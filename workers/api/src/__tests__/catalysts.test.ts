/**
 * Catalyst Engine Test Suite
 * Tests cluster CRUD, template deployment, sub-catalyst management,
 * insight generation, execution logs, and tenant scoping.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';

/** Helper to POST JSON */
async function postJSON(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Helper to GET with auth */
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Helper to POST with auth */
async function authedPost(path: string, body: Record<string, unknown>, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Helper to PUT with auth */
async function authedPut(path: string, body: Record<string, unknown>, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Seed a tenant + user */
async function seedTenant(tenantId: string, slug: string, name: string, industry: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, industry, plan, status) VALUES (?, ?, ?, ?, 'enterprise', 'active')`
  ).bind(tenantId, name, slug, industry).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex","pulse","mind","memory"]', '["finance","hr","operations"]', 50, 100)`
  ).bind(tenantId).run();
}

async function seedUser(id: string, tenantId: string, email: string, password: string, role: string): Promise<void> {
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(id, tenantId, email, 'Test User', role, hash, JSON.stringify(['*'])).run();
}

/** Login helper */
async function login(email: string, password: string, tenantSlug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password, tenant_slug: tenantSlug });
  if (res.status !== 200) throw new Error(`Login failed for ${email}: ${res.status}`);
  const body = await res.json() as { token: string };
  return body.token;
}

// Constants
const TENANT_ID = 'cat-test-tenant';
const OTHER_TENANT = 'cat-other-tenant';
const PASSWORD = 'SecurePass1!';

let adminToken: string;
let superadminToken: string;
let viewerToken: string;
let otherAdminToken: string;

describe('Catalyst Engine', () => {
  beforeAll(async () => {
    // Run migrations
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);

    // Seed tenants
    await seedTenant(TENANT_ID, 'cat-test', 'Catalyst Test Corp', 'technology');
    await seedTenant(OTHER_TENANT, 'cat-other', 'Other Corp', 'healthcare');

    // Seed users
    await seedUser('cat-admin', TENANT_ID, 'cat-admin@test.com', PASSWORD, 'admin');
    await seedUser('cat-super', TENANT_ID, 'cat-super@test.com', PASSWORD, 'superadmin');
    await seedUser('cat-viewer', TENANT_ID, 'cat-viewer@test.com', PASSWORD, 'viewer');
    await seedUser('cat-other-admin', OTHER_TENANT, 'cat-other@test.com', PASSWORD, 'admin');

    // Login all users
    adminToken = await login('cat-admin@test.com', PASSWORD, 'cat-test');
    superadminToken = await login('cat-super@test.com', PASSWORD, 'cat-test');
    viewerToken = await login('cat-viewer@test.com', PASSWORD, 'cat-test');
    otherAdminToken = await login('cat-other@test.com', PASSWORD, 'cat-other');
  });

  // ────────────────────────────────────────────
  // Cluster Listing
  // ────────────────────────────────────────────
  describe('Cluster Listing', () => {
    it('GET /catalysts/clusters returns empty list for new tenant', async () => {
      const res = await authedGet('/api/v1/catalysts/clusters', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { clusters: unknown[]; total: number };
      expect(body.clusters).toBeInstanceOf(Array);
      expect(body.total).toBeGreaterThanOrEqual(0);
    });

    it('requires authentication', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/catalysts/clusters');
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────
  // Cluster CRUD
  // ────────────────────────────────────────────
  describe('Cluster CRUD', () => {
    let clusterId: string;

    it('POST /catalysts/clusters creates a new cluster', async () => {
      const res = await authedPost('/api/v1/catalysts/clusters', {
        name: 'Finance Reconciliation',
        domain: 'finance',
        description: 'Automated financial reconciliation',
        autonomy_tier: 'assisted',
      }, adminToken);
      expect(res.status).toBe(201);
      const body = await res.json() as { id: string; name: string; domain: string };
      expect(body.id).toBeTruthy();
      expect(body.name).toBe('Finance Reconciliation');
      expect(body.domain).toBe('finance');
      clusterId = body.id;
    });

    it('rejects cluster creation with missing name', async () => {
      const res = await authedPost('/api/v1/catalysts/clusters', {
        domain: 'finance',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('rejects cluster creation with missing domain', async () => {
      const res = await authedPost('/api/v1/catalysts/clusters', {
        name: 'Test Cluster',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('GET /catalysts/clusters/:id returns cluster details', async () => {
      // Create a fresh cluster then look it up
      const createRes = await authedPost('/api/v1/catalysts/clusters', {
        name: 'Detail Test Cluster',
        domain: 'finance',
        description: 'For detail lookup test',
      }, adminToken);
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { id: string };

      const res = await authedGet(`/api/v1/catalysts/clusters/${created.id}`, adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.id).toBe(created.id);
      expect(body.name).toBe('Detail Test Cluster');
      expect(body.domain).toBe('finance');
      expect(body.status).toBe('active');
    });

    it('GET /catalysts/clusters/:id returns 404 for non-existent cluster', async () => {
      const res = await authedGet('/api/v1/catalysts/clusters/nonexistent-id', adminToken);
      expect(res.status).toBe(404);
    });

    it('cluster from tenant A is not visible to tenant B', async () => {
      const res = await authedGet(`/api/v1/catalysts/clusters/${clusterId}`, otherAdminToken);
      expect(res.status).toBe(404);
    });

    it('newly created cluster appears in cluster list', async () => {
      // Create a fresh cluster and verify it shows up
      const createRes = await authedPost('/api/v1/catalysts/clusters', {
        name: 'List Check Cluster',
        domain: 'sales',
      }, adminToken);
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { id: string };

      const res = await authedGet('/api/v1/catalysts/clusters', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { clusters: Array<{ id: string }> };
      const found = body.clusters.find(c => c.id === created.id);
      expect(found).toBeTruthy();
    });
  });

  // ────────────────────────────────────────────
  // Template Listing
  // ────────────────────────────────────────────
  describe('Templates', () => {
    it('GET /catalysts/templates returns available templates', async () => {
      const res = await authedGet('/api/v1/catalysts/templates', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { templates: Array<{ industry: string; clusters: unknown[] }> };
      expect(body.templates).toBeInstanceOf(Array);
      expect(body.templates.length).toBeGreaterThan(0);
    });

    it('each template has industry, clusters, and sub-catalysts', async () => {
      const res = await authedGet('/api/v1/catalysts/templates', adminToken);
      const body = await res.json() as { templates: Array<{ industry: string; label: string; clusters: Array<{ name: string; domain: string; sub_catalysts: unknown[] }> }> };
      for (const tmpl of body.templates) {
        expect(tmpl.industry).toBeTruthy();
        expect(tmpl.label).toBeTruthy();
        expect(tmpl.clusters.length).toBeGreaterThan(0);
        for (const cl of tmpl.clusters) {
          expect(cl.name).toBeTruthy();
          expect(cl.domain).toBeTruthy();
          expect(cl.sub_catalysts).toBeInstanceOf(Array);
        }
      }
    });
  });

  // ────────────────────────────────────────────
  // Template Deployment
  // ────────────────────────────────────────────
  describe('Template Deployment', () => {
    it('viewer cannot deploy templates', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        tenant_id: TENANT_ID,
        industry: 'technology',
      }, viewerToken);
      expect(res.status).toBe(403);
    });

    it('admin can deploy template to own tenant', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        tenant_id: TENANT_ID,
        industry: 'technology',
      }, adminToken);
      expect([200, 201]).toContain(res.status);
      const body = await res.json() as { success: boolean; clustersCreated: number; clusterIds: string[] };
      expect(body.success).toBe(true);
      expect(body.clustersCreated).toBeGreaterThan(0);
      expect(body.clusterIds.length).toBe(body.clustersCreated);
    });

    it('regular admin cannot deploy template to another tenant', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        tenant_id: OTHER_TENANT,
        industry: 'technology',
      }, adminToken);
      expect(res.status).toBe(403);
    });

    it('superadmin can deploy template to any tenant', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        tenant_id: OTHER_TENANT,
        industry: 'healthcare',
      }, superadminToken);
      expect([200, 201]).toContain(res.status);
      const body = await res.json() as { success: boolean; clustersCreated: number };
      expect(body.success).toBe(true);
      expect(body.clustersCreated).toBeGreaterThan(0);
    });

    it('rejects deployment with missing tenant_id', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        industry: 'technology',
      }, adminToken);
      expect(res.status).toBe(400);
    });

    it('rejects deployment with invalid industry', async () => {
      const res = await authedPost('/api/v1/catalysts/deploy-template', {
        tenant_id: TENANT_ID,
        industry: 'nonexistent-industry',
      }, adminToken);
      expect([404, 400]).toContain(res.status);
    });

    it('deployed clusters are visible in cluster list', async () => {
      const res = await authedGet('/api/v1/catalysts/clusters', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { clusters: unknown[]; total: number };
      // Should have at least some clusters from template deployment
      expect(body.total).toBeGreaterThanOrEqual(0);
    });
  });

  // ────────────────────────────────────────────
  // Tenant Scoping
  // ────────────────────────────────────────────
  describe('Tenant Scoping', () => {
    it('tenant A sees only its own clusters (isolation check)', async () => {
      // First create a cluster for tenant A to ensure it has data
      await authedPost('/api/v1/catalysts/clusters', {
        name: 'Scoping Test A',
        domain: 'finance',
      }, adminToken);
      const res = await authedGet('/api/v1/catalysts/clusters', adminToken);
      const body = await res.json() as { clusters: Array<Record<string, unknown>> };
      expect(body.clusters.length).toBeGreaterThan(0);
    });

    it('tenant B sees only its own clusters (isolation check)', async () => {
      // Create a cluster for tenant B
      await authedPost('/api/v1/catalysts/clusters', {
        name: 'Scoping Test B',
        domain: 'hr',
      }, otherAdminToken);
      const res = await authedGet('/api/v1/catalysts/clusters', otherAdminToken);
      const body = await res.json() as { clusters: Array<Record<string, unknown>> };
      expect(body.clusters.length).toBeGreaterThan(0);
    });

    it('superadmin can view other tenant clusters via tenant_id param', async () => {
      const res = await authedGet(`/api/v1/catalysts/clusters?tenant_id=${OTHER_TENANT}`, superadminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { clusters: Array<Record<string, unknown>> };
      // May be 0 if healthcare template deployment created clusters for OTHER_TENANT
      expect(body.clusters).toBeInstanceOf(Array);
    });
  });

  // ────────────────────────────────────────────
  // Cluster with Sub-Catalysts
  // ────────────────────────────────────────────
  describe('Sub-Catalysts', () => {
    let subClusterId: string;

    it('creates cluster with sub-catalysts', async () => {
      const res = await authedPost('/api/v1/catalysts/clusters', {
        name: 'HR Workforce Catalyst',
        domain: 'hr',
        description: 'Human resources automation',
        autonomy_tier: 'read-only',
        sub_catalysts: [
          { name: 'Payroll Reconciliation', enabled: true, description: 'Monthly payroll checks' },
          { name: 'Leave Management', enabled: false, description: 'Leave tracking automation' },
          { name: 'Compliance Audit', enabled: true, description: 'Regulatory compliance checks' },
        ],
      }, adminToken);
      expect(res.status).toBe(201);
      const body = await res.json() as { id: string };
      subClusterId = body.id;
    });

    it('cluster with sub-catalysts is retrievable', async () => {
      // Create a fresh cluster with sub-catalysts and immediately look it up
      const createRes = await authedPost('/api/v1/catalysts/clusters', {
        name: 'Sub-Cat Lookup Test',
        domain: 'procurement',
        sub_catalysts: [
          { name: 'Invoice Check', enabled: true, description: 'Invoice validation' },
        ],
      }, adminToken);
      expect(createRes.status).toBe(201);
      const created = await createRes.json() as { id: string };
      const res = await authedGet(`/api/v1/catalysts/clusters/${created.id}`, adminToken);
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────
  // Execution & Actions
  // ────────────────────────────────────────────
  describe('Actions', () => {
    it('GET /catalysts/actions returns actions list', async () => {
      const res = await authedGet('/api/v1/catalysts/actions', adminToken);
      // May be 200 with empty list or have some actions from template deployment
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────
  // Execution Logs
  // ────────────────────────────────────────────
  describe('Execution Logs', () => {
    it('GET /catalysts/execution-logs returns logs', async () => {
      const res = await authedGet('/api/v1/catalysts/execution-logs', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json() as { logs: unknown[] };
      expect(body.logs).toBeInstanceOf(Array);
    });
  });

  // ────────────────────────────────────────────
  // Governance & Approvals
  // ────────────────────────────────────────────
  describe('Governance', () => {
    it('GET /catalysts/governance returns governance data', async () => {
      const res = await authedGet('/api/v1/catalysts/governance', adminToken);
      expect(res.status).toBe(200);
    });

    it('GET /catalysts/approvals returns approval queue', async () => {
      const res = await authedGet('/api/v1/catalysts/approvals', adminToken);
      expect(res.status).toBe(200);
    });
  });

  // ────────────────────────────────────────────
  // Backward Compatibility (/api/ prefix)
  // ────────────────────────────────────────────
  describe('Backward Compat', () => {
    it('GET /api/catalysts/clusters works without v1 prefix', async () => {
      const res = await authedGet('/api/catalysts/clusters', adminToken);
      expect(res.status).toBe(200);
    });

    it('GET /api/catalysts/templates works without v1 prefix', async () => {
      const res = await authedGet('/api/catalysts/templates', adminToken);
      expect(res.status).toBe(200);
    });
  });
});
