/**
 * Audit-share public lookup
 * ═══
 *
 * GET /api/v1/audit-share/:token
 *
 * No authentication — the token itself is the credential. Tokens are
 * 256 bits of crypto-random hex (see compliance.ts), expire after 7 days,
 * and can be revoked from the admin UI.
 *
 * Every access is recorded on the row (access_count, last_accessed_at,
 * last_accessed_ip) and written to audit_log under the issuing tenant so
 * the admin sees who pulled the pack and when.
 */
import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { buildEvidencePack } from '../services/compliance-evidence';

const auditShare = new Hono<AppBindings>();

auditShare.get('/:token', async (c) => {
  const token = c.req.param('token');
  if (!token || token.length < 32) {
    return c.json({ error: 'Invalid token' }, 404);
  }

  const row = await c.env.DB.prepare(
    `SELECT id, tenant_id, label, expires_at, revoked_at, access_count
     FROM audit_share_tokens
     WHERE token = ?`
  ).bind(token).first<{
    id: string;
    tenant_id: string;
    label: string | null;
    expires_at: string;
    revoked_at: string | null;
    access_count: number;
  }>();

  if (!row) {
    return c.json({ error: 'Link not found' }, 404);
  }
  if (row.revoked_at) {
    return c.json({ error: 'Link revoked' }, 410);
  }
  if (new Date(row.expires_at).getTime() < Date.now()) {
    return c.json({ error: 'Link expired' }, 410);
  }

  const ip = c.req.header('cf-connecting-ip')
    || c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
    || null;

  // Best-effort access counter + audit log; don't block the response.
  try {
    await c.env.DB.prepare(
      `UPDATE audit_share_tokens
       SET access_count = access_count + 1,
           last_accessed_at = datetime('now'),
           last_accessed_ip = ?
       WHERE id = ?`
    ).bind(ip, row.id).run();
  } catch (err) {
    console.error('Audit share access counter failed:', err);
  }
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, ip_address, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      crypto.randomUUID(),
      row.tenant_id,
      'compliance.share.access',
      'platform',
      `audit_share_tokens/${row.id}`,
      ip,
      'success',
    ).run();
  } catch (auditErr) {
    console.error('Audit share access log failed (non-fatal):', auditErr);
  }

  try {
    const pack = await buildEvidencePack(c.env.DB, row.tenant_id, 'audit-share');
    return c.json({
      label: row.label,
      expires_at: row.expires_at,
      pack,
    });
  } catch (err) {
    console.error('Evidence pack build failed for share token:', err);
    return c.json({ error: 'Failed to build evidence pack' }, 500);
  }
});

export default auditShare;
