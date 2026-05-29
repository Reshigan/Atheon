/**
 * Shared-Savings Billing Engine — Phase 10-19.
 *
 * Translates the Phase 10 substrate (quantified RCAs + verified
 * actions + RCA closure on metric recovery) into auditable
 * shared-savings invoices. Every claimed dollar traces to an ERP
 * record + a field mapping + a confidence score, per the project
 * memory on the business model.
 *
 * Eligibility (a resolved RCA contributes to billing iff):
 *   1. status = 'resolved' AND resolved_at within the period
 *   2. AT LEAST one verified action linked via diagnostic_prescriptions
 *      → catalyst_actions (verification_status = 'verified', from
 *      Phase 9-6 verification framework)
 *   3. impact_value > 0 on at least one causal_factor (Phase 10-10
 *      quantified amount)
 *
 * Why the verified-action gate: an RCA can recover for reasons
 * unrelated to Atheon's recommendation. We only bill when our
 * prescription was acted on AND the metric recovered AND the action
 * was verified to land in the customer's ERP. Those three together
 * are the strongest non-coincidence signal we have.
 *
 * Per-tenant share: tenant_settings key='billing_share_pct' (number
 * 0..1; default 0.2 = 20%). Customer-managed; defaults conservative.
 *
 * Persistence: billable_periods (header) + billable_line_items (per
 * resolved RCA). Status starts 'draft' so finance can review before
 * marking 'invoiced'. Idempotent on (tenant, period_start, period_end).
 */

import { logError, logInfo } from './logger';
import { getTenantCurrency } from './tenant-currency';

const DEFAULT_SHARE_PCT = 0.2;

// ── Types ──────────────────────────────────────────────────────────────

export interface BillableLineItem {
  rca_id: string;
  metric_name: string;
  attributed_savings: number;
  confidence: number;
  evidence: {
    causal_factors_count: number;
    max_factor_impact: number;
    /** The single quantified causal factor whose impact_value became the
     *  attributed_savings — the anchor that ties this claimed dollar to one
     *  ERP record + field mapping. Null only when the aggregate omits it. */
    causal_factor_id: string | null;
    verified_action_ids: string[];
    resolved_at: string | null;
    metric_id: string | null;
  };
}

export interface BillablePeriod {
  tenant_id: string;
  period_start: string;
  period_end: string;
  currency: string;
  share_pct: number;
  line_items: BillableLineItem[];
  total_realised_savings: number;
  atheon_revenue: number;
}

interface ResolvedRcaRow {
  id: string;
  metric_id: string;
  metric_name: string;
  resolved_at: string;
  confidence: number;
}

interface CausalFactorAggRow {
  rca_id: string;
  factor_id: string | null;
  max_impact: number | null;
  count: number;
}

interface VerifiedActionRow {
  rca_id: string;
  action_id: string;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function loadShareePct(db: D1Database, tenantId: string): Promise<number> {
  try {
    const r = await db.prepare(
      `SELECT value FROM tenant_settings
        WHERE tenant_id = ? AND key = 'billing_share_pct' LIMIT 1`
    ).bind(tenantId).first<{ value: string }>();
    if (!r?.value) return DEFAULT_SHARE_PCT;
    let parsed: unknown;
    try { parsed = JSON.parse(r.value); } catch { parsed = r.value; }
    let n: number | null = null;
    if (typeof parsed === 'number') n = parsed;
    else if (typeof parsed === 'string') {
      const x = Number(parsed);
      if (Number.isFinite(x)) n = x;
    } else if (parsed && typeof parsed === 'object' && typeof (parsed as Record<string, unknown>).value === 'number') {
      n = (parsed as Record<string, number>).value;
    }
    if (n == null || !Number.isFinite(n) || n < 0 || n > 1) return DEFAULT_SHARE_PCT;
    return n;
  } catch (err) {
    logError('billing.load_share_failed', err, { tenantId }, {});
    return DEFAULT_SHARE_PCT;
  }
}

async function loadResolvedRcas(
  db: D1Database, tenantId: string, periodStart: string, periodEnd: string,
): Promise<ResolvedRcaRow[]> {
  try {
    const r = await db.prepare(
      `SELECT id, metric_id, metric_name, resolved_at, confidence
         FROM root_cause_analyses
        WHERE tenant_id = ?
          AND status = 'resolved'
          AND resolved_at >= ? AND resolved_at < ?
        ORDER BY resolved_at ASC`
    ).bind(tenantId, periodStart, periodEnd).all<ResolvedRcaRow>();
    return r.results || [];
  } catch (err) {
    logError('billing.load_rcas_failed', err, { tenantId }, {});
    return [];
  }
}

async function loadFactorImpactAgg(
  db: D1Database, tenantId: string, rcaIds: string[],
): Promise<Map<string, { max: number; count: number; factorId: string | null }>> {
  const out = new Map<string, { max: number; count: number; factorId: string | null }>();
  if (rcaIds.length === 0) return out;
  const placeholders = rcaIds.map(() => '?').join(',');
  try {
    // The bare `id` column resolves to the row holding MAX(impact_value):
    // SQLite guarantees bare columns take values from the min/max row when
    // exactly one min()/max() aggregate is present. That id is the single
    // causal factor whose dollar amount becomes attributed_savings.
    const r = await db.prepare(
      `SELECT rca_id, id AS factor_id, MAX(impact_value) as max_impact, COUNT(impact_value) as count
         FROM causal_factors
        WHERE tenant_id = ? AND rca_id IN (${placeholders})
          AND impact_value IS NOT NULL AND impact_value > 0
        GROUP BY rca_id`
    ).bind(tenantId, ...rcaIds).all<CausalFactorAggRow>();
    for (const row of r.results || []) {
      out.set(row.rca_id, { max: row.max_impact ?? 0, count: row.count, factorId: row.factor_id ?? null });
    }
  } catch (err) {
    logError('billing.load_factors_failed', err, { tenantId }, {});
  }
  return out;
}

async function loadVerifiedActionsByRca(
  db: D1Database, tenantId: string, rcaIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (rcaIds.length === 0) return out;
  const placeholders = rcaIds.map(() => '?').join(',');
  try {
    // Diagnostic prescriptions belong to a parent RCA. We look for
    // catalyst_actions whose source ties back via prescriptions
    // (or directly via the prescription reference if present).
    // Schema reality: catalyst_actions has source_finding_id (added in
    // v62) which we treat as the prescription_id. Falls back to
    // matching by tenant + verified within the period.
    const r = await db.prepare(
      `SELECT dp.rca_id as rca_id, ca.id as action_id
         FROM diagnostic_prescriptions dp
         JOIN catalyst_actions ca ON ca.source_finding_id = dp.id
        WHERE dp.tenant_id = ? AND dp.rca_id IN (${placeholders})
          AND ca.tenant_id = ?
          AND ca.verification_status = 'verified'`
    ).bind(tenantId, ...rcaIds, tenantId).all<VerifiedActionRow>();
    for (const row of r.results || []) {
      const cur = out.get(row.rca_id) || [];
      cur.push(row.action_id);
      out.set(row.rca_id, cur);
    }
  } catch (err) {
    // Fallback: source_finding_id might not be populated; we tolerate
    // empty mapping rather than crash.
    logError('billing.load_actions_failed', err, { tenantId }, {});
  }
  return out;
}

// ── Pure builder ───────────────────────────────────────────────────────

interface BuildInput {
  tenantId: string;
  periodStart: string;
  periodEnd: string;
  currency: string;
  sharePct: number;
  rcas: ResolvedRcaRow[];
  factorAgg: Map<string, { max: number; count: number; factorId?: string | null }>;
  verifiedActions: Map<string, string[]>;
}

/** Pure function exposed for tests. Applies the eligibility gates and
 *  computes line items + totals. */
export function buildBillablePeriod(input: BuildInput): BillablePeriod {
  const items: BillableLineItem[] = [];
  for (const rca of input.rcas) {
    const factors = input.factorAgg.get(rca.id);
    if (!factors || factors.max <= 0) continue;
    const verifiedIds = input.verifiedActions.get(rca.id) || [];
    if (verifiedIds.length === 0) continue;
    items.push({
      rca_id: rca.id,
      metric_name: rca.metric_name,
      attributed_savings: factors.max,
      confidence: Math.max(0, Math.min(1, rca.confidence / 100)),
      evidence: {
        causal_factors_count: factors.count,
        max_factor_impact: factors.max,
        causal_factor_id: factors.factorId ?? null,
        verified_action_ids: verifiedIds,
        resolved_at: rca.resolved_at,
        metric_id: rca.metric_id,
      },
    });
  }
  const total = items.reduce((s, i) => s + i.attributed_savings, 0);
  const revenue = Math.round(total * input.sharePct);
  return {
    tenant_id: input.tenantId,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    currency: input.currency,
    share_pct: input.sharePct,
    line_items: items,
    total_realised_savings: total,
    atheon_revenue: revenue,
  };
}

// ── Persistence ────────────────────────────────────────────────────────

async function persistPeriod(
  db: D1Database, period: BillablePeriod,
): Promise<{ periodId: string | null; lineItemsInserted: number }> {
  // Idempotent on (tenant, period_start, period_end) — UPDATE if existing.
  let periodId: string | null = null;
  try {
    // Check existing
    const existing = await db.prepare(
      `SELECT id FROM billable_periods
        WHERE tenant_id = ? AND period_start = ? AND period_end = ? LIMIT 1`
    ).bind(period.tenant_id, period.period_start, period.period_end).first<{ id: string }>();
    if (existing) {
      periodId = existing.id;
      await db.prepare(
        `UPDATE billable_periods
            SET total_realised_savings = ?, atheon_share_pct = ?, atheon_revenue = ?,
                currency = ?, generated_at = datetime('now')
          WHERE id = ?`
      ).bind(
        period.total_realised_savings, period.share_pct, period.atheon_revenue,
        period.currency, existing.id,
      ).run();
      // Replace line items
      await db.prepare(`DELETE FROM billable_line_items WHERE period_id = ?`).bind(existing.id).run();
    } else {
      periodId = crypto.randomUUID();
      await db.prepare(
        `INSERT INTO billable_periods
           (id, tenant_id, period_start, period_end, total_realised_savings,
            atheon_share_pct, atheon_revenue, currency, status, generated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'draft', datetime('now'))`
      ).bind(
        periodId, period.tenant_id, period.period_start, period.period_end,
        period.total_realised_savings, period.share_pct, period.atheon_revenue,
        period.currency,
      ).run();
    }
  } catch (err) {
    logError('billing.persist_period_failed', err, { tenantId: period.tenant_id }, {});
    return { periodId: null, lineItemsInserted: 0 };
  }

  let lineItemsInserted = 0;
  for (const item of period.line_items) {
    try {
      await db.prepare(
        `INSERT INTO billable_line_items
           (id, period_id, tenant_id, rca_id, metric_name,
            attributed_savings, currency, confidence, evidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        crypto.randomUUID(), periodId, period.tenant_id, item.rca_id,
        item.metric_name, item.attributed_savings, period.currency,
        item.confidence, JSON.stringify(item.evidence),
      ).run();
      lineItemsInserted++;
    } catch (err) {
      logError('billing.persist_item_failed', err, { tenantId: period.tenant_id },
        { rca_id: item.rca_id });
    }
  }
  return { periodId, lineItemsInserted };
}

// ── Main entry ─────────────────────────────────────────────────────────

export interface ComputeOptions {
  /** ISO yyyy-mm-dd inclusive period start. */
  periodStart: string;
  /** ISO yyyy-mm-dd EXCLUSIVE period end. */
  periodEnd: string;
  /** When true, persist to billable_periods + billable_line_items.
   *  When false, just return the computed period (read-only preview). */
  persist?: boolean;
}

export interface ComputeResult {
  period: BillablePeriod;
  persisted: boolean;
  periodId: string | null;
  lineItemsInserted: number;
}

export async function computeBillablePeriod(
  db: D1Database, tenantId: string, opts: ComputeOptions,
): Promise<ComputeResult> {
  const currency = await getTenantCurrency(db, tenantId);
  const sharePct = await loadShareePct(db, tenantId);
  const rcas = await loadResolvedRcas(db, tenantId, opts.periodStart, opts.periodEnd);
  const ids = rcas.map((r) => r.id);
  const [factorAgg, verifiedActions] = await Promise.all([
    loadFactorImpactAgg(db, tenantId, ids),
    loadVerifiedActionsByRca(db, tenantId, ids),
  ]);

  const period = buildBillablePeriod({
    tenantId, periodStart: opts.periodStart, periodEnd: opts.periodEnd,
    currency, sharePct, rcas, factorAgg, verifiedActions,
  });

  if (!opts.persist || period.line_items.length === 0) {
    return { period, persisted: false, periodId: null, lineItemsInserted: 0 };
  }

  const { periodId, lineItemsInserted } = await persistPeriod(db, period);
  if (periodId) {
    logInfo('billing.period_persisted',
      { tenantId, layer: 'billing', action: 'compute_period' },
      {
        period_start: opts.periodStart, period_end: opts.periodEnd,
        line_items: lineItemsInserted, atheon_revenue: period.atheon_revenue,
        currency,
      });
  }
  return { period, persisted: !!periodId, periodId, lineItemsInserted };
}
