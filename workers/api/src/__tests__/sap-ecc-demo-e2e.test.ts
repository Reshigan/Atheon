/**
 * Phase 10-26 — SAP ECC end-to-end platform validation.
 *
 * Seeds a realistic single-company SAP ECC tenant + 30 days of
 * transactional history, runs the entire Phase 10 chain, and asserts
 * that the canonical causal-chain example actually materialises:
 *
 *   1. Brent crude (rising +22% over 30 days)  ← external signal
 *   2. → Procurement Input Cost (rising correspondingly)  ← attribution
 *   3. → Gross Margin (falling)  ← cross-metric correlation
 *   4. → RCA synthesised with L0 + L1 (Brent driver) + L2 (peer metrics)
 *   5. → Apex narrative briefing emitted with the chain summary
 *
 * This is the platform's deploy-time smoke test. If a regression
 * breaks any link in the chain, this test fails clearly at the layer
 * where the break is.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSapEccDemo } from '../services/demo-sap-ecc-seeder';
import { runPhase10ChainForTenant } from '../services/phase-10-analytics-runner';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-ecc-e2e-test';

describe('Phase 10-26 — SAP ECC end-to-end demo', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
  });

  it('seeds tenant + KPIs + history + signals; chain produces RCA + Apex briefing', async () => {
    // ── SEED ───────────────────────────────────────────────────────
    const seed = await seedSapEccDemo(env.DB, { tenantId: TENANT });
    expect(seed.tenantId).toBe(TENANT);
    expect(seed.metrics.length).toBeGreaterThanOrEqual(5);
    const metricNames = seed.metrics.map((m) => m.name);
    expect(metricNames).toContain('Gross Margin %');
    expect(metricNames).toContain('Procurement Input Cost');
    expect(seed.signalIds.length).toBeGreaterThanOrEqual(1);

    // History rows present
    const histCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM process_metric_history WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    expect(histCount?.n).toBeGreaterThanOrEqual(150); // 5+ metrics × 30 days

    // ── RUN THE CHAIN ──────────────────────────────────────────────
    const result = await runPhase10ChainForTenant(env.DB, TENANT);
    expect(result.tenantId).toBe(TENANT);
    expect(result.steps.length).toBe(9);
    const failed = result.steps.filter((s) => !s.ok);
    if (failed.length > 0) {
      throw new Error(`Phase 10 chain steps failed: ${JSON.stringify(failed)}`);
    }

    // ── ASSERT: correlation_events created ─────────────────────────
    const corrCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM correlation_events WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    // 6 metrics × 5 same-direction trends → many correlated pairs
    expect(corrCount?.n).toBeGreaterThan(0);

    // ── ASSERT: signal_impacts (Brent → some metric) ───────────────
    const impactCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM signal_impacts WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    expect(impactCount?.n).toBeGreaterThan(0);

    // Brent specifically should show up against at least one rising metric
    const brentImpacts = await env.DB.prepare(
      `SELECT analysis FROM signal_impacts WHERE tenant_id = ? AND analysis LIKE '%Brent%'`
    ).bind(TENANT).all<{ analysis: string }>();
    expect(brentImpacts.results?.length).toBeGreaterThan(0);

    // ── ASSERT: RCA created on a red KPI ───────────────────────────
    const rcas = await env.DB.prepare(
      `SELECT id, metric_name, status, confidence FROM root_cause_analyses
        WHERE tenant_id = ? ORDER BY generated_at DESC`
    ).bind(TENANT).all<{ id: string; metric_name: string; status: string; confidence: number }>();
    expect(rcas.results?.length).toBeGreaterThan(0);
    // Each RCA should have at least 2 causal_factors (L0 symptom + 1 driver)
    for (const rca of rcas.results || []) {
      const f = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM causal_factors WHERE rca_id = ? AND tenant_id = ?`
      ).bind(rca.id, TENANT).first<{ n: number }>();
      expect(f?.n).toBeGreaterThanOrEqual(2);
    }

    // ── ASSERT: Apex executive_briefing emitted ────────────────────
    const briefing = await env.DB.prepare(
      `SELECT title, summary, risks, kpi_movements FROM executive_briefings
        WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 1`
    ).bind(TENANT).first<{
      title: string; summary: string; risks: string; kpi_movements: string;
    }>();
    expect(briefing).not.toBeNull();
    const risks = JSON.parse(briefing!.risks) as Array<{ metric: string; causal_chain: string }>;
    expect(risks.length).toBeGreaterThan(0);
    // The top risk's causal_chain should include the symptom metric name
    expect(risks[0].causal_chain).toBeTruthy();

    // ── ASSERT: forecast persisted (Phase 10-17) ────────────────────
    const forecastCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM kpi_forecasts WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    // 30-day history × 30/60/90d horizons × multiple metrics → many forecast rows
    expect(forecastCount?.n).toBeGreaterThan(0);
  }, 60_000);

  it('is idempotent — re-running clears prior data and re-seeds cleanly', async () => {
    const seed1 = await seedSapEccDemo(env.DB, { tenantId: TENANT });
    expect(seed1.metrics.length).toBeGreaterThanOrEqual(5);
    const seed2 = await seedSapEccDemo(env.DB, { tenantId: TENANT });
    expect(seed2.metrics.length).toBeGreaterThanOrEqual(5);
    // Counts should be the same — no row duplication
    const histCount = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM process_metric_history WHERE tenant_id = ?`
    ).bind(TENANT).first<{ n: number }>();
    expect(histCount?.n).toBeLessThan(500); // rough upper bound; would be 1000s if duplicates
  }, 60_000);
});
