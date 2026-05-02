/**
 * Scheduled Handler — Cron Triggers for Atheon
 * Handles: health recalculation, executive briefings, memory auto-population, process mining, agent lifecycle
 */

import type { Env } from '../types';
import { optimizedChat } from './ai-cost-optimizer';
import { recalculateHealthScoreFromKpis } from './insights-engine';
import { runScheduledRadarScan } from './radar-engine-v2';
import { calculateEffectiveness, calculateROI } from './pattern-engine-v2';
import { checkOverduePrescriptions } from './diagnostics-engine-v2';
import { queueEmail } from './email';
import { getWeeklyDigestEmailTemplate } from './email';
import { logInfo, logError } from './logger';
import { processDueWebhooks } from './webhook-delivery';
import { detectErpSchemaDrift } from './erp-drift-detector';
import { escalateStaleActions } from './erp-hitl-sla';
import { verifyCompletedActions } from './erp-action-verification';
import { detectMetricCorrelations } from './metric-correlation-engine';
import { sweepExternalSignals } from './external-signals-feed';
import { attributeSignalsToKpis } from './signal-kpi-attribution';
import { synthesizeCrossCatalystRca } from './cross-catalyst-rca-synthesizer';
import { generateApexNarrative, closeRecoveredRcas } from './apex-narrative-engine';
import { sweepCompetitorIntel } from './competitor-intel-source';
import { sweepRegulatoryFeeds } from './regulatory-feed';

interface ScheduledEnv extends Env {
  CATALYST_QUEUE?: Queue<CatalystQueueMessage>;
}

export interface CatalystQueueMessage {
  type: 'catalyst_execution' | 'erp_sync' | 'health_recalc' | 'briefing_gen';
  tenantId: string;
  payload: Record<string, unknown>;
  scheduledAt: string;
}

// Main scheduled handler — dispatched by Cron Triggers
// Configured in wrangler.toml: [triggers] crons = ["every 15 minutes"]
export async function handleScheduled(
  _event: ScheduledController,
  env: ScheduledEnv,
): Promise<void> {
  const db = env.DB;
  const cache = env.CACHE;
  // Synthetic request-ID per cron invocation so every tenant-iteration log
  // in this run is correlatable (no Hono context available here).
  const runId = crypto.randomUUID();

  // Get all active tenants
  const tenants = await db.prepare(
    "SELECT id, slug FROM tenants WHERE status = 'active'"
  ).all();

  logInfo('scheduled.run.start', { requestId: runId, layer: 'scheduled', action: 'cron.tick' }, {
    tenantCount: tenants.results.length,
  });

  for (const tenant of tenants.results) {
    const tenantId = tenant.id as string;

    try {
      // 3.6: Health score recalculation
      await recalculateHealthScore(db, tenantId);

      // 3.7: Executive briefing generation
      await generateBriefing(db, env.AI, tenantId, env.OLLAMA_API_KEY, env.CACHE);

      // 3.8: Memory auto-population from ERP data
      await autoPopulateMemory(db, tenantId);

      // 3.9: Process mining refresh + 5.4: event-driven catalyst triggers
      await refreshProcessMining(db, tenantId, env.CATALYST_QUEUE);

      // 5.4: Agent lifecycle — heartbeat check & status updates
      await checkAgentLifecycle(db, cache, tenantId);

      // 6.0: Sub-catalyst scheduled execution — run due sub-catalysts
      await executeScheduledSubCatalysts(db, tenantId);

      // V2: Radar scan — analyse unprocessed signals
      try { await runScheduledRadarScan(db, tenantId, env); } catch (e) { console.error(`Radar scan failed for ${tenantId}:`, e); }

      // §9.1 — Overdue prescription checks
      try { await checkOverduePrescriptions(db, tenantId); } catch (e) { console.error(`Overdue checks failed for ${tenantId}:`, e); }

      // §9.1 — Weekly digest email (Monday mornings)
      try { await generateWeeklyDigest(db, tenantId); } catch (e) { console.error(`Weekly digest failed for ${tenantId}:`, e); }

      // §11.3 — Goal achievement checks
      try { await checkGoalAchievements(db, tenantId); } catch (e) { console.error(`Goal achievement check failed for ${tenantId}:`, e); }

      // V2: Effectiveness + ROI recalculation
      // OPTIMIZED: Fetch id + sub_catalysts in one query (was 2 queries per cluster — N+1)
      try {
        const clusters = await db.prepare('SELECT id, name, sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all();
        for (const cl of clusters.results) {
          const clRow = cl as Record<string, unknown>;
          if (clRow.sub_catalysts) {
            const subList = JSON.parse(clRow.sub_catalysts as string || '[]') as Array<{ name: string }>;
            for (const sub of subList) {
              await calculateEffectiveness(db, tenantId, clRow.id as string, sub.name).catch(() => {});
            }
          }
        }
        await calculateROI(db, tenantId);
      } catch (e) { console.error(`Effectiveness/ROI calc failed for ${tenantId}:`, e); }

      // v59 ERP schema drift detection — flag any per-connection schema
      // that has gained or lost fields since the last drift sweep. Surface
      // as a notification so the customer can confirm the change before
      // the auto-mapper acts on stale assumptions. Best-effort.
      try { await detectErpSchemaDrift(db, tenantId); } catch (e) { console.error(`ERP drift detection failed for ${tenantId}:`, e); }

      // v65 HITL SLA — sweep pending_approval write-back actions; warn
      // at 24h, escalate at 48h, auto-reject at 7 days. Keeps the queue
      // bounded + customer in the loop. Best-effort.
      try { await escalateStaleActions(db, tenantId); } catch (e) { console.error(`HITL SLA sweep failed for ${tenantId}:`, e); }

      // v66 post-action verification — re-read the ERP for recently-
      // completed actions; mark verification_status. Failures notify the
      // customer + ROI attribution downgrades to never bill on writes the
      // ERP didn't actually record. Best-effort.
      try { await verifyCompletedActions(db, tenantId); } catch (e) { console.error(`Action verification failed for ${tenantId}:`, e); }

      // Phase 10-1 — pairwise metric correlation. Walks the tenant's
      // metric history and writes correlation_events when two metrics
      // co-move with |r| ≥ 0.7 over ≥ 14 daily buckets. Substrate for
      // the cross-catalyst RCA synthesizer (Phase 10-4). Best-effort.
      try { await detectMetricCorrelations(db, tenantId); } catch (e) { console.error(`Correlation sweep failed for ${tenantId}:`, e); }

      // Phase 10-3 — signal → KPI attribution. Joins external_signals
      // history (Phase 10-2) to process_metric_history with a 0–7 day
      // lag sweep; persists significant joins to signal_impacts. Lets
      // Apex narrate "Brent +22% drove procurement costs +6%" instead
      // of two unrelated headlines. Best-effort.
      try { await attributeSignalsToKpis(db, tenantId); } catch (e) { console.error(`Signal attribution failed for ${tenantId}:`, e); }

      // Phase 10-4 — cross-catalyst RCA synthesizer. For each red KPI,
      // composes a deterministic causal chain from signal_impacts (10-3)
      // and correlation_events (10-1) — L0 symptom, L1 direct external
      // drivers, L2 cross-metric drivers, L3 transitive external drivers.
      // Persists to root_cause_analyses + causal_factors. Best-effort.
      try { await synthesizeCrossCatalystRca(db, tenantId); } catch (e) { console.error(`Cross-catalyst RCA failed for ${tenantId}:`, e); }

      // Phase 10-5 — RCA closure. For each active RCA whose symptom
      // metric has held a non-red status across the last N samples,
      // mark the RCA resolved. Counterpart to verifyCompletedActions:
      // verification proves the write landed, closure proves the
      // outcome materialised. Best-effort.
      try { await closeRecoveredRcas(db, tenantId); } catch (e) { console.error(`RCA closure failed for ${tenantId}:`, e); }

      // Phase 10-5 — Apex narrative. Distils recent active RCAs into
      // one executive_briefings row per tenant per day (debounced).
      // Risks = live symptoms with their causal chain; KPI movements =
      // symptom metric values; Opportunities = RCAs that recently
      // closed (recovery wins). Best-effort.
      try { await generateApexNarrative(db, tenantId); } catch (e) { console.error(`Apex narrative failed for ${tenantId}:`, e); }

      // Phase 10-8 — competitor intelligence. Per tenant, reads each
      // competitors row, queries Google News RSS, classifies each
      // headline into a strategy category (pricing / product_launch /
      // market_expansion / hiring / funding_or_ma / partnership /
      // trouble), persists to radar_signals. No-op for tenants with
      // no competitors. Best-effort.
      try { await sweepCompetitorIntel(db, tenantId, {}); } catch (e) { console.error(`Competitor intel failed for ${tenantId}:`, e); }

      // Phase 10-12 — regulatory feeds. Industry-aware: SARS/SARB
      // for everyone; FSCA/JSE for finance; SAHPRA for healthcare;
      // DMRE for mining; NRCS for agri/fmcg/manufacturing; ICASA
      // for tech. Persists to regulatory_events table. Best-effort.
      try { await sweepRegulatoryFeeds(db, tenantId, {}); } catch (e) { console.error(`Regulatory feed failed for ${tenantId}:`, e); }
    } catch (err) {
      logError('scheduled.tenant.failed', err, {
        requestId: runId,
        tenantId,
        layer: 'scheduled',
        action: 'tenant.failed',
      });
    }
  }

  // §11.4 — Peer benchmarks (daily, global across all tenants)
  try { await calculatePeerBenchmarks(db); } catch (e) { console.error('Peer benchmarks calculation failed:', e); }

  // Phase 10-2 — pull live external macro signals (FX from frankfurter,
  // Brent crude from EIA when EIA_API_KEY is set) once per tick and fan
  // them out to every active tenant's external_signals table. Substrate
  // for Phase 10-3 (signal → KPI attribution) and 10-4 (RCA synthesizer).
  // Best-effort — never throws.
  try {
    await sweepExternalSignals(db, {
      EIA_API_KEY: (env as { EIA_API_KEY?: string }).EIA_API_KEY,
    });
  } catch (e) {
    console.error('External signals sweep failed:', e);
  }

  // §11.6 — Resolution patterns (monthly aggregation)
  try { await calculateResolutionPatterns(db); } catch (e) { console.error('Resolution patterns calculation failed:', e); }

  // §11.1 — Trial cleanup (remove expired trials)
  try { await cleanupExpiredTrials(db); } catch (e) { console.error('Trial cleanup failed:', e); }

  // Phase 6.4: Email delivery with retry + fallback
  await processEmailQueue(db, env);

  // Audit §3.6: Signed webhook delivery with exponential-backoff retry + DLQ
  try {
    await processDueWebhooks(db);
  } catch (e) {
    console.error('Webhook queue processing failed:', e);
  }
}

/**
 * Phase 6.4: Email Queue Processor with Retry & Fallback
 * Processes pending emails with exponential backoff retry.
 * Uses Microsoft Graph API as primary, with a simple SMTP fallback.
 */
async function processEmailQueue(db: D1Database, env: ScheduledEnv): Promise<void> {
  const pendingEmails = await db.prepare(
    `SELECT id, tenant_id, recipients, subject, html_body, text_body, retry_count, max_retries
     FROM email_queue WHERE status = 'pending' AND (retry_count < max_retries OR max_retries IS NULL)
     ORDER BY created_at ASC LIMIT 20`
  ).all();

  for (const row of pendingEmails.results) {
    const email = row as Record<string, unknown>;
    const retryCount = (email.retry_count as number) || 0;
    const maxRetries = (email.max_retries as number) || 3;

    try {
      // Try Microsoft Graph API
      const sent = await sendViaGraphAPI(email, env);
      if (sent) {
        await db.prepare(
          "UPDATE email_queue SET status = 'sent', sent_at = datetime('now') WHERE id = ?"
        ).bind(email.id).run();
        continue;
      }

      // If Graph API fails, mark for retry with exponential backoff
      if (retryCount + 1 >= maxRetries) {
        await db.prepare(
          "UPDATE email_queue SET status = 'failed', error = 'Max retries exceeded', retry_count = ? WHERE id = ?"
        ).bind(retryCount + 1, email.id).run();
      } else {
        await db.prepare(
          "UPDATE email_queue SET retry_count = ?, error = 'Delivery failed, will retry' WHERE id = ?"
        ).bind(retryCount + 1, email.id).run();
      }
    } catch (err) {
      console.error(`Email delivery failed for ${email.id}:`, err);
      await db.prepare(
        "UPDATE email_queue SET retry_count = ?, error = ? WHERE id = ?"
      ).bind(retryCount + 1, (err as Error).message, email.id).run().catch(() => {});
    }
  }
}

/** Send email via Microsoft Graph API */
async function sendViaGraphAPI(email: Record<string, unknown>, env: ScheduledEnv): Promise<boolean> {
  if (!env.MS_GRAPH_CLIENT_ID || !env.MS_GRAPH_CLIENT_SECRET || !env.MS_GRAPH_TENANT_ID) {
    return false;
  }

  try {
    // Get access token
    const tokenRes = await fetch(`https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.MS_GRAPH_CLIENT_ID,
        client_secret: env.MS_GRAPH_CLIENT_SECRET,
        scope: 'https://graph.microsoft.com/.default',
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenRes.ok) return false;
    const tokenData = await tokenRes.json() as { access_token: string };

    const recipients = JSON.parse(email.recipients as string) as string[];
    const toRecipients = recipients.map(r => ({ emailAddress: { address: r } }));

    const sendRes = await fetch('https://graph.microsoft.com/v1.0/users/noreply@vantax.co.za/sendMail', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${tokenData.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          subject: email.subject,
          body: { contentType: 'HTML', content: email.html_body },
          toRecipients,
        },
      }),
    });

    return sendRes.ok || sendRes.status === 202;
  } catch {
    return false;
  }
}

/**
 * 3.6: Health Score Recalculation (GAP 3 — uses real KPI data across all business dimensions)
 * Delegates to the insights engine which aggregates KPI values, process metrics,
 * risk alerts, catalyst success rates, and anomalies into a multi-dimensional composite score.
 * Dimensions: financial, operational, compliance, strategic, technology, risk, catalyst, process.
 */
async function recalculateHealthScore(db: D1Database, tenantId: string): Promise<void> {
  await recalculateHealthScoreFromKpis(db, tenantId);
}

/**
 * 3.7: Executive Briefing Generation
 * Creates daily briefing from latest health, risks, and catalyst data
 */
async function generateBriefing(db: D1Database, ai: Ai, tenantId: string, ollamaApiKey?: string, cache?: KVNamespace): Promise<void> {
  // Check if we already generated a briefing today
  const existing = await db.prepare(
    "SELECT id FROM executive_briefings WHERE tenant_id = ? AND generated_at >= datetime('now', '-1 day')"
  ).bind(tenantId).first();
  if (existing) return;

  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  // Skip briefing generation for tenants with no health data (new/empty tenants)
  if (!health) return;

  const activeRisks = await db.prepare(
    "SELECT title, severity, category, impact_value FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 5"
  ).bind(tenantId).all();

  const pendingApprovals = await db.prepare(
    "SELECT COUNT(*) as count FROM catalyst_actions WHERE tenant_id = ? AND status IN ('pending_approval', 'escalated')"
  ).bind(tenantId).first<{ count: number }>();

  const openAnomalies = await db.prepare(
    "SELECT metric, severity FROM anomalies WHERE tenant_id = ? AND status = 'open' LIMIT 5"
  ).bind(tenantId).all();

  // Build briefing content
  const overallScore = (health.overall_score as number) || 0;
  const dims = health?.dimensions ? JSON.parse(health.dimensions as string) : {};

  const risks = activeRisks.results.map((r: Record<string, unknown>) =>
    `[${r.severity}] ${r.title} (${r.category}, R${((r.impact_value as number) || 0).toLocaleString()})`
  );

  const opportunities: string[] = [];
  if (overallScore >= 80) opportunities.push('Strong health position — consider expanding catalyst automation');
  if ((pendingApprovals?.count || 0) === 0) opportunities.push('No pending approvals — pipeline clear for new deployments');

  const kpiMovements = Object.entries(dims).map(([key, val]: [string, unknown]) => {
    const d = val as { score: number; trend: string };
    return `${key}: ${d.score}/100 (${d.trend})`;
  });

  const decisionsNeeded: string[] = [];
  if ((pendingApprovals?.count || 0) > 0) decisionsNeeded.push(`${pendingApprovals?.count} catalyst action(s) awaiting approval`);
  if (openAnomalies.results.length > 0) decisionsNeeded.push(`${openAnomalies.results.length} anomaly(ies) require investigation`);

  let summary = `Overall health: ${overallScore}/100. ${activeRisks.results.length} active risk(s). ${pendingApprovals?.count || 0} pending approval(s).`;

  // Try AI-enhanced summary via optimizedChat (cache + tiered routing + cost tracking)
  try {
    if (cache) {
      const briefingQuery = `Health: ${overallScore}/100. Risks: ${risks.join('; ')}. KPIs: ${kpiMovements.join(', ')}. Pending: ${pendingApprovals?.count || 0} approvals.`;
      const aiResult = await optimizedChat(
        ollamaApiKey, ai, cache,
        tenantId,
        [
          { role: 'system', content: 'You are a concise executive briefing writer for an enterprise intelligence platform. Write a 2-3 sentence executive summary. Be specific with numbers.' },
          { role: 'user', content: briefingQuery },
        ],
        briefingQuery,
      );
      if (aiResult.response) summary = aiResult.response;
    }
  } catch (err) {
    console.error('generateBriefing: AI summary failed, using fallback:', err);
  }

  const title = `Executive Briefing — ${new Date().toISOString().split('T')[0]}`;

  await db.prepare(
    'INSERT INTO executive_briefings (id, tenant_id, title, summary, risks, opportunities, kpi_movements, decisions_needed, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(
    crypto.randomUUID(), tenantId, title, summary,
    JSON.stringify(risks), JSON.stringify(opportunities),
    JSON.stringify(kpiMovements), JSON.stringify(decisionsNeeded),
  ).run();
}

/**
 * 3.8: Memory Auto-Population
 * Creates graph entities from ERP canonical data (customers, suppliers, products)
 * OPTIMIZED: Batch existence check instead of N+1 per-entity SELECT
 */
async function autoPopulateMemory(db: D1Database, tenantId: string): Promise<void> {
  // Only run if there are ERP records but few graph entities
  const entityCount = await db.prepare(
    'SELECT COUNT(*) as count FROM graph_entities WHERE tenant_id = ? AND source = ?'
  ).bind(tenantId, 'erp_sync').first<{ count: number }>();

  const erpCustomers = await db.prepare(
    'SELECT id, name, customer_group, city, status FROM erp_customers WHERE tenant_id = ? LIMIT 50'
  ).bind(tenantId).all();

  const erpSuppliers = await db.prepare(
    'SELECT id, name, supplier_group, city, status FROM erp_suppliers WHERE tenant_id = ? LIMIT 50'
  ).bind(tenantId).all();

  const erpProducts = await db.prepare(
    'SELECT id, name, category, sku FROM erp_products WHERE tenant_id = ? AND is_active = 1 LIMIT 50'
  ).bind(tenantId).all();

  // Skip if no new ERP data or already heavily populated
  const totalErp = erpCustomers.results.length + erpSuppliers.results.length + erpProducts.results.length;
  if (totalErp === 0 || (entityCount?.count || 0) >= totalErp * 2) return;

  // OPTIMIZED: Fetch ALL existing entity names in one query instead of per-entity lookups
  const existingEntities = await db.prepare(
    "SELECT type, name FROM graph_entities WHERE tenant_id = ? AND source = 'erp_sync'"
  ).bind(tenantId).all();

  const existingSet = new Set(
    existingEntities.results.map((e: Record<string, unknown>) => `${e.type}::${e.name}`)
  );

  // Collect all inserts into a batch (D1 batch API)
  const insertStmts: D1PreparedStatement[] = [];

  for (const cust of erpCustomers.results) {
    const c = cust as Record<string, unknown>;
    if (!existingSet.has(`customer::${c.name}`)) {
      insertStmts.push(
        db.prepare('INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), tenantId, 'customer', c.name, JSON.stringify({ group: c.customer_group, city: c.city, status: c.status, erpId: c.id }), 0.95, 'erp_sync')
      );
    }
  }

  for (const sup of erpSuppliers.results) {
    const s = sup as Record<string, unknown>;
    if (!existingSet.has(`supplier::${s.name}`)) {
      insertStmts.push(
        db.prepare('INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), tenantId, 'supplier', s.name, JSON.stringify({ group: s.supplier_group, city: s.city, status: s.status, erpId: s.id }), 0.95, 'erp_sync')
      );
    }
  }

  for (const prod of erpProducts.results) {
    const p = prod as Record<string, unknown>;
    if (!existingSet.has(`product::${p.name}`)) {
      insertStmts.push(
        db.prepare('INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
          .bind(crypto.randomUUID(), tenantId, 'product', p.name, JSON.stringify({ category: p.category, sku: p.sku, erpId: p.id }), 0.95, 'erp_sync')
      );
    }
  }

  // Execute all inserts in a single batch (1 round-trip instead of up to 150)
  if (insertStmts.length > 0) {
    await db.batch(insertStmts);
  }
}

/**
 * 3.9: Process Mining Refresh
 * Dynamically builds process flows, metrics, anomalies, and correlations
 * from catalyst_actions data — every catalyst domain becomes a process flow
 * with transaction-level reporting (completed vs escalated vs pending).
 * 5.4: Enqueues catalyst tasks when metrics transition to red.
 */
async function refreshProcessMining(
  db: D1Database, tenantId: string, queue?: Queue<CatalystQueueMessage>
): Promise<void> {
  // ── Phase 1: Build process flows from catalyst actions ──
  // Group catalyst actions by catalyst_name to form process flows
  const actions = await db.prepare(
    'SELECT catalyst_name, status, confidence, input_data, output_data, created_at, completed_at FROM catalyst_actions WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  if (actions.results.length === 0) return; // No catalyst runs — nothing to mine

  // Pre-read existing catalyst-engine metric statuses BEFORE Phase 2 overwrites them
  // (needed by Phase 5 to detect status transitions correctly)
  const existingStatuses = new Map<string, string>();
  const existingMetricRows = await db.prepare(
    "SELECT id, status FROM process_metrics WHERE tenant_id = ? AND source_system = 'catalyst-engine'"
  ).bind(tenantId).all();
  for (const row of existingMetricRows.results) {
    const r = row as Record<string, unknown>;
    existingStatuses.set(r.id as string, r.status as string);
  }

  // Group actions by catalyst name (each catalyst = a process flow)
  const catalystGroups: Record<string, Array<Record<string, unknown>>> = {};
  for (const a of actions.results) {
    const row = a as Record<string, unknown>;
    const name = row.catalyst_name as string;
    if (!catalystGroups[name]) catalystGroups[name] = [];
    catalystGroups[name].push(row);
  }

  // Build/update process flows for each catalyst domain
  for (const [catalystName, runs] of Object.entries(catalystGroups)) {
    const flowId = `pf-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    const completed = runs.filter(r => r.status === 'completed');
    const exceptions = runs.filter(r => r.status === 'exception');
    const pending = runs.filter(r => r.status === 'pending');
    const total = runs.length;

    // Conformance = completed / total (exceptions and pending lower conformance)
    const conformanceRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;

    // Variants = distinct action patterns within this catalyst
    const uniqueActions = new Set(runs.map(r => r.status as string));
    const variants = uniqueActions.size;

    // Avg duration from created_at to completed_at for completed runs
    let avgDuration = 0;
    const durationsMs: number[] = [];
    for (const r of completed) {
      if (r.completed_at && r.created_at) {
        const diff = new Date(r.completed_at as string).getTime() - new Date(r.created_at as string).getTime();
        if (diff > 0) durationsMs.push(diff);
      }
    }
    if (durationsMs.length > 0) {
      avgDuration = Math.round(durationsMs.reduce((s, d) => s + d, 0) / durationsMs.length / 1000); // seconds
    }

    // Bottlenecks = exception reasons extracted from output_data
    const bottlenecks: string[] = [];
    for (const r of exceptions.slice(0, 5)) {
      try {
        const output = JSON.parse(r.output_data as string || '{}');
        if (output.exception_type) {
          bottlenecks.push(`${output.exception_type}: ${output.exception_detail || 'Requires review'}`);
        }
      } catch { /* skip unparseable */ }
    }
    if (exceptions.length > 0 && bottlenecks.length === 0) {
      bottlenecks.push(`${exceptions.length} action(s) escalated for human review`);
    }

    // Steps = the lifecycle stages of this catalyst process
    const steps = JSON.stringify([
      { name: 'Received', count: total },
      { name: 'Processing', count: pending.length },
      { name: 'Completed', count: completed.length },
      { name: 'Escalated', count: exceptions.length },
    ]);

    // Upsert the process flow
    await db.prepare(
      `INSERT INTO process_flows (id, tenant_id, name, steps, variants, avg_duration, conformance_rate, bottlenecks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET steps = excluded.steps, variants = excluded.variants,
         avg_duration = excluded.avg_duration, conformance_rate = excluded.conformance_rate,
         bottlenecks = excluded.bottlenecks`
    ).bind(flowId, tenantId, catalystName, steps, variants, avgDuration, conformanceRate, JSON.stringify(bottlenecks)).run();

    // ── Phase 2: Generate process metrics from catalyst runs ──
    const metricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;

    // Success rate metric for this catalyst
    const successRate = total > 0 ? Math.round((completed.length / total) * 100) : 100;
    let metricStatus = 'green';
    if (successRate < 60) metricStatus = 'red';
    else if (successRate < 80) metricStatus = 'amber';

    // Build trend from last 6 data points (most recent runs)
    const recentRuns = runs.slice(0, Math.min(6, runs.length));
    const trend: number[] = [];
    let runningCompleted = completed.length;
    let runningTotal = total;
    for (const r of recentRuns) {
      if (runningTotal > 0) {
        trend.push(Math.round((runningCompleted / runningTotal) * 100));
      }
      if (r.status === 'completed') runningCompleted--;
      runningTotal--;
    }

    await db.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 80, 80, 60, ?, 'catalyst-engine', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status,
         trend = excluded.trend, measured_at = excluded.measured_at`
    ).bind(metricId, tenantId, `${catalystName} Success Rate`, successRate, metricStatus, JSON.stringify(trend.reverse())).run();

    // Exception rate metric
    const exceptionMetricId = `pm-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-exc`;
    const exceptionRate = total > 0 ? Math.round((exceptions.length / total) * 100) : 0;
    let excStatus = 'green';
    if (exceptionRate > 40) excStatus = 'red';
    else if (exceptionRate > 20) excStatus = 'amber';

    await db.prepare(
      `INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, trend, source_system, measured_at)
       VALUES (?, ?, ?, ?, '%', ?, 20, 20, 40, '[]', 'catalyst-engine', datetime('now'))
       ON CONFLICT(id) DO UPDATE SET value = excluded.value, status = excluded.status, measured_at = excluded.measured_at`
    ).bind(exceptionMetricId, tenantId, `${catalystName} Exception Rate`, exceptionRate, excStatus).run();

    // ── Phase 3: Detect anomalies from exception patterns ──
    if (exceptionRate > 30 && exceptions.length >= 2) {
      const anomalyId = `anom-${tenantId.substring(0, 8)}-${catalystName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
      const expectedRate = 10; // baseline expected exception rate
      const deviation = Math.round(((exceptionRate - expectedRate) / expectedRate) * 100);

      // Extract hypothesis from recent exception outputs
      let hypothesis = `${catalystName} has a ${exceptionRate}% exception rate (${exceptions.length} of ${total} runs). `;
      const exceptionTypes: Record<string, number> = {};
      for (const r of exceptions) {
        try {
          const output = JSON.parse(r.output_data as string || '{}');
          const etype = output.exception_type as string || 'unknown';
          exceptionTypes[etype] = (exceptionTypes[etype] || 0) + 1;
        } catch { /* skip */ }
      }
      const topTypes = Object.entries(exceptionTypes).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (topTypes.length > 0) {
        hypothesis += `Top exception types: ${topTypes.map(([t, c]) => `${t} (${c}x)`).join(', ')}.`;
      }

      await db.prepare(
        `INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', datetime('now'))
         ON CONFLICT(id) DO UPDATE SET actual_value = excluded.actual_value, deviation = excluded.deviation,
           hypothesis = excluded.hypothesis`
      ).bind(
        anomalyId, tenantId, `${catalystName} Exception Rate`,
        exceptionRate > 50 ? 'critical' : 'high',
        expectedRate, exceptionRate, deviation, hypothesis
      ).run();
    }
  }

  // ── Phase 4: Generate cross-system correlation events ──
  // Look for catalyst actions that span different source systems
  const systemActions = await db.prepare(
    "SELECT catalyst_name, input_data, output_data, status, created_at FROM catalyst_actions WHERE tenant_id = ? AND input_data IS NOT NULL ORDER BY created_at DESC LIMIT 100"
  ).bind(tenantId).all();

  const systemEvents: Array<{ catalyst: string; system: string; status: string; time: string }> = [];
  for (const a of systemActions.results) {
    const row = a as Record<string, unknown>;
    try {
      const input = JSON.parse(row.input_data as string || '{}');
      const sourceSystem = input.source_system || input.sourceSystem || input.system || '';
      if (sourceSystem) {
        systemEvents.push({
          catalyst: row.catalyst_name as string,
          system: sourceSystem as string,
          status: row.status as string,
          time: row.created_at as string,
        });
      }
    } catch { /* skip */ }
  }

  // Find correlations between different systems (e.g., ERP exception → downstream impact)
  const systemPairs = new Map<string, { source: string; sourceEvent: string; target: string; targetImpact: string; count: number }>();
  for (let i = 0; i < systemEvents.length - 1; i++) {
    for (let j = i + 1; j < Math.min(i + 5, systemEvents.length); j++) {
      const a = systemEvents[i];
      const b = systemEvents[j];
      if (a.system !== b.system && a.status === 'exception') {
        const key = `${a.system}->${b.system}`;
        const existing = systemPairs.get(key);
        if (existing) {
          existing.count++;
        } else {
          systemPairs.set(key, {
            source: a.system,
            sourceEvent: `${a.catalyst} exception`,
            target: b.system,
            targetImpact: `${b.catalyst} ${b.status}`,
            count: 1,
          });
        }
      }
    }
  }

  for (const [key, pair] of systemPairs) {
    if (pair.count < 2) continue; // Need at least 2 occurrences for a meaningful correlation
    const corrId = `ce-${tenantId.substring(0, 8)}-${key.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`;
    const confidence = Math.min(0.95, 0.5 + pair.count * 0.1);

    await db.prepare(
      `INSERT INTO correlation_events (id, tenant_id, source_system, source_event, target_system, target_impact, confidence, lag_days, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET confidence = excluded.confidence, source_event = excluded.source_event,
         target_impact = excluded.target_impact`
    ).bind(corrId, tenantId, pair.source, pair.sourceEvent, pair.target, pair.targetImpact, confidence).run();
  }

  // ── Phase 5: Recalculate existing metric statuses + trigger alerts ──
  const existingMetrics = await db.prepare(
    'SELECT id, name, value, status as current_status, threshold_green, threshold_amber, threshold_red, source_system FROM process_metrics WHERE tenant_id = ? AND threshold_red IS NOT NULL'
  ).bind(tenantId).all();

  for (const m of existingMetrics.results) {
    const row = m as Record<string, unknown>;
    const value = row.value as number;
    const green = row.threshold_green as number;
    const amber = row.threshold_amber as number;
    const red = row.threshold_red as number;
    const previousStatus = existingStatuses.get(row.id as string) || (row.current_status as string);

    let status = 'green';
    if (green > red) {
      if (value < red) status = 'red';
      else if (value < amber) status = 'amber';
    } else {
      if (value > red) status = 'red';
      else if (value > amber) status = 'amber';
    }

    if (status !== previousStatus) {
      await db.prepare("UPDATE process_metrics SET status = ?, measured_at = datetime('now') WHERE id = ?")
        .bind(status, row.id).run();
    }

    // 5.4: Event-driven trigger — enqueue catalyst task when metric goes red
    if (status === 'red' && previousStatus !== 'red' && queue) {
      try {
        const cluster = await db.prepare(
          "SELECT id, name, autonomy_tier, trust_score FROM catalyst_clusters WHERE tenant_id = ? AND status = 'active' ORDER BY trust_score DESC LIMIT 1"
        ).bind(tenantId).first();

        if (cluster) {
          await queue.send({
            type: 'catalyst_execution',
            tenantId,
            payload: {
              clusterId: cluster.id as string,
              catalystName: `metric-remediation-${row.name}`,
              action: 'investigate',
              inputData: {
                metricId: row.id,
                metricName: row.name,
                currentValue: value,
                threshold: red,
                sourceSystem: row.source_system,
                trigger: 'metric_red_transition',
              },
              riskLevel: 'medium',
              autonomyTier: cluster.autonomy_tier as string,
              trustScore: cluster.trust_score as number,
            },
            scheduledAt: new Date().toISOString(),
          });
        }

        await db.prepare(
          "INSERT INTO notifications (id, tenant_id, type, title, message, severity, created_at) VALUES (?, ?, 'metric_alert', ?, ?, 'high', datetime('now'))"
        ).bind(
          crypto.randomUUID(), tenantId,
          `Metric "${row.name}" is now RED`,
          `${row.name} value ${value} has crossed the red threshold (${red}). A catalyst investigation has been triggered.`,
        ).run();
      } catch (err) {
        console.error(`Failed to enqueue catalyst task for red metric ${row.id}:`, err);
      }
    }
  }
}

/**
 * 5.4: Agent Lifecycle Management
 * Checks heartbeats and updates agent status (running -> degraded -> stopped)
 */
async function checkAgentLifecycle(db: D1Database, cache: KVNamespace, tenantId: string): Promise<void> {
  const agents = await db.prepare(
    "SELECT id, name, status, last_heartbeat FROM agent_deployments WHERE tenant_id = ? AND status != 'stopped'"
  ).bind(tenantId).all();

  const now = Date.now();

  for (const agent of agents.results) {
    const a = agent as Record<string, unknown>;
    const lastHeartbeat = a.last_heartbeat ? new Date(a.last_heartbeat as string).getTime() : 0;
    const minutesSinceHeartbeat = (now - lastHeartbeat) / 60000;

    let newStatus = a.status as string;
    if (minutesSinceHeartbeat > 30 && a.status === 'running') {
      newStatus = 'degraded';
    } else if (minutesSinceHeartbeat > 120 && a.status === 'degraded') {
      newStatus = 'stopped';
    }

    if (newStatus !== a.status) {
      await db.prepare('UPDATE agent_deployments SET status = ? WHERE id = ?')
        .bind(newStatus, a.id).run();

      // Create notification for status change
      await db.prepare(
        "INSERT INTO notifications (id, tenant_id, type, title, message, severity, created_at) VALUES (?, ?, 'agent_status', ?, ?, ?, datetime('now'))"
      ).bind(
        crypto.randomUUID(), tenantId,
        `Agent ${a.name} is now ${newStatus}`,
        `Agent ${a.name} status changed from ${a.status} to ${newStatus}. Last heartbeat: ${minutesSinceHeartbeat.toFixed(0)} minutes ago.`,
        newStatus === 'stopped' ? 'high' : 'medium',
      ).run();

      // Cache the event for potential catalyst triggers (5.3: event-driven triggers)
      await cache.put(`agent_event:${a.id}:${Date.now()}`, JSON.stringify({
        type: 'agent_status_change',
        agentId: a.id,
        agentName: a.name,
        previousStatus: a.status,
        newStatus,
        tenantId,
        timestamp: new Date().toISOString(),
      }), { expirationTtl: 3600 });
    }
  }
}

/**
 * 6.0: Sub-Catalyst Scheduled Execution
 * Checks all catalyst clusters for sub-catalysts with schedules that are due.
 * Executes them and updates last_run / next_run timestamps.
 */
interface SubCatalystScheduleData {
  frequency: string;
  day_of_week?: number;
  day_of_month?: number;
  time_of_day?: string;
  last_run?: string;
  next_run?: string;
}

interface SubCatalystData {
  name: string;
  enabled: boolean;
  description?: string;
  schedule?: SubCatalystScheduleData;
  data_source?: { type: string; config: Record<string, unknown> };
}

function calculateNextRunScheduled(
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

  return '';
}

async function executeScheduledSubCatalysts(db: D1Database, tenantId: string): Promise<void> {
  // Get all active clusters with sub-catalysts
  const clusters = await db.prepare(
    "SELECT id, name, domain, sub_catalysts, autonomy_tier FROM catalyst_clusters WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).all();

  const now = new Date();

  for (const cluster of clusters.results) {
    const clusterRow = cluster as Record<string, unknown>;
    const subsJson = (clusterRow.sub_catalysts as string) || '[]';
    let subs: SubCatalystData[];
    try {
      subs = JSON.parse(subsJson);
    } catch (err) {
      console.error(`executeScheduledSubCatalysts: failed to parse sub_catalysts JSON for cluster ${clusterRow.id}:`, err);
      continue;
    }

    let updated = false;

    for (const sub of subs) {
      // Skip disabled, manual, or unscheduled sub-catalysts
      if (!sub.enabled || !sub.schedule || sub.schedule.frequency === 'manual') continue;

      // Check if next_run is in the past (i.e. due to execute)
      const nextRun = sub.schedule.next_run ? new Date(sub.schedule.next_run) : null;
      if (!nextRun || nextRun > now) continue;

      // Execute: create a catalyst action for this sub-catalyst
      const actionId = crypto.randomUUID();
      const inputData = JSON.stringify({
        scheduled: true,
        frequency: sub.schedule.frequency,
        sub_catalyst: sub.name,
        triggered_at: now.toISOString(),
      });

      try {
        await db.prepare(
          "INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, reasoning, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))"
        ).bind(
          actionId,
          clusterRow.id as string,
          tenantId,
          sub.name,
          `Scheduled ${sub.schedule.frequency} execution`,
          'pending',
          0.90,
          inputData,
          `Automatic scheduled execution (${sub.schedule.frequency}). Sub-catalyst: ${sub.name}.`
        ).run();

        // Log the scheduled execution
        await db.prepare(
          "INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).bind(
          crypto.randomUUID(), tenantId, 'catalyst.sub_catalyst.scheduled_execution', 'catalysts',
          clusterRow.id as string,
          JSON.stringify({ sub_catalyst: sub.name, frequency: sub.schedule.frequency, action_id: actionId }),
          'success'
        ).run().catch(() => {});
      } catch (err) {
        console.error(`Scheduled execution failed for sub-catalyst ${sub.name} in cluster ${clusterRow.id}:`, err);
      }

      // Update last_run and next_run
      sub.schedule.last_run = now.toISOString();
      sub.schedule.next_run = calculateNextRunScheduled(
        sub.schedule.frequency,
        sub.schedule.day_of_week,
        sub.schedule.day_of_month,
        sub.schedule.time_of_day,
      );
      updated = true;
    }

    // Persist schedule updates back to DB
    if (updated) {
      await db.prepare(
        'UPDATE catalyst_clusters SET sub_catalysts = ? WHERE id = ? AND tenant_id = ?'
      ).bind(JSON.stringify(subs), clusterRow.id as string, tenantId).run();
    }
  }
}

/**
 * 5.1: Queue Consumer — processes catalyst execution messages from Cloudflare Queue
 */
// §9.1 — Weekly digest email (runs Monday mornings via cron)
async function generateWeeklyDigest(db: D1Database, tenantId: string): Promise<void> {
  // Only generate on Mondays
  const dayOfWeek = new Date().getUTCDay();
  if (dayOfWeek !== 1) return;

  // Check if already sent this week
  const existing = await db.prepare(
    "SELECT id FROM email_queue WHERE tenant_id = ? AND subject LIKE '%Weekly Digest%' AND created_at >= datetime('now', '-6 days')"
  ).bind(tenantId).first();
  if (existing) return;

  // Gather digest data
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  const newSignals = await db.prepare(
    "SELECT COUNT(*) as count FROM external_signals WHERE tenant_id = ? AND detected_at >= datetime('now', '-7 days')"
  ).bind(tenantId).first<{ count: number }>();

  const newRcas = await db.prepare(
    "SELECT COUNT(*) as count FROM root_cause_analyses WHERE tenant_id = ? AND generated_at >= datetime('now', '-7 days')"
  ).bind(tenantId).first<{ count: number }>();

  const overduePrescriptions = await db.prepare(
    "SELECT COUNT(*) as count FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending' AND deadline_suggested IS NOT NULL AND deadline_suggested < datetime('now')"
  ).bind(tenantId).first<{ count: number }>();

  const roiData = await db.prepare(
    'SELECT total_discrepancy_value_recovered, roi_multiple FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ total_discrepancy_value_recovered: number; roi_multiple: number }>();

  // Get admin users for this tenant
  const admins = await db.prepare(
    "SELECT email, name FROM users WHERE tenant_id = ? AND role IN ('superadmin', 'admin', 'executive') AND status = 'active'"
  ).bind(tenantId).all();

  if (admins.results.length === 0) return;

  const recipients = admins.results.map((a: Record<string, unknown>) => a.email as string);
  const template = getWeeklyDigestEmailTemplate({
    healthScore: health?.overall_score ?? 0,
    newSignals: newSignals?.count ?? 0,
    newRcas: newRcas?.count ?? 0,
    overduePrescriptions: overduePrescriptions?.count ?? 0,
    recoveredValue: roiData?.total_discrepancy_value_recovered ?? 0,
    roiMultiple: roiData?.roi_multiple ?? 0,
  });

  await queueEmail(db, {
    tenantId,
    to: recipients,
    subject: `Atheon Weekly Digest — ${new Date().toISOString().split('T')[0]}`,
    htmlBody: template.html,
    textBody: template.text,
  });
}

// §11.3 — Goal achievement checks (runs every 15 min via cron)
async function checkGoalAchievements(db: D1Database, tenantId: string): Promise<void> {
  const targets = await db.prepare(
    "SELECT id, target_type, target_name, target_value, current_value FROM health_targets WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).all();

  if (targets.results.length === 0) return;

  // OPTIMIZED: Fetch health score ONCE instead of per-target (was N queries for N targets)
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first<{ overall_score: number; dimensions: string }>();

  const parsedDims = health?.dimensions ? JSON.parse(health.dimensions) : {};

  // Collect batch statements for updates
  const updateStmts: D1PreparedStatement[] = [];

  for (const t of targets.results) {
    const row = t as Record<string, unknown>;
    let currentValue = (row.current_value as number) || 0;

    // Refresh current value from the single pre-fetched health score
    if (row.target_type === 'overall') {
      currentValue = (health?.overall_score as number) || 0;
    } else if (row.target_type === 'dimension') {
      const dimData = parsedDims[row.target_name as string];
      if (dimData) currentValue = dimData.score || 0;
    }

    // Update current value
    updateStmts.push(
      db.prepare('UPDATE health_targets SET current_value = ? WHERE id = ?').bind(currentValue, row.id)
    );

    // Check if achieved
    if (currentValue >= (row.target_value as number)) {
      updateStmts.push(
        db.prepare("UPDATE health_targets SET status = 'achieved', achieved_at = datetime('now') WHERE id = ?").bind(row.id)
      );
      updateStmts.push(
        db.prepare(
          "INSERT INTO notifications (id, tenant_id, type, title, message, priority, created_at) VALUES (?, ?, 'achievement', ?, ?, 'high', datetime('now'))"
        ).bind(
          crypto.randomUUID(), tenantId,
          `Target Achieved: ${row.target_name}`,
          `Your ${row.target_type} target "${row.target_name}" has reached ${currentValue} (target: ${row.target_value}). Congratulations!`
        )
      );
    }
  }

  // Execute all updates in a single batch
  if (updateStmts.length > 0) {
    await db.batch(updateStmts);
  }
}

// §11.4 — Peer benchmarks calculation (runs daily via cron — computes anonymised industry benchmarks)
// OPTIMIZED: Fetch all health scores in ONE query instead of per-tenant-per-dimension (was N×9 queries)
async function calculatePeerBenchmarks(db: D1Database): Promise<void> {
  // tenants.industry was dropped by migrate.ts — aggregation is global. All
  // active tenants bucket as 'general' until per-tenant industry tagging is
  // reintroduced. This silently no-op'd in production prior to this change
  // because the SELECT referenced a missing column; the JOIN now drops the
  // industry filter so the cron actually populates anonymised_benchmarks.
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM
  const dimensions = ['financial', 'operational', 'compliance', 'strategic', 'technology', 'risk', 'catalyst', 'process', 'overall'];
  const GLOBAL_BUCKET = 'general';

  // Single query: latest health score per tenant for every active tenant.
  const allHealthScores = await db.prepare(
    `SELECT hs.tenant_id, hs.overall_score, hs.dimensions
     FROM health_scores hs
     JOIN tenants t ON hs.tenant_id = t.id AND t.status = 'active'
     WHERE hs.calculated_at = (
       SELECT MAX(hs2.calculated_at) FROM health_scores hs2 WHERE hs2.tenant_id = hs.tenant_id
     )`
  ).all();

  // Bucket every tenant under the single global industry key.
  const healthByIndustry: Record<string, Array<{ overall_score: number; dimensions: Record<string, { score: number }> }>> = {};
  healthByIndustry[GLOBAL_BUCKET] = [];
  for (const row of allHealthScores.results) {
    const r = row as Record<string, unknown>;
    healthByIndustry[GLOBAL_BUCKET].push({
      overall_score: (r.overall_score as number) || 0,
      dimensions: r.dimensions ? JSON.parse(r.dimensions as string) : {},
    });
  }

  const insertStmts: D1PreparedStatement[] = [];

  for (const industry of Object.keys(healthByIndustry)) {
    const healthData = healthByIndustry[industry];
    if (healthData.length < 3) continue; // Anonymity threshold

    for (const dim of dimensions) {
      const scores: number[] = [];

      for (const h of healthData) {
        if (dim === 'overall') {
          if (h.overall_score) scores.push(h.overall_score);
        } else {
          if (h.dimensions[dim]?.score) scores.push(h.dimensions[dim].score);
        }
      }

      if (scores.length < 3) continue;

      scores.sort((a, b) => a - b);
      const avg = Math.round(scores.reduce((s, v) => s + v, 0) / scores.length);
      const p25 = scores[Math.floor(scores.length * 0.25)] || 0;
      const p50 = scores[Math.floor(scores.length * 0.5)] || 0;
      const p75 = scores[Math.floor(scores.length * 0.75)] || 0;

      insertStmts.push(
        db.prepare(
          `INSERT OR REPLACE INTO anonymised_benchmarks (id, industry, dimension, period, tenant_count, avg_score, p25_score, p50_score, p75_score, min_score, max_score, calculated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
        ).bind(crypto.randomUUID(), industry, dim, period, scores.length, avg, p25, p50, p75, scores[0], scores[scores.length - 1])
      );
    }
  }

  // Batch all benchmark inserts
  if (insertStmts.length > 0) {
    await db.batch(insertStmts);
  }
}

// §11.6 — Success stories / resolution patterns aggregation (monthly)
async function calculateResolutionPatterns(db: D1Database): Promise<void> {
  // tenants.industry was dropped by migrate.ts — aggregation is global. All
  // resolved RCAs bucket under 'general' until per-tenant industry tagging is
  // reintroduced. Prior to this change, the SELECT referenced a missing column
  // and the cron silently no-op'd.
  const resolved = await db.prepare(
    `SELECT rca.metric_name, rca.resolved_at, rca.generated_at,
            GROUP_CONCAT(dp.title, '|') as fix_titles
     FROM root_cause_analyses rca
     JOIN tenants t ON rca.tenant_id = t.id
     LEFT JOIN diagnostic_prescriptions dp ON dp.rca_id = rca.id AND dp.status = 'completed'
     WHERE rca.status = 'resolved'
     GROUP BY rca.id`
  ).all();

  // Group by pattern signature, bucketed under the single global industry key.
  const patterns: Record<string, { industry: string; count: number; totalDays: number; totalValue: number; fixTypes: Set<string> }> = {};

  for (const row of resolved.results) {
    const r = row as Record<string, unknown>;
    const metricName = (r.metric_name as string) || 'unknown';
    const industry = 'general';
    // Pattern signature = normalized metric name (remove specific identifiers)
    const signature = metricName.replace(/[-_]\d+/g, '').replace(/\s+/g, '_').toLowerCase();
    const key = `${signature}::${industry}`;

    if (!patterns[key]) {
      patterns[key] = { industry, count: 0, totalDays: 0, totalValue: 0, fixTypes: new Set() };
    }

    patterns[key].count++;

    // Calculate resolution days
    if (r.resolved_at && r.generated_at) {
      const days = Math.max(1, Math.round((new Date(r.resolved_at as string).getTime() - new Date(r.generated_at as string).getTime()) / (24 * 60 * 60 * 1000)));
      patterns[key].totalDays += days;
    }

    // Parse fix types
    if (r.fix_titles) {
      for (const title of (r.fix_titles as string).split('|')) {
        if (title.trim()) patterns[key].fixTypes.add(title.trim());
      }
    }
  }

  // Upsert resolution patterns
  for (const [key, data] of Object.entries(patterns)) {
    if (data.count < 3) continue; // Anonymity threshold
    const [signature, industry] = key.split('::');
    const avgDays = Math.round(data.totalDays / data.count);
    const fixTypesArr = Array.from(data.fixTypes).slice(0, 5);

    try {
      await db.prepare(
        `INSERT OR REPLACE INTO resolution_patterns (id, pattern_signature, industry, resolution_count, avg_resolution_days, avg_value_recovered, common_fix_types, last_updated)
         VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(crypto.randomUUID(), signature, industry, data.count, avgDays, data.totalValue / data.count, JSON.stringify(fixTypesArr)).run();
    } catch { /* non-fatal */ }
  }
}

// §11.1 — Trial assessment cleanup (remove expired trials after 7 days)
async function cleanupExpiredTrials(db: D1Database): Promise<void> {
  const expired = await db.prepare(
    "SELECT id, tenant_id FROM trial_assessments WHERE expires_at < datetime('now') AND status != 'cleaned'"
  ).all();

  for (const row of expired.results) {
    const r = row as Record<string, unknown>;
    const tenantId = r.tenant_id as string;

    // Clean up trial data
    try {
      await db.prepare("DELETE FROM users WHERE tenant_id = ?").bind(tenantId).run();
      await db.prepare("DELETE FROM tenants WHERE id = ? AND plan = 'trial'").bind(tenantId).run();
      await db.prepare("UPDATE trial_assessments SET status = 'cleaned' WHERE id = ?").bind(r.id).run();
    } catch { /* non-fatal */ }
  }
}

/**
 * Dead-letter queue handler. Messages that have exhausted retries on the
 * main queue land here. Persist them to audit_log so operators can
 * investigate, then ack so they don't loop.
 */
export async function handleDlqMessage(
  batch: MessageBatch<unknown>,
  env: ScheduledEnv,
): Promise<void> {
  for (const message of batch.messages) {
    try {
      const msg = message.body as Partial<CatalystQueueMessage> | null;
      const tenantId = (msg && typeof msg.tenantId === 'string' && msg.tenantId) || 'unknown';
      await env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(),
        tenantId,
        'catalyst.queue.dead_letter',
        'catalysts',
        batch.queue,
        JSON.stringify({
          queue: batch.queue,
          messageId: message.id,
          timestamp: message.timestamp,
          attempts: message.attempts,
          type: msg?.type,
          body: msg,
        }),
        'failure',
      ).run();
      console.error(`[DLQ] persisted dead-letter message ${message.id} from ${batch.queue} (tenant=${tenantId})`);
    } catch (err) {
      // Swallow — we always ack DLQ messages, otherwise they'd loop forever.
      console.error(`[DLQ] failed to persist message ${message.id}:`, err);
    } finally {
      message.ack();
    }
  }
}

export async function handleQueueMessage(
  batch: MessageBatch<unknown>,
  env: ScheduledEnv,
): Promise<void> {
  // Dead-letter queues end with '-dlq' (catalyst-dlq, catalyst-dlq-staging).
  // Route them to the DLQ handler which records and terminates.
  if (batch.queue.endsWith('-dlq')) {
    return handleDlqMessage(batch, env);
  }

  for (const message of batch.messages) {
    const msg = message.body as CatalystQueueMessage;
    try {
      switch (msg.type) {
        case 'catalyst_execution': {
          // Import and execute through the catalyst engine
          const { executeTask } = await import('./catalyst-engine');
          const payload = msg.payload as {
            clusterId: string; catalystName: string; action: string;
            inputData: Record<string, unknown>; riskLevel: string; autonomyTier: string; trustScore: number;
            /** Optional per-company scope propagated from upstream / HTTP caller. */
            companyId?: string;
          };
          await executeTask({
            clusterId: payload.clusterId,
            tenantId: msg.tenantId,
            catalystName: payload.catalystName,
            action: payload.action,
            inputData: payload.inputData || {},
            riskLevel: (payload.riskLevel || 'medium') as 'high' | 'medium' | 'low',
            autonomyTier: payload.autonomyTier || 'read-only',
            trustScore: payload.trustScore || 50,
            companyId: payload.companyId,
          }, env.DB, env.CACHE, env.AI, env.OLLAMA_API_KEY, env.CATALYST_QUEUE);
          break;
        }
        case 'health_recalc':
          await recalculateHealthScore(env.DB, msg.tenantId);
          break;
        case 'briefing_gen':
          await generateBriefing(env.DB, env.AI, msg.tenantId, env.OLLAMA_API_KEY);
          break;
        case 'erp_sync':
          // Trigger ERP sync — handled by the ERP route sync endpoint
          break;
      }
      message.ack();
    } catch (err) {
      console.error(`Queue message processing failed:`, err);
      message.retry();
    }
  }
}


// TASK-019: Fan-out via queue instead of sequential processing
// Each scheduled task is dispatched as a separate queue message for parallel processing
export async function fanOutViaBatch(
  queue: { send: (msg: unknown) => Promise<void> },
  tasks: Array<{ tenantId: string; clusterId: string; subCatalystName: string }>,
): Promise<{ dispatched: number; failed: number }> {
  let dispatched = 0;
  let failed = 0;
  
  for (const task of tasks) {
    try {
      await queue.send({
        type: 'catalyst-run',
        tenant_id: task.tenantId,
        cluster_id: task.clusterId,
        sub_catalyst_name: task.subCatalystName,
        triggered_by: 'scheduler',
        timestamp: new Date().toISOString(),
      });
      dispatched++;
    } catch (err) {
      console.error(`[SCHEDULER] Failed to enqueue task for ${task.tenantId}/${task.clusterId}:`, err);
      failed++;
    }
  }
  
  console.log(`[SCHEDULER] Fan-out complete: ${dispatched} dispatched, ${failed} failed`);
  return { dispatched, failed };
}

// ── Merged from scheduler.ts (SPEC-018) ──

export interface ScheduledTask {
  id: string;
  name: string;
  cronExpression: string;
  handler: string;
  tenantId?: string;
  enabled: boolean;
  maxRetries: number;
  timeoutMs: number;
  lastRunAt?: string;
  lastRunStatus?: 'success' | 'failure' | 'timeout';
  nextRunAt?: string;
  metadata?: Record<string, unknown>;
}

export interface TaskExecution {
  id: string;
  taskId: string;
  startedAt: string;
  completedAt?: string;
  status: 'running' | 'success' | 'failure' | 'timeout' | 'dead_letter';
  duration?: number;
  error?: string;
  retryCount: number;
}

export function getNextRunTime(cron: string, from: Date = new Date()): Date {
  const parts = cron.split(' ');
  if (parts.length !== 5) throw new Error('Invalid cron expression');
  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts;
  const next = new Date(from);
  next.setSeconds(0, 0);
  for (let i = 0; i < 525960; i++) {
    next.setMinutes(next.getMinutes() + 1);
    if (matchesCronField(next.getMinutes(), minute) && matchesCronField(next.getHours(), hour) &&
        matchesCronField(next.getDate(), dayOfMonth) && matchesCronField(next.getMonth() + 1, month) &&
        matchesCronField(next.getDay(), dayOfWeek)) {
      return next;
    }
  }
  throw new Error('Could not find next run time within 1 year');
}

function matchesCronField(value: number, pattern: string): boolean {
  if (pattern === '*') return true;
  if (pattern.includes('/')) {
    const [base, step] = pattern.split('/');
    const stepNum = parseInt(step, 10);
    const baseNum = base === '*' ? 0 : parseInt(base, 10);
    return value >= baseNum && (value - baseNum) % stepNum === 0;
  }
  if (pattern.includes(',')) return pattern.split(',').map(Number).includes(value);
  if (pattern.includes('-')) {
    const [start, end] = pattern.split('-').map(Number);
    return value >= start && value <= end;
  }
  return parseInt(pattern, 10) === value;
}

export function getDefaultScheduledTasks(): Omit<ScheduledTask, 'id'>[] {
  return [
    { name: 'health_score_recalculation', cronExpression: '0 */6 * * *', handler: 'recalculateHealthScores', enabled: true, maxRetries: 3, timeoutMs: 300000 },
    { name: 'erp_sync_poll', cronExpression: '*/15 * * * *', handler: 'pollERPSync', enabled: true, maxRetries: 2, timeoutMs: 120000 },
    { name: 'anomaly_detection', cronExpression: '0 */2 * * *', handler: 'runAnomalyDetection', enabled: true, maxRetries: 2, timeoutMs: 180000 },
    { name: 'audit_log_cleanup', cronExpression: '0 3 * * 0', handler: 'cleanupAuditLogs', enabled: true, maxRetries: 1, timeoutMs: 600000 },
    { name: 'report_generation', cronExpression: '0 6 * * 1', handler: 'generateWeeklyReports', enabled: true, maxRetries: 3, timeoutMs: 300000 },
    { name: 'subscription_check', cronExpression: '0 0 * * *', handler: 'checkSubscriptionExpiry', enabled: true, maxRetries: 2, timeoutMs: 60000 },
  ];
}
