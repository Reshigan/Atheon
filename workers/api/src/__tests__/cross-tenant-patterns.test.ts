/**
 * Phase 10-18 — Cross-tenant industry pattern discovery.
 *
 * Covers:
 *  Pure helpers
 *   1. normaliseMetricName: spaces, casing, punctuation → underscored slug
 *   2. discoverPatternsFromBuckets: ≥3 tenants + |r|≥0.65 → kept;
 *      below threshold → dropped
 *
 *  End-to-end discovery
 *   3. 3 mining tenants with same Brent→cost attribution → 1 pattern
 *   4. 2 mining tenants → no pattern (below MIN_TENANTS_PER_PATTERN)
 *   5. 3 tenants but avg correlation < 0.65 → no pattern
 *   6. Cross-industry: 3 mining + 3 fmcg with same signal → 2 patterns
 *      (one per industry)
 *   7. Pattern UPSERT: re-running with new tenants updates count
 *
 *  Suggestions
 *   8. getIndustryPatternSuggestions returns industry-matching patterns
 *      ordered by tenant count desc
 *   9. Tenant with no industry signal → empty suggestions
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  normaliseMetricName,
  discoverPatternsFromBuckets,
  discoverIndustryPatterns,
  getIndustryPatternSuggestions,
} from '../services/cross-tenant-pattern-discovery';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANTS_MINING = ['ctp-mining-a', 'ctp-mining-b', 'ctp-mining-c'];
const TENANTS_FMCG = ['ctp-fmcg-a', 'ctp-fmcg-b', 'ctp-fmcg-c'];
const ALL_TENANTS = [...TENANTS_MINING, ...TENANTS_FMCG, 'ctp-suggest-target'];

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function seedDomain(tenantId: string, domain: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
     VALUES (?, ?, ?, 0, 'unit', 'green', ?, datetime('now'))`
  ).bind(`m-${tenantId}-${domain}`, tenantId, `metric-${domain}`, domain).run();
}

async function seedSignalImpact(opts: {
  tenantId: string; signalTitle: string; metricName: string;
  correlation: number; deltaPct?: number;
  direction?: 'headwind' | 'tailwind';
}): Promise<void> {
  const sigId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO external_signals (id, tenant_id, category, title, summary, source_name, reliability_score, raw_data, detected_at)
     VALUES (?, ?, 'commodity', ?, '', 'src', 0.9, '{}', datetime('now'))`
  ).bind(sigId, opts.tenantId, opts.signalTitle).run();
  await env.DB.prepare(
    `INSERT INTO signal_impacts (id, tenant_id, signal_id, health_dimension, impact_magnitude,
                                 impact_direction, impact_timeline, confidence, analysis, computed_at)
     VALUES (?, ?, ?, 'cost', 4, ?, 'near-term', 0.88, ?, datetime('now'))`
  ).bind(
    crypto.randomUUID(), opts.tenantId, sigId,
    opts.direction ?? 'headwind',
    JSON.stringify({
      metric_name: opts.metricName,
      signal_title: opts.signalTitle,
      correlation: opts.correlation,
      signal_delta_pct: opts.deltaPct ?? 18,
    }),
  ).run();
}

describe('Phase 10-18 — cross-tenant pattern discovery', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    for (const t of ALL_TENANTS) await seedTenant(t);
  });

  beforeEach(async () => {
    // Inactivate other tenants in DB so they don't pollute the global discovery
    await env.DB.prepare(
      `UPDATE tenants SET status = 'inactive' WHERE id NOT LIKE 'ctp-%'`
    ).run();
    for (const t of ALL_TENANTS) {
      await env.DB.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).bind(t).run();
      await env.DB.prepare('DELETE FROM signal_impacts WHERE tenant_id = ?').bind(t).run();
      await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id = ?').bind(t).run();
      await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(t).run();
    }
    await env.DB.prepare(`DELETE FROM industry_patterns`).run();
  });

  describe('normaliseMetricName (pure)', () => {
    it('lowercases + slugifies', () => {
      expect(normaliseMetricName('Procurement Input Cost')).toBe('procurement_input_cost');
      expect(normaliseMetricName('Gross Margin %')).toBe('gross_margin');
      expect(normaliseMetricName('  Yield/ha  ')).toBe('yield_ha');
    });
  });

  describe('discoverIndustryPatterns end-to-end', () => {
    it('3 mining tenants with same Brent→cost → 1 pattern', async () => {
      for (const t of TENANTS_MINING) {
        await seedDomain(t, 'mining-equipment');
        await seedSignalImpact({
          tenantId: t, signalTitle: 'Brent crude spot price',
          metricName: 'Procurement Input Cost', correlation: 0.85,
        });
      }
      const r = await discoverIndustryPatterns(env.DB);
      expect(r.tenantsScanned).toBeGreaterThanOrEqual(3);
      expect(r.patternsPersisted).toBeGreaterThanOrEqual(1);

      const row = await env.DB.prepare(
        `SELECT industry, signal_key, metric_name_normalised, supporting_tenant_count, avg_correlation
           FROM industry_patterns WHERE industry = 'mining'`
      ).first<{ industry: string; signal_key: string; metric_name_normalised: string; supporting_tenant_count: number; avg_correlation: number }>();
      expect(row).not.toBeNull();
      expect(row!.signal_key).toBe('brent_crude_spot_price');
      expect(row!.metric_name_normalised).toBe('procurement_input_cost');
      expect(row!.supporting_tenant_count).toBe(3);
      expect(row!.avg_correlation).toBeGreaterThanOrEqual(0.85);
    });

    it('2 mining tenants → no pattern (< MIN_TENANTS)', async () => {
      for (const t of TENANTS_MINING.slice(0, 2)) {
        await seedDomain(t, 'mining-equipment');
        await seedSignalImpact({
          tenantId: t, signalTitle: 'Brent crude', metricName: 'Cost', correlation: 0.85,
        });
      }
      const r = await discoverIndustryPatterns(env.DB);
      expect(r.patternsPersisted).toBe(0);
    });

    it('3 tenants but avg correlation < 0.65 → no pattern', async () => {
      for (const t of TENANTS_MINING) {
        await seedDomain(t, 'mining-equipment');
        await seedSignalImpact({
          tenantId: t, signalTitle: 'Weak signal', metricName: 'M', correlation: 0.4,
        });
      }
      const r = await discoverIndustryPatterns(env.DB);
      expect(r.patternsPersisted).toBe(0);
    });

    it('cross-industry: 3 mining + 3 fmcg with same signal → 2 patterns', async () => {
      for (const t of TENANTS_MINING) {
        await seedDomain(t, 'mining-ore');
        await seedSignalImpact({ tenantId: t, signalTitle: 'Brent crude', metricName: 'Cost', correlation: 0.8 });
      }
      for (const t of TENANTS_FMCG) {
        await seedDomain(t, 'fmcg-trade');
        await seedSignalImpact({ tenantId: t, signalTitle: 'Brent crude', metricName: 'Cost', correlation: 0.78 });
      }
      const r = await discoverIndustryPatterns(env.DB);
      expect(r.patternsPersisted).toBeGreaterThanOrEqual(2);
      const rows = await env.DB.prepare(
        `SELECT industry FROM industry_patterns WHERE signal_key = 'brent_crude'`
      ).all<{ industry: string }>();
      const industries = (rows.results || []).map((r) => r.industry).sort();
      expect(industries).toContain('mining');
      expect(industries).toContain('fmcg');
    });

    it('UPSERT: re-running with new tenant updates supporting_tenant_count', async () => {
      // First pass: 3 mining tenants
      for (const t of TENANTS_MINING) {
        await seedDomain(t, 'mining-equipment');
        await seedSignalImpact({
          tenantId: t, signalTitle: 'Iron ore index', metricName: 'Margin', correlation: 0.85,
        });
      }
      await discoverIndustryPatterns(env.DB);
      let row = await env.DB.prepare(
        `SELECT supporting_tenant_count FROM industry_patterns WHERE signal_key = 'iron_ore_index'`
      ).first<{ supporting_tenant_count: number }>();
      expect(row!.supporting_tenant_count).toBe(3);

      // Add a 4th mining tenant + impact
      const T4 = 'ctp-mining-d';
      await seedTenant(T4);
      await env.DB.prepare(`UPDATE tenants SET status = 'active' WHERE id = ?`).bind(T4).run();
      await seedDomain(T4, 'mining-equipment');
      await seedSignalImpact({
        tenantId: T4, signalTitle: 'Iron ore index', metricName: 'Margin', correlation: 0.85,
      });
      await discoverIndustryPatterns(env.DB);
      row = await env.DB.prepare(
        `SELECT supporting_tenant_count FROM industry_patterns WHERE signal_key = 'iron_ore_index'`
      ).first<{ supporting_tenant_count: number }>();
      expect(row!.supporting_tenant_count).toBe(4);
    });
  });

  describe('discoverPatternsFromBuckets (pure)', () => {
    it('drops buckets with < MIN_TENANTS', () => {
      const buckets = new Map();
      buckets.set('mining|brent|cost', {
        key: { industry: 'mining', signal_key: 'brent', metric_name_normalised: 'cost' },
        tenants: new Set(['t1', 't2']), correlations: [0.8, 0.85],
        signalDeltas: [10, 12], directions: new Map([['headwind', 2]]),
      });
      const out = discoverPatternsFromBuckets(buckets);
      expect(out.length).toBe(0);
    });
    it('keeps buckets with ≥ MIN_TENANTS and avg correlation ≥ 0.65', () => {
      const buckets = new Map();
      buckets.set('mining|brent|cost', {
        key: { industry: 'mining', signal_key: 'brent', metric_name_normalised: 'cost' },
        tenants: new Set(['t1', 't2', 't3']), correlations: [0.7, 0.8, 0.85],
        signalDeltas: [10, 12, 15], directions: new Map([['headwind', 3]]),
      });
      const out = discoverPatternsFromBuckets(buckets);
      expect(out.length).toBe(1);
      expect(out[0].supporting_tenant_count).toBe(3);
      expect(out[0].common_impact_direction).toBe('headwind');
    });
  });

  describe('getIndustryPatternSuggestions', () => {
    it('returns mining-industry patterns to a mining tenant', async () => {
      // Seed 3 mining tenants + their pattern
      for (const t of TENANTS_MINING) {
        await seedDomain(t, 'mining-ore');
        await seedSignalImpact({ tenantId: t, signalTitle: 'Iron ore index', metricName: 'Margin', correlation: 0.8 });
      }
      await discoverIndustryPatterns(env.DB);

      // The suggestion target tenant: also mining
      const TARGET = 'ctp-suggest-target';
      await seedDomain(TARGET, 'mining-equipment');

      const out = await getIndustryPatternSuggestions(env.DB, TARGET);
      expect(out.length).toBeGreaterThanOrEqual(1);
      expect(out[0].industry).toBe('mining');
      expect(out[0].signal_title).toContain('Iron');
      expect(out[0].supporting_tenant_count).toBe(3);
    });

    it('tenant with no industry signal → empty suggestions', async () => {
      // No domains seeded for the target → industries=['general'] → filtered out
      const out = await getIndustryPatternSuggestions(env.DB, 'ctp-suggest-target');
      expect(out).toEqual([]);
    });
  });
});
