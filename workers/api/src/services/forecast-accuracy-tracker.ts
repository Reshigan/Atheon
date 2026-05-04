/**
 * Forecast Accuracy Tracker — Phase 10-17.
 *
 * Closes the loop on Phase 10-11. When the Apex narrative emits
 * 30/60/90-day projections, we now persist each one to `kpi_forecasts`
 * with a target_date. On every cron tick, we look for predictions
 * whose target_date has elapsed and grade them against the actual
 * metric value at that date.
 *
 * Outcomes are fed into inference_calibration on the synthetic gate
 * 'kpi_forecasting.accuracy' so:
 *   - The forecast ranker can show calibration ("our 30-day Margin
 *     forecasts have been within 8% over the last quarter")
 *   - The auto-tuner could (future) prefer wider bands when accuracy
 *     is poor
 *
 * Strong-inference policy:
 *   - within_band = TRUE iff actual ∈ [predicted_lower, predicted_upper]
 *     This is the operative success criterion. The point estimate's
 *     abs_error_pct is recorded for explanation but doesn't drive the
 *     true_positive/false_positive label.
 *   - Don't grade against forecasts whose target_date hasn't elapsed
 *   - Idempotent: a forecast is graded once (evaluated_at NOT NULL ⇒ skip)
 */

import { logError, logInfo } from './logger';
import { recordOutcome } from './inference-calibration';
import type { ForecastPoint } from './kpi-forecasting';

// ── Recording (called from Apex narrative when forecasts are emitted) ──

interface ForecastRecord {
  metric_id: string;
  metric_name: string;
  horizon_days: number;
  predicted_value: number;
  predicted_lower: number;
  predicted_upper: number;
  r_squared: number;
  target_date: string; // ISO yyyy-mm-dd
}

function targetDateFor(horizonDays: number): string {
  const t = new Date();
  t.setUTCDate(t.getUTCDate() + horizonDays);
  return t.toISOString().slice(0, 10);
}

/** Persist a batch of forecasts for a metric. Called from generateApexNarrative
 *  per metric when forecasts are computed. Idempotent within the same
 *  generated_at timestamp + (metric_id, horizon_days) — we don't dedupe
 *  here because Apex narrative is daily-debounced upstream. */
export async function recordEmittedForecasts(
  db: D1Database, tenantId: string,
  metricId: string, metricName: string, forecasts: ForecastPoint[],
): Promise<number> {
  if (forecasts.length === 0) return 0;
  let count = 0;
  for (const f of forecasts) {
    const record: ForecastRecord = {
      metric_id: metricId,
      metric_name: metricName,
      horizon_days: f.horizon_days,
      predicted_value: f.value,
      predicted_lower: f.lower,
      predicted_upper: f.upper,
      r_squared: f.r_squared,
      target_date: targetDateFor(f.horizon_days),
    };
    try {
      await db.prepare(
        `INSERT INTO kpi_forecasts
           (id, tenant_id, metric_id, metric_name, horizon_days,
            predicted_value, predicted_lower, predicted_upper, r_squared,
            target_date, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), tenantId, record.metric_id, record.metric_name,
        record.horizon_days, record.predicted_value, record.predicted_lower,
        record.predicted_upper, record.r_squared, record.target_date,
      ).run();
      count++;
    } catch (err) {
      logError('forecast_accuracy.insert_failed', err, { tenantId },
        { metric_id: metricId, horizon_days: f.horizon_days });
    }
  }
  return count;
}

// ── Grading (called from scheduled per-tenant block) ──

interface PendingForecastRow {
  id: string;
  metric_id: string;
  metric_name: string;
  horizon_days: number;
  predicted_value: number;
  predicted_lower: number | null;
  predicted_upper: number | null;
  target_date: string;
}

interface MetricSampleRow {
  value: number;
  recorded_at: string;
}

async function loadPendingForecasts(
  db: D1Database, tenantId: string,
): Promise<PendingForecastRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, horizon_days, predicted_value,
              predicted_lower, predicted_upper, target_date
         FROM kpi_forecasts
        WHERE tenant_id = ?
          AND evaluated_at IS NULL
          AND target_date <= date('now')`
    ).bind(tenantId).all<PendingForecastRow>();
    return r.results || [];
  } catch (err) {
    logError('forecast_accuracy.load_pending_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadMetricSampleAtOrAfter(
  db: D1Database, tenantId: string, metricId: string, targetDate: string,
): Promise<MetricSampleRow | null> {
  try {
    return await db.prepare(
      `SELECT value, recorded_at FROM process_metric_history
        WHERE tenant_id = ? AND metric_id = ?
          AND date(recorded_at) >= ?
        ORDER BY recorded_at ASC LIMIT 1`
    ).bind(tenantId, metricId, targetDate).first<MetricSampleRow>();
  } catch {
    return null;
  }
}

/** Pure grader exposed for tests. */
export interface GradeResult {
  abs_error: number;
  abs_error_pct: number | null;
  within_band: boolean;
}
export function gradeForecast(
  predicted: number, lower: number | null, upper: number | null, actual: number,
): GradeResult {
  const abs_error = Math.abs(predicted - actual);
  const abs_error_pct = actual === 0 ? null : Number(((abs_error / Math.abs(actual)) * 100).toFixed(2));
  const within_band = lower != null && upper != null
    ? actual >= lower && actual <= upper
    : false;
  return { abs_error: Number(abs_error.toFixed(3)), abs_error_pct, within_band };
}

export interface ForecastGradeSweepResult {
  pendingForecasts: number;
  graded: number;
  skippedNoSample: number;
  withinBand: number;
}

/** Sweep elapsed forecasts, grade them against actuals, persist + record
 *  to inference_calibration. Idempotent — a forecast graded once stays
 *  graded (evaluated_at IS NOT NULL → skipped on next sweep). */
export async function sweepForecastAccuracy(
  db: D1Database, tenantId: string,
): Promise<ForecastGradeSweepResult> {
  const result: ForecastGradeSweepResult = {
    pendingForecasts: 0, graded: 0, skippedNoSample: 0, withinBand: 0,
  };

  const pending = await loadPendingForecasts(db, tenantId);
  result.pendingForecasts = pending.length;
  if (pending.length === 0) return result;

  for (const fc of pending) {
    const sample = await loadMetricSampleAtOrAfter(
      db, tenantId, fc.metric_id, fc.target_date,
    );
    if (!sample) {
      result.skippedNoSample++;
      continue;
    }
    const grade = gradeForecast(
      fc.predicted_value, fc.predicted_lower, fc.predicted_upper, sample.value,
    );
    try {
      await db.prepare(
        `UPDATE kpi_forecasts
            SET evaluated_at = datetime('now'),
                actual_value = ?,
                abs_error = ?,
                abs_error_pct = ?,
                within_band = ?
          WHERE id = ?`
      ).bind(
        sample.value, grade.abs_error, grade.abs_error_pct,
        grade.within_band ? 1 : 0, fc.id,
      ).run();
      result.graded++;
      if (grade.within_band) result.withinBand++;

      // Feed into inference_calibration on the forecasting gate.
      // Synthetic gate name not in the autotune registry — that's fine,
      // the calibration table stores it for audit/dashboard regardless.
      try {
        await recordOutcome({
          db, tenantId,
          // Cast: synthetic gate name; outside the typed GateName union
          // by design — autotuner ignores unknown gates.
          gate: 'kpi_forecasting.accuracy' as never,
          outcome: grade.within_band ? 'true_positive' : 'false_positive',
          source: 'auto_resolved',
          context: {
            forecast_id: fc.id,
            metric_id: fc.metric_id,
            metric_name: fc.metric_name,
            horizon_days: fc.horizon_days,
            predicted: fc.predicted_value,
            actual: sample.value,
            abs_error_pct: grade.abs_error_pct,
          },
        });
      } catch { /* calibration is best-effort */ }
    } catch (err) {
      logError('forecast_accuracy.grade_failed', err, { tenantId },
        { forecast_id: fc.id });
    }
  }

  if (result.graded > 0) {
    logInfo(
      'forecast_accuracy.sweep_completed',
      { tenantId, layer: 'analytics', action: 'forecast_accuracy' },
      { ...result },
    );
  }
  return result;
}

/** Aggregate accuracy stats for explainability — used by the
 *  customer ROI dashboard (Phase 10-23). */
export interface ForecastAccuracyStats {
  total_graded: number;
  within_band_rate: number | null;
  median_abs_error_pct: number | null;
  /** Per-horizon breakdown for the same fields. */
  by_horizon: Array<{
    horizon_days: number;
    graded: number;
    within_band_rate: number | null;
    median_abs_error_pct: number | null;
  }>;
}

export async function getForecastAccuracyStats(
  db: D1Database, tenantId: string, lookbackDays = 90,
): Promise<ForecastAccuracyStats> {
  try {
    const r = await db.prepare(
      `SELECT horizon_days, within_band, abs_error_pct
         FROM kpi_forecasts
        WHERE tenant_id = ? AND evaluated_at IS NOT NULL
          AND evaluated_at > datetime('now', ?)`
    ).bind(tenantId, `-${lookbackDays} days`).all<{
      horizon_days: number; within_band: number | null; abs_error_pct: number | null;
    }>();
    const rows = r.results || [];
    if (rows.length === 0) {
      return { total_graded: 0, within_band_rate: null, median_abs_error_pct: null, by_horizon: [] };
    }

    const summarise = (subset: typeof rows) => {
      const banded = subset.filter((x) => x.within_band !== null);
      const errs = subset.map((x) => x.abs_error_pct).filter((x): x is number => x != null).sort((a, b) => a - b);
      const median = errs.length === 0 ? null : Number(errs[Math.floor(errs.length / 2)].toFixed(2));
      const wbr = banded.length === 0 ? null
        : Number((banded.filter((x) => x.within_band === 1).length / banded.length).toFixed(3));
      return { graded: subset.length, within_band_rate: wbr, median_abs_error_pct: median };
    };

    const overall = summarise(rows);
    const horizons = Array.from(new Set(rows.map((r) => r.horizon_days))).sort((a, b) => a - b);
    const byHorizon = horizons.map((h) => ({
      horizon_days: h,
      ...summarise(rows.filter((r) => r.horizon_days === h)),
    }));
    return {
      total_graded: overall.graded,
      within_band_rate: overall.within_band_rate,
      median_abs_error_pct: overall.median_abs_error_pct,
      by_horizon: byHorizon,
    };
  } catch (err) {
    logError('forecast_accuracy.stats_failed', err, { tenantId }, {});
    return { total_graded: 0, within_band_rate: null, median_abs_error_pct: null, by_horizon: [] };
  }
}
