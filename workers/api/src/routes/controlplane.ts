import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const controlplane = new Hono<AppBindings>();

function getTenantId(c: { get: (key: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || 'vantax';
}

// GET /api/controlplane/deployments
controlplane.get('/deployments', async (c) => {
  const tenantId = getTenantId(c);

  const query = `SELECT ad.*, cc.name as cluster_name, cc.domain as cluster_domain, t.name as tenant_name 
    FROM agent_deployments ad 
    LEFT JOIN catalyst_clusters cc ON ad.cluster_id = cc.id 
    JOIN tenants t ON ad.tenant_id = t.id
    WHERE ad.tenant_id = ?
    ORDER BY ad.created_at DESC`;

  const results = await c.env.DB.prepare(query).bind(tenantId).all();

  const formatted = results.results.map((d: Record<string, unknown>) => ({
    id: d.id,
    tenantId: d.tenant_id,
    tenantName: d.tenant_name,
    clusterId: d.cluster_id,
    clusterName: d.cluster_name,
    clusterDomain: d.cluster_domain,
    name: d.name,
    agentType: d.agent_type,
    status: d.status,
    deploymentModel: d.deployment_model,
    version: d.version,
    healthScore: d.health_score,
    uptime: d.uptime,
    tasksExecuted: d.tasks_executed,
    lastHeartbeat: d.last_heartbeat,
    config: JSON.parse(d.config as string || '{}'),
    createdAt: d.created_at,
  }));

  return c.json({ deployments: formatted, total: formatted.length });
});

// GET /api/controlplane/deployments/:id
controlplane.get('/deployments/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const d = await c.env.DB.prepare(
    `SELECT ad.*, cc.name as cluster_name, cc.domain as cluster_domain, t.name as tenant_name 
     FROM agent_deployments ad 
     LEFT JOIN catalyst_clusters cc ON ad.cluster_id = cc.id 
     JOIN tenants t ON ad.tenant_id = t.id 
     WHERE ad.id = ? AND ad.tenant_id = ?`
  ).bind(id, tenantId).first();

  if (!d) return c.json({ error: 'Deployment not found' }, 404);

  return c.json({
    id: d.id,
    tenantId: d.tenant_id,
    tenantName: d.tenant_name,
    clusterId: d.cluster_id,
    clusterName: d.cluster_name,
    clusterDomain: d.cluster_domain,
    name: d.name,
    agentType: d.agent_type,
    status: d.status,
    deploymentModel: d.deployment_model,
    version: d.version,
    healthScore: d.health_score,
    uptime: d.uptime,
    tasksExecuted: d.tasks_executed,
    lastHeartbeat: d.last_heartbeat,
    config: JSON.parse(d.config as string || '{}'),
    createdAt: d.created_at,
  });
});

// POST /api/controlplane/deployments
controlplane.post('/deployments', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    cluster_id?: string; name: string; agent_type: string;
    deployment_model?: string; version?: string; config?: Record<string, unknown>;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'agent_type', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'deployment_model', type: 'string', required: false, maxLength: 32 },
    { field: 'version', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, deployment_model, version, config, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, tenantId, body.cluster_id || null, body.name, body.agent_type, body.deployment_model || 'saas', body.version || '1.0.0', JSON.stringify(body.config || {})).run();

  // Update cluster agent count if cluster specified
  if (body.cluster_id) {
    await c.env.DB.prepare(
      'UPDATE catalyst_clusters SET agent_count = agent_count + 1 WHERE id = ? AND tenant_id = ?'
    ).bind(body.cluster_id, tenantId).run();
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, 'agent.deployed', 'controlplane', id, JSON.stringify({ name: body.name, type: body.agent_type, model: body.deployment_model }), 'success').run();

  return c.json({ id, status: 'provisioning' }, 201);
});

// PUT /api/controlplane/deployments/:id
controlplane.put('/deployments/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const body = await c.req.json<{
    status?: string; version?: string; name?: string;
    agent_type?: string; deployment_model?: string;
    config?: Record<string, unknown>;
    health_score?: number; uptime?: number;
  }>();

  // Verify deployment exists
  const existing = await c.env.DB.prepare(
    'SELECT id, status, config FROM agent_deployments WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Deployment not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.version) { updates.push('version = ?'); values.push(body.version); }
  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.agent_type) { updates.push('agent_type = ?'); values.push(body.agent_type); }
  if (body.deployment_model) { updates.push('deployment_model = ?'); values.push(body.deployment_model); }
  if (typeof body.health_score === 'number') { updates.push('health_score = ?'); values.push(body.health_score); }
  if (typeof body.uptime === 'number') { updates.push('uptime = ?'); values.push(body.uptime); }
  if (body.config) {
    // Merge with existing config
    const existingConfig = JSON.parse(existing.config as string || '{}');
    const mergedConfig = { ...existingConfig, ...body.config };
    updates.push('config = ?');
    values.push(JSON.stringify(mergedConfig));
  }
  updates.push('last_heartbeat = datetime(\'now\')');

  values.push(id, tenantId);
  await c.env.DB.prepare(`UPDATE agent_deployments SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();

  // Audit log for status changes
  if (body.status) {
    const prevStatus = existing.status as string;
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId,
      `agent.${body.status === 'running' ? 'started' : body.status === 'stopped' ? 'stopped' : body.status === 'deploying' ? 'restarting' : 'updated'}`,
      'controlplane', id,
      JSON.stringify({ previousStatus: prevStatus, newStatus: body.status, version: body.version }),
      'success',
    ).run();
  }

  // Fetch and return updated deployment
  const updated = await c.env.DB.prepare(
    `SELECT ad.*, cc.name as cluster_name, t.name as tenant_name
     FROM agent_deployments ad
     LEFT JOIN catalyst_clusters cc ON ad.cluster_id = cc.id
     JOIN tenants t ON ad.tenant_id = t.id
     WHERE ad.id = ? AND ad.tenant_id = ?`
  ).bind(id, tenantId).first();

  return c.json({
    success: true,
    deployment: updated ? {
      id: updated.id,
      name: updated.name,
      status: updated.status,
      version: updated.version,
      healthScore: updated.health_score,
      config: JSON.parse(updated.config as string || '{}'),
    } : null,
  });
});

// DELETE /api/controlplane/deployments/:id
controlplane.delete('/deployments/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const deployment = await c.env.DB.prepare('SELECT cluster_id FROM agent_deployments WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();

  await c.env.DB.prepare('DELETE FROM agent_deployments WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();

  if (deployment?.cluster_id) {
    await c.env.DB.prepare(
      'UPDATE catalyst_clusters SET agent_count = MAX(0, agent_count - 1) WHERE id = ? AND tenant_id = ?'
    ).bind(deployment.cluster_id, tenantId).run();
  }

  return c.json({ success: true });
});

// GET /api/controlplane/health
controlplane.get('/health', async (c) => {
  const tenantId = getTenantId(c);

  const statusCounts = await c.env.DB.prepare(
    'SELECT status, COUNT(*) as count FROM agent_deployments WHERE tenant_id = ? GROUP BY status'
  ).bind(tenantId).all();

  const avgHealth = await c.env.DB.prepare('SELECT AVG(health_score) as avg FROM agent_deployments WHERE tenant_id = ?').bind(tenantId).first<{ avg: number }>();
  const avgUptime = await c.env.DB.prepare('SELECT AVG(uptime) as avg FROM agent_deployments WHERE tenant_id = ?').bind(tenantId).first<{ avg: number }>();

  return c.json({
    overallHealth: Math.round((avgHealth?.avg || 0) * 100) / 100,
    overallUptime: Math.round((avgUptime?.avg || 0) * 100) / 100,
    deploymentStatus: statusCounts.results.reduce((acc: Record<string, unknown>, row: Record<string, unknown>) => {
      acc[row.status as string] = row.count;
      return acc;
    }, {} as Record<string, unknown>),
    lastChecked: new Date().toISOString(),
  });
});

export default controlplane;
