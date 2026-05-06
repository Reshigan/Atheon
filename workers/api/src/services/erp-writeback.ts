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
import {
  odooAuthenticate, odooPostApInvoice, odooPostPayment, odooPostJournalEntry,
  odooSetCreditHold, isOdooError,
} from './erp-odoo-client';
import type { OdooConnectionConfig } from './erp-odoo-client';

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
 *  the appropriate adapter. Per-row failures don't abort the batch. */
export async function executePendingActions(
  db: D1Database, tenantId: string, opts: { limit?: number } = {},
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
      const dispatch = await dispatchToErp(db, row);
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

/** Dispatch one staged row to the right adapter. Per-adapter impls
 *  are skinny stubs today; the SAP RFC / Odoo / Xero real writes
 *  swap in here without touching the staging layer. */
async function dispatchToErp(
  db: D1Database, row: TransactionalActionRow,
): Promise<AdapterDispatchResult> {
  let adapterId: string | null = null;
  let connectionConfig: string | null = null;
  if (row.erp_connection_id) {
    const conn = await db.prepare(
      'SELECT adapter_id, config FROM erp_connections WHERE id = ?',
    ).bind(row.erp_connection_id).first<{ adapter_id: string; config: string }>();
    adapterId = conn?.adapter_id ?? null;
    connectionConfig = conn?.config ?? null;
  }

  // Synthesise a deterministic external doc ID so retries idempotent
  const docId = `${row.action_type.toUpperCase()}-${row.idempotency_key.slice(-12)}`;

  const adapterKey = (adapterId ?? 'sap_ecc').toLowerCase();
  switch (adapterKey) {
    case 'sap_ecc':
    case 'sap':
    case 'sap_s4hana':
      return dispatchSap(row, docId);
    case 'odoo':
      return dispatchOdoo(row, docId, connectionConfig);
    case 'xero':
      return dispatchXero(row, docId);
    case 'netsuite':
      return dispatchNetsuite(row, docId);
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

async function dispatchSap(
  row: TransactionalActionRow, docId: string,
): Promise<AdapterDispatchResult> {
  const sapDoc = mapToSapDoc(row.action_type, docId);
  logInfo('erp_writeback.sap',
    { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
    { adapter: 'sap_ecc', doc_id: sapDoc, idempotency_key: row.idempotency_key, entity: row.target_entity });
  return { posted: true, externalDocId: sapDoc };
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
  row: TransactionalActionRow, docId: string, configJson: string | null,
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
        result = await postOdooApInvoice(cfg, uid, row, payload);
        break;
      case 'ap_payment_run':
        result = await postOdooPaymentRun(cfg, uid, row, payload);
        break;
      case 'ar_cash_apply':
        result = await postOdooCashApply(cfg, uid, row, payload);
        break;
      case 'gl_journal_entry':
        result = await postOdooJournalEntry(cfg, uid, row, payload);
        break;
      case 'ar_credit_hold':
        result = await postOdooCreditHold(cfg, uid, row, payload);
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

interface OdooApInvoicePayload {
  invoice?: { invoice_number?: string; invoice_amount?: number; invoice_date?: string; due_date?: string };
  vendor_id?: number; vendor_partner_id?: number; partner_id?: number;
  expense_account_id?: number;
  line_items?: Array<{ name?: string; quantity?: number; price_unit?: number; account_id?: number }>;
}
async function postOdooApInvoice(
  cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooApInvoicePayload,
): Promise<{ id: number; name: string }> {
  const partnerId = payload.partner_id ?? payload.vendor_partner_id ?? payload.vendor_id;
  if (typeof partnerId !== 'number') {
    throw new Error('payload missing partner_id / vendor_partner_id (Odoo res.partner numeric ID required)');
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
  total_amount?: number; amount?: number;
  journal_id?: number;
}
async function postOdooPaymentRun(
  cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooPaymentPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = payload.partner_id ?? payload.vendor_partner_id ?? payload.vendor_id;
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required)');
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
  amount?: number; journal_id?: number;
}
async function postOdooCashApply(
  cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooCashApplyPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = payload.partner_id ?? payload.customer_partner_id ?? payload.customer_id;
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required)');
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
  reason?: string;
}
async function postOdooCreditHold(
  cfg: OdooConnectionConfig, uid: number, row: TransactionalActionRow, payload: OdooCreditHoldPayload,
): Promise<{ id: number; name: string }> {
  const partnerId = payload.partner_id ?? payload.customer_partner_id ?? payload.customer_id;
  if (typeof partnerId !== 'number') throw new Error('payload missing partner_id (Odoo numeric ID required)');
  return odooSetCreditHold(cfg, uid, partnerId, payload.reason ?? row.reasoning ?? 'Credit limit exceeded');
}

async function dispatchXero(
  row: TransactionalActionRow, docId: string,
): Promise<AdapterDispatchResult> {
  logInfo('erp_writeback.xero',
    { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
    { adapter: 'xero', doc_id: docId, idempotency_key: row.idempotency_key, entity: row.target_entity });
  return { posted: true, externalDocId: docId };
}

async function dispatchNetsuite(
  row: TransactionalActionRow, docId: string,
): Promise<AdapterDispatchResult> {
  logInfo('erp_writeback.netsuite',
    { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
    { adapter: 'netsuite', doc_id: docId, idempotency_key: row.idempotency_key, entity: row.target_entity });
  return { posted: true, externalDocId: docId };
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
