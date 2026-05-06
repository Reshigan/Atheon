/**
 * Phase 10-38 — webhookHmacMiddleware end-to-end.
 *
 * Mounts the middleware on a synthetic test route and exercises:
 *   - signed request with valid HMAC headers → 200
 *   - JWT bearer (no HMAC headers) → falls through to JWT path
 *   - missing X-Atheon-Tenant when X-Atheon-Signature present → 401
 *   - signature mismatch → 401 with reason
 *   - downstream handler sees auth.role='integration' on HMAC path
 *   - downstream handler sees webhookSourceId variable set
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { env, SELF, createExecutionContext, waitOnExecutionContext } from 'cloudflare:test';
import type { AppBindings, AuthContext } from '../types';
import {
  provisionWebhookSecret, buildSignatureHeader, webhookHmacMiddleware,
} from '../services/webhook-hmac';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'webhook-mw-test';

// Build a minimal Hono app that mirrors how /ingest/* will be mounted:
// HMAC middleware → ingest route handler. Echoes the resolved auth context
// back so we can assert role + tenant ID + source ID propagation.
function buildTestApp() {
  const app = new Hono<AppBindings>();
  app.use('/ingest/*', webhookHmacMiddleware());
  app.post('/ingest/test', async (c) => {
    const auth = c.get('auth') as AuthContext | undefined;
    return c.json({
      ok: true,
      auth_role: auth?.role ?? null,
      auth_tenant: auth?.tenantId ?? null,
      webhook_source_id: c.get('webhookSourceId') ?? null,
      raw_body: c.get('rawBody') ?? null,
    });
  });
  return app;
}

describe('Phase 10-38 — webhookHmacMiddleware', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'MW Test', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();
  }, 60_000);

  it('signed request passes; downstream sees role=integration + source_id', async () => {
    const { secret } = await provisionWebhookSecret(env.DB, env.ENCRYPTION_KEY as string, TENANT, 'src-mw-1', 'mw test', null);
    const body = JSON.stringify({ amount: 100 });
    const sigHeader = await buildSignatureHeader(secret, body);

    const app = buildTestApp();
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('http://localhost/ingest/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Atheon-Source': 'src-mw-1',
          'X-Atheon-Tenant': TENANT,
          'X-Atheon-Signature': sigHeader,
        },
        body,
      }),
      env, ctx,
    );
    await waitOnExecutionContext(ctx);

    expect(res.status).toBe(200);
    const out = await res.json<{ ok: boolean; auth_role: string; auth_tenant: string; webhook_source_id: string; raw_body: string }>();
    expect(out.ok).toBe(true);
    expect(out.auth_role).toBe('integration');
    expect(out.auth_tenant).toBe(TENANT);
    expect(out.webhook_source_id).toBe('src-mw-1');
    expect(out.raw_body).toBe(body);
  });

  it('no HMAC headers → middleware falls through (auth not set)', async () => {
    const app = buildTestApp();
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('http://localhost/ingest/test', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ x: 1 }),
      }),
      env, ctx,
    );
    await waitOnExecutionContext(ctx);

    // Falls through; the test app's handler runs with no auth context
    // (in production, tenantIsolation would be next; if THAT also fails
    // it returns 401, but here we have no JWT layer so the handler runs)
    expect(res.status).toBe(200);
    const out = await res.json<{ auth_role: string | null }>();
    expect(out.auth_role).toBeNull();
  });

  it('signature present but tenant header missing → 401', async () => {
    const { secret } = await provisionWebhookSecret(env.DB, env.ENCRYPTION_KEY as string, TENANT, 'src-mw-no-tenant', 'no tenant', null);
    const body = '{}';
    const sigHeader = await buildSignatureHeader(secret, body);

    const app = buildTestApp();
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('http://localhost/ingest/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Atheon-Source': 'src-mw-no-tenant',
          'X-Atheon-Signature': sigHeader,
        },
        body,
      }),
      env, ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    const out = await res.json<{ error: string }>();
    expect(out.error).toContain('X-Atheon-Tenant');
  });

  it('signature mismatch → 401 with specific reason', async () => {
    await provisionWebhookSecret(env.DB, env.ENCRYPTION_KEY as string, TENANT, 'src-mw-bad', 'bad sig', null);
    const body = '{"x":1}';
    const wrongSig = await buildSignatureHeader('whsec_fake', body);

    const app = buildTestApp();
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request('http://localhost/ingest/test', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'X-Atheon-Source': 'src-mw-bad',
          'X-Atheon-Tenant': TENANT,
          'X-Atheon-Signature': wrongSig,
        },
        body,
      }),
      env, ctx,
    );
    await waitOnExecutionContext(ctx);
    expect(res.status).toBe(401);
    const out = await res.json<{ error: string; reason: string }>();
    expect(out.error).toContain('rejected');
    expect(out.reason).toContain('signature mismatch');
  });
});
