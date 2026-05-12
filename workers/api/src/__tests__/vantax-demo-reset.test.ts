/**
 * VantaX demo — reset + billing-materialise smoke test.
 *
 * This test exercises the two helpers that make the VantaX demo repeatable:
 *   1. `cleanupVantaxTenant` — wipes all tenant-scoped tables, leaves the
 *      schema intact. Idempotent (second call on an already-clean tenant
 *      returns count=0 without errors).
 *   2. `materialiseDemoBilling` — resolves a couple of RCAs, stamps
 *      impact_value, links a verified catalyst_action, and runs
 *      computeBillablePeriod so the demo lights up the shared-savings
 *      billing tab without needing the full Phase 10 chain.
 *
 * The seed-vantax HTTP route itself isn't exercised here — it requires
 * a real authenticated session and a pre-existing tenant with slug='vantax'.
 * The route is a thin wrapper that calls these helpers, so testing the
 * helpers + their idempotency is the load-bearing assertion.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { cleanupVantaxTenant, materialiseDemoBilling } from '../services/vantax-demo';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'vantax-demo-smoke';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, region)
     VALUES (?, 'VantaX Smoke', ?, 'enterprise', 'active', 'af-south-1')`
  ).bind(TENANT, TENANT).run();
}

async function seedCluster(): Promise<string> {
  const id = `cluster-${TENANT}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status)
     VALUES (?, ?, 'Finance', 'finance', 'active')`
  ).bind(id, TENANT).run();
  return id;
}

async function seedActiveRca(metricName: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at)
     VALUES (?, ?, ?, ?, 'red', '[]', 85, 'active', datetime('now'))`
  ).bind(id, TENANT, `m-${id}`, metricName).run();
  // L0 factor with no impact_value yet — materialise will stamp it.
  await env.DB.prepare(
    `INSERT INTO causal_factors
       (id, rca_id, tenant_id, layer, factor_type, title, description,
        evidence, confidence, created_at)
     VALUES (?, ?, ?, 'L0', 'process', 'symptom', 'demo factor',
             '{}', 90, datetime('now'))`
  ).bind(crypto.randomUUID(), id, TENANT).run();
  // Prescription so materialise can link a verified catalyst_action.
  await env.DB.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, priority, title, description, effort_level, status, created_at)
     VALUES (?, ?, ?, 'high', 'demo fix', 'apply', 'medium', 'pending', datetime('now'))`
  ).bind(crypto.randomUUID(), id, TENANT).run();
  return id;
}

describe('VantaX demo — repeatable reset + billing materialise', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
  });

  beforeEach(async () => {
    // Start each test from a clean slate. We intentionally call the helper
    // we're testing here — it's what `/reset` invokes in production.
    await cleanupVantaxTenant(env.DB, TENANT);
    await env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(TENANT).run();
  });

  describe('cleanupVantaxTenant', () => {
    it('returns count=0 on a tenant with no data (idempotent)', async () => {
      await seedTenant();
      const r = await cleanupVantaxTenant(env.DB, TENANT);
      expect(r.count).toBe(0);
      expect(r.tables).toBeGreaterThan(50); // safety: we're sweeping a lot
    });

    it('removes all seeded RCA / factor / prescription / action rows', async () => {
      await seedTenant();
      const clusterId = await seedCluster();
      const rcaId = await seedActiveRca('Inventory Accuracy');
      // Stamp a verified action to verify it's also cleared.
      const presc = await env.DB.prepare(
        `SELECT id FROM diagnostic_prescriptions WHERE rca_id = ? LIMIT 1`
      ).bind(rcaId).first<{ id: string }>();
      await env.DB.prepare(
        `INSERT INTO catalyst_actions
           (id, cluster_id, tenant_id, catalyst_name, action, status,
            source_finding_id, verification_status, created_at)
         VALUES (?, ?, ?, 'cat', 'fix', 'completed', ?, 'verified', datetime('now'))`
      ).bind(crypto.randomUUID(), clusterId, TENANT, presc!.id).run();

      // Sanity: data is present before cleanup
      const beforeRca = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM root_cause_analyses WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(beforeRca?.n).toBe(1);

      const r = await cleanupVantaxTenant(env.DB, TENANT);
      expect(r.count).toBeGreaterThanOrEqual(4); // rca + factor + presc + action

      // Every tenant-scoped row gone — check named so failure pinpoints
      // exactly which table didn't drain.
      const checks: Array<[string, string]> = [
        ['root_cause_analyses', `SELECT COUNT(*) as n FROM root_cause_analyses WHERE tenant_id = ?`],
        ['causal_factors', `SELECT COUNT(*) as n FROM causal_factors WHERE tenant_id = ?`],
        ['diagnostic_prescriptions', `SELECT COUNT(*) as n FROM diagnostic_prescriptions WHERE tenant_id = ?`],
        ['catalyst_actions', `SELECT COUNT(*) as n FROM catalyst_actions WHERE tenant_id = ?`],
        ['catalyst_clusters', `SELECT COUNT(*) as n FROM catalyst_clusters WHERE tenant_id = ?`],
      ];
      for (const [name, sql] of checks) {
        const row = await env.DB.prepare(sql).bind(TENANT).first<{ n: number }>();
        expect(row?.n, `${name} should be empty after cleanup`).toBe(0);
      }
    });

    it('clears Phase 10 chain outputs (billable_periods, billable_line_items, kpi_forecasts)', async () => {
      await seedTenant();
      // Drop a row into each of the Phase 10 tables we expanded the cleanup
      // to cover. If any of these survives, the repeatable demo would
      // accumulate stale billing rows across re-seeds — the exact thing
      // this expansion exists to prevent.
      const periodId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO billable_periods
           (id, tenant_id, period_start, period_end, total_realised_savings,
            atheon_share_pct, atheon_revenue, currency, status, generated_at)
         VALUES (?, ?, '2026-04-01', '2026-05-01', 1000000, 0.2, 200000, 'ZAR', 'draft', datetime('now'))`
      ).bind(periodId, TENANT).run();
      await env.DB.prepare(
        `INSERT INTO billable_line_items
           (id, period_id, tenant_id, rca_id, metric_name, attributed_savings,
            currency, confidence, evidence, created_at)
         VALUES (?, ?, ?, 'rca-x', 'metric', 1000000, 'ZAR', 0.9, '{}', datetime('now'))`
      ).bind(crypto.randomUUID(), periodId, TENANT).run();
      await env.DB.prepare(
        `INSERT INTO kpi_forecasts (id, tenant_id, metric_id, metric_name,
            horizon_days, predicted_value, predicted_lower, predicted_upper,
            r_squared, target_date)
         VALUES (?, ?, 'm-x', 'demo metric', 30, 100, 80, 120, 0.8, date('now', '+30 days'))`
      ).bind(crypto.randomUUID(), TENANT).run();

      await cleanupVantaxTenant(env.DB, TENANT);

      const checks: Array<[string, string]> = [
        ['billable_periods', `SELECT COUNT(*) as n FROM billable_periods WHERE tenant_id = ?`],
        ['billable_line_items', `SELECT COUNT(*) as n FROM billable_line_items WHERE tenant_id = ?`],
        ['kpi_forecasts', `SELECT COUNT(*) as n FROM kpi_forecasts WHERE tenant_id = ?`],
      ];
      for (const [name, sql] of checks) {
        const row = await env.DB.prepare(sql).bind(TENANT).first<{ n: number }>();
        expect(row?.n, `${name} should be empty after cleanup`).toBe(0);
      }
    });
  });

  describe('materialiseDemoBilling', () => {
    it('resolves 2 RCAs, stamps impact_value, creates verified actions, persists billable period', async () => {
      await seedTenant();
      await seedCluster();
      await seedActiveRca('Production OEE');
      await seedActiveRca('Inventory Accuracy');

      const r = await materialiseDemoBilling(env.DB, TENANT);

      expect(r.rcasResolved).toBe(2);
      expect(r.actionsVerified).toBe(2);
      expect(r.periodId).not.toBeNull();
      expect(r.lineItems).toBe(2); // both eligible
      expect(r.atheonRevenue).toBeGreaterThan(0);
      // 20% share × max(4.2M, 1.8M) ≥ 360k floor sanity check
      expect(r.atheonRevenue).toBeGreaterThanOrEqual(360_000);
      expect(r.currency).toBe('ZAR');

      // Persisted: billable_periods has 1 row, billable_line_items has 2
      const period = await env.DB.prepare(
        `SELECT id, total_realised_savings, atheon_revenue, currency
           FROM billable_periods WHERE tenant_id = ?`
      ).bind(TENANT).first<{
        id: string; total_realised_savings: number;
        atheon_revenue: number; currency: string;
      }>();
      expect(period?.id).toBe(r.periodId);
      expect(period?.total_realised_savings).toBeGreaterThan(0);

      const lineItems = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM billable_line_items WHERE tenant_id = ? AND period_id = ?`
      ).bind(TENANT, r.periodId).first<{ n: number }>();
      expect(lineItems?.n).toBe(2);

      // Each line item has an rca_id linkable back to a resolved RCA
      const rcaCheck = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM root_cause_analyses
          WHERE tenant_id = ? AND status = 'resolved' AND resolved_at IS NOT NULL`
      ).bind(TENANT).first<{ n: number }>();
      expect(rcaCheck?.n).toBe(2);
    });

    it('no-op when no active RCAs exist', async () => {
      await seedTenant();
      await seedCluster();

      const r = await materialiseDemoBilling(env.DB, TENANT);
      expect(r.rcasResolved).toBe(0);
      expect(r.actionsVerified).toBe(0);
      expect(r.periodId).toBeNull();
      expect(r.lineItems).toBe(0);
    });
  });

  describe('full reset → reseed → re-reset → re-reseed cycle', () => {
    it('two full cycles produce identical billing shape (count + revenue)', async () => {
      const captures: Array<{ revenue: number; lineItems: number; rcasResolved: number }> = [];

      for (let cycle = 0; cycle < 2; cycle++) {
        // Reset (no-op on first iteration if DB is clean)
        await cleanupVantaxTenant(env.DB, TENANT);
        // Seed fresh tenant + cluster + 2 RCAs (deterministic shape)
        await seedTenant();
        await seedCluster();
        await seedActiveRca('Production OEE');
        await seedActiveRca('Inventory Accuracy');

        // Materialise
        const r = await materialiseDemoBilling(env.DB, TENANT);
        captures.push({
          revenue: r.atheonRevenue,
          lineItems: r.lineItems,
          rcasResolved: r.rcasResolved,
        });
      }

      // Both cycles must produce the same shape — proves the demo is
      // genuinely repeatable.
      expect(captures[0].lineItems).toBe(captures[1].lineItems);
      expect(captures[0].rcasResolved).toBe(captures[1].rcasResolved);
      expect(captures[0].revenue).toBe(captures[1].revenue);
    });

    it('reset wipes the previous cycle\'s billable_period (no accumulation across cycles)', async () => {
      // First cycle
      await seedTenant();
      await seedCluster();
      await seedActiveRca('Production OEE');
      await materialiseDemoBilling(env.DB, TENANT);
      const firstCount = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM billable_periods WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(firstCount?.n).toBe(1);

      // Reset + reseed
      await cleanupVantaxTenant(env.DB, TENANT);
      await seedTenant();
      await seedCluster();
      await seedActiveRca('Inventory Accuracy');
      await materialiseDemoBilling(env.DB, TENANT);

      // Still exactly one period — not two (no accumulation).
      const secondCount = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM billable_periods WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(secondCount?.n).toBe(1);
    });
  });
});
