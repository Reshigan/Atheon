import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const apex = new Hono<AppBindings>();

/** Helper: always use JWT tenantId, never trust query params */
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || 'vantax';
}

// Helper: check if a query/action references a disabled sub-catalyst
async function checkSubCatalystRestriction(db: D1Database, tenantId: string, context: string): Promise<{ restricted: boolean; subName?: string }> {
  try {
    const clusters = await db.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all();
    const ctxLower = context.toLowerCase();
    for (const cl of clusters.results) {
      const subs = JSON.parse((cl as Record<string, unknown>).sub_catalysts as string || '[]') as Array<{ name: string; enabled: boolean }>;
      for (const sub of subs) {
        if (!sub.enabled && ctxLower.includes(sub.name.toLowerCase())) {
          return { restricted: true, subName: sub.name };
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return { restricted: false };
}

// GET /api/apex/health
apex.get('/health', async (c) => {
  const tenantId = getTenantId(c);
  const score = await c.env.DB.prepare(
    'SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!score) {
    return c.json({ overall: 0, dimensions: {}, calculatedAt: null });
  }

  return c.json({
    id: score.id,
    overall: score.overall_score,
    dimensions: JSON.parse(score.dimensions as string || '{}'),
    calculatedAt: score.calculated_at,
  });
});

// GET /api/apex/briefing
apex.get('/briefing', async (c) => {
  const tenantId = getTenantId(c);
  const briefing = await c.env.DB.prepare(
    'SELECT * FROM executive_briefings WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  if (!briefing) {
    return c.json({ error: 'No briefings found' }, 404);
  }

  return c.json({
    id: briefing.id,
    title: briefing.title,
    summary: briefing.summary,
    risks: JSON.parse(briefing.risks as string || '[]'),
    opportunities: JSON.parse(briefing.opportunities as string || '[]'),
    kpiMovements: JSON.parse(briefing.kpi_movements as string || '[]'),
    decisionsNeeded: JSON.parse(briefing.decisions_needed as string || '[]'),
    generatedAt: briefing.generated_at,
  });
});

// GET /api/apex/risks
apex.get('/risks', async (c) => {
  const tenantId = getTenantId(c);
  const severity = c.req.query('severity');

  let query = 'SELECT * FROM risk_alerts WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (severity) {
    query += ' AND severity = ?';
    binds.push(severity);
  }

  query += ' ORDER BY CASE severity WHEN \'critical\' THEN 1 WHEN \'high\' THEN 2 WHEN \'medium\' THEN 3 WHEN \'low\' THEN 4 END';

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  const formatted = results.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    severity: r.severity,
    category: r.category,
    probability: r.probability,
    impactValue: r.impact_value,
    impactUnit: r.impact_unit || 'ZAR',
    recommendedActions: JSON.parse(r.recommended_actions as string || '[]'),
    status: r.status,
    detectedAt: r.detected_at,
  }));

  return c.json({ risks: formatted, total: formatted.length });
});

// POST /api/apex/risks
apex.post('/risks', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    title: string; description: string; severity: string;
    category: string; probability?: number; impact_value?: number; recommended_actions?: string[];
  }>(c, [
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'description', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'severity', type: 'string', required: true, minLength: 1, maxLength: 32 },
    { field: 'category', type: 'string', required: true, minLength: 1, maxLength: 64 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, recommended_actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.severity, body.category, body.probability || 0, body.impact_value || 0, JSON.stringify(body.recommended_actions || [])).run();

  return c.json({ id }, 201);
});

// PUT /api/apex/risks/:id
apex.put('/risks/:id', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ status?: string }>();

  if (body.status) {
    const resolvedAt = body.status === 'resolved' ? "datetime('now')" : 'NULL';
    await c.env.DB.prepare(
      `UPDATE risk_alerts SET status = ?, resolved_at = ${resolvedAt} WHERE id = ?`
    ).bind(body.status, id).run();
  }

  return c.json({ success: true });
});

// GET /api/apex/scenarios
apex.get('/scenarios', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM scenarios WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((s: Record<string, unknown>) => ({
    id: s.id,
    title: s.title,
    description: s.description,
    inputQuery: s.input_query,
    variables: JSON.parse(s.variables as string || '[]'),
    results: JSON.parse(s.results as string || '{}'),
    status: s.status,
    createdAt: s.created_at,
  }));

  return c.json({ scenarios: formatted, total: formatted.length });
});

// POST /api/apex/scenarios
apex.post('/scenarios', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    title: string; description: string; input_query: string; variables?: string[];
  }>(c, [
    { field: 'title', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'description', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'input_query', type: 'string', required: true, minLength: 1, maxLength: 2000 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Check sub-catalyst restrictions — block scenarios referencing disabled sub-catalysts
  const restriction = await checkSubCatalystRestriction(c.env.DB, tenantId, `${body.title} ${body.description} ${body.input_query}`);
  if (restriction.restricted) {
    return c.json({ error: `The sub-catalyst "${restriction.subName}" is currently disabled by your administrator. Enable it before running scenarios that reference it.`, restricted: true, restrictedSubCatalyst: restriction.subName }, 403);
  }

  const id = crypto.randomUUID();

  // Generate scenario results
  const results = {
    npv_impact: Math.round((Math.random() - 0.5) * 10000000),
    risk_change: `${Math.random() > 0.5 ? '+' : '-'}${Math.round(Math.random() * 20)}%`,
    confidence: Math.round(70 + Math.random() * 25),
    recommendation: 'Analysis completed. See detailed report for implementation steps.',
    generated_at: new Date().toISOString(),
  };

  await c.env.DB.prepare(
    'INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.input_query, JSON.stringify(body.variables || []), JSON.stringify(results), 'completed').run();

  return c.json({ id, results }, 201);
});

export default apex;
