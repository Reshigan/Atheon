/**
 * Phase 7-1 — write-back action framework + per-ERP adapters.
 *
 * Covers:
 *  1. checkAutonomy: block / queue / execute decisions per tier
 *  2. dispatchWriteAction: idempotency replays return original outcome
 *  3. dispatchWriteAction: previewOnly bypasses autonomy gate
 *  4. dispatchWriteAction: read-only tier blocks
 *  5. dispatchWriteAction: assisted tier queues for approval
 *  6. dispatchWriteAction: autonomous tier executes (low value)
 *  7. dispatchWriteAction: autonomous tier queues high-value actions
 *  8. SAP / Odoo / Xero adapter validation rejects bad payloads
 *  9. Xero customer_credit_update unsupported (no native field)
 * 10. approveQueuedAction executes a pending action
 * 11. rejectQueuedAction marks action rejected
 * 12. POST /actions endpoint integration
 * 13. POST /actions/:id/approve + /reject endpoint integration
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import {
  checkAutonomy,
  dispatchWriteAction,
  approveQueuedAction,
  rejectQueuedAction,
  type CatalystWriteAction,
  type ActionType,
} from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'wa-tenant';
const ADMIN = 'wa-admin@test.local';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse"]', '["finance"]', 10, 10)`
  ).bind(TENANT).run();
}
async function seedUser(): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind('wa-admin', TENANT, ADMIN, ADMIN, hash, JSON.stringify(['*'])).run();
}
async function seedAdapter(id: string, system: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES (?, 'Test', ?, '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id, system).run();
}
async function seedConnection(id: string, adapterId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, ?, 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT, adapterId).run();
}
async function seedCluster(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
     VALUES (?, ?, 'Test Cluster', 'finance', 'active', 'assisted')`
  ).bind(id, TENANT).run();
}
async function login(): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email: ADMIN, password: TEST_PASSWORD, tenant_slug: TENANT });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

function makeAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'idem-' + crypto.randomUUID(),
    type: 'ar_dunning_send' as ActionType,
    tenantId: TENANT,
    connectionId: 'conn-1',
    catalystName: 'AR Collection',
    clusterId: 'cluster-1',
    payload: { invoice_id: 'INV-1' },
    value_zar: 5000,
    ...overrides,
  };
}

describe('Phase 7-1 — write-back actions', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
    await seedUser();
    await seedAdapter('wa-adapter-sap', 'SAP');
    await seedAdapter('wa-adapter-odoo', 'Odoo');
    await seedAdapter('wa-adapter-xero', 'Xero');
    await seedCluster('cluster-1');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
    await seedConnection('conn-1', 'wa-adapter-xero');
    await seedConnection('conn-sap', 'wa-adapter-sap');
    await seedConnection('conn-odoo', 'wa-adapter-odoo');
  });

  describe('checkAutonomy', () => {
    it('read-only blocks all', () => {
      expect(checkAutonomy('read-only', makeAction())).toBe('block');
    });
    it('assisted always queues', () => {
      expect(checkAutonomy('assisted', makeAction())).toBe('queue');
    });
    it('transactional always queues', () => {
      expect(checkAutonomy('transactional', makeAction())).toBe('queue');
    });
    it('autonomous executes low-value', () => {
      expect(checkAutonomy('autonomous', makeAction({ value_zar: 1000 }))).toBe('execute');
    });
    it('autonomous queues high-value', () => {
      expect(checkAutonomy('autonomous', makeAction({ value_zar: 100000 }))).toBe('queue');
    });
  });

  describe('dispatchWriteAction', () => {
    it('previewOnly executes the adapter without autonomy gate', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'read-only',
        makeAction({ previewOnly: true }), { db: env.DB });
      expect(out.status).toBe('previewed');
      expect(out.result?.ok).toBe(true);
    });

    it('read-only blocks (no previewOnly)', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'read-only',
        makeAction(), { db: env.DB });
      expect(out.status).toBe('rejected');
    });

    it('assisted queues for approval', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'assisted',
        makeAction(), { db: env.DB });
      expect(out.status).toBe('pending_approval');
      expect(out.pending_approval).toBeTruthy();
    });

    it('autonomous executes low-value', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'autonomous',
        makeAction({ value_zar: 1000 }), { db: env.DB });
      expect(out.status).toBe('completed');
    });

    it('autonomous queues high-value', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'autonomous',
        makeAction({ value_zar: 999_999 }), { db: env.DB });
      expect(out.status).toBe('pending_approval');
    });

    it('idempotency replay returns original outcome', async () => {
      const action = makeAction({ previewOnly: true });
      const first = await dispatchWriteAction(env.DB, 'Xero', 'read-only', action, { db: env.DB });
      const second = await dispatchWriteAction(env.DB, 'Xero', 'read-only', action, { db: env.DB });
      expect(second.action_id).toBe(first.action_id);
      expect(second.status).toBe(first.status);
    });

    it('no adapter for vendor → failed', async () => {
      const out = await dispatchWriteAction(env.DB, 'NonExistent', 'autonomous',
        makeAction({ value_zar: 100 }), { db: env.DB });
      expect(out.status).toBe('failed');
      expect(out.result?.error).toBe('no_adapter');
    });

    it('Xero rejects customer_credit_update (unsupported)', async () => {
      const out = await dispatchWriteAction(env.DB, 'Xero', 'autonomous',
        makeAction({ type: 'customer_credit_update' as ActionType, payload: { partner_id: 'P', credit_limit: 10000 } }),
        { db: env.DB });
      expect(out.status).toBe('failed');
      expect(out.result?.error).toBe('unsupported_action');
    });

    it('SAP adapter rejects payload missing required field', async () => {
      const out = await dispatchWriteAction(env.DB, 'SAP', 'autonomous',
        makeAction({ type: 'ar_dunning_send' as ActionType, payload: { customer_code: 'C1' /* missing company_code, dunning_level */ } }),
        { db: env.DB });
      expect(out.status).toBe('failed');
      expect(out.result?.summary).toMatch(/Missing required/);
    });
  });

  describe('approveQueuedAction / rejectQueuedAction', () => {
    it('approve flips a pending_approval action to completed', async () => {
      const queued = await dispatchWriteAction(env.DB, 'Xero', 'assisted', makeAction(), { db: env.DB });
      expect(queued.status).toBe('pending_approval');
      const out = await approveQueuedAction(env.DB, queued.action_id, TENANT, 'approver@example.com', 'Xero', { db: env.DB });
      expect(out.status).toBe('completed');
      expect(out.result?.ok).toBe(true);
    });

    it('reject marks the action rejected', async () => {
      const queued = await dispatchWriteAction(env.DB, 'Xero', 'assisted', makeAction(), { db: env.DB });
      const out = await rejectQueuedAction(env.DB, queued.action_id, TENANT, 'rejector@example.com', 'too risky');
      expect(out.status).toBe('rejected');
      const row = await env.DB.prepare(
        `SELECT status, output_data FROM catalyst_actions WHERE id = ?`
      ).bind(queued.action_id).first<{ status: string; output_data: string }>();
      expect(row?.status).toBe('rejected');
    });

    it('approving a non-pending action does not re-execute', async () => {
      const action = makeAction({ previewOnly: true });
      const previewed = await dispatchWriteAction(env.DB, 'Xero', 'read-only', action, { db: env.DB });
      const out = await approveQueuedAction(env.DB, previewed.action_id, TENANT, 'approver@example.com', 'Xero', { db: env.DB });
      expect(out.result?.ok).toBe(false);
    });
  });

  describe('HTTP routes', () => {
    it('POST /api/v1/erp/connections/:id/actions queues an assisted action', async () => {
      const token = await login();
      const res = await postJSON('/api/v1/erp/connections/conn-1/actions', {
        idempotency_key: 'http-1', type: 'ar_dunning_send',
        catalyst_name: 'AR Collection', cluster_id: 'cluster-1',
        payload: { invoice_id: 'INV-1' }, value_zar: 5000,
        autonomy_tier: 'assisted',
      }, token);
      expect(res.status).toBe(200);
      const body = await res.json() as { status: string; action_id: string };
      expect(body.status).toBe('pending_approval');
      expect(body.action_id).toBeTruthy();
    });

    it('POST /actions/:id/approve flips queued to completed + audit row', async () => {
      const token = await login();
      const create = await postJSON('/api/v1/erp/connections/conn-1/actions', {
        idempotency_key: 'http-2', type: 'ar_dunning_send',
        catalyst_name: 'AR Collection', cluster_id: 'cluster-1',
        payload: { invoice_id: 'INV-1' }, value_zar: 5000, autonomy_tier: 'assisted',
      }, token);
      const created = await create.json() as { action_id: string };
      const approve = await postJSON(`/api/v1/erp/connections/conn-1/actions/${created.action_id}/approve`, {}, token);
      expect(approve.status).toBe(200);
      const body = await approve.json() as { status: string };
      expect(body.status).toBe('completed');

      const audit = await env.DB.prepare(
        `SELECT details FROM audit_log WHERE tenant_id = ? AND action = 'erp.write_action.approved' ORDER BY created_at DESC LIMIT 1`
      ).bind(TENANT).first<{ details: string }>();
      expect(audit).not.toBeNull();
    });

    it('GET /actions lists actions for a connection', async () => {
      const token = await login();
      await postJSON('/api/v1/erp/connections/conn-1/actions', {
        idempotency_key: 'http-3a', type: 'ar_dunning_send',
        catalyst_name: 'AR Collection', cluster_id: 'cluster-1',
        payload: { invoice_id: 'INV-X' }, value_zar: 5000, autonomy_tier: 'assisted',
      }, token);
      await postJSON('/api/v1/erp/connections/conn-1/actions', {
        idempotency_key: 'http-3b', type: 'ar_dunning_send',
        catalyst_name: 'AR Collection', cluster_id: 'cluster-1',
        payload: { invoice_id: 'INV-Y' }, value_zar: 7500, autonomy_tier: 'assisted',
      }, token);
      const res = await authedGet('/api/v1/erp/connections/conn-1/actions', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { total: number; actions: Array<{ status: string }> };
      expect(body.total).toBeGreaterThanOrEqual(2);
      expect(body.actions[0].status).toBeTruthy();
    });

    it('POST /actions/:id/reject marks the action rejected', async () => {
      const token = await login();
      const create = await postJSON('/api/v1/erp/connections/conn-1/actions', {
        idempotency_key: 'http-4', type: 'ar_dunning_send',
        catalyst_name: 'AR Collection', cluster_id: 'cluster-1',
        payload: { invoice_id: 'INV-Q' }, value_zar: 5000, autonomy_tier: 'assisted',
      }, token);
      const created = await create.json() as { action_id: string };
      const reject = await postJSON(`/api/v1/erp/connections/conn-1/actions/${created.action_id}/reject`, { reason: 'not now' }, token);
      expect(reject.status).toBe(200);
      const body = await reject.json() as { status: string };
      expect(body.status).toBe('rejected');
    });
  });
});
