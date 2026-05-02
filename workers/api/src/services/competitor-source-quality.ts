/**
 * Competitor Source Quality — Phase 10-14.
 *
 * Maintains a small registry of trusted news domains and adjusts the
 * severity of ingested competitor signals accordingly. Reuters / FT /
 * Bloomberg-class outlets carry weight; an anonymous blog should not
 * trigger a 'critical' radar alert just because its headline contains
 * "acquires" or "lawsuit".
 *
 * The registry is intentionally short — only outlets we have explicit
 * editorial trust signal for. Everything else gets a neutral default
 * (0.5) and the severity assigned by the strategy classifier stands.
 *
 * Adjustment rule:
 *   - quality ≥ HIGH_QUALITY (0.85): keep critical/warning as-is;
 *     promote 'info' on trouble-category to 'warning' (a Reuters
 *     report that competitor X was fined matters)
 *   - quality < LOW_QUALITY (0.4): demote 'critical' to 'warning';
 *     demote 'warning' to 'info'. We don't ban the source — we just
 *     don't escalate based on it
 *   - 0.4 ≤ quality < 0.85: no change
 *
 * Customers can override via tenant_settings key='competitor_source_overrides'
 * (JSON map of domain → score). Future Phase: per-tenant trust list
 * (e.g. their industry's must-read outlet).
 */

import type { StrategyCategory, StrategySeverity } from './competitor-strategy-classifier';

const HIGH_QUALITY = 0.85;
const LOW_QUALITY = 0.4;

/** Conservative default — only outlets with established editorial
 *  standards get an explicit score. Add more in PRs as they prove
 *  reliable in practice. */
export const DEFAULT_SOURCE_QUALITY: Record<string, number> = {
  // Global wires / major outlets
  'reuters.com': 0.95,
  'ft.com': 0.95,
  'bloomberg.com': 0.95,
  'wsj.com': 0.92,
  'economist.com': 0.92,
  'apnews.com': 0.92,
  'bbc.com': 0.9,
  'bbc.co.uk': 0.9,
  'cnbc.com': 0.85,
  // South Africa
  'businesslive.co.za': 0.88,
  'fin24.com': 0.85,
  'businesstech.co.za': 0.78,
  'mybroadband.co.za': 0.8,
  'engineeringnews.co.za': 0.82,
  'miningweekly.com': 0.82,
  'farmersweekly.co.za': 0.75,
  'dailymaverick.co.za': 0.82,
  'news24.com': 0.7,
  'iol.co.za': 0.68,
  'timeslive.co.za': 0.7,
  // Wire-ish / press releases — informational but not editorially scored
  'prnewswire.com': 0.55,
  'businesswire.com': 0.55,
  'globenewswire.com': 0.55,
};

/** Extract a host from a URL string. Returns lowercased host with the
 *  leading "www." stripped, or null when the input isn't parseable. */
export function extractHost(url: string): string | null {
  try {
    const u = new URL(url);
    return u.host.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Resolve quality for a host. Looks up exact match first, then walks
 *  up subdomains (m.bbc.co.uk → bbc.co.uk). Returns 0.5 default. */
export function qualityForHost(
  host: string | null,
  registry: Record<string, number> = DEFAULT_SOURCE_QUALITY,
): number {
  if (!host) return 0.5;
  if (registry[host] != null) return registry[host];
  const parts = host.split('.');
  while (parts.length > 2) {
    parts.shift();
    const candidate = parts.join('.');
    if (registry[candidate] != null) return registry[candidate];
  }
  return 0.5;
}

/** Apply quality-aware adjustment to a (severity, category) pair. */
export function adjustSeverity(
  severity: StrategySeverity,
  category: StrategyCategory,
  quality: number,
): StrategySeverity {
  if (quality >= HIGH_QUALITY) {
    // Promote info → warning ONLY for trouble-class signals from
    // top-tier outlets (a Reuters report on a competitor fine matters)
    if (severity === 'info' && category === 'trouble') return 'warning';
    return severity;
  }
  if (quality < LOW_QUALITY) {
    if (severity === 'critical') return 'warning';
    if (severity === 'warning') return 'info';
    return severity;
  }
  return severity;
}

/** Optional per-tenant override loader. Reads tenant_settings for
 *  custom source-quality overrides; merges with defaults (overrides win). */
export async function loadEffectiveSourceQuality(
  db: D1Database, tenantId: string,
): Promise<Record<string, number>> {
  try {
    const r = await db.prepare(
      `SELECT value FROM tenant_settings
        WHERE tenant_id = ? AND key = 'competitor_source_overrides' LIMIT 1`
    ).bind(tenantId).first<{ value: string }>();
    if (!r?.value) return DEFAULT_SOURCE_QUALITY;
    try {
      const parsed = JSON.parse(r.value) as Record<string, number>;
      const merged: Record<string, number> = { ...DEFAULT_SOURCE_QUALITY };
      for (const [k, v] of Object.entries(parsed)) {
        if (typeof v === 'number' && v >= 0 && v <= 1) merged[k.toLowerCase()] = v;
      }
      return merged;
    } catch {
      return DEFAULT_SOURCE_QUALITY;
    }
  } catch {
    return DEFAULT_SOURCE_QUALITY;
  }
}
