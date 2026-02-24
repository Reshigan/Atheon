import { Hono } from 'hono';
import type { Env } from '../types';

const erp = new Hono<{ Bindings: Env }>();

// GET /api/erp/adapters
erp.get('/adapters', async (c) => {
  const results = await c.env.DB.prepare('SELECT * FROM erp_adapters ORDER BY name ASC').all();

  const formatted = results.results.map((a: Record<string, unknown>) => ({
    id: a.id,
    name: a.name,
    system: a.system,
    version: a.version,
    protocol: a.protocol,
    status: a.status,
    operations: JSON.parse(a.operations as string || '[]'),
    authMethods: JSON.parse(a.auth_methods as string || '[]'),
  }));

  return c.json({ adapters: formatted, total: formatted.length });
});

// GET /api/erp/adapters/:id
erp.get('/adapters/:id', async (c) => {
  const id = c.req.param('id');
  const adapter = await c.env.DB.prepare('SELECT * FROM erp_adapters WHERE id = ?').bind(id).first();

  if (!adapter) return c.json({ error: 'Adapter not found' }, 404);

  // Get connections using this adapter
  const connections = await c.env.DB.prepare(
    'SELECT ec.*, t.name as tenant_name FROM erp_connections ec JOIN tenants t ON ec.tenant_id = t.id WHERE ec.adapter_id = ?'
  ).bind(id).all();

  return c.json({
    id: adapter.id,
    name: adapter.name,
    system: adapter.system,
    version: adapter.version,
    protocol: adapter.protocol,
    status: adapter.status,
    operations: JSON.parse(adapter.operations as string || '[]'),
    authMethods: JSON.parse(adapter.auth_methods as string || '[]'),
    connections: connections.results.map((conn: Record<string, unknown>) => ({
      id: conn.id,
      tenantId: conn.tenant_id,
      tenantName: conn.tenant_name,
      name: conn.name,
      status: conn.status,
      lastSync: conn.last_sync,
      recordsSynced: conn.records_synced,
    })),
  });
});

// GET /api/erp/connections?tenant_id=
erp.get('/connections', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const results = await c.env.DB.prepare(
    'SELECT ec.*, ea.name as adapter_name, ea.system as adapter_system, ea.protocol as adapter_protocol FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.tenant_id = ? ORDER BY ec.name ASC'
  ).bind(tenantId).all();

  const formatted = results.results.map((conn: Record<string, unknown>) => ({
    id: conn.id,
    adapterId: conn.adapter_id,
    adapterName: conn.adapter_name,
    adapterSystem: conn.adapter_system,
    adapterProtocol: conn.adapter_protocol,
    name: conn.name,
    status: conn.status,
    config: JSON.parse(conn.config as string || '{}'),
    lastSync: conn.last_sync,
    syncFrequency: conn.sync_frequency,
    recordsSynced: conn.records_synced,
    connectedAt: conn.connected_at,
  }));

  return c.json({ connections: formatted, total: formatted.length });
});

// POST /api/erp/connections
erp.post('/connections', async (c) => {
  const body = await c.req.json<{
    tenant_id: string; adapter_id: string; name: string; config?: Record<string, unknown>; sync_frequency?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO erp_connections (id, tenant_id, adapter_id, name, config, sync_frequency, connected_at) VALUES (?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, body.tenant_id, body.adapter_id, body.name, JSON.stringify(body.config || {}), body.sync_frequency || 'realtime').run();

  return c.json({ id, status: 'connected' }, 201);
});

// PUT /api/erp/connections/:id
erp.put('/connections/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string; sync_frequency?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.sync_frequency) { updates.push('sync_frequency = ?'); values.push(body.sync_frequency); }
  if (body.status === 'connected') { updates.push('last_sync = datetime(\'now\')'); }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE erp_connections SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// DELETE /api/erp/connections/:id
erp.delete('/connections/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM erp_connections WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/erp/canonical - list canonical API endpoints
erp.get('/canonical', async (c) => {
  const domain = c.req.query('domain');

  let query = 'SELECT * FROM canonical_endpoints';
  const binds: unknown[] = [];

  if (domain) { query += ' WHERE domain = ?'; binds.push(domain); }
  query += ' ORDER BY domain, path';

  const results = binds.length > 0
    ? await c.env.DB.prepare(query).bind(...binds).all()
    : await c.env.DB.prepare(query).all();

  const formatted = results.results.map((ep: Record<string, unknown>) => ({
    id: ep.id,
    domain: ep.domain,
    path: ep.path,
    method: ep.method,
    description: ep.description,
    rateLimit: ep.rate_limit,
    version: ep.version,
  }));

  return c.json({ endpoints: formatted, total: formatted.length });
});

// POST /api/erp/sync/:connection_id (trigger sync)
erp.post('/sync/:connection_id', async (c) => {
  const connectionId = c.req.param('connection_id');

  const conn = await c.env.DB.prepare('SELECT * FROM erp_connections WHERE id = ?').bind(connectionId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  // Simulate sync
  const newRecords = Math.round(Math.random() * 500) + 10;
  await c.env.DB.prepare(
    'UPDATE erp_connections SET last_sync = datetime(\'now\'), records_synced = records_synced + ? WHERE id = ?'
  ).bind(newRecords, connectionId).run();

  return c.json({
    connectionId,
    recordsSynced: newRecords,
    syncedAt: new Date().toISOString(),
    status: 'completed',
  });
});

export default erp;
