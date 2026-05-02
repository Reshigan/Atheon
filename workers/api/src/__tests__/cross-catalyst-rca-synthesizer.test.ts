/**
 * Phase 10-4 — Cross-catalyst RCA synthesizer.
 *
 * Covers:
 *  1. Red symptom + 1 signal_impact + 1 correlated peer → RCA with L0+L1+L2.
 *  2. Transitive: signal drives a peer that drives the symptom → L3 also written.
 *  3. Green-only metrics → no RCAs.
 *  4. Lone red symptom (no signals, no correlations) → skipped (thin chain).
 *  5. Debounce: second sweep within 24h doesn't re-create.
 *  6. Layer-breadth cap: many signals collapsed to ≤ 3 per layer.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { synthesizeCrossCatalystRca } from '../services/cross-catalyst-rca-synthesizer';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'rca-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMetric(opts: {
  id: string; name: string; status: 'green' | 'amber' | 'red';
  value?: number; domain?: string;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, ?, 'unit', ?, ?, 80, 60, 40, datetime('now'))`
  ).bind(
    opts.id, TENANT, opts.name, opts.value ?? 90, opts.status, opts.domain ?? 'general',
  ).run();
}

async function seedSignal(id: string, signalKey: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO external_signals
       (id, tenant_id, category, title, summary, source_name,
        reliability_score, raw_data, detected_at)
     VALUES (?, ?, 'commodity', ?, 'sample', 'test', 0.9, ?, datetime('now'))`
  ).bind(id, TENANT, `Signal ${signalKey}`, JSON.stringify({ signal_key: signalKey })).run();
}

interface ImpactOpts {
  signalId: string; metricId: string; metricName: string;
  signalTitle?: string; correlation?: number; deltaPct?: number;
  confidence?: number; magnitude?: number; direction?: 'headwind' | 'tailwind';
  dimension?: string;
}
async function seedSignalImpact(opts: ImpactOpts): Promise<void> {
  const analysis = {
    metric_id: opts.metricId,
    metric_name: opts.metricName,
    signal_title: opts.signalTitle ?? 'External signal',
    signal_source: 'frankfurter.app',
    correlation: opts.correlation ?? 0.85,
    best_lag_days: 2,
    observations: 18,
    signal_delta_pct: opts.deltaPct ?? 12.3,
    metric_delta_pct: 6.4,
    method: 'pearson_lag_sweep',
  };
  await env.DB.prepare(
    `INSERT INTO signal_impacts
       (id, tenant_id, signal_id, health_dimension, impact_magnitude,
        impact_direction, impact_timeline, confidence, analysis, computed_at)
     VALUES (?, ?, ?, ?, ?, ?, 'near-term', ?, ?, datetime('now'))`
  ).bind(
    crypto.randomUUID(), TENANT, opts.signalId,
    opts.dimension ?? 'cost', opts.magnitude ?? 4,
    opts.direction ?? 'headwind', opts.confidence ?? 0.9,
    JSON.stringify(analysis),
  ).run();
}

async function seedCorrelationEdge(opts: {
  metricA: string; metricB: string; type?: 'positive' | 'negative'; confidence?: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO correlation_events
       (id, tenant_id, source_system, source_event, target_system, target_impact,
        confidence, lag_days, metric_a, metric_b, correlation_type, lag_hours,
        description, detected_at)
     VALUES (?, ?, 'sysA', 'A↑', 'sysB', 'B↑', ?, 0, ?, ?, ?, 0, ?, datetime('now'))`
  ).bind(
    crypto.randomUUID(), TENANT, opts.confidence ?? 0.82,
    opts.metricA, opts.metricB, opts.type ?? 'positive',
    `Pearson r=${(opts.confidence ?? 0.82).toFixed(2)} on n=20 buckets at lag 0d`,
  ).run();
}

async function countRcas(): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM root_cause_analyses WHERE tenant_id = ?`
  ).bind(TENANT).first<{ n: number }>();
  return r?.n ?? 0;
}

describe('Phase 10-4 — cross-catalyst RCA synthesizer', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM causal_factors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM signal_impacts WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM correlation_events WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM external_signals WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('red symptom + 1 signal + 1 correlated peer → RCA with L0/L1/L2 factors', async () => {
    await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', value: 12, domain: 'finance' });
    await seedMetric({ id: 'm-cost', name: 'Procurement Input Cost', status: 'amber', value: 1200, domain: 'procurement' });
    await seedSignal('sig-oil', 'oil.brent_spot');
    await seedSignalImpact({
      signalId: 'sig-oil', metricId: 'm-margin', metricName: 'Gross Margin',
      signalTitle: 'Brent crude spot price', correlation: 0.88,
    });
    await seedCorrelationEdge({ metricA: 'm-margin', metricB: 'm-cost', type: 'negative', confidence: 0.81 });

    const r = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r.symptomsScanned).toBe(1);
    expect(r.rcasCreated).toBe(1);
    expect(r.factorsCreated).toBeGreaterThanOrEqual(3); // L0 + L1 + L2

    const factors = await env.DB.prepare(
      `SELECT layer, factor_type, title FROM causal_factors WHERE tenant_id = ? ORDER BY layer ASC`
    ).bind(TENANT).all<{ layer: string; factor_type: string; title: string }>();
    const layers = factors.results?.map((f) => f.layer) ?? [];
    expect(layers).toContain('L0');
    expect(layers).toContain('L1');
    expect(layers).toContain('L2');
  });

  it('signal drives a peer that drives the symptom → L3 transitive factor written', async () => {
    await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', domain: 'finance' });
    await seedMetric({ id: 'm-cost', name: 'Procurement Input Cost', status: 'amber', domain: 'procurement' });
    await seedSignal('sig-oil', 'oil.brent_spot');
    // Signal drives the *peer* (procurement cost), not the symptom directly.
    await seedSignalImpact({
      signalId: 'sig-oil', metricId: 'm-cost', metricName: 'Procurement Input Cost',
      signalTitle: 'Brent crude spot price',
    });
    // Symptom co-moves with the peer.
    await seedCorrelationEdge({ metricA: 'm-margin', metricB: 'm-cost', type: 'negative' });

    const r = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r.rcasCreated).toBe(1);

    const layers = await env.DB.prepare(
      `SELECT DISTINCT layer FROM causal_factors WHERE tenant_id = ? ORDER BY layer ASC`
    ).bind(TENANT).all<{ layer: string }>();
    const distinct = layers.results?.map((l) => l.layer) ?? [];
    expect(distinct).toContain('L0');
    expect(distinct).toContain('L2');
    expect(distinct).toContain('L3'); // transitive driver
  });

  it('green-only tenant produces no RCAs', async () => {
    await seedMetric({ id: 'm-x', name: 'M', status: 'green' });
    const r = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r.symptomsScanned).toBe(0);
    expect(r.rcasCreated).toBe(0);
  });

  it('red symptom with no signals AND no correlations is skipped (thin chain)', async () => {
    await seedMetric({ id: 'm-lonely', name: 'Lonely Metric', status: 'red' });
    const r = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r.symptomsScanned).toBe(1);
    expect(r.rcasCreated).toBe(0);
    expect(r.symptomsSkippedThin).toBe(1);
  });

  it('debounce: second sweep within 24h does not re-create the RCA', async () => {
    await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', domain: 'finance' });
    await seedMetric({ id: 'm-cost', name: 'Cost', status: 'amber', domain: 'procurement' });
    await seedSignal('sig-oil', 'oil.brent_spot');
    await seedSignalImpact({
      signalId: 'sig-oil', metricId: 'm-margin', metricName: 'Gross Margin',
    });
    await seedCorrelationEdge({ metricA: 'm-margin', metricB: 'm-cost' });

    const r1 = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r1.rcasCreated).toBe(1);

    const r2 = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r2.rcasCreated).toBe(0);
    expect(r2.symptomsSkippedDebounced).toBe(1);
    expect(await countRcas()).toBe(1);
  });

  it('caps each layer at MAX_LAYER_BREADTH=3 drivers', async () => {
    await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', domain: 'finance' });
    // 5 signal impacts on the symptom — should be clipped to 3.
    for (let i = 0; i < 5; i++) {
      await seedSignal(`sig-${i}`, `oil.spot_${i}`);
      await seedSignalImpact({
        signalId: `sig-${i}`, metricId: 'm-margin', metricName: 'Gross Margin',
        signalTitle: `Driver ${i}`,
      });
    }

    const r = await synthesizeCrossCatalystRca(env.DB, TENANT);
    expect(r.rcasCreated).toBe(1);

    const l1 = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM causal_factors WHERE tenant_id = ? AND layer = 'L1'`
    ).bind(TENANT).first<{ n: number }>();
    expect(l1?.n).toBe(3);
  });
});
