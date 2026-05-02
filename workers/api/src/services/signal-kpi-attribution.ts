/**
 * Signal → KPI Attribution — Phase 10-3.
 *
 * Joins external signals (Phase 10-2) to internal KPI movements and
 * attributes the internal delta to the external driver. This is what
 * lets Apex eventually say:
 *   "Brent +22% MoM is driving our procurement input costs +6%"
 * instead of
 *   "Brent moved" + (separately) "procurement costs moved".
 *
 * Method:
 *  1. Pull each tenant's external_signals with history (Phase 10-2 stores
 *     30 days of daily values in raw_data.history).
 *  2. Pull each tenant's process_metrics with history (≥14 days).
 *  3. For each (signal, metric) pair, align the daily series and
 *     compute Pearson r using lags 0..LAG_DAYS_MAX days. Pick the lag
 *     with the strongest |r|.
 *  4. Persist a signal_impacts row when:
 *      - |r| ≥ MIN_CORRELATION
 *      - The signal moved by at least MIN_SIGNAL_DELTA_PCT over the
 *        history window (otherwise we're not attributing real movement)
 *      - This (signal, metric) pair was not attributed within DEBOUNCE_DAYS.
 *
 * Strong-inference gates:
 *  - ≥ 10 paired observations after lag-shift.
 *  - |r| ≥ 0.6 (a touch looser than 10-1's 0.7 because macro signals
 *    are noisier; still well above chance for n≥10).
 *  - |signal_delta_pct| ≥ 5%.
 *  - Per-pair debounce 7 days (signals move slowly; we don't want to
 *    re-attribute a stable relationship every cron tick).
 */

import { logError, logInfo } from './logger';
import { pearson } from './metric-correlation-engine';
import {
  canonicaliseDimension,
  classifyImpactDirection as classifyImpactDirectionByDirection,
  resolveKpiDirection,
} from './kpi-classification';

const MIN_PAIRED_OBSERVATIONS = 10;
const MIN_CORRELATION = 0.6;
const MIN_SIGNAL_DELTA_PCT = 5;
const LAG_DAYS_MAX = 7;
const DEBOUNCE_DAYS = 7;

// ── Types ──────────────────────────────────────────────────────────────

interface SignalRow {
  id: string;
  category: string;
  source_name: string;
  title: string;
  raw_data: string;
}

interface MetricRow {
  id: string;
  name: string;
  domain: string | null;
  threshold_red: number | null;
  threshold_amber: number | null;
  threshold_green: number | null;
}

interface DailyPoint { date: string; value: number }

interface AttributionInput {
  signal: SignalRow;
  metric: MetricRow;
  signalSeries: DailyPoint[];
  metricSeries: DailyPoint[];
}

export interface AttributionDecision {
  /** Best Pearson r found across the lag sweep. */
  correlation: number;
  /** Lag (days) at which the best correlation occurred — signal leads metric. */
  bestLagDays: number;
  /** % change of the signal over the window. */
  signalDeltaPct: number;
  /** % change of the metric over the window. */
  metricDeltaPct: number;
  /** Number of paired observations after lag alignment. */
  observations: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Pull `history` array from external_signals.raw_data. */
function parseSignalHistory(rawData: string | null): DailyPoint[] {
  if (!rawData) return [];
  try {
    const parsed = JSON.parse(rawData) as { history?: DailyPoint[] };
    if (!Array.isArray(parsed.history)) return [];
    return parsed.history
      .filter((h) => h && typeof h.date === 'string' && typeof h.value === 'number')
      .sort((a, b) => a.date.localeCompare(b.date));
  } catch {
    return [];
  }
}

/** Convert process_metric_history rows into daily points (one mean per day). */
export function bucketMetricDaily(
  rows: Array<{ value: number; recorded_at: string }>,
): DailyPoint[] {
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const r of rows) {
    const date = new Date(r.recorded_at).toISOString().slice(0, 10);
    const prev = buckets.get(date);
    if (prev) { prev.sum += r.value; prev.count++; }
    else buckets.set(date, { sum: r.value, count: 1 });
  }
  return [...buckets.entries()]
    .map(([date, { sum, count }]) => ({ date, value: sum / count }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/** Lag-shift: signal at day D matched against metric at day D+lag. */
function alignWithLag(
  signal: DailyPoint[], metric: DailyPoint[], lagDays: number,
): { xs: number[]; ys: number[] } {
  const sMap = new Map(signal.map((p) => [p.date, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const mPt of metric) {
    const mDate = new Date(mPt.date);
    const sDate = new Date(mDate.getTime() - lagDays * 86400 * 1000);
    const sKey = sDate.toISOString().slice(0, 10);
    const sVal = sMap.get(sKey);
    if (sVal !== undefined) {
      xs.push(sVal);
      ys.push(mPt.value);
    }
  }
  return { xs, ys };
}

function pctChange(series: DailyPoint[]): number {
  if (series.length < 2) return 0;
  const first = series[0].value;
  const last = series[series.length - 1].value;
  if (first === 0) return 0;
  return ((last - first) / Math.abs(first)) * 100;
}

/** Run the lag sweep and pick the best correlation. */
export function decideAttribution(input: AttributionInput): AttributionDecision | null {
  let best: AttributionDecision | null = null;
  for (let lag = 0; lag <= LAG_DAYS_MAX; lag++) {
    const { xs, ys } = alignWithLag(input.signalSeries, input.metricSeries, lag);
    if (xs.length < MIN_PAIRED_OBSERVATIONS) continue;
    const r = pearson(xs, ys);
    if (r === null) continue;
    if (!best || Math.abs(r) > Math.abs(best.correlation)) {
      best = {
        correlation: r,
        bestLagDays: lag,
        observations: xs.length,
        signalDeltaPct: pctChange(input.signalSeries),
        metricDeltaPct: pctChange(input.metricSeries),
      };
    }
  }
  if (!best) return null;
  if (Math.abs(best.correlation) < MIN_CORRELATION) return null;
  if (Math.abs(best.signalDeltaPct) < MIN_SIGNAL_DELTA_PCT) return null;
  return best;
}

// ── Persistence ────────────────────────────────────────────────────────

async function recentlyAttributed(
  db: D1Database, tenantId: string, signalId: string, metricName: string,
): Promise<boolean> {
  try {
    const r = await db.prepare(
      `SELECT 1 FROM signal_impacts
        WHERE tenant_id = ? AND signal_id = ?
          AND analysis LIKE ?
          AND computed_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, signalId, `%"metric_name":"${metricName}"%`, `-${DEBOUNCE_DAYS} days`).first();
    return r !== null;
  } catch {
    return false;
  }
}

/** Magnitude on the schema's INTEGER 1-5 scale. */
function classifyMagnitude(decision: AttributionDecision): number {
  const m = Math.round(Math.abs(decision.correlation) * 5);
  return Math.max(1, Math.min(5, m));
}

async function persistAttribution(
  db: D1Database, tenantId: string,
  signal: SignalRow, metric: MetricRow, decision: AttributionDecision,
): Promise<boolean> {
  const dimension = canonicaliseDimension(metric.domain);
  const kpiDirection = await resolveKpiDirection(db, tenantId, metric.name, {
    red: metric.threshold_red,
    amber: metric.threshold_amber,
    green: metric.threshold_green,
  }, metric.domain);
  const direction = classifyImpactDirectionByDirection(
    decision.metricDeltaPct, kpiDirection,
  );
  const magnitude = classifyMagnitude(decision);
  const analysis = {
    metric_id: metric.id,
    metric_name: metric.name,
    metric_domain: metric.domain,
    kpi_direction: kpiDirection,
    signal_title: signal.title,
    signal_source: signal.source_name,
    correlation: Number(decision.correlation.toFixed(3)),
    best_lag_days: decision.bestLagDays,
    observations: decision.observations,
    signal_delta_pct: Number(decision.signalDeltaPct.toFixed(2)),
    metric_delta_pct: Number(decision.metricDeltaPct.toFixed(2)),
    method: 'pearson_lag_sweep',
  };
  try {
    await db.prepare(
      `INSERT INTO signal_impacts
         (id, tenant_id, signal_id, health_dimension, impact_magnitude,
          impact_direction, impact_timeline, confidence, analysis, computed_at)
       VALUES (?, ?, ?, ?, ?, ?, 'near-term', ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId, signal.id, dimension, magnitude,
      direction, Math.abs(decision.correlation),
      JSON.stringify(analysis),
    ).run();
    return true;
  } catch (err) {
    logError('signal_attribution.persist_failed', err, { tenantId }, {
      signal_id: signal.id, metric_id: metric.id,
    });
    return false;
  }
}

// ── Main entry ─────────────────────────────────────────────────────────

export interface AttributionSweepResult {
  signalsScanned: number;
  metricsScanned: number;
  pairsEvaluated: number;
  attributionsDetected: number;
  attributionsPersisted: number;
  skippedDebounced: number;
}

export async function attributeSignalsToKpis(
  db: D1Database, tenantId: string,
): Promise<AttributionSweepResult> {
  const result: AttributionSweepResult = {
    signalsScanned: 0, metricsScanned: 0, pairsEvaluated: 0,
    attributionsDetected: 0, attributionsPersisted: 0, skippedDebounced: 0,
  };

  // 1. Pull external signals + their history.
  let signals: SignalRow[] = [];
  try {
    const r = await db.prepare(
      `SELECT id, category, source_name, title, raw_data
         FROM external_signals WHERE tenant_id = ?`
    ).bind(tenantId).all<SignalRow>();
    signals = r.results || [];
  } catch (err) {
    logError('signal_attribution.signals_failed', err, { tenantId }, {});
    return result;
  }
  result.signalsScanned = signals.length;
  if (signals.length === 0) return result;

  // 2. Pull metrics + their 30-day history.
  let metrics: MetricRow[] = [];
  try {
    const r = await db.prepare(
      `SELECT id, name, domain, threshold_red, threshold_amber, threshold_green
         FROM process_metrics WHERE tenant_id = ?`
    ).bind(tenantId).all<MetricRow>();
    metrics = r.results || [];
  } catch (err) {
    logError('signal_attribution.metrics_failed', err, { tenantId }, {});
    return result;
  }
  result.metricsScanned = metrics.length;
  if (metrics.length === 0) return result;

  const ids = metrics.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  let rawHistory: Array<{ metric_id: string; value: number; recorded_at: string }> = [];
  try {
    const r = await db.prepare(
      `SELECT metric_id, value, recorded_at FROM process_metric_history
        WHERE tenant_id = ? AND metric_id IN (${placeholders})
          AND recorded_at > datetime('now', '-30 days')
        ORDER BY recorded_at ASC`
    ).bind(tenantId, ...ids).all<{ metric_id: string; value: number; recorded_at: string }>();
    rawHistory = r.results || [];
  } catch (err) {
    logError('signal_attribution.history_failed', err, { tenantId }, {});
    return result;
  }

  const metricSeriesById = new Map<string, DailyPoint[]>();
  const grouped = new Map<string, Array<{ value: number; recorded_at: string }>>();
  for (const h of rawHistory) {
    const arr = grouped.get(h.metric_id);
    if (arr) arr.push(h); else grouped.set(h.metric_id, [h]);
  }
  for (const [mid, raw] of grouped) {
    const daily = bucketMetricDaily(raw);
    if (daily.length >= MIN_PAIRED_OBSERVATIONS) metricSeriesById.set(mid, daily);
  }

  // 3. Pairwise — for each signal × each metric with sufficient history,
  //    decide attribution and persist when significant.
  for (const signal of signals) {
    const signalSeries = parseSignalHistory(signal.raw_data);
    if (signalSeries.length < MIN_PAIRED_OBSERVATIONS) continue;
    for (const metric of metrics) {
      const metricSeries = metricSeriesById.get(metric.id);
      if (!metricSeries) continue;
      result.pairsEvaluated++;

      const decision = decideAttribution({ signal, metric, signalSeries, metricSeries });
      if (!decision) continue;
      result.attributionsDetected++;

      if (await recentlyAttributed(db, tenantId, signal.id, metric.name)) {
        result.skippedDebounced++;
        continue;
      }
      const ok = await persistAttribution(db, tenantId, signal, metric, decision);
      if (ok) result.attributionsPersisted++;
    }
  }

  if (result.attributionsPersisted > 0) {
    logInfo('signal_attribution.sweep_completed', { tenantId, layer: 'analytics', action: 'signal_attribution' }, { ...result });
  }
  return result;
}
