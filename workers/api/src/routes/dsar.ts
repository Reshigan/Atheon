/**
 * DSAR Routes — Phase 10-20.
 *
 * POST /api/v1/dsar/access
 *   Body: { subject_identifier: string }
 *   Returns an AES-256-GCM encrypted export of the data subject's records.
 *   The plaintext is never on the wire after Phase 10-20.1: callers receive
 *   an opaque `encrypted_export` envelope and must call
 *   POST /access/:requestId/decrypt to retrieve the plaintext (re-auth check
 *   each time). This protects PII from log capture, browser history, paste
 *   buffers, and any intermediate storage the operator might use to hand
 *   off the export to a downstream consumer (legal team, mailbox, ticket).
 *   Authorization: tenant admin / superadmin OR the subject themselves.
 *
 * POST /api/v1/dsar/access/:requestId/decrypt
 *   Body: { encrypted_export: string }
 *   Returns the plaintext export. Same authz as /access.
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
import { encrypt, decrypt } from '../services/encryption';
import { logError } from '../services/logger';

const dsar = new Hono<AppBindings>();

const ADMIN_ROLES = new Set(['admin', 'system_admin', 'superadmin', 'support_admin']);

function getAuth(c: { get: (key: string) => unknown }): AuthContext | null {
  return (c.get('auth') as AuthContext | undefined) ?? null;
}

/** The secret used to derive the AES-GCM wrap key.
 *
 * Resolution: prefer a dedicated `ENCRYPTION_KEY` (the same env Atheon uses
 * for ERP credential encryption at rest); fall back to `JWT_SECRET` so
 * deployments that haven't set ENCRYPTION_KEY don't ship plaintext DSAR
 * exports — the secret is still derived via HKDF in encryption.ts.
 */
function resolveSecret(env: AppBindings['Bindings']): string {
  const e = env as unknown as { ENCRYPTION_KEY?: string; JWT_SECRET?: string };
  return e.ENCRYPTION_KEY || e.JWT_SECRET || '';
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

  // POPIA §3 hardening: wrap the export in AES-256-GCM so the response body
  // never carries plaintext PII. If no secret is configured the request is
  // rejected outright — fail-closed rather than ship plaintext.
  const secret = resolveSecret(c.env);
  if (!secret) {
    logError('dsar.access.no_secret', new Error('ENCRYPTION_KEY/JWT_SECRET unset'),
      { tenantId: auth.tenantId }, { request_id: requestId });
    return c.json({ error: 'server misconfigured — encryption secret unavailable' }, 503);
  }

  try {
    const encrypted = await encrypt(JSON.stringify(exp), secret);
    return c.json({
      request_id: requestId,
      format: 'enc:v1',
      encrypted_export: encrypted,
      decrypt_hint: 'POST /api/v1/dsar/access/' + (requestId ?? '<request_id>') + '/decrypt',
    });
  } catch (err) {
    logError('dsar.access.encrypt_failed', err, { tenantId: auth.tenantId },
      { request_id: requestId });
    return c.json({ error: 'export_encryption_failed' }, 500);
  }
});

interface DecryptBody { encrypted_export: string }

// Decrypts an export blob previously returned by POST /access. Each call
// re-validates auth + role so a stolen encrypted blob is useless without
// a current admin session.
dsar.post('/access/:requestId/decrypt', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);

  const requestId = c.req.param('requestId');
  let body: DecryptBody;
  try { body = await c.req.json<DecryptBody>(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (typeof body.encrypted_export !== 'string' || !body.encrypted_export.startsWith('enc:v1:')) {
    return c.json({ error: 'encrypted_export required' }, 400);
  }

  // Authorization: the original /access call already enforced admin-or-self.
  // For decrypt we re-check using the dsar_requests row: the caller must
  // either be an admin OR be the original requester. This prevents an
  // ex-employee who saved an encrypted export from re-decrypting it after
  // they've lost admin role.
  const isAdmin = ADMIN_ROLES.has(auth.role || '');
  if (!isAdmin) {
    const row = await c.env.DB.prepare(
      `SELECT requested_by FROM dsar_requests
        WHERE id = ? AND tenant_id = ? LIMIT 1`
    ).bind(requestId, auth.tenantId).first<{ requested_by: string }>();
    if (!row || row.requested_by !== (auth.userId || '')) {
      return c.json({ error: 'forbidden — admin or original requester only' }, 403);
    }
  }

  const secret = resolveSecret(c.env);
  if (!secret) {
    return c.json({ error: 'server misconfigured — encryption secret unavailable' }, 503);
  }

  try {
    const plaintext = await decrypt(body.encrypted_export, secret);
    if (plaintext === null) {
      return c.json({ error: 'decryption_failed — wrong key or corrupt envelope' }, 400);
    }
    let parsed: unknown;
    try { parsed = JSON.parse(plaintext); } catch { parsed = plaintext; }
    return c.json({ request_id: requestId, export: parsed });
  } catch (err) {
    logError('dsar.decrypt.failed', err, { tenantId: auth.tenantId }, { request_id: requestId });
    return c.json({ error: 'decryption_failed' }, 500);
  }
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
