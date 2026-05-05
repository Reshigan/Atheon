/**
 * Phase 10-37 — Webhook HMAC verification + admin CRUD.
 *
 * Validates the Stripe-style signed-webhook auth path that lets
 * untrusted-network callers (banks, T&E SaaS, payment processors)
 * post to /ingest/* without a JWT.
 *
 * Coverage:
 *   - verifyWebhookSignature passes correctly-signed requests
 *   - rejects mismatched signature
 *   - rejects expired timestamp (replay window)
 *   - rejects when no active secret exists for source
 *   - rejects after secret revocation
 *   - rotation produces a new working secret + invalidates the old
 *   - admin routes: list / provision / rotate / revoke
 *   - admin routes: 403 for analyst role
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { generateToken } from '../middleware/auth';
import {
  verifyWebhookSignature, provisionWebhookSecret, revokeWebhookSecret,
  buildSignatureHeader,
} from '../services/webhook-hmac';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'webhook-hmac-test';

async function tokenFor(role: string): Promise<string> {
  return generateToken({
    sub: `user-${role}`,
    email: `${role}@example.invalid`,
    name: `Test ${role}`,
    role,
    tenant_id: TENANT,
    permissions: ['*'],
  }, env.JWT_SECRET as string);
}

async function authedFetch(path: string, opts: RequestInit & { role?: string } = {}) {
  const role = opts.role ?? 'admin';
  const token = await tokenFor(role);
  const headers = new Headers(opts.headers || {});
  headers.set('Authorization', `Bearer ${token}`);
  if (opts.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  return SELF.fetch(`http://localhost${path}`, { ...opts, headers });
}

describe('Phase 10-37 — webhook HMAC verification', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'HMAC Test', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();
  }, 60_000);

  it('verifies a correctly-signed request', async () => {
    const { secret } = await provisionWebhookSecret(env.DB, TENANT, 'src-stripe-test', 'Stripe webhook (test)', null);
    const body = JSON.stringify({ event: 'test', payload: { x: 1 } });
    const sigHeader = await buildSignatureHeader(secret, body);

    const result = await verifyWebhookSignature(env.DB, TENANT, 'src-stripe-test', sigHeader, body);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.secret.source_id).toBe('src-stripe-test');
      expect(result.secret.status).toBe('active');
    }
  });

  it('rejects a mismatched signature', async () => {
    await provisionWebhookSecret(env.DB, TENANT, 'src-bad-sig', 'bad sig test', null);
    const body = JSON.stringify({ event: 'test' });
    // Sign with a DIFFERENT secret
    const wrongSig = await buildSignatureHeader('whsec_wrong', body);

    const result = await verifyWebhookSignature(env.DB, TENANT, 'src-bad-sig', wrongSig, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('signature mismatch');
  });

  it('rejects an expired timestamp', async () => {
    const { secret } = await provisionWebhookSecret(env.DB, TENANT, 'src-old-ts', 'old ts test', null);
    const body = JSON.stringify({ event: 'old' });
    const oldTs = Math.floor(Date.now() / 1000) - 600; // 10 min ago
    const sigHeader = await buildSignatureHeader(secret, body, oldTs);

    const result = await verifyWebhookSignature(env.DB, TENANT, 'src-old-ts', sigHeader, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('timestamp out of window');
  });

  it('rejects when no active secret exists', async () => {
    const body = JSON.stringify({ event: 'no-secret' });
    const sigHeader = await buildSignatureHeader('whsec_anything', body);

    const result = await verifyWebhookSignature(env.DB, TENANT, 'src-does-not-exist', sigHeader, body);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('no active webhook secret');
  });

  it('rejects after revocation', async () => {
    const { secret, secretRow } = await provisionWebhookSecret(env.DB, TENANT, 'src-revoke', 'revoke test', null);
    const body = JSON.stringify({ event: 'revoked' });

    // First, signed request works
    const sigHeader = await buildSignatureHeader(secret, body);
    const before = await verifyWebhookSignature(env.DB, TENANT, 'src-revoke', sigHeader, body);
    expect(before.ok).toBe(true);

    // Now revoke
    const revoked = await revokeWebhookSecret(env.DB, TENANT, secretRow.id, 'security incident');
    expect(revoked).toBe(true);

    // Fresh signature, but secret is gone
    const fresh = await buildSignatureHeader(secret, body);
    const after = await verifyWebhookSignature(env.DB, TENANT, 'src-revoke', fresh, body);
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.reason).toContain('no active webhook secret');
  });

  it('rotation invalidates the old secret + new secret works', async () => {
    const first = await provisionWebhookSecret(env.DB, TENANT, 'src-rotate', 'rotate test', null);
    const second = await provisionWebhookSecret(env.DB, TENANT, 'src-rotate', 'rotate test v2', null);

    expect(first.secret).not.toBe(second.secret);
    const body = JSON.stringify({ event: 'rotated' });

    // Old secret can't sign anymore (it's now status='rotated')
    const oldSig = await buildSignatureHeader(first.secret, body);
    const oldResult = await verifyWebhookSignature(env.DB, TENANT, 'src-rotate', oldSig, body);
    expect(oldResult.ok).toBe(false);

    // New secret works
    const newSig = await buildSignatureHeader(second.secret, body);
    const newResult = await verifyWebhookSignature(env.DB, TENANT, 'src-rotate', newSig, body);
    expect(newResult.ok).toBe(true);
  });

  it('rejects malformed signature header', async () => {
    await provisionWebhookSecret(env.DB, TENANT, 'src-malformed', 'malformed test', null);
    const body = JSON.stringify({ event: 'malformed' });

    const r1 = await verifyWebhookSignature(env.DB, TENANT, 'src-malformed', null, body);
    expect(r1.ok).toBe(false);

    const r2 = await verifyWebhookSignature(env.DB, TENANT, 'src-malformed', 'just-some-string', body);
    expect(r2.ok).toBe(false);

    const r3 = await verifyWebhookSignature(env.DB, TENANT, 'src-malformed', 't=999,v1=tooshort', body);
    expect(r3.ok).toBe(false);
  });
});

describe('Phase 10-37 — webhook-secrets admin routes', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'HMAC Routes', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();
  }, 60_000);

  it('full flow: provision → list → rotate → revoke', async () => {
    // Provision
    const provRes = await authedFetch('/api/v1/webhook-secrets', {
      method: 'POST',
      body: JSON.stringify({ source_id: 'src-route-test', label: 'Route flow test' }),
    });
    expect(provRes.status).toBe(200);
    const provBody = await provRes.json<{ secret: string; secret_row: { id: string; source_id: string; secret_prefix: string }; note: string }>();
    expect(provBody.secret).toMatch(/^whsec_[0-9a-f]{64}$/);
    expect(provBody.secret_row.source_id).toBe('src-route-test');
    expect(provBody.secret_row.secret_prefix).toMatch(/^whsec_…/);
    expect(provBody.note).toContain('cannot be retrieved later');
    const firstSecretId = provBody.secret_row.id;

    // List
    const listRes = await authedFetch('/api/v1/webhook-secrets');
    const listBody = await listRes.json<{ secrets: Array<{ id: string; source_id: string; status: string; secret_prefix: string }> }>();
    const ours = listBody.secrets.find((s) => s.id === firstSecretId);
    expect(ours).toBeDefined();
    expect(ours!.status).toBe('active');
    // Critical: list endpoint MUST NOT return the raw secret value
    expect(JSON.stringify(listBody)).not.toContain(provBody.secret);

    // Rotate
    const rotRes = await authedFetch(`/api/v1/webhook-secrets/${firstSecretId}/rotate`, {
      method: 'POST', body: JSON.stringify({}),
    });
    expect(rotRes.status).toBe(200);
    const rotBody = await rotRes.json<{ secret: string; secret_row: { id: string; status: string } }>();
    expect(rotBody.secret).not.toBe(provBody.secret);
    expect(rotBody.secret_row.status).toBe('active');
    expect(rotBody.secret_row.id).not.toBe(firstSecretId);

    // After rotation, the OLD row's status is 'rotated' (not 'active')
    const afterRotate = await authedFetch('/api/v1/webhook-secrets');
    const afterRotateBody = await afterRotate.json<{ secrets: Array<{ id: string; status: string }> }>();
    const oldRow = afterRotateBody.secrets.find((s) => s.id === firstSecretId);
    expect(oldRow!.status).toBe('rotated');

    // Revoke the new one
    const revRes = await authedFetch(`/api/v1/webhook-secrets/${rotBody.secret_row.id}`, {
      method: 'DELETE', body: JSON.stringify({ reason: 'integration sunset' }),
    });
    expect(revRes.status).toBe(200);

    // After revoke, the row's status is 'revoked'
    const afterRevoke = await authedFetch('/api/v1/webhook-secrets');
    const afterRevokeBody = await afterRevoke.json<{ secrets: Array<{ id: string; status: string }> }>();
    const newRow = afterRevokeBody.secrets.find((s) => s.id === rotBody.secret_row.id);
    expect(newRow!.status).toBe('revoked');
  });

  it('source_id validation rejects invalid characters', async () => {
    const res = await authedFetch('/api/v1/webhook-secrets', {
      method: 'POST', body: JSON.stringify({ source_id: 'has spaces', label: 'bad' }),
    });
    expect(res.status).toBe(400);
  });

  it('analyst role is forbidden from CRUD', async () => {
    const res = await authedFetch('/api/v1/webhook-secrets', {
      method: 'POST', body: JSON.stringify({ source_id: 'src-analyst', label: 'no' }),
      role: 'analyst',
    });
    expect(res.status).toBe(403);
  });

  it('list does not leak any secret values', async () => {
    const { secret } = await provisionWebhookSecret(env.DB, TENANT, 'src-leak-test', 'Leak test', null);
    const res = await authedFetch('/api/v1/webhook-secrets');
    const body = await res.text();
    expect(body).not.toContain(secret);
    expect(body).not.toContain('secret_hash');
  });
});
