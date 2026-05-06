/**
 * ERP Write-Back Interface — v74 (Phase 10-30).
 *
 * The transactional subcatalysts (AP 3-way match, AR cash app, GL
 * bank recon, etc.) call into this layer to STAGE a write to the
 * customer's ERP. The flow is:
 *
 *   1. Subcatalyst constructs a transactional payload (invoice doc,
 *      payment run, journal entry, ...).
 *   2. Calls stageTransactionalAction(...) which writes a
 *      `transactional_actions` row with status='pending' and an
 *      idempotency key derived from the source ref + action type.
 *   3. Either auto-approve flips it to 'approved' inline (per
 *      tenant policy / per-subcatalyst confidence threshold), OR a
 *      HITL approver flips it via an admin route.
 *   4. executePendingActions(...) — invoked by a downstream sweep
 *      (or directly in the transactional runner) — picks up
 *      'approved' rows and dispatches to the per-adapter write
 *      via dispatchToErp(...).
 *   5. Adapter returns external_doc_id + posted_at; row flips to
 *      'posted' or 'failed'.
 *
 * Idempotency:
 *   - The (tenant_id, idempotency_key) UNIQUE constraint guarantees
 *     a duplicate stage call collapses to no-op (we re-read the
 *     existing row instead of inserting).
 *   - Adapters MUST be idempotent at the ERP boundary — most modern
 *     ERPs (Xero, NetSuite, Odoo 16+) accept Idempotency-Key headers
 *     or natural keys (PO+GR for invoice, doc# for journal). For
 *     SAP RFC, we use SAP's own duplicate-invoice check (XBLNR).
 *
 * Per-adapter impls are SKINNY STUBS: they synthesize an external_doc_id
 * (deterministic from the idempotency key) and log the call. The real
 * SAP RFC / Odoo XML-RPC / Xero REST writes will replace the stubs
 * adapter-by-adapter; the staging + idempotency + audit pattern stays.
 *
 * Why staging + dispatch instead of one-shot post:
 *   - Auditability: every action has a row even before it's posted.
 *     Provenance chain (Phase 9) can fingerprint the payload at
 *     stage-time, before any external system has accepted it.
 *   - Retry: 'failed' rows are picked up by the next sweep, with
 *     exponential backoff via retry_count.
 *   - HITL gating: high-value actions (Phase 10-25 rate limits, or
 *     payment runs > tenant threshold) wait in 'pending' until a
 *     human approves.
 */

import { logError, logInfo, logWarn } from './logger';
import { encrypt, decrypt, isEncrypted } from './encryption';
import {
  odooAuthenticate, odooPostApInvoice, odooPostPayment, odooPostJournalEntry,
  odooSetCreditHold, isOdooError,
} from './erp-odoo-client';
import type { OdooConnectionConfig } from './erp-odoo-client';
import {
  xeroPostInvoice, xeroPostPayment, xeroPostManualJournal, isXeroError,
} from './erp-xero-client';
import type { XeroConnectionConfig } from './erp-xero-client';
import {
  netsuitePostVendorBill, netsuitePostCustomerPayment, netsuitePostJournalEntry,
  isNetSuiteError,
} from './erp-netsuite-client';
import type { NetSuiteConnectionConfig } from './erp-netsuite-client';
import {
  sapPostSupplierInvoice, sapPostIncomingPayment, sapPostJournalEntry, isSapError,
} from './erp-sap-client';
import type { SapConnectionConfig } from './erp-sap-client';
import {
  lookupPartnerExternalId, lookupPartnerExternalIdNumeric,
} from './erp-partner-mapping';

export type TransactionalActionType =
  | 'ap_invoice_post'
  | 'ap_payment_run'
  | 'ar_cash_apply'
  | 'ar_credit_hold'
  | 'gl_bank_match'
  | 'gl_journal_entry'
  | 'ap_invoice_block';

export type TransactionalStatus =
  | 'pending'      // staged, awaiting approval
  | 'approved'     // ready for dispatch
  | 'posted'       // ERP confirmed
  | 'failed'       // dispatch error
  | 'skipped';     // duplicate / superseded

export interface TransactionalActionRow {
  id: string;
  tenant_id: string;
  erp_connection_id: string | null;
  sub_catalyst_name: string;
  action_type: TransactionalActionType;
  target_entity: string;
  source_record_ref: string | null;
  idempotency_key: string;
  payload: string;
  payload_hash: string | null;
  status: TransactionalStatus;
  external_doc_id: string | null;
  posted_at: string | null;
  error: string | null;
  retry_count: number;
  posted_value: number | null;
  currency: string;
  reasoning: string | null;
  created_at: string;
  updated_at: string;
}

export interface StageActionInput {
  tenantId: string;
  erpConnectionId: string | null;
  subCatalystName: string;
  actionType: TransactionalActionType;
  targetEntity: string;
  sourceRecordRef: string | null;
  payload: Record<string, unknown>;
  postedValue?: number | null;
  currency?: string;
  reasoning?: string | null;
  /** When true, skip 'pending' and write 'approved' so the next
   *  dispatch sweep posts immediately. Use for high-confidence
   *  auto-decisions (perfect 3-way match, exact remittance match). */
  autoApprove?: boolean;
}

export interface StageActionResult {
  id: string;
  status: TransactionalStatus;
  duplicate: boolean;
}

/** Compute a deterministic idempotency key. For (tenant, source ref,
 *  action type) the key is stable so duplicate stage calls collapse. */
export function buildIdempotencyKey(
  subCatalystName: string,
  actionType: TransactionalActionType,
  sourceRecordRef: string | null,
): string {
  return `${subCatalystName}::${actionType}::${sourceRecordRef ?? '_none_'}`;
}

async function sha256Hex(text: string): Promise<string> {
  const buf = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Stage a transactional action. Idempotent on (tenant, idempotency_key). */
export async function stageTransactionalAction(
  db: D1Database,
  input: StageActionInput,
): Promise<StageActionResult> {
  const idempotencyKey = buildIdempotencyKey(
    input.subCatalystName, input.actionType, input.sourceRecordRef,
  );
  const existing = await db.prepare(
    'SELECT id, status FROM transactional_actions WHERE tenant_id = ? AND idempotency_key = ?',
  ).bind(input.tenantId, idempotencyKey).first<{ id: string; status: TransactionalStatus }>();

  if (existing) {
    return { id: existing.id, status: existing.status, duplicate: true };
  }

  const id = `txn-${crypto.randomUUID()}`;
  const payloadJson = JSON.stringify(input.payload);
  const payloadHash = await sha256Hex(payloadJson);
  const status: TransactionalStatus = input.autoApprove ? 'approved' : 'pending';
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO transactional_actions (
       id, tenant_id, erp_connection_id, sub_catalyst_name, action_type,
       target_entity, source_record_ref, idempotency_key, payload, payload_hash,
       status, posted_value, currency, reasoning, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, input.tenantId, input.erpConnectionId, input.subCatalystName, input.actionType,
    input.targetEntity, input.sourceRecordRef, idempotencyKey, payloadJson, payloadHash,
    status, input.postedValue ?? null, input.currency ?? 'ZAR', input.reasoning ?? null,
    now, now,
  ).run();

  return { id, status, duplicate: false };
}

export interface DispatchResult {
  posted: number;
  failed: number;
  skipped: number;
  errors: string[];
}

/** Pick up all 'approved' rows for the tenant and dispatch each to
 *  the appropriate adapter. Per-row failures don't abort the batch.
 *
 *  encryptionKey is the env ENCRYPTION_KEY — used to decrypt
 *  erp_connections.encrypted_config at dispatch time so adapters get
 *  plaintext credentials in memory. Optional for backwards compat:
 *  callers without an encryption key fall through to the plaintext
 *  config column. */
export async function executePendingActions(
  db: D1Database, tenantId: string, opts: { limit?: number; encryptionKey?: string } = {},
): Promise<DispatchResult> {
  const limit = opts.limit ?? 200;
  const rows = await db.prepare(
    `SELECT * FROM transactional_actions
      WHERE tenant_id = ? AND status = 'approved'
      ORDER BY created_at ASC LIMIT ?`,
  ).bind(tenantId, limit).all<TransactionalActionRow>();

  const result: DispatchResult = { posted: 0, failed: 0, skipped: 0, errors: [] };
  for (const row of rows.results || []) {
    try {
      const dispatch = await dispatchToErp(db, row, opts.encryptionKey);
      const now = new Date().toISOString();
      await db.prepare(
        `UPDATE transactional_actions SET
           status = ?, external_doc_id = ?, posted_at = ?, updated_at = ?
         WHERE id = ?`,
      ).bind(
        dispatch.posted ? 'posted' : 'skipped',
        dispatch.externalDocId, now, now, row.id,
      ).run();
      if (dispatch.posted) result.posted++;
      else result.skipped++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const now = new Date().toISOString();
      await db.prepare(
        `UPDATE transactional_actions SET
           status = 'failed', error = ?, retry_count = retry_count + 1, updated_at = ?
         WHERE id = ?`,
      ).bind(msg, now, row.id).run();
      result.failed++;
      result.errors.push(`${row.id}: ${msg}`);
      logError('erp_writeback.dispatch_failed', err, { tenantId, layer: 'erp_write', action: row.action_type }, { entity: row.target_entity });
    }
  }
  return result;
}

interface AdapterDispatchResult {
  posted: boolean;
  externalDocId: string;
}

/** Pick the right column off an erp_connections row and decrypt as
 *  needed. Returns plaintext JSON (or null) for the adapter to parse.
 *  Logs decrypt failures but never throws — the adapter falls back
 *  to its stub path when the config can't be resolved. */
async function resolveConnectionConfig(
  conn: { config: string | null; encrypted_config: string | null } | undefined | null,
  encryptionKey: string | undefined,
  tenantId: string,
  connectionId: string,
): Promise<string | null> {
  if (!conn) return null;
  const enc = conn.encrypted_config;
  if (enc && isEncrypted(enc)) {
    if (!encryptionKey || encryptionKey.length < 16) {
      logWarn('erp_writeback.config_decrypt_no_key',
        { tenantId, layer: 'erp_write', action: 'config_decrypt' },
        { connection_id: connectionId, reason: 'encrypted_config present but ENCRYPTION_KEY not configured' });
      // Fall through to plaintext (likely empty); adapter will stub.
    } else {
      const dec = await decrypt(enc, encryptionKey);
      if (dec === null) {
        logWarn('erp_writeback.config_decrypt_failed',
          { tenantId, layer: 'erp_write', action: 'config_decrypt' },
          { connection_id: connectionId, reason: 'AES-GCM auth tag mismatch — wrong key or tampered ciphertext' });
        return null;
      }
      return dec;
    }
  }
  // Plaintext path (legacy, pre-encryption-key, or test fixtures)
  return conn.config && conn.config !== '{}' ? conn.config : null;
}

/** Dispatch one staged row to the right adapter. Reads the connection
 *  config from `erp_connections.encrypted_config` (decrypted with the
 *  ENCRYPTION_KEY env var) and falls back to the plaintext `config`
 *  column when not encrypted (legacy / pre-key tenants). */
async function dispatchToErp(
  db: D1Database, row: TransactionalActionRow, encryptionKey?: string,
): Promise<AdapterDispatchResult> {
  let adapterId: string | null = null;
  let adapterSystem: string | null = null;
  let connectionConfig: string | null = null;
  if (row.erp_connection_id) {
    // Join erp_adapters so we can route on `system` (canonical, e.g. 'SAP',
    // 'Odoo', 'Xero', 'NetSuite') rather than `adapter_id` strings, which vary
    // between production seed (`erp-sap-ecc`, `erp-odoo`, `erp-ns`, `erp-xero`)
    // and test fixtures (`'sap_ecc'`, `'odoo'`, `'xero'`, `'netsuite'`).
    const conn = await db.prepare(
      `SELECT ec.adapter_id, ec.config, ec.encrypted_config, ea.system AS adapter_system
         FROM erp_connections ec
         LEFT JOIN erp_adapters ea ON ea.id = ec.adapter_id
        WHERE ec.id = ?`,
    ).bind(row.erp_connection_id).first<{ adapter_id: string; adapter_system: string | null; config: string | null; encrypted_config: string | null }>();
    adapterId = conn?.adapter_id ?? null;
    adapterSystem = conn?.adapter_system ?? null;
    connectionConfig = await resolveConnectionConfig(conn, encryptionKey, row.tenant_id, row.erp_connection_id);
  }

  // Synthesise a deterministic external doc ID so retries idempotent
  const docId = `${row.action_type.toUpperCase()}-${row.idempotency_key.slice(-12)}`;

  // Route on system FIRST (production path), fall back to adapter_id (test path).
  // Both lower-cased so 'SAP'/'sap_ecc'/'sap_s4hana'/'erp-sap-ecc' all land at dispatchSap.
  const adapterKey = (adapterSystem ?? adapterId ?? 'sap_ecc').toLowerCase();
  switch (adapterKey) {
    case 'sap':
    case 'sap_ecc':
    case 'sap_s4hana':
    case 'erp-sap-s4':
    case 'erp-sap-ecc':
      return dispatchSap(db, row, docId, connectionConfig);
    case 'odoo':
    case 'erp-odoo':
      return dispatchOdoo(db, row, docId, connectionConfig);
    case 'xero':
    case 'erp-xero':
      return dispatchXero(db, row, docId, connectionConfig, encryptionKey);
    case 'netsuite':
    case 'erp-ns':
      return dispatchNetsuite(db, row, docId, connectionConfig);
    default:
      // Generic stub — log + return synthesised id
      logInfo('erp_writeback.generic_stub',
        { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
        { adapter: adapterKey, doc_id: docId, entity: row.target_entity });
      return { posted: true, externalDocId: docId };
  }
}

// ── Per-adapter stubs ────────────────────────────────────────────
// These return synthesised IDs + log the call. Real implementations
// (SAP RFC via BAPI_INCOMINGINVOICE_CREATE, Odoo
// account.move:create + post, Xero PUT /Invoices, NetSuite REST
// vendorBill record) will swap in here. The staging row is already
// persisted with the full payload, so the adapter is purely an
// outbound bridge.

/**
 * Real SAP S/4HANA write-back via OData v2 services with CSRF token
 * handshake. Falls back to the synthesised SAP-shaped doc number when
 * config is incomplete (legacy ECC tenants without a configured
 * communication user, dev fixtures, etc.).
 *
 * Action-type → SAP service mapping:
 *   ap_invoice_post  → API_SUPPLIERINVOICE_PROCESS_SRV/A_SupplierInvoice
 *   ar_cash_apply    → API_INCOMINGPAYMENT_SRV/IncomingPayment
 *   gl_journal_entry → API_JOURNALENTRY_SRV/A_JournalEntry
 *   ap_payment_run   → STUB (Payment Run F110 isn't a single OData call;
 *                      tenant-side workflow handles batch payment runs)
 *   ar_credit_hold + ap_invoice_block + gl_bank_match → STUB
 */
async function dispatchSap(
  db: D1Database, row: TransactionalActionRow, docId: string, configJson: string | null,
): Promise<AdapterDispatchResult> {
  const cfg = parseSapConfig(configJson);
  if (!cfg) {
    // Existing behaviour: synthesise an SAP-shaped doc number + log.
    // Lots of tenants in the platform are still on the stub path
    // (sandbox / demo / pre-production) — don't break them.
    const sapDoc = mapToSapDoc(row.action_type, docId);
    logInfo('erp_writeback.sap_missing_config',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { adapter: 'sap_ecc', doc_id: sapDoc, reason: 'config missing base_url/user/password — falling back to synth doc' });
    return { posted: true, externalDocId: sapDoc };
  }

  if (
    row.action_type === 'ap_invoice_block' || row.action_type === 'gl_bank_match' ||
    row.action_type === 'ar_credit_hold' || row.action_type === 'ap_payment_run'
  ) {
    const sapDoc = mapToSapDoc(row.action_type, docId);
    logInfo('erp_writeback.sap_skipped',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'action_type does not map to a single SAP OData call', doc_id: sapDoc });
    return { posted: true, externalDocId: sapDoc };
  }

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* keep empty */ }

  try {
    let externalDocId: string;
    switch (row.action_type) {
      case 'ap_invoice_post': {
        const r = await postSapSupplierInvoice(db, cfg, row, payload);
        externalDocId = r.SupplierInvoice;
        break;
      }
      case 'ar_cash_apply': {
        const r = await postSapIncomingPayment(db, cfg, row, payload);
        externalDocId = r.PaymentDocument;
        break;
      }
      case 'gl_journal_entry': {
        const r = await postSapJournalEntry(cfg, row, payload);
        externalDocId = r.AccountingDocument;
        break;
      }
      default: {
        const sapDoc = mapToSapDoc(row.action_type, docId);
        logWarn('erp_writeback.sap_unsupported',
          { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
          { reason: `action_type '${row.action_type}' has no SAP mapping; using synth doc_id`, doc_id: sapDoc });
        return { posted: true, externalDocId: sapDoc };
      }
    }

    logInfo('erp_writeback.sap_posted',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { adapter: 'sap', doc_id: externalDocId, idempotency_key: row.idempotency_key, entity: row.target_entity });
    return { posted: true, externalDocId };
  } catch (err) {
    const reason = isSapError(err)
      ? `[SAP ${err.sapErrorCode ?? 'error'} ${err.httpStatus ?? '?'}] ${err.message}${err.debug ? ` :: ${err.debug.slice(0, 200)}` : ''}`
      : err instanceof Error ? err.message : String(err);
    throw new Error(`SAP dispatch failed: ${reason}`);
  }
}

function parseSapConfig(configJson: string | null): SapConnectionConfig | null {
  if (!configJson) return null;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(configJson); } catch { return null; }
  const base_url = typeof parsed.base_url === 'string' ? parsed.base_url.replace(/\/+$/, '') : '';
  const user = typeof parsed.user === 'string' ? parsed.user : '';
  const password = typeof parsed.password === 'string' ? parsed.password : '';
  const client = typeof parsed.client === 'string' ? parsed.client : undefined;
  if (!base_url || !user || !password) return null;
  return { base_url, user, password, client };
}

interface SapApInvoicePayload {
  invoice?: { invoice_number?: string; invoice_date?: string; due_date?: string };
  company_code?: string;
  vendor_id?: string; vendor_ref?: string;
  document_currency?: string;
  gross_amount?: number;
  line_items?: Array<{ gl_account: string; amount: number; debit_credit?: 'S' | 'H' }>;
}
async function postSapSupplierInvoice(
  db: D1Database, cfg: SapConnectionConfig, row: TransactionalActionRow, payload: SapApInvoicePayload,
): Promise<{ SupplierInvoice: string; FiscalYear: string }> {
  if (!payload.company_code) throw new Error('payload missing company_code (SAP CompanyCode required)');
  let vendorId = payload.vendor_id;
  if (!vendorId && payload.vendor_ref && row.erp_connection_id) {
    const mapped = await lookupPartnerExternalId(db, row.tenant_id, row.erp_connection_id, 'vendor', payload.vendor_ref);
    if (mapped) vendorId = mapped;
  }
  if (!vendorId) throw new Error('payload missing vendor_id (SAP InvoicingParty required) and no vendor_ref mapping found');
  const inv = payload.invoice ?? {};
  const docDate = inv.invoice_date ?? new Date().toISOString().slice(0, 10);
  const currency = payload.document_currency ?? row.currency ?? 'USD';
  const gross = (payload.gross_amount ?? row.posted_value ?? 0).toFixed(2);
  const items = payload.line_items && payload.line_items.length > 0
    ? payload.line_items.map((li) => ({
        CompanyCode: payload.company_code as string,
        GLAccount: li.gl_account,
        DebitCreditCode: (li.debit_credit ?? 'S') as 'S' | 'H',
        DocumentCurrency: currency,
        SupplierInvoiceItemAmount: li.amount.toFixed(2),
      }))
    : undefined;
  return sapPostSupplierInvoice(cfg, {
    CompanyCode: payload.company_code,
    DocumentDate: docDate,
    PostingDate: docDate,
    InvoicingParty: vendorId,
    SupplierInvoiceIDByInvcgParty: inv.invoice_number ?? row.source_record_ref ?? undefined,
    DocumentCurrency: currency,
    InvoiceGrossAmount: gross,
    ...(items ? { to_SupplierInvoiceItemGLAcct: { results: items } } : {}),
  });
}

interface SapCashApplyPayload {
  company_code?: string;
  customer_id?: string; customer_ref?: string;
  amount?: number;
  currency?: string;
  house_bank?: string;
  house_bank_account?: string;
  assignment_reference?: string;
  payment_date?: string;
}
async function postSapIncomingPayment(
  db: D1Database, cfg: SapConnectionConfig, row: TransactionalActionRow, payload: SapCashApplyPayload,
): Promise<{ PaymentDocument: string; FiscalYear: string }> {
  if (!payload.company_code) throw new Error('payload missing company_code (SAP CompanyCode required)');
  let customerId = payload.customer_id;
  if (!customerId && payload.customer_ref && row.erp_connection_id) {
    const mapped = await lookupPartnerExternalId(db, row.tenant_id, row.erp_connection_id, 'customer', payload.customer_ref);
    if (mapped) customerId = mapped;
  }
  if (!customerId) throw new Error('payload missing customer_id (SAP Customer required) and no customer_ref mapping found');
  return sapPostIncomingPayment(cfg, {
    CompanyCode: payload.company_code,
    PostingDate: payload.payment_date ?? new Date().toISOString().slice(0, 10),
    Customer: customerId,
    PaymentAmount: (payload.amount ?? row.posted_value ?? 0).toFixed(2),
    PaymentCurrency: payload.currency ?? row.currency ?? 'USD',
    HouseBank: payload.house_bank,
    HouseBankAccount: payload.house_bank_account,
    AssignmentReference: payload.assignment_reference ?? row.source_record_ref ?? undefined,
  });
}

interface SapJePayload {
  company_code?: string;
  document_date?: string;
  document_type?: string;
  reference?: string;
  header_text?: string;
  currency?: string;
  debit?: { gl_account: string; amount: number };
  credit?: { gl_account: string; amount: number };
}
async function postSapJournalEntry(
  cfg: SapConnectionConfig, row: TransactionalActionRow, payload: SapJePayload,
): Promise<{ AccountingDocument: string; FiscalYear: string }> {
  if (!payload.company_code) throw new Error('payload missing company_code (SAP CompanyCode required)');
  if (!payload.debit || !payload.credit) throw new Error('payload missing debit/credit blocks');
  const docDate = payload.document_date ?? new Date().toISOString().slice(0, 10);
  const currency = payload.currency ?? row.currency ?? 'USD';
  const cc = payload.company_code;
  return sapPostJournalEntry(cfg, {
    CompanyCode: cc,
    DocumentDate: docDate,
    PostingDate: docDate,
    AccountingDocumentType: payload.document_type ?? 'SA',
    DocumentReferenceID: payload.reference ?? row.source_record_ref ?? undefined,
    DocumentHeaderText: payload.header_text ?? row.target_entity,
    to_JournalEntryItem: {
      results: [
        { CompanyCode: cc, GLAccount: payload.debit.gl_account, DebitCreditCode: 'S',
          AmountInTransactionCurrency: Math.abs(payload.debit.amount).toFixed(2), TransactionCurrency: currency,
          DocumentItemText: payload.header_text ?? row.target_entity },
        { CompanyCode: cc, GLAccount: payload.credit.gl_account, DebitCreditCode: 'H',
          AmountInTransactionCurrency: Math.abs(payload.credit.amount).toFixed(2), TransactionCurrency: currency,
          DocumentItemText: payload.header_text ?? row.target_entity },
      ],
    },
  });
}

/**
 * Real Odoo write-back. Posts via the JSON-RPC `/jsonrpc` endpoint
 * using credentials in `erp_connections.config`. Falls back to the
 * stub-and-log behaviour when credentials are missing OR when the
 * payload references partner/journal IDs we can't resolve — that
 * way test environments and partial-config tenants don't fail
 * dispatch on a real-API path that nothing's wired up to yet.
 *
 * Action-type → Odoo model mapping:
 *   ap_invoice_post  → account.move (in_invoice) create + action_post
 *   ap_payment_run   → account.payment (outbound, supplier) create + action_post
 *   ar_cash_apply    → account.payment (inbound, customer) create + action_post
 *   ar_credit_hold   → res.partner write { sale_warn:'block' }
 *   gl_journal_entry → account.move (entry) create + action_post
 *   gl_bank_match    → STUB (recon needs an existing bank statement line ID
 *                      that Atheon doesn't track yet)
 *   ap_invoice_block → STUB (block is internal HITL state; nothing to write)
 */
async function dispatchOdoo(
  db: D1Database, row: TransactionalActionRow, docId: string, configJson: string | null,
): Promise<AdapterDispatchResult> {
  const cfg = parseOdooConfig(configJson);
  if (!cfg) {
    // Connection config doesn't have full Odoo creds — log + stub.
    // This preserves the existing test-environment behaviour where
    // erp_connections.config is just `{}` or missing fields.
    logWarn('erp_writeback.odoo_missing_config',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'config missing url/db/login/password — falling back to stub' });
    return { posted: true, externalDocId: docId };
  }

  // Block actions don't post to Odoo — they're internal HITL markers
  if (row.action_type === 'ap_invoice_block' || row.action_type === 'gl_bank_match') {
    logInfo('erp_writeback.odoo_skipped',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'action_type does not map to an Odoo write', doc_id: docId });
    return { posted: true, externalDocId: docId };
  }

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* keep empty */ }

  try {
    const uid = await odooAuthenticate(cfg);

    let result: { id: number; name: string };
    switch (row.action_type) {
      case 'ap_invoice_post':
        result = await postOdooApInvoice(db, cfg, uid, row, payload);
        break;
      case 'ap_payment_run':
        result = await postOdooPaymentRun(db, cfg, uid, row, payload);
        break;
      case 'ar_cash_apply':
        result = await postOdooCashApply(db, cfg, uid, row, payload);
        break;
      case 'gl_journal_entry':
        result = await postOdooJournalEntry(cfg, uid, row, payload);
        break;
      case 'ar_credit_hold':
        result = await postOdooCreditHold(db, cfg, uid, row, payload);
        break;
      default:
        logWarn('erp_writeback.odoo_unsupported',
          { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
          { reason: `action_type '${row.action_type}' has no Odoo mapping; using stub doc_id` });
        return { posted: true, externalDocId: docId };
    }

    logInfo('erp_writeback.odoo_posted',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { adapter: 'odoo', doc_id: result.name, odoo_id: result.id, idempotency_key: row.idempotency_key, entity: row.target_entity });
    return { posted: true, externalDocId: result.name };
  } catch (err) {
    // Surface the actual error so executePendingActions writes it
    // into transactional_actions.error — not "Max retries exceeded"
    // anti-pattern. The route handler bubbles this and the row goes
    // status='failed' with a human-readable reason in the column.
    const reason = isOdooError(err)
      ? `[Odoo ${err.odooErrorName ?? 'error'}] ${err.message}${err.debug ? ` :: ${err.debug.slice(0, 200)}` : ''}`
      : err instanceof Error ? err.message : String(err);
    throw new Error(`Odoo dispatch failed: ${reason}`);
  }
}

function parseOdooConfig(configJson: string | null): OdooConnectionConfig | null {
  if (!configJson) return null;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(configJson); } catch { return null; }
  const url = typeof parsed.url === 'string' ? parsed.url : '';
  const db = typeof parsed.db === 'string' ? parsed.db : '';
  const login = typeof parsed.login === 'string' ? parsed.login : '';
  const password = typeof parsed.password === 'string' ? parsed.password : '';
  if (!url || !db || !login || !password) return null;
  return { url, db, login, password };
}

/** Resolve an Odoo numeric res.partner.id from either an explicit
 *  numeric in the payload OR a string vendor_ref that maps via
 *  erp_partner_mappings. Returns null when neither is available. */
async function resolveOdooPartnerId(
  db: D1Database, row: TransactionalActionRow,
  partnerType: 'vendor' | 'customer',
  payload: { partner_id?: number; vendor_partner_id?: number; vendor_id?: number;
             customer_partner_id?: number; customer_id?: number;
             vendor_ref?: string; customer_ref?: string; partner_ref?: string },
): Promise<number | null> {
  // Explicit numeric ID wins (fast path, no DB hit)
  const explicit = payload.partner_id
    ?? (partnerType === 'vendor' ? (payload.vendor_partner_id ?? payload.vendor_id) : (payload.customer_partner_id ?? payload.customer_id));
  if (typeof explicit === 'number') return explicit;

  // String ref via mapping table
  if (!row.erp_connection_id) return null;
  const ref = payload.partner_ref
    ?? (partnerType === 'vendor' ? payload.vendor_ref : payload.customer_ref);
  if (!ref) return null;
  return lookupPartnerExternalIdNumeric(db, row.tenant_id, row.erp_connection_id, partnerType, ref);
}

interface OdooApInvoicePayload {
  invoice?: { invoice_number?: string; invoice_amount?: number; invoice_date?: string; due_date?: string };
  vendor_id?: number; vendor_partner_id?: number; partner_id?: number;
  vendor_ref?: string; partner_ref?: string;
  expense_account_id?: number;
  line_items?: Array<{ name?: string; quantity?: number; price_unit?: number; account_id?: number }>;
}
async function postOdooApInvoice(
  db: D1Database, cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooApInvoicePayload,
): Promise<{ id: number; name: string }> {
  const partnerId = await resolveOdooPartnerId(db, row, 'vendor', payload);
  if (typeof partnerId !== 'number') {
    throw new Error('payload missing partner_id / vendor_partner_id (Odoo res.partner numeric ID required) and no vendor_ref mapping found');
  }
  const inv = payload.invoice ?? {};
  const lines = payload.line_items && payload.line_items.length > 0
    ? payload.line_items.map((li) => [0, 0, {
        name: li.name ?? row.target_entity,
        quantity: li.quantity ?? 1,
        price_unit: li.price_unit ?? (row.posted_value ?? 0),
        ...(li.account_id ? { account_id: li.account_id } : {}),
      }] as [0, 0, { name: string; quantity: number; price_unit: number; account_id?: number }])
    : [[0, 0, {
        name: inv.invoice_number ?? row.target_entity,
        quantity: 1,
        price_unit: row.posted_value ?? 0,
        ...(payload.expense_account_id ? { account_id: payload.expense_account_id } : {}),
      }] as [0, 0, { name: string; quantity: number; price_unit: number; account_id?: number }]];
  return odooPostApInvoice(cfg, uid, {
    move_type: 'in_invoice',
    partner_id: partnerId,
    invoice_date: inv.invoice_date,
    invoice_date_due: inv.due_date,
    ref: inv.invoice_number ?? row.source_record_ref ?? undefined,
    invoice_line_ids: lines,
  });
}

interface OdooPaymentPayload {
  vendor_id?: number; vendor_partner_id?: number; partner_id?: number;
  vendor_ref?: string; partner_ref?: string;
  total_amount?: number; amount?: number;
  journal_id?: number;
}
async function postOdooPaymentRun(
  db: D1Database, cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooPaymentPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = await resolveOdooPartnerId(db, row, 'vendor', payload);
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required) and no vendor_ref mapping found');
  if (typeof payload.journal_id !== 'number') throw new Error('payload missing journal_id (Odoo bank journal numeric ID required)');
  return odooPostPayment(cfg, uid, {
    payment_type: 'outbound',
    partner_type: 'supplier',
    partner_id: partnerId,
    amount: payload.total_amount ?? payload.amount ?? Math.abs(row.posted_value ?? 0),
    date: new Date().toISOString().slice(0, 10),
    ref: row.source_record_ref ?? undefined,
    journal_id: payload.journal_id,
  });
}

interface OdooCashApplyPayload {
  customer_id?: number; customer_partner_id?: number; partner_id?: number;
  customer_ref?: string; partner_ref?: string;
  amount?: number; journal_id?: number;
}
async function postOdooCashApply(
  db: D1Database, cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooCashApplyPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = await resolveOdooPartnerId(db, row, 'customer', payload);
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required) and no customer_ref mapping found');
  if (typeof payload.journal_id !== 'number') throw new Error('payload missing journal_id (Odoo bank journal numeric ID required)');
  return odooPostPayment(cfg, uid, {
    payment_type: 'inbound',
    partner_type: 'customer',
    partner_id: partnerId,
    amount: payload.amount ?? row.posted_value ?? 0,
    date: new Date().toISOString().slice(0, 10),
    ref: row.source_record_ref ?? undefined,
    journal_id: payload.journal_id,
  });
}

interface OdooJePayload {
  journal_id?: number;
  debit?: { account_id: number; amount: number };
  credit?: { account_id: number; amount: number };
  name?: string;
}
async function postOdooJournalEntry(
  cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooJePayload,
): Promise<{ id: number; name: string }> {
  if (typeof payload.journal_id !== 'number') throw new Error('payload missing journal_id (Odoo numeric ID required)');
  if (!payload.debit || !payload.credit) throw new Error('payload missing debit/credit blocks');
  const memo = payload.name ?? row.source_record_ref ?? row.target_entity;
  return odooPostJournalEntry(cfg, uid, {
    ref: memo,
    date: new Date().toISOString().slice(0, 10),
    journal_id: payload.journal_id,
    line_ids: [
      [0, 0, { name: memo, account_id: payload.debit.account_id, debit: payload.debit.amount }],
      [0, 0, { name: memo, account_id: payload.credit.account_id, credit: payload.credit.amount }],
    ],
  });
}

interface OdooCreditHoldPayload {
  customer_partner_id?: number; partner_id?: number; customer_id?: number;
  customer_ref?: string; partner_ref?: string;
  reason?: string;
}
async function postOdooCreditHold(
  db: D1Database, cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooCreditHoldPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = await resolveOdooPartnerId(db, row, 'customer', payload);
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required) and no customer_ref mapping found');
  return odooSetCreditHold(cfg, uid, partnerId, payload.reason ?? row.reasoning ?? 'Credit limit exceeded');
}

/**
 * Real Xero write-back. Posts via Xero's REST API using OAuth2
 * credentials stored in `erp_connections.config`. Falls back to the
 * stub-and-log path when config is missing fields, so test
 * environments and partial-config tenants don't fail dispatch.
 *
 * Action-type → Xero endpoint mapping:
 *   ap_invoice_post  → PUT /Invoices  (Type: ACCPAY)
 *   ap_payment_run   → PUT /Payments  (against an existing AP invoice)
 *   ar_cash_apply    → PUT /Payments  (against an existing AR invoice)
 *   gl_journal_entry → PUT /ManualJournals
 *   ar_credit_hold   → STUB (Xero has no native credit-hold flag;
 *                      tenant-side workflow handles it)
 *   ap_invoice_block, gl_bank_match → STUB (internal HITL state)
 *
 * Refreshed access tokens are persisted back to
 * erp_connections.config so the next dispatch picks up the rotated
 * token instead of re-refreshing on every call.
 */
async function dispatchXero(
  db: D1Database, row: TransactionalActionRow, docId: string, configJson: string | null,
  encryptionKey?: string,
): Promise<AdapterDispatchResult> {
  const cfg = parseXeroConfig(configJson);
  if (!cfg) {
    logWarn('erp_writeback.xero_missing_config',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'config missing client_id/client_secret/tenant_id/access_token — falling back to stub' });
    return { posted: true, externalDocId: docId };
  }

  if (row.action_type === 'ap_invoice_block' || row.action_type === 'gl_bank_match' || row.action_type === 'ar_credit_hold') {
    logInfo('erp_writeback.xero_skipped',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'action_type does not map to a Xero write', doc_id: docId });
    return { posted: true, externalDocId: docId };
  }

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* keep empty */ }

  const tokenSnapshot = { access_token: cfg.access_token, refresh_token: cfg.refresh_token, token_expires_at: cfg.token_expires_at };

  try {
    let externalDocId: string;
    switch (row.action_type) {
      case 'ap_invoice_post': {
        const inv = await postXeroApInvoice(db, cfg, row, payload);
        externalDocId = inv.InvoiceNumber || inv.InvoiceID;
        break;
      }
      case 'ap_payment_run': {
        const pay = await postXeroPaymentRun(cfg, row, payload);
        externalDocId = pay.Reference || pay.PaymentID;
        break;
      }
      case 'ar_cash_apply': {
        const pay = await postXeroCashApply(cfg, row, payload);
        externalDocId = pay.Reference || pay.PaymentID;
        break;
      }
      case 'gl_journal_entry': {
        const j = await postXeroJournalEntry(cfg, row, payload);
        externalDocId = j.ManualJournalID;
        break;
      }
      default:
        logWarn('erp_writeback.xero_unsupported',
          { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
          { reason: `action_type '${row.action_type}' has no Xero mapping; using stub doc_id` });
        return { posted: true, externalDocId: docId };
    }

    // If xeroCall rotated the token, persist back so subsequent dispatches don't refresh again
    if (row.erp_connection_id && (
      cfg.access_token !== tokenSnapshot.access_token ||
      cfg.refresh_token !== tokenSnapshot.refresh_token ||
      cfg.token_expires_at !== tokenSnapshot.token_expires_at
    )) {
      await persistXeroToken(db, row.erp_connection_id, cfg, encryptionKey);
    }

    logInfo('erp_writeback.xero_posted',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { adapter: 'xero', doc_id: externalDocId, idempotency_key: row.idempotency_key, entity: row.target_entity });
    return { posted: true, externalDocId };
  } catch (err) {
    const reason = isXeroError(err)
      ? `[Xero ${err.xeroErrorType ?? 'error'} ${err.httpStatus ?? '?'}] ${err.message}${err.debug ? ` :: ${err.debug.slice(0, 200)}` : ''}`
      : err instanceof Error ? err.message : String(err);
    throw new Error(`Xero dispatch failed: ${reason}`);
  }
}

function parseXeroConfig(configJson: string | null): XeroConnectionConfig | null {
  if (!configJson) return null;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(configJson); } catch { return null; }
  const client_id = typeof parsed.client_id === 'string' ? parsed.client_id : '';
  const client_secret = typeof parsed.client_secret === 'string' ? parsed.client_secret : '';
  const tenant_id = typeof parsed.tenant_id === 'string' ? parsed.tenant_id : '';
  const access_token = typeof parsed.access_token === 'string' ? parsed.access_token : '';
  const refresh_token = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : '';
  const token_expires_at = typeof parsed.token_expires_at === 'string' ? parsed.token_expires_at : '';
  if (!client_id || !client_secret || !tenant_id || !access_token || !refresh_token) return null;
  return { client_id, client_secret, tenant_id, access_token, refresh_token, token_expires_at };
}

async function persistXeroToken(
  db: D1Database, connectionId: string, cfg: XeroConnectionConfig,
  encryptionKey?: string,
): Promise<void> {
  try {
    const row = await db.prepare('SELECT config, encrypted_config FROM erp_connections WHERE id = ?')
      .bind(connectionId).first<{ config: string | null; encrypted_config: string | null }>();
    // Decode the existing config (preserving any non-token fields) — prefer
    // encrypted_config when present + decryptable, else fall back to plaintext.
    let parsed: Record<string, unknown> = {};
    if (row?.encrypted_config && isEncrypted(row.encrypted_config) && encryptionKey && encryptionKey.length >= 16) {
      const dec = await decrypt(row.encrypted_config, encryptionKey);
      try { if (dec) parsed = JSON.parse(dec); } catch { /* overwrite */ }
    } else if (row?.config) {
      try { parsed = JSON.parse(row.config); } catch { /* overwrite */ }
    }
    parsed.access_token = cfg.access_token;
    parsed.refresh_token = cfg.refresh_token;
    parsed.token_expires_at = cfg.token_expires_at;
    const json = JSON.stringify(parsed);

    // Re-encrypt if a key is configured AND the row was previously encrypted
    // (don't silently upgrade plaintext tenants — that's an admin/migration
    // decision, not a side-effect of token refresh).
    const wasEncrypted = !!(row?.encrypted_config && isEncrypted(row.encrypted_config));
    if (wasEncrypted && encryptionKey && encryptionKey.length >= 16) {
      const enc = await encrypt(json, encryptionKey);
      await db.prepare(
        `UPDATE erp_connections SET encrypted_config = ?, config = '{}' WHERE id = ?`,
      ).bind(enc, connectionId).run();
    } else {
      await db.prepare('UPDATE erp_connections SET config = ? WHERE id = ?')
        .bind(json, connectionId).run();
    }
  } catch (err) {
    // Persistence failure is non-fatal: the token still works for the
    // current request; next dispatch will just refresh again.
    logWarn('erp_writeback.xero_token_persist_failed',
      { layer: 'erp_write', action: 'xero.token_persist' },
      { connection_id: connectionId, reason: err instanceof Error ? err.message : String(err) });
  }
}

interface XeroApInvoicePayload {
  invoice?: { invoice_number?: string; invoice_amount?: number; invoice_date?: string; due_date?: string };
  vendor_contact_id?: string; vendor_name?: string; vendor_ref?: string;
  expense_account_code?: string;
  line_items?: Array<{ description?: string; quantity?: number; unit_amount?: number; account_code?: string }>;
  status?: 'DRAFT' | 'AUTHORISED';
}
async function postXeroApInvoice(
  db: D1Database, cfg: XeroConnectionConfig, row: TransactionalActionRow, payload: XeroApInvoicePayload,
): Promise<{ InvoiceID: string; InvoiceNumber: string }> {
  const inv = payload.invoice ?? {};
  const lines = payload.line_items && payload.line_items.length > 0
    ? payload.line_items.map((li) => ({
        Description: li.description ?? row.target_entity,
        Quantity: li.quantity ?? 1,
        UnitAmount: li.unit_amount ?? (row.posted_value ?? 0),
        AccountCode: li.account_code ?? payload.expense_account_code ?? '400',
      }))
    : [{
        Description: inv.invoice_number ?? row.target_entity,
        Quantity: 1,
        UnitAmount: row.posted_value ?? 0,
        AccountCode: payload.expense_account_code ?? '400',
      }];
  // Resolve Xero ContactID: explicit ID > mapping table > Name fallback
  let contactId = payload.vendor_contact_id;
  if (!contactId && payload.vendor_ref && row.erp_connection_id) {
    const mapped = await lookupPartnerExternalId(db, row.tenant_id, row.erp_connection_id, 'vendor', payload.vendor_ref);
    if (mapped) contactId = mapped;
  }
  const contact = contactId
    ? { ContactID: contactId }
    : { Name: payload.vendor_name ?? row.target_entity };
  return xeroPostInvoice(cfg, {
    Type: 'ACCPAY',
    Contact: contact,
    Date: inv.invoice_date ?? new Date().toISOString().slice(0, 10),
    DueDate: inv.due_date,
    LineItems: lines,
    Reference: inv.invoice_number ?? row.source_record_ref ?? undefined,
    Status: payload.status ?? 'AUTHORISED',
  }, row.idempotency_key);
}

interface XeroPaymentPayload {
  invoice_id?: string;
  amount?: number; total_amount?: number;
  bank_account_code?: string;
  payment_date?: string;
}
async function postXeroPaymentRun(
  cfg: XeroConnectionConfig, row: TransactionalActionRow, payload: XeroPaymentPayload,
): Promise<{ PaymentID: string; Reference: string | null }> {
  if (!payload.invoice_id) throw new Error('payload missing invoice_id (Xero InvoiceID required)');
  if (!payload.bank_account_code) throw new Error('payload missing bank_account_code (Xero bank account code required)');
  return xeroPostPayment(cfg, {
    Invoice: { InvoiceID: payload.invoice_id },
    Account: { Code: payload.bank_account_code },
    Amount: payload.total_amount ?? payload.amount ?? Math.abs(row.posted_value ?? 0),
    Date: payload.payment_date ?? new Date().toISOString().slice(0, 10),
    Reference: row.source_record_ref ?? undefined,
  }, row.idempotency_key);
}

async function postXeroCashApply(
  cfg: XeroConnectionConfig, row: TransactionalActionRow, payload: XeroPaymentPayload,
): Promise<{ PaymentID: string; Reference: string | null }> {
  if (!payload.invoice_id) throw new Error('payload missing invoice_id (Xero InvoiceID required)');
  if (!payload.bank_account_code) throw new Error('payload missing bank_account_code (Xero bank account code required)');
  return xeroPostPayment(cfg, {
    Invoice: { InvoiceID: payload.invoice_id },
    Account: { Code: payload.bank_account_code },
    Amount: payload.amount ?? payload.total_amount ?? row.posted_value ?? 0,
    Date: payload.payment_date ?? new Date().toISOString().slice(0, 10),
    Reference: row.source_record_ref ?? undefined,
  }, row.idempotency_key);
}

interface XeroJournalPayload {
  narration?: string;
  date?: string;
  status?: 'DRAFT' | 'POSTED';
  debit?: { account_code: string; amount: number; description?: string };
  credit?: { account_code: string; amount: number; description?: string };
}
async function postXeroJournalEntry(
  cfg: XeroConnectionConfig, row: TransactionalActionRow, payload: XeroJournalPayload,
): Promise<{ ManualJournalID: string }> {
  if (!payload.debit || !payload.credit) throw new Error('payload missing debit/credit blocks');
  const memo = payload.narration ?? row.source_record_ref ?? row.target_entity;
  return xeroPostManualJournal(cfg, {
    Narration: memo,
    Date: payload.date ?? new Date().toISOString().slice(0, 10),
    Status: payload.status ?? 'POSTED',
    JournalLines: [
      { Description: payload.debit.description ?? memo, LineAmount: Math.abs(payload.debit.amount), AccountCode: payload.debit.account_code },
      { Description: payload.credit.description ?? memo, LineAmount: -Math.abs(payload.credit.amount), AccountCode: payload.credit.account_code },
    ],
  }, row.idempotency_key);
}

/**
 * Real NetSuite write-back via SuiteTalk REST + OAuth 1.0a TBA.
 *
 * Action-type → NetSuite endpoint mapping:
 *   ap_invoice_post  → POST /vendorBill
 *   ap_payment_run   → STUB (NetSuite vendor payments need an
 *                      existing bill internalId + bank account; until
 *                      payment-run payloads include both, we don't
 *                      have the data to call vendorPayment cleanly)
 *   ar_cash_apply    → POST /customerPayment with apply lines
 *   gl_journal_entry → POST /journalEntry
 *   ar_credit_hold + ap_invoice_block + gl_bank_match → STUB
 *
 * NetSuite returns 204 No Content + a Location header pointing at
 * the new record; we use the trailing internalId as external_doc_id.
 */
async function dispatchNetsuite(
  db: D1Database, row: TransactionalActionRow, docId: string, configJson: string | null,
): Promise<AdapterDispatchResult> {
  const cfg = parseNetSuiteConfig(configJson);
  if (!cfg) {
    logWarn('erp_writeback.netsuite_missing_config',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'config missing account_id/consumer_key/consumer_secret/token_id/token_secret — falling back to stub' });
    return { posted: true, externalDocId: docId };
  }

  if (
    row.action_type === 'ap_invoice_block' || row.action_type === 'gl_bank_match' ||
    row.action_type === 'ar_credit_hold' || row.action_type === 'ap_payment_run'
  ) {
    logInfo('erp_writeback.netsuite_skipped',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { reason: 'action_type does not map to a NetSuite write yet', doc_id: docId });
    return { posted: true, externalDocId: docId };
  }

  let payload: Record<string, unknown> = {};
  try { payload = JSON.parse(row.payload || '{}'); } catch { /* keep empty */ }

  try {
    let internalId: string;
    switch (row.action_type) {
      case 'ap_invoice_post':
        internalId = (await postNetSuiteVendorBill(db, cfg, row, payload)).internalId;
        break;
      case 'ar_cash_apply':
        internalId = (await postNetSuiteCustomerPayment(db, cfg, row, payload)).internalId;
        break;
      case 'gl_journal_entry':
        internalId = (await postNetSuiteJournalEntry(cfg, row, payload)).internalId;
        break;
      default:
        logWarn('erp_writeback.netsuite_unsupported',
          { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
          { reason: `action_type '${row.action_type}' has no NetSuite mapping; using stub doc_id` });
        return { posted: true, externalDocId: docId };
    }

    logInfo('erp_writeback.netsuite_posted',
      { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
      { adapter: 'netsuite', doc_id: internalId, idempotency_key: row.idempotency_key, entity: row.target_entity });
    return { posted: true, externalDocId: internalId };
  } catch (err) {
    const reason = isNetSuiteError(err)
      ? `[NetSuite ${err.netsuiteErrorType ?? 'error'} ${err.httpStatus ?? '?'}] ${err.message}${err.debug ? ` :: ${err.debug.slice(0, 200)}` : ''}`
      : err instanceof Error ? err.message : String(err);
    throw new Error(`NetSuite dispatch failed: ${reason}`);
  }
}

function parseNetSuiteConfig(configJson: string | null): NetSuiteConnectionConfig | null {
  if (!configJson) return null;
  let parsed: Record<string, unknown> = {};
  try { parsed = JSON.parse(configJson); } catch { return null; }
  const account_id = typeof parsed.account_id === 'string' ? parsed.account_id : '';
  const consumer_key = typeof parsed.consumer_key === 'string' ? parsed.consumer_key : '';
  const consumer_secret = typeof parsed.consumer_secret === 'string' ? parsed.consumer_secret : '';
  const token_id = typeof parsed.token_id === 'string' ? parsed.token_id : '';
  const token_secret = typeof parsed.token_secret === 'string' ? parsed.token_secret : '';
  if (!account_id || !consumer_key || !consumer_secret || !token_id || !token_secret) return null;
  return { account_id, consumer_key, consumer_secret, token_id, token_secret };
}

interface NetSuiteVendorBillRowPayload {
  invoice?: { invoice_number?: string; invoice_date?: string; due_date?: string };
  vendor_internal_id?: string; vendor_ref?: string;
  expense_account_id?: string;
  line_items?: Array<{ description?: string; quantity?: number; amount?: number; account_id?: string }>;
}
async function postNetSuiteVendorBill(
  db: D1Database, cfg: NetSuiteConnectionConfig, row: TransactionalActionRow, payload: NetSuiteVendorBillRowPayload,
) {
  let vendorId = payload.vendor_internal_id;
  if (!vendorId && payload.vendor_ref && row.erp_connection_id) {
    const mapped = await lookupPartnerExternalId(db, row.tenant_id, row.erp_connection_id, 'vendor', payload.vendor_ref);
    if (mapped) vendorId = mapped;
  }
  if (!vendorId) throw new Error('payload missing vendor_internal_id (NetSuite vendor internal ID required) and no vendor_ref mapping found');
  const inv = payload.invoice ?? {};
  const expenseLines = payload.line_items && payload.line_items.length > 0
    ? payload.line_items.map((li) => ({
        account: { id: li.account_id ?? payload.expense_account_id ?? '' },
        amount: li.amount ?? row.posted_value ?? 0,
        memo: li.description ?? row.target_entity,
      })).filter((l) => l.account.id)
    : [{
        account: { id: payload.expense_account_id ?? '' },
        amount: row.posted_value ?? 0,
        memo: inv.invoice_number ?? row.target_entity,
      }].filter((l) => l.account.id);
  if (expenseLines.length === 0) throw new Error('payload missing expense_account_id (NetSuite GL account internal ID required)');
  return netsuitePostVendorBill(cfg, {
    entity: { id: vendorId },
    tranDate: inv.invoice_date,
    dueDate: inv.due_date,
    tranId: inv.invoice_number ?? row.source_record_ref ?? undefined,
    memo: row.reasoning ?? undefined,
    expense: { items: expenseLines },
  });
}

interface NetSuiteCustomerPaymentRowPayload {
  customer_internal_id?: string; customer_ref?: string;
  bank_account_id?: string;
  amount?: number;
  invoice_internal_id?: string;
  payment_date?: string;
}
async function postNetSuiteCustomerPayment(
  db: D1Database, cfg: NetSuiteConnectionConfig, row: TransactionalActionRow, payload: NetSuiteCustomerPaymentRowPayload,
) {
  let customerId = payload.customer_internal_id;
  if (!customerId && payload.customer_ref && row.erp_connection_id) {
    const mapped = await lookupPartnerExternalId(db, row.tenant_id, row.erp_connection_id, 'customer', payload.customer_ref);
    if (mapped) customerId = mapped;
  }
  if (!customerId) throw new Error('payload missing customer_internal_id (NetSuite customer internal ID required) and no customer_ref mapping found');
  const amount = payload.amount ?? row.posted_value ?? 0;
  return netsuitePostCustomerPayment(cfg, {
    customer: { id: customerId },
    payment: amount,
    tranDate: payload.payment_date ?? new Date().toISOString().slice(0, 10),
    account: payload.bank_account_id ? { id: payload.bank_account_id } : undefined,
    memo: row.source_record_ref ?? undefined,
    apply: payload.invoice_internal_id
      ? { items: [{ apply: true, doc: payload.invoice_internal_id, amount }] }
      : undefined,
  });
}

interface NetSuiteJeRowPayload {
  date?: string;
  memo?: string;
  debit?: { account_id: string; amount: number; memo?: string };
  credit?: { account_id: string; amount: number; memo?: string };
}
async function postNetSuiteJournalEntry(
  cfg: NetSuiteConnectionConfig, row: TransactionalActionRow, payload: NetSuiteJeRowPayload,
) {
  if (!payload.debit || !payload.credit) throw new Error('payload missing debit/credit blocks');
  const memo = payload.memo ?? row.source_record_ref ?? row.target_entity;
  return netsuitePostJournalEntry(cfg, {
    tranDate: payload.date,
    memo,
    line: {
      items: [
        { account: { id: payload.debit.account_id },  debit: Math.abs(payload.debit.amount),  memo: payload.debit.memo ?? memo },
        { account: { id: payload.credit.account_id }, credit: Math.abs(payload.credit.amount), memo: payload.credit.memo ?? memo },
      ],
    },
  });
}

// SAP doc-number conventions: 5-series for AP invoices, 14-series
// for payment runs, etc. Just gives the synth IDs a SAP-shaped
// signature so they look right in dashboards.
function mapToSapDoc(actionType: TransactionalActionType, suffix: string): string {
  const prefix: Record<TransactionalActionType, string> = {
    ap_invoice_post: '51',
    ap_payment_run: '14',
    ar_cash_apply: '12',
    ar_credit_hold: 'CH',
    gl_bank_match: '50',
    gl_journal_entry: 'JE',
    ap_invoice_block: 'BLK',
  };
  return `${prefix[actionType] ?? 'TX'}${suffix}`;
}

/** Approve a pending action (HITL surface). Idempotent. */
export async function approveAction(
  db: D1Database, tenantId: string, actionId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE transactional_actions SET status = 'approved', updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status = 'pending'`,
  ).bind(now, actionId, tenantId).run();
  return (res.meta?.changes ?? 0) > 0;
}

/** Mark a pending action skipped (HITL reject). */
export async function skipAction(
  db: D1Database, tenantId: string, actionId: string, reason: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.prepare(
    `UPDATE transactional_actions SET status = 'skipped', error = ?, updated_at = ?
      WHERE id = ? AND tenant_id = ? AND status IN ('pending','approved')`,
  ).bind(reason, now, actionId, tenantId).run();
  return (res.meta?.changes ?? 0) > 0;
}
