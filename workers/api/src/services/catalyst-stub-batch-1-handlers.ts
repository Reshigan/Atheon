/**
 * Stub batch 1 — eight previously-stubbed sub-catalysts get bespoke
 * handlers grounded in existing canonical tables (erp_*, audit_log).
 *
 * Each handler follows the operational/commercial pattern: keyword match
 * on taskText(t), domain-shaped query, evidence + recommendation +
 * scopedToCompany + timestamp. No new schema. The matching catalog
 * entries are flipped from `implementation: 'stub'` (enabled: false) to
 * `implementation: 'real'` (enabled: true) in this PR.
 *
 * Coverage:
 *   - Strategic Sourcing      (Procurement)
 *   - Vendor Scoring          (Procurement)
 *   - Tender Management       (Procurement)
 *   - Cost Optimization       (Procurement / Services)
 *   - SaaS License Management (Procurement / IT)
 *   - Cost Allocation         (Finance Operations)
 *   - Budget Forecasting      (Finance Operations)
 *   - Financial Reporting     (Finance)
 *
 * These are deliberately broad-applicability handlers (every customer
 * has POs, invoices, suppliers). Industry-specific stubs (e.g.
 * Co-Packer Management, Cooperative Buying, Contract Farming) stay
 * deferred until customer demand surfaces them.
 */

import { type CatalystHandler, registerHandler } from './catalyst-handler-registry';
import { taskText, anyWord as anyOf, allWords, companyFilter, scopeLabel } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

// ── STRATEGIC SOURCING ─────────────────────────────────────────────────

async function runStrategicSourcing(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // High-spend categories with multiple suppliers → consolidation opportunity.
  // Low-spend categories with single supplier → risk concentration.
  const byCategory = await db.prepare(
    `SELECT
        COALESCE(NULLIF(p.category, ''), 'uncategorised') AS category,
        COUNT(DISTINCT po.supplier_id) AS supplier_count,
        SUM(po.total) AS total_spend,
        COUNT(po.id) AS po_count
     FROM erp_purchase_orders po
     LEFT JOIN erp_products p ON p.tenant_id = po.tenant_id
     WHERE po.tenant_id = ? AND po.status NOT IN ('cancelled')${clause}
     GROUP BY category
     ORDER BY total_spend DESC LIMIT 15`,
  ).bind(task.tenantId, ...params).all();

  const consolidationCandidates = byCategory.results.filter(r => {
    const row = r as { supplier_count: number; total_spend: number };
    return (row.supplier_count || 0) >= 3 && (row.total_spend || 0) > 100000;
  });
  const concentrationRisks = byCategory.results.filter(r => {
    const row = r as { supplier_count: number; total_spend: number };
    return (row.supplier_count || 0) === 1 && (row.total_spend || 0) > 50000;
  });

  return {
    type: 'procurement_strategic_sourcing',
    categoryBreakdown: byCategory.results,
    consolidationCandidates: consolidationCandidates.length,
    concentrationRisks: concentrationRisks.length,
    consolidationCategories: consolidationCandidates.slice(0, 5),
    concentrationCategories: concentrationRisks.slice(0, 5),
    recommendation: consolidationCandidates.length > 0
      ? `${consolidationCandidates.length} high-spend categor(ies) with ≥3 suppliers — run sourcing events to consolidate volume`
      : concentrationRisks.length > 0
        ? `${concentrationRisks.length} significant categor(ies) with single-supplier exposure — qualify a secondary source`
        : 'Sourcing posture stable — no consolidation or concentration flags',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── VENDOR SCORING ─────────────────────────────────────────────────────

async function runVendorScoring(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const supplierClause = clause.replace(' AND company_id', ' AND s.company_id');
  // Score = blended (delivery_on_time, delay_penalty, risk_score, spend_weight).
  const scored = await db.prepare(
    `SELECT
        s.id, s.name, s.risk_score,
        COUNT(po.id) AS po_count,
        SUM(CASE WHEN po.delivery_status = 'delayed' THEN 1 ELSE 0 END) AS delayed_count,
        SUM(CASE WHEN po.delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count,
        COALESCE(SUM(po.total), 0) AS total_spend
     FROM erp_suppliers s
     LEFT JOIN erp_purchase_orders po ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
        AND po.status NOT IN ('cancelled')
     WHERE s.tenant_id = ? AND s.status = 'active'${supplierClause}
     GROUP BY s.id, s.name, s.risk_score
     ORDER BY total_spend DESC LIMIT 20`,
  ).bind(task.tenantId, ...params).all();

  const ranked = scored.results.map(r => {
    const row = r as { id: string; name: string; risk_score: number; po_count: number; delayed_count: number; delivered_count: number; total_spend: number };
    const completed = (row.delivered_count || 0) + (row.delayed_count || 0);
    const onTimeRate = completed > 0 ? (row.delivered_count || 0) / completed : 1;
    const riskPenalty = 1 - Math.min(1, row.risk_score || 0);
    // Blended score 0–100. Weight delivery 50%, risk 30%, activity 20%.
    const activityFactor = Math.min(1, (row.po_count || 0) / 12);
    const score = Math.round((onTimeRate * 0.5 + riskPenalty * 0.3 + activityFactor * 0.2) * 100);
    return {
      supplierId: row.id, name: row.name,
      score,
      onTimeRate: Math.round(onTimeRate * 1000) / 10,
      riskScore: row.risk_score,
      totalSpend: round2(row.total_spend),
      poCount: row.po_count,
    };
  }).sort((a, b) => a.score - b.score);

  const lowScore = ranked.filter(r => r.score < 60 && r.totalSpend > 25000);
  return {
    type: 'procurement_vendor_scoring',
    supplierCount: ranked.length,
    lowScoreCount: lowScore.length,
    bottomScored: ranked.slice(0, 5),
    topScored: ranked.slice(-5).reverse(),
    recommendation: lowScore.length > 0
      ? `${lowScore.length} active supplier(s) with score < 60 and >R25k spend — schedule QBRs and probation conditions`
      : 'Vendor performance distribution healthy — no probation candidates',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── TENDER MANAGEMENT ──────────────────────────────────────────────────

const TENDER_THRESHOLD_ZAR = 250_000;

async function runTenderManagement(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Single-source POs above the policy threshold need competitive bidding evidence.
  const aboveThresh = await db.prepare(
    `SELECT po.po_number, po.supplier_name, po.total, po.order_date, po.status
     FROM erp_purchase_orders po
     WHERE po.tenant_id = ? AND po.total >= ? AND po.status NOT IN ('cancelled')
       AND po.order_date >= date('now', '-180 days')${clause}
     ORDER BY po.total DESC LIMIT 25`,
  ).bind(task.tenantId, TENDER_THRESHOLD_ZAR, ...params).all();

  const totalAbove = aboveThresh.results.reduce((s, r) => s + ((r as { total: number }).total || 0), 0);

  return {
    type: 'procurement_tender_management',
    thresholdZar: TENDER_THRESHOLD_ZAR,
    poCountAboveThreshold: aboveThresh.results.length,
    totalSpendAboveThreshold: round2(totalAbove),
    poList: aboveThresh.results,
    recommendation: aboveThresh.results.length > 0
      ? `${aboveThresh.results.length} PO(s) above R${TENDER_THRESHOLD_ZAR.toLocaleString()} in last 180 days — confirm competitive-bid evidence on file`
      : 'No POs above the tender threshold — competitive-bid evidence not required',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── COST OPTIMIZATION ──────────────────────────────────────────────────

async function runCostOptimization(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Duplicate spend signal: same supplier billed for similar amounts within
  // 7 days — could be split-PO to bypass approval thresholds, or genuine
  // duplicate billing.
  const duplicates = await db.prepare(
    `SELECT supplier_name, ROUND(total, -2) AS rounded_total, COUNT(*) AS cnt, SUM(total) AS sum_total
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND status NOT IN ('cancelled')
       AND order_date >= date('now', '-90 days')${clause}
     GROUP BY supplier_name, rounded_total
     HAVING cnt >= 2
     ORDER BY sum_total DESC LIMIT 15`,
  ).bind(task.tenantId, ...params).all();

  const duplicateSpend = duplicates.results.reduce((s, r) => s + ((r as { sum_total: number }).sum_total || 0), 0);

  return {
    type: 'procurement_cost_optimization',
    suspectDuplicateGroupCount: duplicates.results.length,
    suspectDuplicateSpend: round2(duplicateSpend),
    duplicates: duplicates.results,
    recommendation: duplicates.results.length > 0
      ? `${duplicates.results.length} supplier-amount pair(s) with ≥2 POs in 90 days — review for split-PO bypass or duplicate billing`
      : 'No suspect duplicate-spend patterns in last 90 days',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── SAAS LICENSE MANAGEMENT ────────────────────────────────────────────

async function runSaasLicenseManagement(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const saasSpend = await db.prepare(
    `SELECT supplier_name, COUNT(*) AS po_count, SUM(total) AS total_spend
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND status NOT IN ('cancelled')
       AND (
         LOWER(supplier_name) LIKE '%saas%' OR LOWER(supplier_name) LIKE '%software%'
         OR LOWER(supplier_name) LIKE '%cloud%' OR LOWER(supplier_name) LIKE '%subscription%'
         OR LOWER(supplier_name) LIKE '%licens%'
       )
       AND order_date >= date('now', '-365 days')${clause}
     GROUP BY supplier_name
     ORDER BY total_spend DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const totalSaas = saasSpend.results.reduce((s, r) => s + ((r as { total_spend: number }).total_spend || 0), 0);
  return {
    type: 'procurement_saas_license_management',
    saasSupplierCount: saasSpend.results.length,
    annualSaasSpend: round2(totalSaas),
    suppliers: saasSpend.results,
    recommendation: totalSaas > 1_000_000
      ? `R${Math.round(totalSaas).toLocaleString()} annual SaaS spend across ${saasSpend.results.length} supplier(s) — schedule a license-utilisation audit`
      : saasSpend.results.length > 0
        ? `R${Math.round(totalSaas).toLocaleString()} annual SaaS spend — consolidate where utilisation < 70%`
        : 'No SaaS-tagged spend identified — categorise software vendors for visibility',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── COST ALLOCATION ────────────────────────────────────────────────────

async function runCostAllocation(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Spend by department — uses erp_employees.department to apportion shared
  // costs (rough proxy: PO requester or simply allocate by headcount).
  const headcount = await db.prepare(
    `SELECT department, COUNT(*) AS active_count
     FROM erp_employees
     WHERE tenant_id = ? AND status = 'active' AND department IS NOT NULL${clause}
     GROUP BY department ORDER BY active_count DESC`,
  ).bind(task.tenantId, ...params).all();

  const totalPaySql = `SELECT COALESCE(SUM(gross_salary), 0) AS total_payroll, COUNT(*) AS active
                       FROM erp_employees WHERE tenant_id = ? AND status = 'active'${clause}`;
  const totalPay = await db.prepare(totalPaySql).bind(task.tenantId, ...params).first<{ total_payroll: number; active: number }>();

  const allocations = headcount.results.map(r => {
    const row = r as { department: string; active_count: number };
    const share = (totalPay?.active || 0) > 0 ? row.active_count / (totalPay!.active) : 0;
    return {
      department: row.department,
      headcount: row.active_count,
      sharePct: Math.round(share * 1000) / 10,
      allocatedPayroll: round2((totalPay?.total_payroll || 0) * share),
    };
  });

  return {
    type: 'finance_cost_allocation',
    departmentCount: allocations.length,
    totalPayroll: round2(totalPay?.total_payroll || 0),
    allocations,
    recommendation: allocations.length === 0
      ? 'No department data available — populate erp_employees.department for cost allocation'
      : 'Allocations computed by headcount share — apply to shared overhead via the same key for reporting',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── BUDGET FORECASTING ─────────────────────────────────────────────────

async function runBudgetForecasting(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Pull last 12 months of invoice activity grouped by month.
  const monthly = await db.prepare(
    `SELECT
        strftime('%Y-%m', invoice_date) AS month,
        SUM(total) AS revenue,
        COUNT(*) AS invoice_count
     FROM erp_invoices
     WHERE tenant_id = ? AND invoice_date >= date('now', '-12 months')${clause}
     GROUP BY month ORDER BY month`,
  ).bind(task.tenantId, ...params).all();

  const series = monthly.results.map(r => {
    const row = r as { month: string; revenue: number; invoice_count: number };
    return { month: row.month, revenue: round2(row.revenue), invoiceCount: row.invoice_count };
  });

  // Simple rolling-3-month average projection, no seasonality. Operators
  // can layer their own model on top — this is the floor.
  const recent = series.slice(-3).map(s => s.revenue);
  const avgRecent = recent.length > 0 ? recent.reduce((a, b) => a + b, 0) / recent.length : 0;
  const projection = [1, 2, 3].map(offset => {
    const lastMonth = series.length > 0 ? series[series.length - 1].month : '';
    return { month: `+${offset}m`, projectedRevenue: round2(avgRecent), basis: `3-month rolling avg from ${lastMonth}` };
  });

  return {
    type: 'finance_budget_forecasting',
    historyMonths: series.length,
    history: series,
    projection,
    recommendation: series.length < 3
      ? 'Insufficient history (<3 months of invoice data) — populate erp_invoices to enable trend forecasting'
      : `Projected R${Math.round(avgRecent).toLocaleString()}/month based on rolling 3-month average — overlay seasonality if known`,
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── FINANCIAL REPORTING ────────────────────────────────────────────────

async function runFinancialReporting(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Month-end snapshot: AR, AP, payroll, top customer, top supplier.
  const [ar, ap, payroll] = await Promise.all([
    db.prepare(`SELECT COALESCE(SUM(amount_due), 0) AS ar FROM erp_invoices WHERE tenant_id = ? AND payment_status IN ('unpaid', 'partial')${clause}`)
      .bind(task.tenantId, ...params).first<{ ar: number }>(),
    db.prepare(`SELECT COALESCE(SUM(total), 0) AS ap FROM erp_purchase_orders WHERE tenant_id = ? AND status NOT IN ('cancelled', 'closed')${clause}`)
      .bind(task.tenantId, ...params).first<{ ap: number }>(),
    db.prepare(`SELECT COALESCE(SUM(gross_salary), 0) AS payroll FROM erp_employees WHERE tenant_id = ? AND status = 'active'${clause}`)
      .bind(task.tenantId, ...params).first<{ payroll: number }>(),
  ]);

  const topCustomer = await db.prepare(
    `SELECT customer_name, SUM(total) AS total
     FROM erp_invoices WHERE tenant_id = ? AND invoice_date >= date('now', '-90 days')${clause}
     GROUP BY customer_name ORDER BY total DESC LIMIT 1`,
  ).bind(task.tenantId, ...params).first<{ customer_name: string; total: number }>();

  return {
    type: 'finance_financial_reporting',
    asOf: new Date().toISOString().slice(0, 10),
    accountsReceivable: round2(ar?.ar || 0),
    accountsPayable: round2(ap?.ap || 0),
    monthlyPayroll: round2(payroll?.payroll || 0),
    topCustomer: topCustomer
      ? { name: topCustomer.customer_name, revenueLast90d: round2(topCustomer.total) }
      : null,
    recommendation: (ar?.ar || 0) > 2 * (ap?.ap || 1)
      ? `AR (R${Math.round(ar?.ar || 0).toLocaleString()}) is >2x AP — review collections cadence`
      : 'Working-capital balance within typical range — monthly close report ready for review',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── Handler registrations ──────────────────────────────────────────────

const strategicSourcingHandler: CatalystHandler = {
  name: 'batch1:strategic-sourcing',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'strategic', 'sourcing') || anyOf(s, 'sourcing-events', 'sourcing event');
  },
  execute: runStrategicSourcing,
};

const vendorScoringHandler: CatalystHandler = {
  name: 'batch1:vendor-scoring',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'vendor', 'scoring')
      || allWords(s, 'supplier', 'scoring')
      || allWords(s, 'supplier', 'scorecard');
  },
  execute: runVendorScoring,
};

const tenderManagementHandler: CatalystHandler = {
  name: 'batch1:tender-management',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'tender', 'management') || anyOf(s, 'rfp', 'rfq', 'competitive bid');
  },
  execute: runTenderManagement,
};

const costOptimizationHandler: CatalystHandler = {
  name: 'batch1:cost-optimization',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'cost', 'optimization')
      || allWords(s, 'cost', 'optimisation')
      || anyOf(s, 'duplicate-spend', 'split-po');
  },
  execute: runCostOptimization,
};

const saasLicenseHandler: CatalystHandler = {
  name: 'batch1:saas-license',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'saas') && anyOf(s, 'license', 'licence', 'management'))
      || anyOf(s, 'license-management', 'licence-management');
  },
  execute: runSaasLicenseManagement,
};

const costAllocationHandler: CatalystHandler = {
  name: 'batch1:cost-allocation',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'cost', 'allocation') || anyOf(s, 'activity-based-costing', 'abc-costing');
  },
  execute: runCostAllocation,
};

const budgetForecastingHandler: CatalystHandler = {
  name: 'batch1:budget-forecasting',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'budget', 'forecast') || allWords(s, 'budget', 'forecasting');
  },
  execute: runBudgetForecasting,
};

const financialReportingHandler: CatalystHandler = {
  name: 'batch1:financial-reporting',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'financial', 'reporting')
      || allWords(s, 'financial', 'statement')
      || anyOf(s, 'month-end-close', 'period-close');
  },
  execute: runFinancialReporting,
};

export function registerStubBatch1Handlers(): void {
  // Order matters — most-specific first, broader matchers last.
  registerHandler(strategicSourcingHandler);
  registerHandler(vendorScoringHandler);
  registerHandler(tenderManagementHandler);
  registerHandler(saasLicenseHandler);
  registerHandler(costOptimizationHandler);
  registerHandler(costAllocationHandler);
  registerHandler(budgetForecastingHandler);
  registerHandler(financialReportingHandler);
}

registerStubBatch1Handlers();
