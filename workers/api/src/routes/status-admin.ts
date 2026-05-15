/**
 * Admin surface for the public status page (Phase AZ).
 *
 * Platform admins use these endpoints to declare new incidents, append
 * updates as the situation evolves, and mark the incident resolved.
 * Each mutation is audit-logged so an internal-audit team can prove
 * the disclosure timeline post-incident.
 *
 * JWT-authed, superadmin/support_admin only — incidents are platform-wide,
 * not tenant-scoped, so the right gating sits at the Atheon-staff layer.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const statusAdmin = new Hono<AppBindings>();

interface IncidentBody {
  title?: string;
  severity?: string;
  status?: string;
  impact?: string;
  components?: string[];
  message?: string;
}

const VALID_SEVERITIES = new Set(['operational', 'degraded', 'partial_outage', 'major_outage']);
const VALID_STATUSES = new Set(['investigating', 'identified', 'monitoring', 'resolved']);

function requireSuperOrSupport(auth?: AuthContext): boolean {
  return auth?.role === 'superadmin' || auth?.role === 'support_admin';
}

async function writeAudit(
  db: D1Database,
  ctx: { actorId: string | null; action: string; resource: string; details: unknown },
) {
  try {
    await db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
       VALUES (?, NULL, ?, ?, 'platform', ?, ?, 'success', datetime('now'))`
    ).bind(crypto.randomUUID(), ctx.actorId, ctx.action, ctx.resource, JSON.stringify(ctx.details)).run();
  } catch { /* audit must never break the API */ }
}

// GET /api/admin/status/incidents — list everything (incl. resolved) for the admin console
statusAdmin.get('/incidents', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperOrSupport(auth)) return c.json({ error: 'Forbidden' }, 403);
  const rows = await c.env.DB.prepare(
    `SELECT id, title, severity, status, impact, components, updates,
            started_at, resolved_at, updated_at
       FROM system_incidents
      ORDER BY started_at DESC
      LIMIT 200`
  ).all();
  return c.json({ incidents: rows.results ?? [] });
});

// POST /api/admin/status/incidents — declare a new incident
statusAdmin.post('/incidents', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperOrSupport(auth)) return c.json({ error: 'Forbidden' }, 403);
  let body: IncidentBody;
  try { body = await c.req.json<IncidentBody>(); }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const title = (body.title || '').trim();
  const severity = body.severity || 'degraded';
  const status = body.status || 'investigating';
  if (!title) return c.json({ error: 'title is required' }, 400);
  if (!VALID_SEVERITIES.has(severity)) return c.json({ error: 'invalid severity' }, 400);
  if (!VALID_STATUSES.has(status)) return c.json({ error: 'invalid status' }, 400);

  const id = crypto.randomUUID();
  const components = JSON.stringify(Array.isArray(body.components) ? body.components.slice(0, 20) : []);
  const initialUpdate = body.message
    ? JSON.stringify([{ at: new Date().toISOString(), status, message: body.message.slice(0, 4000) }])
    : '[]';

  await c.env.DB.prepare(
    `INSERT INTO system_incidents (id, title, severity, status, impact, components, updates, started_at, created_by, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, datetime('now'))`
  ).bind(
    id, title.slice(0, 200), severity, status,
    (body.impact || null) && body.impact!.slice(0, 1000),
    components, initialUpdate,
    auth?.userId || null,
  ).run();

  await writeAudit(c.env.DB, {
    actorId: auth?.userId || null,
    action: 'platform.incident.opened',
    resource: `incident/${id}`,
    details: { title, severity, status },
  });

  return c.json({ id, title, severity, status }, 201);
});

// PATCH /api/admin/status/incidents/:id — append an update / change severity / resolve
statusAdmin.patch('/incidents/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperOrSupport(auth)) return c.json({ error: 'Forbidden' }, 403);
  const id = c.req.param('id');
  let body: IncidentBody;
  try { body = await c.req.json<IncidentBody>(); }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  const row = await c.env.DB.prepare(
    `SELECT id, severity, status, updates, resolved_at FROM system_incidents WHERE id = ?`
  ).bind(id).first<{ id: string; severity: string; status: string; updates: string; resolved_at: string | null }>();
  if (!row) return c.json({ error: 'Incident not found' }, 404);

  if (body.severity && !VALID_SEVERITIES.has(body.severity)) return c.json({ error: 'invalid severity' }, 400);
  if (body.status && !VALID_STATUSES.has(body.status)) return c.json({ error: 'invalid status' }, 400);

  // Append the message to the updates timeline (if provided).
  let updates: unknown[] = [];
  try { const v = JSON.parse(row.updates || '[]'); if (Array.isArray(v)) updates = v; } catch { /* tolerate */ }
  if (body.message) {
    updates.push({
      at: new Date().toISOString(),
      status: body.status || row.status,
      message: body.message.slice(0, 4000),
    });
  }

  const nextStatus = body.status || row.status;
  const nextSeverity = body.severity || row.severity;
  const resolveNow = nextStatus === 'resolved' && !row.resolved_at;

  await c.env.DB.prepare(
    `UPDATE system_incidents
        SET severity = ?, status = ?, updates = ?, updated_at = datetime('now'),
            resolved_at = COALESCE(resolved_at, ${resolveNow ? "datetime('now')" : 'NULL'})
      WHERE id = ?`
  ).bind(nextSeverity, nextStatus, JSON.stringify(updates), id).run();

  await writeAudit(c.env.DB, {
    actorId: auth?.userId || null,
    action: resolveNow ? 'platform.incident.resolved' : 'platform.incident.updated',
    resource: `incident/${id}`,
    details: { severity: nextSeverity, status: nextStatus, appendedMessage: !!body.message },
  });

  return c.json({ ok: true, resolved: resolveNow });
});

export default statusAdmin;
