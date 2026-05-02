/**
 * Pulse Diagnostics Engine V2
 * 
 * Root-cause analysis pipeline with L0-L5 causal chain using V2 schema:
 * root_cause_analyses, causal_factors, diagnostic_prescriptions
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';
import type { LlmMessage } from './llm-provider';
import { createNotification } from './notifications';
import { getTenantCurrency } from './tenant-currency';

// ── runRootCauseAnalysis ──

export async function runRootCauseAnalysis(
  db: D1Database,
  tenantId: string,
  metricId: string,
  env: { AI: Ai },
): Promise<{ id: string }> {
  // L0 — Symptom: Load metric from process_metrics
  const metric = await db.prepare(
    'SELECT * FROM process_metrics WHERE id = ? AND tenant_id = ?'
  ).bind(metricId, tenantId).first();

  if (!metric) throw new Error('Metric not found');

  const metricName = metric.name as string;
  const metricValue = metric.value as number;
  const metricStatus = metric.status as string;
  const triggerStatus = metricStatus;

  // Create RCA record
  const rcaId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO root_cause_analyses (id, tenant_id, metric_id, metric_name, trigger_status, status, generated_at)
     VALUES (?, ?, ?, ?, ?, 'active', ?)`
  ).bind(rcaId, tenantId, metricId, metricName, triggerStatus, now).run();

  // Gather context for L1-L5
  const recentRuns = await db.prepare(
    'SELECT id, sub_catalyst_name, cluster_id, status, discrepancies, discrepancy_details, recommendations, total_discrepancy_value FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 10'
  ).bind(tenantId).all();

  const processFlows = await db.prepare(
    'SELECT * FROM process_flows WHERE tenant_id = ? LIMIT 5'
  ).bind(tenantId).all();

  const correlations = await db.prepare(
    'SELECT * FROM correlation_events WHERE tenant_id = ? ORDER BY detected_at DESC LIMIT 10'
  ).bind(tenantId).all();

  // tenants.industry was dropped from the schema; the LLM prompt is bucketed
  // under 'general' until per-tenant industry tagging is reintroduced.
  // Reading the column would throw "no such column: industry" at runtime.
  const tenant: { industry: string } = { industry: 'general' };
  const currency = await getTenantCurrency(db, tenantId);
  const llmConfig = await loadLlmConfig(db, tenantId);

  // L0 factor — Symptom
  const l0Id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO causal_factors (id, rca_id, tenant_id, layer, factor_type, title, description, evidence, confidence, created_at)
     VALUES (?, ?, ?, 'L0', 'symptom', ?, ?, ?, 90, ?)`
  ).bind(
    l0Id, rcaId, tenantId,
    `${metricName} degraded to ${metricStatus}`,
    `Metric ${metricName} is at ${metricValue} ${metric.unit || ''} (status: ${metricStatus}). Thresholds: green=${metric.threshold_green}, amber=${metric.threshold_amber}, red=${metric.threshold_red}.`,
    JSON.stringify({ value: metricValue, status: metricStatus, unit: metric.unit }),
    now,
  ).run();

  // Build comprehensive LLM prompt for L1-L5
  const runContext = recentRuns.results.map((r: Record<string, unknown>) =>
    `${r.sub_catalyst_name}: ${r.status}, discrepancies=${r.discrepancies}, value=R${r.total_discrepancy_value || 0}`
  ).join('\n');

  const correlationContext = correlations.results.map((c: Record<string, unknown>) =>
    `${c.source_system}→${c.target_system}: ${c.source_event}→${c.target_impact} (confidence: ${c.confidence})`
  ).join('\n');

  const messages: LlmMessage[] = [
    {
      role: 'system',
      content: `You are Atheon Intelligence performing root-cause analysis for a ${tenant?.industry || 'general'} business. The tenant operates in ${currency}; quantify financial impact in ${currency}.

Build causal factors for layers L1 through L5:
L1 — Process Factor: what process step degraded
L2 — Resource/Config Factor: root resource or configuration cause (staffing gaps, approval workflows, master data issues, SAP config, missing automation)
L3 — Quantified Impact: financial and operational impact with amounts in ${currency}
L4 — Downstream Cascade: other metrics/systems affected
L5 — Prescription: 2-4 prioritised fix prescriptions

For L1-L4, respond with JSON: { "layers": [{ "layer": "L1", "factor_type": "process|resource|impact|cascade", "title": "", "description": "", "confidence": 0-100, "evidence_reasoning": "", "impact_value": null, "impact_unit": "${currency}" }] }
For L5, add: "prescriptions": [{ "priority": "immediate|short-term|strategic", "title": "", "description": "", "expected_impact": "", "effort_level": "low|medium|high", "responsible_domain": "", "sap_transactions": [] }]

Respond ONLY in JSON.`,
    },
    {
      role: 'user',
      content: `Metric: ${metricName} at ${metricValue} (${metricStatus})
Thresholds: green=${metric.threshold_green}, amber=${metric.threshold_amber}, red=${metric.threshold_red}

Recent catalyst runs:
${runContext || 'None'}

Process flows:
${processFlows.results.map((p: Record<string, unknown>) => `${p.name}: conformance=${p.conformance_rate}%, bottlenecks=${p.bottlenecks}`).join('\n') || 'None'}

Downstream correlations:
${correlationContext || 'None'}

Perform full L1-L5 root cause analysis.`,
    },
  ];

  let parsed: {
    layers?: Array<{ layer: string; factor_type: string; title: string; description: string; confidence: number; evidence_reasoning?: string; impact_value?: number; impact_unit?: string }>;
    prescriptions?: Array<{ priority: string; title: string; description: string; expected_impact?: string; effort_level: string; responsible_domain?: string; sap_transactions?: string[] }>;
  } = {};

  try {
    const result = await llmChatWithFallback(llmConfig, env.AI, messages, { maxTokens: 2000 });
    parsed = JSON.parse(stripCodeFences(result.text));
  } catch {
    parsed = {
      layers: [
        { layer: 'L1', factor_type: 'process', title: 'Process degradation detected', description: `The process associated with ${metricName} is showing degraded performance.`, confidence: 60 },
        { layer: 'L2', factor_type: 'resource', title: 'Potential configuration issue', description: 'Manual investigation needed to identify specific resource or configuration root cause.', confidence: 40 },
        { layer: 'L3', factor_type: 'impact', title: 'Financial impact pending quantification', description: 'Impact requires manual assessment.', confidence: 30, impact_value: 0 },
        { layer: 'L4', factor_type: 'cascade', title: 'Cascade analysis pending', description: 'Downstream effects need to be assessed.', confidence: 30 },
      ],
      prescriptions: [
        { priority: 'short-term', title: 'Investigate root cause manually', description: 'Review recent process changes and catalyst run results.', effort_level: 'medium', responsible_domain: 'operations' },
      ],
    };
  }

  // Store L1-L4 factors
  const causalChainJson: Array<Record<string, unknown>> = [{ layer: 'L0', title: `${metricName} degraded to ${metricStatus}` }];

  for (const layer of (parsed.layers || [])) {
    const factorId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO causal_factors (id, rca_id, tenant_id, layer, factor_type, title, description, evidence, impact_value, impact_unit, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      factorId, rcaId, tenantId,
      layer.layer || 'L1',
      layer.factor_type || 'process',
      layer.title || 'Unknown',
      layer.description || '',
      JSON.stringify({ reasoning: layer.evidence_reasoning || '' }),
      layer.impact_value || null,
      layer.impact_unit || currency,
      Math.min(100, Math.max(0, layer.confidence || 50)),
      now,
    ).run();
    causalChainJson.push({ layer: layer.layer, title: layer.title });
  }

  // Store L5 prescriptions
  let totalImpact = '';
  for (const rx of (parsed.prescriptions || [])) {
    const rxId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO diagnostic_prescriptions (id, rca_id, tenant_id, priority, title, description, expected_impact, effort_level, responsible_domain, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`
    ).bind(
      rxId, rcaId, tenantId,
      rx.priority || 'short-term',
      rx.title || 'Untitled',
      rx.description || '',
      rx.expected_impact || null,
      rx.effort_level || 'medium',
      rx.responsible_domain || null,
      now,
    ).run();
    if (rx.expected_impact) totalImpact += rx.expected_impact + '; ';
    causalChainJson.push({ layer: 'L5', title: rx.title });
  }

  // Update RCA with causal chain summary and confidence
  const avgConfidence = parsed.layers && parsed.layers.length > 0
    ? Math.round(parsed.layers.reduce((s, l) => s + (l.confidence || 50), 0) / parsed.layers.length)
    : 50;

  await db.prepare(
    `UPDATE root_cause_analyses SET causal_chain = ?, confidence = ?, impact_summary = ? WHERE id = ?`
  ).bind(JSON.stringify(causalChainJson), avgConfidence, totalImpact || null, rcaId).run();

  // §9.1.1 — Auto-triggered notification: RCA completion
  const prescriptionCount = (parsed.prescriptions || []).length;
  const l2Factor = (parsed.layers || []).find(l => l.layer === 'L2');
  try {
    await createNotification(db, {
      tenantId,
      type: 'alert',
      title: `Root Cause Analysis Complete: ${metricName}`,
      message: `Atheon diagnosed why ${metricName} is ${triggerStatus}. Root cause: ${l2Factor?.title || 'Under investigation'}. ${prescriptionCount} prescriptions generated.`,
      severity: triggerStatus === 'red' ? 'critical' : 'high',
      actionUrl: `/pulse?tab=diagnostics&rca=${rcaId}`,
      metadata: { rcaId, metricId, metricName },
    });
  } catch (notifErr) { console.error('RCA notification failed:', notifErr); }

  return { id: rcaId };
}

// §9.1.1 — Overdue prescription check (called by cron handler)
export async function checkOverduePrescriptions(
  db: D1Database,
  tenantId: string,
): Promise<number> {
  const overdue = await db.prepare(
    "SELECT dp.id, dp.title, dp.rca_id, rca.metric_name FROM diagnostic_prescriptions dp JOIN root_cause_analyses rca ON dp.rca_id = rca.id WHERE dp.tenant_id = ? AND dp.status = 'pending' AND dp.deadline_suggested IS NOT NULL AND dp.deadline_suggested < datetime('now')"
  ).bind(tenantId).all();

  let count = 0;
  for (const row of overdue.results) {
    const r = row as Record<string, unknown>;
    try {
      await createNotification(db, {
        tenantId,
        type: 'escalation',
        title: `Overdue Prescription: ${r.title}`,
        message: `The prescription "${r.title}" for ${r.metric_name} is past its suggested deadline. Please review and action immediately.`,
        severity: 'high',
        actionUrl: `/pulse?tab=diagnostics&rca=${r.rca_id}`,
        metadata: { prescriptionId: r.id, rcaId: r.rca_id },
      });
      count++;
    } catch { /* non-fatal */ }
  }
  return count;
}
