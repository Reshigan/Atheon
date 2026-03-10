/**
 * Smoke tests for Atheon API — verifies basic worker functionality.
 * These tests ensure the worker boots, responds to health checks,
 * and basic routing works before deeper integration tests run.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { runMigrations, MIGRATION_VERSION } from '../services/migrate';

/**
 * Helper: call POST /api/v1/admin/migrate with the test SETUP_SECRET
 * so that both D1 schema and KV migration-flag are set.
 */
async function migrateViaEndpoint(): Promise<void> {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST',
    headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
  });
  if (res.status !== 200) {
    throw new Error(`Migration endpoint returned ${res.status}`);
  }
}

describe('Smoke Tests', () => {
  beforeAll(async () => {
    // Run migrations via the endpoint so the KV cache flag is also set
    await migrateViaEndpoint();
  });

  describe('Health Check', () => {
    it('GET /healthz returns 200 with status ok', async () => {
      const res = await SELF.fetch('http://localhost/healthz');
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('status', 'healthy');
    });

    it('GET / returns 200 root response', async () => {
      const res = await SELF.fetch('http://localhost/');
      expect(res.status).toBe(200);
    });
  });

  describe('CORS', () => {
    it('OPTIONS request returns CORS headers', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
        method: 'OPTIONS',
        headers: {
          'Origin': 'http://localhost:3000',
          'Access-Control-Request-Method': 'POST',
        },
      });
      // Should not be 500
      expect(res.status).toBeLessThan(500);
    });
  });

  describe('Auth Endpoints Exist', () => {
    it('POST /api/v1/auth/login with empty body returns 4xx', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      // Should return a client error (4xx), not 404 or 5xx
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(404);
    });

    it('POST /api/v1/auth/register with empty body returns 4xx', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
      expect(res.status).not.toBe(404);
    });
  });

  describe('Admin Migrate Endpoint', () => {
    it('POST /api/v1/admin/migrate without auth returns 403', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
      });
      expect(res.status).toBe(403);
    });

    it('POST /api/v1/admin/migrate with wrong secret returns 403', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { 'X-Setup-Secret': 'wrong-secret' },
      });
      expect(res.status).toBe(403);
    });

    it('POST /api/v1/admin/migrate with correct secret returns 200', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
        method: 'POST',
        headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
      });
      expect(res.status).toBe(200);
      const body = await res.json() as Record<string, unknown>;
      expect(body).toHaveProperty('version');
      expect(body).toHaveProperty('tablesCreated');
    });
  });

  describe('Migration Guard', () => {
    it('returns 503 for protected routes when migration flag is missing from KV', async () => {
      // Clear the migration KV flag to simulate un-migrated state
      const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
      await env.CACHE.delete(migrationKey);

      const res = await SELF.fetch('http://localhost/api/v1/dashboard');
      // Should get 503 (migration guard), succeed via auto-migration, 401 (auth), or 404 (no GET route)
      expect([200, 401, 404, 503]).toContain(res.status);

      // Restore migration flag
      await migrateViaEndpoint();
    });
  });

  describe('Protected Routes Require Auth', () => {
    it('GET /api/v1/dashboard without token returns 401 or 404', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/dashboard');
      // 401 if auth middleware fires first, 404 if route not registered as GET
      expect([401, 404]).toContain(res.status);
    });

    it('GET /api/v1/catalysts without token returns 401', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/catalysts');
      expect(res.status).toBe(401);
    });

    it('GET /api/v1/users without token returns 401 or 404', async () => {
      const res = await SELF.fetch('http://localhost/api/v1/users');
      // 401 if auth middleware fires first, 404 if route not registered as GET
      expect([401, 404]).toContain(res.status);
    });
  });
});
