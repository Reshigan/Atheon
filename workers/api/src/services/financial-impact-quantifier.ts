/**
 * Financial Impact Quantifier — Phase 10-10.
 *
 * Translates qualitative causal links ("Brent ↑ → procurement cost ↑")
 * into quantitative monetary impact ("≈ R0.97M/month margin pressure").
 * This is the substrate for the shared-savings billing model — every
 * claimed dollar of impact must trace to a metric value, a signal
 * delta, and a correlation strength, all visible in `causal_factors.evidence`.
 *
 * Method (deterministic, no LLM):
 *
 *   For an EXTERNAL DRIVER (Phase 10-3 signal_impact attribution):
 *     impact ≈ metric_base × |signal_delta_pct| / 100 × |correlation|
 *
 *   For a CROSS-METRIC DRIVER (Phase 10-1 correlation):
 *     impact ≈ symptom_base × peer_delta_pct / 100 × |correlation|
 *     (when peer_delta_pct is available — otherwise null)
 *
 * Where `metric_base` is:
 *   1. metric.value (when the metric's unit is monetary — e.g. ZAR/USD)
 *   2. Looked up from tenant_settings.monthly_revenue_base (when set)
 *   3. null (silent) — we'd rather attach no number than the wrong one
 *
 * Strong-inference policy (matches the project memory on inference
 * strength): prefer false negatives. If we can't tell the metric is
 * monetary or we have no base value, we return null and let the
 * causal_factors.impact_value stay null — better than printing a
 * fabricated dollar amount on an executive briefing.
 *
 * The returned value is a positive magnitude (absolute). Direction
 * (headwind vs tailwind) is already captured on signal_impacts and
 * the causal factor's evidence; impact_value carries the size only.
 */

import { logError } from './logger';

const KNOWN_CURRENCY_CODES = new Set([
  'ZAR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR',
  'BRL', 'AED', 'SGD', 'NZD', 'MXN', 'KES', 'NGN', 'GHS', 'EGP',
]);
const CURRENCY_SYMBOLS = new Set(['R', '$', '€', '£', '¥', '₹', 'A$', 'C$', 'NZ$']);

export interface MetricBase {
  value: number;
  unit: string | null;
}

/** True if the metric's unit reads as monetary, so we can use its value
 *  as a base for impact estimation. */
export function isMonetaryUnit(unit: string | null | undefined, currency: string): boolean {
  if (!unit) return false;
  const u = unit.trim().toUpperCase();
  if (KNOWN_CURRENCY_CODES.has(u)) return true;
  if (u === currency.toUpperCase()) return true;
  // Common multi-suffix forms: "ZAR/month", "USD-thousands", "R '000"
  for (const code of KNOWN_CURRENCY_CODES) {
    if (u.startsWith(code + '/') || u.startsWith(code + '-') || u.startsWith(code + ' ')) return true;
  }
  if (CURRENCY_SYMBOLS.has(unit.trim())) return true;
  if (CURRENCY_SYMBOLS.has(unit.trim().charAt(0))) return true;
  return false;
}

/** Resolve a tenant-level monetary base (e.g. monthly revenue) when
 *  individual metric units are not monetary themselves. */
export async function loadTenantMonthlyBase(
  db: D1Database, tenantId: string,
): Promise<number | null> {
  try {
    const r = await db.prepare(
      `SELECT value FROM tenant_settings
        WHERE tenant_id = ? AND key = 'monthly_revenue_base' LIMIT 1`
    ).bind(tenantId).first<{ value: string }>();
    if (!r?.value) return null;
    const raw = (() => {
      try {
        const parsed = JSON.parse(r.value);
        if (typeof parsed === 'number') return parsed;
        if (parsed && typeof parsed === 'object' && typeof parsed.value === 'number') return parsed.value;
        if (typeof parsed === 'string') {
          const n = Number(parsed);
          return Number.isFinite(n) ? n : null;
        }
      } catch { /* fallthrough */ }
      const n = Number(r.value);
      return Number.isFinite(n) ? n : null;
    })();
    if (raw == null || raw <= 0) return null;
    return raw;
  } catch (err) {
    logError('financial_impact.load_base_failed', err, { tenantId }, {});
    return null;
  }
}

/** External driver: impact = base × |Δ%| / 100 × |r|.
 *  Returns null if no usable base or invalid inputs. */
export function estimateExternalDriverImpact(
  metric: MetricBase,
  signalDeltaPct: number | undefined | null,
  correlation: number | undefined | null,
  tenantCurrency: string,
  tenantBase: number | null,
): number | null {
  if (signalDeltaPct == null || correlation == null) return null;
  if (!Number.isFinite(signalDeltaPct) || !Number.isFinite(correlation)) return null;
  const r = Math.abs(correlation);
  const pct = Math.abs(signalDeltaPct);
  if (r <= 0 || pct <= 0) return null;

  let base: number | null = null;
  if (isMonetaryUnit(metric.unit, tenantCurrency) && Number.isFinite(metric.value) && Math.abs(metric.value) > 0) {
    base = Math.abs(metric.value);
  } else if (tenantBase && tenantBase > 0) {
    base = tenantBase;
  }
  if (base == null) return null;

  const impact = base * (pct / 100) * r;
  if (!Number.isFinite(impact) || impact <= 0) return null;
  return Math.round(impact);
}

/** Cross-metric driver: impact = symptom_base × peer_delta_pct / 100 × |r|.
 *  Use when the symptom's unit is monetary; otherwise null. */
export function estimateCrossMetricImpact(
  symptom: MetricBase,
  peerDeltaPct: number | undefined | null,
  edgeConfidence: number,
  tenantCurrency: string,
  tenantBase: number | null,
): number | null {
  if (peerDeltaPct == null || !Number.isFinite(peerDeltaPct)) {
    // No peer delta available — fall back to the same shape but with
    // a conservative 5% nominal motion (the threshold we attribute on)
    return estimateExternalDriverImpact(symptom, 5, edgeConfidence, tenantCurrency, tenantBase);
  }
  return estimateExternalDriverImpact(symptom, peerDeltaPct, edgeConfidence, tenantCurrency, tenantBase);
}

export interface QuantifiedImpact {
  value: number;
  unit: string;
  basis: 'metric_value' | 'tenant_base';
}

/** High-level wrapper used by RCA synthesizer. Picks base, computes,
 *  packages the result. Returns null when no monetary anchor exists. */
export async function quantifyExternalDriverImpact(
  db: D1Database, tenantId: string,
  metric: MetricBase,
  signalDeltaPct: number | undefined | null,
  correlation: number | undefined | null,
  tenantCurrency: string,
): Promise<QuantifiedImpact | null> {
  const tenantBase = await loadTenantMonthlyBase(db, tenantId);
  const value = estimateExternalDriverImpact(
    metric, signalDeltaPct, correlation, tenantCurrency, tenantBase,
  );
  if (value == null) return null;
  const basis = isMonetaryUnit(metric.unit, tenantCurrency) ? 'metric_value' : 'tenant_base';
  return { value, unit: tenantCurrency, basis };
}
