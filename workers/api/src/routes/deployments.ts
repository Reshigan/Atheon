// workers/api/src/routes/deployments.ts
// Hybrid Deployment Management API — Super Admin + Agent routes
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const deployments = new Hono<AppBindings>();

// ── Licence key auth helper ──────────────────────────────────────────────
async function getDeploymentByLicenceKey(db: D1Database, licenceKey: string) {
  return db.prepare(
    'SELECT * FROM managed_deployments WHERE licence_key = ? AND status != ?'
  ).bind(licenceKey, 'suspended').first<Record<string, unknown>>();
}

// ── Superadmin auth guard ─────────────────────────────────────────────────
function requireSuperAdmin(auth: AuthContext | undefined): boolean {
  return auth?.role === 'superadmin';
}

function generateLicenceKey(): string {
  // Format: ATH-XXXX-XXXX-XXXX-XXXX (groups of 4 hex chars)
  const hex = () => crypto.randomUUID().replace(/-/g, '').slice(0, 4).toUpperCase();
  return `ATH-${hex()}-${hex()}-${hex()}-${hex()}`;
}

// ── GET /api/deployments ──────────────────────────────────────────────────
deployments.get('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const results = await c.env.DB.prepare(`
    SELECT md.*, t.name as tenant_name, t.slug as tenant_slug
    FROM managed_deployments md
    JOIN tenants t ON md.tenant_id = t.id
    ORDER BY md.created_at DESC
  `).all<Record<string, unknown>>();

  return c.json({
    deployments: results.results.map(formatDeployment),
    total: results.results.length
  });
});

// ── POST /api/deployments ─────────────────────────────────────────────────
deployments.post('/', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    tenant_id: string;
    name: string;
    deployment_type?: 'hybrid' | 'on-premise';
    region?: string;
    licence_expires_at?: string;
    config?: Record<string, unknown>;
  }>();

  if (!body.tenant_id || !body.name) {
    return c.json({ error: 'tenant_id and name are required' }, 400);
  }

  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(body.tenant_id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  const id = crypto.randomUUID();
  const licenceKey = generateLicenceKey();
  const defaultConfig = {
    ollamaModel: 'Reshigan/atheon',
    maxUsers: 50,
    features: ['apex', 'pulse', 'catalysts', 'mind', 'memory'],
    updateChannel: 'stable',
    callHomeEnabled: true,
    telemetryEnabled: true,
    ...(body.config || {})
  };

  await c.env.DB.prepare(`
    INSERT INTO managed_deployments
    (id, tenant_id, name, deployment_type, status, licence_key, licence_expires_at, region, config)
    VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
  `).bind(
    id,
    body.tenant_id,
    body.name,
    body.deployment_type || 'hybrid',
    licenceKey,
    body.licence_expires_at || null,
    body.region || 'af-south-1',
    JSON.stringify(defaultConfig)
  ).run();

  // Return the install config the customer IT team needs
  const installConfig = buildInstallConfig(id, licenceKey, defaultConfig);

  return c.json({
    id,
    licenceKey,
    status: 'pending',
    installConfig,
    message: 'Deployment provisioned. Share installConfig with the customer IT team.'
  }, 201);
});

// ── GET /api/deployments/:id ──────────────────────────────────────────────
deployments.get('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const dep = await c.env.DB.prepare(`
    SELECT md.*, t.name as tenant_name, t.slug as tenant_slug
    FROM managed_deployments md JOIN tenants t ON md.tenant_id = t.id
    WHERE md.id = ?
  `).bind(c.req.param('id')).first<Record<string, unknown>>();

  if (!dep) return c.json({ error: 'Not found' }, 404);
  return c.json(formatDeployment(dep));
});

// ── PUT /api/deployments/:id ──────────────────────────────────────────────
deployments.put('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<{
    name?: string;
    status?: string;
    config?: Record<string, unknown>;
    licence_expires_at?: string;
    customer_api_url?: string;
  }>();

  const existing = await c.env.DB.prepare('SELECT * FROM managed_deployments WHERE id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const updates: string[] = ["updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.customer_api_url) { updates.push('customer_api_url = ?'); values.push(body.customer_api_url); }
  if (body.licence_expires_at) { updates.push('licence_expires_at = ?'); values.push(body.licence_expires_at); }

  if (body.config) {
    const merged = { ...JSON.parse(existing.config as string || '{}'), ...body.config };
    updates.push('config = ?');
    values.push(JSON.stringify(merged));
  }

  values.push(c.req.param('id'));
  await c.env.DB.prepare(
    `UPDATE managed_deployments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  return c.json({ success: true });
});

// ── POST /api/deployments/:id/push-config ─────────────────────────────────
deployments.post('/:id/push-config', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const body = await c.req.json<Record<string, unknown>>();
  const existing = await c.env.DB.prepare('SELECT config FROM managed_deployments WHERE id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const newConfig = { ...JSON.parse(existing.config as string || '{}'), ...body };
  await c.env.DB.prepare(
    "UPDATE managed_deployments SET config = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify(newConfig), c.req.param('id')).run();

  return c.json({ success: true, message: 'Config queued — agent will apply on next heartbeat' });
});

// ── POST /api/deployments/:id/push-update ────────────────────────────────
deployments.post('/:id/push-update', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const { version } = await c.req.json<{ version: string }>();
  if (!version) return c.json({ error: 'version is required' }, 400);

  const existing = await c.env.DB.prepare('SELECT config FROM managed_deployments WHERE id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!existing) return c.json({ error: 'Not found' }, 404);

  const config = { ...JSON.parse(existing.config as string || '{}'), targetVersion: version };
  await c.env.DB.prepare(
    "UPDATE managed_deployments SET config = ?, updated_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify(config), c.req.param('id')).run();

  return c.json({ success: true, message: `Update to ${version} queued` });
});

// ── GET /api/deployments/:id/logs ─────────────────────────────────────────
deployments.get('/:id/logs', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  const dep = await c.env.DB.prepare('SELECT error_log FROM managed_deployments WHERE id = ?')
    .bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!dep) return c.json({ error: 'Not found' }, 404);

  return c.json({ logs: JSON.parse(dep.error_log as string || '[]') });
});

// ── DELETE /api/deployments/:id ───────────────────────────────────────────
deployments.delete('/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!requireSuperAdmin(auth)) return c.json({ error: 'Forbidden' }, 403);

  await c.env.DB.prepare(
    "UPDATE managed_deployments SET status = 'suspended', updated_at = datetime('now') WHERE id = ?"
  ).bind(c.req.param('id')).run();

  return c.json({ success: true, message: 'Licence revoked. Agent will be refused on next heartbeat.' });
});

// NOTE: Agent routes (heartbeat, config, error) have been moved to agent-routes.ts
// and are mounted at /api/agent — outside tenantIsolation middleware.

// ── Helpers───────────────────────────────────────────────────────────────
function formatDeployment(d: Record<string, unknown>) {
  return {
    id: d.id,
    tenantId: d.tenant_id,
    tenantName: d.tenant_name,
    tenantSlug: d.tenant_slug,
    name: d.name,
    deploymentType: d.deployment_type,
    status: d.status,
    licenceKey: d.licence_key,
    licenceExpiresAt: d.licence_expires_at,
    agentVersion: d.agent_version,
    apiVersion: d.api_version,
    customerApiUrl: d.customer_api_url,
    region: d.region,
    lastHeartbeat: d.last_heartbeat,
    healthScore: d.health_score,
    config: JSON.parse(d.config as string || '{}'),
    resourceUsage: JSON.parse(d.resource_usage as string || '{}'),
    createdAt: d.created_at,
    updatedAt: d.updated_at,
  };
}

function buildInstallConfig(deploymentId: string, licenceKey: string, config: Record<string, unknown>) {
  return {
    deploymentId,
    licenceKey,
    controlPlaneUrl: 'https://atheon.vantax.co.za/api/deployments',
    heartbeatIntervalSeconds: 60,
    agentImage: `gonxt/atheon-api:${config.updateChannel || 'stable'}`,
    initialConfig: config,
    envFile: [
      `ATHEON_DEPLOYMENT_ID=${deploymentId}`,
      `ATHEON_LICENCE_KEY=${licenceKey}`,
      `ATHEON_CONTROL_PLANE_URL=https://atheon.vantax.co.za/api/deployments`,
      `ATHEON_HEARTBEAT_INTERVAL=60`,
      `# Fill in these values:`,
      `DATABASE_URL=postgresql://atheon:CHANGEME@localhost:5432/atheon`,
      `REDIS_URL=redis://localhost:6379`,
      `MINIO_ENDPOINT=http://localhost:9000`,
      `MINIO_BUCKET=atheon-storage`,
      `MINIO_ACCESS_KEY=atheon`,
      `MINIO_SECRET_KEY=CHANGEME`,
      `OLLAMA_BASE_URL=http://localhost:11434`,
      `JWT_SECRET=CHANGEME_32_CHARS_MIN`,
      `ENCRYPTION_KEY=CHANGEME_32_CHARS_MIN`,
    ].join('\n'),
    installCommand: `curl -sSL https://atheon.vantax.co.za/install.sh | bash -s -- --licence-key ${licenceKey} --deployment-id ${deploymentId}`,
  };
}

export default deployments;
