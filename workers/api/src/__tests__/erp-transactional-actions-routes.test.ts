/**
 * Phase 10-49 — transactional-actions admin routes.
 *
 * Covers the operator surface for the action layer:
 *   GET  /api/erp/transactional-actions[?status=&sub_catalyst=&limit=]
 *   GET  /api/erp/transactional-actions/summary
 *   POST /api/erp/transactional-actions/:id/revive
 *   POST /api/erp/transactional-actions/:id/approve
 *   POST /api/erp/transactional-actions/:id/skip
 *
 * Verifies that the routes:
 *   - Honor tenant isolation (rows from other tenants invisible / not revivable)
 *   - Apply the status filter when supplied
 *   - Return summary counts grouped by status
 *   - Revive flips dead_letter → approved + clears retry state
 *   - Revive refuses non-dead-letter rows
 *   - Approve flips pending → approved
 *   - Skip flips pending/approved → skipped
 *   - Sort order surfaces dead_letter rows first (operator priority)
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createTestUser, loginUser, authedRequest, request, postJSON,
} from './helpers';
import { ensureMigrated } from './setup';

const TENANT = 'txn-routes-tenant';
const OTHER_TENANT = 'txn-routes-other-tenant';

let token: string;

async function ensureTenant(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`,
  ).bind(id, name, id).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse"]', '["finance"]', 10, 50)`,
  ).bind(id).run();
}

beforeAll(async () => {
  await ensureMigrated();
  await ensureTenant(TENANT, 'TXN Routes Test');
  await ensureTenant(OTHER_TENANT, 'TXN Routes Other');
  await createTestUser({
    email: 'txn-admin@test.local', password: 'TxnAdmin1!',
    name: 'Txn Admin', role: 'admin', tenantId: TENANT,
  });
  const t = await loginUser('txn-admin@test.local', 'TxnAdmin1!');
  if (!t) throw new Error('login failed for txn admin');
  token = t;
}, 60_000);

afterEach(async () => {
  await env.DB.prepare(`DELETE FROM transactional_actions WHERE tenant_id IN (?, ?)`)
    .bind(TENANT, OTHER_TENANT).run();
});

async function insertAction(opts: {
  id: string;
  tenantId?: string;
  status: 'pending' | 'approved' | 'posted' | 'failed' | 'dead_letter' | 'skipped';
  subCatalyst?: string;
  retryCount?: number;
  postedValue?: number;
  deadLetterAt?: string | null;
}): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO transactional_actions
       (id, tenant_id, sub_catalyst_name, action_type, target_entity, idempotency_key,
        status, retry_count, dead_letter_at, posted_value, currency)
     VALUES (?, ?, ?, 'ap_invoice_post', ?, ?, ?, ?, ?, ?, 'USD')`,
  ).bind(
    opts.id,
    opts.tenantId ?? TENANT,
    opts.subCatalyst ?? 'ap-3way-match',
    `ENT-${opts.id}`,
    `idem-${opts.id}`,
    opts.status,
    opts.retryCount ?? 0,
    opts.deadLetterAt ?? null,
    opts.postedValue ?? null,
  ).run();
}

describe('Phase 10-49 — transactional-actions admin routes', () => {
  it('GET /transactional-actions returns the tenant rows, dead_letter first', async () => {
    await insertAction({ id: 'a-pending', status: 'pending', postedValue: 100 });
    await insertAction({ id: 'a-posted', status: 'posted', postedValue: 200 });
    await insertAction({ id: 'a-dead', status: 'dead_letter', retryCount: 5,
      deadLetterAt: new Date().toISOString(), postedValue: 300 });

    const res = await authedRequest('/api/erp/transactional-actions', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { actions: Array<{ id: string; status: string }>; total: number };
    expect(body.total).toBe(3);
    // dead_letter sorts first
    expect(body.actions[0].id).toBe('a-dead');
    expect(body.actions[0].status).toBe('dead_letter');
  });

  it('GET /transactional-actions filters by status', async () => {
    await insertAction({ id: 'b-pending-1', status: 'pending' });
    await insertAction({ id: 'b-pending-2', status: 'pending' });
    await insertAction({ id: 'b-posted-1', status: 'posted' });
    await insertAction({ id: 'b-dead-1', status: 'dead_letter' });

    const res = await authedRequest('/api/erp/transactional-actions?status=dead_letter', token);
    expect(res.status).toBe(200);
    const body = await res.json() as { actions: Array<{ id: string; status: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.actions[0].id).toBe('b-dead-1');
  });

  it('GET /transactional-actions hides rows from other tenants', async () => {
    await insertAction({ id: 'mine-1', status: 'pending', tenantId: TENANT });
    await insertAction({ id: 'theirs-1', status: 'pending', tenantId: OTHER_TENANT });

    const res = await authedRequest('/api/erp/transactional-actions', token);
    const body = await res.json() as { actions: Array<{ id: string }>; total: number };
    expect(body.total).toBe(1);
    expect(body.actions[0].id).toBe('mine-1');
  });

  it('GET /transactional-actions/summary returns count + value per status', async () => {
    await insertAction({ id: 's-pending', status: 'pending', postedValue: 100 });
    await insertAction({ id: 's-posted-1', status: 'posted', postedValue: 250 });
    await insertAction({ id: 's-posted-2', status: 'posted', postedValue: 750 });
    await insertAction({ id: 's-dead', status: 'dead_letter', postedValue: 50 });

    const res = await authedRequest('/api/erp/transactional-actions/summary', token);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      summary: Record<string, { count: number; total_value: number }>;
    };
    expect(body.summary.pending.count).toBe(1);
    expect(body.summary.posted.count).toBe(2);
    expect(body.summary.posted.total_value).toBe(1000);
    expect(body.summary.dead_letter.count).toBe(1);
    expect(body.summary.dead_letter.total_value).toBe(50);
    // Statuses with no rows still come back as zero
    expect(body.summary.failed.count).toBe(0);
    expect(body.summary.approved.count).toBe(0);
  });

  it('POST /transactional-actions/:id/revive flips dead_letter → approved', async () => {
    await insertAction({ id: 'rev-1', status: 'dead_letter', retryCount: 5,
      deadLetterAt: new Date().toISOString() });

    const res = await postJSON(`/api/erp/transactional-actions/rev-1/revive`, {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { id: string; revived: boolean };
    expect(body.revived).toBe(true);

    const after = await env.DB.prepare(
      `SELECT status, retry_count, dead_letter_at, next_retry_at, error
         FROM transactional_actions WHERE id = ?`,
    ).bind('rev-1').first<{ status: string; retry_count: number; dead_letter_at: string | null; next_retry_at: string | null; error: string | null }>();
    expect(after?.status).toBe('approved');
    expect(after?.retry_count).toBe(0);
    expect(after?.dead_letter_at).toBeNull();
    expect(after?.next_retry_at).toBeNull();
  });

  it('POST /transactional-actions/:id/revive refuses non-dead-letter rows', async () => {
    await insertAction({ id: 'rev-no', status: 'failed', retryCount: 1 });
    const res = await postJSON(`/api/erp/transactional-actions/rev-no/revive`, {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(404);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('not_revivable');
  });

  it('POST /transactional-actions/:id/revive refuses cross-tenant', async () => {
    await insertAction({ id: 'rev-other', status: 'dead_letter', tenantId: OTHER_TENANT,
      deadLetterAt: new Date().toISOString() });
    const res = await postJSON(`/api/erp/transactional-actions/rev-other/revive`, {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(404);
  });

  it('POST /transactional-actions/:id/approve flips pending → approved', async () => {
    await insertAction({ id: 'app-1', status: 'pending' });
    const res = await postJSON(`/api/erp/transactional-actions/app-1/approve`, {}, {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const after = await env.DB.prepare(
      `SELECT status FROM transactional_actions WHERE id = ?`,
    ).bind('app-1').first<{ status: string }>();
    expect(after?.status).toBe('approved');
  });

  it('POST /transactional-actions/:id/skip flips pending → skipped with reason', async () => {
    await insertAction({ id: 'skp-1', status: 'pending' });
    const res = await postJSON(`/api/erp/transactional-actions/skp-1/skip`,
      { reason: 'Wrong vendor' }, { Authorization: `Bearer ${token}` });
    expect(res.status).toBe(200);
    const after = await env.DB.prepare(
      `SELECT status, error FROM transactional_actions WHERE id = ?`,
    ).bind('skp-1').first<{ status: string; error: string | null }>();
    expect(after?.status).toBe('skipped');
    expect(after?.error).toBe('Wrong vendor');
  });

  it('routes require authentication', async () => {
    await insertAction({ id: 'na-1', status: 'pending' });
    const res = await request('/api/erp/transactional-actions');
    expect(res.status).toBe(401);
  });
});

