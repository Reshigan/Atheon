import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { generatePulseInsights } from '../services/insights-engine';

const pulse = new Hono<AppBindings>();

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

/**
 * Check if a role has admin-level privileges (superadmin, support_admin, admin, or system_admin).
 */
function isAdminRole(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'system_admin';
}

// M2: Helper to parse pagination params
function getPagination(c: { req: { query: (k: string) => string | undefined } }): { limit: number; offset: number } {
  const limit = Math.min(Math.max(parseInt(c.req.query('limit') || '100', 10) || 100, 1), 500);
  const offset = Math.max(parseInt(c.req.query('offset') || '0', 10) || 0, 0);
  return { limit, offset };
}

// GET /api/pulse/metrics — GAP 1: Department/domain filtering support
pulse.get('/metrics', async (c) => {
  const tenantId = getTenantId(c);
  const { limit, offset } = getPagination(c);
  const domain = c.req.query('domain'); // GAP 1: filter by department/domain
  const category = c.req.query('category'); // Filter by KPI category
  const status = c.req.query('status'); // Filter by status (green/amber/red)

  let query = 'SELECT * FROM process_metrics WHERE tenant_id = ?';
  let countQuery = 'SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];
  const countBinds: unknown[] = [tenantId];

  if (domain) {
    query += ' AND domain = ?';
    countQuery += ' AND domain = ?';
    binds.push(domain);
    countBinds.push(domain);
  }
  if (category) {
    query += ' AND category = ?';
    countQuery += ' AND category = ?';
    binds.push(category);
    countBinds.push(category);
  }
  if (status) {
    query += ' AND status = ?';
    countQuery += ' AND status = ?';
    binds.push(status);
    countBinds.push(status);
  }

  query += ' ORDER BY name ASC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();
  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first<{ count: number }>();

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
    // Source attribution & traceability
    subCatalystName: m.sub_catalyst_name || null,
    sourceRunId: m.source_run_id || null,
    clusterId: m.cluster_id || null,
    domain: m.domain || null,
    category: m.category || null,
  }));

  return c.json({ metrics: formatted, total: countResult?.count || formatted.length, limit, offset });
});

// GET /api/pulse/insights — AI-powered operational insights per department
pulse.get('/insights', async (c) => {
  const tenantId = getTenantId(c);
  const domain = c.req.query('domain');

  try {
    const result = await generatePulseInsights(c.env.DB, c.env.AI, tenantId, domain || undefined);
    return c.json({
      insights: result.insights,
      recommendations: result.recommendations,
      drivers: result.drivers,
      domain: domain || 'all',
      generatedAt: new Date().toISOString(),
      // Attribution: "Atheon Intelligence" — never expose LLM identity
      poweredBy: 'Atheon Intelligence',
    });
  } catch (err) {
    console.error('Pulse insights generation failed:', err);
    return c.json({ insights: 'Insights temporarily unavailable.', recommendations: [], drivers: [], domain: domain || 'all', poweredBy: 'Atheon Intelligence' });
  }
});

// GET /api/pulse/domains — List available domains for department filtering
// OPTIMIZED: Single UNION query instead of 2 separate queries
pulse.get('/domains', async (c) => {
  const tenantId = getTenantId(c);
  const result = await c.env.DB.prepare(
    `SELECT DISTINCT domain FROM (
       SELECT domain FROM process_metrics WHERE tenant_id = ? AND domain IS NOT NULL
       UNION
       SELECT domain FROM catalyst_clusters WHERE tenant_id = ? AND domain IS NOT NULL
     ) ORDER BY domain`
  ).bind(tenantId, tenantId).all<Record<string, unknown>>();

  const domains = (result.results || []).map(r => r.domain as string).filter(Boolean);

  return c.json({
    domains,
    total: domains.length,
  });
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
  const limit = parseInt(c.req.query('limit') || '50');
  const severity = c.req.query('severity');

  const query = `
    SELECT a.*, pm.name as metric_name, pm.value as current_value
    FROM anomalies a
    LEFT JOIN process_metrics pm ON a.metric = pm.id
    WHERE a.tenant_id = ?
    ${severity ? 'AND a.severity = ?' : ''}
    ORDER BY a.detected_at DESC
    LIMIT ?
  `;

  const results = await c.env.DB.prepare(query)
    .bind(tenantId, ...(severity ? [severity] : []), limit)
    .all<Record<string, unknown>>();

  return c.json({
    anomalies: (results.results || []).map((a: Record<string, unknown>) => ({
      id: a.id,
      metric: a.metric,
      metricName: a.metric_name,
      currentValue: a.current_value,
      deviation: a.deviation,
      severity: a.severity,
      description: a.description,
      status: a.status,
      detectedAt: a.detected_at,
    })),
    total: results.results?.length || 0,
  });
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
    // P3: Updated correlation response — support both old schema (source_system/source_event) and new (metric_a/metric_b)
    metricA: ce.metric_a || ce.source_system,
    metricB: ce.metric_b || ce.target_system,
    sourceSystem: ce.source_system,
    sourceEvent: ce.source_event,
    targetSystem: ce.target_system,
    targetImpact: ce.target_impact,
    correlationType: ce.correlation_type || 'temporal',
    confidence: ce.confidence,
    lagHours: ce.lag_hours,
    lagDays: ce.lag_days,
    description: ce.description,
    detectedAt: ce.detected_at,
    sourceRunId: ce.source_run_id || null,
    clusterId: ce.cluster_id || null,
  }));

  return c.json({ correlations: formatted, total: formatted.length, limit: formatted.length, offset: 0 });
});

// POST /api/pulse/refresh — On-demand process mining refresh from catalyst runs
pulse.post('/refresh', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'No tenant context' }, 400);

  // Count catalyst actions for this tenant
  const actionCount = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?'
  ).bind(tenantId).first<{ count: number }>();

  if (!actionCount || actionCount.count === 0) {
    return c.json({ refreshed: false, message: 'No catalyst runs found. Run a catalyst first to generate process mining data.' });
  }

  // Group catalyst actions by catalyst_name to build process flows
  const actions = await c.env.DB.prepare(
    'SELECT catalyst_name, status, confidence, input_data, output_data, created_at, completed_at FROM catalyst_actions WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const catalystGroups: Record<string, Array<Record<string, unknown>>> = {};
  for (const a of actions.results) {
    const row = a as Record<string, unknown>;
    const name = row.catalyst_name as string;
    if (!catalystGroups[name]) catalystGroups[name] = [];
    catalystGroups[name].push(row);
  }

  // Lookup so newly written metrics carry their cluster + sub-catalyst linkage —
  // without this the Pulse drilldown can't surface the matching sub-catalyst panel.
  const subCatalystToCluster = new Map<string, string>();
  const scRows = await c.env.DB.prepare(
    'SELECT cluster_id, sub_catalyst_name FROM sub_catalyst_kpis WHERE tenant_id = ?'
  ).bind(tenantId).all();
  for (const row of scRows.results) {
    const r = row as Record<string, unknown>;
    subCatalystToCluster.set(r.sub_catalyst_name as string, r.cluster_id as string);
  }

  let flowsCreated = 0;
  let metricsCreated = 0;

  for (const [catalystName, runs] of Object.entries(catalystGroups)) {
    const flowId = `pf-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const completed = runs.filter(r => r.status === 'completed');
    const exceptions = runs.filter(r => r.status === 'exception');
    const pending = runs.filter(r => r.status === 'pending');
    const total = runs.length;
    const conformanceRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    const uniqueActions = new Set(runs.map(r => r.status as string));

    // Avg duration
    let avgDuration = 0;
    const durationsMs: number[] = [];
    for (const r of completed) {
      if (r.completed_at && r.created_at) {
        const diff = new Date(r.completed_at as string).getTime() - new Date(r.created_at as string).getTime();
        if (diff > 0) durationsMs.push(diff);
      }
    }
    if (durationsMs.length > 0) {
      avgDuration = Math.round(durationsMs.reduce((s, d) => s + d, 0) / durationsMs.length / 1000);
    }

    // Bottlenecks from exceptions
    const bottlenecks: string[] = [];
    for (const r of exceptions.slice(0, 5)) {
      try {
        const output = JSON.parse(r.output_data as string || '{}');
        if (output.exception_type) {
          bottlenecks.push(`${output.exception_type}: ${output.exception_detail || 'Requires review'}`);
        }
      } catch { /* skip */ }
    }
    if (exceptions.length > 0 && bottlenecks.length === 0) {
      bottlenecks.push(`${exceptions.length} action(s) escalated for human review`);
    }

    // Per-step richness — keeps the Pulse Process Mining UI populated rather
    // than rendering "<missing>" for every step pill. Mirrors the heuristic
    // in services/scheduled.ts refreshProcessMining(); kept in sync manually
    // since the two paths populate the same table.
    const tp = (count: number) => Math.max(count, 0) > 0 ? Math.max(1, Math.round(count / 30)) : 0;
    const sd = (share: number) => avgDuration > 0
      ? Math.round((avgDuration * share) / 86400 * 10) / 10 : 0;
    const stepDef = [
      { name: 'Received',  count: total,            share: 0.05, status: 'healthy' as const },
      { name: 'Processing', count: pending.length,  share: 0.65,
        status: (pending.length >= total * 0.4 ? 'bottleneck' : 'healthy') as 'healthy' | 'degraded' | 'bottleneck' },
      { name: 'Completed', count: completed.length, share: 0.25, status: 'healthy' as const },
      { name: 'Escalated', count: exceptions.length, share: 0.05,
        status: (exceptions.length >= 3 ? 'degraded' : 'healthy') as 'healthy' | 'degraded' | 'bottleneck' },
    ];
    const steps = JSON.stringify(stepDef.map((s, i) => ({
      id: `step-${flowId}-${i}`,
      name: s.name,
      count: s.count,
      avgDuration: sd(s.share),
      throughput: tp(s.count),
      status: s.status,
    })));

    await c.env.DB.prepare(
      `INSERT INTO process_flows (id, tenant_id, name, steps, variants, avg_duration, conformance_rate, bottlenecks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET steps = excluded.steps, variants = excluded.variants,
         avg_duration = excluded.avg_duration, conformance_rate = excluded.conformance_rate,
         bottlenecks = excluded.bottlenecks`
    ).bind(flowId, tenantId, catalystName, steps, uniqueActions.size, avgDuration, conformanceRate, JSON.stringify(bottlenecks)).run();
    flowsCreated++;

    // Success rate metric
    const metricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const successRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    let metricStatus = 'green';
    if (successRate < 60) metricStatus = 'red';
    else if (successRate < 80) metricStatus = 'amber';

    const linkedClusterId = subCatalystToCluster.get(catalystName) ?? null;
    const linkedSubCatalyst = linkedClusterId ? catalystName : null;

    await c.env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, cluster_id, sub_catalyst_name, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 80, 80, 60, '[]', 'catalyst-engine', ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status,
         cluster_id = excluded.cluster_id, sub_catalyst_name = excluded.sub_catalyst_name,
         measured_at = excluded.measured_at`
    ).bind(metricId, tenantId, `${catalystName} Success Rate`, successRate, metricStatus, linkedClusterId, linkedSubCatalyst).run();
    metricsCreated++;

    // Exception rate metric
    const excMetricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-exc`;
    const exceptionRate = total > 0 ? Math.round((exceptions.length / total) * 100) : 0;
    let excStatus = 'green';
    if (exceptionRate > 40) excStatus = 'red';
    else if (exceptionRate > 20) excStatus = 'amber';

    await c.env.DB.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, cluster_id, sub_catalyst_name, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 20, 20, 40, '[]', 'catalyst-engine', ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status,
         cluster_id = excluded.cluster_id, sub_catalyst_name = excluded.sub_catalyst_name,
         measured_at = excluded.measured_at`
    ).bind(excMetricId, tenantId, `${catalystName} Exception Rate`, exceptionRate, excStatus, linkedClusterId, linkedSubCatalyst).run();
    metricsCreated++;
  }

  return c.json({ refreshed: true, processFlows: flowsCreated, metricsGenerated: metricsCreated, catalystActions: actionCount.count });
});

// GET /api/pulse/catalyst-runs — Transaction-level reporting for catalyst runs
pulse.get('/catalyst-runs', async (c) => {
  const tenantId = getTenantId(c);
  const { limit, offset } = getPagination(c);
  const catalystFilter = c.req.query('catalyst');

  let query = 'SELECT id, cluster_id, catalyst_name, action, status, confidence, input_data, output_data, reasoning, approved_by, created_at, completed_at FROM catalyst_actions WHERE tenant_id = ?';
  const binds: unknown[] = [tenantId];

  if (catalystFilter) {
    query += ' AND catalyst_name = ?';
    binds.push(catalystFilter);
  }
  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  binds.push(limit, offset);

  const results = await c.env.DB.prepare(query).bind(...binds).all();

  // Get total count
  let countQuery = 'SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ?';
  const countBinds: unknown[] = [tenantId];
  if (catalystFilter) {
    countQuery += ' AND catalyst_name = ?';
    countBinds.push(catalystFilter);
  }
  const countResult = await c.env.DB.prepare(countQuery).bind(...countBinds).first<{ count: number }>();

  // Get summary stats per catalyst
  const summaryQuery = await c.env.DB.prepare(
    `SELECT catalyst_name,
       COUNT(*) as total_runs,
       SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
       SUM(CASE WHEN status = 'exception' THEN 1 ELSE 0 END) as exceptions,
       SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
       AVG(confidence) as avg_confidence
     FROM catalyst_actions WHERE tenant_id = ? GROUP BY catalyst_name ORDER BY total_runs DESC`
  ).bind(tenantId).all();

  const runs = results.results.map((r: Record<string, unknown>) => {
    let inputData = null;
    let outputData = null;
    try { inputData = JSON.parse(r.input_data as string || 'null'); } catch { /* skip */ }
    try { outputData = JSON.parse(r.output_data as string || 'null'); } catch { /* skip */ }

    return {
      id: r.id,
      clusterId: r.cluster_id,
      catalystName: r.catalyst_name,
      action: r.action,
      status: r.status,
      confidence: r.confidence,
      inputData,
      outputData,
      reasoning: r.reasoning,
      approvedBy: r.approved_by,
      createdAt: r.created_at,
      completedAt: r.completed_at,
      needsHumanReview: r.status === 'exception' || r.status === 'pending',
    };
  });

  const summary = summaryQuery.results.map((s: Record<string, unknown>) => ({
    catalystName: s.catalyst_name,
    totalRuns: s.total_runs,
    completed: s.completed,
    exceptions: s.exceptions,
    pending: s.pending,
    avgConfidence: Math.round((s.avg_confidence as number || 0) * 100) / 100,
    successRate: (s.total_runs as number) > 0
      ? Math.round(((s.completed as number) / (s.total_runs as number)) * 100)
      : 0,
  }));

  return c.json({
    runs,
    summary,
    total: countResult?.count || runs.length,
    limit,
    offset,
  });
});

// P2-2: POST /api/pulse/backfill-trends — backfill trend arrays from sub_catalyst_kpi_values
pulse.post('/backfill-trends', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'Tenant required' }, 400);

  // Get all metrics for tenant
  const metrics = await c.env.DB.prepare(
    'SELECT id, name, trend FROM process_metrics WHERE tenant_id = ?'
  ).bind(tenantId).all();

  let updated = 0;
  for (const m of metrics.results) {
    const metricName = m.name as string;
    const existingTrend: number[] = (() => { try { return JSON.parse(m.trend as string || '[]'); } catch { return []; } })();
    if (existingTrend.length >= 30) continue; // Already full

    // Find matching KPI values by name pattern
    const kpiValues = await c.env.DB.prepare(
      `SELECT kv.numeric_value FROM sub_catalyst_kpi_values kv
       JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
       WHERE kd.tenant_id = ? AND kd.kpi_name LIKE ?
       ORDER BY kv.recorded_at ASC LIMIT 30`
    ).bind(tenantId, `%${metricName}%`).all();

    if (kpiValues.results.length > 0) {
      const values = kpiValues.results.map(v => v.numeric_value as number).filter(v => v != null);
      if (values.length > 0) {
        // Merge: existing + new, cap at 30
        const merged = [...existingTrend, ...values].slice(-30);
        await c.env.DB.prepare(
          'UPDATE process_metrics SET trend = ? WHERE id = ?'
        ).bind(JSON.stringify(merged), m.id as string).run();
        updated++;
      }
    }
  }

  return c.json({ backfilled: updated, totalMetrics: metrics.results.length });
});

// GET /api/pulse/history — month-aggregated history for the top-2 process metrics.
//
// Dashboard's "Metrics Over Time" chart and the MoM-change bar chart both consume
// this. Without it, both charts render empty (we removed the synthesized data on
// Phase 7-8 and never wired the real source). The endpoint shapes the response
// to match Recharts' expected `{month, value, secondary}` rows so the dashboard
// can drop the result straight into its data props.
//
// Tenant-scoped; no role gate beyond the standard tenantIsolation middleware.
pulse.get('/history', async (c) => {
  const tenantId = getTenantId(c);
  const months = Math.min(Math.max(parseInt(c.req.query('months') || '6', 10) || 6, 1), 24);

  // Identify the top-2 metrics by id ordering (matches what Dashboard.tsx picks).
  const top = await c.env.DB.prepare(
    `SELECT id, name FROM process_metrics WHERE tenant_id = ? ORDER BY name ASC LIMIT 2`
  ).bind(tenantId).all<{ id: string; name: string }>();
  const rows = top.results || [];
  if (rows.length === 0) {
    return c.json({ series: [], mom_changes: [], primary_label: null, secondary_label: null });
  }
  const primaryId = rows[0].id;
  const secondaryId = rows[1]?.id;

  // SQLite strftime bucketing — '%Y-%m' gives an orderable month key
  const since = `datetime('now', '-${months} months')`;
  const primaryHistory = await c.env.DB.prepare(
    `SELECT strftime('%Y-%m', recorded_at) AS bucket, AVG(value) AS avg_value
       FROM process_metric_history
      WHERE tenant_id = ? AND metric_id = ? AND recorded_at >= ${since}
      GROUP BY bucket ORDER BY bucket ASC`
  ).bind(tenantId, primaryId).all<{ bucket: string; avg_value: number }>();

  const secondaryHistory = secondaryId
    ? await c.env.DB.prepare(
        `SELECT strftime('%Y-%m', recorded_at) AS bucket, AVG(value) AS avg_value
           FROM process_metric_history
          WHERE tenant_id = ? AND metric_id = ? AND recorded_at >= ${since}
          GROUP BY bucket ORDER BY bucket ASC`
      ).bind(tenantId, secondaryId).all<{ bucket: string; avg_value: number }>()
    : { results: [] as { bucket: string; avg_value: number }[] };

  // Merge into one series, indexed by the primary's bucket list (we drop
  // secondary-only buckets — they'd render as gaps in the area chart).
  const secByBucket = new Map(
    (secondaryHistory.results || []).map((r) => [r.bucket, r.avg_value])
  );
  const formatMonth = (bucket: string): string => {
    // 2026-05 → "May 26"
    const [y, m] = bucket.split('-');
    const date = new Date(Number(y), Number(m) - 1, 1);
    return date.toLocaleString('en-US', { month: 'short', year: '2-digit' });
  };
  const series = (primaryHistory.results || []).map((r) => ({
    month: formatMonth(r.bucket),
    value: Number(r.avg_value.toFixed(2)),
    secondary: secByBucket.has(r.bucket) ? Number((secByBucket.get(r.bucket) as number).toFixed(2)) : null,
  }));

  // Month-over-month % change on the primary. First entry has no prior, skip it.
  const momChanges: { month: string; change: number }[] = [];
  for (let i = 1; i < series.length; i++) {
    const prev = series[i - 1].value;
    const cur = series[i].value;
    const change = prev !== 0 ? Number((((cur - prev) / prev) * 100).toFixed(1)) : 0;
    momChanges.push({ month: series[i].month, change });
  }

  return c.json({
    series,
    mom_changes: momChanges,
    primary_label: rows[0].name,
    secondary_label: rows[1]?.name ?? null,
  });
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

// P1-4: GET /api/pulse/metrics/:metricId/trace — Trace a metric back to its source sub-cataulyst runs
pulse.get('/metrics/:metricId/trace', async (c) => {
  const tenantId = getTenantId(c);
  const metricId = c.req.param('metricId');
  
  // Try cache first (5 minute TTL)
  const cacheKey = `trace:metric:${tenantId}:${metricId}`;
  try {
    const cached = await c.env.CACHE.get(cacheKey);
    if (cached) {
      const cachedData = JSON.parse(cached);
      // Add cache hit header
      c.header('X-Cache', 'HIT');
      return c.json(cachedData);
    }
  } catch (err) {
    console.error('Cache read failed:', err);
    // Continue without cache
  }
  
  // Get the metric
  const metric = await c.env.DB.prepare(
    'SELECT * FROM process_metrics WHERE id = ? AND tenant_id = ?'
  ).bind(metricId, tenantId).first<Record<string, unknown>>();
  
  if (!metric) {
    return c.json({ 
      error: 'Metric not found',
      metricId,
      suggestion: 'Verify the metric ID or navigate to the Metrics page to select a valid metric',
      quickActions: [
        { label: 'View All Metrics', href: '/pulse#metrics' }
      ]
    }, 404);
  }
  
  // Get source attribution
  const subCataulystName = metric.sub_catalyst_name as string | null;
  const sourceRunId = metric.source_run_id as string | null;
  const clusterId = metric.cluster_id as string | null;
  
  // Get the source run if available
  let sourceRun: Record<string, unknown> | null = null;
  if (sourceRunId) {
    sourceRun = await c.env.DB.prepare(
      'SELECT id, cluster_id, sub_catalyst_name, status, matched, discrepancies, exceptions_raised, total_source_value, started_at, completed_at FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
    ).bind(sourceRunId, tenantId).first();
  }
  
  // Get cluster info
  let clusterInfo: Record<string, unknown> | null = null;
  if (clusterId) {
    clusterInfo = await c.env.DB.prepare(
      'SELECT id, name, domain, sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
    ).bind(clusterId, tenantId).first();
  }
  
  // Get KPIs that contributed to this metric
  let contributingKpis: Record<string, unknown>[] = [];
  if (subCataulystName && clusterId) {
    const kpis = await c.env.DB.prepare(
      'SELECT kd.kpi_name, kd.category, kv.value, kv.status, kv.measured_at FROM sub_catalyst_kpi_values kv JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id WHERE kd.tenant_id = ? AND kd.cluster_id = ? AND kd.sub_catalyst_name = ? ORDER BY kv.measured_at DESC LIMIT 20'
    ).bind(tenantId, clusterId, subCataulystName).all();
    contributingKpis = kpis.results || [];
  }
  
  // Get related anomalies
  let relatedAnomalies: Record<string, unknown>[] = [];
  const anomalies = await c.env.DB.prepare(
    'SELECT * FROM anomalies WHERE tenant_id = ? AND metric = ? ORDER BY detected_at DESC LIMIT 10'
  ).bind(tenantId, metric.name as string).all();
  relatedAnomalies = anomalies.results || [];
  
  // Build traceability chain
  const traceChain = {
    metric: {
      id: metric.id,
      name: metric.name,
      value: metric.value,
      status: metric.status,
      unit: metric.unit,
      measuredAt: metric.measured_at,
      trend: JSON.parse(metric.trend as string || '[]'),
    },
    sourceAttribution: {
      subCataulystName,
      sourceRunId,
      clusterId,
      sourceSystem: metric.source_system,
    },
    sourceRun: sourceRun ? {
      runId: sourceRun.id,
      subCataulystName: sourceRun.sub_catalyst_name,
      status: sourceRun.status,
      matched: sourceRun.matched,
      discrepancies: sourceRun.discrepancies,
      exceptions: sourceRun.exceptions_raised,
      totalValue: sourceRun.total_source_value,
      startedAt: sourceRun.started_at,
      completedAt: sourceRun.completed_at,
    } : null,
    cluster: clusterInfo ? {
      clusterId: clusterInfo.id,
      clusterName: clusterInfo.name,
      domain: clusterInfo.domain,
      subCataulysts: JSON.parse(clusterInfo.sub_catalysts as string || '[]'),
    } : null,
    contributingKpis: contributingKpis.map(k => ({
      kpiName: k.kpi_name,
      category: k.category,
      value: k.value,
      status: k.status,
      measuredAt: k.measured_at,
    })),
    relatedAnomalies: relatedAnomalies.map(a => ({
      anomalyId: a.id,
      severity: a.severity,
      expectedValue: a.expected_value,
      actualValue: a.actual_value,
      deviation: a.deviation,
      detectedAt: a.detected_at,
    })),
    drillDownPath: {
      metric: metricId,
      run: sourceRunId || 'N/A',
      items: sourceRunId ? `GET /api/cataulysts/runs/${sourceRunId}/items` : 'N/A',
      kpis: subCataulystName && clusterId ? `GET /api/cataulysts/clusters/${clusterId}/sub-cataulysts/${encodeURIComponent(subCataulystName)}/kpi-definitions` : 'N/A',
    },
  };
  
  // Cache the result (5 minute TTL)
  try {
    await c.env.CACHE.put(cacheKey, JSON.stringify(traceChain), { expirationTtl: 300 });
    c.header('X-Cache', 'MISS');
  } catch (err) {
    console.error('Cache write failed:', err);
    // Non-fatal, continue without caching
  }
  
  return c.json(traceChain);
});

// P1-5: POST /api/pulse/anomalies/detect — ML-powered anomaly detection
pulse.post('/anomalies/detect', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  const body = await c.req.json<{ metric_id?: string; sensitivity?: 'low' | 'medium' | 'high' }>();
  const metricId = body.metric_id;
  const sensitivity = body.sensitivity || 'medium';

  // Sensitivity multipliers for Z-score threshold
  const thresholds = { low: 3.0, medium: 2.5, high: 2.0 };
  const zThreshold = thresholds[sensitivity];

  // Get historical metric data (last 90 days)
  const historicalData = await c.env.DB.prepare(
    `SELECT value, recorded_at
     FROM process_metric_history
     WHERE tenant_id = ? AND metric_id = ? AND recorded_at >= datetime('now', '-90 days')
     ORDER BY recorded_at ASC`
  ).bind(tenantId, metricId || '').all<{ value: number; recorded_at: string }>();

  const values = (historicalData.results || []).map(d => d.value);
  
  if (values.length < 30) {
    return c.json({ error: 'Insufficient historical data. Need at least 30 data points.', detected: [] }, 400);
  }

  // Calculate statistics
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const stdDev = Math.sqrt(variance);

  // Get current metrics
  const currentMetrics = await c.env.DB.prepare(
    `SELECT id, name, value, recorded_at
     FROM process_metrics
     WHERE tenant_id = ? ${metricId ? 'AND id = ?' : ''}
     ORDER BY recorded_at DESC
     LIMIT 100`
  ).bind(tenantId, ...(metricId ? [metricId] : [])).all<Record<string, unknown>>();

  // Detect anomalies using Z-score
  const anomalies = (currentMetrics.results || []).map((m: Record<string, unknown>) => {
    const val = Number(m.value);
    const zScore = Math.abs((val - mean) / stdDev);
    const deviation = ((val - mean) / mean) * 100;
    
    if (zScore > zThreshold) {
      return {
        metric_id: m.id,
        metric_name: m.name,
        current_value: m.value,
        expected_mean: mean,
        std_deviation: stdDev,
        z_score: zScore,
        deviation_percent: deviation,
        severity: zScore > 3.5 ? 'critical' : zScore > 3.0 ? 'high' : 'medium',
        description: `Value ${m.value} deviates ${deviation.toFixed(1)}% from historical mean ${mean.toFixed(2)}`,
      };
    }
    return null;
  }).filter(Boolean);

  // Save detected anomalies
  for (const anomaly of anomalies) {
    if (!anomaly) continue;
    await c.env.DB.prepare(
      `INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), tenantId,
      String(anomaly.metric_id), anomaly.severity,
      anomaly.expected_mean, Number(anomaly.current_value),
      anomaly.deviation_percent, anomaly.description,
      'open', new Date().toISOString()
    ).run();
  }

  return c.json({
    success: true,
    statistics: {
      mean,
      stdDev,
      dataPoints: values.length,
      period: '90 days',
    },
    detected: anomalies,
    count: anomalies.length,
  });
});

// ---------------------------------------------------------------------------
// SLA Adherence (Wave 4 - Pulse depth)
// ---------------------------------------------------------------------------

type SLADefRow = {
  id: string;
  process_key: string;
  process_name: string;
  domain: string;
  target_hours: number;
  threshold_pct: number;
  owner: string | null;
  description: string | null;
  active: number;
  updated_at: string;
};

type SLAMeasurementRow = {
  measured_at: string;
  total_items: number;
  met_count: number;
  breached_count: number;
  avg_hours: number;
  p95_hours: number | null;
  adherence_pct: number;
};

function statusForSla(adherencePct: number | null, threshold: number): 'green' | 'amber' | 'red' {
  if (adherencePct === null) return 'amber';
  if (adherencePct >= threshold) return 'green';
  if (adherencePct >= threshold - 10) return 'amber';
  return 'red';
}

// GET /api/pulse/sla — list SLA definitions with latest measurement + 30d trend
pulse.get('/sla', async (c) => {
  const tenantId = getTenantId(c);
  const defs = await c.env.DB.prepare(
    'SELECT id, process_key, process_name, domain, target_hours, threshold_pct, owner, description, active, updated_at FROM pulse_sla_definitions WHERE tenant_id = ? AND active = 1 ORDER BY domain, process_name'
  ).bind(tenantId).all<SLADefRow>();

  const items = [] as Array<Record<string, unknown>>;
  let breachedCount = 0;
  let totalCount = 0;
  let totalAdherenceSum = 0;
  let totalAdherenceN = 0;

  for (const d of defs.results) {
    const recent = await c.env.DB.prepare(
      'SELECT measured_at, total_items, met_count, breached_count, avg_hours, p95_hours, adherence_pct FROM pulse_sla_measurements WHERE tenant_id = ? AND sla_id = ? ORDER BY measured_at DESC LIMIT 30'
    ).bind(tenantId, d.id).all<SLAMeasurementRow>();

    const trend = recent.results.slice().reverse();
    const latest = recent.results[0] || null;
    const status = statusForSla(latest?.adherence_pct ?? null, d.threshold_pct);
    if (status === 'red') breachedCount += 1;
    totalCount += 1;
    if (latest) {
      totalAdherenceSum += latest.adherence_pct;
      totalAdherenceN += 1;
    }

    items.push({
      id: d.id,
      processKey: d.process_key,
      processName: d.process_name,
      domain: d.domain,
      targetHours: d.target_hours,
      thresholdPct: d.threshold_pct,
      owner: d.owner,
      description: d.description,
      latest: latest ? {
        measuredAt: latest.measured_at,
        totalItems: latest.total_items,
        metCount: latest.met_count,
        breachedCount: latest.breached_count,
        avgHours: latest.avg_hours,
        p95Hours: latest.p95_hours,
        adherencePct: latest.adherence_pct,
      } : null,
      status,
      trend: trend.map((m) => ({
        measuredAt: m.measured_at,
        adherencePct: m.adherence_pct,
        avgHours: m.avg_hours,
      })),
    });
  }

  return c.json({
    items,
    summary: {
      totalSlas: totalCount,
      breachingSlas: breachedCount,
      avgAdherencePct: totalAdherenceN > 0 ? +(totalAdherenceSum / totalAdherenceN).toFixed(1) : 0,
    },
  });
});

// POST /api/pulse/sla — upsert SLA definition (admin+)
pulse.post('/sla', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isAdminRole(auth?.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    processKey: string;
    processName: string;
    domain?: string;
    targetHours: number;
    thresholdPct?: number;
    owner?: string;
    description?: string;
  }>(c, [
    { field: 'processKey', type: 'string', required: true, maxLength: 100 },
    { field: 'processName', type: 'string', required: true, maxLength: 200 },
    { field: 'targetHours', type: 'number', required: true, min: 0 },
  ]);
  if (errors.length || !body) return c.json({ error: 'Invalid payload', details: errors }, 400);

  const existing = await c.env.DB.prepare(
    'SELECT id FROM pulse_sla_definitions WHERE tenant_id = ? AND process_key = ?'
  ).bind(tenantId, body.processKey).first<{ id: string }>();

  const now = new Date().toISOString();
  if (existing) {
    await c.env.DB.prepare(
      `UPDATE pulse_sla_definitions SET process_name = ?, domain = ?, target_hours = ?, threshold_pct = ?, owner = ?, description = ?, updated_at = ? WHERE id = ?`
    ).bind(
      body.processName,
      body.domain || 'general',
      body.targetHours,
      body.thresholdPct ?? 95,
      body.owner ?? null,
      body.description ?? null,
      now,
      existing.id,
    ).run();
    return c.json({ id: existing.id, updated: true });
  }

  const id = `sla_${tenantId.slice(0, 6)}_${Date.now()}`;
  await c.env.DB.prepare(
    `INSERT INTO pulse_sla_definitions (id, tenant_id, process_key, process_name, domain, target_hours, threshold_pct, owner, description, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
  ).bind(
    id,
    tenantId,
    body.processKey,
    body.processName,
    body.domain || 'general',
    body.targetHours,
    body.thresholdPct ?? 95,
    body.owner ?? null,
    body.description ?? null,
    now,
    now,
  ).run();
  return c.json({ id, created: true });
});

// PATCH /api/pulse/sla/:id — toggle active / adjust target / threshold (admin+)
pulse.patch('/sla/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!isAdminRole(auth?.role)) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tenantId = getTenantId(c);
  const slaId = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<{
    targetHours?: number;
    thresholdPct?: number;
    active?: boolean;
    owner?: string;
  }>(c, []);
  if (errors.length || !body) return c.json({ error: 'Invalid payload', details: errors }, 400);

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.targetHours === 'number') { sets.push('target_hours = ?'); binds.push(body.targetHours); }
  if (typeof body.thresholdPct === 'number') { sets.push('threshold_pct = ?'); binds.push(body.thresholdPct); }
  if (typeof body.active === 'boolean') { sets.push('active = ?'); binds.push(body.active ? 1 : 0); }
  if (typeof body.owner === 'string') { sets.push('owner = ?'); binds.push(body.owner); }
  if (!sets.length) return c.json({ error: 'No changes' }, 400);
  sets.push('updated_at = ?');
  binds.push(new Date().toISOString());
  binds.push(slaId, tenantId);
  await c.env.DB.prepare(`UPDATE pulse_sla_definitions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...binds).run();
  return c.json({ updated: true });
});

// ─────────────────────────────────────────────────────────────────────────
// Pulse metric subscriptions — Wave 4 polish.
//
// "Email me when X breaches Y" — captured in the prior feature audit as the
// biggest Pulse gap. We model subscriptions as a per-user row pinned to a
// metric_id + comparator + threshold. Evaluation is best-effort, runs from
// the existing cron (scheduled.ts wires the evaluator on a separate phase
// follow-up), and gates on cooldown_minutes to prevent alert storms.
// ─────────────────────────────────────────────────────────────────────────

type Comparator = 'gt' | 'gte' | 'lt' | 'lte' | 'eq';
const VALID_COMPARATORS: ReadonlySet<Comparator> = new Set(['gt', 'gte', 'lt', 'lte', 'eq']);
type Channel = 'email' | 'in_app' | 'both';
const VALID_CHANNELS: ReadonlySet<Channel> = new Set(['email', 'in_app', 'both']);

interface SubscriptionRow {
  id: string;
  tenant_id: string;
  user_id: string;
  metric_id: string;
  comparator: string;
  threshold_value: number;
  channel: string;
  cooldown_minutes: number;
  last_triggered_at: string | null;
  last_observed_value: number | null;
  active: number;
  created_at: string;
}

pulse.get('/subscriptions', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

  // Caller sees only their own subs unless they're an admin.
  const showAll = isAdminRole(auth.role) && c.req.query('all') === '1';
  const sql = showAll
    ? `SELECT s.*, m.name AS metric_name, m.unit AS metric_unit, m.value AS current_value
         FROM pulse_metric_subscriptions s
         LEFT JOIN process_metrics m ON m.id = s.metric_id
        WHERE s.tenant_id = ?
        ORDER BY s.created_at DESC`
    : `SELECT s.*, m.name AS metric_name, m.unit AS metric_unit, m.value AS current_value
         FROM pulse_metric_subscriptions s
         LEFT JOIN process_metrics m ON m.id = s.metric_id
        WHERE s.tenant_id = ? AND s.user_id = ?
        ORDER BY s.created_at DESC`;
  const binds = showAll ? [tenantId] : [tenantId, auth.userId];
  const rows = await c.env.DB.prepare(sql).bind(...binds).all<SubscriptionRow & {
    metric_name: string | null; metric_unit: string | null; current_value: number | null;
  }>();
  return c.json({ subscriptions: rows.results || [] });
});

pulse.post('/subscriptions', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

  const body = await c.req.json<{
    metric_id?: string;
    comparator?: string;
    threshold_value?: number;
    channel?: string;
    cooldown_minutes?: number;
  }>();
  const metricId = (body.metric_id || '').trim();
  const comparator = (body.comparator || 'gt').toLowerCase();
  const threshold = Number(body.threshold_value);
  const channel = (body.channel || 'email').toLowerCase();
  const cooldown = Math.min(Math.max(Number(body.cooldown_minutes) || 60, 5), 1440);

  if (!metricId) return c.json({ error: 'metric_id is required' }, 400);
  if (!VALID_COMPARATORS.has(comparator as Comparator)) return c.json({ error: 'invalid comparator' }, 400);
  if (!Number.isFinite(threshold)) return c.json({ error: 'threshold_value must be a number' }, 400);
  if (!VALID_CHANNELS.has(channel as Channel)) return c.json({ error: 'invalid channel' }, 400);

  // Verify metric belongs to this tenant — prevents enumeration via subscription
  const metric = await c.env.DB.prepare(
    `SELECT id FROM process_metrics WHERE id = ? AND tenant_id = ?`
  ).bind(metricId, tenantId).first<{ id: string }>();
  if (!metric) return c.json({ error: 'metric not found' }, 404);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO pulse_metric_subscriptions
       (id, tenant_id, user_id, metric_id, comparator, threshold_value, channel, cooldown_minutes, active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
  ).bind(id, tenantId, auth.userId, metricId, comparator, threshold, channel, cooldown).run();

  return c.json({ id, created: true });
});

pulse.patch('/subscriptions/:id', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

  const subId = c.req.param('id');
  const body = await c.req.json<{ active?: boolean; threshold_value?: number; comparator?: string; cooldown_minutes?: number }>();

  // Scope mutation to caller's own row unless admin.
  const scopeClause = isAdminRole(auth.role) ? 'tenant_id = ?' : 'tenant_id = ? AND user_id = ?';
  const scopeBinds = isAdminRole(auth.role) ? [tenantId] : [tenantId, auth.userId];

  const sets: string[] = [];
  const binds: unknown[] = [];
  if (typeof body.active === 'boolean') { sets.push('active = ?'); binds.push(body.active ? 1 : 0); }
  if (typeof body.threshold_value === 'number' && Number.isFinite(body.threshold_value)) {
    sets.push('threshold_value = ?'); binds.push(body.threshold_value);
  }
  if (typeof body.comparator === 'string' && VALID_COMPARATORS.has(body.comparator.toLowerCase() as Comparator)) {
    sets.push('comparator = ?'); binds.push(body.comparator.toLowerCase());
  }
  if (typeof body.cooldown_minutes === 'number') {
    const cd = Math.min(Math.max(body.cooldown_minutes, 5), 1440);
    sets.push('cooldown_minutes = ?'); binds.push(cd);
  }
  if (sets.length === 0) return c.json({ error: 'no fields to update' }, 400);

  const sql = `UPDATE pulse_metric_subscriptions SET ${sets.join(', ')} WHERE id = ? AND ${scopeClause}`;
  binds.push(subId, ...scopeBinds);
  await c.env.DB.prepare(sql).bind(...binds).run();
  return c.json({ updated: true });
});

pulse.delete('/subscriptions/:id', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.userId) return c.json({ error: 'Unauthorized' }, 401);

  const subId = c.req.param('id');
  const sql = isAdminRole(auth.role)
    ? `DELETE FROM pulse_metric_subscriptions WHERE id = ? AND tenant_id = ?`
    : `DELETE FROM pulse_metric_subscriptions WHERE id = ? AND tenant_id = ? AND user_id = ?`;
  const binds = isAdminRole(auth.role) ? [subId, tenantId] : [subId, tenantId, auth.userId];
  await c.env.DB.prepare(sql).bind(...binds).run();
  return c.json({ deleted: true });
});

export default pulse;
