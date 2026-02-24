/**
 * Scheduled Handler — Cron Triggers for Atheon
 * Handles: health recalculation, executive briefings, memory auto-population, process mining, agent lifecycle
 */

import type { Env } from '../types';

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

  // Get all active tenants
  const tenants = await db.prepare(
    "SELECT id, slug FROM tenants WHERE status = 'active'"
  ).all();

  for (const tenant of tenants.results) {
    const tenantId = tenant.id as string;

    try {
      // 3.6: Health score recalculation
      await recalculateHealthScore(db, tenantId);

      // 3.7: Executive briefing generation
      await generateBriefing(db, env.AI, tenantId);

      // 3.8: Memory auto-population from ERP data
      await autoPopulateMemory(db, tenantId);

      // 3.9: Process mining refresh + 5.4: event-driven catalyst triggers
      await refreshProcessMining(db, tenantId, env.CATALYST_QUEUE);

      // 5.4: Agent lifecycle — heartbeat check & status updates
      await checkAgentLifecycle(db, cache, tenantId);
    } catch (err) {
      console.error(`Scheduled tasks failed for tenant ${tenantId}:`, err);
    }
  }
}

/**
 * 3.6: Health Score Recalculation
 * Aggregates metrics from all layers into a composite health score
 */
async function recalculateHealthScore(db: D1Database, tenantId: string): Promise<void> {
  // Gather dimension data
  const metrics = await db.prepare(
    "SELECT status, COUNT(*) as count FROM process_metrics WHERE tenant_id = ? GROUP BY status"
  ).bind(tenantId).all();

  const risks = await db.prepare(
    "SELECT severity, COUNT(*) as count FROM risk_alerts WHERE tenant_id = ? AND status = 'active' GROUP BY severity"
  ).bind(tenantId).all();

  const catalysts = await db.prepare(
    "SELECT AVG(success_rate) as avg_success, COUNT(*) as count FROM catalyst_clusters WHERE tenant_id = ? AND status = 'active'"
  ).bind(tenantId).first<{ avg_success: number | null; count: number }>();

  const anomalies = await db.prepare(
    "SELECT COUNT(*) as count FROM anomalies WHERE tenant_id = ? AND status = 'open'"
  ).bind(tenantId).first<{ count: number }>();

  // Calculate dimension scores
  const metricMap: Record<string, number> = {};
  for (const m of metrics.results) {
    metricMap[m.status as string] = m.count as number;
  }
  const totalMetrics = (metricMap['green'] || 0) + (metricMap['amber'] || 0) + (metricMap['red'] || 0);
  const operationalScore = totalMetrics > 0
    ? Math.round(((metricMap['green'] || 0) * 100 + (metricMap['amber'] || 0) * 50) / totalMetrics)
    : 75;

  const riskMap: Record<string, number> = {};
  for (const r of risks.results) {
    riskMap[r.severity as string] = r.count as number;
  }
  const riskPenalty = (riskMap['critical'] || 0) * 20 + (riskMap['high'] || 0) * 10 + (riskMap['medium'] || 0) * 5 + (riskMap['low'] || 0) * 2;
  const riskScore = Math.max(0, 100 - riskPenalty);

  const catalystScore = catalysts?.avg_success ?? 75;
  const anomalyPenalty = (anomalies?.count || 0) * 5;
  const processScore = Math.max(0, 100 - anomalyPenalty);

  // Weighted composite
  const overall = Math.round(operationalScore * 0.3 + riskScore * 0.25 + catalystScore * 0.25 + processScore * 0.2);

  const dimensions = {
    operational: { score: operationalScore, trend: operationalScore >= 70 ? 'improving' : 'declining' },
    risk: { score: riskScore, trend: riskScore >= 70 ? 'stable' : 'declining' },
    catalyst: { score: Math.round(catalystScore), trend: catalystScore >= 70 ? 'improving' : 'stable' },
    process: { score: processScore, trend: processScore >= 80 ? 'stable' : 'declining' },
  };

  await db.prepare(
    'INSERT INTO health_scores (id, tenant_id, overall_score, dimensions, calculated_at) VALUES (?, ?, ?, ?, datetime(\'now\'))'
  ).bind(crypto.randomUUID(), tenantId, overall, JSON.stringify(dimensions)).run();
}

/**
 * 3.7: Executive Briefing Generation
 * Creates daily briefing from latest health, risks, and catalyst data
 */
async function generateBriefing(db: D1Database, ai: Ai, tenantId: string): Promise<void> {
  // Check if we already generated a briefing today
  const existing = await db.prepare(
    "SELECT id FROM executive_briefings WHERE tenant_id = ? AND generated_at >= datetime('now', '-1 day')"
  ).bind(tenantId).first();
  if (existing) return;

  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

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
  const overallScore = (health?.overall_score as number) || 75;
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

  // Try AI-enhanced summary
  try {
    const aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
      messages: [
        { role: 'system', content: 'You are a concise executive briefing writer for an enterprise intelligence platform. Write a 2-3 sentence executive summary. Be specific with numbers.' },
        { role: 'user', content: `Health: ${overallScore}/100. Risks: ${risks.join('; ')}. KPIs: ${kpiMovements.join(', ')}. Pending: ${pendingApprovals?.count || 0} approvals.` },
      ],
      max_tokens: 256,
      temperature: 0.3,
    });
    const result = aiResult as { response?: string };
    if (result.response) summary = result.response;
  } catch {
    // Use fallback summary
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

  // Upsert customers as graph entities
  for (const cust of erpCustomers.results) {
    const c = cust as Record<string, unknown>;
    const existing = await db.prepare(
      "SELECT id FROM graph_entities WHERE tenant_id = ? AND type = 'customer' AND name = ? AND source = 'erp_sync'"
    ).bind(tenantId, c.name).first();
    if (!existing) {
      await db.prepare(
        'INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, 'customer', c.name, JSON.stringify({ group: c.customer_group, city: c.city, status: c.status, erpId: c.id }), 0.95, 'erp_sync').run();
    }
  }

  // Upsert suppliers
  for (const sup of erpSuppliers.results) {
    const s = sup as Record<string, unknown>;
    const existing = await db.prepare(
      "SELECT id FROM graph_entities WHERE tenant_id = ? AND type = 'supplier' AND name = ? AND source = 'erp_sync'"
    ).bind(tenantId, s.name).first();
    if (!existing) {
      await db.prepare(
        'INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, 'supplier', s.name, JSON.stringify({ group: s.supplier_group, city: s.city, status: s.status, erpId: s.id }), 0.95, 'erp_sync').run();
    }
  }

  // Upsert products
  for (const prod of erpProducts.results) {
    const p = prod as Record<string, unknown>;
    const existing = await db.prepare(
      "SELECT id FROM graph_entities WHERE tenant_id = ? AND type = 'product' AND name = ? AND source = 'erp_sync'"
    ).bind(tenantId, p.name).first();
    if (!existing) {
      await db.prepare(
        'INSERT INTO graph_entities (id, tenant_id, type, name, properties, confidence, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), tenantId, 'product', p.name, JSON.stringify({ category: p.category, sku: p.sku, erpId: p.id }), 0.95, 'erp_sync').run();
    }
  }
}

/**
 * 3.9: Process Mining Refresh
 * Recalculates process flow conformance rates and detects new anomalies
 * 5.4: Enqueues catalyst tasks when metrics transition to red
 */
async function refreshProcessMining(
  db: D1Database, tenantId: string, queue?: Queue<CatalystQueueMessage>
): Promise<void> {
  // Recalculate metric statuses based on thresholds
  const metrics = await db.prepare(
    'SELECT id, name, value, status as current_status, threshold_green, threshold_amber, threshold_red, source_system FROM process_metrics WHERE tenant_id = ? AND threshold_red IS NOT NULL'
  ).bind(tenantId).all();

  for (const m of metrics.results) {
    const row = m as Record<string, unknown>;
    const value = row.value as number;
    const green = row.threshold_green as number;
    const amber = row.threshold_amber as number;
    const red = row.threshold_red as number;
    const previousStatus = row.current_status as string;

    let status = 'green';
    if (green > red) {
      // Higher is better
      if (value < red) status = 'red';
      else if (value < amber) status = 'amber';
    } else {
      // Lower is better
      if (value > red) status = 'red';
      else if (value > amber) status = 'amber';
    }

    await db.prepare('UPDATE process_metrics SET status = ?, measured_at = datetime(\'now\') WHERE id = ?')
      .bind(status, row.id).run();

    // 5.4: Event-driven trigger — enqueue catalyst task when metric goes red
    if (status === 'red' && previousStatus !== 'red' && queue) {
      try {
        // Find a relevant catalyst cluster to handle this metric
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

        // Also create a notification for the metric going red
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
 * 5.1: Queue Consumer — processes catalyst execution messages from Cloudflare Queue
 */
export async function handleQueueMessage(
  batch: MessageBatch<unknown>,
  env: ScheduledEnv,
): Promise<void> {
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
          }, env.DB, env.CACHE, env.AI);
          break;
        }
        case 'health_recalc':
          await recalculateHealthScore(env.DB, msg.tenantId);
          break;
        case 'briefing_gen':
          await generateBriefing(env.DB, env.AI, msg.tenantId);
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
