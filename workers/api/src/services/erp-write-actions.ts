/**
 * ERP Write-Back Actions — Phase 7-1 of dynamic ERP intelligence.
 *
 * Up to now Atheon catalysts READ from ERPs and produced advisory
 * insights. This service is the foundation for catalysts to WRITE BACK
 * to the ERP — release a payment, send a dunning notice, post a
 * journal entry, create a PO from a recommendation — and actually
 * realise the savings the assessments have been quoting.
 *
 * Design constraints:
 *
 *   1. **Autonomy-tier gated.** Every action checks the catalyst's
 *      autonomy_tier. `read-only` blocks all writes. `assisted` queues
 *      for human approval (HITL). `transactional` executes after a
 *      single approval. `autonomous` executes immediately for
 *      pre-approved action types within thresholds.
 *
 *   2. **Dry-run preview before execute.** Every action supports a
 *      `previewOnly` flag — the adapter computes the request payload
 *      and projects the outcome WITHOUT calling the ERP. Customer can
 *      preview before approving.
 *
 *   3. **Idempotent.** Each action carries a client-generated
 *      idempotency key. Replays are no-ops; the dispatcher returns the
 *      original outcome.
 *
 *   4. **Audit-defensible.** Every action persists to `catalyst_actions`
 *      with input_data + output_data + approved_by + completed_at +
 *      attribution back to the source finding (so ROI attribution can
 *      mark "this saved $X via this automated action").
 *
 *   5. **Per-ERP adapter pattern.** A `CatalystWriteAdapter` interface
 *      lets each ERP implement its own write path. Phase 7-1 ships
 *      stubs that record the intended payload (testable, no real ERP
 *      sandbox needed); real API integration plugs in incrementally
 *      as customers reach the relevant tier.
 *
 * Action types (initial set — high-ROI, broadly applicable):
 *   - ar_dunning_send: send a dunning notice for an overdue AR record
 *   - ap_payment_release: release a payment for an approved AP invoice
 *   - po_create: create a PO from a sourcing recommendation
 *   - journal_post: post a journal entry (correction, accrual, reclass)
 *   - invoice_post: post a draft invoice to AUTHORISED status
 *   - customer_credit_update: adjust a customer's credit limit
 */

import { logError, logInfo } from './logger';

// ── Types ───────────────────────────────────────────────────────────────

export type ActionType =
  | 'ar_dunning_send'
  | 'ap_payment_release'
  | 'po_create'
  | 'journal_post'
  | 'invoice_post'
  | 'customer_credit_update';

export type ActionAutonomyTier = 'read-only' | 'assisted' | 'transactional' | 'autonomous';

export type ActionStatus =
  | 'pending_approval'
  | 'approved'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'rejected'
  | 'previewed';

/** Request payload — intentionally typed as `Record<string, unknown>` per
 *  action_type so adapter implementations can shape their own payload. */
export interface CatalystWriteAction {
  /** Stable, client-generated. Replays return the original outcome. */
  idempotency_key: string;
  type: ActionType;
  tenantId: string;
  connectionId: string;
  /** Catalyst that produced this action — feeds reasoning + audit. */
  catalystName: string;
  clusterId: string;
  /** Per-action_type payload — adapters cast and validate. */
  payload: Record<string, unknown>;
  /** Estimated value at stake (ZAR), for HITL prioritisation + ROI. */
  value_zar?: number;
  /** Optional finding the action resolves — drives ROI attribution. */
  source_finding_id?: string;
  /** When true, adapter computes payload + projection but does NOT call ERP. */
  previewOnly?: boolean;
  /** Reasoning string for the audit trail (why we chose this action). */
  reasoning?: string;
}

export interface ActionExecutionResult {
  ok: boolean;
  status: ActionStatus;
  /** ERP-side reference of the created/updated record (e.g. payment id). */
  erp_reference?: string;
  /** Human-readable summary of what happened (or would happen, for preview). */
  summary: string;
  /** Whatever the adapter wants to surface for audit / debugging. */
  details?: Record<string, unknown>;
  /** Set when the adapter rejected the action (validation, permission, …). */
  error?: string;
  /** Phase 8-2: 'live' = real vendor API call landed; 'stub' = recorded
   *  intent only (vendor adapter not yet wired or live_mode disabled);
   *  'preview' = explicit previewOnly request. UIs render a badge so the
   *  customer never confuses "completed (stub)" with "completed (live)". */
  mode?: 'live' | 'stub' | 'preview';
}

/** Per-ERP adapter contract. Vendor implementations are registered into
 *  the registry in `erp-write-adapters.ts`. */
export interface CatalystWriteAdapter {
  /** Vendor system name (matches erp_adapters.system / source_system). */
  vendor: string;
  /** Whether this adapter implements the action type. */
  supports(type: ActionType): boolean;
  /** Execute (or preview) the action. The dispatcher already verified
   *  autonomy + idempotency; this method does the ERP-side work. */
  execute(action: CatalystWriteAction, context: AdapterContext): Promise<ActionExecutionResult>;
}

/** Context passed to adapter implementations — credentials, db handle,
 *  whatever else the adapter needs. Kept narrow on purpose. */
export interface AdapterContext {
  db: D1Database;
  /** Decrypted credentials for the connection — adapter must not log. */
  credentials?: Record<string, unknown>;
  /** Adapter-system version label, for compatibility branching. */
  systemVersion?: string;
  /** Atheon ENCRYPTION_KEY — adapters need this to re-encrypt refreshed
   *  OAuth tokens. */
  encryptionKey?: string;
}

// ── Adapter registry ────────────────────────────────────────────────────

const adapters = new Map<string, CatalystWriteAdapter>();

export function registerWriteAdapter(adapter: CatalystWriteAdapter): void {
  adapters.set(adapter.vendor.toLowerCase(), adapter);
}

export function getWriteAdapter(vendor: string | null | undefined): CatalystWriteAdapter | null {
  if (!vendor) return null;
  return adapters.get(vendor.toLowerCase()) || null;
}

export function listRegisteredAdapters(): string[] {
  return [...adapters.keys()];
}

/** Test-only: clear registry. */
export function _resetAdaptersForTests(): void {
  adapters.clear();
}

// ── Autonomy-tier check ────────────────────────────────────────────────

/** Returns 'execute' to run immediately, 'queue' to require HITL approval,
 *  or 'block' to refuse the action entirely. */
export function checkAutonomy(
  tier: ActionAutonomyTier,
  action: CatalystWriteAction,
  thresholdZar = 50000,
): 'execute' | 'queue' | 'block' {
  if (tier === 'read-only') return 'block';
  if (tier === 'autonomous') {
    // Autonomous still queues high-value actions for safety.
    if ((action.value_zar || 0) > thresholdZar) return 'queue';
    return 'execute';
  }
  if (tier === 'transactional') {
    // Single approval gate — queue.
    return 'queue';
  }
  // assisted
  return 'queue';
}

// ── Idempotency ────────────────────────────────────────────────────────

interface ExistingActionRow {
  id: string;
  status: string;
  output_data: string | null;
}

/** Look up an existing action by idempotency_key (dedicated column populated
 *  by persistAction). Returns null if none. */
async function findIdempotent(
  db: D1Database, tenantId: string, key: string,
): Promise<ExistingActionRow | null> {
  try {
    const r = await db.prepare(
      `SELECT id, status, output_data FROM catalyst_actions
        WHERE tenant_id = ? AND idempotency_key = ?
        ORDER BY created_at DESC LIMIT 1`
    ).bind(tenantId, key).first<ExistingActionRow>();
    return r || null;
  } catch {
    return null;
  }
}

// ── Persistence ────────────────────────────────────────────────────────

async function persistAction(
  db: D1Database, action: CatalystWriteAction, status: ActionStatus, result?: ActionExecutionResult,
): Promise<string> {
  const id = crypto.randomUUID();
  // Record the action with the autonomy-aware status. Subsequent
  // approve/execute/reject paths update the same row.
  // The dedicated columns (action_type, value_zar, source_finding_id,
  // idempotency_key, connection_id) drive the approval queue + ROI
  // attribution joins; input_data still carries the full payload for
  // adapter replay.
  try {
    await db.prepare(
      `INSERT INTO catalyst_actions (
         id, cluster_id, tenant_id, catalyst_name, action, status,
         input_data, output_data, reasoning,
         action_type, value_zar, source_finding_id, idempotency_key, connection_id,
         created_at, completed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`
    ).bind(
      id, action.clusterId, action.tenantId, action.catalystName, action.type, status,
      JSON.stringify({ ...action }),
      result ? JSON.stringify(result) : null,
      action.reasoning || null,
      action.type, action.value_zar || null, action.source_finding_id || null,
      action.idempotency_key, action.connectionId,
      result && (status === 'completed' || status === 'failed' || status === 'rejected')
        ? new Date().toISOString() : null,
    ).run();
  } catch (err) {
    logError('erp.write_action.persist_failed', err, { tenantId: action.tenantId }, {
      type: action.type, idempotency_key: action.idempotency_key,
    });
  }
  return id;
}

async function updateActionStatus(
  db: D1Database, id: string, tenantId: string, status: ActionStatus,
  result?: ActionExecutionResult, approvedBy?: string,
): Promise<void> {
  try {
    await db.prepare(
      `UPDATE catalyst_actions SET status = ?, output_data = ?, approved_by = ?,
              completed_at = CASE WHEN ? IN ('completed', 'failed', 'rejected')
                                  THEN datetime('now')
                                  ELSE completed_at END
        WHERE id = ? AND tenant_id = ?`
    ).bind(status, result ? JSON.stringify(result) : null, approvedBy || null, status, id, tenantId).run();
  } catch (err) {
    logError('erp.write_action.update_failed', err, { tenantId }, { id, status });
  }
}

// ── Dispatcher (entry point catalyst handlers call) ────────────────────

export interface DispatchOutcome {
  /** Internal catalyst_actions row id. */
  action_id: string;
  status: ActionStatus;
  /** Adapter execution result (or projection for preview). */
  result?: ActionExecutionResult;
  /** When status='pending_approval', who needs to approve. */
  pending_approval?: { reason: string };
}

/**
 * Dispatch a write-back action. Honours autonomy tier, idempotency,
 * and persists outcome. Catalyst handlers call this rather than touching
 * adapters directly.
 */
export async function dispatchWriteAction(
  db: D1Database,
  vendor: string,
  tier: ActionAutonomyTier,
  action: CatalystWriteAction,
  adapterContext: AdapterContext,
): Promise<DispatchOutcome> {
  // 1. Idempotency
  const existing = await findIdempotent(db, action.tenantId, action.idempotency_key);
  if (existing) {
    let prior: ActionExecutionResult | undefined;
    try { prior = existing.output_data ? JSON.parse(existing.output_data) : undefined; } catch { /* ignore */ }
    return {
      action_id: existing.id,
      status: existing.status as ActionStatus,
      result: prior,
    };
  }

  // 2. Adapter resolution
  const adapter = getWriteAdapter(vendor);
  if (!adapter) {
    const id = await persistAction(db, action, 'failed', {
      ok: false, status: 'failed', summary: `No write adapter registered for vendor "${vendor}"`,
      error: 'no_adapter',
    });
    return { action_id: id, status: 'failed', result: { ok: false, status: 'failed', summary: 'No write adapter', error: 'no_adapter' } };
  }
  if (!adapter.supports(action.type)) {
    const id = await persistAction(db, action, 'failed', {
      ok: false, status: 'failed',
      summary: `Adapter ${adapter.vendor} does not support action type ${action.type}`,
      error: 'unsupported_action',
    });
    return { action_id: id, status: 'failed', result: { ok: false, status: 'failed', summary: 'Unsupported action', error: 'unsupported_action' } };
  }

  // 3. Preview path — always allowed regardless of autonomy
  if (action.previewOnly) {
    const result = await adapter.execute(action, adapterContext);
    const id = await persistAction(db, action, 'previewed', result);
    return { action_id: id, status: 'previewed', result };
  }

  // 4. Autonomy gate
  const decision = checkAutonomy(tier, action);
  if (decision === 'block') {
    const id = await persistAction(db, action, 'rejected', {
      ok: false, status: 'rejected',
      summary: `Tenant autonomy tier "${tier}" does not permit this action`,
      error: 'autonomy_blocked',
    });
    return { action_id: id, status: 'rejected' };
  }
  if (decision === 'queue') {
    const id = await persistAction(db, action, 'pending_approval');
    logInfo('erp.write_action.queued', { tenantId: action.tenantId, layer: 'erp', action: 'erp.write_action.queue' }, {
      action_id: id, type: action.type, vendor, value_zar: action.value_zar || 0,
    });
    return {
      action_id: id, status: 'pending_approval',
      pending_approval: { reason: tier === 'autonomous'
        ? `value ZAR ${action.value_zar} exceeds autonomous threshold; HITL approval required`
        : 'autonomy tier requires human approval' },
    };
  }

  // 5. Execute
  let result: ActionExecutionResult;
  try {
    result = await adapter.execute(action, adapterContext);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false, status: 'failed', summary: 'Adapter raised exception', error: message };
  }
  const id = await persistAction(db, action, result.ok ? 'completed' : 'failed', result);
  return { action_id: id, status: result.status, result };
}

// ── Approve / Reject path (called from API endpoints in Phase 7-2) ─────

export async function approveQueuedAction(
  db: D1Database,
  actionId: string,
  tenantId: string,
  approvedBy: string,
  vendor: string,
  adapterContext: AdapterContext,
): Promise<DispatchOutcome> {
  // Load the queued action
  const row = await db.prepare(
    `SELECT id, status, input_data FROM catalyst_actions WHERE id = ? AND tenant_id = ?`
  ).bind(actionId, tenantId).first<{ id: string; status: string; input_data: string }>();
  if (!row) return { action_id: actionId, status: 'failed', result: { ok: false, status: 'failed', summary: 'Action not found' } };
  if (row.status !== 'pending_approval') {
    return { action_id: actionId, status: row.status as ActionStatus, result: { ok: false, status: row.status as ActionStatus, summary: `Action is in status "${row.status}", cannot approve` } };
  }

  let action: CatalystWriteAction;
  try { action = JSON.parse(row.input_data) as CatalystWriteAction; }
  catch { return { action_id: actionId, status: 'failed', result: { ok: false, status: 'failed', summary: 'Stored action payload is corrupt' } }; }

  await updateActionStatus(db, actionId, tenantId, 'approved', undefined, approvedBy);

  const adapter = getWriteAdapter(vendor);
  if (!adapter || !adapter.supports(action.type)) {
    const result: ActionExecutionResult = { ok: false, status: 'failed', summary: `No adapter for ${vendor}/${action.type}`, error: 'no_adapter' };
    await updateActionStatus(db, actionId, tenantId, 'failed', result, approvedBy);
    return { action_id: actionId, status: 'failed', result };
  }

  let result: ActionExecutionResult;
  try { result = await adapter.execute(action, adapterContext); }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    result = { ok: false, status: 'failed', summary: 'Adapter raised exception', error: message };
  }
  await updateActionStatus(db, actionId, tenantId, result.ok ? 'completed' : 'failed', result, approvedBy);
  return { action_id: actionId, status: result.status, result };
}

export async function rejectQueuedAction(
  db: D1Database,
  actionId: string,
  tenantId: string,
  rejectedBy: string,
  reason?: string,
): Promise<{ ok: boolean; status: ActionStatus }> {
  await updateActionStatus(db, actionId, tenantId, 'rejected', {
    ok: false, status: 'rejected', summary: reason || 'Rejected by user',
  }, rejectedBy);
  return { ok: true, status: 'rejected' };
}
