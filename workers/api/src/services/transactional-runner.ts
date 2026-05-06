/**
 * Transactional Runner — Phase 10-30.
 *
 * Single per-tenant entry point that:
 *   1. Runs each transactional subcatalyst in sequence (deterministic
 *      order — see ORDER notes below)
 *   2. Records a sub_catalyst_runs row per subcatalyst (so the existing
 *      Sub-Catalyst Ops dashboards light up automatically)
 *   3. Dispatches all 'approved' transactional_actions at the end
 *
 * Order rationale:
 *   - Duplicate blocker FIRST so duplicates never reach 3-way match
 *   - 3-way match SECOND so 'matched' invoices are available for...
 *   - Payment run THIRD (consumes matched invoices)
 *   - AR cash app FOURTH so receipts settle open invoices before...
 *   - AR credit hold FIFTH (uses post-receipt exposure)
 *   - GL bank recon LAST so it sees both AP payments + AR receipts
 *     posted in this tick
 *
 * The dispatch sweep at the end posts every staged 'approved' row.
 * 'pending' (HITL) rows wait for an approver via the admin route.
 *
 * Best-effort per step — one failure doesn't abort the rest. Each
 * subcatalyst's exception bubbles into the recorded run row but the
 * runner returns an aggregate summary.
 */

import { recordRun } from './sub-catalyst-ops';
import type { ExecutionResultRecord } from './sub-catalyst-ops';
import { logError, logInfo } from './logger';
import { executePendingActions } from './erp-writeback';
import {
  runApThreeWayMatch,
  runApDuplicateBlocker,
  runApPaymentRun,
  runArCashApplication,
  runArCreditHold,
  runGlBankReconciliation,
} from './transactional-subcatalysts';
import type { TransactionalRunSummary } from './transactional-subcatalysts';

export interface TransactionalRunnerResult {
  tenantId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  subcatalystSummaries: TransactionalRunSummary[];
  dispatch: { posted: number; failed: number; skipped: number };
}

/** Find or create a placeholder cluster_id for the action layer. The
 *  sub_catalyst_runs row requires a cluster reference; we use the
 *  tenant's first existing cluster, or create a 'transactional'
 *  cluster on the fly. */
async function ensureTransactionalCluster(
  db: D1Database, tenantId: string,
): Promise<string> {
  const existing = await db.prepare(
    `SELECT id FROM catalyst_clusters
      WHERE tenant_id = ? AND domain = 'transactional' LIMIT 1`,
  ).bind(tenantId).first<{ id: string }>();
  if (existing) return existing.id;

  // Fallback to any cluster, else create one
  const any = await db.prepare(
    `SELECT id FROM catalyst_clusters WHERE tenant_id = ? LIMIT 1`,
  ).bind(tenantId).first<{ id: string }>();
  if (any) return any.id;

  const id = `cluster-txn-${tenantId.slice(0, 8)}-${Date.now()}`;
  await db.prepare(
    `INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status)
     VALUES (?, ?, 'Transactional Action Layer', 'transactional', 'AP/AR/GL transactional automation', 'active')`,
  ).bind(id, tenantId).run();
  return id;
}

function summaryToExecutionResult(
  summary: TransactionalRunSummary,
  startedAtIso: string,
  durationMs: number,
  err: unknown,
): ExecutionResultRecord {
  const status = err ? 'failed' : 'completed';
  return {
    id: `txn-exec-${crypto.randomUUID()}`,
    sub_catalyst: summary.subCatalyst,
    cluster_id: '', // overridden by recordRun signature
    executed_at: startedAtIso,
    duration_ms: durationMs,
    status,
    mode: 'transactional',
    summary: {
      total_records_source: summary.processed,
      total_records_target: summary.autoPosted + summary.blocked,
      matched: summary.autoPosted,
      unmatched_source: summary.exceptions,
      unmatched_target: 0,
      discrepancies: summary.blocked,
    },
    error: err instanceof Error ? err.message : (err ? String(err) : undefined),
    reasoning: summary.reasoning.join(' | ') || undefined,
    recommendations: summary.reasoning.length > 0 ? summary.reasoning : undefined,
  };
}

async function runOne(
  db: D1Database, tenantId: string, clusterId: string,
  fn: () => Promise<TransactionalRunSummary>,
): Promise<TransactionalRunSummary> {
  const t0 = Date.now();
  const startedIso = new Date().toISOString();
  let summary: TransactionalRunSummary;
  let err: unknown;
  try {
    summary = await fn();
  } catch (e) {
    err = e;
    summary = {
      subCatalyst: 'unknown', processed: 0, autoPosted: 0, blocked: 0,
      exceptions: 0, totalValue: 0, reasoning: [`Failed: ${e instanceof Error ? e.message : String(e)}`],
    };
  }

  try {
    await recordRun(db, tenantId, clusterId, summary.subCatalyst,
      summaryToExecutionResult(summary, startedIso, Date.now() - t0, err),
      'schedule', { source: 'transactional-runner' });
  } catch (recErr) {
    logError('transactional_runner.record_run_failed', recErr,
      { tenantId, layer: 'erp_write', action: summary.subCatalyst }, {});
  }
  return summary;
}

/** Run the full transactional chain for one tenant. Best-effort per
 *  subcatalyst; never throws. */
export async function runTransactionalSubcatalystsForTenant(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunnerResult> {
  const startedAtIso = new Date().toISOString();
  const startMs = Date.now();
  const clusterId = await ensureTransactionalCluster(db, tenantId);

  const subcatalystSummaries: TransactionalRunSummary[] = [];

  // Order matters — see top-of-file rationale
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runApDuplicateBlocker(db, tenantId)));
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runApThreeWayMatch(db, tenantId)));
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runApPaymentRun(db, tenantId)));
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runArCashApplication(db, tenantId)));
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runArCreditHold(db, tenantId)));
  subcatalystSummaries.push(await runOne(db, tenantId, clusterId, () => runGlBankReconciliation(db, tenantId)));

  // Dispatch all approved staging rows
  let dispatch = { posted: 0, failed: 0, skipped: 0 };
  try {
    const res = await executePendingActions(db, tenantId);
    dispatch = { posted: res.posted, failed: res.failed, skipped: res.skipped };
  } catch (err) {
    logError('transactional_runner.dispatch_failed', err,
      { tenantId, layer: 'erp_write' }, {});
  }

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;

  logInfo('transactional_runner.completed',
    { tenantId, layer: 'erp_write', action: 'transactional_chain' },
    {
      duration_ms: durationMs,
      subcatalyst_count: subcatalystSummaries.length,
      dispatched_posted: dispatch.posted,
      dispatched_failed: dispatch.failed,
    });

  return {
    tenantId, startedAt: startedAtIso, completedAt, durationMs,
    subcatalystSummaries, dispatch,
  };
}
