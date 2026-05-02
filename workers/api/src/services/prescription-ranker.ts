/**
 * Prescription Ranker — Phase 10-13.
 *
 * Deterministically ranks `diagnostic_prescriptions` rows by
 * (impact × confidence) / effort, so Apex tells you what to *do*,
 * not just what's happening. The diagnostics-engine-v2 LLM populates
 * prescriptions with priority='immediate|short-term|strategic',
 * effort_level='low|medium|high', and free-text expected_impact —
 * useful but not directly sortable. This module produces a numeric
 * priority_score on the fly and returns a sorted list.
 *
 * Score formula:
 *
 *   priority_score = impact_score × confidence_score / effort_weight
 *
 * Where:
 *   - impact_score: from the parent RCA's max(causal_factors.impact_value)
 *     (Phase 10-10 quantified amount), normalised to 0..1 against the
 *     tenant's largest RCA impact in the same window. Falls back to a
 *     priority-tag heuristic when no monetary value exists.
 *   - confidence_score: rca.confidence (0..100) → 0..1. The RCA's own
 *     confidence is the customer's trust anchor.
 *   - effort_weight: low=1, medium=2, high=3. Inverse: low effort =
 *     higher score for the same impact.
 *
 * No persistence — pure computation on read. Apex narrative + any UI
 * sort by priority_score; the underlying prescription rows stay
 * untouched. This means re-tuning the weights doesn't require a
 * migration.
 *
 * Strong-inference policy: when both impact and confidence are missing,
 * fall back to the existing priority tag (immediate=3, short-term=2,
 * strategic=1) so the ranker doesn't silently drop unranked
 * prescriptions to 0 — preserves the existing categorical signal.
 */

import { logError } from './logger';

const EFFORT_WEIGHT: Record<string, number> = {
  low: 1, medium: 2, high: 3,
};

const PRIORITY_TAG_SCORE: Record<string, number> = {
  immediate: 0.9, 'short-term': 0.6, strategic: 0.3,
};

interface PrescriptionRow {
  id: string;
  rca_id: string;
  title: string;
  description: string;
  expected_impact: string | null;
  effort_level: string;
  responsible_domain: string | null;
  status: string;
  priority: string;
}

interface RcaRow {
  id: string;
  metric_id: string;
  metric_name: string;
  trigger_status: string;
  confidence: number;
}

interface FactorImpact {
  rca_id: string;
  max_impact: number | null;
}

export interface RankedPrescription {
  id: string;
  rca_id: string;
  rca_metric_name: string;
  title: string;
  description: string;
  expected_impact: string | null;
  effort_level: string;
  priority_tag: string;
  /** Computed ranked score in [0, ~1+]. Higher = act sooner. */
  priority_score: number;
  /** Components for explainability — UI can show what drove the score. */
  components: {
    impact_score: number;
    confidence_score: number;
    effort_weight: number;
    impact_basis: 'monetary' | 'priority_tag';
  };
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Normalise a tenant's per-RCA monetary impact to [0,1] against the
 *  max in the same window, so a tenant with one R10M RCA + one R200K
 *  RCA still gets a useful spread. */
function normaliseImpacts(rawByRca: Map<string, number | null>): Map<string, number> {
  const out = new Map<string, number>();
  let max = 0;
  for (const v of rawByRca.values()) {
    if (v != null && v > max) max = v;
  }
  if (max === 0) {
    for (const k of rawByRca.keys()) out.set(k, 0);
    return out;
  }
  for (const [k, v] of rawByRca) {
    out.set(k, v != null ? Math.min(1, v / max) : 0);
  }
  return out;
}

export function computePriorityScore(opts: {
  rcaConfidence: number;          // 0..100
  rcaImpactNormalised: number;    // 0..1
  effortLevel: string;
  priorityTag: string;
}): { score: number; components: RankedPrescription['components'] } {
  const effort = EFFORT_WEIGHT[opts.effortLevel.toLowerCase()] ?? 2;
  const conf = Math.max(0, Math.min(1, opts.rcaConfidence / 100));
  let impact = opts.rcaImpactNormalised;
  let basis: 'monetary' | 'priority_tag' = 'monetary';
  if (impact <= 0) {
    // Fall back to the categorical priority tag so we don't silently zero out
    impact = PRIORITY_TAG_SCORE[opts.priorityTag.toLowerCase()] ?? 0.5;
    basis = 'priority_tag';
  }
  const score = (impact * conf) / effort;
  return {
    score: Number(score.toFixed(4)),
    components: {
      impact_score: Number(impact.toFixed(4)),
      confidence_score: Number(conf.toFixed(4)),
      effort_weight: effort,
      impact_basis: basis,
    },
  };
}

// ── DB ─────────────────────────────────────────────────────────────────

async function loadActiveRcas(db: D1Database, tenantId: string): Promise<RcaRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, trigger_status, confidence
         FROM root_cause_analyses
        WHERE tenant_id = ? AND status = 'active'`
    ).bind(tenantId).all<RcaRow>();
    return r.results || [];
  } catch (err) {
    logError('prescription_ranker.load_rcas_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadMaxImpactByRca(
  db: D1Database, tenantId: string, rcaIds: string[],
): Promise<Map<string, number | null>> {
  const out = new Map<string, number | null>();
  if (rcaIds.length === 0) return out;
  const placeholders = rcaIds.map(() => '?').join(',');
  try {
    const r = await db.prepare(
      `SELECT rca_id, MAX(impact_value) as max_impact
         FROM causal_factors
        WHERE tenant_id = ? AND rca_id IN (${placeholders})
        GROUP BY rca_id`
    ).bind(tenantId, ...rcaIds).all<FactorImpact>();
    for (const row of r.results || []) {
      out.set(row.rca_id, row.max_impact);
    }
  } catch (err) {
    logError('prescription_ranker.load_impacts_failed', err, { tenantId }, {});
  }
  for (const id of rcaIds) if (!out.has(id)) out.set(id, null);
  return out;
}

async function loadPrescriptionsForRcas(
  db: D1Database, tenantId: string, rcaIds: string[],
): Promise<PrescriptionRow[]> {
  if (rcaIds.length === 0) return [];
  const placeholders = rcaIds.map(() => '?').join(',');
  try {
    const r = await db.prepare(
      `SELECT id, rca_id, title, description, expected_impact,
              effort_level, responsible_domain, status, priority
         FROM diagnostic_prescriptions
        WHERE tenant_id = ? AND rca_id IN (${placeholders}) AND status = 'pending'`
    ).bind(tenantId, ...rcaIds).all<PrescriptionRow>();
    return r.results || [];
  } catch (err) {
    logError('prescription_ranker.load_prescriptions_failed', err, { tenantId }, {});
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────

/** Returns active prescriptions sorted by priority_score desc.
 *  Empty array when there are no active RCAs / pending prescriptions. */
export async function getPrioritisedPrescriptions(
  db: D1Database, tenantId: string,
): Promise<RankedPrescription[]> {
  const rcas = await loadActiveRcas(db, tenantId);
  if (rcas.length === 0) return [];
  const rcaById = new Map(rcas.map((r) => [r.id, r]));

  const ids = rcas.map((r) => r.id);
  const [rawImpacts, prescriptions] = await Promise.all([
    loadMaxImpactByRca(db, tenantId, ids),
    loadPrescriptionsForRcas(db, tenantId, ids),
  ]);
  if (prescriptions.length === 0) return [];

  const normalised = normaliseImpacts(rawImpacts);

  const ranked: RankedPrescription[] = [];
  for (const p of prescriptions) {
    const rca = rcaById.get(p.rca_id);
    if (!rca) continue;
    const { score, components } = computePriorityScore({
      rcaConfidence: rca.confidence,
      rcaImpactNormalised: normalised.get(rca.id) ?? 0,
      effortLevel: p.effort_level,
      priorityTag: p.priority,
    });
    ranked.push({
      id: p.id,
      rca_id: p.rca_id,
      rca_metric_name: rca.metric_name,
      title: p.title,
      description: p.description,
      expected_impact: p.expected_impact,
      effort_level: p.effort_level,
      priority_tag: p.priority,
      priority_score: score,
      components,
    });
  }
  return ranked.sort((a, b) => b.priority_score - a.priority_score);
}
