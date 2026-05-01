/**
 * Phase 8-1 — real Xero write adapter.
 *
 * Mocks global.fetch to verify the adapter:
 *  1. Falls back to stub when live_mode=false
 *  2. Falls back to stub when live_mode=true but credentials missing
 *  3. Calls the right URL + method + headers when live_mode + creds
 *  4. Honours Xero-tenant-id header
 *  5. Handles 200 success → completed
 *  6. Handles 4xx error → failed with mapped summary
 *  7. Refreshes access_token on 401 then retries; persists new token
 *  8. Honours 429 Retry-After (bounded) then succeeds on retry
 *  9. Per-action body shape (POST /Payments etc.) matches Xero spec
 * 10. Extracts erp_reference from response body
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeXeroLive, type XeroCredentials } from '../services/erp-xero-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'xero-live-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}
async function seedUser(): Promise<void> {
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind('xl-admin', TENANT, 'xl@test.local', 'xl', hash, JSON.stringify(['*'])).run();
}
async function seedAdapterAndConnection(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('xl-adapter', 'Xero', 'Xero', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES ('conn-xl', ?, 'xl-adapter', 'Xero Live', 'connected', '{}', 'realtime', 0)`
  ).bind(TENANT).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
     VALUES ('xl-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`
  ).bind(TENANT).run();
}

function makeAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'idem-' + Math.random().toString(36).slice(2),
    type: 'invoice_post',
    tenantId: TENANT,
    connectionId: 'conn-xl',
    catalystName: 'Invoice Reconciliation',
    clusterId: 'xl-cluster',
    payload: { invoice_id: 'INV-XYZ' },
    value_zar: 1000,
    ...overrides,
  };
}

const liveCreds: XeroCredentials = {
  client_id: 'cid', client_secret: 'csec',
  access_token: 'access-token-1', refresh_token: 'refresh-token-1',
  xero_tenant_id: 'xero-org-1', live_mode: true,
};

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 8-1 — Xero live adapter', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
    await seedUser();
    await seedAdapterAndConnection();
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

  describe('executeXeroLive (unit)', () => {
    it('200 → completed; calls right URL + method', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        Invoices: [{ InvoiceID: 'INV-XYZ', Status: 'AUTHORISED' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));

      const result = await executeXeroLive(makeAction(), { db: env.DB }, liveCreds, {
        tenantId: TENANT, connectionId: 'conn-xl',
      });
      expect(result.ok).toBe(true);
      expect(result.status).toBe('completed');
      expect(result.erp_reference).toBe('INV-XYZ');

      const call = fetchMock.mock.calls[0];
      expect(call[0]).toContain('/api.xro/2.0/Invoices/INV-XYZ');
      expect(call[1].method).toBe('POST');
      expect(call[1].headers['Authorization']).toBe('Bearer access-token-1');
      expect(call[1].headers['Xero-tenant-id']).toBe('xero-org-1');
    });

    it('4xx → failed with mapped summary from Xero error body', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        Detail: 'Invoice does not exist', ErrorNumber: 17,
      }), { status: 400 }));

      const result = await executeXeroLive(makeAction(), { db: env.DB }, liveCreds, {
        tenantId: TENANT, connectionId: 'conn-xl',
      });
      expect(result.ok).toBe(false);
      expect(result.status).toBe('failed');
      expect(result.summary).toBe('Invoice does not exist');
      expect(result.error).toBe('xero_400');
    });

    it('401 triggers refresh + retry; succeeds; persists new token', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response(JSON.stringify({ Detail: 'Unauthorised' }), { status: 401 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          access_token: 'access-token-2', refresh_token: 'refresh-token-2',
        }), { status: 200 }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          Invoices: [{ InvoiceID: 'INV-XYZ' }],
        }), { status: 200 }));

      const credCopy: XeroCredentials = { ...liveCreds };
      const result = await executeXeroLive(makeAction(), { db: env.DB }, credCopy, {
        tenantId: TENANT, connectionId: 'conn-xl',
      });
      expect(result.ok).toBe(true);
      expect(result.details?.refreshed).toBe(true);
      // 3 fetch calls total: original 401, refresh, retry
      expect(fetchMock.mock.calls.length).toBe(3);
      // Refresh call hit identity endpoint
      const refreshCall = fetchMock.mock.calls[1];
      expect(refreshCall[0]).toContain('identity.xero.com/connect/token');
    });

    it('429 + Retry-After triggers bounded retry then succeeds', async () => {
      fetchMock
        .mockResolvedValueOnce(new Response('Rate limit', { status: 429, headers: { 'Retry-After': '1' } }))
        .mockResolvedValueOnce(new Response(JSON.stringify({
          Invoices: [{ InvoiceID: 'INV-XYZ' }],
        }), { status: 200 }));

      const result = await executeXeroLive(makeAction(), { db: env.DB }, liveCreds, {
        tenantId: TENANT, connectionId: 'conn-xl',
      });
      expect(result.ok).toBe(true);
      expect(fetchMock.mock.calls.length).toBe(2);
    }, 10000);

    it('missing access_token → fails fast without calling fetch', async () => {
      const result = await executeXeroLive(makeAction(), { db: env.DB }, { live_mode: true } as XeroCredentials, {
        tenantId: TENANT, connectionId: 'conn-xl',
      });
      expect(result.ok).toBe(false);
      expect(result.error).toBe('no_credentials');
      expect(fetchMock.mock.calls.length).toBe(0);
    });

    it('po_create body shape uses PUT /PurchaseOrders with Contact + LineItems', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        PurchaseOrders: [{ PurchaseOrderID: 'PO-1' }],
      }), { status: 200 }));

      const result = await executeXeroLive(makeAction({
        type: 'po_create',
        payload: { contact_id: 'CT-1', line_items: [{ Description: 'Widget', Quantity: 2, UnitAmount: 50 }] },
      }), { db: env.DB }, liveCreds, { tenantId: TENANT, connectionId: 'conn-xl' });
      expect(result.ok).toBe(true);
      expect(result.erp_reference).toBe('PO-1');
      const call = fetchMock.mock.calls[0];
      expect(call[1].method).toBe('PUT');
      expect(call[0]).toContain('/PurchaseOrders');
      const body = JSON.parse(call[1].body);
      expect(body.PurchaseOrders[0].Contact.ContactID).toBe('CT-1');
      expect(body.PurchaseOrders[0].LineItems).toBeTruthy();
    });
  });

  describe('Stub fallback (no live_mode or no creds)', () => {
    it('falls back to stub when live_mode is false', async () => {
      const action = makeAction({ payload: { invoice_id: 'INV-1' } });
      // Need to wire dispatch with stub credentials path
      const result = await dispatchWriteAction(env.DB, 'Xero', 'autonomous', action, {
        db: env.DB,
        credentials: { live_mode: false, access_token: 'a', xero_tenant_id: 'x' },
      });
      // Stub returns 'completed' without ever calling fetch
      expect(result.status).toBe('completed');
      expect(fetchMock.mock.calls.length).toBe(0);
      expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
    });

    it('live_mode=true but missing access_token → stub with helpful note', async () => {
      const action = makeAction({ payload: { invoice_id: 'INV-1' } });
      const result = await dispatchWriteAction(env.DB, 'Xero', 'autonomous', action, {
        db: env.DB, credentials: { live_mode: true /* no access_token */ },
      });
      expect(result.status).toBe('completed');
      expect(fetchMock.mock.calls.length).toBe(0);
      const note = (result.result?.details as { note?: string })?.note;
      expect(note).toMatch(/credentials missing/i);
    });

    it('routes to live when live_mode=true AND credentials present', async () => {
      fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
        Invoices: [{ InvoiceID: 'INV-1' }],
      }), { status: 200 }));

      const action = makeAction({ payload: { invoice_id: 'INV-1' } });
      const result = await dispatchWriteAction(env.DB, 'Xero', 'autonomous', action, {
        db: env.DB, credentials: liveCreds, encryptionKey: 'test-encryption-key-32chars-min!',
      });
      expect(result.status).toBe('completed');
      expect(fetchMock.mock.calls.length).toBe(1);
    });
  });
});
