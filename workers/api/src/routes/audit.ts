import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const audit = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/audit/log
audit.get('/log', async (c) => {
  const tenantId = getTenantId(c);
  const layer = c.req.query('layer');
  const action = c.req.query('action');
  const limit = parseInt(c.req.query('limit') || '100');
  const offset = parseInt(c.req.query('offset') || '0');

  let query = 'SELECT * FROM audit_log WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (layer) { query += ' AND layer = ?'; binds.push(layer); }
  if (action) { query += ' AND action LIKE ?'; binds.push(`%${action}%`); }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((entry: Record<string, unknown>) => ({
    id: entry.id,
    tenantId: entry.tenant_id,
    userId: entry.user_id,
    action: entry.action,
    layer: entry.layer,
    resource: entry.resource,
    details: entry.details ? JSON.parse(entry.details as string) : null,
    outcome: entry.outcome,
    ipAddress: entry.ip_address,
    createdAt: entry.created_at,
  }));

  return c.json({ entries: formatted, total: formatted.length, offset, limit });
});

// POST /api/audit/log
audit.post('/log', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    user_id?: string; action: string; layer: string;
    resource?: string; details?: unknown; outcome?: string;
  }>(c, [
    { field: 'action', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'layer', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'resource', type: 'string', required: false, maxLength: 200 },
    { field: 'outcome', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.user_id || null, body.action, body.layer, body.resource || null, body.details ? JSON.stringify(body.details) : null, body.outcome || 'success').run();

  return c.json({ id }, 201);
});

// GET /api/audit/stats
audit.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const totalEntries = await c.env.DB.prepare('SELECT COUNT(*) as count FROM audit_log WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();

  const layerBreakdown = await c.env.DB.prepare(
    'SELECT layer, COUNT(*) as count FROM audit_log WHERE tenant_id = ? GROUP BY layer ORDER BY count DESC'
  ).bind(tenantId).all();

  const outcomeBreakdown = await c.env.DB.prepare(
    'SELECT outcome, COUNT(*) as count FROM audit_log WHERE tenant_id = ? GROUP BY outcome'
  ).bind(tenantId).all();

  const recentActivity = await c.env.DB.prepare(
    'SELECT action, layer, outcome, created_at FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10'
  ).bind(tenantId).all();

  return c.json({
    totalEntries: totalEntries?.count || 0,
    layerBreakdown: layerBreakdown.results,
    outcomeBreakdown: outcomeBreakdown.results,
    recentActivity: recentActivity.results,
  });
});

// GET /api/audit/export
audit.get('/export', async (c) => {
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1000'
  ).bind(tenantId).all();

  // Return as JSON (could be CSV in production)
  return c.json({ entries: results.results, total: results.results.length, exportedAt: new Date().toISOString() });
});

export default audit;
