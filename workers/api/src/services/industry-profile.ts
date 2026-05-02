/**
 * Tenant Industry Profile — Phase 10-7.
 *
 * Derives a tenant's industry mix from data they already produce
 * (process_metrics.domain, sub_catalyst_kpi_definitions.category,
 * catalyst_clusters.domain) — no manually-filled industry column. The
 * inference is keyword-based and cumulative: a tenant whose KPIs span
 * "mining-equipment" + "mfg-production" gets tagged `mining` AND
 * `manufacturing`, not forced into one bucket.
 *
 * The output is consumed by the external-signals feed to decide which
 * sources to pull per tenant. A pure-tech tenant won't get weather
 * data; an agri tenant will. Same FX is pulled for everyone (currency
 * affects every business with international touchpoints).
 *
 * Design choices:
 *  - Cumulative tags, not single-bucket: real businesses span industries.
 *  - Confidence per tag: the more KPI/domain signals matching a keyword,
 *    the higher the score. Helps downstream rank sources.
 *  - 'general' fallback when no strong industry signal: don't filter
 *    sources aggressively when we can't tell — false negatives are
 *    cheap (one extra signal to ignore), false silence is expensive
 *    (no external context at all).
 */

import { logError } from './logger';

export type Industry =
  | 'mining'
  | 'agriculture'
  | 'healthcare'
  | 'fmcg'
  | 'logistics'
  | 'manufacturing'
  | 'finance'
  | 'technology'
  | 'general';

export interface IndustryProfile {
  /** Industries inferred from this tenant's data, sorted by confidence desc. */
  industries: Industry[];
  /** Per-industry confidence score (count of matching domain/category strings). */
  scores: Partial<Record<Industry, number>>;
  /** Source rows that contributed to the inference (for observability). */
  derivedFrom: { domains: number; categories: number; clusters: number };
}

// ── Keyword rules ──────────────────────────────────────────────────────

const INDUSTRY_RULES: Array<[Industry, RegExp]> = [
  ['mining', /\bmining\b|\bmine\b|\bore\b|smelter|tailings/],
  ['agriculture', /\bagri|\bfarm|\bcrop|irrigation|harvest|livestock/],
  ['healthcare', /\bhealth|patient|hospital|clinic|pharma|medical|nursing/],
  ['fmcg', /\bfmcg\b|consumer-?good|retail|grocer|trade-?spend|shelf|distributor/],
  ['logistics', /logistics|fleet|warehous|distribut|haulage|freight|port-?\b/],
  ['manufacturing', /manufactur|\bmfg\b|production|factory|assembly|line/],
  ['finance', /\bfinance\b|treasury|banking|capital|invest|insurance|fintech/],
  ['technology', /\btech\b|software|saas|devops|cybersec|cloud|engineering/],
];

function classifyOne(input: string): Industry[] {
  if (!input) return [];
  const lower = input.toLowerCase();
  const hits: Industry[] = [];
  for (const [industry, re] of INDUSTRY_RULES) {
    if (re.test(lower)) hits.push(industry);
  }
  return hits;
}

// ── DB queries ─────────────────────────────────────────────────────────

async function loadDistinctDomains(db: D1Database, tenantId: string): Promise<string[]> {
  try {
    const r = await db.prepare(
      `SELECT DISTINCT domain FROM process_metrics
        WHERE tenant_id = ? AND domain IS NOT NULL AND domain != ''`
    ).bind(tenantId).all<{ domain: string }>();
    return (r.results || []).map((x) => x.domain);
  } catch (err) {
    logError('industry_profile.load_domains_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadDistinctKpiCategories(db: D1Database, tenantId: string): Promise<string[]> {
  try {
    const r = await db.prepare(
      `SELECT DISTINCT category FROM sub_catalyst_kpi_definitions
        WHERE tenant_id = ? AND category IS NOT NULL AND category != ''`
    ).bind(tenantId).all<{ category: string }>();
    return (r.results || []).map((x) => x.category);
  } catch (err) {
    logError('industry_profile.load_categories_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadDistinctClusterDomains(db: D1Database, tenantId: string): Promise<string[]> {
  try {
    const r = await db.prepare(
      `SELECT DISTINCT domain FROM catalyst_clusters
        WHERE tenant_id = ? AND domain IS NOT NULL AND domain != ''`
    ).bind(tenantId).all<{ domain: string }>();
    return (r.results || []).map((x) => x.domain);
  } catch (err) {
    logError('industry_profile.load_clusters_failed', err, { tenantId }, {});
    return [];
  }
}

// ── Main ──────────────────────────────────────────────────────────────

/** Pure inference: given a list of strings, score each industry by
 *  number of matches. Exposed for tests / direct callers that want to
 *  classify already-loaded data without re-querying. */
export function classifyIndustryFromStrings(inputs: string[]): IndustryProfile['scores'] {
  const scores: Partial<Record<Industry, number>> = {};
  for (const s of inputs) {
    for (const ind of classifyOne(s)) {
      scores[ind] = (scores[ind] ?? 0) + 1;
    }
  }
  return scores;
}

export async function inferTenantIndustryProfile(
  db: D1Database, tenantId: string,
): Promise<IndustryProfile> {
  const [domains, categories, clusters] = await Promise.all([
    loadDistinctDomains(db, tenantId),
    loadDistinctKpiCategories(db, tenantId),
    loadDistinctClusterDomains(db, tenantId),
  ]);

  const scores = classifyIndustryFromStrings([...domains, ...categories, ...clusters]);
  const ranked = (Object.keys(scores) as Industry[])
    .sort((a, b) => (scores[b] ?? 0) - (scores[a] ?? 0));
  return {
    industries: ranked.length > 0 ? ranked : ['general'],
    scores,
    derivedFrom: { domains: domains.length, categories: categories.length, clusters: clusters.length },
  };
}
