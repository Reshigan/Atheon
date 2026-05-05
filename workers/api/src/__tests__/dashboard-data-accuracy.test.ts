/**
 * Phase 10-27 — Dashboard / Pulse / Apex data accuracy validation.
 *
 * Seeds the SAP ECC demo (now extended with sub_catalyst_runs +
 * sub_catalyst_kpi_values + health_scores + catalyst_insights via
 * the Phase 10-27 extension) and asserts that the API endpoints
 * those screens read return the correct counts and shapes.
 *
 * Why direct DB asserts (not full HTTP round-trips through SELF.fetch):
 * the dashboard endpoints require auth tokens and the test harness
 * doesn't carry one. Each endpoint here is reduced to its underlying
 * DB query to validate the SHAPE the UI will render. Full auth-flow
 * round-trips are covered by the existing apex.test / pulse.test files.
 *
 * Covers:
 *   1. SAP demo seed populates sub_catalyst_runs (4 expected)
 *   2. SAP demo seed populates sub_catalyst_kpi_values linked to defs
 *   3. SAP demo seed populates health_scores + 30-day history
 *   4. SAP demo seed populates catalyst_insights at apex + pulse levels
 *   5. Apex /summary-style query returns correct red KPI counts
 *   6. Pulse run-list query returns the 4 seeded runs in time order
 *   7. Health-trend query returns 30 history points
 *   8. End-to-end: after running the Phase 10 chain, dashboard
 *      surfaces remain consistent with the seed (no corruption,
 *      no double-write)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSapEccDemo } from '../services/demo-sap-ecc-seeder';
import { runPhase10ChainForTenant } from '../services/phase-10-analytics-runner';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-ecc-dash-test';

describe('Phase 10-27 — Dashboard / Pulse / Apex data accuracy', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedSapEccDemo(env.DB, { tenantId: TENANT });
  });

  it('seeds 4 sub_catalyst_runs covering procurement / finance / warehouse / hr', async () => {
    const r = await env.DB.prepare(
      `SELECT sub_catalyst_name, status, matched, discrepancies, exceptions_raised,
              total_source_value, total_discrepancy_value
         FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC`
    ).bind(TENANT).all<{
      sub_catalyst_name: string; status: string; matched: number;
      discrepancies: number; exceptions_raised: number;
      total_source_value: number; total_discrepancy_value: number;
    }>();
    expect(r.results?.length).toBe(4);
    const subs = (r.results || []).map((row) => row.sub_catalyst_name).sort();
    expect(subs).toEqual([
      'finance-margin-watch', 'hr-hiring-pipeline',
      'procurement-cost-monitor', 'warehouse-picking-efficiency',
    ]);
    // Procurement run carries the meaningful $ values
    const proc = r.results!.find((row) => row.sub_catalyst_name === 'procurement-cost-monitor');
    expect(proc?.total_source_value).toBe(6_400_000);
    expect(proc?.total_discrepancy_value).toBe(145_000);
    expect(proc?.discrepancies).toBe(87);
  });

  it('seeds sub_catalyst_kpi_values linked to definitions', async () => {
    const r = await env.DB.prepare(
      `SELECT kv.value, kv.status, kd.kpi_name
         FROM sub_catalyst_kpi_values kv
         JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
        WHERE kv.tenant_id = ?`
    ).bind(TENANT).all<{ value: number; status: string; kpi_name: string }>();
    expect(r.results?.length).toBeGreaterThanOrEqual(5);
    const byName = new Map((r.results || []).map((row) => [row.kpi_name, row]));
    expect(byName.get('Procurement Input Cost')?.value).toBe(6_400_000);
    expect(byName.get('Procurement Input Cost')?.status).toBe('red');
    expect(byName.get('Gross Margin %')?.status).toBe('red');
  });

  it('seeds health_scores headline + 30-day history', async () => {
    const head = await env.DB.prepare(
      `SELECT overall_score, dimensions FROM health_scores
        WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1`
    ).bind(TENANT).first<{ overall_score: number; dimensions: string }>();
    expect(head).not.toBeNull();
    // Distressed tenant — overall score should be in the lower band
    expect(head!.overall_score).toBeLessThan(60);
    const dims = JSON.parse(head!.dimensions) as Record<string, number>;
    expect(dims.cost).toBeLessThan(50);

    const hist = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM health_score_history WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    expect(hist?.n).toBe(30);
  });

  it('seeds catalyst_insights at apex + pulse levels', async () => {
    const r = await env.DB.prepare(
      `SELECT insight_level, category, severity FROM catalyst_insights
        WHERE tenant_id = ?`
    ).bind(TENANT).all<{ insight_level: string; category: string; severity: string }>();
    expect(r.results?.length).toBeGreaterThanOrEqual(5);
    const levels = new Set((r.results || []).map((row) => row.insight_level));
    expect(levels.has('apex')).toBe(true);
    expect(levels.has('pulse')).toBe(true);
    // At least 1 critical insight (Apex narrative will surface)
    const critical = (r.results || []).filter((row) => row.severity === 'critical');
    expect(critical.length).toBeGreaterThanOrEqual(2);
  });

  it('Apex summary query — red KPI count + active RCAs', async () => {
    // Apex /summary aggregates: red metric count, active RCAs, etc.
    const redKpis = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM process_metrics
        WHERE tenant_id = ? AND status = 'red'`
    ).bind(TENANT).first<{ n: number }>();
    expect(redKpis?.n).toBe(5); // Margin + ProcCost + DPO + Picking + Hires

    // Run the chain so RCAs get created
    const chain = await runPhase10ChainForTenant(env.DB, TENANT);
    expect(chain.steps.every((s) => s.ok)).toBe(true);

    const activeRcas = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM root_cause_analyses
        WHERE tenant_id = ? AND status = 'active'`
    ).bind(TENANT).first<{ n: number }>();
    expect(activeRcas?.n).toBeGreaterThan(0);
  });

  it('Pulse run-list query returns runs in time order with status', async () => {
    const r = await env.DB.prepare(
      `SELECT id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised
         FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 20`
    ).bind(TENANT).all<{
      id: string; sub_catalyst_name: string; status: string;
      matched: number; discrepancies: number; exceptions_raised: number;
    }>();
    expect(r.results?.length).toBe(4);
    // All runs completed in the demo seed
    for (const run of r.results || []) {
      expect(run.status).toBe('completed');
      expect(run.matched).toBeGreaterThan(0);
    }
  });

  it('Apex KPI table query joins kpi_values + definitions correctly', async () => {
    // The Apex page queries:
    //   SELECT kd.kpi_name, kd.unit, kd.direction, kv.value, kv.status, scr.sub_catalyst_name
    //   FROM sub_catalyst_kpi_values kv
    //   JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
    //   LEFT JOIN sub_catalyst_runs scr ON kv.run_id = scr.id
    //   WHERE kd.tenant_id = ? AND kv.status != 'green'
    const r = await env.DB.prepare(
      `SELECT kd.kpi_name, kd.unit, kd.direction, kv.value, kv.status, scr.sub_catalyst_name
         FROM sub_catalyst_kpi_values kv
         JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
         LEFT JOIN sub_catalyst_runs scr ON kv.run_id = scr.id
        WHERE kd.tenant_id = ? AND kv.status != 'green'
        ORDER BY kv.measured_at DESC`
    ).bind(TENANT).all<{
      kpi_name: string; unit: string; direction: string; value: number;
      status: string; sub_catalyst_name: string;
    }>();
    expect(r.results?.length).toBeGreaterThanOrEqual(5);
    // Every row should have a sub_catalyst_name (the JOIN succeeded)
    for (const row of r.results || []) {
      expect(row.sub_catalyst_name).toBeTruthy();
      expect(row.direction).toMatch(/^(higher_better|lower_better)$/);
    }
  });

  it('end-to-end: dashboard tables remain consistent after Phase 10 chain runs', async () => {
    // Counts BEFORE chain
    const before = {
      runs: (await env.DB.prepare(`SELECT COUNT(*) as n FROM sub_catalyst_runs WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      kpiValues: (await env.DB.prepare(`SELECT COUNT(*) as n FROM sub_catalyst_kpi_values WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      insights: (await env.DB.prepare(`SELECT COUNT(*) as n FROM catalyst_insights WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      healthSnapshots: (await env.DB.prepare(`SELECT COUNT(*) as n FROM health_score_history WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
    };

    // Run the chain (idempotent via debounce gates)
    await runPhase10ChainForTenant(env.DB, TENANT);

    const after = {
      runs: (await env.DB.prepare(`SELECT COUNT(*) as n FROM sub_catalyst_runs WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      kpiValues: (await env.DB.prepare(`SELECT COUNT(*) as n FROM sub_catalyst_kpi_values WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      insights: (await env.DB.prepare(`SELECT COUNT(*) as n FROM catalyst_insights WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
      healthSnapshots: (await env.DB.prepare(`SELECT COUNT(*) as n FROM health_score_history WHERE tenant_id = ?`).bind(TENANT).first<{ n: number }>())?.n ?? 0,
    };

    // The Phase 10 chain writes:
    //   - sub_catalyst_runs: 24 NEW from the transactional layer
    //     (Phase 10-30 + 10-31 + 10-32 batches: master-data
    //     onboarding, inventory, AP/AR/GL/payroll/T&E/treasury
    //     subcatalysts) on FIRST tick. Idempotent on subsequent
    //     ticks (idempotency keys collapse).
    //   - sub_catalyst_kpi_values: grows alongside the runs above
    //   - catalyst_insights: insights-engine path writes per run
    //   - health_score_history: per-tick snapshot
    expect(after.runs).toBe(before.runs + 24);
    expect(after.kpiValues).toBeGreaterThanOrEqual(before.kpiValues);
    expect(after.insights).toBeGreaterThanOrEqual(before.insights);
    expect(after.healthSnapshots).toBeGreaterThanOrEqual(before.healthSnapshots);
  }, 60_000);
});
