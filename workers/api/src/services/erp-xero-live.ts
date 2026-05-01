/**
 * Xero Live Write Adapter — Phase 8-1.
 *
 * Replaces the Phase 7-1 stub for connections opted into `live_mode`.
 * For others (default), the stub continues to record intent without
 * touching Xero. Customer flips `live_mode: true` in the connection's
 * credentials config when they're ready to actually let Atheon write
 * to their Xero org.
 *
 * Design constraints:
 *   1. OAuth2 token refresh on 401, persisting new tokens back to the
 *      connection's encrypted_config so the next sync uses them.
 *   2. Rate-limit handling: Xero returns 429 with Retry-After. We
 *      respect it (capped at 30s) and retry up to 3 times.
 *   3. Per-action error mapping — Xero ApiException JSON maps cleanly
 *      to ActionExecutionResult.error.
 *   4. **Idempotency** is enforced by the dispatcher (Phase 7-1) via the
 *      idempotency_key column. Within a single attempt, Xero's own
 *      idempotent endpoints (PUT /PurchaseOrders, POST /Invoices) are
 *      idempotent on InvoiceNumber/PurchaseOrderNumber if the customer
 *      passes one — so retries during 5xx are safe.
 *
 * Tests use a mocked fetch (cloudflare:test exposes global fetch).
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError, logInfo } from './logger';

// ── Configuration ──────────────────────────────────────────────────────

const XERO_BASE = 'https://api.xero.com';
const XERO_TOKEN_URL = 'https://identity.xero.com/connect/token';
const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 30;

export interface XeroCredentials {
  /** OAuth2 client_id provisioned in Xero developer portal. */
  client_id?: string;
  /** OAuth2 client_secret. Encrypted at rest. */
  client_secret?: string;
  /** Current access token. Refreshed on 401. */
  access_token?: string;
  /** Long-lived refresh token. */
  refresh_token?: string;
  /** Xero tenant id (the customer's Xero org id, NOT Atheon tenantId). */
  xero_tenant_id?: string;
  /** Opt-in flag — when true and credentials are present, real API calls
   *  are made; otherwise the adapter falls back to stub behaviour. */
  live_mode?: boolean;
}

interface RefreshTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
}

// ── Token refresh ──────────────────────────────────────────────────────

async function refreshAccessToken(creds: XeroCredentials): Promise<RefreshTokenResponse | null> {
  if (!creds.client_id || !creds.client_secret || !creds.refresh_token) {
    return null;
  }
  try {
    const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
    const res = await fetch(XERO_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(creds.refresh_token)}`,
    });
    if (!res.ok) {
      logError('xero.live.refresh_failed', new Error(`Refresh token call returned ${res.status}`),
        { tenantId: 'unknown' }, { status: res.status });
      return null;
    }
    return (await res.json()) as RefreshTokenResponse;
  } catch (err) {
    logError('xero.live.refresh_exception', err, { tenantId: 'unknown' }, {});
    return null;
  }
}

/** Persist refreshed tokens back into the connection's encrypted config. */
async function persistRefreshedTokens(
  db: D1Database, tenantId: string, connectionId: string,
  newTokens: RefreshTokenResponse, encryptionKey: string | undefined,
): Promise<void> {
  try {
    const row = await db.prepare(
      'SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?'
    ).bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string }>();
    if (!row) return;

    let parsedConfig: XeroCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const decrypted = await decrypt(row.encrypted_config, encryptionKey);
      if (decrypted) parsedConfig = JSON.parse(decrypted);
    } else if (row.config && row.config !== '{}') {
      parsedConfig = JSON.parse(row.config);
    }
    parsedConfig.access_token = newTokens.access_token;
    if (newTokens.refresh_token) parsedConfig.refresh_token = newTokens.refresh_token;

    const json = JSON.stringify(parsedConfig);
    if (encryptionKey && encryptionKey.length >= 16) {
      const enc = await encrypt(json, encryptionKey);
      await db.prepare(
        `UPDATE erp_connections SET encrypted_config = ?, config = '{}' WHERE id = ? AND tenant_id = ?`
      ).bind(enc, connectionId, tenantId).run();
    } else {
      await db.prepare(
        `UPDATE erp_connections SET config = ? WHERE id = ? AND tenant_id = ?`
      ).bind(json, connectionId, tenantId).run();
    }
  } catch (err) {
    logError('xero.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

// ── HTTP client with refresh + 429 retry ───────────────────────────────

interface CallOptions {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH';
  path: string;
  body?: unknown;
}

interface CallResult {
  ok: boolean;
  status: number;
  body: unknown;
  /** Set when we tried to refresh + retry but still failed. */
  refreshAttempted?: boolean;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Make a Xero API call with one auto-refresh on 401 and bounded
 *  retries on 429. Returns the parsed body + status. */
async function callXeroOnce(
  creds: XeroCredentials, opts: CallOptions,
): Promise<CallResult> {
  const url = `${XERO_BASE}${opts.path}`;
  const headers: Record<string, string> = {
    'Authorization': `Bearer ${creds.access_token || ''}`,
    'Accept': 'application/json',
    'Content-Type': 'application/json',
  };
  if (creds.xero_tenant_id) headers['Xero-tenant-id'] = creds.xero_tenant_id;

  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    // Try to parse JSON, fall back to text
    let parsed: unknown;
    const text = await res.text();
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (res.status === 429) {
      const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
      const wait = Math.min(Math.max(ra, 1), MAX_RETRY_AFTER_SECONDS) * 1000;
      logInfo('xero.live.rate_limited', { tenantId: 'unknown', layer: 'erp', action: 'xero.rate_limit' },
        { attempt: attempt + 1, retry_after_seconds: ra });
      await sleep(wait);
      continue;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
  return { ok: false, status: 429, body: { error: 'Exceeded retry budget on rate-limit' } };
}

async function callXero(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  creds: XeroCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let result = await callXeroOnce(creds, opts);
  if (result.status === 401 && creds.refresh_token) {
    const refreshed = await refreshAccessToken(creds);
    if (refreshed) {
      creds.access_token = refreshed.access_token;
      if (refreshed.refresh_token) creds.refresh_token = refreshed.refresh_token;
      await persistRefreshedTokens(ctx.db, tenantId, connectionId, refreshed, encryptionKey);
      result = await callXeroOnce(creds, opts);
      result.refreshAttempted = true;
    }
  }
  return result;
}

// ── Per-action HTTP shapes ─────────────────────────────────────────────
//
// Each action type maps to a Xero endpoint + body shape. Stays in sync
// with XERO_ACTION_ENDPOINTS in erp-write-adapters.ts.

type LiveCallable = (action: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    method: 'POST',
    path: `/api.xro/2.0/Invoices/${a.payload.invoice_id}/SendInvoice`,
  }),
  ap_payment_release: (a) => ({
    method: 'POST',
    path: '/api.xro/2.0/Payments',
    body: {
      Payments: [{
        Invoice: { InvoiceID: a.payload.invoice_id },
        Account: { Code: a.payload.account_code },
        Amount: a.payload.amount,
        Date: a.payload.payment_date || new Date().toISOString().slice(0, 10),
        Reference: a.payload.reference || `Atheon-${a.idempotency_key}`,
      }],
    },
  }),
  po_create: (a) => ({
    method: 'PUT',
    path: '/api.xro/2.0/PurchaseOrders',
    body: {
      PurchaseOrders: [{
        Contact: { ContactID: a.payload.contact_id },
        LineItems: a.payload.line_items,
        Reference: a.payload.reference || `Atheon-${a.idempotency_key}`,
        Status: a.payload.status || 'DRAFT',
      }],
    },
  }),
  journal_post: (a) => ({
    method: 'POST',
    path: '/api.xro/2.0/ManualJournals',
    body: {
      ManualJournals: [{
        Narration: a.payload.narration,
        JournalLines: a.payload.journal_lines,
        Date: a.payload.date || new Date().toISOString().slice(0, 10),
        Status: 'POSTED',
      }],
    },
  }),
  invoice_post: (a) => ({
    method: 'POST',
    path: `/api.xro/2.0/Invoices/${a.payload.invoice_id}`,
    body: { Invoices: [{ InvoiceID: a.payload.invoice_id, Status: 'AUTHORISED' }] },
  }),
};

// ── Public entry point ─────────────────────────────────────────────────

export interface XeroLiveExecuteOptions {
  /** Atheon tenant id — required to persist refreshed tokens back. */
  tenantId: string;
  /** Connection id — same. */
  connectionId: string;
  /** Atheon's ENCRYPTION_KEY for re-encrypting refreshed token blob. */
  encryptionKey?: string;
}

/** Execute a write-back action against the live Xero API. Caller has
 *  already validated payload + autonomy via the dispatcher. Returns the
 *  same ActionExecutionResult shape the stub returns, so dispatcher /
 *  HITL paths don't change. */
export async function executeXeroLive(
  action: CatalystWriteAction,
  ctx: AdapterContext,
  creds: XeroCredentials,
  opts: XeroLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Xero live adapter does not implement ${action.type}`,
      error: 'unsupported_action' };
  }
  if (!creds.access_token || !creds.xero_tenant_id) {
    return { ok: false, status: 'failed',
      summary: 'Xero live mode is enabled but access_token / xero_tenant_id are missing — re-authenticate the Xero connection',
      error: 'no_credentials' };
  }

  const callOpts = callable(action);
  const result = await callXero(ctx, opts.tenantId, opts.connectionId, creds, callOpts, opts.encryptionKey);

  if (!result.ok) {
    const errBody = result.body as { Detail?: string; Message?: string; ErrorNumber?: number } | string | null;
    let errSummary = `Xero ${callOpts.method} ${callOpts.path} returned HTTP ${result.status}`;
    if (errBody && typeof errBody === 'object') {
      if ('Detail' in errBody && errBody.Detail) errSummary = errBody.Detail;
      else if ('Message' in errBody && errBody.Message) errSummary = errBody.Message;
    }
    return {
      ok: false, status: 'failed', summary: errSummary,
      error: `xero_${result.status}`,
      details: { request: callOpts, response: result.body, refreshed: result.refreshAttempted },
    };
  }

  return {
    ok: true, status: 'completed',
    summary: `Xero ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractXeroId(action.type, result.body),
    details: { request: callOpts, response: result.body, refreshed: result.refreshAttempted },
  };
}

/** Pull a useful Xero id from the response so we can show it in the audit. */
function extractXeroId(type: ActionType, body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (type === 'po_create' && Array.isArray(b.PurchaseOrders) && b.PurchaseOrders[0]) {
    return (b.PurchaseOrders[0] as { PurchaseOrderID?: string }).PurchaseOrderID;
  }
  if (type === 'invoice_post' && Array.isArray(b.Invoices) && b.Invoices[0]) {
    return (b.Invoices[0] as { InvoiceID?: string }).InvoiceID;
  }
  if (type === 'ap_payment_release' && Array.isArray(b.Payments) && b.Payments[0]) {
    return (b.Payments[0] as { PaymentID?: string }).PaymentID;
  }
  if (type === 'journal_post' && Array.isArray(b.ManualJournals) && b.ManualJournals[0]) {
    return (b.ManualJournals[0] as { ManualJournalID?: string }).ManualJournalID;
  }
  return undefined;
}
