/**
 * Salesforce Live Write Adapter — Phase 9-5.
 *
 * Salesforce is CRM-first, not a full ERP. Only a subset of Atheon's
 * write-back action types have natural equivalents:
 *   - customer_credit_update → PATCH /sobjects/Account/{id} (custom field)
 *   - ar_dunning_send        → create a Case + send Email via REST
 * Other action types (po_create, journal_post, invoice_post,
 * ap_payment_release) return `unsupported_action`.
 *
 * Auth: OAuth2 refresh_token. Per-tenant `instance_url` (e.g.
 * `https://yourcompany.my.salesforce.com`) is required.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError } from './logger';

const TOKEN_URL_LOGIN = 'https://login.salesforce.com/services/oauth2/token';
const MAX_RETRIES = 3;

export interface SalesforceCredentials {
  /** Salesforce instance URL — set after first OAuth handshake. */
  instance_url?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  /** API version to target — defaults to v60.0 (Spring '24). */
  api_version?: string;
  live_mode?: boolean;
}

interface RefreshResponse {
  access_token: string;
  refresh_token?: string;
  instance_url?: string;
  expires_in?: number;
}

async function refreshAccessToken(c: SalesforceCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token) return null;
  try {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: c.refresh_token,
      client_id: c.client_id,
      client_secret: c.client_secret,
    });
    const res = await fetch(TOKEN_URL_LOGIN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('salesforce.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: SalesforceCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      if (dec) parsed = JSON.parse(dec);
    } else if (row.config && row.config !== '{}') {
      parsed = JSON.parse(row.config);
    }
    parsed.access_token = newToken.access_token;
    if (newToken.refresh_token) parsed.refresh_token = newToken.refresh_token;
    if (newToken.instance_url) parsed.instance_url = newToken.instance_url;
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
    logError('salesforce.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callOnce(c: SalesforceCredentials, opts: CallOptions): Promise<CallResult> {
  const v = c.api_version || 'v60.0';
  const url = `${c.instance_url}/services/data/${v}${opts.path}`;
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

async function callSalesforce(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: SalesforceCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
    const t = await refreshAccessToken(c);
    if (t) {
      c.access_token = t.access_token;
      if (t.refresh_token) c.refresh_token = t.refresh_token;
      if (t.instance_url) c.instance_url = t.instance_url;
      await persistTokens(ctx.db, tenantId, connectionId, t, encryptionKey);
      r = await callOnce(c, opts);
      r.refreshAttempted = true;
    }
  }
  return r;
}

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  customer_credit_update: (a) => ({
    method: 'PATCH',
    path: `/sobjects/Account/${a.payload.account_id}`,
    body: { CreditLimit__c: a.payload.credit_limit },
  }),
  ar_dunning_send: (a) => ({
    method: 'POST',
    path: `/sobjects/Case`,
    body: {
      AccountId: a.payload.account_id,
      Subject: a.payload.subject || `Overdue invoice reminder — ${a.payload.invoice_number || 'INV'}`,
      Description: a.payload.description || 'Atheon-generated dunning case',
      Origin: 'Atheon',
      Status: 'New',
    },
  }),
};

export interface SalesforceLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeSalesforceLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: SalesforceCredentials, opts: SalesforceLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Salesforce is CRM-first; ${action.type} has no native equivalent. Use a financials-system connection for this action.`,
      error: 'unsupported_action' };
  }
  if (!c.access_token || !c.instance_url) {
    return { ok: false, status: 'failed',
      summary: 'Salesforce live mode is enabled but instance_url / access_token are missing — re-authenticate',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callSalesforce(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Salesforce ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as Array<{ message?: string; errorCode?: string }> | { message?: string } | string | null;
    if (Array.isArray(body) && body[0]?.message) summary = body[0].message;
    else if (body && typeof body === 'object' && (body as { message?: string }).message) summary = (body as { message: string }).message;
    return {
      ok: false, status: 'failed', summary,
      error: `salesforce_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Salesforce ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractSfId(r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractSfId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (b.id) return String(b.id);
  return undefined;
}
