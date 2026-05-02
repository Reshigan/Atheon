/**
 * Insights Collection Engine
 * 
 * Runs DURING each catalyst/sub-catalyst execution to collect:
 * - KPI snapshots and movements
 * - Issue detection (high discrepancies, low match rates, exceptions)
 * - Trend capture (KPI movements over time)
 * - Auto-generated risk alerts when findings exceed thresholds
 * - Health score history with source run attribution
 * 
 * Powers:
 * - Pulse: Department-level operational insights (filtered by domain)
 * - Apex: Executive cross-department performance drivers and issue detection
 * - Dashboard: Unified intelligence summary
 * 
 * All LLM-powered insights use the configurable provider abstraction.
 * The platform NEVER exposes which model is being used.
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
// LlmMessage type not directly used — messages are inline objects
// V2 engines are invoked via scheduled.ts cron jobs (they need env.AI binding not available in collectRunInsights)

// ── Types ──

export interface InsightRecord {
  id: string;
  tenant_id: string;
  source_type: 'catalyst_run' | 'health_recalc' | 'scheduled' | 'manual';
  source_run_id: string | null;
  cluster_id: string | null;
  sub_catalyst_name: string | null;
  domain: string | null;
  insight_level: 'pulse' | 'apex' | 'dashboard';
  category: 'kpi_movement' | 'issue_detected' | 'trend_change' | 'risk_alert' | 'performance_driver' | 'recommendation';
  title: string;
  description: string;
  severity: 'info' | 'warning' | 'critical';
  data: Record<string, unknown>;
  traceability: {
    source_run_id?: string;
    cluster_id?: string;
    sub_catalyst_name?: string;
    kpi_ids?: string[];
    metric_ids?: string[];
    risk_alert_ids?: string[];
  };
  generated_at: string;
}

export interface RunInsightContext {
  tenantId: string;
  clusterId: string;
  subCatalystName: string;
  runId: string;
  domain: string;
  runData: {
    status: string;
    matched: number;
    discrepancies: number;
    exceptions: number;
    totalSourceValue: number;
    totalDiscrepancyValue: number;
    totalUnmatchedValue: number;
    matchRate: number;
    discrepancyRate: number;
    exceptionRate: number;
    confidence: number;
    duration_ms: number;
  };
  previousRunData?: {
    matched: number;
    discrepancies: number;
    exceptions: number;
    matchRate: number;
    totalSourceValue: number;
  } | null;
  kpiValues: Array<{
    name: string;
    category: string;
    value: number;
    status: string;
    previousValue?: number;
  }>;
}

// ── Domain-to-dimension mapping ──

const DOMAIN_TO_DIMENSIONS: Record<string, string[]> = {
  'finance': ['financial'],
  'procurement': ['operational', 'financial'],
  'supply-chain': ['operational'],
  'operations': ['operational'],
  'hr': ['operational', 'strategic'],
  'sales': ['financial', 'strategic'],
  'revenue': ['financial', 'strategic'],
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

export function getDimensionsForDomain(domain: string): string[] {
  if (DOMAIN_TO_DIMENSIONS[domain]) return DOMAIN_TO_DIMENSIONS[domain];
  // Unknown domain: preserve the customer's own naming as its own
  // dimension (slugified) instead of silently merging into 'operational'.
  // Lets Atheon reason about arbitrary customer-defined KPI universes
  // — see kpi-classification.ts for the same principle in attribution.
  if (!domain) return ['operational'];
  const slug = domain.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug ? [slug] : ['operational'];
}

// ── Core: Collect insights during a catalyst run ──

export async function collectRunInsights(
  db: D1Database,
  context: RunInsightContext,
): Promise<InsightRecord[]> {
  const insights: InsightRecord[] = [];
  const now = new Date().toISOString();
  const trace = {
    source_run_id: context.runId,
    cluster_id: context.clusterId,
    sub_catalyst_name: context.subCatalystName,
  };

  // 1. Detect issues from run data
  const issueInsights = detectIssues(context, now, trace);
  insights.push(...issueInsights);

  // 2. Detect KPI movements
  const kpiInsights = detectKpiMovements(context, now, trace);
  insights.push(...kpiInsights);

  // 3. Detect trends (compare with previous run)
  if (context.previousRunData) {
    const trendInsights = detectTrends(context, now, trace);
    insights.push(...trendInsights);
  }

  // 4. Store all insights — OPTIMIZED: batch INSERT instead of per-insight INSERT
  if (insights.length > 0) {
    const insightStmts: D1PreparedStatement[] = insights.map(insight =>
      db.prepare(
        `INSERT INTO catalyst_insights (id, tenant_id, source_type, source_run_id, cluster_id, sub_catalyst_name, domain, insight_level, category, title, description, severity, data, traceability, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        insight.id, insight.tenant_id, insight.source_type, insight.source_run_id,
        insight.cluster_id, insight.sub_catalyst_name, insight.domain,
        insight.insight_level, insight.category, insight.title, insight.description,
        insight.severity, JSON.stringify(insight.data), JSON.stringify(insight.traceability),
        insight.generated_at,
      )
    );
    try {
      await db.batch(insightStmts);
    } catch (err) {
      console.error('collectRunInsights: failed to batch-store insights:', err);
    }
  }

  // 5. Auto-generate risk alerts for critical findings (GAP 4)
  await autoGenerateRiskAlerts(db, context, insights, now);

  // 6. Record health score history with run attribution (GAP 5)
  await recordHealthScoreHistory(db, context, now);

  // V2: Auto-trigger pattern analysis after each catalyst run (skipped here — no env binding available; runs via cron in scheduled.ts)

  // V2: Auto-trigger RCA on red metrics (skipped here — no env binding available; runs via cron in scheduled.ts)
  const redKpis = (context.kpiValues || []).filter(k => k.status === 'red');
  if (redKpis.length > 0) {
    console.log(`[insights-engine] ${redKpis.length} red KPIs detected for ${context.subCatalystName}, RCA will run via scheduled job`);
  }

  return insights;
}

// ── Issue Detection ──

function detectIssues(
  context: RunInsightContext,
  now: string,
  trace: Record<string, string>,
): InsightRecord[] {
  const insights: InsightRecord[] = [];
  const { runData, tenantId, domain, clusterId, subCatalystName, runId } = context;

  // High discrepancy rate
  if (runData.discrepancyRate > 10) {
    const severity = runData.discrepancyRate > 25 ? 'critical' : 'warning';
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: 'pulse',
      category: 'issue_detected',
      title: `High Discrepancy Rate: ${runData.discrepancyRate.toFixed(1)}%`,
      description: `${subCatalystName} found ${runData.discrepancies} discrepancies out of ${runData.matched + runData.discrepancies + runData.exceptions} records (${runData.discrepancyRate.toFixed(1)}%). ${severity === 'critical' ? 'Immediate review required.' : 'Review recommended.'}`,
      severity,
      data: {
        discrepancies: runData.discrepancies,
        discrepancyRate: runData.discrepancyRate,
        totalDiscrepancyValue: runData.totalDiscrepancyValue,
        threshold: 10,
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  // Low match rate
  if (runData.matchRate < 80) {
    const severity = runData.matchRate < 60 ? 'critical' : 'warning';
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: 'pulse',
      category: 'issue_detected',
      title: `Low Match Rate: ${runData.matchRate.toFixed(1)}%`,
      description: `${subCatalystName} only matched ${runData.matched} of ${runData.matched + runData.discrepancies + runData.exceptions} records. ${runData.totalUnmatchedValue > 0 ? `Unmatched value: R${runData.totalUnmatchedValue.toLocaleString()}.` : ''} Investigation needed.`,
      severity,
      data: {
        matched: runData.matched,
        matchRate: runData.matchRate,
        totalUnmatchedValue: runData.totalUnmatchedValue,
        threshold: 80,
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  // High exception count
  if (runData.exceptionRate > 5) {
    const severity = runData.exceptionRate > 15 ? 'critical' : 'warning';
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: 'pulse',
      category: 'issue_detected',
      title: `Elevated Exception Rate: ${runData.exceptionRate.toFixed(1)}%`,
      description: `${subCatalystName} raised ${runData.exceptions} exceptions (${runData.exceptionRate.toFixed(1)}%). These require human review through the HITL workflow.`,
      severity,
      data: {
        exceptions: runData.exceptions,
        exceptionRate: runData.exceptionRate,
        threshold: 5,
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  // Large financial impact from discrepancies
  if (runData.totalDiscrepancyValue > 50000) {
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: 'apex',
      category: 'issue_detected',
      title: `Significant Financial Discrepancy: R${runData.totalDiscrepancyValue.toLocaleString()}`,
      description: `${subCatalystName} identified R${runData.totalDiscrepancyValue.toLocaleString()} in discrepancies. This impacts the ${domain} dimension and requires executive attention.`,
      severity: runData.totalDiscrepancyValue > 250000 ? 'critical' : 'warning',
      data: {
        totalDiscrepancyValue: runData.totalDiscrepancyValue,
        currency: 'ZAR',
        domain,
        dimensions: getDimensionsForDomain(domain),
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  return insights;
}

// ── KPI Movement Detection ──

function detectKpiMovements(
  context: RunInsightContext,
  now: string,
  trace: Record<string, string>,
): InsightRecord[] {
  const insights: InsightRecord[] = [];
  const { kpiValues, tenantId, domain, clusterId, subCatalystName, runId } = context;

  for (const kpi of kpiValues) {
    // Red KPIs are always noteworthy
    if (kpi.status === 'red') {
      insights.push({
        id: `ins-${crypto.randomUUID()}`,
        tenant_id: tenantId,
        source_type: 'catalyst_run',
        source_run_id: runId,
        cluster_id: clusterId,
        sub_catalyst_name: subCatalystName,
        domain,
        insight_level: 'pulse',
        category: 'kpi_movement',
        title: `KPI Critical: ${kpi.name} at ${kpi.value.toFixed(1)}`,
        description: `${kpi.name} (${kpi.category}) has breached the RED threshold. Current value: ${kpi.value.toFixed(1)}. From ${subCatalystName}.`,
        severity: 'critical',
        data: {
          kpiName: kpi.name,
          category: kpi.category,
          currentValue: kpi.value,
          previousValue: kpi.previousValue,
          status: kpi.status,
        },
        traceability: { ...trace, source_run_id: runId },
        generated_at: now,
      });
    }

    // Significant movement from previous value
    if (kpi.previousValue !== undefined && kpi.previousValue > 0) {
      const changePercent = ((kpi.value - kpi.previousValue) / kpi.previousValue) * 100;
      if (Math.abs(changePercent) > 10) {
        const direction = changePercent > 0 ? 'increased' : 'decreased';
        insights.push({
          id: `ins-${crypto.randomUUID()}`,
          tenant_id: tenantId,
          source_type: 'catalyst_run',
          source_run_id: runId,
          cluster_id: clusterId,
          sub_catalyst_name: subCatalystName,
          domain,
          insight_level: 'pulse',
          category: 'kpi_movement',
          title: `${kpi.name} ${direction} ${Math.abs(changePercent).toFixed(1)}%`,
          description: `${kpi.name} ${direction} from ${kpi.previousValue.toFixed(1)} to ${kpi.value.toFixed(1)} (${changePercent > 0 ? '+' : ''}${changePercent.toFixed(1)}%). ${Math.abs(changePercent) > 20 ? 'Significant movement requiring attention.' : 'Moderate change detected.'}`,
          severity: Math.abs(changePercent) > 20 ? 'warning' : 'info',
          data: {
            kpiName: kpi.name,
            category: kpi.category,
            currentValue: kpi.value,
            previousValue: kpi.previousValue,
            changePercent,
            direction,
          },
          traceability: { ...trace, source_run_id: runId },
          generated_at: now,
        });
      }
    }
  }

  return insights;
}

// ── Trend Detection ──

function detectTrends(
  context: RunInsightContext,
  now: string,
  trace: Record<string, string>,
): InsightRecord[] {
  const insights: InsightRecord[] = [];
  const { runData, previousRunData, tenantId, domain, clusterId, subCatalystName, runId } = context;

  if (!previousRunData) return insights;

  // Match rate trend
  const matchDelta = runData.matchRate - previousRunData.matchRate;
  if (Math.abs(matchDelta) > 5) {
    const direction = matchDelta > 0 ? 'improving' : 'declining';
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: 'pulse',
      category: 'trend_change',
      title: `Match Rate ${direction}: ${matchDelta > 0 ? '+' : ''}${matchDelta.toFixed(1)}pp`,
      description: `${subCatalystName} match rate ${direction} from ${previousRunData.matchRate.toFixed(1)}% to ${runData.matchRate.toFixed(1)}%. ${direction === 'declining' ? 'This trend needs monitoring.' : 'Positive trend continuing.'}`,
      severity: direction === 'declining' && Math.abs(matchDelta) > 10 ? 'warning' : 'info',
      data: {
        currentMatchRate: runData.matchRate,
        previousMatchRate: previousRunData.matchRate,
        delta: matchDelta,
        direction,
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  // Discrepancy trend
  const discDelta = runData.discrepancies - previousRunData.discrepancies;
  if (Math.abs(discDelta) > 3) {
    const direction = discDelta > 0 ? 'increasing' : 'decreasing';
    insights.push({
      id: `ins-${crypto.randomUUID()}`,
      tenant_id: tenantId,
      source_type: 'catalyst_run',
      source_run_id: runId,
      cluster_id: clusterId,
      sub_catalyst_name: subCatalystName,
      domain,
      insight_level: direction === 'increasing' ? 'apex' : 'pulse',
      category: 'trend_change',
      title: `Discrepancies ${direction}: ${discDelta > 0 ? '+' : ''}${discDelta}`,
      description: `${subCatalystName} discrepancies ${direction} from ${previousRunData.discrepancies} to ${runData.discrepancies}. ${direction === 'increasing' ? 'Escalating issue requires investigation.' : 'Issue resolving.'}`,
      severity: direction === 'increasing' ? 'warning' : 'info',
      data: {
        currentDiscrepancies: runData.discrepancies,
        previousDiscrepancies: previousRunData.discrepancies,
        delta: discDelta,
        direction,
      },
      traceability: { ...trace, source_run_id: runId },
      generated_at: now,
    });
  }

  return insights;
}

// ── GAP 4: Auto-generate risk alerts from significant findings ──

async function autoGenerateRiskAlerts(
  db: D1Database,
  context: RunInsightContext,
  insights: InsightRecord[],
  now: string,
): Promise<void> {
  const criticalInsights = insights.filter(i => i.severity === 'critical');
  if (criticalInsights.length === 0) return;

  // OPTIMIZED: batch INSERT all risk alerts instead of per-insight INSERT
  const alertStmts: D1PreparedStatement[] = criticalInsights.map(insight => {
    const alertId = `ra-auto-${context.tenantId}-${context.runId}-${insight.category}-${insight.id}`;
    return db.prepare(
      `INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at, source_run_id, cluster_id, sub_catalyst_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ZAR', ?, 'active', ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET description=excluded.description, detected_at=excluded.detected_at, status='active'`
    ).bind(
      alertId, context.tenantId,
      insight.title,
      insight.description,
      insight.severity === 'critical' ? 'high' : 'medium',
      insight.domain || 'operational',
      0.8,
      (insight.data.totalDiscrepancyValue as number) || (insight.data.totalUnmatchedValue as number) || 0,
      JSON.stringify([
        `Review ${context.subCatalystName} run details`,
        'Investigate root cause of flagged items',
        'Escalate to department head if unresolved within 24 hours',
      ]),
      now,
      context.runId,
      context.clusterId,
      context.subCatalystName,
    );
  });

  try {
    await db.batch(alertStmts);
  } catch (err) {
    console.error('autoGenerateRiskAlerts: failed to batch-create alerts:', err);
  }
}

// ── GAP 5: Record health score history with source run attribution ──

async function recordHealthScoreHistory(
  db: D1Database,
  context: RunInsightContext,
  now: string,
): Promise<void> {
  try {
    // Get the latest health score
    const latestScore = await db.prepare(
      'SELECT id, overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
    ).bind(context.tenantId).first<{ id: string; overall_score: number; dimensions: string }>();

    if (!latestScore) return;

    // Record history entry linked to this run
    await db.prepare(
      `INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions, source_run_id, catalyst_name, recorded_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      `hsh-${crypto.randomUUID()}`,
      context.tenantId,
      latestScore.overall_score,
      latestScore.dimensions,
      context.runId,
      context.subCatalystName,
      now,
    ).run();
  } catch (err) {
    console.error('recordHealthScoreHistory: failed:', err);
  }
}

// ── GAP 2: Bridge sub-catalyst KPI values to Pulse process_metrics ──

export async function bridgeKpisToProcessMetrics(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subCatalystName: string,
  runId: string,
): Promise<number> {
  let bridged = 0;
  try {
    // Get all KPI definitions with their latest values for this sub-catalyst
    const defs = await db.prepare(
      `SELECT kd.id, kd.kpi_name, kd.category, kd.unit, kd.direction,
              kd.threshold_green, kd.threshold_amber, kd.threshold_red,
              kv.value, kv.status, kv.trend
       FROM sub_catalyst_kpi_definitions kd
       LEFT JOIN sub_catalyst_kpi_values kv ON kv.definition_id = kd.id AND kv.run_id IS NULL
       WHERE kd.tenant_id = ? AND kd.cluster_id = ? AND kd.sub_catalyst_name = ? AND kd.enabled = 1
       ORDER BY kd.sort_order`
    ).bind(tenantId, clusterId, subCatalystName).all<Record<string, unknown>>();

    if (!defs.results || defs.results.length === 0) return 0;

    // Get the domain for this cluster
    const cluster = await db.prepare(
      'SELECT domain FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
    ).bind(clusterId, tenantId).first<{ domain: string }>();
    const domain = cluster?.domain || 'operational';

    const now = new Date().toISOString();

    // OPTIMIZED: batch INSERT all process metrics instead of per-KPI INSERT
    const metricStmts: D1PreparedStatement[] = [];
    for (const def of defs.results) {
      const value = def.value as number | null;
      if (value === null) continue;

      const kpiName = def.kpi_name as string;
      const category = def.category as string;
      const unit = def.unit as string;
      const status = def.status as string || 'green';
      const trendStr = def.trend as string || '[]';

      // Create a deterministic metric ID so we upsert correctly
      const metricId = `pm-${tenantId}-${clusterId}-${subCatalystName.replace(/\s+/g, '-').toLowerCase()}-${kpiName.replace(/\s+/g, '-').toLowerCase()}`;

      metricStmts.push(
        db.prepare(
          `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system, measured_at, trend, sub_catalyst_name, source_run_id, cluster_id, domain, category)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET value=excluded.value, status=excluded.status, measured_at=excluded.measured_at, trend=excluded.trend, source_run_id=excluded.source_run_id`
        ).bind(
          metricId, tenantId, `${subCatalystName}: ${kpiName}`, value, unit, status,
          def.threshold_green as number | null, def.threshold_amber as number | null, def.threshold_red as number | null,
          subCatalystName, now, trendStr,
          subCatalystName, runId, clusterId, domain, category,
        )
      );
      bridged++;
    }

    if (metricStmts.length > 0) {
      await db.batch(metricStmts);
    }
  } catch (err) {
    console.error('bridgeKpisToProcessMetrics: failed:', err);
  }
  return bridged;
}

// ── GAP 3: Rewrite health score calculation to use real KPI data ──

export async function recalculateHealthScoreFromKpis(
  db: D1Database,
  tenantId: string,
): Promise<{ overall: number; dimensions: Record<string, unknown> } | null> {
  // Pull ALL sub_catalyst_kpi_values grouped by category
  const kpiData = await db.prepare(
    `SELECT kd.category, kv.value, kv.status, kd.direction, kd.threshold_green, kd.threshold_amber, kd.threshold_red
     FROM sub_catalyst_kpi_values kv
     JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
     WHERE kd.tenant_id = ? AND kv.run_id IS NULL AND kd.enabled = 1`
  ).bind(tenantId).all<Record<string, unknown>>();

  // Also get process_metrics status counts
  const metricCounts = await db.prepare(
    "SELECT status, COUNT(*) as count FROM process_metrics WHERE tenant_id = ? GROUP BY status"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Get risk alerts
  const risks = await db.prepare(
    "SELECT severity, COUNT(*) as count FROM risk_alerts WHERE tenant_id = ? AND status = 'active' GROUP BY severity"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Get catalyst success rates
  const catalysts = await db.prepare(
    "SELECT AVG(success_rate) as avg_success, COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).first<{ avg_success: number | null; count: number }>();

  // Get anomalies
  const anomalies = await db.prepare(
    "SELECT COUNT(*) as count FROM anomalies WHERE tenant_id = ? AND status = 'open'"
  ).bind(tenantId).first<{ count: number }>();

  // Check if there's any data at all
  const hasKpiData = (kpiData.results || []).length > 0;
  const hasMetrics = (metricCounts.results || []).length > 0;
  const hasRisks = (risks.results || []).length > 0;
  const hasActiveCatalysts = (catalysts?.count || 0) > 0;
  const hasAnomalies = (anomalies?.count || 0) > 0;

  if (!hasKpiData && !hasMetrics && !hasRisks && !hasActiveCatalysts && !hasAnomalies) {
    return null; // No data — keep dashboard blank
  }

  // ── Group KPI values by business dimension ──
  // Standard categories canonicalise; everything else passes through as
  // its own dimension (slugified) so customer-defined categories like
  // 'sustainability' or 'esg-water' are reasoned about as themselves
  // instead of silently merged into 'operational'.
  const dimensionScores: Record<string, { total: number; green: number; amber: number; red: number; count: number }> = {};
  const STANDARD_CATEGORIES = new Set(['financial', 'operational', 'compliance', 'strategic', 'technology', 'risk', 'people', 'cost', 'revenue']);

  for (const kpi of (kpiData.results || [])) {
    const rawCategory = ((kpi.category as string) || '').toLowerCase().trim();
    const dimension = rawCategory && STANDARD_CATEGORIES.has(rawCategory)
      ? rawCategory
      : (rawCategory ? rawCategory.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') : 'operational');
    const status = kpi.status as string;

    if (!dimensionScores[dimension]) {
      dimensionScores[dimension] = { total: 0, green: 0, amber: 0, red: 0, count: 0 };
    }
    dimensionScores[dimension].count++;
    if (status === 'green') dimensionScores[dimension].green++;
    else if (status === 'amber') dimensionScores[dimension].amber++;
    else if (status === 'red') dimensionScores[dimension].red++;
  }

  // ── Also factor in process_metrics ──
  const metricMap: Record<string, number> = {};
  for (const m of (metricCounts.results || [])) {
    metricMap[m.status as string] = m.count as number;
  }

  // Add metric data to operational dimension
  if (hasMetrics) {
    if (!dimensionScores['operational']) {
      dimensionScores['operational'] = { total: 0, green: 0, amber: 0, red: 0, count: 0 };
    }
    dimensionScores['operational'].green += metricMap['green'] || 0;
    dimensionScores['operational'].amber += metricMap['amber'] || 0;
    dimensionScores['operational'].red += metricMap['red'] || 0;
    dimensionScores['operational'].count += (metricMap['green'] || 0) + (metricMap['amber'] || 0) + (metricMap['red'] || 0);
  }

  // ── Calculate per-dimension scores ──
  const dimensions: Record<string, { score: number; trend: string; delta: number; kpiContributors: Array<{ status: string; count: number }> }> = {};
  const dimensionWeights: Record<string, number> = {
    financial: 0.25,
    operational: 0.25,
    compliance: 0.2,
    strategic: 0.15,
    technology: 0.15,
  };

  // Get previous health score for trend calculation
  const prevScore = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();
  const prevDimensions: Record<string, { score: number }> = prevScore?.dimensions ? JSON.parse(prevScore.dimensions) : {};

  for (const [dim, data] of Object.entries(dimensionScores)) {
    if (data.count === 0) continue;
    const score = Math.round(
      ((data.green * 100 + data.amber * 50 + data.red * 0) / data.count)
    );
    const prevDimScore = prevDimensions[dim]?.score ?? score;
    const delta = score - prevDimScore;
    const trend = delta > 2 ? 'improving' : delta < -2 ? 'declining' : 'stable';

    dimensions[dim] = {
      score,
      trend,
      delta,
      kpiContributors: [
        { status: 'green', count: data.green },
        { status: 'amber', count: data.amber },
        { status: 'red', count: data.red },
      ],
    };
  }

  // ── Risk dimension from risk_alerts ──
  if (hasRisks) {
    const riskMap: Record<string, number> = {};
    for (const r of (risks.results || [])) {
      riskMap[r.severity as string] = r.count as number;
    }
    const riskPenalty = (riskMap['critical'] || 0) * 20 + (riskMap['high'] || 0) * 10 + (riskMap['medium'] || 0) * 5 + (riskMap['low'] || 0) * 2;
    const riskScore = Math.max(0, 100 - riskPenalty);
    const prevRiskScore = prevDimensions['risk']?.score ?? riskScore;
    dimensions['risk'] = {
      score: riskScore,
      trend: riskScore > prevRiskScore + 2 ? 'improving' : riskScore < prevRiskScore - 2 ? 'declining' : 'stable',
      delta: riskScore - prevRiskScore,
      kpiContributors: [
        { status: 'critical', count: riskMap['critical'] || 0 },
        { status: 'high', count: riskMap['high'] || 0 },
        { status: 'medium', count: riskMap['medium'] || 0 },
      ],
    };
  }

  // ── Catalyst dimension ──
  if (hasActiveCatalysts && catalysts?.avg_success != null) {
    const catalystScore = Math.round(catalysts.avg_success);
    const prevCatScore = prevDimensions['catalyst']?.score ?? catalystScore;
    dimensions['catalyst'] = {
      score: catalystScore,
      trend: catalystScore > prevCatScore + 2 ? 'improving' : catalystScore < prevCatScore - 2 ? 'declining' : 'stable',
      delta: catalystScore - prevCatScore,
      kpiContributors: [{ status: 'success_rate', count: catalysts.count }],
    };
  }

  // ── Process dimension from anomalies ──
  if (hasAnomalies) {
    const anomalyPenalty = (anomalies?.count || 0) * 5;
    const processScore = Math.max(0, 100 - anomalyPenalty);
    const prevProcScore = prevDimensions['process']?.score ?? processScore;
    dimensions['process'] = {
      score: processScore,
      trend: processScore > prevProcScore + 2 ? 'improving' : processScore < prevProcScore - 2 ? 'declining' : 'stable',
      delta: processScore - prevProcScore,
      kpiContributors: [{ status: 'anomalies', count: anomalies?.count || 0 }],
    };
  }

  // ── Weighted composite ──
  const weightedEntries: Array<{ score: number; weight: number }> = [];
  for (const [dim, data] of Object.entries(dimensions)) {
    const weight = dimensionWeights[dim] || 0.1;
    weightedEntries.push({ score: data.score, weight });
  }

  const totalWeight = weightedEntries.reduce((sum, d) => sum + d.weight, 0);
  const overall = totalWeight > 0
    ? Math.round(weightedEntries.reduce((sum, d) => sum + d.score * (d.weight / totalWeight), 0))
    : 0;

  // Store new health score
  await db.prepare(
    "INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at) VALUES (?, ?, ?, ?, datetime('now'))"
  ).bind(crypto.randomUUID(), tenantId, overall, JSON.stringify(dimensions)).run();

  return { overall, dimensions };
}

// ── LLM-Powered Insight Generation ──

export async function generatePulseInsights(
  db: D1Database,
  ai: Ai,
  tenantId: string,
  domain?: string,
): Promise<{ insights: string; recommendations: string[]; drivers: Array<{ metric: string; impact: string; direction: string; traceability: Record<string, unknown> }> }> {
  // Gather recent insights for this domain
  let insightQuery = 'SELECT * FROM catalyst_insights WHERE tenant_id = ? AND insight_level = ?';
  const binds: unknown[] = [tenantId, 'pulse'];
  if (domain) {
    insightQuery += ' AND domain = ?';
    binds.push(domain);
  }
  insightQuery += ' ORDER BY generated_at DESC LIMIT 20';

  const recentInsights = await db.prepare(insightQuery).bind(...binds).all<Record<string, unknown>>();

  // Get recent metrics
  let metricsQuery = 'SELECT name, value, unit, status, source_system, sub_catalyst_name, source_run_id, cluster_id FROM process_metrics WHERE tenant_id = ?';
  const metricBinds: unknown[] = [tenantId];
  if (domain) {
    metricsQuery += ' AND domain = ?';
    metricBinds.push(domain);
  }
  metricsQuery += ' ORDER BY measured_at DESC LIMIT 30';
  const metrics = await db.prepare(metricsQuery).bind(...metricBinds).all<Record<string, unknown>>();

  // Fetch external signals (radar signals, regulatory events, benchmarks) for context
  const externalSignals = await db.prepare(
    'SELECT title, summary, category, sentiment FROM external_signals WHERE tenant_id = ? ORDER BY relevance_score DESC, detected_at DESC LIMIT 5'
  ).bind(tenantId).all<Record<string, unknown>>();
  const signalSummary = (externalSignals.results || []).map(s => `- [${s.category}] ${s.title}: ${s.summary} (sentiment: ${s.sentiment})`).join('\n');

  const regulatoryEvents = await db.prepare(
    "SELECT title, jurisdiction, compliance_deadline, readiness_score FROM regulatory_events WHERE tenant_id = ? AND status = 'upcoming' ORDER BY compliance_deadline ASC LIMIT 3"
  ).bind(tenantId).all<Record<string, unknown>>();
  const regSummary = (regulatoryEvents.results || []).map(r => `- ${r.title} (${r.jurisdiction}, deadline: ${r.compliance_deadline}, readiness: ${r.readiness_score}%)`).join('\n');

  // Build context for LLM
  const insightSummary = (recentInsights.results || []).map(i => `- [${i.severity}] ${i.title}: ${i.description}`).join('\n');
  const metricSummary = (metrics.results || []).map(m => `- ${m.name}: ${m.value} ${m.unit} (${m.status})`).join('\n');

  const systemPrompt = `You are an enterprise operations intelligence engine. Analyze the following operational data and external market signals to provide:
1. A concise executive summary (2-3 sentences) of the current operational state${domain ? ` for the ${domain} department` : ''}
2. Top 3 actionable recommendations (factor in external signals if relevant)
3. Key performance drivers (what's driving the current state)

Be specific with numbers. Factor external signals and regulatory events into your analysis when they affect operational performance. Never mention AI, models, or algorithms.`;

  const externalContext = (signalSummary || regSummary)
    ? `\n\nExternal Signals:\n${signalSummary || 'None.'}\n\nRegulatory Events:\n${regSummary || 'None.'}`
    : '';

  const userPrompt = `Recent Insights:\n${insightSummary || 'No recent insights collected yet.'}\n\nCurrent Metrics:\n${metricSummary || 'No metrics available.'}${externalContext}\n\nProvide analysis as JSON: { "summary": string, "recommendations": string[], "drivers": [{ "metric": string, "impact": string, "direction": "improving"|"declining"|"stable" }] }`;

  // Build drivers from data (deterministic fallback)
  const drivers: Array<{ metric: string; impact: string; direction: string; traceability: Record<string, unknown> }> = [];
  for (const m of (metrics.results || []).slice(0, 5)) {
    const status = m.status as string;
    drivers.push({
      metric: m.name as string,
      impact: status === 'red' ? 'Negative — below threshold' : status === 'amber' ? 'Moderate — approaching threshold' : 'Positive — within targets',
      direction: status === 'red' ? 'declining' : status === 'green' ? 'improving' : 'stable',
      traceability: {
        sub_catalyst_name: m.sub_catalyst_name || null,
        source_run_id: m.source_run_id || null,
        cluster_id: m.cluster_id || null,
      },
    });
  }

  try {
    const config = await loadLlmConfig(db, tenantId);
    const result = await llmChatWithFallback(config, ai, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ], { maxTokens: 1024, temperature: 0.3 });

    try {
      const parsed = JSON.parse(stripCodeFences(result.text));
      return {
        insights: parsed.summary || result.text,
        recommendations: parsed.recommendations || [],
        drivers: (parsed.drivers || []).map((d: Record<string, string>, idx: number) => ({
          ...d,
          traceability: drivers[idx]?.traceability || {},
        })),
      };
    } catch {
      return { insights: result.text, recommendations: [], drivers };
    }
  } catch (err) {
    console.error('generatePulseInsights: LLM failed:', err);
    // Deterministic fallback
    const redCount = (metrics.results || []).filter(m => m.status === 'red').length;
    const amberCount = (metrics.results || []).filter(m => m.status === 'amber').length;
    const greenCount = (metrics.results || []).filter(m => m.status === 'green').length;
    const total = redCount + amberCount + greenCount;

    return {
      insights: total > 0
        ? `${domain ? `${domain} department: ` : ''}${greenCount} metrics healthy, ${amberCount} require attention, ${redCount} critical. ${redCount > 0 ? 'Immediate action recommended on RED metrics.' : amberCount > 0 ? 'Monitor AMBER metrics closely.' : 'All systems operating normally.'}`
        : 'No operational data available yet. Run catalysts to generate insights.',
      recommendations: redCount > 0
        ? ['Review RED metric root causes', 'Check data source connectivity', 'Escalate critical findings']
        : amberCount > 0
          ? ['Monitor approaching thresholds', 'Schedule preventive reviews', 'Verify data quality']
          : ['Maintain current operational standards', 'Consider expanding automation'],
      drivers,
    };
  }
}

export async function generateApexInsights(
  db: D1Database,
  ai: Ai,
  tenantId: string,
): Promise<{
  executiveSummary: string;
  performanceDrivers: Array<{ dimension: string; driver: string; impact: string; direction: string; traceability: Record<string, unknown> }>;
  issues: Array<{ title: string; severity: string; description: string; affectedDomain: string; traceability: Record<string, unknown> }>;
  crossDepartmentCorrelations: string[];
  strategicImplications: string[];
}> {
  // Get health score
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  // Get all critical/warning insights across departments
  const criticalInsights = await db.prepare(
    "SELECT * FROM catalyst_insights WHERE tenant_id = ? AND severity IN ('critical', 'warning') AND insight_level IN ('apex', 'pulse') ORDER BY generated_at DESC LIMIT 30"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Get risk alerts
  const activeRisks = await db.prepare(
    "SELECT title, severity, category, impact_value, source_run_id, cluster_id, sub_catalyst_name FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 10"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Get department-level summaries
  // departmentMetrics reserved for future cross-department correlation
  void (await db.prepare(
    "SELECT domain, status, COUNT(*) as count FROM process_metrics WHERE tenant_id = ? AND domain IS NOT NULL GROUP BY domain, status"
  ).bind(tenantId).all<Record<string, unknown>>());

  // Build deterministic performance drivers
  const dims = health?.dimensions ? JSON.parse(health.dimensions) : {};
  const performanceDrivers: Array<{ dimension: string; driver: string; impact: string; direction: string; traceability: Record<string, unknown> }> = [];

  for (const [dim, data] of Object.entries(dims) as Array<[string, Record<string, unknown>]>) {
    const score = data.score as number;
    const trend = data.trend as string;
    performanceDrivers.push({
      dimension: dim,
      driver: `${dim.charAt(0).toUpperCase() + dim.slice(1)} health at ${score}/100`,
      impact: score >= 80 ? 'Positive contributor' : score >= 60 ? 'Moderate contributor' : 'Negative contributor — dragging overall health down',
      direction: trend || 'stable',
      traceability: { dimension: dim, kpiContributors: data.kpiContributors || [] },
    });
  }

  // Build issues from critical insights
  const issues: Array<{ title: string; severity: string; description: string; affectedDomain: string; traceability: Record<string, unknown> }> = [];
  for (const insight of (criticalInsights.results || []).slice(0, 10)) {
    issues.push({
      title: insight.title as string,
      severity: insight.severity as string,
      description: (insight.description as string) || (insight.title as string),
      affectedDomain: (insight.domain as string) || 'general',
      traceability: {
        source_run_id: insight.source_run_id,
        cluster_id: insight.cluster_id,
        sub_catalyst_name: insight.sub_catalyst_name,
        insight_id: insight.id,
      },
    });
  }

  // Add risk alerts as issues
  for (const risk of (activeRisks.results || [])) {
    issues.push({
      title: risk.title as string,
      severity: risk.severity as string,
      description: (risk.title as string),
      affectedDomain: (risk.category as string) || 'general',
      traceability: {
        source_run_id: risk.source_run_id || null,
        cluster_id: risk.cluster_id || null,
        sub_catalyst_name: risk.sub_catalyst_name || null,
      },
    });
  }

  // Fetch external signals for executive context
  const externalSignals = await db.prepare(
    'SELECT title, summary, category, sentiment, relevance_score FROM external_signals WHERE tenant_id = ? ORDER BY relevance_score DESC, detected_at DESC LIMIT 5'
  ).bind(tenantId).all<Record<string, unknown>>();
  const signalContext = (externalSignals.results || []).length > 0
    ? `External signals: ${(externalSignals.results || []).map(s => `[${s.category}/${s.sentiment}] ${s.title}`).join('; ')}.`
    : '';

  const regulatoryEvents = await db.prepare(
    "SELECT title, compliance_deadline, readiness_score FROM regulatory_events WHERE tenant_id = ? AND status = 'upcoming' ORDER BY compliance_deadline ASC LIMIT 3"
  ).bind(tenantId).all<Record<string, unknown>>();
  const regContext = (regulatoryEvents.results || []).length > 0
    ? ` Regulatory deadlines: ${(regulatoryEvents.results || []).map(r => `${r.title} (deadline: ${r.compliance_deadline}, readiness: ${r.readiness_score}%)`).join('; ')}.`
    : '';

  const benchmarks = await db.prepare(
    'SELECT metric_name, benchmark_value, benchmark_unit, industry FROM market_benchmarks WHERE tenant_id = ? ORDER BY measured_at DESC LIMIT 3'
  ).bind(tenantId).all<Record<string, unknown>>();
  const benchContext = (benchmarks.results || []).length > 0
    ? ` Industry benchmarks: ${(benchmarks.results || []).map(b => `${b.metric_name}: ${b.benchmark_value}${b.benchmark_unit || ''} (${b.industry})`).join('; ')}.`
    : '';

  // LLM-powered executive summary
  const overallScore = health?.overall_score || 0;
  const systemPrompt = `You are an executive intelligence briefing engine for a large enterprise. Generate a concise executive summary that:
1. Opens with the overall health score and trajectory
2. Highlights the top 2-3 performance drivers
3. Flags critical issues requiring executive attention
4. Incorporates external market signals, regulatory events, and industry benchmarks into strategic implications
5. Suggests strategic implications

Be specific, data-driven, and decisive. Never mention AI, models, or algorithms. This is YOUR analysis.`;

  const contextData = `Health: ${overallScore}/100. Dimensions: ${JSON.stringify(dims)}. Active risks: ${(activeRisks.results || []).map(r => `[${r.severity}] ${r.title}`).join('; ') || 'None'}. Critical insights: ${(criticalInsights.results || []).slice(0, 5).map(i => i.title).join('; ') || 'None'}. ${signalContext}${regContext}${benchContext}`;

  let executiveSummary = '';
  let crossDepartmentCorrelations: string[] = [];
  let strategicImplications: string[] = [];

  try {
    const config = await loadLlmConfig(db, tenantId);
    const result = await llmChatWithFallback(config, ai, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `${contextData}\n\nRespond with JSON: { "executiveSummary": string, "crossDepartmentCorrelations": string[], "strategicImplications": string[] }` },
    ], { maxTokens: 1024, temperature: 0.3 });

    try {
      const parsed = JSON.parse(stripCodeFences(result.text));
      executiveSummary = parsed.executiveSummary || result.text;
      crossDepartmentCorrelations = parsed.crossDepartmentCorrelations || [];
      strategicImplications = parsed.strategicImplications || [];
    } catch {
      executiveSummary = result.text;
    }
  } catch {
    // Deterministic fallback
    const declining = Object.entries(dims).filter(([, d]) => (d as Record<string, unknown>).trend === 'declining');
    const improving = Object.entries(dims).filter(([, d]) => (d as Record<string, unknown>).trend === 'improving');

    executiveSummary = `Business health at ${overallScore}/100. ${improving.length > 0 ? `${improving.map(([k]) => k).join(', ')} showing improvement.` : ''} ${declining.length > 0 ? `${declining.map(([k]) => k).join(', ')} declining — requires attention.` : ''} ${issues.length} active issues flagged, ${(activeRisks.results || []).length} risk alerts.`;

    if (declining.length > 0 && improving.length > 0) {
      crossDepartmentCorrelations.push(`${declining[0][0]} decline may be impacting ${improving[0][0]} improvement pace`);
    }

    strategicImplications = [
      overallScore < 60 ? 'Critical: Business health below acceptable threshold — immediate intervention required' :
        overallScore < 75 ? 'Moderate risk: Trending below target — proactive measures recommended' :
          'Stable: Business health within acceptable range — focus on optimization',
    ];
  }

  return {
    executiveSummary,
    performanceDrivers,
    issues,
    crossDepartmentCorrelations,
    strategicImplications,
  };
}

export async function generateDashboardIntelligence(
  db: D1Database,
  ai: Ai,
  tenantId: string,
): Promise<{
  summary: string;
  keyMetrics: Array<{ name: string; value: number; status: string; trend: string; traceability: Record<string, unknown> }>;
  topRisks: Array<{ title: string; severity: string; traceability: Record<string, unknown> }>;
  recommendedActions: string[];
}> {
  // Health score
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  // Top metrics by impact
  const topMetrics = await db.prepare(
    "SELECT name, value, unit, status, sub_catalyst_name, source_run_id, cluster_id FROM process_metrics WHERE tenant_id = ? ORDER BY CASE status WHEN 'red' THEN 1 WHEN 'amber' THEN 2 ELSE 3 END, measured_at DESC LIMIT 6"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Top risks
  const topRisks = await db.prepare(
    "SELECT title, severity, source_run_id, cluster_id, sub_catalyst_name FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 5"
  ).bind(tenantId).all<Record<string, unknown>>();

  // Recent insights count
  const insightCounts = await db.prepare(
    "SELECT severity, COUNT(*) as count FROM catalyst_insights WHERE tenant_id = ? AND generated_at >= datetime('now', '-7 days') GROUP BY severity"
  ).bind(tenantId).all<Record<string, unknown>>();

  const overallScore = health?.overall_score || 0;
  // dims used for future dimension breakdown
  void (health?.dimensions ? JSON.parse(health.dimensions) : {});
  const criticalCount = (insightCounts.results || []).find(i => i.severity === 'critical');
  const warningCount = (insightCounts.results || []).find(i => i.severity === 'warning');

  const keyMetrics = (topMetrics.results || []).map(m => ({
    name: m.name as string,
    value: m.value as number,
    status: m.status as string,
    trend: (m.status as string) === 'green' ? 'stable' : 'declining',
    traceability: {
      sub_catalyst_name: m.sub_catalyst_name || null,
      source_run_id: m.source_run_id || null,
      cluster_id: m.cluster_id || null,
    },
  }));

  const topRiskList = (topRisks.results || []).map(r => ({
    title: r.title as string,
    severity: r.severity as string,
    traceability: {
      source_run_id: r.source_run_id || null,
      cluster_id: r.cluster_id || null,
      sub_catalyst_name: r.sub_catalyst_name || null,
    },
  }));

  // Build summary
  const redMetrics = (topMetrics.results || []).filter(m => m.status === 'red').length;
  const summary = `Business health ${overallScore}/100${overallScore > 0 ? `, trending ${overallScore >= 75 ? 'stable' : overallScore >= 60 ? 'cautious' : 'critical'}` : ''}. ${(criticalCount?.count as number) || 0} critical findings, ${(warningCount?.count as number) || 0} warnings this week. ${redMetrics} metric(s) require immediate attention. ${(topRisks.results || []).length} active risk alert(s).`;

  const recommendedActions: string[] = [];
  if (redMetrics > 0) recommendedActions.push('Address RED metrics — view Pulse for operational detail');
  if ((topRisks.results || []).length > 0) recommendedActions.push('Review active risk alerts in Apex');
  if ((criticalCount?.count as number) > 0) recommendedActions.push('Investigate critical insights from recent catalyst runs');
  if (recommendedActions.length === 0) recommendedActions.push('All systems nominal — review Pulse for optimization opportunities');

  return {
    summary,
    keyMetrics,
    topRisks: topRiskList,
    recommendedActions,
  };
}
