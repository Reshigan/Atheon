/**
 * Phase 10-5 — Apex narrative engine + RCA closure.
 *
 * Covers:
 *  Narrative
 *   1. Tenant with 1 active RCA → 1 executive_briefings row with risks/kpis/opps populated
 *   2. Tenant with no RCAs → no briefing
 *   3. 20-hour debounce: second run within window does not re-create
 *   4. Recently-resolved RCA → opportunities bullet
 *  Closure
 *   5. Active RCA + symptom now green for ≥3 samples → resolved
 *   6. Active RCA + symptom still red → not resolved
 *   7. Active RCA + symptom green but only 1 sample → skipped insufficient history
 *   8. Lower-better metric (e.g. defect rate) recovers → resolved
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  generateApexNarrative,
  closeRecoveredRcas,
} from '../services/apex-narrative-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'narr-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

interface MetricSeed {
  id: string; name: string; status: 'green' | 'amber' | 'red'; value?: number;
  thresholdGreen?: number; thresholdAmber?: number; thresholdRed?: number;
}
async function seedMetric(opts: MetricSeed): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, threshold_red,
        threshold_amber, threshold_green, measured_at)
     VALUES (?, ?, ?, ?, 'unit', ?, ?, ?, ?, datetime('now'))`
  ).bind(
    opts.id, TENANT, opts.name, opts.value ?? 90, opts.status,
    opts.thresholdRed ?? 40, opts.thresholdAmber ?? 60, opts.thresholdGreen ?? 80,
  ).run();
}

async function seedHistory(metricId: string, values: number[]): Promise<void> {
  for (let i = 0; i < values.length; i++) {
    const offset = i; // 0 = most recent
    await env.DB.prepare(
      `INSERT INTO process_metric_history (id, tenant_id, metric_id, value, recorded_at)
       VALUES (?, ?, ?, ?, datetime('now', '-' || ? || ' hours'))`
    ).bind(crypto.randomUUID(), TENANT, metricId, values[i], offset).run();
  }
}

interface RcaSeed {
  id: string; metricId: string; metricName: string;
  triggerStatus?: string; status?: 'active' | 'resolved';
  generatedAtOffset?: string; resolvedAtOffset?: string; confidence?: number;
}
async function seedRca(opts: RcaSeed): Promise<void> {
  const status = opts.status ?? 'active';
  const generated = opts.generatedAtOffset ?? '-1 hours';
  await env.DB.prepare(
    `INSERT INTO root_cause_analyses
       (id, tenant_id, metric_id, metric_name, trigger_status, causal_chain,
        confidence, status, generated_at, resolved_at)
     VALUES (?, ?, ?, ?, ?, '[]', ?, ?, datetime('now', ?), ?)`
  ).bind(
    opts.id, TENANT, opts.metricId, opts.metricName,
    opts.triggerStatus ?? 'red', opts.confidence ?? 80, status, generated,
    status === 'resolved' && opts.resolvedAtOffset
      ? `datetime('now', '${opts.resolvedAtOffset}')`
      : null,
  ).run();
  if (status === 'resolved' && opts.resolvedAtOffset) {
    await env.DB.prepare(
      `UPDATE root_cause_analyses SET resolved_at = datetime('now', ?) WHERE id = ?`
    ).bind(opts.resolvedAtOffset, opts.id).run();
  }
}

async function seedFactor(rcaId: string, layer: string, title: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO causal_factors
       (id, rca_id, tenant_id, layer, factor_type, title, description, evidence,
        impact_value, impact_unit, confidence, created_at)
     VALUES (?, ?, ?, ?, 'symptom', ?, '', '{}', null, 'ZAR', 80, datetime('now'))`
  ).bind(crypto.randomUUID(), rcaId, TENANT, layer, title).run();
}

describe('Phase 10-5 — Apex narrative engine + RCA closure', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM executive_briefings WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM causal_factors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM root_cause_analyses WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metric_history WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('generateApexNarrative', () => {
    it('1 active RCA → 1 briefing with risks, kpi_movements populated', async () => {
      await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', value: 12 });
      await seedRca({ id: 'rca1', metricId: 'm-margin', metricName: 'Gross Margin' });
      await seedFactor('rca1', 'L0', 'Gross Margin degraded to red');
      await seedFactor('rca1', 'L1', 'Brent crude +22% driving Gross Margin (headwind)');
      await seedFactor('rca1', 'L2', 'Procurement Input Cost co-moves with Gross Margin');

      const r = await generateApexNarrative(env.DB, TENANT);
      expect(r.briefingsCreated).toBe(1);
      expect(r.activeRcasConsidered).toBe(1);
      expect(r.skippedDebounced).toBe(false);

      const row = await env.DB.prepare(
        `SELECT title, summary, risks, kpi_movements FROM executive_briefings WHERE tenant_id = ?`
      ).bind(TENANT).first<{ title: string; summary: string; risks: string; kpi_movements: string }>();
      expect(row).not.toBeNull();
      expect(row!.title).toContain('Gross Margin');
      const risks = JSON.parse(row!.risks) as Array<{ metric: string; causal_chain: string; drivers: string[] }>;
      expect(risks.length).toBe(1);
      expect(risks[0].metric).toBe('Gross Margin');
      expect(risks[0].causal_chain).toContain('Gross Margin');
      expect(risks[0].drivers.length).toBeGreaterThan(0);
      const kpis = JSON.parse(row!.kpi_movements) as Array<{ metric: string; value: number }>;
      expect(kpis.find((k) => k.metric === 'Gross Margin')).toBeTruthy();
    });

    it('no RCAs and no recent recoveries → no briefing emitted', async () => {
      const r = await generateApexNarrative(env.DB, TENANT);
      expect(r.briefingsCreated).toBe(0);
      expect(r.skippedDebounced).toBe(false);
    });

    it('debounce: second run within 20h does not re-create', async () => {
      await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', value: 12 });
      await seedRca({ id: 'rca1', metricId: 'm-margin', metricName: 'Gross Margin' });

      const r1 = await generateApexNarrative(env.DB, TENANT);
      expect(r1.briefingsCreated).toBe(1);
      const r2 = await generateApexNarrative(env.DB, TENANT);
      expect(r2.briefingsCreated).toBe(0);
      expect(r2.skippedDebounced).toBe(true);

      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM executive_briefings WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(cnt?.n).toBe(1);
    });

    it('recently-resolved RCA → opportunities bullet in briefing', async () => {
      await seedMetric({ id: 'm-rev', name: 'Revenue', status: 'green', value: 100 });
      await seedRca({
        id: 'rca-resolved', metricId: 'm-rev', metricName: 'Revenue',
        status: 'resolved', resolvedAtOffset: '-2 hours',
      });
      const r = await generateApexNarrative(env.DB, TENANT);
      expect(r.briefingsCreated).toBe(1);

      const row = await env.DB.prepare(
        `SELECT opportunities FROM executive_briefings WHERE tenant_id = ?`
      ).bind(TENANT).first<{ opportunities: string }>();
      const opps = JSON.parse(row!.opportunities) as Array<{ metric: string; message: string }>;
      expect(opps.length).toBe(1);
      expect(opps[0].metric).toBe('Revenue');
      expect(opps[0].message).toContain('recovered');
    });
  });

  describe('closeRecoveredRcas', () => {
    it('symptom now green and held for ≥3 samples → RCA resolved + notification', async () => {
      await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'green', value: 90 });
      await seedHistory('m-margin', [90, 88, 85]); // all above red=40, all "recovered"
      await seedRca({ id: 'rca1', metricId: 'm-margin', metricName: 'Gross Margin' });

      const r = await closeRecoveredRcas(env.DB, TENANT);
      expect(r.rcasScanned).toBe(1);
      expect(r.rcasResolved).toBe(1);

      const rca = await env.DB.prepare(
        `SELECT status, resolved_at FROM root_cause_analyses WHERE id = ?`
      ).bind('rca1').first<{ status: string; resolved_at: string | null }>();
      expect(rca!.status).toBe('resolved');
      expect(rca!.resolved_at).not.toBeNull();

      const notif = await env.DB.prepare(
        `SELECT title FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`
      ).bind(TENANT).first<{ title: string }>();
      expect(notif?.title).toContain('Gross Margin');
    });

    it('symptom still red → RCA stays active', async () => {
      await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'red', value: 12 });
      await seedHistory('m-margin', [12, 14, 18]);
      await seedRca({ id: 'rca1', metricId: 'm-margin', metricName: 'Gross Margin' });

      const r = await closeRecoveredRcas(env.DB, TENANT);
      expect(r.rcasResolved).toBe(0);

      const rca = await env.DB.prepare(
        `SELECT status FROM root_cause_analyses WHERE id = ?`
      ).bind('rca1').first<{ status: string }>();
      expect(rca!.status).toBe('active');
    });

    it('symptom green but only 1 history point → skipped (insufficient history)', async () => {
      await seedMetric({ id: 'm-margin', name: 'Gross Margin', status: 'green', value: 90 });
      await seedHistory('m-margin', [90]);
      await seedRca({ id: 'rca1', metricId: 'm-margin', metricName: 'Gross Margin' });

      const r = await closeRecoveredRcas(env.DB, TENANT);
      expect(r.rcasResolved).toBe(0);
      expect(r.rcasSkippedInsufficientHistory).toBe(1);
    });

    it('lower-better metric (defect rate) recovers below red → resolved', async () => {
      // Defect rate: green=2, amber=5, red=10 (lower is better)
      await seedMetric({
        id: 'm-defect', name: 'Defect Rate', status: 'green', value: 1.5,
        thresholdGreen: 2, thresholdAmber: 5, thresholdRed: 10,
      });
      await seedHistory('m-defect', [1.5, 1.8, 2.1]); // all below red=10 → recovered
      await seedRca({ id: 'rca1', metricId: 'm-defect', metricName: 'Defect Rate' });

      const r = await closeRecoveredRcas(env.DB, TENANT);
      expect(r.rcasResolved).toBe(1);
    });
  });
});
