/**
 * Phase 9-6 — real Sage Intacct + Sage X3 + Sage Pastel adapters.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeIntacctLive, type IntacctCredentials } from '../services/erp-sage-intacct-live';
import { executeSageX3Live, type SageX3Credentials } from '../services/erp-sage-x3-live';
import { dispatchWriteAction, type CatalystWriteAction, getWriteAdapter } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sage-tenant';

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('sage-admin', TENANT, 'sage@test.local', 'sage', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('intacct-adapter', 'Intacct', 'Sage Intacct', '3.0', 'XML', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('x3-adapter', 'X3', 'Sage X3', '12', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('pastel-adapter', 'Pastel', 'Sage Pastel', '21', 'SDK', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-intacct', ?, 'intacct-adapter', 'Intacct', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-x3', ?, 'x3-adapter', 'X3', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-pastel', ?, 'pastel-adapter', 'Pastel', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('sage-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const intacctCreds: IntacctCredentials = {
  sender_id: 'atheon', sender_password: 'spwd',
  company_id: 'acme', user_id: 'svc', user_password: 'upwd',
  live_mode: true,
};
const x3Creds: SageX3Credentials = {
  base_url: 'https://x3.acme.com', folder: 'PROD',
  client_id: 'cid', client_secret: 'csec',
  access_token: 'x3-tok', refresh_token: 'x3-ref',
  live_mode: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

function makeAction(connectionId: string, type: CatalystWriteAction['type'], payload: Record<string, unknown>): CatalystWriteAction {
  return {
    idempotency_key: 'k-' + Math.random().toString(36).slice(2),
    type, tenantId: TENANT, connectionId,
    catalystName: 'X', clusterId: 'sage-cluster',
    payload, value_zar: 1000,
  };
}

describe('Phase 9-6 — Sage Intacct live adapter', () => {
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

  function sessionResponse(): Response {
    return new Response(`<?xml version="1.0"?><response><operation><result><status>success</status><sessionid>SESS-1</sessionid><endpoint>https://api.intacct.com/ia/xml/xmlgw.phtml</endpoint></result></operation></response>`, { status: 200 });
  }
  function successResponse(): Response {
    return new Response(`<?xml version="1.0"?><response><operation><result><status>success</status></result></operation></response>`, { status: 200 });
  }

  it('po_create: getAPISession → create_potransaction; mode=live', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(successResponse());
    const result = await executeIntacctLive(
      makeAction('conn-intacct', 'po_create', { vendor_id: 'V1', line_items: [{ item_id: 'I1', quantity: 2, price: 50 }] }),
      { db: env.DB }, { ...intacctCreds }, { tenantId: TENANT, connectionId: 'conn-intacct' },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(fetchMock.mock.calls.length).toBe(2);
    // Second call carries sessionid (no <login>)
    const writeBody: string = fetchMock.mock.calls[1][1].body;
    expect(writeBody).toContain('<sessionid>SESS-1</sessionid>');
    expect(writeBody).toContain('create_potransaction');
    expect(writeBody).toContain('<itemid>I1</itemid>');
  });

  it('cached session_id skips re-auth', async () => {
    fetchMock.mockResolvedValueOnce(successResponse());
    const credCopy: IntacctCredentials = { ...intacctCreds, session_id: 'SESS-CACHED', session_endpoint: 'https://api.intacct.com/ia/xml/xmlgw.phtml' };
    const result = await executeIntacctLive(
      makeAction('conn-intacct', 'po_create', { vendor_id: 'V1', line_items: [] }),
      { db: env.DB }, credCopy, { tenantId: TENANT, connectionId: 'conn-intacct' },
    );
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(1);
  });

  it('Intacct error → mapped summary', async () => {
    fetchMock
      .mockResolvedValueOnce(sessionResponse())
      .mockResolvedValueOnce(new Response(`<?xml version="1.0"?><response><operation><result><status>failure</status><errormessage><error><description2>Vendor V1 not found</description2></error></errormessage></result></operation></response>`, { status: 200 }));
    const result = await executeIntacctLive(
      makeAction('conn-intacct', 'po_create', { vendor_id: 'V1', line_items: [] }),
      { db: env.DB }, { ...intacctCreds }, { tenantId: TENANT, connectionId: 'conn-intacct' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Vendor V1 not found');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Sage Intacct', 'autonomous',
      makeAction('conn-intacct', 'po_create', { vendor_id: 'V1', line_items: [] }),
      { db: env.DB, credentials: { /* no live_mode */ } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });
});

describe('Phase 9-6 — Sage X3 live adapter', () => {
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

  it('po_create: POSTs to /api1/x3/erp/{folder}/PORDERS', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ POHNUM: 'PO-X3-1' }), { status: 201 }));
    const result = await executeSageX3Live(
      makeAction('conn-x3', 'po_create', { vendor_code: 'V1', lines: [{ ITMREF: 'I1', QTY: 1 }] }),
      { db: env.DB }, { ...x3Creds }, { tenantId: TENANT, connectionId: 'conn-x3' },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(result.erp_reference).toBe('PO-X3-1');
    expect(fetchMock.mock.calls[0][0]).toContain('/api1/x3/erp/PROD/PORDERS');
  });

  it('__diagnoses[].message → mapped summary', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      __diagnoses: [{ message: 'BPSNUM not found' }],
    }), { status: 400 }));
    const result = await executeSageX3Live(
      makeAction('conn-x3', 'po_create', { vendor_code: 'V1', lines: [] }),
      { db: env.DB }, { ...x3Creds }, { tenantId: TENANT, connectionId: 'conn-x3' },
    );
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('BPSNUM not found');
  });

  it('Stub fallback when live_mode=false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Sage X3', 'autonomous',
      makeAction('conn-x3', 'po_create', { vendor_code: 'V1', lines: [] }),
      { db: env.DB, credentials: { /* no live_mode */ } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
  });
});

describe('Phase 9-6 — Sage Pastel adapter (SDK-only stub)', () => {
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

  it('always returns stub mode with documented SDK path; never calls fetch', async () => {
    const result = await dispatchWriteAction(env.DB, 'Sage Pastel', 'autonomous',
      makeAction('conn-pastel', 'po_create', { vendor_code: 'V1', lines: [{ qty: 1 }] }),
      { db: env.DB, credentials: { /* even with live_mode=true Pastel has no native HTTP */ live_mode: true } });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    const details = result.result?.details as { mode?: string; sdk_path?: string };
    expect(details.mode).toBe('stub');
    expect(details.sdk_path).toMatch(/Pastel SDK/);
  });
});

describe('Phase 9-6 — adapter resolver', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await setup();
  });

  it('"Sage Intacct" routes to intacct adapter (longest-key wins over generic Sage)', () => {
    expect(getWriteAdapter('Sage Intacct')?.vendor).toBe('Sage Intacct');
  });
  it('"Sage X3" routes to x3 adapter', () => {
    expect(getWriteAdapter('Sage X3')?.vendor).toBe('Sage X3');
  });
  it('"Sage Pastel" routes to pastel adapter', () => {
    expect(getWriteAdapter('Sage Pastel')?.vendor).toBe('Sage Pastel');
  });
  it('"Sage" still routes to original Business Cloud adapter (exact match)', () => {
    expect(getWriteAdapter('Sage')?.vendor).toBe('Sage');
  });
  it('"Sage Business Cloud" routes to Business Cloud (substring of "sage" wins)', () => {
    expect(getWriteAdapter('Sage Business Cloud')?.vendor).toBe('Sage');
  });
});
