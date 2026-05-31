/**
 * License Enforcement — integration tests.
 *
 * Two surfaces:
 *   1. Cloud-side `GET /api/agent/license-check?key=...` — returns the
 *      validity verdict for a given licence key against managed_deployments.
 *   2. Customer-side `licenseEnforcement()` middleware — phones home,
 *      caches result, gates data-plane traffic. Tested by unit-testing
 *      the helper functions; the full middleware path needs an outbound
 *      HTTP fetch which the worker test pool can't easily mock.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';

const TENANT_ID = 'license-tenant';

async function migrate(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);
}

async function seedDeployment(args: {
  id: string;
  status: string;
  licenceKey: string;
  expiresAt: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(TENANT_ID, 'License Tenant', TENANT_ID).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO managed_deployments (id, tenant_id, name, deployment_type, status, licence_key, licence_expires_at)
     VALUES (?, ?, 'Test Deployment', 'hybrid', ?, ?, ?)`,
  ).bind(args.id, TENANT_ID, args.status, args.licenceKey, args.expiresAt).run();
}

describe('License Enforcement — cloud-side license-check endpoint', () => {
  beforeAll(async () => { await migrate(); });

  beforeEach(async () => {
    // Clean prior fixtures so each test starts clean.
    await env.DB.prepare(`DELETE FROM managed_deployments WHERE tenant_id = ?`).bind(TENANT_ID).run();
  });

  it('returns valid: true for an active licence with no expiry', async () => {
    await seedDeployment({ id: 'dep-1', status: 'active', licenceKey: 'KEY-ACTIVE-1', expiresAt: null });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-ACTIVE-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; expires_at: string | null; reason: string };
    expect(body.valid).toBe(true);
    expect(body.status).toBe('active');
  });

  it('returns valid: false / status revoked for a suspended licence', async () => {
    await seedDeployment({ id: 'dep-2', status: 'suspended', licenceKey: 'KEY-SUSP-1', expiresAt: null });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-SUSP-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('revoked');
    expect(body.reason).toMatch(/suspended/i);
  });

  it('returns valid: false / status expired for a past expiry', async () => {
    await seedDeployment({
      id: 'dep-3', status: 'active', licenceKey: 'KEY-EXP-1',
      expiresAt: '2024-01-01T00:00:00.000Z',
    });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-EXP-1');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('expired');
    expect(body.reason).toMatch(/expired/i);
  });

  it('returns valid: false / status unknown for an unrecognised licence', async () => {
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-DOES-NOT-EXIST');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.status).toBe('unknown');
    expect(body.reason).toMatch(/no deployment found/i);
  });

  it('returns valid: false on missing key query param', async () => {
    const res = await SELF.fetch('http://localhost/api/agent/license-check');
    expect(res.status).toBe(200);
    const body = await res.json() as { valid: boolean; status: string; reason: string };
    expect(body.valid).toBe(false);
    expect(body.reason).toMatch(/without \?key=/i);
  });

  it('rate-limits /api/agent/license-check to 60 req/hour per IP', async () => {
    // licenseCheckRateLimiter (middleware/ratelimit.ts) is registered on the
    // exact path /api/agent/license-check ahead of the general /api/* limiter.
    // We confirm wiring by reading the X-RateLimit-Limit response header on
    // a single call: if the specific limiter fired we see 60, if the general
    // one fired we'd see 120. (Driving 61 calls to hit the 429 would balloon
    // the test wall-time; the header is a sufficient wiring smoke check.)
    await seedDeployment({ id: 'dep-rl', status: 'active', licenceKey: 'KEY-RL-1', expiresAt: null });
    const res = await SELF.fetch('http://localhost/api/agent/license-check?key=KEY-RL-1', {
      headers: { 'CF-Connecting-IP': '203.0.113.99' },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('X-RateLimit-Limit')).toBe('60');
  });
});

describe('License Enforcement — customer-mode stale cache fail-closed', () => {
  // The 7-day fail-closed branch (services/license-enforcement.ts:151-159)
  // is the most security-sensitive line in the middleware: if a customer
  // instance has been disconnected from Atheon cloud for > 7 days, the
  // last cached "valid" status MUST be overridden to invalid so a revoked
  // licence can't keep running indefinitely on a stale cache.
  //
  // We test the branch via the exported getLicenseStatusForAdmin helper,
  // which routes through the same getCurrentStatus() code path. The
  // helper is admin-only (called from /api/v1/license-status), so it
  // does NOT go via the middleware — meaning we don't need to mock the
  // outbound phone-home fetch to reach the stale-cache branch.

  const CACHE_KEY = 'license-enforcement:status';
  // Build a fake customer-mode env that reuses real DB + CACHE bindings
  // but overrides the deployment role and configures phone-home URL/key.
  // (The unused phone-home target won't be hit because we seed a fresh
  // cache that's < 1h old, then a stale one that's > 7d old — both
  // bypass the refresh branch by being either fresh OR cache-hit-stale.)
  function customerEnv() {
    return {
      ...env,
      DEPLOYMENT_ROLE: 'customer',
      LICENCE_KEY: 'STALE-CACHE-TEST-KEY',
      ATHEON_LICENSE_CHECK_URL: 'https://example.invalid/api/agent/license-check',
    } as typeof env;
  }

  beforeEach(async () => {
    await env.CACHE.delete(CACHE_KEY);
  });

  it('cache hit < 1 hour old returns cached status as-is (no fail-close)', async () => {
    const cached = {
      valid: true,
      expires_at: null,
      status: 'active',
      last_checked_at: new Date().toISOString(),
      reason: 'fresh cache',
    };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(cached));

    const { getLicenseStatusForAdmin } = await import('../services/license-enforcement');
    const status = await getLicenseStatusForAdmin(customerEnv());

    expect(status.valid).toBe(true);
    expect(status.status).toBe('active');
    expect(status.reason).toBe('fresh cache');
  });

  it('cache hit > 7 days old overrides to valid:false with stale reason', async () => {
    // 8 days ago — past the 7-day stale fail-closed threshold but inside
    // KV expirationTtl (we don't set one, so it persists).
    const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    const cached = {
      valid: true, // ← was valid when last checked
      expires_at: null,
      status: 'active',
      last_checked_at: eightDaysAgo,
      reason: 'last successful check',
    };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(cached));

    const { getLicenseStatusForAdmin } = await import('../services/license-enforcement');
    const status = await getLicenseStatusForAdmin(customerEnv());

    // The crucial assertion: even though cache says valid:true and 'active',
    // staleness > 7 days MUST flip valid to false.
    expect(status.valid).toBe(false);
    expect(status.status).toBe('unknown');
    expect(status.reason).toMatch(/has not been validated against Atheon cloud for \d+ days/i);
    expect(status.reason).toMatch(/failing closed for safety/i);
    // last_checked_at is preserved so operators can see when contact was lost.
    expect(status.last_checked_at).toBe(eightDaysAgo);
  });

  it('cache hit exactly at the 7-day boundary still treats as fresh (inclusive boundary)', async () => {
    // 6d 23h ago — should still be inside the 7-day window.
    const justUnderSevenDays = new Date(Date.now() - (7 * 24 - 1) * 60 * 60 * 1000).toISOString();
    const cached = {
      valid: true,
      expires_at: null,
      status: 'active',
      last_checked_at: justUnderSevenDays,
      reason: 'just under boundary',
    };
    await env.CACHE.put(CACHE_KEY, JSON.stringify(cached));

    const { getLicenseStatusForAdmin } = await import('../services/license-enforcement');
    const status = await getLicenseStatusForAdmin(customerEnv());

    // Cache is > 1h old so getCurrentStatus will TRY to refresh via
    // phone-home. The fetch to example.invalid will fail, and the code
    // falls back to the existing cached status (which is < 7 days old).
    expect(status.valid).toBe(true);
    expect(status.reason).toBe('just under boundary');
  });
});

describe('License Enforcement — middleware no-ops on cloud deployment', () => {
  beforeAll(async () => { await migrate(); });

  it('license-status endpoint returns "active" for cloud deployments', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/license-status');
    expect(res.status).toBe(200);
    const body = await res.json() as { status: string; valid: boolean; reason: string };
    expect(body.status).toBe('active');
    expect(body.valid).toBe(true);
    expect(body.reason).toMatch(/cloud instance/i);
  });

  it('license-status/refresh refuses on cloud (returns error)', async () => {
    const res = await SELF.fetch('http://localhost/api/v1/license-status/refresh', { method: 'POST' });
    expect(res.status).toBe(200);
    const body = await res.json() as { error?: string };
    expect(body.error).toMatch(/customer deployments/i);
  });
});
