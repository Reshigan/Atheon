/**
 * Sage Business Cloud Accounting Live Write Adapter — Phase 9-4.
 *
 * REST + OAuth2. Customers opt in by setting `live_mode: true` plus
 * client_id + client_secret + access_token + refresh_token + business_id
 * in the connection config.
 *
 * Sage Intacct (the US/enterprise sibling) uses a different XML-based
 * API; that variant gets its own adapter when customer demand warrants.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError } from './logger';

const TOKEN_URL = 'https://oauth.accounting.sage.com/token';
const BASE_URL = 'https://api.accounting.sage.com/v3.1';
const MAX_RETRIES = 3;

export interface SageCredentials {
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  /** Sage business id — multi-business customers must specify */
  business_id?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

async function refreshAccessToken(c: SageCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token) return null;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
      client_id: c.client_id,
      client_secret: c.client_secret,
    });
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('sage.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: SageCredentials = {};
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
    logError('sage.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PUT' | 'DELETE'; path: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callSageOnce(c: SageCredentials, opts: CallOptions): Promise<CallResult> {
  const url = `${BASE_URL}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.access_token || ''}`,
    Accept: 'application/json', 'Content-Type': 'application/json',
  };
  if (c.business_id) headers['X-Business'] = c.business_id;

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

async function callSage(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: SageCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callSageOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callSageOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ap_payment_release: (a) => ({
    method: 'POST', path: `/contact_payments`,
    body: {
      contact_payment: {
        contact_id: a.payload.vendor_id,
        bank_account_id: a.payload.bank_account_id,
        date: a.payload.payment_date || new Date().toISOString().slice(0, 10),
        total_amount: a.payload.amount,
        contact_payment_allocations: a.payload.allocations,
      },
    },
  }),
  po_create: (a) => ({
    method: 'POST', path: `/purchase_orders`,
    body: {
      purchase_order: {
        contact_id: a.payload.vendor_id,
        date: a.payload.order_date || new Date().toISOString().slice(0, 10),
        purchase_order_lines: a.payload.line_items,
        reference: a.payload.reference || `Atheon-${a.idempotency_key}`,
      },
    },
  }),
  journal_post: (a) => ({
    method: 'POST', path: `/journals`,
    body: {
      journal: {
        date: a.payload.date || new Date().toISOString().slice(0, 10),
        reference: a.payload.reference,
        journal_lines: a.payload.lines,
      },
    },
  }),
  invoice_post: (a) => ({
    method: 'POST', path: `/sales_invoices`,
    body: { sales_invoice: { id: a.payload.invoice_id, status: 'AUTHORISED' } },
  }),
  customer_credit_update: (a) => ({
    method: 'PUT', path: `/contacts/${a.payload.contact_id}`,
    body: { contact: { credit_limit: a.payload.credit_limit } },
  }),
  // ar_dunning_send not in Sage Business Cloud — adapter rejects
};

export interface SageLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeSageLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: SageCredentials, opts: SageLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Sage Business Cloud does not natively support ${action.type}`,
      error: 'unsupported_action' };
  }
  if (!c.access_token) {
    return { ok: false, status: 'failed',
      summary: 'Sage live mode is enabled but access_token is missing — re-authenticate',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callSage(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Sage ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { '$errors'?: Array<{ '$message'?: string }> } | { '$message'?: string } | string | null;
    if (body && typeof body === 'object') {
      const errs = (body as { '$errors'?: Array<{ '$message'?: string }> })['$errors'];
      if (errs && errs[0]?.['$message']) summary = errs[0]['$message'];
      else if ((body as { '$message'?: string })['$message']) summary = (body as { '$message': string })['$message'];
    }
    return {
      ok: false, status: 'failed', summary,
      error: `sage_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Sage ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractSageId(r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractSageId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (b.id) return String(b.id);
  if (b.purchase_order && (b.purchase_order as { id?: string }).id) return String((b.purchase_order as { id: string }).id);
  return undefined;
}
