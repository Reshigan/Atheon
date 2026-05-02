/**
 * Inference Calibration — Phase 10-15.
 *
 * Phase 10's analytical gates (correlation thresholds, signal-delta
 * minimums, debounce windows, etc.) are set by hand. This module
 * starts the loop that lets us *observe* whether those gates are
 * producing real signal or noise per tenant per gate, so a future PR
 * can auto-tune thresholds based on outcomes.
 *
 * What gets recorded:
 *   - true_positive: an inference (e.g. signal→KPI attribution) was
 *     made AND the implied outcome materialised. Initial wiring:
 *     when an RCA closes via metric recovery, every L1 driver of that
 *     RCA gets a true_positive on its source gate.
 *   - false_positive: user explicitly rejected the inference. Wired
 *     later via a /feedback endpoint (out of scope for this PR — we
 *     ship the recorder and reader so the wiring is ready).
 *   - true_negative: a gate suppressed an attribution and the metric
 *     stayed stable. Optional, future PR.
 *
 * The reader (getCalibrationStats) summarises the outcome distribution
 * per gate per tenant over a window, and exposes a recommended-
 * adjustment direction (loosen | tighten | hold) based on the ratio.
 *
 * Strong-inference policy: never auto-apply tuning until the sample
 * is large enough (≥ MIN_SAMPLE_SIZE = 25) — matches the project's
 * inference-strength memory ("sample size ≥ 25, mode share ≥ 70%").
 * This PR is observability only; tuning is opt-in for the next PR.
 */

import { logError } from './logger';

const MIN_SAMPLE_SIZE = 25;
const TIGHTEN_FALSE_POS_RATE = 0.3;   // > 30% false positives → tighten
const LOOSEN_FALSE_NEG_RATE = 0.5;    // > 50% missed → loosen

export type CalibrationOutcome =
  | 'true_positive' | 'false_positive'
  | 'true_negative' | 'false_negative';

export type CalibrationSource = 'auto_resolved' | 'auto_rejected' | 'user_feedback';

/** Stable identifiers for the gates we currently expose. Add to this
 *  union as new gates land — keeps the per-gate analytics typed. */
export type GateName =
  | 'signal_attribution.min_correlation'
  | 'signal_attribution.min_signal_delta_pct'
  | 'metric_correlation.min_correlation'
  | 'cross_rca.min_causal_factors'
  | 'rca_closure.min_recovery_samples';

export interface CalibrationStats {
  gate: GateName;
  total: number;
  true_positives: number;
  false_positives: number;
  true_negatives: number;
  false_negatives: number;
  /** Ratio false_positives / (true_positives + false_positives). Null
   *  when the denominator is zero. */
  false_positive_rate: number | null;
  /** Ratio false_negatives / (true_negatives + false_negatives). */
  false_negative_rate: number | null;
  /** Recommendation for the gate threshold:
   *    'tighten' when false-positive rate is high (gate too loose)
   *    'loosen' when false-negative rate is high (gate too tight)
   *    'hold' when sample is too small or rates are within bounds */
  recommendation: 'tighten' | 'loosen' | 'hold';
}

// ── Recording ──────────────────────────────────────────────────────────

export async function recordOutcome(opts: {
  db: D1Database;
  tenantId: string;
  gate: GateName;
  outcome: CalibrationOutcome;
  source: CalibrationSource;
  context?: Record<string, unknown>;
}): Promise<boolean> {
  try {
    await opts.db.prepare(
      `INSERT INTO inference_calibration
         (id, tenant_id, gate_name, outcome, source, context, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), opts.tenantId, opts.gate, opts.outcome, opts.source,
      JSON.stringify(opts.context ?? {}),
    ).run();
    return true;
  } catch (err) {
    logError('inference_calibration.record_failed', err, { tenantId: opts.tenantId },
      { gate: opts.gate, outcome: opts.outcome });
    return false;
  }
}

// ── Reading ────────────────────────────────────────────────────────────

interface OutcomeRow { outcome: string; n: number }

function recommendationFromRates(
  total: number,
  fpRate: number | null,
  fnRate: number | null,
): CalibrationStats['recommendation'] {
  if (total < MIN_SAMPLE_SIZE) return 'hold';
  if (fpRate != null && fpRate > TIGHTEN_FALSE_POS_RATE) return 'tighten';
  if (fnRate != null && fnRate > LOOSEN_FALSE_NEG_RATE) return 'loosen';
  return 'hold';
}

/** Pure helper exposed for tests + reuse. */
export function statsFromCounts(opts: {
  gate: GateName; tp: number; fp: number; tn: number; fn: number;
}): CalibrationStats {
  const total = opts.tp + opts.fp + opts.tn + opts.fn;
  const fpDen = opts.tp + opts.fp;
  const fnDen = opts.tn + opts.fn;
  const fpRate = fpDen > 0 ? opts.fp / fpDen : null;
  const fnRate = fnDen > 0 ? opts.fn / fnDen : null;
  return {
    gate: opts.gate,
    total,
    true_positives: opts.tp,
    false_positives: opts.fp,
    true_negatives: opts.tn,
    false_negatives: opts.fn,
    false_positive_rate: fpRate != null ? Number(fpRate.toFixed(3)) : null,
    false_negative_rate: fnRate != null ? Number(fnRate.toFixed(3)) : null,
    recommendation: recommendationFromRates(total, fpRate, fnRate),
  };
}

export async function getCalibrationStats(
  db: D1Database, tenantId: string, gate: GateName, lookbackDays = 90,
): Promise<CalibrationStats> {
  const empty = statsFromCounts({ gate, tp: 0, fp: 0, tn: 0, fn: 0 });
  try {
    const r = await db.prepare(
      `SELECT outcome, COUNT(*) as n FROM inference_calibration
        WHERE tenant_id = ? AND gate_name = ?
          AND recorded_at > datetime('now', ?)
        GROUP BY outcome`
    ).bind(tenantId, gate, `-${lookbackDays} days`).all<OutcomeRow>();
    const counts = { tp: 0, fp: 0, tn: 0, fn: 0 };
    for (const row of r.results || []) {
      if (row.outcome === 'true_positive') counts.tp = row.n;
      else if (row.outcome === 'false_positive') counts.fp = row.n;
      else if (row.outcome === 'true_negative') counts.tn = row.n;
      else if (row.outcome === 'false_negative') counts.fn = row.n;
    }
    return statsFromCounts({ gate, ...counts });
  } catch (err) {
    logError('inference_calibration.stats_failed', err, { tenantId }, { gate });
    return empty;
  }
}

/** Convenience: stats for ALL gates a tenant has activity on. */
export async function getAllCalibrationStats(
  db: D1Database, tenantId: string, lookbackDays = 90,
): Promise<CalibrationStats[]> {
  const gates: GateName[] = [
    'signal_attribution.min_correlation',
    'signal_attribution.min_signal_delta_pct',
    'metric_correlation.min_correlation',
    'cross_rca.min_causal_factors',
    'rca_closure.min_recovery_samples',
  ];
  return Promise.all(gates.map((g) => getCalibrationStats(db, tenantId, g, lookbackDays)));
}
