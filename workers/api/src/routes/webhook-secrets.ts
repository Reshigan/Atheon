/**
 * Webhook Signing Secrets — Phase 10-37 admin surface.
 *
 * CRUD for the per-tenant per-source HMAC secrets that gate
 * /api/v1/ingest/* endpoints. Only superadmin/support_admin/admin
 * can touch this; the secret value is shown to the operator EXACTLY
 * once at creation and never returned by any read endpoint.
 *
 *   GET    /api/v1/webhook-secrets             list (no secret values)
 *   POST   /api/v1/webhook-secrets             provision new (returns secret once)
 *   POST   /api/v1/webhook-secrets/:id/rotate  rotate (revoke + provision)
 *   DELETE /api/v1/webhook-secrets/:id         revoke (no value returned)
 *
 * Pattern mirrors api_keys / billing routes — tenant_id always
 * derived from JWT auth, never trusted from request body.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { provisionWebhookSecret, revokeWebhookSecret } from '../services/webhook-hmac';

const webhookSecrets = new Hono<AppBindings>();

const MUTATION_ROLES = new Set(['superadmin', 'support_admin', 'admin']);

function getTenantId(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || '';
}

function getRole(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.role || '';
}

function getUserId(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.userId || 'system';
}

function gate(c: { get: (k: string) => unknown }): { ok: boolean; tenantId: string; userId: string; reason?: string } {
  const tenantId = getTenantId(c);
  if (!tenantId) return { ok: false, tenantId: '', userId: '', reason: 'tenant scope required' };
  if (!MUTATION_ROLES.has(getRole(c))) return { ok: false, tenantId, userId: '', reason: 'forbidden' };
  return { ok: true, tenantId, userId: getUserId(c) };
}

// ── LIST ─────────────────────────────────────────────────────────

webhookSecrets.get('/', async (c) => {
  const g = gate(c);
  if (!g.ok) return c.json({ error: g.reason }, g.reason === 'forbidden' ? 403 : 400);

  // Read-only operators can also see this — broaden the gate. Skip
  // for now; if needed, lower the bar in a follow-up.

  const rows = await c.env.DB.prepare(
    `SELECT id, source_id, label, secret_prefix, algorithm, status,
            created_at, last_used_at, last_rotated_at, revoked_at, revoked_reason
       FROM webhook_signing_secrets WHERE tenant_id = ?
      ORDER BY created_at DESC`,
  ).bind(g.tenantId).all<Record<string, unknown>>();

  return c.json({ secrets: rows.results || [] });
});

// ── PROVISION ────────────────────────────────────────────────────

webhookSecrets.post('/', async (c) => {
  const g = gate(c);
  if (!g.ok) return c.json({ error: g.reason }, g.reason === 'forbidden' ? 403 : 400);

  const body = await c.req.json<{ source_id?: string; label?: string }>();
  const sourceId = (body.source_id || '').trim();
  const label = (body.label || '').trim() || sourceId;
  if (!sourceId) return c.json({ error: 'source_id is required' }, 400);
  if (!/^[a-zA-Z0-9_.\-:]{1,64}$/.test(sourceId)) {
    return c.json({ error: 'source_id must be 1-64 chars [a-zA-Z0-9_.-:]' }, 400);
  }

  const { secret, secretRow } = await provisionWebhookSecret(
    c.env.DB, g.tenantId, sourceId, label, g.userId,
  );

  // Audit log
  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome)
       VALUES (?, ?, ?, 'webhook_secret.provisioned', 'admin', 'webhook_signing_secrets', ?, 'success')`,
    ).bind(
      crypto.randomUUID(), g.tenantId, g.userId,
      JSON.stringify({ source_id: sourceId, secret_id: secretRow.id, label }),
    ).run();
  } catch { /* non-fatal */ }

  // Returns the secret value EXACTLY ONCE
  return c.json({
    secret,
    secret_row: secretRow,
    note: 'Save this value now — it cannot be retrieved later. Sign requests with HMAC-SHA256 over `<unix_ts>.<body>` and send as X-Atheon-Signature: t=<ts>,v1=<hex>.',
  });
});

// ── ROTATE ───────────────────────────────────────────────────────

webhookSecrets.post('/:id/rotate', async (c) => {
  const g = gate(c);
  if (!g.ok) return c.json({ error: g.reason }, g.reason === 'forbidden' ? 403 : 400);
  const id = c.req.param('id');

  // Look up the existing secret to get source_id + label for the new one
  const existing = await c.env.DB.prepare(
    `SELECT source_id, label FROM webhook_signing_secrets
      WHERE id = ? AND tenant_id = ?`,
  ).bind(id, g.tenantId).first<{ source_id: string; label: string }>();
  if (!existing) return c.json({ error: 'not found' }, 404);

  // provisionWebhookSecret automatically marks the old active secret 'rotated'
  const { secret, secretRow } = await provisionWebhookSecret(
    c.env.DB, g.tenantId, existing.source_id, existing.label, g.userId,
  );

  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome)
       VALUES (?, ?, ?, 'webhook_secret.rotated', 'admin', 'webhook_signing_secrets', ?, 'success')`,
    ).bind(
      crypto.randomUUID(), g.tenantId, g.userId,
      JSON.stringify({ source_id: existing.source_id, old_secret_id: id, new_secret_id: secretRow.id }),
    ).run();
  } catch { /* non-fatal */ }

  return c.json({
    secret,
    secret_row: secretRow,
    note: 'Old secret is now status=rotated and will reject new signatures immediately. Save this new value now.',
  });
});

// ── REVOKE ───────────────────────────────────────────────────────

webhookSecrets.delete('/:id', async (c) => {
  const g = gate(c);
  if (!g.ok) return c.json({ error: g.reason }, g.reason === 'forbidden' ? 403 : 400);
  const id = c.req.param('id');

  const body = await c.req.json<{ reason?: string }>().catch(() => ({} as { reason?: string }));
  const reason = body.reason ?? `Revoked by ${g.userId}`;

  const ok = await revokeWebhookSecret(c.env.DB, g.tenantId, id, reason);
  if (!ok) return c.json({ error: 'not found or already revoked' }, 404);

  try {
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome)
       VALUES (?, ?, ?, 'webhook_secret.revoked', 'admin', 'webhook_signing_secrets', ?, 'success')`,
    ).bind(
      crypto.randomUUID(), g.tenantId, g.userId,
      JSON.stringify({ secret_id: id, reason }),
    ).run();
  } catch { /* non-fatal */ }

  return c.json({ revoked: true, reason });
});

export default webhookSecrets;
