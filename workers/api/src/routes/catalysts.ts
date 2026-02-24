import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { executeTask, approveAction, rejectAction } from '../services/catalyst-engine';

const catalysts = new Hono<AppBindings>();

// Safe JSON parse that handles plain text strings
function safeJsonParse(value: unknown): unknown {
  if (!value || value === 'null') return null;
  const str = String(value);
  try {
    return JSON.parse(str);
  } catch {
    return str;
  }
}

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
    inputData: safeJsonParse(a.input_data as string),
    outputData: safeJsonParse(a.output_data as string),
    reasoning: a.reasoning,
    approvedBy: a.approved_by,
    createdAt: a.created_at,
    completedAt: a.completed_at,
  }));

  return c.json({ actions: formatted, total: formatted.length });
});

// POST /api/catalysts/actions - Submit action through execution engine
catalysts.post('/actions', async (c) => {
  const body = await c.req.json<{
    cluster_id: string; tenant_id: string; catalyst_name: string; action: string;
    confidence?: number; input_data?: Record<string, unknown>; reasoning?: string;
    risk_level?: string;
  }>();

  // Get cluster info for autonomy tier and trust score
  const cluster = await c.env.DB.prepare(
    'SELECT * FROM catalyst_clusters WHERE id = ?'
  ).bind(body.cluster_id).first();

  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  // Execute through the catalyst engine
  const result = await executeTask({
    clusterId: body.cluster_id,
    tenantId: body.tenant_id,
    catalystName: body.catalyst_name,
    action: body.action,
    inputData: body.input_data || {},
    riskLevel: (body.risk_level || 'medium') as 'high' | 'medium' | 'low',
    autonomyTier: (cluster.autonomy_tier as string) || 'read-only',
    trustScore: (cluster.trust_score as number) || 0.5,
  }, c.env.DB, c.env.CACHE, c.env.AI);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), body.tenant_id, 'catalyst.action.executed', 'catalysts', body.cluster_id,
    JSON.stringify({ action_id: result.actionId, catalyst: body.catalyst_name, action: body.action, confidence: result.confidence, status: result.status }),
    result.status === 'failed' ? 'failure' : 'success',
  ).run();

  return c.json(result, 201);
});

// PUT /api/catalysts/actions/:id/approve - Approve via execution engine
catalysts.put('/actions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string }>();

  const result = await approveAction(id, body.approved_by || 'system', c.env.DB, c.env.CACHE);
  return c.json(result);
});

// PUT /api/catalysts/actions/:id/reject - Reject via execution engine
catalysts.put('/actions/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string; reason?: string }>();

  const result = await rejectAction(id, body.approved_by || 'system', body.reason || '', c.env.DB, c.env.CACHE);
  return c.json(result);
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

// GET /api/catalysts/approvals?tenant_id= - Get pending approval requests
catalysts.get('/approvals', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const results = await c.env.DB.prepare(
    'SELECT ca.*, cc.name as cluster_name, cc.domain FROM catalyst_actions ca JOIN catalyst_clusters cc ON ca.cluster_id = cc.id WHERE ca.tenant_id = ? AND ca.status IN (?, ?) ORDER BY ca.created_at DESC'
  ).bind(tenantId, 'pending_approval', 'escalated').all();

  return c.json({
    approvals: results.results.map((a: Record<string, unknown>) => ({
      id: a.id,
      clusterId: a.cluster_id,
      clusterName: a.cluster_name,
      domain: a.domain,
      catalystName: a.catalyst_name,
      action: a.action,
      status: a.status,
      confidence: a.confidence,
      reasoning: a.reasoning,
      inputData: safeJsonParse(a.input_data as string),
      createdAt: a.created_at,
    })),
    total: results.results.length,
  });
});

// GET /api/catalysts/execution-stats?tenant_id= - Execution engine stats
catalysts.get('/execution-stats', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';

  const [total, byStatus, avgConfidence, recentExecutions] = await Promise.all([
    c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>(),
    c.env.DB.prepare('SELECT status, COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? GROUP BY status').bind(tenantId).all(),
    c.env.DB.prepare('SELECT AVG(confidence) as avg_conf FROM catalyst_actions WHERE tenant_id = ? AND confidence IS NOT NULL').bind(tenantId).first<{ avg_conf: number }>(),
    c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 10').bind(tenantId).all(),
  ]);

  return c.json({
    totalExecutions: total?.count || 0,
    statusBreakdown: byStatus.results.reduce((acc: Record<string, unknown>, r: Record<string, unknown>) => {
      acc[r.status as string] = r.count; return acc;
    }, {}),
    averageConfidence: Math.round((avgConfidence?.avg_conf || 0) * 100) / 100,
    recentExecutions: recentExecutions.results.map((a: Record<string, unknown>) => ({
      id: a.id, action: a.action, status: a.status, confidence: a.confidence, createdAt: a.created_at,
    })),
  });
});

export default catalysts;
