/**
 * NetSuite REST client — Phase 10-42 real ERP write-back.
 *
 * Replaces dispatchNetsuite() in erp-writeback.ts with real POSTs
 * against NetSuite's SuiteTalk REST Web Services using Token-Based
 * Authentication (TBA / OAuth 1.0a HMAC-SHA256).
 *
 * Auth: OAuth 1.0a with HMAC-SHA256 signature. Each request signs:
 *   <method>&<percentEncodedURL>&<percentEncodedSortedParams>
 * with the key `<consumer_secret>&<token_secret>` (both percent-encoded).
 * The Authorization header carries:
 *   OAuth realm="<account_id>", oauth_consumer_key=..., oauth_token=...,
 *         oauth_signature_method="HMAC-SHA256", oauth_timestamp=...,
 *         oauth_nonce=..., oauth_version="1.0", oauth_signature="..."
 *
 * Connection config in erp_connections.config (JSON):
 *   { "account_id":"1234567",
 *     "consumer_key":"...",
 *     "consumer_secret":"...",
 *     "token_id":"...",
 *     "token_secret":"..." }
 *
 * Per NetSuite docs, the REST services base URL is account-scoped:
 *   https://<accountId>.suitetalk.api.netsuite.com/services/rest/record/v1
 *
 * For account IDs with underscores (sandboxes, e.g. "1234567_SB1"),
 * the host normalises underscores to hyphens.
 *
 * Endpoints used:
 *   POST /vendorBill         → AP invoice / vendor bill
 *   POST /customerPayment    → AR cash application
 *   POST /journalEntry       → manual GL journal
 *
 * NetSuite returns 204 No Content with a Location header pointing at
 * the new record (e.g. /services/rest/record/v1/vendorBill/9981).
 * We extract the trailing numeric ID from Location and return it as
 * the external_doc_id. There's no rich body; one extra GET would
 * fetch tranid/document number, but for write-back attribution the
 * internal ID is sufficient.
 */

import { logInfo } from './logger';

export interface NetSuiteConnectionConfig {
  account_id: string;
  consumer_key: string;
  consumer_secret: string;
  token_id: string;
  token_secret: string;
}

class NetSuiteError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly netsuiteErrorType: string | null,
    public readonly debug: string | null,
  ) {
    super(message);
    this.name = 'NetSuiteError';
  }
}

/** RFC 3986 percent-encoding — stricter than encodeURIComponent.
 *  NetSuite (and all OAuth 1.0a impls) require !*'() to be encoded. */
function pctEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function genNonce(): string {
  // 32 hex chars, well above OAuth's recommended length
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Base64(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(message));
  // base64
  let bin = '';
  const bytes = new Uint8Array(sig);
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Build the OAuth 1.0a Authorization header for a NetSuite REST call.
 *  Body is NOT included in the signature for application/json POSTs
 *  (NetSuite's REST contract); only URL + query params + OAuth params. */
async function buildAuthHeader(
  cfg: NetSuiteConnectionConfig, method: string, url: string,
): Promise<string> {
  const u = new URL(url);
  const queryParams: Array<[string, string]> = [];
  u.searchParams.forEach((v, k) => queryParams.push([k, v]));

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: cfg.consumer_key,
    oauth_nonce: genNonce(),
    oauth_signature_method: 'HMAC-SHA256',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: cfg.token_id,
    oauth_version: '1.0',
  };

  // Build the parameter string: combine query + oauth params, sort by key (then value), encode each
  const allParams: Array<[string, string]> = [
    ...queryParams,
    ...Object.entries(oauthParams),
  ];
  const encoded = allParams.map(([k, v]) => [pctEncode(k), pctEncode(v)] as [string, string]);
  encoded.sort((a, b) => (a[0] === b[0] ? a[1].localeCompare(b[1]) : a[0].localeCompare(b[0])));
  const paramString = encoded.map(([k, v]) => `${k}=${v}`).join('&');

  // Base string: <METHOD>&<encoded-base-url>&<encoded-param-string>
  const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
  const baseString = `${method.toUpperCase()}&${pctEncode(baseUrl)}&${pctEncode(paramString)}`;

  const signingKey = `${pctEncode(cfg.consumer_secret)}&${pctEncode(cfg.token_secret)}`;
  const signature = await hmacSha256Base64(signingKey, baseString);

  // Header: realm + all oauth_* + oauth_signature, each value double-quoted + percent-encoded
  const headerParts: Array<[string, string]> = [
    ['realm', cfg.account_id.toUpperCase()],
    ['oauth_consumer_key', oauthParams.oauth_consumer_key],
    ['oauth_token', oauthParams.oauth_token],
    ['oauth_signature_method', oauthParams.oauth_signature_method],
    ['oauth_timestamp', oauthParams.oauth_timestamp],
    ['oauth_nonce', oauthParams.oauth_nonce],
    ['oauth_version', oauthParams.oauth_version],
    ['oauth_signature', signature],
  ];
  return 'OAuth ' + headerParts.map(([k, v]) => `${k}="${pctEncode(v)}"`).join(', ');
}

/** Account ID → REST host. Underscores in sandboxes ("1234567_SB1")
 *  become hyphens in the hostname. Production accounts use the ID
 *  directly. Lowercase always. */
export function netsuiteRestHost(accountId: string): string {
  return `${accountId.toLowerCase().replace(/_/g, '-')}.suitetalk.api.netsuite.com`;
}

interface NetSuiteCallResult {
  /** Internal numeric ID of the created record, parsed from Location header. */
  internalId: string;
  /** Full Location URL — kept for debugging / linking back into NetSuite. */
  location: string | null;
}

async function netsuiteCall(
  cfg: NetSuiteConnectionConfig, method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
  path: string, body?: unknown,
): Promise<NetSuiteCallResult> {
  const url = `https://${netsuiteRestHost(cfg.account_id)}/services/rest/record/v1${path}`;
  const auth = await buildAuthHeader(cfg, method, url);
  const headers: Record<string, string> = {
    Authorization: auth,
    Accept: 'application/json',
    Prefer: 'transient',  // NetSuite-specific: don't persist response sublist refs
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(url, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: { 'o:errorDetails'?: Array<{ detail: string; 'o:errorCode'?: string }>; title?: string } = {};
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const detail = parsed['o:errorDetails']?.[0];
    throw new NetSuiteError(
      `NetSuite ${method} ${path} ${res.status}: ${detail?.detail ?? parsed.title ?? text.slice(0, 300)}`,
      res.status,
      detail?.['o:errorCode'] ?? null,
      text.slice(0, 1000) || null,
    );
  }

  // 204 No Content + Location: <full URL ending in /<id>>
  const location = res.headers.get('Location');
  const internalId = location ? location.split('/').pop() ?? '' : '';
  if (!internalId) {
    throw new NetSuiteError(
      `NetSuite ${method} ${path} returned no internal ID (no Location header)`,
      res.status, null, location,
    );
  }
  return { internalId, location };
}

// ── High-level operations ────────────────────────────────────────

export interface NetSuiteVendorBillPayload {
  entity: { id: string };          // vendor internal ID
  tranDate?: string;                // YYYY-MM-DD
  dueDate?: string;
  tranId?: string;                  // document number / external invoice ref
  memo?: string;
  item?: {
    items: Array<{
      item?: { id: string };
      account?: { id: string };
      amount?: number;
      quantity?: number;
      description?: string;
    }>;
  };
  expense?: {
    items: Array<{
      account: { id: string };
      amount: number;
      memo?: string;
    }>;
  };
}

export async function netsuitePostVendorBill(
  cfg: NetSuiteConnectionConfig, payload: NetSuiteVendorBillPayload,
): Promise<NetSuiteCallResult> {
  logInfo('netsuite.vendor_bill_post',
    { layer: 'erp', action: 'netsuite.vendorBill' },
    { entity_id: payload.entity.id, tran_id: payload.tranId });
  return netsuiteCall(cfg, 'POST', '/vendorBill', payload);
}

export interface NetSuiteCustomerPaymentPayload {
  customer: { id: string };
  payment: number;
  tranDate?: string;
  account?: { id: string };       // bank account internal ID
  memo?: string;
  apply?: {
    items: Array<{
      apply: boolean;
      doc: string;                 // invoice internal ID
      amount: number;
    }>;
  };
}

export async function netsuitePostCustomerPayment(
  cfg: NetSuiteConnectionConfig, payload: NetSuiteCustomerPaymentPayload,
): Promise<NetSuiteCallResult> {
  logInfo('netsuite.customer_payment_post',
    { layer: 'erp', action: 'netsuite.customerPayment' },
    { customer_id: payload.customer.id, amount: payload.payment });
  return netsuiteCall(cfg, 'POST', '/customerPayment', payload);
}

export interface NetSuiteJournalEntryPayload {
  tranDate?: string;
  memo?: string;
  line: {
    items: Array<{
      account: { id: string };
      debit?: number;
      credit?: number;
      memo?: string;
    }>;
  };
}

export async function netsuitePostJournalEntry(
  cfg: NetSuiteConnectionConfig, payload: NetSuiteJournalEntryPayload,
): Promise<NetSuiteCallResult> {
  logInfo('netsuite.journal_entry_post',
    { layer: 'erp', action: 'netsuite.journalEntry' },
    { line_count: payload.line.items.length });
  return netsuiteCall(cfg, 'POST', '/journalEntry', payload);
}

export function isNetSuiteError(err: unknown): err is NetSuiteError {
  return err instanceof NetSuiteError;
}

export { NetSuiteError };
