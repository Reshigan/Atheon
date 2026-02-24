import { Hono } from 'hono';
import type { Env } from '../types';

const controlplane = new Hono<{ Bindings: Env }>();

// GET /api/controlplane/deployments?tenant_id=
controlplane.get('/deployments', async (c) => {
  const tenantId = c.req.query('tenant_id');

  let query = `SELECT ad.*, cc.name as cluster_name, cc.domain as cluster_domain, t.name as tenant_name 
    FROM agent_deployments ad 
    LEFT JOIN catalyst_clusters cc ON ad.cluster_id = cc.id 
    JOIN tenants t ON ad.tenant_id = t.id`;
  const binds: unknown[] = [];

  if (tenantId) {
    query += ' WHERE ad.tenant_id = ?';
    binds.push(tenantId);
  }

  query += ' ORDER BY ad.created_at DESC';

  const results = binds.length > 0
    ? await c.env.DB.prepare(query).bind(...binds).all()
    : await c.env.DB.prepare(query).all();

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
  const id = c.req.param('id');
  const d = await c.env.DB.prepare(
    `SELECT ad.*, cc.name as cluster_name, cc.domain as cluster_domain, t.name as tenant_name 
     FROM agent_deployments ad 
     LEFT JOIN catalyst_clusters cc ON ad.cluster_id = cc.id 
     JOIN tenants t ON ad.tenant_id = t.id 
     WHERE ad.id = ?`
  ).bind(id).first();

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
  const body = await c.req.json<{
    tenant_id: string; cluster_id?: string; name: string; agent_type: string;
    deployment_model?: string; version?: string; config?: Record<string, unknown>;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO agent_deployments (id, tenant_id, cluster_id, name, agent_type, deployment_model, version, config, last_heartbeat) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(id, body.tenant_id, body.cluster_id || null, body.name, body.agent_type, body.deployment_model || 'saas', body.version || '1.0.0', JSON.stringify(body.config || {})).run();

  // Update cluster agent count if cluster specified
  if (body.cluster_id) {
    await c.env.DB.prepare(
      'UPDATE catalyst_clusters SET agent_count = agent_count + 1 WHERE id = ?'
    ).bind(body.cluster_id).run();
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), body.tenant_id, 'agent.deployed', 'controlplane', id, JSON.stringify({ name: body.name, type: body.agent_type, model: body.deployment_model }), 'success').run();

  return c.json({ id, status: 'provisioning' }, 201);
});

// PUT /api/controlplane/deployments/:id
controlplane.put('/deployments/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string; version?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.version) { updates.push('version = ?'); values.push(body.version); }
  updates.push('last_heartbeat = datetime(\'now\')');

  values.push(id);
  await c.env.DB.prepare(`UPDATE agent_deployments SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return c.json({ success: true });
});

// DELETE /api/controlplane/deployments/:id
controlplane.delete('/deployments/:id', async (c) => {
  const id = c.req.param('id');

  const deployment = await c.env.DB.prepare('SELECT cluster_id, tenant_id FROM agent_deployments WHERE id = ?').bind(id).first();

  await c.env.DB.prepare('DELETE FROM agent_deployments WHERE id = ?').bind(id).run();

  if (deployment?.cluster_id) {
    await c.env.DB.prepare(
      'UPDATE catalyst_clusters SET agent_count = MAX(0, agent_count - 1) WHERE id = ?'
    ).bind(deployment.cluster_id).run();
  }

  return c.json({ success: true });
});

// GET /api/controlplane/health (global system health)
controlplane.get('/health', async (c) => {
  const tenantId = c.req.query('tenant_id');

  let deploymentQuery = 'SELECT status, COUNT(*) as count FROM agent_deployments';
  const binds: unknown[] = [];
  if (tenantId) {
    deploymentQuery += ' WHERE tenant_id = ?';
    binds.push(tenantId);
  }
  deploymentQuery += ' GROUP BY status';

  const statusCounts = binds.length > 0
    ? await c.env.DB.prepare(deploymentQuery).bind(...binds).all()
    : await c.env.DB.prepare(deploymentQuery).all();

  let avgHealth: { avg: number } | null;
  if (tenantId) {
    avgHealth = await c.env.DB.prepare('SELECT AVG(health_score) as avg FROM agent_deployments WHERE tenant_id = ?').bind(tenantId).first<{ avg: number }>();
  } else {
    avgHealth = await c.env.DB.prepare('SELECT AVG(health_score) as avg FROM agent_deployments').first<{ avg: number }>();
  }

  let avgUptime: { avg: number } | null;
  if (tenantId) {
    avgUptime = await c.env.DB.prepare('SELECT AVG(uptime) as avg FROM agent_deployments WHERE tenant_id = ?').bind(tenantId).first<{ avg: number }>();
  } else {
    avgUptime = await c.env.DB.prepare('SELECT AVG(uptime) as avg FROM agent_deployments').first<{ avg: number }>();
  }

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
