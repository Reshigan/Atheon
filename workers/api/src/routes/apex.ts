import { Hono } from 'hono';
import type { Env } from '../types';

const apex = new Hono<{ Bindings: Env }>();

// GET /api/apex/health?tenant_id=
apex.get('/health', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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

// GET /api/apex/briefing?tenant_id=
apex.get('/briefing', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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

// GET /api/apex/risks?tenant_id=
apex.get('/risks', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; title: string; description: string; severity: string;
    category: string; probability?: number; impact_value?: number; recommended_actions?: string[];
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, recommended_actions) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.title, body.description, body.severity, body.category, body.probability || 0, body.impact_value || 0, JSON.stringify(body.recommended_actions || [])).run();

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

// GET /api/apex/scenarios?tenant_id=
apex.get('/scenarios', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; title: string; description: string; input_query: string; variables?: string[];
  }>();

  const id = crypto.randomUUID();

  // Generate mock scenario results
  const results = {
    npv_impact: Math.round((Math.random() - 0.5) * 10000000),
    risk_change: `${Math.random() > 0.5 ? '+' : '-'}${Math.round(Math.random() * 20)}%`,
    confidence: Math.round(70 + Math.random() * 25),
    recommendation: 'Analysis completed. See detailed report for implementation steps.',
    generated_at: new Date().toISOString(),
  };

  await c.env.DB.prepare(
    'INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.title, body.description, body.input_query, JSON.stringify(body.variables || []), JSON.stringify(results), 'completed').run();

  return c.json({ id, results }, 201);
});

export default apex;
