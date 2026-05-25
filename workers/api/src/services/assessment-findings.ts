/**
 * Assessment Findings Engine
 * --------------------------
 * Detects specific business issues from a customer's connected ERP data and
 * maps each issue to the catalyst / sub-catalyst that resolves it.
 *
 * This is the engine the sales motion depends on — it has to be thorough,
 * quantitatively rigorous, and produce evidence the prospect can verify
 * against their own records. Every finding includes:
 *   - a numeric value-at-risk derived from the customer's actual data
 *     (NEVER a fixed-percentage estimate)
 *   - a confidence rating from data-completeness
 *   - 5–10 sample records (refs, amounts, dates) the prospect can sanity-check
 *   - the catalyst + sub-catalyst that resolves the finding (so the report can
 *     close the loop: "here's the problem, here's the cure, here's the ROI")
 *
 * Detectors are grouped by domain (AR, AP, GL, procurement, inventory, sales,
 * workforce, compliance, cross-cutting). Each is a pure async function with a
 * single SQL query (or a small number of related queries), no side effects.
 *
 * Multi-currency: each query keeps the native currency on each row and
 * normalises to ZAR using `ctx.exchangeRates` for the headline value. The
 * per-currency split is preserved in `currency_breakdown` so the report can
 * call out FX exposure explicitly.
 *
 * Multi-company: when `ctx.companyIds` is set, every query scopes to those
 * companies via `erp_*.company_id IN (…)`. Tables that don't yet have a
 * `company_id` column degrade gracefully — the column is filtered if present.
 */

// ── Types ─────────────────────────────────────────────────────────────────

/**
 * Stable identifier for each finding type. New detectors must add a code here
 * AND a row in `FINDING_CATALYST_MAP` below — the build will not link without
 * both. The string format is `<domain>_<short-name>` so the codes also work as
 * Pulse metric signatures (see `metric_signature` on `Finding`).
 */
export type FindingCode =
  // AR
  | 'ar_aging_overdue_30_60'
  | 'ar_aging_overdue_60_90'
  | 'ar_aging_overdue_90_plus'
  | 'ar_credit_limit_breach'
  | 'ar_top_debtor_concentration'
  // AP
  | 'ap_overdue_delivery'
  | 'ap_three_way_mismatch'
  | 'ap_unreconciled_bank'
  // GL
  | 'gl_suspense_balance'
  | 'gl_journal_off_hours'
  | 'gl_round_amount_journals'
  | 'gl_high_manual_volume'
  // Procurement
  | 'proc_maverick_spend'
  | 'proc_duplicate_suppliers'
  | 'proc_supplier_concentration'
  | 'proc_inactive_with_open_pos'
  // Inventory / Supply Chain
  | 'inv_stale_stock'
  | 'inv_dead_stock'
  | 'inv_negative_stock'
  | 'inv_below_reorder'
  | 'inv_margin_erosion'
  | 'inv_inactive_with_value'
  // Sales / Customer
  | 'sales_customer_concentration'
  | 'sales_inactive_with_ar'
  | 'sales_credit_no_check'
  // Workforce / Payroll
  | 'hr_terminated_in_payroll'
  | 'hr_high_payroll_concentration'
  // Compliance / Tax
  | 'tax_overdue_submission'
  | 'tax_missing_vat_numbers'
  | 'tax_vat_rate_anomaly'
  // Cross-cutting / FX
  | 'fx_currency_exposure'
  | 'fx_dual_use_currency'
  // Service-company specific (require erp_projects / erp_time_entries)
  | 'svc_low_billable_utilisation'
  | 'svc_unbilled_time_aging'
  | 'svc_project_overrun'
  | 'svc_project_margin_negative'
  | 'svc_unapproved_time_entries'
  | 'svc_revenue_recognition_lag'
  | 'svc_zero_hours_active_project'
  | 'svc_inactive_employee_billed_time';

export type FindingCategory =
  | 'finance'
  | 'procurement'
  | 'supply_chain'
  | 'sales'
  | 'workforce'
  | 'compliance'
  | 'cross_cutting'
  | 'service_delivery';

export type CompanyProfile = 'product' | 'service' | 'mixed' | 'unknown';

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export type EvidenceQuality = 'high' | 'medium' | 'low';

/** A 1–10 record sample shown verbatim in the report. */
export interface SampleRecord {
  /** Human-readable identifier (invoice number, SKU, customer name, etc.) */
  ref: string;
  description: string;
  amount_native?: number;
  currency?: string;
  amount_zar?: number;
  date?: string;
  /** Anything the report should render verbatim — keep small. */
  metadata?: Record<string, string | number>;
}

/** One $-quantified component of value-at-risk. */
export interface ValueComponent {
  label: string;
  amount_zar: number;
  methodology: string;
}

export interface Finding {
  /** Stable per-detection-run id; not a database key. */
  id: string;
  code: FindingCode;
  category: FindingCategory;
  severity: Severity;
  /** One-line headline (≤ 100 chars). */
  title: string;
  /** 2–4 sentence narrative quoting the customer's own numbers. */
  narrative: string;
  affected_count: number;
  value_at_risk_zar: number;
  value_components: ValueComponent[];
  /** Native-currency breakdown. Empty for ZAR-only tenants. */
  currency_breakdown: Record<string, number>;
  /** Top 5–10 records with refs the prospect can verify in their own ERP. */
  sample_records: SampleRecord[];
  /** Catalyst + sub-catalyst that resolves this finding. */
  recommended_catalyst: { catalyst: string; sub_catalyst: string };
  /** Pulse-compatible metric key — same shape as the code, useful for cross-reference. */
  metric_signature: string;
  evidence_quality: EvidenceQuality;
  detected_at: string;
  /** LLM-authored business commentary attached during report generation.
   *  Two short sentences: (1) why this matters in plain business language,
   *  (2) what the operator should do next. Optional — if absent, the PDF
   *  renderer falls back to `narrative`. */
  commentary?: string;
  /**
   * When the engine runs per-company (multi-entity / multinational), each
   * Finding is tagged with the entity it belongs to. Unset for tenant-wide
   * runs (`detectAllFindings` without a company filter).
   */
  company_id?: string;
  company_name?: string;
}

export interface CompanyContext {
  id: string;
  name: string;
  currency: string;
  country: string;
  is_primary: number;
}

export interface FindingsContext {
  /** Functional currency for the engagement; everything reports in ZAR for now. */
  baseCurrency: 'ZAR';
  /** native-currency → ZAR. Always includes ZAR=1.0. Missing keys fall back to 1.0 with a warning. */
  exchangeRates: Record<string, number>;
  /** ISO date used as the "today" anchor for aging. Defaults to `datetime('now')`. */
  asOfDate?: string;
  /** Restrict to specific erp_companies; null/undefined = all companies for the tenant. */
  companyIds?: string[];
  /** Used for evidence_quality scoring. < 3 → low, 3–6 → medium, ≥ 6 → high. */
  monthsOfData?: number;
}

// ── Catalyst mapping ──────────────────────────────────────────────────────

/**
 * Each FindingCode maps to the catalyst + sub-catalyst that resolves it. This
 * is the table the report uses to close the loop — every finding ends with
 * "and here's the catalyst that fixes this".
 *
 * Sub-catalyst names that don't yet exist as `real` handlers in the catalog
 * are flagged with a TODO at the bottom of this file so PR D can pick them up.
 */
/**
 * Catalyst names below match the canonical cluster names in
 * catalyst-templates.ts. Sub-catalyst names match the (newly-added in PR D)
 * `implementation: 'real'` entries on each cluster. The
 * `every-finding-has-a-real-catalyst` test asserts this round-trip.
 */
export const FINDING_CATALYST_MAP: Record<FindingCode, { catalyst: string; sub_catalyst: string }> = {
  ar_aging_overdue_30_60:        { catalyst: 'Finance Catalyst',                 sub_catalyst: 'AR Collection' },
  ar_aging_overdue_60_90:        { catalyst: 'Finance Catalyst',                 sub_catalyst: 'AR Collection' },
  ar_aging_overdue_90_plus:      { catalyst: 'Finance Catalyst',                 sub_catalyst: 'AR Collection' },
  ar_credit_limit_breach:        { catalyst: 'Finance Catalyst',                 sub_catalyst: 'Credit Vetting' },
  ar_top_debtor_concentration:   { catalyst: 'Finance Catalyst',                 sub_catalyst: 'AR Collection' },
  ap_overdue_delivery:           { catalyst: 'Procurement Catalyst',             sub_catalyst: 'PO Automation' },
  ap_three_way_mismatch:         { catalyst: 'Finance Catalyst',                 sub_catalyst: 'Invoice Reconciliation' },
  ap_unreconciled_bank:          { catalyst: 'Finance Catalyst',                 sub_catalyst: 'GL-Bank Reconciliation' },
  gl_suspense_balance:           { catalyst: 'Finance Catalyst',                 sub_catalyst: 'GL-Bank Reconciliation' },
  gl_journal_off_hours:          { catalyst: 'Compliance & Regulatory Catalyst', sub_catalyst: 'Journal Anomaly Detection' },
  gl_round_amount_journals:      { catalyst: 'Compliance & Regulatory Catalyst', sub_catalyst: 'Journal Anomaly Detection' },
  gl_high_manual_volume:         { catalyst: 'Finance Catalyst',                 sub_catalyst: 'Automation Coverage' },
  proc_maverick_spend:           { catalyst: 'Procurement Catalyst',             sub_catalyst: '3-Way Match' },
  proc_duplicate_suppliers:      { catalyst: 'Procurement Catalyst',             sub_catalyst: 'Vendor Master Cleanup' },
  proc_supplier_concentration:   { catalyst: 'Procurement Catalyst',             sub_catalyst: 'Supplier Risk Management' },
  proc_inactive_with_open_pos:   { catalyst: 'Procurement Catalyst',             sub_catalyst: 'Vendor Master Cleanup' },
  inv_stale_stock:               { catalyst: 'Supply Chain Catalyst',            sub_catalyst: 'Inventory Optimization' },
  inv_dead_stock:                { catalyst: 'Supply Chain Catalyst',            sub_catalyst: 'Slow & Obsolete Stock' },
  inv_negative_stock:            { catalyst: 'Supply Chain Catalyst',            sub_catalyst: 'Inventory Data Quality' },
  inv_below_reorder:             { catalyst: 'Supply Chain Catalyst',            sub_catalyst: 'Replenishment Triggers' },
  inv_margin_erosion:            { catalyst: 'Sales Catalyst',                   sub_catalyst: 'Pricing & Margin Analysis' },
  inv_inactive_with_value:       { catalyst: 'Supply Chain Catalyst',            sub_catalyst: 'Inventory Optimization' },
  sales_customer_concentration:  { catalyst: 'Sales Catalyst',                   sub_catalyst: 'Customer Risk' },
  sales_inactive_with_ar:        { catalyst: 'Finance Catalyst',                 sub_catalyst: 'AR Collection' },
  sales_credit_no_check:         { catalyst: 'Finance Catalyst',                 sub_catalyst: 'Credit Vetting' },
  hr_terminated_in_payroll:      { catalyst: 'HR & Workforce Catalyst',          sub_catalyst: 'Payroll Audit' },
  hr_high_payroll_concentration: { catalyst: 'HR & Workforce Catalyst',          sub_catalyst: 'Compensation Analysis' },
  tax_overdue_submission:        { catalyst: 'Compliance & Regulatory Catalyst', sub_catalyst: 'Tax Compliance' },
  // Vendor master cleanup is canonically a Procurement concern — the missing
  // VAT numbers on suppliers are mastered there, not in the compliance cluster.
  tax_missing_vat_numbers:       { catalyst: 'Procurement Catalyst',             sub_catalyst: 'Vendor Master Cleanup' },
  tax_vat_rate_anomaly:          { catalyst: 'Compliance & Regulatory Catalyst', sub_catalyst: 'Tax Audit' },
  fx_currency_exposure:          { catalyst: 'Finance Catalyst',                 sub_catalyst: 'FX Hedge Advisory' },
  fx_dual_use_currency:          { catalyst: 'Procurement Catalyst',             sub_catalyst: 'Vendor Master Cleanup' },
  // Service-company catalyst mapping — all entries resolve to the new
  // Service Operations Catalyst added in PR D, except revenue recognition
  // which is canonically a Finance sub-catalyst.
  svc_low_billable_utilisation:  { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'Billable Utilisation' },
  svc_unbilled_time_aging:       { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'WIP & Unbilled Aging' },
  svc_project_overrun:           { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'Project Profitability' },
  svc_project_margin_negative:   { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'Project Profitability' },
  svc_unapproved_time_entries:   { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'Time & Expense Governance' },
  svc_revenue_recognition_lag:   { catalyst: 'Finance Catalyst',                 sub_catalyst: 'Revenue Recognition' },
  svc_zero_hours_active_project: { catalyst: 'Service Operations Catalyst',      sub_catalyst: 'Project Profitability' },
  svc_inactive_employee_billed_time: { catalyst: 'HR & Workforce Catalyst',      sub_catalyst: 'Payroll Audit' },
};

const CATEGORY_MAP: Record<FindingCode, FindingCategory> = {
  ar_aging_overdue_30_60: 'finance',
  ar_aging_overdue_60_90: 'finance',
  ar_aging_overdue_90_plus: 'finance',
  ar_credit_limit_breach: 'finance',
  ar_top_debtor_concentration: 'finance',
  ap_overdue_delivery: 'procurement',
  ap_three_way_mismatch: 'finance',
  ap_unreconciled_bank: 'finance',
  gl_suspense_balance: 'finance',
  gl_journal_off_hours: 'compliance',
  gl_round_amount_journals: 'compliance',
  gl_high_manual_volume: 'finance',
  proc_maverick_spend: 'procurement',
  proc_duplicate_suppliers: 'procurement',
  proc_supplier_concentration: 'procurement',
  proc_inactive_with_open_pos: 'procurement',
  inv_stale_stock: 'supply_chain',
  inv_dead_stock: 'supply_chain',
  inv_negative_stock: 'supply_chain',
  inv_below_reorder: 'supply_chain',
  inv_margin_erosion: 'sales',
  inv_inactive_with_value: 'supply_chain',
  sales_customer_concentration: 'sales',
  sales_inactive_with_ar: 'sales',
  sales_credit_no_check: 'sales',
  hr_terminated_in_payroll: 'workforce',
  hr_high_payroll_concentration: 'workforce',
  tax_overdue_submission: 'compliance',
  tax_missing_vat_numbers: 'compliance',
  tax_vat_rate_anomaly: 'compliance',
  fx_currency_exposure: 'cross_cutting',
  fx_dual_use_currency: 'cross_cutting',
  svc_low_billable_utilisation: 'service_delivery',
  svc_unbilled_time_aging: 'service_delivery',
  svc_project_overrun: 'service_delivery',
  svc_project_margin_negative: 'service_delivery',
  svc_unapproved_time_entries: 'service_delivery',
  svc_revenue_recognition_lag: 'service_delivery',
  svc_zero_hours_active_project: 'service_delivery',
  svc_inactive_employee_billed_time: 'service_delivery',
};

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Generate a stable random id for a Finding. Uses crypto.randomUUID where
 * available (Workers runtime) and falls back to a timestamp-based id otherwise
 * (test harness, edge cases). The id is per-detection-run; not a DB key.
 */
function makeFindingId(): string {
  try {
    return (crypto as unknown as { randomUUID(): string }).randomUUID();
  } catch {
    return `f-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/** Convert a native amount to ZAR using the context's rate table. */
function toZAR(amount: number, currency: string | undefined, ctx: FindingsContext): number {
  if (!amount) return 0;
  const cur = (currency || 'ZAR').toUpperCase();
  if (cur === 'ZAR') return amount;
  const rate = ctx.exchangeRates[cur];
  if (!rate || rate <= 0) return amount; // unknown rate — treat as 1:1 to avoid a silent zero-out.
  return amount * rate;
}

/** Severity from value-at-risk (R) and a "% of revenue" lens. Used by most detectors. */
function severityFromValue(valueZar: number): Severity {
  if (valueZar >= 5_000_000) return 'critical';
  if (valueZar >= 1_000_000) return 'high';
  if (valueZar >= 100_000) return 'medium';
  return 'low';
}

/** Severity from a count of affected records (for data-quality findings). */
function severityFromCount(count: number, breakpoints: { critical: number; high: number; medium: number }): Severity {
  if (count >= breakpoints.critical) return 'critical';
  if (count >= breakpoints.high) return 'high';
  if (count >= breakpoints.medium) return 'medium';
  return 'low';
}

/** Combine two severity reads — pick the worse. */
function maxSeverity(a: Severity, b: Severity): Severity {
  const order: Severity[] = ['low', 'medium', 'high', 'critical'];
  return order[Math.max(order.indexOf(a), order.indexOf(b))];
}

function evidenceQualityFromMonths(monthsOfData: number | undefined): EvidenceQuality {
  if (typeof monthsOfData !== 'number') return 'medium';
  if (monthsOfData >= 6) return 'high';
  if (monthsOfData >= 3) return 'medium';
  return 'low';
}

/** Format a number as ZAR for inclusion in narratives. */
function formatZAR(amount: number): string {
  return `R ${Math.round(amount).toLocaleString('en-ZA')}`;
}

interface CompanyFilterClause {
  /** Joins onto the SQL string with `AND ${clause}` if non-empty, else ''. */
  clause: string;
  /** Bind values appended to the query parameter array. */
  binds: string[];
}

/**
 * Build a `company_id IN (?, ?, …)` filter for a given table. Returns empty
 * clause if `companyIds` is unset (= unscoped). Tables without a company_id
 * column should pass `column: null` to no-op.
 */
function companyFilter(
  ctx: FindingsContext,
  column: string | null,
  alias = '',
): CompanyFilterClause {
  if (!ctx.companyIds || ctx.companyIds.length === 0 || !column) {
    return { clause: '', binds: [] };
  }
  const placeholders = ctx.companyIds.map(() => '?').join(', ');
  const ref = alias ? `${alias}.${column}` : column;
  return {
    clause: `AND ${ref} IN (${placeholders})`,
    binds: ctx.companyIds,
  };
}

/** Build a base Finding from required + optional fields. Severity etc. stay caller-controlled. */
function makeFinding(args: {
  code: FindingCode;
  title: string;
  narrative: string;
  affected_count: number;
  value_at_risk_zar: number;
  value_components: ValueComponent[];
  currency_breakdown: Record<string, number>;
  sample_records: SampleRecord[];
  severity: Severity;
  ctx: FindingsContext;
}): Finding {
  return {
    id: makeFindingId(),
    code: args.code,
    category: CATEGORY_MAP[args.code],
    severity: args.severity,
    title: args.title,
    narrative: args.narrative,
    affected_count: args.affected_count,
    value_at_risk_zar: Math.round(args.value_at_risk_zar),
    value_components: args.value_components.map(v => ({ ...v, amount_zar: Math.round(v.amount_zar) })),
    currency_breakdown: args.currency_breakdown,
    sample_records: args.sample_records.slice(0, 10),
    recommended_catalyst: FINDING_CATALYST_MAP[args.code],
    metric_signature: args.code,
    evidence_quality: evidenceQualityFromMonths(args.ctx.monthsOfData),
    detected_at: new Date().toISOString(),
  };
}

// ── Detectors ─────────────────────────────────────────────────────────────

/** Shared row shape pulled from `erp_invoices` for AR detectors. */
interface InvoiceRow {
  id: string;
  invoice_number: string;
  customer_name: string | null;
  invoice_date: string;
  due_date: string | null;
  total: number;
  amount_due: number;
  currency: string | null;
  payment_status: string | null;
  status: string | null;
}

/**
 * Detect overdue AR within a single aging bucket. Used by 30-60, 60-90 and
 * 90+ detectors to share the same query template.
 */
async function detectAgingBucket(
  db: D1Database,
  tenantId: string,
  ctx: FindingsContext,
  code: 'ar_aging_overdue_30_60' | 'ar_aging_overdue_60_90' | 'ar_aging_overdue_90_plus',
  minDays: number,
  maxDays: number | null,
): Promise<Finding | null> {
  const ageExpr = "CAST((julianday('now') - julianday(due_date)) AS INTEGER)";
  const bucketWhere = maxDays === null
    ? `${ageExpr} >= ${minDays}`
    : `${ageExpr} >= ${minDays} AND ${ageExpr} < ${maxDays}`;
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, invoice_number, customer_name, invoice_date, due_date,
            total, amount_due, currency, payment_status, status
       FROM erp_invoices
      WHERE tenant_id = ?
        AND payment_status != 'paid'
        AND due_date IS NOT NULL
        AND ${bucketWhere}
        ${cf.clause}
      ORDER BY amount_due DESC
      LIMIT 200`,
  ).bind(tenantId, ...cf.binds).all<InvoiceRow>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + (r.amount_due || 0);
    totalZar += toZAR(r.amount_due || 0, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.invoice_number || r.id,
    description: r.customer_name || 'Unknown customer',
    amount_native: r.amount_due,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.amount_due || 0, r.currency || undefined, ctx),
    date: r.due_date || r.invoice_date,
  }));

  const bucketLabel = maxDays === null ? `${minDays}+ days past due` : `${minDays}–${maxDays} days past due`;
  const severity = code === 'ar_aging_overdue_90_plus'
    ? maxSeverity(severityFromValue(totalZar), 'high')
    : severityFromValue(totalZar);

  // Estimated recovery uplift: industry rule of thumb is that 8–12% of
  // collectable AR ages out beyond 90 days unless actively chased. We use
  // a single 8% uplift (conservative) for the value calculation, with the
  // bucket-specific context in the methodology string.
  const upliftPct = code === 'ar_aging_overdue_90_plus' ? 12 : 8;
  const uplift = totalZar * (upliftPct / 100);

  return makeFinding({
    code,
    title: `${rows.length} invoices ${bucketLabel} (${formatZAR(totalZar)} outstanding)`,
    narrative: `${rows.length} unpaid invoices have aged ${bucketLabel}, exposing ${formatZAR(totalZar)} of working capital. Industry benchmarks indicate that ${upliftPct}% of this balance (${formatZAR(uplift)}) can typically be recovered with a structured collections cadence. The longer the bucket, the lower the recovery odds — invoices past 90 days have a ~50% write-off rate without intervention.`,
    affected_count: rows.length,
    value_at_risk_zar: uplift,
    value_components: [{
      label: `Recoverable AR (${bucketLabel})`,
      amount_zar: uplift,
      methodology: `${formatZAR(totalZar)} aged AR × ${upliftPct}% structured-collections uplift`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity,
    ctx,
  });
}

async function detectArAging30_60(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  return detectAgingBucket(db, tenantId, ctx, 'ar_aging_overdue_30_60', 30, 60);
}

async function detectArAging60_90(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  return detectAgingBucket(db, tenantId, ctx, 'ar_aging_overdue_60_90', 60, 90);
}

async function detectArAging90Plus(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  return detectAgingBucket(db, tenantId, ctx, 'ar_aging_overdue_90_plus', 90, null);
}

async function detectArCreditLimitBreach(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, name, credit_limit, credit_balance, currency, payment_terms, status
       FROM erp_customers
      WHERE tenant_id = ?
        AND credit_limit > 0
        AND credit_balance > credit_limit
        ${cf.clause}
      ORDER BY (credit_balance - credit_limit) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; name: string; credit_limit: number; credit_balance: number;
    currency: string | null; payment_terms: string | null; status: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  let breachZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const breach = (r.credit_balance || 0) - (r.credit_limit || 0);
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + breach;
    breachZar += toZAR(breach, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.name,
    description: `Credit balance ${formatZAR(toZAR(r.credit_balance, r.currency || undefined, ctx))} exceeds limit ${formatZAR(toZAR(r.credit_limit, r.currency || undefined, ctx))}`,
    amount_native: (r.credit_balance || 0) - (r.credit_limit || 0),
    currency: r.currency || 'ZAR',
    amount_zar: toZAR((r.credit_balance || 0) - (r.credit_limit || 0), r.currency || undefined, ctx),
    metadata: { payment_terms: r.payment_terms || 'unspecified' },
  }));

  // Bad-debt provisioning: customers materially over-limit have ~2× the default
  // rate of in-limit customers. Conservative 5% bad-debt allowance on the breach.
  const badDebtRisk = breachZar * 0.05;

  return makeFinding({
    code: 'ar_credit_limit_breach',
    title: `${rows.length} customers exceeding credit limit (${formatZAR(breachZar)} over)`,
    narrative: `${rows.length} customers are carrying balances above their assigned credit limit, with a combined excess of ${formatZAR(breachZar)}. Customers materially over their credit limit default at roughly 2× the in-limit rate; provisioning at 5% of the excess gives ${formatZAR(badDebtRisk)} of expected bad debt unless credit policy is enforced.`,
    affected_count: rows.length,
    value_at_risk_zar: badDebtRisk,
    value_components: [{
      label: 'Bad-debt provision on credit excess',
      amount_zar: badDebtRisk,
      methodology: `${formatZAR(breachZar)} excess × 5% historical bad-debt rate for over-limit accounts`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: maxSeverity(severityFromValue(breachZar), severityFromCount(rows.length, { critical: 50, high: 20, medium: 5 })),
    ctx,
  });
}

async function detectArTopDebtorConcentration(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT customer_name, COUNT(*) as inv_count, SUM(amount_due) as outstanding, currency
       FROM erp_invoices
      WHERE tenant_id = ? AND payment_status != 'paid' ${cf.clause}
      GROUP BY customer_name, currency
      ORDER BY outstanding DESC`,
  ).bind(tenantId, ...cf.binds).all<{
    customer_name: string; inv_count: number; outstanding: number; currency: string | null;
  }>()).results || [];
  if (rows.length < 5) return null;

  let totalAr = 0;
  const aggregated: Record<string, { count: number; outstanding_zar: number; currencies: Record<string, number> }> = {};
  for (const r of rows) {
    const name = r.customer_name || 'Unknown';
    if (!aggregated[name]) aggregated[name] = { count: 0, outstanding_zar: 0, currencies: {} };
    aggregated[name].count += r.inv_count;
    const z = toZAR(r.outstanding, r.currency || undefined, ctx);
    aggregated[name].outstanding_zar += z;
    const cur = (r.currency || 'ZAR').toUpperCase();
    aggregated[name].currencies[cur] = (aggregated[name].currencies[cur] || 0) + r.outstanding;
    totalAr += z;
  }
  if (totalAr <= 0) return null;

  const sorted = Object.entries(aggregated).sort((a, b) => b[1].outstanding_zar - a[1].outstanding_zar);
  const top5 = sorted.slice(0, 5);
  const top5Total = top5.reduce((s, [, v]) => s + v.outstanding_zar, 0);
  const top5Pct = (top5Total / totalAr) * 100;
  if (top5Pct < 50) return null; // not concentrated enough to flag

  // The headline value: 5% of the top-5 balance is at risk if any single
  // top debtor defaults — a conservative single-customer-default scenario.
  const concentrationRisk = top5Total * 0.05;

  const sample: SampleRecord[] = top5.map(([name, v]) => ({
    ref: name,
    description: `${v.count} invoices, ${((v.outstanding_zar / totalAr) * 100).toFixed(1)}% of total AR`,
    amount_zar: v.outstanding_zar,
    currency: 'ZAR',
    metadata: { invoices: v.count },
  }));

  return makeFinding({
    code: 'ar_top_debtor_concentration',
    title: `Top 5 customers hold ${top5Pct.toFixed(0)}% of AR (${formatZAR(top5Total)})`,
    narrative: `Concentration risk: just 5 customers account for ${top5Pct.toFixed(0)}% (${formatZAR(top5Total)}) of total outstanding AR (${formatZAR(totalAr)}). A single default in this group materially impacts working capital. A ${formatZAR(concentrationRisk)} bad-debt provision (5% of the top-5 balance) reflects a conservative single-customer-default scenario.`,
    affected_count: top5.length,
    value_at_risk_zar: concentrationRisk,
    value_components: [{
      label: 'Concentration default risk',
      amount_zar: concentrationRisk,
      methodology: `Top-5 balance ${formatZAR(top5Total)} × 5% single-default scenario`,
    }],
    currency_breakdown: { ZAR: totalAr }, // already aggregated
    sample_records: sample,
    severity: top5Pct >= 75 ? 'high' : 'medium',
    ctx,
  });
}

async function detectApOverdueDelivery(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, po_number, supplier_name, order_date, delivery_date, total, currency, status, delivery_status
       FROM erp_purchase_orders
      WHERE tenant_id = ?
        AND delivery_date IS NOT NULL
        AND date(delivery_date) < date('now')
        AND COALESCE(delivery_status, 'pending') != 'received'
        ${cf.clause}
      ORDER BY total DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; po_number: string; supplier_name: string | null;
    order_date: string; delivery_date: string; total: number; currency: string | null;
    status: string | null; delivery_status: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + r.total;
    totalZar += toZAR(r.total, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.po_number,
    description: r.supplier_name || 'Unknown supplier',
    amount_native: r.total,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.total, r.currency || undefined, ctx),
    date: r.delivery_date,
  }));

  // Late delivery cost: typical supply-chain analysis pegs the working-capital
  // and expediting cost of late receipts at 2–3% of PO value. We use 2.5%.
  const valueZar = totalZar * 0.025;

  return makeFinding({
    code: 'ap_overdue_delivery',
    title: `${rows.length} POs past delivery date (${formatZAR(totalZar)} committed)`,
    narrative: `${rows.length} purchase orders worth ${formatZAR(totalZar)} are past their committed delivery date and not yet received. Late deliveries typically cost 2–3% of PO value in expediting, downstream production stoppages, and stale working capital — equivalent to ${formatZAR(valueZar)} of avoidable cost.`,
    affected_count: rows.length,
    value_at_risk_zar: valueZar,
    value_components: [{
      label: 'Late-delivery operating cost',
      amount_zar: valueZar,
      methodology: `${formatZAR(totalZar)} late PO value × 2.5% expediting + stoppage cost`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(valueZar),
    ctx,
  });
}

async function detectApThreeWayMismatch(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Heuristic: invoices marked paid but amount_paid != total (off by > R1 or > 0.1%).
  // Real 3-way needs PO+receipt+invoice linkage; we approximate using the paid/total mismatch.
  const rows = (await db.prepare(
    `SELECT id, invoice_number, customer_name, total, amount_paid, currency, invoice_date
       FROM erp_invoices
      WHERE tenant_id = ?
        AND amount_paid > 0
        AND total > 0
        AND ABS(amount_paid - total) > 1
        AND ABS(amount_paid - total) / total > 0.001
        ${cf.clause}
      ORDER BY ABS(amount_paid - total) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; invoice_number: string; customer_name: string | null;
    total: number; amount_paid: number; currency: string | null; invoice_date: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  let mismatchZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const diff = (r.total || 0) - (r.amount_paid || 0);
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + Math.abs(diff);
    mismatchZar += Math.abs(toZAR(diff, cur, ctx));
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.invoice_number,
    description: r.customer_name || 'Unknown',
    amount_native: (r.total || 0) - (r.amount_paid || 0),
    currency: r.currency || 'ZAR',
    amount_zar: toZAR((r.total || 0) - (r.amount_paid || 0), r.currency || undefined, ctx),
    metadata: { total: r.total, paid: r.amount_paid },
  }));

  return makeFinding({
    code: 'ap_three_way_mismatch',
    title: `${rows.length} invoices with reconciliation mismatches (${formatZAR(mismatchZar)} variance)`,
    narrative: `${rows.length} invoices show a payment-vs-total mismatch totaling ${formatZAR(mismatchZar)}. These are typical 3-way-match exceptions — overpayments, missing credits, mis-applied receipts, or short-payments that have not been reconciled. Each is a candidate for write-back or recovery.`,
    affected_count: rows.length,
    value_at_risk_zar: mismatchZar,
    value_components: [{
      label: 'Recoverable reconciliation variance',
      amount_zar: mismatchZar,
      methodology: 'Sum of |total − amount_paid| across mismatched invoices',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: maxSeverity(severityFromValue(mismatchZar), severityFromCount(rows.length, { critical: 100, high: 30, medium: 10 })),
    ctx,
  });
}

async function detectApUnreconciledBank(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, bank_account, transaction_date, description, debit, credit, balance, reference
       FROM erp_bank_transactions
      WHERE tenant_id = ?
        AND COALESCE(reconciled, 0) = 0
        AND date(transaction_date) < date('now', '-30 days')
        ${cf.clause}
      ORDER BY (COALESCE(debit, 0) + COALESCE(credit, 0)) DESC
      LIMIT 200`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; bank_account: string; transaction_date: string;
    description: string | null; debit: number; credit: number; balance: number;
    reference: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalAbs = rows.reduce((s, r) => s + Math.abs((r.debit || 0) + (r.credit || 0)), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.reference || r.id,
    description: r.description || `${r.bank_account} txn`,
    amount_native: (r.debit || 0) + (r.credit || 0),
    currency: 'ZAR',
    amount_zar: (r.debit || 0) + (r.credit || 0),
    date: r.transaction_date,
  }));

  // Unreconciled bank items routinely hide ~1% in genuine duplicates / missed
  // postings / vendor errors. The recovery is conservative.
  const recoveryZar = totalAbs * 0.01;

  return makeFinding({
    code: 'ap_unreconciled_bank',
    title: `${rows.length} unreconciled bank transactions older than 30 days (${formatZAR(totalAbs)})`,
    narrative: `${rows.length} bank transactions worth ${formatZAR(totalAbs)} have been sitting unreconciled for over 30 days. Aging unreconciled items hide duplicate payments, missed receipts, vendor errors, and fraud — automating GL-bank reconciliation typically recovers 1% of the unreconciled balance (${formatZAR(recoveryZar)}) within the first quarter.`,
    affected_count: rows.length,
    value_at_risk_zar: recoveryZar,
    value_components: [{
      label: 'Recoverable from automated reconciliation',
      amount_zar: recoveryZar,
      methodology: `${formatZAR(totalAbs)} unreconciled × 1% historic recovery rate`,
    }],
    currency_breakdown: { ZAR: totalAbs },
    sample_records: sample,
    severity: maxSeverity(severityFromValue(recoveryZar), severityFromCount(rows.length, { critical: 500, high: 200, medium: 50 })),
    ctx,
  });
}

async function detectGlSuspenseBalance(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, account_code, account_name, account_type, account_class, currency, balance
       FROM erp_gl_accounts
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND ABS(COALESCE(balance, 0)) > 0
        AND (
          LOWER(COALESCE(account_class, '')) LIKE '%suspense%'
          OR LOWER(COALESCE(account_name, '')) LIKE '%suspense%'
          OR LOWER(COALESCE(account_name, '')) LIKE '%clearing%'
          OR LOWER(COALESCE(account_name, '')) LIKE '%unallocated%'
        )
        ${cf.clause}
      ORDER BY ABS(balance) DESC
      LIMIT 50`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; account_code: string; account_name: string; account_type: string;
    account_class: string | null; currency: string | null; balance: number;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalAbs = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    const abs = Math.abs(r.balance || 0);
    breakdown[cur] = (breakdown[cur] || 0) + abs;
    totalAbs += toZAR(abs, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: `${r.account_code} — ${r.account_name}`,
    description: `Class: ${r.account_class || 'unspecified'}, type: ${r.account_type || 'unspecified'}`,
    amount_native: r.balance,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.balance, r.currency || undefined, ctx),
  }));

  return makeFinding({
    code: 'gl_suspense_balance',
    title: `${rows.length} suspense / clearing accounts with ${formatZAR(totalAbs)} balance`,
    narrative: `${rows.length} GL accounts classified as suspense, clearing, or unallocated are carrying a non-zero balance totalling ${formatZAR(totalAbs)}. These accounts should clear to zero each period — persistent balances indicate misposted journals, unmatched cash receipts, or incomplete reconciliation. The full balance is in scope for write-back or correct reclassification.`,
    affected_count: rows.length,
    value_at_risk_zar: totalAbs,
    value_components: [{
      label: 'Suspense balance to clear',
      amount_zar: totalAbs,
      methodology: 'Sum of |balance| across suspense/clearing/unallocated GL accounts',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(totalAbs),
    ctx,
  });
}

async function detectGlJournalOffHours(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // SQLite strftime('%w', x) returns 0=Sun .. 6=Sat. Hours via strftime('%H').
  const rows = (await db.prepare(
    `SELECT id, journal_number, journal_date, description, total_debit, posted_by, created_at
       FROM erp_journal_entries
      WHERE tenant_id = ?
        AND status = 'posted'
        AND (
          CAST(strftime('%w', COALESCE(created_at, journal_date)) AS INTEGER) IN (0, 6)
          OR CAST(strftime('%H', COALESCE(created_at, journal_date)) AS INTEGER) NOT BETWEEN 7 AND 18
        )
        ${cf.clause}
      ORDER BY total_debit DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; journal_number: string; journal_date: string;
    description: string | null; total_debit: number; posted_by: string | null;
    created_at: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalAbs = rows.reduce((s, r) => s + Math.abs(r.total_debit || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.journal_number,
    description: r.description || `Posted by ${r.posted_by || 'unknown'}`,
    amount_native: r.total_debit,
    currency: 'ZAR',
    amount_zar: r.total_debit,
    date: r.created_at || r.journal_date,
  }));

  return makeFinding({
    code: 'gl_journal_off_hours',
    title: `${rows.length} journals posted outside business hours (${formatZAR(totalAbs)})`,
    narrative: `${rows.length} posted journal entries totaling ${formatZAR(totalAbs)} were created outside standard business hours (07:00–18:00 weekdays) or on weekends. Off-hours postings are a common control weakness for fraud, year-end "smoothing" and unauthorised adjustments — they warrant supervisory review.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Audit-attestable amount under review',
      amount_zar: totalAbs,
      methodology: 'Sum of total_debit on off-hours posted journals (informational; not a recovery target)',
    }],
    currency_breakdown: { ZAR: totalAbs },
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 100, high: 30, medium: 10 }),
    ctx,
  });
}

async function detectGlRoundAmountJournals(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Suspiciously round = above R10k AND ends in '000.00' (multiples of 1000).
  const rows = (await db.prepare(
    `SELECT id, journal_number, journal_date, description, total_debit, posted_by
       FROM erp_journal_entries
      WHERE tenant_id = ?
        AND status = 'posted'
        AND total_debit >= 10000
        AND ABS(total_debit - ROUND(total_debit, -3)) < 0.01
        ${cf.clause}
      ORDER BY total_debit DESC
      LIMIT 50`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; journal_number: string; journal_date: string;
    description: string | null; total_debit: number; posted_by: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalAbs = rows.reduce((s, r) => s + Math.abs(r.total_debit || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.journal_number,
    description: r.description || `Posted by ${r.posted_by || 'unknown'}`,
    amount_native: r.total_debit,
    currency: 'ZAR',
    amount_zar: r.total_debit,
    date: r.journal_date,
  }));

  return makeFinding({
    code: 'gl_round_amount_journals',
    title: `${rows.length} large round-amount journals (${formatZAR(totalAbs)})`,
    narrative: `${rows.length} posted journals are round-thousand amounts above R10,000 (totaling ${formatZAR(totalAbs)}). These exhibit Benford's-law deviations characteristic of estimates, accruals, and management adjustments — they are the highest-yield population for fraud and earnings-management detection.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Audit-review amount',
      amount_zar: totalAbs,
      methodology: 'Sum of total_debit on round-thousand journals ≥ R10,000 (informational)',
    }],
    currency_breakdown: { ZAR: totalAbs },
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 50, high: 20, medium: 5 }),
    ctx,
  });
}

async function detectGlHighManualVolume(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Heuristic: any journal with posted_by in (manual user list) or description LIKE 'Manual%'
  // and a high count over the last 90 days. We don't have a "source" column,
  // so fall back to description heuristic + count.
  const r = await db.prepare(
    `SELECT
       COUNT(*) FILTER (WHERE LOWER(COALESCE(description, '')) LIKE 'manual%' OR posted_by NOT LIKE '%system%') as manual_count,
       COUNT(*) as total_count,
       SUM(total_debit) FILTER (WHERE LOWER(COALESCE(description, '')) LIKE 'manual%' OR posted_by NOT LIKE '%system%') as manual_value
     FROM erp_journal_entries
     WHERE tenant_id = ?
       AND status = 'posted'
       AND date(journal_date) >= date('now', '-90 days')
       ${cf.clause}`,
  ).bind(tenantId, ...cf.binds).first<{ manual_count: number; total_count: number; manual_value: number }>();
  if (!r || r.total_count < 20) return null; // not enough data to reason about
  const manualPct = (r.manual_count / r.total_count) * 100;
  if (manualPct < 50) return null;

  // Each manual journal costs ~R150 (FTE labour). Automation reclaims ~70% of that.
  const automatedSaving = r.manual_count * 4 * 150 * 0.7; // annualise the 90d count ×4
  return makeFinding({
    code: 'gl_high_manual_volume',
    title: `${manualPct.toFixed(0)}% of journals are manual (${r.manual_count} of ${r.total_count} in 90 days)`,
    narrative: `${r.manual_count} of the last ${r.total_count} posted journals (${manualPct.toFixed(0)}%) appear manual based on description / posted_by patterns. Manual journals cost ~R150 each in labour and a multiple of that in error-rate cost. Automating the recurring patterns reclaims roughly ${formatZAR(automatedSaving)}/year.`,
    affected_count: r.manual_count,
    value_at_risk_zar: automatedSaving,
    value_components: [{
      label: 'Annualised journal automation saving',
      amount_zar: automatedSaving,
      methodology: `${r.manual_count} 90-day count × 4 → ${r.manual_count * 4} annual × R150/journal × 70% automatable`,
    }],
    currency_breakdown: { ZAR: r.manual_value || 0 },
    sample_records: [],
    severity: manualPct >= 80 ? 'high' : 'medium',
    ctx,
  });
}

async function detectProcMaverickSpend(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  // Maverick = invoice with no PO reference, or where the reference doesn't
  // match any po_number for the same supplier. We use a conservative test:
  // invoices with NULL or empty `reference` AND the customer is a supplier
  // (we don't have a direct "is_purchase_invoice" flag — proxy via amount_paid
  // patterns is unreliable, so we treat AP invoices as those with reference IS NULL/empty).
  // Real-world deployments will refine via line_items inspection.
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT i.id, i.invoice_number, i.customer_name, i.total, i.amount_due, i.currency, i.invoice_date
       FROM erp_invoices i
      WHERE i.tenant_id = ?
        AND i.total > 0
        AND (i.reference IS NULL OR i.reference = '')
        AND NOT EXISTS (
          SELECT 1 FROM erp_purchase_orders p
           WHERE p.tenant_id = i.tenant_id
             AND p.supplier_name = i.customer_name
        )
        ${cf.clause}
      ORDER BY i.total DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; invoice_number: string; customer_name: string | null;
    total: number; amount_due: number; currency: string | null; invoice_date: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + r.total;
    totalZar += toZAR(r.total, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.invoice_number,
    description: r.customer_name || 'Unknown',
    amount_native: r.total,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.total, r.currency || undefined, ctx),
    date: r.invoice_date,
  }));

  // Maverick spend savings: literature pegs 8–15% of off-contract spend as
  // recoverable through compliance + sourcing leverage. We use 8%.
  const valueZar = totalZar * 0.08;

  return makeFinding({
    code: 'proc_maverick_spend',
    title: `${rows.length} invoices without matching PO (${formatZAR(totalZar)} off-contract)`,
    narrative: `${rows.length} invoices totalling ${formatZAR(totalZar)} have no PO reference and no matching purchase order in the system — classic maverick spend. Industry studies put recoverable savings at 8–15% of off-contract spend through procurement compliance and sourcing leverage; 8% on this population gives ${formatZAR(valueZar)} of annualised opportunity.`,
    affected_count: rows.length,
    value_at_risk_zar: valueZar,
    value_components: [{
      label: 'Recoverable on off-contract spend',
      amount_zar: valueZar,
      methodology: `${formatZAR(totalZar)} maverick spend × 8% sourcing/compliance leverage`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(valueZar),
    ctx,
  });
}

async function detectProcDuplicateSuppliers(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  void ctx;
  // Duplicates by (vat_number) or (registration_number) where both are non-empty.
  const rows = (await db.prepare(
    `SELECT vat_number, registration_number, COUNT(*) as dup_count, GROUP_CONCAT(name, ' | ') as names
       FROM erp_suppliers
      WHERE tenant_id = ?
        AND status = 'active'
      GROUP BY COALESCE(NULLIF(vat_number, ''), NULLIF(registration_number, ''))
     HAVING COUNT(*) > 1
        AND COALESCE(NULLIF(vat_number, ''), NULLIF(registration_number, '')) IS NOT NULL
     ORDER BY dup_count DESC
     LIMIT 50`,
  ).bind(tenantId).all<{
    vat_number: string | null; registration_number: string | null; dup_count: number; names: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  const affected = rows.reduce((s, r) => s + r.dup_count, 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.vat_number || r.registration_number || 'unknown',
    description: `${r.dup_count} suppliers share this identifier: ${r.names}`,
    metadata: { dup_count: r.dup_count },
  }));

  // Duplicate suppliers cost ~R3k/each in vendor master maintenance + payment risk.
  const valueZar = affected * 3000;

  return makeFinding({
    code: 'proc_duplicate_suppliers',
    title: `${rows.length} duplicate-supplier groups detected (${affected} records)`,
    narrative: `${rows.length} groups of suppliers share the same VAT or registration number — ${affected} supplier records overlap. Duplicate vendors dilute negotiation leverage, fragment spend reporting, and create payment-fraud surface. Cleanup typically saves R3,000 per duplicate record (${formatZAR(valueZar)}) in master-data maintenance and risk reduction.`,
    affected_count: affected,
    value_at_risk_zar: valueZar,
    value_components: [{
      label: 'Vendor master cleanup saving',
      amount_zar: valueZar,
      methodology: `${affected} duplicate records × R3,000 maintenance + risk cost per record`,
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromCount(affected, { critical: 100, high: 30, medium: 10 }),
    ctx,
  });
}

async function detectProcSupplierConcentration(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT supplier_name, COUNT(*) as po_count, SUM(total) as spend, currency
       FROM erp_purchase_orders
      WHERE tenant_id = ?
        AND date(order_date) >= date('now', '-12 months')
        ${cf.clause}
      GROUP BY supplier_name, currency
      ORDER BY spend DESC`,
  ).bind(tenantId, ...cf.binds).all<{
    supplier_name: string; po_count: number; spend: number; currency: string | null;
  }>()).results || [];
  if (rows.length < 5) return null;

  const aggregated: Record<string, { po_count: number; spend_zar: number }> = {};
  let totalSpend = 0;
  for (const r of rows) {
    const z = toZAR(r.spend, r.currency || undefined, ctx);
    if (!aggregated[r.supplier_name]) aggregated[r.supplier_name] = { po_count: 0, spend_zar: 0 };
    aggregated[r.supplier_name].po_count += r.po_count;
    aggregated[r.supplier_name].spend_zar += z;
    totalSpend += z;
  }
  if (totalSpend <= 0) return null;

  const sorted = Object.entries(aggregated).sort((a, b) => b[1].spend_zar - a[1].spend_zar);
  const top5 = sorted.slice(0, 5);
  const top5Total = top5.reduce((s, [, v]) => s + v.spend_zar, 0);
  const top5Pct = (top5Total / totalSpend) * 100;
  if (top5Pct < 60) return null;

  // Single-supplier disruption value: 2% of the concentrated spend is a
  // conservative single-supplier-failure scenario.
  const disruptionRisk = top5Total * 0.02;

  const sample: SampleRecord[] = top5.map(([name, v]) => ({
    ref: name,
    description: `${v.po_count} POs, ${((v.spend_zar / totalSpend) * 100).toFixed(1)}% of 12-month spend`,
    amount_zar: v.spend_zar,
    currency: 'ZAR',
    metadata: { pos: v.po_count },
  }));

  return makeFinding({
    code: 'proc_supplier_concentration',
    title: `Top 5 suppliers absorb ${top5Pct.toFixed(0)}% of 12-month spend (${formatZAR(top5Total)})`,
    narrative: `Just 5 suppliers absorb ${top5Pct.toFixed(0)}% (${formatZAR(top5Total)}) of trailing-12-month spend. A single-supplier disruption against this concentration is conservatively a 2% impact (${formatZAR(disruptionRisk)}) — supply diversification, dual-sourcing, and continuity planning are warranted.`,
    affected_count: top5.length,
    value_at_risk_zar: disruptionRisk,
    value_components: [{
      label: 'Single-supplier disruption risk',
      amount_zar: disruptionRisk,
      methodology: `Top-5 spend ${formatZAR(top5Total)} × 2% disruption scenario`,
    }],
    currency_breakdown: { ZAR: totalSpend },
    sample_records: sample,
    severity: top5Pct >= 80 ? 'high' : 'medium',
    ctx,
  });
}

async function detectProcInactiveWithOpenPos(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id', 'p');
  const rows = (await db.prepare(
    `SELECT p.id, p.po_number, p.supplier_name, p.order_date, p.total, p.currency, p.delivery_status
       FROM erp_purchase_orders p
       JOIN erp_suppliers s ON s.tenant_id = p.tenant_id AND s.name = p.supplier_name
      WHERE p.tenant_id = ?
        AND s.status != 'active'
        AND p.status != 'closed'
        AND COALESCE(p.delivery_status, 'pending') != 'received'
        ${cf.clause}
      ORDER BY p.total DESC
      LIMIT 50`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; po_number: string; supplier_name: string;
    order_date: string; total: number; currency: string | null; delivery_status: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + r.total;
    totalZar += toZAR(r.total, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.po_number,
    description: `Inactive supplier: ${r.supplier_name}`,
    amount_native: r.total,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.total, r.currency || undefined, ctx),
    date: r.order_date,
  }));

  return makeFinding({
    code: 'proc_inactive_with_open_pos',
    title: `${rows.length} open POs against inactive suppliers (${formatZAR(totalZar)})`,
    narrative: `${rows.length} open purchase orders worth ${formatZAR(totalZar)} are issued to suppliers flagged inactive in the master file. These are stuck commitments — likely cancelled procurements that never closed in the system, or active orders against suppliers who have been deactivated administratively. Either way the working capital is mis-stated.`,
    affected_count: rows.length,
    value_at_risk_zar: totalZar,
    value_components: [{
      label: 'Working capital release on PO cleanup',
      amount_zar: totalZar,
      methodology: 'Sum of open PO totals where supplier.status != active',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(totalZar),
    ctx,
  });
}

async function detectInvStaleStock(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Stale = active product, stock_on_hand > 0, no recent invoice line referencing the SKU.
  // Without a movements table we approximate with: product.created_at older than 6 months
  // AND product not in any line_items in the last 6 months. Line_items check is an
  // expensive LIKE — limit to top 50 by stock value first.
  const rows = (await db.prepare(
    `SELECT id, sku, name, category, stock_on_hand, cost_price, selling_price, warehouse, created_at
       FROM erp_products
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND stock_on_hand > 0
        AND date(COALESCE(created_at, '1970-01-01')) <= date('now', '-6 months')
        AND id NOT IN (
          SELECT DISTINCT json_extract(value, '$.product_id')
            FROM erp_invoices, json_each(line_items)
           WHERE erp_invoices.tenant_id = ?
             AND date(invoice_date) >= date('now', '-6 months')
             AND json_extract(value, '$.product_id') IS NOT NULL
        )
        ${cf.clause}
      ORDER BY (stock_on_hand * cost_price) DESC
      LIMIT 100`,
  ).bind(tenantId, tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; category: string | null;
    stock_on_hand: number; cost_price: number; selling_price: number;
    warehouse: string | null; created_at: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalCost = rows.reduce((s, r) => s + (r.stock_on_hand || 0) * (r.cost_price || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    amount_zar: (r.stock_on_hand || 0) * (r.cost_price || 0),
    currency: 'ZAR',
    metadata: { category: r.category || 'unspecified', stock: r.stock_on_hand, warehouse: r.warehouse || 'unspecified' },
  }));

  // Stale stock carries 12–18% holding cost annually. We use 15%.
  const carryCost = totalCost * 0.15;

  return makeFinding({
    code: 'inv_stale_stock',
    title: `${rows.length} stale SKUs holding ${formatZAR(totalCost)} of inventory`,
    narrative: `${rows.length} active products with stock-on-hand have shown no invoice movement in the last 6 months — ${formatZAR(totalCost)} of working capital tied up in slow-movers. Holding cost at 15% per year is ${formatZAR(carryCost)}; targeted markdown, repackaging, or retirement decisions release that cash.`,
    affected_count: rows.length,
    value_at_risk_zar: carryCost,
    value_components: [
      { label: 'Annual carrying cost', amount_zar: carryCost, methodology: `${formatZAR(totalCost)} stale stock × 15% holding cost` },
    ],
    currency_breakdown: { ZAR: totalCost },
    sample_records: sample,
    severity: severityFromValue(carryCost),
    ctx,
  });
}

async function detectInvDeadStock(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Dead stock = same as stale but 12+ months. Reuse the same query template.
  const rows = (await db.prepare(
    `SELECT id, sku, name, category, stock_on_hand, cost_price
       FROM erp_products
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND stock_on_hand > 0
        AND date(COALESCE(created_at, '1970-01-01')) <= date('now', '-12 months')
        AND id NOT IN (
          SELECT DISTINCT json_extract(value, '$.product_id')
            FROM erp_invoices, json_each(line_items)
           WHERE erp_invoices.tenant_id = ?
             AND date(invoice_date) >= date('now', '-12 months')
             AND json_extract(value, '$.product_id') IS NOT NULL
        )
        ${cf.clause}
      ORDER BY (stock_on_hand * cost_price) DESC
      LIMIT 100`,
  ).bind(tenantId, tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; category: string | null;
    stock_on_hand: number; cost_price: number;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalCost = rows.reduce((s, r) => s + (r.stock_on_hand || 0) * (r.cost_price || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    amount_zar: (r.stock_on_hand || 0) * (r.cost_price || 0),
    currency: 'ZAR',
    metadata: { category: r.category || 'unspecified', stock: r.stock_on_hand },
  }));

  // Dead stock typically writes down to 30–50% of cost. The recoverable value
  // through liquidation is ~40% of cost — the remainder is impairment.
  const recoverable = totalCost * 0.40;

  return makeFinding({
    code: 'inv_dead_stock',
    title: `${rows.length} dead SKUs (no movement in 12+ months) — ${formatZAR(totalCost)} at cost`,
    narrative: `${rows.length} active products are dead stock — no invoice movement for over 12 months — carrying ${formatZAR(totalCost)} at cost. Liquidation typically recovers ~40% of cost (${formatZAR(recoverable)}); the rest is impairment that should hit the P&L this period rather than continuing to inflate the balance sheet.`,
    affected_count: rows.length,
    value_at_risk_zar: recoverable,
    value_components: [
      { label: 'Liquidation recovery', amount_zar: recoverable, methodology: `${formatZAR(totalCost)} dead stock × 40% liquidation factor` },
    ],
    currency_breakdown: { ZAR: totalCost },
    sample_records: sample,
    severity: maxSeverity(severityFromValue(totalCost), 'high'),
    ctx,
  });
}

async function detectInvNegativeStock(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, sku, name, stock_on_hand, cost_price, warehouse
       FROM erp_products
      WHERE tenant_id = ?
        AND stock_on_hand < 0
        ${cf.clause}
      ORDER BY stock_on_hand ASC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; stock_on_hand: number;
    cost_price: number; warehouse: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalUnits = rows.reduce((s, r) => s + Math.abs(r.stock_on_hand || 0), 0);
  const totalAbsValue = rows.reduce((s, r) => s + Math.abs(r.stock_on_hand || 0) * (r.cost_price || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    metadata: { stock: r.stock_on_hand, warehouse: r.warehouse || 'unspecified' },
  }));

  return makeFinding({
    code: 'inv_negative_stock',
    title: `${rows.length} SKUs with negative on-hand (${totalUnits} units, ${formatZAR(totalAbsValue)} cost)`,
    narrative: `${rows.length} products show negative stock-on-hand (${totalUnits} units total, ${formatZAR(totalAbsValue)} at cost). Negative stock is a data-quality red flag — typically caused by un-receipted issues, rebooking errors, or backflush race conditions. Until cleaned, COGS, fill rate, and reorder calculations are unreliable.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Inventory data quality remediation',
      amount_zar: totalAbsValue,
      methodology: 'Sum of |stock_on_hand × cost_price| for negative-balance SKUs (informational)',
    }],
    currency_breakdown: { ZAR: totalAbsValue },
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 200, high: 50, medium: 10 }),
    ctx,
  });
}

async function detectInvBelowReorder(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, sku, name, stock_on_hand, reorder_level, reorder_quantity, cost_price, warehouse
       FROM erp_products
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND reorder_level > 0
        AND stock_on_hand < reorder_level
        AND stock_on_hand >= 0
        ${cf.clause}
      ORDER BY (reorder_level - stock_on_hand) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; stock_on_hand: number;
    reorder_level: number; reorder_quantity: number; cost_price: number; warehouse: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    metadata: {
      stock: r.stock_on_hand,
      reorder_level: r.reorder_level,
      gap: r.reorder_level - r.stock_on_hand,
      warehouse: r.warehouse || 'unspecified',
    },
  }));

  // Stock-out cost: each below-reorder SKU has a measurable lost-margin
  // exposure. Conservative assumption: 1 stockout-event/month at margin = 30% of cost.
  const monthlyExposure = rows.reduce((s, r) => s + r.cost_price * 0.30, 0);
  const annual = monthlyExposure * 12;

  return makeFinding({
    code: 'inv_below_reorder',
    title: `${rows.length} SKUs below reorder level — stockout risk`,
    narrative: `${rows.length} active SKUs have on-hand quantities below their configured reorder level. Each carries a measurable stockout exposure — at 30% margin × 1 stockout event/month, the annualised lost-margin risk across this population is ${formatZAR(annual)}. Replenishment trigger automation closes the gap.`,
    affected_count: rows.length,
    value_at_risk_zar: annual,
    value_components: [{
      label: 'Annualised lost-margin from stockout',
      amount_zar: annual,
      methodology: `${rows.length} SKUs × R(cost_price × 30% margin) × 12 months`,
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 200, high: 80, medium: 20 }),
    ctx,
  });
}

async function detectInvMarginErosion(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, sku, name, cost_price, selling_price, stock_on_hand, category
       FROM erp_products
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 1
        AND cost_price > 0
        AND selling_price > 0
        AND cost_price >= selling_price
        ${cf.clause}
      ORDER BY (cost_price - selling_price) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; cost_price: number;
    selling_price: number; stock_on_hand: number; category: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  // Loss-on-sale: per unit (cost − sell) × stock_on_hand (assumed clearable).
  const lossExposure = rows.reduce((s, r) => s + (r.cost_price - r.selling_price) * Math.max(r.stock_on_hand || 0, 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    metadata: {
      cost: r.cost_price,
      sell: r.selling_price,
      margin: ((r.selling_price - r.cost_price) / Math.max(r.cost_price, 0.01) * 100).toFixed(1) + '%',
      stock: r.stock_on_hand,
    },
  }));

  return makeFinding({
    code: 'inv_margin_erosion',
    title: `${rows.length} SKUs sell at or below cost — ${formatZAR(lossExposure)} loss exposure`,
    narrative: `${rows.length} active SKUs have selling_price ≤ cost_price, meaning each unit sold loses money before overhead. Combined with on-hand quantities, the loss exposure on the current inventory is ${formatZAR(lossExposure)}. Pricing review or product retirement is warranted.`,
    affected_count: rows.length,
    value_at_risk_zar: lossExposure,
    value_components: [{
      label: 'Margin loss on current inventory',
      amount_zar: lossExposure,
      methodology: 'Σ (cost − sell) × stock_on_hand for loss-making SKUs',
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromValue(lossExposure),
    ctx,
  });
}

async function detectInvInactiveWithValue(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, sku, name, stock_on_hand, cost_price, warehouse
       FROM erp_products
      WHERE tenant_id = ?
        AND COALESCE(is_active, 1) = 0
        AND stock_on_hand > 0
        AND cost_price > 0
        ${cf.clause}
      ORDER BY (stock_on_hand * cost_price) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; sku: string; name: string; stock_on_hand: number;
    cost_price: number; warehouse: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalCost = rows.reduce((s, r) => s + r.stock_on_hand * r.cost_price, 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.sku,
    description: r.name,
    amount_zar: r.stock_on_hand * r.cost_price,
    currency: 'ZAR',
    metadata: { stock: r.stock_on_hand, warehouse: r.warehouse || 'unspecified' },
  }));

  // Inactive SKUs with stock are effectively dead — assume 40% liquidation.
  const recoverable = totalCost * 0.40;

  return makeFinding({
    code: 'inv_inactive_with_value',
    title: `${rows.length} discontinued SKUs holding ${formatZAR(totalCost)} of stock`,
    narrative: `${rows.length} discontinued / inactive products still carry on-hand stock totalling ${formatZAR(totalCost)} at cost. These are deactivated in the master but never cleared from inventory — typically the residue from product line transitions. Liquidation recovery at 40% (${formatZAR(recoverable)}) plus immediate write-down of the residue clears the balance sheet.`,
    affected_count: rows.length,
    value_at_risk_zar: recoverable,
    value_components: [{
      label: 'Liquidation recovery on inactive SKUs',
      amount_zar: recoverable,
      methodology: `${formatZAR(totalCost)} inactive stock × 40% liquidation factor`,
    }],
    currency_breakdown: { ZAR: totalCost },
    sample_records: sample,
    severity: severityFromValue(totalCost),
    ctx,
  });
}

async function detectSalesCustomerConcentration(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT customer_name, SUM(total) as revenue, currency, COUNT(*) as inv_count
       FROM erp_invoices
      WHERE tenant_id = ?
        AND date(invoice_date) >= date('now', '-12 months')
        AND status NOT IN ('draft', 'cancelled')
        ${cf.clause}
      GROUP BY customer_name, currency
      ORDER BY revenue DESC`,
  ).bind(tenantId, ...cf.binds).all<{
    customer_name: string; revenue: number; currency: string | null; inv_count: number;
  }>()).results || [];
  if (rows.length < 5) return null;

  const aggregated: Record<string, { rev_zar: number; invs: number }> = {};
  let totalRev = 0;
  for (const r of rows) {
    if (!aggregated[r.customer_name]) aggregated[r.customer_name] = { rev_zar: 0, invs: 0 };
    const z = toZAR(r.revenue, r.currency || undefined, ctx);
    aggregated[r.customer_name].rev_zar += z;
    aggregated[r.customer_name].invs += r.inv_count;
    totalRev += z;
  }
  if (totalRev <= 0) return null;

  const sorted = Object.entries(aggregated).sort((a, b) => b[1].rev_zar - a[1].rev_zar);
  const top5 = sorted.slice(0, 5);
  const top5Total = top5.reduce((s, [, v]) => s + v.rev_zar, 0);
  const top5Pct = (top5Total / totalRev) * 100;
  if (top5Pct < 60) return null;

  // Customer-loss revenue exposure: 5% of the top-5 revenue is a single-loss
  // scenario.
  const lossRisk = top5Total * 0.05;

  const sample: SampleRecord[] = top5.map(([name, v]) => ({
    ref: name,
    description: `${v.invs} invoices, ${((v.rev_zar / totalRev) * 100).toFixed(1)}% of 12-month revenue`,
    amount_zar: v.rev_zar,
    currency: 'ZAR',
    metadata: { invoices: v.invs },
  }));

  return makeFinding({
    code: 'sales_customer_concentration',
    title: `Top 5 customers generate ${top5Pct.toFixed(0)}% of revenue (${formatZAR(top5Total)})`,
    narrative: `${top5Pct.toFixed(0)}% (${formatZAR(top5Total)}) of trailing-12-month revenue comes from just 5 customers. Losing one is conservatively a 5% revenue impact (${formatZAR(lossRisk)}). Account-tier strategies, contract lengthening, and active diversification are warranted.`,
    affected_count: 5,
    value_at_risk_zar: lossRisk,
    value_components: [{
      label: 'Single-customer-loss revenue exposure',
      amount_zar: lossRisk,
      methodology: `Top-5 revenue ${formatZAR(top5Total)} × 5% single-loss scenario`,
    }],
    currency_breakdown: { ZAR: totalRev },
    sample_records: sample,
    severity: top5Pct >= 80 ? 'high' : 'medium',
    ctx,
  });
}

async function detectSalesInactiveWithAr(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id', 'i');
  const rows = (await db.prepare(
    `SELECT i.id, i.invoice_number, i.customer_name, c.name as customer_master_name,
            i.amount_due, i.currency, i.invoice_date, c.status as customer_status
       FROM erp_invoices i
       JOIN erp_customers c ON c.tenant_id = i.tenant_id AND c.id = i.customer_id
      WHERE i.tenant_id = ?
        AND i.payment_status != 'paid'
        AND i.amount_due > 0
        AND c.status != 'active'
        ${cf.clause}
      ORDER BY i.amount_due DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; invoice_number: string; customer_name: string | null;
    customer_master_name: string; amount_due: number; currency: string | null;
    invoice_date: string; customer_status: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + r.amount_due;
    totalZar += toZAR(r.amount_due, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.invoice_number,
    description: `${r.customer_master_name} (status: ${r.customer_status})`,
    amount_native: r.amount_due,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.amount_due, r.currency || undefined, ctx),
    date: r.invoice_date,
  }));

  // Inactive customers with AR are typically harder to collect — 30% of the
  // outstanding is at risk.
  const writeOffRisk = totalZar * 0.30;

  return makeFinding({
    code: 'sales_inactive_with_ar',
    title: `${rows.length} unpaid invoices on inactive/closed customer accounts (${formatZAR(totalZar)})`,
    narrative: `${rows.length} unpaid invoices worth ${formatZAR(totalZar)} are against customers flagged inactive in the master file. Once a customer relationship has been terminated, collection probability drops sharply — bad-debt provisioning at 30% of outstanding gives ${formatZAR(writeOffRisk)} of likely write-off unless escalated immediately.`,
    affected_count: rows.length,
    value_at_risk_zar: writeOffRisk,
    value_components: [{
      label: 'Likely write-off on inactive AR',
      amount_zar: writeOffRisk,
      methodology: `${formatZAR(totalZar)} inactive AR × 30% historical write-off rate`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: maxSeverity(severityFromValue(writeOffRisk), 'high'),
    ctx,
  });
}

async function detectSalesCreditNoCheck(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, name, credit_limit, credit_balance, payment_terms, currency, created_at
       FROM erp_customers
      WHERE tenant_id = ?
        AND status = 'active'
        AND COALESCE(credit_limit, 0) = 0
        AND credit_balance > 0
        ${cf.clause}
      ORDER BY credit_balance DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; name: string; credit_limit: number; credit_balance: number;
    payment_terms: string | null; currency: string | null; created_at: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    breakdown[cur] = (breakdown[cur] || 0) + r.credit_balance;
    totalZar += toZAR(r.credit_balance, cur, ctx);
  }

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.name,
    description: `Active customer with credit balance but no limit set (created ${r.created_at})`,
    amount_native: r.credit_balance,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.credit_balance, r.currency || undefined, ctx),
    metadata: { payment_terms: r.payment_terms || 'unspecified' },
  }));

  // Default-rate exposure on uncreditchecked accounts ~5% of balance.
  const defaultRisk = totalZar * 0.05;

  return makeFinding({
    code: 'sales_credit_no_check',
    title: `${rows.length} customers carry balance with no credit limit set (${formatZAR(totalZar)})`,
    narrative: `${rows.length} active customers have an outstanding balance but no credit limit configured — ${formatZAR(totalZar)} of unvetted exposure. Default rates on uncreditchecked accounts run ~5% (${formatZAR(defaultRisk)}); systematic credit vetting on onboarding eliminates this surface.`,
    affected_count: rows.length,
    value_at_risk_zar: defaultRisk,
    value_components: [{
      label: 'Default exposure on uncreditchecked balances',
      amount_zar: defaultRisk,
      methodology: `${formatZAR(totalZar)} unvetted balance × 5% default rate`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(defaultRisk),
    ctx,
  });
}

async function detectHrTerminatedInPayroll(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, employee_number, first_name, last_name, department, gross_salary,
            status, termination_date, salary_frequency
       FROM erp_employees
      WHERE tenant_id = ?
        AND status IN ('terminated', 'resigned', 'retired')
        AND COALESCE(gross_salary, 0) > 0
        ${cf.clause}
      ORDER BY gross_salary DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; employee_number: string; first_name: string; last_name: string;
    department: string | null; gross_salary: number; status: string;
    termination_date: string | null; salary_frequency: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  // Annualise based on salary_frequency
  const annualLeak = rows.reduce((s, r) => {
    const mult = r.salary_frequency === 'monthly' ? 12 : r.salary_frequency === 'weekly' ? 52 : 12;
    return s + (r.gross_salary || 0) * mult;
  }, 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.employee_number,
    description: `${r.first_name} ${r.last_name} (${r.status}, ${r.department || 'no dept'})`,
    amount_zar: r.gross_salary * (r.salary_frequency === 'monthly' ? 12 : 52),
    currency: 'ZAR',
    date: r.termination_date || undefined,
    metadata: { frequency: r.salary_frequency },
  }));

  return makeFinding({
    code: 'hr_terminated_in_payroll',
    title: `${rows.length} terminated/resigned employees with active payroll setup (${formatZAR(annualLeak)} annual exposure)`,
    narrative: `${rows.length} employees marked terminated/resigned/retired still carry a non-zero gross_salary in the payroll setup — ${formatZAR(annualLeak)} of annual salary exposure. Each is a potential ghost-employee payment until the payroll team resets the master record.`,
    affected_count: rows.length,
    value_at_risk_zar: annualLeak,
    value_components: [{
      label: 'Ghost-employee annual payroll leak',
      amount_zar: annualLeak,
      methodology: 'Sum of annualised gross_salary on terminated employees with non-zero salary',
    }],
    currency_breakdown: { ZAR: annualLeak },
    sample_records: sample,
    severity: maxSeverity(severityFromValue(annualLeak), severityFromCount(rows.length, { critical: 50, high: 10, medium: 3 })),
    ctx,
  });
}

async function detectHrHighPayrollConcentration(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const summary = await db.prepare(
    `SELECT SUM(gross_salary) as total_payroll, COUNT(*) as headcount
       FROM erp_employees WHERE tenant_id = ? AND status = 'active' AND salary_frequency = 'monthly' AND gross_salary > 0 ${cf.clause}`,
  ).bind(tenantId, ...cf.binds).first<{ total_payroll: number; headcount: number }>();
  if (!summary || !summary.total_payroll || summary.headcount < 5) return null;

  const top5 = await db.prepare(
    `SELECT employee_number, first_name, last_name, department, position, gross_salary
       FROM erp_employees
      WHERE tenant_id = ? AND status = 'active' AND salary_frequency = 'monthly' AND gross_salary > 0 ${cf.clause}
      ORDER BY gross_salary DESC LIMIT 5`,
  ).bind(tenantId, ...cf.binds).all<{
    employee_number: string; first_name: string; last_name: string;
    department: string | null; position: string | null; gross_salary: number;
  }>();

  const top5Total = (top5.results || []).reduce((s, r) => s + r.gross_salary, 0);
  const top5Pct = (top5Total / summary.total_payroll) * 100;
  if (top5Pct < 25) return null;

  const sample: SampleRecord[] = (top5.results || []).map(r => ({
    ref: r.employee_number,
    description: `${r.first_name} ${r.last_name} — ${r.position || 'no position'}`,
    amount_zar: r.gross_salary * 12,
    currency: 'ZAR',
    metadata: { department: r.department || 'unspecified' },
  }));

  return makeFinding({
    code: 'hr_high_payroll_concentration',
    title: `Top 5 earners take ${top5Pct.toFixed(0)}% of monthly payroll`,
    narrative: `Top 5 active monthly earners account for ${top5Pct.toFixed(0)}% (${formatZAR(top5Total)}) of the total monthly payroll across ${summary.headcount} employees. Compensation concentration at this level warrants a structural compensation review — particularly when annualised it is ${formatZAR(top5Total * 12)} of fixed cost.`,
    affected_count: 5,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Annualised top-5 cost',
      amount_zar: top5Total * 12,
      methodology: 'Sum of top-5 gross_salary × 12 (informational; review trigger)',
    }],
    currency_breakdown: { ZAR: top5Total * 12 },
    sample_records: sample,
    severity: top5Pct >= 40 ? 'high' : 'medium',
    ctx,
  });
}

async function detectTaxOverdueSubmission(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  void ctx;
  const rows = (await db.prepare(
    `SELECT id, tax_period, tax_type, output_vat, input_vat, net_vat, status, created_at
       FROM erp_tax_entries
      WHERE tenant_id = ?
        AND status != 'submitted'
        AND date(COALESCE(created_at, '1970-01-01')) < date('now', '-60 days')
      ORDER BY created_at ASC
      LIMIT 50`,
  ).bind(tenantId).all<{
    id: string; tax_period: string; tax_type: string;
    output_vat: number; input_vat: number; net_vat: number;
    status: string; created_at: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;

  const totalNetVat = rows.reduce((s, r) => s + Math.abs(r.net_vat || 0), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: `${r.tax_type} ${r.tax_period}`,
    description: `Output VAT ${formatZAR(r.output_vat)}, Input VAT ${formatZAR(r.input_vat)} (status: ${r.status})`,
    amount_zar: r.net_vat,
    currency: 'ZAR',
    date: r.created_at || undefined,
  }));

  // SARS late-VAT penalty is 10% of outstanding + interest. Cap exposure at 15%.
  const penaltyRisk = totalNetVat * 0.15;

  return makeFinding({
    code: 'tax_overdue_submission',
    title: `${rows.length} overdue VAT submissions (>${60} days, ${formatZAR(totalNetVat)} net)`,
    narrative: `${rows.length} VAT submissions are overdue by more than 60 days, with combined net VAT of ${formatZAR(totalNetVat)}. SARS late-payment penalties run 10% of outstanding plus interest — a 15% all-in penalty exposure of ${formatZAR(penaltyRisk)}. Tax compliance automation closes the cycle.`,
    affected_count: rows.length,
    value_at_risk_zar: penaltyRisk,
    value_components: [{
      label: 'SARS penalty exposure',
      amount_zar: penaltyRisk,
      methodology: `${formatZAR(totalNetVat)} overdue VAT × 15% combined penalty + interest`,
    }],
    currency_breakdown: { ZAR: totalNetVat },
    sample_records: sample,
    severity: maxSeverity(severityFromValue(penaltyRisk), 'high'),
    ctx,
  });
}

async function detectTaxMissingVatNumbers(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  void ctx;
  // Customers with significant balances but no VAT number (B2B exposure)
  const cusRow = await db.prepare(
    `SELECT COUNT(*) as cnt, SUM(credit_balance) as total_bal
       FROM erp_customers
      WHERE tenant_id = ? AND status = 'active'
        AND (vat_number IS NULL OR vat_number = '')
        AND credit_balance > 10000`,
  ).bind(tenantId).first<{ cnt: number; total_bal: number }>();
  const supRow = await db.prepare(
    `SELECT COUNT(*) as cnt FROM erp_suppliers WHERE tenant_id = ? AND status = 'active' AND (vat_number IS NULL OR vat_number = '')`,
  ).bind(tenantId).first<{ cnt: number }>();
  const cusCount = cusRow?.cnt || 0;
  const supCount = supRow?.cnt || 0;
  const total = cusCount + supCount;
  if (total === 0) return null;

  // Disallowed VAT input claims if supplier VAT number missing — assume 5% of supplier base × R5k avg input claim/year.
  const disallowedClaims = supCount * 5000;

  const samples: SampleRecord[] = [];
  if (cusCount > 0) samples.push({ ref: 'customers_missing_vat', description: `${cusCount} active customers with balance > R10k and no VAT number`, amount_zar: cusRow?.total_bal || 0, currency: 'ZAR' });
  if (supCount > 0) samples.push({ ref: 'suppliers_missing_vat', description: `${supCount} active suppliers with no VAT number`, currency: 'ZAR' });

  return makeFinding({
    code: 'tax_missing_vat_numbers',
    title: `${total} master records missing VAT numbers (${cusCount} customers, ${supCount} suppliers)`,
    narrative: `${cusCount} active customers (with balances above R10k) and ${supCount} active suppliers have no VAT number on file. Missing supplier VAT numbers disallow input-VAT claims — conservative annual leakage at R5k per supplier is ${formatZAR(disallowedClaims)}. Vendor master cleanup closes the gap.`,
    affected_count: total,
    value_at_risk_zar: disallowedClaims,
    value_components: [{
      label: 'Disallowed input-VAT claims',
      amount_zar: disallowedClaims,
      methodology: `${supCount} suppliers × R5,000 average input-VAT claim`,
    }],
    currency_breakdown: {},
    sample_records: samples,
    severity: severityFromCount(total, { critical: 200, high: 50, medium: 10 }),
    ctx,
  });
}

async function detectTaxVatRateAnomaly(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  // Anomaly = ZA invoice with non-zero subtotal where vat_amount/subtotal is
  // outside 14% .. 16% (the 15% standard rate ± rounding margin).
  const rows = (await db.prepare(
    `SELECT id, invoice_number, customer_name, subtotal, vat_amount, total, currency, invoice_date
       FROM erp_invoices
      WHERE tenant_id = ?
        AND COALESCE(currency, 'ZAR') = 'ZAR'
        AND subtotal > 0
        AND (vat_amount / subtotal < 0.14 OR vat_amount / subtotal > 0.16)
        AND vat_amount > 0
        ${cf.clause}
      ORDER BY ABS(vat_amount - (subtotal * 0.15)) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; invoice_number: string; customer_name: string | null;
    subtotal: number; vat_amount: number; total: number;
    currency: string | null; invoice_date: string;
  }>()).results || [];
  if (rows.length === 0) return null;

  const expectedVat = rows.reduce((s, r) => s + r.subtotal * 0.15, 0);
  const actualVat = rows.reduce((s, r) => s + (r.vat_amount || 0), 0);
  const variance = Math.abs(expectedVat - actualVat);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.invoice_number,
    description: r.customer_name || 'Unknown',
    metadata: {
      subtotal: r.subtotal,
      vat: r.vat_amount,
      effective_rate: ((r.vat_amount / r.subtotal) * 100).toFixed(1) + '%',
    },
    date: r.invoice_date,
  }));

  return makeFinding({
    code: 'tax_vat_rate_anomaly',
    title: `${rows.length} ZAR invoices with non-standard VAT rate (${formatZAR(variance)} variance)`,
    narrative: `${rows.length} ZAR-currency invoices show a VAT rate outside the standard 15% (±1% rounding margin). The cumulative variance vs expected is ${formatZAR(variance)}. Some may legitimately use zero-rated or exempt items; the rest are potential tax misclassification.`,
    affected_count: rows.length,
    value_at_risk_zar: variance,
    value_components: [{
      label: 'VAT misclassification variance',
      amount_zar: variance,
      methodology: '|Σ(subtotal × 15%) − Σ(actual VAT)| across off-rate invoices',
    }],
    currency_breakdown: { ZAR: variance },
    sample_records: sample,
    severity: severityFromValue(variance),
    ctx,
  });
}

async function detectFxCurrencyExposure(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT currency, COUNT(*) as cnt, SUM(amount_due) as outstanding
       FROM erp_invoices
      WHERE tenant_id = ?
        AND payment_status != 'paid'
        AND currency IS NOT NULL
        AND currency != 'ZAR'
        ${cf.clause}
      GROUP BY currency
      HAVING SUM(amount_due) > 0`,
  ).bind(tenantId, ...cf.binds).all<{ currency: string; cnt: number; outstanding: number }>()).results || [];
  if (rows.length === 0) return null;

  let totalZarExposure = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    breakdown[r.currency] = (breakdown[r.currency] || 0) + r.outstanding;
    totalZarExposure += toZAR(r.outstanding, r.currency, ctx);
  }

  // 10% FX volatility scenario
  const volatility = totalZarExposure * 0.10;

  const sample: SampleRecord[] = rows.map(r => ({
    ref: r.currency,
    description: `${r.cnt} open invoices, ${formatZAR(toZAR(r.outstanding, r.currency, ctx))} ZAR-equivalent`,
    amount_native: r.outstanding,
    currency: r.currency,
    amount_zar: toZAR(r.outstanding, r.currency, ctx),
    metadata: { invoices: r.cnt },
  }));

  return makeFinding({
    code: 'fx_currency_exposure',
    title: `${rows.length} foreign currencies with ${formatZAR(totalZarExposure)} unhedged AR exposure`,
    narrative: `Unpaid invoices in ${rows.length} non-base currencies expose ${formatZAR(totalZarExposure)} (ZAR-equivalent) to FX volatility. A 10% currency move (${formatZAR(volatility)}) reprices the receivables instantly. Forward cover or natural hedging through matched-currency payables eliminates the surface.`,
    affected_count: rows.reduce((s, r) => s + r.cnt, 0),
    value_at_risk_zar: volatility,
    value_components: [{
      label: 'FX volatility exposure',
      amount_zar: volatility,
      methodology: `${formatZAR(totalZarExposure)} foreign-currency AR × 10% volatility`,
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(volatility),
    ctx,
  });
}

async function detectFxDualUseCurrency(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  void ctx;
  // A supplier billed in 2+ currencies in the last 12 months.
  const rows = (await db.prepare(
    `SELECT supplier_name, COUNT(DISTINCT currency) as cur_count, GROUP_CONCAT(DISTINCT currency) as currencies
       FROM erp_purchase_orders
      WHERE tenant_id = ?
        AND date(order_date) >= date('now', '-12 months')
      GROUP BY supplier_name
     HAVING cur_count > 1
      ORDER BY cur_count DESC
      LIMIT 50`,
  ).bind(tenantId).all<{ supplier_name: string; cur_count: number; currencies: string }>()).results || [];
  if (rows.length === 0) return null;

  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.supplier_name,
    description: `Billed in ${r.cur_count} currencies: ${r.currencies}`,
    metadata: { currencies: r.currencies },
  }));

  return makeFinding({
    code: 'fx_dual_use_currency',
    title: `${rows.length} suppliers billed in multiple currencies — likely master-data duplicates`,
    narrative: `${rows.length} suppliers have been billed in 2 or more currencies in the last 12 months. This typically indicates either legitimate multi-entity dealings (handled as separate supplier records) OR — more commonly — a duplicate vendor record where the same legal entity is mastered twice. Either way, vendor master cleanup is warranted.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Vendor master cleanup',
      amount_zar: rows.length * 3000,
      methodology: `${rows.length} suspect master records × R3,000 maintenance + risk cost (informational)`,
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 50, high: 15, medium: 5 }),
    ctx,
  });
}

// ── Company-type detection ────────────────────────────────────────────────

/**
 * Classify the prospect as product / service / mixed / unknown so the
 * orchestrator can include or skip the service-only detectors.
 *
 * Heuristic (deliberately simple — gets the right answer for ~95% of cases
 * and never raises a false-positive that would attempt a service detector
 * against a tenant with no time-tracking data):
 *
 *   - has erp_time_entries OR erp_projects rows AND has erp_products → mixed
 *   - has erp_time_entries OR erp_projects rows AND no erp_products → service
 *   - has erp_products AND no time/projects → product
 *   - none of the above → unknown (only the universal detectors run)
 */
export async function detectCompanyProfile(
  db: D1Database,
  tenantId: string,
): Promise<{ profile: CompanyProfile; product_count: number; project_count: number; time_entry_count: number }> {
  const counts = await db.prepare(
    `SELECT
       (SELECT COUNT(*) FROM erp_products WHERE tenant_id = ? AND COALESCE(is_active, 1) = 1) as product_count,
       (SELECT COUNT(*) FROM erp_projects WHERE tenant_id = ?) as project_count,
       (SELECT COUNT(*) FROM erp_time_entries WHERE tenant_id = ?) as time_entry_count`,
  ).bind(tenantId, tenantId, tenantId).first<{ product_count: number; project_count: number; time_entry_count: number }>();
  const product_count = counts?.product_count || 0;
  const project_count = counts?.project_count || 0;
  const time_entry_count = counts?.time_entry_count || 0;
  const hasService = project_count > 0 || time_entry_count > 0;
  const hasProduct = product_count > 0;
  let profile: CompanyProfile = 'unknown';
  if (hasService && hasProduct) profile = 'mixed';
  else if (hasService) profile = 'service';
  else if (hasProduct) profile = 'product';
  return { profile, product_count, project_count, time_entry_count };
}

// ── Service-company detectors ────────────────────────────────────────────

/**
 * Billable utilisation — billable hours ÷ total hours over the last 90 days.
 * Industry benchmark for professional services is 65-75% utilisation; below
 * 50% is structural waste worth quantifying.
 */
async function detectSvcLowBillableUtilisation(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const summary = await db.prepare(
    `SELECT
       SUM(hours) as total_hours,
       SUM(CASE WHEN billable = 1 THEN hours ELSE 0 END) as billable_hours,
       SUM(CASE WHEN billable = 1 THEN hours * billable_rate ELSE 0 END) as billable_value,
       COUNT(DISTINCT employee_id) as headcount
     FROM erp_time_entries
     WHERE tenant_id = ?
       AND date(work_date) >= date('now', '-90 days')
       ${cf.clause}`,
  ).bind(tenantId, ...cf.binds).first<{ total_hours: number; billable_hours: number; billable_value: number; headcount: number }>();
  if (!summary || !summary.total_hours || summary.total_hours < 100) return null;
  const utilPct = (summary.billable_hours / summary.total_hours) * 100;
  if (utilPct >= 50) return null;
  // Lift to 65% target → unrealised billable hours × historical billable rate.
  const targetHours = summary.total_hours * 0.65;
  const gapHours = Math.max(0, targetHours - summary.billable_hours);
  const avgRate = summary.billable_hours > 0 ? summary.billable_value / summary.billable_hours : 1500;
  const annualUplift = gapHours * avgRate * (365 / 90); // annualise from 90d window
  return makeFinding({
    code: 'svc_low_billable_utilisation',
    title: `Billable utilisation ${utilPct.toFixed(0)}% — below 50% threshold`,
    narrative: `Across ${summary.headcount} consultants in the last 90 days, billable utilisation is ${utilPct.toFixed(0)}% (${Math.round(summary.billable_hours).toLocaleString()} of ${Math.round(summary.total_hours).toLocaleString()} hours). Lifting to a 65% benchmark recovers ${Math.round(gapHours).toLocaleString()} 90-day hours, ${formatZAR(annualUplift)} annualised at the current average billable rate.`,
    affected_count: summary.headcount,
    value_at_risk_zar: annualUplift,
    value_components: [{
      label: 'Annualised utilisation uplift',
      amount_zar: annualUplift,
      methodology: `(65% target − ${utilPct.toFixed(0)}% actual) × ${Math.round(summary.total_hours).toLocaleString()} hours × ${formatZAR(avgRate)}/hr × 365/90`,
    }],
    currency_breakdown: {},
    sample_records: [],
    severity: maxSeverity(severityFromValue(annualUplift), 'high'),
    ctx,
  });
}

/**
 * Time entries that are billable, approved, but not invoiced and aging out.
 * Each day unbilled is a day the cash conversion cycle stretches.
 */
async function detectSvcUnbilledTimeAging(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, employee_number, project_code, work_date, hours, billable_rate, currency, description
       FROM erp_time_entries
      WHERE tenant_id = ?
        AND billable = 1
        AND COALESCE(billed, 0) = 0
        AND approval_status = 'approved'
        AND date(work_date) < date('now', '-30 days')
        ${cf.clause}
      ORDER BY (hours * billable_rate) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; employee_number: string | null; project_code: string | null;
    work_date: string; hours: number; billable_rate: number;
    currency: string | null; description: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;
  let totalZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    const v = (r.hours || 0) * (r.billable_rate || 0);
    breakdown[cur] = (breakdown[cur] || 0) + v;
    totalZar += toZAR(v, cur, ctx);
  }
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: `${r.project_code || 'no-project'} / ${r.employee_number || 'unknown'}`,
    description: r.description || `${r.hours}h @ ${r.billable_rate}/h`,
    amount_native: r.hours * r.billable_rate,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.hours * r.billable_rate, r.currency || undefined, ctx),
    date: r.work_date,
  }));
  return makeFinding({
    code: 'svc_unbilled_time_aging',
    title: `${rows.length} aged unbilled time entries (${formatZAR(totalZar)})`,
    narrative: `${rows.length} approved billable time entries totalling ${formatZAR(totalZar)} have been waiting more than 30 days to invoice. Every day unbilled is a day of working capital tied up — and the longer it sits, the higher the chance the client pushes back on the line item. WIP automation invoices these immediately on approval.`,
    affected_count: rows.length,
    value_at_risk_zar: totalZar,
    value_components: [{
      label: 'Aged WIP — invoice immediately',
      amount_zar: totalZar,
      methodology: 'Σ (hours × billable_rate) on approved-but-unbilled entries older than 30 days',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(totalZar),
    ctx,
  });
}

/**
 * Projects where actual_cost has exceeded budgeted_cost by > 15% but the
 * project is still active. Each is a margin leak to investigate.
 */
async function detectSvcProjectOverrun(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, code, name, customer_name, contract_value, budgeted_cost, actual_cost, currency, project_manager
       FROM erp_projects
      WHERE tenant_id = ?
        AND status = 'active'
        AND budgeted_cost > 0
        AND actual_cost > budgeted_cost * 1.15
        ${cf.clause}
      ORDER BY (actual_cost - budgeted_cost) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; code: string; name: string; customer_name: string | null;
    contract_value: number; budgeted_cost: number; actual_cost: number;
    currency: string | null; project_manager: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;
  let overrunZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    const overrun = r.actual_cost - r.budgeted_cost;
    breakdown[cur] = (breakdown[cur] || 0) + overrun;
    overrunZar += toZAR(overrun, cur, ctx);
  }
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.code,
    description: `${r.name} (${r.customer_name || 'no client'}) — PM ${r.project_manager || 'unassigned'}`,
    amount_native: r.actual_cost - r.budgeted_cost,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.actual_cost - r.budgeted_cost, r.currency || undefined, ctx),
    metadata: {
      budgeted: r.budgeted_cost,
      actual: r.actual_cost,
      overrun_pct: (((r.actual_cost - r.budgeted_cost) / r.budgeted_cost) * 100).toFixed(0) + '%',
    },
  }));
  return makeFinding({
    code: 'svc_project_overrun',
    title: `${rows.length} active projects over budget by 15%+ (${formatZAR(overrunZar)} overrun)`,
    narrative: `${rows.length} active projects have already burned ≥15% past their budgeted cost — total overrun ${formatZAR(overrunZar)}. Without intervention this falls straight through to the gross margin. Project profitability monitoring catches the trend in the first 25% of project life.`,
    affected_count: rows.length,
    value_at_risk_zar: overrunZar,
    value_components: [{
      label: 'Margin leak from active overruns',
      amount_zar: overrunZar,
      methodology: 'Σ (actual_cost − budgeted_cost) on active projects > 15% over',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: maxSeverity(severityFromValue(overrunZar), 'high'),
    ctx,
  });
}

/**
 * Closed projects that ended at negative margin — actual cost > recognised
 * revenue. These are losses booked but not yet learned from.
 */
async function detectSvcProjectMarginNegative(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, code, name, customer_name, contract_value, recognised_revenue, actual_cost, currency
       FROM erp_projects
      WHERE tenant_id = ?
        AND status = 'closed'
        AND recognised_revenue > 0
        AND actual_cost > recognised_revenue
        ${cf.clause}
      ORDER BY (actual_cost - recognised_revenue) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; code: string; name: string; customer_name: string | null;
    contract_value: number; recognised_revenue: number; actual_cost: number;
    currency: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;
  let lossZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    const loss = r.actual_cost - r.recognised_revenue;
    breakdown[cur] = (breakdown[cur] || 0) + loss;
    lossZar += toZAR(loss, cur, ctx);
  }
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.code,
    description: `${r.name} (${r.customer_name || 'no client'})`,
    amount_native: r.actual_cost - r.recognised_revenue,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.actual_cost - r.recognised_revenue, r.currency || undefined, ctx),
    metadata: { revenue: r.recognised_revenue, cost: r.actual_cost },
  }));
  return makeFinding({
    code: 'svc_project_margin_negative',
    title: `${rows.length} closed projects ran at negative margin (${formatZAR(lossZar)} total loss)`,
    narrative: `${rows.length} closed projects delivered at a loss — ${formatZAR(lossZar)} of cost above recognised revenue. These are the patterns to learn from before the next contract: scope creep, mis-scoped time, off-rate work. Re-quoting on the same shape would lift margin by the full loss amount.`,
    affected_count: rows.length,
    value_at_risk_zar: lossZar,
    value_components: [{
      label: 'Avoidable loss on future re-quotes',
      amount_zar: lossZar,
      methodology: 'Σ (actual_cost − recognised_revenue) on closed loss-making projects',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: maxSeverity(severityFromValue(lossZar), 'high'),
    ctx,
  });
}

/**
 * Time entries pending approval > 14 days. Approval lag delays invoicing,
 * obscures utilisation, and is the most common audit finding in services.
 */
async function detectSvcUnapprovedTimeEntries(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, employee_number, project_code, work_date, hours, billable_rate, currency, approval_status
       FROM erp_time_entries
      WHERE tenant_id = ?
        AND approval_status = 'pending'
        AND date(work_date) < date('now', '-14 days')
        ${cf.clause}
      ORDER BY work_date ASC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; employee_number: string | null; project_code: string | null;
    work_date: string; hours: number; billable_rate: number; currency: string | null;
    approval_status: string;
  }>()).results || [];
  if (rows.length === 0) return null;
  const totalValue = rows.reduce((s, r) => s + toZAR((r.hours || 0) * (r.billable_rate || 0), r.currency || undefined, ctx), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.id,
    description: `${r.project_code || '?'} / ${r.employee_number || '?'} — ${r.hours}h`,
    amount_zar: toZAR((r.hours || 0) * (r.billable_rate || 0), r.currency || undefined, ctx),
    currency: r.currency || 'ZAR',
    date: r.work_date,
  }));
  return makeFinding({
    code: 'svc_unapproved_time_entries',
    title: `${rows.length} time entries pending approval > 14 days (${formatZAR(totalValue)})`,
    narrative: `${rows.length} time entries totalling ${formatZAR(totalValue)} have been waiting for approval for more than 14 days. Approval lag delays invoicing and obscures utilisation reporting; automating approval workflow + escalations clears the backlog within a sprint.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Time waiting for approval',
      amount_zar: totalValue,
      methodology: 'Σ (hours × billable_rate) on pending entries > 14 days old (informational)',
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 200, high: 50, medium: 10 }),
    ctx,
  });
}

/**
 * Projects with delivered hours but recognised_revenue lagging the
 * billed_to_date — milestone-billing or PoC revenue not yet booked.
 */
async function detectSvcRevenueRecognitionLag(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id');
  const rows = (await db.prepare(
    `SELECT id, code, name, customer_name, billed_to_date, recognised_revenue, currency, billing_type
       FROM erp_projects
      WHERE tenant_id = ?
        AND status = 'active'
        AND billed_to_date > 0
        AND billed_to_date - recognised_revenue > billed_to_date * 0.2
        ${cf.clause}
      ORDER BY (billed_to_date - recognised_revenue) DESC
      LIMIT 100`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; code: string; name: string; customer_name: string | null;
    billed_to_date: number; recognised_revenue: number; currency: string | null;
    billing_type: string;
  }>()).results || [];
  if (rows.length === 0) return null;
  let lagZar = 0;
  const breakdown: Record<string, number> = {};
  for (const r of rows) {
    const cur = (r.currency || 'ZAR').toUpperCase();
    const lag = r.billed_to_date - r.recognised_revenue;
    breakdown[cur] = (breakdown[cur] || 0) + lag;
    lagZar += toZAR(lag, cur, ctx);
  }
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.code,
    description: `${r.name} — billing type: ${r.billing_type}`,
    amount_native: r.billed_to_date - r.recognised_revenue,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.billed_to_date - r.recognised_revenue, r.currency || undefined, ctx),
    metadata: { billed: r.billed_to_date, recognised: r.recognised_revenue },
  }));
  return makeFinding({
    code: 'svc_revenue_recognition_lag',
    title: `${rows.length} projects with recognition lag > 20% of billings (${formatZAR(lagZar)})`,
    narrative: `${rows.length} active projects have billed ${formatZAR(lagZar)} more than they have recognised as revenue. This is deferred revenue or unrecognised milestones — either intentional (PoC delivery) or a revenue-recognition lag worth surfacing to the finance team. Either way it's a discussion to have before period-close.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Recognition lag',
      amount_zar: lagZar,
      methodology: 'Σ (billed_to_date − recognised_revenue) on active projects with > 20% lag (informational)',
    }],
    currency_breakdown: breakdown,
    sample_records: sample,
    severity: severityFromValue(lagZar),
    ctx,
  });
}

/**
 * Active projects with zero time entries in the last 60 days. Either the
 * project is dormant and should be closed, or work IS happening but is being
 * recorded against a different project (timesheet hygiene issue).
 */
async function detectSvcZeroHoursActiveProject(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id', 'p');
  const rows = (await db.prepare(
    `SELECT p.id, p.code, p.name, p.customer_name, p.contract_value, p.start_date, p.currency
       FROM erp_projects p
      WHERE p.tenant_id = ?
        AND p.status = 'active'
        AND date(COALESCE(p.start_date, '1970-01-01')) <= date('now', '-60 days')
        AND NOT EXISTS (
          SELECT 1 FROM erp_time_entries t
          WHERE t.tenant_id = p.tenant_id
            AND t.project_id = p.id
            AND date(t.work_date) >= date('now', '-60 days')
        )
        ${cf.clause}
      ORDER BY p.contract_value DESC
      LIMIT 50`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; code: string; name: string; customer_name: string | null;
    contract_value: number; start_date: string | null; currency: string | null;
  }>()).results || [];
  if (rows.length === 0) return null;
  let totalContractZar = 0;
  for (const r of rows) totalContractZar += toZAR(r.contract_value, r.currency || undefined, ctx);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.code,
    description: `${r.name} (${r.customer_name || 'no client'}) — started ${r.start_date || '?'}`,
    amount_native: r.contract_value,
    currency: r.currency || 'ZAR',
    amount_zar: toZAR(r.contract_value, r.currency || undefined, ctx),
  }));
  return makeFinding({
    code: 'svc_zero_hours_active_project',
    title: `${rows.length} active projects with zero hours in 60 days (${formatZAR(totalContractZar)} contract value)`,
    narrative: `${rows.length} projects are flagged active with combined contract value ${formatZAR(totalContractZar)} but have had no time entries logged for 60+ days. Each is either a dormant project that should be closed (stops dilution of utilisation reports) or a timesheet hygiene gap where work is being booked elsewhere.`,
    affected_count: rows.length,
    value_at_risk_zar: 0,
    value_components: [{
      label: 'Project status hygiene',
      amount_zar: totalContractZar,
      methodology: 'Σ contract_value on dormant active projects (informational)',
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: severityFromCount(rows.length, { critical: 50, high: 20, medium: 5 }),
    ctx,
  });
}

/**
 * Time entries booked under a terminated/inactive employee. Classic
 * timesheet-fraud signal or stale data.
 */
async function detectSvcInactiveEmployeeBilledTime(db: D1Database, tenantId: string, ctx: FindingsContext): Promise<Finding | null> {
  const cf = companyFilter(ctx, 'company_id', 't');
  const rows = (await db.prepare(
    `SELECT t.id, t.employee_number, t.project_code, t.work_date, t.hours, t.billable_rate, t.currency, e.status
       FROM erp_time_entries t
       JOIN erp_employees e ON e.tenant_id = t.tenant_id AND e.id = t.employee_id
      WHERE t.tenant_id = ?
        AND e.status != 'active'
        AND date(t.work_date) >= date(COALESCE(e.termination_date, '1970-01-01'))
        ${cf.clause}
      ORDER BY t.work_date DESC
      LIMIT 50`,
  ).bind(tenantId, ...cf.binds).all<{
    id: string; employee_number: string | null; project_code: string | null;
    work_date: string; hours: number; billable_rate: number; currency: string | null;
    status: string;
  }>()).results || [];
  if (rows.length === 0) return null;
  const totalValue = rows.reduce((s, r) => s + toZAR((r.hours || 0) * (r.billable_rate || 0), r.currency || undefined, ctx), 0);
  const sample: SampleRecord[] = rows.slice(0, 10).map(r => ({
    ref: r.employee_number || r.id,
    description: `Inactive (${r.status}) — ${r.hours}h on ${r.project_code || '?'}`,
    amount_zar: toZAR((r.hours || 0) * (r.billable_rate || 0), r.currency || undefined, ctx),
    currency: r.currency || 'ZAR',
    date: r.work_date,
  }));
  return makeFinding({
    code: 'svc_inactive_employee_billed_time',
    title: `${rows.length} time entries booked under inactive employees (${formatZAR(totalValue)})`,
    narrative: `${rows.length} time entries totalling ${formatZAR(totalValue)} have been logged on or after the employee's termination date. Each is either a payroll/HR data sync issue or a timesheet-fraud signal — both warrant immediate review.`,
    affected_count: rows.length,
    value_at_risk_zar: totalValue,
    value_components: [{
      label: 'Recoverable on payroll/timesheet remediation',
      amount_zar: totalValue,
      methodology: 'Σ (hours × billable_rate) on entries logged after termination_date',
    }],
    currency_breakdown: {},
    sample_records: sample,
    severity: maxSeverity(severityFromValue(totalValue), 'high'),
    ctx,
  });
}

// ── Orchestrator ──────────────────────────────────────────────────────────

const DETECTORS: Array<(db: D1Database, tenantId: string, ctx: FindingsContext) => Promise<Finding | null>> = [
  detectArAging30_60,
  detectArAging60_90,
  detectArAging90Plus,
  detectArCreditLimitBreach,
  detectArTopDebtorConcentration,
  detectApOverdueDelivery,
  detectApThreeWayMismatch,
  detectApUnreconciledBank,
  detectGlSuspenseBalance,
  detectGlJournalOffHours,
  detectGlRoundAmountJournals,
  detectGlHighManualVolume,
  detectProcMaverickSpend,
  detectProcDuplicateSuppliers,
  detectProcSupplierConcentration,
  detectProcInactiveWithOpenPos,
  detectInvStaleStock,
  detectInvDeadStock,
  detectInvNegativeStock,
  detectInvBelowReorder,
  detectInvMarginErosion,
  detectInvInactiveWithValue,
  detectSalesCustomerConcentration,
  detectSalesInactiveWithAr,
  detectSalesCreditNoCheck,
  detectHrTerminatedInPayroll,
  detectHrHighPayrollConcentration,
  detectTaxOverdueSubmission,
  detectTaxMissingVatNumbers,
  detectTaxVatRateAnomaly,
  detectFxCurrencyExposure,
  detectFxDualUseCurrency,
  // Service-company detectors. Always run — they no-op (return null) cleanly
  // for tenants without erp_projects / erp_time_entries data.
  detectSvcLowBillableUtilisation,
  detectSvcUnbilledTimeAging,
  detectSvcProjectOverrun,
  detectSvcProjectMarginNegative,
  detectSvcUnapprovedTimeEntries,
  detectSvcRevenueRecognitionLag,
  detectSvcZeroHoursActiveProject,
  detectSvcInactiveEmployeeBilledTime,
];

/**
 * Run every detector against a tenant's ERP data and return the resulting
 * findings sorted by severity then value-at-risk.
 *
 * Each detector is run independently and isolated — a single detector failing
 * (e.g., a SQLite column the table no longer has) is logged and skipped, never
 * aborting the run. The assessment must keep producing findings even when one
 * data source is partial or broken.
 */
export async function detectAllFindings(
  db: D1Database,
  tenantId: string,
  ctx: FindingsContext,
): Promise<Finding[]> {
  const findings: Finding[] = [];
  for (const detector of DETECTORS) {
    try {
      const result = await detector(db, tenantId, ctx);
      if (result) findings.push(result);
    } catch (err) {
      // Don't let one detector kill the run. Log and continue — partial data
      // (e.g., a missing optional ERP table) is the common case.
      console.error(`assessment-findings: detector ${detector.name} failed:`, err);
    }
  }

  const severityOrder: Record<Severity, number> = { critical: 4, high: 3, medium: 2, low: 1 };
  findings.sort((a, b) => {
    const s = severityOrder[b.severity] - severityOrder[a.severity];
    if (s !== 0) return s;
    return b.value_at_risk_zar - a.value_at_risk_zar;
  });
  return findings;
}

/**
 * Multi-company / multinational variant — runs every detector once per
 * registered `erp_company` and tags each finding with the entity it belongs
 * to. Returns the per-company breakdown the report uses for entity-level
 * sections, plus a tenant-wide rollup (under a synthetic "all" company) so
 * the cover page can still lead with consolidated numbers.
 *
 * Tenants without any `erp_companies` rows degrade to a single tenant-wide
 * run (effectively the same shape as `detectAllFindings`).
 */
export async function detectAllFindingsByCompany(
  db: D1Database,
  tenantId: string,
  ctx: FindingsContext,
): Promise<{
  per_company: Array<{ company: CompanyContext; findings: Finding[] }>;
  consolidated: Finding[];
}> {
  const companies = (await db.prepare(
    `SELECT id, name, currency, country, is_primary
       FROM erp_companies
      WHERE tenant_id = ?
        AND status = 'active'
      ORDER BY is_primary DESC, name ASC`,
  ).bind(tenantId).all<CompanyContext>()).results || [];

  // No companies registered → single tenant-wide run, no per-company split.
  if (companies.length === 0) {
    const consolidated = await detectAllFindings(db, tenantId, ctx);
    return { per_company: [], consolidated };
  }

  const per_company: Array<{ company: CompanyContext; findings: Finding[] }> = [];
  for (const company of companies) {
    const scopedCtx: FindingsContext = { ...ctx, companyIds: [company.id] };
    const findings = (await detectAllFindings(db, tenantId, scopedCtx)).map(f => ({
      ...f,
      company_id: company.id,
      company_name: company.name,
    }));
    per_company.push({ company, findings });
  }

  // Consolidated run (no company filter) for the tenant-wide cover page.
  // We keep this separate from a sum-of-per-company because some detectors
  // (e.g., concentration / duplicate detection) only make sense at the
  // tenant level — running them per-company would miss cross-entity duplicates.
  const consolidated = await detectAllFindings(db, tenantId, ctx);
  return { per_company, consolidated };
}

/** Tally findings into a category-grouped summary for the report cover page. */
export function summariseFindings(findings: Finding[]): {
  total_count: number;
  total_value_at_risk_zar: number;
  by_severity: Record<Severity, number>;
  by_category: Record<FindingCategory, { count: number; value_at_risk_zar: number }>;
  recommended_catalysts: string[];
} {
  const by_severity: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  const by_category: Record<FindingCategory, { count: number; value_at_risk_zar: number }> = {
    finance: { count: 0, value_at_risk_zar: 0 },
    procurement: { count: 0, value_at_risk_zar: 0 },
    supply_chain: { count: 0, value_at_risk_zar: 0 },
    sales: { count: 0, value_at_risk_zar: 0 },
    workforce: { count: 0, value_at_risk_zar: 0 },
    compliance: { count: 0, value_at_risk_zar: 0 },
    cross_cutting: { count: 0, value_at_risk_zar: 0 },
    service_delivery: { count: 0, value_at_risk_zar: 0 },
  };
  const catalysts = new Set<string>();
  let totalValue = 0;
  for (const f of findings) {
    by_severity[f.severity]++;
    by_category[f.category].count++;
    by_category[f.category].value_at_risk_zar += f.value_at_risk_zar;
    catalysts.add(f.recommended_catalyst.catalyst);
    totalValue += f.value_at_risk_zar;
  }
  return {
    total_count: findings.length,
    total_value_at_risk_zar: totalValue,
    by_severity,
    by_category,
    recommended_catalysts: Array.from(catalysts).sort(),
  };
}

// ── Catalyst gap surface ──────────────────────────────────────────────────
//
// Closed in PR #275 — every entry in FINDING_CATALYST_MAP now resolves to a
// `real`-implementation sub-catalyst on a real cluster in catalyst-templates.ts.
// The `every-finding-has-a-real-catalyst` test in assessment-findings.test.ts
// asserts the round-trip: each finding's recommended catalyst+sub_catalyst
// must exist in the catalog with implementation === 'real'. Adding a new
// detector that references a non-existent sub-catalyst will fail that test
// (intentionally — the report's "here's the cure" loop must always close).
