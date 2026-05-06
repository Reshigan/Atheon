/**
 * Odoo JSON-RPC client — Phase 10-39 real ERP write-back.
 *
 * Replaces the dispatchOdoo() stub in erp-writeback.ts with a real
 * client that posts via Odoo's `/jsonrpc` endpoint. Used by the
 * action layer to actually execute AP invoices, AR receipts,
 * journal entries, bank reconciliations against a customer's Odoo
 * instance.
 *
 * Odoo JSON-RPC protocol (since v8 / supported on all hosted
 * Odoo SaaS + on-prem):
 *
 *   POST /jsonrpc
 *   { "jsonrpc":"2.0", "method":"call", "params": {
 *       "service":"common"|"object",
 *       "method":"authenticate"|"execute_kw",
 *       "args":[<positional args...>]
 *     }
 *   }
 *
 * Auth:
 *   common.authenticate(db, login, password, {}) → uid (int) | false
 *
 * Operations:
 *   object.execute_kw(db, uid, password, model, method, args, kwargs)
 *
 * Connection config (lives in erp_connections.config JSON):
 *   { "url": "https://acme.odoo.com",
 *     "db": "acme",
 *     "login": "atheon-bot@acme.com",
 *     "password": "<API key or password>" }
 *
 * In production the password should be encrypted with
 * ENCRYPTION_KEY (AES-GCM) at rest — same scheme as
 * webhook_signing_secrets in PR #370. v1 of this client accepts
 * plaintext config; the encrypt-on-write pass is a follow-up.
 */

import { logInfo, logWarn } from './logger';

export interface OdooConnectionConfig {
  url: string;
  db: string;
  login: string;
  password: string;
}

export type OdooArg =
  | string | number | boolean | null
  | OdooArg[] | { [k: string]: OdooArg };

interface JsonRpcResponse<T> {
  jsonrpc: '2.0';
  id?: number | string | null;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { name?: string; message?: string; debug?: string };
  };
}

class OdooError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly odooErrorCode: number | null,
    public readonly odooErrorName: string | null,
    public readonly debug: string | null,
  ) {
    super(message);
    this.name = 'OdooError';
  }
}

async function jsonrpcCall<T>(
  url: string, body: object, timeoutMs = 30_000,
): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);

  try {
    const res = await fetch(`${url.replace(/\/+$/, '')}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new OdooError(
        `Odoo HTTP ${res.status}: ${text.slice(0, 300)}`,
        res.status, null, null, text.slice(0, 1000) || null,
      );
    }

    const data = await res.json() as JsonRpcResponse<T>;
    if (data.error) {
      const e = data.error;
      throw new OdooError(
        `Odoo ${e.data?.name ?? 'error'}: ${e.message}`,
        res.status, e.code, e.data?.name ?? null, e.data?.debug ?? null,
      );
    }
    if (data.result === undefined) {
      throw new OdooError('Odoo response missing result', res.status, null, null, null);
    }
    return data.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Authenticate against Odoo's common service. Returns the user's
 *  numeric uid on success. Throws OdooError on failure. */
export async function odooAuthenticate(cfg: OdooConnectionConfig): Promise<number> {
  const result = await jsonrpcCall<number | false>(cfg.url, {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'common',
      method: 'authenticate',
      args: [cfg.db, cfg.login, cfg.password, {}],
    },
  });
  if (result === false || typeof result !== 'number') {
    throw new OdooError(
      `Odoo authenticate failed for db=${cfg.db} login=${cfg.login} (returned: ${JSON.stringify(result)})`,
      null, null, 'authentication_failed', null,
    );
  }
  return result;
}

/** Generic execute_kw — runs a method on a model. The full Odoo
 *  ORM is reachable through this single primitive. */
export async function odooExecuteKw<T>(
  cfg: OdooConnectionConfig,
  uid: number,
  model: string,
  method: string,
  args: OdooArg[],
  kwargs: Record<string, OdooArg> = {},
): Promise<T> {
  return jsonrpcCall<T>(cfg.url, {
    jsonrpc: '2.0',
    method: 'call',
    params: {
      service: 'object',
      method: 'execute_kw',
      args: [cfg.db, uid, cfg.password, model, method, args, kwargs],
    },
  });
}

// ── High-level operations ────────────────────────────────────────
//
// One function per action_type from the transactional layer. Each
// returns the Odoo external doc ID (e.g. "INV/2026/00042") so we
// can flip transactional_actions.external_doc_id on success.

interface OdooMoveCreatePayload {
  move_type: 'in_invoice' | 'out_invoice' | 'entry' | 'in_receipt' | 'out_receipt';
  partner_id: number;
  invoice_date?: string;
  invoice_date_due?: string;
  ref?: string;
  invoice_line_ids: Array<[0, 0, {
    product_id?: number;
    name?: string;
    quantity: number;
    price_unit: number;
    account_id?: number;
  }]>;
}

/** Create + post an AP vendor bill (in_invoice). Returns Odoo move ID. */
export async function odooPostApInvoice(
  cfg: OdooConnectionConfig, uid: number, payload: OdooMoveCreatePayload,
): Promise<{ id: number; name: string }> {
  // Step 1: create the draft move
  const moveId = await odooExecuteKw<number>(
    cfg, uid, 'account.move', 'create', [payload as unknown as OdooArg],
  );
  // Step 2: post (validates + locks the move)
  await odooExecuteKw<boolean>(
    cfg, uid, 'account.move', 'action_post', [[moveId]],
  );
  // Step 3: read back name (the "INV/2026/00042" identifier)
  const rows = await odooExecuteKw<Array<{ id: number; name: string }>>(
    cfg, uid, 'account.move', 'read', [[moveId], ['id', 'name']],
  );
  const row = rows[0];
  if (!row) throw new OdooError(`account.move ${moveId} not readable after post`, null, null, null, null);
  return row;
}

interface OdooPaymentCreatePayload {
  payment_type: 'inbound' | 'outbound';
  partner_type: 'customer' | 'supplier';
  partner_id: number;
  amount: number;
  date: string;
  ref?: string;
  journal_id: number;
}

/** Create + post a payment (used for AP payment runs and AR cash receipts). */
export async function odooPostPayment(
  cfg: OdooConnectionConfig, uid: number, payload: OdooPaymentCreatePayload,
): Promise<{ id: number; name: string }> {
  const paymentId = await odooExecuteKw<number>(
    cfg, uid, 'account.payment', 'create', [payload as unknown as OdooArg],
  );
  await odooExecuteKw<boolean>(
    cfg, uid, 'account.payment', 'action_post', [[paymentId]],
  );
  const rows = await odooExecuteKw<Array<{ id: number; name: string }>>(
    cfg, uid, 'account.payment', 'read', [[paymentId], ['id', 'name']],
  );
  const row = rows[0];
  if (!row) throw new OdooError(`account.payment ${paymentId} not readable after post`, null, null, null, null);
  return row;
}

interface OdooJournalEntryPayload {
  ref: string;
  date: string;
  journal_id: number;
  line_ids: Array<[0, 0, { name: string; account_id: number; debit?: number; credit?: number; partner_id?: number }]>;
}

/** Create + post a manual journal entry. */
export async function odooPostJournalEntry(
  cfg: OdooConnectionConfig, uid: number, payload: OdooJournalEntryPayload,
): Promise<{ id: number; name: string }> {
  const moveId = await odooExecuteKw<number>(
    cfg, uid, 'account.move', 'create', [{ move_type: 'entry', ...payload } as unknown as OdooArg],
  );
  await odooExecuteKw<boolean>(
    cfg, uid, 'account.move', 'action_post', [[moveId]],
  );
  const rows = await odooExecuteKw<Array<{ id: number; name: string }>>(
    cfg, uid, 'account.move', 'read', [[moveId], ['id', 'name']],
  );
  const row = rows[0];
  if (!row) throw new OdooError(`account.move ${moveId} (JE) not readable after post`, null, null, null, null);
  return row;
}

/** Set a customer on credit hold by writing to res.partner. */
export async function odooSetCreditHold(
  cfg: OdooConnectionConfig, uid: number, partnerId: number, holdMessage: string,
): Promise<{ id: number; name: string }> {
  await odooExecuteKw<boolean>(
    cfg, uid, 'res.partner', 'write',
    [[partnerId], { sale_warn: 'block', sale_warn_msg: holdMessage }],
  );
  const rows = await odooExecuteKw<Array<{ id: number; name: string }>>(
    cfg, uid, 'res.partner', 'read', [[partnerId], ['id', 'name']],
  );
  const row = rows[0];
  if (!row) throw new OdooError(`res.partner ${partnerId} not readable after write`, null, null, null, null);
  return row;
}

// ── Test helper: lightweight surface for assertions ──────────────

export function isOdooError(err: unknown): err is OdooError {
  return err instanceof OdooError;
}

export { OdooError };
