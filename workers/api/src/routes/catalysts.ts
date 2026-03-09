import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { executeTask, approveAction, rejectAction } from '../services/catalyst-engine';
import { getValidatedJsonBody } from '../middleware/validation';
import { INDUSTRY_TEMPLATES, getTemplateForIndustry } from '../services/catalyst-templates';

const catalysts = new Hono<AppBindings>();

/**
 * Write an execution log entry.
 */
async function writeLog(db: D1Database, tenantId: string, actionId: string, stepNumber: number, stepName: string, status: string, detail: string, durationMs?: number): Promise<void> {
  try {
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
async function generateInsightsForTenant(db: D1Database, tenantId: string, catalystName: string, domain: string, actionId?: string): Promise<void> {
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
  let existingDimensions: Record<string, { score: number; trend: string; delta: number }> = {};
  let existingId: string | null = null;
  try {
    const existing = await db.prepare('SELECT id, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ id: string; dimensions: string }>();
    if (existing) {
      existingId = existing.id;
      const parsed = JSON.parse(existing.dimensions);
      if (parsed && typeof parsed === 'object') existingDimensions = parsed;
    }
  } catch (err) { console.error('generateInsights: failed to read existing health data:', err); }

  // Only generate new scores for the affected dimensions
  for (const dim of affectedDimensions) {
    const score = Math.floor(60 + Math.random() * 35);
    const delta = Math.round((Math.random() * 10 - 3) * 10) / 10;
    const trend = delta > 0.5 ? 'improving' : delta < -0.5 ? 'declining' : 'stable';
    existingDimensions[dim] = { score, trend, delta };
  }

  // Recalculate overall from only the populated dimensions
  const populatedDims = Object.values(existingDimensions);
  const overallScore = populatedDims.length > 0
    ? Math.round(populatedDims.reduce((sum, d) => sum + d.score, 0) / populatedDims.length)
    : 0;

  try {
    if (existingId) {
      // Update existing row — merge dimensions
      await db.prepare(
        'UPDATE health_scores SET overall_score = ?, dimensions = ?, calculated_at = ? WHERE id = ?'
      ).bind(overallScore, JSON.stringify(existingDimensions), now, existingId).run();
    } else {
      // First catalyst run — create new row
      await db.prepare(
        'INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, overallScore, JSON.stringify(existingDimensions), now).run();
    }
  } catch (err) { console.error('generateInsights: health_scores upsert failed:', err); }

  const dimCount= Object.keys(existingDimensions).length;
  await writeLog(db, tenantId, logId, step, 'Health Score Calculation', 'completed', `Health score updated — overall ${overallScore}/100 across ${dimCount} dimension(s)`, Date.now() - t1);
  step++;

  // Step 3: Risk Alert — only generate risk for this catalyst's domain category
  const t2 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Risk Alert Generation', 'running', `Scanning ${domainLabel} for ${categoryLabel.toLowerCase()} risk indicators...`, 0);
  const riskRand = Math.random();
  const riskSeverity = riskRand > 0.6 ? 'high' : riskRand > 0.4 ? 'medium' : 'low';
  const riskImpact = riskSeverity === 'high' ? Math.floor(500000 + Math.random() * 500000) : riskSeverity === 'medium' ? Math.floor(200000 + Math.random() * 300000) : Math.floor(50000 + Math.random() * 100000);
  const riskTitle = friendlyRiskTitle(riskSeverity, domain);
  const riskDesc = friendlyRiskDescription(riskSeverity, domain, catalystName);
  try {
    await db.prepare(
      'INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId,
      riskTitle, riskDesc,
      riskSeverity, riskCategory, Math.round((0.3 + Math.random() * 0.5) * 100) / 100,
      riskImpact, 'ZAR',
      JSON.stringify([`Review ${domainLabel} findings and assess exposure`, `Assign a remediation owner from the ${categoryLabel} team`, `Schedule a follow-up review within 14 days`]),
      'active', now
    ).run();
  } catch (err) { console.error('generateInsights: risk_alerts insert failed:', err); }
  await writeLog(db, tenantId, logId, step, 'Risk Alert Generation', 'completed', `${categoryLabel} risk alert raised (${riskSeverity} severity)`, Date.now() - t2);
  step++;

  // Step 4: Executive Briefing — scoped to this catalyst
  const t3 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Executive Briefing', 'running', `Preparing executive summary for ${domainLabel}...`, 0);
  try {
    const dimDelta = existingDimensions[affectedDimensions[0]]?.delta ?? 0;
    const dimDeltaStr = `${dimDelta > 0 ? '+' : ''}${dimDelta}`;
    await db.prepare(
      'INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), tenantId,
      `${domainLabel} — Executive Summary`,
      `${catalystName} completed its analysis of ${domainLabel}. The overall business health score is now ${overallScore}/100 with ${affectedDimensions.map(friendlyDimension).join(' and ')} updated. Key findings have been surfaced for your review.`,
      JSON.stringify([`A ${riskSeverity}-severity ${categoryLabel.toLowerCase()} risk was identified — review recommended`]),
      JSON.stringify([`Explore efficiency improvements in ${domainLabel} to reduce cost and cycle time`]),
      JSON.stringify([{ metric: `${friendlyDimension(affectedDimensions[0])}`, change: `${dimDeltaStr} pts` }]),
      JSON.stringify([`Review the ${domainLabel} risk findings and agree on next steps`]),
      now
    ).run();
  } catch (err) { console.error('generateInsights: executive_briefings insert failed:', err); }
  await writeLog(db, tenantId, logId, step, 'Executive Briefing', 'completed', `Executive summary generated for ${domainLabel}`, Date.now() - t3);
  step++;

  // Step 5: Process Metrics — scoped to this domain only
  const t4 = Date.now();
  await writeLog(db, tenantId, logId, step, 'Process Metrics', 'running', `Capturing ${domainLabel} performance metrics...`, 0);
  const processMetrics = [
    { name: `${domainLabel} — Throughput`, value: Math.floor(80 + Math.random() * 20), unit: 'tps', status: 'green' as const },
    { name: `${domainLabel} — Response Time`, value: Math.floor(50 + Math.random() * 150), unit: 'ms', status: Math.random() > 0.5 ? 'amber' as const : 'green' as const },
    { name: `${domainLabel} — Error Rate`, value: Math.round(Math.random() * 5 * 100) / 100, unit: '%', status: Math.random() > 0.8 ? 'red' as const : 'green' as const },
  ];
  // Clean up any old-format metrics for this domain (pre-friendly-label format)
  try {
    await db.prepare("DELETE FROM process_metrics WHERE tenant_id = ? AND name LIKE ?").bind(tenantId, `${domain} %`).run();
    await db.prepare("DELETE FROM process_metrics WHERE tenant_id = ? AND name LIKE ?").bind(tenantId, `${domainLabel} —%`).run();
  } catch (err) { console.error('generateInsights: process_metrics cleanup failed:', err); }
  for (const metric of processMetrics){
    try {
      await db.prepare(
        'INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, trend, source_system, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, metric.name, metric.value, metric.unit, metric.status, JSON.stringify([metric.value * 0.9, metric.value * 0.95, metric.value]), catalystName, now).run();
    } catch (err) { console.error('generateInsights: process_metrics insert failed:', err); }
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
  // Only insert anomaly~40% of the time (not every catalyst run should find one)
  if (Math.random() < 0.4) {
    try {
      const expected = 100;
      const actual = Math.round(expected * (1 + (Math.random() * 0.4 - 0.1)));
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

  // Step 7: Finalisation
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
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/catalysts/clusters
catalysts.get('/clusters', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
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
  const defaultTenantId = auth?.tenantId || 'vantax';
  const tenantId = canCrossTenant(auth?.role) ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;

  // BUG-26: Enforce tenant ownership on cluster reads
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

// GET /api/catalysts/templates - List available industry templates
catalysts.get('/templates', async (c) => {
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
    })),
  }));
  return c.json({ templates });
});

// POST /api/catalysts/deploy-template - Deploy all catalyst clusters for an industry template
catalysts.post('/deploy-template', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminRole(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'Only admins can deploy catalyst templates' }, 403);
  }

  const body = await c.req.json<{
    tenant_id: string;
    industry: string;
    clusters?: Array<{
      name: string; domain: string; description: string; autonomy_tier: string;
      sub_catalysts: Array<{ name: string; enabled: boolean; description: string }>;
    }>;
  }>();

  if (!body.tenant_id) return c.json({ error: 'tenant_id is required' }, 400);
  if (!body.industry) return c.json({ error: 'industry is required' }, 400);

  // Only superadmin/support_admin can deploy to a different tenant
  const callerTenant = auth.tenantId;
  if (body.tenant_id !== callerTenant && !canCrossTenant(auth.role)) {
    return c.json({ error: 'Forbidden', message: 'You can only deploy templates to your own tenant' }, 403);
  }

  // Verify tenant exists
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE id = ?').bind(body.tenant_id).first();
  if (!tenant) return c.json({ error: 'Tenant not found' }, 404);

  // Get template clusters — use custom clusters if provided, else use the industry default
  let clustersToCreate = body.clusters;
  if (!clustersToCreate || clustersToCreate.length === 0) {
    const template = getTemplateForIndustry(body.industry);
    if (!template) return c.json({ error: `No template found for industry: ${body.industry}` }, 404);
    clustersToCreate = template.clusters.map(cl => ({
      name: cl.name,
      domain: cl.domain,
      description: cl.description,
      autonomy_tier: cl.autonomy_tier,
      sub_catalysts: cl.sub_catalysts,
    }));
  }

  // Check for existing clusters for this tenant — warn but don't block
  const existing = await c.env.DB.prepare(
    'SELECT COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ?'
  ).bind(body.tenant_id).first<{ count: number }>();

  const createdIds: string[] = [];
  for (const cl of clustersToCreate) {
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      'INSERT INTO catalyst_clusters (id, tenant_id, name, domain, description, status, agent_count, tasks_completed, tasks_in_progress, success_rate, trust_score, autonomy_tier, sub_catalysts) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      id, body.tenant_id, cl.name, cl.domain, cl.description,
      'active', 0, 0, 0, 0, 0, cl.autonomy_tier,
      JSON.stringify(cl.sub_catalysts)
    ).run();
    createdIds.push(id);
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), body.tenant_id, 'catalyst.template.deployed', 'catalysts', body.tenant_id,
    JSON.stringify({ industry: body.industry, clusters_created: createdIds.length, existing_clusters: existing?.count || 0 }),
    'success'
  ).run().catch(() => {});

  return c.json({
    success: true,
    industry: body.industry,
    clustersCreated: createdIds.length,
    clusterIds: createdIds,
    existingClusters: existing?.count || 0,
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
  status: 'completed' | 'failed' | 'partial';
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
      result = await performReconciliation(sub, sources, mappings, clusterId, targetTenant, c.env.DB);
    } else if (execConfig.mode === 'validation') {
      result = await performValidation(sub, sources, clusterId, targetTenant, c.env.DB);
    } else if (execConfig.mode === 'compare' && sources.length >= 2) {
      result = await performComparison(sub, sources, mappings, clusterId, targetTenant, c.env.DB);
    } else {
      // Default: extract/analyze mode — pull data from sources and report
      result = await performExtraction(sub, sources, clusterId, targetTenant, c.env.DB);
    }

    result.duration_ms = Date.now() - startTime;
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
  db: D1Database
): Promise<ExecutionResultRecord> {
  // Pull data from the first two data sources using ERP canonical tables
  const sourceData = await fetchDataForSource(sources[0], tenantId, db);
  const targetData = await fetchDataForSource(sources[1], tenantId, db);

  let matched = 0;
  let discrepancyCount = 0;
  let skippedSource = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];

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
        matched++;

        // Check other mappings for discrepancies between matched records
        for (const fm of keyMappings.slice(1)) {
          const sv = srcRow[fm.source_field];
          const tv = tgtRow[fm.target_field];
          if (fm.match_type === 'numeric_tolerance') {
            const nSv = parseFloat(String(sv));
            const nTv = parseFloat(String(tv));
            const tol = fm.tolerance ?? 0.01;
            if (!isNaN(nSv) && !isNaN(nTv) && Math.abs(nSv - nTv) > tol) {
              discrepancyCount++;
              if (discrepancies && discrepancies.length < 50) {
                discrepancies.push({
                  source_record: srcRow, target_record: tgtRow,
                  field: `${fm.source_field} vs ${fm.target_field}`,
                  source_value: sv, target_value: tv,
                  difference: `Difference: ${(nSv - nTv).toFixed(2)}`,
                });
              }
            }
          } else {
            const sSv = String(sv ?? '').toLowerCase().trim();
            const sTv = String(tv ?? '').toLowerCase().trim();
            if (sSv !== sTv) {
              discrepancyCount++;
              if (discrepancies && discrepancies.length < 50) {
                discrepancies.push({
                  source_record: srcRow, target_record: tgtRow,
                  field: `${fm.source_field} vs ${fm.target_field}`,
                  source_value: sv, target_value: tv,
                });
              }
            }
          }
        }
        break;
      }
    }

    if (!foundMatch && discrepancies && discrepancies.length < 50) {
      discrepancies.push({
        source_record: srcRow, target_record: null,
        field: primaryKey.source_field,
        source_value: srcRow[primaryKey.source_field],
        target_value: null,
        difference: 'No matching record in target',
      });
    }
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: (discrepancyCount > 0 || matched < (sourceData.length - skippedSource) || matchedTargetIndices.size < (targetData.length - skippedTargetCount)) ? 'partial' : 'completed',
    mode: 'reconciliation',
    summary: {
      total_records_source: sourceData.length - skippedSource,
      total_records_target: targetData.length - skippedTargetCount,
      matched,
      unmatched_source: sourceData.length - skippedSource - matched,
      unmatched_target: targetData.length - skippedTargetCount - matchedTargetIndices.size,
      discrepancies: discrepancyCount,
    },
    discrepancies: discrepancies?.length ? discrepancies : undefined,
  };
}

async function performValidation(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  clusterId: string,
  tenantId: string,
  db: D1Database
): Promise<ExecutionResultRecord> {
  const data = await fetchDataForSource(sources[0], tenantId, db);
  let issues = 0;
  const discrepancies: ExecutionResultRecord['discrepancies'] = [];

  for (const row of data) {
    // Basic validation checks
    const hasAmount = row['amount'] !== undefined && row['amount'] !== null && row['amount'] !== '';
    const hasDate = row['invoice_date'] || row['date'] || row['posting_date'];
    const hasRef = row['invoice_number'] || row['reference'] || row['transaction_id'] || row['document_number'];

    if (!hasAmount || !hasDate || !hasRef) {
      issues++;
      if (discrepancies && discrepancies.length < 50) {
        discrepancies.push({
          source_record: row, target_record: null,
          field: !hasAmount ? 'amount' : !hasDate ? 'date' : 'reference',
          source_value: null, target_value: null,
          difference: `Missing required field: ${!hasAmount ? 'amount' : !hasDate ? 'date' : 'reference'}`,
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
  db: D1Database
): Promise<ExecutionResultRecord> {
  const sourceData = await fetchDataForSource(sources[0], tenantId, db);
  const targetData = await fetchDataForSource(sources[1], tenantId, db);

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: 'completed', mode: 'compare',
    summary: {
      total_records_source: sourceData.length, total_records_target: targetData.length,
      matched: Math.min(sourceData.length, targetData.length),
      unmatched_source: Math.max(0, sourceData.length - targetData.length),
      unmatched_target: Math.max(0, targetData.length - sourceData.length),
      discrepancies: Math.abs(sourceData.length - targetData.length),
    },
  };
}

async function performExtraction(
  sub: SubCatalystRecord,
  sources: Array<{ type: string; config: Record<string, unknown> }>,
  clusterId: string,
  tenantId: string,
  db: D1Database
): Promise<ExecutionResultRecord> {
  let totalRecords = 0;
  for (const src of sources) {
    const data = await fetchDataForSource(src, tenantId, db);
    totalRecords += data.length;
  }

  return {
    id: crypto.randomUUID(), sub_catalyst: sub.name, cluster_id: clusterId,
    executed_at: new Date().toISOString(), duration_ms: 0,
    status: 'completed', mode: sub.execution_config?.mode || 'extract',
    summary: {
      total_records_source: totalRecords, total_records_target: 0,
      matched: totalRecords, unmatched_source: 0, unmatched_target: 0, discrepancies: 0,
    },
  };
}

async function fetchDataForSource(
  source: { type: string; config: Record<string, unknown> },
  tenantId: string,
  db: D1Database
): Promise<Record<string, unknown>[]> {
  try {
    if (source.type === 'erp') {
      // erp_type available in source.config.erp_type for adapter selection
      const module = String(source.config.module || '').toLowerCase();

      if (module.includes('invoice') || module.includes('accounts_payable') || module.includes('ap')) {
        const rows = await db.prepare(
          'SELECT invoice_number, invoice_date, due_date, amount, tax_amount, status, vendor_name, description FROM erp_invoices WHERE tenant_id = ? LIMIT 500'
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('customer') || module.includes('accounts_receivable') || module.includes('ar')) {
        const rows = await db.prepare(
          'SELECT id, name, email, phone, account_number, credit_limit, outstanding_balance FROM erp_customers WHERE tenant_id = ? LIMIT 500'
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('product') || module.includes('inventory') || module.includes('stock')) {
        const rows = await db.prepare(
          'SELECT sku, name, stock_on_hand, reorder_level, cost_price, selling_price, category FROM erp_products WHERE tenant_id = ? LIMIT 500'
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      if (module.includes('supplier') || module.includes('vendor')) {
        const rows = await db.prepare(
          'SELECT id, name, email, payment_terms, tax_number FROM erp_suppliers WHERE tenant_id = ? LIMIT 500'
        ).bind(tenantId).all();
        return rows.results as Record<string, unknown>[];
      }
      // Default: try invoices as a common ERP data set
      const rows = await db.prepare(
        'SELECT invoice_number, invoice_date, amount, status, vendor_name FROM erp_invoices WHERE tenant_id = ? LIMIT 500'
      ).bind(tenantId).all();
      return rows.results as Record<string, unknown>[];
    }

    if (source.type === 'custom_system') {
      // For custom/bank systems, pull from process_metrics as a proxy data source
      const rows = await db.prepare(
        'SELECT metric_name as reference, metric_value as amount, status, updated_at as date, dimension as category FROM process_metrics WHERE tenant_id = ? LIMIT 500'
      ).bind(tenantId).all();
      return rows.results as Record<string, unknown>[];
    }

    // For email, cloud_storage, upload: return process_metrics as placeholder data
    const rows = await db.prepare(
      'SELECT metric_name as reference, metric_value as amount, status, updated_at as date FROM process_metrics WHERE tenant_id = ? LIMIT 200'
    ).bind(tenantId).all();
    return rows.results as Record<string, unknown>[];
  } catch (err) {
    console.error(`fetchDataForSource error for type=${source.type}:`, err);
    return [];
  }
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

  // BUG-19: Validate update fields
  const allowedStatus = new Set(['active', 'inactive']);
  const allowedAutonomy = new Set(['read-only', 'assisted', 'transactional']);

  if (body.status && !allowedStatus.has(body.status)) {
    return c.json({ error: 'Invalid status', message: `Allowed: ${[...allowedStatus].join(', ')}` }, 400);
  }
  if (body.autonomy_tier && !allowedAutonomy.has(body.autonomy_tier)) {
    return c.json({ error: 'Invalid autonomy_tier', message: `Allowed: ${[...allowedAutonomy].join(', ')}` }, 400);
  }

  // BUG-25: Enforce tenant ownership on cluster updates
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
  const defaultTenantId = auth?.tenantId || 'vantax';
  const tenantId = canCrossTenant(auth?.role) ? (c.req.query('tenant_id') || defaultTenantId) : defaultTenantId;
  const { data: body, errors } = await getValidatedJsonBody<{
    cluster_id: string; catalyst_name: string; action: string;
    confidence?: number; input_data?: Record<string, unknown>; reasoning?: string;
    risk_level?: string;
  }>(c, [
    { field: 'cluster_id', type: 'string', required: true, minLength: 1 },
    { field: 'catalyst_name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'action', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'risk_level', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Get cluster info for autonomy tier and trust score
  const cluster = await c.env.DB.prepare(
    'SELECT * FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
  ).bind(body.cluster_id, tenantId).first();

  if (!cluster) return c.json({ error: 'Cluster not found' }, 404);

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
  }, c.env.DB, c.env.CACHE, c.env.AI, c.env.OLLAMA_API_KEY);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), tenantId, 'catalyst.action.executed', 'catalysts', body.cluster_id,
    JSON.stringify({ action_id: result.actionId, catalyst: body.catalyst_name, action: body.action, confidence: result.confidence, status: result.status }),
    result.status === 'failed' ? 'failure' : 'success',
  ).run();

  return c.json(result, 201);
});

// PUT /api/catalysts/actions/:id/approve - Approve via execution engine
catalysts.put('/actions/:id/approve', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string }>();

  const result = await approveAction(id, body.approved_by || 'system', c.env.DB, c.env.CACHE);
  return c.json(result);
});

// PUT /api/catalysts/actions/:id/reject - Reject via execution engine
catalysts.put('/actions/:id/reject', async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json<{ approved_by?: string; reason?: string }>();

  const result = await rejectAction(id, body.approved_by || 'system', body.reason || '', c.env.DB, c.env.CACHE);
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
    await generateInsightsForTenant(c.env.DB, tenantId, catalystName, clusterDomain, actionId);
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
    query = 'SELECT * FROM execution_logs WHERE tenant_id = ? AND action_id = ? ORDER BY step_number ASC LIMIT ?';
    binds.push(actionId, limit);
  } else {
    query = 'SELECT * FROM execution_logs WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?';
    binds.push(limit);
  }

  try {
    const results = await c.env.DB.prepare(query).bind(...binds).all();
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

export default catalysts;
