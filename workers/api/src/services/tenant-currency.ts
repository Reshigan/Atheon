/**
 * Tenant Currency Resolution — Phase 10-9.
 *
 * Single source of truth for "what currency does this tenant operate in".
 * Until this module landed, several places hardcoded 'ZAR' even though
 * tenants outside South Africa would get incorrect monetary outputs.
 *
 * Resolution chain (first match wins):
 *  1. tenant_settings.currency (customer-declared, authoritative)
 *  2. tenants.region → ISO currency mapping (af-south-1 → ZAR,
 *     eu-* → EUR, us-* → USD, ap-* → SGD as a regional default)
 *  3. Hard default 'ZAR' (Atheon's primary launch market)
 *
 * Returns ISO 4217 codes. Consumers use the code directly in UI/LLM
 * prompts and in `causal_factors.impact_unit`, `radar_signals.raw_data`,
 * etc., so downstream presentation stays consistent.
 */

import { logError } from './logger';

const REGION_TO_CURRENCY: Array<[RegExp, string]> = [
  [/^af-/, 'ZAR'],
  [/^eu-/, 'EUR'],
  [/^us-/, 'USD'],
  [/^uk-|^gb-/, 'GBP'],
  [/^ap-southeast-1/, 'SGD'],
  [/^ap-southeast-2/, 'AUD'],
  [/^ap-northeast-1/, 'JPY'],
  [/^ap-/, 'SGD'],
  [/^me-/, 'AED'],
  [/^sa-/, 'BRL'],
];

const KNOWN_CURRENCIES = new Set([
  'ZAR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'INR',
  'BRL', 'AED', 'SGD', 'NZD', 'MXN', 'KES', 'NGN', 'GHS', 'EGP',
]);

const DEFAULT_CURRENCY = 'ZAR';

/** Cache per-process; tenant currency rarely changes mid-cron-tick. */
const CACHE = new Map<string, { currency: string; ts: number }>();
const CACHE_TTL_MS = 60_000;

async function loadDeclaredCurrency(db: D1Database, tenantId: string): Promise<string | null> {
  try {
    const r = await db.prepare(
      `SELECT value FROM tenant_settings
        WHERE tenant_id = ? AND key = 'currency' LIMIT 1`
    ).bind(tenantId).first<{ value: string }>();
    if (!r?.value) return null;
    // value is stored as JSON in this table; tolerate both raw and quoted strings
    let raw = r.value.trim();
    if (raw.startsWith('"') && raw.endsWith('"')) raw = raw.slice(1, -1);
    try {
      const parsed = JSON.parse(r.value);
      if (typeof parsed === 'string') raw = parsed;
      else if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') raw = parsed.code;
    } catch { /* fallthrough — already trimmed */ }
    raw = raw.toUpperCase();
    return KNOWN_CURRENCIES.has(raw) ? raw : null;
  } catch (err) {
    logError('tenant_currency.load_setting_failed', err, { tenantId }, {});
    return null;
  }
}

async function loadTenantRegion(db: D1Database, tenantId: string): Promise<string | null> {
  try {
    const r = await db.prepare(
      `SELECT region FROM tenants WHERE id = ? LIMIT 1`
    ).bind(tenantId).first<{ region: string | null }>();
    return r?.region ?? null;
  } catch (err) {
    logError('tenant_currency.load_region_failed', err, { tenantId }, {});
    return null;
  }
}

/** Pure mapping from region to currency (exposed for tests). */
export function currencyForRegion(region: string | null | undefined): string | null {
  if (!region) return null;
  const r = region.toLowerCase();
  for (const [re, curr] of REGION_TO_CURRENCY) {
    if (re.test(r)) return curr;
  }
  return null;
}

/** Resolve the tenant's operating currency. Cached for 60s per process. */
export async function getTenantCurrency(db: D1Database, tenantId: string): Promise<string> {
  const cached = CACHE.get(tenantId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.currency;

  const declared = await loadDeclaredCurrency(db, tenantId);
  if (declared) {
    CACHE.set(tenantId, { currency: declared, ts: Date.now() });
    return declared;
  }

  const region = await loadTenantRegion(db, tenantId);
  const fromRegion = currencyForRegion(region);
  if (fromRegion) {
    CACHE.set(tenantId, { currency: fromRegion, ts: Date.now() });
    return fromRegion;
  }

  CACHE.set(tenantId, { currency: DEFAULT_CURRENCY, ts: Date.now() });
  return DEFAULT_CURRENCY;
}

/** Test helper to clear the per-process cache. */
export function _resetCurrencyCacheForTests(): void {
  CACHE.clear();
}
