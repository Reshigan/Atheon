import { Hono } from 'hono';
import type { Env } from '../types';

const catalysts = new Hono<{ Bindings: Env }>();

// GET /api/catalysts/clusters?tenant_id=
catalysts.get('/clusters', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
  const results = await c.env.DB.prepare(
    'SELECT * FROM catalyst_clusters WHERE tenant_id = ? ORDER BY domain ASC'
  ).bind(tenantId).all();

  const formatted = results.results.map((cl: Record<string, unknown>) => ({
    id: cl.id,
    name: cl.name,
    domain: cl.domain,
    description: cl.description,
    status: cl.status,
    agentCount: cl.agent_count,
    tasksCompleted: cl.tasks_completed,
    tasksInProgress: cl.tasks_in_progress,
    successRate: cl.success_rate,
    trustScore: cl.trust_score,
    autonomyTier: cl.autonomy_tier,
    createdAt: cl.created_at,
  }));

  return c.json({ clusters: formatted, total: formatted.length });
});

// GET /api/catalysts/clusters/:id
catalysts.get('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const cl = await c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE id = ?').bind(id).first();

  if (!cl) return c.json({ error: 'Cluster not found' }, 404);

  // Get recent actions
  const actions = await c.env.DB.prepare(
    'SELECT * FROM catalyst_actions WHERE cluster_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(id).all();

  // Get deployments
  const deployments = await c.env.DB.prepare(
    'SELECT * FROM agent_deployments WHERE cluster_id = ? ORDER BY created_at DESC'
  ).bind(id).all();

  return c.json({
    id: cl.id,
    name: cl.name,
    domain: cl.domain,
    description: cl.description,
    status: cl.status,
    agentCount: cl.agent_count,
    tasksCompleted: cl.tasks_completed,
    tasksInProgress: cl.tasks_in_progress,
    successRate: cl.success_rate,
    trustScore: cl.trust_score,
    autonomyTier: cl.autonomy_tier,
    recentActions: actions.results.map((a: Record<string, unknown>) => ({
      id: a.id,
      catalystName: a.catalyst_name,
      action: a.action,
      status: a.status,
      confidence: a.confidence,
      reasoning: a.reasoning,
      createdAt: a.created_at,
      completedAt: a.completed_at,
    })),
    deployments: deployments.results.map((d: Record<string, unknown>) => ({
      id: d.id,
      name: d.name,
      agentType: d.agent_type,
      status: d.status,
      deploymentModel: d.deployment_model,
      version: d.version,
      healthScore: d.health_score,
      uptime: d.uptime,
      tasksExecuted: d.tasks_executed,
      lastHeartbeat: d.last_heartbeat,
    })),
  });
});

// POST /api/catalysts/clusters
catalysts.post('/clusters', async (c) => {
  const body = await c.req.json<{
    tenant_id: string; name: string; domain: string; description?: string; autonomy_tier?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, autonomy_tier) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.name, body.domain, body.description || '', body.autonomy_tier || 'read-only').run();

  return c.json({ id, name: body.name, domain: body.domain }, 201);
});

// PUT /api/catalysts/clusters/:id
catalysts.put('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string; autonomy_tier?: string }>();

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.autonomy_tier) { updates.push('autonomy_tier = ?'); values.push(body.autonomy_tier); }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE catalyst_clusters SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// GET /api/catalysts/actions?tenant_id=&cluster_id=
catalysts.get('/actions', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
  const clusterId = c.req.query('cluster_id');
  const status = c.req.query('status');
  const limit = parseInt(c.req.query('limit') || '50');

  let query = 'SELECT * FROM catalyst_actions WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (clusterId) { query += ' AND cluster_id = ?'; binds.push(clusterId); }
  if (status) { query += ' AND status = ?'; binds.push(status); }

  query += ' ORDER BY created_at DESC LIMIT ?';
  binds.push(limit);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((a: Record<string, unknown>) => ({
    id: a.id,
    clusterId: a.cluster_id,
    catalystName: a.catalyst_name,
    action: a.action,
    status: a.status,
    confidence: a.confidence,
    inputData: a.input_data ? JSON.parse(a.input_data as string) : null,
    outputData: a.output_data ? JSON.parse(a.output_data as string) : null,
    reasoning: a.reasoning,
    approvedBy: a.approved_by,
    createdAt: a.created_at,
    completedAt: a.completed_at,
  }));

  return c.json({ actions: formatted, total: formatted.length });
});

// POST /api/catalysts/actions
catalysts.post('/actions', async (c) => {
  const body = await c.req.json<{
    cluster_id: string; tenant_id: string; catalyst_name: string; action: string;
    confidence?: number; input_data?: unknown; reasoning?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, reasoning) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.cluster_id, body.tenant_id, body.catalyst_name, body.action, 'pending', body.confidence || 0, body.input_data ? JSON.stringify(body.input_data) : null, body.reasoning || null).run();

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), body.tenant_id, 'catalyst.action.created', 'catalysts', body.cluster_id, JSON.stringify({ action_id: id, catalyst: body.catalyst_name, action: body.action }), 'success').run();

  return c.json({ id, status: 'pending' }, 201);
});

// PUT /api/catalysts/actions/:id/approve
catalysts.put('/actions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string }>();

  await c.env.DB.prepare(
    'UPDATE catalyst_actions SET status = ?, approved_by = ?, completed_at = datetime(\'now\') WHERE id = ?'
  ).bind('approved', body.approved_by || 'system', id).run();

  return c.json({ success: true, status: 'approved' });
});

// PUT /api/catalysts/actions/:id/reject
catalysts.put('/actions/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string; reason?: string }>();

  await c.env.DB.prepare(
    'UPDATE catalyst_actions SET status = ?, approved_by = ?, completed_at = datetime(\'now\') WHERE id = ?'
  ).bind('rejected', body.approved_by || 'system', id).run();

  return c.json({ success: true, status: 'rejected' });
});

// GET /api/catalysts/governance?tenant_id=
catalysts.get('/governance', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const totalActions = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const pendingActions = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? AND status = ?').bind(tenantId, 'pending').first<{ count: number }>();
  const approvedActions = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? AND status = ?').bind(tenantId, 'approved').first<{ count: number }>();
  const rejectedActions = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? AND status = ?').bind(tenantId, 'rejected').first<{ count: number }>();

  // Get clusters summary
  const clusters = await c.env.DB.prepare(
    'SELECT domain, autonomy_tier, trust_score FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(tenantId).all();

  return c.json({
    totalActions: totalActions?.count || 0,
    pendingApprovals: pendingActions?.count || 0,
    approved: approvedActions?.count || 0,
    rejected: rejectedActions?.count || 0,
    clusterAutonomy: clusters.results.map((cl: Record<string, unknown>) => ({
      domain: cl.domain,
      autonomyTier: cl.autonomy_tier,
      trustScore: cl.trust_score,
    })),
  });
});

export default catalysts;
