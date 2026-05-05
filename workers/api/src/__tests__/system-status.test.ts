/**
 * Phase 10-36 — System Status admin endpoint.
 *
 * Validates the operator-visibility surface that would have made the
 * 2026-05-05 incident (silent migration timeout + missing brand
 * columns + missing MS Graph secrets + CORS misconfig) take 30
 * seconds to diagnose instead of 2 hours.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { generateToken } from '../middleware/auth';
import { runMigrations, MIGRATION_VERSION } from '../services/migrate';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'system-status-test';

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

async function authedGet(path: string, role = 'admin') {
  const token = await tokenFor(role);
  return SELF.fetch(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Phase 10-36 — system status endpoint', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

    // Tenant must exist for the migration-marker query to find anything
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'Status Test', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();

    // Ensure the marker exists (migration runs above did this, but be explicit)
    await runMigrations(env.DB);
  }, 60_000);

  it('returns the full status report shape', async () => {
    const res = await authedGet('/api/v1/admin/system-status');
    expect(res.status).toBe(200);
    const body = await res.json<{
      generated_at: string; elapsed_ms: number;
      migration: { code_version: string; marker_present: boolean; marker_version: string | null; marker_completed_at: string | null; drift: string | null };
      email: { queue: Record<string, number>; recent_failures: unknown[] };
      secrets: { ms_graph_configured: boolean; azure_ad_sso_configured: boolean };
      tenants: { total: number; by_status: Record<string, number> };
      errors: string[];
    }>();

    expect(typeof body.generated_at).toBe('string');
    expect(typeof body.elapsed_ms).toBe('number');

    // Migration block is fully populated
    expect(body.migration.code_version).toBe(MIGRATION_VERSION);
    expect(body.migration.marker_present).toBe(true);
    expect(body.migration.marker_version).toBe(MIGRATION_VERSION);
    expect(body.migration.drift).toBeNull();

    // Email block is shaped (test env has no queue, so empty maps)
    expect(typeof body.email.queue).toBe('object');
    expect(Array.isArray(body.email.recent_failures)).toBe(true);

    // Secrets reflect test env (test bindings are empty strings or missing)
    expect(typeof body.secrets.ms_graph_configured).toBe('boolean');
    expect(typeof body.secrets.azure_ad_sso_configured).toBe('boolean');

    // Tenants block reflects DB
    expect(body.tenants.total).toBeGreaterThanOrEqual(1); // at least our test tenant
    expect(body.tenants.by_status.active).toBeGreaterThanOrEqual(1);
  });

  it('flags drift when marker version != code version', async () => {
    // Fake drift: write a marker with an old version
    await env.DB.prepare(
      `INSERT OR REPLACE INTO _migration_meta (version, completed_at, duration_ms) VALUES ('v00-stale', datetime('now'), 0)`,
    ).run();
    await env.DB.prepare(
      `DELETE FROM _migration_meta WHERE version = ?`,
    ).bind(MIGRATION_VERSION).run();

    const res = await authedGet('/api/v1/admin/system-status');
    const body = await res.json<{ migration: { drift: string | null; marker_version: string } }>();
    expect(body.migration.marker_version).toBe('v00-stale');
    expect(body.migration.drift).toContain('v00-stale');
    expect(body.migration.drift).toContain(MIGRATION_VERSION);

    // Restore for any later tests
    await env.DB.prepare(
      `INSERT INTO _migration_meta (version, completed_at, duration_ms) VALUES (?, datetime('now'), 0)`,
    ).bind(MIGRATION_VERSION).run();
    await env.DB.prepare(`DELETE FROM _migration_meta WHERE version = 'v00-stale'`).run();
  });

  it('surfaces recent email failures with the actual error', async () => {
    // Insert a failed email row with a real-shaped error
    const id = `email-test-${crypto.randomUUID()}`;
    await env.DB.prepare(
      `INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, status, error, created_at, retry_count)
       VALUES (?, ?, ?, 'Reset password', '<p>x</p>', 'failed', ?, datetime('now'), 3)`,
    ).bind(
      id, TENANT, JSON.stringify(['reshigan@vantax.co.za']),
      'Max retries exceeded — last error: token endpoint 401: AADSTS70011: Invalid scope',
    ).run();

    const res = await authedGet('/api/v1/admin/system-status');
    const body = await res.json<{ email: { queue: Record<string, number>; recent_failures: Array<{ id: string; error_excerpt: string }> } }>();
    expect(body.email.queue.failed).toBeGreaterThanOrEqual(1);
    const ourFailure = body.email.recent_failures.find((f) => f.id === id);
    expect(ourFailure).toBeDefined();
    expect(ourFailure!.error_excerpt).toContain('AADSTS70011');
  });

  it('rejects analyst role with 403', async () => {
    const res = await authedGet('/api/v1/admin/system-status', 'analyst');
    expect(res.status).toBe(403);
  });
});
