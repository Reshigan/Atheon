/**
 * Phase 8-4 — post-action verification cron.
 *
 * Covers:
 *  1. Stub-mode action → verification_status = 'skipped'
 *  2. Preview-mode action → verification_status = 'skipped'
 *  3. Live Xero invoice_post + AUTHORISED → verified
 *  4. Live Xero invoice_post + DRAFT → failed (notification fired)
 *  5. Connection without live_mode credentials → skipped (not failed)
 *  6. Already-verified action does not re-verify
 *  7. ROI attribution excludes failed-verification actions from
 *     automated_value_zar
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import { verifyCompletedActions } from '../services/erp-action-verification';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'verify-tenant';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function setup(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
  const hash = await hashPassword('SecurePass1!');
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind('verify-admin', TENANT, 'verify@test.local', 'verify', hash, JSON.stringify(['*'])).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('verify-adapter', 'Test', 'Xero', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES ('conn-verify', ?, 'verify-adapter', 'Xero Verify', 'connected', ?, 'realtime', 0)`
  ).bind(TENANT, JSON.stringify({
    live_mode: true, access_token: 'tok-1', xero_tenant_id: 'org-1',
    client_id: 'c', client_secret: 's', refresh_token: 'r',
  })).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO catalyst_clusters (id, tenant_id, name, domain, status, autonomy_tier)
     VALUES ('verify-cluster', ?, 'AR', 'finance', 'active', 'autonomous')`
  ).bind(TENANT).run();
}

async function seedAction(opts: {
  id: string; mode?: 'live' | 'stub' | 'preview'; ageMinutes?: number;
  payloadInvoiceId?: string; valueZar?: number; verificationStatus?: string;
}): Promise<void> {
  const mode = opts.mode || 'live';
  const completedAt = new Date(Date.now() - (opts.ageMinutes || 0) * 60 * 1000).toISOString();
  const inputData = JSON.stringify({
    idempotency_key: 'idem-' + opts.id, type: 'invoice_post',
    tenantId: TENANT, connectionId: 'conn-verify', catalystName: 'Inv Recon',
    clusterId: 'verify-cluster', payload: { invoice_id: opts.payloadInvoiceId || 'INV-1' },
    value_zar: opts.valueZar || 1000,
  });
  const outputData = JSON.stringify({
    ok: true, status: 'completed', summary: 'done', mode,
    erp_reference: opts.payloadInvoiceId || 'INV-1',
  });
  await env.DB.prepare(
    `INSERT INTO catalyst_actions (
       id, tenant_id, cluster_id, catalyst_name, action, status,
       action_type, value_zar, connection_id, input_data, output_data,
       verification_status, completed_at
     ) VALUES (?, ?, 'verify-cluster', 'Inv Recon', 'invoice_post', 'completed',
              'invoice_post', ?, 'conn-verify', ?, ?, ?, ?)`
  ).bind(opts.id, TENANT, opts.valueZar || 1000, inputData, outputData,
         opts.verificationStatus || null, completedAt).run();
}

let fetchMock: ReturnType<typeof vi.fn>;

describe('Phase 8-4 — post-action verification', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await setup();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM catalyst_actions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM roi_tracking WHERE tenant_id = ?').bind(TENANT).run();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stub-mode action → skipped', async () => {
    await seedAction({ id: 'stub-1', mode: 'stub' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.skipped).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(0); // no API call
    const row = await env.DB.prepare(`SELECT verification_status FROM catalyst_actions WHERE id = 'stub-1'`).first<{ verification_status: string }>();
    expect(row?.verification_status).toBe('skipped');
  });

  it('preview-mode action → skipped', async () => {
    await seedAction({ id: 'preview-1', mode: 'preview' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.skipped).toBe(1);
  });

  it('live Xero invoice_post + AUTHORISED → verified', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      Invoices: [{ InvoiceID: 'INV-OK', Status: 'AUTHORISED' }],
    }), { status: 200 }));

    await seedAction({ id: 'live-ok', mode: 'live', payloadInvoiceId: 'INV-OK' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.verified).toBe(1);
    expect(fetchMock.mock.calls.length).toBe(1);
    const row = await env.DB.prepare(`SELECT verification_status, verification_notes FROM catalyst_actions WHERE id = 'live-ok'`).first<{ verification_status: string; verification_notes: string }>();
    expect(row?.verification_status).toBe('verified');
    expect(row?.verification_notes).toMatch(/AUTHORISED/);
  });

  it('live Xero invoice_post + DRAFT → failed + notification', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      Invoices: [{ InvoiceID: 'INV-BAD', Status: 'DRAFT' }],
    }), { status: 200 }));

    await seedAction({ id: 'live-bad', mode: 'live', payloadInvoiceId: 'INV-BAD' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.failed).toBe(1);
    const notif = await env.DB.prepare(
      `SELECT title, severity FROM notifications WHERE tenant_id = ? AND title LIKE '%verification failed%' ORDER BY created_at DESC LIMIT 1`
    ).bind(TENANT).first<{ title: string; severity: string }>();
    expect(notif).not.toBeNull();
    expect(notif!.severity).toBe('warning');
  });

  it('connection without live_mode → skipped (not failed)', async () => {
    // Replace connection's config to remove live_mode
    await env.DB.prepare(
      `UPDATE erp_connections SET config = ?, encrypted_config = NULL WHERE id = 'conn-verify' AND tenant_id = ?`
    ).bind(JSON.stringify({ /* no live_mode */ }), TENANT).run();

    await seedAction({ id: 'no-live', mode: 'live' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.skipped).toBe(1);
    expect(r.failed).toBe(0);

    // Restore for subsequent tests
    await env.DB.prepare(
      `UPDATE erp_connections SET config = ? WHERE id = 'conn-verify' AND tenant_id = ?`
    ).bind(JSON.stringify({
      live_mode: true, access_token: 'tok-1', xero_tenant_id: 'org-1',
      client_id: 'c', client_secret: 's', refresh_token: 'r',
    }), TENANT).run();
  });

  it('already-verified action does not re-verify', async () => {
    await seedAction({ id: 'already', mode: 'live', verificationStatus: 'verified' });
    const r = await verifyCompletedActions(env.DB, TENANT);
    expect(r.checked).toBe(0);
    expect(fetchMock.mock.calls.length).toBe(0);
  });

  it('ROI attribution excludes failed-verification actions from automated_value_zar', async () => {
    // Seed: 1 verified completed (R 100k) + 1 failed-verification (R 200k) + identified R 1m
    await env.DB.prepare(
      `INSERT INTO roi_tracking (id, tenant_id, period, total_discrepancy_value_identified, total_discrepancy_value_recovered, total_downstream_losses_prevented, total_person_hours_saved, total_catalyst_runs, licence_cost_annual, roi_multiple, calculated_at)
       VALUES (?, ?, '2026-05', 1000000, 100000, 0, 0, 0, 0, 0, datetime('now'))`
    ).bind(crypto.randomUUID(), TENANT).run();
    await seedAction({ id: 'roi-good', mode: 'live', valueZar: 100000, verificationStatus: 'verified' });
    await seedAction({ id: 'roi-bad', mode: 'live', valueZar: 200000, verificationStatus: 'failed' });
    await seedAction({ id: 'roi-deferred', mode: 'live', valueZar: 50000, verificationStatus: 'deferred' });

    const token = await postJSON('/api/v1/auth/login', { email: 'verify@test.local', password: 'SecurePass1!', tenant_slug: TENANT });
    const tokenJson = await token.json() as { token: string };
    const res = await authedGet('/api/v1/roi', tokenJson.token);
    expect(res.status).toBe(200);
    const body = await res.json() as { breakdown: { byActionState: { automated_value_zar: number; automated_count: number } } };
    // Only verified + deferred should count toward automated; failed excluded.
    expect(body.breakdown.byActionState.automated_value_zar).toBe(150000);
    expect(body.breakdown.byActionState.automated_count).toBe(2);
  });
});
