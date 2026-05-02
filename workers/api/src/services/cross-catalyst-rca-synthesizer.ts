/**
 * Cross-Catalyst RCA Synthesizer — Phase 10-4.
 *
 * Closes the cross-catalyst causal-chain gap by *deterministically*
 * composing a multi-link root cause from substrate built by Phases
 * 10-1 (correlation_events) and 10-3 (signal_impacts):
 *
 *   "Margin↓ ← Procurement input cost↑ ← Brent +22% AND Picking
 *     efficiency↓ ← HR hiring lag"
 *
 * The existing diagnostics-engine-v2 calls an LLM per metric and
 * produces L0–L5 prose. This engine is the *cheap, deterministic*
 * counterpart that runs every cron tick and produces a verifiable
 * causal graph backed by quantitative evidence (Pearson r, signal
 * deltas, lag days). Both paths write to the same V2 tables
 * (root_cause_analyses, causal_factors), so consumers don't need to
 * branch.
 *
 * Method per red KPI:
 *  1. L0 — symptom: the red metric itself.
 *  2. L1 — direct external drivers: rows in signal_impacts whose
 *     analysis JSON references this metric_id.
 *  3. L2 — cross-metric drivers: peer metrics that co-move with the
 *     symptom in correlation_events (|r| ≥ 0.7, from Phase 10-1).
 *  4. L3 — transitive external drivers: signal_impacts on each of
 *     the L2 peer metrics — i.e. the macro signal that's driving the
 *     metric that's pulling the symptom around.
 *
 * Strong-inference gates:
 *  - Symptom must be process_metrics.status = 'red' (high signal of
 *    actual degradation; we don't synthesize for green/amber to keep
 *    the surface free of low-stakes noise).
 *  - ≥ 2 distinct causal factors (L1 OR L2 OR L3) — otherwise the
 *    chain reduces to "L0 plus nothing" and adds no value.
 *  - 24-hour per-metric debounce (active RCA on this metric within
 *    24h → skip).
 *  - Cap each layer at 3 drivers — readable chain over exhaustive one.
 */

import { logError, logInfo } from './logger';
import { getTenantCurrency } from './tenant-currency';
import {
  loadTenantMonthlyBase,
  estimateExternalDriverImpact,
  estimateCrossMetricImpact,
} from './financial-impact-quantifier';

const DEBOUNCE_HOURS = 24;
const MIN_CAUSAL_FACTORS = 2;
const MAX_LAYER_BREADTH = 3;

// ── Types ──────────────────────────────────────────────────────────────

interface MetricRow {
  id: string;
  name: string;
  value: number;
  unit: string | null;
  status: string;
  domain: string | null;
  threshold_red: number | null;
  threshold_amber: number | null;
  threshold_green: number | null;
}

interface SignalImpactRow {
  id: string;
  signal_id: string;
  health_dimension: string;
  impact_magnitude: number;
  impact_direction: string;
  confidence: number;
  analysis: string;
}

interface CorrelationEventRow {
  metric_a: string | null;
  metric_b: string | null;
  correlation_type: string | null;
  confidence: number;
  lag_hours: number | null;
  description: string | null;
}

export interface SynthesisResult {
  symptomsScanned: number;
  symptomsSkippedDebounced: number;
  symptomsSkippedThin: number;
  rcasCreated: number;
  factorsCreated: number;
}

// ── Helpers ────────────────────────────────────────────────────────────

interface ParsedSignalAnalysis {
  metric_id?: string;
  metric_name?: string;
  signal_title?: string;
  signal_source?: string;
  correlation?: number;
  best_lag_days?: number;
  signal_delta_pct?: number;
  metric_delta_pct?: number;
}

function parseAnalysis(raw: string | null): ParsedSignalAnalysis {
  if (!raw) return {};
  try { return JSON.parse(raw) as ParsedSignalAnalysis; } catch { return {}; }
}

/** Pull peer metric ids from a correlation_events row, given the symptom id. */
function peerMetricId(c: CorrelationEventRow, symptomId: string): string | null {
  if (c.metric_a === symptomId && c.metric_b) return c.metric_b;
  if (c.metric_b === symptomId && c.metric_a) return c.metric_a;
  return null;
}

/** Map signal_impacts.confidence (0..1) → causal_factors.confidence (0..100). */
function toFactorConfidence(x: number): number {
  return Math.round(Math.max(0, Math.min(1, x)) * 100);
}

// ── DB queries ─────────────────────────────────────────────────────────

async function activeRcaWithinDebounce(
  db: D1Database, tenantId: string, metricId: string,
): Promise<boolean> {
  try {
    const r = await db.prepare(
      `SELECT 1 FROM root_cause_analyses
        WHERE tenant_id = ? AND metric_id = ?
          AND generated_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, metricId, `-${DEBOUNCE_HOURS} hours`).first();
    return r !== null;
  } catch {
    return false;
  }
}

async function loadRedSymptoms(db: D1Database, tenantId: string): Promise<MetricRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, name, value, unit, status, domain,
              threshold_red, threshold_amber, threshold_green
         FROM process_metrics
        WHERE tenant_id = ? AND status = 'red'`
    ).bind(tenantId).all<MetricRow>();
    return r.results || [];
  } catch (err) {
    logError('cross_rca.load_metrics_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadSignalImpactsForMetric(
  db: D1Database, tenantId: string, metricId: string,
): Promise<SignalImpactRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, signal_id, health_dimension, impact_magnitude,
              impact_direction, confidence, analysis
         FROM signal_impacts
        WHERE tenant_id = ? AND analysis LIKE ?
        ORDER BY computed_at DESC
        LIMIT ?`
    ).bind(tenantId, `%"metric_id":"${metricId}"%`, MAX_LAYER_BREADTH).all<SignalImpactRow>();
    return r.results || [];
  } catch (err) {
    logError('cross_rca.load_signal_impacts_failed', err, { tenantId }, { metricId });
    return [];
  }
}

async function loadCorrelationsForMetric(
  db: D1Database, tenantId: string, metricId: string,
): Promise<CorrelationEventRow[]> {
  try {
    const r = await db.prepare(
      `SELECT metric_a, metric_b, correlation_type, confidence, lag_hours, description
         FROM correlation_events
        WHERE tenant_id = ?
          AND (metric_a = ? OR metric_b = ?)
          AND metric_a IS NOT NULL AND metric_b IS NOT NULL
        ORDER BY confidence DESC
        LIMIT ?`
    ).bind(tenantId, metricId, metricId, MAX_LAYER_BREADTH).all<CorrelationEventRow>();
    return r.results || [];
  } catch (err) {
    logError('cross_rca.load_correlations_failed', err, { tenantId }, { metricId });
    return [];
  }
}

async function loadMetricById(
  db: D1Database, tenantId: string, metricId: string,
): Promise<MetricRow | null> {
  try {
    const r = await db.prepare(
      `SELECT id, name, value, unit, status, domain,
              threshold_red, threshold_amber, threshold_green
         FROM process_metrics WHERE tenant_id = ? AND id = ?`
    ).bind(tenantId, metricId).first<MetricRow>();
    return r || null;
  } catch {
    return null;
  }
}

// ── Persistence ────────────────────────────────────────────────────────

interface PendingFactor {
  layer: 'L0' | 'L1' | 'L2' | 'L3';
  factor_type: 'symptom' | 'external_driver' | 'cross_metric' | 'transitive_external';
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  confidence: number; // 0..100
  impact_value: number | null;
  impact_unit: string;
}

async function persistRcaWithFactors(
  db: D1Database, tenantId: string, symptom: MetricRow, factors: PendingFactor[],
): Promise<{ rcaId: string; factorCount: number } | null> {
  const rcaId = crypto.randomUUID();
  const causalChainSummary = factors.map((f) => ({ layer: f.layer, title: f.title }));
  const avgConfidence = Math.round(
    factors.reduce((s, f) => s + f.confidence, 0) / factors.length,
  );
  try {
    await db.prepare(
      `INSERT INTO root_cause_analyses
         (id, tenant_id, metric_id, metric_name, trigger_status,
          causal_chain, confidence, status, generated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'active', datetime('now'))`
    ).bind(
      rcaId, tenantId, symptom.id, symptom.name, symptom.status,
      JSON.stringify(causalChainSummary), avgConfidence,
    ).run();
  } catch (err) {
    logError('cross_rca.rca_insert_failed', err, { tenantId }, { metricId: symptom.id });
    return null;
  }

  let factorCount = 0;
  for (const f of factors) {
    try {
      await db.prepare(
        `INSERT INTO causal_factors
           (id, rca_id, tenant_id, layer, factor_type, title, description,
            evidence, impact_value, impact_unit, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), rcaId, tenantId, f.layer, f.factor_type,
        f.title, f.description, JSON.stringify(f.evidence),
        f.impact_value, f.impact_unit, f.confidence,
      ).run();
      factorCount++;
    } catch (err) {
      logError('cross_rca.factor_insert_failed', err, { tenantId }, {
        rcaId, layer: f.layer,
      });
    }
  }
  return { rcaId, factorCount };
}

// ── Chain assembly ─────────────────────────────────────────────────────

function buildSymptomFactor(metric: MetricRow, currency: string): PendingFactor {
  return {
    layer: 'L0',
    factor_type: 'symptom',
    title: `${metric.name} degraded to ${metric.status}`,
    description: `${metric.name} is at ${metric.value} ${metric.unit ?? ''} (status: ${metric.status}). ` +
      `Thresholds — green: ${metric.threshold_green ?? 'n/a'}, amber: ${metric.threshold_amber ?? 'n/a'}, ` +
      `red: ${metric.threshold_red ?? 'n/a'}.`,
    evidence: {
      metric_id: metric.id, value: metric.value, status: metric.status, unit: metric.unit,
    },
    confidence: 95, // status is observed, not inferred
    impact_value: null,
    impact_unit: currency,
  };
}

function buildExternalDriverFactor(
  layer: 'L1' | 'L3',
  factorType: 'external_driver' | 'transitive_external',
  metric: MetricRow,
  impact: SignalImpactRow,
  currency: string,
  tenantBase: number | null,
): PendingFactor {
  const a = parseAnalysis(impact.analysis);
  const driverTitle = a.signal_title ?? 'external signal';
  const direction = impact.impact_direction;
  const dPct = a.signal_delta_pct;
  const r = a.correlation;
  const lag = a.best_lag_days;

  const title = layer === 'L1'
    ? `${driverTitle} driving ${metric.name} (${direction})`
    : `${driverTitle} driving ${metric.name} via correlated peer (${direction})`;

  const impactValue = estimateExternalDriverImpact(
    { value: metric.value, unit: metric.unit },
    a.signal_delta_pct, a.correlation, currency, tenantBase,
  );

  const description =
    `External signal "${driverTitle}" (${a.signal_source ?? 'unknown source'}) ` +
    `moved ${dPct !== undefined ? `${dPct.toFixed(1)}%` : 'significantly'} ` +
    `with Pearson r = ${r !== undefined ? r.toFixed(2) : 'n/a'} ` +
    `at lag ${lag ?? 'n/a'} days against ${metric.name}.` +
    (impactValue != null
      ? ` Estimated impact ≈ ${impactValue.toLocaleString()} ${currency}.`
      : '');

  return {
    layer,
    factor_type: factorType,
    title,
    description,
    evidence: {
      signal_id: impact.signal_id,
      signal_title: a.signal_title,
      signal_source: a.signal_source,
      health_dimension: impact.health_dimension,
      impact_direction: impact.impact_direction,
      impact_magnitude: impact.impact_magnitude,
      correlation: a.correlation,
      best_lag_days: a.best_lag_days,
      signal_delta_pct: a.signal_delta_pct,
      metric_delta_pct: a.metric_delta_pct,
      target_metric_id: metric.id,
    },
    confidence: toFactorConfidence(impact.confidence),
    impact_value: impactValue,
    impact_unit: currency,
  };
}

function buildCrossMetricFactor(
  symptom: MetricRow, peer: MetricRow, edge: CorrelationEventRow,
  currency: string, tenantBase: number | null,
): PendingFactor {
  const directionWord = edge.correlation_type === 'negative' ? 'inversely co-moves with' : 'co-moves with';
  const impactValue = estimateCrossMetricImpact(
    { value: symptom.value, unit: symptom.unit },
    null, edge.confidence ?? 0, currency, tenantBase,
  );
  return {
    layer: 'L2',
    factor_type: 'cross_metric',
    title: `${peer.name} ${directionWord} ${symptom.name}`,
    description: (
      `${peer.name} (${peer.status}, ${peer.value} ${peer.unit ?? ''}) ` +
      `${directionWord} ${symptom.name} with confidence ${(edge.confidence ?? 0).toFixed(2)} ` +
      `at lag ${edge.lag_hours ?? 0}h. ${edge.description ?? ''}`.trim() +
      (impactValue != null ? ` Estimated impact ≈ ${impactValue.toLocaleString()} ${currency}.` : '')
    ).trim(),
    evidence: {
      symptom_metric_id: symptom.id,
      peer_metric_id: peer.id,
      peer_metric_name: peer.name,
      peer_status: peer.status,
      peer_domain: peer.domain,
      correlation_type: edge.correlation_type,
      confidence: edge.confidence,
      lag_hours: edge.lag_hours,
    },
    confidence: toFactorConfidence(edge.confidence ?? 0),
    impact_value: impactValue,
    impact_unit: currency,
  };
}

async function assembleChain(
  db: D1Database, tenantId: string, symptom: MetricRow,
  currency: string, tenantBase: number | null,
): Promise<PendingFactor[]> {
  const factors: PendingFactor[] = [buildSymptomFactor(symptom, currency)];

  // L1 — direct external drivers of the symptom
  const directImpacts = await loadSignalImpactsForMetric(db, tenantId, symptom.id);
  for (const imp of directImpacts) {
    factors.push(buildExternalDriverFactor('L1', 'external_driver', symptom, imp, currency, tenantBase));
  }

  // L2 — cross-metric drivers (peer metrics co-moving with the symptom)
  const edges = await loadCorrelationsForMetric(db, tenantId, symptom.id);
  const peerIds: string[] = [];
  for (const edge of edges) {
    const peerId = peerMetricId(edge, symptom.id);
    if (!peerId || peerIds.includes(peerId)) continue;
    const peer = await loadMetricById(db, tenantId, peerId);
    if (!peer) continue;
    peerIds.push(peerId);
    factors.push(buildCrossMetricFactor(symptom, peer, edge, currency, tenantBase));

    // L3 — transitive external driver: a signal that drives this peer.
    const peerImpacts = await loadSignalImpactsForMetric(db, tenantId, peerId);
    for (const pImp of peerImpacts.slice(0, 1)) {
      factors.push(buildExternalDriverFactor('L3', 'transitive_external', peer, pImp, currency, tenantBase));
    }
  }

  return factors;
}

// ── Main entry ─────────────────────────────────────────────────────────

export async function synthesizeCrossCatalystRca(
  db: D1Database, tenantId: string,
): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    symptomsScanned: 0, symptomsSkippedDebounced: 0, symptomsSkippedThin: 0,
    rcasCreated: 0, factorsCreated: 0,
  };

  const symptoms = await loadRedSymptoms(db, tenantId);
  result.symptomsScanned = symptoms.length;
  if (symptoms.length === 0) return result;

  const currency = await getTenantCurrency(db, tenantId);
  const tenantBase = await loadTenantMonthlyBase(db, tenantId);

  for (const symptom of symptoms) {
    if (await activeRcaWithinDebounce(db, tenantId, symptom.id)) {
      result.symptomsSkippedDebounced++;
      continue;
    }
    const factors = await assembleChain(db, tenantId, symptom, currency, tenantBase);
    // factors[0] is L0 symptom; everything beyond is signal/correlation drivers.
    const driverCount = factors.length - 1;
    if (driverCount < MIN_CAUSAL_FACTORS) {
      result.symptomsSkippedThin++;
      continue;
    }
    const persisted = await persistRcaWithFactors(db, tenantId, symptom, factors);
    if (persisted) {
      result.rcasCreated++;
      result.factorsCreated += persisted.factorCount;
    }
  }

  if (result.rcasCreated > 0) {
    logInfo(
      'cross_rca.synthesis_completed',
      { tenantId, layer: 'analytics', action: 'cross_rca' },
      { ...result },
    );
  }
  return result;
}
