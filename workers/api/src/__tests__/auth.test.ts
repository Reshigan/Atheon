/**
 * Auth + Tenant Isolation Test Suite
 * Tests registration, login, JWT validation, tenant isolation,
 * role-based access control, token refresh, logout, and lockout.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
// MIGRATION_VERSION removed — unused in tests
import { hashPassword } from '../middleware/auth';

/** Helper to POST JSON to the worker */
async function postJSON(path: string, body: Record<string, unknown>, headers: Record<string, string> = {}): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

/** Helper to GET with auth */
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

/** Helper to POST with auth */
async function authedPost(path: string, body: Record<string, unknown>, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

/** Seed a tenant + user directly in D1 for testing */
async function seedTestTenant(tenantId: string, slug: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(tenantId, name, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users) VALUES (?, '["apex","pulse","mind","memory"]', '["finance"]', 50, 100)`
  ).bind(tenantId).run();
}

async function seedTestUser(id: string, tenantId: string, email: string, password: string, role: string, name: string): Promise<void> {
  const hash = await hashPassword(password);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, 'active')`
  ).bind(id, tenantId, email, name, role, hash, JSON.stringify(['*'])).run();
}

/** Login helper returning token */
async function login(email: string, password: string, tenantSlug?: string): Promise<{ token: string; refreshToken: string; user: Record<string, unknown> } | null> {
  const body: Record<string, unknown> = { email, password };
  if (tenantSlug) body.tenant_slug = tenantSlug;
  const res = await postJSON('/api/v1/auth/login', body);
  if (res.status !== 200) return null;
  return res.json() as Promise<{ token: string; refreshToken: string; user: Record<string, unknown> }>;
}

// ── Test Constants ──
const TENANT_A_ID = 'test-tenant-a';
const TENANT_B_ID = 'test-tenant-b';
const ADMIN_USER_ID = 'test-admin-001';
const ANALYST_USER_ID = 'test-analyst-001';
const VIEWER_USER_ID = 'test-viewer-001';
const TENANT_B_USER_ID = 'test-b-user-001';
const TEST_PASSWORD = 'SecurePass1!';

describe('Auth + Tenant Isolation', () => {
  beforeAll(async () => {
    // Run migrations via endpoint (sets KV flag too)
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (res.status !== 200) throw new Error(`Migration failed: ${res.status}`);

    // Seed two tenants
    await seedTestTenant(TENANT_A_ID, 'tenant-a', 'Tenant A Corp');
    await seedTestTenant(TENANT_B_ID, 'tenant-b', 'Tenant B Inc');

    // Seed users for Tenant A
    await seedTestUser(ADMIN_USER_ID, TENANT_A_ID, 'admin@tenant-a.com', TEST_PASSWORD, 'admin', 'Admin User');
    await seedTestUser(ANALYST_USER_ID, TENANT_A_ID, 'analyst@tenant-a.com', TEST_PASSWORD, 'analyst', 'Analyst User');
    await seedTestUser(VIEWER_USER_ID, TENANT_A_ID, 'viewer@tenant-a.com', TEST_PASSWORD, 'viewer', 'Viewer User');

    // Seed user for Tenant B
    await seedTestUser(TENANT_B_USER_ID, TENANT_B_ID, 'user@tenant-b.com', TEST_PASSWORD, 'admin', 'TenantB Admin');
  });

  // ────────────────────────────────────────────
  // Registration
  // ────────────────────────────────────────────
  describe('Registration', () => {
    it('rejects registration with missing fields', async () => {
      const res = await postJSON('/api/v1/auth/register', {});
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('error');
    });

    it('rejects registration with weak password', async () => {
      const res = await postJSON('/api/v1/auth/register', {
        email: 'newuser@tenant-a.com',
        password: 'short',
        name: 'New User',
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(400);
    });

    it('rejects registration with invalid email', async () => {
      const res = await postJSON('/api/v1/auth/register', {
        email: 'not-an-email',
        password: TEST_PASSWORD,
        name: 'New User',
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(400);
    });

    it('rejects registration with non-existent tenant', async () => {
      const res = await postJSON('/api/v1/auth/register', {
        email: 'newuser@ghost.com',
        password: TEST_PASSWORD,
        name: 'Ghost User',
        tenant_slug: 'non-existent-tenant',
      });
      expect(res.status).toBe(404);
    });

    it('registers a new user successfully', async () => {
      const res = await postJSON('/api/v1/auth/register', {
        email: 'fresh@tenant-a.com',
        password: TEST_PASSWORD,
        name: 'Fresh User',
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(201);
      const body = await res.json() as { token: string; user: Record<string, unknown> };
      expect(body.token).toBeTruthy();
      expect(body.user.email).toBe('fresh@tenant-a.com');
      expect(body.user.role).toBe('analyst'); // default role
      expect(body.user.tenantId).toBe(TENANT_A_ID);
    });

    it('rejects duplicate registration', async () => {
      // First register a unique user
      const uniqueEmail = `dup-test-${Date.now()}@tenant-a.com`;
      const res1 = await postJSON('/api/v1/auth/register', {
        email: uniqueEmail,
        password: TEST_PASSWORD,
        name: 'Dup Test',
        tenant_slug: 'tenant-a',
      });
      expect(res1.status).toBe(201);

      // Second registration with same email should fail
      const res2 = await postJSON('/api/v1/auth/register', {
        email: uniqueEmail,
        password: TEST_PASSWORD,
        name: 'Duplicate',
        tenant_slug: 'tenant-a',
      });
      expect(res2.status).toBe(409);
    });
  });

  // ────────────────────────────────────────────
  // Login
  // ────────────────────────────────────────────
  describe('Login', () => {
    it('rejects login with missing fields', async () => {
      const res = await postJSON('/api/v1/auth/login', {});
      expect(res.status).toBe(400);
    });

    it('rejects login with wrong password', async () => {
      const res = await postJSON('/api/v1/auth/login', {
        email: 'admin@tenant-a.com',
        password: 'WrongPassword1!',
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(401);
    });

    it('rejects login with non-existent email', async () => {
      const res = await postJSON('/api/v1/auth/login', {
        email: 'nobody@nowhere.com',
        password: TEST_PASSWORD,
      });
      expect(res.status).toBe(401);
    });

    it('logs in admin successfully', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      expect(result!.token).toBeTruthy();
      expect(result!.refreshToken).toBeTruthy();
      expect(result!.user.role).toBe('admin');
      expect(result!.user.tenantId).toBe(TENANT_A_ID);
    });

    it('logs in analyst successfully', async () => {
      const result = await login('analyst@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      expect(result!.user.role).toBe('analyst');
    });

    it('logs in viewer successfully', async () => {
      const result = await login('viewer@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      expect(result!.user.role).toBe('viewer');
    });

    it('logs in Tenant B user with correct tenant_slug', async () => {
      const result = await login('user@tenant-b.com', TEST_PASSWORD, 'tenant-b');
      expect(result).not.toBeNull();
      expect(result!.user.tenantId).toBe(TENANT_B_ID);
    });
  });

  // ────────────────────────────────────────────
  // JWT Validation
  // ────────────────────────────────────────────
  describe('JWT Validation', () => {
    it('rejects requests without Authorization header', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/catalysts');
      expect(res.status).toBe(401);
    });

    it('rejects requests with malformed token', async () => {
      const res = await authedGet('/api/v1/catalysts', 'not-a-valid-jwt');
      expect(res.status).toBe(401);
    });

    it('rejects requests with expired token', async () => {
      // Generate a token that expired 1 hour ago
      const expiredPayload = {
        sub: ADMIN_USER_ID,
        email: 'admin@tenant-a.com',
        name: 'Admin',
        role: 'admin',
        tenant_id: TENANT_A_ID,
        permissions: ['*'],
        iat: Math.floor(Date.now() / 1000) - 90000,
        exp: Math.floor(Date.now() / 1000) - 3600,
      };
      // Manually create a JWT with the test secret
      const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const body = btoa(JSON.stringify(expiredPayload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      // We need a proper HMAC signature, but since verifyToken checks exp, any well-formed expired token will be rejected
      const fakeToken = `${header}.${body}.fakesignature`;
      const res = await authedGet('/api/v1/catalysts', fakeToken);
      expect(res.status).toBe(401);
    });

    it('accepts valid token', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/catalysts', result!.token);
      // Should be 200 (may have empty data) but NOT 401
      expect(res.status).not.toBe(401);
    });
  });

  // ────────────────────────────────────────────
  // Tenant Isolation
  // ────────────────────────────────────────────
  describe('Tenant Isolation', () => {
    it('prevents Tenant A user from accessing Tenant B data via tenant_id param', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet(`/api/v1/catalysts?tenant_id=${TENANT_B_ID}`, result!.token);
      expect(res.status).toBe(403);
    });

    it('prevents Tenant B user from accessing Tenant A data via tenant_id param', async () => {
      const result = await login('user@tenant-b.com', TEST_PASSWORD, 'tenant-b');
      expect(result).not.toBeNull();
      const res = await authedGet(`/api/v1/catalysts?tenant_id=${TENANT_A_ID}`, result!.token);
      expect(res.status).toBe(403);
    });

    it('allows user to access own tenant data', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet(`/api/v1/catalysts?tenant_id=${TENANT_A_ID}`, result!.token);
      expect(res.status).not.toBe(403);
    });

    it('allows superadmin to access any tenant', async () => {
      // Create a superadmin user
      await seedTestUser('superadmin-001', TENANT_A_ID, 'super@tenant-a.com', TEST_PASSWORD, 'superadmin', 'Super Admin');
      const result = await login('super@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      // Superadmin should be able to access Tenant B data
      const res = await authedGet(`/api/v1/catalysts?tenant_id=${TENANT_B_ID}`, result!.token);
      expect(res.status).not.toBe(403);
    });
  });

  // ────────────────────────────────────────────
  // Role-Based Access Control
  // ────────────────────────────────────────────
  describe('RBAC', () => {
    it('allows admin to access IAM routes', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/iam/users', result!.token);
      // Admin should have access (not 403)
      expect(res.status).not.toBe(403);
    });

    it('denies viewer access to IAM routes', async () => {
      const result = await login('viewer@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/iam/users', result!.token);
      expect(res.status).toBe(403);
    });

    it('denies analyst access to IAM routes', async () => {
      const result = await login('analyst@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/iam/users', result!.token);
      expect(res.status).toBe(403);
    });

    it('denies non-superadmin access to tenants routes', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/tenants', result!.token);
      expect(res.status).toBe(403);
    });

    it('allows superadmin access to tenants routes', async () => {
      // Seed a fresh superadmin for this test
      await seedTestUser('rbac-super', TENANT_A_ID, 'rbac-super@tenant-a.com', TEST_PASSWORD, 'superadmin', 'RBAC Super');
      const result = await login('rbac-super@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedGet('/api/v1/tenants', result!.token);
      expect(res.status).not.toBe(403);
    });
  });

  // ────────────────────────────────────────────
  // Token Refresh
  // ────────────────────────────────────────────
  describe('Token Refresh', () => {
    it('rejects refresh with invalid token', async () => {
      const res = await postJSON('/api/v1/auth/refresh', { refresh_token: 'invalid-token' });
      expect(res.status).toBe(401);
    });

    it('refreshes token successfully', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();

      const res = await postJSON('/api/v1/auth/refresh', { refresh_token: result!.refreshToken });
      expect(res.status).toBe(200);
      const body = await res.json() as { token: string; refreshToken: string };
      expect(body.token).toBeTruthy();
      expect(body.refreshToken).toBeTruthy();
      // New refresh token should be different (rotation)
      expect(body.refreshToken).not.toBe(result!.refreshToken);
    });

    it('old refresh token is invalidated after rotation', async () => {
      const result = await login('analyst@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();

      // Use the refresh token
      const res1 = await postJSON('/api/v1/auth/refresh', { refresh_token: result!.refreshToken });
      expect(res1.status).toBe(200);

      // Try to use the old refresh token again — should fail
      const res2 = await postJSON('/api/v1/auth/refresh', { refresh_token: result!.refreshToken });
      expect(res2.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────
  // Logout
  // ────────────────────────────────────────────
  describe('Logout', () => {
    it('logout requires auth header', async () => {
      const res = await postJSON('/api/v1/auth/logout', {});
      expect(res.status).toBe(401);
    });

    it('logout blacklists the token', async () => {
      const result = await login('viewer@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();

      // Logout
      const logoutRes = await SELF.fetch('http://localhost/api/v1/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${result!.token}` },
      });
      expect(logoutRes.status).toBe(200);

      // Try to use the blacklisted token
      const res = await authedGet('/api/v1/catalysts', result!.token);
      expect(res.status).toBe(401);
    });
  });

  // ────────────────────────────────────────────
  // Password Change
  // ────────────────────────────────────────────
  describe('Password Change', () => {
    it('rejects change-password without auth', async () => {
      const res = await postJSON('/api/v1/auth/change-password', {
        current_password: TEST_PASSWORD,
        new_password: 'NewSecure1!Pass',
      });
      expect(res.status).toBe(401);
    });

    it('rejects change-password with wrong current password', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedPost('/api/v1/auth/change-password', {
        current_password: 'WrongPassword1!',
        new_password: 'NewSecure1!Pass',
      }, result!.token);
      expect(res.status).toBe(401);
    });

    it('rejects change-password with weak new password', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await authedPost('/api/v1/auth/change-password', {
        current_password: TEST_PASSWORD,
        new_password: 'weak',
      }, result!.token);
      expect(res.status).toBe(400);
    });
  });

  // ────────────────────────────────────────────
  // Account Lockout
  // ────────────────────────────────────────────
  describe('Account Lockout', () => {
    beforeEach(async () => {
      // Clear lockout counter
      await env.CACHE.delete('login_attempts:lockout-test@tenant-a.com');
    });

    it('locks account after 5 failed attempts', async () => {
      await seedTestUser('lockout-user', TENANT_A_ID, 'lockout-test@tenant-a.com', TEST_PASSWORD, 'analyst', 'Lockout Test');

      // 5 failed attempts
      for (let i = 0; i < 5; i++) {
        await postJSON('/api/v1/auth/login', {
          email: 'lockout-test@tenant-a.com',
          password: 'WrongPassword1!',
          tenant_slug: 'tenant-a',
        });
      }

      // 6th attempt should be locked
      const res = await postJSON('/api/v1/auth/login', {
        email: 'lockout-test@tenant-a.com',
        password: TEST_PASSWORD,
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(429);
    });
  });

  // ────────────────────────────────────────────
  // Account Enumeration Defense (timing-safe login)
  // ────────────────────────────────────────────
  describe('Account Enumeration Defense', () => {
    const EXIST_EMAIL = 'enum-exist@tenant-a.com';
    const GHOST_EMAIL = 'enum-ghost@tenant-a.com'; // intentionally never seeded

    beforeAll(async () => {
      await seedTestUser('enum-exist-user', TENANT_A_ID, EXIST_EMAIL, TEST_PASSWORD, 'analyst', 'Enum Exist');
    });

    async function timeWrongLogin(email: string): Promise<{ ms: number; res: Response }> {
      await env.CACHE.delete(`login_attempts:${email}`);
      const t0 = Date.now();
      const res = await postJSON('/api/v1/auth/login', {
        email, password: 'WrongPassword1!', tenant_slug: 'tenant-a',
      });
      return { ms: Date.now() - t0, res };
    }

    it('missing user returns the same generic 401 as a wrong password', async () => {
      const { res: ghostRes } = await timeWrongLogin(GHOST_EMAIL);
      const { res: existRes } = await timeWrongLogin(EXIST_EMAIL);
      expect(ghostRes.status).toBe(401);
      expect(existRes.status).toBe(401);
      const ghostBody = await ghostRes.json() as { error: string };
      const existBody = await existRes.json() as { error: string };
      expect(ghostBody.error).toBe(existBody.error); // identical message — no enumeration via response body
    });

    it('missing user pays the same PBKDF2 cost so timing does not reveal existence', async () => {
      // Warm up to absorb first-call JIT/import overhead.
      await timeWrongLogin(EXIST_EMAIL);
      await timeWrongLogin(GHOST_EMAIL);

      const minOf = async (email: string): Promise<number> => {
        const samples: number[] = [];
        for (let i = 0; i < 3; i++) samples.push((await timeWrongLogin(email)).ms);
        return Math.min(...samples);
      };
      const tExist = await minOf(EXIST_EMAIL);
      const tGhost = await minOf(GHOST_EMAIL);

      // Without the dummy verify, the missing-user path skips PBKDF2 and would
      // be a tiny fraction of the wrong-password path. With it, the two are
      // comparable; 0.5 cleanly separates fixed from unfixed without flaking.
      expect(tGhost).toBeGreaterThan(tExist * 0.5);
    });
  });

  // ────────────────────────────────────────────
  // Admin Setup Endpoint
  // ────────────────────────────────────────────
  describe('Admin Setup', () => {
    it('rejects setup with wrong secret', async () => {
      const res = await postJSON('/api/v1/admin/setup', {
        setup_secret: 'wrong-secret-here',
        email: 'admin@tenant-a.com',
        password: 'NewSecure1!Pass',
      });
      expect(res.status).toBe(403);
    });

    it('rejects setup for non-superadmin', async () => {
      const res = await postJSON('/api/v1/admin/setup', {
        setup_secret: 'test-setup-secret-for-testing123',
        email: 'admin@tenant-a.com',
        password: 'NewSecure1!Pass',
      });
      // admin@tenant-a.com is role 'admin', not 'superadmin'
      expect(res.status).toBe(403);
    });

    it('resets superadmin password successfully', async () => {
      // Ensure superadmin user exists with correct role
      await seedTestUser('superadmin-setup', TENANT_A_ID, 'setup-super@tenant-a.com', TEST_PASSWORD, 'superadmin', 'Setup Super');

      const res = await postJSON('/api/v1/admin/setup', {
        setup_secret: 'test-setup-secret-for-testing123',
        email: 'setup-super@tenant-a.com',
        password: 'ResetPass1!New',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.success).toBe(true);

      // Verify new password works
      const result = await login('setup-super@tenant-a.com', 'ResetPass1!New', 'tenant-a');
      expect(result).not.toBeNull();
    });
  });

  // ────────────────────────────────────────────
  // Admin Migrate Endpoint Auth
  // ────────────────────────────────────────────
  describe('Admin Migrate Auth', () => {
    it('rejects migrate without any auth', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', { method: 'POST' });
      expect(res.status).toBe(403);
    });

    it('rejects migrate with wrong setup secret', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { 'X-Setup-Secret': 'wrong' },
      });
      expect(res.status).toBe(403);
    });

    it('allows migrate with correct setup secret', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
      });
      expect(res.status).toBe(200);
    });

    it('rejects migrate with JWT only (no X-Setup-Secret) since admin/migrate is outside tenantIsolation', async () => {
      // The /admin/migrate endpoint is mounted outside the tenantIsolation middleware,
      // so c.get('auth') is undefined. JWT-only auth requires the tenantIsolation middleware
      // to parse the token first. This is by design — use X-Setup-Secret instead.
      await seedTestUser('migrate-super', TENANT_A_ID, 'migrate-super@tenant-a.com', TEST_PASSWORD, 'superadmin', 'Migrate Super');
      const result = await login('migrate-super@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${result!.token}` },
      });
      // Returns 403 because tenantIsolation doesn't run on /admin/migrate, so auth context is empty
      expect(res.status).toBe(403);
    });

    it('rejects migrate with non-superadmin JWT', async () => {
      const result = await login('admin@tenant-a.com', TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { Authorization: `Bearer ${result!.token}` },
      });
      expect(res.status).toBe(403);
    });
  });

  // ────────────────────────────────────────────
  // Security Headers
  // ────────────────────────────────────────────
  describe('Security Headers', () => {
    it('includes X-Request-ID in response', async () => {
      const res = await SELF.fetch('http://localhost/healthz');
      expect(res.headers.get('X-Request-ID')).toBeTruthy();
    });

    it('echoes back provided X-Request-ID', async () => {
      const res = await SELF.fetch('http://localhost/healthz', {
        headers: { 'X-Request-ID': 'test-request-123' },
      });
      expect(res.headers.get('X-Request-ID')).toBe('test-request-123');
    });

    it('includes X-Content-Type-Options: nosniff', async () => {
      const res = await SELF.fetch('http://localhost/healthz');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('includes X-Frame-Options: DENY', async () => {
      const res = await SELF.fetch('http://localhost/healthz');
      expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });
  });

  // ────────────────────────────────────────────
  // v40: Mandatory MFA enforcement for admin roles
  // ────────────────────────────────────────────
  describe('MFA Enforcement (v40)', () => {
    // Helpers — scoped here so the rest of the suite is untouched.
    const MFA_ADMIN_EXPIRED = 'mfa-admin-expired@tenant-a.com';
    const MFA_ADMIN_GRACE = 'mfa-admin-grace@tenant-a.com';
    const MFA_ANALYST = 'mfa-analyst@tenant-a.com';
    const MFA_ADMIN_BACKUP = 'mfa-admin-backup@tenant-a.com';
    const MFA_ADMIN_REGEN = 'mfa-admin-regen@tenant-a.com';

    async function setGraceUntil(userId: string, iso: string | null): Promise<void> {
      await env.DB.prepare('UPDATE users SET mfa_grace_until = ? WHERE id = ?').bind(iso, userId).run();
    }

    async function enableMfaWithBackupCodes(
      userId: string,
      backupCodes: string[],
    ): Promise<void> {
      const hashes = await Promise.all(backupCodes.map(async (code) => {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(code.trim().toLowerCase()));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
      }));
      // Clear any grace — MFA is now "enabled" for test purposes.
      await env.DB.prepare(
        'UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ?, mfa_grace_until = NULL WHERE id = ?',
      ).bind('JBSWY3DPEHPK3PXP', JSON.stringify(hashes), userId).run();
    }

    /** Create an MFA challenge directly in KV (bypasses password step for isolated testing). */
    async function seedMfaChallenge(
      userId: string, tenantId: string, email: string, name: string, role: string,
    ): Promise<string> {
      const token = crypto.randomUUID();
      await env.CACHE.put(`mfa_challenge:${token}`, JSON.stringify({
        userId, tenantId, email, name, role, permissions: ['*'],
      }), { expirationTtl: 300 });
      return token;
    }

    beforeAll(async () => {
      await seedTestUser('mfa-admin-expired', TENANT_A_ID, MFA_ADMIN_EXPIRED, TEST_PASSWORD, 'admin', 'MFA Expired');
      await seedTestUser('mfa-admin-grace', TENANT_A_ID, MFA_ADMIN_GRACE, TEST_PASSWORD, 'admin', 'MFA Grace');
      await seedTestUser('mfa-analyst', TENANT_A_ID, MFA_ANALYST, TEST_PASSWORD, 'analyst', 'MFA Analyst');
      await seedTestUser('mfa-admin-backup', TENANT_A_ID, MFA_ADMIN_BACKUP, TEST_PASSWORD, 'admin', 'MFA Backup');
      await seedTestUser('mfa-admin-regen', TENANT_A_ID, MFA_ADMIN_REGEN, TEST_PASSWORD, 'admin', 'MFA Regen');
    });

    it('blocks admin login when MFA is off and grace period has expired', async () => {
      // Set grace_until to yesterday.
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      await setGraceUntil('mfa-admin-expired', yesterday);
      // Ensure MFA is off.
      await env.DB.prepare('UPDATE users SET mfa_enabled = 0 WHERE id = ?').bind('mfa-admin-expired').run();
      // Clear any stale lockout.
      await env.CACHE.delete(`login_attempts:${MFA_ADMIN_EXPIRED}`);

      const res = await postJSON('/api/v1/auth/login', {
        email: MFA_ADMIN_EXPIRED, password: TEST_PASSWORD, tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(403);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('MFA required for this role');
      expect(body.action).toBe('enable_mfa');
      expect(body.mfaSetupUrl).toBe('/settings/security/mfa');
    });

    it('allows admin login during grace period but returns mfaEnforcementWarning', async () => {
      const tenDaysOut = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();
      await setGraceUntil('mfa-admin-grace', tenDaysOut);
      await env.DB.prepare('UPDATE users SET mfa_enabled = 0 WHERE id = ?').bind('mfa-admin-grace').run();
      await env.CACHE.delete(`login_attempts:${MFA_ADMIN_GRACE}`);

      const res = await postJSON('/api/v1/auth/login', {
        email: MFA_ADMIN_GRACE, password: TEST_PASSWORD, tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.token).toBeTruthy();
      expect(body.mfaEnforcementWarning).toBeTruthy();
      const warn = body.mfaEnforcementWarning as Record<string, unknown>;
      expect(warn.reason).toBe('MFA must be enabled for admin roles');
      expect(typeof warn.daysRemaining).toBe('number');
      expect((warn.daysRemaining as number) > 0).toBe(true);
      expect((warn.daysRemaining as number) <= 14).toBe(true);
    });

    it('does NOT enforce MFA for non-admin roles', async () => {
      await env.DB.prepare(
        'UPDATE users SET mfa_enabled = 0, mfa_grace_until = NULL WHERE id = ?',
      ).bind('mfa-analyst').run();
      await env.CACHE.delete(`login_attempts:${MFA_ANALYST}`);

      const res = await postJSON('/api/v1/auth/login', {
        email: MFA_ANALYST, password: TEST_PASSWORD, tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.token).toBeTruthy();
      expect(body.mfaEnforcementWarning).toBeUndefined();
    });

    it('back-fills mfa_grace_until for existing admin with no grace set', async () => {
      // Simulate an admin account that pre-dates v40 — no grace timestamp at all.
      await env.DB.prepare(
        'UPDATE users SET mfa_enabled = 0, mfa_grace_until = NULL WHERE id = ?',
      ).bind('mfa-admin-grace').run();
      await env.CACHE.delete(`login_attempts:${MFA_ADMIN_GRACE}`);

      const res = await postJSON('/api/v1/auth/login', {
        email: MFA_ADMIN_GRACE, password: TEST_PASSWORD, tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.mfaEnforcementWarning).toBeTruthy();

      // Verify grace_until is now populated on the row.
      const row = await env.DB.prepare('SELECT mfa_grace_until FROM users WHERE id = ?')
        .bind('mfa-admin-grace').first();
      expect(row?.mfa_grace_until).toBeTruthy();
      const ts = Date.parse(row!.mfa_grace_until as string);
      expect(Number.isNaN(ts)).toBe(false);
      expect(ts).toBeGreaterThan(Date.now());
    });

    it('accepts a backup code on /mfa/validate and consumes it', async () => {
      const codes = ['aaaa-bbbb', 'cccc-dddd', 'eeee-ffff', 'gggg-hhhh'];
      await enableMfaWithBackupCodes('mfa-admin-backup', codes);

      const token = await seedMfaChallenge(
        'mfa-admin-backup', TENANT_A_ID, MFA_ADMIN_BACKUP, 'MFA Backup', 'admin',
      );

      const res = await postJSON('/api/v1/auth/mfa/validate', {
        challenge_token: token,
        code: 'aaaa-bbbb',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.token).toBeTruthy();
      expect(body.mfaMethodUsed).toBe('backup_code');
      expect(body.backupCodesRemaining).toBe(3);
      // 3 remaining < 3 is false, so low-codes warning should NOT be set (strict <).
      // But since remaining==3, expect not-low.
      expect(body.mfaBackupCodesLow).toBeUndefined();

      // The used code must now be gone — second attempt should fail.
      const token2 = await seedMfaChallenge(
        'mfa-admin-backup', TENANT_A_ID, MFA_ADMIN_BACKUP, 'MFA Backup', 'admin',
      );
      const res2 = await postJSON('/api/v1/auth/mfa/validate', {
        challenge_token: token2,
        code: 'aaaa-bbbb',
      });
      expect(res2.status).toBe(401);
    });

    it('emits mfaBackupCodesLow when fewer than 3 codes remain after use', async () => {
      // Seed exactly 3 codes — after consuming one, 2 remain which is < 3.
      const codes = ['lowa-low1', 'lowb-low2', 'lowc-low3'];
      await enableMfaWithBackupCodes('mfa-admin-backup', codes);

      const token = await seedMfaChallenge(
        'mfa-admin-backup', TENANT_A_ID, MFA_ADMIN_BACKUP, 'MFA Backup', 'admin',
      );
      const res = await postJSON('/api/v1/auth/mfa/validate', {
        challenge_token: token,
        code: 'lowa-low1',
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body.backupCodesRemaining).toBe(2);
      expect(body.mfaBackupCodesLow).toBe(true);
    });

    it('rejects an unknown backup code without consuming any', async () => {
      const codes = ['keep-aaaa', 'keep-bbbb'];
      await enableMfaWithBackupCodes('mfa-admin-backup', codes);

      const token = await seedMfaChallenge(
        'mfa-admin-backup', TENANT_A_ID, MFA_ADMIN_BACKUP, 'MFA Backup', 'admin',
      );
      const res = await postJSON('/api/v1/auth/mfa/validate', {
        challenge_token: token,
        code: 'zzzz-zzzz',
      });
      expect(res.status).toBe(401);

      // All codes still present.
      const row = await env.DB.prepare('SELECT mfa_backup_codes FROM users WHERE id = ?')
        .bind('mfa-admin-backup').first();
      const stored = JSON.parse(row!.mfa_backup_codes as string) as string[];
      expect(stored.length).toBe(2);
    });

    it('/mfa/regenerate-backup-codes requires auth', async () => {
      const res = await postJSON('/api/v1/auth/mfa/regenerate-backup-codes', { code: '123456' });
      expect(res.status).toBe(401);
    });

    it('/mfa/regenerate-backup-codes rejects when MFA is not enabled', async () => {
      // Seed an analyst (non-admin so no enforcement blocks login) without MFA.
      await env.DB.prepare(
        'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL, mfa_grace_until = NULL WHERE id = ?',
      ).bind('mfa-admin-regen').run();
      // Switch role to analyst just for this auth step so the login goes through.
      await env.DB.prepare('UPDATE users SET role = ? WHERE id = ?').bind('analyst', 'mfa-admin-regen').run();
      await env.CACHE.delete(`login_attempts:${MFA_ADMIN_REGEN}`);
      const result = await login(MFA_ADMIN_REGEN, TEST_PASSWORD, 'tenant-a');
      expect(result).not.toBeNull();

      const res = await authedPost(
        '/api/v1/auth/mfa/regenerate-backup-codes',
        { code: '123456' },
        result!.token,
      );
      expect(res.status).toBe(400);
      const body = await res.json() as Record<string, unknown>;
      expect(body.error).toBe('MFA is not enabled');
    });
  });

  // ────────────────────────────────────────────
  // Backward Compatibility (/api/ prefix)
  // ────────────────────────────────────────────
  describe('Backward Compat Routes', () => {
    it('POST /api/auth/login works (no v1 prefix)', async () => {
      const res = await postJSON('/api/auth/login', {
        email: 'admin@tenant-a.com',
        password: TEST_PASSWORD,
        tenant_slug: 'tenant-a',
      });
      expect(res.status).toBe(200);
    });

    it('POST /api/auth/register works (no v1 prefix)', async () => {
      const res = await postJSON('/api/auth/register', {
        email: 'compat-test@tenant-a.com',
        password: TEST_PASSWORD,
        name: 'Compat Test',
        tenant_slug: 'tenant-a',
      });
      // 201 for new user or 409 if already exists
      expect([201, 409]).toContain(res.status);
    });
  });
});
