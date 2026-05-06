/**
 * Phase-10 Analytics Runner — Phase 10-21.
 *
 * Single entry point that runs the full Phase 10 analytical chain for
 * one tenant. Extracted from scheduled.ts so:
 *
 *   1. The cron tick can call it inline (current default), OR
 *   2. The queue consumer can call it on a per-tenant analytics_sweep
 *      message — enabling parallel processing across many worker
 *      invocations
 *
 * Each sweep is wrapped in best-effort try/catch so one failure
 * doesn't abort the rest of the chain. Order matters: each sweep can
 * depend on data the previous one produced (e.g. RCA closure reads
 * RCAs that the synthesizer just created).
 */

import { logError, logInfo } from './logger';
import { detectMetricCorrelations } from './metric-correlation-engine';
import { attributeSignalsToKpis } from './signal-kpi-attribution';
import { synthesizeCrossCatalystRca } from './cross-catalyst-rca-synthesizer';
import { generateApexNarrative, closeRecoveredRcas } from './apex-narrative-engine';
import { sweepCompetitorIntel } from './competitor-intel-source';
import { sweepRegulatoryFeeds } from './regulatory-feed';
import { autotuneThresholds } from './threshold-autotune';
import { sweepForecastAccuracy } from './forecast-accuracy-tracker';
import { runTransactionalSubcatalystsForTenant } from './transactional-runner';

export interface Phase10RunResult {
  tenantId: string;
  startedAt: string;
  completedAt: string;
  durationMs: number;
  steps: Array<{ name: string; ok: boolean; durationMs: number; error?: string }>;
}

async function runStep<T>(
  name: string, fn: () => Promise<T>, results: Phase10RunResult['steps'],
  tenantId: string,
): Promise<void> {
  const start = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, durationMs: Date.now() - start });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    results.push({ name, ok: false, durationMs: Date.now() - start, error: msg });
    logError(`phase_10.${name}.failed`, err, { tenantId }, {});
  }
}

/** Run the Phase 10 analytical chain for a single tenant. Best-effort
 *  per step; never throws. Returns a structured result for telemetry.
 *
 *  encryptionKey forwards env ENCRYPTION_KEY into the transactional
 *  subcatalysts step so adapters can decrypt erp_connections.encrypted_config
 *  at dispatch time. */
export async function runPhase10ChainForTenant(
  db: D1Database, tenantId: string, opts: { encryptionKey?: string } = {},
): Promise<Phase10RunResult> {
  const startedAtIso = new Date().toISOString();
  const startMs = Date.now();
  const steps: Phase10RunResult['steps'] = [];

  // Order matters — each step can read what previous steps wrote
  await runStep('metric_correlation', () => detectMetricCorrelations(db, tenantId), steps, tenantId);
  await runStep('signal_attribution', () => attributeSignalsToKpis(db, tenantId), steps, tenantId);
  await runStep('cross_rca_synthesis', () => synthesizeCrossCatalystRca(db, tenantId), steps, tenantId);
  await runStep('rca_closure', () => closeRecoveredRcas(db, tenantId), steps, tenantId);
  await runStep('apex_narrative', () => generateApexNarrative(db, tenantId), steps, tenantId);
  await runStep('competitor_intel', () => sweepCompetitorIntel(db, tenantId, {}), steps, tenantId);
  await runStep('regulatory_feed', () => sweepRegulatoryFeeds(db, tenantId, {}), steps, tenantId);
  await runStep('threshold_autotune', () => autotuneThresholds(db, tenantId), steps, tenantId);
  await runStep('forecast_accuracy', () => sweepForecastAccuracy(db, tenantId), steps, tenantId);
  // Phase 10-30 — transactional action layer (AP/AR/GL automation)
  await runStep('transactional_subcatalysts', () => runTransactionalSubcatalystsForTenant(db, tenantId, { encryptionKey: opts.encryptionKey }), steps, tenantId);

  const completedAt = new Date().toISOString();
  const durationMs = Date.now() - startMs;
  const result: Phase10RunResult = {
    tenantId,
    startedAt: startedAtIso,
    completedAt,
    durationMs,
    steps,
  };

  const failedCount = steps.filter((s) => !s.ok).length;
  logInfo('phase_10.chain_completed',
    { tenantId, layer: 'analytics', action: 'phase_10_chain' },
    { duration_ms: durationMs, steps: steps.length, failed: failedCount });

  return result;
}
