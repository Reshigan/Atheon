/**
 * Phase 10-19 — Shared-savings billing engine.
 *
 * Covers:
 *  Pure builder
 *   1. Eligibility: RCA without verified action → excluded
 *   2. Eligibility: RCA without impact_value → excluded
 *   3. Eligibility: passes all gates → line item with attributed_savings
 *   4. Total + revenue: revenue = total × share_pct
 *
 *  End-to-end via DB
 *   5. Resolved RCA + verified action + impact_value → 1 line item,
 *      revenue = sum × default 20%
 *   6. Per-tenant share override (50%) applied
 *   7. Idempotent on (tenant, period_start, period_end) — re-running
 *      replaces line items rather than duplicating
 *   8. Resolved-outside-period excluded
 *   9. Currency reflected from tenant currency
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  buildBillablePeriod,
  computeBillablePeriod,
} from '../services/billing-engine';
import { _resetCurrencyCacheForTests } from '../services/tenant-currency';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'bill-tenant';

async function seedTenant(region = 'af-south-1'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status, region)
     VALUES (?, ?, ?, 'enterprise', 'active', ?)`
  ).bind(TENANT, TENANT, TENANT, region).run();
}

async function seedShare(value: number): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
     VALUES (?, ?, 'billing_share_pct', ?, datetime('now'))`
  ).bind(crypto.randomUUID(), TENANT, JSON.stringify(value)).run();
}

async function seedResolvedRca(opts: {
  id: string; metricName: string; resolvedAtOffset?: string; confidence?: number;
}): Promise<void> {
  const offset = opts.resolvedAtOffset ?? '-3 days';
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at, resolved_at)
     VALUES (?, ?, ?, ?, 'red', '[]', ?, 'resolved', datetime('now', ?), datetime('now', ?))`
  ).bind(
    opts.id, TENANT, `m-${opts.id}`, opts.metricName,
    opts.confidence ?? 80,
    offset, // both generated_at and resolved_at use same offset for simplicity
    offset,
  ).run();
}

async function seedFactor(rcaId: string, impactValue: number): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO causal_factors
       (id, rca_id, tenant_id, layer, factor_type, title, description, evidence,
        impact_value, impact_unit, confidence, created_at)
     VALUES (?, ?, ?, 'L1', 'external_driver', 'driver', '', '{}', ?, 'ZAR', 80, datetime('now'))`
  ).bind(id, rcaId, TENANT, impactValue).run();
  return id;
}

async function seedPrescription(rcaId: string): Promise<string> {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO diagnostic_prescriptions
       (id, rca_id, tenant_id, priority, title, description, effort_level, status, created_at)
     VALUES (?, ?, ?, 'short-term', 'fix', '', 'medium', 'pending', datetime('now'))`
  ).bind(id, rcaId, TENANT).run();
  return id;
}

async function seedVerifiedAction(prescriptionId: string): Promise<string> {
  const id = crypto.randomUUID();
  // catalyst_actions schema requires cluster_id; create one quickly
  const clusterId = `c-${id}`;
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status)
     VALUES (?, ?, 'cluster', 'general', 'active')`
  ).bind(clusterId, TENANT).run();
  await env.DB.prepare(
    `INSERT INTO catalyst_actions
       (id, cluster_id, tenant_id, catalyst_name, action, status, source_finding_id,
        verification_status, verified_at, completed_at, created_at)
     VALUES (?, ?, ?, 'cat', 'fix', 'completed', ?, 'verified', datetime('now'),
             datetime('now', '-3 days'), datetime('now', '-3 days'))`
  ).bind(id, clusterId, TENANT, prescriptionId).run();
  return id;
}

describe('Phase 10-19 — shared-savings billing engine', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    _resetCurrencyCacheForTests();
    await env.DB.prepare('DELETE FROM billable_line_items WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM billable_periods WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM diagnostic_prescriptions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM causal_factors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare(
      `DELETE FROM tenant_settings WHERE tenant_id = ? AND key = 'billing_share_pct'`
    ).bind(TENANT).run();
  });

  describe('buildBillablePeriod (pure)', () => {
    const baseInput = {
      tenantId: TENANT, periodStart: '2026-04-01', periodEnd: '2026-05-01',
      currency: 'ZAR', sharePct: 0.2,
    };

    it('RCA without verified action → excluded', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [{ id: 'r1', metric_id: 'm1', metric_name: 'M', resolved_at: '2026-04-15', confidence: 80 }],
        factorAgg: new Map([['r1', { max: 1_000_000, count: 1 }]]),
        verifiedActions: new Map(), // no verified actions
      });
      expect(period.line_items.length).toBe(0);
      expect(period.atheon_revenue).toBe(0);
    });

    it('RCA without impact_value → excluded', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [{ id: 'r1', metric_id: 'm1', metric_name: 'M', resolved_at: '2026-04-15', confidence: 80 }],
        factorAgg: new Map(),
        verifiedActions: new Map([['r1', ['a1']]]),
      });
      expect(period.line_items.length).toBe(0);
    });

    it('passes all gates → line item with attributed_savings', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [{ id: 'r1', metric_id: 'm1', metric_name: 'Margin', resolved_at: '2026-04-15', confidence: 90 }],
        factorAgg: new Map([['r1', { max: 5_000_000, count: 2 }]]),
        verifiedActions: new Map([['r1', ['a1']]]),
      });
      expect(period.line_items.length).toBe(1);
      expect(period.line_items[0].attributed_savings).toBe(5_000_000);
      expect(period.line_items[0].evidence.verified_action_ids).toEqual(['a1']);
      expect(period.line_items[0].confidence).toBeCloseTo(0.9, 2);
    });

    it('records the causal_factor_id that produced the attributed savings', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [{ id: 'r1', metric_id: 'm1', metric_name: 'Margin', resolved_at: '2026-04-15', confidence: 90 }],
        factorAgg: new Map([['r1', { max: 5_000_000, count: 2, factorId: 'cf-top' }]]),
        verifiedActions: new Map([['r1', ['a1']]]),
      });
      expect(period.line_items[0].evidence.causal_factor_id).toBe('cf-top');
    });

    it('causal_factor_id is null when the aggregate omits it', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [{ id: 'r1', metric_id: 'm1', metric_name: 'Margin', resolved_at: '2026-04-15', confidence: 90 }],
        factorAgg: new Map([['r1', { max: 5_000_000, count: 1 }]]),
        verifiedActions: new Map([['r1', ['a1']]]),
      });
      expect(period.line_items[0].evidence.causal_factor_id).toBeNull();
    });

    it('total + revenue arithmetic', () => {
      const period = buildBillablePeriod({
        ...baseInput,
        rcas: [
          { id: 'r1', metric_id: 'm1', metric_name: 'A', resolved_at: '2026-04-15', confidence: 80 },
          { id: 'r2', metric_id: 'm2', metric_name: 'B', resolved_at: '2026-04-20', confidence: 80 },
        ],
        factorAgg: new Map([
          ['r1', { max: 5_000_000, count: 1 }],
          ['r2', { max: 3_000_000, count: 1 }],
        ]),
        verifiedActions: new Map([['r1', ['a1']], ['r2', ['a2']]]),
      });
      expect(period.total_realised_savings).toBe(8_000_000);
      expect(period.atheon_revenue).toBe(1_600_000); // 8M × 20%
    });
  });

  describe('computeBillablePeriod end-to-end', () => {
    it('persists 1 line item; revenue = 20% of impact', async () => {
      await seedResolvedRca({ id: 'rca-1', metricName: 'Margin', resolvedAtOffset: '-15 days' });
      await seedFactor('rca-1', 5_000_000);
      const pid = await seedPrescription('rca-1');
      await seedVerifiedAction(pid);

      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(); monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);

      const r = await computeBillablePeriod(env.DB, TENANT, {
        periodStart: start, periodEnd: today, persist: true,
      });
      expect(r.persisted).toBe(true);
      expect(r.lineItemsInserted).toBe(1);
      expect(r.period.total_realised_savings).toBe(5_000_000);
      expect(r.period.atheon_revenue).toBe(1_000_000); // 5M × 0.2
      expect(r.period.currency).toBe('ZAR');

      const row = await env.DB.prepare(
        `SELECT total_realised_savings, atheon_revenue, currency FROM billable_periods WHERE tenant_id = ?`
      ).bind(TENANT).first<{ total_realised_savings: number; atheon_revenue: number; currency: string }>();
      expect(row?.atheon_revenue).toBe(1_000_000);
    });

    it('traces attributed_savings to the highest-impact causal factor id', async () => {
      await seedResolvedRca({ id: 'rca-trace', metricName: 'Margin', resolvedAtOffset: '-12 days' });
      const lowId = await seedFactor('rca-trace', 2_000_000);
      const highId = await seedFactor('rca-trace', 5_000_000);
      const pid = await seedPrescription('rca-trace');
      await seedVerifiedAction(pid);

      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(); monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);

      const r = await computeBillablePeriod(env.DB, TENANT, {
        periodStart: start, periodEnd: today, persist: true,
      });
      expect(r.lineItemsInserted).toBe(1);
      expect(r.period.line_items[0].attributed_savings).toBe(5_000_000);
      expect(r.period.line_items[0].evidence.causal_factor_id).toBe(highId);
      expect(r.period.line_items[0].evidence.causal_factor_id).not.toBe(lowId);

      // The persisted evidence JSON carries the link so the audit pack can
      // trace each claimed dollar back to a single quantified causal factor.
      const row = await env.DB.prepare(
        `SELECT evidence FROM billable_line_items WHERE tenant_id = ? AND rca_id = 'rca-trace'`
      ).bind(TENANT).first<{ evidence: string }>();
      const ev = JSON.parse(row!.evidence) as { causal_factor_id: string };
      expect(ev.causal_factor_id).toBe(highId);
    });

    it('per-tenant share override applied (50%)', async () => {
      await seedShare(0.5);
      await seedResolvedRca({ id: 'rca-2', metricName: 'M', resolvedAtOffset: '-10 days' });
      await seedFactor('rca-2', 2_000_000);
      const pid = await seedPrescription('rca-2');
      await seedVerifiedAction(pid);

      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(); monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);
      const r = await computeBillablePeriod(env.DB, TENANT, {
        periodStart: start, periodEnd: today, persist: false,
      });
      expect(r.period.share_pct).toBe(0.5);
      expect(r.period.atheon_revenue).toBe(1_000_000); // 2M × 50%
    });

    it('idempotent: re-running replaces line items', async () => {
      await seedResolvedRca({ id: 'rca-3', metricName: 'M', resolvedAtOffset: '-5 days' });
      await seedFactor('rca-3', 1_000_000);
      const pid = await seedPrescription('rca-3');
      await seedVerifiedAction(pid);

      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(); monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);

      await computeBillablePeriod(env.DB, TENANT, { periodStart: start, periodEnd: today, persist: true });
      await computeBillablePeriod(env.DB, TENANT, { periodStart: start, periodEnd: today, persist: true });

      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM billable_periods WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(cnt?.n).toBe(1);
      const items = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM billable_line_items WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(items?.n).toBe(1);
    });

    it('RCA resolved outside the period → excluded', async () => {
      await seedResolvedRca({ id: 'rca-old', metricName: 'M', resolvedAtOffset: '-200 days' });
      await seedFactor('rca-old', 1_000_000);
      const pid = await seedPrescription('rca-old');
      await seedVerifiedAction(pid);

      const today = new Date().toISOString().slice(0, 10);
      const monthAgo = new Date(); monthAgo.setUTCDate(monthAgo.getUTCDate() - 30);
      const start = monthAgo.toISOString().slice(0, 10);
      const r = await computeBillablePeriod(env.DB, TENANT, { periodStart: start, periodEnd: today, persist: false });
      expect(r.period.line_items.length).toBe(0);
    });
  });
});
