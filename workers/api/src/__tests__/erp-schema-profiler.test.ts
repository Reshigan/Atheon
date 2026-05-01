/**
 * ERP Schema Profiler — Phase 1 of dynamic ERP-mapping intelligence.
 *
 * Verifies that:
 *  1. profileRecords builds a per-field profile from sample records
 *  2. profileEntityRecords UPSERTs into erp_connection_schemas idempotently
 *  3. PII / secret-shaped values are masked in samples
 *  4. Multiple connections per tenant are kept distinct
 *  5. GET /api/v1/erp/connections/:id/schemas returns the discovered schema
 *  6. Cross-tenant access is blocked (404)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { profileRecords, profileEntityRecords, getDiscoveredSchemas } from '../services/erp-schema-profiler';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT_A = 'profiler-tenant-a';
const TENANT_B = 'profiler-tenant-b';
const ADMIN_A = 'profiler-admin-a@test.local';
const ADMIN_B = 'profiler-admin-b@test.local';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
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
     VALUES (?, 'Test SAP', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id).run();
}

async function seedConnection(id: string, tenantId: string, adapterId: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, ?, ?, 'connected', '{}', 'realtime', 0)`
  ).bind(id, tenantId, adapterId, name).run();
}

async function login(email: string, tenantSlug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: tenantSlug });
  if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status}`);
  const data = await res.json() as { token: string };
  return data.token;
}

describe('ERP Schema Profiler (v57 — dynamic mapping foundation)', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

    await seedTenant(TENANT_A, TENANT_A);
    await seedTenant(TENANT_B, TENANT_B);
    await seedUser('profiler-admin-a', TENANT_A, ADMIN_A);
    await seedUser('profiler-admin-b', TENANT_B, ADMIN_B);
    await seedAdapter('profiler-adapter');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_connection_schemas WHERE tenant_id = ? OR tenant_id = ?')
      .bind(TENANT_A, TENANT_B).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ? OR tenant_id = ?')
      .bind(TENANT_A, TENANT_B).run();
  });

  describe('profileRecords (pure)', () => {
    it('infers types and counts occurrences across a sample', () => {
      const records = [
        { WRBTR: '1234.56', LIFNR: 'V001', NETWR: 1234.56, IS_OPEN: true },
        { WRBTR: '789.00',  LIFNR: 'V002', NETWR: 789, IS_OPEN: false },
        { WRBTR: '',        LIFNR: 'V003', NETWR: null, IS_OPEN: true },
      ];
      const profiles = profileRecords(records);
      const byField = Object.fromEntries(profiles.map((p) => [p.field, p]));

      expect(byField.WRBTR.type).toBe('string');
      expect(byField.WRBTR.occurrences).toBe(3);
      expect(byField.WRBTR.nulls).toBe(1); // empty-string counts as null

      expect(byField.NETWR.type).toBe('number');
      expect(byField.NETWR.nulls).toBe(1);

      expect(byField.IS_OPEN.type).toBe('boolean');
      expect(byField.IS_OPEN.nulls).toBe(0);

      expect(byField.LIFNR.samples.length).toBeGreaterThan(0);
      expect(byField.LIFNR.samples.length).toBeLessThanOrEqual(5);
    });

    it('masks secret-shaped values in samples', () => {
      const records = [
        { api_token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c' },
        { api_token: 'AKIAIOSFODNN7EXAMPLEAKIAIOSFODNN7EXAMPLEAKIAIOSF' },
      ];
      const profiles = profileRecords(records);
      const tokenProfile = profiles.find((p) => p.field === 'api_token')!;
      expect(tokenProfile.samples.every((s) => s.includes('***'))).toBe(true);
      expect(tokenProfile.samples.some((s) => s.includes('eyJhbGc'))).toBe(false);
    });

    it('marks fields with mixed types', () => {
      const records = [
        { weird: 'a string' },
        { weird: 42 },
      ];
      const profiles = profileRecords(records);
      expect(profiles.find((p) => p.field === 'weird')!.type).toBe('mixed');
    });
  });

  describe('profileEntityRecords (persistence)', () => {
    it('UPSERTs profiles into erp_connection_schemas and accumulates occurrences across runs', async () => {
      await seedConnection('conn-a-1', TENANT_A, 'profiler-adapter', 'SAP Finance Test');
      const records1 = [
        { WRBTR: '100', LIFNR: 'V1' },
        { WRBTR: '200', LIFNR: 'V2' },
      ];
      const r1 = await profileEntityRecords(env.DB, TENANT_A, 'conn-a-1', 'SAP', 'invoices', records1);
      expect(r1.profiled).toBe(2);
      expect(r1.persisted).toBe(2);

      // Second batch — same fields, more occurrences
      const records2 = [
        { WRBTR: '300', LIFNR: 'V3', NEW_FIELD: 'first time' },
      ];
      await profileEntityRecords(env.DB, TENANT_A, 'conn-a-1', 'SAP', 'invoices', records2);

      const schemas = await getDiscoveredSchemas(env.DB, TENANT_A, 'conn-a-1', 'invoices');
      const wrbtr = schemas.find((s) => s.source_field === 'WRBTR')!;
      expect(wrbtr.occurrences).toBe(3); // 2 + 1 accumulated
      const newField = schemas.find((s) => s.source_field === 'NEW_FIELD');
      expect(newField).toBeTruthy();
      expect(newField!.occurrences).toBe(1);
    });

    it('keeps two connections for the same tenant distinct', async () => {
      await seedConnection('conn-sap', TENANT_A, 'profiler-adapter', 'SAP');
      await seedConnection('conn-odoo', TENANT_A, 'profiler-adapter', 'Odoo');

      await profileEntityRecords(env.DB, TENANT_A, 'conn-sap', 'SAP', 'invoices', [
        { WRBTR: '100', LIFNR: 'V1' },
      ]);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-odoo', 'Odoo', 'invoices', [
        { amount_total: 100, partner_name: 'Acme' },
      ]);

      const sapFields = (await getDiscoveredSchemas(env.DB, TENANT_A, 'conn-sap')).map((s) => s.source_field);
      const odooFields = (await getDiscoveredSchemas(env.DB, TENANT_A, 'conn-odoo')).map((s) => s.source_field);

      expect(sapFields).toContain('WRBTR');
      expect(sapFields).not.toContain('amount_total');
      expect(odooFields).toContain('amount_total');
      expect(odooFields).not.toContain('WRBTR');
    });

    it('handles empty record arrays without throwing', async () => {
      await seedConnection('conn-empty', TENANT_A, 'profiler-adapter', 'Empty');
      const r = await profileEntityRecords(env.DB, TENANT_A, 'conn-empty', 'SAP', 'invoices', []);
      expect(r.profiled).toBe(0);
      expect(r.persisted).toBe(0);
    });
  });

  describe('GET /api/v1/erp/connections/:id/schemas', () => {
    it('returns the discovered schema grouped by entity_type', async () => {
      await seedConnection('conn-a-route', TENANT_A, 'profiler-adapter', 'SAP Route Test');
      await profileEntityRecords(env.DB, TENANT_A, 'conn-a-route', 'SAP', 'invoices', [
        { WRBTR: '100', LIFNR: 'V1', BELNR: 'INV-001' },
      ]);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-a-route', 'SAP', 'suppliers', [
        { LIFNR: 'V1', NAME1: 'Acme', LAND1: 'ZA' },
      ]);

      const token = await login(ADMIN_A, TENANT_A);
      const res = await authedGet('/api/v1/erp/connections/conn-a-route/schemas', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { connectionId: string; entityCount: number; fieldCount: number; schemas: Record<string, unknown[]> };

      expect(body.connectionId).toBe('conn-a-route');
      expect(body.entityCount).toBe(2);
      expect(body.fieldCount).toBe(6);
      expect(body.schemas.invoices).toBeTruthy();
      expect(body.schemas.suppliers).toBeTruthy();
    });

    it('filters to one entity type via ?entity=', async () => {
      await seedConnection('conn-filter', TENANT_A, 'profiler-adapter', 'Filter Test');
      await profileEntityRecords(env.DB, TENANT_A, 'conn-filter', 'SAP', 'invoices', [{ WRBTR: '1' }]);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-filter', 'SAP', 'suppliers', [{ LIFNR: 'V1' }]);

      const token = await login(ADMIN_A, TENANT_A);
      const res = await authedGet('/api/v1/erp/connections/conn-filter/schemas?entity=invoices', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { entityCount: number; schemas: Record<string, unknown[]> };
      expect(body.entityCount).toBe(1);
      expect(body.schemas.invoices).toBeTruthy();
      expect(body.schemas.suppliers).toBeUndefined();
    });

    it('blocks cross-tenant access (404, not 403, to avoid leaking existence)', async () => {
      await seedConnection('conn-only-a', TENANT_A, 'profiler-adapter', 'Tenant A only');
      await profileEntityRecords(env.DB, TENANT_A, 'conn-only-a', 'SAP', 'invoices', [{ WRBTR: '1' }]);

      const otherToken = await login(ADMIN_B, TENANT_B);
      const res = await authedGet('/api/v1/erp/connections/conn-only-a/schemas', otherToken);
      expect(res.status).toBe(404);
    });
  });
});
