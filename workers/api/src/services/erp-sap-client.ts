/**
 * SAP S/4HANA OData client — Phase 10-43 real ERP write-back.
 *
 * Replaces dispatchSap() in erp-writeback.ts with real POSTs against
 * SAP S/4HANA's OData v2 APIs (the modern HTTP-based alternative to
 * legacy RFC, which can't be invoked from a Cloudflare Worker).
 *
 * Auth: HTTP Basic with a technical/communication user provisioned in
 * the customer's SAP tenant. Optional `client` (mandant) is sent in the
 * `sap-client` query parameter.
 *
 * CSRF handshake (required for POST/PUT/PATCH/DELETE):
 *   1. GET <service-root>/  with header `x-csrf-token: fetch`
 *      → SAP returns `x-csrf-token: <token>` header + Set-Cookie
 *   2. POST the actual write with `x-csrf-token: <token>` + the
 *      cookies returned by step 1.
 *
 * Connection config in erp_connections.config (JSON):
 *   { "base_url":"https://my-sap.example.com",
 *     "user":"ATHEON_BOT",
 *     "password":"...",
 *     "client":"100" }
 *
 * Action-type → SAP service mapping:
 *   ap_invoice_post  → /sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice
 *   ar_cash_apply    → /sap/opu/odata/sap/API_INCOMINGPAYMENT_SRV/IncomingPayment
 *   gl_journal_entry → /sap/opu/odata/sap/API_JOURNALENTRY_SRV/A_JournalEntry
 *
 * SAP returns 201 with the created entity body; we parse the
 * document-key field (SupplierInvoice / PaymentDocument /
 * AccountingDocument) and surface it as external_doc_id.
 */

import { logInfo } from './logger';

export interface SapConnectionConfig {
  /** Base URL of the SAP system, no trailing slash. */
  base_url: string;
  user: string;
  password: string;
  /** Optional SAP client / mandant — sent in `sap-client` query param. */
  client?: string;
}

class SapError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number | null,
    public readonly sapErrorCode: string | null,
    public readonly debug: string | null,
  ) {
    super(message);
    this.name = 'SapError';
  }
}

function basicAuth(cfg: SapConnectionConfig): string {
  return `Basic ${btoa(`${cfg.user}:${cfg.password}`)}`;
}

function withClient(cfg: SapConnectionConfig, url: string): string {
  if (!cfg.client) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}sap-client=${encodeURIComponent(cfg.client)}`;
}

interface CsrfHandshake {
  token: string;
  cookies: string;
}

/** Fetch a CSRF token + cookies from the given OData service root.
 *  SAP requires a fresh handshake per service for write operations. */
export async function sapFetchCsrf(
  cfg: SapConnectionConfig, serviceRoot: string,
): Promise<CsrfHandshake> {
  const url = withClient(cfg, `${cfg.base_url}${serviceRoot}/`);
  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: basicAuth(cfg),
      Accept: 'application/json',
      'x-csrf-token': 'fetch',
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new SapError(
      `SAP CSRF fetch ${res.status}: ${text.slice(0, 300)}`,
      res.status, 'csrf_fetch_failed', text.slice(0, 1000) || null,
    );
  }
  const token = res.headers.get('x-csrf-token') ?? '';
  if (!token || token === 'required') {
    throw new SapError(
      'SAP CSRF fetch returned no x-csrf-token header',
      res.status, 'csrf_missing', null,
    );
  }
  // SAP returns Set-Cookie with session + CSRF cookies; we re-emit
  // them on the POST. getSetCookie() (Workers + recent Node) returns
  // each cookie as a separate string; otherwise we split the joined
  // header on comma-before-name=. Strip attributes, join name=value pairs.
  const headersWithGetSetCookie = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies: string[] = typeof headersWithGetSetCookie.getSetCookie === 'function'
    ? headersWithGetSetCookie.getSetCookie()
    : (res.headers.get('set-cookie')?.split(/,(?=\s*\w+=)/) ?? []);
  const cookies = setCookies
    .map((c: string) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');
  return { token, cookies };
}

async function sapWrite<T>(
  cfg: SapConnectionConfig, serviceRoot: string, entitySet: string,
  body: unknown,
): Promise<T> {
  const csrf = await sapFetchCsrf(cfg, serviceRoot);
  const url = withClient(cfg, `${cfg.base_url}${serviceRoot}/${entitySet}`);
  const headers: Record<string, string> = {
    Authorization: basicAuth(cfg),
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-csrf-token': csrf.token,
  };
  if (csrf.cookies) headers.Cookie = csrf.cookies;
  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let parsed: { error?: { code?: string; message?: { value?: string } | string } } = {};
    try { parsed = JSON.parse(text); } catch { /* keep text */ }
    const sapMsg = typeof parsed.error?.message === 'object' ? parsed.error.message?.value : parsed.error?.message;
    throw new SapError(
      `SAP POST ${entitySet} ${res.status}: ${sapMsg ?? text.slice(0, 300)}`,
      res.status, parsed.error?.code ?? null, text.slice(0, 1000) || null,
    );
  }
  // OData v2 wraps results in { d: { ... } }; v4 returns the entity directly.
  const json = await res.json() as { d?: T } & Record<string, unknown>;
  return (json.d ?? json) as T;
}

// ── High-level operations ────────────────────────────────────────

const SVC_SUPPLIER_INVOICE = '/sap/opu/odata/sap/API_SUPPLIERINVOICE_PROCESS_SRV';
const SVC_INCOMING_PAYMENT = '/sap/opu/odata/sap/API_INCOMINGPAYMENT_SRV';
const SVC_JOURNAL_ENTRY    = '/sap/opu/odata/sap/API_JOURNALENTRY_SRV';

export interface SapSupplierInvoicePayload {
  CompanyCode: string;
  DocumentDate: string;       // YYYY-MM-DD
  PostingDate: string;
  InvoicingParty: string;     // vendor (BUKRS partner) ID
  SupplierInvoiceIDByInvcgParty?: string;
  DocumentCurrency: string;
  InvoiceGrossAmount: string;
  to_SupplierInvoiceItemGLAcct?: {
    results: Array<{
      CompanyCode: string;
      GLAccount: string;
      DebitCreditCode: 'S' | 'H';
      DocumentCurrency: string;
      SupplierInvoiceItemAmount: string;
    }>;
  };
}

export async function sapPostSupplierInvoice(
  cfg: SapConnectionConfig, payload: SapSupplierInvoicePayload,
): Promise<{ SupplierInvoice: string; FiscalYear: string }> {
  logInfo('sap.supplier_invoice_post',
    { layer: 'erp', action: 'sap.supplierInvoice' },
    { invoicing_party: payload.InvoicingParty, gross: payload.InvoiceGrossAmount });
  return sapWrite(cfg, SVC_SUPPLIER_INVOICE, 'A_SupplierInvoice', payload);
}

export interface SapIncomingPaymentPayload {
  CompanyCode: string;
  PostingDate: string;
  Customer: string;
  PaymentAmount: string;
  PaymentCurrency: string;
  HouseBank?: string;
  HouseBankAccount?: string;
  /** Reference to the AR document being cleared */
  AssignmentReference?: string;
}

export async function sapPostIncomingPayment(
  cfg: SapConnectionConfig, payload: SapIncomingPaymentPayload,
): Promise<{ PaymentDocument: string; FiscalYear: string }> {
  logInfo('sap.incoming_payment_post',
    { layer: 'erp', action: 'sap.incomingPayment' },
    { customer: payload.Customer, amount: payload.PaymentAmount });
  return sapWrite(cfg, SVC_INCOMING_PAYMENT, 'IncomingPayment', payload);
}

export interface SapJournalEntryPayload {
  CompanyCode: string;
  DocumentDate: string;
  PostingDate: string;
  AccountingDocumentType: string;     // e.g. 'SA' for general posting
  DocumentReferenceID?: string;
  DocumentHeaderText?: string;
  to_JournalEntryItem: {
    results: Array<{
      CompanyCode: string;
      GLAccount: string;
      DebitCreditCode: 'S' | 'H';   // S = debit, H = credit
      AmountInTransactionCurrency: string;
      TransactionCurrency: string;
      DocumentItemText?: string;
    }>;
  };
}

export async function sapPostJournalEntry(
  cfg: SapConnectionConfig, payload: SapJournalEntryPayload,
): Promise<{ AccountingDocument: string; FiscalYear: string }> {
  logInfo('sap.journal_entry_post',
    { layer: 'erp', action: 'sap.journalEntry' },
    { line_count: payload.to_JournalEntryItem.results.length });
  return sapWrite(cfg, SVC_JOURNAL_ENTRY, 'A_JournalEntry', payload);
}

export function isSapError(err: unknown): err is SapError {
  return err instanceof SapError;
}

export { SapError };
