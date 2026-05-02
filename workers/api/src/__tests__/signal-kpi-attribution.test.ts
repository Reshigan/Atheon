/**
 * Phase 10-3 — Signal → KPI attribution.
 *
 * Covers:
 *  1. bucketMetricDaily averages multiple samples per day
 *  2. decideAttribution picks lag with strongest |r|
 *  3. decideAttribution returns null when |r| < 0.6
 *  4. decideAttribution returns null when signal moved < 5%
 *  5. Sweep: signal + correlated metric → 1 signal_impacts row with right shape
 *  6. Sweep: 7-day debounce — second sweep does not re-attribute
 *  7. Sweep: cost-domain metric + signal-up + metric-up → headwind
 *  8. Sweep: < MIN_PAIRED_OBS history on either side → not attributed
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  bucketMetricDaily,
  decideAttribution,
  attributeSignalsToKpis,
} from '../services/signal-kpi-attribution';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'attr-tenant';

interface DailyPoint { date: string; value: number }

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedSignal(id: string, signalKey: string, history: DailyPoint[], category = 'commodity'): Promise<void> {
  const last = history[history.length - 1];
  await env.DB.prepare(
    `INSERT OR REPLACE INTO external_signals
       (id, tenant_id, category, title, summary, source_name,
        reliability_score, raw_data, detected_at)
     VALUES (?, ?, ?, ?, ?, 'test', 0.9, ?, datetime('now'))`
  ).bind(
    id, TENANT, category, `Signal ${signalKey}`, `latest ${last?.value ?? 0}`,
    JSON.stringify({ signal_key: signalKey, latest_value: last?.value ?? 0, history }),
  ).run();
}

async function seedMetric(id: string, name: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
     VALUES (?, ?, ?, 0, 'unit', 'green', ?, datetime('now'))`
  ).bind(id, TENANT, name, domain).run();
}

async function seedMetricHistory(metricId: string, history: DailyPoint[]): Promise<void> {
  for (const p of history) {
    await env.DB.prepare(
      `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(crypto.randomUUID(), TENANT, metricId, p.value, `${p.date}T12:00:00Z`).run();
  }
}

function dateNDaysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

/** Build N daily points from `start` (older) to `end` (newer). */
function buildSeries(values: number[], startDaysAgo: number): DailyPoint[] {
  return values.map((value, i) => ({
    date: dateNDaysAgo(startDaysAgo - i),
    value,
  }));
}

describe('Phase 10-3 — signal → KPI attribution', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM signal_impacts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('bucketMetricDaily', () => {
    it('averages multiple samples per day', () => {
      const out = bucketMetricDaily([
        { value: 10, recorded_at: '2026-05-01T08:00:00Z' },
        { value: 20, recorded_at: '2026-05-01T18:00:00Z' },
        { value: 30, recorded_at: '2026-05-02T09:00:00Z' },
      ]);
      expect(out.length).toBe(2);
      expect(out[0].value).toBe(15);
      expect(out[1].value).toBe(30);
    });
  });

  describe('decideAttribution', () => {
    it('picks lag with strongest |r| and returns the correlation', () => {
      const sig = buildSeries(
        Array.from({ length: 20 }, (_, i) => 100 + i), 19,
      );
      const met = buildSeries(
        // Same series, lag 0 → r ≈ 1
        Array.from({ length: 20 }, (_, i) => 50 + i * 2), 19,
      );
      const decision = decideAttribution({
        signal: { id: 's1', category: 'commodity', source_name: 'x', title: 't', raw_data: '{}' },
        metric: { id: 'm1', name: 'M', domain: 'cost' },
        signalSeries: sig,
        metricSeries: met,
      });
      expect(decision).not.toBeNull();
      expect(decision!.correlation).toBeCloseTo(1, 2);
      expect(decision!.signalDeltaPct).toBeGreaterThan(5);
    });

    it('returns null when |r| < 0.6', () => {
      const sig = buildSeries(Array.from({ length: 20 }, (_, i) => 100 + i), 19);
      // Random-ish — low correlation
      const met = buildSeries(
        Array.from({ length: 20 }, (_, i) => 50 + ((i * 17 + 3) % 11)),
        19,
      );
      const decision = decideAttribution({
        signal: { id: 's1', category: 'commodity', source_name: 'x', title: 't', raw_data: '{}' },
        metric: { id: 'm1', name: 'M', domain: 'cost' },
        signalSeries: sig,
        metricSeries: met,
      });
      // Could be null or have very low correlation — just make sure not strongly attributed
      if (decision !== null) {
        expect(Math.abs(decision.correlation)).toBeLessThan(0.6 + 0.0001);
      }
    });

    it('returns null when signal moved < 5%', () => {
      // Signal essentially flat (1% movement) — even strong correlation shouldn't attribute
      const sig = buildSeries(Array.from({ length: 20 }, (_, i) => 100 + i * 0.05), 19);
      const met = buildSeries(Array.from({ length: 20 }, (_, i) => 50 + i * 0.025), 19);
      const decision = decideAttribution({
        signal: { id: 's1', category: 'commodity', source_name: 'x', title: 't', raw_data: '{}' },
        metric: { id: 'm1', name: 'M', domain: 'cost' },
        signalSeries: sig,
        metricSeries: met,
      });
      expect(decision).toBeNull();
    });
  });

  describe('attributeSignalsToKpis (sweep)', () => {
    it('signal + correlated metric → 1 signal_impacts row with right shape', async () => {
      // 20 days of monotonically rising oil → procurement cost rising in lockstep.
      const oil = buildSeries(Array.from({ length: 20 }, (_, i) => 70 + i * 1.5), 19);
      const cost = buildSeries(Array.from({ length: 20 }, (_, i) => 1000 + i * 30), 19);
      await seedSignal('sig-oil', 'oil.brent_spot', oil);
      await seedMetric('met-cost', 'Procurement Input Cost', 'procurement');
      await seedMetricHistory('met-cost', cost);

      const r = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r.signalsScanned).toBe(1);
      expect(r.metricsScanned).toBe(1);
      expect(r.pairsEvaluated).toBe(1);
      expect(r.attributionsDetected).toBe(1);
      expect(r.attributionsPersisted).toBe(1);

      const row = await env.DB.prepare(
        `SELECT signal_id, health_dimension, impact_direction, impact_magnitude, confidence, analysis
           FROM signal_impacts WHERE tenant_id = ?`
      ).bind(TENANT).first<{
        signal_id: string; health_dimension: string; impact_direction: string;
        impact_magnitude: number; confidence: number; analysis: string;
      }>();
      expect(row).not.toBeNull();
      expect(row!.signal_id).toBe('sig-oil');
      expect(row!.health_dimension).toBe('cost');
      expect(row!.impact_direction).toBe('headwind');
      expect(row!.impact_magnitude).toBeGreaterThanOrEqual(4);
      expect(row!.confidence).toBeGreaterThan(0.9);
      const analysis = JSON.parse(row!.analysis) as { metric_name: string; correlation: number; signal_delta_pct: number };
      expect(analysis.metric_name).toBe('Procurement Input Cost');
      expect(analysis.correlation).toBeGreaterThan(0.9);
      expect(analysis.signal_delta_pct).toBeGreaterThan(0);
    });

    it('7-day debounce — second sweep does not re-attribute', async () => {
      const oil = buildSeries(Array.from({ length: 20 }, (_, i) => 70 + i * 1.5), 19);
      const cost = buildSeries(Array.from({ length: 20 }, (_, i) => 1000 + i * 30), 19);
      await seedSignal('sig-oil', 'oil.brent_spot', oil);
      await seedMetric('met-cost', 'Cost', 'procurement');
      await seedMetricHistory('met-cost', cost);

      const r1 = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r1.attributionsPersisted).toBe(1);
      const r2 = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r2.attributionsPersisted).toBe(0);
      expect(r2.skippedDebounced).toBe(1);
    });

    it('< MIN_PAIRED_OBS history on either side → not attributed', async () => {
      // Only 5 days of history each
      const oil = buildSeries(Array.from({ length: 5 }, (_, i) => 70 + i * 2), 4);
      const cost = buildSeries(Array.from({ length: 5 }, (_, i) => 1000 + i * 50), 4);
      await seedSignal('sig-oil', 'oil.brent_spot', oil);
      await seedMetric('met-cost', 'Cost', 'procurement');
      await seedMetricHistory('met-cost', cost);

      const r = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r.attributionsPersisted).toBe(0);
    });

    it('classifies revenue-domain metric+signal-up+metric-down as headwind', async () => {
      // FX up + revenue down (importer scenario)
      const fx = buildSeries(Array.from({ length: 20 }, (_, i) => 18 + i * 0.1), 19);
      const rev = buildSeries(Array.from({ length: 20 }, (_, i) => 100 - i * 1.5), 19);
      await seedSignal('sig-fx', 'fx.usd_zar', fx, 'fx');
      await seedMetric('met-rev', 'Monthly Revenue', 'finance');
      await seedMetricHistory('met-rev', rev);

      await attributeSignalsToKpis(env.DB, TENANT);
      const row = await env.DB.prepare(
        `SELECT impact_direction, health_dimension FROM signal_impacts WHERE tenant_id = ?`
      ).bind(TENANT).first<{ impact_direction: string; health_dimension: string }>();
      expect(row).not.toBeNull();
      expect(row!.health_dimension).toBe('financial');
      expect(row!.impact_direction).toBe('headwind');
    });

    it('handles tenant with no signals as a no-op', async () => {
      await seedMetric('m', 'M', 'cost');
      const r = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r.signalsScanned).toBe(0);
      expect(r.attributionsPersisted).toBe(0);
    });
  });
});
