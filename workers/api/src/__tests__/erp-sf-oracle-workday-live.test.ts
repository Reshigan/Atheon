/**
 * Phase 9-5 — real Salesforce + Oracle Fusion + Workday live adapters.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeSalesforceLive, type SalesforceCredentials } from '../services/erp-salesforce-live';
import { executeOracleLive, type OracleCredentials } from '../services/erp-oracle-live';
import { executeWorkdayLive, type WorkdayCredentials } from '../services/erp-workday-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sow-tenant';

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('sow-admin', TENANT, 'sow@test.local', 'sow', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('sf-adapter', 'SF', 'Salesforce', 'v60', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('oracle-adapter', 'Oracle', 'Oracle', '2024', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('wd-adapter', 'WD', 'Workday', '2024', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-sf', ?, 'sf-adapter', 'SF', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-oracle', ?, 'oracle-adapter', 'Oracle', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-wd', ?, 'wd-adapter', 'WD', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('sow-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const sfCreds: SalesforceCredentials = {
  instance_url: 'https://acme.my.salesforce.com',
  client_id: 'cid', client_secret: 'csec',
  access_token: 'sf-tok', refresh_token: 'sf-ref',
  api_version: 'v60.0', live_mode: true,
};
const oracleCreds: OracleCredentials = {
  pod_url: 'https://acme-test.fa.us6.oraclecloud.com',
  client_id: 'cid', client_secret: 'csec',
  access_token: 'or-tok', refresh_token: 'or-ref',
  auth_scheme: 'oauth', live_mode: true,
};
const wdCreds: WorkdayCredentials = {
  host: 'https://wd2-impl-services1.workday.com',
  tenant: 'acme', client_id: 'cid', client_secret: 'csec',
  access_token: 'wd-tok', refresh_token: 'wd-ref',
  live_mode: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

function makeAction(connectionId: string, type: CatalystWriteAction['type'], payload: Record<string, unknown>): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type, tenantId: TENANT, connectionId,
    catalystName: 'X', clusterId: 'sow-cluster',
    payload, value_zar: 1000,
  };
}

describe('Phase 9-5 — Salesforce live adapter', () => {
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

  it('customer_credit_update: PATCH Account custom field', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    const result = await executeSalesforceLive(
      makeAction('conn-sf', 'customer_credit_update', { account_id: '001000', credit_limit: 50000 }),
      { db: env.DB }, { ...sfCreds }, { tenantId: TENANT, connectionId: 'conn-sf' },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    const call = fetchMock.mock.calls[0];
    expect(call[0]).toContain('/services/data/v60.0/sobjects/Account/001000');
    expect(call[1].method).toBe('PATCH');
    expect(JSON.parse(call[1].body).CreditLimit__c).toBe(50000);
  });

  it('po_create → unsupported_action (Salesforce is CRM)', async () => {
    const result = await executeSalesforceLive(
      makeAction('conn-sf', 'po_create', { contact_id: 'X', line_items: [] }),
      { db: env.DB }, { ...sfCreds }, { tenantId: TENANT, connectionId: 'conn-sf' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_action');
  });

  it('Salesforce error array → mapped summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify([{
      message: 'Account does not exist', errorCode: 'INVALID_ID',
    }]), { status: 400 }));
    const result = await executeSalesforceLive(
      makeAction('conn-sf', 'customer_credit_update', { account_id: 'X', credit_limit: 100 }),
      { db: env.DB }, { ...sfCreds }, { tenantId: TENANT, connectionId: 'conn-sf' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Account does not exist');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Salesforce', 'autonomous',
      makeAction('conn-sf', 'customer_credit_update', { account_id: '001', credit_limit: 100 }),
      { db: env.DB, credentials: { /* no live_mode */ } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });
});

describe('Phase 9-5 — Oracle Fusion live adapter', () => {
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

  it('po_create: POSTs to /fscmRestApi/.../purchaseOrders', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ PurchaseOrderId: 12345 }), { status: 201 }));
    const result = await executeOracleLive(
      makeAction('conn-oracle', 'po_create', { supplier: 'S1', procurement_bu: 'BU', requisitioning_bu: 'BU', lines: [] }),
      { db: env.DB }, { ...oracleCreds }, { tenantId: TENANT, connectionId: 'conn-oracle' },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('12345');
    expect(fetchMock.mock.calls[0][0]).toContain('/fscmRestApi/resources/11.13.18.05/purchaseOrders');
  });

  it('Basic auth scheme uses username/password', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({}), { status: 200 }));
    const basicCreds: OracleCredentials = { ...oracleCreds, auth_scheme: 'basic', username: 'u', password: 'p', access_token: undefined };
    await executeOracleLive(
      makeAction('conn-oracle', 'invoice_post', { invoice_id: '1' }),
      { db: env.DB }, basicCreds, { tenantId: TENANT, connectionId: 'conn-oracle' },
    );
    expect(fetchMock.mock.calls[0][1].headers['Authorization']).toBe('Basic ' + btoa('u:p'));
  });

  it('detail field mapped to summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      detail: 'Supplier S1 not found', title: 'NotFound',
    }), { status: 404 }));
    const result = await executeOracleLive(
      makeAction('conn-oracle', 'po_create', { supplier: 'S1', procurement_bu: 'BU', requisitioning_bu: 'BU', lines: [] }),
      { db: env.DB }, { ...oracleCreds }, { tenantId: TENANT, connectionId: 'conn-oracle' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Supplier S1 not found');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Oracle', 'autonomous',
      makeAction('conn-oracle', 'po_create', { supplier: 'S1', procurement_bu: 'BU', lines: [] }),
      { db: env.DB, credentials: { /* no live_mode */ } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('"Oracle Fusion" prefix-match resolves to oracle adapter', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ PurchaseOrderId: 1 }), { status: 201 }));
    const result = await dispatchWriteAction(env.DB, 'Oracle Fusion Cloud', 'autonomous',
      makeAction('conn-oracle', 'po_create', { supplier: 'S1', procurement_bu: 'BU', requisitioning_bu: 'BU', lines: [] }),
      { db: env.DB, credentials: { ...oracleCreds }, encryptionKey: 'test-encryption-key-32chars-min!' });
    expect(result.status).toBe('completed');
    expect(result.result?.mode).toBe('live');
  });
});

describe('Phase 9-5 — Workday live adapter', () => {
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

  it('journal_post: POSTs to /financialAccounting/v1/{tenant}/journals', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ id: 'wd-j-1' }), { status: 201 }));
    const result = await executeWorkdayLive(
      makeAction('conn-wd', 'journal_post', { ledger: 'L1', accounting_date: '2026-05-01', lines: [] }),
      { db: env.DB }, { ...wdCreds }, { tenantId: TENANT, connectionId: 'conn-wd' },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('wd-j-1');
    expect(fetchMock.mock.calls[0][0]).toContain('/ccx/api/financialAccounting/v1/acme/journals');
  });

  it('po_create → unsupported_action (Workday is HCM)', async () => {
    const result = await executeWorkdayLive(
      makeAction('conn-wd', 'po_create', { vendor_id: 'V', items: [] }),
      { db: env.DB }, { ...wdCreds }, { tenantId: TENANT, connectionId: 'conn-wd' },
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBe('unsupported_action');
  });

  it('description error mapped to summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'invalid_request', description: 'Ledger L1 does not exist',
    }), { status: 400 }));
    const result = await executeWorkdayLive(
      makeAction('conn-wd', 'journal_post', { ledger: 'L1', accounting_date: '2026-05-01', lines: [] }),
      { db: env.DB }, { ...wdCreds }, { tenantId: TENANT, connectionId: 'conn-wd' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Ledger L1 does not exist');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Workday', 'autonomous',
      makeAction('conn-wd', 'journal_post', { ledger: 'L1', lines: [] }),
      { db: env.DB, credentials: { /* no live_mode */ } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});
