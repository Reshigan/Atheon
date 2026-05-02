/**
 * Competitor Intelligence Source — Phase 10-8.
 *
 * Per-tenant daily ingestion of competitor news + strategy classification.
 * Reads each tenant's `competitors` rows, queries Google News RSS for
 * each competitor name, parses items, runs the deterministic strategy
 * classifier (competitor-strategy-classifier.ts), and persists each
 * NEW item to `radar_signals` with `signal_type='competitor'` and the
 * inferred strategy category embedded in `raw_data`.
 *
 * Why this is a per-TENANT source (unlike FX/oil/weather which are
 * global): every customer has different competitors. The set is read
 * from `competitors` — a table the customer or a setup workflow
 * populates. A tenant with no competitors → no fetches, no-op.
 *
 * Free + keyless: Google News RSS is publicly accessible, no auth.
 *
 * Persistence:
 *  - Dedup by URL within last 30 days per tenant — re-running the same
 *    sweep doesn't insert duplicates
 *  - signal_type='competitor', source=competitor.name, severity from
 *    classifier, raw_data carries {competitor_id, strategy_category,
 *    matched_keywords, item_url, pub_date}
 *  - downstream consumers (radar-engine-v2, Apex narrative,
 *    diagnostics-engine-v2) already read radar_signals — no changes
 *    needed there
 *
 * Strong-inference gates:
 *  - Tenant must have at least 1 competitor row, else skip entirely
 *  - URL-level dedup over 30-day window
 *  - Per-competitor cap of MAX_ITEMS_PER_COMPETITOR (5) to keep
 *    radar_signals from filling up on a single noisy competitor
 *  - Title length >= 10 chars (filter junk)
 */

import { logError, logInfo } from './logger';
import { classifyStrategy, decodeBasicEntities } from './competitor-strategy-classifier';
import {
  extractHost,
  qualityForHost,
  adjustSeverity,
  loadEffectiveSourceQuality,
} from './competitor-source-quality';

const GOOGLE_NEWS_DEFAULT = 'https://news.google.com/rss/search';
const MAX_ITEMS_PER_COMPETITOR = 5;
const DEDUP_WINDOW_DAYS = 30;
const MIN_TITLE_CHARS = 10;

// ── Types ──────────────────────────────────────────────────────────────

interface CompetitorRow {
  id: string;
  name: string;
  industry: string | null;
}

interface ParsedItem {
  title: string;
  link: string;
  pubDate: string | null;
  description: string | null;
}

export interface CompetitorIntelSweepResult {
  competitorsScanned: number;
  itemsFetched: number;
  itemsInserted: number;
  itemsSkippedDuplicate: number;
  itemsSkippedJunk: number;
  competitorsFailed: number;
}

export interface CompetitorSourceEnv {
  /** Override base URL for tests. */
  GOOGLE_NEWS_BASE?: string;
  /** Optional country/locale hints — default ZA. */
  GOOGLE_NEWS_CEID?: string;
  GOOGLE_NEWS_HL?: string;
  GOOGLE_NEWS_GL?: string;
}

// ── RSS parsing (regex-based; no DOMParser in Workers) ─────────────────

const ITEM_RE = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
const TITLE_RE = /<title(?:\s[^>]*)?>([\s\S]*?)<\/title>/i;
const LINK_RE = /<link(?:\s[^>]*)?>([\s\S]*?)<\/link>/i;
const PUBDATE_RE = /<pubDate(?:\s[^>]*)?>([\s\S]*?)<\/pubDate>/i;
const DESCRIPTION_RE = /<description(?:\s[^>]*)?>([\s\S]*?)<\/description>/i;
const CDATA_RE = /^<!\[CDATA\[([\s\S]*?)\]\]>$/;

function unwrapCdata(s: string): string {
  const m = s.trim().match(CDATA_RE);
  return m ? m[1].trim() : s.trim();
}

export function parseRssItems(xml: string): ParsedItem[] {
  const out: ParsedItem[] = [];
  let m: RegExpExecArray | null;
  ITEM_RE.lastIndex = 0;
  while ((m = ITEM_RE.exec(xml)) !== null) {
    const block = m[1];
    const title = block.match(TITLE_RE);
    const link = block.match(LINK_RE);
    const pub = block.match(PUBDATE_RE);
    const desc = block.match(DESCRIPTION_RE);
    if (!title || !link) continue;
    const titleText = decodeBasicEntities(unwrapCdata(title[1]));
    const linkText = unwrapCdata(link[1]);
    out.push({
      title: titleText,
      link: linkText,
      pubDate: pub ? unwrapCdata(pub[1]) : null,
      description: desc ? decodeBasicEntities(unwrapCdata(desc[1])) : null,
    });
  }
  return out;
}

// ── DB ─────────────────────────────────────────────────────────────────

async function loadCompetitors(db: D1Database, tenantId: string): Promise<CompetitorRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, name, industry FROM competitors WHERE tenant_id = ?`
    ).bind(tenantId).all<CompetitorRow>();
    return r.results || [];
  } catch (err) {
    logError('competitor_intel.load_competitors_failed', err, { tenantId }, {});
    return [];
  }
}

async function urlAlreadyIngested(
  db: D1Database, tenantId: string, url: string,
): Promise<boolean> {
  try {
    const r = await db.prepare(
      `SELECT 1 FROM radar_signals
        WHERE tenant_id = ? AND url = ?
          AND detected_at > datetime('now', ?)
        LIMIT 1`
    ).bind(tenantId, url, `-${DEDUP_WINDOW_DAYS} days`).first();
    return r !== null;
  } catch {
    return false;
  }
}

async function persistRadarSignal(
  db: D1Database, tenantId: string, competitor: CompetitorRow,
  item: ParsedItem,
  sourceQualityRegistry: Record<string, number>,
): Promise<boolean> {
  const cls = classifyStrategy(item.title);
  const host = extractHost(item.link);
  const quality = qualityForHost(host, sourceQualityRegistry);
  const adjustedSeverity = adjustSeverity(cls.severity, cls.category, quality);
  const rawData = {
    competitor_id: competitor.id,
    competitor_name: competitor.name,
    strategy_category: cls.category,
    matched_keywords: cls.matched,
    item_url: item.link,
    pub_date: item.pubDate,
    source_host: host,
    source_quality: quality,
    raw_severity: cls.severity,
  };
  try {
    await db.prepare(
      `INSERT INTO radar_signals
         (id, tenant_id, source, signal_type, title, description, url,
          raw_data, severity, relevance_score, status, detected_at, created_at)
       VALUES (?, ?, ?, 'competitor', ?, ?, ?, ?, ?, ?, 'new',
               datetime('now'), datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId, competitor.name,
      item.title, item.description ?? item.title, item.link,
      JSON.stringify(rawData), adjustedSeverity, quality,
    ).run();
    return true;
  } catch (err) {
    logError('competitor_intel.insert_failed', err, { tenantId },
      { competitor_id: competitor.id, url: item.link });
    return false;
  }
}

// ── Main ──────────────────────────────────────────────────────────────

function buildGoogleNewsUrl(env: CompetitorSourceEnv, query: string): string {
  const base = env.GOOGLE_NEWS_BASE || GOOGLE_NEWS_DEFAULT;
  const hl = env.GOOGLE_NEWS_HL || 'en-ZA';
  const gl = env.GOOGLE_NEWS_GL || 'ZA';
  const ceid = env.GOOGLE_NEWS_CEID || 'ZA:en';
  return `${base}?q=${encodeURIComponent(`"${query}"`)}&hl=${hl}&gl=${gl}&ceid=${ceid}`;
}

/** Daily per-tenant competitor intelligence sweep.
 *  No-op for tenants with no `competitors` rows. */
export async function sweepCompetitorIntel(
  db: D1Database, tenantId: string, env: CompetitorSourceEnv,
): Promise<CompetitorIntelSweepResult> {
  const result: CompetitorIntelSweepResult = {
    competitorsScanned: 0, itemsFetched: 0,
    itemsInserted: 0, itemsSkippedDuplicate: 0, itemsSkippedJunk: 0,
    competitorsFailed: 0,
  };

  const competitors = await loadCompetitors(db, tenantId);
  result.competitorsScanned = competitors.length;
  if (competitors.length === 0) return result;

  const sourceQualityRegistry = await loadEffectiveSourceQuality(db, tenantId);

  for (const c of competitors) {
    try {
      const url = buildGoogleNewsUrl(env, c.name);
      const res = await fetch(url, { headers: { Accept: 'application/rss+xml, application/xml' } });
      if (!res.ok) {
        logError('competitor_intel.http_error', new Error(`HTTP ${res.status}`),
          { tenantId }, { competitor: c.name });
        result.competitorsFailed++;
        continue;
      }
      const xml = await res.text();
      const items = parseRssItems(xml).slice(0, MAX_ITEMS_PER_COMPETITOR);
      result.itemsFetched += items.length;
      for (const item of items) {
        if (item.title.length < MIN_TITLE_CHARS) {
          result.itemsSkippedJunk++;
          continue;
        }
        if (await urlAlreadyIngested(db, tenantId, item.link)) {
          result.itemsSkippedDuplicate++;
          continue;
        }
        const ok = await persistRadarSignal(db, tenantId, c, item, sourceQualityRegistry);
        if (ok) result.itemsInserted++;
      }
    } catch (err) {
      logError('competitor_intel.fetch_failed', err, { tenantId },
        { competitor: c.name });
      result.competitorsFailed++;
    }
  }

  if (result.itemsInserted > 0) {
    logInfo('competitor_intel.sweep_completed',
      { tenantId, layer: 'analytics', action: 'competitor_intel' },
      { ...result });
  }
  return result;
}
