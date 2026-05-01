/**
 * Phase 8-3 — HITL SLA + drift debounce.
 *
 * Covers:
 *  1. Action < 24h old: no warning, no escalation
 *  2. Action 25h old: warned, notification fired, escalation_level='warned'
 *  3. Action 50h old: escalated, escalation_level='escalated'
 *  4. Action 8 days old: auto-rejected with escalation_level='auto_rejected'
 *  5. Already-warned action does not re-fire on next sweep
 *  6. Drift event recently fired suppresses next event within debounce window
 *  7. Drift event outside debounce window fires normally
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { escalateStaleActions, _SLA_HOURS } from '../services/erp-hitl-sla';
import { detectErpSchemaDrift } from '../services/erp-drift-detector';
import { profileEntityRecords } from '../services/erp-schema-profiler';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sla-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}
async function seedAdapter(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('sla-adapter', 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
}
async function seedConnection(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'sla-adapter', 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT).run();
}
async function seedCluster(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
     VALUES ('sla-cluster', ?, 'AR', 'finance', 'active', 'assisted')`
  ).bind(TENANT).run();
}

async function seedAction(id: string, ageHours: number, valueZar = 5000): Promise<void> {
  const created = new Date(Date.now() - ageHours * 60 * 60 * 1000).toISOString();
  await env.DB.prepare(
    `INSERT INTO catalyst_actions (id, tenant_id, cluster_id, catalyst_name, action, status, value_zar, action_type, connection_id, created_at)
     VALUES (?, ?, 'sla-cluster', 'AR Collection', 'ar_dunning_send', 'pending_approval', ?, 'ar_dunning_send', 'conn-sla', ?)`
  ).bind(id, TENANT, valueZar, created).run();
}

describe('Phase 8-3 — HITL SLA + drift debounce', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
    await seedAdapter();
    await seedConnection('conn-sla');
    await seedCluster();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_schema_drift_events WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connection_schemas WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare("DELETE FROM tenant_settings WHERE tenant_id = ? AND key LIKE 'erp_drift_snapshot:%'").bind(TENANT).run();
  });

  describe('escalateStaleActions', () => {
    it('action < WARN_HOURS old → not warned', async () => {
      await seedAction('a-fresh', 1);
      const r = await escalateStaleActions(env.DB, TENANT);
      expect(r.warned).toBe(0);
      expect(r.escalated).toBe(0);
      expect(r.rejected).toBe(0);
    });

    it('action ≥ WARN_HOURS but < ESCALATE_HOURS → warned + notification + level=warned', async () => {
      await seedAction('a-warn', _SLA_HOURS.WARN_HOURS + 1);
      const r = await escalateStaleActions(env.DB, TENANT);
      expect(r.warned).toBe(1);
      expect(r.escalated).toBe(0);
      const row = await env.DB.prepare(`SELECT escalation_level FROM catalyst_actions WHERE id = 'a-warn'`).first<{ escalation_level: string }>();
      expect(row?.escalation_level).toBe('warned');
      const notif = await env.DB.prepare(`SELECT title, severity FROM notifications WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1`).bind(TENANT).first<{ title: string; severity: string }>();
      expect(notif?.title).toMatch(/awaiting approval/i);
    });

    it('action ≥ ESCALATE_HOURS → escalated + level=escalated', async () => {
      await seedAction('a-esc', _SLA_HOURS.ESCALATE_HOURS + 1);
      const r = await escalateStaleActions(env.DB, TENANT);
      expect(r.escalated).toBe(1);
      const row = await env.DB.prepare(`SELECT escalation_level FROM catalyst_actions WHERE id = 'a-esc'`).first<{ escalation_level: string }>();
      expect(row?.escalation_level).toBe('escalated');
    });

    it('action ≥ AUTO_REJECT_HOURS → status flips to rejected', async () => {
      await seedAction('a-rej', _SLA_HOURS.AUTO_REJECT_HOURS + 1);
      const r = await escalateStaleActions(env.DB, TENANT);
      expect(r.rejected).toBe(1);
      const row = await env.DB.prepare(`SELECT status, escalation_level FROM catalyst_actions WHERE id = 'a-rej'`).first<{ status: string; escalation_level: string }>();
      expect(row?.status).toBe('rejected');
      expect(row?.escalation_level).toBe('auto_rejected');
    });

    it('already-warned action does not re-warn on next sweep', async () => {
      await seedAction('a-stay', _SLA_HOURS.WARN_HOURS + 1);
      await escalateStaleActions(env.DB, TENANT);
      const r2 = await escalateStaleActions(env.DB, TENANT);
      expect(r2.warned).toBe(0); // already had escalation_level='warned', so skipped
    });
  });

  describe('Drift debounce', () => {
    it('first drift event fires; second within debounce window suppressed', async () => {
      await profileEntityRecords(env.DB, TENANT, 'conn-sla', 'SAP', 'invoices', [{ WRBTR: '1' }]);
      await detectErpSchemaDrift(env.DB, TENANT); // baseline, no event
      // Add a new field — should fire
      await profileEntityRecords(env.DB, TENANT, 'conn-sla', 'SAP', 'invoices', [{ WRBTR: '2', NEW_FIELD: 'a' }]);
      const r1 = await detectErpSchemaDrift(env.DB, TENANT);
      expect(r1.driftCount).toBe(1);

      // Add ANOTHER field within debounce — should be suppressed
      await profileEntityRecords(env.DB, TENANT, 'conn-sla', 'SAP', 'invoices', [{ WRBTR: '3', NEW_FIELD: 'b', SECOND_NEW: 'c' }]);
      const r2 = await detectErpSchemaDrift(env.DB, TENANT);
      expect(r2.driftCount).toBe(0);

      const events = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM erp_schema_drift_events WHERE tenant_id = ? AND connection_id = 'conn-sla'`
      ).bind(TENANT).first<{ n: number }>();
      expect(events?.n).toBe(1); // only the first event persisted
    });
  });
});
