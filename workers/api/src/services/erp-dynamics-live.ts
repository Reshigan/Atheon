/**
 * Microsoft Dynamics 365 Business Central Live Write Adapter — Phase 9-4.
 *
 * REST + Azure AD OAuth2. Customers opt in by setting `live_mode: true`
 * plus aad_tenant_id + client_id + client_secret + access_token +
 * refresh_token + bc_tenant_id + bc_environment + company_id in the
 * connection config.
 *
 * Targets BC v2.0 cloud API. Finance & Operations apps use a different
 * base — that variant can plug in via a per-credential `api_variant`.
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

export interface DynamicsCredentials {
  /** Azure AD tenant id (guid) */
  aad_tenant_id?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  /** Business Central tenant id (matches `aad_tenant_id` in cloud) */
  bc_tenant_id?: string;
  /** BC environment name (e.g. "Production", "Sandbox") */
  bc_environment?: string;
  /** BC company id (guid) */
  company_id?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

function tokenUrl(c: DynamicsCredentials): string {
  return `https://login.microsoftonline.com/${c.aad_tenant_id}/oauth2/v2.0/token`;
}
function baseUrl(c: DynamicsCredentials): string {
  return `https://api.businesscentral.dynamics.com/v2.0/${c.bc_tenant_id}/${c.bc_environment || 'Production'}/api/v2.0`;
}

async function refreshAccessToken(c: DynamicsCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token || !c.aad_tenant_id) return null;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
      client_id: c.client_id,
      client_secret: c.client_secret,
      scope: 'https://api.businesscentral.dynamics.com/.default offline_access',
    });
    const res = await fetch(tokenUrl(c), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('dynamics.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: DynamicsCredentials = {};
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
    logError('dynamics.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown; etag?: string }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callBcOnce(c: DynamicsCredentials, opts: CallOptions): Promise<CallResult> {
  const url = `${baseUrl(c)}${opts.path}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${c.access_token || ''}`,
    Accept: 'application/json', 'Content-Type': 'application/json',
  };
  // Business Central requires If-Match for PATCH writes
  if (opts.method === 'PATCH') headers['If-Match'] = opts.etag || '*';

  for (let i = 0; i < MAX_RETRIES; i++) {
    const res = await fetch(url, {
      method: opts.method, headers,
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
    });
    const text = await res.text();
    let parsed: unknown; try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }
    if (res.status === 429 || res.status === 503) {
      const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
      await sleep(Math.min(Math.max(ra, 1), 30) * 1000);
      continue;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
  return { ok: false, status: 429, body: { error: 'Exceeded retry budget' } };
}

async function callBc(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: DynamicsCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callBcOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callBcOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  po_create: (a) => ({
    method: 'POST',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/purchaseOrders`.replace('__default__', ''),
    body: {
      vendorNumber: a.payload.vendor_number,
      vendorInvoiceNumber: a.payload.vendor_invoice_number,
      orderDate: a.payload.order_date,
    },
  }),
  invoice_post: (a) => ({
    method: 'POST',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/salesInvoices(${a.payload.invoice_id})/Microsoft.NAV.post`.replace('__default__', ''),
  }),
  ap_payment_release: (a) => ({
    method: 'POST',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/vendorPayments`.replace('__default__', ''),
    body: {
      vendorNumber: a.payload.vendor_number,
      amount: a.payload.amount,
      postingDate: a.payload.posting_date || new Date().toISOString().slice(0, 10),
    },
  }),
  journal_post: (a) => ({
    method: 'POST',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/journals(${a.payload.journal_id})/Microsoft.NAV.post`.replace('__default__', ''),
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/customers(${a.payload.customer_id})`.replace('__default__', ''),
    body: { creditLimit: a.payload.credit_limit },
  }),
  ar_dunning_send: (a) => ({
    method: 'POST',
    path: `/companies(${(a.payload.company_id_override || '__default__')})/customerStatementEmails`.replace('__default__', ''),
    body: { customerNumber: a.payload.customer_number },
  }),
};

export interface DynamicsLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeDynamicsLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: DynamicsCredentials, opts: DynamicsLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed', summary: `Dynamics live adapter does not implement ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.access_token || !c.bc_tenant_id || !c.bc_environment) {
    return { ok: false, status: 'failed',
      summary: 'Dynamics live mode is enabled but bc_tenant_id / bc_environment / access_token are missing — re-authenticate',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  // Inject default company_id when payload didn't override
  if (callOpts.path.includes('()')) {
    callOpts.path = callOpts.path.replace('()', `(${c.company_id || ''})`);
  }
  const r = await callBc(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Dynamics ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { error?: { message?: string; code?: string } } | string | null;
    if (body && typeof body === 'object' && body.error?.message) summary = body.error.message;
    return {
      ok: false, status: 'failed', summary,
      error: `dynamics_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Dynamics ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractDynamicsId(action.type, r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractDynamicsId(type: ActionType, body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (type === 'po_create' && b.id) return String(b.id);
  if (type === 'ap_payment_release' && b.id) return String(b.id);
  return undefined;
}
