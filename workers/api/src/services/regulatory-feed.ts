/**
 * Regulatory Feed — Phase 10-12.
 *
 * Industry-aware ingestion of regulatory/compliance signals into the
 * existing `regulatory_events` table. Closes the audit gap that
 * compliance KPIs had no external context — Atheon now reads SARS /
 * SARB / FSCA / JSE / sector-specific regulator activity daily and
 * routes only the relevant items to each tenant based on their
 * inferred industry profile (Phase 10-7).
 *
 * Source: Google News RSS scoped to each regulator name. Free, keyless,
 * available globally. Uses the same RSS parser shipped with Phase 10-8
 * (competitor-intel-source). When a regulator publishes its own RSS
 * (e.g. SARB monetary policy), drop the URL into the regulator's
 * `feeds` array and it'll be tried first.
 *
 * Persistence: existing regulatory_events table:
 *   - jurisdiction = regulator name
 *   - source_url   = RSS item link (used for 30-day dedup)
 *   - title / description from the item
 *   - status defaults to 'upcoming' (consumers re-classify)
 *   - affected_dimensions = JSON of the regulator's applicable
 *     industries (so cross-industry dashboards can filter)
 *
 * Strong-inference gates:
 *   - Tenant industry profile must intersect regulator's applicableTo
 *     (or regulator declared as universal)
 *   - URL-level dedup over 30 days per tenant
 *   - Per-regulator cap of 5 items per sweep — keep the table tidy
 *   - Title length ≥ 10 chars
 */

import { logError, logInfo } from './logger';
import { inferTenantIndustryProfile, type Industry } from './industry-profile';
import { parseRssItems } from './competitor-intel-source';

const MAX_ITEMS_PER_REGULATOR = 5;
const DEDUP_WINDOW_DAYS = 30;
const MIN_TITLE_CHARS = 10;
const GOOGLE_NEWS_DEFAULT = 'https://news.google.com/rss/search';

export interface RegulatorFeed {
  /** Stable identifier — used in audit logs. */
  name: string;
  /** Display jurisdiction stored on the regulatory_events row. */
  jurisdiction: string;
  /** Search queries used to find news about this regulator. */
  queries: string[];
  /** Which industries this regulator is relevant to. */
  applicableTo: ReadonlyArray<Industry>;
  /** Optional first-party RSS feed URLs (tried before Google News). */
  feeds?: string[];
}

/** Default registry. Extend by passing a wider list to sweepRegulatoryFeeds. */
export const DEFAULT_REGULATORS: RegulatorFeed[] = [
  {
    name: 'sars',
    jurisdiction: 'South African Revenue Service',
    queries: ['SARS tax', 'SARS regulation'],
    applicableTo: ['general', 'mining', 'agriculture', 'healthcare', 'fmcg',
      'logistics', 'manufacturing', 'finance', 'technology'],
  },
  {
    name: 'sarb',
    jurisdiction: 'South African Reserve Bank',
    queries: ['SARB monetary policy', 'South African Reserve Bank repo rate'],
    applicableTo: ['general', 'finance', 'fmcg', 'mining', 'manufacturing'],
  },
  {
    name: 'fsca',
    jurisdiction: 'Financial Sector Conduct Authority',
    queries: ['FSCA regulation', 'FSCA enforcement'],
    applicableTo: ['finance'],
  },
  {
    name: 'jse',
    jurisdiction: 'Johannesburg Stock Exchange',
    queries: ['JSE listing rules', 'JSE SENS announcement'],
    applicableTo: ['finance'],
  },
  {
    name: 'sahpra',
    jurisdiction: 'South African Health Products Regulatory Authority',
    queries: ['SAHPRA regulation', 'SAHPRA approval'],
    applicableTo: ['healthcare'],
  },
  {
    name: 'dmre',
    jurisdiction: 'Department of Mineral Resources and Energy',
    queries: ['DMRE mining regulation', 'mining charter South Africa'],
    applicableTo: ['mining'],
  },
  {
    name: 'nrcs',
    jurisdiction: 'National Regulator for Compulsory Specifications',
    queries: ['NRCS standards', 'NRCS food safety'],
    applicableTo: ['agriculture', 'fmcg', 'manufacturing'],
  },
  {
    name: 'icasa',
    jurisdiction: 'Independent Communications Authority',
    queries: ['ICASA regulation', 'ICASA spectrum'],
    applicableTo: ['technology'],
  },
];

export interface RegulatorySweepEnv {
  /** Override for tests. */
  GOOGLE_NEWS_BASE?: string;
  GOOGLE_NEWS_HL?: string;
  GOOGLE_NEWS_GL?: string;
  GOOGLE_NEWS_CEID?: string;
}

export interface RegulatorySweepResult {
  regulatorsScanned: number;
  itemsFetched: number;
  itemsInserted: number;
  itemsSkippedDuplicate: number;
  itemsSkippedJunk: number;
  regulatorsFailed: number;
}

// ── Helpers ───────────────────────────────────────────────────────────

function applies(reg: RegulatorFeed, industries: ReadonlyArray<Industry>): boolean {
  for (const ind of industries) {
    if (reg.applicableTo.includes(ind)) return true;
  }
  return false;
}

function buildGoogleNewsUrl(env: RegulatorySweepEnv, query: string): string {
  const base = env.GOOGLE_NEWS_BASE || GOOGLE_NEWS_DEFAULT;
  const hl = env.GOOGLE_NEWS_HL || 'en-ZA';
  const gl = env.GOOGLE_NEWS_GL || 'ZA';
  const ceid = env.GOOGLE_NEWS_CEID || 'ZA:en';
  return `${base}?q=${encodeURIComponent(query)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

async function urlAlreadyIngested(
  db: D1Database, tenantId: string, url: string,
): Promise<boolean> {
  try {
    const r = await db.prepare(
      `SELECT 1 FROM regulatory_events
        WHERE tenant_id = ? AND source_url = ?
          AND created_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, url, `-${DEDUP_WINDOW_DAYS} days`).first();
    return r !== null;
  } catch {
    return false;
  }
}

async function persistRegulatoryEvent(
  db: D1Database, tenantId: string, reg: RegulatorFeed,
  item: { title: string; link: string; description: string | null },
): Promise<boolean> {
  try {
    await db.prepare(
      `INSERT INTO regulatory_events
         (id, tenant_id, title, description, jurisdiction,
          affected_dimensions, status, source_url)
       VALUES (?, ?, ?, ?, ?, ?, 'upcoming', ?)`
    ).bind(
      crypto.randomUUID(), tenantId,
      item.title, item.description ?? item.title,
      reg.jurisdiction,
      JSON.stringify(reg.applicableTo),
      item.link,
    ).run();
    return true;
  } catch (err) {
    logError('regulatory_feed.insert_failed', err, { tenantId },
      { regulator: reg.name, url: item.link });
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

/** Per-tenant daily regulatory feed sweep.
 *  Filters by tenant industry profile so a finance tenant doesn't get
 *  mining-charter news and a mining tenant doesn't get JSE SENS noise. */
export async function sweepRegulatoryFeeds(
  db: D1Database, tenantId: string, env: RegulatorySweepEnv,
  registry: RegulatorFeed[] = DEFAULT_REGULATORS,
): Promise<RegulatorySweepResult> {
  const result: RegulatorySweepResult = {
    regulatorsScanned: 0, itemsFetched: 0,
    itemsInserted: 0, itemsSkippedDuplicate: 0, itemsSkippedJunk: 0,
    regulatorsFailed: 0,
  };

  let industries: ReadonlyArray<Industry>;
  try {
    const profile = await inferTenantIndustryProfile(db, tenantId);
    industries = profile.industries;
  } catch {
    industries = ['general'];
  }

  const applicableRegulators = registry.filter((r) => applies(r, industries));
  result.regulatorsScanned = applicableRegulators.length;
  if (applicableRegulators.length === 0) return result;

  for (const reg of applicableRegulators) {
    let regItemsAdded = 0;
    try {
      // Try first-party RSS feeds first; fall back to Google News.
      const urls = (reg.feeds && reg.feeds.length > 0)
        ? reg.feeds
        : reg.queries.map((q) => buildGoogleNewsUrl(env, q));

      for (const url of urls) {
        if (regItemsAdded >= MAX_ITEMS_PER_REGULATOR) break;
        try {
          const res = await fetch(url, { headers: { Accept: 'application/rss+xml, application/xml' } });
          if (!res.ok) {
            logError('regulatory_feed.http_error', new Error(`HTTP ${res.status}`),
              { tenantId }, { regulator: reg.name, url });
            continue;
          }
          const xml = await res.text();
          const items = parseRssItems(xml);
          result.itemsFetched += items.length;

          for (const item of items) {
            if (regItemsAdded >= MAX_ITEMS_PER_REGULATOR) break;
            if (item.title.length < MIN_TITLE_CHARS) {
              result.itemsSkippedJunk++;
              continue;
            }
            if (await urlAlreadyIngested(db, tenantId, item.link)) {
              result.itemsSkippedDuplicate++;
              continue;
            }
            const ok = await persistRegulatoryEvent(db, tenantId, reg, item);
            if (ok) {
              result.itemsInserted++;
              regItemsAdded++;
            }
          }
        } catch (err) {
          logError('regulatory_feed.fetch_failed', err, { tenantId },
            { regulator: reg.name, url });
        }
      }
    } catch (err) {
      logError('regulatory_feed.regulator_failed', err, { tenantId },
        { regulator: reg.name });
      result.regulatorsFailed++;
    }
  }

  if (result.itemsInserted > 0) {
    logInfo('regulatory_feed.sweep_completed',
      { tenantId, layer: 'analytics', action: 'regulatory_feed' },
      { ...result });
  }
  return result;
}
