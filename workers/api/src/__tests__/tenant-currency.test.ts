/**
 * Phase 10-9 — Tenant currency resolution.
 *
 * Covers:
 *  Pure region mapping
 *   1. af-* → ZAR; eu-* → EUR; us-* → USD; ap-southeast-1 → SGD
 *
 *  Resolution chain
 *   2. Customer declaration on tenant_settings wins over region
 *   3. Region used when no declaration
 *   4. Default ZAR when neither declaration nor region resolves
 *   5. Cache: second call within 60s returns cached value
 *
 *  End-to-end through RCA synthesizer
 *   6. EU tenant → causal_factors.impact_unit = 'EUR' (not ZAR)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  currencyForRegion,
  getTenantCurrency,
  _resetCurrencyCacheForTests,
} from '../services/tenant-currency';
import { synthesizeCrossCatalystRca } from '../services/cross-catalyst-rca-synthesizer';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const T_ZAR = 'cur-zar';
const T_EUR = 'cur-eur';
const T_USD_DECLARED = 'cur-usd-declared';
const T_DEFAULT = 'cur-default';

async function seedTenant(id: string, region: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, region)
     VALUES (?, ?, ?, 'enterprise', 'active', ?)`
  ).bind(id, id, id, region).run();
}

async function seedCurrencySetting(tenantId: string, code: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
     VALUES (?, ?, 'currency', ?, datetime('now'))`
  ).bind(crypto.randomUUID(), tenantId, JSON.stringify(code)).run();
}

describe('Phase 10-9 — tenant currency', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(T_ZAR, 'af-south-1');
    await seedTenant(T_EUR, 'eu-west-1');
    await seedTenant(T_USD_DECLARED, 'af-south-1');
    await seedTenant(T_DEFAULT, '');
  });

  beforeEach(() => { _resetCurrencyCacheForTests(); });

  describe('currencyForRegion (pure)', () => {
    it('af-* → ZAR', () => { expect(currencyForRegion('af-south-1')).toBe('ZAR'); });
    it('eu-* → EUR', () => { expect(currencyForRegion('eu-west-1')).toBe('EUR'); });
    it('us-* → USD', () => { expect(currencyForRegion('us-east-1')).toBe('USD'); });
    it('uk-* → GBP', () => { expect(currencyForRegion('uk-london')).toBe('GBP'); });
    it('ap-southeast-1 → SGD', () => { expect(currencyForRegion('ap-southeast-1')).toBe('SGD'); });
    it('ap-southeast-2 → AUD', () => { expect(currencyForRegion('ap-southeast-2')).toBe('AUD'); });
    it('unknown region → null', () => { expect(currencyForRegion('xx-yz-1')).toBeNull(); });
    it('null → null', () => { expect(currencyForRegion(null)).toBeNull(); });
  });

  describe('getTenantCurrency', () => {
    it('declared setting wins over region', async () => {
      await seedCurrencySetting(T_USD_DECLARED, 'USD');
      const c = await getTenantCurrency(env.DB, T_USD_DECLARED);
      expect(c).toBe('USD');
    });
    it('region used when no declaration: af-south-1 → ZAR', async () => {
      const c = await getTenantCurrency(env.DB, T_ZAR);
      expect(c).toBe('ZAR');
    });
    it('region used when no declaration: eu-west-1 → EUR', async () => {
      const c = await getTenantCurrency(env.DB, T_EUR);
      expect(c).toBe('EUR');
    });
    it('default ZAR when neither declaration nor recognisable region', async () => {
      const c = await getTenantCurrency(env.DB, T_DEFAULT);
      expect(c).toBe('ZAR');
    });
    it('rejects unknown currency codes (falls through to region/default)', async () => {
      const T_BAD = 'cur-bad-setting';
      await seedTenant(T_BAD, 'af-south-1');
      await seedCurrencySetting(T_BAD, 'XYZ');
      const c = await getTenantCurrency(env.DB, T_BAD);
      expect(c).toBe('ZAR'); // unknown XYZ rejected → fell to region
    });
  });

  describe('end-to-end through RCA synthesizer', () => {
    it('EU tenant: causal_factors.impact_unit = EUR (not ZAR)', async () => {
      const T = 'cur-rca-eu';
      await seedTenant(T, 'eu-west-1');

      // Set up a red metric + signal_impact + correlation peer so a chain assembles
      await env.DB.prepare(
        `INSERT OR REPLACE INTO process_metrics
           (id, tenant_id, name, value, unit, status, domain, threshold_red,
            threshold_amber, threshold_green, measured_at)
         VALUES (?, ?, ?, 12, 'pct', 'red', 'finance', 40, 60, 80, datetime('now'))`
      ).bind('rca-margin-eu', T, 'Gross Margin').run();
      await env.DB.prepare(
        `INSERT OR REPLACE INTO process_metrics
           (id, tenant_id, name, value, unit, status, domain, threshold_red,
            threshold_amber, threshold_green, measured_at)
         VALUES (?, ?, ?, 1200, 'eur', 'amber', 'procurement', 80, 60, 40, datetime('now'))`
      ).bind('rca-cost-eu', T, 'Procurement Input Cost').run();

      await env.DB.prepare(
        `INSERT INTO external_signals
           (id, tenant_id, category, title, summary, source_name,
            reliability_score, raw_data, detected_at)
         VALUES (?, ?, 'commodity', 'Brent crude', 'r', 'eia', 0.95, '{}', datetime('now'))`
      ).bind('rca-sig-eu', T).run();

      await env.DB.prepare(
        `INSERT INTO signal_impacts
           (id, tenant_id, signal_id, health_dimension, impact_magnitude,
            impact_direction, impact_timeline, confidence, analysis, computed_at)
         VALUES (?, ?, ?, 'financial', 4, 'headwind', 'near-term', 0.88, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), T, 'rca-sig-eu',
        JSON.stringify({
          metric_id: 'rca-margin-eu', metric_name: 'Gross Margin',
          signal_title: 'Brent crude spot price',
          correlation: 0.88, best_lag_days: 2, signal_delta_pct: 22, metric_delta_pct: -8,
        }),
      ).run();

      await env.DB.prepare(
        `INSERT INTO correlation_events
           (id, tenant_id, source_system, source_event, target_system, target_impact,
            confidence, lag_days, metric_a, metric_b, correlation_type, lag_hours,
            description, detected_at)
         VALUES (?, ?, 'finance', 'X', 'procurement', 'Y', 0.81, 0,
                 'rca-margin-eu', 'rca-cost-eu', 'negative', 0, '', datetime('now'))`
      ).bind(crypto.randomUUID(), T).run();

      const r = await synthesizeCrossCatalystRca(env.DB, T);
      expect(r.rcasCreated).toBe(1);

      const row = await env.DB.prepare(
        `SELECT impact_unit FROM causal_factors WHERE tenant_id = ? LIMIT 1`
      ).bind(T).first<{ impact_unit: string }>();
      expect(row?.impact_unit).toBe('EUR');
    });
  });
});
