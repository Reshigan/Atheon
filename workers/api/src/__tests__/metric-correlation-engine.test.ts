/**
 * Phase 10-1 — Metric correlation engine.
 *
 * Covers:
 *  1. pearson() pure: positive, negative, zero correlations + edge cases
 *  2. bucketHistory() pure: buckets daily, averages within bucket
 *  3. alignSeries() pure: inner-join, returns paired arrays
 *  4. Sweep: two strongly-correlated metrics → 1 correlation_events row
 *  5. Sweep: weak correlation (|r| < 0.7) → not persisted
 *  6. Sweep: insufficient overlap (< 14 buckets) → not persisted
 *  7. Sweep: constant metric → not persisted (Pearson undefined)
 *  8. Sweep: debounce — second sweep within 24h does not re-emit
 *  9. Sweep: lex-ordered metric pair persisted (a.id < b.id)
 * 10. Sweep: < 2 metrics → no-op
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  pearson,
  bucketHistory,
  alignSeries,
  detectMetricCorrelations,
} from '../services/metric-correlation-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'corr-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMetric(id: string, name: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
       VALUES (?, ?, ?, 0, 'unit', 'green', ?, datetime('now'))`
  ).bind(id, TENANT, name, domain).run();
}

async function seedHistory(metricId: string, values: number[], startDaysAgo: number): Promise<void> {
  // values[0] is at startDaysAgo days ago, increasing one day per index
  for (let i = 0; i < values.length; i++) {
    const daysAgo = startDaysAgo - i;
    await env.DB.prepare(
      `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, ?, ?, datetime('now', ?))`
    ).bind(crypto.randomUUID(), TENANT, metricId, values[i], `-${daysAgo} days`).run();
  }
}

describe('Phase 10-1 — metric correlation engine', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM correlation_events WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('pearson (pure)', () => {
    it('perfect positive correlation = 1', () => {
      expect(pearson([1, 2, 3, 4, 5], [2, 4, 6, 8, 10])).toBeCloseTo(1, 5);
    });
    it('perfect negative correlation = -1', () => {
      expect(pearson([1, 2, 3, 4, 5], [10, 8, 6, 4, 2])).toBeCloseTo(-1, 5);
    });
    it('zero correlation = ~0', () => {
      const r = pearson([1, 2, 3, 4, 5], [3, 1, 4, 1, 5]);
      expect(r).not.toBeNull();
      expect(Math.abs(r!)).toBeLessThan(0.5);
    });
    it('constant series → null (std=0 undefined)', () => {
      expect(pearson([1, 2, 3], [5, 5, 5])).toBeNull();
    });
    it('mismatched lengths → null', () => {
      expect(pearson([1, 2], [1, 2, 3])).toBeNull();
    });
    it('empty → null', () => {
      expect(pearson([], [])).toBeNull();
    });
  });

  describe('bucketHistory + alignSeries (pure)', () => {
    it('buckets daily and averages within bucket', () => {
      const t = '2026-05-01T';
      const buckets = bucketHistory([
        { value: 10, recorded_at: `${t}10:00:00Z` },
        { value: 20, recorded_at: `${t}14:00:00Z` }, // same day → averages with above to 15
        { value: 30, recorded_at: '2026-05-02T08:00:00Z' },
      ]);
      expect(buckets.length).toBe(2);
      expect(buckets[0].value).toBe(15);
      expect(buckets[1].value).toBe(30);
    });

    it('alignSeries inner-joins on bucket key', () => {
      const a = [{ bucket: 100, value: 1 }, { bucket: 200, value: 2 }, { bucket: 300, value: 3 }];
      const b = [{ bucket: 200, value: 20 }, { bucket: 300, value: 30 }, { bucket: 400, value: 40 }];
      const { xs, ys } = alignSeries(a, b);
      expect(xs).toEqual([2, 3]);
      expect(ys).toEqual([20, 30]);
    });
  });

  describe('detectMetricCorrelations (sweep)', () => {
    it('two strongly-correlated metrics → 1 correlation_events row', async () => {
      await seedMetric('m-a', 'Procurement Cost', 'procurement');
      await seedMetric('m-b', 'Picking Efficiency', 'operations');
      // 20 days of monotonically rising A, monotonically falling B → r ≈ -1
      const days = 20;
      const aVals = Array.from({ length: days }, (_, i) => 100 + i * 5);
      const bVals = Array.from({ length: days }, (_, i) => 200 - i * 4);
      await seedHistory('m-a', aVals, days);
      await seedHistory('m-b', bVals, days);

      const r = await detectMetricCorrelations(env.DB, TENANT);
      expect(r.metricsScanned).toBe(2);
      expect(r.pairsEvaluated).toBe(1);
      expect(r.correlationsDetected).toBe(1);
      expect(r.correlationsPersisted).toBe(1);

      const row = await env.DB.prepare(
        `SELECT metric_a, metric_b, correlation_type, confidence, source_event, target_impact, description
           FROM correlation_events WHERE tenant_id = ?`
      ).bind(TENANT).first<{ metric_a: string; metric_b: string; correlation_type: string; confidence: number; source_event: string; target_impact: string; description: string }>();
      expect(row).not.toBeNull();
      expect(row!.correlation_type).toBe('negative');
      expect(row!.confidence).toBeGreaterThan(0.95);
      expect(row!.description).toMatch(/Procurement Cost/);
      expect(row!.description).toMatch(/Picking Efficiency/);
    });

    it('weak correlation (|r| < 0.7) → not persisted', async () => {
      await seedMetric('w-a', 'A', 'finance');
      await seedMetric('w-b', 'B', 'finance');
      const days = 20;
      // Random-ish values → weak correlation
      const aVals = Array.from({ length: days }, (_, i) => 100 + (i % 3) * 10);
      const bVals = Array.from({ length: days }, (_, i) => 50 + (i % 7) * 5);
      await seedHistory('w-a', aVals, days);
      await seedHistory('w-b', bVals, days);

      const r = await detectMetricCorrelations(env.DB, TENANT);
      expect(r.pairsEvaluated).toBe(1);
      expect(r.correlationsPersisted).toBe(0);
    });

    it('insufficient overlap (< 14 buckets) → not persisted', async () => {
      await seedMetric('s-a', 'A', 'finance');
      await seedMetric('s-b', 'B', 'finance');
      // Only 10 days each
      await seedHistory('s-a', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 10);
      await seedHistory('s-b', [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], 10);

      const r = await detectMetricCorrelations(env.DB, TENANT);
      expect(r.correlationsPersisted).toBe(0);
    });

    it('constant metric → not persisted (Pearson undefined)', async () => {
      await seedMetric('c-a', 'A', 'finance');
      await seedMetric('c-b', 'Constant B', 'finance');
      const days = 20;
      await seedHistory('c-a', Array.from({ length: days }, (_, i) => i + 1), days);
      await seedHistory('c-b', Array(days).fill(50), days);

      const r = await detectMetricCorrelations(env.DB, TENANT);
      expect(r.correlationsPersisted).toBe(0);
    });

    it('debounce — second sweep within 24h does not re-emit', async () => {
      await seedMetric('d-a', 'A', 'finance');
      await seedMetric('d-b', 'B', 'finance');
      const days = 20;
      await seedHistory('d-a', Array.from({ length: days }, (_, i) => i * 2), days);
      await seedHistory('d-b', Array.from({ length: days }, (_, i) => i * 3), days);

      const first = await detectMetricCorrelations(env.DB, TENANT);
      expect(first.correlationsPersisted).toBe(1);

      const second = await detectMetricCorrelations(env.DB, TENANT);
      expect(second.correlationsPersisted).toBe(0);
      expect(second.skippedDebounced).toBe(1);

      const count = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM correlation_events WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(count?.n).toBe(1);
    });

    it('< 2 metrics → no-op', async () => {
      await seedMetric('only-one', 'Only Metric', 'finance');
      const r = await detectMetricCorrelations(env.DB, TENANT);
      expect(r.metricsScanned).toBe(1);
      expect(r.pairsEvaluated).toBe(0);
      expect(r.correlationsPersisted).toBe(0);
    });

    it('cross-domain correlations include domain in description (substrate for RCA)', async () => {
      await seedMetric('m-margin', 'Gross Margin', 'finance');
      await seedMetric('m-picking', 'Picking Efficiency', 'operations');
      const days = 16;
      // Negatively correlated: margin down as picking efficiency drops
      await seedHistory('m-margin', Array.from({ length: days }, (_, i) => 30 - i * 0.5), days);
      await seedHistory('m-picking', Array.from({ length: days }, (_, i) => 95 - i * 1.5), days);

      await detectMetricCorrelations(env.DB, TENANT);
      const row = await env.DB.prepare(
        `SELECT description, source_event, target_impact, correlation_type
           FROM correlation_events WHERE tenant_id = ?`
      ).bind(TENANT).first<{ description: string; source_event: string; target_impact: string; correlation_type: string }>();
      expect(row).not.toBeNull();
      expect(row!.description).toMatch(/finance/);
      expect(row!.description).toMatch(/operations/);
      // When two things both decrease, that's positive correlation (both moving same direction)
      expect(row!.correlation_type).toBe('positive');
    });
  });
});
