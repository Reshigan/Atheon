/**
 * Phase 10-46 — dispatcher routing on production adapter IDs.
 *
 * Locks down the fix for a routing bug: the dispatcher's switch was
 * matching on `adapter_id` (e.g. 'sap_ecc', 'odoo', 'xero', 'netsuite')
 * but the production seed in migrate.ts inserts `'erp-sap-ecc'`,
 * `'erp-odoo'`, `'erp-xero'`, `'erp-ns'`. Every production tenant
 * would have fallen through to the generic stub instead of the real
 * write-back path.
 *
 * Fix: join erp_adapters and route on `system` (canonical name like
 * 'SAP', 'Odoo'), with adapter_id as the fallback. This test ensures
 * the production seed IDs route correctly even though they don't
 * match the test fixture IDs.
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { stageTransactionalAction, executePendingActions } from '../services/erp-writeback';
import { encrypt } from '../services/encryption';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'route-tenant';
const ENC_KEY = 'test-encryption-key-min-16-chars-for-hkdf';

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

  await env.DB.prepare(`DELETE FROM transactional_actions WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(TENANT).run();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, slug, plan, status)
     VALUES (?, 'Routing Test', ?, 'enterprise', 'active')`,
  ).bind(TENANT, `route-${Date.now()}`).run();

  // Production-seed adapter rows. The migrate.ts seed inserts these IDs but
  // they DON'T match the dispatcher's old `case 'xero'` switch.
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('erp-xero', 'Xero', 'Xero', '2.0', 'REST', 'available', '[]', '["OAuth 2.0"]')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('erp-odoo', 'Odoo', 'Odoo', '18.0', 'REST', 'available', '[]', '["OAuth 2.0"]')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('erp-ns', 'NetSuite', 'NetSuite', '2026.1', 'REST', 'available', '[]', '["Token-Based Auth"]')`,
  ).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('erp-sap-s4', 'SAP S/4HANA', 'SAP', '2025', 'OData V4', 'available', '[]', '["Basic Auth"]')`,
  ).run();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function approve(rowId: string): Promise<void> {
  await env.DB.prepare(`UPDATE transactional_actions SET status = 'approved' WHERE id = ?`).bind(rowId).run();
}

async function seedConn(id: string, adapterId: string, configPlain: string): Promise<void> {
  const enc = await encrypt(configPlain, ENC_KEY);
  await env.DB.prepare(
    `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, encrypted_config, sync_frequency, records_synced, connected_at)
     VALUES (?, ?, ?, ?, 'active', '{}', ?, 'hourly', 0, datetime('now'))`,
  ).bind(id, TENANT, adapterId, `Conn ${adapterId}`, enc).run();
}

describe('Phase 10-46 — production adapter ID routing', () => {
  it('routes adapter_id=erp-xero to dispatchXero (not the generic stub)', async () => {
    await seedConn('conn-erp-xero', 'erp-xero', JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-1',
      access_token: 'access-1', refresh_token: 'refresh-1',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    }));

    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ Invoices: [{ InvoiceID: 'inv-1', InvoiceNumber: 'INV-ROUTE-1' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-erp-xero',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-R1', sourceRecordRef: 'INV-R1',
      payload: {
        vendor_name: 'Acme', invoice: { invoice_number: 'INV-R1', invoice_date: '2026-04-15' },
        line_items: [{ description: 'svc', quantity: 1, unit_amount: 1000, account_code: '400' }],
      },
      reasoning: 'matched', postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approve(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
    const url = fetchSpy.mock.calls[0][0];
    expect(typeof url).toBe('string');
    expect(url as string).toContain('api.xero.com');

    // Posted external_doc_id should be the Xero invoice number, not the synth stub
    const r = await env.DB.prepare(
      `SELECT external_doc_id FROM transactional_actions WHERE id = ?`,
    ).bind(staged.id).first<{ external_doc_id: string }>();
    expect(r?.external_doc_id).toBe('INV-ROUTE-1');
  });

  it('routes adapter_id=erp-ns to dispatchNetsuite (not the generic stub)', async () => {
    await seedConn('conn-erp-ns', 'erp-ns', JSON.stringify({
      account_id: '1234567', consumer_key: 'CK', consumer_secret: 'CS',
      token_id: 'TID', token_secret: 'TSEC',
    }));

    const fetchSpy = vi.fn(async () => new Response('', {
      status: 204,
      headers: { Location: 'https://1234567.suitetalk.api.netsuite.com/services/rest/record/v1/vendorBill/9999' },
    }));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-erp-ns',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-R2', sourceRecordRef: 'INV-R2',
      payload: { vendor_internal_id: '17', expense_account_id: '400' },
      reasoning: 'm', postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approve(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);
    expect(fetchSpy).toHaveBeenCalled();
    expect(fetchSpy.mock.calls[0][0] as string).toContain('suitetalk.api.netsuite.com');

    const r = await env.DB.prepare(
      `SELECT external_doc_id FROM transactional_actions WHERE id = ?`,
    ).bind(staged.id).first<{ external_doc_id: string }>();
    expect(r?.external_doc_id).toBe('9999');
  });

  it('routes adapter_id=erp-odoo to dispatchOdoo (not the generic stub)', async () => {
    await seedConn('conn-erp-odoo', 'erp-odoo', JSON.stringify({
      url: 'https://acme.odoo.com', db: 'acme', login: 'bot', password: 'pw',
    }));

    let i = 0;
    const fetchSpy = vi.fn(async () => {
      i++;
      if (i === 1) {
        // odooAuthenticate
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: 5 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (i === 2) {
        // create
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: 99 }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (i === 3) {
        // action_post
        return new Response(JSON.stringify({ jsonrpc: '2.0', result: true }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      // read
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: [{ id: 99, name: 'BILL/2026/00099' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-erp-odoo',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-R3', sourceRecordRef: 'INV-R3',
      payload: { partner_id: 17, invoice: { invoice_number: 'INV-R3', invoice_date: '2026-04-15' } },
      reasoning: 'm', postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approve(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);
    // 4 calls: authenticate + create + action_post + read
    expect(fetchSpy).toHaveBeenCalledTimes(4);

    const r = await env.DB.prepare(
      `SELECT external_doc_id FROM transactional_actions WHERE id = ?`,
    ).bind(staged.id).first<{ external_doc_id: string }>();
    expect(r?.external_doc_id).toBe('BILL/2026/00099');
  });

  it('routes adapter_id=erp-sap-s4 to dispatchSap (not the generic stub)', async () => {
    await seedConn('conn-erp-sap', 'erp-sap-s4', JSON.stringify({
      base_url: 'https://my-sap.example.com', user: 'BOT', password: 'pw',
    }));

    let i = 0;
    const fetchSpy = vi.fn(async () => {
      i++;
      if (i === 1) {
        // CSRF GET
        return new Response('{"d":{}}', {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-csrf-token': 'TKN' },
        });
      }
      // POST supplier invoice
      return new Response(JSON.stringify({ d: { SupplierInvoice: '5105612345', FiscalYear: '2026' } }), {
        status: 201, headers: { 'content-type': 'application/json' },
      });
    });
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-erp-sap', subCatalystName: 'ap-3way-match',
      actionType: 'ap_invoice_post', targetEntity: 'INV-R4', sourceRecordRef: 'INV-R4',
      payload: {
        company_code: '1000', vendor_id: '0001000017', document_currency: 'USD', gross_amount: 1000,
        invoice: { invoice_number: 'INV-R4', invoice_date: '2026-04-15' },
      },
      reasoning: 'm', postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approve(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);
    // CSRF + POST = 2 calls
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1][0] as string).toContain('API_SUPPLIERINVOICE_PROCESS_SRV');

    const r = await env.DB.prepare(
      `SELECT external_doc_id FROM transactional_actions WHERE id = ?`,
    ).bind(staged.id).first<{ external_doc_id: string }>();
    expect(r?.external_doc_id).toBe('5105612345');
  });
});
