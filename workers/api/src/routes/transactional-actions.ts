/**
 * Transactional Actions HITL Routes — Phase 10-30 / 10-31.
 *
 * Admin/operator surface over the transactional_actions ledger:
 *
 *   GET    /api/v1/transactional-actions             list (filterable)
 *   GET    /api/v1/transactional-actions/:id         detail (full payload)
 *   POST   /api/v1/transactional-actions/:id/approve flip pending → approved
 *   POST   /api/v1/transactional-actions/:id/skip    flip pending → skipped (with reason)
 *   POST   /api/v1/transactional-actions/dispatch    manual dispatch sweep
 *
 * Auth model:
 *   - Tenant-scoped via existing `tenantIsolation` middleware
 *     (already mounted globally for the `/transactional-actions/*`
 *     prefix once added to protectedPrefixes in index.ts)
 *   - Mutations require admin or operator role; reads are open to
 *     any authenticated user in the tenant (consistent with how the
 *     existing catalyst_actions surfaces work)
 *
 * Pattern mirrors `routes/catalysts.ts` approve/reject handlers so
 * the frontend's existing approval UX works the same way.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  approveAction,
  skipAction,
  executePendingActions,
} from '../services/erp-writeback';
import { logInfo } from '../services/logger';

const transactionalActions = new Hono<AppBindings>();

const MUTATION_ROLES = new Set([
  'superadmin', 'support_admin', 'admin', 'executive', 'operator',
]);

function getTenantId(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || '';
}

function getUserRole(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.role || '';
}

function getUserId(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.userId || 'system';
}

interface TransactionalActionRow {
  id: string;
  tenant_id: string;
  erp_connection_id: string | null;
  sub_catalyst_name: string;
  action_type: string;
  target_entity: string;
  source_record_ref: string | null;
  idempotency_key: string;
  payload: string;
  payload_hash: string | null;
  status: string;
  external_doc_id: string | null;
  posted_at: string | null;
  error: string | null;
  retry_count: number;
  posted_value: number | null;
  currency: string;
  reasoning: string | null;
  created_at: string;
  updated_at: string;
}

// ── LIST ─────────────────────────────────────────────────────────

transactionalActions.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);

  const status = c.req.query('status');
  const subCatalyst = c.req.query('sub_catalyst');
  const actionType = c.req.query('action_type');
  const limit = Math.min(parseInt(c.req.query('limit') || '50', 10), 500);
  const offset = parseInt(c.req.query('offset') || '0', 10);

  const wheres = ['tenant_id = ?'];
  const params: unknown[] = [tenantId];
  if (status) { wheres.push('status = ?'); params.push(status); }
  if (subCatalyst) { wheres.push('sub_catalyst_name = ?'); params.push(subCatalyst); }
  if (actionType) { wheres.push('action_type = ?'); params.push(actionType); }
  const whereClause = wheres.join(' AND ');

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) AS n FROM transactional_actions WHERE ${whereClause}`,
  ).bind(...params).first<{ n: number }>();

  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id, erp_connection_id, sub_catalyst_name, action_type,
            target_entity, source_record_ref, idempotency_key, status,
            external_doc_id, posted_at, error, retry_count,
            posted_value, currency, reasoning, created_at, updated_at
       FROM transactional_actions WHERE ${whereClause}
      ORDER BY created_at DESC LIMIT ? OFFSET ?`,
  ).bind(...params, limit, offset).all<Omit<TransactionalActionRow, 'payload' | 'payload_hash'>>();

  return c.json({
    actions: rows.results || [],
    total: totalRow?.n ?? 0,
    limit, offset,
  });
});

// ── DETAIL ───────────────────────────────────────────────────────

transactionalActions.get('/:id', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  const id = c.req.param('id');

  const row = await c.env.DB.prepare(
    `SELECT * FROM transactional_actions WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).first<TransactionalActionRow>();

  if (!row) return c.json({ error: 'not found' }, 404);

  // Parse payload JSON for client convenience
  let payloadObj: unknown = null;
  try { payloadObj = row.payload ? JSON.parse(row.payload) : null; } catch { /* keep null */ }

  return c.json({ action: { ...row, payload: payloadObj } });
});

// ── BULK APPROVE / SKIP ──────────────────────────────────────────
// Registered BEFORE the `/:id/approve` and `/:id/skip` routes so
// Hono's first-match-wins router doesn't bind `_bulk` as the :id.
// Keep this block above the per-row routes whenever you reorganize.

transactionalActions.post('/_bulk/approve', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  if (!MUTATION_ROLES.has(getUserRole(c))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ ids: string[] }>().catch(() => ({ ids: [] as string[] }));
  const ids = (body.ids || []).slice(0, 200);
  if (ids.length === 0) return c.json({ error: 'ids required (max 200 per call)' }, 400);

  const result = { approved: 0, errors: [] as Array<{ id: string; reason: string }> };
  for (const id of ids) {
    try {
      const ok = await approveAction(c.env.DB, tenantId, id);
      if (ok) result.approved++;
      else result.errors.push({ id, reason: 'not found or already processed' });
    } catch (err) {
      result.errors.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  // One dispatch sweep at the end — picks up all approvals at once
  const dispatch = await executePendingActions(c.env.DB, tenantId, { limit: ids.length + 50 });

  logInfo('transactional_actions.bulk_approved',
    { tenantId, layer: 'erp_write', action: 'bulk_approve', userId: getUserId(c) },
    { requested: ids.length, approved: result.approved, dispatched_posted: dispatch.posted, dispatched_failed: dispatch.failed });

  return c.json({ ...result, dispatched: dispatch });
});

transactionalActions.post('/_bulk/skip', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  if (!MUTATION_ROLES.has(getUserRole(c))) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json<{ ids: string[]; reason?: string }>().catch(() => ({ ids: [] as string[], reason: undefined as string | undefined }));
  const ids = (body.ids || []).slice(0, 200);
  if (ids.length === 0) return c.json({ error: 'ids required (max 200 per call)' }, 400);
  const reason = ((body as { reason?: string }).reason ?? '').slice(0, 500) || `Bulk-skipped by ${getUserId(c)}`;

  const result = { skipped: 0, errors: [] as Array<{ id: string; reason: string }> };
  for (const id of ids) {
    try {
      const ok = await skipAction(c.env.DB, tenantId, id, reason);
      if (ok) result.skipped++;
      else result.errors.push({ id, reason: 'not found or already processed' });
    } catch (err) {
      result.errors.push({ id, reason: err instanceof Error ? err.message : String(err) });
    }
  }

  logInfo('transactional_actions.bulk_skipped',
    { tenantId, layer: 'erp_write', action: 'bulk_skip', userId: getUserId(c) },
    { requested: ids.length, skipped: result.skipped, reason });

  return c.json(result);
});

// ── APPROVE ──────────────────────────────────────────────────────

transactionalActions.post('/:id/approve', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  if (!MUTATION_ROLES.has(getUserRole(c))) return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const ok = await approveAction(c.env.DB, tenantId, id);
  if (!ok) return c.json({ error: 'not found or already processed' }, 404);

  logInfo('transactional_actions.approved',
    { tenantId, layer: 'erp_write', action: 'approve', userId: getUserId(c) },
    { actionId: id });

  // Auto-dispatch this single approved row inline so the operator
  // sees the result immediately (status flips to 'posted' or
  // 'failed' before we respond)
  const dispatch = await executePendingActions(c.env.DB, tenantId, { limit: 1 });

  const row = await c.env.DB.prepare(
    `SELECT id, status, external_doc_id, posted_at, error
       FROM transactional_actions WHERE id = ?`,
  ).bind(id).first<{ id: string; status: string; external_doc_id: string; posted_at: string; error: string }>();

  return c.json({ approved: true, dispatched: dispatch, action: row });
});

// ── SKIP ─────────────────────────────────────────────────────────

transactionalActions.post('/:id/skip', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  if (!MUTATION_ROLES.has(getUserRole(c))) return c.json({ error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = (body.reason ?? '').slice(0, 500) || `Skipped by ${getUserId(c)}`;

  const ok = await skipAction(c.env.DB, tenantId, id, reason);
  if (!ok) return c.json({ error: 'not found or already processed' }, 404);

  logInfo('transactional_actions.skipped',
    { tenantId, layer: 'erp_write', action: 'skip', userId: getUserId(c) },
    { actionId: id, reason });

  return c.json({ skipped: true, reason });
});

// ── DISPATCH (manual sweep) ──────────────────────────────────────

transactionalActions.post('/dispatch', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);
  if (!MUTATION_ROLES.has(getUserRole(c))) return c.json({ error: 'forbidden' }, 403);

  const limit = Math.min(parseInt(c.req.query('limit') || '200', 10), 500);
  const result = await executePendingActions(c.env.DB, tenantId, { limit });
  return c.json(result);
});

// ── COUNTS BY STATUS (dashboard widgets) ─────────────────────────

transactionalActions.get('/_summary/counts', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT sub_catalyst_name, status, COUNT(*) AS n,
            COALESCE(SUM(posted_value), 0) AS total_value
       FROM transactional_actions WHERE tenant_id = ?
      GROUP BY sub_catalyst_name, status`,
  ).bind(tenantId).all<{ sub_catalyst_name: string; status: string; n: number; total_value: number }>();

  return c.json({ counts: rows.results || [] });
});

export default transactionalActions;
