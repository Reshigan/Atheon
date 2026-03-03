import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const tenants = new Hono<AppBindings>();

// GET /api/tenants - List all tenants (admin only)
tenants.get('/', async (c) => {
  const results = await c.env.DB.prepare(
    'SELECT t.*, te.layers, te.catalyst_clusters, te.max_agents, te.max_users, te.autonomy_tiers, te.llm_tiers, te.features, te.sso_enabled, te.api_access, te.custom_branding, te.data_retention_days FROM tenants t LEFT JOIN tenant_entitlements te ON t.id = te.tenant_id ORDER BY t.created_at DESC'
  ).all();

  const formatted = results.results.map((t: Record<string, unknown>) => ({
    id: t.id,
    name: t.name,
    slug: t.slug,
    industry: t.industry,
    plan: t.plan,
    status: t.status,
    deploymentModel: t.deployment_model,
    region: t.region,
    createdAt: t.created_at,
    entitlements: {
      layers: JSON.parse(t.layers as string || '[]'),
      catalystClusters: JSON.parse(t.catalyst_clusters as string || '[]'),
      maxAgents: t.max_agents,
      maxUsers: t.max_users,
      autonomyTiers: JSON.parse(t.autonomy_tiers as string || '[]'),
      llmTiers: JSON.parse(t.llm_tiers as string || '[]'),
      features: JSON.parse(t.features as string || '[]'),
      ssoEnabled: !!t.sso_enabled,
      apiAccess: !!t.api_access,
      customBranding: !!t.custom_branding,
      dataRetentionDays: t.data_retention_days,
    },
  }));

  return c.json({ tenants: formatted, total: formatted.length });
});

// GET /api/tenants/:id
tenants.get('/:id', async (c) => {
  const id = c.req.param('id');
  const t = await c.env.DB.prepare(
    'SELECT t.*, te.layers, te.catalyst_clusters, te.max_agents, te.max_users, te.autonomy_tiers, te.llm_tiers, te.features, te.sso_enabled, te.api_access, te.custom_branding, te.data_retention_days FROM tenants t LEFT JOIN tenant_entitlements te ON t.id = te.tenant_id WHERE t.id = ?'
  ).bind(id).first();

  if (!t) return c.json({ error: 'Tenant not found' }, 404);

  // Get user count
  const userCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM users WHERE tenant_id = ?').bind(id).first<{ count: number }>();
  // Get agent count
  const agentCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM agent_deployments WHERE tenant_id = ?').bind(id).first<{ count: number }>();
  // Get cluster count
  const clusterCount = await c.env.DB.prepare('SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?').bind(id).first<{ count: number }>();

  return c.json({
    id: t.id,
    name: t.name,
    slug: t.slug,
    industry: t.industry,
    plan: t.plan,
    status: t.status,
    deploymentModel: t.deployment_model,
    region: t.region,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    stats: {
      users: userCount?.count || 0,
      agents: agentCount?.count || 0,
      clusters: clusterCount?.count || 0,
    },
    entitlements: {
      layers: JSON.parse(t.layers as string || '[]'),
      catalystClusters: JSON.parse(t.catalyst_clusters as string || '[]'),
      maxAgents: t.max_agents,
      maxUsers: t.max_users,
      autonomyTiers: JSON.parse(t.autonomy_tiers as string || '[]'),
      llmTiers: JSON.parse(t.llm_tiers as string || '[]'),
      features: JSON.parse(t.features as string || '[]'),
      ssoEnabled: !!t.sso_enabled,
      apiAccess: !!t.api_access,
      customBranding: !!t.custom_branding,
      dataRetentionDays: t.data_retention_days,
    },
  });
});

// POST /api/tenants
tenants.post('/', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{
    name: string; slug: string; industry?: string; plan?: string;
    deploymentModel?: string; region?: string; entitlements?: Record<string, unknown>;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'slug', type: 'string', required: true, minLength: 1, maxLength: 64, pattern: /^[a-z0-9-]+$/ },
    { field: 'industry', type: 'string', required: false, maxLength: 64 },
    { field: 'plan', type: 'string', required: false, maxLength: 32 },
    { field: 'region', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO tenants (id, name, slug, industry, plan, deployment_model, region) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.name, body.slug, body.industry || 'general', body.plan || 'starter', body.deploymentModel || 'saas', body.region || 'af-south-1').run();

  // Create default entitlements
  await c.env.DB.prepare(
    'INSERT INTO tenant_entitlements (tenant_id) VALUES (?)'
  ).bind(id).run();

  return c.json({ id, name: body.name, slug: body.slug, status: 'active' }, 201);
});

// PUT /api/tenants/:id
tenants.put('/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const existing = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Tenant not found' }, 404);

  if (body.name || body.plan || body.status || body.deploymentModel) {
    const updates: string[] = [];
    const values: unknown[] = [];
    if (body.name) { updates.push('name = ?'); values.push(body.name); }
    if (body.plan) { updates.push('plan = ?'); values.push(body.plan); }
    if (body.status) { updates.push('status = ?'); values.push(body.status); }
    if (body.deploymentModel) { updates.push('deployment_model = ?'); values.push(body.deploymentModel); }
    updates.push('updated_at = datetime(\'now\')');
    values.push(id);

    await c.env.DB.prepare(`UPDATE tenants SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// PUT /api/tenants/:id/entitlements
tenants.put('/:id/entitlements', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<Record<string, unknown>>();

  const existing = await c.env.DB.prepare('SELECT tenant_id FROM tenant_entitlements WHERE tenant_id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Tenant not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];

  if (body.layers) { updates.push('layers = ?'); values.push(JSON.stringify(body.layers)); }
  if (body.catalystClusters) { updates.push('catalyst_clusters = ?'); values.push(JSON.stringify(body.catalystClusters)); }
  if (body.maxAgents !== undefined) { updates.push('max_agents = ?'); values.push(body.maxAgents); }
  if (body.maxUsers !== undefined) { updates.push('max_users = ?'); values.push(body.maxUsers); }
  if (body.autonomyTiers) { updates.push('autonomy_tiers = ?'); values.push(JSON.stringify(body.autonomyTiers)); }
  if (body.llmTiers) { updates.push('llm_tiers = ?'); values.push(JSON.stringify(body.llmTiers)); }
  if (body.features) { updates.push('features = ?'); values.push(JSON.stringify(body.features)); }
  if (body.ssoEnabled !== undefined) { updates.push('sso_enabled = ?'); values.push(body.ssoEnabled ? 1 : 0); }
  if (body.apiAccess !== undefined) { updates.push('api_access = ?'); values.push(body.apiAccess ? 1 : 0); }

  if (updates.length > 0) {
    values.push(id);
    await c.env.DB.prepare(`UPDATE tenant_entitlements SET ${updates.join(', ')} WHERE tenant_id = ?`).bind(...values).run();
  }

  return c.json({ success: true });
});

// POST /api/tenants/:id/reset - Reset company (delete all insights, start fresh)
tenants.post('/:id/reset', async (c) => {
  const id = c.req.param('id');

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id, name FROM tenants WHERE id = ?').bind(id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Delete all Apex/Pulse insight data + catalyst data for this tenant
  const insightTables = [
    'health_scores',
    'risk_alerts',
    'executive_briefings',
    'process_metrics',
    'anomalies',
    'process_flows',
    'correlation_events',
    'scenarios',
    'catalyst_actions',
    'agent_deployments',
    'mind_queries',
    'notifications',
  ];

  let deletedTotal = 0;
  for (const table of insightTables) {
    try {
      const result = await c.env.DB.prepare(`DELETE FROM ${table} WHERE tenant_id = ?`).bind(id).run();
      deletedTotal += result.meta?.changes || 0;
    } catch {
      // Table may not exist or have no tenant_id column — skip
    }
  }

  // Log the reset action in audit
  try {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), id, 'company.reset', 'admin', 'tenant',
      JSON.stringify({ tenantName: tenant.name, tablesCleared: insightTables.length, rowsDeleted: deletedTotal }),
      'success'
    ).run();
  } catch { /* audit log failed — non-critical */ }

  return c.json({ success: true, deletedRows: deletedTotal, tablesCleared: insightTables.length });
});

// DELETE /api/tenants/:id
tenants.delete('/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('UPDATE tenants SET status = ? WHERE id = ?').bind('suspended', id).run();
  return c.json({ success: true });
});

export default tenants;
