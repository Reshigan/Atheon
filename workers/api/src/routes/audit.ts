import { Hono } from 'hono';
import type { Env } from '../types';

const audit = new Hono<{ Bindings: Env }>();

// GET /api/audit/log?tenant_id=&layer=&action=&limit=
audit.get('/log', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; user_id?: string; action: string; layer: string;
    resource?: string; details?: unknown; outcome?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.user_id || null, body.action, body.layer, body.resource || null, body.details ? JSON.stringify(body.details) : null, body.outcome || 'success').run();

  return c.json({ id }, 201);
});

// GET /api/audit/stats?tenant_id=
audit.get('/stats', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

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

// GET /api/audit/export?tenant_id=&format=
audit.get('/export', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const results = await c.env.DB.prepare(
    'SELECT * FROM audit_log WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 1000'
  ).bind(tenantId).all();

  // Return as JSON (could be CSV in production)
  return c.json({ entries: results.results, total: results.results.length, exportedAt: new Date().toISOString() });
});

export default audit;
