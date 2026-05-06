/**
 * Phase 10-44 — encrypted erp_connections.config at dispatch time.
 *
 * Validates that:
 *   - dispatchToErp reads encrypted_config (when present) and decrypts
 *     it with ENCRYPTION_KEY before passing to per-adapter dispatchers
 *   - falls back to plaintext config column when encrypted_config is NULL
 *     (legacy / pre-key tenants)
 *   - falls back to stub-and-log when encrypted_config is present but no
 *     ENCRYPTION_KEY is configured
 *   - falls back to stub-and-log when encrypted_config can't be decrypted
 *     (wrong key — AES-GCM auth tag mismatch)
 *   - Xero token persistence re-encrypts when the row was previously
 *     encrypted, instead of silently downgrading to plaintext
 */
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { stageTransactionalAction, executePendingActions } from '../services/erp-writeback';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';

const TENANT = 'enc-tenant';
const ENC_KEY = 'test-encryption-key-min-16-chars-for-hkdf';
const SETUP_SECRET = 'test-setup-secret-for-testing123';

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

  // Tenant — FK target for staging rows + erp_connections
  await env.DB.prepare(`DELETE FROM transactional_actions WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(TENANT).run();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, slug, plan, status)
     VALUES (?, 'Encrypted Config Test', ?, 'enterprise', 'active')`,
  ).bind(TENANT, `enc-tenant-${Date.now()}`).run();

  // Adapter rows — FK target for erp_connections.adapter_id
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, status) VALUES ('xero', 'Xero', 'xero', 'available')`,
  ).run();
}, 60_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

async function seedConnection(opts: {
  id: string;
  adapter_id: string;
  encrypted_config?: string | null;
  config?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, config, encrypted_config, sync_frequency, records_synced, connected_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?, 'hourly', 0, datetime('now'))`,
  ).bind(
    opts.id, TENANT, opts.adapter_id, `Test ${opts.adapter_id}`,
    opts.config ?? '{}', opts.encrypted_config ?? null,
  ).run();
}

async function approveOnly(rowId: string): Promise<void> {
  await env.DB.prepare(`UPDATE transactional_actions SET status = 'approved' WHERE id = ?`).bind(rowId).run();
}

describe('Phase 10-44 — encrypted erp_connections.config at dispatch', () => {
  it('decrypts encrypted_config and passes plaintext credentials to the Xero adapter', async () => {
    const xeroPlain = JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-1',
      access_token: 'access-1', refresh_token: 'refresh-1',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const enc = await encrypt(xeroPlain, ENC_KEY);
    expect(isEncrypted(enc)).toBe(true);
    await seedConnection({ id: 'conn-xero', adapter_id: 'xero', config: '{}', encrypted_config: enc });

    // Capture fetch — Xero PUT /Invoices succeeds
    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ Invoices: [{ InvoiceID: 'inv-uuid-1', InvoiceNumber: 'INV-0001' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-xero',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-9001', sourceRecordRef: 'INV-9001',
      payload: {
        vendor_name: 'Acme', invoice: { invoice_number: 'INV-9001', invoice_date: '2026-04-15' },
        line_items: [{ description: 'svc', quantity: 1, unit_amount: 1000, account_code: '400' }],
      },
      reasoning: 'matched', postedValue: 1000, currency: 'USD',
      autoApprove: false,
    });
    await approveOnly(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);
    expect(result.failed).toBe(0);

    // The fetch call must have used the decrypted access_token + tenant_id
    expect(fetchSpy).toHaveBeenCalled();
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-1');
    expect(headers['xero-tenant-id']).toBe('xero-tenant-1');
  });

  it('falls back to stub when encrypted_config is present but ENCRYPTION_KEY not configured', async () => {
    const xeroPlain = JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-1',
      access_token: 'access-1', refresh_token: 'refresh-1',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const enc = await encrypt(xeroPlain, ENC_KEY);
    await seedConnection({ id: 'conn-xero-2', adapter_id: 'xero', config: '{}', encrypted_config: enc });

    // No fetch should be called — stub path
    const fetchSpy = vi.fn(async () => new Response('should not be called', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-xero-2',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-9002', sourceRecordRef: 'INV-9002',
      payload: { vendor_name: 'X' }, reasoning: 'x', postedValue: 100, currency: 'USD', autoApprove: false,
    });
    await approveOnly(staged.id);

    // No encryption key — dispatch goes via stub path, returns synth doc
    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: undefined });
    expect(result.posted).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('falls back to stub when encrypted_config cannot be decrypted (wrong key)', async () => {
    const xeroPlain = JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-1',
      access_token: 'access-1', refresh_token: 'refresh-1',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    const enc = await encrypt(xeroPlain, ENC_KEY);
    await seedConnection({ id: 'conn-xero-3', adapter_id: 'xero', config: '{}', encrypted_config: enc });

    const fetchSpy = vi.fn(async () => new Response('should not be called', { status: 500 }));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-xero-3',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-9003', sourceRecordRef: 'INV-9003',
      payload: { vendor_name: 'X' }, reasoning: 'x', postedValue: 100, currency: 'USD', autoApprove: false,
    });
    await approveOnly(staged.id);

    // Wrong key — auth tag mismatch — null decrypt → stub path
    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: 'completely-different-key-also-16-chars' });
    expect(result.posted).toBe(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses plaintext config column when encrypted_config is NULL (legacy path)', async () => {
    const xeroPlain = JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-legacy',
      access_token: 'access-legacy', refresh_token: 'refresh-1',
      token_expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await seedConnection({ id: 'conn-xero-legacy', adapter_id: 'xero', config: xeroPlain, encrypted_config: null });

    const fetchSpy = vi.fn(async () => new Response(
      JSON.stringify({ Invoices: [{ InvoiceID: 'inv-uuid-9', InvoiceNumber: 'INV-9999' }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    ));
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-xero-legacy',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-9999', sourceRecordRef: 'INV-9999',
      payload: {
        vendor_name: 'Y', invoice: { invoice_number: 'INV-9999', invoice_date: '2026-04-15' },
        line_items: [{ description: 'svc', quantity: 1, unit_amount: 1000, account_code: '400' }],
      },
      reasoning: 'matched', confidence: 0.95, postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approveOnly(staged.id);

    // Even with no encryption key, plaintext config still works
    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: undefined });
    expect(result.posted).toBe(1);
    const init = fetchSpy.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer access-legacy');
  });

  it('re-encrypts the config when persisting refreshed Xero tokens (no plaintext downgrade)', async () => {
    const expiringSoon = new Date(Date.now() + 30_000).toISOString();
    const xeroPlain = JSON.stringify({
      client_id: 'CID', client_secret: 'CSEC', tenant_id: 'xero-tenant-rotate',
      access_token: 'access-OLD', refresh_token: 'refresh-OLD',
      token_expires_at: expiringSoon,
    });
    const enc = await encrypt(xeroPlain, ENC_KEY);
    await seedConnection({ id: 'conn-xero-rotate', adapter_id: 'xero', config: '{}', encrypted_config: enc });

    let i = 0;
    const fetchSpy = vi.fn(async () => {
      i++;
      // 1st call: token refresh; 2nd: the actual invoice POST
      if (i === 1) {
        return new Response(
          JSON.stringify({ access_token: 'access-NEW', refresh_token: 'refresh-NEW', expires_in: 1800 }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      }
      return new Response(
        JSON.stringify({ Invoices: [{ InvoiceID: 'inv-uuid-2', InvoiceNumber: 'INV-0002' }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    vi.stubGlobal('fetch', fetchSpy);

    const staged = await stageTransactionalAction(env.DB, {
      tenantId: TENANT, erpConnectionId: 'conn-xero-rotate',
      subCatalystName: 'ap-3way-match', actionType: 'ap_invoice_post',
      targetEntity: 'INV-0002', sourceRecordRef: 'INV-0002',
      payload: {
        vendor_name: 'Z', invoice: { invoice_number: 'INV-0002', invoice_date: '2026-04-15' },
        line_items: [{ description: 'svc', quantity: 1, unit_amount: 1000, account_code: '400' }],
      },
      reasoning: 'matched', confidence: 0.95, postedValue: 1000, currency: 'USD', autoApprove: false,
    });
    await approveOnly(staged.id);

    const result = await executePendingActions(env.DB, TENANT, { encryptionKey: ENC_KEY });
    expect(result.posted).toBe(1);

    // The connection's encrypted_config must STILL be encrypted (not downgraded
    // to plaintext) AND its config column must be '{}'.
    const row = await env.DB.prepare(
      'SELECT config, encrypted_config FROM erp_connections WHERE id = ?',
    ).bind('conn-xero-rotate').first<{ config: string; encrypted_config: string }>();
    expect(row?.config).toBe('{}');
    expect(row?.encrypted_config).toBeTruthy();
    expect(isEncrypted(row!.encrypted_config)).toBe(true);

    // And the rotated tokens must be present after decrypt
    const dec = await decrypt(row!.encrypted_config, ENC_KEY);
    expect(dec).toBeTruthy();
    const parsed = JSON.parse(dec!) as { access_token: string; refresh_token: string };
    expect(parsed.access_token).toBe('access-NEW');
    expect(parsed.refresh_token).toBe('refresh-NEW');
  });
});
