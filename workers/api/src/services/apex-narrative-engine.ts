/**
 * Apex Narrative Engine + Insight Closure — Phase 10-5.
 *
 * The last leg of the Phase 10 cross-catalyst causal chain. Two
 * deterministic sweeps that turn the substrate built by 10-1 → 10-4
 * into Apex-layer narrative and clean up RCAs that have run their
 * course:
 *
 *  1. **generateApexNarrative** — once per tenant per day, distil
 *     recent active RCAs (Phase 10-4) into one `executive_briefings`
 *     row. Risks = the live symptoms with their causal chains; KPI
 *     movements = the symptom metrics' values; Opportunities = RCAs
 *     that recently closed (recovery wins).
 *
 *  2. **closeRecoveredRcas** — for each active RCA, read the current
 *     status of the symptom metric. If the metric is no longer red AND
 *     has held that better status for the last N samples (debounce),
 *     mark the RCA `resolved` and notify. This is the analytical
 *     counterpart to verifyCompletedActions: action verification
 *     proves the *write* landed; RCA closure proves the *outcome*
 *     materialised.
 *
 * Strong-inference gates:
 *  - Narrative: only generated when ≥ 1 active RCA exists; daily debounce
 *    prevents Apex from spamming briefings on quiet days.
 *  - Closure: requires ≥ MIN_RECOVERY_SAMPLES recent history points all
 *    at the recovered status — preferring false negatives (briefly
 *    closed metric stays under RCA) over false positives (single
 *    rebound sample falsely closes a real problem).
 */

import { logError, logInfo } from './logger';
import { forecastMetric, type ForecastPoint } from './kpi-forecasting';
import { recordOutcome, type GateName } from './inference-calibration';

const NARRATIVE_DEBOUNCE_HOURS = 20; // ~once per day, with slack
const RCA_LOOKBACK_DAYS = 7;
const MIN_RECOVERY_SAMPLES = 3;
const MAX_RISKS_IN_BRIEFING = 5;

// ── Types ──────────────────────────────────────────────────────────────

interface RcaRow {
  id: string;
  metric_id: string;
  metric_name: string;
  trigger_status: string;
  causal_chain: string;
  confidence: number;
  generated_at: string;
}

interface FactorRow {
  layer: string;
  factor_type: string;
  title: string;
  description: string;
  confidence: number;
  evidence: string;
}

interface MetricRow {
  id: string;
  name: string;
  value: number;
  unit: string | null;
  status: string;
  domain: string | null;
}

export interface NarrativeResult {
  briefingsCreated: number;
  skippedDebounced: boolean;
  activeRcasConsidered: number;
}

export interface ClosureResult {
  rcasScanned: number;
  rcasResolved: number;
  rcasSkippedInsufficientHistory: number;
}

// ── Narrative ──────────────────────────────────────────────────────────

async function recentBriefingExists(db: D1Database, tenantId: string): Promise<boolean> {
  try {
    const r = await db.prepare(
      `SELECT 1 FROM executive_briefings
        WHERE tenant_id = ? AND generated_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, `-${NARRATIVE_DEBOUNCE_HOURS} hours`).first();
    return r !== null;
  } catch {
    return false;
  }
}

async function loadActiveRcas(db: D1Database, tenantId: string): Promise<RcaRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, trigger_status, causal_chain, confidence, generated_at
         FROM root_cause_analyses
        WHERE tenant_id = ? AND status = 'active'
          AND generated_at > datetime('now', ?)
        ORDER BY confidence DESC, generated_at DESC
        LIMIT ?`
    ).bind(tenantId, `-${RCA_LOOKBACK_DAYS} days`, MAX_RISKS_IN_BRIEFING).all<RcaRow>();
    return r.results || [];
  } catch (err) {
    logError('apex_narrative.load_rcas_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadFactorsForRca(db: D1Database, tenantId: string, rcaId: string): Promise<FactorRow[]> {
  try {
    const r = await db.prepare(
      `SELECT layer, factor_type, title, description, confidence, evidence
         FROM causal_factors
        WHERE rca_id = ? AND tenant_id = ?
        ORDER BY layer ASC`
    ).bind(rcaId, tenantId).all<FactorRow>();
    return r.results || [];
  } catch {
    return [];
  }
}

async function loadMetric(db: D1Database, tenantId: string, metricId: string): Promise<MetricRow | null> {
  try {
    return await db.prepare(
      `SELECT id, name, value, unit, status, domain FROM process_metrics
        WHERE id = ? AND tenant_id = ?`
    ).bind(metricId, tenantId).first<MetricRow>();
  } catch {
    return null;
  }
}

async function loadRecentlyResolvedRcas(db: D1Database, tenantId: string): Promise<RcaRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, trigger_status, causal_chain, confidence, generated_at
         FROM root_cause_analyses
        WHERE tenant_id = ? AND status = 'resolved'
          AND resolved_at > datetime('now', ?)
        ORDER BY resolved_at DESC
        LIMIT 5`
    ).bind(tenantId, `-${NARRATIVE_DEBOUNCE_HOURS} hours`).all<RcaRow>();
    return r.results || [];
  } catch {
    return [];
  }
}

interface RiskBullet {
  metric: string;
  status: string;
  causal_chain: string;
  confidence: number;
  drivers: string[];
}

interface KpiMovement {
  metric: string;
  value: number;
  unit: string;
  status: string;
  /** 30/60/90-day linear-trend forecasts. Empty when history < 10 obs. */
  forecast: ForecastPoint[];
}

interface OpportunityBullet {
  metric: string;
  message: string;
}

async function buildRiskBullet(
  db: D1Database, tenantId: string, rca: RcaRow,
): Promise<RiskBullet> {
  const factors = await loadFactorsForRca(db, tenantId, rca.id);
  const drivers = factors
    .filter((f) => f.layer !== 'L0')
    .slice(0, 3)
    .map((f) => f.title);
  const chainTitles = [rca.metric_name, ...drivers];
  return {
    metric: rca.metric_name,
    status: rca.trigger_status,
    causal_chain: chainTitles.join(' ← '),
    confidence: rca.confidence,
    drivers,
  };
}

function buildOpportunityBullet(rca: RcaRow): OpportunityBullet {
  return {
    metric: rca.metric_name,
    message: `${rca.metric_name} recovered from ${rca.trigger_status}; RCA closed.`,
  };
}

async function persistBriefing(
  db: D1Database, tenantId: string,
  risks: RiskBullet[], kpis: KpiMovement[], opportunities: OpportunityBullet[],
): Promise<boolean> {
  const symptomList = risks.map((r) => r.metric).join(', ') || 'No active symptoms';
  const summary = risks.length > 0
    ? `Apex narrative — ${risks.length} active causal chain${risks.length === 1 ? '' : 's'} ` +
      `under investigation. Top symptom: ${risks[0].causal_chain}.`
    : `Apex narrative — no active root causes; KPI surface is stable.`;
  try {
    await db.prepare(
      `INSERT INTO executive_briefings
         (id, tenant_id, title, summary, risks, opportunities, kpi_movements,
          decisions_needed, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]', datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId,
      `Apex weekly briefing — ${symptomList}`,
      summary,
      JSON.stringify(risks),
      JSON.stringify(opportunities),
      JSON.stringify(kpis),
    ).run();
    return true;
  } catch (err) {
    logError('apex_narrative.persist_failed', err, { tenantId }, {});
    return false;
  }
}

export async function generateApexNarrative(
  db: D1Database, tenantId: string,
): Promise<NarrativeResult> {
  const result: NarrativeResult = {
    briefingsCreated: 0, skippedDebounced: false, activeRcasConsidered: 0,
  };

  if (await recentBriefingExists(db, tenantId)) {
    result.skippedDebounced = true;
    return result;
  }

  const rcas = await loadActiveRcas(db, tenantId);
  result.activeRcasConsidered = rcas.length;
  const recentlyResolved = await loadRecentlyResolvedRcas(db, tenantId);

  // Only emit a briefing when there's something to narrate.
  if (rcas.length === 0 && recentlyResolved.length === 0) return result;

  const risks: RiskBullet[] = [];
  const kpis: KpiMovement[] = [];
  for (const rca of rcas) {
    risks.push(await buildRiskBullet(db, tenantId, rca));
    const m = await loadMetric(db, tenantId, rca.metric_id);
    if (m) {
      const forecast = await forecastMetric(db, tenantId, m.id);
      kpis.push({
        metric: m.name, value: m.value, unit: m.unit ?? '', status: m.status,
        forecast,
      });
    }
  }
  const opportunities = recentlyResolved.map(buildOpportunityBullet);

  const ok = await persistBriefing(db, tenantId, risks, kpis, opportunities);
  if (ok) {
    result.briefingsCreated = 1;
    logInfo(
      'apex_narrative.briefing_created',
      { tenantId, layer: 'apex', action: 'narrative' },
      { risks: risks.length, opportunities: opportunities.length, kpis: kpis.length },
    );
  }
  return result;
}

// ── RCA closure on metric recovery ────────────────────────────────────

interface ActiveRcaForClosure {
  id: string;
  metric_id: string;
  metric_name: string;
  trigger_status: string;
}

async function loadActiveRcasForClosure(
  db: D1Database, tenantId: string,
): Promise<ActiveRcaForClosure[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, trigger_status
         FROM root_cause_analyses
        WHERE tenant_id = ? AND status = 'active'`
    ).bind(tenantId).all<ActiveRcaForClosure>();
    return r.results || [];
  } catch (err) {
    logError('rca_closure.load_failed', err, { tenantId }, {});
    return [];
  }
}

interface RecentHistoryRow { value: number; recorded_at: string }

async function loadRecentMetricHistory(
  db: D1Database, tenantId: string, metricId: string, limit: number,
): Promise<RecentHistoryRow[]> {
  try {
    const r = await db.prepare(
      `SELECT value, recorded_at FROM process_metric_history
        WHERE tenant_id = ? AND metric_id = ?
        ORDER BY recorded_at DESC
        LIMIT ?`
    ).bind(tenantId, metricId, limit).all<RecentHistoryRow>();
    return r.results || [];
  } catch {
    return [];
  }
}

/** Decide whether a metric value is at a recovered (non-red) level. */
function isRecoveredValue(value: number, thresholds: {
  red?: number | null; amber?: number | null; green?: number | null;
  direction: 'higher_better' | 'lower_better';
}): boolean {
  // No thresholds → can't say; conservatively return false (don't auto-close).
  const { red, amber, direction } = thresholds;
  if (red == null) return false;
  if (direction === 'higher_better') {
    // healthy when value ABOVE red threshold (with some buffer to amber if known)
    if (value <= red) return false;
    if (amber != null && value < amber) return true; // recovered to amber zone
    return true; // above amber → green/amber
  }
  // lower_better
  if (value >= red) return false;
  if (amber != null && value >= amber) return true;
  return true;
}

interface MetricWithThresholds {
  status: string;
  value: number;
  threshold_red: number | null;
  threshold_amber: number | null;
  threshold_green: number | null;
}

async function loadMetricWithThresholds(
  db: D1Database, tenantId: string, metricId: string,
): Promise<MetricWithThresholds | null> {
  try {
    return await db.prepare(
      `SELECT status, value, threshold_red, threshold_amber, threshold_green
         FROM process_metrics WHERE id = ? AND tenant_id = ?`
    ).bind(metricId, tenantId).first<MetricWithThresholds>();
  } catch {
    return null;
  }
}

/** Higher-better when red threshold sits BELOW amber (e.g. green=80, red=40 → higher better). */
function inferDirection(m: MetricWithThresholds): 'higher_better' | 'lower_better' {
  if (m.threshold_red == null || m.threshold_amber == null) {
    return 'higher_better';
  }
  return m.threshold_amber > m.threshold_red ? 'higher_better' : 'lower_better';
}

async function markResolved(
  db: D1Database, tenantId: string, rcaId: string, metricName: string,
): Promise<boolean> {
  try {
    await db.prepare(
      `UPDATE root_cause_analyses
          SET status = 'resolved', resolved_at = datetime('now')
        WHERE id = ? AND tenant_id = ?`
    ).bind(rcaId, tenantId).run();
    try {
      await db.prepare(
        `INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, metadata, read)
         VALUES (?, ?, 'system', ?, ?, 'info', '/pulse?tab=diagnostics', ?, 0)`
      ).bind(
        crypto.randomUUID(), tenantId,
        `RCA closed — ${metricName} recovered`,
        `${metricName} held at a recovered status across the last ${MIN_RECOVERY_SAMPLES} samples; the active root cause analysis has been resolved.`,
        JSON.stringify({ rcaId, metricName }),
      ).run();
    } catch { /* notifications are best-effort */ }
    return true;
  } catch (err) {
    logError('rca_closure.update_failed', err, { tenantId }, { rcaId });
    return false;
  }
}

export async function closeRecoveredRcas(
  db: D1Database, tenantId: string,
): Promise<ClosureResult> {
  const result: ClosureResult = {
    rcasScanned: 0, rcasResolved: 0, rcasSkippedInsufficientHistory: 0,
  };

  const rcas = await loadActiveRcasForClosure(db, tenantId);
  result.rcasScanned = rcas.length;
  if (rcas.length === 0) return result;

  for (const rca of rcas) {
    const metric = await loadMetricWithThresholds(db, tenantId, rca.metric_id);
    if (!metric) continue;
    if (metric.status === 'red') continue; // still degraded — keep RCA open

    const history = await loadRecentMetricHistory(db, tenantId, rca.metric_id, MIN_RECOVERY_SAMPLES);
    if (history.length < MIN_RECOVERY_SAMPLES) {
      result.rcasSkippedInsufficientHistory++;
      continue;
    }

    const dir = inferDirection(metric);
    const allRecovered = history.every((h) => isRecoveredValue(h.value, {
      red: metric.threshold_red,
      amber: metric.threshold_amber,
      green: metric.threshold_green,
      direction: dir,
    }));
    if (!allRecovered) {
      result.rcasSkippedInsufficientHistory++;
      continue;
    }

    const ok = await markResolved(db, tenantId, rca.id, rca.metric_name);
    if (ok) {
      result.rcasResolved++;
      // Phase 10-15: every L1 driver of a recovered RCA is a true_positive
      // on its source attribution gate. Lets a future PR auto-tune
      // gate thresholds based on how often recoveries follow attributions.
      try {
        const factors = await db.prepare(
          `SELECT factor_type, layer FROM causal_factors
            WHERE rca_id = ? AND tenant_id = ? AND layer IN ('L1', 'L3')`
        ).bind(rca.id, tenantId).all<{ factor_type: string; layer: string }>();
        for (const f of factors.results || []) {
          const gate: GateName = f.factor_type === 'cross_metric'
            ? 'metric_correlation.min_correlation'
            : 'signal_attribution.min_correlation';
          await recordOutcome({
            db, tenantId, gate,
            outcome: 'true_positive',
            source: 'auto_resolved',
            context: { rcaId: rca.id, factorLayer: f.layer, factorType: f.factor_type, metricId: rca.metric_id },
          });
        }
      } catch (calErr) {
        logError('rca_closure.calibration_failed', calErr, { tenantId }, { rcaId: rca.id });
      }
    }
  }

  if (result.rcasResolved > 0) {
    logInfo(
      'rca_closure.completed',
      { tenantId, layer: 'apex', action: 'rca_closure' },
      { ...result },
    );
  }
  return result;
}
