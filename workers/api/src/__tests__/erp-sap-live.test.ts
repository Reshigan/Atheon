/**
 * Phase 9-1 — real SAP S/4HANA write adapter.
 *
 * Mocks fetch to verify:
 *  1. live_mode + creds → real call to SAP OData endpoint
 *  2. CSRF fetch precedes write call (x-csrf-token: fetch then echoed)
 *  3. 401 → refresh client_credentials token + retry
 *  4. 429 / 503 + Retry-After → bounded retry then succeeds
 *  5. SAP error.message.value surfaced as ActionExecutionResult.summary
 *  6. po_create body wraps PurchaseOrderItem in OData `to_*` shape
 *  7. customer_credit_update uses PATCH path with composite key
 *  8. live success returns mode='live' with PurchaseOrder id extracted
 *  9. Missing base_url → no_credentials, no fetch calls
 * 10. Stub fallback when live_mode=false
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeSapLive, type SapCredentials } from '../services/erp-sap-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-live-tenant';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('sap-admin', TENANT, 'sap@test.local', 'sap', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('sap-adapter', 'Test SAP', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-sap-live', ?, 'sap-adapter', 'SAP Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('sap-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const liveCreds: SapCredentials = {
  base_url: 'https://my.s4hana.cloud',
  client_id: 'cid', client_secret: 'csec',
  access_token: 'sap-token-1', expires_at: Date.now() + 3600_000,
  live_mode: true,
};

function makeAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'idem-' + Math.random().toString(36).slice(2),
    type: 'invoice_post',
    tenantId: TENANT, connectionId: 'conn-sap-live',
    catalystName: 'AR Collection', clusterId: 'sap-cluster',
    payload: { billing_doc_id: 'BD-1' },
    value_zar: 1000,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 9-1 — SAP live adapter', () => {
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
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function csrfResponse(): Response {
    return new Response('', { status: 200, headers: { 'x-csrf-token': 'CSRF-XYZ' } });
  }

  it('live invoice_post: fetches CSRF then POSTs body; returns mode=live', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        d: { BillingDocument: 'BD-1' },
      }), { status: 200 }));

    const result = await executeSapLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-sap-live',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');

    expect(fetchMock.mock.calls.length).toBe(2);
    // First call: CSRF fetch GET
    const csrfCall = fetchMock.mock.calls[0];
    expect(csrfCall[0]).toContain('$metadata');
    expect(csrfCall[1].method).toBe('GET');
    expect(csrfCall[1].headers['x-csrf-token']).toBe('fetch');
    // Second call: write POST with echoed token
    const writeCall = fetchMock.mock.calls[1];
    expect(writeCall[0]).toContain('/API_BILLINGDOCUMENT_SRV/A_BillingDocument');
    expect(writeCall[1].method).toBe('POST');
    expect(writeCall[1].headers['x-csrf-token']).toBe('CSRF-XYZ');
  });

  it('401 triggers token refresh + retry', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())  // first CSRF
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: { value: 'Unauthorised' } } }), { status: 401 })) // first write
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'sap-token-2', expires_in: 3600 }), { status: 200 })) // refresh
      .mockResolvedValueOnce(csrfResponse())  // refetch CSRF
      .mockResolvedValueOnce(new Response(JSON.stringify({ d: { BillingDocument: 'BD-1' } }), { status: 200 })); // retry write

    const credCopy = { ...liveCreds };
    const result = await executeSapLive(makeAction(), { db: env.DB }, credCopy, {
      tenantId: TENANT, connectionId: 'conn-sap-live',
    });
    expect(result.ok).toBe(true);
    expect(result.details?.refreshed).toBe(true);
  });

  it('429 + Retry-After triggers bounded retry then succeeds', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response('throttled', { status: 429, headers: { 'Retry-After': '1' } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ d: {} }), { status: 200 }));

    const result = await executeSapLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-sap-live',
    });
    expect(result.ok).toBe(true);
  }, 10000);

  it('SAP error.message.value is surfaced as the summary', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({
        error: { code: 'INV_REQ', message: { value: 'BillingDocument BD-X does not exist' } },
      }), { status: 400 }));

    const result = await executeSapLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-sap-live',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('BillingDocument BD-X does not exist');
    expect(result.error).toBe('sap_400');
  });

  it('po_create body uses to_PurchaseOrderItem.results wrapper', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ d: { PurchaseOrder: 'PO-99' } }), { status: 200 }));

    const result = await executeSapLive(makeAction({
      type: 'po_create',
      payload: { vendor_code: 'V1', company_code: '0001', items: [{ Material: 'MAT-1', OrderQuantity: 10 }] },
    }), { db: env.DB }, { ...liveCreds }, { tenantId: TENANT, connectionId: 'conn-sap-live' });
    expect(result.ok).toBe(true);
    expect(result.erp_reference).toBe('PO-99');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.to_PurchaseOrderItem.results).toHaveLength(1);
  });

  it('customer_credit_update uses PATCH with composite key in path', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ d: {} }), { status: 200 }));

    await executeSapLive(makeAction({
      type: 'customer_credit_update',
      payload: { customer_code: 'C1', company_code: '0001', credit_limit: 50000 },
    }), { db: env.DB }, { ...liveCreds }, { tenantId: TENANT, connectionId: 'conn-sap-live' });

    const writeCall = fetchMock.mock.calls[1];
    expect(writeCall[1].method).toBe('PATCH');
    expect(writeCall[0]).toContain("BusinessPartner='C1'");
  });

  it('missing base_url → no_credentials, no fetch calls', async () => {
    const result = await executeSapLive(makeAction(), { db: env.DB }, { live_mode: true } as SapCredentials, {
      tenantId: TENANT, connectionId: 'conn-sap-live',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('no_credentials');
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('Stub fallback when live_mode is false', async () => {
    const result = await dispatchWriteAction(env.DB, 'SAP', 'autonomous', makeAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });

  it('Dispatcher routes to live when live_mode + creds present', async () => {
    fetchMock
      .mockResolvedValueOnce(csrfResponse())
      .mockResolvedValueOnce(new Response(JSON.stringify({ d: { BillingDocument: 'BD-1' } }), { status: 200 }));

    const result = await dispatchWriteAction(env.DB, 'SAP', 'autonomous', makeAction(), {
      db: env.DB, credentials: { ...liveCreds }, encryptionKey: 'test-encryption-key-32chars-min!',
    });
    expect(result.status).toBe('completed');
    expect(result.result?.mode).toBe('live');
  });

  // Quiet the unused-import warning for postJSON; kept for future expansion.
  void postJSON;
});
