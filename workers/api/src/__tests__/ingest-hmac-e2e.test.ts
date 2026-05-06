/**
 * Phase 10-40 — End-to-end HMAC auth on /ingest/*.
 *
 * Validates that the wired middleware in index.ts actually
 * authenticates webhook callers without a JWT and rejects bad sigs.
 * Uses SELF.fetch (the real worker entrypoint) — the prior HMAC
 * tests used a synthetic Hono app to test the middleware in isolation.
 *
 * Coverage:
 *   - HMAC-signed POST /api/v1/ingest/ap-invoice succeeds (no JWT)
 *   - Same payload with WRONG signature → 401
 *   - JWT bearer (no HMAC headers) still works (back-compat)
 *   - HMAC + JWT both absent → tenantIsolation 401 (auth required)
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { generateToken } from '../middleware/auth';
import { provisionWebhookSecret, buildSignatureHeader } from '../services/webhook-hmac';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'ingest-hmac-e2e-test';

async function adminToken(): Promise<string> {
  return generateToken({
    sub: 'user-admin', email: 'admin@example.invalid', name: 'Admin',
    role: 'admin', tenant_id: TENANT, permissions: ['*'],
  }, env.JWT_SECRET as string);
}

describe('Phase 10-40 — /ingest HMAC end-to-end', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'HMAC E2E', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();
  }, 60_000);

  it('HMAC-signed POST /ingest/ap-invoice succeeds without JWT', async () => {
    const { secret } = await provisionWebhookSecret(
      env.DB, env.ENCRYPTION_KEY as string, TENANT,
      'src-bank-prod', 'Bank webhook (prod)', null,
    );
    const body = JSON.stringify({
      invoice_number: 'INV-HMAC-1', vendor_id: 'V-HMAC',
      vendor_name: 'HMAC Test Vendor', invoice_amount: 12345,
      invoice_date: '2026-05-01', due_date: '2026-05-31',
    });
    const sigHeader = await buildSignatureHeader(secret, body);

    const res = await SELF.fetch('http://localhost/api/v1/ingest/ap-invoice', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Atheon-Source': 'src-bank-prod',
        'X-Atheon-Tenant': TENANT,
        'X-Atheon-Signature': sigHeader,
      },
      body,
    });
    expect(res.status).toBe(200);
    const out = await res.json<{ inserted: number; duplicates: number }>();
    expect(out.inserted).toBe(1);

    // Confirm the row landed in the right tenant
    const row = await env.DB.prepare(
      `SELECT invoice_number, vendor_id, invoice_amount FROM ap_invoice_inbox WHERE tenant_id = ? AND invoice_number = ?`,
    ).bind(TENANT, 'INV-HMAC-1').first<{ invoice_number: string; vendor_id: string; invoice_amount: number }>();
    expect(row?.vendor_id).toBe('V-HMAC');
    expect(row?.invoice_amount).toBe(12345);
  });

  it('mismatched signature → 401', async () => {
    await provisionWebhookSecret(
      env.DB, env.ENCRYPTION_KEY as string, TENANT,
      'src-bad-sig-ingest', 'bad sig', null,
    );
    const body = JSON.stringify({ invoice_number: 'INV-BAD', vendor_id: 'V', invoice_amount: 100 });
    const wrongSig = await buildSignatureHeader('whsec_imposter', body);

    const res = await SELF.fetch('http://localhost/api/v1/ingest/ap-invoice', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'X-Atheon-Source': 'src-bad-sig-ingest',
        'X-Atheon-Tenant': TENANT,
        'X-Atheon-Signature': wrongSig,
      },
      body,
    });
    expect(res.status).toBe(401);
    const out = await res.json<{ error: string; reason?: string }>();
    expect(out.error).toContain('rejected');
    expect(out.reason).toContain('signature mismatch');

    // Confirm NOTHING got inserted
    const row = await env.DB.prepare(
      `SELECT invoice_number FROM ap_invoice_inbox WHERE tenant_id = ? AND invoice_number = 'INV-BAD'`,
    ).bind(TENANT).first<{ invoice_number: string }>();
    expect(row).toBeNull();
  });

  it('JWT bearer (no HMAC headers) still works — backward compat', async () => {
    const token = await adminToken();
    const res = await SELF.fetch('http://localhost/api/v1/ingest/ap-invoice', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        invoice_number: 'INV-JWT-1', vendor_id: 'V-JWT',
        vendor_name: 'JWT Test', invoice_amount: 5000,
      }),
    });
    expect(res.status).toBe(200);
    const out = await res.json<{ inserted: number }>();
    expect(out.inserted).toBe(1);
  });

  it('no auth at all → 401 (tenantIsolation rejects)', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/ingest/ap-invoice', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice_number: 'NOPE', vendor_id: 'V', invoice_amount: 1 }),
    });
    expect(res.status).toBe(401);
  });
});
