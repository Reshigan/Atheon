/**
 * Phase 9-4 — real MS Dynamics 365 BC + Sage Business Cloud adapters.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeDynamicsLive, type DynamicsCredentials } from '../services/erp-dynamics-live';
import { executeSageLive, type SageCredentials } from '../services/erp-sage-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'ds-tenant';

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('ds-admin', TENANT, 'ds@test.local', 'ds', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('dyn-adapter', 'BC', 'Dynamics', '2024', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('sage-adapter', 'Sage', 'Sage', '3.1', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-dyn', ?, 'dyn-adapter', 'Dynamics Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-sage', ?, 'sage-adapter', 'Sage Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('ds-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const dynCreds: DynamicsCredentials = {
  aad_tenant_id: 'aad-1', client_id: 'cid', client_secret: 'csec',
  access_token: 'dyn-tok', refresh_token: 'dyn-ref',
  bc_tenant_id: 'bc-1', bc_environment: 'Production', company_id: 'co-1',
  live_mode: true,
};
const sageCreds: SageCredentials = {
  client_id: 'cid', client_secret: 'csec',
  access_token: 'sage-tok', refresh_token: 'sage-ref',
  business_id: 'biz-1', live_mode: true,
};

function makeDynAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type: 'po_create',
    tenantId: TENANT, connectionId: 'conn-dyn',
    catalystName: 'PO', clusterId: 'ds-cluster',
    payload: { vendor_number: 'V1', vendor_invoice_number: 'INV-1', order_date: '2026-05-01' },
    value_zar: 1000, ...overrides,
  };
}
function makeSageAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type: 'po_create',
    tenantId: TENANT, connectionId: 'conn-sage',
    catalystName: 'PO', clusterId: 'ds-cluster',
    payload: { vendor_id: '5', line_items: [{ description: 'Item', quantity: 1, unit_price: 100 }] },
    value_zar: 1000, ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 9-4 — Dynamics 365 BC live adapter', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await setup();
  });
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('po_create: POSTs to BC purchaseOrders endpoint with company id substituted', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'po-99' }), { status: 201 }));
    const result = await executeDynamicsLive(makeDynAction(), { db: env.DB }, { ...dynCreds }, {
      tenantId: TENANT, connectionId: 'conn-dyn',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('po-99');
    expect(fetchMock.mock.calls[0][0]).toContain('api.businesscentral.dynamics.com/v2.0/bc-1/Production/api/v2.0/companies(co-1)/purchaseOrders');
  });

  it('401 → AAD refresh + retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: 'expired' } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'dyn-tok-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'po-99' }), { status: 201 }));
    const result = await executeDynamicsLive(makeDynAction(), { db: env.DB }, { ...dynCreds }, {
      tenantId: TENANT, connectionId: 'conn-dyn',
    });
    expect(result.ok).toBe(true);
    expect(result.details?.refreshed).toBe(true);
  });

  it('error.message mapped to summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: { code: 'BadRequest', message: 'Vendor V1 does not exist' },
    }), { status: 400 }));
    const result = await executeDynamicsLive(makeDynAction(), { db: env.DB }, { ...dynCreds }, {
      tenantId: TENANT, connectionId: 'conn-dyn',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Vendor V1 does not exist');
  });

  it('PATCH includes If-Match header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    await executeDynamicsLive(makeDynAction({
      type: 'customer_credit_update', payload: { customer_id: 'c-1', credit_limit: 50000 },
    }), { db: env.DB }, { ...dynCreds }, { tenantId: TENANT, connectionId: 'conn-dyn' });
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('PATCH');
    expect(call[1].headers['If-Match']).toBe('*');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Dynamics', 'autonomous', makeDynAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });

  it('Microsoft Dynamics 365 prefix-match routes to dynamics adapter', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'po-99' }), { status: 201 }));
    const result = await dispatchWriteAction(env.DB, 'Microsoft Dynamics 365', 'autonomous', makeDynAction(), {
      db: env.DB, credentials: { ...dynCreds }, encryptionKey: 'test-encryption-key-32chars-min!',
    });
    expect(result.status).toBe('completed');
    expect(result.result?.mode).toBe('live');
  });
});

describe('Phase 9-4 — Sage Business Cloud live adapter', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await setup();
  });
  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('po_create: POSTs to /v3.1/purchase_orders with X-Business header', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'sage-po-1' }), { status: 201 }));
    const result = await executeSageLive(makeSageAction(), { db: env.DB }, { ...sageCreds }, {
      tenantId: TENANT, connectionId: 'conn-sage',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('sage-po-1');
    expect(fetchMock.mock.calls[0][0]).toContain('api.accounting.sage.com/v3.1/purchase_orders');
    expect(fetchMock.mock.calls[0][1].headers['X-Business']).toBe('biz-1');
  });

  it('$message mapped to summary on error', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      $errors: [{ $message: 'Validation failed: vendor_id required' }],
    }), { status: 422 }));
    const result = await executeSageLive(makeSageAction(), { db: env.DB }, { ...sageCreds }, {
      tenantId: TENANT, connectionId: 'conn-sage',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Validation failed: vendor_id required');
  });

  it('ar_dunning_send → unsupported_action (no native Sage equivalent)', async () => {
    const result = await executeSageLive(makeSageAction({
      type: 'ar_dunning_send', payload: { invoice_id: 'INV-1' },
    }), { db: env.DB }, { ...sageCreds }, { tenantId: TENANT, connectionId: 'conn-sage' });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_action');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Sage', 'autonomous', makeSageAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });
});
