/**
 * Compliance / SOC 2 evidence pack
 * ═══
 * Read-only aggregation over existing tables. No new schema.
 *
 *   GET /api/v1/compliance/evidence-pack
 *     - Admin+ may read their own tenant.
 *     - Superadmin / support_admin may read any tenant via ?tenant_id=.
 *
 * Frontend renders the response on /compliance as one card per control.
 * Procurement teams typically ask for a JSON dump; the page also offers a
 * "Download" button that just stringifies the same response.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { buildEvidencePack } from '../services/compliance-evidence';

const compliance = new Hono<AppBindings>();

function getAuth(c: { get: (key: string) => unknown }): AuthContext | undefined {
  return c.get('auth') as AuthContext | undefined;
}
function isSupportOrAbove(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin';
}
function isPlatformAdmin(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin';
}

compliance.get('/evidence-pack', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  // Admin: own tenant only. Support+/superadmin: cross-tenant via ?tenant_id=.
  const queryTenantId = c.req.query('tenant_id');
  let tenantId = auth.tenantId;
  if (queryTenantId && queryTenantId !== auth.tenantId) {
    if (!isSupportOrAbove(auth.role)) {
      return c.json({ error: 'Forbidden: cannot view other tenants' }, 403);
    }
    tenantId = queryTenantId;
  }

  try {
    const pack = await buildEvidencePack(c.env.DB, tenantId, auth.userId);

    // Audit-log the access — SOC 2 itself wants evidence of who pulled
    // evidence packs and when.
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(),
        tenantId,
        auth.userId,
        'compliance.evidence_pack.read',
        'platform',
        'compliance',
        'success',
      ).run();
    } catch (auditErr) {
      console.error('Compliance evidence audit log failed (non-fatal):', auditErr);
    }

    return c.json(pack);
  } catch (err) {
    console.error('Evidence pack build failed:', err);
    return c.json({ error: 'Failed to build evidence pack', details: (err as Error).message }, 500);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Audit-share magic links — admin mints a 7-day read-only URL for an external
// auditor. The auditor opens the link in a browser (no login) and sees the
// evidence pack. Every access is logged with IP + timestamp.
//
//   POST   /api/v1/compliance/share        → mint a token (admin+)
//   GET    /api/v1/compliance/share        → list active tokens (admin+)
//   DELETE /api/v1/compliance/share/:id    → revoke (admin+)
//
// The public lookup endpoint lives at /api/v1/audit-share/:token — see
// src/routes/audit-share.ts. It is NOT mounted under tenantIsolation.
// ─────────────────────────────────────────────────────────────────────────────

const SHARE_TTL_DAYS = 7;

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
}

compliance.post('/share', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const body = await c.req.json().catch(() => ({} as Record<string, unknown>));
  const label = typeof body.label === 'string' ? body.label.slice(0, 120) : null;

  const id = crypto.randomUUID();
  const token = randomToken();
  const expiresAt = new Date(Date.now() + SHARE_TTL_DAYS * 86400_000).toISOString();

  await c.env.DB.prepare(
    `INSERT INTO audit_share_tokens (id, tenant_id, token, created_by_user_id, label, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).bind(id, auth.tenantId, token, auth.userId, label, expiresAt).run();

  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      auth.tenantId,
      auth.userId,
      'compliance.share.create',
      'platform',
      `audit_share_tokens/${id}`,
      'success',
    ).run();
  } catch (auditErr) {
    console.error('Audit share create log failed (non-fatal):', auditErr);
  }

  return c.json({
    id,
    token,
    label,
    expires_at: expiresAt,
    ttl_days: SHARE_TTL_DAYS,
  }, 201);
});

compliance.get('/share', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const rows = await c.env.DB.prepare(
    `SELECT id, label, expires_at, revoked_at, access_count, last_accessed_at, last_accessed_ip, created_at, created_by_user_id
     FROM audit_share_tokens
     WHERE tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 50`
  ).bind(auth.tenantId).all<{
    id: string;
    label: string | null;
    expires_at: string;
    revoked_at: string | null;
    access_count: number;
    last_accessed_at: string | null;
    last_accessed_ip: string | null;
    created_at: string;
    created_by_user_id: string;
  }>();

  const now = Date.now();
  const links = (rows.results || []).map((r) => ({
    ...r,
    status: r.revoked_at
      ? 'revoked'
      : (new Date(r.expires_at).getTime() < now ? 'expired' : 'active'),
  }));

  return c.json({ links });
});

compliance.delete('/share/:id', async (c) => {
  const auth = getAuth(c);
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);
  if (!isPlatformAdmin(auth.role)) {
    return c.json({ error: 'Forbidden: admin role required' }, 403);
  }

  const id = c.req.param('id');
  const res = await c.env.DB.prepare(
    `UPDATE audit_share_tokens SET revoked_at = datetime('now') WHERE id = ? AND tenant_id = ? AND revoked_at IS NULL`
  ).bind(id, auth.tenantId).run();

  if (!res.meta.changes) {
    return c.json({ error: 'Not found or already revoked' }, 404);
  }

  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      auth.tenantId,
      auth.userId,
      'compliance.share.revoke',
      'platform',
      `audit_share_tokens/${id}`,
      'success',
    ).run();
  } catch (auditErr) {
    console.error('Audit share revoke log failed (non-fatal):', auditErr);
  }

  return c.json({ ok: true });
});

export default compliance;
