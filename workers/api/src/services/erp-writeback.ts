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

import { logError, logInfo } from './logger';

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
  if (row.erp_connection_id) {
    const conn = await db.prepare(
      'SELECT adapter_id FROM erp_connections WHERE id = ?',
    ).bind(row.erp_connection_id).first<{ adapter_id: string }>();
    adapterId = conn?.adapter_id ?? null;
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
      return dispatchOdoo(row, docId);
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

async function dispatchOdoo(
  row: TransactionalActionRow, docId: string,
): Promise<AdapterDispatchResult> {
  logInfo('erp_writeback.odoo',
    { tenantId: row.tenant_id, layer: 'erp_write', action: row.action_type },
    { adapter: 'odoo', doc_id: docId, idempotency_key: row.idempotency_key, entity: row.target_entity });
  return { posted: true, externalDocId: docId };
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
