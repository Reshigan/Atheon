import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { withLlmFallback } from '../services/ollama';
import { generateApexInsights, generateDashboardIntelligence } from '../services/insights-engine';
import { stripCodeFences } from '../services/llm-provider';

const apex = new Hono<AppBindings>();

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
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

// A1-3: GET /api/apex/health/history — Health score time-series for trend sparklines
apex.get('/health/history', async (c) => {
  const tenantId = getTenantId(c);
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '30', 10) || 30, 1), 90);

  const results = await c.env.DB.prepare(
    'SELECT id, overall_score, dimensions, source_run_id, catalyst_name, recorded_at FROM health_score_history WHERE tenant_id = ? ORDER BY recorded_at DESC LIMIT ?'
  ).bind(tenantId, limit).all();

  const history = results.results.map((h: Record<string, unknown>) => ({
    id: h.id,
    overallScore: h.overall_score,
    dimensions: JSON.parse(h.dimensions as string || '{}'),
    sourceRunId: h.source_run_id || null,
    catalystName: h.catalyst_name || null,
    recordedAt: h.recorded_at,
  }));

  // Calculate delta from latest vs 7-days-ago
  let delta = 0;
  let deltaLabel = 'No change';
  if (history.length >= 2) {
    const latest = history[0].overallScore as number;
    // Find score from ~7 days ago (or oldest available)
    const weekAgo = history.length > 7 ? history[7].overallScore as number : history[history.length - 1].overallScore as number;
    delta = latest - weekAgo;
    deltaLabel = delta > 0 ? `+${delta} points this week` : delta < 0 ? `${delta} points this week` : 'No change this week';
  }

  return c.json({ history: history.reverse(), delta, deltaLabel, total: history.length });
});

// A1-4: GET /api/apex/health/dimensions/:dimension — Drill-down into a specific health dimension
apex.get('/health/dimensions/:dimension', async (c) => {
  const tenantId = getTenantId(c);
  const dimension = c.req.param('dimension');
  
  // Validate dimension
  const validDimensions = ['financial', 'operational', 'compliance', 'strategic', 'technology', 'risk', 'catalyst', 'process'];
  if (!validDimensions.includes(dimension)) {
    return c.json({ 
      error: `Invalid dimension. Must be one of: ${validDimensions.join(', ')}`,
      validDimensions,
      suggestion: 'Check the traceability architecture documentation for available dimensions'
    }, 400);
  }
  
  // Get latest health score
  const latestScore = await c.env.DB.prepare(
    'SELECT id, overall_score, dimensions, calculated_at FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ id: string; overall_score: number; dimensions: string; calculated_at: string }>();
  
  if (!latestScore) {
    return c.json({ 
      error: 'No health score found',
      message: 'Run a catalyst first to generate health data.',
      suggestion: 'Navigate to Catalysts page and run a catalyst action',
      quickActions: [
        { label: 'Run Catalyst', href: '/catalysts' },
        { label: 'View Documentation', href: '/docs/traceability' }
      ]
    }, 404);
  }
  
  const dimensions = JSON.parse(latestScore.dimensions || '{}') as Record<string, { score: number; trend: string; delta: number; contributors?: string[]; sourceRunId?: string; catalystName?: string; kpiContributors?: Array<{ name: string; value: number; status: string }>; lastUpdated?: string }>;
  
  const dimData = dimensions[dimension];
  if (!dimData) {
    return c.json({ 
      dimension, 
      score: null, 
      message: `No data for dimension '${dimension}'. Run a catalyst in this domain to generate data.`,
      suggestion: `Run a catalyst in a domain that affects ${dimension} dimension`,
      relatedDimensions: validDimensions.filter(d => d !== dimension)
    });
  }
  
  // Get contributing sub-cataulysts from cluster info
  const clusterInfo = await c.env.DB.prepare(
    'SELECT id, name, domain, sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(tenantId).all<{ id: string; name: string; domain: string; sub_catalysts: string }>();
  
  // Map domains to dimensions (same logic as catalysts.ts)
  const domainToDimensions: Record<string, string[]> = {
    'finance': ['financial'],
    'procurement': ['operational', 'financial'],
    'supply-chain': ['operational'],
    'hr': ['operational', 'strategic'],
    'sales': ['financial', 'strategic'],
    'mining-safety': ['compliance'],
    'mining-environment': ['compliance'],
    'health-compliance': ['compliance'],
    'health-supply': ['technology', 'operational'],
    'health-patient': ['operational'],
    'health-staffing': ['operational'],
    'health-experience': ['strategic', 'operational'],
    'mining-equipment': ['technology', 'operational'],
    'mining-ore': ['operational'],
    'agri-crop': ['operational', 'technology'],
    'agri-irrigation': ['technology'],
    'agri-quality': ['compliance'],
    'agri-market': ['strategic'],
    'logistics-fleet': ['operational'],
    'logistics-warehouse': ['operational'],
    'logistics-compliance': ['compliance'],
    'tech-devops': ['technology'],
    'tech-security': ['technology', 'compliance'],
    'tech-product': ['strategic', 'technology'],
    'tech-customer-success': ['strategic', 'operational'],
    'mfg-production': ['operational'],
    'mfg-quality': ['compliance', 'operational'],
    'mfg-maintenance': ['technology', 'operational'],
    'mfg-energy': ['technology', 'operational'],
    'fmcg-trade': ['financial', 'strategic'],
    'fmcg-distributor': ['operational', 'strategic'],
    'fmcg-launch': ['strategic'],
    'fmcg-shelf': ['strategic', 'operational'],
  };
  
  // Find clusters that contribute to this dimension
  const contributingClusters = (clusterInfo.results || []).filter(cl => {
    // Check if cluster domain maps to this dimension
    const clusterDomain = cl.domain || '';
    const dimForDomain = domainToDimensions[clusterDomain] || ['operational'];
    return dimForDomain.includes(dimension);
  }).map(cl => ({
    clusterId: cl.id,
    clusterName: cl.name,
    domain: cl.domain,
    subCataulysts: JSON.parse(cl.sub_catalysts || '[]'),
  }));
  
  // Get recent runs from contributing sub-cataulysts
  const recentRuns = await c.env.DB.prepare(
    'SELECT id, cluster_id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value, started_at FROM sub_catalyst_runs WHERE tenant_id = ? AND status != ? ORDER BY started_at DESC LIMIT 20'
  ).bind(tenantId, 'running').all();
  
  // Filter runs to only those from contributing clusters
  const contributingRunIds = new Set(contributingClusters.map(c => c.clusterId));
  const relevantRuns = (recentRuns.results || []).filter(r => contributingRunIds.has(r.cluster_id as string)).map(r => ({
    runId: r.id,
    clusterId: r.cluster_id,
    subCataulystName: r.sub_catalyst_name,
    status: r.status,
    matched: r.matched,
    discrepancies: r.discrepancies,
    exceptions: r.exceptions_raised,
    totalValue: r.total_source_value,
    startedAt: r.started_at,
  }));
  
  // Get KPIs for this dimension from contributing sub-cataulysts
  const kpiQuery = await c.env.DB.prepare(
    'SELECT kd.id, kd.kpi_name, kd.category, kd.unit, kd.direction, kv.value, kv.status, kv.measured_at, scr.sub_catalyst_name, scr.id as run_id FROM sub_catalyst_kpi_values kv JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id LEFT JOIN sub_catalyst_runs scr ON kv.run_id = scr.id WHERE kd.tenant_id = ? AND kv.status != ? ORDER BY kv.measured_at DESC LIMIT 50'
  ).bind(tenantId, 'green').all();
  
  const relevantKpis = (kpiQuery.results || []).filter(k => {
    // Filter by category matching dimension
    const categoryToDimension: Record<string, string> = {
      'financial': 'financial',
      'operational': 'operational',
      'compliance': 'compliance',
      'strategic': 'strategic',
      'technology': 'technology',
      'risk': 'risk',
    };
    return categoryToDimension[k.category as string] === dimension;
  }).map(k => ({
    kpiId: k.id,
    kpiName: k.kpi_name,
    category: k.category,
    value: k.value,
    status: k.status,
    unit: k.unit,
    measuredAt: k.measured_at,
    subCataulystName: k.sub_catalyst_name,
    runId: k.run_id,
  }));
  
  return c.json({
    dimension,
    score: dimData.score,
    trend: dimData.trend,
    delta: dimData.delta,
    contributors: dimData.contributors || [],
    sourceRunId: dimData.sourceRunId || null,
    catalystName: dimData.catalystName || null,
    kpiContributors: dimData.kpiContributors || [],
    lastUpdated: dimData.lastUpdated,
    calculatedAt: latestScore.calculated_at,
    traceability: {
      contributingClusters,
      recentRuns: relevantRuns,
      relevantKpis: relevantKpis,
    },
    drillDownPath: {
      dimension: dimension,
      clusters: contributingClusters.map(c => c.clusterId),
      subCataulysts: contributingClusters.flatMap(c => (c.subCataulysts as Array<{ name?: string }>).map(s => s.name || '')),
      runs: relevantRuns.map(r => r.runId),
      items: 'Use GET /api/cataulysts/runs/:runId/items for item-level detail',
    },
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
    // A2: Data-driven briefing fields
    healthDelta: briefing.health_delta ?? null,
    redMetricCount: briefing.red_metric_count ?? null,
    anomalyCount: briefing.anomaly_count ?? null,
    activeRiskCount: briefing.active_risk_count ?? null,
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
    // P1/A4-3: Source attribution for drill-through
    sourceRunId: r.source_run_id || null,
    clusterId: r.cluster_id || null,
    subCatalystName: r.sub_catalyst_name || null,
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

// A4-4: GET /api/apex/risks/:riskId/trace — Trace a risk alert back to its source
apex.get('/risks/:riskId/trace', async (c) => {
  const tenantId = getTenantId(c);
  const riskId = c.req.param('riskId');
  
  // Get the risk alert
  const risk = await c.env.DB.prepare(
    'SELECT * FROM risk_alerts WHERE id = ? AND tenant_id = ?'
  ).bind(riskId, tenantId).first<Record<string, unknown>>();
  
  if (!risk) {
    return c.json({ 
      error: 'Risk alert not found',
      riskId,
      suggestion: 'Verify the risk ID or navigate to the Risks page to select a valid risk',
      quickActions: [
        { label: 'View All Risks', href: '/apex#risks' }
      ]
    }, 404);
  }
  
  // Get source attribution
  const sourceRunId = risk.source_run_id as string | null;
  const clusterId = risk.cluster_id as string | null;
  const subCataulystName = risk.sub_catalyst_name as string | null;
  
  // Get the source run if available
  let sourceRun: Record<string, unknown> | null = null;
  if (sourceRunId) {
    sourceRun = await c.env.DB.prepare(
      'SELECT id, cluster_id, sub_catalyst_name, catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value, started_at, completed_at, reasoning FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
    ).bind(sourceRunId, tenantId).first();
  }
  
  // Get cluster info
  let clusterInfo: Record<string, unknown> | null = null;
  if (clusterId) {
    clusterInfo = await c.env.DB.prepare(
      'SELECT id, name, domain, sub_catalysts, autonomy_tier FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
    ).bind(clusterId, tenantId).first();
  }
  
  // Get KPIs from the source run's sub-cataulyst
  let contributingKpis: Record<string, unknown>[] = [];
  if (subCataulystName && clusterId) {
    const kpis = await c.env.DB.prepare(
      'SELECT kd.kpi_name, kd.category, kd.unit, kv.value, kv.status, kv.measured_at FROM sub_catalyst_kpi_values kv JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id WHERE kd.tenant_id = ? AND kd.cluster_id = ? AND kd.sub_catalyst_name = ? ORDER BY kv.measured_at DESC LIMIT 20'
    ).bind(tenantId, clusterId, subCataulystName).all();
    contributingKpis = kpis.results || [];
  }
  
  // Get items with discrepancies/exceptions from the source run
  let flaggedItems: Record<string, unknown>[] = [];
  if (sourceRunId) {
    const items = await c.env.DB.prepare(
      "SELECT item_number, item_status, exception_type, exception_severity, source_ref, target_ref, field, source_value, target_value, difference FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? AND item_status IN ('discrepancy', 'exception') LIMIT 50"
    ).bind(sourceRunId, tenantId).all();
    flaggedItems = items.results || [];
  }
  
  // Get related anomalies
  let relatedAnomalies: Record<string, unknown>[] = [];
  if (subCataulystName) {
    const anomalies = await c.env.DB.prepare(
      "SELECT * FROM anomalies WHERE tenant_id = ? AND (metric LIKE ? OR hypothesis LIKE ?) ORDER BY detected_at DESC LIMIT 10"
    ).bind(tenantId, `%${subCataulystName}%`, `%${subCataulystName}%`).all();
    relatedAnomalies = anomalies.results || [];
  }
  
  // Build traceability chain
  const traceChain = {
    riskAlert: {
      id: risk.id,
      title: risk.title,
      description: risk.description,
      severity: risk.severity,
      category: risk.category,
      probability: risk.probability,
      impactValue: risk.impact_value,
      impactUnit: risk.impact_unit,
      recommendedActions: JSON.parse(risk.recommended_actions as string || '[]'),
      status: risk.status,
      detectedAt: risk.detected_at,
      resolvedAt: risk.resolved_at,
    },
    sourceAttribution: {
      sourceRunId,
      clusterId,
      subCataulystName,
    },
    sourceRun: sourceRun ? {
      runId: sourceRun.id,
      clusterId: sourceRun.cluster_id,
      subCataulystName: sourceRun.sub_catalyst_name,
      catalystName: sourceRun.catalyst_name,
      status: sourceRun.status,
      matched: sourceRun.matched,
      discrepancies: sourceRun.discrepancies,
      exceptions: sourceRun.exceptions_raised,
      totalValue: sourceRun.total_source_value,
      startedAt: sourceRun.started_at,
      completedAt: sourceRun.completed_at,
      reasoning: sourceRun.reasoning,
    } : null,
    cluster: clusterInfo ? {
      clusterId: clusterInfo.id,
      clusterName: clusterInfo.name,
      domain: clusterInfo.domain,
      autonomyTier: clusterInfo.autonomy_tier,
      subCataulysts: JSON.parse(clusterInfo.sub_catalysts as string || '[]'),
    } : null,
    contributingKpis: contributingKpis.map(k => ({
      kpiName: k.kpi_name,
      category: k.category,
      unit: k.unit,
      value: k.value,
      status: k.status,
      measuredAt: k.measured_at,
    })),
    flaggedItems: flaggedItems.map(i => ({
      itemNumber: i.item_number,
      status: i.item_status,
      type: i.exception_type,
      severity: i.exception_severity,
      sourceRef: i.source_ref,
      targetRef: i.target_ref,
      field: i.field,
      sourceValue: i.source_value,
      targetValue: i.target_value,
      difference: i.difference,
    })),
    relatedAnomalies: relatedAnomalies.map(a => ({
      anomalyId: a.id,
      metric: a.metric,
      severity: a.severity,
      expectedValue: a.expected_value,
      actualValue: a.actual_value,
      deviation: a.deviation,
      detectedAt: a.detected_at,
    })),
    drillDownPath: {
      risk: riskId,
      run: sourceRunId || 'N/A',
      items: sourceRunId ? `GET /api/cataulysts/runs/${sourceRunId}/items?status=discrepancy,status=exception` : 'N/A',
      cluster: clusterId || 'N/A',
      kpis: subCataulystName && clusterId ? `GET /api/cataulysts/clusters/${clusterId}/sub-cataulysts/${encodeURIComponent(subCataulystName)}/kpi-definitions` : 'N/A',
    },
  };
  
  return c.json(traceChain);
});

// A4-5: GET /api/apex/risks/:riskId/suggest-causes — LLM-powered root cause suggestions
apex.get('/risks/:riskId/suggest-causes', async (c) => {
  const tenantId = getTenantId(c);
  const riskId = c.req.param('riskId');
  
  // Get the risk alert
  const risk = await c.env.DB.prepare(
    'SELECT * FROM risk_alerts WHERE id = ? AND tenant_id = ?'
  ).bind(riskId, tenantId).first<Record<string, unknown>>();
  
  if (!risk) {
    return c.json({ error: 'Risk alert not found' }, 404);
  }
  
  // Get source attribution
  const sourceRunId = risk.source_run_id as string | null;
  const subCataulystName = risk.sub_catalyst_name as string | null;
  
  // Get related data for analysis
  let sourceRun: Record<string, unknown> | null = null;
  let contributingKpis: Record<string, unknown>[] = [];
  let flaggedItems: Record<string, unknown>[] = [];
  
  if (sourceRunId) {
    sourceRun = await c.env.DB.prepare(
      'SELECT id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, reasoning FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
    ).bind(sourceRunId, tenantId).first();
  }
  
  if (sourceRunId && subCataulystName) {
    const kpis = await c.env.DB.prepare(
      'SELECT kd.kpi_name, kd.category, kv.value, kv.status FROM sub_catalyst_kpi_values kv JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id WHERE kv.run_id = ? AND kv.tenant_id = ? ORDER BY kv.status DESC LIMIT 10'
    ).bind(sourceRunId, tenantId).all();
    contributingKpis = kpis.results || [];
    
    const items = await c.env.DB.prepare(
      "SELECT item_number, item_status, exception_type, exception_severity, field, discrepancy_reason FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? AND item_status IN ('discrepancy', 'exception') LIMIT 20"
    ).bind(sourceRunId, tenantId).all();
    flaggedItems = items.results || [];
  }
  
  // Build context for LLM
  const context = {
    risk: {
      title: risk.title,
      description: risk.description,
      severity: risk.severity,
      category: risk.category,
    },
    runStats: sourceRun ? {
      subCatalyst: sourceRun.sub_catalyst_name,
      status: sourceRun.status,
      matched: sourceRun.matched,
      discrepancies: sourceRun.discrepancies,
      exceptions: sourceRun.exceptions_raised,
      reasoning: sourceRun.reasoning,
    } : null,
    topKpis: contributingKpis.slice(0, 5),
    topIssues: flaggedItems.slice(0, 10),
  };
  
  try {
    // Call LLM for root cause analysis
    const ai = (c.env as unknown as Record<string, unknown>).AI;
    if (!ai || typeof (ai as Record<string, unknown>).run !== 'function') {
      throw new Error('Workers AI not available');
    }
    
    const prompt = `You are an enterprise root cause analysis expert. Analyze this risk alert and suggest likely root causes:

**Risk Alert:**
- Title: ${context.risk.title}
- Description: ${context.risk.description}
- Severity: ${context.risk.severity}
- Category: ${context.risk.category}

**Source Run Statistics:**
${context.runStats ? JSON.stringify(context.runStats, null, 2) : 'No run data available'}

**Top KPI Issues:**
${context.topKpis.map((k: Record<string, unknown>) => `- ${k.kpi_name}: ${k.value} (${k.status})`).join('\n') || 'No KPI data'}

**Flagged Items:**
${context.topIssues.map((i: Record<string, unknown>) => `- Item #${i.item_number}: ${i.exception_type} - ${i.field} (${i.discrepancy_reason || 'No reason'})`).join('\n') || 'No flagged items'}

**Task:** Identify the top 3 most likely root causes and provide:
1. Root cause description
2. Confidence level (0-100)
3. Recommended immediate action
4. Recommended long-term fix
5. Related systems/processes affected

Respond with JSON: { "rootCauses": [{ "description": string, "confidence": number, "immediateAction": string, "longTermFix": string, "affectedSystems": string[] }] }`;

    const aiResult = await (ai as { run: (model: string, input: { prompt: string }) => Promise<{ response?: string }> }).run('@cf/meta/llama-3.1-8b-instruct', { prompt });
    const text = aiResult?.response || '';
    
    if (!text) {
      throw new Error('Empty AI response');
    }
    
    try {
      const analysis = JSON.parse(stripCodeFences(text));
      
      // Save analysis to database
      await c.env.DB.prepare(
        'INSERT OR REPLACE INTO run_insights (id, run_id, tenant_id, summary, risks, actions, impact, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(),
        sourceRunId || 'N/A',
        tenantId,
        'Root cause analysis',
        JSON.stringify(analysis.rootCauses || []),
        JSON.stringify((analysis.rootCauses || []).map((r: Record<string, unknown>) => r.immediateAction)),
        'Root cause analysis generated',
        new Date().toISOString()
      ).run();
      
      return c.json({
        success: true,
        riskId,
        analysis: {
          rootCauses: analysis.rootCauses || [],
          generatedAt: new Date().toISOString(),
          model: 'llama-3.1-8b-instruct',
        },
      });
    } catch {
      // Fallback: return text as analysis
      return c.json({
        success: true,
        riskId,
        analysis: {
          rawAnalysis: text,
          generatedAt: new Date().toISOString(),
          model: 'llama-3.1-8b-instruct',
        },
      });
    }
  } catch (err) {
    console.error('Root cause analysis failed:', err);
    
    // Fallback: heuristic-based analysis
    const heuristicCauses = [];
    
    if ((context.runStats?.discrepancies as number) > 10) {
      heuristicCauses.push({
        description: 'High discrepancy rate suggests data quality issues in source or target systems',
        confidence: 75,
        immediateAction: 'Review data validation rules and source system logs',
        longTermFix: 'Implement automated data quality monitoring',
        affectedSystems: ['Source ERP', 'Target System'],
      });
    }
    
    if ((context.runStats?.exceptions as number) > 5) {
      heuristicCauses.push({
        description: 'Multiple exceptions indicate business rule violations or configuration mismatches',
        confidence: 70,
        immediateAction: 'Review exception details and business rule configurations',
        longTermFix: 'Align business rules between systems',
        affectedSystems: ['Business Rules Engine', 'Configuration'],
      });
    }
    
    if (context.topKpis.some((k: Record<string, unknown>) => k.status === 'red')) {
      heuristicCauses.push({
        description: 'Critical KPI failures suggest systemic process issues',
        confidence: 65,
        immediateAction: 'Investigate red KPIs and their dependencies',
        longTermFix: 'Implement KPI-based alerting and monitoring',
        affectedSystems: ['Process Monitoring', 'KPI Dashboard'],
      });
    }
    
    if (heuristicCauses.length === 0) {
      heuristicCauses.push({
        description: 'Insufficient data for automated analysis. Manual investigation recommended.',
        confidence: 50,
        immediateAction: 'Review run logs and flagged items manually',
        longTermFix: 'Improve data collection for better automated analysis',
        affectedSystems: ['Manual Review Process'],
      });
    }
    
    return c.json({
      success: true,
      riskId,
      analysis: {
        rootCauses: heuristicCauses,
        generatedAt: new Date().toISOString(),
        model: 'heuristic-fallback',
        note: 'LLM analysis unavailable, using heuristic analysis',
      },
    });
  }
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

  // A3-1: Gather real context data for scenario analysis
  let contextData: Record<string, unknown> = {};
  try {
    const health = await c.env.DB.prepare('SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ overall_score: number; dimensions: string }>();
    const redMetrics = await c.env.DB.prepare("SELECT name, value, unit FROM process_metrics WHERE tenant_id = ? AND status = 'red' LIMIT 10").bind(tenantId).all();
    const activeRisks = await c.env.DB.prepare("SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = 'active' LIMIT 10").bind(tenantId).all();
    const recentRuns = await c.env.DB.prepare('SELECT sub_catalyst_name, status, matched, discrepancies, exceptions_raised FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 20').bind(tenantId).all();
    contextData = {
      healthScore: health?.overall_score ?? 0,
      dimensions: health?.dimensions ? JSON.parse(health.dimensions) : {},
      redMetrics: redMetrics.results || [],
      activeRisks: activeRisks.results || [],
      recentRuns: recentRuns.results || [],
    };
  } catch (err) { console.error('scenarios: context gathering failed:', err); }

  // A3-2 + Spec 7 LLM-2: Scenario modelling with withLlmFallback wrapper
  const healthScore = (contextData.healthScore as number) || 50;
  const redCount = ((contextData.redMetrics as unknown[]) || []).length;
  const riskCount = ((contextData.activeRisks as unknown[]) || []).length;

  const llmResult = await withLlmFallback<Record<string, unknown>>(
    async () => {
      const ai = (c.env as unknown as Record<string, unknown>).AI;
      if (!ai || typeof (ai as Record<string, unknown>).run !== 'function') throw new Error('Workers AI not available');
      const prompt = `You are Atheon Mind, an enterprise AI analyst. Analyze this what-if scenario for a business:\n\nScenario: ${body.title}\nDescription: ${body.description}\nQuery: ${body.input_query}\n\nCurrent Business Context:\n- Health Score: ${healthScore}/100\n- RED Metrics: ${JSON.stringify(contextData.redMetrics || [])}\n- Active Risks: ${JSON.stringify(contextData.activeRisks || [])}\n- Recent Runs: ${JSON.stringify((contextData.recentRuns as unknown[])?.slice(0, 5) || [])}\n\nRespond with JSON: { "npv_impact": number, "risk_change": string, "confidence": number (0-100), "recommendation": string, "analysis_points": string[] }`;
      const aiResult = await (ai as { run: (model: string, input: { prompt: string }) => Promise<{ response?: string }> }).run('@cf/meta/llama-3.1-8b-instruct', { prompt });
      const text = aiResult?.response || '';
      if (!text) throw new Error('Empty AI response');
      try {
        return { ...JSON.parse(stripCodeFences(text)), generated_at: new Date().toISOString() };
      } catch {
        // Try to extract JSON from text that may have preamble before the JSON block
        const jsonMatch = text.match(/\{[\s\S]*"(?:npv_impact|recommendation|confidence)"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return { ...JSON.parse(jsonMatch[0]), generated_at: new Date().toISOString() };
          } catch { /* fall through to raw text */ }
        }
        return { recommendation: text, generated_at: new Date().toISOString() };
      }
    },
    () => {
      // Data-driven deterministic fallback (no Math.random)
      const baseImpact = healthScore > 70 ? 500000 : healthScore > 50 ? -200000 : -1000000;
      const riskAdjustment = riskCount * -150000 + redCount * -100000;
      return {
        npv_impact: Math.round(baseImpact + riskAdjustment),
        risk_change: `${riskCount > 3 ? '+' : '-'}${Math.round(riskCount * 3 + redCount * 2)}%`,
        confidence: Math.max(40, Math.min(85, 75 - riskCount * 5 - redCount * 3)),
        recommendation: `Based on current health score (${healthScore}/100), ${redCount} RED metric(s), and ${riskCount} active risk(s): ${healthScore > 70 ? 'Organization is well-positioned for this change.' : healthScore > 50 ? 'Moderate risk — address RED metrics before proceeding.' : 'High risk — stabilize operations first.'}`,
        analysis_points: [
          `Current health score: ${healthScore}/100`,
          redCount > 0 ? `${redCount} metric(s) in RED status need attention` : 'All metrics within acceptable ranges',
          riskCount > 0 ? `${riskCount} active risk alert(s) may impact outcome` : 'No active risk alerts',
        ],
        generated_at: new Date().toISOString(),
      };
    },
    10000, // 10s timeout
  );
  const scenarioResults = { ...llmResult.result, source: llmResult.source };
  const modelResponse = llmResult.source === 'llm' ? JSON.stringify(llmResult.result) : null;

  await c.env.DB.prepare(
    'INSERT INTO scenarios (id, tenant_id, title, description, input_query, variables, results, status, context_data, model_response) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.title, body.description, body.input_query, JSON.stringify(body.variables || []), JSON.stringify(scenarioResults), 'completed', JSON.stringify(contextData), modelResponse).run();

  return c.json({ id, results: scenarioResults, context: contextData }, 201);
});

// A4-6: GET /api/apex/risks/:riskId/export — Export risk traceability report as CSV
apex.get('/risks/:riskId/export', async (c) => {
  const tenantId = getTenantId(c);
  const riskId = c.req.param('riskId');
  
  // Get the risk alert
  const risk = await c.env.DB.prepare(
    'SELECT * FROM risk_alerts WHERE id = ? AND tenant_id = ?'
  ).bind(riskId, tenantId).first<Record<string, unknown>>();
  
  if (!risk) {
    return c.json({ error: 'Risk alert not found' }, 404);
  }
  
  // Get source run and items
  const sourceRunId = risk.source_run_id as string | null;
  let items: Record<string, unknown>[] = [];
  
  if (sourceRunId) {
    const itemsResult = await c.env.DB.prepare(
      "SELECT item_number, item_status, exception_type, exception_severity, source_ref, target_ref, field, source_value, target_value, difference, discrepancy_reason FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? AND item_status IN ('discrepancy', 'exception') ORDER BY item_number"
    ).bind(sourceRunId, tenantId).all();
    items = itemsResult.results || [];
  }
  
  // Build CSV
  const csvRows = [
    ['Risk Traceability Report'],
    ['Generated At', new Date().toISOString()],
    ['Risk ID', riskId],
    ['Risk Title', risk.title as string],
    ['Severity', risk.severity as string],
    ['Category', risk.category as string],
    ['Source Run ID', sourceRunId || 'N/A'],
    [],
    ['Item #', 'Status', 'Type', 'Severity', 'Source Ref', 'Target Ref', 'Field', 'Source Value', 'Target Value', 'Difference', 'Reason'],
  ];
  
  for (const item of items) {
    csvRows.push([
      String(item.item_number ?? ''),
      String(item.item_status ?? ''),
      String(item.exception_type || ''),
      String(item.exception_severity || ''),
      String(item.source_ref || ''),
      String(item.target_ref || ''),
      String(item.field || ''),
      String(item.source_value ?? ''),
      String(item.target_value ?? ''),
      String(item.difference || ''),
      String(item.discrepancy_reason || ''),
    ]);
  }
  
  const csvContent = csvRows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  
  c.header('Content-Type', 'text/csv');
  c.header('Content-Disposition', `attachment; filename="risk-${riskId}-traceability-${new Date().toISOString().split('T')[0]}.csv"`);
  
  return c.body(csvContent);
});

// GET /api/apex/insights — Executive cross-department performance drivers and issue detection
apex.get('/insights', async (c) => {
  const tenantId = getTenantId(c);

  try {
    const result = await generateApexInsights(c.env.DB, c.env.AI, tenantId);
    return c.json({
      executiveSummary: result.executiveSummary,
      performanceDrivers: result.performanceDrivers,
      issues: result.issues,
      crossDepartmentCorrelations: result.crossDepartmentCorrelations,
      strategicImplications: result.strategicImplications,
      generatedAt: new Date().toISOString(),
      poweredBy: 'Atheon Intelligence',
    });
  } catch (err) {
    console.error('Apex insights generation failed:', err);
    return c.json({
      executiveSummary: 'Executive insights temporarily unavailable.',
      performanceDrivers: [],
      issues: [],
      crossDepartmentCorrelations: [],
      strategicImplications: [],
      poweredBy: 'Atheon Intelligence',
    });
  }
});

// GET /api/apex/dashboard-intelligence — Unified intelligence summary for the main dashboard
apex.get('/dashboard-intelligence', async (c) => {
  const tenantId = getTenantId(c);

  try {
    const result = await generateDashboardIntelligence(c.env.DB, c.env.AI, tenantId);
    return c.json({
      summary: result.summary,
      keyMetrics: result.keyMetrics,
      topRisks: result.topRisks,
      recommendedActions: result.recommendedActions,
      generatedAt: new Date().toISOString(),
      poweredBy: 'Atheon Intelligence',
    });
  } catch (err) {
    console.error('Dashboard intelligence generation failed:', err);
    return c.json({
      summary: 'Intelligence summary temporarily unavailable.',
      keyMetrics: [],
      topRisks: [],
      recommendedActions: [],
      poweredBy: 'Atheon Intelligence',
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategic management — OKRs + Initiative Portfolio
// ═══
//
// OKRs:
//   GET    /api/v1/apex/okrs                 — list objectives + nested KRs
//   POST   /api/v1/apex/okrs                 — create objective
//   PATCH  /api/v1/apex/okrs/:id             — update objective
//   DELETE /api/v1/apex/okrs/:id             — delete objective (cascades KRs)
//   POST   /api/v1/apex/okrs/:id/key-results — add KR to objective
//   PATCH  /api/v1/apex/okrs/key-results/:krId
//   DELETE /api/v1/apex/okrs/key-results/:krId
//
// Portfolio (strategic initiatives + capital allocation rollup):
//   GET    /api/v1/apex/portfolio            — list + summary (rollup by BU)
//   POST   /api/v1/apex/portfolio            — create initiative
//   PATCH  /api/v1/apex/portfolio/:id        — update gate/status/actuals
//   DELETE /api/v1/apex/portfolio/:id
//
// Admin+ for mutations; any authenticated tenant user for reads.
// ─────────────────────────────────────────────────────────────────────────────

const OBJECTIVE_STATUSES = new Set(['on_track', 'at_risk', 'off_track', 'achieved']);
const KR_STATUSES = OBJECTIVE_STATUSES;
const INIT_GATES = new Set(['discovery', 'build', 'scale', 'done', 'killed']);
const INIT_STATUSES = new Set(['green', 'amber', 'red']);

function isAdminPlus(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'executive';
}

apex.get('/okrs', async (c) => {
  const tenantId = getTenantId(c);
  const quarter = c.req.query('quarter');
  const params: unknown[] = [tenantId];
  let where = 'tenant_id = ?';
  if (quarter) {
    where += ' AND quarter = ?';
    params.push(quarter);
  }
  const [objectives, keyResults] = await Promise.all([
    c.env.DB.prepare(
      `SELECT * FROM strategic_objectives WHERE ${where} ORDER BY priority = 'p1' DESC, status = 'off_track' DESC, status = 'at_risk' DESC, created_at DESC`
    ).bind(...params).all<Record<string, unknown>>(),
    c.env.DB.prepare(
      `SELECT kr.* FROM strategic_key_results kr WHERE kr.tenant_id = ? ORDER BY kr.created_at ASC`
    ).bind(tenantId).all<Record<string, unknown>>(),
  ]);

  const krsByObjective = new Map<string, Record<string, unknown>[]>();
  for (const kr of (keyResults.results || [])) {
    const oid = kr.objective_id as string;
    if (!krsByObjective.has(oid)) krsByObjective.set(oid, []);
    krsByObjective.get(oid)!.push(kr);
  }

  const items: Array<Record<string, unknown> & { key_results: Record<string, unknown>[] }> =
    (objectives.results || []).map((obj) => ({
      ...obj,
      key_results: krsByObjective.get(obj.id as string) || [],
    }));

  const summary = {
    total: items.length,
    on_track: items.filter((o) => (o.status as string) === 'on_track').length,
    at_risk: items.filter((o) => (o.status as string) === 'at_risk').length,
    off_track: items.filter((o) => (o.status as string) === 'off_track').length,
    achieved: items.filter((o) => (o.status as string) === 'achieved').length,
    avg_progress: items.length
      ? Math.round(items.reduce((s, o) => s + ((o.progress_pct as number) || 0), 0) / items.length)
      : 0,
  };
  return c.json({ objectives: items, summary });
});

apex.post('/okrs', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const quarter = typeof body.quarter === 'string' ? body.quarter.trim() : '';
  if (!title || !quarter) return c.json({ error: 'title and quarter required' }, 400);

  const status = typeof body.status === 'string' && OBJECTIVE_STATUSES.has(body.status) ? body.status : 'on_track';
  const priority = body.priority === 'p1' || body.priority === 'p2' ? body.priority : 'normal';

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO strategic_objectives (id, tenant_id, title, description, owner, status, priority, quarter, progress_pct)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, title,
    typeof body.description === 'string' ? body.description : null,
    typeof body.owner === 'string' ? body.owner : null,
    status, priority, quarter,
    typeof body.progress_pct === 'number' ? body.progress_pct : 0,
  ).run();
  return c.json({ id }, 201);
});

apex.patch('/okrs/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors: vErrors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || vErrors.length > 0) return c.json({ error: 'Invalid input', details: vErrors }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof body.title === 'string') { updates.push('title = ?'); params.push(body.title); }
  if (typeof body.description === 'string') { updates.push('description = ?'); params.push(body.description); }
  if (typeof body.owner === 'string') { updates.push('owner = ?'); params.push(body.owner); }
  if (typeof body.status === 'string' && OBJECTIVE_STATUSES.has(body.status)) { updates.push('status = ?'); params.push(body.status); }
  if (body.priority === 'p1' || body.priority === 'p2' || body.priority === 'normal') { updates.push('priority = ?'); params.push(body.priority); }
  if (typeof body.quarter === 'string') { updates.push('quarter = ?'); params.push(body.quarter); }
  if (typeof body.progress_pct === 'number') { updates.push('progress_pct = ?'); params.push(Math.max(0, Math.min(100, body.progress_pct))); }
  if (!updates.length) return c.json({ error: 'no fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  const res = await c.env.DB.prepare(
    `UPDATE strategic_objectives SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

apex.delete('/okrs/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM strategic_key_results WHERE objective_id = ? AND tenant_id = ?').bind(id, tenantId).run();
  const res = await c.env.DB.prepare('DELETE FROM strategic_objectives WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

apex.post('/okrs/:id/key-results', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const objectiveId = c.req.param('id');
  const { data: body, errors: vErrors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || vErrors.length > 0) return c.json({ error: 'Invalid input', details: vErrors }, 400);
  const description = typeof body.description === 'string' ? body.description.trim() : '';
  if (!description) return c.json({ error: 'description required' }, 400);

  // Verify objective belongs to tenant
  const obj = await c.env.DB.prepare('SELECT id FROM strategic_objectives WHERE id = ? AND tenant_id = ?').bind(objectiveId, tenantId).first();
  if (!obj) return c.json({ error: 'objective not found' }, 404);

  const status = typeof body.status === 'string' && KR_STATUSES.has(body.status) ? body.status : 'on_track';
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO strategic_key_results (id, tenant_id, objective_id, description, metric, target_value, current_value, unit, status, due_date)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, objectiveId, description,
    typeof body.metric === 'string' ? body.metric : null,
    typeof body.target_value === 'number' ? body.target_value : null,
    typeof body.current_value === 'number' ? body.current_value : null,
    typeof body.unit === 'string' ? body.unit : null,
    status,
    typeof body.due_date === 'string' ? body.due_date : null,
  ).run();
  return c.json({ id }, 201);
});

apex.patch('/okrs/key-results/:krId', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const krId = c.req.param('krId');
  const { data: body, errors: vErrors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || vErrors.length > 0) return c.json({ error: 'Invalid input', details: vErrors }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  if (typeof body.description === 'string') { updates.push('description = ?'); params.push(body.description); }
  if (typeof body.metric === 'string') { updates.push('metric = ?'); params.push(body.metric); }
  if (typeof body.target_value === 'number') { updates.push('target_value = ?'); params.push(body.target_value); }
  if (typeof body.current_value === 'number') { updates.push('current_value = ?'); params.push(body.current_value); }
  if (typeof body.unit === 'string') { updates.push('unit = ?'); params.push(body.unit); }
  if (typeof body.status === 'string' && KR_STATUSES.has(body.status)) { updates.push('status = ?'); params.push(body.status); }
  if (typeof body.due_date === 'string') { updates.push('due_date = ?'); params.push(body.due_date); }
  if (!updates.length) return c.json({ error: 'no fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(krId, tenantId);

  const res = await c.env.DB.prepare(
    `UPDATE strategic_key_results SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

apex.delete('/okrs/key-results/:krId', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const krId = c.req.param('krId');
  const res = await c.env.DB.prepare('DELETE FROM strategic_key_results WHERE id = ? AND tenant_id = ?').bind(krId, tenantId).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// ── Initiative Portfolio ─────────────────────────────────────────────────────

apex.get('/portfolio', async (c) => {
  const tenantId = getTenantId(c);
  const rows = await c.env.DB.prepare(
    `SELECT * FROM strategic_initiatives
     WHERE tenant_id = ?
     ORDER BY
       CASE status WHEN 'red' THEN 0 WHEN 'amber' THEN 1 ELSE 2 END,
       CASE gate WHEN 'killed' THEN 9 WHEN 'done' THEN 8 ELSE 0 END,
       created_at DESC`
  ).bind(tenantId).all<Record<string, unknown>>();
  const items = rows.results || [];

  // Capital allocation rollup by business unit (active initiatives only).
  const byBu = new Map<string, { unit: string; planned_value: number; actual_value: number; budget: number; spend_to_date: number; count: number }>();
  for (const it of items) {
    if (it.gate === 'killed') continue;
    const unit = (it.business_unit as string) || 'Unassigned';
    const slot = byBu.get(unit) || { unit, planned_value: 0, actual_value: 0, budget: 0, spend_to_date: 0, count: 0 };
    slot.planned_value += (it.planned_value_zar as number) || 0;
    slot.actual_value += (it.actual_value_zar as number) || 0;
    slot.budget += (it.budget_zar as number) || 0;
    slot.spend_to_date += (it.spend_to_date_zar as number) || 0;
    slot.count += 1;
    byBu.set(unit, slot);
  }

  const summary = {
    total: items.length,
    active: items.filter((i) => i.gate !== 'killed' && i.gate !== 'done').length,
    green: items.filter((i) => i.status === 'green').length,
    amber: items.filter((i) => i.status === 'amber').length,
    red: items.filter((i) => i.status === 'red').length,
    total_planned_value: items.reduce((s, i) => s + ((i.planned_value_zar as number) || 0), 0),
    total_actual_value: items.reduce((s, i) => s + ((i.actual_value_zar as number) || 0), 0),
    total_budget: items.reduce((s, i) => s + ((i.budget_zar as number) || 0), 0),
    total_spend_to_date: items.reduce((s, i) => s + ((i.spend_to_date_zar as number) || 0), 0),
    capital_allocation: Array.from(byBu.values()).sort((a, b) => b.budget - a.budget),
  };
  return c.json({ initiatives: items, summary });
});

apex.post('/portfolio', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const { data: body, errors: vErrors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || vErrors.length > 0) return c.json({ error: 'Invalid input', details: vErrors }, 400);
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return c.json({ error: 'name required' }, 400);

  const gate = typeof body.gate === 'string' && INIT_GATES.has(body.gate) ? body.gate : 'discovery';
  const status = typeof body.status === 'string' && INIT_STATUSES.has(body.status) ? body.status : 'green';

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO strategic_initiatives
       (id, tenant_id, name, description, sponsor, owner, gate, status,
        planned_value_zar, actual_value_zar, spend_to_date_zar, budget_zar,
        start_date, target_completion_date, business_unit, linked_objective_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, name,
    typeof body.description === 'string' ? body.description : null,
    typeof body.sponsor === 'string' ? body.sponsor : null,
    typeof body.owner === 'string' ? body.owner : null,
    gate, status,
    typeof body.planned_value_zar === 'number' ? body.planned_value_zar : 0,
    typeof body.actual_value_zar === 'number' ? body.actual_value_zar : 0,
    typeof body.spend_to_date_zar === 'number' ? body.spend_to_date_zar : 0,
    typeof body.budget_zar === 'number' ? body.budget_zar : 0,
    typeof body.start_date === 'string' ? body.start_date : null,
    typeof body.target_completion_date === 'string' ? body.target_completion_date : null,
    typeof body.business_unit === 'string' ? body.business_unit : null,
    typeof body.linked_objective_id === 'string' ? body.linked_objective_id : null,
  ).run();
  return c.json({ id }, 201);
});

apex.patch('/portfolio/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors: vErrors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || vErrors.length > 0) return c.json({ error: 'Invalid input', details: vErrors }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  const stringFields = ['name', 'description', 'sponsor', 'owner', 'start_date', 'target_completion_date', 'business_unit', 'linked_objective_id'];
  for (const f of stringFields) {
    if (typeof body[f] === 'string') { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  if (typeof body.gate === 'string' && INIT_GATES.has(body.gate)) { updates.push('gate = ?'); params.push(body.gate); }
  if (typeof body.status === 'string' && INIT_STATUSES.has(body.status)) { updates.push('status = ?'); params.push(body.status); }
  const numFields = ['planned_value_zar', 'actual_value_zar', 'spend_to_date_zar', 'budget_zar'];
  for (const f of numFields) {
    if (typeof body[f] === 'number') { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  if (!updates.length) return c.json({ error: 'no fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(id, tenantId);

  const res = await c.env.DB.prepare(
    `UPDATE strategic_initiatives SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

apex.delete('/portfolio/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const res = await c.env.DB.prepare('DELETE FROM strategic_initiatives WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

export default apex;
