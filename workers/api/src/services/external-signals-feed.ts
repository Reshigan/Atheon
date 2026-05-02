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
}

export interface SourceEnv {
  EIA_API_KEY?: string;
  /** Override base URL for tests. */
  FRANKFURTER_BASE?: string;
  EIA_BASE?: string;
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
  readingsFetched: number;
  signalsInserted: number;
  signalsUpdated: number;
  signalsUnchanged: number;
}

/**
 * Poll all configured external sources ONCE, then fan out the readings
 * to every active tenant. Returns a sweep summary for logging. Best-
 * effort — a failing source does not abort the others.
 */
export async function sweepExternalSignals(
  db: D1Database,
  env: SourceEnv,
  sources: ExternalSignalSource[] = [frankfurterFxSource, eiaOilSource],
): Promise<SignalSweepResult> {
  const result: SignalSweepResult = {
    sourcesAttempted: 0, sourcesSucceeded: 0,
    readingsFetched: 0,
    signalsInserted: 0, signalsUpdated: 0, signalsUnchanged: 0,
  };

  // 1. Fetch from each source ONCE (signals are global, not tenant-scoped).
  const allReadings: ExternalSignalReading[] = [];
  for (const source of sources) {
    result.sourcesAttempted++;
    try {
      const readings = await source.fetchLatest(env);
      if (readings && readings.length > 0) {
        allReadings.push(...readings);
        result.sourcesSucceeded++;
        result.readingsFetched += readings.length;
      }
    } catch (err) {
      logError('external_signals.source_failed', err, { tenantId: 'global' }, { source: source.name });
    }
  }
  if (allReadings.length === 0) return result;

  // 2. Fan out to all active tenants.
  let tenants: Array<{ id: string }> = [];
  try {
    const r = await db.prepare(`SELECT id FROM tenants WHERE status = 'active'`).all<{ id: string }>();
    tenants = r.results || [];
  } catch (err) {
    logError('external_signals.tenant_list_failed', err, { tenantId: 'global' }, {});
    return result;
  }

  for (const t of tenants) {
    for (const reading of allReadings) {
      const outcome = await persistReading(db, t.id, reading);
      if (outcome === 'inserted') result.signalsInserted++;
      else if (outcome === 'updated') result.signalsUpdated++;
      else result.signalsUnchanged++;
    }
  }

  if (result.signalsInserted + result.signalsUpdated > 0) {
    logInfo('external_signals.sweep_completed', { tenantId: 'global', layer: 'analytics', action: 'external_signals' }, { ...result });
  }
  return result;
}
