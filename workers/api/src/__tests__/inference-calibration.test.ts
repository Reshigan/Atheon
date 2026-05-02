/**
 * Phase 10-15 — Inference calibration loop.
 *
 * Covers:
 *  Pure stats
 *   1. statsFromCounts: total + rates computed correctly
 *   2. recommendation 'tighten' when FP rate > 30% AND sample ≥ 25
 *   3. recommendation 'loosen' when FN rate > 50% AND sample ≥ 25
 *   4. recommendation 'hold' when sample < MIN_SAMPLE_SIZE
 *   5. recommendation 'hold' when rates are healthy
 *
 *  Recording + reading
 *   6. recordOutcome persists; getCalibrationStats counts by outcome
 *   7. Lookback window respected (older outcomes excluded)
 *
 *  End-to-end via closeRecoveredRcas
 *   8. Recovering an RCA records true_positive for each L1 driver
 *      on signal_attribution.min_correlation
 *   9. L2 cross_metric driver gets metric_correlation.min_correlation
 *      gate
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  statsFromCounts,
  recordOutcome,
  getCalibrationStats,
  type GateName,
} from '../services/inference-calibration';
import { closeRecoveredRcas } from '../services/apex-narrative-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'cal-tenant';
const GATE: GateName = 'signal_attribution.min_correlation';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMetric(id: string, name: string, value: number, status: 'red' | 'amber' | 'green'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, ?, 'unit', ?, 40, 60, 80, datetime('now'))`
  ).bind(id, TENANT, name, value, status).run();
}

async function seedHistory(metricId: string, values: number[]): Promise<void> {
  for (let i = 0; i < values.length; i++) {
    await env.DB.prepare(
      `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' hours'))`
    ).bind(crypto.randomUUID(), TENANT, metricId, values[i], i).run();
  }
}

async function seedRcaWithFactors(opts: {
  id: string; metricId: string; metricName: string;
  l1FactorTypes: string[];
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at)
     VALUES (?, ?, ?, ?, 'red', '[]', 80, 'active', datetime('now'))`
  ).bind(opts.id, TENANT, opts.metricId, opts.metricName).run();
  for (const ft of opts.l1FactorTypes) {
    await env.DB.prepare(
      `INSERT INTO causal_factors
         (id, rca_id, tenant_id, layer, factor_type, title, description, evidence,
          impact_value, impact_unit, confidence, created_at)
       VALUES (?, ?, ?, 'L1', ?, 'driver', '', '{}', null, 'ZAR', 80, datetime('now'))`
    ).bind(crypto.randomUUID(), opts.id, TENANT, ft).run();
  }
}

describe('Phase 10-15 — inference calibration', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM inference_calibration WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM causal_factors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('statsFromCounts', () => {
    it('total + rates computed correctly', () => {
      const s = statsFromCounts({ gate: GATE, tp: 70, fp: 20, tn: 8, fn: 2 });
      expect(s.total).toBe(100);
      expect(s.false_positive_rate).toBeCloseTo(20 / 90, 3);
      expect(s.false_negative_rate).toBeCloseTo(2 / 10, 3);
    });
    it("recommendation 'tighten' when FP rate > 30% and sample ≥ 25", () => {
      // 60 TP + 40 FP → FP rate = 0.4
      const s = statsFromCounts({ gate: GATE, tp: 60, fp: 40, tn: 0, fn: 0 });
      expect(s.recommendation).toBe('tighten');
    });
    it("recommendation 'loosen' when FN rate > 50% and sample ≥ 25", () => {
      // 5 TN + 25 FN → FN rate = 0.83. Plus enough TP/FP to hit MIN_SAMPLE_SIZE
      const s = statsFromCounts({ gate: GATE, tp: 5, fp: 0, tn: 5, fn: 25 });
      expect(s.total).toBe(35);
      expect(s.recommendation).toBe('loosen');
    });
    it("recommendation 'hold' when sample < 25", () => {
      const s = statsFromCounts({ gate: GATE, tp: 5, fp: 5, tn: 5, fn: 5 });
      expect(s.total).toBe(20);
      expect(s.recommendation).toBe('hold');
    });
    it("recommendation 'hold' when rates are healthy", () => {
      const s = statsFromCounts({ gate: GATE, tp: 80, fp: 5, tn: 10, fn: 5 });
      expect(s.recommendation).toBe('hold');
    });
  });

  describe('recordOutcome + getCalibrationStats', () => {
    it('persists and reads back counts', async () => {
      await recordOutcome({ db: env.DB, tenantId: TENANT, gate: GATE, outcome: 'true_positive', source: 'auto_resolved' });
      await recordOutcome({ db: env.DB, tenantId: TENANT, gate: GATE, outcome: 'true_positive', source: 'auto_resolved' });
      await recordOutcome({ db: env.DB, tenantId: TENANT, gate: GATE, outcome: 'false_positive', source: 'user_feedback' });

      const stats = await getCalibrationStats(env.DB, TENANT, GATE);
      expect(stats.total).toBe(3);
      expect(stats.true_positives).toBe(2);
      expect(stats.false_positives).toBe(1);
      expect(stats.recommendation).toBe('hold'); // sample too small
    });

    it('lookback window excludes older outcomes', async () => {
      // Insert one in-window + one out-of-window via raw SQL
      await env.DB.prepare(
        `INSERT INTO inference_calibration (id, tenant_id, gate_name, outcome, source, context, recorded_at)
         VALUES (?, ?, ?, 'true_positive', 'auto_resolved', '{}', datetime('now'))`
      ).bind(crypto.randomUUID(), TENANT, GATE).run();
      await env.DB.prepare(
        `INSERT INTO inference_calibration (id, tenant_id, gate_name, outcome, source, context, recorded_at)
         VALUES (?, ?, ?, 'true_positive', 'auto_resolved', '{}', datetime('now', '-200 days'))`
      ).bind(crypto.randomUUID(), TENANT, GATE).run();

      const stats90 = await getCalibrationStats(env.DB, TENANT, GATE, 90);
      expect(stats90.total).toBe(1);
      const stats365 = await getCalibrationStats(env.DB, TENANT, GATE, 365);
      expect(stats365.total).toBe(2);
    });
  });

  describe('end-to-end via closeRecoveredRcas', () => {
    it('recovering an RCA records true_positive for each L1 driver', async () => {
      // Recovered metric (now green for ≥3 samples)
      await seedMetric('m-margin', 'Gross Margin', 90, 'green');
      await seedHistory('m-margin', [90, 88, 85]);
      await seedRcaWithFactors({
        id: 'rca-1', metricId: 'm-margin', metricName: 'Gross Margin',
        l1FactorTypes: ['external_driver', 'external_driver'], // 2 L1 drivers
      });

      const r = await closeRecoveredRcas(env.DB, TENANT);
      expect(r.rcasResolved).toBe(1);

      const stats = await getCalibrationStats(env.DB, TENANT, 'signal_attribution.min_correlation');
      expect(stats.true_positives).toBe(2);
      expect(stats.total).toBe(2);
    });

    it('L2-style cross_metric factor records on metric_correlation gate', async () => {
      await seedMetric('m-x', 'X', 90, 'green');
      await seedHistory('m-x', [90, 88, 85]);
      await seedRcaWithFactors({
        id: 'rca-2', metricId: 'm-x', metricName: 'X',
        l1FactorTypes: ['cross_metric', 'external_driver'],
      });

      await closeRecoveredRcas(env.DB, TENANT);

      const sig = await getCalibrationStats(env.DB, TENANT, 'signal_attribution.min_correlation');
      const corr = await getCalibrationStats(env.DB, TENANT, 'metric_correlation.min_correlation');
      expect(sig.true_positives).toBe(1);
      expect(corr.true_positives).toBe(1);
    });
  });
});
