/**
 * KPI Forecasting — Phase 10-11.
 *
 * Linear-trend projection of `process_metric_history` with confidence
 * bands that widen by horizon. Pure functions — given a history series
 * + a horizon (days), return point estimate and 1σ band. The Apex
 * narrative engine composes 30/60/90-day forecasts per symptom KPI and
 * embeds them in `executive_briefings.kpi_movements` so the next
 * briefing reads as forwards-looking, not just retrospective.
 *
 * Why linear regression (vs Holt-Winters, ARIMA, neural):
 *   - Atheon ingests daily KPI samples; 14–30 days of history is
 *     typical at launch — far too sparse for seasonal models
 *   - Linear is interpretable: the slope IS the per-day delta. The
 *     band is the 1σ residual standard error projected forward
 *   - Zero training overhead per cron tick; runs on every red metric
 *   - When trend is weak (R² low), we widen the band — consumers
 *     can decide whether to act
 *
 * Strong-inference gates:
 *   - Need ≥ MIN_OBS history points (10) — otherwise return null;
 *     Apex briefing simply omits the forecast block for that metric
 *   - When R² < MIN_R2 (0.2), still emit but flag low_confidence so
 *     consumers can downweight or hide
 *   - Bands are 1σ residual SE × √(horizon/historyLength) — grows with
 *     extrapolation distance (heteroscedastic-style honesty)
 */

const MIN_OBS = 10;
const MIN_R2 = 0.2;

export interface ForecastPoint {
  /** Days forward from the last observation. */
  horizon_days: number;
  /** Point estimate of the metric value at horizon_days from now. */
  value: number;
  /** Lower bound of 1σ confidence band. */
  lower: number;
  /** Upper bound of 1σ confidence band. */
  upper: number;
  /** R² of the underlying fit, [0,1]. Low values mean trend is noisy. */
  r_squared: number;
  /** True when r_squared < MIN_R2 — UI should treat the forecast as
   *  directional only. */
  low_confidence: boolean;
}

export interface MetricHistoryPoint {
  /** Unix ms timestamp. */
  t: number;
  value: number;
}

interface FitResult {
  slope: number;
  intercept: number;
  r2: number;
  /** Standard error of residuals (1σ band reference). */
  residualStdErr: number;
  /** Range of x in days (last - first observation). */
  xRangeDays: number;
}

/** Fit y = slope·x + intercept where x is days-since-first-observation. */
export function linearFit(history: MetricHistoryPoint[]): FitResult | null {
  if (history.length < 2) return null;
  const t0 = history[0].t;
  const days = (ms: number) => (ms - t0) / 86_400_000;

  const xs = history.map((h) => days(h.t));
  const ys = history.map((h) => h.value);
  const n = xs.length;
  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let sxx = 0, sxy = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX, dy = ys[i] - meanY;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  if (sxx === 0) return null;

  const slope = sxy / sxx;
  const intercept = meanY - slope * meanX;
  const ssRes = ys.reduce((s, y, i) => {
    const yhat = intercept + slope * xs[i];
    return s + (y - yhat) ** 2;
  }, 0);
  const r2 = syy === 0 ? 1 : Math.max(0, 1 - ssRes / syy);
  const residualStdErr = Math.sqrt(ssRes / Math.max(1, n - 2));
  return {
    slope, intercept, r2, residualStdErr,
    xRangeDays: xs[n - 1] - xs[0],
  };
}

/** Forecast at a future horizon. Returns null when history too sparse. */
export function forecastAtHorizon(
  history: MetricHistoryPoint[], horizonDays: number,
): ForecastPoint | null {
  if (history.length < MIN_OBS) return null;
  const fit = linearFit(history);
  if (!fit) return null;
  const lastX = (history[history.length - 1].t - history[0].t) / 86_400_000;
  const xForecast = lastX + horizonDays;
  const point = fit.intercept + fit.slope * xForecast;

  // Band widens with extrapolation distance: scale residual SE by
  // sqrt(horizon / historyLength). Honest about uncertainty far out.
  const widening = Math.sqrt(Math.max(1, horizonDays) / Math.max(1, fit.xRangeDays || history.length));
  const band = fit.residualStdErr * widening;

  return {
    horizon_days: horizonDays,
    value: Number(point.toFixed(3)),
    lower: Number((point - band).toFixed(3)),
    upper: Number((point + band).toFixed(3)),
    r_squared: Number(fit.r2.toFixed(3)),
    low_confidence: fit.r2 < MIN_R2,
  };
}

/** Forecast at multiple horizons in one call. Skips horizons that
 *  produce nulls (insufficient history → all null). */
export function forecastMultiHorizon(
  history: MetricHistoryPoint[], horizonsDays: number[] = [30, 60, 90],
): ForecastPoint[] {
  const out: ForecastPoint[] = [];
  for (const h of horizonsDays) {
    const f = forecastAtHorizon(history, h);
    if (f) out.push(f);
  }
  return out;
}

// ── DB-backed convenience ─────────────────────────────────────────────

interface RawHistoryRow { value: number; recorded_at: string }

export async function loadMetricHistoryForForecast(
  db: D1Database, tenantId: string, metricId: string, days = 60,
): Promise<MetricHistoryPoint[]> {
  try {
    const r = await db.prepare(
      `SELECT value, recorded_at FROM process_metric_history
        WHERE tenant_id = ? AND metric_id = ?
          AND recorded_at > datetime('now', ?)
        ORDER BY recorded_at ASC`
    ).bind(tenantId, metricId, `-${days} days`).all<RawHistoryRow>();
    return (r.results || [])
      .map((row) => ({ t: new Date(row.recorded_at).getTime(), value: row.value }))
      .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.value));
  } catch {
    return [];
  }
}

/** End-to-end: load history + return 30/60/90 day forecasts. Empty
 *  array when history is too sparse. */
export async function forecastMetric(
  db: D1Database, tenantId: string, metricId: string,
): Promise<ForecastPoint[]> {
  const history = await loadMetricHistoryForForecast(db, tenantId, metricId);
  return forecastMultiHorizon(history);
}
