/**
 * NetSuite Live Write Adapter — Phase 9-3.
 *
 * NetSuite SuiteTalk REST API. Supports both OAuth2 (preferred for new
 * integrations) and TBA (Token-Based Auth, OAuth1) — this adapter
 * targets OAuth2 since it's straightforward in a Workers environment.
 * TBA support can plug in later via a per-credential `auth_scheme`.
 *
 * Customers opt in by setting `live_mode: true` plus account_id +
 * client_id + client_secret + access_token + refresh_token in the
 * connection config. Base URL is derived from account_id.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError } from './logger';

const MAX_RETRIES = 3;

export interface NetSuiteCredentials {
  account_id?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

function baseUrl(c: NetSuiteCredentials): string {
  // NetSuite account ids are like "1234567" or "1234567_SB1" for sandboxes.
  // Hostname uses lowercase with underscores converted.
  const acct = (c.account_id || '').toLowerCase().replace(/_/g, '-');
  return `https://${acct}.suitetalk.api.netsuite.com/services/rest`;
}

function tokenUrl(c: NetSuiteCredentials): string {
  const acct = (c.account_id || '').toLowerCase().replace(/_/g, '-');
  return `https://${acct}.suitetalk.api.netsuite.com/services/rest/auth/oauth2/v1/token`;
}

async function refreshAccessToken(c: NetSuiteCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token || !c.account_id) return null;
  try {
    const basic = btoa(`${c.client_id}:${c.client_secret}`);
    const res = await fetch(tokenUrl(c), {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`,
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('netsuite.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: NetSuiteCredentials = {};
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
    logError('netsuite.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean; locationHeader?: string }

async function callNetSuiteOnce(c: NetSuiteCredentials, opts: CallOptions): Promise<CallResult> {
  const url = `${baseUrl(c)}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.access_token || ''}`,
    Accept: 'application/json', 'Content-Type': 'application/json',
    Prefer: 'transient', // NetSuite: don't store the request, return Location header
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
    return { ok: res.ok, status: res.status, body: parsed, locationHeader: res.headers.get('location') || undefined };
  }
  return { ok: false, status: 429, body: { error: 'Exceeded retry budget' } };
}

async function callNetSuite(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: NetSuiteCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callNetSuiteOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callNetSuiteOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    method: 'POST', path: `/record/v1/invoice/${a.payload.invoice_id}/!transform/dunningEmail`,
    body: { template: a.payload.template || 'standard' },
  }),
  ap_payment_release: (a) => ({
    method: 'POST', path: `/record/v1/vendorPayment`,
    body: {
      entity: { id: a.payload.vendor_id },
      apply: a.payload.bill_links,
      account: { id: a.payload.account_id },
      currency: { id: a.payload.currency_id || '1' },
    },
  }),
  po_create: (a) => ({
    method: 'POST', path: `/record/v1/purchaseOrder`,
    body: {
      entity: { id: a.payload.vendor_id },
      item: { items: a.payload.items },
      memo: a.payload.memo || `Atheon-${a.idempotency_key}`,
    },
  }),
  journal_post: (a) => ({
    method: 'POST', path: `/record/v1/journalEntry`,
    body: { line: { items: a.payload.lines }, memo: a.payload.memo },
  }),
  invoice_post: (a) => ({
    method: 'PATCH', path: `/record/v1/invoice/${a.payload.invoice_id}`,
    body: { status: { id: 'A', refName: 'Open' } },
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH', path: `/record/v1/customer/${a.payload.customer_id}`,
    body: { creditLimit: a.payload.credit_limit },
  }),
};

export interface NetSuiteLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeNetSuiteLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: NetSuiteCredentials, opts: NetSuiteLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed', summary: `NetSuite live adapter does not implement ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.access_token || !c.account_id) {
    return { ok: false, status: 'failed',
      summary: 'NetSuite live mode is enabled but account_id / access_token are missing — re-authenticate',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callNetSuite(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `NetSuite ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { 'o:errorDetails'?: Array<{ detail?: string }> } | { title?: string } | string | null;
    if (body && typeof body === 'object') {
      const oErr = body as { 'o:errorDetails'?: Array<{ detail?: string }> };
      if (oErr['o:errorDetails']?.[0]?.detail) summary = oErr['o:errorDetails'][0].detail!;
      else if ((body as { title?: string }).title) summary = (body as { title: string }).title;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `netsuite_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  // NetSuite returns the new record's id in the Location header for POSTs
  let erpRef: string | undefined;
  if (r.locationHeader) {
    const parts = r.locationHeader.split('/');
    erpRef = parts[parts.length - 1];
  }
  return {
    ok: true, status: 'completed',
    summary: `NetSuite ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: erpRef,
    details: { request: callOpts, response: r.body, location: r.locationHeader, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}
