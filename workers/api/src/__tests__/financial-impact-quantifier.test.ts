/**
 * Phase 10-10 — Financial impact quantification.
 *
 * Covers:
 *  Pure helpers
 *   1. isMonetaryUnit recognises ZAR/USD/EUR codes + symbols + suffixed forms
 *   2. estimateExternalDriverImpact: monetary metric → impact in tenant currency
 *   3. estimateExternalDriverImpact: non-monetary metric + no tenant base → null
 *   4. estimateExternalDriverImpact: non-monetary metric + tenant base → uses base
 *   5. estimateExternalDriverImpact: zero/missing inputs → null (false-negative bias)
 *   6. estimateCrossMetricImpact: falls back to nominal 5% when no peer delta
 *
 *  End-to-end via RCA synthesizer
 *   7. Monetary symptom + signal_impact → causal_factors.impact_value populated
 *   8. Non-monetary symptom + no tenant base → impact_value stays null
 *   9. Non-monetary symptom + tenant_settings monthly_revenue_base → uses base
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  isMonetaryUnit,
  estimateExternalDriverImpact,
  estimateCrossMetricImpact,
  loadTenantMonthlyBase,
} from '../services/financial-impact-quantifier';
import { synthesizeCrossCatalystRca } from '../services/cross-catalyst-rca-synthesizer';
import { _resetCurrencyCacheForTests } from '../services/tenant-currency';

const SETUP_SECRET = 'test-setup-secret-for-testing123';

async function seedTenant(id: string, region = 'af-south-1'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, region)
     VALUES (?, ?, ?, 'enterprise', 'active', ?)`
  ).bind(id, id, id, region).run();
}

async function seedMonthlyBase(tenantId: string, value: number): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
     VALUES (?, ?, 'monthly_revenue_base', ?, datetime('now'))`
  ).bind(crypto.randomUUID(), tenantId, JSON.stringify(value)).run();
}

interface RcaScenarioOpts {
  tenantId: string;
  symptomId: string;
  symptomName: string;
  symptomValue: number;
  symptomUnit: string | null;
  signalDeltaPct?: number;
  correlation?: number;
}
async function seedRcaScenario(opts: RcaScenarioOpts): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, ?, ?, 'red', 'finance', 40, 60, 80, datetime('now'))`
  ).bind(opts.symptomId, opts.tenantId, opts.symptomName, opts.symptomValue, opts.symptomUnit).run();

  // peer metric for L2 link
  const peerId = `peer-${opts.symptomId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, 1200, 'units', 'amber', 'procurement', 80, 60, 40, datetime('now'))`
  ).bind(peerId, opts.tenantId, `${opts.symptomName} peer`).run();

  // external signal + impact pointing at the symptom
  const sigId = `sig-${opts.symptomId}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO external_signals
       (id, tenant_id, category, title, summary, source_name, reliability_score, raw_data, detected_at)
     VALUES (?, ?, 'commodity', 'Brent crude', 'r', 'eia', 0.95, '{}', datetime('now'))`
  ).bind(sigId, opts.tenantId).run();

  await env.DB.prepare(
    `INSERT INTO signal_impacts
       (id, tenant_id, signal_id, health_dimension, impact_magnitude,
        impact_direction, impact_timeline, confidence, analysis, computed_at)
     VALUES (?, ?, ?, 'financial', 4, 'headwind', 'near-term', ?, ?, datetime('now'))`
  ).bind(
    crypto.randomUUID(), opts.tenantId, sigId, opts.correlation ?? 0.88,
    JSON.stringify({
      metric_id: opts.symptomId,
      metric_name: opts.symptomName,
      signal_title: 'Brent crude spot price',
      correlation: opts.correlation ?? 0.88,
      best_lag_days: 2,
      signal_delta_pct: opts.signalDeltaPct ?? 22,
      metric_delta_pct: -8,
    }),
  ).run();

  // L2 correlation edge so chain has ≥ 2 drivers
  await env.DB.prepare(
    `INSERT INTO correlation_events
       (id, tenant_id, source_system, source_event, target_system, target_impact,
        confidence, lag_days, metric_a, metric_b, correlation_type, lag_hours,
        description, detected_at)
     VALUES (?, ?, 'finance', 'X', 'procurement', 'Y', 0.81, 0,
             ?, ?, 'negative', 0, '', datetime('now'))`
  ).bind(crypto.randomUUID(), opts.tenantId, opts.symptomId, peerId).run();
}

describe('Phase 10-10 — financial impact quantifier', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
  });

  beforeEach(() => { _resetCurrencyCacheForTests(); });

  describe('isMonetaryUnit', () => {
    it('ISO codes', () => {
      expect(isMonetaryUnit('ZAR', 'ZAR')).toBe(true);
      expect(isMonetaryUnit('USD', 'ZAR')).toBe(true);
      expect(isMonetaryUnit('EUR', 'EUR')).toBe(true);
    });
    it('suffixed forms', () => {
      expect(isMonetaryUnit('ZAR/month', 'ZAR')).toBe(true);
      expect(isMonetaryUnit('USD-thousands', 'ZAR')).toBe(true);
    });
    it('symbols', () => {
      expect(isMonetaryUnit('R', 'ZAR')).toBe(true);
      expect(isMonetaryUnit('$', 'USD')).toBe(true);
      expect(isMonetaryUnit('€', 'EUR')).toBe(true);
    });
    it('non-monetary units', () => {
      expect(isMonetaryUnit('pct', 'ZAR')).toBe(false);
      expect(isMonetaryUnit('units', 'ZAR')).toBe(false);
      expect(isMonetaryUnit(null, 'ZAR')).toBe(false);
      expect(isMonetaryUnit('', 'ZAR')).toBe(false);
    });
  });

  describe('estimateExternalDriverImpact', () => {
    it('monetary metric: base × |Δ%|/100 × |r|', () => {
      // R5,000,000 monthly cost × 22% signal × 0.88 r = R968,000
      const v = estimateExternalDriverImpact(
        { value: 5_000_000, unit: 'ZAR' }, 22, 0.88, 'ZAR', null,
      );
      expect(v).toBe(968_000);
    });
    it('non-monetary metric without tenant base → null', () => {
      const v = estimateExternalDriverImpact(
        { value: 12, unit: 'pct' }, 22, 0.88, 'ZAR', null,
      );
      expect(v).toBeNull();
    });
    it('non-monetary metric WITH tenant base → uses base', () => {
      // R10,000,000 monthly base × 10% signal × 0.7 = R700,000
      const v = estimateExternalDriverImpact(
        { value: 12, unit: 'pct' }, 10, 0.7, 'ZAR', 10_000_000,
      );
      expect(v).toBe(700_000);
    });
    it('zero/missing inputs → null (prefer false negatives)', () => {
      expect(estimateExternalDriverImpact({ value: 1000, unit: 'ZAR' }, 0, 0.88, 'ZAR', null)).toBeNull();
      expect(estimateExternalDriverImpact({ value: 1000, unit: 'ZAR' }, 22, 0, 'ZAR', null)).toBeNull();
      expect(estimateExternalDriverImpact({ value: 1000, unit: 'ZAR' }, null, 0.88, 'ZAR', null)).toBeNull();
      expect(estimateExternalDriverImpact({ value: 0, unit: 'ZAR' }, 22, 0.88, 'ZAR', null)).toBeNull();
    });
  });

  describe('estimateCrossMetricImpact', () => {
    it('falls back to 5% nominal when no peer delta', () => {
      // R1,000,000 × 5% × 0.81 = R40,500
      const v = estimateCrossMetricImpact(
        { value: 1_000_000, unit: 'ZAR' }, null, 0.81, 'ZAR', null,
      );
      expect(v).toBe(40_500);
    });
    it('uses provided peer delta', () => {
      const v = estimateCrossMetricImpact(
        { value: 1_000_000, unit: 'ZAR' }, 12, 0.81, 'ZAR', null,
      );
      expect(v).toBe(97_200); // 1M × 12% × 0.81
    });
  });

  describe('loadTenantMonthlyBase', () => {
    it('reads JSON-encoded number from tenant_settings', async () => {
      const T = 'fi-base-set';
      await seedTenant(T);
      await seedMonthlyBase(T, 7_500_000);
      const base = await loadTenantMonthlyBase(env.DB, T);
      expect(base).toBe(7_500_000);
    });
    it('returns null when not set', async () => {
      const T = 'fi-base-unset';
      await seedTenant(T);
      const base = await loadTenantMonthlyBase(env.DB, T);
      expect(base).toBeNull();
    });
  });

  describe('end-to-end via RCA synthesizer', () => {
    it('monetary symptom → causal_factors.impact_value populated for L1 driver', async () => {
      const T = 'fi-rca-monetary';
      await seedTenant(T, 'af-south-1');
      await seedRcaScenario({
        tenantId: T,
        symptomId: 'fi-monetary-margin',
        symptomName: 'Monthly Procurement Spend',
        symptomValue: 5_000_000,
        symptomUnit: 'ZAR',
      });

      const r = await synthesizeCrossCatalystRca(env.DB, T);
      expect(r.rcasCreated).toBe(1);

      const l1 = await env.DB.prepare(
        `SELECT impact_value, impact_unit FROM causal_factors
          WHERE tenant_id = ? AND layer = 'L1'`
      ).bind(T).first<{ impact_value: number | null; impact_unit: string }>();
      expect(l1?.impact_unit).toBe('ZAR');
      expect(l1?.impact_value).not.toBeNull();
      expect(l1!.impact_value!).toBeGreaterThan(0);
    });

    it('non-monetary symptom + no tenant base → impact_value stays null', async () => {
      const T = 'fi-rca-nonmonetary';
      await seedTenant(T, 'af-south-1');
      await seedRcaScenario({
        tenantId: T,
        symptomId: 'fi-pct-margin',
        symptomName: 'Gross Margin Percentage',
        symptomValue: 12,
        symptomUnit: 'pct',
      });

      const r = await synthesizeCrossCatalystRca(env.DB, T);
      expect(r.rcasCreated).toBe(1);

      const l1 = await env.DB.prepare(
        `SELECT impact_value FROM causal_factors WHERE tenant_id = ? AND layer = 'L1'`
      ).bind(T).first<{ impact_value: number | null }>();
      expect(l1?.impact_value).toBeNull();
    });

    it('non-monetary symptom + tenant base → impact_value uses base', async () => {
      const T = 'fi-rca-tenant-base';
      await seedTenant(T, 'af-south-1');
      await seedMonthlyBase(T, 10_000_000);
      await seedRcaScenario({
        tenantId: T,
        symptomId: 'fi-base-margin',
        symptomName: 'Margin %',
        symptomValue: 12,
        symptomUnit: 'pct',
        signalDeltaPct: 10,
        correlation: 0.7,
      });

      const r = await synthesizeCrossCatalystRca(env.DB, T);
      expect(r.rcasCreated).toBe(1);

      const l1 = await env.DB.prepare(
        `SELECT impact_value FROM causal_factors WHERE tenant_id = ? AND layer = 'L1'`
      ).bind(T).first<{ impact_value: number | null }>();
      // 10M × 10% × 0.7 = 700,000
      expect(l1?.impact_value).toBe(700_000);
    });
  });
});
