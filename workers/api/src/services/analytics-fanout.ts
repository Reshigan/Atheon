/**
 * Analytics Sweep Fan-Out — Phase 10-21.
 *
 * The Phase 10 per-tenant analytical sweeps (correlation, attribution,
 * RCA synthesis, narrative, closure, forecasting, etc.) currently run
 * SERIALLY inside handleScheduled. At 100+ tenants × ~17 sweeps each,
 * the 30-minute Workers cron deadline becomes a real risk.
 *
 * This module provides a queue-based fan-out path. The cron tick
 * decides at runtime:
 *   - When CATALYST_QUEUE is bound → enqueue one analytics_sweep
 *     message per tenant; the queue consumer (handleQueueMessage)
 *     processes them in parallel across many worker invocations
 *   - When CATALYST_QUEUE is NOT bound → run inline (backwards
 *     compatible — single-tenant dev, on-prem deployments without a
 *     queue, tests)
 *
 * Why a separate message type from the existing 'catalyst_execution':
 * analytical sweeps are tenant-wide (no specific catalyst/cluster),
 * idempotent (best-effort, dedupe + debounce inside each sweep), and
 * cheap individually. The catalyst_execution type carries
 * cluster_id/catalystName/action — semantically different.
 *
 * Strong-inference policy: queue is OPTIONAL. If sending fails for any
 * tenant, we DON'T fall back to inline (would defeat the rate-limit
 * benefit) — we log + skip + let the next cron tick try again.
 * Idempotency in each sweep ensures no data is lost across retries.
 */

import { logError, logInfo } from './logger';
import type { CatalystQueueMessage } from './scheduled';

export type AnalyticsSweepKind =
  | 'all'                     // run the full Phase-10 chain for the tenant
  | 'metric_correlation'      // just Phase 10-1
  | 'signal_attribution'      // just Phase 10-3
  | 'cross_rca'               // just Phase 10-4
  | 'narrative_and_closure'   // 10-5 closure + narrative
  | 'competitor_intel'        // 10-8
  | 'regulatory_feed'         // 10-12
  | 'autotune_and_forecast';  // 10-16 + 10-17

export interface AnalyticsSweepPayload {
  kind: AnalyticsSweepKind;
  /** Optional: pin a specific metric / signal for diagnostic re-runs. */
  scope?: { metricId?: string; signalId?: string };
}

export interface FanOutResult {
  enqueued: number;
  failed: number;
  inline: number;
}

/** Enqueue one analytics_sweep message per tenant. Returns counts. */
export async function enqueueAnalyticsSweeps(
  queue: { send: (msg: CatalystQueueMessage) => Promise<void> } | undefined,
  tenants: ReadonlyArray<{ id: string }>,
  kind: AnalyticsSweepKind = 'all',
): Promise<FanOutResult> {
  const result: FanOutResult = { enqueued: 0, failed: 0, inline: 0 };
  if (!queue) {
    // Caller will fall back to inline — count and return.
    result.inline = tenants.length;
    return result;
  }
  const now = new Date().toISOString();
  for (const t of tenants) {
    try {
      const payload: AnalyticsSweepPayload = { kind };
      await queue.send({
        type: 'analytics_sweep' as CatalystQueueMessage['type'],
        tenantId: t.id,
        payload: payload as unknown as Record<string, unknown>,
        scheduledAt: now,
      });
      result.enqueued++;
    } catch (err) {
      logError('analytics_fanout.enqueue_failed', err, { tenantId: t.id }, { kind });
      result.failed++;
    }
  }
  if (result.enqueued > 0) {
    logInfo(
      'analytics_fanout.enqueued',
      { tenantId: 'global', layer: 'scheduler', action: 'fanout' },
      { ...result, kind },
    );
  }
  return result;
}

/** Should the cron tick fan out via queue, or process inline? */
export function shouldFanOut(
  env: { CATALYST_QUEUE?: { send: (msg: CatalystQueueMessage) => Promise<void> } },
  tenantCount: number,
): boolean {
  // Queue must be bound AND we have enough tenants to make fan-out
  // worth the per-message overhead. Below the threshold, inline is
  // strictly faster (no queue serialization round-trip).
  const FANOUT_MIN_TENANTS = 5;
  return !!env.CATALYST_QUEUE && tenantCount >= FANOUT_MIN_TENANTS;
}
