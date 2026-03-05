import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const pulse = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// M2: Helper to parse pagination params
function getPagination(c: { req: { query: (k: string) => string | undefined } }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  return { limit, offset };
}

// GET /api/pulse/metrics
pulse.get('/metrics', async (c) => {
  const tenantId = getTenantId(c);
  const { limit, offset } = getPagination(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM process_metrics WHERE tenant_id = ? ORDER BY name ASC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();
  const countResult = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?'
  ).bind(tenantId).first<{ count: number }>();

  const formatted = results.results.map((m: Record<string, unknown>) => ({
    id: m.id,
    name: m.name,
    value: m.value,
    unit: m.unit,
    status: m.status,
    thresholds: {
      green: m.threshold_green,
      amber: m.threshold_amber,
      red: m.threshold_red,
    },
    trend: JSON.parse(m.trend as string || '[]'),
    sourceSystem: m.source_system,
    measuredAt: m.measured_at,
  }));

  return c.json({ metrics: formatted, total: countResult?.count || formatted.length, limit, offset });
});

// POST /api/pulse/metrics
pulse.post('/metrics', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    name: string; value: number; unit: string;
    threshold_green?: number; threshold_amber?: number; threshold_red?: number; source_system?: string;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'value', type: 'number', required: true },
    { field: 'unit', type: 'string', required: true, minLength: 1, maxLength: 32 },
    { field: 'source_system', type: 'string', required: false, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();

  // Calculate status
  let status = 'green';
  if (body.threshold_red !== undefined && body.threshold_amber !== undefined && body.threshold_green !== undefined) {
    if (body.threshold_green > body.threshold_red) {
      // Higher is better (e.g., %)
      if (body.value < body.threshold_red) status = 'red';
      else if (body.value < body.threshold_amber) status = 'amber';
    } else {
      // Lower is better (e.g., days)
      if (body.value > body.threshold_red) status = 'red';
      else if (body.value > body.threshold_amber) status = 'amber';
    }
  }

  await c.env.DB.prepare(
    'INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.name, body.value, body.unit, status, body.threshold_green || null, body.threshold_amber || null, body.threshold_red || null, body.source_system || null).run();

  return c.json({ id, status }, 201);
});

// GET /api/pulse/anomalies
pulse.get('/anomalies', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM anomalies WHERE tenant_id = ? ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END'
  ).bind(tenantId).all();

  const formatted = results.results.map((a: Record<string, unknown>) => ({
    id: a.id,
    metric: a.metric,
    severity: a.severity,
    expectedValue: a.expected_value,
    actualValue: a.actual_value,
    deviation: a.deviation,
    hypothesis: a.hypothesis,
    status: a.status,
    detectedAt: a.detected_at,
  }));

  return c.json({ anomalies: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// PUT /api/pulse/anomalies/:id
pulse.put('/anomalies/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>();

  if (body.status) {
    await c.env.DB.prepare('UPDATE anomalies SET status = ? WHERE id = ?').bind(body.status, id).run();
  }

  return c.json({ success: true });
});

// GET /api/pulse/processes
pulse.get('/processes', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM process_flows WHERE tenant_id = ?'
  ).bind(tenantId).all();

  const formatted = results.results.map((f: Record<string, unknown>) => ({
    id: f.id,
    name: f.name,
    steps: JSON.parse(f.steps as string || '[]'),
    variants: f.variants,
    avgDuration: f.avg_duration,
    conformanceRate: f.conformance_rate,
    bottlenecks: JSON.parse(f.bottlenecks as string || '[]'),
  }));

  return c.json({ processes: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// GET /api/pulse/correlations
pulse.get('/correlations', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM correlation_events WHERE tenant_id = ? ORDER BY confidence DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((ce: Record<string, unknown>) => ({
    id: ce.id,
    sourceSystem: ce.source_system,
    sourceEvent: ce.source_event,
    targetSystem: ce.target_system,
    targetImpact: ce.target_impact,
    confidence: ce.confidence,
    lagDays: ce.lag_days,
    detectedAt: ce.detected_at,
  }));

  return c.json({ correlations: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// GET /api/pulse/summary (aggregated overview)
pulse.get('/summary', async (c) => {
  const tenantId = getTenantId(c);

  const totalMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const greenMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'green').first<{ count: number }>();
  const amberMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'amber').first<{ count: number }>();
  const redMetrics = await c.env.DB.prepare('SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'red').first<{ count: number }>();
  const openAnomalies = await c.env.DB.prepare('SELECT COUNT(*) as count FROM anomalies WHERE tenant_id = ? AND status = ?').bind(tenantId, 'open').first<{ count: number }>();

  return c.json({
    totalMetrics: totalMetrics?.count || 0,
    statusBreakdown: {
      green: greenMetrics?.count || 0,
      amber: amberMetrics?.count || 0,
      red: redMetrics?.count || 0,
    },
    openAnomalies: openAnomalies?.count || 0,
  });
});

export default pulse;
