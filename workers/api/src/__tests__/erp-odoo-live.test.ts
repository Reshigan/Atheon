/**
 * Phase 9-2 — real Odoo write adapter (JSON-RPC).
 *
 * Mocks fetch to verify:
 *  1. live + creds + no cached uid → authenticate then execute_kw
 *  2. live + creds + cached uid → straight to execute_kw (no auth call)
 *  3. authenticate failure → returns auth_failed
 *  4. po_create returns numeric id → mapped to erp_reference
 *  5. Odoo business error in body → failed with mapped summary
 *  6. customer_credit_update body shape (write with [[id], {credit_limit}])
 *  7. Stub fallback when live_mode=false
 *  8. live_mode=true but credentials missing → stub with helpful note
 *  9. Dispatcher routes to live when complete creds present
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { executeOdooLive, type OdooCredentials } from '../services/erp-odoo-live';
import { dispatchWriteAction, type CatalystWriteAction } from '../services/erp-write-actions';
import '../services/erp-write-adapters';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'odoo-live-tenant';

async function setup(): Promise<void> {
  await env.DB.prepare(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(`INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`)
    .bind('odoo-admin', TENANT, 'odoo@test.local', 'odoo', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods) VALUES ('odoo-adapter', 'Odoo', 'Odoo', '17', 'JSON-RPC', 'available', '[]', '[]')`).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced) VALUES ('conn-odoo-live', ?, 'odoo-adapter', 'Odoo Live', 'connected', '{}', 'realtime', 0)`).bind(TENANT).run();
  await env.DB.prepare(`INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier) VALUES ('odoo-cluster', ?, 'Ops', 'finance', 'active', 'autonomous')`).bind(TENANT).run();
}

const liveCreds: OdooCredentials = {
  base_url: 'https://my.odoo.com',
  db: 'mydb', username: 'integration@me.com', api_key: 'k-1',
  live_mode: true,
};

function makeAction(overrides: Partial<CatalystWriteAction> = {}): CatalystWriteAction {
  return {
    idempotency_key: 'idem-' + Math.random().toString(36).slice(2),
    type: 'invoice_post',
    tenantId: TENANT, connectionId: 'conn-odoo-live',
    catalystName: 'Inv Recon', clusterId: 'odoo-cluster',
    payload: { move_id: 1234 },
    value_zar: 1000,
    ...overrides,
  };
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 9-2 — Odoo live adapter', () => {
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

  function rpcOk(result: unknown): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, result }), { status: 200 });
  }
  function rpcError(name: string, message: string): Response {
    return new Response(JSON.stringify({ jsonrpc: '2.0', id: 1, error: { code: 200, message: 'Odoo Server Error', data: { name, message } } }), { status: 200 });
  }

  it('no cached uid → authenticate then execute_kw', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk(7))    // authenticate returns uid 7
      .mockResolvedValueOnce(rpcOk(true)); // execute_kw returns true

    const result = await executeOdooLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-odoo-live',
    });
    expect(result.ok).toBe(true);
    expect(result.mode).toBe('live');
    expect(fetchMock.mock.calls.length).toBe(2);
    const authBody = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(authBody.params.service).toBe('common');
    expect(authBody.params.method).toBe('authenticate');
    const writeBody = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(writeBody.params.service).toBe('object');
    expect(writeBody.params.method).toBe('execute_kw');
    // args structure: [db, uid, key, model, method, [positional], {kwargs}]
    expect(writeBody.params.args[1]).toBe(7);
    expect(writeBody.params.args[3]).toBe('account.move');
    expect(writeBody.params.args[4]).toBe('action_post');
  });

  it('cached uid → no authenticate call, straight to execute_kw', async () => {
    fetchMock.mockResolvedValueOnce(rpcOk(true));

    const result = await executeOdooLive(makeAction(), { db: env.DB }, { ...liveCreds, uid: 42 }, {
      tenantId: TENANT, connectionId: 'conn-odoo-live',
    });
    expect(result.ok).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.params.args[1]).toBe(42);
  });

  it('authenticate fails → auth_failed', async () => {
    fetchMock.mockResolvedValueOnce(rpcOk(false));

    const result = await executeOdooLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-odoo-live',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toBe('auth_failed');
  });

  it('po_create returns numeric id → mapped to erp_reference', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk(7))
      .mockResolvedValueOnce(rpcOk(99)); // create returns id 99

    const result = await executeOdooLive(makeAction({
      type: 'po_create', payload: { partner_id: 1, order_line: [[0, 0, { product_id: 1, product_qty: 1 }]] },
    }), { db: env.DB }, { ...liveCreds }, { tenantId: TENANT, connectionId: 'conn-odoo-live' });
    expect(result.ok).toBe(true);
    expect(result.erp_reference).toBe('99');
  });

  it('Odoo business error in body → failed with mapped summary', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk(7))
      .mockResolvedValueOnce(rpcError('odoo.exceptions.UserError', 'Move 1234 already posted'));

    const result = await executeOdooLive(makeAction(), { db: env.DB }, { ...liveCreds }, {
      tenantId: TENANT, connectionId: 'conn-odoo-live',
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('Move 1234 already posted');
    expect(result.error).toBe('odoo.exceptions.UserError');
  });

  it('customer_credit_update body shape: write with [[id], {credit_limit}]', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk(7))
      .mockResolvedValueOnce(rpcOk(true));

    await executeOdooLive(makeAction({
      type: 'customer_credit_update',
      payload: { partner_id: 5, credit_limit: 100000 },
    }), { db: env.DB }, { ...liveCreds }, { tenantId: TENANT, connectionId: 'conn-odoo-live' });

    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.params.args[3]).toBe('res.partner');
    expect(body.params.args[4]).toBe('write');
    expect(body.params.args[5][0]).toEqual([5]);
    expect(body.params.args[5][1].credit_limit).toBe(100000);
  });

  it('Stub fallback when live_mode is false', async () => {
    const result = await dispatchWriteAction(env.DB, 'Odoo', 'autonomous', makeAction(), {
      db: env.DB, credentials: { /* no live_mode */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    expect((result.result?.details as { mode?: string })?.mode).toBe('stub');
  });

  it('live_mode=true but credentials missing → stub with helpful note', async () => {
    const result = await dispatchWriteAction(env.DB, 'Odoo', 'autonomous', makeAction(), {
      db: env.DB, credentials: { live_mode: true /* no other fields */ },
    });
    expect(result.status).toBe('completed');
    expect(fetchMock.mock.calls.length).toBe(0);
    const note = (result.result?.details as { note?: string })?.note;
    expect(note).toMatch(/credentials missing/i);
  });

  it('Dispatcher routes to live when live_mode + creds present', async () => {
    fetchMock
      .mockResolvedValueOnce(rpcOk(7))
      .mockResolvedValueOnce(rpcOk(true));

    const result = await dispatchWriteAction(env.DB, 'Odoo', 'autonomous', makeAction(), {
      db: env.DB, credentials: { ...liveCreds }, encryptionKey: 'test-encryption-key-32chars-min!',
    });
    expect(result.status).toBe('completed');
    expect(result.result?.mode).toBe('live');
  });
});
