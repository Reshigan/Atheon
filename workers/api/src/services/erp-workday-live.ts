/**
 * Workday Live Write Adapter — Phase 9-5.
 *
 * Workday is HCM-first; only a subset of action types have natural
 * equivalents in the Financials API (REST in v1+, OAuth2):
 *   - journal_post           → POST /ccx/api/financialAccounting/v1/{tenant}/journals
 *   - ap_payment_release     → POST /ccx/api/expenses/v1/{tenant}/supplierInvoiceRequests
 *   - customer_credit_update → PATCH /ccx/api/financialAccounting/v1/{tenant}/customers/{id}
 * po_create / invoice_post / ar_dunning_send return `unsupported_action`.
 *
 * Workday OAuth2 uses `tenant` as a routing path component plus
 * `client_id`/`client_secret`/`refresh_token`. ISU (Integration System
 * User) is the recommended principal for service integrations.
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

export interface WorkdayCredentials {
  /** Workday tenant alias — appears in the path. */
  tenant?: string;
  /** Workday host — e.g. https://wd2-impl-services1.workday.com */
  host?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

async function refreshAccessToken(c: WorkdayCredentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token || !c.host || !c.tenant) return null;
  try {
    const url = `${c.host}/ccx/oauth2/${c.tenant}/token`;
    const basic = btoa(`${c.client_id}:${c.client_secret}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`,
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('workday.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: WorkdayCredentials = {};
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
    logError('workday.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; pathFragment: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callOnce(c: WorkdayCredentials, opts: CallOptions): Promise<CallResult> {
  const url = `${c.host}/ccx/api${opts.pathFragment.replace('{tenant}', c.tenant || '')}`;
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

async function callWorkday(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: WorkdayCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  let r = await callOnce(c, opts);
  if (r.status === 401 && c.refresh_token) {
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

type LiveCallable = (a: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  journal_post: (a) => ({
    method: 'POST',
    pathFragment: `/financialAccounting/v1/{tenant}/journals`,
    body: {
      ledger: a.payload.ledger,
      accountingDate: a.payload.accounting_date,
      lines: a.payload.lines,
    },
  }),
  ap_payment_release: (a) => ({
    method: 'POST',
    pathFragment: `/expenses/v1/{tenant}/supplierInvoiceRequests`,
    body: {
      supplier: a.payload.supplier,
      invoiceAmount: a.payload.amount,
      memo: a.payload.memo || `Atheon-${a.idempotency_key}`,
    },
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH',
    pathFragment: `/financialAccounting/v1/{tenant}/customers/${a.payload.customer_id}`,
    body: { creditLimit: a.payload.credit_limit },
  }),
};

export interface WorkdayLiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeWorkdayLive(
  action: CatalystWriteAction, ctx: AdapterContext, c: WorkdayCredentials, opts: WorkdayLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Workday is HCM-first; ${action.type} has no native financials equivalent`,
      error: 'unsupported_action' };
  }
  if (!c.access_token || !c.host || !c.tenant) {
    return { ok: false, status: 'failed',
      summary: 'Workday live mode is enabled but host / tenant / access_token are missing',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callWorkday(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Workday ${callOpts.method} ${callOpts.pathFragment} returned HTTP ${r.status}`;
    const body = r.body as { error?: string; description?: string } | string | null;
    if (body && typeof body === 'object') {
      if (body.description) summary = body.description;
      else if (body.error) summary = body.error;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `workday_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Workday ${callOpts.method} succeeded`,
    erp_reference: extractWorkdayId(r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractWorkdayId(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (b.id) return String(b.id);
  if (b.descriptor) return String(b.descriptor);
  return undefined;
}
