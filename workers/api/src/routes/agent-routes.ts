// workers/api/src/routes/agent-routes.ts
// Agent routes — authenticated by X-Licence-Key header, NOT JWT
// Mounted at /api/agent (outside tenantIsolation middleware)
import { Hono } from 'hono';
import type { AppBindings } from '../types';

const agentRoutes = new Hono<AppBindings>();

async function getDeploymentByLicenceKey(db: D1Database, licenceKey: string) {
  return db.prepare(
    'SELECT * FROM managed_deployments WHERE licence_key = ? AND status != ?'
  ).bind(licenceKey, 'suspended').first<Record<string, unknown>>();
}

// ── AGENT: POST /api/agent/heartbeat ──────────────────────────────────
agentRoutes.post('/heartbeat', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  const body = await c.req.json<{
    agentVersion?: string;
    apiVersion?: string;
    healthScore?: number;
    resourceUsage?: Record<string, unknown>;
    status?: string;
  }>();

  const updates: string[] = ["last_heartbeat = datetime('now')", "updated_at = datetime('now')"];
  const values: unknown[] = [];

  if (body.agentVersion) { updates.push('agent_version = ?'); values.push(body.agentVersion); }
  if (body.apiVersion) { updates.push('api_version = ?'); values.push(body.apiVersion); }
  if (typeof body.healthScore === 'number') { updates.push('health_score = ?'); values.push(body.healthScore); }
  if (body.resourceUsage) { updates.push('resource_usage = ?'); values.push(JSON.stringify(body.resourceUsage)); }

  // If heartbeat arrives, deployment is active
  const newStatus = dep.status === 'pending' || dep.status === 'offline' ? 'active' : dep.status as string;
  updates.push('status = ?');
  values.push(body.status || newStatus);

  values.push(dep.id);
  await c.env.DB.prepare(
    `UPDATE managed_deployments SET ${updates.join(', ')} WHERE id = ?`
  ).bind(...values).run();

  // Return any pending config for the agent
  const currentConfig = JSON.parse(dep.config as string || '{}');
  return c.json({
    ok: true,
    config: currentConfig,
    targetVersion: currentConfig.targetVersion || null,
  });
});

// ── AGENT: GET /api/agent/config ──────────────────────────────────────
agentRoutes.get('/config', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  return c.json({ config: JSON.parse(dep.config as string || '{}') });
});

// ── AGENT: POST /api/agent/error ──────────────────────────────────────
agentRoutes.post('/error', async (c) => {
  const licenceKey = c.req.header('X-Licence-Key');
  if (!licenceKey) return c.json({ error: 'Missing X-Licence-Key' }, 401);

  const dep = await getDeploymentByLicenceKey(c.env.DB, licenceKey);
  if (!dep) return c.json({ error: 'Invalid or suspended licence' }, 403);

  const body = await c.req.json<{ message: string; code?: string; severity?: string }>();
  const existing = JSON.parse(dep.error_log as string || '[]') as unknown[];
  const newLog = [
    { ts: new Date().toISOString(), message: body.message, code: body.code, severity: body.severity || 'error' },
    ...existing
  ].slice(0, 20); // keep last 20

  await c.env.DB.prepare(
    "UPDATE managed_deployments SET error_log = ?, status = CASE WHEN status = 'active' THEN 'degraded' ELSE status END, updated_at = datetime('now') WHERE id = ?"
  ).bind(JSON.stringify(newLog), dep.id).run();

  return c.json({ ok: true });
});

export default agentRoutes;
