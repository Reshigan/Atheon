import { Hono } from 'hono';
import type { AppBindings, AuthContext, Env } from '../types';
import { executeTask, approveAction, rejectAction } from '../services/catalyst-engine';
import { triggerDownstream } from '../services/catalyst-dag';
import { getValidatedJsonBody } from '../middleware/validation';
import {
  INDUSTRY_TEMPLATES,
  CATALYST_CATALOG,
  getTemplateForIndustry,
  getStarterClusters,
} from '../services/catalyst-templates';
import { getApprovalEmailTemplate, getEscalationEmailTemplate, getRunResultsEmailTemplate, sendOrQueueEmail } from '../services/email';
import { recordRun, recalculateKpis, getRuns, getRunDetail, getKpis, getRunItems, compareRuns, getKpiDefinitions, updateKpiDefinition } from '../services/sub-catalyst-ops';
import { generateKpiDefinitions } from '../services/kpi-definitions';
import { loadLlmConfig, llmChatWithFallback, stripCodeFences, checkAndReserveBudget, recordLlmUsage, estimateTokensFor } from '../services/llm-provider';
import type { LlmMessage } from '../services/llm-provider';
import { logInfo, logWarn } from '../services/logger';
import { generateRunNarrative, NarrativeError } from '../services/catalyst-narrative';

const catalysts = new Hono<AppBindings>();

/**
 * Sentinel returned by resolveCompanyScope when a company_id was supplied but
 * did not belong to the target tenant. Callers map this to a 404. Using a
 * sentinel (rather than throwing) keeps the endpoints linear and lets each
 * one return the company-scoped 404 in its own voice.
 */
const COMPANY_REJECTED = '__COMPANY_NOT_FOUND__';

/**
 * Read an optional per-company scope from the request (query param
 * `?company_id=` or JSON body `company_id`). When present, verify the
 * company belongs to `targetTenant`.
 *
 * Returns:
 *  - `null` (or `undefined`) when no company_id was supplied → consolidated.
 *  - The validated company_id string when it belongs to the tenant.
 *  - `COMPANY_REJECTED` when a value was supplied but did not validate —
 *    the caller must respond with 404 in this case.
 */
async function resolveCompanyScope(
  c: { req: { query: (k: string) => string | undefined; header: (k: string) => string | undefined; json: <T = unknown>() => Promise<T> }; env: { DB: D1Database } },
  targetTenant: string,
): Promise<string | null | typeof COMPANY_REJECTED> {
  let raw: string | undefined = c.req.query('company_id');

  // Body fallback — only try JSON if Content-Type looks like JSON.
  if (!raw) {
    const contentType = (c.req.header('content-type') || '').toLowerCase();
    if (contentType.includes('application/json')) {
      try {
        const body = await c.req.json<{ company_id?: string }>();
        if (body && typeof body.company_id === 'string') raw = body.company_id;
      } catch {
        // Body not parseable / not present — fall through to no-scope.
      }
    }
  }

  if (!raw) return null;
  const companyId = raw.trim();
  if (!companyId) return null;

  const exists = await c.env.DB.prepare(
    'SELECT id FROM erp_companies WHERE tenant_id = ? AND id = ?',
  ).bind(targetTenant, companyId).first<{ id: string }>();

  if (!exists) return COMPANY_REJECTED;
  return companyId;
}

/**
 * Write an execution log entry.
 * When status is 'running', inserts a new row.
 * When status is 'completed'/'failed', updates the existing 'running' row for the same step
 * (falls back to INSERT if no running row exists).
 */
async function writeLog(db: D1Database, tenantId: string, actionId: string, stepNumber: number, stepName: string, status: string, detail: string, durationMs?: number): Promise<void> {
  try {
    if (status !== 'running') {
      // Try to update an existing 'running' row for this step
      const updated = await db.prepare(
        'UPDATE execution_logs SET status = ?, detail = ?, duration_ms = ? WHERE tenant_id = ? AND action_id = ? AND step_number = ? AND step_name = ? AND status = ?'
      ).bind(status, detail, durationMs ?? null, tenantId, actionId, stepNumber, stepName, 'running').run();
      if (updated.meta.changes && updated.meta.changes > 0) return;
    }
    // Insert new row (either 'running' status, or fallback if no running row to update)
    await db.prepare(
      'INSERT INTO execution_logs (id, tenant_id, action_id, step_number, step_name, status, detail, duration_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, actionId, stepNumber, stepName, status, detail, durationMs ?? null).run();
  } catch (err) { console.error('writeLog: execution_logs table may not exist yet:', err); }
}

/**
 * Map a catalyst domain to the health-score dimension(s) it affects.
 * Each catalyst only updates its relevant dimensions, leaving others untouched.
 */
function domainToDimensions(domain: string): string[] {
  const map: Record<string, string[]> = {
    // Finance-related domains
    'finance': ['financial'],
    // Procurement & supply chain
    'procurement': ['operational', 'financial'],
    'supply-chain': ['operational'],
    // HR / workforce
    'hr': ['operational', 'strategic'],
    // Sales
    'sales': ['financial', 'strategic'],
    // Compliance-related
    'mining-safety': ['compliance'],
    'mining-environment': ['compliance'],
    'health-compliance': ['compliance'],
    // Healthcare
    'health-supply': ['technology', 'operational'],
    'health-patient': ['operational'],
    'health-staffing': ['operational'],
    'health-experience': ['strategic', 'operational'],
    // Industry-specific operational
    'mining-equipment': ['technology', 'operational'],
    'mining-ore': ['operational'],
    // Agriculture
    'agri-crop': ['operational', 'technology'],
    'agri-irrigation': ['technology'],
    'agri-quality': ['compliance'],
    'agri-market': ['strategic'],
    // Logistics
    'logistics-fleet': ['operational'],
    'logistics-warehouse': ['operational'],
    'logistics-compliance': ['compliance'],
    // Technology
    'tech-devops': ['technology'],
    'tech-security': ['technology', 'compliance'],
    'tech-product': ['strategic', 'technology'],
    'tech-customer-success': ['strategic', 'operational'],
    // Manufacturing
    'mfg-production': ['operational'],
    'mfg-quality': ['compliance', 'operational'],
    'mfg-maintenance': ['technology', 'operational'],
    'mfg-energy': ['technology', 'operational'],
    // FMCG
    'fmcg-trade': ['financial', 'strategic'],
    'fmcg-distributor': ['operational', 'strategic'],
    'fmcg-launch': ['strategic'],
    'fmcg-shelf': ['strategic', 'operational'],
  };
  return map[domain] || ['operational'];
}

/**
 * Map a catalyst domain to its primary risk category.
 */
function domainToRiskCategory(domain: string): string {
  if (domain.includes('compliance') || domain.includes('safety') || domain.includes('environment') || domain.includes('quality')) return 'compliance';
  if (domain.includes('finance') || domain.startsWith('fin-') || domain === 'sales' || domain === 'procurement') return 'financial';
  if (domain.includes('tech') || domain.includes('data') || domain.includes('devops') || domain.includes('security')) return 'technology';
  return 'operational';
}

/**
 * Human-friendly label for a domain key.
 */
function friendlyDomain(domain: string): string {
  const map: Record<string, string> = {
    'finance': 'Financial Operations',
    'procurement': 'Procurement & Sourcing',
    'supply-chain': 'Supply Chain',
    'hr': 'Human Resources',
    'sales': 'Sales & Revenue',
    'mining-safety': 'Workplace Safety',
    'mining-environment': 'Environmental Compliance',
    'mining-equipment': 'Equipment & Machinery',
    'mining-ore': 'Ore Processing & Quality',
    'health-compliance': 'Healthcare Compliance',
    'health-supply': 'Medical Supply Chain',
    'health-patient': 'Patient Care',
    'health-staffing': 'Staffing & Workforce',
    'health-experience': 'Patient Experience',
    'agri-crop': 'Crop Management',
    'agri-irrigation': 'Irrigation Systems',
    'agri-quality': 'Produce Quality',
    'agri-market': 'Market & Pricing',
    'logistics-fleet': 'Fleet Management',
    'logistics-warehouse': 'Warehouse Operations',
    'logistics-compliance': 'Logistics Compliance',
    'tech-devops': 'DevOps & Infrastructure',
    'tech-security': 'Cybersecurity',
    'tech-product': 'Product Development',
    'tech-customer-success': 'Customer Success',
    'mfg-production': 'Production Line',
    'mfg-quality': 'Quality Assurance',
    'mfg-maintenance': 'Plant Maintenance',
    'mfg-energy': 'Energy Management',
    'fmcg-trade': 'Trade Spend',
    'fmcg-distributor': 'Distributor Network',
    'fmcg-launch': 'Product Launch',
    'fmcg-shelf': 'Shelf Performance',
  };
  return map[domain] || domain.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/**
 * Human-friendly label for a risk category.
 */
function friendlyCategory(cat: string): string {
  const map: Record<string, string> = {
    'compliance': 'Compliance & Governance',
    'financial': 'Financial',
    'technology': 'Technology & Systems',
    'operational': 'Operational',
  };
  return map[cat] || cat.charAt(0).toUpperCase() + cat.slice(1);
}

/**
 * Human-friendly label for a dimension key.
 */
function friendlyDimension(dim: string): string {
  const map: Record<string, string> = {
    'financial': 'Financial Health',
    'operational': 'Operational Efficiency',
    'compliance': 'Compliance & Governance',
    'strategic': 'Strategic Alignment',
    'technology': 'Technology Readiness',
    'risk': 'Risk Posture',
    'catalyst': 'Catalyst Performance',
    'process': 'Process Maturity',
  };
  return map[dim] || dim.charAt(0).toUpperCase() + dim.slice(1);
}

/**
 * Generate a human-friendly risk title based on severity and domain.
 */
function friendlyRiskTitle(severity: string, domain: string): string {
  const domainLabel = friendlyDomain(domain);
  if (severity === 'high') return `Elevated risk detected in ${domainLabel}`;
  if (severity === 'medium') return `Moderate concern flagged in ${domainLabel}`;
  return `Minor observation noted in ${domainLabel}`;
}

/**
 * Check if a role has admin-level privileges (superadmin, support_admin, admin, or system_admin).
 */
function isAdminRole(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'system_admin';
}

/**
 * Check if a role can override tenant_id (cross-tenant access).
 */
function canCrossTenant(role: string | undefined): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'system_admin';
}

/**
 * Generate a human-friendly risk description.
 */
function friendlyRiskDescription(severity: string, domain: string, catalystName: string): string {
  const domainLabel = friendlyDomain(domain);
  if (severity === 'high') {
    return `During routine analysis, ${catalystName} identified a significant risk indicator within ${domainLabel}. This warrants immediate attention from the relevant stakeholders to assess potential business impact and agree on next steps.`;
  }
  if (severity === 'medium') {
    return `${catalystName} flagged a moderate-level concern within ${domainLabel}. While not critical, this should be reviewed within the current planning cycle to prevent escalation.`;
  }
  return `${catalystName} noted a low-level observation within ${domainLabel}. No immediate action is needed, but it should be tracked as part of ongoing monitoring.`;
}

/**
 * Calculate the next run time for a scheduled sub-catalyst.
 */
function calculateNextRun(
  frequency: string,
  dayOfWeek?: number,
  dayOfMonth?: number,
  timeOfDay?: string,
): string {
  const now = new Date();
  const [hours, minutes] = (timeOfDay || '06:00').split(':').map(Number);

  if (frequency === 'daily') {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    if (next <= now) next.setUTCDate(next.getUTCDate() + 1);
    return next.toISOString();
  }

  if (frequency === 'weekly' && dayOfWeek !== undefined) {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    const currentDay = next.getUTCDay();
    let daysUntil = dayOfWeek - currentDay;
    if (daysUntil < 0) daysUntil += 7;
    if (daysUntil === 0 && next <= now) daysUntil = 7;
    next.setUTCDate(next.getUTCDate() + daysUntil);
    return next.toISOString();
  }

  if (frequency === 'monthly' && dayOfMonth !== undefined) {
    const next = new Date(now);
    next.setUTCHours(hours, minutes, 0, 0);
    next.setUTCDate(dayOfMonth);
    if (next <= now) {
      next.setUTCMonth(next.getUTCMonth() + 1);
      next.setUTCDate(dayOfMonth);
    }
    return next.toISOString();
  }

  // manual — no next run
  return '';
}

/**
 * Generate Apex/Pulse insight data for a tenant after catalyst execution.
 * INCREMENTAL: Only updates the dimensions and risk categories relevant to the catalyst domain.
 * When only one catalyst has run, the dashboard shows scoped data for that domain.
 * As more catalysts run, the dashboard consolidates across all domains.
 */
async function generateInsightsForTenant(db: D1Database, tenantId: string, catalystName: string, domain: string, actionId?: string, sourceRunId?: string, clusterId?: string, subCatalystName?: string): Promise<void> {
  const now = new Date().toISOString();
  const logId = actionId || 'system';
  let step = 1;
  const affectedDimensions = domainToDimensions(domain);
  const riskCategory = domainToRiskCategory(domain);
  const domainLabel = friendlyDomain(domain);
  const categoryLabel = friendlyCategory(riskCategory);

  // Step 1: Initialisation
  const t0 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Initialisation', 'completed', `${catalystName} started analysis of ${domainLabel}. Updating: ${affectedDimensions.map(friendlyDimension).join(', ')}.`, Date.now() - t0);
  step++;

  // Step 2: Incremental Health Score — only update affected dimensions
  const t1 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Health Score Calculation', 'running', `Recalculating ${affectedDimensions.length} health dimension(s): ${affectedDimensions.map(friendlyDimension).join(', ')}`, 0);

  // Fetch existing health scores to merge with
  let existingDimensions: Record<string, { 
    score: number; 
    trend: string; 
    delta: number;
    contributors?: string[] | Record<string, unknown>;
    sourceRunId?: string | null;
    catalystName?: string;
    kpiContributors?: Array<{ name: string; value: number; status: string }>;
    lastUpdated?: string;
  }> = {};
  let existingId: string | null = null;
  let previousOverallScore = 0;
  try {
    const existing = await db.prepare('SELECT id, overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ id: string; overall_score: number; dimensions: string }>();
    if (existing) {
      existingId = existing.id;
      previousOverallScore = existing.overall_score ?? 0;
      const parsed = JSON.parse(existing.dimensions);
      if (parsed && typeof parsed === 'object') existingDimensions = parsed;
    }
  } catch (err) { console.error('generateInsights: failed to read existing health data:', err); }

  // Data-driven: derive dimension scores from the specific catalyst run (scoped to sourceRunId or clusterId)
  let latestRunConfidence = 0;
  let latestRunSuccess = 0;
  let latestRunTotal = 0;
  let latestRunDiscrepancies = 0;
  try {
    let recentRun: { avg_confidence: number; source_record_count: number; matched: number; discrepancies: number } | null = null;
    if (sourceRunId) {
      recentRun = await db.prepare(
        'SELECT avg_confidence, source_record_count, matched, discrepancies FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
      ).bind(sourceRunId, tenantId).first<{ avg_confidence: number; source_record_count: number; matched: number; discrepancies: number }>();
    } else if (clusterId) {
      recentRun = await db.prepare(
        'SELECT avg_confidence, source_record_count, matched, discrepancies FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? ORDER BY started_at DESC LIMIT 1'
      ).bind(tenantId, clusterId).first<{ avg_confidence: number; source_record_count: number; matched: number; discrepancies: number }>();
    } else {
      recentRun = await db.prepare(
        'SELECT avg_confidence, source_record_count, matched, discrepancies FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 1'
      ).bind(tenantId).first<{ avg_confidence: number; source_record_count: number; matched: number; discrepancies: number }>();
    }
    if (recentRun) {
      latestRunConfidence = recentRun.avg_confidence ?? 0;
      latestRunTotal = recentRun.source_record_count ?? 0;
      latestRunSuccess = recentRun.matched ?? 0;
      latestRunDiscrepancies = recentRun.discrepancies ?? 0;
    }
  } catch { /* table may not exist yet */ }

  for (const dim of affectedDimensions) {
    // Base score from success rate (matched/total), then avg_confidence as tiebreaker; 0 if no runs yet
    const successRate = latestRunTotal > 0 ? latestRunSuccess / latestRunTotal : 0;
    const baseScore = latestRunTotal > 0
      ? Math.round((latestRunConfidence > 0 ? (successRate * 0.7 + latestRunConfidence * 0.3) : successRate) * 100)
      : 0;
    // Clamp between 0 and 100
    const score = Math.max(0, Math.min(100, baseScore));
    const prevScore = existingDimensions[dim]?.score ?? score;
    const delta = Math.round((score - prevScore) * 10) / 10;
    const trend = delta > 0.5 ? 'improving' : delta < -0.5 ? 'declining' : 'stable';
    
    // Build contributor tracking for traceability
    const contributors: string[] = [];
    if (subCatalystName) contributors.push(subCatalystName);
    if (clusterId) contributors.push(clusterId);
    
    // Get KPIs that contributed to this dimension
    const kpiContributors = await db.prepare(
      'SELECT kd.kpi_name, kv.value, kv.status FROM sub_catalyst_kpi_values kv JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id WHERE kd.tenant_id = ? AND kd.cluster_id = ? AND kd.sub_catalyst_name = ? AND kd.enabled = 1 LIMIT 10'
    ).bind(tenantId, clusterId || '', subCatalystName || '').all<{ kpi_name: string; value: number; status: string }>();
    
    const kpiDetails = (kpiContributors.results || []).map(k => ({
      name: k.kpi_name,
      value: k.value,
      status: k.status,
    }));
    
    existingDimensions[dim] = { 
      score, 
      trend, 
      delta,
      contributors,
      sourceRunId: sourceRunId || null,
      catalystName: catalystName,
      kpiContributors: kpiDetails,
      lastUpdated: now,
    };
  }

  // Recalculate overall from only the populated dimensions
  const populatedDims = Object.values(existingDimensions);
  const overallScore = populatedDims.length > 0
    ? Math.round(populatedDims.reduce((sum, d) => sum + d.score, 0) / populatedDims.length)
    : 0;

  try {
    if (existingId) {
      await db.prepare(
        'UPDATE health_scores SET overall_score = ?, dimensions = ?, calculated_at = ? WHERE id = ?'
      ).bind(overallScore, JSON.stringify(existingDimensions), now, existingId).run();
    } else {
      await db.prepare(
        'INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, overallScore, JSON.stringify(existingDimensions), now).run();
    }
  } catch (err) { console.error('generateInsights: health_scores upsert failed:', err); }

  // A1-2: Write health score history row for trend tracking
  try {
    await db.prepare(
      'INSERT INTO health_score_history (id, tenant_id, overall_score, dimensions, source_run_id, catalyst_name, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, overallScore, JSON.stringify(existingDimensions), sourceRunId || null, catalystName, now).run();
  } catch (err) { console.error('generateInsights: health_score_history insert failed:', err); }

  const dimCount = Object.keys(existingDimensions).length;
  await writeLog(db, tenantId, logId, step, 'Health Score Calculation', 'completed', `Health score updated — overall ${overallScore}/100 across ${dimCount} dimension(s)`, Date.now() - t1);
  step++;

  // Step 3: Risk Alert — with source attribution (P1)
  const t2 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Risk Alert Generation', 'running', `Scanning ${domainLabel} for ${categoryLabel.toLowerCase()} risk indicators...`, 0);
  // Data-driven risk: derive severity from run success rate
  const successRate = latestRunTotal > 0 ? latestRunSuccess / latestRunTotal : 1;
  const riskSeverity = successRate < 0.7 ? 'high' : successRate < 0.9 ? 'medium' : 'low';
  // Impact proportional to actual discrepancy count (matched records with field-level differences)
  const discrepancyCount = latestRunDiscrepancies;
  const riskImpact = riskSeverity === 'high' ? discrepancyCount * 5000 : riskSeverity === 'medium' ? discrepancyCount * 2000 : discrepancyCount * 500;
  const riskTitle = friendlyRiskTitle(riskSeverity, domain);
  const riskDesc = friendlyRiskDescription(riskSeverity, domain, catalystName);
  try {
    await db.prepare(
      'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at, source_run_id, cluster_id, sub_catalyst_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId,
      riskTitle, riskDesc,
      riskSeverity, riskCategory, Math.round(Math.max(0.1, 1 - successRate) * 100) / 100,
      riskImpact, 'ZAR',
      JSON.stringify([`Review ${domainLabel} findings and assess exposure`, `Assign a remediation owner from the ${categoryLabel} team`, `Schedule a follow-up review within 14 days`]),
      'active', now,
      sourceRunId || null, clusterId || null, subCatalystName || null
    ).run();
  } catch (err) { console.error('generateInsights: risk_alerts insert failed:', err); }
  await writeLog(db, tenantId, logId, step, 'Risk Alert Generation', 'completed', `${categoryLabel} risk alert raised (${riskSeverity} severity)`, Date.now() - t2);
  step++;

  // Step 4: Data-Driven Executive Briefing (A2)
  const t3 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Executive Briefing', 'running', `Preparing data-driven executive summary for ${domainLabel}...`, 0);
  try {
    // A2-1: Query real data for briefing
    const healthDelta = overallScore - previousOverallScore;
    const redMetrics = await db.prepare('SELECT COUNT(*) as cnt FROM process_metrics WHERE tenant_id = ? AND status = ?').bind(tenantId, 'red').first<{ cnt: number }>();
    const redMetricCount = redMetrics?.cnt ?? 0;
    const openAnomalies = await db.prepare('SELECT COUNT(*) as cnt FROM anomalies WHERE tenant_id = ? AND status = ?').bind(tenantId, 'open').first<{ cnt: number }>();
    const anomalyCount = openAnomalies?.cnt ?? 0;
    const activeRisks = await db.prepare('SELECT COUNT(*) as cnt FROM risk_alerts WHERE tenant_id = ? AND status = ?').bind(tenantId, 'active').first<{ cnt: number }>();
    const activeRiskCount = activeRisks?.cnt ?? 0;

    // A2-1: KPI movements from last 7 days
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentKpis = await db.prepare(
      'SELECT name, value, status FROM process_metrics WHERE tenant_id = ? AND measured_at >= ? ORDER BY measured_at DESC LIMIT 10'
    ).bind(tenantId, sevenDaysAgo).all<{ name: string; value: number; status: string }>();
    const kpiMovements = (recentKpis.results || []).map(k => ({
      metric: k.name,
      change: `${k.status === 'red' ? 'Degraded' : k.status === 'amber' ? 'Watchlisted' : 'On track'} (${k.value})`,
      period: 'last 7 days',
    })).slice(0, 5);

    // Recent runs summary
    const recentRuns = await db.prepare(
      'SELECT COUNT(*) as cnt FROM sub_catalyst_runs WHERE tenant_id = ? AND started_at >= ?'
    ).bind(tenantId, sevenDaysAgo).first<{ cnt: number }>();
    const runCount = recentRuns?.cnt ?? 0;

    // A2-2: Build structured briefing with real numbers
    const healthDeltaStr = `${healthDelta > 0 ? '+' : ''}${healthDelta}`;
    const summary = `Health score is ${overallScore}/100 (${healthDeltaStr} points this period). ${runCount} catalyst runs completed in the last 7 days. ${redMetricCount > 0 ? `${redMetricCount} metric(s) in RED status require attention.` : 'All metrics within acceptable ranges.'} ${anomalyCount > 0 ? `${anomalyCount} open anomaly(ies) detected.` : ''} ${activeRiskCount > 0 ? `${activeRiskCount} active risk alert(s).` : ''}`;

    const risks: string[] = [];
    if (redMetricCount > 0) risks.push(`${redMetricCount} process metric(s) in RED status — immediate review recommended`);
    if (anomalyCount > 0) risks.push(`${anomalyCount} unresolved anomaly(ies) — investigate root cause`);
    if (activeRiskCount > 0) risks.push(`${activeRiskCount} active risk alert(s) — assign remediation owners`);
    if (healthDelta < -5) risks.push(`Health score declined ${Math.abs(healthDelta)} points — trend reversal needed`);
    if (risks.length === 0) risks.push('No critical risks identified this period');

    const opportunities: string[] = [];
    if (healthDelta > 0) opportunities.push(`Health score improved ${healthDelta} points — momentum to build on`);
    opportunities.push(`Explore efficiency improvements in ${domainLabel} to reduce cost and cycle time`);
    if (runCount > 5) opportunities.push(`High run frequency (${runCount} runs/week) enables early anomaly detection`);

    const decisions: string[] = [];
    if (redMetricCount > 0) decisions.push(`Assign owners for ${redMetricCount} RED metric(s) and set remediation deadlines`);
    if (activeRiskCount > 0) decisions.push(`Review ${activeRiskCount} active risk(s) and approve mitigation plans`);
    decisions.push(`Review the ${domainLabel} risk findings and agree on next steps`);

    // A2-3: Insert data-driven briefing
    await db.prepare(
      'INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at, health_delta, red_metric_count, anomaly_count, active_risk_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId,
      `${domainLabel} — Executive Summary`,
      summary,
      JSON.stringify(risks),
      JSON.stringify(opportunities),
      JSON.stringify(kpiMovements),
      JSON.stringify(decisions),
      now,
      healthDelta, redMetricCount, anomalyCount, activeRiskCount
    ).run();
  } catch (err) { console.error('generateInsights: executive_briefings insert failed:', err); }
  await writeLog(db, tenantId, logId, step, 'Executive Briefing', 'completed', `Data-driven executive summary generated for ${domainLabel}`, Date.now() - t3);
  step++;

  // Step 5: Process Metrics — with source attribution (P1) and real trends (P2)
  const t4 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Process Metrics', 'running', `Capturing ${domainLabel} performance metrics...`, 0);
  // Data-driven process metrics from actual run results
  const throughputValue = latestRunTotal > 0 ? latestRunTotal : 0;
  const errorRateValue = latestRunTotal > 0 ? Math.round((1 - successRate) * 100 * 100) / 100 : 0;
  const processMetrics = [
    { name: `${domainLabel} — Throughput`, value: throughputValue, unit: 'records', status: (throughputValue > 50 ? 'green' : throughputValue > 10 ? 'amber' : 'red') as 'green' | 'amber' | 'red' },
    { name: `${domainLabel} — Success Rate`, value: Math.round(successRate * 100 * 100) / 100, unit: '%', status: (successRate >= 0.95 ? 'green' : successRate >= 0.8 ? 'amber' : 'red') as 'green' | 'amber' | 'red' },
    { name: `${domainLabel} — Error Rate`, value: errorRateValue, unit: '%', status: (errorRateValue <= 2 ? 'green' : errorRateValue <= 10 ? 'amber' : 'red') as 'green' | 'amber' | 'red' },
  ];
  // Clean up any old-format metrics for this domain (pre-friendly-label format)
  try {
    await db.prepare("DELETE FROM process_metrics WHERE tenant_id = ? AND name LIKE ?").bind(tenantId, `${domain} %`).run();
  } catch (err) { console.error('generateInsights: process_metrics cleanup failed:', err); }

  for (const metric of processMetrics) {
    try {
      // P2-1: Read existing trend, append new value, cap at 30
      let trendArr: number[] = [];
      const existingMetric = await db.prepare(
        'SELECT id, trend FROM process_metrics WHERE tenant_id = ? AND name = ? ORDER BY measured_at DESC LIMIT 1'
      ).bind(tenantId, metric.name).first<{ id: string; trend: string }>();

      if (existingMetric) {
        try { trendArr = JSON.parse(existingMetric.trend || '[]'); } catch { trendArr = []; }
        trendArr.push(metric.value);
        if (trendArr.length > 30) trendArr = trendArr.slice(-30);
        // Update existing metric row
        await db.prepare(
          'UPDATE process_metrics SET value = ?, status = ?, trend = ?, measured_at = ?, sub_catalyst_name = ?, source_run_id = ?, cluster_id = ? WHERE id = ?'
        ).bind(metric.value, metric.status, JSON.stringify(trendArr), now, subCatalystName || null, sourceRunId || null, clusterId || null, existingMetric.id).run();
      } else {
        trendArr = [metric.value];
        // P1-2: Insert with source attribution fields
        await db.prepare(
          'INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, trend, source_system, measured_at, sub_catalyst_name, source_run_id, cluster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), tenantId, metric.name, metric.value, metric.unit, metric.status, JSON.stringify(trendArr), catalystName, now, subCatalystName || null, sourceRunId || null, clusterId || null).run();
      }
    } catch (err) { console.error('generateInsights: process_metrics upsert failed:', err); }
  }
  await writeLog(db, tenantId, logId, step, 'Process Metrics', 'completed', `${processMetrics.length} performance metrics captured for ${domainLabel}`, Date.now() - t4);
  step++;

  // Step 6: Anomaly Detection — scoped to this domain
  const t5 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Anomaly Detection', 'running', `Scanning ${domainLabel} for unusual patterns...`, 0);
  // Clean up old-format anomaly rows for this domain
  try {
    await db.prepare("DELETE FROM anomalies WHERE tenant_id = ? AND metric = ?").bind(tenantId, `${domain} throughput`).run();
    await db.prepare("DELETE FROM anomalies WHERE tenant_id = ? AND metric = ?").bind(tenantId, `${domainLabel} throughput`).run();
  } catch (err) { console.error('generateInsights: anomalies cleanup failed:', err); }
  // Data-driven anomaly detection: only flag if error rate exceeds 10% or throughput drops significantly
  const anomalyTriggered = errorRateValue > 10 || (throughputValue > 0 && throughputValue < 10);
  if (anomalyTriggered) {
    try {
      const expected = 100;
      const actual = latestRunTotal > 0 ? Math.round(successRate * 100) : expected;
      const deviation = Math.round((actual - expected) / expected * 100 * 10) / 10;
      await db.prepare(
        'INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), tenantId,
        `${domainLabel} throughput`,
        Math.abs(deviation) > 15 ? 'high' : Math.abs(deviation) > 5 ? 'medium' : 'low',
        expected, actual, deviation,
        `An unusual throughput pattern was detected in ${domainLabel}. The observed value deviates ${Math.abs(deviation).toFixed(1)}% from the expected baseline, which may indicate a process change or external factor.`,
        'open', now
      ).run();
    } catch (err) { console.error('generateInsights: anomaly insert failed:', err); }
    await writeLog(db, tenantId, logId, step, 'Anomaly Detection', 'completed', `Anomaly detected in ${domainLabel} — flagged for review`, Date.now() - t5);
  } else {
    await writeLog(db, tenantId, logId, step, 'Anomaly Detection', 'completed', `No anomalies detected in ${domainLabel}`, Date.now() - t5);
  }
  step++;

  // Step 7: Correlation Detection (P3) — detect cross-domain metric movements within 7-day window
  const t6 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Correlation Detection', 'running', `Scanning for cross-domain metric correlations...`, 0);
  try {
    const window7d = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentRedMetrics = await db.prepare(
      "SELECT name, value, status, source_system, measured_at FROM process_metrics WHERE tenant_id = ? AND status IN ('red', 'amber') AND measured_at >= ? ORDER BY measured_at DESC"
    ).bind(tenantId, window7d).all<{ name: string; value: number; status: string; source_system: string; measured_at: string }>();

    const metricsByDomain: Record<string, Array<{ name: string; value: number; status: string; measuredAt: string }>> = {};
    for (const m of (recentRedMetrics.results || [])) {
      const d = (m.source_system || 'unknown').toLowerCase();
      if (!metricsByDomain[d]) metricsByDomain[d] = [];
      metricsByDomain[d].push({ name: m.name, value: m.value, status: m.status, measuredAt: m.measured_at });
    }

    const domainKeys = Object.keys(metricsByDomain);
    let correlationsInserted = 0;
    if (domainKeys.length >= 2) {
      for (let i = 0; i < domainKeys.length && correlationsInserted < 3; i++) {
        for (let j = i + 1; j < domainKeys.length && correlationsInserted < 3; j++) {
          const metricsA = metricsByDomain[domainKeys[i]];
          const metricsB = metricsByDomain[domainKeys[j]];
          // Check temporal proximity — within 24 hours
          const aTime = new Date(metricsA[0].measuredAt).getTime();
          const bTime = new Date(metricsB[0].measuredAt).getTime();
          const timeDiffHours = Math.abs(aTime - bTime) / (1000 * 60 * 60);
          if (timeDiffHours > 168) continue; // Skip if > 7 days apart
          const confidence = Math.max(0.3, Math.min(0.95, 1 - (timeDiffHours / 168)));

          // P3-3: Deduplication — no duplicates within 30 days
          const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
          const existingCorr = await db.prepare(
            "SELECT id FROM correlation_events WHERE tenant_id = ? AND metric_a = ? AND metric_b = ? AND detected_at >= ?"
          ).bind(tenantId, metricsA[0].name, metricsB[0].name, thirtyDaysAgo).first<{ id: string }>();
          if (existingCorr) continue;

          await db.prepare(
            'INSERT INTO correlation_events (id, tenant_id, metric_a, metric_b, correlation_type, confidence, lag_hours, description, detected_at, source_run_id, cluster_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(
            crypto.randomUUID(), tenantId,
            metricsA[0].name, metricsB[0].name,
            'temporal', Math.round(confidence * 100) / 100,
            Math.round(timeDiffHours * 10) / 10,
            `${metricsA[0].name} (${metricsA[0].status}) and ${metricsB[0].name} (${metricsB[0].status}) both showed degradation within ${Math.round(timeDiffHours)}h, suggesting a linked process dependency.`,
            now,
            sourceRunId || null, clusterId || null
          ).run();
          correlationsInserted++;
        }
      }
    }
    if (correlationsInserted > 0) {
      await writeLog(db, tenantId, logId, step, 'Correlation Detection', 'completed', `${correlationsInserted} cross-domain correlation(s) detected`, Date.now() - t6);
    } else {
      await writeLog(db, tenantId, logId, step, 'Correlation Detection', 'completed', 'No new cross-domain correlations detected', Date.now() - t6);
    }
  } catch (err) {
    console.error('generateInsights: correlation detection failed:', err);
    await writeLog(db, tenantId, logId, step, 'Correlation Detection', 'completed', 'Correlation detection completed with no findings', Date.now() - t6);
  }
  step++;

  // Step 8: Finalisation
  await writeLog(db, tenantId, logId, step, 'Finalisation', 'completed', `Analysis complete for ${domainLabel}. All insights have been published.`, Date.now() - t0);
}

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

// GET /api/catalysts/clusters
catalysts.get('/clusters', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  const tenantId = canCrossTenant(auth?.role) ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;
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
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  const tenantId = canCrossTenant(auth?.role) ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;

  // Enforce tenant ownership on cluster reads - tenant isolation
  const cl = await c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();

  if (!cl) return c.json({ error: 'Cluster not found' }, 404);

  // Get recent actions (scoped by tenant)
  const actions = await c.env.DB.prepare(
    'SELECT * FROM catalyst_actions WHERE cluster_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT 20'
  ).bind(id, tenantId).all();

  // Get deployments (scoped by tenant)
  const deployments = await c.env.DB.prepare(
    'SELECT * FROM agent_deployments WHERE cluster_id = ? AND tenant_id = ? ORDER BY created_at DESC'
  ).bind(id, tenantId).all();

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
    subCatalysts: safeJsonParse(cl.sub_catalysts as string) || [],
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
  const targetTenant = canCrossTenant(auth?.role) && raw.tenant_id ? raw.tenant_id : tenantId;

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

// GET /api/catalysts/templates - List the flat catalyst catalog
// Returns:
//   - `catalog`: the flat, tag-based catalog (preferred)
//   - `templates`: deprecated industry-grouped shape derived from the catalog,
//                  kept for backwards compatibility with the existing frontend.
catalysts.get('/templates', async (c) => {
  const summarise = (subs: Array<{ implementation?: 'real' | 'generic' | 'stub' }>) => {
    const real = subs.filter(s => s.implementation === 'real').length;
    const generic = subs.filter(s => !s.implementation || s.implementation === 'generic').length;
    const stub = subs.filter(s => s.implementation === 'stub').length;
    const total = subs.length;
    const realRatio = total > 0 ? real / total : 0;
    const maturity: 'production' | 'partial' | 'planned' =
      realRatio >= 0.5 ? 'production' : real > 0 ? 'partial' : 'planned';
    return { real, generic, stub, total, maturity };
  };
  const catalog = CATALYST_CATALOG.map(cl => ({
    name: cl.name,
    domain: cl.domain,
    description: cl.description,
    autonomy_tier: cl.autonomy_tier,
    tags: cl.tags,
    subCatalystCount: cl.sub_catalysts.length,
    sub_catalysts: cl.sub_catalysts,
    implementationSummary: summarise(cl.sub_catalysts),
  }));
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
      implementationSummary: summarise(cl.sub_catalysts),
    })),
  }));
  return c.json({ catalog, templates });
});

// POST /api/catalysts/deploy-template - Deploy all catalyst clusters for an industry template
catalysts.post('/deploy-template', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminRole(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'Only admins can deploy catalyst templates' }, 403);
  }

  const body = await c.req.json<{
    tenant_id: string;
    industry?: string;
    clusters?: Array<{
      name: string; domain: string; description: string; autonomy_tier: string;
      sub_catalysts: Array<{ name: string; enabled: boolean; description: string }>;
    }>;
  }>();

  if (!body.tenant_id) return c.json({ error: 'tenant_id is required' }, 400);

  // Only superadmin/support_admin can deploy to a different tenant
  const callerTenant = auth.tenantId;
  if (body.tenant_id !== callerTenant && !canCrossTenant(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'You can only deploy templates to your own tenant' }, 403);
  }

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(body.tenant_id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Resolve which clusters to deploy. Priority order:
  //   1. Caller-supplied `clusters` (custom selection from the flat catalog)
  //   2. `industry` — legacy path that resolves via the deprecated industry
  //      bucket (derived from CATALYST_CATALOG by tag) so existing API
  //      consumers keep working.
  //   3. Neither provided — deploy the curated starter bundle (finance,
  //      procurement, supply chain, HR, sales, operations, customer intel,
  //      risk, CX, inventory) defined in catalyst-templates.ts. This gives
  //      a tenant a useful baseline without having to choose an industry.
  let clustersToCreate = body.clusters;
  let deploymentSource: string;
  if (clustersToCreate && clustersToCreate.length > 0) {
    deploymentSource = 'custom';
  } else if (body.industry) {
    const template = getTemplateForIndustry(body.industry);
    if (!template) return c.json({ error: `No template found for industry: ${body.industry}` }, 404);
    clustersToCreate = template.clusters.map(cl => ({
      name: cl.name,
      domain: cl.domain,
      description: cl.description,
      autonomy_tier: cl.autonomy_tier,
      sub_catalysts: cl.sub_catalysts,
    }));
    deploymentSource = `industry:${body.industry}`;
  } else {
    clustersToCreate = getStarterClusters().map(cl => ({
      name: cl.name,
      domain: cl.domain,
      description: cl.description,
      autonomy_tier: cl.autonomy_tier,
      sub_catalysts: cl.sub_catalysts,
    }));
    deploymentSource = 'starter';
  }

  // Check for existing clusters for this tenant — skip duplicates by name
  const existing = await c.env.DB.prepare(
    'SELECT id, name FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(body.tenant_id).all<{ id: string; name: string }>();
  const existingNames = new Set((existing.results || []).map(r => r.name));

  const createdIds: string[] = [];
  const skippedNames: string[] = [];
  for (const cl of clustersToCreate) {
    // Skip if a cluster with this name already exists for this tenant
    if (existingNames.has(cl.name)) {
      skippedNames.push(cl.name);
      continue;
    }
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, agent_count, tasks_completed, tasks_in_progress, success_rate, trust_score, autonomy_tier, sub_catalysts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, body.tenant_id, cl.name, cl.domain, cl.description,
      'active', 0, 0, 0, 0, 0, cl.autonomy_tier,
      JSON.stringify(cl.sub_catalysts)
    ).run();
    createdIds.push(id);
    existingNames.add(cl.name);

    // Seed KPI definitions for each sub-catalyst in this cluster
    try {
      const subs = Array.isArray(cl.sub_catalysts) ? cl.sub_catalysts : JSON.parse(cl.sub_catalysts || '[]');
      for (const sub of subs) {
        const subName = typeof sub === 'string' ? sub : (sub.name || sub);
        const subDesc = typeof sub === 'object' && sub !== null ? (sub.description || '') : '';
        const defs = generateKpiDefinitions(subName, subDesc, cl.domain || '', cl.autonomy_tier || '');
        for (const [idx, def] of defs.entries()) {
          await c.env.DB.prepare(
            `INSERT OR IGNORE INTO sub_catalyst_kpi_definitions (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit, direction, threshold_green, threshold_amber, threshold_red, calculation, data_source, category, is_universal, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).bind(
            crypto.randomUUID(), body.tenant_id, id, subName,
            def.name, def.unit, def.direction, def.green, def.amber, def.red,
            def.calculation, def.source, def.category, def.is_universal ? 1 : 0, idx
          ).run();
        }
      }
    } catch (err) {
      console.error(`Failed to seed KPI definitions for cluster ${cl.name}:`, err);
    }
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), body.tenant_id, 'catalyst.template.deployed', 'catalysts', body.tenant_id,
    JSON.stringify({
      industry: body.industry,
      source: deploymentSource,
      clusters_created: createdIds.length,
      existing_clusters: (existing.results || []).length,
      skipped_duplicates: skippedNames,
    }),
    'success'
  ).run().catch(() => {});

  return c.json({
    success: true,
    industry: body.industry,
    source: deploymentSource,
    clustersCreated: createdIds.length,
    clusterIds: createdIds,
    existingClusters: (existing.results || []).length,
    skippedDuplicates: skippedNames,
  }, 201);
});

// DELETE /api/catalysts/clusters/:id - Delete a catalyst cluster
catalysts.delete('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminRole(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'Only admins can delete catalyst clusters' }, 403);
  }

  const tenantId = auth.tenantId;
  // Only superadmin/support_admin can delete from other tenants via query param
  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || tenantId) : tenantId;

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
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can toggle sub-catalysts' }, 403);
  }

  // Admin can manage clusters of other tenants via tenant_id query param
  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

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

const VALID_DS_TYPES = ['erp', 'email', 'cloud_storage', 'upload', 'custom_system'];

type FieldMappingRecord = {
  id: string;
  source_index: number;
  target_index: number;
  source_field: string;
  target_field: string;
  match_type: 'exact' | 'fuzzy' | 'contains' | 'numeric_tolerance' | 'date_range';
  tolerance?: number;
  confidence: number;
  auto_suggested: boolean;
};

type ExecutionConfigRecord = {
  mode: 'reconciliation' | 'validation' | 'sync' | 'extract' | 'compare';
  parameters?: Record<string, unknown>;
};

type ExecutionResultRecord = {
  id: string;
  sub_catalyst: string;
  cluster_id: string;
  executed_at: string;
  duration_ms: number;
  status: 'completed' | 'failed' | 'partial' | 'running';
  mode: string;
  summary: {
    total_records_source: number;
    total_records_target: number;
    matched: number;
    unmatched_source: number;
    unmatched_target: number;
    discrepancies: number;
  };
  discrepancies?: Array<{
    source_record: Record<string, unknown>;
    target_record: Record<string, unknown> | null;
    field: string;
    source_value: unknown;
    target_value: unknown;
    difference?: string;
  }>;
  error?: string;
  reasoning?: string;
  recommendations?: string[];
  matched_records?: Array<{ source: Record<string, unknown>; target: Record<string, unknown>; confidence: number; matched_on: string }>;
  unmatched_source_records?: Array<Record<string, unknown>>;
  unmatched_target_records?: Array<Record<string, unknown>>;
  exception_records?: Array<{ record: Record<string, unknown>; type: string; severity: string; detail: string }>;
  llm_analysis?: {
    reasoning: string;
    recommendations: string[];
    risk_factors: string[];
    industry_context: string;
    confidence_assessment: string;
    erp_specific_notes: string;
  };
};

type SubCatalystRecord = {
  name: string;
  enabled: boolean;
  description?: string;
  data_source?: { type: string; config: Record<string, unknown> };
  data_sources?: Array<{ type: string; config: Record<string, unknown> }>;
  field_mappings?: FieldMappingRecord[];
  execution_config?: ExecutionConfigRecord;
  last_execution?: ExecutionResultRecord;
  schedule?: Record<string, unknown>;
};

function validateDataSourceConfig(ds: { type: string; config: Record<string, unknown> }): string | null {
  if (!ds.type || !VALID_DS_TYPES.includes(ds.type)) {
    return `Invalid data source type. Must be: ${VALID_DS_TYPES.join(', ')}`;
  }
  const config = ds.config || {};
  if (ds.type === 'erp' && !config.erp_type) return 'ERP data source requires erp_type in config';
  if (ds.type === 'email' && !config.mailbox) return 'Email data source requires mailbox in config';
  if (ds.type === 'cloud_storage' && (!config.provider || !config.path)) return 'Cloud storage data source requires provider and path in config';
  if (ds.type === 'custom_system' && !config.system_name) return 'Custom system data source requires system_name in config';
  return null;
}

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-source - Configure single data source (backward compat)
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/data-source', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  const body = await c.req.json<{ type: string; config: Record<string, unknown> }>();
  const validationError = validateDataSourceConfig(body);
  if (validationError) return c.json({ error: validationError }, 400);

  const config = body.config || {};
  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  const dsEntry = { type: body.type, config };
  subs[idx].data_source = dsEntry;
  // Also sync to data_sources array (keep both in sync for backward compat)
  if (!subs[idx].data_sources) subs[idx].data_sources = [];
  subs[idx].data_sources = [dsEntry];

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_source_configured', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, data_source_type: body.type }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// DELETE /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-source - Remove all data sources
catalysts.delete('/clusters/:clusterId/sub-catalysts/:subName/data-source', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  delete subs[idx].data_source;
  delete subs[idx].data_sources;
  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_source_removed', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-sources - Set multiple data sources
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/data-sources', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  const body = await c.req.json<{ data_sources: Array<{ type: string; config: Record<string, unknown> }> }>();
  if (!body.data_sources || !Array.isArray(body.data_sources)) {
    return c.json({ error: 'data_sources must be an array' }, 400);
  }

  // Validate each data source
  for (let i = 0; i < body.data_sources.length; i++) {
    const err = validateDataSourceConfig(body.data_sources[i]);
    if (err) return c.json({ error: `Data source ${i + 1}: ${err}` }, 400);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  const cleaned = body.data_sources.map(ds => ({ type: ds.type, config: ds.config || {} }));
  subs[idx].data_sources = cleaned;
  // Keep data_source in sync (first source for backward compat)
  subs[idx].data_source = cleaned.length > 0 ? cleaned[0] : undefined;
  if (!subs[idx].data_source) delete subs[idx].data_source;

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_sources_configured', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, data_source_count: cleaned.length, types: cleaned.map(d => d.type) }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// DELETE /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/data-sources/:index - Remove a specific data source by index
catalysts.delete('/clusters/:clusterId/sub-catalysts/:subName/data-sources/:index', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const dsIndex = parseInt(c.req.param('index'), 10);
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure data sources' }, 403);
  }

  if (isNaN(dsIndex) || dsIndex < 0) return c.json({ error: 'Invalid data source index' }, 400);

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  const sources = subs[idx].data_sources || [];
  if (dsIndex >= sources.length) return c.json({ error: 'Data source index out of range' }, 400);

  sources.splice(dsIndex, 1);
  subs[idx].data_sources = sources;
  // Keep data_source in sync
  subs[idx].data_source = sources.length > 0 ? sources[0] : undefined;
  if (!subs[idx].data_source) delete subs[idx].data_source;
  if (sources.length === 0) delete subs[idx].data_sources;

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.data_source_removed', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, removed_index: dsIndex }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// ── Field Mapping Endpoints ──

// Known data elements per data source type for smart matching
const KNOWN_FIELDS: Record<string, string[]> = {
  erp: [
    'invoice_number', 'invoice_date', 'amount', 'currency', 'vendor_name', 'vendor_id',
    'customer_name', 'customer_id', 'po_number', 'gl_account', 'cost_center',
    'payment_date', 'payment_reference', 'tax_amount', 'net_amount', 'gross_amount',
    'description', 'quantity', 'unit_price', 'document_number', 'posting_date',
    'due_date', 'payment_terms', 'bank_account', 'transaction_id',
  ],
  email: [
    'subject', 'sender', 'date', 'body', 'attachment_name', 'reference_number',
    'amount_mentioned', 'invoice_reference', 'payment_confirmation',
  ],
  cloud_storage: [
    'file_name', 'file_date', 'sheet_name', 'column_a', 'column_b', 'column_c',
    'reference', 'amount', 'date', 'description', 'account_number',
  ],
  upload: [
    'column_1', 'column_2', 'column_3', 'reference', 'amount', 'date',
    'description', 'account', 'name', 'id',
  ],
  custom_system: [
    'transaction_id', 'reference', 'amount', 'date', 'status', 'account_number',
    'bank_reference', 'statement_date', 'debit', 'credit', 'balance',
    'counterparty', 'narrative', 'value_date', 'entry_date',
  ],
};

// Split a normalized field name into semantic tokens (e.g. 'vendorid' -> ['vendor','id'], 'invoice_number' -> ['invoice','number'])
function tokenizeFieldName(raw: string): string[] {
  // First split on delimiters
  const parts = raw.toLowerCase().split(/[_\-\s]+/).filter(Boolean);
  // Then split camelCase-style concatenated words using known vocabulary
  const vocab = [
    'invoice', 'vendor', 'customer', 'payment', 'transaction', 'account',
    'amount', 'number', 'name', 'date', 'reference', 'description',
    'balance', 'credit', 'debit', 'status', 'bank', 'posting',
    'document', 'cost', 'center', 'price', 'unit', 'quantity',
    'gross', 'net', 'tax', 'due', 'terms', 'currency', 'value',
    'total', 'sum', 'id', 'code', 'ref', 'type', 'file', 'sheet',
    'column', 'body', 'subject', 'sender', 'attachment', 'entry',
    'narrative', 'counterparty', 'confirmation', 'mentioned', 'statement',
  ];
  const tokens: string[] = [];
  for (const part of parts) {
    // Try to split concatenated words greedily (longest match first)
    let remaining = part;
    while (remaining.length > 0) {
      let matched = false;
      // Try longest vocab words first
      for (const word of vocab.sort((x, y) => y.length - x.length)) {
        if (remaining.startsWith(word)) {
          tokens.push(word);
          remaining = remaining.slice(word.length);
          matched = true;
          break;
        }
      }
      if (!matched) {
        // No vocab match — take the entire remaining as one token
        tokens.push(remaining);
        break;
      }
    }
  }
  return tokens;
}

// Similarity scoring for field name matching
function fieldNameSimilarity(a: string, b: string): number {
  const na = a.toLowerCase().replace(/[_\-\s]/g, '');
  const nb = b.toLowerCase().replace(/[_\-\s]/g, '');
  if (na === nb) return 1.0;
  if (na.includes(nb) || nb.includes(na)) return 0.8;

  // Tokenize and check synonym groups using whole-token matching
  const tokensA = tokenizeFieldName(a);
  const tokensB = tokenizeFieldName(b);

  const synonyms: Record<string, string[]> = {
    'amount': ['value', 'total', 'sum', 'price', 'cost', 'gross', 'net'],
    'date': ['datetime', 'timestamp', 'posted', 'created', 'due'],
    'reference': ['ref', 'number', 'identifier', 'code'],
    'name': ['description', 'label', 'title', 'narrative'],
    'account': ['ledger', 'costcenter', 'bank'],
    'invoice': ['bill', 'document', 'voucher'],
    'vendor': ['supplier', 'creditor'],
    'customer': ['debtor', 'client', 'buyer'],
    'payment': ['remittance', 'settlement', 'transfer'],
    'transaction': ['entry', 'posting', 'record'],
    'id': ['identifier'],
  };
  for (const [key, syns] of Object.entries(synonyms)) {
    const allTerms = [key, ...syns];
    const aHit = tokensA.some(t => allTerms.includes(t));
    const bHit = tokensB.some(t => allTerms.includes(t));
    if (aHit && bHit) return 0.65;
  }
  return 0;
}

function inferMatchType(fieldA: string, fieldB: string): 'exact' | 'fuzzy' | 'numeric_tolerance' | 'date_range' {
  const lower = (fieldA + fieldB).toLowerCase();
  if (lower.includes('amount') || lower.includes('price') || lower.includes('total') ||
      lower.includes('cost') || lower.includes('value') || lower.includes('debit') ||
      lower.includes('credit') || lower.includes('balance')) {
    return 'numeric_tolerance';
  }
  if (lower.includes('date') || lower.includes('time') || lower.includes('posted') || lower.includes('due')) {
    return 'date_range';
  }
  if (lower.includes('name') || lower.includes('description') || lower.includes('narrative')) {
    return 'fuzzy';
  }
  return 'exact';
}

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/field-mappings/suggest - Smart match suggestions
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/field-mappings/suggest', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  const sources = subs[idx].data_sources || [];
  if (sources.length < 2) {
    return c.json({ suggestions: [], message: 'At least 2 data sources are needed for field mapping suggestions' });
  }

  // Generate suggestions by comparing field names between each pair of sources
  const suggestions: FieldMappingRecord[] = [];
  for (let si = 0; si < sources.length; si++) {
    for (let ti = si + 1; ti < sources.length; ti++) {
      const sourceFields = KNOWN_FIELDS[sources[si].type] || KNOWN_FIELDS['upload'];
      const targetFields = KNOWN_FIELDS[sources[ti].type] || KNOWN_FIELDS['upload'];

      for (const sf of sourceFields) {
        let bestMatch = '';
        let bestScore = 0;
        for (const tf of targetFields) {
          const score = fieldNameSimilarity(sf, tf);
          if (score > bestScore) {
            bestScore = score;
            bestMatch = tf;
          }
        }
        if (bestScore >= 0.5 && bestMatch) {
          // Avoid duplicate mappings
          const exists = suggestions.some(s =>
            s.source_index === si && s.target_index === ti &&
            s.source_field === sf && s.target_field === bestMatch
          );
          if (!exists) {
            suggestions.push({
              id: crypto.randomUUID(),
              source_index: si,
              target_index: ti,
              source_field: sf,
              target_field: bestMatch,
              match_type: inferMatchType(sf, bestMatch),
              tolerance: inferMatchType(sf, bestMatch) === 'numeric_tolerance' ? 0.01 : undefined,
              confidence: Math.round(bestScore * 100) / 100,
              auto_suggested: true,
            });
          }
        }
      }
    }
  }

  // Sort by confidence descending
  suggestions.sort((a, b) => b.confidence - a.confidence);

  return c.json({ suggestions });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/field-mappings - Save field mappings
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/field-mappings', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure field mappings' }, 403);
  }

  const body = await c.req.json<{ field_mappings: FieldMappingRecord[] }>();
  if (!body.field_mappings || !Array.isArray(body.field_mappings)) {
    return c.json({ error: 'field_mappings must be an array' }, 400);
  }

  // Validate each mapping
  const validMatchTypes = ['exact', 'fuzzy', 'contains', 'numeric_tolerance', 'date_range'];
  for (const fm of body.field_mappings) {
    if (!fm.source_field || !fm.target_field) return c.json({ error: 'Each mapping needs source_field and target_field' }, 400);
    if (fm.source_index === undefined || fm.target_index === undefined) return c.json({ error: 'Each mapping needs source_index and target_index' }, 400);
    if (!validMatchTypes.includes(fm.match_type)) return c.json({ error: `Invalid match_type. Must be: ${validMatchTypes.join(', ')}` }, 400);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  // Ensure each mapping has an id
  const mappings = body.field_mappings.map(fm => ({
    ...fm,
    id: fm.id || crypto.randomUUID(),
  }));

  subs[idx].field_mappings = mappings;

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.field_mappings_configured', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, mapping_count: mappings.length }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/execution-config - Set execution config
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/execution-config', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure execution' }, 403);
  }

  const body = await c.req.json<ExecutionConfigRecord>();
  const validModes = ['reconciliation', 'validation', 'sync', 'extract', 'compare'];
  if (!body.mode || !validModes.includes(body.mode)) {
    return c.json({ error: `Invalid mode. Must be: ${validModes.join(', ')}` }, 400);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  subs[idx].execution_config = { mode: body.mode, parameters: body.parameters || {} };

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.execution_config_set', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, mode: body.mode }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// POST /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/execute - Execute sub-catalyst against its data sources
catalysts.post('/clusters/:clusterId/sub-catalysts/:subName/execute', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can execute sub-catalysts' }, 403);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  // Optional per-company scope (superadmin cross-tenant style — accepted via
  // ?company_id= query param or JSON body). If present it must belong to the
  // target tenant; otherwise we reject with 404 so leaking/guessing IDs across
  // tenants is impossible.
  const companyId = await resolveCompanyScope(c, targetTenant);
  if (companyId && companyId === COMPANY_REJECTED) {
    return c.json({ error: 'Company not found', message: 'company_id does not belong to this tenant' }, 404);
  }
  const scopedCompanyId = companyId || undefined;

  const cluster = await c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<Record<string, unknown>>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse((cluster.sub_catalysts as string) || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  const sub = subs[idx];
  if (!sub.enabled) return c.json({ error: 'Sub-catalyst is disabled' }, 400);

  const sources = sub.data_sources || [];
  if (sources.length < 1) return c.json({ error: 'No data sources configured' }, 400);

  const mappings = sub.field_mappings || [];
  const execConfig = sub.execution_config || { mode: 'reconciliation' };
  const startTime = Date.now();

  // Perform execution based on mode
  let result: ExecutionResultRecord;

  try {
    if (execConfig.mode === 'reconciliation' && sources.length >= 2 && mappings.length > 0) {
      result = await performReconciliation(sub, sources, mappings, clusterId, targetTenant, c.env.DB, scopedCompanyId);
    } else if (execConfig.mode === 'validation') {
      result = await performValidation(sub, sources, clusterId, targetTenant, c.env.DB, scopedCompanyId);
    } else if (execConfig.mode === 'compare' && sources.length >= 2) {
      result = await performComparison(sub, sources, mappings, clusterId, targetTenant, c.env.DB, scopedCompanyId);
    } else {
      // Default: extract/analyze mode — pull data from sources and report
      result = await performExtraction(sub, sources, clusterId, targetTenant, c.env.DB, scopedCompanyId);
    }

    result.duration_ms = Date.now() - startTime;

    // ── LLM-powered analysis: send data sample + results to Atheon model ──
    try {
      const clusterDomain = (cluster.domain as string) || 'finance';
      const clusterIndustry = (cluster.industry as string) || 'general';
      const llmResult = await llmAnalyzeExecution(
        result, sub.name, clusterDomain, clusterIndustry, execConfig.mode,
        targetTenant, c.env.DB, c.env.AI,
      );
      if (llmResult) {
        result.llm_analysis = llmResult;
        result.reasoning = llmResult.reasoning;
        result.recommendations = llmResult.recommendations;
      }
    } catch (llmErr) {
      console.error('LLM analysis failed (non-critical, rules-based results preserved):', llmErr);
    }
  } catch (err) {
    result = {
      id: crypto.randomUUID(),
      sub_catalyst: subName,
      cluster_id: clusterId,
      executed_at: new Date().toISOString(),
      duration_ms: Date.now() - startTime,
      status: 'failed',
      mode: execConfig.mode,
      summary: { total_records_source: 0, total_records_target: 0, matched: 0, unmatched_source: 0, unmatched_target: 0, discrepancies: 0 },
      error: (err as Error).message,
    };
  }

  // Re-read cluster to avoid overwriting concurrent changes (execution may take a while)
  const freshCluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?')
    .bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  const freshSubs = JSON.parse(freshCluster?.sub_catalysts || '[]') as SubCatalystRecord[];
  const freshIdx = freshSubs.findIndex(s => s.name === subName);
  if (freshIdx !== -1) {
    freshSubs[freshIdx].last_execution = result;
    await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
      .bind(JSON.stringify(freshSubs), clusterId, targetTenant).run();
  }

  // Store execution in execution_logs for history
  await writeLog(c.env.DB, targetTenant, result.id, 1, `${subName} — ${execConfig.mode}`, result.status, JSON.stringify(result.summary), result.duration_ms);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.executed', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, mode: execConfig.mode, status: result.status, summary: result.summary }),
    result.status === 'failed' ? 'failure' : 'success'
  ).run().catch(() => {});

  // ── Skip post-processing pipeline for failed runs — no fake data in analytics ──
  if (result.status === 'failed') {
    return c.json(result, 200);
  }

  // ── Exception pipeline: auto-raise exceptions for problematic results ──
  const exceptionIds = await raiseExecutionExceptions(c.env.DB, targetTenant, clusterId, subName, result, execConfig);
  if (exceptionIds.length > 0) {
    (result as Record<string, unknown>).exceptions_raised = exceptionIds.length;
    (result as Record<string, unknown>).exception_ids = exceptionIds;
  }

  // ── Record run in sub_catalyst_runs + items (Phase 4) ──
  let runId: string | undefined;
  try {
    runId = await recordRun(c.env.DB, targetTenant, clusterId, subName, result, 'manual');
    (result as Record<string, unknown>).run_id = runId;
  } catch (err) {
    console.error('recordRun failed:', err);
  }

  // ── DAG: fire downstream dependents when the run completed successfully.
  // This HTTP path is always user-initiated so chainDepth starts at 0; DAG
  // hops thereafter go via the catalyst-tasks queue → executeTask and carry
  // their own chainDepth. triggerDownstream caps at MAX_CHAIN_DEPTH.
  try {
    await triggerDownstream({
      tenantId: targetTenant,
      upstreamClusterId: clusterId,
      upstreamSubCatalystName: subName,
      chainDepth: 0,
      parentContext: { runId, source: 'sub_catalyst_http' },
      companyId: scopedCompanyId,
    }, c.env.DB, c.env.CATALYST_QUEUE as Queue<import('../services/scheduled').CatalystQueueMessage> | undefined);
  } catch (err) {
    console.error('[DAG] downstream trigger failed (non-fatal):', err);
  }

  // ── Auto-populate catalyst_run_analytics from the execution result ──
  try {
    const summary = result.summary || {} as Record<string, number>;
    const matched = typeof summary.matched === 'number' ? summary.matched : 0;
    const unmatchedSource = typeof summary.unmatched_source === 'number' ? summary.unmatched_source : 0;
    const unmatchedTarget = typeof summary.unmatched_target === 'number' ? summary.unmatched_target : 0;
    const discrepancyCount = typeof summary.discrepancies === 'number' ? summary.discrepancies : 0;
    const totalRecSource = typeof summary.total_records_source === 'number' ? summary.total_records_source : 0;
    const totalRecTarget = typeof summary.total_records_target === 'number' ? summary.total_records_target : 0;
    const totalItems = matched + unmatchedSource + unmatchedTarget + discrepancyCount || Math.max(totalRecSource, totalRecTarget, 1);
    const completedItems = matched;
    const exceptionItems = (result as Record<string, unknown>).exceptions_raised as number || 0;
    const escalatedItems = 0;
    const pendingItems = 0;
    const autoApprovedItems = matched;
    const matchRate = totalItems > 0 ? matched / totalItems : 0;
    const dist: Record<string, number> = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
    if (matchRate > 0) dist['80-100'] = completedItems;
    if (exceptionItems > 0) dist['0-20'] = exceptionItems;
    const insights: string[] = [];
    if (matchRate >= 0.9) insights.push(`High match rate (${(matchRate * 100).toFixed(0)}%) — most items processed automatically.`);
    if (matchRate < 0.5 && totalItems > 0) insights.push(`Low match rate (${(matchRate * 100).toFixed(0)}%) — review data quality or field mappings.`);
    if (discrepancyCount > 0) insights.push(`${discrepancyCount} discrepancy(ies) detected — review and resolve.`);
    if (unmatchedSource > 0) insights.push(`${unmatchedSource} unmatched source record(s) need attention.`);
    if (totalRecSource === 0 && totalRecTarget === 0 && matched === 0) insights.push('No items were processed — check data source configuration.');
    // Append LLM-generated reasoning and recommendations to analytics insights
    if (result.llm_analysis) {
      if (result.llm_analysis.reasoning) insights.push(`AI Analysis: ${result.llm_analysis.reasoning}`);
      for (const rec of result.llm_analysis.recommendations) insights.push(`AI Recommendation: ${rec}`);
      for (const risk of result.llm_analysis.risk_factors) insights.push(`AI Risk: ${risk}`);
      if (result.llm_analysis.industry_context) insights.push(`Industry Context: ${result.llm_analysis.industry_context}`);
    }
    const analyticsId = crypto.randomUUID();
    console.log(`[run-analytics] Inserting analytics for ${subName} run=${runId || result.id}, totalItems=${totalItems}, matched=${matched}, status=${result.status}`);
    await c.env.DB.prepare(
      `INSERT INTO catalyst_run_analytics (id, tenant_id, cluster_id, sub_catalyst_name, run_id, completed_at, duration_ms, total_items, completed_items, exception_items, escalated_items, pending_items, auto_approved_items, avg_confidence, min_confidence, max_confidence, confidence_distribution, status, insights) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      analyticsId, targetTenant, clusterId, subName, runId || result.id,
      result.duration_ms, totalItems, completedItems, exceptionItems, escalatedItems, pendingItems, autoApprovedItems,
      Math.round(matchRate * 1000) / 1000, 0, matchRate > 0 ? 1 : 0,
      JSON.stringify(dist), result.status, JSON.stringify(insights),
    ).run();
    console.log(`[run-analytics] Successfully inserted analytics ${analyticsId}`);
  } catch (err) {
    console.error('auto run-analytics insert failed:', err, JSON.stringify({ clusterId, subName, runId, resultKeys: Object.keys(result), summaryKeys: result.summary ? Object.keys(result.summary) : 'no summary' }));
  }

  // ── Generate Apex/Pulse/Dashboard insights from this catalyst run ──
  try {
    const clusterDomain = (cluster.domain as string) || 'finance';
    await generateInsightsForTenant(c.env.DB, targetTenant, subName, clusterDomain, undefined, runId, clusterId, subName);
  } catch (err) {
    console.error('Insight generation after sub-catalyst execution failed (non-critical):', err);
  }

  // Always return 200 so the client can read the detailed result (status field indicates success/failure)
  return c.json(result, 200);
});

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/executions - Execution history
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/executions', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as SubCatalystRecord[];
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  // Return last_execution as the history (single entry for now; could expand to a separate table later)
  const executions: ExecutionResultRecord[] = [];
  if (subs[idx].last_execution) {
    executions.push(subs[idx].last_execution as ExecutionResultRecord);
  }

  return c.json({ executions, total: executions.length });
});

// ── Execution Engine Helpers ──

async function performReconciliation(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  mappings: FieldMappingRecord[],
  clusterId: string,
  tenantId: string,
  db: D1Database,
  companyId?: string,
): Promise<ExecutionResultRecord> {
  // Pull data from the first two data sources using ERP canonical tables
  const sourceData = await fetchDataForSource(sources[0], tenantId, db, companyId);
  const targetData = await fetchDataForSource(sources[1], tenantId, db, companyId);

  // Fail fast if no data was returned — likely means ERP data hasn't been synced
  if (sourceData.length === 0 && targetData.length === 0) {
    throw new Error(`No data found for reconciliation. The ERP data source tables are empty for this tenant. Please sync data from your ERP system first (Connectivity → Sync Now).`);
  }

  let matchedCount = 0;
  let discrepancyCount = 0;
  let skippedSource = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];
  const matched_records: Array<{ source: Record<string, unknown>; target: Record<string, unknown>; confidence: number; matched_on: string }> = [];
  const unmatched_source_records: Array<Record<string, unknown>> = [];

  // Use the first mapping that connects source 0 to source 1 as the key field
  const keyMappings = mappings.filter(m => m.source_index === 0 && m.target_index === 1);

  if (keyMappings.length === 0) {
    // No mappings between source 0 and 1, do a count-based comparison
    return {
      id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
      executed_at: new Date().toISOString(), duration_ms: 0, status: 'completed',
      mode: 'reconciliation',
      summary: {
        total_records_source: sourceData.length, total_records_target: targetData.length,
        matched: 0, unmatched_source: sourceData.length, unmatched_target: targetData.length,
        discrepancies: Math.abs(sourceData.length - targetData.length),
      },
      unmatched_source_records: sourceData,
      unmatched_target_records: targetData,
    };
  }

  // Match records using key field mapping
  const primaryKey = keyMappings[0];
  const matchedTargetIndices = new Set<number>();

  // Pre-count target records with empty key fields
  const skippedTargetCount = targetData.filter(r => !String(r[primaryKey.target_field] ?? '').trim()).length;

  for (const srcRow of sourceData) {
    const srcVal = String(srcRow[primaryKey.source_field] ?? '').toLowerCase().trim();
    if (!srcVal) { skippedSource++; continue; } // skip records with empty key field
    let foundMatch = false;

    for (let ti = 0; ti < targetData.length; ti++) {
      if (matchedTargetIndices.has(ti)) continue; // skip already-matched targets
      const tgtRow = targetData[ti];
      const tgtVal = String(tgtRow[primaryKey.target_field] ?? '').toLowerCase().trim();
      if (!tgtVal) continue; // skip records with empty key field

      const isMatch = primaryKey.match_type === 'exact' ? srcVal === tgtVal :
        primaryKey.match_type === 'fuzzy' ? (srcVal.includes(tgtVal) || tgtVal.includes(srcVal)) :
        primaryKey.match_type === 'contains' ? srcVal.includes(tgtVal) :
        srcVal === tgtVal;

      if (isMatch) {
        foundMatch = true;
        matchedTargetIndices.add(ti);
        matchedCount++;
        let hasDiscrepancy = false;

        // Track the matched pair
        matched_records.push({ source: srcRow, target: tgtRow, confidence: 1.0, matched_on: primaryKey.source_field });

        // Check other mappings for discrepancies between matched records (no cap)
        for (const fm of keyMappings.slice(1)) {
          const sv = srcRow[fm.source_field];
          const tv = tgtRow[fm.target_field];
          if (fm.match_type === 'numeric_tolerance') {
            const nSv = parseFloat(String(sv));
            const nTv = parseFloat(String(tv));
            const tol = fm.tolerance ?? 0.01;
            if (!isNaN(nSv) && !isNaN(nTv) && Math.abs(nSv - nTv) > tol) {
              discrepancyCount++;
              hasDiscrepancy = true;
              discrepancies.push({
                source_record: srcRow, target_record: tgtRow,
                field: `${fm.source_field} vs ${fm.target_field}`,
                source_value: sv, target_value: tv,
                difference: `Difference: ${(nSv - nTv).toFixed(2)}`,
              });
            }
          } else {
            const sSv = String(sv ?? '').toLowerCase().trim();
            const sTv = String(tv ?? '').toLowerCase().trim();
            if (sSv !== sTv) {
              discrepancyCount++;
              hasDiscrepancy = true;
              discrepancies.push({
                source_record: srcRow, target_record: tgtRow,
                field: `${fm.source_field} vs ${fm.target_field}`,
                source_value: sv, target_value: tv,
              });
            }
          }
        }
        // If discrepancy found on a matched record, adjust confidence
        if (hasDiscrepancy && matched_records.length > 0) {
          matched_records[matched_records.length - 1].confidence = 0.7;
        }
        break;
      }
    }

    if (!foundMatch) {
      unmatched_source_records.push(srcRow);
      discrepancies.push({
        source_record: srcRow, target_record: null,
        field: primaryKey.source_field,
        source_value: srcRow[primaryKey.source_field],
        target_value: null,
        difference: 'No matching record in target',
      });
    }
  }

  // Collect unmatched target records
  const unmatched_target_records: Array<Record<string, unknown>> = [];
  for (let ti = 0; ti < targetData.length; ti++) {
    if (!matchedTargetIndices.has(ti)) {
      const tgtVal = String(targetData[ti][primaryKey.target_field] ?? '').trim();
      if (tgtVal) unmatched_target_records.push(targetData[ti]);
    }
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: (discrepancyCount > 0 || matchedCount < (sourceData.length - skippedSource) || matchedTargetIndices.size < (targetData.length - skippedTargetCount)) ? 'partial' : 'completed',
    mode: 'reconciliation',
    summary: {
      total_records_source: sourceData.length - skippedSource,
      total_records_target: targetData.length - skippedTargetCount,
      matched: matchedCount,
      unmatched_source: sourceData.length - skippedSource - matchedCount,
      unmatched_target: targetData.length - skippedTargetCount - matchedTargetIndices.size,
      discrepancies: discrepancyCount,
    },
    discrepancies: discrepancies?.length ? discrepancies : undefined,
    matched_records: matched_records.length ? matched_records : undefined,
    unmatched_source_records: unmatched_source_records.length ? unmatched_source_records : undefined,
    unmatched_target_records: unmatched_target_records.length ? unmatched_target_records : undefined,
  };
}

async function performValidation(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  clusterId: string,
  tenantId: string,
  db: D1Database,
  companyId?: string,
): Promise<ExecutionResultRecord> {
  const data = await fetchDataForSource(sources[0], tenantId, db, companyId);

  // Fail fast if no data was returned — likely means ERP data hasn't been synced
  if (data.length === 0) {
    throw new Error(`No data found for validation. The ERP data source table is empty for this tenant. Please sync data from your ERP system first (Connectivity → Sync Now).`);
  }

  let issues = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];

  // ── Self-learning data-type detection ──
  // Instead of matching module names, inspect the actual fields in the first row
  // to determine data type. Works for SAP, Odoo, Sage, Xero, or any ERP automatically.
  const module = String(sources[0]?.config?.module || '').toLowerCase();
  const sampleRow = data[0] || {};
  const hasField = (candidates: string[]) => candidates.some(f => f in sampleRow);

  // ── Priority-ordered detection: ERP financial data FIRST (they may contain partner/product refs from JOINs) ──

  // SAP financial documents: checked first because BSEG has LIFNR and VBRK JOINs bring MATNR
  const isSapFinancialData = module.startsWith('sap_bseg') || module.startsWith('sap_vbrk') ||
    (hasField(['BELNR', 'BUKRS', 'GJAHR']) && hasField(['DMBTR'])) ||  // SAP BKPF/BSEG
    (hasField(['FKART', 'FKTYP']) && hasField(['NETWR']));  // SAP VBRK (billing-specific fields)

  // Odoo financial data: account.move (invoices/journal entries)
  const isOdooFinancialData = !isSapFinancialData && (
    module.startsWith('odoo_account_move') ||
    (hasField(['move_type', 'amount_total']) && hasField(['payment_state'])) ||  // Odoo account.move
    (hasField(['debit', 'credit', 'balance']) && hasField(['move_id', 'account_id']))  // Odoo account.move.line
  );

  // Sage financial data: sales/purchase invoices
  const isSageFinancialData = !isSapFinancialData && !isOdooFinancialData && (
    module.startsWith('sage_sales_invoice') || module.startsWith('sage_purchase_invoice') ||
    (hasField(['InvoiceNumber', 'NetAmount', 'TaxAmount', 'GrossAmount'])) ||  // Sage invoices
    (hasField(['NominalCode', 'NominalName', 'NominalType']))  // Sage nominal ledger
  );

  // Xero financial data: invoices
  const isXeroFinancialData = !isSapFinancialData && !isOdooFinancialData && !isSageFinancialData && (
    module.startsWith('xero_invoice') ||
    (hasField(['InvoiceNumber', 'SubTotal', 'TotalTax', 'Total']) && hasField(['AmountDue'])) ||  // Xero invoices
    (hasField(['ManualJournalID', 'Narration', 'JournalLines']))  // Xero manual journals
  );

  // QuickBooks financial data: invoices/bills
  const isQBFinancialData = !isSapFinancialData && !isOdooFinancialData && !isSageFinancialData && !isXeroFinancialData && (
    module.startsWith('qb_invoice') || module.startsWith('qb_bill') || module.startsWith('qb_journal') ||
    (hasField(['DocNumber', 'TxnDate', 'TotalAmt']) && (hasField(['CustomerRef_name']) || hasField(['VendorRef_name'])))
  );

  // Any ERP financial data (union of all)
  const isAnyFinancialData = isSapFinancialData || isOdooFinancialData || isSageFinancialData || isXeroFinancialData || isQBFinancialData;

  // Supplier/Vendor data: detected by vendor master fields across all ERPs
  const isSupplierData = !isAnyFinancialData && (
    hasField(['KTOKK', 'SPERM']) ||  // SAP LFA1/LFB1
    (hasField(['supplier_rank']) && hasField(['vat'])) ||  // Odoo res.partner (supplier)
    (hasField(['AccountReference', 'BankSortCode']) && hasField(['CompanyName'])) ||  // Sage supplier
    (hasField(['IsSupplier', 'TaxNumber']) && hasField(['ContactStatus'])) ||  // Xero contact (supplier)
    (hasField(['TaxIdentifier', 'Vendor1099']) && hasField(['DisplayName'])) ||  // QuickBooks vendor
    (module.includes('vendor') || module.includes('supplier')) && !module.includes('bseg')
  );

  // Customer data: detected by customer master fields across all ERPs
  const isCustomerData = !isAnyFinancialData && (
    hasField(['KTOKD', 'KLIMK']) ||  // SAP KNA1/KNB1
    (hasField(['customer_rank']) && hasField(['property_account_receivable_id'])) ||  // Odoo res.partner (customer)
    (hasField(['AccountReference', 'CreditLimit']) && hasField(['AccountType'])) ||  // Sage customer
    (hasField(['IsCustomer', 'Balances_AccountsReceivable_Outstanding'])) ||  // Xero contact (customer)
    (hasField(['DisplayName', 'PreferredDeliveryMethod']) && hasField(['Balance'])) ||  // QuickBooks customer
    module.includes('customer') || module.includes('accounts_receivable') || module === 'ar'
  );

  // Product/Inventory data: detected by stock/inventory fields across all ERPs
  const isProductData = !isAnyFinancialData && (
    hasField(['LABST', 'LGORT']) ||  // SAP MARD
    (hasField(['qty_available', 'standard_price']) && hasField(['default_code'])) ||  // Odoo product
    (hasField(['inventory_quantity', 'inventory_diff_quantity'])) ||  // Odoo stock.quant
    (hasField(['ProductCode', 'QuantityInStock', 'ReorderLevel'])) ||  // Sage stock item
    (hasField(['QuantityOnHand', 'IsTrackedAsInventory'])) ||  // Xero item
    (hasField(['QtyOnHand', 'ReorderPoint', 'TrackQtyOnHand'])) ||  // QuickBooks item
    module.includes('product') || module.includes('inventory') || module.includes('stock')
  );

  for (const row of data) {
    const rowIssues: string[] = [];
    // Helper: check if a field has a non-empty value
    const val = (key: string) => row[key] !== null && row[key] !== undefined && String(row[key]).trim() !== '';

    if (isSapFinancialData) {
      // SAP financial document validation (BSEG, VBRK, etc.)
      const hasAmount = val('DMBTR') || val('WRBTR') || val('NETWR');
      const hasDate = val('BUDAT') || val('BLDAT') || val('FKDAT') || val('CPUDT');
      const hasRef = val('BELNR') || val('VBELN') || val('EBELN') || val('XBLNR');
      const dmbtr = Number(row['DMBTR'] || 0);
      const wrbtr = Number(row['WRBTR'] || 0);
      const bstat = String(row['BSTAT'] || '');

      if (!hasAmount) rowIssues.push('Missing amount (DMBTR/WRBTR/NETWR)');
      if (!hasDate) rowIssues.push('Missing posting/document date');
      if (!hasRef) rowIssues.push('Missing document reference');
      if (dmbtr > 0 && wrbtr > 0 && Math.abs(dmbtr - wrbtr) / wrbtr > 0.01) {
        rowIssues.push(`Forex variance: local ${dmbtr} vs doc ${wrbtr} (${((Math.abs(dmbtr - wrbtr) / wrbtr) * 100).toFixed(1)}%)`);
      }
      if (bstat === 'V') rowIssues.push('Document is parked (not posted)');
      if (!val('XBLNR') && val('BELNR')) rowIssues.push('Missing external reference (XBLNR)');
      if (val('MWSBK') && val('NETWR')) {
        const netwr = Number(row['NETWR']);
        const mwsbk = Number(row['MWSBK']);
        if (netwr > 0 && mwsbk <= 0) rowIssues.push('Missing VAT on billing document');
      }
    } else if (isOdooFinancialData) {
      // Odoo account.move / account.move.line validation
      const hasAmount = val('amount_total') || val('debit') || val('credit');
      const hasDate = val('invoice_date') || val('date');
      const hasRef = val('name') || val('move_name') || val('ref');
      const state = String(row['state'] || '');
      const paymentState = String(row['payment_state'] || '');
      const residual = Number(row['amount_residual'] || 0);
      const total = Number(row['amount_total'] || 0);

      if (!hasAmount) rowIssues.push('Missing amount (amount_total/debit/credit)');
      if (!hasDate) rowIssues.push('Missing invoice/posting date');
      if (!hasRef) rowIssues.push('Missing document reference');
      if (state === 'draft') rowIssues.push('Document is still in draft state');
      if (state === 'cancel') rowIssues.push('Document has been cancelled');
      if (paymentState === 'not_paid' && residual > 0 && val('invoice_date_due')) {
        const due = new Date(String(row['invoice_date_due']));
        if (due < new Date()) rowIssues.push(`Overdue: ${residual.toFixed(2)} unpaid since ${row['invoice_date_due']}`);
      }
      if (total > 0 && Number(row['amount_tax'] || 0) <= 0) rowIssues.push('Missing tax on document');
    } else if (isSageFinancialData) {
      // Sage sales/purchase invoice validation
      const hasAmount = val('NetAmount') || val('GrossAmount');
      const hasDate = val('InvoiceDate');
      const hasRef = val('InvoiceNumber') || val('Reference') || val('NominalCode');
      const outstanding = Number(row['AmountOutstanding'] || 0);
      const status = String(row['Status'] || '');

      if (!hasAmount) rowIssues.push('Missing amount (NetAmount/GrossAmount)');
      if (!hasDate) rowIssues.push('Missing invoice date');
      if (!hasRef) rowIssues.push('Missing invoice number or reference');
      if (val('NetAmount') && val('TaxAmount') && val('GrossAmount')) {
        const expected = Number(row['NetAmount']) + Number(row['TaxAmount']);
        const actual = Number(row['GrossAmount']);
        if (Math.abs(expected - actual) > 0.02) rowIssues.push(`Gross ${actual} != Net ${row['NetAmount']} + Tax ${row['TaxAmount']}`);
      }
      if (outstanding > 0 && val('DueDate')) {
        const due = new Date(String(row['DueDate']));
        if (due < new Date()) rowIssues.push(`Overdue: ${outstanding.toFixed(2)} outstanding since ${row['DueDate']}`);
      }
      if (status === 'Void' || status === 'Deleted') rowIssues.push(`Document status: ${status}`);
    } else if (isXeroFinancialData) {
      // Xero invoice / journal validation
      const hasAmount = val('Total') || val('SubTotal');
      const hasDate = val('Date');
      const hasRef = val('InvoiceNumber') || val('Reference') || val('Narration');
      const amountDue = Number(row['AmountDue'] || 0);
      const status = String(row['Status'] || '');

      if (!hasAmount) rowIssues.push('Missing amount (Total/SubTotal)');
      if (!hasDate) rowIssues.push('Missing date');
      if (!hasRef) rowIssues.push('Missing invoice number or reference');
      if (status === 'DRAFT') rowIssues.push('Invoice is still in DRAFT status');
      if (status === 'VOIDED') rowIssues.push('Invoice has been voided');
      if (amountDue > 0 && val('DueDate')) {
        const due = new Date(String(row['DueDate']));
        if (due < new Date()) rowIssues.push(`Overdue: ${amountDue.toFixed(2)} due since ${row['DueDate']}`);
      }
      if (val('SubTotal') && val('TotalTax') && val('Total')) {
        const expected = Number(row['SubTotal']) + Number(row['TotalTax']);
        const actual = Number(row['Total']);
        if (Math.abs(expected - actual) > 0.02) rowIssues.push(`Total ${actual} != SubTotal ${row['SubTotal']} + Tax ${row['TotalTax']}`);
      }
    } else if (isQBFinancialData) {
      // QuickBooks invoice/bill validation
      const hasAmount = val('TotalAmt');
      const hasDate = val('TxnDate');
      const hasRef = val('DocNumber');
      const balance = Number(row['Balance'] || 0);
      const totalAmt = Number(row['TotalAmt'] || 0);

      if (!hasAmount) rowIssues.push('Missing TotalAmt');
      if (!hasDate) rowIssues.push('Missing TxnDate');
      if (!hasRef) rowIssues.push('Missing DocNumber');
      if (balance > 0 && val('DueDate')) {
        const due = new Date(String(row['DueDate']));
        if (due < new Date()) rowIssues.push(`Overdue: ${balance.toFixed(2)} balance due since ${row['DueDate']}`);
      }
      if (totalAmt > 0 && Number(row['TxnTaxDetail_TotalTax'] || 0) <= 0) rowIssues.push('Missing tax on transaction');
      if (!val('CustomerRef_name') && !val('VendorRef_name')) rowIssues.push('Missing customer/vendor reference');
    } else if (isSupplierData) {
      // Supplier / Vendor master validation — works with all ERP field names
      const hasName = val('name') || val('NAME1') || val('CompanyName') || val('Name') || val('DisplayName');
      const hasVat = val('vat_number') || val('STCD1') || val('vat') || val('VATRegistrationNumber') || val('TaxNumber') || val('TaxIdentifier');
      const hasPayTerms = val('payment_terms') || val('ZTERM') || val('property_payment_term_id') || val('TermsAgreed') || val('TermRef');
      const hasBankDetails = (val('bank_name') && val('bank_account')) || val('HBKID') || val('AKONT') ||
        val('property_account_payable_id') || (val('BankName') && val('BankAccountNumber')) || val('BankAccountDetails') || val('AcctNum');
      const hasContact = val('contact_name') || val('contact_email') || val('TELF1') || val('email') || val('phone') ||
        val('EmailAddress') || val('TelephoneNumber') || val('PrimaryEmailAddr') || val('PrimaryPhone');
      const isBlocked = val('SPERR') || val('SPERM') || (Number(row['active'] ?? row['Active'] ?? 1) === 0);

      if (!hasName) rowIssues.push('Missing supplier name');
      if (!hasVat) rowIssues.push('Missing VAT/tax number');
      if (!hasPayTerms) rowIssues.push('Missing payment terms');
      if (!hasBankDetails) rowIssues.push('Missing reconciliation account or bank details');
      if (!hasContact) rowIssues.push('Missing contact information');
      if (isBlocked) rowIssues.push('Vendor is blocked or inactive');
    } else if (isCustomerData) {
      // Customer / AR validation — works with all ERP field names
      const hasName = val('name') || val('NAME1') || val('CompanyName') || val('Name') || val('DisplayName');
      const hasRegNum = val('registration_number') || val('STCD1') || val('vat') || val('company_registry') ||
        val('VATRegistrationNumber') || val('TaxNumber') || val('TaxExemptionReasonId');
      const hasPayTerms = val('payment_terms') || val('ZTERM') || val('property_payment_term_id') || val('TermsAgreed');
      const hasContact = val('contact_name') || val('contact_email') || val('TELF1') || val('email') || val('phone') ||
        val('EmailAddress') || val('TelephoneNumber') || val('PrimaryEmailAddr') || val('PrimaryPhone');
      const creditLimit = Number(row['credit_limit'] || row['KLIMK'] || row['CreditLimit'] || 0);
      const creditBalance = Number(row['credit_balance'] || row['Balance'] ||
        row['Balances_AccountsReceivable_Outstanding'] || 0);
      const hasCreditControl = val('CTLPC') || creditLimit > 0;

      if (!hasName) rowIssues.push('Missing customer name');
      if (!hasRegNum) rowIssues.push('Missing registration/tax number');
      if (creditLimit > 0 && creditBalance > creditLimit) rowIssues.push(`Credit balance ${creditBalance} exceeds limit ${creditLimit}`);
      if (!hasCreditControl && creditLimit <= 0) rowIssues.push('No credit limit or credit control set');
      if (!hasPayTerms) rowIssues.push('Missing payment terms');
      if (!hasContact) rowIssues.push('Missing contact information');
    } else if (isProductData) {
      // Product / Inventory validation — works with all ERP field names
      const hasSku = val('sku') || val('MATNR') || val('default_code') || val('ProductCode') || val('Code') || val('Sku');
      const hasName = val('name') || val('ARKTX') || val('Name') || val('Description');
      const costPrice = Number(row['cost_price'] || row['standard_price'] || row['CostPrice'] || row['PurchaseCost'] ||
        row['PurchaseUnitPrice'] || 0);
      const sellingPrice = Number(row['selling_price'] || row['list_price'] || row['SalePrice'] || row['UnitPrice'] ||
        row['SalesUnitPrice'] || 0);
      const stockOnHand = Number(row['stock_on_hand'] || row['LABST'] || row['qty_available'] || row['quantity'] ||
        row['QuantityInStock'] || row['QuantityOnHand'] || row['QtyOnHand'] || 0);
      const reorderLevel = Number(row['reorder_level'] || row['ReorderLevel'] || row['ReorderPoint'] || 0);
      const hasBlockedStock = Number(row['SPEME'] || 0) > 0;
      const isInactive = Number(row['InactiveFlag'] || 0) > 0 || Number(row['active'] ?? row['Active'] ?? 1) === 0;

      if (!hasSku) rowIssues.push('Missing SKU/material number');
      if (!hasName) rowIssues.push('Missing product name');
      if (costPrice > 0 && sellingPrice > 0 && sellingPrice < costPrice) rowIssues.push(`Selling price ${sellingPrice} below cost ${costPrice}`);
      if (stockOnHand < reorderLevel && reorderLevel > 0) rowIssues.push(`Stock ${stockOnHand} below reorder level ${reorderLevel}`);
      if (hasBlockedStock) rowIssues.push(`Blocked stock: ${row['SPEME']} units`);
      if (isInactive) rowIssues.push('Product is inactive/discontinued');
    } else {
      // Generic financial record validation (invoices, payments, bank transactions)
      const hasAmount = val('amount') || val('total') || val('debit') || val('credit') || val('total_debit');
      const hasDate = val('invoice_date') || val('date') || val('posting_date') || val('journal_date') || val('order_date') || val('transaction_date');
      const hasRef = val('invoice_number') || val('reference') || val('transaction_id') || val('document_number') ||
                     val('name') || val('sku') || val('po_number') || val('journal_number') || val('id');

      if (!hasAmount) rowIssues.push('Missing amount/total');
      if (!hasDate) rowIssues.push('Missing date');
      if (!hasRef) rowIssues.push('Missing reference');

      // Check for overdue invoices
      if (row['due_date'] && row['payment_status'] !== 'paid' && row['amount_due'] && Number(row['amount_due']) > 0) {
        const dueDate = new Date(String(row['due_date']));
        if (dueDate < new Date()) rowIssues.push(`Overdue invoice — due ${String(row['due_date'])}`);
      }
      // Check for amount mismatches
      if (row['subtotal'] && row['vat_amount'] && row['total']) {
        const expected = Number(row['subtotal']) + Number(row['vat_amount']);
        const actual = Number(row['total']);
        if (Math.abs(expected - actual) > 0.02) rowIssues.push(`Total ${actual} != subtotal ${row['subtotal']} + VAT ${row['vat_amount']}`);
      }
    }

    if (rowIssues.length > 0) {
      issues++;
      if (discrepancies && discrepancies.length < 50) {
        // Self-learning ref field: try SAP fields, then legacy fields
        const refField = row['NAME1'] || row['LIFNR'] || row['KUNNR'] || row['BELNR'] || row['VBELN'] || row['MATNR'] ||
                         row['name'] || row['invoice_number'] || row['sku'] || row['reference'] || row['id'] || 'unknown';
        discrepancies.push({
          source_record: row, target_record: null,
          field: rowIssues[0].split(' ')[0].toLowerCase(),
          source_value: String(refField),
          target_value: null,
          difference: rowIssues.join('; '),
        });
      }
    }
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: issues > 0 ? 'partial' : 'completed',
    mode: 'validation',
    summary: {
      total_records_source: data.length, total_records_target: 0,
      matched: data.length - issues, unmatched_source: issues, unmatched_target: 0,
      discrepancies: issues,
    },
    discrepancies: discrepancies?.length ? discrepancies : undefined,
  };
}

async function performComparison(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  mappings: FieldMappingRecord[],
  clusterId: string,
  tenantId: string,
  db: D1Database,
  companyId?: string,
): Promise<ExecutionResultRecord> {
  const sourceData = await fetchDataForSource(sources[0], tenantId, db, companyId);
  const targetData = await fetchDataForSource(sources[1], tenantId, db, companyId);

  // Fail fast if no data was returned — likely means ERP data hasn't been synced
  if (sourceData.length === 0 && targetData.length === 0) {
    throw new Error(`No data found for comparison. The ERP data source tables are empty for this tenant. Please sync data from your ERP system first (Connectivity → Sync Now).`);
  }

  // If we have field mappings, do a real field-level comparison (same logic as reconciliation)
  if (mappings.length > 0) {
    const keyMappings = mappings.filter(m => m.source_index === 0 && m.target_index === 1);
    if (keyMappings.length > 0) {
      const primaryKey = keyMappings[0];
      let matchedCount = 0;
      let discrepancyCount = 0;
      let skippedSource = 0;
      const discrepancies: ExecutionResultRecord['discrepancies'] = [];
      const matched_records: Array<{ source: Record<string, unknown>; target: Record<string, unknown>; confidence: number; matched_on: string }> = [];
      const unmatched_source_records: Array<Record<string, unknown>> = [];
      const matchedTargetIndices = new Set<number>();
      const skippedTargetCount = targetData.filter(r => !String(r[primaryKey.target_field] ?? '').trim()).length;

      for (const srcRow of sourceData) {
        const srcVal = String(srcRow[primaryKey.source_field] ?? '').toLowerCase().trim();
        if (!srcVal) { skippedSource++; continue; }
        let foundMatch = false;

        for (let ti = 0; ti < targetData.length; ti++) {
          if (matchedTargetIndices.has(ti)) continue;
          const tgtRow = targetData[ti];
          const tgtVal = String(tgtRow[primaryKey.target_field] ?? '').toLowerCase().trim();
          if (!tgtVal) continue;

          const isMatch = primaryKey.match_type === 'exact' ? srcVal === tgtVal :
            primaryKey.match_type === 'fuzzy' ? (srcVal.includes(tgtVal) || tgtVal.includes(srcVal)) :
            primaryKey.match_type === 'contains' ? srcVal.includes(tgtVal) :
            srcVal === tgtVal;

          if (isMatch) {
            foundMatch = true;
            matchedTargetIndices.add(ti);
            matchedCount++;
            let hasDiscrepancy = false;
            matched_records.push({ source: srcRow, target: tgtRow, confidence: 1.0, matched_on: primaryKey.source_field });

            // Check remaining mappings for field-level differences
            for (const fm of keyMappings.slice(1)) {
              const sv = srcRow[fm.source_field];
              const tv = tgtRow[fm.target_field];
              if (fm.match_type === 'numeric_tolerance') {
                const nSv = parseFloat(String(sv));
                const nTv = parseFloat(String(tv));
                const tol = fm.tolerance ?? 0.01;
                if (!isNaN(nSv) && !isNaN(nTv) && Math.abs(nSv - nTv) > tol) {
                  discrepancyCount++;
                  hasDiscrepancy = true;
                  discrepancies.push({
                    source_record: srcRow, target_record: tgtRow,
                    field: `${fm.source_field} vs ${fm.target_field}`,
                    source_value: sv, target_value: tv,
                    difference: `Difference: ${(nSv - nTv).toFixed(2)}`,
                  });
                }
              } else {
                const sSv = String(sv ?? '').toLowerCase().trim();
                const sTv = String(tv ?? '').toLowerCase().trim();
                if (sSv !== sTv) {
                  discrepancyCount++;
                  hasDiscrepancy = true;
                  discrepancies.push({
                    source_record: srcRow, target_record: tgtRow,
                    field: `${fm.source_field} vs ${fm.target_field}`,
                    source_value: sv, target_value: tv,
                  });
                }
              }
            }
            if (hasDiscrepancy && matched_records.length > 0) {
              matched_records[matched_records.length - 1].confidence = 0.7;
            }
            break;
          }
        }
        if (!foundMatch) {
          unmatched_source_records.push(srcRow);
        }
      }

      const unmatched_target_records: Array<Record<string, unknown>> = [];
      for (let ti = 0; ti < targetData.length; ti++) {
        if (!matchedTargetIndices.has(ti)) {
          const tgtVal = String(targetData[ti][primaryKey.target_field] ?? '').trim();
          if (tgtVal) unmatched_target_records.push(targetData[ti]);
        }
      }

      return {
        id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
        executed_at: new Date().toISOString(), duration_ms: 0,
        status: (discrepancyCount > 0 || unmatched_source_records.length > 0 || unmatched_target_records.length > 0) ? 'partial' : 'completed',
        mode: 'compare',
        summary: {
          total_records_source: sourceData.length - skippedSource,
          total_records_target: targetData.length - skippedTargetCount,
          matched: matchedCount,
          unmatched_source: sourceData.length - skippedSource - matchedCount,
          unmatched_target: targetData.length - skippedTargetCount - matchedTargetIndices.size,
          discrepancies: discrepancyCount,
        },
        discrepancies: discrepancies?.length ? discrepancies : undefined,
        matched_records: matched_records.length ? matched_records : undefined,
        unmatched_source_records: unmatched_source_records.length ? unmatched_source_records : undefined,
        unmatched_target_records: unmatched_target_records.length ? unmatched_target_records : undefined,
      };
    }
  }

  // Fallback: no mappings — compare all fields of records by position
  let matchedCount = 0;
  let discrepancyCount = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];
  const limit = Math.min(sourceData.length, targetData.length);
  for (let i = 0; i < limit; i++) {
    const src = sourceData[i];
    const tgt = targetData[i];
    let rowMatch = true;
    for (const key of Object.keys(src)) {
      if (key in tgt && String(src[key] ?? '') !== String(tgt[key] ?? '')) {
        rowMatch = false;
        discrepancyCount++;
        if (discrepancies.length < 100) {
          discrepancies.push({
            source_record: src, target_record: tgt,
            field: key, source_value: src[key], target_value: tgt[key],
          });
        }
        break;
      }
    }
    if (rowMatch) matchedCount++;
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: discrepancyCount > 0 ? 'partial' : 'completed', mode: 'compare',
    summary: {
      total_records_source: sourceData.length, total_records_target: targetData.length,
      matched: matchedCount,
      unmatched_source: Math.max(0, sourceData.length - targetData.length),
      unmatched_target: Math.max(0, targetData.length - sourceData.length),
      discrepancies: discrepancyCount,
    },
    discrepancies: discrepancies?.length ? discrepancies : undefined,
  };
}

async function performExtraction(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  clusterId: string,
  tenantId: string,
  db: D1Database,
  companyId?: string,
): Promise<ExecutionResultRecord> {
  // Extract data from all sources, validate each record, and report quality issues
  // Fetch all source data once upfront (avoids double-fetching for emptiness check)
  const allSourceData: Array<{ source: typeof sources[0]; data: Record<string, unknown>[] }> = [];
  for (const src of sources) {
    const data = await fetchDataForSource(src, tenantId, db, companyId);
    allSourceData.push({ source: src, data });
  }
  if (allSourceData.every(d => d.data.length === 0)) {
    throw new Error(`No data found for extraction. All ERP data source tables are empty for this tenant. Please sync data from your ERP system first (Connectivity → Sync Now).`);
  }

  let totalRecords = 0;
  let validRecords = 0;
  let issueRecords = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];
  const exception_records: ExecutionResultRecord['exception_records'] = [];

  for (const { data } of allSourceData) {
    totalRecords += data.length;

    for (const row of data) {
      // Check for completeness: required fields should not be null/empty
      // Skip known optional/nullable fields that are legitimately empty
      const optionalFields = new Set([
        'notes', 'contact_phone', 'bank_name', 'bank_account', 'reference',
        'contact_email', 'contact_name', 'description', 'posted_by',
        'delivery_date', 'province', 'country', 'currency', 'uom',
        'product_group', 'warehouse', 'reorder_quantity', 'vat_rate',
      ]);
      const emptyFields: string[] = [];
      for (const [key, val] of Object.entries(row)) {
        if (optionalFields.has(key)) continue;
        if (val === null || val === undefined || String(val).trim() === '') {
          emptyFields.push(key);
        }
      }

      if (emptyFields.length > 0) {
        issueRecords++;
        if (discrepancies.length < 100) {
          discrepancies.push({
            source_record: row, target_record: null,
            field: emptyFields.join(', '),
            source_value: null, target_value: null,
            difference: `Missing/empty fields: ${emptyFields.join(', ')}`,
          });
        }

        // Raise as exception if >30% of fields are empty
        if (emptyFields.length > Object.keys(row).length * 0.3 && exception_records.length < 50) {
          exception_records.push({
            record: row, type: 'data_quality',
            severity: emptyFields.length > Object.keys(row).length * 0.5 ? 'high' : 'medium',
            detail: `${emptyFields.length} of ${Object.keys(row).length} fields empty: ${emptyFields.slice(0, 5).join(', ')}`,
          });
        }
      } else {
        validRecords++;
      }
    }
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: issueRecords > 0 ? 'partial' : 'completed',
    mode: sub.execution_config?.mode || 'extract',
    summary: {
      total_records_source: totalRecords, total_records_target: 0,
      matched: validRecords, unmatched_source: issueRecords, unmatched_target: 0,
      discrepancies: issueRecords,
    },
    discrepancies: discrepancies?.length ? discrepancies : undefined,
    exception_records: exception_records?.length ? exception_records : undefined,
  };
}

async function fetchDataForSource(
  source: { type: string; config: Record<string, unknown> },
  tenantId: string,
  db: D1Database,
  companyId?: string,
): Promise<Record<string, unknown>[]> {
  try {
    // source_filter: when set, adds a WHERE source_system = ? clause to differentiate
    // datasets seeded for the same table (e.g., 'SAP' vs 'PHYSICAL_COUNT')
    const sourceFilter = source.config.source_filter ? String(source.config.source_filter) : null;
    // Per-company scope (only applies to canonical erp_* tables which have a
    // company_id column — SAP/Odoo/Sage/Xero/QB native tables don't).
    const companyClause = companyId ? ' AND company_id = ?' : '';
    const companyBind: unknown[] = companyId ? [companyId] : [];

    if (source.type === 'erp') {
      const module = String(source.config.module || '').toLowerCase();

      // ── SAP Native Table Queries ──
      // These read directly from sap_* tables with authentic SAP field names.
      // The module name in data_sources config maps to the SAP table + optional filter.

      if (module === 'sap_bseg_vendor') {
        // BSEG vendor line items (KOART = 'K') joined with BKPF header
        const rows = await db.prepare(
          `SELECT b.BUKRS, b.BELNR, b.GJAHR, b.BUZEI, b.BSCHL, b.KOART, b.KONTO, b.DMBTR, b.WRBTR,
                  b.MWSKZ, b.MWSTS, b.SGTXT, b.LIFNR, b.EBELN, b.SHKZG, b.ZFBDT, b.ZBD1T,
                  h.BLART, h.BUDAT, h.BLDAT, h.XBLNR, h.BSTAT, h.WAERS, h.USNAM
           FROM sap_bseg b
           LEFT JOIN sap_bkpf h ON b.tenant_id = h.tenant_id AND b.BUKRS = h.BUKRS AND b.BELNR = h.BELNR AND b.GJAHR = h.GJAHR
           WHERE b.tenant_id = ? AND b.KOART = 'K'
           LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_bsik') {
        const rows = await db.prepare(
          `SELECT BUKRS, LIFNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS,
                  SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, EBELN
           FROM sap_bsik WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_bsid') {
        const rows = await db.prepare(
          `SELECT BUKRS, KUNNR, AUGDT, AUGBL, GJAHR, BELNR, BUZEI, BUDAT, BLDAT, WAERS,
                  SHKZG, DMBTR, WRBTR, SGTXT, ZFBDT, ZBD1T, XBLNR
           FROM sap_bsid WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_febep') {
        const rows = await db.prepare(
          `SELECT BUKRS, HESSION, AESSION, VALUT, KWBTR, WRBTR, WAERS, VWEZW, XBLNR, SGTXT
           FROM sap_febep WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_ekko') {
        const rows = await db.prepare(
          `SELECT EBELN, BUKRS, BSTYP, BSART, LOEKZ, STATU, AEDAT, LIFNR, EKGRP, WAERS,
                  BEDAT, RLWRT, ZTERM
           FROM sap_ekko WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_ekpo') {
        const rows = await db.prepare(
          `SELECT EBELN, EBELP, MATNR, TXZ01, MENGE, MEINS, NETPR, PEINH, NETWR, MATKL, WERKS, LGORT
           FROM sap_ekpo WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_ekbe_gr') {
        // EKBE Goods Receipts only (VGABE = '1')
        const rows = await db.prepare(
          `SELECT EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BEWTP, MENGE, WRBTR, WAERS, BUDAT
           FROM sap_ekbe WHERE tenant_id = ? AND VGABE = '1' LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_ekbe_ir') {
        // EKBE Invoice Receipts only (VGABE = '2')
        const rows = await db.prepare(
          `SELECT EBELN, EBELP, ZEESSION, VGABE, GJAHR, BELNR, BEWTP, MENGE, WRBTR, WAERS, BUDAT
           FROM sap_ekbe WHERE tenant_id = ? AND VGABE = '2' LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_mard') {
        const rows = await db.prepare(
          `SELECT MATNR, WERKS, LGORT, LABST, INSME, SPEME, EINME, RETME, LFGJA, LFMON
           FROM sap_mard WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_iseg') {
        const rows = await db.prepare(
          `SELECT IBLNR, GJAHR, ZEESSION, MATNR, WERKS, LGORT, MENGE, MEINS, BUCHM, XNULL, XDIFF
           FROM sap_iseg WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_vbak') {
        const rows = await db.prepare(
          `SELECT VBELN, AUART, VKORG, VTWEG, SPART, KUNNR, BSTNK, AUDAT, VDATU, NETWR, WAERK, VBTYP
           FROM sap_vbak WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_vbap') {
        const rows = await db.prepare(
          `SELECT VBELN, POSNR, MATNR, ARKTX, KWMENG, VRKME, NETPR, NETWR, WAERK, WERKS, MATKL
           FROM sap_vbap WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_vbrk') {
        // Billing document headers — include AUBEL from VBRP for order-to-bill matching
        const rows = await db.prepare(
          `SELECT k.VBELN, k.FKART, k.VKORG, k.KUNAG, k.FKDAT, k.RFBSK, k.NETWR, k.MWSBK, k.WAERK, k.BUKRS, k.XBLNR,
                  p.AUBEL, p.AUPOS, p.MATNR, p.ARKTX, p.FKIMG, p.NETWR as ITEM_NETWR
           FROM sap_vbrk k
           LEFT JOIN sap_vbrp p ON k.tenant_id = p.tenant_id AND k.VBELN = p.VBELN
           WHERE k.tenant_id = ?
           LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_lfa1') {
        // Vendor master with company code data
        const rows = await db.prepare(
          `SELECT a.LIFNR, a.LAND1, a.NAME1, a.NAME2, a.ORT01, a.PSTLZ, a.REGIO, a.STCD1, a.STCD2,
                  a.TELF1, a.KTOKK, a.LOEVM, a.SPERR, a.SPERM,
                  b.AKONT, b.ZTERM, b.ZWELS, b.REPRF, b.HBKID
           FROM sap_lfa1 a
           LEFT JOIN sap_lfb1 b ON a.tenant_id = b.tenant_id AND a.LIFNR = b.LIFNR
           WHERE a.tenant_id = ?
           LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      if (module === 'sap_kna1') {
        // Customer master with company code data
        const rows = await db.prepare(
          `SELECT a.KUNNR, a.LAND1, a.NAME1, a.NAME2, a.ORT01, a.PSTLZ, a.REGIO, a.STCD1,
                  a.TELF1, a.KTOKD, a.LOEVM, a.SPERR,
                  b.AKONT, b.ZTERM, b.KLIMK, b.CTLPC
           FROM sap_kna1 a
           LEFT JOIN sap_knb1 b ON a.tenant_id = b.tenant_id AND a.KUNNR = b.KUNNR
           WHERE a.tenant_id = ?
           LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      // ── Odoo Native Table Queries ──
      if (module === 'odoo_account_move' || module === 'odoo_account_move_invoice') {
        const typeFilter = module.includes('invoice') ? "AND move_type IN ('in_invoice','in_refund')" : '';
        const rows = await db.prepare(
          `SELECT name, move_type, partner_id, partner_name, invoice_date, date, invoice_date_due, ref,
                  state, amount_untaxed, amount_tax, amount_total, amount_residual, amount_paid,
                  currency_id, payment_state, invoice_origin
           FROM odoo_account_move WHERE tenant_id = ? ${typeFilter} LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_account_move_line') {
        const rows = await db.prepare(
          `SELECT l.move_id, l.move_name, l.account_id, l.account_name, l.partner_id, l.name,
                  l.debit, l.credit, l.balance, l.amount_currency, l.date_maturity, l.date,
                  l.reconciled, l.product_id, l.quantity, l.price_unit
           FROM odoo_account_move_line l WHERE l.tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_res_partner' || module === 'odoo_res_partner_supplier') {
        const rankFilter = module.includes('supplier') ? 'AND supplier_rank > 0' : '';
        const rows = await db.prepare(
          `SELECT name, display_name, partner_type, is_company, supplier_rank, customer_rank,
                  vat, company_registry, street, city, zip, country_id, phone, email,
                  property_payment_term_id, property_account_receivable_id, property_account_payable_id,
                  credit_limit, active
           FROM odoo_res_partner WHERE tenant_id = ? ${rankFilter} LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_res_partner_customer') {
        const rows = await db.prepare(
          `SELECT name, display_name, partner_type, is_company, customer_rank,
                  vat, company_registry, street, city, zip, country_id, phone, email,
                  property_payment_term_id, property_account_receivable_id, credit_limit, active
           FROM odoo_res_partner WHERE tenant_id = ? AND customer_rank > 0 LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_product_product') {
        const rows = await db.prepare(
          `SELECT default_code, name, barcode, type, categ_name, list_price, standard_price,
                  uom_id, qty_available, virtual_available, active
           FROM odoo_product_product WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_stock_quant') {
        const rows = await db.prepare(
          `SELECT product_id, product_name, location_id, location_name, lot_id,
                  quantity, reserved_quantity, inventory_date, inventory_quantity, inventory_diff_quantity
           FROM odoo_stock_quant WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_purchase_order') {
        const rows = await db.prepare(
          `SELECT name, partner_id, partner_name, date_order, date_planned, state,
                  amount_untaxed, amount_tax, amount_total, currency_id, invoice_status, receipt_status
           FROM odoo_purchase_order WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_purchase_order_line') {
        const rows = await db.prepare(
          `SELECT l.order_id, l.product_id, l.product_name, l.product_qty, l.qty_received,
                  l.qty_invoiced, l.product_uom, l.price_unit, l.price_subtotal, l.price_total, l.date_planned
           FROM odoo_purchase_order_line l WHERE l.tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_sale_order') {
        const rows = await db.prepare(
          `SELECT name, partner_id, partner_name, date_order, commitment_date, client_order_ref,
                  state, amount_untaxed, amount_tax, amount_total, currency_id, invoice_status, delivery_status
           FROM odoo_sale_order WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_sale_order_line') {
        const rows = await db.prepare(
          `SELECT order_id, product_id, product_name, product_uom_qty, qty_delivered,
                  qty_invoiced, product_uom, price_unit, price_subtotal, price_total
           FROM odoo_sale_order_line WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_account_bank_statement_line') {
        const rows = await db.prepare(
          `SELECT statement_id, journal_id, date, payment_ref, partner_name, amount,
                  amount_currency, currency_id, account_number, is_reconciled
           FROM odoo_account_bank_statement_line WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'odoo_account_payment') {
        const rows = await db.prepare(
          `SELECT name, payment_type, partner_type, partner_name, amount, currency_id,
                  date, ref, state
           FROM odoo_account_payment WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      // ── Sage Native Table Queries ──
      if (module === 'sage_customer') {
        const rows = await db.prepare(
          `SELECT AccountReference, CompanyName, ContactName, City, Country, TelephoneNumber,
                  EmailAddress, VATRegistrationNumber, CreditLimit, Balance, TermsAgreed,
                  NominalCode, CurrencyCode, AccountStatus
           FROM sage_customer WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_supplier') {
        const rows = await db.prepare(
          `SELECT AccountReference, CompanyName, ContactName, City, Country, TelephoneNumber,
                  EmailAddress, VATRegistrationNumber, CreditLimit, Balance, TermsAgreed,
                  NominalCode, BankName, BankAccountNumber, BankSortCode, AccountStatus
           FROM sage_supplier WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_sales_invoice') {
        const rows = await db.prepare(
          `SELECT InvoiceNumber, AccountReference, CustomerName, InvoiceDate, DueDate,
                  NetAmount, TaxAmount, GrossAmount, AmountPaid, AmountOutstanding,
                  TaxCode, NominalCode, Reference, Status, CurrencyCode
           FROM sage_sales_invoice WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_purchase_invoice') {
        const rows = await db.prepare(
          `SELECT InvoiceNumber, AccountReference, SupplierName, InvoiceDate, DueDate,
                  NetAmount, TaxAmount, GrossAmount, AmountPaid, AmountOutstanding,
                  TaxCode, NominalCode, Reference, Status, CurrencyCode
           FROM sage_purchase_invoice WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_stock_item') {
        const rows = await db.prepare(
          `SELECT ProductCode, Description, Category, SalePrice, CostPrice,
                  QuantityInStock, ReorderLevel, ReorderQuantity, UnitOfMeasure,
                  Location, InactiveFlag
           FROM sage_stock_item WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_bank_transaction') {
        const rows = await db.prepare(
          `SELECT BankAccountReference, TransactionDate, TransactionType, Reference, Details,
                  NetAmount, TaxAmount, GrossAmount, PaymentMethod, NominalCode, Reconciled, CurrencyCode
           FROM sage_bank_transaction WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_purchase_order') {
        const rows = await db.prepare(
          `SELECT OrderNumber, AccountReference, SupplierName, OrderDate, DeliveryDate,
                  NetAmount, TaxAmount, GrossAmount, Status, DeliveryStatus, Reference, CurrencyCode
           FROM sage_purchase_order WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_goods_received') {
        const rows = await db.prepare(
          `SELECT GRNNumber, OrderNumber, SupplierName, ReceivedDate, ProductCode,
                  Description, QuantityOrdered, QuantityReceived, UnitCost, TotalCost, Status
           FROM sage_goods_received WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'sage_nominal_ledger') {
        const rows = await db.prepare(
          `SELECT NominalCode, NominalName, NominalType, CategoryCode, Balance, BudgetBalance, PriorYearBalance
           FROM sage_nominal_ledger WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      // ── Xero Native Table Queries ──
      if (module === 'xero_invoice' || module === 'xero_invoice_accrec') {
        const typeFilter = module.includes('accrec') ? "AND Type = 'ACCREC'" : '';
        const rows = await db.prepare(
          `SELECT InvoiceNumber, Type, Reference, ContactName, Date, DueDate, Status,
                  SubTotal, TotalTax, Total, AmountDue, AmountPaid, AmountCredited,
                  CurrencyCode, CurrencyRate, SentToContact
           FROM xero_invoice WHERE tenant_id = ? ${typeFilter} LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_invoice_accpay') {
        const rows = await db.prepare(
          `SELECT InvoiceNumber, Type, Reference, ContactName, Date, DueDate, Status,
                  SubTotal, TotalTax, Total, AmountDue, AmountPaid, CurrencyCode
           FROM xero_invoice WHERE tenant_id = ? AND Type = 'ACCPAY' LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_contact' || module === 'xero_contact_supplier') {
        const supplierFilter = module.includes('supplier') ? 'AND IsSupplier = 1' : '';
        const rows = await db.prepare(
          `SELECT Name, ContactNumber, ContactStatus, EmailAddress, IsSupplier, IsCustomer,
                  TaxNumber, DefaultCurrency, Phone, City, Country,
                  Balances_AccountsReceivable_Outstanding, Balances_AccountsPayable_Outstanding
           FROM xero_contact WHERE tenant_id = ? ${supplierFilter} LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_contact_customer') {
        const rows = await db.prepare(
          `SELECT Name, ContactNumber, ContactStatus, EmailAddress, IsCustomer,
                  TaxNumber, DefaultCurrency, Phone, City, Country,
                  Balances_AccountsReceivable_Outstanding
           FROM xero_contact WHERE tenant_id = ? AND IsCustomer = 1 LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_bank_transaction') {
        const rows = await db.prepare(
          `SELECT Type, ContactName, BankAccountName, Date, Reference, IsReconciled,
                  Status, SubTotal, TotalTax, Total, CurrencyCode
           FROM xero_bank_transaction WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_payment') {
        const rows = await db.prepare(
          `SELECT PaymentType, InvoiceNumber, Date, Amount, Reference, Status, BankAccountName
           FROM xero_payment WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_item') {
        const rows = await db.prepare(
          `SELECT Code, Name, Description, PurchaseUnitPrice, SalesUnitPrice,
                  QuantityOnHand, TotalCostPool, IsTrackedAsInventory, IsSold, IsPurchased
           FROM xero_item WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_manual_journal') {
        const rows = await db.prepare(
          `SELECT Date, Narration, Status, JournalLines, ShowOnCashBasisReports
           FROM xero_manual_journal WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'xero_purchase_order') {
        const rows = await db.prepare(
          `SELECT PurchaseOrderNumber, ContactName, Date, DeliveryDate, Reference,
                  Status, SubTotal, TotalTax, Total, CurrencyCode, SentToContact
           FROM xero_purchase_order WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      // ── QuickBooks Native Table Queries ──
      if (module === 'qb_invoice') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, DueDate, CustomerRef_name, TotalAmt, Balance,
                  TxnTaxDetail_TotalTax, CurrencyRef, SalesTermRef, PrintStatus, EmailStatus
           FROM qb_invoice WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_bill') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, DueDate, VendorRef_name, TotalAmt, Balance,
                  TxnTaxDetail_TotalTax, CurrencyRef, APAccountRef, SalesTermRef
           FROM qb_bill WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_customer') {
        const rows = await db.prepare(
          `SELECT DisplayName, CompanyName, GivenName, FamilyName, PrimaryEmailAddr,
                  PrimaryPhone, BillAddr_City, BillAddr_Country, Balance, CurrencyRef,
                  PreferredDeliveryMethod, Active
           FROM qb_customer WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_vendor') {
        const rows = await db.prepare(
          `SELECT DisplayName, CompanyName, PrimaryEmailAddr, PrimaryPhone,
                  BillAddr_City, BillAddr_Country, TaxIdentifier, AcctNum, Balance,
                  CurrencyRef, TermRef, Active, Vendor1099
           FROM qb_vendor WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_item') {
        const rows = await db.prepare(
          `SELECT Name, Sku, Type, Description, UnitPrice, PurchaseCost,
                  QtyOnHand, ReorderPoint, TrackQtyOnHand, Taxable, Active
           FROM qb_item WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_payment') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, CustomerRef_name, TotalAmt, UnappliedAmt,
                  CurrencyRef, PaymentRefNum
           FROM qb_payment WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_bill_payment') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, VendorRef_name, TotalAmt, CurrencyRef, PayType
           FROM qb_bill_payment WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_journal_entry') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, TotalAmt, Adjustment, PrivateNote, CurrencyRef
           FROM qb_journal_entry WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_purchase_order') {
        const rows = await db.prepare(
          `SELECT DocNumber, TxnDate, VendorRef_name, TotalAmt, TxnTaxDetail_TotalTax,
                  CurrencyRef, POStatus, DueDate, Memo
           FROM qb_purchase_order WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'qb_deposit') {
        const rows = await db.prepare(
          `SELECT TxnDate, DepositToAccountRef_name, TotalAmt, CurrencyRef, PrivateNote
           FROM qb_deposit WHERE tenant_id = ? LIMIT 500`
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }

      // ── Legacy ERP Table Queries (backward compatibility) ──
      // These hit canonical erp_* tables which all have a nullable company_id
      // column. When companyId is provided we also filter by it; otherwise
      // consolidated (original behaviour).

      if (module.includes('invoice') || module.includes('accounts_payable') || module.includes('ap')) {
        const q = sourceFilter
          ? `SELECT invoice_number, invoice_date, due_date, total, subtotal, vat_amount, amount_paid, amount_due, status, payment_status, customer_name, reference, notes FROM erp_invoices WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT invoice_number, invoice_date, due_date, total, subtotal, vat_amount, amount_paid, amount_due, status, payment_status, customer_name, reference, notes FROM erp_invoices WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('customer') || module.includes('accounts_receivable') || module.includes('ar')) {
        const q = sourceFilter
          ? `SELECT id, name, registration_number, customer_group, credit_limit, credit_balance, payment_terms, contact_name, contact_email, contact_phone, status FROM erp_customers WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT id, name, registration_number, customer_group, credit_limit, credit_balance, payment_terms, contact_name, contact_email, contact_phone, status FROM erp_customers WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('product') || module.includes('inventory') || module.includes('stock')) {
        const q = sourceFilter
          ? `SELECT sku, name, stock_on_hand, reorder_level, cost_price, selling_price, category FROM erp_products WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT sku, name, stock_on_hand, reorder_level, cost_price, selling_price, category FROM erp_products WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('supplier') || module.includes('vendor')) {
        const q = sourceFilter
          ? `SELECT id, name, vat_number, supplier_group, payment_terms, contact_name, contact_email, contact_phone, bank_name, bank_account, status FROM erp_suppliers WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT id, name, vat_number, supplier_group, payment_terms, contact_name, contact_email, contact_phone, bank_name, bank_account, status FROM erp_suppliers WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('purchase_order') || module === 'po' || module.includes('procurement')) {
        const q = sourceFilter
          ? `SELECT po_number, supplier_name, order_date, delivery_date, subtotal, vat_amount, total, status, delivery_status, reference FROM erp_purchase_orders WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT po_number, supplier_name, order_date, delivery_date, subtotal, vat_amount, total, status, delivery_status, reference FROM erp_purchase_orders WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('bank') || module.includes('bank_statement') || module.includes('cash')) {
        const q = sourceFilter
          ? `SELECT bank_account, transaction_date, description, reference, debit, credit, balance, reconciled FROM erp_bank_transactions WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT bank_account, transaction_date, description, reference, debit, credit, balance, reconciled FROM erp_bank_transactions WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module === 'gl' || module.includes('general_ledger') || module.includes('journal')) {
        const q = sourceFilter
          ? `SELECT journal_number, journal_date, description, total_debit, total_credit, status, posted_by FROM erp_journal_entries WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
          : `SELECT journal_number, journal_date, description, total_debit, total_credit, status, posted_by FROM erp_journal_entries WHERE tenant_id = ?${companyClause} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('goods_receipt') || module === 'gr' || module.includes('delivery')) {
        const baseWhere = sourceFilter
          ? `tenant_id = ? AND source_system = ? AND delivery_status IN ('received', 'partial')${companyClause}`
          : `tenant_id = ? AND delivery_status IN ('received', 'partial')${companyClause}`;
        const q = `SELECT po_number, supplier_name, delivery_date, total, delivery_status, reference FROM erp_purchase_orders WHERE ${baseWhere} LIMIT 500`;
        const rows = sourceFilter
          ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
          : await db.prepare(q).bind(tenantId, ...companyBind).all();
        return rows.results as Record<string, unknown>[];
      }
      // Default: try invoices as a common ERP data set
      const q = sourceFilter
        ? `SELECT invoice_number, invoice_date, total, status, customer_name, reference FROM erp_invoices WHERE tenant_id = ? AND source_system = ?${companyClause} LIMIT 500`
        : `SELECT invoice_number, invoice_date, total, status, customer_name, reference FROM erp_invoices WHERE tenant_id = ?${companyClause} LIMIT 500`;
      const rows = sourceFilter
        ? await db.prepare(q).bind(tenantId, sourceFilter, ...companyBind).all()
        : await db.prepare(q).bind(tenantId, ...companyBind).all();
      return rows.results as Record<string, unknown>[];
    }

    if (source.type === 'custom_system') {
      const rows = await db.prepare(
        'SELECT metric_name as reference, metric_value as amount, status, updated_at as date, dimension as category FROM process_metrics WHERE tenant_id = ? LIMIT 500'
      ).bind(tenantId).all();
      return rows.results as Record<string, unknown>[];
    }

    // For email, cloud_storage, upload: return process_metrics as available data
    const rows = await db.prepare(
      'SELECT metric_name as reference, metric_value as amount, status, updated_at as date FROM process_metrics WHERE tenant_id = ? LIMIT 200'
    ).bind(tenantId).all();
    return rows.results as Record<string, unknown>[];
  } catch (err) {
    console.error(`fetchDataForSource error for type=${source.type}:`, err);
    throw new Error(`Data source fetch failed (type=${source.type}, module=${source.config.module || 'unknown'}): ${(err as Error).message}`);
  }
}

// ── LLM-Powered Execution Analysis ──
// Uses the tenant's configured LLM provider (Atheon model trained on ERP/industry data)
// to analyze sub-catalyst results and provide intelligent, context-aware insights.
// Falls back gracefully — rules-based results are always preserved if LLM is unavailable.

async function llmAnalyzeExecution(
  result: ExecutionResultRecord,
  subCatalystName: string,
  domain: string,
  industry: string,
  mode: string,
  tenantId: string,
  db: D1Database,
  ai: Ai,
): Promise<ExecutionResultRecord['llm_analysis'] | null> {
  const config = await loadLlmConfig(db, tenantId);

  // Build a concise data sample for the LLM (max 5 discrepancies to keep token usage low)
  const sampleDiscrepancies = (result.discrepancies || []).slice(0, 5).map(d => ({
    field: d.field,
    source_value: d.source_value,
    target_value: d.target_value,
    difference: d.difference,
  }));

  const sampleUnmatched = (result.unmatched_source_records || []).slice(0, 3).map(r => {
    const keys = Object.keys(r).slice(0, 6);
    const sample: Record<string, unknown> = {};
    for (const k of keys) sample[k] = r[k];
    return sample;
  });

  const systemPrompt = `You are Atheon Intelligence, an ERP data analysis engine trained on ${industry} industry data. You analyze sub-catalyst execution results and provide actionable insights.

Context:
- Industry: ${industry}
- Domain: ${domain}
- Sub-catalyst: ${subCatalystName}
- Execution mode: ${mode}

You MUST respond with valid JSON only (no markdown, no code fences). Use this exact schema:
{
  "reasoning": "2-3 sentence analysis of what the results mean for this specific industry/ERP context",
  "recommendations": ["actionable recommendation 1", "actionable recommendation 2", "actionable recommendation 3"],
  "risk_factors": ["specific risk based on the data patterns"],
  "industry_context": "How these findings relate to ${industry} industry standards and compliance",
  "confidence_assessment": "How confident the system is in these results and why",
  "erp_specific_notes": "ERP-specific observations about data quality, field completeness, or integration issues"
}`;

  const userPrompt = `Analyze this ${mode} execution for "${subCatalystName}" in the ${domain} domain:

Summary:
- Source records: ${result.summary.total_records_source}
- Target records: ${result.summary.total_records_target}
- Matched: ${result.summary.matched}
- Unmatched source: ${result.summary.unmatched_source}
- Unmatched target: ${result.summary.unmatched_target}
- Discrepancies: ${result.summary.discrepancies}
- Status: ${result.status}

${sampleDiscrepancies.length > 0 ? `Sample discrepancies:\n${JSON.stringify(sampleDiscrepancies, null, 1)}` : 'No discrepancies found.'}
${sampleUnmatched.length > 0 ? `\nSample unmatched records:\n${JSON.stringify(sampleUnmatched, null, 1)}` : ''}

Provide your analysis as JSON.`;

  const messages: LlmMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ];

  // ── Budget: reserve an estimate before the call; deny if over monthly cap.
  const estimatedTokens = estimateTokensFor(messages) + 1024;
  const budget = await checkAndReserveBudget(db, tenantId, estimatedTokens);
  if (!budget.allowed) {
    console.warn(`catalyst.reasoning LLM blocked for tenant ${tenantId}: ${budget.reason}`);
    return null;
  }

  const llmResponse = await llmChatWithFallback(config, ai, messages, {
    maxTokens: 1024,
    temperature: 0.3,
    timeoutMs: 12000,
  });

  // ── Record actual usage + reconcile.
  await recordLlmUsage(
    db,
    tenantId,
    config.provider,
    config.model_id || 'default',
    'catalyst.reasoning',
    llmResponse.tokensIn,
    llmResponse.tokensOut,
    undefined,
    estimatedTokens,
  );

  const cleaned = stripCodeFences(llmResponse.text);
  const parsed = JSON.parse(cleaned) as {
    reasoning?: string;
    recommendations?: string[];
    risk_factors?: string[];
    industry_context?: string;
    confidence_assessment?: string;
    erp_specific_notes?: string;
  };

  return {
    reasoning: parsed.reasoning || 'Analysis completed.',
    recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
    risk_factors: Array.isArray(parsed.risk_factors) ? parsed.risk_factors : [],
    industry_context: parsed.industry_context || '',
    confidence_assessment: parsed.confidence_assessment || '',
    erp_specific_notes: parsed.erp_specific_notes || '',
  };
}

// ── Exception Pipeline: Auto-raise exceptions from execution results ──

interface ExceptionThresholds {
  discrepancy_rate_pct: number;   // raise exception if discrepancy rate exceeds this (default: 10%)
  match_rate_pct: number;         // raise exception if match rate drops below this (default: 50%)
  unmatched_threshold: number;    // raise exception if unmatched records exceed this (default: 20)
  auto_escalate_on_failure: boolean; // auto-escalate to L1 on execution failure (default: true)
}

const DEFAULT_THRESHOLDS: ExceptionThresholds = {
  discrepancy_rate_pct: 10,
  match_rate_pct: 50,
  unmatched_threshold: 20,
  auto_escalate_on_failure: true,
};

function getThresholds(execConfig: { parameters?: Record<string, unknown> }): ExceptionThresholds {
  const p = execConfig.parameters || {};
  return {
    discrepancy_rate_pct: typeof p.exception_discrepancy_threshold === 'number' ? p.exception_discrepancy_threshold : DEFAULT_THRESHOLDS.discrepancy_rate_pct,
    match_rate_pct: typeof p.exception_match_rate_threshold === 'number' ? p.exception_match_rate_threshold : DEFAULT_THRESHOLDS.match_rate_pct,
    unmatched_threshold: typeof p.exception_unmatched_threshold === 'number' ? p.exception_unmatched_threshold : DEFAULT_THRESHOLDS.unmatched_threshold,
    auto_escalate_on_failure: typeof p.auto_escalate_on_failure === 'boolean' ? p.auto_escalate_on_failure : DEFAULT_THRESHOLDS.auto_escalate_on_failure,
  };
}

async function raiseExecutionExceptions(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string,
  result: ExecutionResultRecord,
  execConfig: { mode: string; parameters?: Record<string, unknown> },
): Promise<string[]> {
  const thresholds = getThresholds(execConfig);
  const exceptions: Array<{
    type: string;
    detail: string;
    severity: string;
    escalationLevel: string | null;
    confidence: number;
  }> = [];

  const summary = result.summary;

  // 1. Execution failed entirely
  if (result.status === 'failed') {
    exceptions.push({
      type: 'execution_failed',
      detail: `Execution failed: ${result.error || 'Unknown error'}. Sub-catalyst "${subName}" could not complete ${execConfig.mode} mode. Manual investigation required.`,
      severity: 'high',
      escalationLevel: thresholds.auto_escalate_on_failure ? 'L1' : null,
      confidence: 1.0,
    });
  }

  // Only check data-quality exceptions if execution succeeded or partially succeeded
  if (result.status === 'completed' || result.status === 'partial') {
    const totalSource = summary.total_records_source || 0;
    const _totalTarget = summary.total_records_target || 0;
    void _totalTarget;
    const matched = summary.matched || 0;
    const discrepancies = summary.discrepancies || 0;
    const unmatchedSource = summary.unmatched_source || 0;
    const unmatchedTarget = summary.unmatched_target || 0;

    // 2. High discrepancy rate
    if (matched > 0) {
      const discrepancyRate = (discrepancies / matched) * 100;
      if (discrepancyRate > thresholds.discrepancy_rate_pct) {
        exceptions.push({
          type: 'high_discrepancy_rate',
          detail: `${discrepancies} discrepancies found across ${matched} matched records (${discrepancyRate.toFixed(1)}% discrepancy rate, threshold: ${thresholds.discrepancy_rate_pct}%). Review mismatched fields between source and target data.`,
          severity: discrepancyRate > 50 ? 'high' : 'medium',
          escalationLevel: discrepancyRate > 50 ? 'L1' : null,
          confidence: Math.min(discrepancyRate / 100, 1.0),
        });
      }
    }

    // 3. Low match rate
    if (totalSource > 0) {
      const matchRate = (matched / totalSource) * 100;
      if (matchRate < thresholds.match_rate_pct) {
        const severity = matchRate < 10 ? 'high' : matchRate < 30 ? 'medium' : 'low';
        exceptions.push({
          type: 'low_match_rate',
          detail: `Only ${matched} of ${totalSource} source records matched (${matchRate.toFixed(1)}% match rate, threshold: ${thresholds.match_rate_pct}%). This may indicate misaligned field mappings, data quality issues, or missing records in the target system.`,
          severity,
          escalationLevel: matchRate < 10 ? 'L1' : null,
          confidence: Math.max(1.0 - matchRate / 100, 0.5),
        });
      }
    }

    // 4. Significant unmatched records
    if (unmatchedSource > thresholds.unmatched_threshold || unmatchedTarget > thresholds.unmatched_threshold) {
      const side = unmatchedSource > unmatchedTarget ? 'source' : 'target';
      const count = Math.max(unmatchedSource, unmatchedTarget);
      exceptions.push({
        type: 'unmatched_records',
        detail: `${unmatchedSource} unmatched source record${unmatchedSource !== 1 ? 's' : ''} and ${unmatchedTarget} unmatched target record${unmatchedTarget !== 1 ? 's' : ''} (threshold: ${thresholds.unmatched_threshold}). The ${side} side has the most gaps — check for missing or delayed entries.`,
        severity: count > thresholds.unmatched_threshold * 3 ? 'high' : 'medium',
        escalationLevel: null,
        confidence: Math.min(count / (totalSource || 1), 1.0),
      });
    }
  }

  // Insert exceptions as catalyst_actions
  const actionIds: string[] = [];
  for (const exc of exceptions) {
    const actionId = crypto.randomUUID();

    try {
      await db.prepare(
        'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, output_data, reasoning, escalation_level, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
      ).bind(
        actionId,
        clusterId,
        tenantId,
        subName,
        `${execConfig.mode}_exception`,
        exc.escalationLevel ? 'escalated' : 'exception',
        exc.confidence,
        JSON.stringify({
          execution_id: result.id,
          mode: execConfig.mode,
          sub_catalyst: subName,
          summary: result.summary,
          thresholds,
        }),
        JSON.stringify({
          exception_type: exc.type,
          exception_detail: exc.detail,
          severity: exc.severity,
          execution_summary: result.summary,
          discrepancy_sample: result.discrepancies?.slice(0, 5) || [],
        }),
        exc.detail,
        exc.escalationLevel,
      ).run();
      actionIds.push(actionId);
    } catch (err) {
      console.error('Failed to insert execution exception:', err);
      continue;
    }

    // Write execution log step for each successfully persisted exception
    await writeLog(db, tenantId, result.id, actionIds.length + 1, `Exception: ${exc.type}`, 'failed', exc.detail, 0);
  }

  return actionIds;
}

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/schedule - Set schedule for a sub-catalyst
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/schedule', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure schedules' }, 403);
  }

  const body = await c.req.json<{
    frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
    day_of_week?: number;
    day_of_month?: number;
    time_of_day?: string;
  }>();

  if (!body.frequency || !['manual', 'daily', 'weekly', 'monthly'].includes(body.frequency)) {
    return c.json({ error: 'Invalid frequency. Must be: manual, daily, weekly, or monthly' }, 400);
  }
  if (body.frequency === 'weekly' && (body.day_of_week === undefined || body.day_of_week < 0 || body.day_of_week > 6)) {
    return c.json({ error: 'Weekly schedule requires day_of_week (0=Sun..6=Sat)' }, 400);
  }
  if (body.frequency === 'monthly' && (body.day_of_month === undefined || body.day_of_month < 1 || body.day_of_month > 31)) {
    return c.json({ error: 'Monthly schedule requires day_of_month (1-31)' }, 400);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as Array<Record<string, unknown>>;
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  // Calculate next run time
  const nextRun = calculateNextRun(body.frequency, body.day_of_week, body.day_of_month, body.time_of_day);

  subs[idx].schedule = {
    frequency: body.frequency,
    ...(body.day_of_week !== undefined ? { day_of_week: body.day_of_week } : {}),
    ...(body.day_of_month !== undefined ? { day_of_month: body.day_of_month } : {}),
    ...(body.time_of_day ? { time_of_day: body.time_of_day } : {}),
    next_run: nextRun,
  };

  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.schedule_configured', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName, frequency: body.frequency, next_run: nextRun }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// DELETE /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/schedule - Remove schedule (set to manual)
catalysts.delete('/clusters/:clusterId/sub-catalysts/:subName/schedule', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden', message: 'Only admins can configure schedules' }, 403);
  }

  const targetTenant = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const cluster = await c.env.DB.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, targetTenant).first<{ sub_catalysts: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subs = JSON.parse(cluster.sub_catalysts || '[]') as Array<Record<string, unknown>>;
  const idx = subs.findIndex((s) => s.name === subName);
  if (idx === -1) return c.json({ error: 'Sub-catalyst not found' }, 404);

  delete subs[idx].schedule;
  await c.env.DB.prepare('UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?')
    .bind(JSON.stringify(subs), clusterId, targetTenant).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), targetTenant, 'catalyst.sub_catalyst.schedule_removed', 'catalysts', clusterId,
    JSON.stringify({ sub_catalyst: subName }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, subCatalyst: subs[idx] });
});

// PUT /api/catalysts/clusters/:id
catalysts.put('/clusters/:id', async (c) => {
  const id = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminRole(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'Only admins can update catalyst clusters' }, 403);
  }

  const tenantId = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;
  const body = await c.req.json<{ status?: string; autonomy_tier?: string }>();

  // Validate update fields - whitelist approach for security
  const allowedStatus = new Set(['active', 'inactive']);
  const allowedAutonomy = new Set(['read-only', 'assisted', 'transactional']);

  if (body.status && !allowedStatus.has(body.status)) {
    return c.json({ error: 'Invalid status', message: `Allowed: ${[...allowedStatus].join(', ')}` }, 400);
  }
  if (body.autonomy_tier && !allowedAutonomy.has(body.autonomy_tier)) {
    return c.json({ error: 'Invalid autonomy_tier', message: `Allowed: ${[...allowedAutonomy].join(', ')}` }, 400);
  }

  // Enforce tenant ownership on cluster updates - tenant isolation
  const existing = await c.env.DB.prepare('SELECT id FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Cluster not found' }, 404);

  const updates: string[] = [];
  const values: unknown[] = [];
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.autonomy_tier) { updates.push('autonomy_tier = ?'); values.push(body.autonomy_tier); }

  if (updates.length > 0) {
    values.push(id, tenantId);
    await c.env.DB.prepare(`UPDATE catalyst_clusters SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...values).run();
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)' 
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.cluster.updated', 'catalysts', id,
    JSON.stringify({ status: body.status, autonomy_tier: body.autonomy_tier }),
    'success'
  ).run().catch((err) => { console.error('Failed to write audit log for cluster update:', err); });

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
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  const tenantId = canCrossTenant(auth?.role) ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;
  const { data: body, errors } = await getValidatedJsonBody<{
    cluster_id: string; catalyst_name: string; action: string;
    confidence?: number; input_data?: Record<string, unknown>; reasoning?: string;
    risk_level?: string;
    company_id?: string;
  }>(c, [
    { field: 'cluster_id', type: 'string', required: true, minLength: 1 },
    { field: 'catalyst_name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'action', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'risk_level', type: 'string', required: false, maxLength: 32 },
    { field: 'company_id', type: 'string', required: false, maxLength: 128 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Get cluster info for autonomy tier and trust score
  const cluster = await c.env.DB.prepare(
    'SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
  ).bind(body.cluster_id, tenantId).first();

  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  // Optional per-company scope — validate via erp_companies lookup. Query
  // string takes precedence over body so a superadmin can override on retry.
  const rawCompanyId = c.req.query('company_id') || body.company_id;
  let scopedCompanyId: string | undefined;
  if (rawCompanyId && rawCompanyId.trim()) {
    const companyRow = await c.env.DB.prepare(
      'SELECT id FROM erp_companies WHERE tenant_id = ? AND id = ?',
    ).bind(tenantId, rawCompanyId.trim()).first<{ id: string }>();
    if (!companyRow) {
      return c.json({ error: 'Company not found', message: 'company_id does not belong to this tenant' }, 404);
    }
    scopedCompanyId = companyRow.id;
  }

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
    companyId: scopedCompanyId,
  }, c.env.DB, c.env.CACHE, c.env.AI, c.env.OLLAMA_API_KEY, c.env.CATALYST_QUEUE);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.action.executed', 'catalysts', body.cluster_id,
    JSON.stringify({ action_id: result.actionId, catalyst: body.catalyst_name, action: body.action, confidence: result.confidence, status: result.status }),
    result.status === 'failed' ? 'failure' : 'success',
  ).run();

  // Structured observability log — support uses this to trace an action through a user report
  const emit = result.status === 'failed' ? logWarn : logInfo;
  emit('catalyst.action.executed', {
    requestId: c.get('requestId'),
    tenantId,
    userId: auth?.userId,
    layer: 'catalysts',
    action: 'catalyst.action.executed',
  }, {
    actionId: result.actionId,
    clusterId: body.cluster_id,
    catalystName: body.catalyst_name,
    actionName: body.action,
    status: result.status,
    confidence: result.confidence,
    executionTimeMs: result.executionTimeMs,
  });

  return c.json(result, 201);
});

// PUT /api/catalysts/actions/:id/approve - Approve via execution engine
catalysts.put('/actions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string }>();

  const result = await approveAction(id, body.approved_by || 'system', c.env.DB, c.env.CACHE);

  // Send completion notification to HITL-configured users
  try {
    const action = await c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE id = ?').bind(id).first();
    if (action) {
      await sendHitlNotification(c.env.DB, c.env, action.tenant_id as string, action.cluster_id as string, 'completion', {
        catalystName: action.catalyst_name as string,
        action: action.action as string,
        status: 'approved',
        confidence: action.confidence as number || 0,
      });
    }
  } catch (err) { console.error('HITL approve notification failed (non-critical):', err); }

  return c.json(result);
});

// PUT /api/catalysts/actions/:id/reject - Reject via execution engine
catalysts.put('/actions/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string; reason?: string }>();

  const result = await rejectAction(id, body.approved_by || 'system', body.reason || '', c.env.DB, c.env.CACHE);

  // Send exception notification to HITL-configured users
  try {
    const action = await c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE id = ?').bind(id).first();
    if (action) {
      await sendHitlNotification(c.env.DB, c.env, action.tenant_id as string, action.cluster_id as string, 'exception', {
        catalystName: action.catalyst_name as string,
        action: action.action as string,
        status: 'rejected',
        confidence: action.confidence as number || 0,
        reason: body.reason,
      });
    }
  } catch (err) { console.error('HITL reject notification failed (non-critical):', err); }

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
    } catch (err) {
      console.error('R2 file storage failed (non-critical):', err);
    }
  }

  // Generate Apex/Pulse insights from catalyst execution (pass actionId for execution logs)
  const clusterDomain = (cluster.domain as string) || 'finance';
  try {
    await generateInsightsForTenant(c.env.DB, tenantId, catalystName, clusterDomain, actionId, undefined, clusterId, undefined);
  } catch (err) {
    console.error('Insight generation failed (non-critical):', err);
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
    message: `Manual catalyst execution created for ${catalystName}. Period: ${startDatetime} to ${endDatetime}.${fileName ? ` File: ${fileName}` : ''} Apex/Pulse insights generated.`,
    startDatetime,
    endDatetime,
    fileName,
  }, 201);
});

// GET /api/catalysts/execution-logs - Get execution logs for an action or all recent logs
catalysts.get('/execution-logs', async (c) => {
  const tenantId = getTenantId(c);
  const actionId = c.req.query('action_id');
  const limit = parseInt(c.req.query('limit') || '100');

  let query: string;
  const binds: unknown[] = [tenantId];

  if (actionId) {
    query = 'SELECT * FROM execution_logs WHERE tenant_id = ? AND action_id = ? ORDER BY step_number ASC, created_at DESC LIMIT ?';
    binds.push(actionId, limit * 3);
  } else {
    query = 'SELECT * FROM execution_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?';
    binds.push(limit * 3);
  }

  try {
    const results = await c.env.DB.prepare(query).bind(...binds).all();
    const allLogs = results.results.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      actionId: r.action_id as string,
      stepNumber: r.step_number as number,
      stepName: r.step_name as string,
      status: r.status as string,
      detail: r.detail as string,
      durationMs: r.duration_ms as number | null,
      createdAt: r.created_at as string,
    }));
    // Deduplicate: keep only the final status per (action_id, step_number, step_name).
    // If a 'completed'/'failed' row exists, prefer it over 'running'.
    const seen = new Map<string, typeof allLogs[number]>();
    for (const log of allLogs) {
      const key = `${log.actionId}:${log.stepNumber}:${log.stepName}`;
      const existing = seen.get(key);
      if (!existing) { seen.set(key, log); continue; }
      // Prefer completed/failed over running/pending
      const finalStatuses = new Set(['completed', 'failed']);
      if (finalStatuses.has(log.status) && !finalStatuses.has(existing.status)) {
        seen.set(key, log);
      }
    }
    const logs = [...seen.values()].slice(0, limit);
    return c.json({ logs, total: logs.length });
  } catch (err) {
    console.error('execution-logs query failed:', err);
    return c.json({ logs: [], total: 0 });
  }
});

// GET /api/catalysts/execution-logs/:actionId - Get logs for a specific action
catalysts.get('/execution-logs/:actionId', async (c) => {
  const tenantId = getTenantId(c);
  const actionId = c.req.param('actionId');

  try {
    const results = await c.env.DB.prepare(
      'SELECT * FROM execution_logs WHERE tenant_id = ? AND action_id = ? ORDER BY step_number ASC'
    ).bind(tenantId, actionId).all();

    const logs = results.results.map((r: Record<string, unknown>) => ({
      id: r.id,
      actionId: r.action_id,
      stepNumber: r.step_number,
      stepName: r.step_name,
      status: r.status,
      detail: r.detail,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
    }));
    return c.json({ logs, total: logs.length });
  } catch (err) {
    console.error('execution-logs/:actionId query failed:', err);
    return c.json({ logs: [], total: 0 });
  }
});

// PUT /api/catalysts/actions/:id/resolve - Resolve an exception with notes
catalysts.put('/actions/:id/resolve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ resolution_notes?: string; resolved_by?: string }>();
  const tenantId = getTenantId(c);

  const action = await c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!action) return c.json({ error: 'Action not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE catalyst_actions SET status = ?, output_data = ?, completed_at = datetime(\'now\') WHERE id = ?'
  ).bind(
    'resolved',
    JSON.stringify({
      ...(safeJsonParse(action.output_data as string) as Record<string, unknown> || {}),
      resolution_notes: body.resolution_notes || 'Resolved by admin',
      resolved_by: body.resolved_by || 'admin',
      resolved_at: new Date().toISOString(),
    }),
    id
  ).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.exception.resolved', 'catalysts', id,
    JSON.stringify({ resolution_notes: body.resolution_notes, resolved_by: body.resolved_by }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, status: 'resolved' });
});

// PUT /api/catalysts/actions/:id/escalate - Escalate an exception
catalysts.put('/actions/:id/escalate', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ escalation_notes?: string; escalated_to?: string }>();
  const tenantId = getTenantId(c);

  const action = await c.env.DB.prepare('SELECT * FROM catalyst_actions WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first();
  if (!action) return c.json({ error: 'Action not found' }, 404);

  const currentLevel = (action.escalation_level as string) || null;
  const nextLevel = !currentLevel ? 'L1' : currentLevel === 'L1' ? 'L2' : currentLevel === 'L2' ? 'L3' : 'L3';

  await c.env.DB.prepare(
    'UPDATE catalyst_actions SET status = ?, escalation_level = ?, output_data = ? WHERE id = ?'
  ).bind(
    'escalated',
    nextLevel,
    JSON.stringify({
      ...(safeJsonParse(action.output_data as string) as Record<string, unknown> || {}),
      escalation_notes: body.escalation_notes || 'Escalated by admin',
      escalated_to: body.escalated_to || nextLevel,
      escalated_at: new Date().toISOString(),
    }),
    id
  ).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.exception.escalated', 'catalysts', id,
    JSON.stringify({ escalation_level: nextLevel, escalated_to: body.escalated_to, notes: body.escalation_notes }),
    'success'
  ).run().catch(() => {});

  return c.json({ success: true, status: 'escalated', escalationLevel: nextLevel });
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

// ═══════════════════════════════════════════════════════════════════════════
// HITL (Human-in-the-Loop) Configuration & Notification Endpoints
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Look up HITL config for a cluster and send email notifications to assigned users.
 */
async function sendHitlNotification(
  db: D1Database,
  env: Env,
  tenantId: string,
  clusterId: string,
  notificationType: 'approval_needed' | 'exception' | 'escalation' | 'completion',
  details: { catalystName: string; action: string; status: string; confidence: number; reason?: string; subCatalystName?: string },
): Promise<void> {
  // Try sub-catalyst-level config first, then fall back to cluster-level
  let config: Record<string, unknown> | null = null;
  if (details.subCatalystName) {
    config = await db.prepare(
      'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
    ).bind(tenantId, clusterId, details.subCatalystName).first();
  }
  if (!config) {
    config = await db.prepare(
      'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND (sub_catalyst_name IS NULL OR sub_catalyst_name = \'\'\')'
    ).bind(tenantId, clusterId).first();
  }
  if (!config) return;

  // Determine which user IDs to notify based on type
  let userIds: string[] = [];
  if (notificationType === 'approval_needed' && config.notify_on_approval_needed) {
    userIds = JSON.parse(config.validator_user_ids as string || '[]');
  } else if (notificationType === 'exception' && config.notify_on_exception) {
    userIds = JSON.parse(config.exception_handler_user_ids as string || '[]');
  } else if (notificationType === 'escalation' && config.notify_on_exception) {
    userIds = JSON.parse(config.escalation_user_ids as string || '[]');
    if (userIds.length === 0) userIds = JSON.parse(config.exception_handler_user_ids as string || '[]');
  } else if (notificationType === 'completion' && config.notify_on_completion) {
    // Notify all configured users on completion
    const validators = JSON.parse(config.validator_user_ids as string || '[]') as string[];
    const handlers = JSON.parse(config.exception_handler_user_ids as string || '[]') as string[];
    const escalation = JSON.parse(config.escalation_user_ids as string || '[]') as string[];
    userIds = [...new Set([...validators, ...handlers, ...escalation])];
  }

  if (userIds.length === 0) return;

  // Look up user emails
  const placeholders = userIds.map(() => '?').join(',');
  const users = await db.prepare(
    `SELECT id, email, name FROM users WHERE id IN (${placeholders}) AND tenant_id = ?`
  ).bind(...userIds, tenantId).all();

  const emails = users.results.map(u => u.email as string).filter(Boolean);
  if (emails.length === 0) return;

  const dashboardUrl = 'https://atheon.vantax.co.za/pulse';

  // Build email based on type
  let subject: string;
  let template: { html: string; text: string };

  if (notificationType === 'approval_needed') {
    subject = `[Atheon] Approval Required — ${details.catalystName}`;
    template = getApprovalEmailTemplate(
      details.catalystName, details.action, details.confidence,
      details.reason || 'Action requires human validation before proceeding.',
      dashboardUrl,
    );
  } else if (notificationType === 'escalation') {
    subject = `[Atheon] Escalation — ${details.catalystName}`;
    template = getEscalationEmailTemplate(
      details.catalystName, details.action, 'L1',
      details.reason || 'Action escalated for review.',
      dashboardUrl,
    );
  } else if (notificationType === 'exception') {
    subject = `[Atheon] Exception — ${details.catalystName}`;
    template = getEscalationEmailTemplate(
      details.catalystName, details.action, 'Exception',
      details.reason || 'An exception occurred during execution.',
      dashboardUrl,
    );
  } else {
    // completion — use run results template
    subject = `[Atheon] Run Complete — ${details.catalystName}`;
    template = getRunResultsEmailTemplate(
      details.catalystName,
      { total: 1, completed: details.status === 'approved' || details.status === 'completed' ? 1 : 0, exceptions: details.status === 'failed' || details.status === 'rejected' ? 1 : 0, escalated: details.status === 'escalated' ? 1 : 0, pending: 0 },
      [{ action: details.action, status: details.status, confidence: details.confidence }],
      dashboardUrl,
    );
  }

  await sendOrQueueEmail(db, {
    to: emails,
    subject,
    htmlBody: template.html,
    textBody: template.text,
    tenantId,
  }, env).catch(err => console.error('HITL email send failed:', err));
}

/**
 * Send batch run result emails for a catalyst cluster.
 */
async function sendRunResultsEmail(
  db: D1Database,
  env: Env,
  tenantId: string,
  clusterId: string,
  catalystName: string,
  actions: Array<{ action: string; status: string; confidence: number }>,
  subCatalystName?: string,
): Promise<void> {
  // Try sub-catalyst-level config first, then fall back to cluster-level
  let config: Record<string, unknown> | null = null;
  if (subCatalystName) {
    config = await db.prepare(
      'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
    ).bind(tenantId, clusterId, subCatalystName).first();
  }
  if (!config) {
    config = await db.prepare(
      'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND (sub_catalyst_name IS NULL OR sub_catalyst_name = \'\'\')'
    ).bind(tenantId, clusterId).first();
  }
  if (!config || !config.notify_on_completion) return;

  // Collect all configured users
  const validators = JSON.parse(config.validator_user_ids as string || '[]') as string[];
  const handlers = JSON.parse(config.exception_handler_user_ids as string || '[]') as string[];
  const escalation = JSON.parse(config.escalation_user_ids as string || '[]') as string[];
  const allUserIds = [...new Set([...validators, ...handlers, ...escalation])];
  if (allUserIds.length === 0) return;

  const placeholders = allUserIds.map(() => '?').join(',');
  const users = await db.prepare(
    `SELECT email FROM users WHERE id IN (${placeholders}) AND tenant_id = ?`
  ).bind(...allUserIds, tenantId).all();
  const emails = users.results.map(u => u.email as string).filter(Boolean);
  if (emails.length === 0) return;

  const summary = {
    total: actions.length,
    completed: actions.filter(a => a.status === 'completed' || a.status === 'approved').length,
    exceptions: actions.filter(a => a.status === 'failed' || a.status === 'exception' || a.status === 'rejected').length,
    escalated: actions.filter(a => a.status === 'escalated' || a.status === 'pending_approval').length,
    pending: actions.filter(a => a.status === 'pending').length,
  };

  const dashboardUrl = 'https://atheon.vantax.co.za/pulse';
  const template = getRunResultsEmailTemplate(catalystName, summary, actions.slice(0, 20), dashboardUrl);

  await sendOrQueueEmail(db, {
    to: emails,
    subject: `[Atheon] Run Report — ${catalystName} (${summary.total} actions)`,
    htmlBody: template.html,
    textBody: template.text,
    tenantId,
  }, env).catch(err => console.error('Run results email failed:', err));
}

// GET /api/catalysts/hitl-config - Get HITL config for a cluster (optionally filtered by sub_catalyst)
catalysts.get('/hitl-config', async (c) => {
  const tenantId = getTenantId(c);
  const clusterId = c.req.query('cluster_id');
  const subCatalystName = c.req.query('sub_catalyst_name');

  if (clusterId) {
    // If sub_catalyst_name is specified, look for that specific config
    let config: Record<string, unknown> | null = null;
    if (subCatalystName) {
      config = await c.env.DB.prepare(
        'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
      ).bind(tenantId, clusterId, subCatalystName).first();
    } else {
      config = await c.env.DB.prepare(
        'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND (sub_catalyst_name IS NULL OR sub_catalyst_name = \'\'\')'
      ).bind(tenantId, clusterId).first();
    }

    if (!config) {
      // Also return all sub-catalyst configs for this cluster
      const subConfigs = await c.env.DB.prepare(
        'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? ORDER BY sub_catalyst_name'
      ).bind(tenantId, clusterId).all();

      if (subConfigs.results.length === 0) return c.json({ config: null, subConfigs: [] });

      const allIds = [...new Set(subConfigs.results.flatMap((r: Record<string, unknown>) => [
        ...JSON.parse(r.validator_user_ids as string || '[]') as string[],
        ...JSON.parse(r.exception_handler_user_ids as string || '[]') as string[],
        ...JSON.parse(r.escalation_user_ids as string || '[]') as string[],
      ]))];

      const userMap: Record<string, { email: string; name: string }> = {};
      if (allIds.length > 0) {
        const ph = allIds.map(() => '?').join(',');
        const users = await c.env.DB.prepare(
          `SELECT id, email, name FROM users WHERE id IN (${ph})`
        ).bind(...allIds).all();
        for (const u of users.results) {
          userMap[u.id as string] = { email: u.email as string, name: u.name as string };
        }
      }

      return c.json({
        config: null,
        subConfigs: subConfigs.results.map((r: Record<string, unknown>) => ({
          id: r.id,
          tenantId: r.tenant_id,
          clusterId: r.cluster_id,
          subCatalystName: r.sub_catalyst_name || null,
          domain: r.domain,
          validatorUserIds: JSON.parse(r.validator_user_ids as string || '[]'),
          exceptionHandlerUserIds: JSON.parse(r.exception_handler_user_ids as string || '[]'),
          escalationUserIds: JSON.parse(r.escalation_user_ids as string || '[]'),
          notifyOnCompletion: !!r.notify_on_completion,
          notifyOnException: !!r.notify_on_exception,
          notifyOnApprovalNeeded: !!r.notify_on_approval_needed,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
        users: userMap,
      });
    }

    // Resolve user names for the IDs
    const allIds = [...new Set([
      ...JSON.parse(config.validator_user_ids as string || '[]') as string[],
      ...JSON.parse(config.exception_handler_user_ids as string || '[]') as string[],
      ...JSON.parse(config.escalation_user_ids as string || '[]') as string[],
    ])];

    const userMap: Record<string, { email: string; name: string }> = {};
    if (allIds.length > 0) {
      const ph = allIds.map(() => '?').join(',');
      const users = await c.env.DB.prepare(
        `SELECT id, email, name FROM users WHERE id IN (${ph})`
      ).bind(...allIds).all();
      for (const u of users.results) {
        userMap[u.id as string] = { email: u.email as string, name: u.name as string };
      }
    }

    // Also fetch sub-catalyst configs for this cluster
    const subConfigs = await c.env.DB.prepare(
      'SELECT * FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name IS NOT NULL AND sub_catalyst_name != \'\'\' ORDER BY sub_catalyst_name'
    ).bind(tenantId, clusterId).all();

    return c.json({
      config: {
        id: config.id,
        tenantId: config.tenant_id,
        clusterId: config.cluster_id,
        subCatalystName: config.sub_catalyst_name || null,
        domain: config.domain,
        validatorUserIds: JSON.parse(config.validator_user_ids as string || '[]'),
        exceptionHandlerUserIds: JSON.parse(config.exception_handler_user_ids as string || '[]'),
        escalationUserIds: JSON.parse(config.escalation_user_ids as string || '[]'),
        notifyOnCompletion: !!config.notify_on_completion,
        notifyOnException: !!config.notify_on_exception,
        notifyOnApprovalNeeded: !!config.notify_on_approval_needed,
        createdAt: config.created_at,
        updatedAt: config.updated_at,
        users: userMap,
      },
      subConfigs: subConfigs.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        tenantId: r.tenant_id,
        clusterId: r.cluster_id,
        subCatalystName: r.sub_catalyst_name || null,
        domain: r.domain,
        validatorUserIds: JSON.parse(r.validator_user_ids as string || '[]'),
        exceptionHandlerUserIds: JSON.parse(r.exception_handler_user_ids as string || '[]'),
        escalationUserIds: JSON.parse(r.escalation_user_ids as string || '[]'),
        notifyOnCompletion: !!r.notify_on_completion,
        notifyOnException: !!r.notify_on_exception,
        notifyOnApprovalNeeded: !!r.notify_on_approval_needed,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  }

  // List all configs for tenant
  const results = await c.env.DB.prepare(
    'SELECT h.*, cc.name as cluster_name FROM catalyst_hitl_config h LEFT JOIN catalyst_clusters cc ON h.cluster_id = cc.id WHERE h.tenant_id = ? ORDER BY h.cluster_id, h.sub_catalyst_name'
  ).bind(tenantId).all();

  return c.json({
    configs: results.results.map((r: Record<string, unknown>) => ({
      id: r.id,
      tenantId: r.tenant_id,
      clusterId: r.cluster_id,
      subCatalystName: r.sub_catalyst_name || null,
      clusterName: r.cluster_name,
      domain: r.domain,
      validatorUserIds: JSON.parse(r.validator_user_ids as string || '[]'),
      exceptionHandlerUserIds: JSON.parse(r.exception_handler_user_ids as string || '[]'),
      escalationUserIds: JSON.parse(r.escalation_user_ids as string || '[]'),
      notifyOnCompletion: !!r.notify_on_completion,
      notifyOnException: !!r.notify_on_exception,
      notifyOnApprovalNeeded: !!r.notify_on_approval_needed,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    total: results.results.length,
  });
});

// PUT /api/catalysts/hitl-config - Create or update HITL config (cluster-level or sub-catalyst-level)
catalysts.put('/hitl-config', async (c) => {
  const tenantId = getTenantId(c);
  const body = await c.req.json<{
    cluster_id: string;
    sub_catalyst_name?: string;
    domain?: string;
    validator_user_ids?: string[];
    exception_handler_user_ids?: string[];
    escalation_user_ids?: string[];
    notify_on_completion?: boolean;
    notify_on_exception?: boolean;
    notify_on_approval_needed?: boolean;
  }>();

  if (!body.cluster_id) return c.json({ error: 'cluster_id is required' }, 400);

  // Verify cluster exists
  const cluster = await c.env.DB.prepare(
    'SELECT id, domain FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
  ).bind(body.cluster_id, tenantId).first();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const subName = body.sub_catalyst_name || null;

  // Check if config exists (cluster-level or sub-catalyst-level)
  let existing: Record<string, unknown> | null;
  if (subName) {
    existing = await c.env.DB.prepare(
      'SELECT id FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
    ).bind(tenantId, body.cluster_id, subName).first();
  } else {
    existing = await c.env.DB.prepare(
      "SELECT id FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND (sub_catalyst_name IS NULL OR sub_catalyst_name = '')"
    ).bind(tenantId, body.cluster_id).first();
  }

  const validatorIds = JSON.stringify(body.validator_user_ids || []);
  const exceptionIds = JSON.stringify(body.exception_handler_user_ids || []);
  const escalationIds = JSON.stringify(body.escalation_user_ids || []);
  const domain = body.domain || (cluster.domain as string) || 'general';

  if (existing) {
    await c.env.DB.prepare(
      'UPDATE catalyst_hitl_config SET validator_user_ids = ?, exception_handler_user_ids = ?, escalation_user_ids = ?, notify_on_completion = ?, notify_on_exception = ?, notify_on_approval_needed = ?, domain = ?, updated_at = datetime(\'now\') WHERE id = ?'
    ).bind(
      validatorIds, exceptionIds, escalationIds,
      body.notify_on_completion ? 1 : 0,
      body.notify_on_exception !== false ? 1 : 0,
      body.notify_on_approval_needed !== false ? 1 : 0,
      domain,
      existing.id,
    ).run();
    return c.json({ id: existing.id, updated: true });
  }

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO catalyst_hitl_config (id, tenant_id, cluster_id, sub_catalyst_name, domain, validator_user_ids, exception_handler_user_ids, escalation_user_ids, notify_on_completion, notify_on_exception, notify_on_approval_needed) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    id, tenantId, body.cluster_id, subName, domain,
    validatorIds, exceptionIds, escalationIds,
    body.notify_on_completion ? 1 : 0,
    body.notify_on_exception !== false ? 1 : 0,
    body.notify_on_approval_needed !== false ? 1 : 0,
  ).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.hitl_config.created', 'catalysts', body.cluster_id,
    JSON.stringify({ sub_catalyst: subName, validators: body.validator_user_ids?.length || 0, exception_handlers: body.exception_handler_user_ids?.length || 0, escalation: body.escalation_user_ids?.length || 0 }),
    'success',
  ).run().catch(() => {});

  return c.json({ id, created: true }, 201);
});

// DELETE /api/catalysts/hitl-config/:clusterId - Remove HITL config (optionally for a specific sub-catalyst)
catalysts.delete('/hitl-config/:clusterId', async (c) => {
  const tenantId = getTenantId(c);
  const clusterId = c.req.param('clusterId');
  const subCatalystName = c.req.query('sub_catalyst_name');

  if (subCatalystName) {
    await c.env.DB.prepare(
      'DELETE FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
    ).bind(tenantId, clusterId, subCatalystName).run();
  } else {
    await c.env.DB.prepare(
      'DELETE FROM catalyst_hitl_config WHERE tenant_id = ? AND cluster_id = ?'
    ).bind(tenantId, clusterId).run();
  }

  return c.json({ success: true });
});

// POST /api/catalysts/send-run-report - Send run results email to HITL-configured users
catalysts.post('/send-run-report', async (c) => {
  const tenantId = getTenantId(c);
  const body = await c.req.json<{ cluster_id: string; catalyst_name?: string }>();

  if (!body.cluster_id) return c.json({ error: 'cluster_id is required' }, 400);

  // Fetch recent actions for this cluster
  const actions = await c.env.DB.prepare(
    'SELECT action, status, confidence FROM catalyst_actions WHERE tenant_id = ? AND cluster_id = ? ORDER BY created_at DESC LIMIT 100'
  ).bind(tenantId, body.cluster_id).all();

  const actionList = actions.results.map((a: Record<string, unknown>) => ({
    action: a.action as string,
    status: a.status as string,
    confidence: a.confidence as number || 0,
  }));

  // Get cluster name
  const cluster = await c.env.DB.prepare(
    'SELECT name FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
  ).bind(body.cluster_id, tenantId).first();

  const catalystName = body.catalyst_name || (cluster?.name as string) || 'Catalyst';

  await sendRunResultsEmail(c.env.DB, c.env, tenantId, body.cluster_id, catalystName, actionList);

  return c.json({ success: true, actionCount: actionList.length, message: `Run report sent for ${catalystName}` });
});

// POST /api/catalysts/actions/:id/assign - Assign a user to an action
catalysts.put('/actions/:id/assign', async (c) => {
  const id = c.req.param('id');
  const tenantId = getTenantId(c);
  const body = await c.req.json<{ assigned_to: string }>();

  if (!body.assigned_to) return c.json({ error: 'assigned_to is required' }, 400);

  // Verify user exists
  const user = await c.env.DB.prepare(
    'SELECT id, email, name FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(body.assigned_to, tenantId).first();
  if (!user) return c.json({ error: 'User not found' }, 404);

  const action = await c.env.DB.prepare(
    'SELECT * FROM catalyst_actions WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!action) return c.json({ error: 'Action not found' }, 404);

  await c.env.DB.prepare(
    'UPDATE catalyst_actions SET assigned_to = ? WHERE id = ?'
  ).bind(body.assigned_to, id).run();

  // Send notification email to the assigned user
  const status = action.status as string;
  if (status === 'pending_approval' || status === 'escalated') {
    try {
      await sendHitlNotification(c.env.DB, c.env, tenantId, action.cluster_id as string, 'approval_needed', {
        catalystName: action.catalyst_name as string,
        action: action.action as string,
        status,
        confidence: action.confidence as number || 0,
      });
    } catch (err) { console.error('Assign notification failed:', err); }
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.action.assigned', 'catalysts', id,
    JSON.stringify({ assigned_to: body.assigned_to, user_email: user.email, action_status: status }),
    'success',
  ).run().catch(() => {});

  return c.json({ success: true, assignedTo: body.assigned_to, userName: user.name, userEmail: user.email });
});

// ═══════════════════════════════════════════════════════════════════════════
// Run Analytics & Insights Endpoints
// ═══════════════════════════════════════════════════════════════════════════

// POST /api/catalysts/run-analytics - Record analytics for a catalyst run
catalysts.post('/run-analytics', async (c) => {
  const tenantId = getTenantId(c);
  const body = await c.req.json<{
    cluster_id: string;
    sub_catalyst_name?: string;
    run_id?: string;
    actions: Array<{ action: string; status: string; confidence: number; processing_time_ms?: number }>;
  }>();

  if (!body.cluster_id || !body.actions?.length) return c.json({ error: 'cluster_id and actions are required' }, 400);

  const runId = body.run_id || crypto.randomUUID();
  const actions = body.actions;

  const completed = actions.filter(a => a.status === 'completed' || a.status === 'approved').length;
  const exceptions = actions.filter(a => a.status === 'failed' || a.status === 'exception' || a.status === 'rejected').length;
  const escalated = actions.filter(a => a.status === 'escalated' || a.status === 'pending_approval').length;
  const pending = actions.filter(a => a.status === 'pending').length;
  const autoApproved = actions.filter(a => a.status === 'auto_approved' || (a.status === 'completed' && a.confidence >= 0.95)).length;

  const confidences = actions.map(a => a.confidence).filter(c => c > 0);
  const avgConf = confidences.length > 0 ? confidences.reduce((s, c) => s + c, 0) / confidences.length : 0;
  const minConf = confidences.length > 0 ? Math.min(...confidences) : 0;
  const maxConf = confidences.length > 0 ? Math.max(...confidences) : 0;

  // Confidence distribution buckets: 0-20%, 20-40%, 40-60%, 60-80%, 80-100%
  const dist: Record<string, number> = { '0-20': 0, '20-40': 0, '40-60': 0, '60-80': 0, '80-100': 0 };
  for (const conf of confidences) {
    const pct = conf * 100;
    if (pct < 20) dist['0-20']++;
    else if (pct < 40) dist['20-40']++;
    else if (pct < 60) dist['40-60']++;
    else if (pct < 80) dist['60-80']++;
    else dist['80-100']++;
  }

  const totalMs = actions.reduce((s, a) => s + (a.processing_time_ms || 0), 0);

  // Generate insights
  const insights: string[] = [];
  if (avgConf > 0.9) insights.push('High overall confidence — most items processed automatically.');
  if (avgConf < 0.5) insights.push('Low overall confidence — consider reviewing data quality or mappings.');
  if (exceptions > actions.length * 0.2) insights.push(`Exception rate is high (${((exceptions / actions.length) * 100).toFixed(0)}%). Review exception patterns for automation opportunities.`);
  if (escalated > 0) insights.push(`${escalated} item(s) escalated for human review.`);
  if (autoApproved > actions.length * 0.8) insights.push(`${((autoApproved / actions.length) * 100).toFixed(0)}% auto-approved — high automation rate.`);
  if (minConf < 0.3 && maxConf > 0.9) insights.push('Wide confidence spread — some items may need manual review while others auto-process.');

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO catalyst_run_analytics (id, tenant_id, cluster_id, sub_catalyst_name, run_id, completed_at, duration_ms, total_items, completed_items, exception_items, escalated_items, pending_items, auto_approved_items, avg_confidence, min_confidence, max_confidence, confidence_distribution, status, insights) VALUES (?, ?, ?, ?, ?, datetime('now'), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, body.cluster_id, body.sub_catalyst_name || null, runId,
    totalMs, actions.length, completed, exceptions, escalated, pending, autoApproved,
    Math.round(avgConf * 1000) / 1000, Math.round(minConf * 1000) / 1000, Math.round(maxConf * 1000) / 1000,
    JSON.stringify(dist), 'completed', JSON.stringify(insights),
  ).run();

  return c.json({
    id, runId, status: 'completed',
    summary: { total: actions.length, completed, exceptions, escalated, pending, autoApproved },
    confidence: { avg: avgConf, min: minConf, max: maxConf, distribution: dist },
    insights, durationMs: totalMs,
  });
});

// GET /api/catalysts/run-analytics - Get run analytics for a cluster
catalysts.get('/run-analytics', async (c) => {
  const tenantId = getTenantId(c);
  const clusterId = c.req.query('cluster_id');
  const subCatalystName = c.req.query('sub_catalyst_name');
  const limit = parseInt(c.req.query('limit') || '20');

  let query: string;
  let bindings: unknown[];

  if (clusterId && subCatalystName) {
    query = 'SELECT ra.*, cc.name as cluster_name FROM catalyst_run_analytics ra LEFT JOIN catalyst_clusters cc ON ra.cluster_id = cc.id WHERE ra.tenant_id = ? AND ra.cluster_id = ? AND ra.sub_catalyst_name = ? ORDER BY ra.created_at DESC LIMIT ?';
    bindings = [tenantId, clusterId, subCatalystName, limit];
  } else if (clusterId) {
    query = 'SELECT ra.*, cc.name as cluster_name FROM catalyst_run_analytics ra LEFT JOIN catalyst_clusters cc ON ra.cluster_id = cc.id WHERE ra.tenant_id = ? AND ra.cluster_id = ? ORDER BY ra.created_at DESC LIMIT ?';
    bindings = [tenantId, clusterId, limit];
  } else {
    query = 'SELECT ra.*, cc.name as cluster_name FROM catalyst_run_analytics ra LEFT JOIN catalyst_clusters cc ON ra.cluster_id = cc.id WHERE ra.tenant_id = ? ORDER BY ra.created_at DESC LIMIT ?';
    bindings = [tenantId, limit];
  }

  const results = await c.env.DB.prepare(query).bind(...bindings).all();

  // Aggregate stats
  const runs = results.results.map((r: Record<string, unknown>) => ({
    id: r.id,
    runId: r.run_id,
    clusterId: r.cluster_id,
    clusterName: r.cluster_name,
    subCatalystName: r.sub_catalyst_name || null,
    startedAt: r.started_at,
    completedAt: r.completed_at,
    durationMs: r.duration_ms,
    status: r.status,
    summary: {
      total: r.total_items,
      completed: r.completed_items,
      exceptions: r.exception_items,
      escalated: r.escalated_items,
      pending: r.pending_items,
      autoApproved: r.auto_approved_items,
    },
    confidence: {
      avg: r.avg_confidence,
      min: r.min_confidence,
      max: r.max_confidence,
      distribution: JSON.parse(r.confidence_distribution as string || '{}'),
    },
    insights: JSON.parse(r.insights as string || '[]'),
  }));

  // Overall aggregation
  const totalRuns = runs.length;
  const totalItems = runs.reduce((s, r) => s + (r.summary.total as number), 0);
  const totalCompleted = runs.reduce((s, r) => s + (r.summary.completed as number), 0);
  const totalExceptions = runs.reduce((s, r) => s + (r.summary.exceptions as number), 0);
  const totalEscalated = runs.reduce((s, r) => s + (r.summary.escalated as number), 0);
  const avgConfOverall = runs.length > 0 ? runs.reduce((s, r) => s + (r.confidence.avg as number), 0) / runs.length : 0;
  const automationRate = totalItems > 0 ? (totalCompleted / totalItems) * 100 : 0;

  return c.json({
    runs,
    aggregate: {
      totalRuns,
      totalItems,
      totalCompleted,
      totalExceptions,
      totalEscalated,
      avgConfidence: Math.round(avgConfOverall * 1000) / 1000,
      automationRate: Math.round(automationRate * 10) / 10,
    },
  });
});

// GET /api/catalysts/run-analytics/:runId - Get a single run's analytics
catalysts.get('/run-analytics/:runId', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  const analytics = await c.env.DB.prepare(
    'SELECT ra.*, cc.name as cluster_name FROM catalyst_run_analytics ra LEFT JOIN catalyst_clusters cc ON ra.cluster_id = cc.id WHERE ra.tenant_id = ? AND (ra.run_id = ? OR ra.id = ?)'
  ).bind(tenantId, runId, runId).first();

  if (!analytics) return c.json({ error: 'Run analytics not found' }, 404);

  // Also fetch the individual actions for this run
  const actions = await c.env.DB.prepare(
    'SELECT id, action, status, confidence, assigned_to, processing_time_ms, created_at FROM catalyst_actions WHERE tenant_id = ? AND run_id = ? ORDER BY created_at DESC LIMIT 200'
  ).bind(tenantId, analytics.run_id as string).all();

  return c.json({
    analytics: {
      id: analytics.id,
      runId: analytics.run_id,
      clusterId: analytics.cluster_id,
      clusterName: analytics.cluster_name,
      subCatalystName: analytics.sub_catalyst_name || null,
      startedAt: analytics.started_at,
      completedAt: analytics.completed_at,
      durationMs: analytics.duration_ms,
      status: analytics.status,
      summary: {
        total: analytics.total_items,
        completed: analytics.completed_items,
        exceptions: analytics.exception_items,
        escalated: analytics.escalated_items,
        pending: analytics.pending_items,
        autoApproved: analytics.auto_approved_items,
      },
      confidence: {
        avg: analytics.avg_confidence,
        min: analytics.min_confidence,
        max: analytics.max_confidence,
        distribution: JSON.parse(analytics.confidence_distribution as string || '{}'),
      },
      insights: JSON.parse(analytics.insights as string || '[]'),
    },
    actions: actions.results.map((a: Record<string, unknown>) => ({
      id: a.id,
      action: a.action,
      status: a.status,
      confidence: a.confidence,
      assignedTo: a.assigned_to,
      processingTimeMs: a.processing_time_ms,
      createdAt: a.created_at,
    })),
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// Sub-Catalyst Ops Routes — Runs, Items, KPIs, Review, Compare, Sign-off, Comments
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/runs — Paginated run history
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/runs', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const tenantId = getTenantId(c);

  const limit = parseInt(c.req.query('limit') || '20');
  const offset = parseInt(c.req.query('offset') || '0');
  const status = c.req.query('status') || undefined;
  const from = c.req.query('from') || undefined;
  const to = c.req.query('to') || undefined;
  const triggered_by = c.req.query('triggered_by') || undefined;

  const result = await getRuns(c.env.DB, tenantId, clusterId, subName, { limit, offset, status, from, to, triggered_by });
  return c.json(result);
});

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/runs/:runId — Run detail with steps + linked outputs
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/runs/:runId', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  const detail = await getRunDetail(c.env.DB, tenantId, runId);
  if (!detail.run) return c.json({ error: 'Run not found' }, 404);
  return c.json(detail);
});

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/kpis — KPI summary
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/kpis', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const tenantId = getTenantId(c);

  const kpis = await getKpis(c.env.DB, tenantId, clusterId, subName);
  return c.json({ kpis: kpis || null });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/kpis/thresholds — Update KPI thresholds
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/kpis/thresholds', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tenantId = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  const body = await c.req.json<Record<string, number>>();

  const existing = await c.env.DB.prepare(
    'SELECT id FROM sub_catalyst_kpis WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
  ).bind(tenantId, clusterId, subName).first<{ id: string }>();

  if (existing) {
    const fields: string[] = [];
    const vals: unknown[] = [];
    const allowedFields = [
      'threshold_success_green', 'threshold_success_amber', 'threshold_success_red',
      'threshold_duration_green', 'threshold_duration_amber', 'threshold_duration_red',
      'threshold_discrepancy_green', 'threshold_discrepancy_amber', 'threshold_discrepancy_red',
    ];
    for (const f of allowedFields) {
      if (body[f] !== undefined) { fields.push(`${f} = ?`); vals.push(body[f]); }
    }
    if (fields.length > 0) {
      fields.push('updated_at = ?');
      vals.push(new Date().toISOString());
      vals.push(existing.id);
      await c.env.DB.prepare(`UPDATE sub_catalyst_kpis SET ${fields.join(', ')} WHERE id = ?`).bind(...vals).run();
    }
  } else {
    // Create a new KPI row with the thresholds
    await c.env.DB.prepare(`INSERT INTO sub_catalyst_kpis (id, tenant_id, cluster_id, sub_catalyst_name,
      threshold_success_green, threshold_success_amber, threshold_success_red,
      threshold_duration_green, threshold_duration_amber, threshold_duration_red,
      threshold_discrepancy_green, threshold_discrepancy_amber, threshold_discrepancy_red, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      `kpi-${crypto.randomUUID()}`, tenantId, clusterId, subName,
      body.threshold_success_green ?? 90, body.threshold_success_amber ?? 70, body.threshold_success_red ?? 50,
      body.threshold_duration_green ?? 60000, body.threshold_duration_amber ?? 120000, body.threshold_duration_red ?? 300000,
      body.threshold_discrepancy_green ?? 2, body.threshold_discrepancy_amber ?? 5, body.threshold_discrepancy_red ?? 10,
      new Date().toISOString()
    ).run();
  }

  // Recalculate KPIs with new thresholds
  await recalculateKpis(c.env.DB, tenantId, clusterId, subName);
  const kpis = await getKpis(c.env.DB, tenantId, clusterId, subName);
  return c.json({ success: true, kpis });
});

// GET /api/catalysts/runs/:runId/items — Paginated item-level results
catalysts.get('/runs/:runId/items', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const limit = parseInt(c.req.query('limit') || '50');
  const offset = parseInt(c.req.query('offset') || '0');
  const status = c.req.query('status') || undefined;
  const severity = c.req.query('severity') || undefined;
  const review_status = c.req.query('review_status') || undefined;

  const result = await getRunItems(c.env.DB, tenantId, runId, { limit, offset, status, severity, review_status });
  return c.json(result);
});

// PUT /api/catalysts/runs/:runId/items/:itemId/review — Review (approve/reject/reclassify/defer) an item
catalysts.put('/runs/:runId/items/:itemId/review', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const itemId = c.req.param('itemId');
  const auth = c.get('auth') as AuthContext | undefined;

  const body = await c.req.json<{ review_status: string; review_notes?: string; reclassified_to?: string }>();
  const validStatuses = ['approved', 'rejected', 'reclassified', 'deferred'];
  if (!validStatuses.includes(body.review_status)) {
    return c.json({ error: `review_status must be one of: ${validStatuses.join(', ')}` }, 400);
  }

  await c.env.DB.prepare(
    'UPDATE sub_catalyst_run_items SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ?, reclassified_to = ? WHERE id = ? AND run_id = ? AND tenant_id = ?'
  ).bind(
    body.review_status, auth?.email || 'system', new Date().toISOString(),
    body.review_notes || null, body.reclassified_to || null,
    itemId, runId, tenantId
  ).run();

  // Update run-level review counters
  const counts = await c.env.DB.prepare(
    `SELECT
      COUNT(*) as total,
      SUM(CASE WHEN review_status != 'pending' THEN 1 ELSE 0 END) as reviewed,
      SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) as approved,
      SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
      SUM(CASE WHEN review_status = 'deferred' THEN 1 ELSE 0 END) as deferred
    FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ?`
  ).bind(runId, tenantId).first<Record<string, number>>();

  const reviewComplete = counts && counts.total > 0 && counts.reviewed >= counts.total ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE sub_catalyst_runs SET items_reviewed = ?, items_approved = ?, items_rejected = ?, items_deferred = ?, review_complete = ? WHERE id = ? AND tenant_id = ?'
  ).bind(counts?.reviewed ?? 0, counts?.approved ?? 0, counts?.rejected ?? 0, counts?.deferred ?? 0, reviewComplete, runId, tenantId).run();

  return c.json({ success: true, review_status: body.review_status, review_complete: reviewComplete === 1 });
});

// PUT /api/catalysts/runs/:runId/items/bulk-review — Bulk review multiple items
catalysts.put('/runs/:runId/items/bulk-review', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const auth = c.get('auth') as AuthContext | undefined;

  const body = await c.req.json<{ item_ids: string[]; review_status: string; review_notes?: string }>();
  if (!body.item_ids?.length) return c.json({ error: 'item_ids required' }, 400);

  const validStatuses = ['approved', 'rejected', 'reclassified', 'deferred'];
  if (!validStatuses.includes(body.review_status)) return c.json({ error: 'Invalid review_status' }, 400);

  const now = new Date().toISOString();
  let updated = 0;
  for (const itemId of body.item_ids) {
    try {
      await c.env.DB.prepare(
        'UPDATE sub_catalyst_run_items SET review_status = ?, reviewed_by = ?, reviewed_at = ?, review_notes = ? WHERE id = ? AND run_id = ? AND tenant_id = ?'
      ).bind(body.review_status, auth?.email || 'system', now, body.review_notes || null, itemId, runId, tenantId).run();
      updated++;
    } catch { /* skip */ }
  }

  // Refresh run-level counters
  const counts = await c.env.DB.prepare(
    `SELECT COUNT(*) as total, SUM(CASE WHEN review_status != 'pending' THEN 1 ELSE 0 END) as reviewed,
     SUM(CASE WHEN review_status = 'approved' THEN 1 ELSE 0 END) as approved,
     SUM(CASE WHEN review_status = 'rejected' THEN 1 ELSE 0 END) as rejected,
     SUM(CASE WHEN review_status = 'deferred' THEN 1 ELSE 0 END) as deferred
    FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ?`
  ).bind(runId, tenantId).first<Record<string, number>>();

  const reviewComplete = counts && counts.total > 0 && counts.reviewed >= counts.total ? 1 : 0;
  await c.env.DB.prepare(
    'UPDATE sub_catalyst_runs SET items_reviewed = ?, items_approved = ?, items_rejected = ?, items_deferred = ?, review_complete = ? WHERE id = ? AND tenant_id = ?'
  ).bind(counts?.reviewed ?? 0, counts?.approved ?? 0, counts?.rejected ?? 0, counts?.deferred ?? 0, reviewComplete, runId, tenantId).run();

  return c.json({ success: true, updated, review_complete: reviewComplete === 1 });
});

// GET /api/catalysts/runs/:runId/export — Export run items as CSV
catalysts.get('/runs/:runId/export', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  const items = await c.env.DB.prepare(
    'SELECT * FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? ORDER BY item_number'
  ).bind(runId, tenantId).all<Record<string, unknown>>();

  if (!items.results?.length) return c.json({ error: 'No items found' }, 404);

  // Build CSV
  const headers = ['item_number', 'item_status', 'source_ref', 'source_entity', 'source_amount', 'target_ref', 'target_entity', 'target_amount', 'match_confidence', 'discrepancy_field', 'discrepancy_amount', 'discrepancy_pct', 'exception_type', 'exception_severity', 'review_status', 'reviewed_by', 'review_notes'];
  const rows = items.results.map(item =>
    headers.map(h => {
      const v = item[h];
      if (v === null || v === undefined) return '';
      const s = String(v);
      return s.includes(',') || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(',')
  );
  const csv = [headers.join(','), ...rows].join('\n');

  return new Response(csv, {
    headers: { 'Content-Type': 'text/csv', 'Content-Disposition': `attachment; filename="run-${runId}-items.csv"` },
  });
});

// POST /api/catalysts/runs/:runId/retry — Re-execute the sub-catalyst and link as retry
catalysts.post('/runs/:runId/retry', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) return c.json({ error: 'Forbidden' }, 403);

  const parentRun = await c.env.DB.prepare(
    'SELECT * FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
  ).bind(runId, tenantId).first<{ cluster_id: string; sub_catalyst_name: string }>();
  if (!parentRun) return c.json({ error: 'Run not found' }, 404);

  // Redirect to the execute endpoint — caller should POST to execute and pass parent_run_id
  return c.json({ redirect: true, cluster_id: parentRun.cluster_id, sub_catalyst_name: parentRun.sub_catalyst_name, parent_run_id: runId });
});

// GET /api/catalysts/runs/compare — Compare two runs
catalysts.get('/runs/compare', async (c) => {
  const tenantId = getTenantId(c);
  const runA = c.req.query('run_a');
  const runB = c.req.query('run_b');
  if (!runA || !runB) return c.json({ error: 'run_a and run_b query params required' }, 400);

  const comparison = await compareRuns(c.env.DB, tenantId, runA, runB);
  return c.json(comparison);
});

// PUT /api/catalysts/runs/:runId/sign-off — Sign off on a run
catalysts.put('/runs/:runId/sign-off', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const auth = c.get('auth') as AuthContext | undefined;

  const body = await c.req.json<{ status: string; notes?: string }>();
  const validStatuses = ['signed_off', 'rejected', 'deferred'];
  if (!validStatuses.includes(body.status)) return c.json({ error: 'Invalid status' }, 400);

  await c.env.DB.prepare(
    'UPDATE sub_catalyst_runs SET sign_off_status = ?, signed_off_by = ?, signed_off_at = ?, sign_off_notes = ? WHERE id = ? AND tenant_id = ?'
  ).bind(body.status, auth?.email || 'system', new Date().toISOString(), body.notes || null, runId, tenantId).run();

  return c.json({ success: true, sign_off_status: body.status });
});

// GET /api/catalysts/runs/:runId/comments — Get comments for a run
catalysts.get('/runs/:runId/comments', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  const comments = await c.env.DB.prepare(
    'SELECT * FROM run_comments WHERE run_id = ? AND tenant_id = ? ORDER BY created_at DESC'
  ).bind(runId, tenantId).all<Record<string, unknown>>();

  return c.json({ comments: comments.results || [] });
});

// POST /api/catalysts/runs/:runId/comments — Add a comment to a run or item
catalysts.post('/runs/:runId/comments', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const auth = c.get('auth') as AuthContext | undefined;

  const body = await c.req.json<{ comment: string; item_id?: string; comment_type?: string }>();
  if (!body.comment?.trim()) return c.json({ error: 'comment is required' }, 400);

  const commentId = `cmt-${crypto.randomUUID()}`;
  await c.env.DB.prepare(
    'INSERT INTO run_comments (id, tenant_id, run_id, item_id, user_id, user_name, comment, comment_type, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    commentId, tenantId, runId, body.item_id || null,
    auth?.userId || 'system', auth?.name || auth?.email || 'System',
    body.comment.trim(), body.comment_type || 'note', new Date().toISOString()
  ).run();

  return c.json({ id: commentId, success: true });
});

// DELETE /api/catalysts/runs/:runId/comments/:commentId — Delete a comment.
// Only the original author or an admin/executive can delete. Tenant-scoped.
catalysts.delete('/runs/:runId/comments/:commentId', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const commentId = c.req.param('commentId');
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return c.json({ error: 'Unauthorized' }, 401);

  const row = await c.env.DB.prepare(
    'SELECT user_id FROM run_comments WHERE id = ? AND run_id = ? AND tenant_id = ?'
  ).bind(commentId, runId, tenantId).first<{ user_id: string }>();
  if (!row) return c.json({ error: 'Comment not found' }, 404);

  const isAuthor = row.user_id === auth.userId;
  const isAdmin = isAdminRole(auth.role) || auth.role === 'executive';
  if (!isAuthor && !isAdmin) {
    return c.json({ error: 'Forbidden', message: 'Only the author or an admin can delete this comment' }, 403);
  }

  await c.env.DB.prepare(
    'DELETE FROM run_comments WHERE id = ? AND run_id = ? AND tenant_id = ?'
  ).bind(commentId, runId, tenantId).run();

  return c.json({ success: true });
});

// GET /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions — List all KPI definitions
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const tenantId = getTenantId(c);

  const defs = await getKpiDefinitions(c.env.DB, tenantId, clusterId, subName);
  return c.json({ definitions: defs });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions/:defId — Update KPI definition thresholds/enabled
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions/:defId', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tenantId = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;
  const defId = c.req.param('defId');

  const body = await c.req.json<{ threshold_green?: number; threshold_amber?: number; threshold_red?: number; enabled?: boolean }>();
  const updated = await updateKpiDefinition(c.env.DB, tenantId, defId, body);
  if (!updated) return c.json({ error: 'KPI definition not found or no changes' }, 404);
  return c.json({ success: true });
});

// PUT /api/catalysts/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions/reset — Reset all KPI definitions to defaults
catalysts.put('/clusters/:clusterId/sub-catalysts/:subName/kpi-definitions/reset', async (c) => {
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || (!isAdminRole(auth.role) && auth.role !== 'executive')) {
    return c.json({ error: 'Forbidden' }, 403);
  }
  const tenantId = canCrossTenant(auth.role) ? (c.req.query('tenant_id') || auth.tenantId) : auth.tenantId;

  // Get cluster info for regeneration
  const cluster = await c.env.DB.prepare('SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?').bind(clusterId, tenantId).first<Record<string, string>>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  // Delete existing definitions and regenerate
  await c.env.DB.prepare('DELETE FROM sub_catalyst_kpi_values WHERE tenant_id = ? AND definition_id IN (SELECT id FROM sub_catalyst_kpi_definitions WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?)')
    .bind(tenantId, tenantId, clusterId, subName).run();
  await c.env.DB.prepare('DELETE FROM sub_catalyst_kpi_definitions WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?')
    .bind(tenantId, clusterId, subName).run();

  const subs = safeJsonParse(cluster.sub_catalysts || '[]') as Array<Record<string, string> | string>;
  const sub = subs.find((s) => (typeof s === 'object' ? s.name : s) === subName);
  const subDesc = sub && typeof sub === 'object' ? (sub.description || '') : '';
  const defs = generateKpiDefinitions(subName, subDesc, cluster.domain || '', cluster.autonomy_tier || '');

  for (const [idx, def] of defs.entries()) {
    await c.env.DB.prepare(
      'INSERT OR IGNORE INTO sub_catalyst_kpi_definitions (id, tenant_id, cluster_id, sub_catalyst_name, kpi_name, unit, direction, threshold_green, threshold_amber, threshold_red, calculation, data_source, category, is_universal, sort_order, enabled) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)'
    ).bind(
      crypto.randomUUID(), tenantId, clusterId, subName,
      def.name, def.unit, def.direction, def.green, def.amber, def.red,
      def.calculation, def.source, def.category, def.is_universal ? 1 : 0, idx
    ).run();
  }

  return c.json({ success: true, definitions_count: defs.length });
});

// GET /api/catalysts/runs/:runId/detail — Full run detail with KPIs, metrics, and source data
catalysts.get('/runs/:runId/detail', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  // Get basic run info
  const run = await c.env.DB.prepare(
    `SELECT r.id, r.cluster_id, r.sub_catalyst_name, r.status, r.matched, r.discrepancies, 
            r.exceptions_raised, r.total_source_value, r.started_at, r.completed_at,
            c.name as cluster_name, c.domain as cluster_domain
     FROM sub_catalyst_runs r
     JOIN catalyst_clusters c ON r.cluster_id = c.id
     WHERE r.id = ? AND r.tenant_id = ?`
  ).bind(runId, tenantId).first<{
    id: string; cluster_id: string; sub_catalyst_name: string; status: string;
    matched: number; discrepancies: number; exceptions_raised: number;
    total_source_value: number; started_at: string; completed_at: string;
    cluster_name: string; cluster_domain: string;
  }>();

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  // Get KPIs generated in this run
  const kpis = await c.env.DB.prepare(
    `SELECT kd.kpi_name as name, kv.value, kv.status, kd.unit, 
            kd.threshold_success_green as target
     FROM sub_catalyst_kpi_values kv
     JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
     WHERE kv.run_id = ? AND kv.tenant_id = ?
     ORDER BY kd.kpi_name`
  ).bind(runId, tenantId).all<{
    name: string; value: number; status: string; unit: string; target: number;
  }>();

  // Get metrics created in Pulse from this run
  const metrics = await c.env.DB.prepare(
    `SELECT id, name, value, unit, status
     FROM process_metrics
     WHERE source_run_id = ? AND tenant_id = ?
     ORDER BY name`
  ).bind(runId, tenantId).all<{
    id: string; name: string; value: number; unit: string; status: string;
  }>();

  // Get source data attribution (sample of records processed)
  const sourceData = await c.env.DB.prepare(
    `SELECT id, source_system as sourceSystem, record_type as recordType, 
            source_value as value, match_status as status
     FROM sub_catalyst_run_items
     WHERE run_id = ? AND tenant_id = ?
     ORDER BY created_at DESC
     LIMIT 100`
  ).bind(runId, tenantId).all<{
    id: string; sourceSystem: string; recordType: string; 
    value: number; status: string;
  }>();

  return c.json({
    id: run.id,
    // PR Q: cluster_id surfaced for the simulator card on the run detail page.
    clusterId: run.cluster_id,
    subCatalystName: run.sub_catalyst_name,
    clusterName: run.cluster_name,
    clusterDomain: run.cluster_domain,
    status: run.status,
    matched: run.matched,
    discrepancies: run.discrepancies,
    exceptions: run.exceptions_raised,
    totalValue: run.total_source_value,
    startedAt: run.started_at,
    completedAt: run.completed_at,
    kpis: (kpis.results || []).map(k => ({
      name: k.name,
      value: k.value,
      status: k.status,
      unit: k.unit,
      target: k.target,
    })),
    metrics: (metrics.results || []).map(m => ({
      id: m.id,
      name: m.name,
      value: m.value,
      unit: m.unit,
      status: m.status,
    })),
    sourceData: (sourceData.results || []).map(s => ({
      id: s.id,
      sourceSystem: s.sourceSystem,
      recordType: s.recordType,
      value: s.value,
      status: s.status === 'matched' ? 'matched' : s.status === 'discrepancy' ? 'discrepancy' : 'failed',
    })),
  });
});

// POST /api/catalysts/runs/:runId/llm-insights — Generate LLM-powered narrative insights
catalysts.post('/runs/:runId/llm-insights', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  
  // Get run data
  const run = await c.env.DB.prepare(
    `SELECT r.*, c.name as cluster_name, c.domain as cluster_domain
     FROM sub_catalyst_runs r
     JOIN catalyst_clusters c ON r.cluster_id = c.id
     WHERE r.id = ? AND r.tenant_id = ?`
  ).bind(runId, tenantId).first<Record<string, unknown>>();

  if (!run) {
    return c.json({ error: 'Run not found' }, 404);
  }

  // Get KPIs
  const kpis = await c.env.DB.prepare(
    `SELECT kd.kpi_name, kv.value, kv.status, kd.unit
     FROM sub_catalyst_kpi_values kv
     JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
     WHERE kv.run_id = ? AND kv.tenant_id = ?`
  ).bind(runId, tenantId).all<Record<string, unknown>>();

  // Get anomalies
  const anomalies = await c.env.DB.prepare(
    `SELECT metric, deviation, severity, description
     FROM anomalies
     WHERE source_run_id = ? AND tenant_id = ?
     ORDER BY deviation DESC
     LIMIT 10`
  ).bind(runId, tenantId).all<Record<string, unknown>>();

  // Construct prompt for LLM
  const kpiSummary = (kpis.results || []).map((k: Record<string, unknown>) => 
    `- ${k.kpi_name}: ${k.value} ${k.unit} (${k.status})`
  ).join('\n');

  const anomalySummary = (anomalies.results || []).map((a: Record<string, unknown>) => 
    `- ${a.metric}: ${a.deviation}% deviation (${a.severity}) - ${a.description}`
  ).join('\n');

  const prompt = `You are an enterprise operations analyst. Analyze this catalyst run and provide actionable insights:

**Run Context:**
- Catalyst: ${run.sub_catalyst_name}
- Cluster: ${run.cluster_name} (${run.cluster_domain})
- Status: ${run.status}
- Records Processed: ${run.matched} matched, ${run.discrepancies} discrepancies, ${run.exceptions_raised} exceptions
- Total Value: R ${(Number(run.total_source_value) / 1000000).toFixed(2)}M

**KPIs Generated:**
${kpiSummary || 'No KPIs generated'}

**Anomalies Detected:**
${anomalySummary || 'No anomalies detected'}

**Provide a concise executive summary (3-4 sentences) covering:**
1. Overall performance assessment
2. Key risks or concerns
3. Recommended immediate actions
4. Business impact

Format as JSON: { "summary": "...", "risks": ["..."], "actions": ["..."], "impact": "..." }`;

  // Call LLM (using Cloudflare AI or external API)
  try {
    // If using Cloudflare AI Workers
    const aiResponse = await (c.env.AI as { run: (model: string, params: Record<string, unknown>) => Promise<Record<string, unknown>> }).run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3,
      max_tokens: 500,
    });

    const insights = JSON.parse(stripCodeFences((aiResponse as Record<string, unknown>).response as string || '{}'));
    
    // Save insights to database
    await c.env.DB.prepare(
      `INSERT INTO run_insights (id, run_id, tenant_id, summary, risks, actions, impact, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), runId, tenantId,
      insights.summary || '', JSON.stringify(insights.risks || []),
      JSON.stringify(insights.actions || []), insights.impact || '',
      new Date().toISOString()
    ).run();

    return c.json({
      success: true,
      insights: {
        summary: insights.summary,
        risks: insights.risks || [],
        actions: insights.actions || [],
        impact: insights.impact || '',
        generatedAt: new Date().toISOString(),
      },
    });
  } catch (err: unknown) {
    console.error('LLM insights generation failed:', err);
    return c.json({ error: 'Failed to generate AI insights', details: err instanceof Error ? err.message : String(err) }, 500);
  }
});

// GET /api/catalysts/runs/:runId/insights — Get cached LLM insights
catalysts.get('/runs/:runId/insights', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');

  const insights = await c.env.DB.prepare(
    `SELECT summary, risks, actions, impact, generated_at
     FROM run_insights
     WHERE run_id = ? AND tenant_id = ?
     ORDER BY generated_at DESC
     LIMIT 1`
  ).bind(runId, tenantId).first<Record<string, unknown>>();

  if (!insights) {
    return c.json({ error: 'No insights generated yet. Call POST /llm-insights first.' }, 404);
  }

  return c.json({
    summary: insights.summary,
    risks: JSON.parse(insights.risks as string || '[]'),
    actions: JSON.parse(insights.actions as string || '[]'),
    impact: insights.impact,
    generatedAt: insights.generated_at,
  });
});

// GET /api/catalysts/runs/:runId/narrative — LLM-generated "tl;dr" for a completed run.
// Thin wrapper over services/catalyst-narrative.ts — handles HTTP mapping only.
// Mounted under both /api/v1/catalysts and /api/catalysts by the app-level router.
catalysts.get('/runs/:runId/narrative', async (c) => {
  const tenantId = getTenantId(c);
  const runId = c.req.param('runId');
  const requestId = c.get('requestId');

  try {
    const result = await generateRunNarrative(c.env.DB, c.env, runId, tenantId, requestId);
    return c.json({
      runId,
      narrative: result.narrative,
      cached: result.cached,
      tokensIn: result.tokens_in,
      tokensOut: result.tokens_out,
      costUsd: result.cost_usd,
    });
  } catch (err) {
    if (err instanceof NarrativeError) {
      const statusByCode: Record<string, number> = {
        not_found: 404,
        not_finished: 409,
        budget_exhausted: 429,
        llm_failed: 502,
      };
      const status = statusByCode[err.code] ?? 500;
      // Surface a structured JSON body even on 429 so the UI can show a clean
      // "budget exhausted" message rather than a 500-style generic error.
      return c.json(
        {
          error: err.code,
          message: err.message,
          ...(err.details || {}),
        },
        status as 404 | 409 | 429 | 500 | 502,
      );
    }
    console.error('run narrative generation failed:', err);
    return c.json({ error: 'internal_error', message: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// ── Catalyst Simulator routes (v52-simulator) ─────────────────────────
//
// World-first capability: predict the impact of running a catalyst
// against the customer's actual ERP data with a calibrated confidence
// interval, then record the actual outcome and improve the prediction
// per-tenant via Welford's online stats.
// See workers/api/src/services/catalyst-simulator.ts for the algorithm.

// POST /clusters/:clusterId/sub-catalysts/:subName/simulate
// Generates a calibrated prediction (predicted_value_zar + lower/upper
// bound + calibration factor + n_priors) for running this sub-catalyst
// against the tenant's current state. Persists the prediction so a
// later recordOutcome() call can update calibration.
catalysts.post('/clusters/:clusterId/sub-catalysts/:subName/simulate', async (c) => {
  const tenantId = getTenantId(c);
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));

  // Look up the cluster to get its canonical catalyst-catalog name. The
  // simulator's findingsForCatalyst() matches by catalyst NAME, not by
  // cluster_id — so we resolve the cluster's name here.
  const cluster = await c.env.DB.prepare(
    'SELECT id, name FROM catalyst_clusters WHERE id = ? AND tenant_id = ?',
  ).bind(clusterId, tenantId).first<{ id: string; name: string }>();
  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

  const { simulateCatalyst } = await import('../services/catalyst-simulator');
  try {
    const result = await simulateCatalyst(c.env.DB, tenantId, cluster.name, subName, {
      clusterId: cluster.id,
    });
    return c.json(result);
  } catch (err) {
    console.error('catalyst simulation failed:', err);
    return c.json({ error: 'simulation_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// POST /simulations/:simulationId/record-outcome
// Records the actual outcome of a previously-simulated catalyst run.
// The Welford-style calibration aggregate is updated atomically.
catalysts.post('/simulations/:simulationId/record-outcome', async (c) => {
  const tenantId = getTenantId(c);
  const simulationId = c.req.param('simulationId');
  const body = await c.req.json<{ run_id: string; actual_value_zar: number }>();
  if (!body.run_id || typeof body.actual_value_zar !== 'number') {
    return c.json({ error: 'run_id (string) and actual_value_zar (number) are required' }, 400);
  }
  const { recordOutcome } = await import('../services/catalyst-simulator');
  try {
    const result = await recordOutcome(c.env.DB, tenantId, simulationId, body.run_id, body.actual_value_zar);
    return c.json(result);
  } catch (err) {
    if (err instanceof Error && err.message.includes('not found')) {
      return c.json({ error: 'simulation_not_found' }, 404);
    }
    console.error('record-outcome failed:', err);
    return c.json({ error: 'record_failed', message: err instanceof Error ? err.message : 'Unknown error' }, 500);
  }
});

// GET /clusters/:clusterId/sub-catalysts/:subName/calibration
// Returns the current calibration stats for the chart on the run-detail page.
catalysts.get('/clusters/:clusterId/sub-catalysts/:subName/calibration', async (c) => {
  const tenantId = getTenantId(c);
  const clusterId = c.req.param('clusterId');
  const subName = decodeURIComponent(c.req.param('subName'));
  const { getCalibrationStats, listRecentSimulations } = await import('../services/catalyst-simulator');
  const [stats, history] = await Promise.all([
    getCalibrationStats(c.env.DB, tenantId, clusterId, subName),
    listRecentSimulations(c.env.DB, tenantId, { clusterId, subCatalystName: subName, limit: 50 }),
  ]);
  return c.json({ stats, history });
});

// GET /calibrations/summary
// Tenant-wide aggregate for the buyer-facing Trust & Performance page —
// "predictions made vs outcomes recorded" expressed in one row instead of
// per-(cluster, sub-catalyst). Used by /trust on the frontend.
catalysts.get('/calibrations/summary', async (c) => {
  const tenantId = getTenantId(c);
  const calibrations = await c.env.DB.prepare(
    `SELECT cluster_id, sub_catalyst_name, n_observations, calibration_factor, std_residual, mae, last_observation_at
       FROM catalyst_calibrations
      WHERE tenant_id = ?
      ORDER BY n_observations DESC, last_observation_at DESC`,
  ).bind(tenantId).all<{
    cluster_id: string | null;
    sub_catalyst_name: string;
    n_observations: number;
    calibration_factor: number;
    std_residual: number;
    mae: number;
    last_observation_at: string | null;
  }>();

  const sims = await c.env.DB.prepare(
    `SELECT
        COUNT(*) AS total_simulations,
        SUM(CASE WHEN actual_value_zar IS NOT NULL THEN 1 ELSE 0 END) AS with_outcomes,
        SUM(predicted_value_zar) AS total_predicted_zar
       FROM catalyst_simulations
      WHERE tenant_id = ?`,
  ).bind(tenantId).first<{ total_simulations: number; with_outcomes: number; total_predicted_zar: number }>();

  // Accuracy = 1 - mean(|residual - 1|) across all observed sims; clamp to
  // [0, 1] so a single bad outcome doesn't drive negative numbers in the UI.
  const observed = await c.env.DB.prepare(
    `SELECT residual FROM catalyst_simulations
      WHERE tenant_id = ? AND residual IS NOT NULL`,
  ).bind(tenantId).all<{ residual: number }>();
  const residualErrors = (observed.results || []).map(r => Math.abs((r.residual || 1) - 1));
  const meanErr = residualErrors.length > 0
    ? residualErrors.reduce((a, b) => a + b, 0) / residualErrors.length
    : 0;
  const accuracyPct = Math.max(0, Math.min(100, Math.round((1 - meanErr) * 1000) / 10));

  const totalObservations = (calibrations.results || []).reduce((s, r) => s + (r.n_observations || 0), 0);
  const calibratedClusters = (calibrations.results || []).filter(r => (r.n_observations || 0) >= 5).length;

  return c.json({
    accuracyPct,
    totalSimulations: sims?.total_simulations || 0,
    simulationsWithOutcomes: sims?.with_outcomes || 0,
    totalPredictedValueZar: Math.round((sims?.total_predicted_zar || 0) * 100) / 100,
    totalObservations,
    calibratedSubCatalysts: calibratedClusters,
    perSubCatalystCount: (calibrations.results || []).length,
    calibrations: calibrations.results || [],
  });
});

export { sendHitlNotification, sendRunResultsEmail };
export default catalysts;
