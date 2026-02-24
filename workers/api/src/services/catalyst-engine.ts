/**
 * Catalyst Execution Engine
 * Real task runner with confidence scoring, human-in-the-loop approval workflows, and escalation
 */

export interface TaskDefinition {
  id: string;
  clusterId: string;
  tenantId: string;
  catalystName: string;
  action: string;
  inputData: Record<string, unknown>;
  riskLevel: 'high' | 'medium' | 'low';
  autonomyTier: string;
  trustScore: number;
  priority?: 'critical' | 'high' | 'medium' | 'low';
  requiredConfidence?: number;
  maxRetries?: number;
}

export interface TaskResult {
  actionId: string;
  status: 'completed' | 'failed' | 'requires_approval' | 'escalated';
  confidence: number;
  outputData: Record<string, unknown>;
  reasoning: string;
  executionTimeMs: number;
  retryCount: number;
}

export interface ApprovalRequest {
  actionId: string;
  clusterId: string;
  tenantId: string;
  catalystName: string;
  action: string;
  confidence: number;
  reasoning: string;
  inputSummary: string;
  requiredRole: string;
  expiresAt: string;
}

// ── Confidence Scoring ──

function calculateConfidence(action: string, inputData: Record<string, unknown>, clusterTrustScore: number): number {
  let base = 0.7;

  // Adjust based on action type risk level
  const highRiskActions = ['delete', 'cancel', 'terminate', 'transfer_funds', 'approve_payment'];
  const mediumRiskActions = ['update', 'modify', 'reassign', 'escalate'];
  const lowRiskActions = ['read', 'query', 'analyze', 'report', 'notify', 'log'];

  const actionLower = action.toLowerCase();
  if (highRiskActions.some(a => actionLower.includes(a))) {
    base = 0.5;
  } else if (mediumRiskActions.some(a => actionLower.includes(a))) {
    base = 0.65;
  } else if (lowRiskActions.some(a => actionLower.includes(a))) {
    base = 0.85;
  }

  // Factor in cluster trust score
  const trustFactor = clusterTrustScore / 100;
  base = base * 0.7 + trustFactor * 0.3;

  // Factor in input data completeness
  const fields = Object.keys(inputData);
  const nonEmptyFields = fields.filter(k => inputData[k] !== null && inputData[k] !== undefined && inputData[k] !== '');
  const completeness = fields.length > 0 ? nonEmptyFields.length / fields.length : 0.5;
  base = base * 0.8 + completeness * 0.2;

  return Math.round(Math.min(Math.max(base, 0.1), 0.99) * 100) / 100;
}

// ── Autonomy Tier Check ──

function canAutoExecute(autonomyTier: string, confidence: number, actionType: string): boolean {
  const actionLower = actionType.toLowerCase();
  const isReadOnly = ['read', 'query', 'analyze', 'report', 'list', 'get'].some(a => actionLower.includes(a));
  const isTransactional = ['create', 'update', 'delete', 'transfer', 'approve', 'payment'].some(a => actionLower.includes(a));

  switch (autonomyTier) {
    case 'read-only':
      return isReadOnly;
    case 'assisted':
      return isReadOnly || (confidence >= 0.85 && !isTransactional);
    case 'transactional':
      return confidence >= 0.7;
    default:
      return false;
  }
}

// ── Escalation Logic ──

function determineEscalation(confidence: number, action: string, retryCount: number): {
  shouldEscalate: boolean;
  escalationLevel: 'team_lead' | 'manager' | 'executive';
  reason: string;
} {
  const actionLower = action.toLowerCase();
  const isHighValue = ['payment', 'transfer', 'contract', 'terminate'].some(a => actionLower.includes(a));

  if (retryCount >= 3) {
    return { shouldEscalate: true, escalationLevel: 'manager', reason: `Action failed after ${retryCount} retries` };
  }
  if (confidence < 0.3) {
    return { shouldEscalate: true, escalationLevel: 'executive', reason: 'Very low confidence score — requires human judgment' };
  }
  if (confidence < 0.5 && isHighValue) {
    return { shouldEscalate: true, escalationLevel: 'manager', reason: 'Low confidence on high-value action' };
  }
  if (confidence < 0.6) {
    return { shouldEscalate: true, escalationLevel: 'team_lead', reason: 'Below confidence threshold' };
  }

  return { shouldEscalate: false, escalationLevel: 'team_lead', reason: '' };
}

// ── AI-Powered Action Reasoning ──

async function generateActionReasoning(
  ai: Ai,
  catalystName: string,
  action: string,
  inputData: Record<string, unknown>,
  confidence: number,
): Promise<string> {
  try {
    const result = await ai.run('@cf/meta/llama-3.1-8b-instruct' as Parameters<Ai['run']>[0], {
      messages: [
        {
          role: 'system',
          content: `You are the reasoning engine for "${catalystName}", an autonomous enterprise catalyst agent. Generate a brief, clear reasoning for why this action should be taken, considering the confidence level. Be specific and reference the input data.`,
        },
        {
          role: 'user',
          content: `Action: ${action}\nConfidence: ${confidence}\nInput: ${JSON.stringify(inputData)}`,
        },
      ],
      max_tokens: 256,
      temperature: 0.3,
    });
    const aiResult = result as { response?: string };
    return aiResult.response || `Action "${action}" evaluated with ${confidence} confidence based on input parameters.`;
  } catch {
    return `Action "${action}" evaluated with ${(confidence * 100).toFixed(0)}% confidence. Automated reasoning unavailable.`;
  }
}

// ── Main Execution Engine ──

export async function executeTask(
  taskInput: {
    clusterId: string; tenantId: string; catalystName: string; action: string;
    inputData: Record<string, unknown>; riskLevel: 'high' | 'medium' | 'low';
    autonomyTier: string; trustScore: number;
  },
  db: D1Database, cache: KVNamespace, ai: Ai,
): Promise<TaskResult> {
  const startTime = Date.now();
  let retryCount = 0;

  // Create action record in DB
  const actionId = crypto.randomUUID();
  await db.prepare(
    'INSERT INTO catalyst_actions (id, cluster_id, tenant_id, catalyst_name, action, status, confidence, input_data, retry_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(actionId, taskInput.clusterId, taskInput.tenantId, taskInput.catalystName, taskInput.action, 'pending', 0, JSON.stringify(taskInput.inputData), 0).run();

  const task: TaskDefinition = {
    id: actionId,
    ...taskInput,
    maxRetries: 3,
  };

  const trustScore = taskInput.trustScore || 50;
  const autonomyTier = taskInput.autonomyTier || 'read-only';

  // Calculate confidence
  const confidence = calculateConfidence(task.action, task.inputData, trustScore);

  // Generate AI reasoning
  const reasoning = await generateActionReasoning(ai, task.catalystName, task.action, task.inputData, confidence);

  // Check if auto-execution is allowed
  const autoExecute = canAutoExecute(autonomyTier, confidence, task.action);

  if (!autoExecute) {
    // Check escalation
    const escalation = determineEscalation(confidence, task.action, retryCount);

    if (escalation.shouldEscalate) {
      // Update action status to escalated
      await db.prepare(
        'UPDATE catalyst_actions SET status = ?, confidence = ?, reasoning = ?, output_data = ? WHERE id = ?'
      ).bind('escalated', confidence, reasoning, JSON.stringify({
        escalationLevel: escalation.escalationLevel,
        escalationReason: escalation.reason,
      }), task.id).run();

      // Create notification for escalation
      await db.prepare(
        'INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
      ).bind(
        crypto.randomUUID(), task.tenantId, 'escalation',
        `Escalation: ${task.catalystName}`,
        `Action "${task.action}" escalated to ${escalation.escalationLevel}: ${escalation.reason}`,
        'high', `/catalysts/actions/${task.id}`,
      ).run().catch(() => { /* notifications table may not exist yet */ });

      return {
        actionId: task.id, status: 'escalated', confidence, reasoning,
        outputData: { escalationLevel: escalation.escalationLevel, reason: escalation.reason },
        executionTimeMs: Date.now() - startTime, retryCount,
      };
    }

    // Requires manual approval
    await db.prepare(
      'UPDATE catalyst_actions SET status = ?, confidence = ?, reasoning = ? WHERE id = ?'
    ).bind('pending_approval', confidence, reasoning, task.id).run();

    // Cache approval request for quick access
    const approvalKey = `approval:${task.id}`;
    await cache.put(approvalKey, JSON.stringify({
      actionId: task.id, clusterId: task.clusterId, tenantId: task.tenantId,
      catalystName: task.catalystName, action: task.action, confidence, reasoning,
      inputSummary: JSON.stringify(task.inputData).substring(0, 200),
      requiredRole: confidence < 0.5 ? 'admin' : 'manager',
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    } satisfies ApprovalRequest), { expirationTtl: 86400 });

    return {
      actionId: task.id, status: 'requires_approval', confidence, reasoning,
      outputData: { requiredRole: confidence < 0.5 ? 'admin' : 'manager' },
      executionTimeMs: Date.now() - startTime, retryCount,
    };
  }

  // Auto-execute the action
  const maxRetries = task.maxRetries || 3;
  while (retryCount < maxRetries) {
    try {
      const output = await performAction(task, db);

      // Update action as completed
      await db.prepare(
        'UPDATE catalyst_actions SET status = ?, confidence = ?, reasoning = ?, output_data = ?, completed_at = datetime(\'now\') WHERE id = ?'
      ).bind('completed', confidence, reasoning, JSON.stringify(output), task.id).run();

      // Update cluster stats
      await db.prepare(
        'UPDATE catalyst_clusters SET tasks_completed = tasks_completed + 1, tasks_in_progress = MAX(0, tasks_in_progress - 1) WHERE id = ?'
      ).bind(task.clusterId).run();

      // Audit log
      await db.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), task.tenantId, `catalyst.${task.action}.executed`, 'catalysts',
        task.clusterId, JSON.stringify({ actionId: task.id, catalyst: task.catalystName, confidence }),
        'success',
      ).run();

      return {
        actionId: task.id, status: 'completed', confidence, reasoning,
        outputData: output, executionTimeMs: Date.now() - startTime, retryCount,
      };
    } catch (err) {
      retryCount++;
      if (retryCount >= maxRetries) {
        await db.prepare(
          'UPDATE catalyst_actions SET status = ?, confidence = ?, reasoning = ?, output_data = ? WHERE id = ?'
        ).bind('failed', confidence, reasoning, JSON.stringify({ error: (err as Error).message, retries: retryCount }), task.id).run();

        return {
          actionId: task.id, status: 'failed', confidence, reasoning,
          outputData: { error: (err as Error).message, retries: retryCount },
          executionTimeMs: Date.now() - startTime, retryCount,
        };
      }
      // Brief wait before retry (exponential backoff approximation)
      await new Promise(r => setTimeout(r, Math.min(1000 * Math.pow(2, retryCount), 5000)));
    }
  }

  return {
    actionId: task.id, status: 'failed', confidence, reasoning: 'Max retries exceeded',
    outputData: {}, executionTimeMs: Date.now() - startTime, retryCount,
  };
}

// ── Perform Action (real execution with DB queries and mutations) ──

async function performAction(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const actionLower = task.action.toLowerCase();

  // Read/query actions — query real data from canonical tables
  if (['read', 'query', 'analyze', 'report', 'list', 'get', 'check', 'monitor'].some(a => actionLower.includes(a))) {
    return await performReadAction(task, db);
  }

  // Notification/alerting actions — create real notifications
  if (['notify', 'alert', 'email', 'remind'].some(a => actionLower.includes(a))) {
    return await performNotifyAction(task, db);
  }

  // Investigation/analysis actions — run real data analysis
  if (['investigate', 'diagnose', 'assess', 'evaluate', 'audit'].some(a => actionLower.includes(a))) {
    return await performInvestigateAction(task, db);
  }

  // Create/update actions — modify real DB records
  if (['create', 'update', 'modify', 'process', 'reconcile', 'sync'].some(a => actionLower.includes(a))) {
    return await performMutationAction(task, db);
  }

  // Default action handler — still queries real data for context
  const metricCount = await db.prepare(
    'SELECT COUNT(*) as count FROM process_metrics WHERE tenant_id = ?'
  ).bind(task.tenantId).first<{ count: number }>();

  return {
    type: 'generic_result',
    action: task.action,
    catalyst: task.catalystName,
    tenantMetrics: metricCount?.count || 0,
    timestamp: new Date().toISOString(),
  };
}

/** Read/query actions: fetch real data from ERP canonical tables and process metrics */
async function performReadAction(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const actionLower = task.action.toLowerCase();
  const domain = task.inputData.domain as string || task.inputData.source_system as string || '';

  // Supply chain / inventory queries
  if (actionLower.includes('inventory') || actionLower.includes('stock') || actionLower.includes('supply')) {
    const products = await db.prepare(
      'SELECT name, sku, stock_on_hand, reorder_level, cost_price, selling_price FROM erp_products WHERE tenant_id = ? AND is_active = 1 ORDER BY stock_on_hand ASC LIMIT 20'
    ).bind(task.tenantId).all();

    const lowStock = products.results.filter((p: Record<string, unknown>) =>
      (p.stock_on_hand as number) <= (p.reorder_level as number)
    );

    return {
      type: 'inventory_analysis',
      totalProducts: products.results.length,
      lowStockItems: lowStock.length,
      items: products.results.map((p: Record<string, unknown>) => ({
        name: p.name, sku: p.sku, stock: p.stock_on_hand, reorderLevel: p.reorder_level,
      })),
      recommendations: lowStock.length > 0
        ? `${lowStock.length} item(s) below reorder level — purchase orders recommended`
        : 'All inventory levels healthy',
      timestamp: new Date().toISOString(),
    };
  }

  // Financial / invoice queries
  if (actionLower.includes('invoice') || actionLower.includes('payment') || actionLower.includes('receivable') || actionLower.includes('financial')) {
    const invoices = await db.prepare(
      "SELECT status, payment_status, COUNT(*) as count, SUM(total) as total_value, SUM(amount_due) as total_due FROM erp_invoices WHERE tenant_id = ? GROUP BY status, payment_status"
    ).bind(task.tenantId).all();

    const overdue = await db.prepare(
      "SELECT invoice_number, customer_name, total, amount_due, due_date FROM erp_invoices WHERE tenant_id = ? AND payment_status = 'unpaid' AND due_date < date('now') LIMIT 10"
    ).bind(task.tenantId).all();

    return {
      type: 'financial_analysis',
      invoiceSummary: invoices.results,
      overdueInvoices: overdue.results.length,
      overdueDetails: overdue.results,
      timestamp: new Date().toISOString(),
    };
  }

  // Customer analysis
  if (actionLower.includes('customer') || actionLower.includes('client')) {
    const customers = await db.prepare(
      "SELECT customer_group, status, COUNT(*) as count FROM erp_customers WHERE tenant_id = ? GROUP BY customer_group, status"
    ).bind(task.tenantId).all();

    return {
      type: 'customer_analysis',
      segmentation: customers.results,
      totalSegments: customers.results.length,
      timestamp: new Date().toISOString(),
    };
  }

  // Process metrics query
  if (actionLower.includes('metric') || actionLower.includes('kpi') || actionLower.includes('performance') || domain) {
    let query = 'SELECT name, value, unit, status, source_system FROM process_metrics WHERE tenant_id = ?';
    const binds: unknown[] = [task.tenantId];
    if (domain) { query += ' AND source_system = ?'; binds.push(domain); }
    query += ' ORDER BY measured_at DESC LIMIT 20';

    const metrics = await db.prepare(query).bind(...binds).all();
    const redMetrics = metrics.results.filter((m: Record<string, unknown>) => m.status === 'red');

    return {
      type: 'metric_analysis',
      totalMetrics: metrics.results.length,
      redAlerts: redMetrics.length,
      metrics: metrics.results,
      timestamp: new Date().toISOString(),
    };
  }

  // Generic data query — aggregate counts across tables
  const [customers, suppliers, products, invoices, metrics] = await Promise.all([
    db.prepare('SELECT COUNT(*) as c FROM erp_customers WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_suppliers WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_products WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM erp_invoices WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
    db.prepare('SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ?').bind(task.tenantId).first<{ c: number }>(),
  ]);

  return {
    type: 'data_summary',
    dataCounts: {
      customers: customers?.c || 0, suppliers: suppliers?.c || 0,
      products: products?.c || 0, invoices: invoices?.c || 0, metrics: metrics?.c || 0,
    },
    timestamp: new Date().toISOString(),
  };
}

/** Notify/alert actions: create real notifications in DB */
async function performNotifyAction(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const notifId = crypto.randomUUID();
  const severity = (task.inputData.severity as string) || 'medium';
  const recipients = task.inputData.recipients as string[] || [];

  await db.prepare(
    "INSERT INTO notifications (id, tenant_id, type, title, message, severity, metadata, created_at) VALUES (?, ?, 'catalyst_notification', ?, ?, ?, ?, datetime('now'))"
  ).bind(
    notifId, task.tenantId,
    `${task.catalystName}: ${task.action}`,
    typeof task.inputData.message === 'string' ? task.inputData.message : JSON.stringify(task.inputData),
    severity,
    JSON.stringify({ catalyst: task.catalystName, action: task.action, recipients }),
  ).run();

  return {
    type: 'notification_sent',
    notificationId: notifId,
    severity,
    recipientCount: recipients.length,
    timestamp: new Date().toISOString(),
  };
}

/** Investigation actions: run real analysis by querying anomalies, risks, and metrics */
async function performInvestigateAction(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const metricName = task.inputData.metric as string;
  const threshold = task.inputData.threshold as number;

  // Query relevant anomalies
  const anomalies = await db.prepare(
    "SELECT metric, severity, expected_value, actual_value, deviation, hypothesis FROM anomalies WHERE tenant_id = ? AND status = 'open' ORDER BY deviation DESC LIMIT 10"
  ).bind(task.tenantId).all();

  // Query related risks
  const risks = await db.prepare(
    "SELECT title, severity, category, impact_value FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY impact_value DESC LIMIT 5"
  ).bind(task.tenantId).all();

  // If investigating a specific metric, get its history
  let metricData: Record<string, unknown> | null = null;
  if (metricName) {
    metricData = await db.prepare(
      'SELECT name, value, unit, status, threshold_green, threshold_amber, threshold_red FROM process_metrics WHERE tenant_id = ? AND name = ?'
    ).bind(task.tenantId, metricName).first();
  }

  // Generate findings
  const findings: string[] = [];
  if (anomalies.results.length > 0) {
    findings.push(`${anomalies.results.length} open anomaly(ies) detected`);
  }
  if (risks.results.length > 0) {
    const totalImpact = risks.results.reduce((sum: number, r: Record<string, unknown>) => sum + ((r.impact_value as number) || 0), 0);
    findings.push(`${risks.results.length} active risk(s) with total impact R${totalImpact.toLocaleString()}`);
  }
  if (metricData && threshold) {
    const value = metricData.value as number;
    findings.push(`Metric "${metricName}" at ${value} (threshold: ${threshold})`);
  }

  return {
    type: 'investigation_result',
    anomaliesFound: anomalies.results.length,
    anomalies: anomalies.results,
    activeRisks: risks.results.length,
    risks: risks.results,
    metricData,
    findings,
    timestamp: new Date().toISOString(),
  };
}

/** Mutation actions: perform real DB updates (reconcile, sync, update statuses) */
async function performMutationAction(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const actionLower = task.action.toLowerCase();
  let recordsAffected = 0;

  // Reconcile invoices — mark overdue invoices
  if (actionLower.includes('reconcile') || actionLower.includes('invoice')) {
    const result = await db.prepare(
      "UPDATE erp_invoices SET payment_status = 'overdue' WHERE tenant_id = ? AND payment_status = 'unpaid' AND due_date < date('now')"
    ).bind(task.tenantId).run();
    recordsAffected = result.meta.changes || 0;

    return {
      type: 'reconciliation_result',
      action: 'mark_overdue_invoices',
      recordsAffected,
      timestamp: new Date().toISOString(),
    };
  }

  // Update process metric statuses based on thresholds
  if (actionLower.includes('metric') || actionLower.includes('threshold') || actionLower.includes('process')) {
    const metrics = await db.prepare(
      'SELECT id, value, threshold_green, threshold_amber, threshold_red FROM process_metrics WHERE tenant_id = ? AND threshold_red IS NOT NULL'
    ).bind(task.tenantId).all();

    for (const m of metrics.results) {
      const row = m as Record<string, unknown>;
      const value = row.value as number;
      const green = row.threshold_green as number;
      const red = row.threshold_red as number;
      const amber = row.threshold_amber as number;

      let status = 'green';
      if (green > red) {
        if (value < red) status = 'red';
        else if (value < amber) status = 'amber';
      } else {
        if (value > red) status = 'red';
        else if (value > amber) status = 'amber';
      }

      await db.prepare("UPDATE process_metrics SET status = ?, measured_at = datetime('now') WHERE id = ?")
        .bind(status, row.id).run();
      recordsAffected++;
    }

    return {
      type: 'metric_update_result',
      action: 'recalculate_metric_statuses',
      metricsUpdated: recordsAffected,
      timestamp: new Date().toISOString(),
    };
  }

  // Resolve old anomalies
  if (actionLower.includes('resolve') || actionLower.includes('close') || actionLower.includes('anomal')) {
    const result = await db.prepare(
      "UPDATE anomalies SET status = 'resolved', resolved_at = datetime('now') WHERE tenant_id = ? AND status = 'open' AND detected_at < datetime('now', '-7 days')"
    ).bind(task.tenantId).run();
    recordsAffected = result.meta.changes || 0;

    return {
      type: 'anomaly_resolution',
      action: 'auto_resolve_stale_anomalies',
      recordsAffected,
      timestamp: new Date().toISOString(),
    };
  }

  // Sync — trigger a refresh of canonical data counts
  if (actionLower.includes('sync') || actionLower.includes('refresh')) {
    const connections = await db.prepare(
      "SELECT id FROM erp_connections WHERE tenant_id = ? AND status = 'connected'"
    ).bind(task.tenantId).all();

    // Update last_sync timestamp for all connected ERP connections
    for (const conn of connections.results) {
      await db.prepare("UPDATE erp_connections SET last_sync = datetime('now') WHERE id = ?")
        .bind(conn.id).run();
      recordsAffected++;
    }

    return {
      type: 'sync_result',
      action: 'refresh_erp_connections',
      connectionsRefreshed: recordsAffected,
      timestamp: new Date().toISOString(),
    };
  }

  // Generic mutation — log the operation
  return {
    type: 'mutation_result',
    action: task.action,
    catalyst: task.catalystName,
    inputKeys: Object.keys(task.inputData),
    timestamp: new Date().toISOString(),
  };
}

// ── Approval Workflow ──

export async function approveAction(
  actionId: string,
  approvedBy: string,
  db: D1Database,
  cache: KVNamespace,
): Promise<TaskResult> {
  const action = await db.prepare('SELECT * FROM catalyst_actions WHERE id = ?').bind(actionId).first();
  if (!action) throw new Error('Action not found');

  // Execute the approved action
  const task: TaskDefinition = {
    id: actionId,
    clusterId: action.cluster_id as string,
    tenantId: action.tenant_id as string,
    catalystName: action.catalyst_name as string,
    action: action.action as string,
    inputData: action.input_data ? JSON.parse(action.input_data as string) : {},
    riskLevel: 'medium',
    autonomyTier: 'transactional',
    trustScore: 50,
    maxRetries: 1,
  };

  const output = await performAction(task, db);

  await db.prepare(
    'UPDATE catalyst_actions SET status = ?, approved_by = ?, output_data = ?, completed_at = datetime(\'now\') WHERE id = ?'
  ).bind('approved', approvedBy, JSON.stringify(output), actionId).run();

  // Clean up cached approval
  await cache.delete(`approval:${actionId}`);

  return {
    actionId, status: 'completed', confidence: action.confidence as number || 0.5,
    reasoning: `Manually approved by ${approvedBy}`,
    outputData: output, executionTimeMs: 0, retryCount: 0,
  };
}

export async function rejectAction(
  actionId: string,
  rejectedBy: string,
  reason: string,
  db: D1Database,
  cache: KVNamespace,
): Promise<void> {
  await db.prepare(
    'UPDATE catalyst_actions SET status = ?, approved_by = ?, output_data = ?, completed_at = datetime(\'now\') WHERE id = ?'
  ).bind('rejected', rejectedBy, JSON.stringify({ rejectionReason: reason }), actionId).run();

  await cache.delete(`approval:${actionId}`);
}
