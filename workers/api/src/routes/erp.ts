import { Hono } from 'hono';
import type { Env } from '../types';
import { getERPAdapter, listERPAdapters } from '../services/erp-connector';
import type { ERPCredentials } from '../services/erp-connector';

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

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ?'
  ).bind(connectionId).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const config = JSON.parse(conn.config as string || '{}');
  const adapter = getERPAdapter(conn.adapter_system as string);

  if (adapter && config.access_token) {
    // Real sync via ERP adapter
    const credentials: ERPCredentials = {
      clientId: config.client_id || '',
      clientSecret: config.client_secret || '',
      baseUrl: config.base_url || '',
    };
    const entities = config.sync_entities || ['accounts', 'contacts'];
    const result = await adapter.syncData(credentials, config.access_token, entities);

    await c.env.DB.prepare(
      'UPDATE erp_connections SET last_sync = datetime(\'now\'), records_synced = records_synced + ?, status = ? WHERE id = ?'
    ).bind(result.recordsSynced, result.errors.length > 0 ? 'partial' : 'connected', connectionId).run();

    return c.json({
      connectionId,
      recordsSynced: result.recordsSynced,
      recordsFailed: result.recordsFailed,
      entities: result.entities,
      errors: result.errors,
      duration: result.duration,
      syncedAt: new Date().toISOString(),
      status: result.errors.length > 0 ? 'partial' : 'completed',
    });
  }

  // Fallback: simulated sync when no real credentials
  const newRecords = Math.round(Math.random() * 500) + 10;
  await c.env.DB.prepare(
    'UPDATE erp_connections SET last_sync = datetime(\'now\'), records_synced = records_synced + ? WHERE id = ?'
  ).bind(newRecords, connectionId).run();

  return c.json({
    connectionId,
    recordsSynced: newRecords,
    syncedAt: new Date().toISOString(),
    status: 'completed',
    mode: 'simulated',
  });
});

// POST /api/erp/connections/:id/test - Test ERP connection
erp.post('/connections/:id/test', async (c) => {
  const id = c.req.param('id');

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ?'
  ).bind(id).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const config = JSON.parse(conn.config as string || '{}');
  const adapter = getERPAdapter(conn.adapter_system as string);

  if (!adapter) {
    return c.json({ connected: false, message: `No adapter found for system: ${conn.adapter_system}` });
  }

  if (!config.access_token) {
    return c.json({ connected: false, message: 'No access token configured. Complete OAuth flow first.' });
  }

  const credentials: ERPCredentials = {
    clientId: config.client_id || '',
    clientSecret: config.client_secret || '',
    baseUrl: config.base_url || '',
  };

  const result = await adapter.testConnection(credentials, config.access_token);

  // Update connection status
  await c.env.DB.prepare(
    'UPDATE erp_connections SET status = ? WHERE id = ?'
  ).bind(result.connected ? 'connected' : 'error', id).run();

  return c.json(result);
});

// POST /api/erp/oauth/authorize - Start OAuth flow for an ERP
erp.post('/oauth/authorize', async (c) => {
  const body = await c.req.json<{
    connection_id: string; client_id: string; client_secret: string; base_url: string;
    auth_url?: string; token_url?: string; scope?: string;
  }>();

  const conn = await c.env.DB.prepare(
    'SELECT ec.*, ea.system as adapter_system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ?'
  ).bind(body.connection_id).first();
  if (!conn) return c.json({ error: 'Connection not found' }, 404);

  const adapter = getERPAdapter(conn.adapter_system as string);
  if (!adapter) return c.json({ error: `No adapter for system: ${conn.adapter_system}` }, 400);

  const state = crypto.randomUUID();
  const credentials: ERPCredentials = {
    clientId: body.client_id,
    clientSecret: body.client_secret,
    baseUrl: body.base_url,
    authUrl: body.auth_url,
    tokenUrl: body.token_url,
    scope: body.scope,
  };

  const authUrl = adapter.getAuthUrl(credentials, state);

  // Store OAuth state for callback verification
  await c.env.CACHE.put(`oauth_state:${state}`, JSON.stringify({
    connectionId: body.connection_id,
    credentials,
    system: conn.adapter_system,
  }), { expirationTtl: 600 });

  // Store credentials in connection config
  await c.env.DB.prepare(
    'UPDATE erp_connections SET config = ?, status = ? WHERE id = ?'
  ).bind(JSON.stringify({
    ...JSON.parse(conn.config as string || '{}'),
    client_id: body.client_id,
    client_secret: body.client_secret,
    base_url: body.base_url,
    auth_url: body.auth_url,
    token_url: body.token_url,
  }), 'authorizing', body.connection_id).run();

  return c.json({ authUrl, state });
});

// POST /api/erp/oauth/callback - Complete OAuth token exchange
erp.post('/oauth/callback', async (c) => {
  const body = await c.req.json<{ code: string; state: string }>();

  const stateData = await c.env.CACHE.get(`oauth_state:${body.state}`);
  if (!stateData) return c.json({ error: 'Invalid or expired OAuth state' }, 400);

  const { connectionId, credentials, system } = JSON.parse(stateData) as {
    connectionId: string; credentials: ERPCredentials; system: string;
  };

  const adapter = getERPAdapter(system);
  if (!adapter) return c.json({ error: `No adapter for system: ${system}` }, 400);

  try {
    const tokenResponse = await adapter.exchangeToken(credentials, body.code);

    // Update connection with tokens
    const conn = await c.env.DB.prepare('SELECT config FROM erp_connections WHERE id = ?').bind(connectionId).first();
    const existingConfig = JSON.parse(conn?.config as string || '{}');

    await c.env.DB.prepare(
      'UPDATE erp_connections SET config = ?, status = ?, connected_at = datetime(\'now\') WHERE id = ?'
    ).bind(JSON.stringify({
      ...existingConfig,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      token_type: tokenResponse.token_type,
      token_expires_at: new Date(Date.now() + tokenResponse.expires_in * 1000).toISOString(),
    }), 'connected', connectionId).run();

    // Clean up state
    await c.env.CACHE.delete(`oauth_state:${body.state}`);

    return c.json({ success: true, connectionId, status: 'connected' });
  } catch (err) {
    return c.json({ error: `Token exchange failed: ${(err as Error).message}` }, 500);
  }
});

// GET /api/erp/systems - List available ERP systems (from connector registry)
erp.get('/systems', (c) => {
  const systems = listERPAdapters();
  return c.json({ systems });
});

export default erp;
