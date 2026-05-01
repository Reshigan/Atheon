/**
 * QuickBooks Online Live Write Adapter — Phase 9-3.
 *
 * REST + OAuth2 refresh_token flow. Customers opt in by setting
 * `live_mode: true` plus client_id + client_secret + access_token +
 * refresh_token + realm_id (the QBO company id) in the connection
 * config. The adapter targets the production `quickbooks.api.intuit.com`
 * base; sandbox callers should override `base_url`.
 *
 * Per-action endpoints follow QBO's V3 API. ar_dunning_send maps to
 * the invoice send endpoint. customer_credit_update uses a sparse
 * update body.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError } from './logger';

const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const DEFAULT_BASE = 'https://quickbooks.api.intuit.com';
const MAX_RETRIES = 3;

export interface QboCredentials {
  base_url?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  realm_id?: string;
  live_mode?: boolean;
}

interface RefreshResponse {
  access_token: string; refresh_token?: string; expires_in?: number;
}

async function refreshAccessToken(c: QboCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token) return null;
  try {
    const basic = btoa(`${c.client_id}:${c.client_secret}`);
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`,
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('qbo.live.refresh_exception', err, { tenantId: 'unknown' }, {});
    return null;
  }
}

async function persistTokens(
  db: D1Database, tenantId: string, connectionId: string,
  newToken: RefreshResponse, encryptionKey: string | undefined,
): Promise<void> {
  try {
    const row = await db.prepare('SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?')
      .bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string }>();
    if (!row) return;
    let parsed: QboCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      if (dec) parsed = JSON.parse(dec);
    } else if (row.config && row.config !== '{}') {
      parsed = JSON.parse(row.config);
    }
    parsed.access_token = newToken.access_token;
    if (newToken.refresh_token) parsed.refresh_token = newToken.refresh_token;
    const json = JSON.stringify(parsed);
    if (encryptionKey && encryptionKey.length >= 16) {
      const enc = await encrypt(json, encryptionKey);
      await db.prepare(`UPDATE erp_connections SET encrypted_config = ?, config = '{}' WHERE id = ? AND tenant_id = ?`)
        .bind(enc, connectionId, tenantId).run();
    } else {
      await db.prepare(`UPDATE erp_connections SET config = ? WHERE id = ? AND tenant_id = ?`)
        .bind(json, connectionId, tenantId).run();
    }
  } catch (err) {
    logError('qbo.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  query?: Record<string, string>;
}

interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callQboOnce(c: QboCredentials, opts: CallOptions): Promise<CallResult> {
  const base = c.base_url || DEFAULT_BASE;
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  const url = `${base}/v3/company/${c.realm_id}${opts.path}${qs}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.access_token || ''}`,
    Accept: 'application/json', 'Content-Type': 'application/json',
  };
  for (let i = 0; i < MAX_RETRIES; i++) {
    const res = await fetch(url, {
      method: opts.method, headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (res.status === 429) {
      const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
      await sleep(Math.min(Math.max(ra, 1), 30) * 1000);
      continue;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
  return { ok: false, status: 429, body: { error: 'Exceeded retry budget' } };
}

async function callQbo(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: QboCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callQboOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callQboOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    method: 'POST',
    path: `/invoice/${a.payload.invoice_id}/send`,
    query: a.payload.email ? { sendTo: String(a.payload.email) } : undefined,
  }),
  ap_payment_release: (a) => ({
    method: 'POST', path: `/billpayment`,
    body: {
      VendorRef: { value: String(a.payload.vendor_id) },
      TotalAmt: a.payload.amount,
      PayType: a.payload.pay_type || 'Check',
      Line: [{ Amount: a.payload.amount, LinkedTxn: [{ TxnId: String(a.payload.bill_id), TxnType: 'Bill' }] }],
    },
  }),
  po_create: (a) => ({
    method: 'POST', path: `/purchaseorder`,
    body: {
      VendorRef: { value: String(a.payload.vendor_id) },
      Line: a.payload.line_items,
      APAccountRef: a.payload.ap_account_ref,
    },
  }),
  journal_post: (a) => ({
    method: 'POST', path: `/journalentry`,
    body: { Line: a.payload.lines, TxnDate: a.payload.txn_date || new Date().toISOString().slice(0, 10) },
  }),
  invoice_post: (a) => ({
    method: 'POST', path: `/invoice`,
    body: {
      Id: a.payload.invoice_id, sparse: true,
      // Posting to AUTHORISED in QBO is implicit on Invoice creation
    },
  }),
  customer_credit_update: (a) => ({
    method: 'POST', path: `/customer`,
    body: { Id: String(a.payload.customer_id), sparse: true, CreditLimit: a.payload.credit_limit },
  }),
};

export interface QboLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeQboLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: QboCredentials, opts: QboLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed', summary: `QuickBooks live adapter does not implement ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.access_token || !c.realm_id) {
    return { ok: false, status: 'failed',
      summary: 'QuickBooks live mode is enabled but access_token / realm_id are missing — re-authenticate',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callQbo(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `QuickBooks ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { Fault?: { Error?: Array<{ Message?: string; Detail?: string }> } } | string | null;
    if (body && typeof body === 'object' && body.Fault?.Error?.[0]) {
      summary = body.Fault.Error[0].Detail || body.Fault.Error[0].Message || summary;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `qbo_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `QuickBooks ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractQboId(action.type, r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractQboId(type: ActionType, body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (type === 'po_create' && b.PurchaseOrder) return (b.PurchaseOrder as { Id?: string }).Id;
  if (type === 'journal_post' && b.JournalEntry) return (b.JournalEntry as { Id?: string }).Id;
  if (type === 'invoice_post' && b.Invoice) return (b.Invoice as { Id?: string }).Id;
  if (type === 'ap_payment_release' && b.BillPayment) return (b.BillPayment as { Id?: string }).Id;
  return undefined;
}
