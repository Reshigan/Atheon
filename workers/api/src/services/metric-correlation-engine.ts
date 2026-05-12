/**
 * Metric Correlation Engine — Phase 10-1.
 *
 * Detects co-movement across metrics and persists significant
 * correlations into `correlation_events`. This is the data substrate
 * the cross-catalyst RCA synthesizer (Phase 10-4) walks to compose
 * narratives like "HR hiring lag correlates with Warehouse picking
 * efficiency drop".
 *
 * Strong-inference gates (consistent with the project's "no false
 * positives" policy):
 *   - Require ≥ MIN_PAIRED_OBSERVATIONS paired observations on the
 *     joined timeline before computing correlation.
 *   - Require |Pearson r| ≥ MIN_CORRELATION_STRENGTH for the pair to
 *     be persisted.
 *   - Skip constant-value metrics (std dev = 0) — Pearson is undefined
 *     and a flat metric tells us nothing.
 *   - Debounce: do not re-emit the same metric pair within
 *     DEBOUNCE_HOURS, even if a stronger correlation is detected.
 *     The new value would suggest noise rather than meaningful change.
 *
 * Cost: pairwise across all tenant metrics is O(n²). For a tenant with
 * 100 active metrics, that's ~5,000 pairs per sweep. Each pair joins
 * two histories (≤30 days each) and computes Pearson. Bench measure:
 * ~250ms per tenant in the sweep cron.
 */

import { logError, logInfo } from './logger';
import { getEffectiveThreshold } from './threshold-autotune';

// ── Configuration ──────────────────────────────────────────────────────

const HISTORY_WINDOW_DAYS = 30;
const MIN_PAIRED_OBSERVATIONS = 14;
/** Default; superseded per-tenant by getEffectiveThreshold() at runtime. */
const MIN_CORRELATION_STRENGTH = 0.7;
const DEBOUNCE_HOURS = 24;
/** Bucket history values to this granularity to align series across
 *  metrics that may have different sample cadences (hourly vs daily). */
const BUCKET_HOURS = 24;

// ── Types ──────────────────────────────────────────────────────────────

interface MetricRow {
  id: string;
  name: string;
  domain: string | null;
  source_system: string | null;
  cluster_id: string | null;
  sub_catalyst_name: string | null;
}

interface HistoryPoint {
  /** Bucket start time (epoch ms, snapped to BUCKET_HOURS boundary). */
  bucket: number;
  value: number;
}

export interface DetectedCorrelation {
  metric_a_id: string;
  metric_a_name: string;
  metric_b_id: string;
  metric_b_name: string;
  correlation: number;          // Pearson r in [-1, 1]
  observations: number;          // n paired points used
  lag_hours: number;             // 0 in v1 — Phase 10-1 is concurrent only
  source_domain: string | null;
  target_domain: string | null;
  description: string;
}

// ── Pearson correlation ────────────────────────────────────────────────

/** Pearson r for two equal-length numeric series. Returns null when
 *  either series is constant (std dev = 0). */
export function pearson(xs: number[], ys: number[]): number | null {
  const n = xs.length;
  if (n !== ys.length || n === 0) return null;

  let sumX = 0, sumY = 0;
  for (let i = 0; i < n; i++) { sumX += xs[i]; sumY += ys[i]; }
  const meanX = sumX / n;
  const meanY = sumY / n;

  let num = 0, dxSq = 0, dySq = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    num += dx * dy;
    dxSq += dx * dx;
    dySq += dy * dy;
  }
  if (dxSq === 0 || dySq === 0) return null;
  const r = num / Math.sqrt(dxSq * dySq);
  // Clamp tiny floating-point overshoot
  if (r > 1) return 1;
  if (r < -1) return -1;
  return r;
}

// ── History bucketing + alignment ──────────────────────────────────────

function bucketStart(timestampMs: number): number {
  const ms = BUCKET_HOURS * 60 * 60 * 1000;
  return Math.floor(timestampMs / ms) * ms;
}

/** Group raw history points into buckets, taking the mean per bucket
 *  (so multiple samples in the same day average together). */
export function bucketHistory(rows: Array<{ value: number; recorded_at: string }>): HistoryPoint[] {
  const buckets = new Map<number, { sum: number; count: number }>();
  for (const r of rows) {
    const t = new Date(r.recorded_at).getTime();
    if (!isFinite(t)) continue;
    const b = bucketStart(t);
    const prev = buckets.get(b);
    if (prev) { prev.sum += r.value; prev.count++; }
    else buckets.set(b, { sum: r.value, count: 1 });
  }
  return [...buckets.entries()]
    .map(([bucket, { sum, count }]) => ({ bucket, value: sum / count }))
    .sort((a, b) => a.bucket - b.bucket);
}

/** Inner-join two bucketed series on bucket key. Returns paired arrays
 *  ready to feed into pearson(). */
export function alignSeries(a: HistoryPoint[], b: HistoryPoint[]): { xs: number[]; ys: number[] } {
  const bMap = new Map(b.map((p) => [p.bucket, p.value]));
  const xs: number[] = [];
  const ys: number[] = [];
  for (const pa of a) {
    const yv = bMap.get(pa.bucket);
    if (yv !== undefined) {
      xs.push(pa.value);
      ys.push(yv);
    }
  }
  return { xs, ys };
}

// ── Persistence + debounce ─────────────────────────────────────────────

/** Returns true if a correlation event for this metric pair was emitted
 *  within the debounce window — caller skips it. Order-independent
 *  (a,b vs b,a). */
async function recentlyEmitted(
  db: D1Database, tenantId: string, aId: string, bId: string,
): Promise<boolean> {
  try {
    // metric_a / metric_b are stored canonically as the pair sorted
    // lexicographically — but legacy rows may not be, so check both orderings.
    const r = await db.prepare(
      `SELECT 1 FROM correlation_events
        WHERE tenant_id = ?
          AND ((metric_a = ? AND metric_b = ?) OR (metric_a = ? AND metric_b = ?))
          AND detected_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, aId, bId, bId, aId, `-${DEBOUNCE_HOURS} hours`).first();
    return r !== null;
  } catch {
    return false;
  }
}

async function persistCorrelation(
  db: D1Database, tenantId: string, c: DetectedCorrelation,
): Promise<void> {
  try {
    // The legacy correlation_events shape (source_event/target_impact/source_system/target_system)
    // is preserved for backwards compatibility — cross-cutting code that reads the table by
    // those columns continues to work. The Phase 10 columns (metric_a/metric_b/correlation_type)
    // are populated from the new detection path.
    await db.prepare(
      `INSERT INTO correlation_events (
         id, tenant_id,
         source_system, source_event, target_system, target_impact,
         confidence, lag_days,
         metric_a, metric_b, correlation_type, lag_hours, description,
         detected_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId,
      c.source_domain || 'unknown',
      `${c.metric_a_name} ${c.correlation > 0 ? '↑' : '↓'}`,
      c.target_domain || 'unknown',
      `${c.metric_b_name} ${c.correlation > 0 ? '↑' : '↓'}`,
      Math.abs(c.correlation),
      c.lag_hours / 24,
      c.metric_a_id, c.metric_b_id,
      c.correlation > 0 ? 'positive' : 'negative',
      c.lag_hours,
      c.description,
    ).run();
  } catch (err) {
    logError('correlation.persist_failed', err, { tenantId }, {
      metric_a: c.metric_a_id, metric_b: c.metric_b_id,
    });
  }
}

// ── Main entry ─────────────────────────────────────────────────────────

export interface CorrelationSweepResult {
  metricsScanned: number;
  pairsEvaluated: number;
  correlationsDetected: number;
  correlationsPersisted: number;
  skippedDebounced: number;
}

/**
 * Sweep a tenant's metrics for pairwise correlations and persist the
 * significant ones. Best-effort — never throws; partial failures are
 * logged. Designed to run from the 15-min cron tick.
 */
export async function detectMetricCorrelations(
  db: D1Database, tenantId: string,
): Promise<CorrelationSweepResult> {
  const result: CorrelationSweepResult = {
    metricsScanned: 0, pairsEvaluated: 0,
    correlationsDetected: 0, correlationsPersisted: 0, skippedDebounced: 0,
  };

  // 1. Pull metric definitions.
  let metrics: MetricRow[] = [];
  try {
    const rows = await db.prepare(
      `SELECT id, name, domain, source_system, cluster_id, sub_catalyst_name
         FROM process_metrics
        WHERE tenant_id = ?
        ORDER BY name ASC`
    ).bind(tenantId).all<MetricRow>();
    metrics = rows.results || [];
  } catch (err) {
    logError('correlation.list_metrics_failed', err, { tenantId }, {});
    return result;
  }
  result.metricsScanned = metrics.length;
  if (metrics.length < 2) return result;

  // Resolve per-tenant correlation threshold (autotune override > default).
  const minCorrelation = await getEffectiveThreshold(
    db, tenantId, 'metric_correlation.min_correlation',
  ).catch(() => MIN_CORRELATION_STRENGTH);

  // 2. Pull recent history for each metric — single query, group in JS.
  const ids = metrics.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  let rawHistory: Array<{ metric_id: string; value: number; recorded_at: string }> = [];
  try {
    const rows = await db.prepare(
      `SELECT metric_id, value, recorded_at FROM process_metric_history
        WHERE tenant_id = ? AND metric_id IN (${placeholders})
          AND recorded_at > datetime('now', ?)
        ORDER BY recorded_at ASC`
    ).bind(tenantId, ...ids, `-${HISTORY_WINDOW_DAYS} days`).all<{ metric_id: string; value: number; recorded_at: string }>();
    rawHistory = rows.results || [];
  } catch (err) {
    logError('correlation.list_history_failed', err, { tenantId }, {});
    return result;
  }

  const byMetric = new Map<string, Array<{ value: number; recorded_at: string }>>();
  for (const h of rawHistory) {
    const arr = byMetric.get(h.metric_id);
    if (arr) arr.push(h); else byMetric.set(h.metric_id, [h]);
  }

  // Pre-bucket each metric's history.
  const bucketed = new Map<string, HistoryPoint[]>();
  for (const m of metrics) {
    const raw = byMetric.get(m.id);
    if (!raw || raw.length < MIN_PAIRED_OBSERVATIONS) continue;
    const buckets = bucketHistory(raw);
    if (buckets.length >= MIN_PAIRED_OBSERVATIONS) bucketed.set(m.id, buckets);
  }

  // 3. Pairwise correlation. Only emit (a,b) with a.id < b.id (lex order)
  //    so we never persist both directions of the same pair.
  for (let i = 0; i < metrics.length; i++) {
    const a = metrics[i];
    const aBuckets = bucketed.get(a.id);
    if (!aBuckets) continue;
    for (let j = i + 1; j < metrics.length; j++) {
      const b = metrics[j];
      const bBuckets = bucketed.get(b.id);
      if (!bBuckets) continue;
      result.pairsEvaluated++;

      const { xs, ys } = alignSeries(aBuckets, bBuckets);
      if (xs.length < MIN_PAIRED_OBSERVATIONS) continue;

      const r = pearson(xs, ys);
      if (r === null) continue;
      if (Math.abs(r) < minCorrelation) continue;

      result.correlationsDetected++;

      // Order metric ids canonically and check debounce.
      const [m1, m2] = a.id < b.id ? [a, b] : [b, a];
      if (await recentlyEmitted(db, tenantId, m1.id, m2.id)) {
        result.skippedDebounced++;
        continue;
      }

      const direction = r > 0 ? 'positive' : 'negative';
      const description =
        `Detected ${direction} correlation (r=${r.toFixed(2)}) between ` +
        `"${a.name}" (${a.domain || 'unknown'}) and "${b.name}" (${b.domain || 'unknown'}) ` +
        `over ${xs.length} daily buckets in the last ${HISTORY_WINDOW_DAYS} days.`;

      await persistCorrelation(db, tenantId, {
        metric_a_id: m1.id, metric_a_name: m1.name,
        metric_b_id: m2.id, metric_b_name: m2.name,
        correlation: r, observations: xs.length, lag_hours: 0,
        source_domain: m1.domain, target_domain: m2.domain,
        description,
      });
      result.correlationsPersisted++;
    }
  }

  if (result.correlationsPersisted > 0) {
    logInfo('correlation.sweep_completed', { tenantId, layer: 'analytics', action: 'correlation.sweep' }, { ...result });
  }
  return result;
}
