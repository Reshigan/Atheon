/**
 * Odoo Live Write Adapter — Phase 9-2.
 *
 * Real JSON-RPC write-back for connections opted into `live_mode`.
 * Modern Odoo (≥ 14) supports `/jsonrpc` cleanly; older instances also
 * support `/xmlrpc/2/object` but JSON-RPC is much easier to implement
 * in a Workers environment without an XML library.
 *
 * Auth: per Odoo convention, customers provision an API key (Settings →
 * Users & Companies → Users → API Keys). The adapter calls
 * `/jsonrpc service=common method=authenticate` with db + username +
 * key to resolve a uid (cached on the connection), then per write
 * `service=object method=execute_kw` with that uid + key.
 *
 * Error mapping: Odoo JSON-RPC returns errors in the body as
 * `{"error": {"data": {"name": "...", "message": "..."}}}` on a 200 OK,
 * so we check the error field rather than HTTP status.
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

export interface OdooCredentials {
  base_url?: string;
  db?: string;
  username?: string;
  /** API key generated from Odoo Settings → Users → API Keys. */
  api_key?: string;
  /** Cached uid resolved via authenticate. */
  uid?: number;
  live_mode?: boolean;
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc?: string;
  id?: number | null;
  result?: T;
  error?: {
    code?: number;
    message?: string;
    data?: {
      name?: string;
      message?: string;
      arguments?: unknown[];
      debug?: string;
    };
  };
}

async function callJsonRpc<T = unknown>(
  base: string, service: string, method: string, args: unknown[],
): Promise<JsonRpcResponse<T>> {
  const url = `${base}/jsonrpc`;
  const body = {
    jsonrpc: '2.0', method: 'call',
    params: { service, method, args },
    id: 1,
  };
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    return { error: { message: `HTTP ${res.status}`, data: { name: 'http_error', message: `Odoo /jsonrpc returned HTTP ${res.status}` } } };
  }
  try { return (await res.json()) as JsonRpcResponse<T>; }
  catch { return { error: { message: 'Invalid JSON', data: { name: 'parse_error', message: 'Could not parse Odoo /jsonrpc response' } } }; }
}

async function persistUid(
  db: D1Database, tenantId: string, connectionId: string,
  uid: number, encryptionKey: string | undefined,
): Promise<void> {
  try {
    const row = await db.prepare(
      'SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?'
    ).bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string }>();
    if (!row) return;

    let parsed: OdooCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      if (dec) parsed = JSON.parse(dec);
    } else if (row.config && row.config !== '{}') {
      parsed = JSON.parse(row.config);
    }
    parsed.uid = uid;

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
    logError('odoo.live.uid_persist_failed', err, { tenantId }, { connectionId });
  }
}

async function ensureUid(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  creds: OdooCredentials, encryptionKey: string | undefined,
): Promise<number | null> {
  if (creds.uid) return creds.uid;
  if (!creds.base_url || !creds.db || !creds.username || !creds.api_key) return null;
  const r = await callJsonRpc<number | false>(
    creds.base_url, 'common', 'authenticate',
    [creds.db, creds.username, creds.api_key, {}],
  );
  if (r.error || !r.result || typeof r.result !== 'number') {
    logError('odoo.live.authenticate_failed', new Error(r.error?.data?.message || 'auth failed'),
      { tenantId }, { connectionId });
    return null;
  }
  creds.uid = r.result;
  await persistUid(ctx.db, tenantId, connectionId, r.result, encryptionKey);
  return r.result;
}

interface ExecuteKwCall {
  model: string;
  method: string;
  positional: unknown[];
  kwargs?: Record<string, unknown>;
}

type LiveCallable = (action: CatalystWriteAction) => ExecuteKwCall;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    model: 'account.followup.report',
    method: 'send_followup',
    positional: [[a.payload.partner_id]],
  }),
  ap_payment_release: (a) => ({
    model: 'account.payment',
    method: 'action_post',
    positional: [[a.payload.payment_id]],
  }),
  po_create: (a) => ({
    model: 'purchase.order',
    method: 'create',
    positional: [[{
      partner_id: a.payload.partner_id,
      order_line: a.payload.order_line,
    }]],
  }),
  journal_post: (a) => ({
    model: 'account.move',
    method: 'action_post',
    positional: [[a.payload.move_id]],
  }),
  invoice_post: (a) => ({
    model: 'account.move',
    method: 'action_post',
    positional: [[a.payload.move_id]],
  }),
  customer_credit_update: (a) => ({
    model: 'res.partner',
    method: 'write',
    positional: [[a.payload.partner_id], { credit_limit: a.payload.credit_limit }],
  }),
};

async function callOdooWithRetry(
  creds: OdooCredentials, uid: number, call: ExecuteKwCall,
): Promise<JsonRpcResponse<unknown>> {
  let lastErr: JsonRpcResponse<unknown> | null = null;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const r = await callJsonRpc(
      creds.base_url!, 'object', 'execute_kw',
      [creds.db, uid, creds.api_key, call.model, call.method, call.positional, call.kwargs || {}],
    );
    if (!r.error) return r;
    lastErr = r;
    // Retry only on transient http_error; Odoo business errors don't recover on retry.
    if (r.error.data?.name !== 'http_error') break;
  }
  return lastErr || { error: { message: 'Unknown error' } };
}

export interface OdooLiveExecuteOptions {
  tenantId: string;
  connectionId: string;
  encryptionKey?: string;
}

export async function executeOdooLive(
  action: CatalystWriteAction,
  ctx: AdapterContext,
  creds: OdooCredentials,
  opts: OdooLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `Odoo live adapter does not implement ${action.type}`,
      error: 'unsupported_action' };
  }
  if (!creds.base_url || !creds.db || !creds.username || !creds.api_key) {
    return { ok: false, status: 'failed',
      summary: 'Odoo live mode is enabled but credentials are missing — need base_url + db + username + api_key',
      error: 'no_credentials' };
  }

  const uid = await ensureUid(ctx, opts.tenantId, opts.connectionId, creds, opts.encryptionKey);
  if (!uid) {
    return { ok: false, status: 'failed',
      summary: 'Odoo authentication failed — check db / username / api_key',
      error: 'auth_failed' };
  }

  const call = callable(action);
  const result = await callOdooWithRetry(creds, uid, call);

  if (result.error) {
    const summary = result.error.data?.message || result.error.message || 'Odoo error';
    return {
      ok: false, status: 'failed', summary,
      error: result.error.data?.name || `odoo_${result.error.code || 'error'}`,
      details: { request: call, error: result.error },
    };
  }

  return {
    ok: true, status: 'completed',
    summary: `Odoo ${call.model}.${call.method} succeeded`,
    erp_reference: extractOdooId(action.type, result.result),
    details: { request: call, response: result.result },
    mode: 'live',
  };
}

function extractOdooId(type: ActionType, result: unknown): string | undefined {
  // create returns an id (number), most other methods return true/false
  if (type === 'po_create' && typeof result === 'number') return String(result);
  return undefined;
}
