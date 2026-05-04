/**
 * Threshold Auto-Tuner — Phase 10-16.
 *
 * Reads `inference_calibration` recommendations (Phase 10-15) and
 * persists per-tenant threshold overrides to `tenant_settings` so the
 * next analytical sweep picks them up. Each gate has a default in code
 * AND a configurable override. Override > default; override is
 * bounded to a sane range so a runaway tuning loop can't disable a
 * gate entirely.
 *
 * Tuning rule per gate:
 *   - 'tighten' → step the threshold toward STRICTER by TUNE_STEP
 *   - 'loosen'  → step the threshold toward LOOSER by TUNE_STEP
 *   - 'hold'    → leave the override untouched (or remove if at default)
 *
 * tenant_settings storage:
 *   key: 'inference_threshold:{gate_name}'
 *   value: JSON {value: number, source: 'auto'|'manual', updated_at, recommendation}
 *
 * Manual override (source='manual') always wins; auto-tuner skips
 * gates a customer has explicitly pinned. Lets customers say "I want
 * |r| ≥ 0.7 always, ignore your tuning".
 *
 * Strong-inference policy:
 *   - Only acts when getCalibrationStats returns 'tighten' or 'loosen'
 *     (which already requires ≥ 25 sample observations)
 *   - Steps by 0.05 max per sweep — no jumps
 *   - Bounded: each gate has hard min/max so we never tune a gate
 *     out of meaningful range
 */

import { logError, logInfo } from './logger';
import {
  getAllCalibrationStats,
  type GateName,
  type CalibrationStats,
} from './inference-calibration';

const TUNE_STEP = 0.05;

interface GateTuning {
  defaultValue: number;
  min: number;
  max: number;
  /** When 'tighten' is recommended, move toward this direction. */
  stricterDirection: 'up' | 'down';
}

const GATE_RANGES: Record<GateName, GateTuning> = {
  'signal_attribution.min_correlation': {
    defaultValue: 0.6, min: 0.4, max: 0.85, stricterDirection: 'up',
  },
  'signal_attribution.min_signal_delta_pct': {
    defaultValue: 5, min: 2, max: 15, stricterDirection: 'up',
  },
  'metric_correlation.min_correlation': {
    defaultValue: 0.7, min: 0.5, max: 0.9, stricterDirection: 'up',
  },
  'cross_rca.min_causal_factors': {
    defaultValue: 2, min: 1, max: 4, stricterDirection: 'up',
  },
  'rca_closure.min_recovery_samples': {
    defaultValue: 3, min: 2, max: 7, stricterDirection: 'up',
  },
};

interface StoredThreshold {
  value: number;
  source: 'auto' | 'manual';
  updated_at: string;
  recommendation?: string;
}

const SETTING_PREFIX = 'inference_threshold:';

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

async function loadStoredThreshold(
  db: D1Database, tenantId: string, gate: GateName,
): Promise<StoredThreshold | null> {
  try {
    const r = await db.prepare(
      `SELECT value FROM tenant_settings
        WHERE tenant_id = ? AND key = ? LIMIT 1`
    ).bind(tenantId, `${SETTING_PREFIX}${gate}`).first<{ value: string }>();
    if (!r?.value) return null;
    return JSON.parse(r.value) as StoredThreshold;
  } catch {
    return null;
  }
}

async function persistThreshold(
  db: D1Database, tenantId: string, gate: GateName, threshold: StoredThreshold,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), tenantId, `${SETTING_PREFIX}${gate}`,
      JSON.stringify(threshold),
    ).run();
  } catch (err) {
    logError('threshold_autotune.persist_failed', err, { tenantId }, { gate });
  }
}

/** Pure helper: given a stats reading + the gate range, compute the
 *  next threshold value (or null = no change). Exposed for tests. */
export function nextThreshold(
  stats: CalibrationStats,
  current: number,
  range: GateTuning,
): number | null {
  if (stats.recommendation === 'hold') return null;
  const stepSign = range.stricterDirection === 'up' ? 1 : -1;
  const delta = stats.recommendation === 'tighten' ? stepSign : -stepSign;
  const next = clamp(current + delta * TUNE_STEP, range.min, range.max);
  if (next === current) return null;
  return Number(next.toFixed(3));
}

export interface AutotuneResult {
  gatesChecked: number;
  gatesTuned: number;
  manualOverridesSkipped: number;
  details: Array<{
    gate: GateName;
    from: number;
    to: number;
    recommendation: string;
  }>;
}

/** Per-tenant auto-tune sweep. Reads calibration stats per gate,
 *  applies tuning steps, skips manual overrides. */
export async function autotuneThresholds(
  db: D1Database, tenantId: string,
): Promise<AutotuneResult> {
  const result: AutotuneResult = {
    gatesChecked: 0, gatesTuned: 0, manualOverridesSkipped: 0, details: [],
  };

  const allStats = await getAllCalibrationStats(db, tenantId);

  for (const stats of allStats) {
    result.gatesChecked++;
    const range = GATE_RANGES[stats.gate];
    if (!range) continue;

    const stored = await loadStoredThreshold(db, tenantId, stats.gate);
    if (stored?.source === 'manual') {
      result.manualOverridesSkipped++;
      continue;
    }
    const current = stored?.value ?? range.defaultValue;
    const next = nextThreshold(stats, current, range);
    if (next == null) continue;

    await persistThreshold(db, tenantId, stats.gate, {
      value: next,
      source: 'auto',
      updated_at: new Date().toISOString(),
      recommendation: stats.recommendation,
    });
    result.details.push({
      gate: stats.gate,
      from: current,
      to: next,
      recommendation: stats.recommendation,
    });
    result.gatesTuned++;
  }

  if (result.gatesTuned > 0) {
    logInfo(
      'threshold_autotune.applied',
      { tenantId, layer: 'analytics', action: 'autotune' },
      { ...result },
    );
  }
  return result;
}

/** Used by analytical engines to read the effective threshold for
 *  a gate. Falls back to the default constant when no override exists. */
export async function getEffectiveThreshold(
  db: D1Database, tenantId: string, gate: GateName,
): Promise<number> {
  const range = GATE_RANGES[gate];
  if (!range) {
    logError('threshold_autotune.unknown_gate', new Error('unknown gate'),
      { tenantId }, { gate });
    return 0;
  }
  const stored = await loadStoredThreshold(db, tenantId, gate);
  if (stored && Number.isFinite(stored.value)) {
    return clamp(stored.value, range.min, range.max);
  }
  return range.defaultValue;
}

/** Manual override entry point — used by an admin route or settings UI. */
export async function setManualThreshold(
  db: D1Database, tenantId: string, gate: GateName, value: number,
): Promise<{ accepted: boolean; clamped: number | null }> {
  const range = GATE_RANGES[gate];
  if (!range) return { accepted: false, clamped: null };
  const clamped = clamp(value, range.min, range.max);
  await persistThreshold(db, tenantId, gate, {
    value: clamped,
    source: 'manual',
    updated_at: new Date().toISOString(),
  });
  return { accepted: true, clamped };
}
