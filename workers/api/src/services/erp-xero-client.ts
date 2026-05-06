/**
 * Xero REST client — Phase 10-41 real ERP write-back.
 *
 * Replaces dispatchXero() in erp-writeback.ts with real PUT /Invoices,
 * PUT /Payments, PUT /ManualJournals against the Xero API.
 *
 * Auth: OAuth2 Client Credentials grant (Xero's "machine-to-machine"
 * flow — for custom apps connected to a single Xero org). The
 * connection config holds the access token; refresh is handled on
 * 401 by hitting the Xero token endpoint with the refresh_token.
 *
 * Connection config in erp_connections.config (JSON):
 *   { "client_id":"...",
 *     "client_secret":"...",
 *     "tenant_id":"<xero org GUID>",
 *     "access_token":"...",
 *     "refresh_token":"...",
 *     "token_expires_at":"<ISO>" }
 *
 * Per Xero docs:
 *   POST https://identity.xero.com/connect/token         (refresh)
 *   PUT  https://api.xero.com/api.xro/2.0/Invoices       (create + auth)
 *   PUT  https://api.xero.com/api.xro/2.0/Payments       (apply receipt/pay vendor)
 *   PUT  https://api.xero.com/api.xro/2.0/ManualJournals (recurring JE)
 *
 * Idempotency-Key header makes retries safe.
 */

import { logInfo, logWarn } from './logger';

export interface XeroConnectionConfig {
  client_id: string;
  client_secret: string;
  /** Xero org GUID — passed in `xero-tenant-id` header on every API call. */
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  /** ISO timestamp; if past, refresh before any call. */
  token_expires_at: string;
}

class XeroError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly xeroErrorType: string | null,
    public readonly debug: string | null,
  ) {
    super(message);
    this.name = 'XeroError';
  }
}

const TOKEN_URL = 'https://identity.xero.com/connect/token';
const API_BASE = 'https://api.xero.com/api.xro/2.0';

/** Refresh the access token using refresh_token. Returns the new
 *  token bundle so the caller can persist it back to erp_connections.config. */
export async function xeroRefreshToken(cfg: XeroConnectionConfig): Promise<{
  access_token: string; refresh_token: string; expires_in: number;
}> {
  const basic = btoa(`${cfg.client_id}:${cfg.client_secret}`);
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: cfg.refresh_token,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new XeroError(
      `Xero token refresh ${res.status}: ${body.slice(0, 300)}`,
      res.status, 'token_refresh_failed', body.slice(0, 1000) || null,
    );
  }
  return res.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>;
}

interface XeroResponse {
  Id: string;
  Status: string;
  Date?: string;
  // Result envelopes vary by endpoint; we only ever need the
  // first record's identifier (number/name) for the Atheon
  // external_doc_id.
}

async function xeroCall<T>(
  cfg: XeroConnectionConfig, method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  path: string, body?: unknown, idempotencyKey?: string,
): Promise<T> {
  // Cheap pre-flight refresh check — within 60s of expiry, refresh
  // proactively so we don't spend our retry budget on 401s.
  const now = Date.now();
  const expiresAt = Date.parse(cfg.token_expires_at);
  if (Number.isFinite(expiresAt) && expiresAt - now < 60_000) {
    logInfo('xero.token_proactive_refresh', { layer: 'erp', action: 'xero.refresh' }, { tenant_id: cfg.tenant_id });
    // Caller is responsible for persisting the refreshed token back
    // to erp_connections.config; this client just uses it for the
    // current request.
    const fresh = await xeroRefreshToken(cfg);
    cfg.access_token = fresh.access_token;
    cfg.refresh_token = fresh.refresh_token;
    cfg.token_expires_at = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${cfg.access_token}`,
    Accept: 'application/json',
    'xero-tenant-id': cfg.tenant_id,
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API_BASE}${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // Reactive refresh on 401 — token may have been invalidated server-side
  if (res.status === 401) {
    logWarn('xero.token_reactive_refresh', { layer: 'erp', action: 'xero.refresh' }, { tenant_id: cfg.tenant_id });
    const fresh = await xeroRefreshToken(cfg);
    cfg.access_token = fresh.access_token;
    cfg.refresh_token = fresh.refresh_token;
    cfg.token_expires_at = new Date(Date.now() + fresh.expires_in * 1000).toISOString();
    // One retry with the new token
    const retry = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { ...headers, Authorization: `Bearer ${cfg.access_token}` },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (!retry.ok) {
      const text = await retry.text().catch(() => '');
      throw new XeroError(`Xero ${method} ${path} ${retry.status}: ${text.slice(0, 300)}`, retry.status, null, text.slice(0, 1000));
    }
    return retry.json() as Promise<T>;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    // Xero errors come back as JSON with Type + Message keys
    let parsed: { Type?: string; Message?: string; Elements?: Array<{ ValidationErrors?: Array<{ Message: string }> }> } = {};
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const validationMsg = parsed.Elements?.[0]?.ValidationErrors?.[0]?.Message;
    throw new XeroError(
      `Xero ${method} ${path} ${res.status}: ${parsed.Message ?? validationMsg ?? text.slice(0, 300)}`,
      res.status, parsed.Type ?? null, text.slice(0, 1000) || null,
    );
  }
  return res.json() as Promise<T>;
}

// ── High-level operations ────────────────────────────────────────

interface XeroInvoicePayload {
  Type: 'ACCPAY' | 'ACCREC';   // ACCPAY = AP bill, ACCREC = AR invoice
  Contact: { ContactID?: string; Name?: string };
  Date: string;                 // YYYY-MM-DD
  DueDate?: string;
  LineItems: Array<{
    Description: string;
    Quantity: number;
    UnitAmount: number;
    AccountCode: string;
  }>;
  Reference?: string;
  Status?: 'DRAFT' | 'AUTHORISED';  // AUTHORISED = posted
}

export async function xeroPostInvoice(
  cfg: XeroConnectionConfig, payload: XeroInvoicePayload, idempotencyKey: string,
): Promise<{ InvoiceID: string; InvoiceNumber: string }> {
  const res = await xeroCall<{ Invoices: Array<{ InvoiceID: string; InvoiceNumber: string }> }>(
    cfg, 'PUT', '/Invoices', { Invoices: [payload] }, idempotencyKey,
  );
  const inv = res.Invoices?.[0];
  if (!inv) throw new XeroError('Xero PUT /Invoices returned no invoices', null, null, null);
  return inv;
}

interface XeroPaymentPayload {
  Invoice: { InvoiceID: string };
  Account: { Code: string };       // Bank account code (e.g. "090")
  Amount: number;
  Date: string;
  Reference?: string;
}

export async function xeroPostPayment(
  cfg: XeroConnectionConfig, payload: XeroPaymentPayload, idempotencyKey: string,
): Promise<{ PaymentID: string; Reference: string | null }> {
  const res = await xeroCall<{ Payments: Array<{ PaymentID: string; Reference: string | null }> }>(
    cfg, 'PUT', '/Payments', { Payments: [payload] }, idempotencyKey,
  );
  const pay = res.Payments?.[0];
  if (!pay) throw new XeroError('Xero PUT /Payments returned no payments', null, null, null);
  return pay;
}

interface XeroManualJournalPayload {
  Narration: string;
  Date: string;
  Status?: 'DRAFT' | 'POSTED';
  JournalLines: Array<{
    Description?: string;
    LineAmount: number; // positive = debit, negative = credit
    AccountCode: string;
  }>;
}

export async function xeroPostManualJournal(
  cfg: XeroConnectionConfig, payload: XeroManualJournalPayload, idempotencyKey: string,
): Promise<{ ManualJournalID: string }> {
  const res = await xeroCall<{ ManualJournals: Array<{ ManualJournalID: string }> }>(
    cfg, 'PUT', '/ManualJournals', { ManualJournals: [payload] }, idempotencyKey,
  );
  const j = res.ManualJournals?.[0];
  if (!j) throw new XeroError('Xero PUT /ManualJournals returned no journals', null, null, null);
  return j;
}

export function isXeroError(err: unknown): err is XeroError {
  return err instanceof XeroError;
}

/**
 * List Xero Contacts for partner-mapping bootstrap. Filters by
 * IsSupplier=true / IsCustomer=true so we don't return generic
 * relationship rows (employees, etc.).
 *
 * Xero pages 100 per request; this helper fetches a single page
 * keyed by `page` (1-indexed). The caller orchestrates pagination
 * (the proposals route does so until fewer than 100 rows come back).
 */
export async function xeroListContacts(
  cfg: XeroConnectionConfig,
  partnerType: 'vendor' | 'customer',
  page = 1,
): Promise<Array<{ ContactID: string; Name: string; TaxNumber?: string; EmailAddress?: string }>> {
  const where = partnerType === 'vendor' ? 'IsSupplier==true' : 'IsCustomer==true';
  const path = `/Contacts?where=${encodeURIComponent(where)}&page=${page}&order=Name`;
  const res = await xeroCall<{ Contacts: Array<{ ContactID: string; Name: string; TaxNumber?: string; EmailAddress?: string }> }>(
    cfg, 'GET', path,
  );
  return res.Contacts ?? [];
}

export { XeroError };
export type { XeroResponse };
