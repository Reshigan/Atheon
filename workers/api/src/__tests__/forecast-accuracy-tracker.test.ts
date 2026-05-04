/**
 * Phase 10-17 — Forecast accuracy tracker.
 *
 * Covers:
 *  Pure grader
 *   1. gradeForecast: actual within band → within_band=true
 *   2. gradeForecast: actual outside band → within_band=false
 *   3. gradeForecast: abs_error_pct null when actual=0
 *
 *  Recording
 *   4. recordEmittedForecasts persists one row per horizon
 *
 *  Sweep
 *   5. Forecast with elapsed target_date + sample present → graded;
 *      within_band reflected in result
 *   6. Forecast with target_date in future → skipped (still pending)
 *   7. Already-graded forecast (evaluated_at set) → skipped
 *   8. No metric sample at/after target_date → skippedNoSample
 *
 *  Stats
 *   9. getForecastAccuracyStats aggregates by horizon
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  gradeForecast,
  recordEmittedForecasts,
  sweepForecastAccuracy,
  getForecastAccuracyStats,
} from '../services/forecast-accuracy-tracker';
import type { ForecastPoint } from '../services/kpi-forecasting';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'fa-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMetric(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, 0, 'unit', 'green', 40, 60, 80, datetime('now'))`
  ).bind(id, TENANT, name).run();
}

async function seedHistorySample(metricId: string, value: number, dateOffset: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
     VALUES (?, ?, ?, ?, datetime('now', ?))`
  ).bind(crypto.randomUUID(), TENANT, metricId, value, dateOffset).run();
}

async function seedForecastRow(opts: {
  metricId: string; metricName: string; horizon: number;
  predicted: number; lower: number; upper: number;
  targetDateOffsetDays: number;
}): Promise<string> {
  const id = crypto.randomUUID();
  // Compute target_date in YYYY-MM-DD via SQLite
  const offset = opts.targetDateOffsetDays >= 0
    ? `+${opts.targetDateOffsetDays} days`
    : `${opts.targetDateOffsetDays} days`;
  await env.DB.prepare(
    `INSERT INTO kpi_forecasts
       (id, tenant_id, metric_id, metric_name, horizon_days,
        predicted_value, predicted_lower, predicted_upper, r_squared,
        target_date, generated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.9, date('now', ?), datetime('now'))`
  ).bind(
    id, TENANT, opts.metricId, opts.metricName, opts.horizon,
    opts.predicted, opts.lower, opts.upper, offset,
  ).run();
  return id;
}

describe('Phase 10-17 — forecast accuracy tracker', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM kpi_forecasts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM inference_calibration WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('gradeForecast (pure)', () => {
    it('actual within [lower, upper] → within_band=true', () => {
      const g = gradeForecast(100, 90, 110, 95);
      expect(g.within_band).toBe(true);
      expect(g.abs_error).toBe(5);
      expect(g.abs_error_pct).toBeCloseTo((5 / 95) * 100, 2);
    });
    it('actual outside band → within_band=false', () => {
      const g = gradeForecast(100, 90, 110, 80);
      expect(g.within_band).toBe(false);
      expect(g.abs_error).toBe(20);
    });
    it('abs_error_pct null when actual=0', () => {
      const g = gradeForecast(100, 90, 110, 0);
      expect(g.abs_error_pct).toBeNull();
    });
  });

  describe('recordEmittedForecasts', () => {
    it('persists one row per horizon', async () => {
      await seedMetric('m-x', 'X');
      const fs: ForecastPoint[] = [
        { horizon_days: 30, value: 100, lower: 90, upper: 110, r_squared: 0.9, low_confidence: false },
        { horizon_days: 60, value: 110, lower: 95, upper: 125, r_squared: 0.9, low_confidence: false },
      ];
      const n = await recordEmittedForecasts(env.DB, TENANT, 'm-x', 'X', fs);
      expect(n).toBe(2);
      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM kpi_forecasts WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(cnt?.n).toBe(2);
    });
  });

  describe('sweepForecastAccuracy', () => {
    it('elapsed forecast + sample present → graded with within_band', async () => {
      await seedMetric('m-margin', 'Gross Margin');
      // Forecast: 30-day horizon already elapsed (target_date 5 days ago)
      const fcId = await seedForecastRow({
        metricId: 'm-margin', metricName: 'Gross Margin',
        horizon: 30, predicted: 100, lower: 90, upper: 110,
        targetDateOffsetDays: -5,
      });
      // Sample at-or-after target_date with value=95 (within band)
      await seedHistorySample('m-margin', 95, '-3 days');

      const r = await sweepForecastAccuracy(env.DB, TENANT);
      expect(r.pendingForecasts).toBe(1);
      expect(r.graded).toBe(1);
      expect(r.withinBand).toBe(1);

      const row = await env.DB.prepare(
        `SELECT actual_value, abs_error, within_band, evaluated_at FROM kpi_forecasts WHERE id = ?`
      ).bind(fcId).first<{ actual_value: number; abs_error: number; within_band: number; evaluated_at: string }>();
      expect(row?.actual_value).toBe(95);
      expect(row?.abs_error).toBe(5);
      expect(row?.within_band).toBe(1);
      expect(row?.evaluated_at).not.toBeNull();
    });

    it('forecast with target_date in future → skipped', async () => {
      await seedMetric('m-future', 'F');
      await seedForecastRow({
        metricId: 'm-future', metricName: 'F',
        horizon: 30, predicted: 100, lower: 90, upper: 110,
        targetDateOffsetDays: 30,
      });
      const r = await sweepForecastAccuracy(env.DB, TENANT);
      expect(r.pendingForecasts).toBe(0);
      expect(r.graded).toBe(0);
    });

    it('already-graded forecast → skipped on next sweep (idempotent)', async () => {
      await seedMetric('m-once', 'O');
      await seedForecastRow({
        metricId: 'm-once', metricName: 'O', horizon: 30,
        predicted: 100, lower: 90, upper: 110, targetDateOffsetDays: -5,
      });
      await seedHistorySample('m-once', 100, '-3 days');

      const r1 = await sweepForecastAccuracy(env.DB, TENANT);
      expect(r1.graded).toBe(1);
      const r2 = await sweepForecastAccuracy(env.DB, TENANT);
      expect(r2.pendingForecasts).toBe(0);
      expect(r2.graded).toBe(0);
    });

    it('elapsed forecast + no metric sample → skippedNoSample', async () => {
      await seedMetric('m-nosample', 'N');
      await seedForecastRow({
        metricId: 'm-nosample', metricName: 'N', horizon: 30,
        predicted: 100, lower: 90, upper: 110, targetDateOffsetDays: -5,
      });
      const r = await sweepForecastAccuracy(env.DB, TENANT);
      expect(r.pendingForecasts).toBe(1);
      expect(r.graded).toBe(0);
      expect(r.skippedNoSample).toBe(1);
    });
  });

  describe('getForecastAccuracyStats', () => {
    it('aggregates by horizon', async () => {
      await seedMetric('m-x', 'X');
      // 2 forecasts at 30d, 1 at 60d, all graded
      const ids = await Promise.all([
        seedForecastRow({ metricId: 'm-x', metricName: 'X', horizon: 30, predicted: 100, lower: 90, upper: 110, targetDateOffsetDays: -10 }),
        seedForecastRow({ metricId: 'm-x', metricName: 'X', horizon: 30, predicted: 100, lower: 90, upper: 110, targetDateOffsetDays: -8 }),
        seedForecastRow({ metricId: 'm-x', metricName: 'X', horizon: 60, predicted: 100, lower: 90, upper: 110, targetDateOffsetDays: -5 }),
      ]);
      // Pre-set evaluated_at + within_band for each
      await env.DB.prepare(`UPDATE kpi_forecasts SET evaluated_at = datetime('now'), actual_value = 95, abs_error = 5, abs_error_pct = 5.26, within_band = 1 WHERE id = ?`).bind(ids[0]).run();
      await env.DB.prepare(`UPDATE kpi_forecasts SET evaluated_at = datetime('now'), actual_value = 80, abs_error = 20, abs_error_pct = 25, within_band = 0 WHERE id = ?`).bind(ids[1]).run();
      await env.DB.prepare(`UPDATE kpi_forecasts SET evaluated_at = datetime('now'), actual_value = 100, abs_error = 0, abs_error_pct = 0, within_band = 1 WHERE id = ?`).bind(ids[2]).run();

      const stats = await getForecastAccuracyStats(env.DB, TENANT);
      expect(stats.total_graded).toBe(3);
      expect(stats.within_band_rate).toBeCloseTo(2 / 3, 3);
      const h30 = stats.by_horizon.find((b) => b.horizon_days === 30);
      const h60 = stats.by_horizon.find((b) => b.horizon_days === 60);
      expect(h30?.graded).toBe(2);
      expect(h30?.within_band_rate).toBe(0.5);
      expect(h60?.graded).toBe(1);
      expect(h60?.within_band_rate).toBe(1);
    });
  });
});
