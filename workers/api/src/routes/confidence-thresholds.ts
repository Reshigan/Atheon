/**
 * Per-tenant confidence threshold administration (roadmap B3).
 *
 * Endpoints:
 *   GET    /api/confidence-thresholds          → list rows for caller's tenant
 *   GET    /api/confidence-thresholds/effective?cluster_id=&sub_catalyst_name=
 *                                              → resolve effective thresholds
 *                                                for a scope (cascades through
 *                                                most-specific → tenant default
 *                                                → hard-coded fallback)
 *   PUT    /api/confidence-thresholds          → upsert a row (cluster_id and
 *                                                sub_catalyst_name may both be
 *                                                NULL for tenant-wide default)
 *   DELETE /api/confidence-thresholds/:id      → remove an override
 *
 * Step-up MFA is required on writes — these knobs decide whether actions
 * skip human review, so changing them is a SoD-relevant act.
 *
 * Role: executive, admin, support_admin, superadmin can read. Only the
 * admin tier can write (executives view but can't change auto-approval
 * floors — that's a finance/risk decision).
 */

import { Hono } from 'hono';
import type { AppBindings, Env } from '../types';
import {
  DEFAULT_THRESHOLDS,
  deleteThreshold,
  listThresholds,
  resolveThresholds,
  upsertThreshold,
  validateThresholds,
} from '../services/confidence-thresholds';
import { stepUpMFA } from '../middleware/step-up-mfa';

interface AuthCtx { tenantId: string; userId: string; role: string }

function getAuth(c: { get: (key: string) => unknown }): AuthCtx | null {
  const auth = c.get('auth') as { tenantId?: string; userId?: string; role?: string } | undefined;
  if (!auth || !auth.tenantId || !auth.userId) return null;
  return { tenantId: auth.tenantId, userId: auth.userId, role: auth.role || 'user' };
}

function canRead(role: string): boolean {
  return ['superadmin', 'support_admin', 'admin', 'executive'].includes(role);
}
function canWrite(role: string): boolean {
  return ['superadmin', 'support_admin', 'admin'].includes(role);
}

const confidenceThresholds = new Hono<AppBindings>();

confidenceThresholds.get('/', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthenticated' }, 401);
  if (!canRead(auth.role)) return c.json({ error: 'Forbidden' }, 403);

  const rows = await listThresholds(c.env, auth.tenantId);
  return c.json({
    rows,
    defaults: DEFAULT_THRESHOLDS,
    total: rows.length,
  });
});

confidenceThresholds.get('/effective', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthenticated' }, 401);
  if (!canRead(auth.role)) return c.json({ error: 'Forbidden' }, 403);

  const clusterId = c.req.query('cluster_id') || null;
  const subName = c.req.query('sub_catalyst_name') || null;
  const effective = await resolveThresholds(c.env, auth.tenantId, clusterId, subName);
  return c.json({
    scope: { clusterId, subCatalystName: subName },
    thresholds: effective,
    defaults: DEFAULT_THRESHOLDS,
  });
});

confidenceThresholds.put('/', stepUpMFA(), async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthenticated' }, 401);
  if (!canWrite(auth.role)) return c.json({ error: 'Forbidden', message: 'Only admins can change confidence thresholds.' }, 403);

  const body = await c.req.json<{
    cluster_id?: string | null;
    sub_catalyst_name?: string | null;
    auto_approve_min: number;
    require_human_below: number;
    hard_reject_below: number;
    min_sample_size: number;
    min_mode_share: number;
  }>();

  const proposed = {
    autoApproveMin: Number(body.auto_approve_min),
    requireHumanBelow: Number(body.require_human_below),
    hardRejectBelow: Number(body.hard_reject_below),
    minSampleSize: Number(body.min_sample_size),
    minModeShare: Number(body.min_mode_share),
  };
  const err = validateThresholds(proposed);
  if (err) return c.json({ error: 'Invalid thresholds', message: err }, 400);

  const record = await upsertThreshold(c.env, auth.tenantId, {
    clusterId: body.cluster_id ?? null,
    subCatalystName: body.sub_catalyst_name ?? null,
    ...proposed,
    updatedBy: auth.userId,
  });

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    auth.tenantId,
    'confidence_thresholds.upsert',
    'governance',
    record.id,
    JSON.stringify(record),
    'success',
  ).run().catch(() => {});

  return c.json(record);
});

confidenceThresholds.delete('/:id', stepUpMFA(), async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthenticated' }, 401);
  if (!canWrite(auth.role)) return c.json({ error: 'Forbidden' }, 403);

  const id = c.req.param('id');
  const removed = await deleteThreshold(c.env, auth.tenantId, id);
  if (!removed) return c.json({ error: 'Not found' }, 404);

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    crypto.randomUUID(),
    auth.tenantId,
    'confidence_thresholds.delete',
    'governance',
    id,
    '{}',
    'success',
  ).run().catch(() => {});

  return c.json({ deleted: true });
});

export default confidenceThresholds;
