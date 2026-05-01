/**
 * SAP S/4HANA Live Write Adapter — Phase 9-1.
 *
 * Real OData write-back for connections opted into `live_mode`. Same
 * pattern as the Xero live adapter (Phase 8-1) — different auth and
 * error mapping appropriate to SAP.
 *
 * Auth: OAuth2 client_credentials. SAP S/4HANA Cloud's auth endpoint
 * varies per tenant; the adapter calls `${base_url}/oauth2/api/v1/token`
 * by default, overridable via `auth_url` in credentials.
 *
 * CSRF: SAP OData services require a `x-csrf-token: fetch` GET to
 * obtain a token, then echo it back on the write call. Tokens + cookies
 * are kept in-memory per call (we don't cache them on the connection
 * because they expire fast — cheap to re-fetch).
 *
 * Retries: 401 triggers token refresh. 429 (or SAP's 503 with throttle)
 * respects Retry-After (capped at 30s), retries up to 3×. 4xx errors
 * are surfaced with SAP's `error.message.value` in the summary.
 */

import type {
  CatalystWriteAction,
  ActionExecutionResult,
  ActionType,
  AdapterContext,
} from './erp-write-actions';
import { encrypt, decrypt, isEncrypted } from './encryption';
import { logError, logInfo } from './logger';

const MAX_RETRIES = 3;
const MAX_RETRY_AFTER_SECONDS = 30;

export interface SapCredentials {
  base_url?: string;
  auth_url?: string;
  client_id?: string;
  client_secret?: string;
  access_token?: string;
  expires_at?: number;
  live_mode?: boolean;
}

interface ClientCredentialsResponse {
  access_token: string;
  expires_in?: number;
  token_type?: string;
}

async function refreshAccessToken(creds: SapCredentials): Promise<ClientCredentialsResponse | null> {
  if (!creds.client_id || !creds.client_secret || !creds.base_url) return null;
  const tokenUrl = creds.auth_url || `${creds.base_url}/oauth2/api/v1/token`;
  try {
    const basic = btoa(`${creds.client_id}:${creds.client_secret}`);
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'grant_type=client_credentials',
    });
    if (!res.ok) {
      logError('sap.live.refresh_failed', new Error(`Token call returned ${res.status}`),
        { tenantId: 'unknown' }, { status: res.status });
      return null;
    }
    return (await res.json()) as ClientCredentialsResponse;
  } catch (err) {
    logError('sap.live.refresh_exception', err, { tenantId: 'unknown' }, {});
    return null;
  }
}

async function persistRefreshedTokens(
  db: D1Database, tenantId: string, connectionId: string,
  newToken: ClientCredentialsResponse, encryptionKey: string | undefined,
): Promise<void> {
  try {
    const row = await db.prepare(
      'SELECT encrypted_config, config FROM erp_connections WHERE id = ? AND tenant_id = ?'
    ).bind(connectionId, tenantId).first<{ encrypted_config: string | null; config: string }>();
    if (!row) return;

    let parsed: SapCredentials = {};
    if (row.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      if (dec) parsed = JSON.parse(dec);
    } else if (row.config && row.config !== '{}') {
      parsed = JSON.parse(row.config);
    }
    parsed.access_token = newToken.access_token;
    parsed.expires_at = Date.now() + ((newToken.expires_in || 3600) * 1000);

    const json = JSON.stringify(parsed);
    if (encryptionKey && encryptionKey.length >= 16) {
      const enc = await encrypt(json, encryptionKey);
      await db.prepare(
        `UPDATE erp_connections SET encrypted_config = ?, config = '{}' WHERE id = ? AND tenant_id = ?`
      ).bind(enc, connectionId, tenantId).run();
    } else {
      await db.prepare(`UPDATE erp_connections SET config = ? WHERE id = ? AND tenant_id = ?`)
        .bind(json, connectionId, tenantId).run();
    }
  } catch (err) {
    logError('sap.live.token_persist_failed', err, { tenantId }, { connectionId });
  }
}

interface CallOptions {
  method: 'GET' | 'POST' | 'PATCH';
  path: string;
  body?: unknown;
  /** Some SAP endpoints are query operations rather than entity sets. */
  query?: Record<string, string>;
}

interface CallResult { ok: boolean; status: number; body: unknown; refreshAttempted?: boolean }

async function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }

/** Fetch the CSRF token + cookies. SAP requires this for any non-GET. */
async function fetchCsrf(creds: SapCredentials): Promise<{ token: string; cookie: string } | null> {
  if (!creds.base_url || !creds.access_token) return null;
  try {
    const res = await fetch(`${creds.base_url}/sap/opu/odata/sap/API_BUSINESS_PARTNER/$metadata`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${creds.access_token}`,
        'x-csrf-token': 'fetch',
        Accept: 'application/json',
      },
    });
    const token = res.headers.get('x-csrf-token');
    const cookie = res.headers.get('set-cookie') || '';
    if (!token) return null;
    return { token, cookie };
  } catch (err) {
    logError('sap.live.csrf_fetch_failed', err, { tenantId: 'unknown' }, {});
    return null;
  }
}

async function callSapOnce(
  creds: SapCredentials, opts: CallOptions, csrf: { token: string; cookie: string } | null,
): Promise<CallResult> {
  const qs = opts.query ? '?' + new URLSearchParams(opts.query).toString() : '';
  const url = `${creds.base_url}${opts.path}${qs}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.access_token || ''}`,
    Accept: 'application/json',
    'Content-Type': 'application/json',
  };
  if (csrf && opts.method !== 'GET') {
    headers['x-csrf-token'] = csrf.token;
    if (csrf.cookie) headers['Cookie'] = csrf.cookie;
  }

  const init: RequestInit = { method: opts.method, headers };
  if (opts.body !== undefined) init.body = JSON.stringify(opts.body);

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const res = await fetch(url, init);
    const text = await res.text();
    let parsed: unknown;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = text; }

    if (res.status === 429 || (res.status === 503 && res.headers.get('Retry-After'))) {
      const ra = parseInt(res.headers.get('Retry-After') || '5', 10);
      const wait = Math.min(Math.max(ra, 1), MAX_RETRY_AFTER_SECONDS) * 1000;
      logInfo('sap.live.rate_limited', { tenantId: 'unknown', layer: 'erp', action: 'sap.rate_limit' },
        { attempt: attempt + 1, retry_after_seconds: ra });
      await sleep(wait);
      continue;
    }
    return { ok: res.ok, status: res.status, body: parsed };
  }
  return { ok: false, status: 429, body: { error: 'Exceeded retry budget on rate-limit' } };
}

async function callSap(
  ctx: AdapterContext, tenantId: string, connectionId: string,
  creds: SapCredentials, opts: CallOptions, encryptionKey: string | undefined,
): Promise<CallResult> {
  // Pre-refresh if expired or about to expire (within 60s)
  if (creds.expires_at && Date.now() > creds.expires_at - 60_000) {
    const refreshed = await refreshAccessToken(creds);
    if (refreshed) {
      creds.access_token = refreshed.access_token;
      creds.expires_at = Date.now() + ((refreshed.expires_in || 3600) * 1000);
      await persistRefreshedTokens(ctx.db, tenantId, connectionId, refreshed, encryptionKey);
    }
  }

  let csrf: { token: string; cookie: string } | null = null;
  if (opts.method !== 'GET') {
    csrf = await fetchCsrf(creds);
    if (!csrf) {
      // CSRF call may have failed because token expired; refresh + retry
      const refreshed = await refreshAccessToken(creds);
      if (refreshed) {
        creds.access_token = refreshed.access_token;
        creds.expires_at = Date.now() + ((refreshed.expires_in || 3600) * 1000);
        await persistRefreshedTokens(ctx.db, tenantId, connectionId, refreshed, encryptionKey);
        csrf = await fetchCsrf(creds);
      }
    }
  }

  let result = await callSapOnce(creds, opts, csrf);
  if (result.status === 401 && creds.client_id && creds.client_secret) {
    const refreshed = await refreshAccessToken(creds);
    if (refreshed) {
      creds.access_token = refreshed.access_token;
      creds.expires_at = Date.now() + ((refreshed.expires_in || 3600) * 1000);
      await persistRefreshedTokens(ctx.db, tenantId, connectionId, refreshed, encryptionKey);
      if (opts.method !== 'GET') csrf = await fetchCsrf(creds);
      result = await callSapOnce(creds, opts, csrf);
      result.refreshAttempted = true;
    }
  }
  return result;
}

// ── Per-action call mapping ────────────────────────────────────────────

type LiveCallable = (action: CatalystWriteAction) => CallOptions;

const LIVE_CALLS: Partial<Record<ActionType, LiveCallable>> = {
  ar_dunning_send: (a) => ({
    method: 'POST',
    path: `/sap/opu/odata/sap/API_DUNNING_SRV/CreateDunningRun`,
    body: {
      CustomerCode: a.payload.customer_code,
      CompanyCode: a.payload.company_code,
      DunningLevel: a.payload.dunning_level,
      DunningKey: a.payload.dunning_key || '',
    },
  }),
  ap_payment_release: (a) => ({
    method: 'POST',
    path: `/sap/opu/odata/sap/API_PAYMENT_PROPOSAL_SRV/ReleaseProposal`,
    body: {
      PaymentProposalID: a.payload.payment_proposal_id,
      CompanyCode: a.payload.company_code,
    },
  }),
  po_create: (a) => ({
    method: 'POST',
    path: `/sap/opu/odata/sap/API_PURCHASEORDER_PROCESS_SRV/A_PurchaseOrder`,
    body: {
      Supplier: a.payload.vendor_code,
      CompanyCode: a.payload.company_code,
      PurchaseOrderType: a.payload.po_type || 'NB',
      to_PurchaseOrderItem: { results: a.payload.items },
    },
  }),
  journal_post: (a) => ({
    method: 'POST',
    path: `/sap/opu/odata/sap/API_JOURNALENTRYITEMBASIC_SRV/A_JournalEntryItemBasic`,
    body: {
      CompanyCode: a.payload.company_code,
      AccountingDocumentType: a.payload.document_type,
      to_JournalEntryItem: { results: a.payload.lines },
    },
  }),
  invoice_post: (a) => ({
    method: 'POST',
    path: `/sap/opu/odata/sap/API_BILLINGDOCUMENT_SRV/A_BillingDocument`,
    body: {
      BillingDocument: a.payload.billing_doc_id,
    },
  }),
  customer_credit_update: (a) => ({
    method: 'PATCH',
    path: `/sap/opu/odata/sap/API_BUSINESS_PARTNER/A_CustomerCreditAccount(BusinessPartner='${a.payload.customer_code}',CreditSegment='${a.payload.company_code}')`,
    body: {
      CreditLimitAmount: a.payload.credit_limit,
    },
  }),
};

// ── Public entry point ─────────────────────────────────────────────────

export interface SapLiveExecuteOptions {
  tenantId: string;
  connectionId: string;
  encryptionKey?: string;
}

export async function executeSapLive(
  action: CatalystWriteAction,
  ctx: AdapterContext,
  creds: SapCredentials,
  opts: SapLiveExecuteOptions,
): Promise<ActionExecutionResult> {
  const callable = LIVE_CALLS[action.type];
  if (!callable) {
    return { ok: false, status: 'failed',
      summary: `SAP live adapter does not implement ${action.type}`,
      error: 'unsupported_action' };
  }
  if (!creds.access_token || !creds.base_url) {
    return { ok: false, status: 'failed',
      summary: 'SAP live mode is enabled but base_url / access_token are missing — re-authenticate the SAP connection',
      error: 'no_credentials' };
  }

  const callOpts = callable(action);
  const result = await callSap(ctx, opts.tenantId, opts.connectionId, creds, callOpts, opts.encryptionKey);

  if (!result.ok) {
    let summary = `SAP ${callOpts.method} ${callOpts.path} returned HTTP ${result.status}`;
    const body = result.body as { error?: { message?: { value?: string }; code?: string } } | string | null;
    if (body && typeof body === 'object' && body.error?.message?.value) {
      summary = body.error.message.value;
    }
    return {
      ok: false, status: 'failed', summary,
      error: `sap_${result.status}`,
      details: { request: callOpts, response: result.body, refreshed: result.refreshAttempted },
    };
  }

  return {
    ok: true, status: 'completed',
    summary: `SAP ${callOpts.method} ${callOpts.path} succeeded`,
    erp_reference: extractSapId(action.type, result.body),
    details: { request: callOpts, response: result.body, refreshed: result.refreshAttempted },
    mode: 'live',
  };
}

function extractSapId(type: ActionType, body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const b = body as Record<string, unknown>;
  // SAP responses commonly have a `d` envelope with the entity payload
  const d = (b.d as Record<string, unknown> | undefined) || b;
  if (type === 'po_create' && d.PurchaseOrder) return String(d.PurchaseOrder);
  if (type === 'invoice_post' && d.BillingDocument) return String(d.BillingDocument);
  if (type === 'journal_post' && d.AccountingDocument) return String(d.AccountingDocument);
  if (type === 'ap_payment_release' && d.PaymentDocument) return String(d.PaymentDocument);
  return undefined;
}
