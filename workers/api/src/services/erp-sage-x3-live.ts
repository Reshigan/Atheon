/**
 * Sage X3 Live Write Adapter — Phase 9-6.
 *
 * X3 v12+ exposes a REST API at /api1/x3/erp/{folder} with OAuth2.
 * Older v11 deployments use SOAP — that variant gets its own adapter
 * if customer demand surfaces.
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

export interface SageX3Credentials {
  /** X3 base URL — e.g. https://x3.acme.com */
  base_url?: string;
  /** Folder name (X3 multi-folder dimension) */
  folder?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  refresh_token?: string;
  live_mode?: boolean;
}

interface RefreshResponse { access_token: string; refresh_token?: string; expires_in?: number }

async function refreshAccessToken(c: SageX3Credentials): Promise<RefreshResponse | null> {
  if (!c.client_id || !c.client_secret || !c.refresh_token || !c.base_url) return null;
  try {
    const url = `${c.base_url}/oauth2/token`;
    const basic = btoa(`${c.client_id}:${c.client_secret}`);
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(c.refresh_token)}`,
    });
    if (!res.ok) return null;
    return (await res.json()) as RefreshResponse;
  } catch (err) {
    logError('sage_x3.live.refresh_exception', err, { tenantId: 'unknown' }, {});
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
    let parsed: SageX3Credentials = {};
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
    logError('sage_x3.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function sleep(ms: number): Promise<void> { return new Promise(r => setTimeout(r, ms)); }

interface CallOptions { method: 'GET' | 'POST' | 'PATCH'; path: string; body?: unknown }
interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function callOnce(c: SageX3Credentials, opts: CallOptions): Promise<CallResult> {
  const url = `${c.base_url}/api1/x3/erp/${c.folder}${opts.path}`;
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

async function callX3(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  c: SageX3Credentials, opts: CallOptions, encryptionKey: string | undefined,
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
  po_create: (a) => ({
    method: 'POST', path: `/PORDERS`,
    body: {
      BPSNUM: a.payload.vendor_code,
      ORDDAT: a.payload.order_date,
      LINES: a.payload.lines,
    },
  }),
  ap_payment_release: (a) => ({
    method: 'POST', path: `/PAYMENT`,
    body: { PAYNUM: a.payload.payment_number, PAYAMT: a.payload.amount },
  }),
  journal_post: (a) => ({
    method: 'POST', path: `/GACCENTRY`,
    body: {
      JOU: a.payload.journal_code,
      ACCDAT: a.payload.entry_date,
      LINES: a.payload.lines,
    },
  }),
  invoice_post: (a) => ({
    method: 'PATCH', path: `/SINVOICE/${a.payload.invoice_number}`,
    body: { VLYFLG: '2' /* validated */ },
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH', path: `/BPCUSTOMER/${a.payload.customer_code}`,
    body: { OSTCTL: a.payload.credit_limit },
  }),
};

export interface SageX3LiveExecuteOptions { tenantId: string; connectionId: string; encryptionKey?: string }

export async function executeSageX3Live(
  action: CatalystWriteAction, ctx: AdapterContext, c: SageX3Credentials, opts: SageX3LiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Sage X3 live adapter does not implement ${action.type}`, error: 'unsupported_action' };
  }
  if (!c.access_token || !c.base_url || !c.folder) {
    return { ok: false, status: 'failed',
      summary: 'Sage X3 live mode enabled but base_url / folder / access_token missing',
      error: 'no_credentials' };
  }
  const callOpts = callable(action);
  const r = await callX3(ctx, opts.tenantId, opts.connectionId, c, callOpts, opts.encryptionKey);
  if (!r.ok) {
    let summary = `Sage X3 ${callOpts.method} ${callOpts.path} returned HTTP ${r.status}`;
    const body = r.body as { __diagnoses?: Array<{ message?: string }>; message?: string } | string | null;
    if (body && typeof body === 'object') {
      if (body.__diagnoses && body.__diagnoses[0]?.message) summary = body.__diagnoses[0].message;
      else if (body.message) summary = body.message;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `sage_x3_${r.status}`,
      details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    };
  }
  return {
    ok: true, status: 'completed',
    summary: `Sage X3 ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractX3Id(r.body),
    details: { request: callOpts, response: r.body, refreshed: r.refreshAttempted },
    mode: 'live',
  };
}

function extractX3Id(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  if (b.POHNUM) return String(b.POHNUM);
  if (b.NUM) return String(b.NUM);
  return undefined;
}
