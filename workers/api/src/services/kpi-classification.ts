/**
 * KPI Classification — Phase 10-6.
 *
 * Lets Atheon reason about ARBITRARY customer-defined KPIs without
 * hardcoded taxonomies. Until this module landed, the analytics layer
 * had three places where unknown KPIs silently collapsed into the
 * `operational` bucket:
 *
 *   1. signal-kpi-attribution.classifyHealthDimension — 5 fixed
 *      keyword branches, everything else → 'operational'.
 *   2. signal-kpi-attribution.classifyImpactDirection — only
 *      cost/revenue/financial had business semantics; everything
 *      else used the correlation sign as a guess.
 *   3. insights-engine.DOMAIN_TO_DIMENSIONS — 25 hardcoded industry
 *      keys, anything else → ['operational'].
 *
 * The fix has two pillars:
 *
 *  A. **KPI direction is universal.** Every KPI is either
 *     `higher_better` (e.g. revenue, margin) or `lower_better` (e.g.
 *     defect rate, lead time). Customers declare this on
 *     `sub_catalyst_kpi_definitions.direction`. If they haven't
 *     declared, we infer from threshold ordering (amber > red ⇒
 *     higher_better). Once we know the direction, impact-direction
 *     classification (headwind | tailwind) becomes universal — no
 *     dimension-specific branches.
 *
 *  B. **Unknown domains pass through as themselves.** A KPI with
 *     domain "sustainability" should be reasoned about as the
 *     `sustainability` dimension, not silently merged into
 *     `operational`. Well-known industry domains canonicalise to a
 *     small standard set (cost / revenue / financial / people /
 *     operational) for UI consistency; everything else keeps the
 *     customer's own term, slugified.
 */

export type KpiDirection = 'higher_better' | 'lower_better';

export interface ThresholdSet {
  red: number | null;
  amber: number | null;
  green: number | null;
}

// ── Direction ──────────────────────────────────────────────────────────

/** Infer direction from threshold ordering. amber > red ⇒ higher is better
 *  (e.g. green=80, amber=60, red=40). Returns null if thresholds missing. */
export function inferKpiDirectionFromThresholds(t: ThresholdSet): KpiDirection | null {
  if (t.red == null || t.amber == null) return null;
  return t.amber > t.red ? 'higher_better' : 'lower_better';
}

/** Look up the direction declared on a sub_catalyst_kpi_definitions row. */
export async function loadDeclaredKpiDirection(
  db: D1Database, tenantId: string, kpiName: string,
): Promise<KpiDirection | null> {
  try {
    const r = await db.prepare(
      `SELECT direction FROM sub_catalyst_kpi_definitions
        WHERE tenant_id = ? AND kpi_name = ? AND enabled = 1
        ORDER BY sort_order ASC, created_at DESC LIMIT 1`
    ).bind(tenantId, kpiName).first<{ direction: string | null }>();
    if (!r || !r.direction) return null;
    return r.direction === 'lower_better' ? 'lower_better' : 'higher_better';
  } catch {
    return null;
  }
}

/** Resolve a KPI's direction. Order of preference:
 *   1. Customer declaration on sub_catalyst_kpi_definitions
 *   2. Threshold-ordering inference (amber > red ⇒ higher_better)
 *   3. Canonical-dimension hint (cost ⇒ lower_better; revenue/financial
 *      ⇒ higher_better) — last-resort fallback when neither declaration
 *      nor thresholds are present
 *   4. Default 'higher_better' (most KPIs are higher-is-better)
 */
export async function resolveKpiDirection(
  db: D1Database, tenantId: string, kpiName: string,
  thresholds: ThresholdSet, domainHint?: string | null,
): Promise<KpiDirection> {
  const declared = await loadDeclaredKpiDirection(db, tenantId, kpiName);
  if (declared) return declared;

  const inferred = inferKpiDirectionFromThresholds(thresholds);
  if (inferred) return inferred;

  if (domainHint) {
    const dim = canonicaliseDimension(domainHint);
    if (dim === 'cost') return 'lower_better';
    if (dim === 'revenue' || dim === 'financial') return 'higher_better';
  }
  return 'higher_better';
}

// ── Dimension ──────────────────────────────────────────────────────────

/** Well-known industry-domain → canonical-dimension mappings. Used as
 *  a fast-path normalisation for the common cases. The match is regex
 *  on a lowercased domain string so 'procurement', 'procurement-supply',
 *  'sub-catalyst-procurement' all map to 'cost'.
 */
const CANONICAL_DOMAIN_RULES: Array<[RegExp, string]> = [
  [/finance|treasury/, 'financial'],
  [/procurement|supply/, 'cost'],
  [/sales|revenue/, 'revenue'],
  [/hr\b|workforce|people|staffing/, 'people'],
  [/operations?\b|operational/, 'operational'],
  [/compliance|risk|audit/, 'compliance'],
  [/tech|engineering|devops|security/, 'technology'],
  [/strateg/, 'strategic'],
];

/** Normalise a free-text domain into a dimension key. Well-known industry
 *  domains canonicalise to standard buckets; anything else passes through
 *  as the customer's own slugified term. Never silently buries an unknown
 *  domain in 'operational' — that loses the customer's intent.
 */
export function canonicaliseDimension(input: string | null | undefined): string {
  if (!input) return 'operational';
  const lower = input.toLowerCase().trim();
  if (!lower) return 'operational';
  for (const [re, canon] of CANONICAL_DOMAIN_RULES) {
    if (re.test(lower)) return canon;
  }
  // Unknown domain — preserve the customer's own naming, slugified.
  const slug = lower.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || 'operational';
}

/** Same as canonicaliseDimension but accepts category as an additional
 *  hint. Category (from sub_catalyst_kpi_definitions.category) is the
 *  customer's authoritative classification when present and takes
 *  precedence over a free-text domain. */
export function canonicaliseDimensionWithCategory(
  domain: string | null | undefined,
  category: string | null | undefined,
): string {
  if (category && category.toLowerCase().trim() !== 'universal') {
    return canonicaliseDimension(category);
  }
  return canonicaliseDimension(domain);
}

// ── Impact direction ───────────────────────────────────────────────────

/** Decide whether a correlated signal is a headwind or tailwind for a
 *  KPI. By the time this is called the caller has already gated on
 *  |r| ≥ MIN_CORRELATION, so the *sign* of correlation is no longer
 *  load-bearing — it only tells you which way the signal moved, not
 *  whether the relationship is real. What determines headwind vs
 *  tailwind is whether the KPI itself moved in its BAD direction:
 *
 *    - higher_better KPI that moved DOWN ⇒ adverse ⇒ correlated signal
 *      is a HEADWIND (the signal's movement explains the bad motion)
 *    - higher_better KPI that moved UP ⇒ favourable ⇒ TAILWIND
 *    - lower_better KPI that moved UP ⇒ adverse ⇒ HEADWIND
 *    - lower_better KPI that moved DOWN ⇒ favourable ⇒ TAILWIND
 *
 *  The previous dimension-specific branches (cost vs revenue vs
 *  financial) collapse into this single rule once you know the KPI's
 *  direction — and EVERY KPI has a direction (declared, inferred from
 *  thresholds, or defaulted), so this works for arbitrary customer-
 *  defined KPIs.
 */
export function classifyImpactDirection(
  metricDeltaPct: number,
  kpiDirection: KpiDirection,
): 'headwind' | 'tailwind' {
  const metricUp = metricDeltaPct > 0;
  const metricMovedAdversely =
    kpiDirection === 'higher_better' ? !metricUp : metricUp;
  return metricMovedAdversely ? 'headwind' : 'tailwind';
}
