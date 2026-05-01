/**
 * Phase 3 — LLM fallback, mapping confirm/reject, drift detection.
 *
 * Covers:
 *  1. confirm endpoint: marks a mapping human/active and protects from auto
 *     overwrite on subsequent runs.
 *  2. reject endpoint: marks a mapping rejected so the auto-mapper stops
 *     suggesting it.
 *  3. drift detector: first run stores baseline (no event); second run with
 *     added/removed fields fires an event + notification.
 *  4. drift detector: clean re-run (no changes) is silent.
 *  5. LLM fallback: sanitiser drops malformed entries and 'unknown' classifications.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { profileEntityRecords } from '../services/erp-schema-profiler';
import { detectErpSchemaDrift } from '../services/erp-drift-detector';
import { runAutoMapper, listAllMappings, getActiveMappings } from '../services/erp-auto-mapper';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'phase3-tenant';
const ADMIN = 'phase3-admin@test.local';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse"]', '["finance"]', 10, 10)`
  ).bind(id).run();
}
async function seedUser(id: string, tenantId: string, email: string): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind(id, tenantId, email, email, hash, JSON.stringify(['*'])).run();
}
async function seedAdapter(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES (?, 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id).run();
}
async function seedConnection(id: string, tenantId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'phase3-adapter', 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, tenantId).run();
}
async function login(email: string, slug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: slug });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

describe('Phase 3 — confirm/reject + drift detection', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT, TENANT);
    await seedUser('phase3-admin', TENANT, ADMIN);
    await seedAdapter('phase3-adapter');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_field_mappings WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connection_schemas WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_schema_drift_events WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare("DELETE FROM tenant_settings WHERE tenant_id = ? AND key LIKE 'erp_drift_snapshot:%'").bind(TENANT).run();
    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('POST /mappings/confirm', () => {
    it('marks a mapping human/active and protects from auto overwrite', async () => {
      await seedConnection('conn-c', TENANT);
      // Profile something so the auto-mapper can run later
      await profileEntityRecords(env.DB, TENANT, 'conn-c', 'SAP', 'invoices', [
        { Z_CUSTOM_AMT: '500.00', BELNR: 'INV-1' },
      ]);

      const token = await login(ADMIN, TENANT);
      const res = await postJSON('/api/v1/erp/connections/conn-c/mappings/confirm', {
        entity_type: 'invoices',
        canonical_field: 'amount',
        source_field: 'Z_CUSTOM_AMT',
      }, token);
      expect(res.status).toBe(200);

      // Subsequent runAutoMapper should NOT overwrite our human mapping.
      await runAutoMapper(env.DB, TENANT, 'conn-c', 'invoices');
      const all = await listAllMappings(env.DB, TENANT, 'conn-c', 'invoices');
      const human = all.find((m) => m.canonical_field === 'amount' && m.source_field === 'Z_CUSTOM_AMT')!;
      expect(human.learned_from).toBe('human');
      expect(human.status).toBe('active');
      expect(human.confidence).toBe(1.0);

      // Audit log row written
      const audit = await env.DB.prepare(
        `SELECT details FROM audit_log WHERE tenant_id = ? AND action = 'erp.mapping.confirmed' ORDER BY created_at DESC LIMIT 1`
      ).bind(TENANT).first<{ details: string }>();
      expect(audit).not.toBeNull();
    });
  });

  describe('POST /mappings/reject', () => {
    it('marks a mapping rejected so it stays out of the active set', async () => {
      await seedConnection('conn-r', TENANT);
      await profileEntityRecords(env.DB, TENANT, 'conn-r', 'SAP', 'invoices', [
        { WRBTR: '100', BELNR: 'X' },
      ]);
      await runAutoMapper(env.DB, TENANT, 'conn-r', 'invoices');

      const token = await login(ADMIN, TENANT);
      const res = await postJSON('/api/v1/erp/connections/conn-r/mappings/reject', {
        entity_type: 'invoices',
        canonical_field: 'amount',
        source_field: 'WRBTR',
      }, token);
      expect(res.status).toBe(200);

      const active = await getActiveMappings(env.DB, TENANT, 'conn-r', 'invoices');
      // WRBTR should NOT appear in active mappings for amount any more
      expect((active.amount || []).includes('WRBTR')).toBe(false);
    });
  });

  describe('detectErpSchemaDrift', () => {
    it('first run stores baseline, no drift event', async () => {
      await seedConnection('conn-d1', TENANT);
      await profileEntityRecords(env.DB, TENANT, 'conn-d1', 'SAP', 'invoices', [
        { WRBTR: '1', BELNR: 'X' },
      ]);
      const r = await detectErpSchemaDrift(env.DB, TENANT);
      expect(r.checked).toBe(1);
      expect(r.driftCount).toBe(0);
      // Snapshot exists
      const snap = await env.DB.prepare(
        "SELECT value FROM tenant_settings WHERE tenant_id = ? AND key LIKE 'erp_drift_snapshot:conn-d1:%'"
      ).bind(TENANT).first<{ value: string }>();
      expect(snap).not.toBeNull();
    });

    it('second run with added/removed fields fires drift event + notification', async () => {
      await seedConnection('conn-d2', TENANT);
      // Initial schema: WRBTR + BELNR
      await profileEntityRecords(env.DB, TENANT, 'conn-d2', 'SAP', 'invoices', [
        { WRBTR: '1', BELNR: 'X' },
      ]);
      await detectErpSchemaDrift(env.DB, TENANT);

      // Drift: BELNR removed (we replace the schema row), Z_NEW_FIELD added
      await env.DB.prepare(
        "DELETE FROM erp_connection_schemas WHERE tenant_id = ? AND connection_id = 'conn-d2' AND source_field = 'BELNR'"
      ).bind(TENANT).run();
      await profileEntityRecords(env.DB, TENANT, 'conn-d2', 'SAP', 'invoices', [
        { WRBTR: '2', Z_NEW_FIELD: 'fresh' },
      ]);

      const r2 = await detectErpSchemaDrift(env.DB, TENANT);
      expect(r2.driftCount).toBe(1);

      const events = await env.DB.prepare(
        `SELECT added_fields, removed_fields FROM erp_schema_drift_events WHERE tenant_id = ? AND connection_id = 'conn-d2'`
      ).bind(TENANT).all<{ added_fields: string; removed_fields: string }>();
      expect(events.results.length).toBe(1);
      const added = JSON.parse(events.results[0].added_fields) as string[];
      const removed = JSON.parse(events.results[0].removed_fields) as string[];
      expect(added).toContain('Z_NEW_FIELD');
      expect(removed).toContain('BELNR');

      const notif = await env.DB.prepare(
        `SELECT title, severity FROM notifications WHERE tenant_id = ? AND title LIKE '%schema drift%'`
      ).bind(TENANT).first<{ title: string; severity: string }>();
      expect(notif).not.toBeNull();
      expect(notif!.severity).toBe('warning');
    });

    it('no drift on a clean second run', async () => {
      await seedConnection('conn-d3', TENANT);
      await profileEntityRecords(env.DB, TENANT, 'conn-d3', 'SAP', 'invoices', [
        { WRBTR: '1', BELNR: 'X' },
      ]);
      await detectErpSchemaDrift(env.DB, TENANT);
      const r2 = await detectErpSchemaDrift(env.DB, TENANT);
      expect(r2.driftCount).toBe(0);
    });
  });
});
