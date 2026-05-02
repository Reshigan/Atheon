/**
 * Phase 10-11 — KPI forecasting.
 *
 * Covers:
 *  Pure helpers
 *   1. linearFit on rising series → positive slope, R² ≈ 1
 *   2. linearFit on flat series → slope ≈ 0
 *   3. linearFit on too-few points → null
 *   4. forecastAtHorizon: rising series projects up at h=30
 *   5. forecastAtHorizon: bands widen with horizon
 *   6. forecastAtHorizon: < MIN_OBS → null
 *   7. forecastAtHorizon: noisy series → low_confidence flag
 *   8. forecastMultiHorizon: returns one ForecastPoint per horizon
 *
 *  End-to-end via Apex narrative
 *   9. Active RCA + 20 days history → briefing kpi_movements[0].forecast
 *      has 30/60/90d points
 *  10. Active RCA but only 3 history points → forecast is empty array
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  linearFit,
  forecastAtHorizon,
  forecastMultiHorizon,
  type MetricHistoryPoint,
} from '../services/kpi-forecasting';
import { generateApexNarrative } from '../services/apex-narrative-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'fc-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMetric(id: string, name: string, value: number, status = 'red'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, ?, 'unit', ?, 40, 60, 80, datetime('now'))`
  ).bind(id, TENANT, name, value, status).run();
}

async function seedHistorySeries(metricId: string, valuesNewestLast: number[]): Promise<void> {
  // values: oldest first → newest last; map across last N days
  const n = valuesNewestLast.length;
  for (let i = 0; i < n; i++) {
    const offset = n - 1 - i;
    await env.DB.prepare(
      `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' days'))`
    ).bind(crypto.randomUUID(), TENANT, metricId, valuesNewestLast[i], offset).run();
  }
}

async function seedRca(id: string, metricId: string, metricName: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at)
     VALUES (?, ?, ?, ?, 'red', '[]', 80, 'active', datetime('now', '-1 hours'))`
  ).bind(id, TENANT, metricId, metricName).run();
}

function makeSeries(start: number, slope: number, n: number, noise = 0): MetricHistoryPoint[] {
  const out: MetricHistoryPoint[] = [];
  const t0 = Date.now() - n * 86_400_000;
  for (let i = 0; i < n; i++) {
    const noiseTerm = noise > 0 ? (Math.sin(i * 7.31) * noise) : 0;
    out.push({ t: t0 + i * 86_400_000, value: start + slope * i + noiseTerm });
  }
  return out;
}

describe('Phase 10-11 — KPI forecasting', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM executive_briefings WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('linearFit', () => {
    it('rising series: positive slope, R² ≈ 1', () => {
      const s = makeSeries(100, 2.5, 20);
      const f = linearFit(s);
      expect(f).not.toBeNull();
      expect(f!.slope).toBeCloseTo(2.5, 2);
      expect(f!.r2).toBeGreaterThan(0.99);
    });
    it('flat series: slope ≈ 0', () => {
      const s = makeSeries(50, 0, 20);
      const f = linearFit(s);
      expect(Math.abs(f!.slope)).toBeLessThan(1e-9);
    });
    it('< 2 points → null', () => {
      expect(linearFit([])).toBeNull();
      expect(linearFit([{ t: Date.now(), value: 100 }])).toBeNull();
    });
  });

  describe('forecastAtHorizon', () => {
    it('rising series projects up at h=30', () => {
      const s = makeSeries(100, 2.5, 20); // last value ≈ 100 + 2.5*19 = 147.5
      const f = forecastAtHorizon(s, 30);
      expect(f).not.toBeNull();
      // Forecast at +30 days from last: 147.5 + 2.5*30 = 222.5
      expect(f!.value).toBeGreaterThan(220);
      expect(f!.value).toBeLessThan(225);
    });
    it('bands widen with horizon', () => {
      const s = makeSeries(100, 2.5, 20, 1.0); // small noise
      const f30 = forecastAtHorizon(s, 30);
      const f90 = forecastAtHorizon(s, 90);
      const band30 = (f30!.upper - f30!.lower);
      const band90 = (f90!.upper - f90!.lower);
      expect(band90).toBeGreaterThan(band30);
    });
    it('< MIN_OBS (10) → null', () => {
      const s = makeSeries(100, 1, 5);
      expect(forecastAtHorizon(s, 30)).toBeNull();
    });
    it('noisy series → low_confidence flag', () => {
      const s = makeSeries(100, 0.05, 20, 5.0); // mostly noise
      const f = forecastAtHorizon(s, 30);
      expect(f).not.toBeNull();
      expect(f!.low_confidence).toBe(true);
    });
  });

  describe('forecastMultiHorizon', () => {
    it('returns one ForecastPoint per horizon', () => {
      const s = makeSeries(100, 1, 20);
      const fs = forecastMultiHorizon(s, [30, 60, 90]);
      expect(fs.length).toBe(3);
      expect(fs.map((f) => f.horizon_days)).toEqual([30, 60, 90]);
    });
    it('returns empty array on insufficient history', () => {
      expect(forecastMultiHorizon(makeSeries(100, 1, 5))).toEqual([]);
    });
  });

  describe('end-to-end via Apex narrative', () => {
    it('20 days history → briefing kpi_movements has forecast points', async () => {
      await seedMetric('fc-margin', 'Gross Margin', 12);
      await seedHistorySeries('fc-margin', [12, 14, 16, 18, 20, 22, 24, 26, 28, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50]);
      await seedRca('fc-rca-1', 'fc-margin', 'Gross Margin');

      const r = await generateApexNarrative(env.DB, TENANT);
      expect(r.briefingsCreated).toBe(1);

      const row = await env.DB.prepare(
        `SELECT kpi_movements FROM executive_briefings WHERE tenant_id = ?`
      ).bind(TENANT).first<{ kpi_movements: string }>();
      const kpis = JSON.parse(row!.kpi_movements) as Array<{ metric: string; forecast: Array<{ horizon_days: number; value: number }> }>;
      const margin = kpis.find((k) => k.metric === 'Gross Margin');
      expect(margin).toBeTruthy();
      expect(margin!.forecast.length).toBe(3);
      expect(margin!.forecast.map((f) => f.horizon_days)).toEqual([30, 60, 90]);
      // Rising series → forecast at d90 should be greater than current value
      expect(margin!.forecast[2].value).toBeGreaterThan(50);
    });

    it('only 3 history points → forecast is empty array', async () => {
      await seedMetric('fc-thin', 'Thin History', 12);
      await seedHistorySeries('fc-thin', [10, 12, 14]);
      await seedRca('fc-rca-thin', 'fc-thin', 'Thin History');

      const r = await generateApexNarrative(env.DB, TENANT);
      expect(r.briefingsCreated).toBe(1);

      const row = await env.DB.prepare(
        `SELECT kpi_movements FROM executive_briefings WHERE tenant_id = ?`
      ).bind(TENANT).first<{ kpi_movements: string }>();
      const kpis = JSON.parse(row!.kpi_movements) as Array<{ metric: string; forecast: unknown[] }>;
      const thin = kpis.find((k) => k.metric === 'Thin History');
      expect(thin!.forecast).toEqual([]);
    });
  });
});
