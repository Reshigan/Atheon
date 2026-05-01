/**
 * Oracle Fusion Cloud (Oracle ERP Cloud) Live Write Adapter — Phase 9-5.
 *
 * REST + OAuth2 (or BasicAuth via username/password — supported via
 * `auth_scheme: 'basic'`). Fusion offers all 6 standard action types
 * via /fscmRestApi/resources/11.13.18.05/...
 *
 * Customers opt in by setting `live_mode: true` plus pod_url +
 * (access_token + refresh_token + client_id + client_secret) for OAuth,
 * or (username + password) for Basic.
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

export interface OracleCredentials {
  /** Oracle Cloud pod URL — e.g. https://acme-test.fa.us6.oraclecloud.com */
  pod_url?: string;
  auth_scheme?: 'oauth' | 'basic';
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  username?: string;
  password?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

async function refreshAccessToken(c: OracleCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token || !c.pod_url) return null;
  try {
    const basic = btoa(`${c.client_id}:${c.client_secret}`);
    const res = await fetch(`${c.pod_url}/oauth2/v1/token`, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`,
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('oracle.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: OracleCredentials = {};
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
    logError('oracle.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

function authHeader(c: OracleCredentials): string {
  if (c.auth_scheme === 'basic' && c.username && c.password) {
    return `Basic ${btoa(`${c.username}:${c.password}`)}`;
  }
  return `Bearer ${c.access_token || ''}`;
}

async function callOnce(c: OracleCredentials, opts: CallOptions): Promise<CallResult> {
  const url = `${c.pod_url}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: authHeader(c),
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

async function callOracle(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: OracleCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callOnce(c, opts);
  if (r.status === 401 && c.auth_scheme !== 'basic' && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

const FSCM = '/fscmRestApi/resources/11.13.18.05';

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    method: 'POST', path: `${FSCM}/dunningCorrespondences`,
    body: { CustomerNumber: a.payload.customer_number, BusinessUnit: a.payload.business_unit },
  }),
  ap_payment_release: (a) => ({
    method: 'POST', path: `${FSCM}/paymentRequests`,
    body: { PaymentRequestId: a.payload.payment_request_id, Action: 'RELEASE' },
  }),
  po_create: (a) => ({
    method: 'POST', path: `${FSCM}/purchaseOrders`,
    body: {
      Supplier: a.payload.supplier,
      ProcurementBU: a.payload.procurement_bu,
      RequisitioningBU: a.payload.requisitioning_bu,
      lines: a.payload.lines,
    },
  }),
  journal_post: (a) => ({
    method: 'POST', path: `${FSCM}/journals`,
    body: {
      LedgerName: a.payload.ledger_name,
      AccountingPeriod: a.payload.period,
      JournalLines: a.payload.lines,
    },
  }),
  invoice_post: (a) => ({
    method: 'PATCH', path: `${FSCM}/invoices/${a.payload.invoice_id}`,
    body: { InvoiceStatus: 'COMPLETE' },
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH', path: `${FSCM}/customers/${a.payload.customer_id}`,
    body: { OverallCreditLimit: a.payload.credit_limit },
  }),
};

export interface OracleLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeOracleLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: OracleCredentials, opts: OracleLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed', summary: `Oracle Fusion live adapter does not implement ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.pod_url) {
    return { ok: false, status: 'failed', summary: 'Oracle live mode is enabled but pod_url is missing', error: 'no_credentials' };
  }
  if (c.auth_scheme === 'basic' ? !c.username || !c.password : !c.access_token) {
    return { ok: false, status: 'failed',
      summary: c.auth_scheme === 'basic'
        ? 'Oracle basic auth requires username + password'
        : 'Oracle OAuth requires access_token (and refresh_token + client_id/secret for refresh)',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callOracle(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Oracle ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { detail?: string; title?: string } | string | null;
    if (body && typeof body === 'object') {
      if (body.detail) summary = body.detail;
      else if (body.title) summary = body.title;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `oracle_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Oracle ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractOracleId(r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractOracleId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (b.PurchaseOrderId) return String(b.PurchaseOrderId);
  if (b.JournalId) return String(b.JournalId);
  if (b.InvoiceId) return String(b.InvoiceId);
  return undefined;
}
