/**
 * External Signals Feed — Phase 10-2.
 *
 * Pulls live external macro signals (FX rates, commodity prices) from
 * public APIs and persists them as time-series rows in `external_signals`.
 * Phase 10-3 will join these to internal KPI movements to attribute
 * causation.
 *
 * Sources shipped in v1:
 *   - **frankfurter.app** (FX) — keyless, free, stable. Defaults to
 *     USD/ZAR but configurable per tenant via the `external_signal_pairs`
 *     setting.
 *   - **EIA petroleum API** (Brent crude) — requires `EIA_API_KEY` env
 *     var. No-op when missing (logged as a config gap, not a failure).
 *
 * Persistence model: each poll writes ONE `external_signals` row per
 * source per tenant per day. Same-day re-polls UPDATE the existing
 * row (so the latest value wins). The row's `raw_data.history`
 * carries a 30-day rolling array so Phase 10-3 has a series to join
 * against KPI history.
 *
 * Why per-tenant rows even for global signals: the external_signals
 * table is tenant-scoped (foreign key) so we replicate per tenant.
 * Cheap — these are tiny rows and we only fetch the upstream API once
 * per source per cron tick (cached at the function level), then fan
 * out the persistence per tenant.
 */

import { logError, logInfo } from './logger';
import { inferTenantIndustryProfile, type Industry } from './industry-profile';

const HISTORY_DAYS = 30;

// ── Source contract ────────────────────────────────────────────────────

export interface ExternalSignalReading {
  category: 'fx' | 'commodity' | 'macro';
  source_name: string;
  /** Stable handle for this metric — e.g. 'fx.usd_zar', 'oil.brent_spot'. */
  signal_key: string;
  title: string;
  summary: string;
  value: number;
  unit: string;
  /** Optional source URL for audit. */
  source_url?: string;
  /** Optional reliability score from the upstream provider [0,1]. */
  reliability_score?: number;
}

export interface ExternalSignalSource {
  name: string;
  /** Returns null when source is unavailable (e.g. missing API key) so
   *  the sweep can skip without failing the whole tick. */
  fetchLatest(env: SourceEnv): Promise<ExternalSignalReading[] | null>;
  /** Industries this source is relevant to. Omit OR include 'general' to
   *  apply to every tenant. The sweep persists a source's readings only
   *  to tenants whose inferred industry profile intersects this list.
   *  Lets a pure-tech tenant skip weather, and an agri tenant pick it up. */
  applicableTo?: ReadonlyArray<Industry>;
}

export interface SourceEnv {
  EIA_API_KEY?: string;
  /** Override base URL for tests. */
  FRANKFURTER_BASE?: string;
  EIA_BASE?: string;
  OPEN_METEO_BASE?: string;
}

// ── Frankfurter FX source ──────────────────────────────────────────────

const FRANKFURTER_DEFAULT = 'https://api.frankfurter.app';
const FX_PAIRS = [
  { from: 'USD', to: 'ZAR' },
  { from: 'EUR', to: 'ZAR' },
  { from: 'GBP', to: 'ZAR' },
];

export const frankfurterFxSource: ExternalSignalSource = {
  name: 'frankfurter.fx',
  // FX moves every business with import/export exposure — applicable
  // to every industry including pure-tech (cloud spend in USD).
  applicableTo: ['general', 'mining', 'agriculture', 'healthcare', 'fmcg',
    'logistics', 'manufacturing', 'finance', 'technology'],
  async fetchLatest(env): Promise<ExternalSignalReading[] | null> {
    const base = env.FRANKFURTER_BASE || FRANKFURTER_DEFAULT;
    const out: ExternalSignalReading[] = [];
    for (const pair of FX_PAIRS) {
      try {
        const res = await fetch(`${base}/latest?from=${pair.from}&to=${pair.to}`, {
          headers: { Accept: 'application/json' },
        });
        if (!res.ok) {
          logError('external_signals.frankfurter.http_error', new Error(`HTTP ${res.status}`),
            { tenantId: 'global' }, { pair });
          continue;
        }
        const body = await res.json() as { rates?: Record<string, number>; date?: string };
        const value = body.rates?.[pair.to];
        if (typeof value !== 'number') continue;
        out.push({
          category: 'fx',
          source_name: 'frankfurter.app',
          signal_key: `fx.${pair.from.toLowerCase()}_${pair.to.toLowerCase()}`,
          title: `${pair.from}/${pair.to} exchange rate`,
          summary: `${pair.from}/${pair.to} = ${value.toFixed(4)} as of ${body.date || 'today'}`,
          value,
          unit: pair.to,
          source_url: `${base}/latest?from=${pair.from}&to=${pair.to}`,
          reliability_score: 0.9,
        });
      } catch (err) {
        logError('external_signals.frankfurter.fetch_failed', err, { tenantId: 'global' }, { pair });
      }
    }
    return out.length ? out : null;
  },
};

// ── EIA petroleum source (Brent crude) ─────────────────────────────────

const EIA_DEFAULT = 'https://api.eia.gov/v2';

export const eiaOilSource: ExternalSignalSource = {
  name: 'eia.brent',
  // Energy/transport input — physical-world industries care; pure-tech
  // and finance generally don't (no transport exposure to speak of).
  applicableTo: ['general', 'mining', 'agriculture', 'healthcare', 'fmcg',
    'logistics', 'manufacturing'],
  async fetchLatest(env): Promise<ExternalSignalReading[] | null> {
    if (!env.EIA_API_KEY) {
      logInfo('external_signals.eia.skipped', { tenantId: 'global', layer: 'analytics', action: 'external_signals' },
        { reason: 'EIA_API_KEY not configured — set the secret to enable Brent crude ingestion' });
      return null;
    }
    const base = env.EIA_BASE || EIA_DEFAULT;
    // RBRTE = Brent Europe spot; daily series.
    const url = `${base}/petroleum/pri/spt/data?api_key=${env.EIA_API_KEY}&frequency=daily&data[0]=value&facets[series][]=RBRTE&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`;
    try {
      const res = await fetch(url, { headers: { Accept: 'application/json' } });
      if (!res.ok) {
        logError('external_signals.eia.http_error', new Error(`HTTP ${res.status}`),
          { tenantId: 'global' }, {});
        return null;
      }
      const body = await res.json() as { response?: { data?: Array<{ period: string; value: number }> } };
      const point = body.response?.data?.[0];
      if (!point || typeof point.value !== 'number') return null;
      return [{
        category: 'commodity',
        source_name: 'EIA',
        signal_key: 'oil.brent_spot',
        title: 'Brent crude spot price',
        summary: `Brent spot $${point.value.toFixed(2)}/bbl as of ${point.period}`,
        value: point.value,
        unit: 'USD/bbl',
        source_url: `${base}/petroleum/pri/spt`,
        reliability_score: 0.95,
      }];
    } catch (err) {
      logError('external_signals.eia.fetch_failed', err, { tenantId: 'global' }, {});
      return null;
    }
  },
};

// ── Open-Meteo source (weather — agri / logistics / fmcg / insurance) ──

const OPEN_METEO_DEFAULT = 'https://api.open-meteo.com/v1';
// Cape regional cluster — broadly indicative for SA agri/logistics/retail.
// Customers can later override coordinates per tenant via tenant_settings.
const WEATHER_LOCATIONS = [
  { name: 'Johannesburg', lat: -26.2, lon: 28.04 },
  { name: 'Cape Town', lat: -33.92, lon: 18.42 },
];

export const openMeteoWeatherSource: ExternalSignalSource = {
  name: 'open-meteo.weather',
  // Weather is a real input to agri (irrigation, yields), logistics
  // (port congestion, delivery delays), fmcg (seasonal demand), and
  // healthcare (hospital admissions in heat events). Pure-tech and
  // finance don't need it.
  applicableTo: ['agriculture', 'logistics', 'fmcg', 'healthcare', 'mining'],
  async fetchLatest(env): Promise<ExternalSignalReading[] | null> {
    const base = env.OPEN_METEO_BASE || OPEN_METEO_DEFAULT;
    const out: ExternalSignalReading[] = [];
    for (const loc of WEATHER_LOCATIONS) {
      try {
        const url = `${base}/forecast?latitude=${loc.lat}&longitude=${loc.lon}` +
          `&current=temperature_2m,precipitation,wind_speed_10m`;
        const res = await fetch(url, { headers: { Accept: 'application/json' } });
        if (!res.ok) {
          logError('external_signals.open_meteo.http_error', new Error(`HTTP ${res.status}`),
            { tenantId: 'global' }, { location: loc.name });
          continue;
        }
        const body = await res.json() as { current?: { temperature_2m?: number; precipitation?: number; wind_speed_10m?: number; time?: string } };
        const c = body.current;
        if (!c) continue;
        const slug = loc.name.toLowerCase().replace(/\s+/g, '_');
        if (typeof c.temperature_2m === 'number') {
          out.push({
            category: 'macro',
            source_name: 'open-meteo.com',
            signal_key: `weather.${slug}.temp_c`,
            title: `${loc.name} temperature`,
            summary: `${loc.name} temperature ${c.temperature_2m.toFixed(1)}°C as of ${c.time ?? 'now'}`,
            value: c.temperature_2m,
            unit: '°C',
            source_url: `${base}/forecast?lat=${loc.lat}&lon=${loc.lon}`,
            reliability_score: 0.85,
          });
        }
        if (typeof c.precipitation === 'number') {
          out.push({
            category: 'macro',
            source_name: 'open-meteo.com',
            signal_key: `weather.${slug}.precip_mm`,
            title: `${loc.name} precipitation`,
            summary: `${loc.name} precipitation ${c.precipitation.toFixed(2)}mm as of ${c.time ?? 'now'}`,
            value: c.precipitation,
            unit: 'mm',
            source_url: `${base}/forecast?lat=${loc.lat}&lon=${loc.lon}`,
            reliability_score: 0.85,
          });
        }
      } catch (err) {
        logError('external_signals.open_meteo.fetch_failed', err,
          { tenantId: 'global' }, { location: loc.name });
      }
    }
    return out.length ? out : null;
  },
};

// ── Persistence ────────────────────────────────────────────────────────

interface StoredHistoryPoint { date: string; value: number }

interface ExistingSignalRow {
  id: string;
  raw_data: string | null;
}

async function findExistingSignal(
  db: D1Database, tenantId: string, signalKey: string,
): Promise<ExistingSignalRow | null> {
  try {
    const r = await db.prepare(
      `SELECT id, raw_data FROM external_signals
        WHERE tenant_id = ?
          AND raw_data LIKE ?
        ORDER BY detected_at DESC LIMIT 1`
    ).bind(tenantId, `%"signal_key":"${signalKey}"%`).first<ExistingSignalRow>();
    return r || null;
  } catch {
    return null;
  }
}

function pruneHistory(history: StoredHistoryPoint[]): StoredHistoryPoint[] {
  const cutoff = Date.now() - HISTORY_DAYS * 24 * 60 * 60 * 1000;
  return history.filter((h) => new Date(h.date).getTime() >= cutoff);
}

async function persistReading(
  db: D1Database, tenantId: string, reading: ExternalSignalReading,
): Promise<'inserted' | 'updated' | 'unchanged'> {
  const today = new Date().toISOString().slice(0, 10);
  const existing = await findExistingSignal(db, tenantId, reading.signal_key);

  let rawData: { signal_key: string; latest_value: number; latest_date: string; unit: string; history: StoredHistoryPoint[] };
  if (existing) {
    try {
      rawData = JSON.parse(existing.raw_data || '{}');
    } catch {
      rawData = { signal_key: reading.signal_key, latest_value: reading.value, latest_date: today, unit: reading.unit, history: [] };
    }
    if (!Array.isArray(rawData.history)) rawData.history = [];
    // Append today's value (replace if same date already present).
    const idx = rawData.history.findIndex((h) => h.date === today);
    if (idx >= 0) {
      if (rawData.history[idx].value === reading.value) {
        return 'unchanged';
      }
      rawData.history[idx].value = reading.value;
    } else {
      rawData.history.push({ date: today, value: reading.value });
    }
    rawData.history = pruneHistory(rawData.history);
    rawData.latest_value = reading.value;
    rawData.latest_date = today;
    rawData.signal_key = reading.signal_key;
    rawData.unit = reading.unit;

    try {
      await db.prepare(
        `UPDATE external_signals
            SET title = ?, summary = ?, source_name = ?, source_url = ?,
                reliability_score = ?, raw_data = ?, detected_at = datetime('now')
          WHERE id = ?`
      ).bind(
        reading.title, reading.summary, reading.source_name, reading.source_url || null,
        reading.reliability_score ?? 0.5, JSON.stringify(rawData), existing.id,
      ).run();
    } catch (err) {
      logError('external_signals.update_failed', err, { tenantId }, { signal_key: reading.signal_key });
      return 'unchanged';
    }
    return 'updated';
  }

  rawData = {
    signal_key: reading.signal_key,
    latest_value: reading.value,
    latest_date: today,
    unit: reading.unit,
    history: [{ date: today, value: reading.value }],
  };
  try {
    await db.prepare(
      `INSERT INTO external_signals
        (id, tenant_id, category, title, summary, source_url, source_name,
         reliability_score, relevance_score, sentiment, raw_data, detected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.5, 'neutral', ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId, reading.category, reading.title, reading.summary,
      reading.source_url || null, reading.source_name,
      reading.reliability_score ?? 0.5,
      JSON.stringify(rawData),
    ).run();
  } catch (err) {
    logError('external_signals.insert_failed', err, { tenantId }, { signal_key: reading.signal_key });
    return 'unchanged';
  }
  return 'inserted';
}

// ── Main entry ─────────────────────────────────────────────────────────

export interface SignalSweepResult {
  sourcesAttempted: number;
  sourcesSucceeded: number;
  sourcesSkippedNoTenant: number;
  readingsFetched: number;
  signalsInserted: number;
  signalsUpdated: number;
  signalsUnchanged: number;
  signalsSkippedNotApplicable: number;
}

/** Default registry — extend by passing a wider list to sweepExternalSignals. */
export const DEFAULT_SOURCES: ExternalSignalSource[] = [
  frankfurterFxSource,
  eiaOilSource,
  openMeteoWeatherSource,
];

/** True if `source` is applicable to a tenant whose industry profile
 *  contains at least one of the source's `applicableTo` industries.
 *  A source with no `applicableTo` declaration is treated as global. */
function sourceAppliesToIndustries(
  source: ExternalSignalSource,
  industries: ReadonlyArray<Industry>,
): boolean {
  if (!source.applicableTo || source.applicableTo.length === 0) return true;
  for (const ind of industries) {
    if (source.applicableTo.includes(ind)) return true;
  }
  return false;
}

/**
 * Industry-aware sweep:
 *
 *  1. Compute every active tenant's industry profile.
 *  2. Determine the UNION of sources at least one tenant cares about.
 *     A source no tenant uses is skipped — saves the upstream API call.
 *  3. Fetch each applicable source ONCE.
 *  4. Per tenant, persist only readings from sources that are
 *     applicable to that tenant's industries.
 *
 *  This means a pure-tech tenant doesn't get weather pollution in
 *  external_signals; an agri tenant does. FX is global so everyone
 *  gets it; Brent is physical-economy so finance/tech skip it.
 */
export async function sweepExternalSignals(
  db: D1Database,
  env: SourceEnv,
  sources: ExternalSignalSource[] = DEFAULT_SOURCES,
): Promise<SignalSweepResult> {
  const result: SignalSweepResult = {
    sourcesAttempted: 0, sourcesSucceeded: 0, sourcesSkippedNoTenant: 0,
    readingsFetched: 0,
    signalsInserted: 0, signalsUpdated: 0, signalsUnchanged: 0,
    signalsSkippedNotApplicable: 0,
  };

  // 1. List active tenants up front — needed for industry inference.
  let tenants: Array<{ id: string }> = [];
  try {
    const r = await db.prepare(`SELECT id FROM tenants WHERE status = 'active'`).all<{ id: string }>();
    tenants = r.results || [];
  } catch (err) {
    logError('external_signals.tenant_list_failed', err, { tenantId: 'global' }, {});
    return result;
  }
  if (tenants.length === 0) return result;

  // 2. Compute each tenant's industry profile in parallel.
  const tenantIndustries = new Map<string, ReadonlyArray<Industry>>();
  await Promise.all(tenants.map(async (t) => {
    try {
      const profile = await inferTenantIndustryProfile(db, t.id);
      tenantIndustries.set(t.id, profile.industries);
    } catch {
      tenantIndustries.set(t.id, ['general']);
    }
  }));

  // 3. Determine which sources to fetch — the union of what any tenant
  //    cares about. Skip sources with zero applicable tenants.
  const sourcesByName = new Map<string, ExternalSignalSource>();
  for (const source of sources) {
    let anyMatch = false;
    for (const industries of tenantIndustries.values()) {
      if (sourceAppliesToIndustries(source, industries)) { anyMatch = true; break; }
    }
    if (anyMatch) {
      sourcesByName.set(source.name, source);
    } else {
      result.sourcesSkippedNoTenant++;
    }
  }

  // 4. Fetch each applicable source ONCE; track which source produced
  //    which readings so we can apply per-tenant filtering.
  const readingsBySource = new Map<string, ExternalSignalReading[]>();
  for (const source of sourcesByName.values()) {
    result.sourcesAttempted++;
    try {
      const readings = await source.fetchLatest(env);
      if (readings && readings.length > 0) {
        readingsBySource.set(source.name, readings);
        result.sourcesSucceeded++;
        result.readingsFetched += readings.length;
      }
    } catch (err) {
      logError('external_signals.source_failed', err, { tenantId: 'global' }, { source: source.name });
    }
  }
  if (readingsBySource.size === 0) return result;

  // 5. Per-tenant fan-out, gated by applicability.
  for (const t of tenants) {
    const industries = tenantIndustries.get(t.id) ?? ['general'];
    for (const [sourceName, readings] of readingsBySource) {
      const source = sourcesByName.get(sourceName)!;
      if (!sourceAppliesToIndustries(source, industries)) {
        result.signalsSkippedNotApplicable += readings.length;
        continue;
      }
      for (const reading of readings) {
        const outcome = await persistReading(db, t.id, reading);
        if (outcome === 'inserted') result.signalsInserted++;
        else if (outcome === 'updated') result.signalsUpdated++;
        else result.signalsUnchanged++;
      }
    }
  }

  if (result.signalsInserted + result.signalsUpdated > 0) {
    logInfo('external_signals.sweep_completed',
      { tenantId: 'global', layer: 'analytics', action: 'external_signals' },
      { ...result });
  }
  return result;
}
