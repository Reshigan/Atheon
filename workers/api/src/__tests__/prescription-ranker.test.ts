/**
 * Phase 10-13 — Prescription ranker.
 *
 * Covers:
 *  Pure scoring
 *   1. High impact + high confidence + low effort → highest score
 *   2. Low effort beats high effort at equal impact + confidence
 *   3. Missing impact → falls back to priority_tag heuristic
 *
 *  End-to-end with seeded RCAs + prescriptions
 *   4. Two RCAs (R10M impact + R200K impact) → R10M's prescriptions
 *      rank above R200K's for equal effort
 *   5. Tenant with no active RCAs → empty array
 *   6. Pending-only filter: completed prescriptions excluded
 *   7. Sort order is stable: priority_score desc
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  computePriorityScore,
  getPrioritisedPrescriptions,
} from '../services/prescription-ranker';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'rank-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedRca(opts: {
  id: string; metricName: string; confidence: number;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at)
     VALUES (?, ?, ?, ?, 'red', '[]', ?, 'active', datetime('now'))`
  ).bind(opts.id, TENANT, `m-${opts.id}`, opts.metricName, opts.confidence).run();
}

async function seedFactor(rcaId: string, impactValue: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO causal_factors
       (id, rca_id, tenant_id, layer, factor_type, title, description, evidence,
        impact_value, impact_unit, confidence, created_at)
     VALUES (?, ?, ?, 'L1', 'external_driver', 'driver', '', '{}', ?, 'ZAR', 80, datetime('now'))`
  ).bind(crypto.randomUUID(), rcaId, TENANT, impactValue).run();
}

async function seedPrescription(opts: {
  rcaId: string; title: string; effort: 'low' | 'medium' | 'high';
  priority?: 'immediate' | 'short-term' | 'strategic';
  status?: 'pending' | 'completed';
}): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, priority, title, description, effort_level, status, created_at)
     VALUES (?, ?, ?, ?, ?, '', ?, ?, datetime('now'))`
  ).bind(
    id, opts.rcaId, TENANT, opts.priority ?? 'short-term',
    opts.title, opts.effort, opts.status ?? 'pending',
  ).run();
  return id;
}

describe('Phase 10-13 — prescription ranker', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM diagnostic_prescriptions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM causal_factors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('computePriorityScore', () => {
    it('high impact + high confidence + low effort → high score', () => {
      const r = computePriorityScore({
        rcaConfidence: 95, rcaImpactNormalised: 1.0,
        effortLevel: 'low', priorityTag: 'immediate',
      });
      expect(r.score).toBeCloseTo(0.95, 2);
      expect(r.components.impact_basis).toBe('monetary');
    });
    it('low effort beats high effort at equal impact + confidence', () => {
      const low = computePriorityScore({ rcaConfidence: 80, rcaImpactNormalised: 0.7, effortLevel: 'low', priorityTag: 'short-term' });
      const high = computePriorityScore({ rcaConfidence: 80, rcaImpactNormalised: 0.7, effortLevel: 'high', priorityTag: 'short-term' });
      expect(low.score).toBeGreaterThan(high.score);
      expect(low.components.effort_weight).toBe(1);
      expect(high.components.effort_weight).toBe(3);
    });
    it('missing impact → falls back to priority_tag heuristic', () => {
      const r = computePriorityScore({
        rcaConfidence: 80, rcaImpactNormalised: 0,
        effortLevel: 'medium', priorityTag: 'immediate',
      });
      expect(r.components.impact_basis).toBe('priority_tag');
      expect(r.components.impact_score).toBe(0.9); // immediate
      expect(r.score).toBeCloseTo(0.9 * 0.8 / 2, 3);
    });
    it('unknown effort_level → defaults to medium (weight=2)', () => {
      const r = computePriorityScore({
        rcaConfidence: 80, rcaImpactNormalised: 0.5,
        effortLevel: 'unknown', priorityTag: 'short-term',
      });
      expect(r.components.effort_weight).toBe(2);
    });
  });

  describe('getPrioritisedPrescriptions (end-to-end)', () => {
    it('two RCAs (R10M + R200K) → R10M prescriptions rank above R200K', async () => {
      await seedRca({ id: 'rca-big', metricName: 'Margin', confidence: 90 });
      await seedRca({ id: 'rca-small', metricName: 'Stock', confidence: 90 });
      await seedFactor('rca-big', 10_000_000);
      await seedFactor('rca-small', 200_000);
      const bigId = await seedPrescription({ rcaId: 'rca-big', title: 'Renegotiate contracts', effort: 'medium' });
      const smallId = await seedPrescription({ rcaId: 'rca-small', title: 'Improve stock count', effort: 'medium' });

      const ranked = await getPrioritisedPrescriptions(env.DB, TENANT);
      expect(ranked.length).toBe(2);
      expect(ranked[0].id).toBe(bigId);
      expect(ranked[1].id).toBe(smallId);
      expect(ranked[0].priority_score).toBeGreaterThan(ranked[1].priority_score);
      expect(ranked[0].rca_metric_name).toBe('Margin');
    });

    it('no active RCAs → empty array', async () => {
      const ranked = await getPrioritisedPrescriptions(env.DB, TENANT);
      expect(ranked).toEqual([]);
    });

    it('pending-only: completed prescriptions excluded', async () => {
      await seedRca({ id: 'rca-x', metricName: 'X', confidence: 80 });
      await seedFactor('rca-x', 100_000);
      await seedPrescription({ rcaId: 'rca-x', title: 'Pending one', effort: 'low' });
      await seedPrescription({ rcaId: 'rca-x', title: 'Already done', effort: 'low', status: 'completed' });

      const ranked = await getPrioritisedPrescriptions(env.DB, TENANT);
      expect(ranked.length).toBe(1);
      expect(ranked[0].title).toBe('Pending one');
    });

    it('sort order is priority_score desc', async () => {
      await seedRca({ id: 'rca-1', metricName: 'M1', confidence: 80 });
      await seedFactor('rca-1', 1_000_000);
      // 3 prescriptions with different efforts on same RCA → low > medium > high
      await seedPrescription({ rcaId: 'rca-1', title: 'A medium', effort: 'medium' });
      await seedPrescription({ rcaId: 'rca-1', title: 'B low', effort: 'low' });
      await seedPrescription({ rcaId: 'rca-1', title: 'C high', effort: 'high' });

      const ranked = await getPrioritisedPrescriptions(env.DB, TENANT);
      expect(ranked.map((r) => r.title)).toEqual(['B low', 'A medium', 'C high']);
    });
  });
});
