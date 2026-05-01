/**
 * Phase 4 — multi-connection / multi-source-system attribution.
 *
 * Covers:
 *  1. computeRoiAttribution with one connection → 100 % attributed.
 *  2. computeRoiAttribution with two connections (different inputValue) →
 *     proportional split rounded to 2 dp.
 *  3. Pre-v60 rows (NULL connection_id) fall back to source_system grouping.
 *  4. GET /api/v1/roi response includes breakdown.byConnection.
 *  5. No volumes → empty attribution (no zero-division).
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { computeRoiAttribution } from '../services/erp-attribution';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'attr-tenant';
const ADMIN = 'attr-admin@test.local';

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
async function seedAdapter(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('attr-adapter', 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
}
async function seedConnection(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'attr-adapter', ?, 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT, name).run();
}
async function seedInvoice(id: string, sourceSystem: string, total: number, connectionId: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO erp_invoices (id, tenant_id, source_system, external_id, invoice_number, invoice_date, total, connection_id, currency, status)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, 'ZAR', 'open')`
  ).bind(id, TENANT, sourceSystem, id, id, total, connectionId).run();
}

async function login(email: string, slug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: slug });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

describe('Phase 4 — multi-connection / multi-source attribution', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT, TENANT);
    await seedUser('attr-admin', TENANT, ADMIN);
    await seedAdapter();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_purchase_orders WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_customers WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_suppliers WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM roi_tracking WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
  });

  it('single connection → 100% of recovered attributed to it', async () => {
    await seedConnection('conn-only', 'Sole SAP');
    await seedInvoice('inv-1', 'SAP', 100000, 'conn-only');
    await seedInvoice('inv-2', 'SAP', 200000, 'conn-only');

    const attrib = await computeRoiAttribution(env.DB, TENANT, 50000);
    expect(attrib.length).toBe(1);
    expect(attrib[0].kind).toBe('connection');
    expect(attrib[0].label).toBe('Sole SAP');
    expect(attrib[0].share).toBe(1);
    expect(attrib[0].recoveredValue).toBe(50000);
  });

  it('two connections proportional to inputValue', async () => {
    await seedConnection('conn-sap', 'SAP Finance');
    await seedConnection('conn-odoo', 'Odoo Ops');
    // SAP: 600000 input value (60%); Odoo: 400000 (40%)
    await seedInvoice('inv-sap-1', 'SAP', 600000, 'conn-sap');
    await seedInvoice('inv-odoo-1', 'Odoo', 400000, 'conn-odoo');

    const attrib = await computeRoiAttribution(env.DB, TENANT, 1000000);
    expect(attrib.length).toBe(2);
    const sap = attrib.find((r) => r.label === 'SAP Finance')!;
    const odoo = attrib.find((r) => r.label === 'Odoo Ops')!;
    expect(sap.share).toBeCloseTo(0.6, 2);
    expect(odoo.share).toBeCloseTo(0.4, 2);
    expect(sap.recoveredValue).toBeCloseTo(600000, 2);
    expect(odoo.recoveredValue).toBeCloseTo(400000, 2);
    // Sorted by recoveredValue desc
    expect(attrib[0].recoveredValue).toBeGreaterThanOrEqual(attrib[1].recoveredValue);
  });

  it('rows with NULL connection_id fall back to source_system grouping', async () => {
    await seedConnection('conn-new', 'New SAP');
    // Legacy: no connection_id; new: tagged
    await seedInvoice('inv-legacy', 'SAP', 300000, null);
    await seedInvoice('inv-new', 'SAP', 100000, 'conn-new');

    const attrib = await computeRoiAttribution(env.DB, TENANT, 100000);
    // Two distinct attribution rows — one source_system bucket, one connection bucket
    expect(attrib.length).toBe(2);
    const fallback = attrib.find((r) => r.kind === 'source_system');
    const connRow = attrib.find((r) => r.kind === 'connection');
    expect(fallback).toBeTruthy();
    expect(connRow).toBeTruthy();
    expect(fallback!.label).toBe('SAP');
    expect(connRow!.label).toBe('New SAP');
    // Total share sums to ~1
    expect(attrib.reduce((acc, r) => acc + r.share, 0)).toBeCloseTo(1, 2);
  });

  it('returns empty attribution when there are no canonical records', async () => {
    const attrib = await computeRoiAttribution(env.DB, TENANT, 50000);
    expect(attrib).toEqual([]);
  });

  it('GET /api/v1/roi includes breakdown.byActionState (automated/pending/open)', async () => {
    // Seed roi_tracking + a few catalyst_actions in different states
    await env.DB.prepare(
      `INSERT INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, total_catalyst_runs, licence_cost_annual, roi_multiple, calculated_at)
       VALUES (?, ?, '2026-05', 1000000, 200000, 0, 100, 50, 250000, 1.5, datetime('now'))`
    ).bind(crypto.randomUUID(), TENANT).run();
    await env.DB.prepare(
      `INSERT INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
       VALUES ('cluster-roi', ?, 'Cluster', 'finance', 'active', 'assisted')`
    ).bind(TENANT).run();
    // 2 completed (automated) at R 100k each, 1 pending at R 50k
    await env.DB.prepare(
      `INSERT INTO catalyst_actions (id, tenant_id, cluster_id, catalyst_name, action, status, value_zar, action_type)
       VALUES (?, ?, 'cluster-roi', 'AR Collection', 'ar_dunning_send', 'completed', 100000, 'ar_dunning_send')`
    ).bind(crypto.randomUUID(), TENANT).run();
    await env.DB.prepare(
      `INSERT INTO catalyst_actions (id, tenant_id, cluster_id, catalyst_name, action, status, value_zar, action_type)
       VALUES (?, ?, 'cluster-roi', 'AR Collection', 'ar_dunning_send', 'completed', 100000, 'ar_dunning_send')`
    ).bind(crypto.randomUUID(), TENANT).run();
    await env.DB.prepare(
      `INSERT INTO catalyst_actions (id, tenant_id, cluster_id, catalyst_name, action, status, value_zar, action_type)
       VALUES (?, ?, 'cluster-roi', 'AR Collection', 'ar_dunning_send', 'pending_approval', 50000, 'ar_dunning_send')`
    ).bind(crypto.randomUUID(), TENANT).run();

    const token = await login(ADMIN, TENANT);
    const res = await authedGet('/api/v1/roi', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { breakdown: { byActionState: { automated_count: number; automated_value_zar: number; pending_count: number; pending_value_zar: number; open_value_zar: number } } };
    expect(body.breakdown.byActionState.automated_count).toBe(2);
    expect(body.breakdown.byActionState.automated_value_zar).toBe(200000);
    expect(body.breakdown.byActionState.pending_count).toBe(1);
    expect(body.breakdown.byActionState.pending_value_zar).toBe(50000);
    // Open = identified (1m) - automated (200k) - pending (50k) = 750k
    expect(body.breakdown.byActionState.open_value_zar).toBe(750000);
  });

  it('GET /api/v1/roi includes breakdown.byConnection', async () => {
    await seedConnection('conn-roi', 'SAP for ROI');
    await seedInvoice('inv-roi', 'SAP', 500000, 'conn-roi');
    // Need a roi_tracking row so the endpoint returns the rich shape
    await env.DB.prepare(
      `INSERT INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, total_catalyst_runs, licence_cost_annual, roi_multiple, calculated_at)
       VALUES (?, ?, '2026-05', 800000, 300000, 0, 100, 50, 250000, 1.5, datetime('now'))`
    ).bind(crypto.randomUUID(), TENANT).run();

    const token = await login(ADMIN, TENANT);
    const res = await authedGet('/api/v1/roi', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { breakdown: { byConnection: Array<{ label: string; recoveredValue: number }> } };
    expect(body.breakdown.byConnection.length).toBeGreaterThan(0);
    expect(body.breakdown.byConnection[0].label).toBe('SAP for ROI');
    expect(body.breakdown.byConnection[0].recoveredValue).toBe(300000);
  });
});
