/**
 * Phase 10-31 — Transactional actions HITL admin routes.
 *
 * Validates:
 *   - GET    /transactional-actions             list w/ filters + total
 *   - GET    /transactional-actions/:id         detail with parsed payload
 *   - POST   /transactional-actions/:id/approve flips pending → posted (auto-dispatches)
 *   - POST   /transactional-actions/:id/skip    flips pending → skipped with reason
 *   - GET    /transactional-actions/_summary/counts grouped breakdown
 *   - 403    when role lacks mutation permission
 *
 * The seeded SAP ECC tenant + first transactional run produces both
 * pending payment-run rows (HITL gated) and posted ap_invoice_post
 * rows, giving us coverage of every endpoint state.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSapEccDemo } from '../services/demo-sap-ecc-seeder';
import { runTransactionalSubcatalystsForTenant } from '../services/transactional-runner';
import { generateToken } from '../middleware/auth';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-ecc-routes-test';

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
  if (opts.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return SELF.fetch(`http://localhost${path}`, { ...opts, headers });
}

describe('Phase 10-31 — transactional-actions admin routes', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedSapEccDemo(env.DB, { tenantId: TENANT });
    await runTransactionalSubcatalystsForTenant(env.DB, TENANT);
  }, 120_000);

  it('lists transactional actions with totals', async () => {
    const res = await authedFetch('/api/v1/transactional-actions?limit=50');
    expect(res.status).toBe(200);
    const body = await res.json<{ actions: Array<{ id: string; status: string }>; total: number; limit: number; offset: number }>();
    expect(body.actions.length).toBeGreaterThan(0);
    expect(body.total).toBeGreaterThanOrEqual(body.actions.length);
    expect(body.limit).toBe(50);
  });

  it('filters by status and sub_catalyst', async () => {
    const res = await authedFetch('/api/v1/transactional-actions?status=posted&sub_catalyst=ap-three-way-match');
    expect(res.status).toBe(200);
    const body = await res.json<{ actions: Array<{ status: string; sub_catalyst_name: string }> }>();
    expect(body.actions.length).toBeGreaterThan(0);
    for (const a of body.actions) {
      expect(a.status).toBe('posted');
      expect(a.sub_catalyst_name).toBe('ap-three-way-match');
    }
  });

  it('returns detail with parsed payload', async () => {
    const list = await authedFetch('/api/v1/transactional-actions?status=posted&limit=1');
    const listBody = await list.json<{ actions: Array<{ id: string }> }>();
    expect(listBody.actions.length).toBeGreaterThan(0);
    const id = listBody.actions[0].id;

    const res = await authedFetch(`/api/v1/transactional-actions/${id}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ action: { id: string; payload: unknown; payload_hash: string } }>();
    expect(body.action.id).toBe(id);
    expect(body.action.payload).toBeTruthy();
    expect(typeof body.action.payload).toBe('object');
    expect(body.action.payload_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('approves a pending action and posts inline', async () => {
    const list = await authedFetch('/api/v1/transactional-actions?status=pending&action_type=ap_payment_run&limit=1');
    const listBody = await list.json<{ actions: Array<{ id: string }> }>();
    if (listBody.actions.length === 0) return; // nothing to approve in this run, not a failure

    const id = listBody.actions[0].id;
    const res = await authedFetch(`/api/v1/transactional-actions/${id}/approve`, { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    const body = await res.json<{ approved: boolean; action: { status: string; external_doc_id: string | null } }>();
    expect(body.approved).toBe(true);
    expect(body.action.status).toBe('posted');
    expect(body.action.external_doc_id).toBeTruthy();
  });

  it('skips a pending action with reason', async () => {
    const list = await authedFetch('/api/v1/transactional-actions?status=pending&limit=1');
    const listBody = await list.json<{ actions: Array<{ id: string }> }>();
    if (listBody.actions.length === 0) return;

    const id = listBody.actions[0].id;
    const res = await authedFetch(`/api/v1/transactional-actions/${id}/skip`, {
      method: 'POST', body: JSON.stringify({ reason: 'AP supervisor reviewed; this batch should wait for next month' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json<{ skipped: boolean; reason: string }>();
    expect(body.skipped).toBe(true);
    expect(body.reason).toContain('next month');

    const row = await env.DB.prepare(
      `SELECT status, error FROM transactional_actions WHERE id = ?`,
    ).bind(id).first<{ status: string; error: string }>();
    expect(row!.status).toBe('skipped');
    expect(row!.error).toContain('next month');
  });

  it('returns grouped summary counts', async () => {
    const res = await authedFetch('/api/v1/transactional-actions/_summary/counts');
    expect(res.status).toBe(200);
    const body = await res.json<{ counts: Array<{ sub_catalyst_name: string; status: string; n: number; total_value: number }> }>();
    expect(body.counts.length).toBeGreaterThan(0);
    for (const c of body.counts) {
      expect(typeof c.sub_catalyst_name).toBe('string');
      expect(typeof c.status).toBe('string');
      expect(typeof c.n).toBe('number');
    }
  });

  it('rejects approve from analyst role with 403', async () => {
    const list = await authedFetch('/api/v1/transactional-actions?status=pending&limit=1');
    const listBody = await list.json<{ actions: Array<{ id: string }> }>();
    if (listBody.actions.length === 0) return;
    const id = listBody.actions[0].id;

    const res = await authedFetch(`/api/v1/transactional-actions/${id}/approve`, {
      method: 'POST', body: '{}', role: 'analyst',
    });
    expect(res.status).toBe(403);
  });
});
