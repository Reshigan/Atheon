/**
 * DSAR Routes — Phase 10-20.
 *
 * POST /api/v1/dsar/access
 *   Body: { subject_identifier: string }
 *   Returns the full export of the data subject's records.
 *   Authorization: tenant admin / superadmin OR the subject themselves.
 *
 * POST /api/v1/dsar/erasure
 *   Body: { subject_identifier: string, reason: string }
 *   Performs cascading delete + anonymisation. Audit-logged.
 *   Authorization: tenant admin / superadmin only.
 *
 * GET  /api/v1/dsar/requests
 *   List dsar_requests for the tenant for audit.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { exportSubjectData, eraseSubjectData } from '../services/dsar';

const dsar = new Hono<AppBindings>();

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'superadmin', 'support_admin']);

function getAuth(c: { get: (key: string) => unknown }): AuthContext | null {
  return (c.get('auth') as AuthContext | undefined) ?? null;
}

interface AccessBody { subject_identifier: string }

dsar.post('/access', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);

  let body: AccessBody;
  try { body = await c.req.json<AccessBody>(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body.subject_identifier || typeof body.subject_identifier !== 'string') {
    return c.json({ error: 'subject_identifier required' }, 400);
  }

  // Authorization: admin can request any; non-admin can only request own data
  const isAdmin = ADMIN_ROLES.has(auth.role || '');
  const subjectIsSelf =
    body.subject_identifier === auth.userId ||
    body.subject_identifier.toLowerCase() === auth.email.toLowerCase();
  if (!isAdmin && !subjectIsSelf) {
    return c.json({ error: 'forbidden — admins or self only' }, 403);
  }

  const { export: exp, requestId } = await exportSubjectData(c.env.DB, {
    tenantId: auth.tenantId,
    requestType: 'access',
    subjectIdentifier: body.subject_identifier,
    requestedBy: auth.userId || 'unknown',
  });
  return c.json({ request_id: requestId, export: exp });
});

interface ErasureBody { subject_identifier: string; reason: string }

dsar.post('/erasure', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  if (!ADMIN_ROLES.has(auth.role || '')) {
    return c.json({ error: 'forbidden — admin only' }, 403);
  }

  let body: ErasureBody;
  try { body = await c.req.json<ErasureBody>(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (!body.subject_identifier || typeof body.subject_identifier !== 'string') {
    return c.json({ error: 'subject_identifier required' }, 400);
  }
  if (!body.reason || typeof body.reason !== 'string' || body.reason.length < 10) {
    return c.json({ error: 'reason required (min 10 chars)' }, 400);
  }

  const { result, requestId } = await eraseSubjectData(c.env.DB, {
    tenantId: auth.tenantId,
    requestType: 'erasure',
    subjectIdentifier: body.subject_identifier,
    requestedBy: auth.userId || 'unknown',
    reason: body.reason,
  });
  return c.json({ request_id: requestId, result });
});

dsar.get('/requests', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  if (!ADMIN_ROLES.has(auth.role || '')) {
    return c.json({ error: 'forbidden — admin only' }, 403);
  }
  const r = await c.env.DB.prepare(
    `SELECT id, request_type, subject_identifier, requested_by, reason, status,
            rows_affected, summary, requested_at, completed_at
       FROM dsar_requests WHERE tenant_id = ?
      ORDER BY requested_at DESC LIMIT 100`
  ).bind(auth.tenantId).all();
  return c.json({ requests: r.results || [] });
});

export default dsar;
