/**
 * Phase 10-6 — KPI classification (arbitrary-KPI reasoning).
 *
 * Proves that the analytics layer reasons correctly about KPIs OUTSIDE
 * the original demo set (procurement / finance / hr / sales). Covers:
 *
 *  Direction resolution
 *   1. Customer declaration on sub_catalyst_kpi_definitions wins
 *   2. Threshold ordering inferred when no declaration
 *   3. Canonical-dimension hint used when no declaration AND no thresholds
 *   4. Defaults to higher_better when nothing is known
 *
 *  Dimension canonicalisation
 *   5. Well-known industry domains map to canonical buckets
 *   6. Unknown customer domains pass through as themselves (slugified)
 *   7. Category overrides domain when both supplied (declared > inferred)
 *
 *  Impact direction (universal)
 *   8. higher_better metric moving down → headwind
 *   9. higher_better metric moving up → tailwind
 *  10. lower_better metric moving up (e.g. defect rate worsening) → headwind
 *  11. lower_better metric moving down → tailwind
 *
 *  End-to-end (custom KPI in a custom domain)
 *  12. Custom 'sustainability' KPI with declared lower_better direction
 *      attributes correctly when paired with a correlated signal.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  inferKpiDirectionFromThresholds,
  resolveKpiDirection,
  canonicaliseDimension,
  canonicaliseDimensionWithCategory,
  classifyImpactDirection,
} from '../services/kpi-classification';
import { attributeSignalsToKpis } from '../services/signal-kpi-attribution';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'kpi-class-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

const TEST_CLUSTER_ID = 'kpi-class-cluster';

async function seedCluster(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters
       (id, tenant_id, name, domain, status)
     VALUES (?, ?, 'kpi-class-cluster', 'general', 'active')`
  ).bind(TEST_CLUSTER_ID, TENANT).run();
}

async function seedKpiDefinition(opts: {
  kpiName: string; direction: 'higher_better' | 'lower_better';
  category?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO sub_catalyst_kpi_definitions
       (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit,
        direction, category, enabled, sort_order, created_at)
     VALUES (?, ?, ?, 'sub-x', ?, 'pct', ?, ?, 1, 0, datetime('now'))`
  ).bind(
    crypto.randomUUID(), TENANT, TEST_CLUSTER_ID, opts.kpiName,
    opts.direction, opts.category ?? 'universal',
  ).run();
}

describe('Phase 10-6 — KPI classification', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
    await seedCluster();
  });

  beforeEach(async () => {
    await env.DB.prepare(
      'DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = ?'
    ).bind(TENANT).run();
    await env.DB.prepare('DELETE FROM signal_impacts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('inferKpiDirectionFromThresholds', () => {
    it('amber > red → higher_better', () => {
      expect(inferKpiDirectionFromThresholds({ red: 40, amber: 60, green: 80 })).toBe('higher_better');
    });
    it('amber < red → lower_better', () => {
      expect(inferKpiDirectionFromThresholds({ red: 10, amber: 5, green: 2 })).toBe('lower_better');
    });
    it('missing thresholds → null', () => {
      expect(inferKpiDirectionFromThresholds({ red: null, amber: 60, green: 80 })).toBeNull();
      expect(inferKpiDirectionFromThresholds({ red: 40, amber: null, green: 80 })).toBeNull();
    });
  });

  describe('resolveKpiDirection', () => {
    it('customer declaration wins over thresholds', async () => {
      await seedKpiDefinition({ kpiName: 'Quirky KPI', direction: 'lower_better' });
      // Thresholds suggest higher_better (amber > red), but the declaration says lower
      const dir = await resolveKpiDirection(env.DB, TENANT, 'Quirky KPI',
        { red: 40, amber: 60, green: 80 });
      expect(dir).toBe('lower_better');
    });
    it('inferred from thresholds when no declaration', async () => {
      const dir = await resolveKpiDirection(env.DB, TENANT, 'Untracked KPI',
        { red: 10, amber: 5, green: 2 });
      expect(dir).toBe('lower_better');
    });
    it('falls back to canonical-dimension hint when neither declared nor thresholded', async () => {
      const dir = await resolveKpiDirection(env.DB, TENANT, 'Cost Metric',
        { red: null, amber: null, green: null }, 'procurement');
      expect(dir).toBe('lower_better');
    });
    it('defaults to higher_better when nothing is known', async () => {
      const dir = await resolveKpiDirection(env.DB, TENANT, 'Mystery KPI',
        { red: null, amber: null, green: null });
      expect(dir).toBe('higher_better');
    });
  });

  describe('canonicaliseDimension', () => {
    it('well-known industry domains canonicalise', () => {
      expect(canonicaliseDimension('procurement')).toBe('cost');
      expect(canonicaliseDimension('Procurement-Supply')).toBe('cost');
      expect(canonicaliseDimension('finance')).toBe('financial');
      expect(canonicaliseDimension('treasury-ops')).toBe('financial');
      expect(canonicaliseDimension('sales')).toBe('revenue');
      expect(canonicaliseDimension('hr')).toBe('people');
      expect(canonicaliseDimension('workforce-planning')).toBe('people');
    });
    it('unknown customer domains pass through as themselves (slugified)', () => {
      expect(canonicaliseDimension('sustainability')).toBe('sustainability');
      expect(canonicaliseDimension('ESG-Water-Use')).toBe('esg-water-use');
      expect(canonicaliseDimension('Customer Experience')).toBe('customer-experience');
      expect(canonicaliseDimension('mfg-throughput-line-3')).toBe('mfg-throughput-line-3');
    });
    it('null/empty falls back to operational', () => {
      expect(canonicaliseDimension(null)).toBe('operational');
      expect(canonicaliseDimension('')).toBe('operational');
      expect(canonicaliseDimension('   ')).toBe('operational');
    });
  });

  describe('canonicaliseDimensionWithCategory', () => {
    it('category takes precedence over domain when not "universal"', () => {
      expect(canonicaliseDimensionWithCategory('procurement', 'sustainability')).toBe('sustainability');
    });
    it("category='universal' is treated as no hint, defers to domain", () => {
      expect(canonicaliseDimensionWithCategory('procurement', 'universal')).toBe('cost');
    });
    it('falls back to domain when category is null', () => {
      expect(canonicaliseDimensionWithCategory('finance', null)).toBe('financial');
    });
  });

  describe('classifyImpactDirection', () => {
    it('higher_better moving DOWN → headwind', () => {
      expect(classifyImpactDirection(-15, 'higher_better')).toBe('headwind');
    });
    it('higher_better moving UP → tailwind', () => {
      expect(classifyImpactDirection(15, 'higher_better')).toBe('tailwind');
    });
    it('lower_better moving UP (worse) → headwind', () => {
      // e.g. defect rate rising
      expect(classifyImpactDirection(15, 'lower_better')).toBe('headwind');
    });
    it('lower_better moving DOWN (better) → tailwind', () => {
      expect(classifyImpactDirection(-15, 'lower_better')).toBe('tailwind');
    });
  });

  describe('end-to-end with arbitrary-domain KPI', () => {
    it("attributes a 'sustainability' KPI with customer-declared lower_better direction", async () => {
      // Seed KPI definition declaring direction
      await seedKpiDefinition({
        kpiName: 'Water Withdrawal Per Tonne',
        direction: 'lower_better',
        category: 'sustainability',
      });
      // Seed metric in a non-standard domain
      await env.DB.prepare(
        `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status,
                                       domain, threshold_red, threshold_amber, threshold_green,
                                       measured_at)
         VALUES (?, ?, ?, ?, 'kL/t', 'red', ?, NULL, NULL, NULL, datetime('now'))`
      ).bind(
        'm-water', TENANT, 'Water Withdrawal Per Tonne', 12.5, 'sustainability',
      ).run();
      // 20-day rising water-withdrawal series (KPI getting worse — lower_better moving UP)
      const today = new Date();
      for (let i = 19; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        await env.DB.prepare(
          `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
           VALUES (?, ?, ?, ?, ?)`
        ).bind(crypto.randomUUID(), TENANT, 'm-water', 8 + (19 - i) * 0.25, `${d.toISOString().slice(0, 10)}T12:00:00Z`).run();
      }
      // Seed an external signal with rising-trend history (e.g. drought severity)
      const sigHistory = [];
      for (let i = 19; i >= 0; i--) {
        const d = new Date(today);
        d.setUTCDate(d.getUTCDate() - i);
        sigHistory.push({ date: d.toISOString().slice(0, 10), value: 30 + (19 - i) * 1.5 });
      }
      await env.DB.prepare(
        `INSERT INTO external_signals
           (id, tenant_id, category, title, summary, source_name,
            reliability_score, raw_data, detected_at)
         VALUES (?, ?, 'macro', 'Drought severity index', 'rising', 'test', 0.9, ?, datetime('now'))`
      ).bind(
        'sig-drought', TENANT,
        JSON.stringify({ signal_key: 'macro.drought_index', history: sigHistory }),
      ).run();

      const r = await attributeSignalsToKpis(env.DB, TENANT);
      expect(r.attributionsPersisted).toBe(1);

      const row = await env.DB.prepare(
        `SELECT health_dimension, impact_direction, analysis FROM signal_impacts WHERE tenant_id = ?`
      ).bind(TENANT).first<{ health_dimension: string; impact_direction: string; analysis: string }>();
      expect(row).not.toBeNull();
      // Domain canonicalises to its own slug — preserved, NOT silently merged into 'operational'
      expect(row!.health_dimension).toBe('sustainability');
      // KPI is lower_better and moved UP (worse) → headwind
      expect(row!.impact_direction).toBe('headwind');
      // Analysis JSON should record the resolved direction for observability
      const a = JSON.parse(row!.analysis) as { kpi_direction: string };
      expect(a.kpi_direction).toBe('lower_better');
    });
  });
});
