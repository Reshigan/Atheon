/**
 * Cross-Tenant Pattern Discovery — Phase 10-18.
 *
 * When ≥ MIN_TENANTS_PER_PATTERN tenants in the same industry have the
 * same external-driver → KPI attribution, that constitutes evidence of
 * a generalisable industry pattern. We persist these to
 * `industry_patterns` so that:
 *
 *   1. A NEW tenant in that industry can be seeded with expected
 *      attributions on day 1, before they've accumulated their own
 *      history (Phase 10-3 needs ≥10 paired observations).
 *   2. The Apex narrative for an existing tenant can frame an
 *      observed driver as "industry-wide" vs "your specific exposure",
 *      which informs whether the response is to hedge (everyone is
 *      hit) or to differentiate (only you).
 *
 * Privacy: only NAMES (signal_key, normalised metric name, industry)
 * are persisted across tenants — no per-tenant values, no per-tenant
 * counts beyond an aggregate. The supporting_tenant_count is the only
 * cross-tenant statistic exposed and is bounded to ≥ MIN_TENANTS so
 * a single tenant can never be deanonymised.
 *
 * Strong-inference policy:
 *   - Need ≥ 3 tenants in same industry with the same attribution
 *     before persisting (matches the project memory: ≥25 sample,
 *     ≥70% mode share — adapted: ≥3 distinct tenants AND average
 *     correlation ≥ 0.65 across them)
 *   - Industry inference reused from Phase 10-7 (industry-profile.ts)
 *   - Metric names normalised (lowercased, slugified) so "Procurement
 *     Input Cost" and "procurement input cost" cluster together
 *   - Patterns are global (no tenant_id) — they're discoveries about
 *     the world, not customer data
 */

import { logError, logInfo } from './logger';
import { inferTenantIndustryProfile, type Industry } from './industry-profile';

const MIN_TENANTS_PER_PATTERN = 3;
const MIN_AVG_CORRELATION = 0.65;
const SIGNAL_IMPACT_LOOKBACK_DAYS = 90;

// ── Types ──────────────────────────────────────────────────────────────

export interface DiscoveredPattern {
  industry: Industry;
  signal_key: string;
  metric_name_normalised: string;
  supporting_tenant_count: number;
  avg_correlation: number;
  avg_signal_delta_pct: number | null;
  common_impact_direction: string;
}

interface RawSignalImpactRow {
  tenant_id: string;
  analysis: string;
  impact_direction: string;
}

interface ParsedAnalysis {
  signal_title?: string;
  signal_source?: string;
  metric_name?: string;
  correlation?: number;
  signal_delta_pct?: number;
}

interface PatternKey {
  industry: Industry;
  signal_key: string;
  metric_name_normalised: string;
}
interface PatternBucket {
  key: PatternKey;
  tenants: Set<string>;
  correlations: number[];
  signalDeltas: number[];
  directions: Map<string, number>;
}

// ── Helpers ────────────────────────────────────────────────────────────

export function normaliseMetricName(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function parseAnalysis(raw: string): ParsedAnalysis {
  try { return JSON.parse(raw) as ParsedAnalysis; } catch { return {}; }
}

/** Derive a stable signal_key from analysis JSON. signal_impacts'
 *  analysis carries a signal_title (e.g. "Brent crude spot price") and
 *  signal_source (e.g. "EIA"). We use the title's slugified form as
 *  the cross-tenant key since it's stable across the platform. */
function signalKeyFromAnalysis(a: ParsedAnalysis): string | null {
  if (!a.signal_title) return null;
  return a.signal_title.toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

function bucketKeyOf(k: PatternKey): string {
  return `${k.industry}|${k.signal_key}|${k.metric_name_normalised}`;
}

function avg(xs: number[]): number {
  if (xs.length === 0) return 0;
  return xs.reduce((s, v) => s + v, 0) / xs.length;
}

function modeDirection(directions: Map<string, number>): string {
  let best: string = 'headwind';
  let bestN = 0;
  for (const [dir, n] of directions) {
    if (n > bestN) { best = dir; bestN = n; }
  }
  return best;
}

// ── DB ─────────────────────────────────────────────────────────────────

async function loadActiveTenants(db: D1Database): Promise<string[]> {
  try {
    const r = await db.prepare(
      `SELECT id FROM tenants WHERE status = 'active'`
    ).all<{ id: string }>();
    return (r.results || []).map((t) => t.id);
  } catch (err) {
    logError('cross_tenant_patterns.tenants_failed', err, { tenantId: 'global' }, {});
    return [];
  }
}

async function loadRecentSignalImpacts(
  db: D1Database, tenantId: string,
): Promise<RawSignalImpactRow[]> {
  try {
    const r = await db.prepare(
      `SELECT tenant_id, analysis, impact_direction
         FROM signal_impacts
        WHERE tenant_id = ?
          AND computed_at > datetime('now', ?)`
    ).bind(tenantId, `-${SIGNAL_IMPACT_LOOKBACK_DAYS} days`).all<RawSignalImpactRow>();
    return r.results || [];
  } catch {
    return [];
  }
}

async function persistPattern(db: D1Database, p: DiscoveredPattern): Promise<boolean> {
  try {
    await db.prepare(
      `INSERT INTO industry_patterns
         (id, industry, signal_key, metric_name_normalised,
          supporting_tenant_count, avg_correlation, avg_signal_delta_pct,
          common_impact_direction, last_observed_at, discovered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'))
       ON CONFLICT(industry, signal_key, metric_name_normalised) DO UPDATE SET
         supporting_tenant_count = excluded.supporting_tenant_count,
         avg_correlation = excluded.avg_correlation,
         avg_signal_delta_pct = excluded.avg_signal_delta_pct,
         common_impact_direction = excluded.common_impact_direction,
         last_observed_at = excluded.last_observed_at,
         updated_at = excluded.updated_at`
    ).bind(
      crypto.randomUUID(), p.industry, p.signal_key, p.metric_name_normalised,
      p.supporting_tenant_count, p.avg_correlation, p.avg_signal_delta_pct,
      p.common_impact_direction,
    ).run();
    return true;
  } catch (err) {
    logError('cross_tenant_patterns.persist_failed', err, { tenantId: 'global' },
      { industry: p.industry, signal_key: p.signal_key });
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

export interface PatternDiscoveryResult {
  tenantsScanned: number;
  attributionsConsidered: number;
  candidateGroups: number;
  patternsPersisted: number;
}

/** Pure helper exposed for tests: given a list of (tenant, industry,
 *  attribution rows), bucket and decide which qualify. */
export function discoverPatternsFromBuckets(
  buckets: Map<string, PatternBucket>,
): DiscoveredPattern[] {
  const out: DiscoveredPattern[] = [];
  for (const b of buckets.values()) {
    if (b.tenants.size < MIN_TENANTS_PER_PATTERN) continue;
    const ar = avg(b.correlations);
    if (ar < MIN_AVG_CORRELATION) continue;
    out.push({
      industry: b.key.industry,
      signal_key: b.key.signal_key,
      metric_name_normalised: b.key.metric_name_normalised,
      supporting_tenant_count: b.tenants.size,
      avg_correlation: Number(ar.toFixed(3)),
      avg_signal_delta_pct: b.signalDeltas.length > 0
        ? Number(avg(b.signalDeltas).toFixed(2)) : null,
      common_impact_direction: modeDirection(b.directions),
    });
  }
  return out;
}

export async function discoverIndustryPatterns(
  db: D1Database,
): Promise<PatternDiscoveryResult> {
  const result: PatternDiscoveryResult = {
    tenantsScanned: 0, attributionsConsidered: 0,
    candidateGroups: 0, patternsPersisted: 0,
  };

  const tenants = await loadActiveTenants(db);
  result.tenantsScanned = tenants.length;
  if (tenants.length < MIN_TENANTS_PER_PATTERN) return result;

  // Compute industry profile per tenant in parallel
  const profileByTenant = new Map<string, ReadonlyArray<Industry>>();
  await Promise.all(tenants.map(async (t) => {
    try {
      const p = await inferTenantIndustryProfile(db, t);
      profileByTenant.set(t, p.industries);
    } catch {
      profileByTenant.set(t, ['general']);
    }
  }));

  // Bucket by (industry × signal_key × metric_name_normalised)
  const buckets = new Map<string, PatternBucket>();
  for (const tenantId of tenants) {
    const industries = profileByTenant.get(tenantId) ?? ['general'];
    const impacts = await loadRecentSignalImpacts(db, tenantId);
    result.attributionsConsidered += impacts.length;

    for (const imp of impacts) {
      const a = parseAnalysis(imp.analysis);
      const sigKey = signalKeyFromAnalysis(a);
      if (!sigKey || !a.metric_name) continue;
      const metricKey = normaliseMetricName(a.metric_name);
      const corr = typeof a.correlation === 'number' ? Math.abs(a.correlation) : null;
      if (corr == null) continue;
      const sigDelta = typeof a.signal_delta_pct === 'number' ? a.signal_delta_pct : null;

      // For each tenant industry, contribute to that industry's bucket.
      // Skip 'general' — pattern is too broad to be useful.
      for (const ind of industries) {
        if (ind === 'general') continue;
        const key: PatternKey = { industry: ind, signal_key: sigKey, metric_name_normalised: metricKey };
        const bk = bucketKeyOf(key);
        let bucket = buckets.get(bk);
        if (!bucket) {
          bucket = {
            key,
            tenants: new Set(),
            correlations: [],
            signalDeltas: [],
            directions: new Map(),
          };
          buckets.set(bk, bucket);
        }
        bucket.tenants.add(tenantId);
        bucket.correlations.push(corr);
        if (sigDelta != null) bucket.signalDeltas.push(sigDelta);
        const dir = imp.impact_direction || 'headwind';
        bucket.directions.set(dir, (bucket.directions.get(dir) ?? 0) + 1);
      }
    }
  }

  result.candidateGroups = buckets.size;

  const patterns = discoverPatternsFromBuckets(buckets);
  for (const p of patterns) {
    const ok = await persistPattern(db, p);
    if (ok) result.patternsPersisted++;
  }

  if (result.patternsPersisted > 0) {
    logInfo(
      'cross_tenant_patterns.discovery_completed',
      { tenantId: 'global', layer: 'analytics', action: 'pattern_discovery' },
      { ...result },
    );
  }
  return result;
}

// ── Suggestions API for new tenants ────────────────────────────────────

export interface IndustryPatternSuggestion {
  industry: Industry;
  signal_title: string;            // un-slugified for display
  metric_name: string;             // un-slugified for display
  supporting_tenant_count: number;
  avg_correlation: number;
  common_impact_direction: string;
}

interface PatternRow {
  industry: string;
  signal_key: string;
  metric_name_normalised: string;
  supporting_tenant_count: number;
  avg_correlation: number;
  common_impact_direction: string;
}

function unslugify(s: string): string {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** For a given tenant, look up applicable industry_patterns based on
 *  the inferred industry profile. Returns suggestions sorted by
 *  supporting_tenant_count desc + avg_correlation desc. */
export async function getIndustryPatternSuggestions(
  db: D1Database, tenantId: string, limit = 10,
): Promise<IndustryPatternSuggestion[]> {
  let industries: ReadonlyArray<Industry>;
  try {
    const p = await inferTenantIndustryProfile(db, tenantId);
    industries = p.industries.filter((i) => i !== 'general');
  } catch {
    return [];
  }
  if (industries.length === 0) return [];

  const placeholders = industries.map(() => '?').join(',');
  try {
    const r = await db.prepare(
      `SELECT industry, signal_key, metric_name_normalised,
              supporting_tenant_count, avg_correlation, common_impact_direction
         FROM industry_patterns
        WHERE industry IN (${placeholders})
        ORDER BY supporting_tenant_count DESC, avg_correlation DESC
        LIMIT ?`
    ).bind(...industries, limit).all<PatternRow>();
    return (r.results || []).map((row) => ({
      industry: row.industry as Industry,
      signal_title: unslugify(row.signal_key),
      metric_name: unslugify(row.metric_name_normalised),
      supporting_tenant_count: row.supporting_tenant_count,
      avg_correlation: row.avg_correlation,
      common_impact_direction: row.common_impact_direction,
    }));
  } catch (err) {
    logError('cross_tenant_patterns.suggestions_failed', err, { tenantId }, {});
    return [];
  }
}
