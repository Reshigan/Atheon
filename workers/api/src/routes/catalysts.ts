import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { executeTask, approveAction, rejectAction } from '../services/catalyst-engine';
import { getValidatedJsonBody } from '../middleware/validation';
import { INDUSTRY_TEMPLATES, getTemplateForIndustry } from '../services/catalyst-templates';

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

function getTenantId(c: { get: (key: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || 'vantax';
}

// GET /api/catalysts/clusters
catalysts.get('/clusters', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  const tenantId = (auth?.role === 'admin' || auth?.role === 'system_admin') ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;
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
    subCatalysts: safeJsonParse(cl.sub_catalysts as string) || [],
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
  const tenantId = getTenantId(c);
  const raw = await c.req.json<{
    tenant_id?: string; name: string; domain: string; description?: string; autonomy_tier?: string;
    sub_catalysts?: Array<{ name: string; enabled: boolean; description: string }>;
  }>();

  // Admin can override tenant_id for creating clusters on behalf of other tenants
  const auth = c.get('auth') as AuthContext | undefined;
  const targetTenant = (auth?.role === 'admin' || auth?.role === 'system_admin') && raw.tenant_id ? raw.tenant_id : tenantId;

  if (!raw.name || raw.name.length < 1) return c.json({ error: 'name is required' }, 400);
  if (raw.name.length > 100) return c.json({ error: 'name must be 100 characters or less' }, 400);
  if (!raw.domain || raw.domain.length < 1) return c.json({ error: 'domain is required' }, 400);
  if (raw.domain.length > 64) return c.json({ error: 'domain must be 64 characters or less' }, 400);
  if (raw.description && raw.description.length > 500) return c.json({ error: 'description must be 500 characters or less' }, 400);
  if (raw.autonomy_tier && raw.autonomy_tier.length > 32) return c.json({ error: 'autonomy_tier must be 32 characters or less' }, 400);

  const id = crypto.randomUUID();
  const subCatalysts = raw.sub_catalysts ? JSON.stringify(raw.sub_catalysts) : '[]';
  await c.env.DB.prepare(
    'INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, autonomy_tier, status, sub_catalysts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, targetTenant, raw.name, raw.domain, raw.description || '', raw.autonomy_tier || 'read-only', 'active', subCatalysts).run();

  return c.json({ id, name: raw.name, domain: raw.domain }, 201);
});

// GET /api/catalysts/templates - List available industry templates
catalysts.get('/templates', async (c) => {
  const templates = INDUSTRY_TEMPLATES.map(t => ({
    industry: t.industry,
    label: t.label,
    description: t.description,
    clusterCount: t.clusters.length,
    clusters: t.clusters.map(cl => ({
      name: cl.name,
      domain: cl.domain,
      description: cl.description,
      autonomy_tier: cl.autonomy_tier,
      subCatalystCount: cl.sub_catalysts.length,
      sub_catalysts: cl.sub_catalysts,
    })),
  }));
  return c.json({ templates });
});

// POST /api/catalysts/deploy-template - Deploy all catalyst clusters for an industry template
catalysts.post('/deploy-template', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (auth.role !== 'admin' && auth.role !== 'system_admin')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can deploy catalyst templates' }, 403);
  }

  const body = await c.req.json<{
    tenant_id: string;
    industry: string;
    clusters?: Array<{
      name: string; domain: string; description: string; autonomy_tier: string;
      sub_catalysts: Array<{ name: string; enabled: boolean; description: string }>;
    }>;
  }>();

  if (!body.tenant_id) return c.json({ error: 'tenant_id is required' }, 400);
  if (!body.industry) return c.json({ error: 'industry is required' }, 400);

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(body.tenant_id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Get template clusters — use custom clusters if provided, else use the industry default
  let clustersToCreate = body.clusters;
  if (!clustersToCreate || clustersToCreate.length === 0) {
    const template = getTemplateForIndustry(body.industry);
    if (!template) return c.json({ error: `No template found for industry: ${body.industry}` }, 404);
    clustersToCreate = template.clusters.map(cl => ({
      name: cl.name,
      domain: cl.domain,
      description: cl.description,
      autonomy_tier: cl.autonomy_tier,
      sub_catalysts: cl.sub_catalysts,
    }));
  }

  // Check for existing clusters for this tenant — warn but don't block
  const existing = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(body.tenant_id).first<{ count: number }>();

  const createdIds: string[] = [];
  for (const cl of clustersToCreate) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, agent_count, tasks_completed, tasks_in_progress, success_rate, trust_score, autonomy_tier, sub_catalysts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, body.tenant_id, cl.name, cl.domain, cl.description,
      'active', 0, 0, 0, 0, 0, cl.autonomy_tier,
      JSON.stringify(cl.sub_catalysts)
    ).run();
    createdIds.push(id);
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), body.tenant_id, 'catalyst.template.deployed', 'catalysts', body.tenant_id,
    JSON.stringify({ industry: body.industry, clusters_created: createdIds.length, existing_clusters: existing?.count || 0 }),
    'success'
  ).run().catch(() => {});

  return c.json({
    success: true,
    industry: body.industry,
    clustersCreated: createdIds.length,
    clusterIds: createdIds,
    existingClusters: existing?.count || 0,
  }, 201);
});

// DELETE /api/catalysts/clusters/:id - Delete a catalyst cluster
catalysts.delete('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (auth.role !== 'admin' && auth.role !== 'system_admin')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can delete catalyst clusters' }, 403);
  }

  const tenantId = auth.tenantId;
  // Admin can delete from any tenant by providing query param
  const targetTenant = c.req.query('tenant_id') || tenantId;

  await c.env.DB.prepare('DELETE FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(id, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.cluster.deleted', 'catalysts', id,
    JSON.stringify({ deleted_cluster_id: id }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true });
});

// PUT /api/catalysts/clusters/:id/sub-catalysts/:name/toggle - Toggle sub-catalyst on/off (admin only)
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/toggle', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (auth.role !== 'admin' && auth.role !== 'executive' && auth.role !== 'system_admin')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can toggle sub-catalysts' }, 403);
  }

  // Admin can manage clusters of other tenants via tenant_id query param
  const targetTenant = (auth.role === 'admin' || auth.role === 'system_admin') ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as Array<{ name: string; enabled: boolean; description?: string }>;
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  subs[idx].enabled = !subs[idx].enabled;
  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.toggled', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, enabled: subs[idx].enabled }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-source - Configure data source for a sub-catalyst
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/data-source', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (auth.role !== 'admin' && auth.role !== 'executive' && auth.role !== 'system_admin')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  const body = await c.req.json<{
    type: 'erp' | 'email' | 'cloud_storage' | 'upload';
    config: Record<string, unknown>;
  }>();

  if (!body.type || !['erp', 'email', 'cloud_storage', 'upload'].includes(body.type)) {
    return c.json({ error: 'Invalid data source type. Must be: erp, email, cloud_storage, or upload' }, 400);
  }

  // Validate config based on type
  const config = body.config || {};
  if (body.type === 'erp' && !config.erp_type) {
    return c.json({ error: 'ERP data source requires erp_type in config' }, 400);
  }
  if (body.type === 'email' && !config.mailbox) {
    return c.json({ error: 'Email data source requires mailbox in config' }, 400);
  }
  if (body.type === 'cloud_storage' && (!config.provider || !config.path)) {
    return c.json({ error: 'Cloud storage data source requires provider and path in config' }, 400);
  }

  // Admin can manage clusters of other tenants via tenant_id query param
  const targetTenant = (auth.role === 'admin' || auth.role === 'system_admin') ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as Array<{ name: string; enabled: boolean; description?: string; data_source?: { type: string; config: Record<string, unknown> } }>;
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  subs[idx].data_source = { type: body.type, config };
  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_source_configured', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, data_source_type: body.type }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// DELETE /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-source - Remove data source config
catalysts.delete('/clusters/:clusterId/sub-catalysts/:subName/data-source', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (auth.role !== 'admin' && auth.role !== 'executive' && auth.role !== 'system_admin')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  // Admin can manage clusters of other tenants via tenant_id query param
  const targetTenant = (auth.role === 'admin' || auth.role === 'system_admin') ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as Array<{ name: string; enabled: boolean; description?: string; data_source?: { type: string; config: Record<string, unknown> } }>;
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  delete subs[idx].data_source;
  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_source_removed', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
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

// GET /api/catalysts/actions
catalysts.get('/actions', async (c) => {
  const tenantId = getTenantId(c);
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
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    cluster_id: string; catalyst_name: string; action: string;
    confidence?: number; input_data?: Record<string, unknown>; reasoning?: string;
    risk_level?: string;
  }>(c, [
    { field: 'cluster_id', type: 'string', required: true, minLength: 1 },
    { field: 'catalyst_name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'action', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'risk_level', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Get cluster info for autonomy tier and trust score
  const cluster = await c.env.DB.prepare(
    'SELECT * FROM catalyst_clusters WHERE id = ?'
  ).bind(body.cluster_id).first();

  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  // Execute through the catalyst engine
  const result = await executeTask({
    clusterId: body.cluster_id,
    tenantId: tenantId,
    catalystName: body.catalyst_name,
    action: body.action,
    inputData: body.input_data || {},
    riskLevel: (body.risk_level || 'medium') as 'high' | 'medium' | 'low',
    autonomyTier: (cluster.autonomy_tier as string) || 'read-only',
    trustScore: (cluster.trust_score as number) || 0.5,
  }, c.env.DB, c.env.CACHE, c.env.AI, c.env.OLLAMA_API_KEY);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.action.executed', 'catalysts', body.cluster_id,
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

// GET /api/catalysts/governance
catalysts.get('/governance', async (c) => {
  const tenantId = getTenantId(c);

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

// GET /api/catalysts/approvals - Get pending approval requests
catalysts.get('/approvals', async (c) => {
  const tenantId = getTenantId(c);

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

// POST /api/catalysts/manual-execute - Manual catalyst execution with file upload + datetime range
catalysts.post('/manual-execute', async (c) => {
  const tenantId = getTenantId(c);

  // Parse multipart form data or JSON
  let clusterId: string;
  let catalystName: string;
  let action: string;
  let startDatetime: string;
  let endDatetime: string;
  let fileData: string | null = null;
  let fileName: string | null = null;
  let reasoning: string | null = null;

  const contentType = c.req.header('Content-Type') || '';

  if (contentType.includes('multipart/form-data')) {
    const formData = await c.req.formData();
    clusterId = formData.get('cluster_id') as string;
    catalystName = formData.get('catalyst_name') as string;
    action = formData.get('action') as string;
    startDatetime = formData.get('start_datetime') as string;
    endDatetime = formData.get('end_datetime') as string;
    reasoning = formData.get('reasoning') as string | null;
    const file = formData.get('file') as File | null;
    if (file) {
      fileName = file.name;
      fileData = await file.text();
    }
  } else {
    const body = await c.req.json<{
      cluster_id: string; catalyst_name: string; action: string;
      start_datetime: string; end_datetime: string;
      file_data?: string; file_name?: string; reasoning?: string;
    }>();
    clusterId = body.cluster_id;
    catalystName = body.catalyst_name;
    action = body.action;
    startDatetime = body.start_datetime;
    endDatetime = body.end_datetime;
    fileData = body.file_data || null;
    fileName = body.file_name || null;
    reasoning = body.reasoning || null;
  }

  if (!clusterId || !catalystName || !action || !startDatetime || !endDatetime) {
    return c.json({ error: 'Missing required fields: cluster_id, catalyst_name, action, start_datetime, end_datetime' }, 400);
  }

  // Validate datetime format
  const start = new Date(startDatetime);
  const end = new Date(endDatetime);
  if (isNaN(start.getTime()) || isNaN(end.getTime())) {
    return c.json({ error: 'Invalid datetime format. Use ISO 8601 format.' }, 400);
  }
  if (end <= start) {
    return c.json({ error: 'end_datetime must be after start_datetime' }, 400);
  }

  // Verify cluster exists
  const cluster = await c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, tenantId).first();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  // Create the manual action
  const actionId = crypto.randomUUID();
  const inputData = JSON.stringify({
    manual: true,
    start_datetime: startDatetime,
    end_datetime: endDatetime,
    file_name: fileName,
    file_size: fileData ? fileData.length : 0,
    file_preview: fileData ? fileData.substring(0, 500) : null,
  });

  await c.env.DB.prepare(
    'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(actionId, clusterId, tenantId, catalystName, action, 'pending', 0.85, inputData, reasoning || `Manual execution requested for period ${startDatetime} to ${endDatetime}`).run();

  // Store file in R2 if available
  if (fileData && c.env.STORAGE) {
    try {
      await c.env.STORAGE.put(`catalyst-files/${tenantId}/${actionId}/${fileName}`, fileData);
    } catch {
      // R2 may not be configured, continue without file storage
    }
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, 'catalyst.manual_execute', 'catalysts', clusterId,
    JSON.stringify({ action_id: actionId, catalyst: catalystName, action, start: startDatetime, end: endDatetime, file: fileName }),
    'success'
  ).run().catch(() => {});

  return c.json({
    actionId,
    status: 'pending',
    message: `Manual catalyst execution created for ${catalystName}. Period: ${startDatetime} to ${endDatetime}.${fileName ? ` File: ${fileName}` : ''}`,
    startDatetime,
    endDatetime,
    fileName,
  }, 201);
});

// GET /api/catalysts/execution-stats - Execution engine stats
catalysts.get('/execution-stats', async (c) => {
  const tenantId = getTenantId(c);

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
