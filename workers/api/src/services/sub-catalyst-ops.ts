/**
 * Sub-Catalyst Operations Service
 * Handles run recording, KPI calculation, run history retrieval, and item-level tracking.
 * Core service for the Sub-Catalyst Ops View (all 3 specs).
 */

import { calculateKpiValue, determineKpiStatus } from './kpi-definitions';
import { collectRunInsights, bridgeKpisToProcessMetrics } from './insights-engine';
import type { RunInsightContext } from './insights-engine';

// ── Types ──

export interface ExecutionResultRecord {
  id: string;
  sub_catalyst: string;
  cluster_id: string;
  executed_at: string;
  duration_ms: number;
  status: string;
  mode: string;
  summary: {
    total_records_source: number;
    total_records_target: number;
    matched: number;
    unmatched_source: number;
    unmatched_target: number;
    discrepancies: number;
  };
  error?: string;
  reasoning?: string;
  recommendations?: string[];
  discrepancies?: Array<{
    source_record: Record<string, unknown>;
    target_record: Record<string, unknown> | null;
    field: string;
    source_value: unknown;
    target_value: unknown;
    difference?: string;
  }>;
  // Item-level arrays (from enhanced performReconciliation)
  matched_records?: Array<{ source: Record<string, unknown>; target: Record<string, unknown>; confidence: number; matched_on: string }>;
  unmatched_source_records?: Array<Record<string, unknown>>;
  unmatched_target_records?: Array<Record<string, unknown>>;
  exception_records?: Array<{ record: Record<string, unknown>; type: string; severity: string; detail: string }>;
}

export interface SubCatalystRunRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  run_number: number;
  triggered_by: string;
  trigger_context: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  data_sources_used: string;
  source_record_count: number;
  target_record_count: number;
  status: string;
  mode: string;
  matched: number;
  unmatched_source: number;
  unmatched_target: number;
  discrepancies: number;
  exceptions_raised: number;
  avg_confidence: number;
  min_confidence: number;
  max_confidence: number;
  reasoning: string | null;
  recommendations: string | null;
  metrics_generated: string | null;
  anomalies_detected: string | null;
  risk_alerts_raised: string | null;
  actions_created: string | null;
  result_data: string | null;
  discrepancy_details: string | null;
  total_source_value: number;
  total_matched_value: number;
  total_discrepancy_value: number;
  total_exception_value: number;
  total_unmatched_value: number;
  currency: string;
  items_total: number;
  items_reviewed: number;
  items_approved: number;
  items_rejected: number;
  items_deferred: number;
  review_complete: number;
  parent_run_id: string | null;
  sign_off_status: string;
  signed_off_by: string | null;
  signed_off_at: string | null;
  sign_off_notes: string | null;
  created_at: string;
}

export interface SubCatalystKpisRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_records_processed: number;
  avg_match_rate: number;
  avg_discrepancy_rate: number;
  avg_confidence: number;
  total_exceptions: number;
  exception_rate: number;
  success_trend: string;
  duration_trend: string;
  discrepancy_trend: string;
  confidence_trend: string;
  health_dimensions: string;
  health_contribution: number;
  threshold_success_green: number;
  threshold_success_amber: number;
  threshold_success_red: number;
  threshold_duration_green: number;
  threshold_duration_amber: number;
  threshold_duration_red: number;
  threshold_discrepancy_green: number;
  threshold_discrepancy_amber: number;
  threshold_discrepancy_red: number;
  status: string;
  last_run_at: string | null;
  next_scheduled_run: string | null;
  updated_at: string;
}

// ── Helpers: extract financial amounts from any ERP record shape ──
// v58: the static AMOUNT_FIELDS / REF_FIELDS / ENTITY_FIELDS arrays moved to
// erp-auto-mapper.ts CANONICAL_FIELDS so the resolver, the auto-mapper, and
// these helpers all share one source of truth. The synchronous extractors
// here continue to use the static aliases (and remain the right choice for
// pre-mapped canonical-table reads that already have the value in a known
// column). For raw-source-record extraction in catalyst handlers /
// assessment / report code, prefer the connection-aware resolver via
// extractAmountFor / extractRefFor / extractEntityFor in erp-field-resolver.

import { extractAmountStatic, extractRefStatic, extractEntityStatic } from './erp-field-resolver';

const extractAmount = extractAmountStatic;
const extractRef = extractRefStatic;
const extractEntity = extractEntityStatic;

// ── recordRun ──

export async function recordRun(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string,
  result: ExecutionResultRecord,
  triggeredBy: 'manual' | 'schedule' | 'threshold' | 'api' | 'retry',
  triggerContext?: Record<string, unknown>,
  parentRunId?: string
): Promise<string> {
  const runId = `run-${crypto.randomUUID()}`;

  // Calculate run_number
  const maxRow = await db.prepare(
    'SELECT COALESCE(MAX(run_number), 0) as max_num FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
  ).bind(tenantId, clusterId, subName).first<{ max_num: number }>();
  const runNumber = (maxRow?.max_num ?? 0) + 1;

  // Extract financial totals from item-level data
  let totalSourceValue = 0;
  let totalMatchedValue = 0;
  let totalDiscrepancyValue = 0;
  let totalExceptionValue = 0;
  let totalUnmatchedValue = 0;
  let itemsTotal = 0;

  // Count matched_records for financial values (handles SAP/Odoo/Xero/generic field names)
  if (result.matched_records) {
    for (const rec of result.matched_records) {
      totalMatchedValue += extractAmount(rec.source);
    }
  }
  if (result.unmatched_source_records) {
    for (const rec of result.unmatched_source_records) {
      totalUnmatchedValue += extractAmount(rec);
    }
  }
  if (result.exception_records) {
    for (const rec of result.exception_records) {
      totalExceptionValue += extractAmount(rec.record);
    }
  }
  if (result.discrepancies) {
    for (const d of result.discrepancies) {
      let discItemValue = 0;
      if (d.difference) {
        const num = parseFloat(String(d.difference).replace(/[^0-9.-]/g, ''));
        discItemValue = isNaN(num) ? 0 : Math.abs(num);
      } else {
        const sv = parseFloat(String(d.source_value ?? 0));
        const tv = parseFloat(String(d.target_value ?? 0));
        if (!isNaN(sv) && !isNaN(tv)) discItemValue = Math.abs(sv - tv);
      }
      // Fallback: only use source_record amount for unmatched sources (no target)
      // Skip entirely when unmatched_source_records exists to prevent double-counting
      // (performReconciliation pushes unmatched sources into both arrays)
      if (discItemValue === 0 && d.source_record && !d.target_record
          && !(result.unmatched_source_records?.length)) {
        discItemValue = extractAmount(d.source_record);
      }
      totalDiscrepancyValue += discItemValue;
    }
  }
  totalSourceValue = totalMatchedValue + totalUnmatchedValue + totalDiscrepancyValue + totalExceptionValue;

  // Insert run record
  await db.prepare(`INSERT INTO sub_catalyst_runs (
    id, tenant_id, cluster_id, sub_catalyst_name, run_number, triggered_by, trigger_context,
    started_at, completed_at, duration_ms, data_sources_used,
    source_record_count, target_record_count, status, mode,
    matched, unmatched_source, unmatched_target, discrepancies, exceptions_raised,
    avg_confidence, min_confidence, max_confidence,
    reasoning, recommendations, result_data, discrepancy_details,
    total_source_value, total_matched_value, total_discrepancy_value, total_exception_value, total_unmatched_value,
    currency, items_total, parent_run_id
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    runId, tenantId, clusterId, subName, runNumber, triggeredBy,
    triggerContext ? JSON.stringify(triggerContext) : null,
    result.executed_at, result.status !== 'running' ? new Date().toISOString() : null,
    result.duration_ms, '[]',
    result.summary.total_records_source, result.summary.total_records_target,
    result.status, result.mode,
    result.summary.matched, result.summary.unmatched_source, result.summary.unmatched_target,
    result.summary.discrepancies, result.exception_records?.length ?? 0,
    0, 0, 0, // confidence will be calculated from items
    result.reasoning ?? null, result.recommendations ? JSON.stringify(result.recommendations) : null,
    null, // result_data — skip full payload to save space
    result.discrepancies ? JSON.stringify(result.discrepancies) : null,
    totalSourceValue, totalMatchedValue, totalDiscrepancyValue, totalExceptionValue, totalUnmatchedValue,
    'ZAR', 0, parentRunId ?? null
  ).run();

  // Write item-level records
  itemsTotal = await writeRunItems(db, runId, tenantId, result);

  // Update items_total
  if (itemsTotal > 0) {
    await db.prepare('UPDATE sub_catalyst_runs SET items_total = ? WHERE id = ?').bind(itemsTotal, runId).run();
  }

  // Recalculate KPIs (pass runId for per-run KPI snapshots)
  await recalculateKpis(db, tenantId, clusterId, subName, runId);

  // ── Insights Engine: collect KPIs, issues, trends DURING this run ──
  try {
    // Get domain for this cluster
    const clusterRow = await db.prepare(
      'SELECT domain FROM catalyst_clusters WHERE id = ? AND tenant_id = ?'
    ).bind(clusterId, tenantId).first<{ domain: string }>();
    const domain = clusterRow?.domain || 'operational';

    // Get previous run for trend detection
    const prevRun = await db.prepare(
      'SELECT matched, discrepancies, exceptions_raised, total_source_value FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? AND id != ? ORDER BY started_at DESC LIMIT 1'
    ).bind(tenantId, clusterId, subName, runId).first<Record<string, number>>();

    // Calculate rates
    const totalRecords = (result.summary.matched || 0) + (result.summary.discrepancies || 0) + (result.exception_records?.length ?? 0);
    const matchRate = totalRecords > 0 ? (result.summary.matched / totalRecords) * 100 : 100;
    const discrepancyRate = totalRecords > 0 ? (result.summary.discrepancies / totalRecords) * 100 : 0;
    const exceptionRate = totalRecords > 0 ? ((result.exception_records?.length ?? 0) / totalRecords) * 100 : 0;

    // Get KPI values for this run
    const kpiVals = await db.prepare(
      `SELECT kd.kpi_name, kd.category, kv.value, kv.status
       FROM sub_catalyst_kpi_values kv
       JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
       WHERE kv.run_id = ? AND kv.tenant_id = ?`
    ).bind(runId, tenantId).all<Record<string, unknown>>();

    // Previous run's KPI values for comparison
    let previousRunId: string | null = null;
    if (prevRun) {
      const prevRunRow = await db.prepare(
        'SELECT id FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? AND id != ? ORDER BY started_at DESC LIMIT 1'
      ).bind(tenantId, clusterId, subName, runId).first<{ id: string }>();
      previousRunId = prevRunRow?.id || null;
    }

    const prevKpiMap: Record<string, number> = {};
    if (previousRunId) {
      const prevKpis = await db.prepare(
        `SELECT kd.kpi_name, kv.value FROM sub_catalyst_kpi_values kv
         JOIN sub_catalyst_kpi_definitions kd ON kv.definition_id = kd.id
         WHERE kv.run_id = ? AND kv.tenant_id = ?`
      ).bind(previousRunId, tenantId).all<Record<string, unknown>>();
      for (const pk of (prevKpis.results || [])) {
        prevKpiMap[pk.kpi_name as string] = pk.value as number;
      }
    }

    const insightContext: RunInsightContext = {
      tenantId,
      clusterId,
      subCatalystName: subName,
      runId,
      domain,
      runData: {
        status: result.status,
        matched: result.summary.matched,
        discrepancies: result.summary.discrepancies,
        exceptions: result.exception_records?.length ?? 0,
        totalSourceValue,
        totalDiscrepancyValue,
        totalUnmatchedValue,
        matchRate,
        discrepancyRate,
        exceptionRate,
        confidence: 0,
        duration_ms: result.duration_ms,
      },
      previousRunData: prevRun ? {
        matched: prevRun.matched || 0,
        discrepancies: prevRun.discrepancies || 0,
        exceptions: prevRun.exceptions_raised || 0,
        matchRate: prevRun.matched && prevRun.total_source_value ? (prevRun.matched / (prevRun.matched + prevRun.discrepancies + prevRun.exceptions_raised)) * 100 : 0,
        totalSourceValue: prevRun.total_source_value || 0,
      } : null,
      kpiValues: (kpiVals.results || []).map(k => ({
        name: k.kpi_name as string,
        category: k.category as string,
        value: k.value as number,
        status: k.status as string,
        previousValue: prevKpiMap[k.kpi_name as string],
      })),
    };

    await collectRunInsights(db, insightContext);

    // GAP 2: Bridge ALL KPI values to Pulse process_metrics
    await bridgeKpisToProcessMetrics(db, tenantId, clusterId, subName, runId);
  } catch (err) {
    console.error('recordRun: insights collection failed (non-fatal):', err);
  }

  return runId;
}

// ── writeRunItems — stores each processed record as an individual item ──

async function writeRunItems(
  db: D1Database,
  runId: string,
  tenantId: string,
  result: ExecutionResultRecord
): Promise<number> {
  let itemNumber = 0;

  // Matched records (handles SAP/Odoo/Xero/generic field names)
  if (result.matched_records) {
    for (const rec of result.matched_records) {
      itemNumber++;
      const srcAmt = extractAmount(rec.source);
      const tgtAmt = extractAmount(rec.target);
      try {
        await db.prepare(`INSERT INTO sub_catalyst_run_items (
          id, run_id, tenant_id, item_number, item_status, source_ref, source_entity, source_amount, source_data,
          target_ref, target_entity, target_amount, target_data, match_confidence, matched_on_field
        ) VALUES (?, ?, ?, ?, 'matched', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          `item-${crypto.randomUUID()}`, runId, tenantId, itemNumber,
          extractRef(rec.source),
          extractEntity(rec.source),
          srcAmt !== 0 ? srcAmt : 0, JSON.stringify(rec.source),
          extractRef(rec.target),
          extractEntity(rec.target),
          tgtAmt !== 0 ? tgtAmt : 0, JSON.stringify(rec.target),
          rec.confidence ?? null, rec.matched_on ?? null
        ).run();
      } catch (err) { console.error('writeRunItems matched:', err); }
    }
  }

  // Build a set of unmatched source refs to avoid duplicates between discrepancies and unmatched_source_records
  const unmatchedSourceRefs = new Set<string>();
  if (result.unmatched_source_records) {
    for (const rec of result.unmatched_source_records) {
      const ref = extractRef(rec);
      if (ref) unmatchedSourceRefs.add(ref);
    }
  }

  // Discrepancy records — skip if the same record will be written by the unmatched_source_records loop
  if (result.discrepancies) {
    for (const d of result.discrepancies) {
      if (!d.target_record && unmatchedSourceRefs.size > 0) {
        // This unmatched source is already in unmatched_source_records — skip to avoid duplicates
          const srcRef = extractRef(d.source_record);
          if (srcRef && unmatchedSourceRefs.has(srcRef)) continue;
      }
      itemNumber++;
      const srcAmt = parseFloat(String(d.source_value ?? 0));
      const tgtAmt = parseFloat(String(d.target_value ?? 0));
      const discAmt = !isNaN(srcAmt) && !isNaN(tgtAmt) ? Math.abs(srcAmt - tgtAmt) : null;
      const discPct = !isNaN(srcAmt) && srcAmt !== 0 && discAmt !== null ? Math.round(discAmt / Math.abs(srcAmt) * 10000) / 100 : null;
      try {
        await db.prepare(`INSERT INTO sub_catalyst_run_items (
          id, run_id, tenant_id, item_number, item_status,
          source_ref, source_entity, source_amount, source_data,
          target_ref, target_entity, target_amount, target_data,
          discrepancy_field, discrepancy_source_value, discrepancy_target_value, discrepancy_amount, discrepancy_pct, discrepancy_reason,
          exception_severity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
          `item-${crypto.randomUUID()}`, runId, tenantId, itemNumber,
          d.target_record ? 'discrepancy' : 'unmatched_source',
          extractRef(d.source_record),
          extractEntity(d.source_record),
          isNaN(srcAmt) ? null : srcAmt, JSON.stringify(d.source_record),
          d.target_record ? extractRef(d.target_record as Record<string, unknown>) : null,
          d.target_record ? extractEntity(d.target_record as Record<string, unknown>) : null,
          isNaN(tgtAmt) ? null : tgtAmt, d.target_record ? JSON.stringify(d.target_record) : null,
          d.field, String(d.source_value ?? ''), String(d.target_value ?? ''),
          discAmt, discPct, d.difference ?? null,
          discAmt !== null && discAmt > 10000 ? 'high' : discAmt !== null && discAmt > 1000 ? 'medium' : 'low'
        ).run();
      } catch (err) { console.error('writeRunItems discrepancy:', err); }
    }
  }

  // Unmatched source records
  if (result.unmatched_source_records) {
    for (const rec of result.unmatched_source_records) {
      itemNumber++;
      const amt = extractAmount(rec);
      try {
        await db.prepare(`INSERT INTO sub_catalyst_run_items (
          id, run_id, tenant_id, item_number, item_status,
          source_ref, source_entity, source_amount, source_data, exception_severity
        ) VALUES (?, ?, ?, ?, 'unmatched_source', ?, ?, ?, ?, 'medium')`).bind(
          `item-${crypto.randomUUID()}`, runId, tenantId, itemNumber,
          extractRef(rec),
          extractEntity(rec),
          amt !== 0 ? amt : 0, JSON.stringify(rec)
        ).run();
      } catch (err) { console.error('writeRunItems unmatched_source:', err); }
    }
  }

  // Unmatched target records
  if (result.unmatched_target_records) {
    for (const rec of result.unmatched_target_records) {
      itemNumber++;
      const amt = extractAmount(rec);
      try {
        await db.prepare(`INSERT INTO sub_catalyst_run_items (
          id, run_id, tenant_id, item_number, item_status,
          target_ref, target_entity, target_amount, target_data, exception_severity
        ) VALUES (?, ?, ?, ?, 'unmatched_target', ?, ?, ?, ?, 'medium')`).bind(
          `item-${crypto.randomUUID()}`, runId, tenantId, itemNumber,
          extractRef(rec),
          extractEntity(rec),
          amt !== 0 ? amt : 0, JSON.stringify(rec)
        ).run();
      } catch (err) { console.error('writeRunItems unmatched_target:', err); }
    }
  }

  // Exception records
  if (result.exception_records) {
    for (const exc of result.exception_records) {
      itemNumber++;
      const amt = extractAmount(exc.record);
      try {
        await db.prepare(`INSERT INTO sub_catalyst_run_items (
          id, run_id, tenant_id, item_number, item_status,
          source_ref, source_entity, source_amount, source_data,
          exception_type, exception_severity, exception_detail
        ) VALUES (?, ?, ?, ?, 'exception', ?, ?, ?, ?, ?, ?, ?)`).bind(
          `item-${crypto.randomUUID()}`, runId, tenantId, itemNumber,
          extractRef(exc.record),
          extractEntity(exc.record),
          amt !== 0 ? amt : 0, JSON.stringify(exc.record),
          exc.type, exc.severity, exc.detail
        ).run();
      } catch (err) { console.error('writeRunItems exception:', err); }
    }
  }

  return itemNumber;
}

// ── recalculateKpis ──

export async function recalculateKpis(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string,
  runId?: string
): Promise<void> {
  // Aggregate from all runs
  const agg = await db.prepare(`SELECT
    COUNT(*) as total,
    SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as success,
    SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
    AVG(duration_ms) as avg_dur,
    AVG(source_record_count + target_record_count) as avg_records,
    AVG(CASE WHEN source_record_count > 0 THEN matched * 100.0 / source_record_count ELSE 0 END) as avg_match,
    AVG(CASE WHEN source_record_count > 0 THEN discrepancies * 100.0 / source_record_count ELSE 0 END) as avg_disc,
    AVG(avg_confidence) as avg_conf,
    SUM(exceptions_raised) as total_exc
  FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?`
  ).bind(tenantId, clusterId, subName).first<Record<string, number>>();

  if (!agg || !agg.total) return;

  const total = agg.total || 0;
  const success = agg.success || 0;
  const failed = agg.failed || 0;
  const successRate = total > 0 ? Math.round(success * 1000 / total) / 10 : 0;
  const avgDuration = Math.round(agg.avg_dur || 0);
  const avgRecords = Math.round(agg.avg_records || 0);
  const avgMatch = Math.round((agg.avg_match || 0) * 10) / 10;
  const avgDisc = Math.round((agg.avg_disc || 0) * 10) / 10;
  const avgConf = Math.round((agg.avg_conf || 0) * 100) / 100;
  const totalExc = agg.total_exc || 0;
  const excRate = total > 0 ? Math.round(totalExc * 1000 / total) / 10 : 0;

  // Trend data (last 30 runs)
  const trendRows = await db.prepare(
    `SELECT status, duration_ms, discrepancies, avg_confidence, source_record_count, matched
     FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?
     ORDER BY started_at DESC LIMIT 30`
  ).bind(tenantId, clusterId, subName).all<Record<string, unknown>>();

  const successTrend: number[] = [];
  const durationTrend: number[] = [];
  const discrepancyTrend: number[] = [];
  const confidenceTrend: number[] = [];

  if (trendRows.results) {
    for (const r of trendRows.results.reverse()) {
      successTrend.push(r.status === 'completed' ? 1 : 0);
      durationTrend.push((r.duration_ms as number) || 0);
      discrepancyTrend.push((r.discrepancies as number) || 0);
      confidenceTrend.push((r.avg_confidence as number) || 0);
    }
  }

  // Determine overall status based on thresholds
  // Read existing thresholds or use defaults
  const existing = await db.prepare(
    'SELECT * FROM sub_catalyst_kpis WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
  ).bind(tenantId, clusterId, subName).first<SubCatalystKpisRow>();

  const thGreen = existing?.threshold_success_green ?? 90;
  const thAmber = existing?.threshold_success_amber ?? 70;
  const thRed = existing?.threshold_success_red ?? 50;
  const thDurGreen = existing?.threshold_duration_green ?? 60000;
  const thDurAmber = existing?.threshold_duration_amber ?? 120000;
  const thDurRed = existing?.threshold_duration_red ?? 300000;
  const thDiscGreen = existing?.threshold_discrepancy_green ?? 2;
  const thDiscAmber = existing?.threshold_discrepancy_amber ?? 5;
  const thDiscRed = existing?.threshold_discrepancy_red ?? 10;

  let status = 'green';
  if (successRate < thRed || avgDuration > thDurRed || avgDisc > thDiscRed) status = 'red';
  else if (successRate < thAmber || avgDuration > thDurAmber || avgDisc > thDiscAmber) status = 'amber';
  else if (successRate < thGreen || avgDuration > thDurGreen || avgDisc > thDiscGreen) status = 'amber';

  const kpiId = existing?.id || `kpi-${crypto.randomUUID()}`;
  const now = new Date().toISOString();

  // Get last run time
  const lastRun = await db.prepare(
    'SELECT started_at FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? ORDER BY started_at DESC LIMIT 1'
  ).bind(tenantId, clusterId, subName).first<{ started_at: string }>();

  if (existing) {
    await db.prepare(`UPDATE sub_catalyst_kpis SET
      total_runs = ?, successful_runs = ?, failed_runs = ?, success_rate = ?,
      avg_duration_ms = ?, avg_records_processed = ?, avg_match_rate = ?, avg_discrepancy_rate = ?,
      avg_confidence = ?, total_exceptions = ?, exception_rate = ?,
      success_trend = ?, duration_trend = ?, discrepancy_trend = ?, confidence_trend = ?,
      status = ?, last_run_at = ?, updated_at = ?
    WHERE id = ?`).bind(
      total, success, failed, successRate,
      avgDuration, avgRecords, avgMatch, avgDisc,
      avgConf, totalExc, excRate,
      JSON.stringify(successTrend), JSON.stringify(durationTrend),
      JSON.stringify(discrepancyTrend), JSON.stringify(confidenceTrend),
      status, lastRun?.started_at ?? null, now, kpiId
    ).run();
  } else {
    await db.prepare(`INSERT INTO sub_catalyst_kpis (
      id, tenant_id, cluster_id, sub_catalyst_name,
      total_runs, successful_runs, failed_runs, success_rate,
      avg_duration_ms, avg_records_processed, avg_match_rate, avg_discrepancy_rate,
      avg_confidence, total_exceptions, exception_rate,
      success_trend, duration_trend, discrepancy_trend, confidence_trend,
      status, last_run_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
      kpiId, tenantId, clusterId, subName,
      total, success, failed, successRate,
      avgDuration, avgRecords, avgMatch, avgDisc,
      avgConf, totalExc, excRate,
      JSON.stringify(successTrend), JSON.stringify(durationTrend),
      JSON.stringify(discrepancyTrend), JSON.stringify(confidenceTrend),
      status, lastRun?.started_at ?? null, now
    ).run();
  }

  // ── Pulse Integration: write process_metric for this sub-catalyst ──
  const metricId = `pm-${tenantId}-${clusterId}-${subName.replace(/\s+/g, '-').toLowerCase()}-success`;
  try {
    await db.prepare(`INSERT INTO process_metrics (id, tenant_id, name, value, unit, status, threshold_green, threshold_amber, threshold_red, source_system, measured_at, trend)
      VALUES (?, ?, ?, ?, '%', ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET value=excluded.value, status=excluded.status, measured_at=excluded.measured_at, trend=excluded.trend`
    ).bind(
      metricId, tenantId, `${subName} Success Rate`, successRate, status,
      thGreen, thAmber, thRed, subName, now,
      JSON.stringify(successTrend.slice(-10).map(v => v ? successRate : successRate * 0.8))
    ).run();
  } catch (err) { console.error('recalculateKpis: process_metrics write failed:', err); }

  // ── Auto-create anomaly when RED ──
  if (status === 'red') {
    try {
      const anomalyId = `anom-${tenantId}-${clusterId}-${subName.replace(/\s+/g, '-').toLowerCase()}`;
      await db.prepare(`INSERT INTO anomalies (id, tenant_id, metric, severity, expected_value, actual_value, deviation, hypothesis, status, detected_at)
        VALUES (?, ?, ?, 'high', ?, ?, ?, ?, 'open', ?)
        ON CONFLICT(id) DO UPDATE SET actual_value=excluded.actual_value, deviation=excluded.deviation, detected_at=excluded.detected_at`
      ).bind(
        anomalyId, tenantId, `${subName} Success Rate`,
        thGreen, successRate, Math.round((thGreen - successRate) * 10) / 10,
        `Sub-catalyst "${subName}" performance has degraded below the RED threshold (${thRed}%). Current success rate: ${successRate}%. Immediate review recommended.`,
        now
      ).run();
    } catch (err) { console.error('recalculateKpis: anomaly creation failed:', err); }
  }

  // ── Apex Integration: cluster-level risk alert when ≥2 sub-catalysts RED ──
  try {
    const redCount = await db.prepare(
      "SELECT COUNT(*) as cnt FROM sub_catalyst_kpis WHERE tenant_id = ? AND cluster_id = ? AND status = 'red'"
    ).bind(tenantId, clusterId).first<{ cnt: number }>();

    if (redCount && redCount.cnt >= 2) {
      const alertId = `ra-${tenantId}-${clusterId}-multi-red`;
      await db.prepare(`INSERT INTO risk_alerts (id, tenant_id, title, description, severity, category, probability, impact_value, impact_unit, recommended_actions, status, detected_at)
        VALUES (?, ?, ?, ?, 'critical', 'operational', 0.9, ?, 'ZAR', ?, 'active', ?)
        ON CONFLICT(id) DO UPDATE SET description=excluded.description, detected_at=excluded.detected_at`
      ).bind(
        alertId, tenantId,
        `Cluster Degradation: ${redCount.cnt} sub-catalysts in RED`,
        `Multiple sub-catalysts in cluster ${clusterId} have degraded to RED status. This indicates systemic issues requiring immediate attention.`,
        0,
        JSON.stringify(['Review all RED sub-catalysts', 'Check data source connectivity', 'Escalate to operations team']),
        now
      ).run();

      // Note: health_score degradation is handled by the scheduled recalculation job
      // in services/scheduled.ts to avoid cumulative penalties on every run execution.
      // The risk_alert above already flags the issue for the Apex layer.
    }
  } catch (err) { console.error('recalculateKpis: Apex integration failed:', err); }

  // ── KPI-4: Calculate ALL defined KPI values for this sub-catalyst ──
  try {
    const defs = await db.prepare(
      'SELECT * FROM sub_catalyst_kpi_definitions WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? AND enabled = 1 ORDER BY sort_order'
    ).bind(tenantId, clusterId, subName).all<Record<string, unknown>>();

    if (defs.results && defs.results.length > 0) {
      // Get latest run data for domain-specific KPI calculations
      const latestRun = await db.prepare(
        'SELECT * FROM sub_catalyst_runs WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? ORDER BY started_at DESC LIMIT 1'
      ).bind(tenantId, clusterId, subName).first<Record<string, number>>();

      const runData = {
        source_record_count: latestRun?.source_record_count ?? 0,
        target_record_count: latestRun?.target_record_count ?? 0,
        matched: latestRun?.matched ?? 0,
        discrepancies: latestRun?.discrepancies ?? 0,
        exceptions_raised: latestRun?.exceptions_raised ?? 0,
        total_source_value: latestRun?.total_source_value ?? 0,
        total_matched_value: latestRun?.total_matched_value ?? 0,
        total_discrepancy_value: latestRun?.total_discrepancy_value ?? 0,
        total_exception_value: latestRun?.total_exception_value ?? 0,
        total_unmatched_value: latestRun?.total_unmatched_value ?? 0,
        duration_ms: latestRun?.duration_ms ?? 0,
      };
      const aggregateData = { success_rate: successRate, avg_duration_ms: avgDuration, exception_rate: excRate };

      let worstStatus: 'green' | 'amber' | 'red' = 'green';

      for (const def of defs.results) {
        const defId = def.id as string;
        const category = def.category as string;
        const kpiName = def.kpi_name as string;
        const direction = def.direction as string;
        const thG = def.threshold_green as number;
        const thA = def.threshold_amber as number;
        const thR = def.threshold_red as number;

        const value = calculateKpiValue(category, kpiName, runData, aggregateData);
        if (value === null) continue;

        const kpiStatus = determineKpiStatus(value, direction, thG, thA, thR);

        // Update worst status for rollup
        if (kpiStatus === 'red') worstStatus = 'red';
        else if (kpiStatus === 'amber' && worstStatus !== 'red') worstStatus = 'amber';

        // Get existing aggregate value for trend
        const existingVal = await db.prepare(
          'SELECT id, trend FROM sub_catalyst_kpi_values WHERE definition_id = ? AND run_id IS NULL'
        ).bind(defId).first<{ id: string; trend: string }>();

        const oldTrend: number[] = existingVal?.trend ? safeParseArray(existingVal.trend).map(Number) : [];
        oldTrend.push(Math.round(value * 100) / 100);
        if (oldTrend.length > 30) oldTrend.splice(0, oldTrend.length - 30);

        if (existingVal) {
          await db.prepare(
            'UPDATE sub_catalyst_kpi_values SET value = ?, status = ?, trend = ?, measured_at = ? WHERE id = ?'
          ).bind(value, kpiStatus, JSON.stringify(oldTrend), now, existingVal.id).run();
        } else {
          await db.prepare(
            'INSERT INTO sub_catalyst_kpi_values (id, tenant_id, definition_id, run_id, value, status, trend, measured_at) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)'
          ).bind(`kpiv-${crypto.randomUUID()}`, tenantId, defId, value, kpiStatus, JSON.stringify(oldTrend), now).run();
        }

        // Per-run snapshot (if runId provided)
        if (runId) {
          await db.prepare(
            'INSERT OR IGNORE INTO sub_catalyst_kpi_values (id, tenant_id, definition_id, run_id, value, status, trend, measured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
          ).bind(`kpiv-${crypto.randomUUID()}`, tenantId, defId, runId, value, kpiStatus, '[]', now).run();
        }
      }

      // Worst-status rollup: only escalate (worsen) the status, never downgrade
      const severityOrder: Record<string, number> = { green: 0, amber: 1, red: 2 };
      if ((severityOrder[worstStatus] || 0) > (severityOrder[status] || 0)) {
        await db.prepare('UPDATE sub_catalyst_kpis SET status = ?, updated_at = ? WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?')
          .bind(worstStatus, now, tenantId, clusterId, subName).run();
      }
    }
  } catch (err) { console.error('recalculateKpis: KPI definitions calculation failed:', err); }
}

// ── getRuns ──

export async function getRuns(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string,
  opts: { limit?: number; offset?: number; status?: string; from?: string; to?: string; triggered_by?: string }
): Promise<{ runs: SubCatalystRunRow[]; total: number }> {
  let whereClause = 'WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?';
  const params: unknown[] = [tenantId, clusterId, subName];

  if (opts.status) {
    whereClause += ' AND status = ?';
    params.push(opts.status);
  }
  if (opts.from) {
    whereClause += ' AND started_at >= ?';
    params.push(opts.from);
  }
  if (opts.to) {
    whereClause += ' AND started_at <= ?';
    params.push(opts.to);
  }
  if (opts.triggered_by) {
    whereClause += ' AND triggered_by = ?';
    params.push(opts.triggered_by);
  }

  const countResult = await db.prepare(`SELECT COUNT(*) as cnt FROM sub_catalyst_runs ${whereClause}`)
    .bind(...params).first<{ cnt: number }>();
  const total = countResult?.cnt ?? 0;

  const limit = opts.limit ?? 20;
  const offset = opts.offset ?? 0;

  const rows = await db.prepare(
    `SELECT id, tenant_id, cluster_id, sub_catalyst_name, run_number, triggered_by, trigger_context,
      started_at, completed_at, duration_ms, source_record_count, target_record_count,
      status, mode, matched, unmatched_source, unmatched_target, discrepancies, exceptions_raised,
      avg_confidence, reasoning, recommendations,
      total_source_value, total_matched_value, total_discrepancy_value, total_exception_value, total_unmatched_value,
      currency, items_total, items_reviewed, items_approved, items_rejected, items_deferred, review_complete,
      parent_run_id, sign_off_status, signed_off_by, signed_off_at, sign_off_notes, created_at
    FROM sub_catalyst_runs ${whereClause} ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<SubCatalystRunRow>();

  return { runs: rows.results || [], total };
}

// ── getRunDetail ──

export async function getRunDetail(
  db: D1Database,
  tenantId: string,
  runId: string
): Promise<{
  run: SubCatalystRunRow | null;
  steps: Array<{ step: number; name: string; status: string; duration_ms: number; detail: string }>;
  linkedOutputs: { metrics: string[]; anomalies: string[]; risk_alerts: string[]; actions: string[] };
}> {
  const run = await db.prepare(
    'SELECT * FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
  ).bind(runId, tenantId).first<SubCatalystRunRow>();

  if (!run) return { run: null, steps: [], linkedOutputs: { metrics: [], anomalies: [], risk_alerts: [], actions: [] } };

  // Get execution_logs for this run
  const logs = await db.prepare(
    'SELECT step_number, step_name, status, duration_ms, detail FROM execution_logs WHERE action_id = ? AND tenant_id = ? ORDER BY step_number'
  ).bind(runId, tenantId).all<{ step_number: number; step_name: string; status: string; duration_ms: number; detail: string }>();

  const steps = (logs.results || []).map(l => ({
    step: l.step_number, name: l.step_name, status: l.status,
    duration_ms: l.duration_ms || 0, detail: l.detail || '',
  }));

  // Parse linked output IDs
  const metrics = safeParseArray(run.metrics_generated);
  const anomalies = safeParseArray(run.anomalies_detected);
  const riskAlerts = safeParseArray(run.risk_alerts_raised);
  const actions = safeParseArray(run.actions_created);

  return { run, steps, linkedOutputs: { metrics, anomalies, risk_alerts: riskAlerts, actions } };
}

// ── getKpis ──

export async function getKpis(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string
): Promise<{
  overall_status: string;
  aggregate: SubCatalystKpisRow | null;
  definitions: Array<{
    id: string; name: string; category: string; unit: string; direction: string;
    value: number | null; status: string; thresholds: { green: number | null; amber: number | null; red: number | null };
    trend: number[]; is_universal: boolean; enabled: boolean; sort_order: number;
    calculation: string; data_source: string;
  }>;
}> {
  const aggregate = await db.prepare(
    'SELECT * FROM sub_catalyst_kpis WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ?'
  ).bind(tenantId, clusterId, subName).first<SubCatalystKpisRow>();

  // Load all KPI definitions with their latest values
  const defs = await db.prepare(
    'SELECT * FROM sub_catalyst_kpi_definitions WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? ORDER BY sort_order'
  ).bind(tenantId, clusterId, subName).all<Record<string, unknown>>();

  const definitions = [];
  const overallStatus = aggregate?.status ?? 'green';

  for (const def of (defs.results || [])) {
    const defId = def.id as string;
    // Get latest aggregate value (run_id IS NULL)
    const val = await db.prepare(
      'SELECT value, status, trend FROM sub_catalyst_kpi_values WHERE definition_id = ? AND run_id IS NULL'
    ).bind(defId).first<{ value: number; status: string; trend: string }>();

    let trendArr: number[] = [];
    try { trendArr = val?.trend ? JSON.parse(val.trend) : []; } catch { trendArr = []; }

    definitions.push({
      id: defId,
      name: def.kpi_name as string,
      category: def.category as string,
      unit: def.unit as string,
      direction: def.direction as string,
      value: val?.value ?? null,
      status: val?.status ?? 'green',
      thresholds: {
        green: def.threshold_green as number | null,
        amber: def.threshold_amber as number | null,
        red: def.threshold_red as number | null,
      },
      trend: trendArr,
      is_universal: (def.is_universal as number) === 1,
      enabled: (def.enabled as number) === 1,
      sort_order: def.sort_order as number,
      calculation: def.calculation as string,
      data_source: def.data_source as string,
    });
  }

  return { overall_status: overallStatus, aggregate, definitions };
}

// ── getKpiDefinitions (KPI-6) ──

export async function getKpiDefinitions(
  db: D1Database,
  tenantId: string,
  clusterId: string,
  subName: string
): Promise<Record<string, unknown>[]> {
  const result = await db.prepare(
    'SELECT * FROM sub_catalyst_kpi_definitions WHERE tenant_id = ? AND cluster_id = ? AND sub_catalyst_name = ? ORDER BY sort_order'
  ).bind(tenantId, clusterId, subName).all<Record<string, unknown>>();
  return result.results || [];
}

// ── updateKpiDefinition (KPI-6) ──

export async function updateKpiDefinition(
  db: D1Database,
  tenantId: string,
  defId: string,
  updates: { threshold_green?: number; threshold_amber?: number; threshold_red?: number; enabled?: boolean }
): Promise<boolean> {
  const sets: string[] = [];
  const params: unknown[] = [];
  if (updates.threshold_green !== undefined) { sets.push('threshold_green = ?'); params.push(updates.threshold_green); }
  if (updates.threshold_amber !== undefined) { sets.push('threshold_amber = ?'); params.push(updates.threshold_amber); }
  if (updates.threshold_red !== undefined) { sets.push('threshold_red = ?'); params.push(updates.threshold_red); }
  if (updates.enabled !== undefined) { sets.push('enabled = ?'); params.push(updates.enabled ? 1 : 0); }
  if (sets.length === 0) return false;
  params.push(defId, tenantId);
  const result = await db.prepare(
    `UPDATE sub_catalyst_kpi_definitions SET ${sets.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...params).run();
  return result.meta.changes > 0;
}

// ── getRunItems ──

export async function getRunItems(
  db: D1Database,
  tenantId: string,
  runId: string,
  opts: { limit?: number; offset?: number; status?: string; severity?: string; review_status?: string }
): Promise<{
  items: Record<string, unknown>[];
  totals: { items_total: number; matched: number; discrepancies: number; unmatched: number; exceptions: number; total_source_value: number; total_matched_value: number; total_discrepancy_value: number; total_exception_value: number };
  review_progress: { reviewed: number; approved: number; rejected: number; deferred: number; pending: number };
  total: number;
}> {
  let whereClause = 'WHERE run_id = ? AND tenant_id = ?';
  const params: unknown[] = [runId, tenantId];

  if (opts.status) {
    whereClause += ' AND item_status = ?';
    params.push(opts.status);
  }
  if (opts.severity) {
    whereClause += ' AND exception_severity = ?';
    params.push(opts.severity);
  }
  if (opts.review_status) {
    whereClause += ' AND review_status = ?';
    params.push(opts.review_status);
  }

  const countResult = await db.prepare(`SELECT COUNT(*) as cnt FROM sub_catalyst_run_items ${whereClause}`)
    .bind(...params).first<{ cnt: number }>();

  const limit = opts.limit ?? 50;
  const offset = opts.offset ?? 0;

  const rows = await db.prepare(
    `SELECT * FROM sub_catalyst_run_items ${whereClause} ORDER BY item_number ASC LIMIT ? OFFSET ?`
  ).bind(...params, limit, offset).all<Record<string, unknown>>();

  // Get run-level totals
  const run = await db.prepare(
    'SELECT items_total, matched, discrepancies, unmatched_source, unmatched_target, exceptions_raised, total_source_value, total_matched_value, total_discrepancy_value, total_exception_value, items_reviewed, items_approved, items_rejected, items_deferred FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?'
  ).bind(runId, tenantId).first<Record<string, number>>();

  const totals = {
    items_total: run?.items_total ?? 0,
    matched: run?.matched ?? 0,
    discrepancies: run?.discrepancies ?? 0,
    unmatched: (run?.unmatched_source ?? 0) + (run?.unmatched_target ?? 0),
    exceptions: run?.exceptions_raised ?? 0,
    total_source_value: run?.total_source_value ?? 0,
    total_matched_value: run?.total_matched_value ?? 0,
    total_discrepancy_value: run?.total_discrepancy_value ?? 0,
    total_exception_value: run?.total_exception_value ?? 0,
  };

  const reviewProgress = {
    reviewed: run?.items_reviewed ?? 0,
    approved: run?.items_approved ?? 0,
    rejected: run?.items_rejected ?? 0,
    deferred: run?.items_deferred ?? 0,
    pending: (run?.items_total ?? 0) - (run?.items_reviewed ?? 0),
  };

  return { items: rows.results || [], totals, review_progress: reviewProgress, total: countResult?.cnt ?? 0 };
}

// ── compareRuns ──

export async function compareRuns(
  db: D1Database,
  tenantId: string,
  runAId: string,
  runBId: string
): Promise<{
  run_a: SubCatalystRunRow | null;
  run_b: SubCatalystRunRow | null;
  delta: Record<string, number>;
  new_discrepancies: Record<string, unknown>[];
  resolved_discrepancies: Record<string, unknown>[];
  persistent_discrepancies: Record<string, unknown>[];
}> {
  const runA = await db.prepare('SELECT * FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?').bind(runAId, tenantId).first<SubCatalystRunRow>();
  const runB = await db.prepare('SELECT * FROM sub_catalyst_runs WHERE id = ? AND tenant_id = ?').bind(runBId, tenantId).first<SubCatalystRunRow>();

  if (!runA || !runB) return { run_a: runA, run_b: runB, delta: {}, new_discrepancies: [], resolved_discrepancies: [], persistent_discrepancies: [] };

  const delta: Record<string, number> = {
    matched: runB.matched - runA.matched,
    discrepancies: runB.discrepancies - runA.discrepancies,
    exceptions: runB.exceptions_raised - runA.exceptions_raised,
    total_source_value: runB.total_source_value - runA.total_source_value,
    total_discrepancy_value: runB.total_discrepancy_value - runA.total_discrepancy_value,
  };

  // Get discrepancy items from both runs
  const itemsA = await db.prepare(
    "SELECT * FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? AND item_status IN ('discrepancy','exception')"
  ).bind(runAId, tenantId).all<Record<string, unknown>>();
  const itemsB = await db.prepare(
    "SELECT * FROM sub_catalyst_run_items WHERE run_id = ? AND tenant_id = ? AND item_status IN ('discrepancy','exception')"
  ).bind(runBId, tenantId).all<Record<string, unknown>>();

  const aRefs = new Set((itemsA.results || []).map(i => String(i.source_ref || i.target_ref || '')));
  const bRefs = new Set((itemsB.results || []).map(i => String(i.source_ref || i.target_ref || '')));

  const newDisc = (itemsB.results || []).filter(i => !aRefs.has(String(i.source_ref || i.target_ref || '')));
  const resolved = (itemsA.results || []).filter(i => !bRefs.has(String(i.source_ref || i.target_ref || '')));
  const persistent = (itemsB.results || []).filter(i => aRefs.has(String(i.source_ref || i.target_ref || '')));

  return { run_a: runA, run_b: runB, delta, new_discrepancies: newDisc, resolved_discrepancies: resolved, persistent_discrepancies: persistent };
}

// ── Helper ──

function safeParseArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
