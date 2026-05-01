/**
 * ERP Process Profile — Phase 5A of dynamic ERP intelligence.
 *
 * Customers configure their ERPs differently and those configurations
 * shape the legitimate behaviour of business processes:
 *   - 2-way vs 3-way invoice matching
 *   - AP / PO tolerance percentage (e.g. ±2 % vs ±5 %)
 *   - Default payment terms (Net 30 vs Net 60)
 *   - Fiscal year start (Jan vs Mar vs Jul)
 *   - Approval thresholds (auto-approve up to R10k, ZAR 50k needs CFO …)
 *   - Dunning rules (chase at 30/60/90 days vs 7/14/30)
 *
 * Catalysts that don't read the customer's actual rules either miss the
 * savings (e.g. a 5%-tolerance customer running a catalyst that only
 * flags >2% variances under-reports) or generate false-positive
 * exceptions (a Net-60 customer flagged as overdue by a Net-30 default).
 *
 * This service has two halves:
 *   1. **inferProcessProfile**: read observed canonical data and rule-
 *      derive the most likely profile. E.g. histogram payment_terms
 *      across erp_invoices → mode is the customer's default.
 *   2. **getProcessProfile**: load the resolved profile (with KV cache)
 *      for a (tenant, connection) so catalyst handlers can consult it
 *      on every run.
 *
 * Customer overrides via UI take precedence over inferred values; we
 * track both in `evidence_json` so the audit trail shows where each
 * profile field came from ("inferred from 142 invoices" vs "set by
 * jane@example.com on 2026-04-12").
 */

import { logError } from './logger';

export type ThreeWayMatch = '2way' | '3way' | 'none' | 'unknown';

export interface ApprovalThreshold {
  /** Spend amount above which approval is required. */
  amount: number;
  /** Role/level required to approve at this threshold. */
  role: string;
}

export interface ProcessProfile {
  /** Invoice-matching mode — drives 3-Way Match catalyst behaviour. */
  matching_mode: ThreeWayMatch;
  /** Acceptable price/quantity variance for matching, as a percent (0-100). */
  tolerance_pct: number;
  /** Default payment terms in days — drives AP Aging buckets. */
  payment_terms_days: number;
  /** Month index (1-12) when the fiscal year starts. */
  fiscal_year_start_month: number;
  /** ISO 4217 default currency. */
  default_currency: string;
  /** Approval thresholds, ascending by amount. */
  approval_thresholds: ApprovalThreshold[];
  /** Dunning ladder in days — when each reminder fires. */
  dunning_days: number[];
  /** When the profile was last refreshed. */
  refreshed_at?: string;
}

/** Per-field evidence shape — tracks source of each value for audit.
 *  `low-confidence` = data was insufficient or inconclusive; the field stays
 *  at its default and the catalyst layer should treat it as "don't apply
 *  customer-specific rules — use generic behaviour". This prevents false
 *  positives caused by inferring rules from too-thin data. */
export interface ProfileEvidence {
  matching_mode: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  tolerance_pct: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  payment_terms_days: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  fiscal_year_start_month: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  default_currency: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  approval_thresholds: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
  dunning_days: { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number };
}

// ── Inference confidence thresholds — designed to favour false negatives
//    (leave the field unset and ask the customer) over false positives
//    (silently apply a weak inference and miscalculate savings). ──

/** Minimum sample size before we attempt any inference at all. Below this,
 *  the field stays default and the catalyst behaves generically. */
const MIN_SAMPLE_FOR_INFERENCE = 25;

/** Minimum share of the modal value (0-1). E.g. 0.7 means the most-common
 *  value must account for ≥ 70 % of the sample to be trusted as the rule. */
const MIN_MODE_SHARE = 0.7;

/** For numeric scoring of source-link heuristics (matching_mode), the
 *  fraction below which we declare insufficient evidence. */
const MATCHING_MODE_LOW_CONFIDENCE_BELOW = 0.5;

/** Sensible defaults for every profile field — used when neither inference nor
 *  human override has set a value. Catalysts always get a complete profile. */
export const DEFAULT_PROCESS_PROFILE: ProcessProfile = {
  matching_mode: 'unknown',
  tolerance_pct: 5,
  payment_terms_days: 30,
  fiscal_year_start_month: 3, // March (South Africa fiscal year)
  default_currency: 'ZAR',
  approval_thresholds: [],
  dunning_days: [30, 60, 90],
};

const DEFAULT_EVIDENCE: ProfileEvidence = {
  matching_mode: { source: 'default' },
  tolerance_pct: { source: 'default' },
  payment_terms_days: { source: 'default' },
  fiscal_year_start_month: { source: 'default' },
  default_currency: { source: 'default' },
  approval_thresholds: { source: 'default' },
  dunning_days: { source: 'default' },
};

// ── Inference helpers ──

interface PaymentTermsRow { payment_terms: string | null; n: number }

/** Pick the modal payment terms across invoices for the connection.
 *  We accept either numeric ("30") or the canonical "Net 30" / "30 days" forms. */
function parsePaymentTermsToDays(s: string | null | undefined): number | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  // "30", "30 days", "Net 30", "NET30", "30 Days"
  const m = trimmed.match(/(\d+)/);
  if (m) {
    const n = parseInt(m[1], 10);
    if (!isNaN(n) && n > 0 && n < 365) return n;
  }
  return null;
}

async function inferPaymentTermsDays(db: D1Database, tenantId: string, connectionId: string): Promise<{ value?: number; basis?: string; confidence?: number; lowConfidenceReason?: string }> {
  try {
    // Try connection-scoped first; fall back to tenant-wide.
    let rows: PaymentTermsRow[] = [];
    try {
      const r = await db.prepare(
        `SELECT payment_terms, COUNT(*) as n FROM erp_customers
          WHERE tenant_id = ? AND connection_id = ? AND payment_terms IS NOT NULL
          GROUP BY payment_terms`
      ).bind(tenantId, connectionId).all<PaymentTermsRow>();
      rows = r.results || [];
    } catch { /* connection_id may not exist on column for older deploys */ }

    if (rows.length === 0) {
      const r = await db.prepare(
        `SELECT payment_terms, COUNT(*) as n FROM erp_customers
          WHERE tenant_id = ? AND payment_terms IS NOT NULL
          GROUP BY payment_terms`
      ).bind(tenantId).all<PaymentTermsRow>();
      rows = r.results || [];
    }

    const histogram = new Map<number, number>();
    let total = 0;
    for (const row of rows) {
      const days = parsePaymentTermsToDays(row.payment_terms);
      if (days === null) continue;
      histogram.set(days, (histogram.get(days) || 0) + (row.n || 0));
      total += row.n || 0;
    }
    if (histogram.size === 0 || total === 0) return {};

    let modeDays = 30, modeCount = 0;
    for (const [d, c] of histogram) {
      if (c > modeCount) { modeCount = c; modeDays = d; }
    }
    const share = modeCount / total;
    const sharePct = Math.round(share * 100);

    // Strong-inference gates — protect against false positives.
    if (total < MIN_SAMPLE_FOR_INFERENCE) {
      return {
        confidence: share,
        lowConfidenceReason: `only ${total} customers with payment_terms (need ≥${MIN_SAMPLE_FOR_INFERENCE})`,
      };
    }
    if (share < MIN_MODE_SHARE) {
      return {
        confidence: share,
        lowConfidenceReason: `most-common term (${modeDays}-day) is only ${sharePct}% of the sample (need ≥${MIN_MODE_SHARE * 100}%) — likely mixed terms by customer segment`,
      };
    }

    return {
      value: modeDays,
      confidence: share,
      basis: `mode of payment_terms across ${total} customers (${sharePct}% are ${modeDays}-day)`,
    };
  } catch {
    return {};
  }
}

interface CurrencyRow { currency: string | null; n: number }

async function inferDefaultCurrency(db: D1Database, tenantId: string, connectionId: string): Promise<{ value?: string; basis?: string; confidence?: number; lowConfidenceReason?: string }> {
  try {
    let rows: CurrencyRow[] = [];
    try {
      const r = await db.prepare(
        `SELECT currency, COUNT(*) as n FROM erp_invoices
          WHERE tenant_id = ? AND connection_id = ? AND currency IS NOT NULL AND currency != ''
          GROUP BY currency`
      ).bind(tenantId, connectionId).all<CurrencyRow>();
      rows = r.results || [];
    } catch { /* fallthrough */ }
    if (rows.length === 0) {
      const r = await db.prepare(
        `SELECT currency, COUNT(*) as n FROM erp_invoices
          WHERE tenant_id = ? AND currency IS NOT NULL AND currency != ''
          GROUP BY currency`
      ).bind(tenantId).all<CurrencyRow>();
      rows = r.results || [];
    }
    if (rows.length === 0) return {};
    let mode = '', max = 0, total = 0;
    for (const r of rows) {
      total += r.n || 0;
      if ((r.n || 0) > max) { max = r.n || 0; mode = r.currency || ''; }
    }
    if (!mode) return {};
    const share = max / total;
    const sharePct = Math.round(share * 100);

    // Sample size — invoices accumulate fast so threshold is mid-strict.
    if (total < MIN_SAMPLE_FOR_INFERENCE) {
      return {
        confidence: share,
        lowConfidenceReason: `only ${total} invoices with currency (need ≥${MIN_SAMPLE_FOR_INFERENCE})`,
      };
    }
    // Multi-currency customers must be flagged, not coerced to one.
    if (share < MIN_MODE_SHARE) {
      return {
        confidence: share,
        lowConfidenceReason: `top currency (${mode}) is only ${sharePct}% of invoices — looks like a multi-currency operation; default currency should be set explicitly`,
      };
    }
    return {
      value: mode,
      confidence: share,
      basis: `mode of invoice currency across ${total} records (${sharePct}% are ${mode})`,
    };
  } catch {
    return {};
  }
}

async function inferMatchingMode(db: D1Database, tenantId: string, connectionId: string): Promise<{ value?: ThreeWayMatch; basis?: string; confidence?: number; lowConfidenceReason?: string }> {
  try {
    // Heuristic: if a meaningful % of invoices reference a PO, the customer
    // is doing some form of matching. The PO-link rate is a noisy signal —
    // ERP exports don't always populate `reference` consistently — so we
    // require a substantial sample and treat anything in the middle band
    // as low-confidence rather than guessing.
    // Try connection-scoped first; fall back to tenant-wide on older deploys
    // where erp_invoices.connection_id was not yet populated.
    let totalRow: { n: number } | null = null;
    try {
      totalRow = await db.prepare(
        `SELECT COUNT(*) as n FROM erp_invoices WHERE tenant_id = ? AND connection_id = ?`
      ).bind(tenantId, connectionId).first<{ n: number }>();
    } catch { /* connection_id may not exist yet */ }
    if (!totalRow || (totalRow.n || 0) === 0) {
      totalRow = await db.prepare(
        `SELECT COUNT(*) as n FROM erp_invoices WHERE tenant_id = ?`
      ).bind(tenantId).first<{ n: number }>();
    }
    const total = totalRow?.n || 0;

    // Strong sample requirement — matching mode must be defensible to be
    // applied. Below this we leave the field unset and the catalyst defaults
    // to mode-agnostic checks.
    if (total < MIN_SAMPLE_FOR_INFERENCE) {
      return {
        lowConfidenceReason: `only ${total} invoices on file (need ≥${MIN_SAMPLE_FOR_INFERENCE})`,
      };
    }

    // PO-linked invoices
    const poLinkedRow = await db.prepare(
      `SELECT COUNT(*) as n FROM erp_invoices i
        WHERE i.tenant_id = ?
          AND EXISTS (SELECT 1 FROM erp_purchase_orders p
                       WHERE p.tenant_id = i.tenant_id
                         AND (p.reference = i.reference OR p.po_number = i.reference))`
    ).bind(tenantId).first<{ n: number }>();
    const poLinked = poLinkedRow?.n || 0;
    const linkedPct = poLinked / total;
    const linkedPctLabel = `${Math.round(linkedPct * 100)}%`;

    // Three confident bands; a wide low-confidence middle.
    if (linkedPct >= 0.85) {
      return { value: '3way', confidence: linkedPct, basis: `${linkedPctLabel} of invoices link to a PO (≥85% — confident 3-way matching)` };
    }
    if (linkedPct >= MATCHING_MODE_LOW_CONFIDENCE_BELOW && linkedPct < 0.85) {
      return {
        confidence: linkedPct,
        lowConfidenceReason: `${linkedPctLabel} PO-link rate is mid-range — could be 2-way or partial 3-way; please confirm the matching policy`,
      };
    }
    if (linkedPct >= 0.1 && linkedPct < MATCHING_MODE_LOW_CONFIDENCE_BELOW) {
      return { value: '2way', confidence: linkedPct, basis: `${linkedPctLabel} of invoices link to a PO (10-${MATCHING_MODE_LOW_CONFIDENCE_BELOW * 100}% — looks like 2-way matching on a subset)` };
    }
    return { value: 'none', confidence: 1 - linkedPct, basis: `${linkedPctLabel} of invoices link to a PO — not actively matching` };
  } catch {
    return {};
  }
}

// ── Public API ──

/** Run inference + persist a profile for (tenant, connection). Idempotent —
 *  re-runs simply UPSERT. Customer overrides (saved with source='human')
 *  are NOT touched here. */
export async function inferProcessProfile(
  db: D1Database, tenantId: string, connectionId: string,
): Promise<{ profile: ProcessProfile; evidence: ProfileEvidence }> {
  const profile: ProcessProfile = { ...DEFAULT_PROCESS_PROFILE, refreshed_at: new Date().toISOString() };
  const evidence: ProfileEvidence = JSON.parse(JSON.stringify(DEFAULT_EVIDENCE));

  // First read any existing human overrides — those win over inference.
  const existing = await getProcessProfile(db, tenantId, connectionId);
  const existingOverrides = existing?.evidence ? Object.entries(existing.evidence)
    .filter(([, ev]) => (ev as { source?: string })?.source === 'human')
    .map(([k]) => k as keyof ProcessProfile) : [];

  // Payment terms
  if (!existingOverrides.includes('payment_terms_days')) {
    const ptd = await inferPaymentTermsDays(db, tenantId, connectionId);
    if (typeof ptd.value === 'number') {
      profile.payment_terms_days = ptd.value;
      evidence.payment_terms_days = { source: 'inferred', basis: ptd.basis, confidence: ptd.confidence };
    } else if (ptd.lowConfidenceReason) {
      evidence.payment_terms_days = { source: 'low-confidence', basis: ptd.lowConfidenceReason, confidence: ptd.confidence };
    }
  } else if (existing) {
    profile.payment_terms_days = existing.profile.payment_terms_days;
    evidence.payment_terms_days = existing.evidence.payment_terms_days;
  }

  // Default currency
  if (!existingOverrides.includes('default_currency')) {
    const cur = await inferDefaultCurrency(db, tenantId, connectionId);
    if (cur.value) {
      profile.default_currency = cur.value;
      evidence.default_currency = { source: 'inferred', basis: cur.basis, confidence: cur.confidence };
    } else if (cur.lowConfidenceReason) {
      evidence.default_currency = { source: 'low-confidence', basis: cur.lowConfidenceReason, confidence: cur.confidence };
    }
  } else if (existing) {
    profile.default_currency = existing.profile.default_currency;
    evidence.default_currency = existing.evidence.default_currency;
  }

  // Matching mode
  if (!existingOverrides.includes('matching_mode')) {
    const mm = await inferMatchingMode(db, tenantId, connectionId);
    if (mm.value) {
      profile.matching_mode = mm.value;
      evidence.matching_mode = { source: 'inferred', basis: mm.basis, confidence: mm.confidence };
    } else if (mm.lowConfidenceReason) {
      evidence.matching_mode = { source: 'low-confidence', basis: mm.lowConfidenceReason, confidence: mm.confidence };
    }
  } else if (existing) {
    profile.matching_mode = existing.profile.matching_mode;
    evidence.matching_mode = existing.evidence.matching_mode;
  }

  // Carry across human overrides on remaining fields untouched.
  for (const k of existingOverrides) {
    if (existing) {
      const key = k as keyof ProcessProfile;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (profile as any)[key] = (existing.profile as any)[key];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (evidence as any)[key] = (existing.evidence as any)[key];
    }
  }

  // Persist UPSERT
  try {
    await db.prepare(
      `INSERT INTO erp_process_profiles (id, tenant_id, connection_id, profile_json, evidence_json, inferred_at, updated_at)
       VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
       ON CONFLICT(tenant_id, connection_id) DO UPDATE SET
         profile_json = excluded.profile_json,
         evidence_json = excluded.evidence_json,
         inferred_at = excluded.inferred_at,
         updated_at = excluded.updated_at`
    ).bind(
      crypto.randomUUID(), tenantId, connectionId,
      JSON.stringify(profile), JSON.stringify(evidence),
    ).run();
  } catch (err) {
    logError('erp.process_profile.persist_failed', err, { tenantId }, { connectionId });
  }
  return { profile, evidence };
}

/** Load the persisted profile (raw, no inference). Returns null if absent. */
export async function getProcessProfile(
  db: D1Database, tenantId: string, connectionId: string,
): Promise<{ profile: ProcessProfile; evidence: ProfileEvidence; updatedAt: string } | null> {
  try {
    const row = await db.prepare(
      `SELECT profile_json, evidence_json, updated_at
         FROM erp_process_profiles
        WHERE tenant_id = ? AND connection_id = ?`
    ).bind(tenantId, connectionId).first<{ profile_json: string; evidence_json: string; updated_at: string }>();
    if (!row) return null;
    const profile = { ...DEFAULT_PROCESS_PROFILE, ...JSON.parse(row.profile_json) } as ProcessProfile;
    const evidence = { ...DEFAULT_EVIDENCE, ...JSON.parse(row.evidence_json) } as ProfileEvidence;
    return { profile, evidence, updatedAt: row.updated_at };
  } catch (err) {
    logError('erp.process_profile.read_failed', err, { tenantId }, { connectionId });
    return null;
  }
}

/** Apply a customer override — the supplied fields go to source='human' and
 *  are protected from being overwritten by future inference runs. */
export async function setProcessProfileOverrides(
  db: D1Database, tenantId: string, connectionId: string,
  overrides: Partial<ProcessProfile>, who?: string,
): Promise<{ profile: ProcessProfile; evidence: ProfileEvidence }> {
  const existing = (await getProcessProfile(db, tenantId, connectionId)) || {
    profile: { ...DEFAULT_PROCESS_PROFILE },
    evidence: JSON.parse(JSON.stringify(DEFAULT_EVIDENCE)),
    updatedAt: '',
  };
  const profile: ProcessProfile = { ...existing.profile };
  const evidence: ProfileEvidence = { ...existing.evidence };

  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined || v === null) continue;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (profile as any)[k] = v;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (evidence as any)[k] = { source: 'human', basis: who ? `set by ${who}` : 'set by user' };
  }

  await db.prepare(
    `INSERT INTO erp_process_profiles (id, tenant_id, connection_id, profile_json, evidence_json, inferred_at, updated_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
     ON CONFLICT(tenant_id, connection_id) DO UPDATE SET
       profile_json = excluded.profile_json,
       evidence_json = excluded.evidence_json,
       updated_at = excluded.updated_at`
  ).bind(
    crypto.randomUUID(), tenantId, connectionId,
    JSON.stringify(profile), JSON.stringify(evidence),
  ).run();

  return { profile, evidence };
}

/** Convenience: profile with sensible defaults filled in for any missing
 *  fields. Catalyst handlers use this so they always have a complete object. */
export async function loadProcessProfile(
  db: D1Database, tenantId: string, connectionId: string,
): Promise<ProcessProfile> {
  const got = await getProcessProfile(db, tenantId, connectionId);
  return got ? { ...DEFAULT_PROCESS_PROFILE, ...got.profile } : { ...DEFAULT_PROCESS_PROFILE };
}
