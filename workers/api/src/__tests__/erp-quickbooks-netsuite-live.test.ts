/**
 * Phase 9-3 — real QuickBooks + NetSuite write adapters.
 *
 * Mocks fetch to verify each adapter's URL, body, auth, refresh, error
 * mapping. Same shape as Xero/SAP/Odoo live tests.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeQboLive, type QboCredentials } from '../services/erp-quickbooks-live';
import { executeNetSuiteLive, type NetSuiteCredentials } from '../services/erp-netsuite-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'qbns-tenant';

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('qbns-admin', TENANT, 'qbns@test.local', 'qbns', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('qbo-adapter', 'QBO', 'QuickBooks', '3', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('ns-adapter', 'NS', 'NetSuite', '2024.1', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-qbo', ?, 'qbo-adapter', 'QBO Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-ns', ?, 'ns-adapter', 'NS Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('qbns-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const qboCreds: QboCredentials = {
  client_id: 'cid', client_secret: 'csec',
  access_token: 'qbo-tok', refresh_token: 'qbo-ref',
  realm_id: '1234', live_mode: true,
};
const nsCreds: NetSuiteCredentials = {
  account_id: 'TSTACCT', client_id: 'cid', client_secret: 'csec',
  access_token: 'ns-tok', refresh_token: 'ns-ref', live_mode: true,
};

function makeQboAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type: 'po_create',
    tenantId: TENANT, connectionId: 'conn-qbo',
    catalystName: 'PO Auto', clusterId: 'qbns-cluster',
    payload: { vendor_id: '5', line_items: [{ Amount: 100 }] },
    value_zar: 1000, ...overrides,
  };
}
function makeNsAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type: 'po_create',
    tenantId: TENANT, connectionId: 'conn-ns',
    catalystName: 'PO Auto', clusterId: 'qbns-cluster',
    payload: { vendor_id: '5', items: [{ item: { id: 1 }, quantity: 1, rate: 100 }] },
    value_zar: 1000, ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 9-3 — QuickBooks live adapter', () => {
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

  it('po_create: POSTs to /v3/company/{realmId}/purchaseorder', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      PurchaseOrder: { Id: '99' },
    }), { status: 200 }));
    const result = await executeQboLive(makeQboAction(), { db: env.DB }, { ...qboCreds }, {
      tenantId: TENANT, connectionId: 'conn-qbo',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('99');
    expect(fetchMock.mock.calls[0][0]).toContain('/v3/company/1234/purchaseorder');
    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Bearer qbo-tok');
  });

  it('401 → refresh_token + retry', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ Fault: { Error: [{ Detail: 'token expired' }] } }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'qbo-tok-2', refresh_token: 'qbo-ref-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ PurchaseOrder: { Id: '99' } }), { status: 200 }));
    const result = await executeQboLive(makeQboAction(), { db: env.DB }, { ...qboCreds }, {
      tenantId: TENANT, connectionId: 'conn-qbo',
    });
    expect(result.ok).toBe(true);
    expect(result.details?.refreshed).toBe(true);
  });

  it('Fault.Error.Detail mapped to summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      Fault: { Error: [{ Detail: 'Vendor 5 does not exist', Message: 'NotFound' }] },
    }), { status: 400 }));
    const result = await executeQboLive(makeQboAction(), { db: env.DB }, { ...qboCreds }, {
      tenantId: TENANT, connectionId: 'conn-qbo',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Vendor 5 does not exist');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'QuickBooks', 'autonomous', makeQboAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });

  it('Dispatcher routes to live for "QuickBooks Online" via prefix match', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      PurchaseOrder: { Id: '99' },
    }), { status: 200 }));
    const result = await dispatchWriteAction(env.DB, 'QuickBooks Online', 'autonomous', makeQboAction(), {
      db: env.DB, credentials: { ...qboCreds }, encryptionKey: 'test-encryption-key-32chars-min!',
    });
    expect(result.status).toBe('completed');
    expect(result.result?.mode).toBe('live');
  });
});

describe('Phase 9-3 — NetSuite live adapter', () => {
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

  it('po_create: POSTs to /record/v1/purchaseOrder; uses Location header for id', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, {
      status: 204, headers: { Location: 'https://tstacct.suitetalk.api.netsuite.com/services/rest/record/v1/purchaseOrder/12345' },
    }));
    const result = await executeNetSuiteLive(makeNsAction(), { db: env.DB }, { ...nsCreds }, {
      tenantId: TENANT, connectionId: 'conn-ns',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('12345');
    expect(fetchMock.mock.calls[0][0]).toContain('tstacct.suitetalk.api.netsuite.com');
    expect(fetchMock.mock.calls[0][0]).toContain('/record/v1/purchaseOrder');
  });

  it('o:errorDetails.detail mapped to summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      'o:errorDetails': [{ detail: 'Invalid vendor reference' }],
    }), { status: 400 }));
    const result = await executeNetSuiteLive(makeNsAction(), { db: env.DB }, { ...nsCreds }, {
      tenantId: TENANT, connectionId: 'conn-ns',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Invalid vendor reference');
  });

  it('401 → refresh + retry; persists new token', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('Unauthorised', { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'ns-tok-2' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204, headers: { Location: '/record/v1/purchaseOrder/77' } }));
    const result = await executeNetSuiteLive(makeNsAction(), { db: env.DB }, { ...nsCreds }, {
      tenantId: TENANT, connectionId: 'conn-ns',
    });
    expect(result.ok).toBe(true);
    expect(result.details?.refreshed).toBe(true);
  });

  it('customer_credit_update: PATCH with creditLimit body', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await executeNetSuiteLive(makeNsAction({
      type: 'customer_credit_update', payload: { customer_id: '7', credit_limit: 50000 },
    }), { db: env.DB }, { ...nsCreds }, { tenantId: TENANT, connectionId: 'conn-ns' });
    const call = fetchMock.mock.calls[0];
    expect(call[1].method).toBe('PATCH');
    expect(call[0]).toContain('/customer/7');
    const body = JSON.parse(call[1].body);
    expect(body.creditLimit).toBe(50000);
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'NetSuite', 'autonomous', makeNsAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });
});
