// workers/api/src/services/assessment-engine.ts
// Pre-Assessment Tool — Data collection, catalyst scoring, report generation

// ── Types ─────────────────────────────────────────────────────────────────
export interface AssessmentConfig {
  // Atheon Pricing
  saas_price_per_user_pm: number;
  onprem_licence_fee_pa: number;
  hybrid_licence_fee_pa: number;
  // Infrastructure Cost (SaaS — Cloudflare)
  cf_cost_per_1m_api_calls: number;
  cf_d1_cost_per_gb_pm: number;
  cf_r2_cost_per_gb_pm: number;
  cf_vectorize_cost_per_1m_queries: number;
  cf_workers_ai_cost_per_1m_tokens: number;
  cf_kv_cost_per_1m_reads: number;
  cf_base_pm: number;
  // Infrastructure Cost (On-Premise)
  onprem_support_cost_pa: number;
  onprem_update_cost_pa: number;
  // Catalyst Savings Benchmarks
  ar_savings_pct: number;
  ap_savings_pct: number;
  invoice_recon_savings_pct: number;
  procurement_savings_pct: number;
  workforce_savings_pct: number;
  supply_chain_savings_pct: number;
  compliance_fine_avoidance_pct: number;
  maintenance_savings_pct: number;
  // Deployment target
  deployment_model: 'saas' | 'hybrid' | 'on-premise';
  currency: 'ZAR' | 'USD' | 'EUR';
  exchange_rate_to_zar: number;
  target_users: number;
  contract_years: number;
}

export interface VolumeSnapshot {
  monthly_invoices: number;
  monthly_purchase_orders: number;
  monthly_journal_entries: number;
  monthly_bank_transactions: number;
  total_ar_balance: number;
  total_ap_balance: number;
  overdue_invoice_count: number;
  overdue_invoice_value: number;
  avg_invoice_value: number;
  total_revenue_12m: number;
  total_spend_12m: number;
  employee_count: number;
  total_monthly_payroll: number;
  active_customer_count: number;
  active_supplier_count: number;
  product_count: number;
  total_inventory_value: number;
  months_of_data: number;
  data_completeness_pct: number;
  erp_system: string;
  snapshot_date: string;
}

export interface SubCatalystScore {
  name: string;
  recommended: boolean;
  priority_within_cluster: number;
  estimated_monthly_volume: number;
  volume_unit: string;
  estimated_monthly_api_calls: number;
  estimated_monthly_llm_tokens: number;
  estimated_annual_saving_zar: number;
  deploy_prerequisite?: string;
}

export interface CatalystScore {
  catalyst_name: string;
  domain: string;
  priority: number;
  deploy_order: number;
  estimated_annual_saving_zar: number;
  saving_components: {
    label: string;
    amount_zar: number;
    methodology: string;
  }[];
  data_insights: string[];
  confidence: 'high' | 'medium' | 'low';
  sub_catalysts: SubCatalystScore[];
  estimated_monthly_api_calls: number;
  estimated_monthly_vector_queries: number;
  estimated_monthly_llm_tokens: number;
  estimated_db_size_mb: number;
}

export interface TechnicalSizing {
  total_monthly_api_calls: number;
  total_monthly_vector_queries: number;
  total_monthly_llm_tokens: number;
  total_db_size_gb: number;
  total_storage_gb: number;
  total_kv_reads_monthly: number;
  cost_cf_workers: number;
  cost_cf_d1: number;
  cost_cf_vectorize: number;
  cost_cf_workers_ai: number;
  cost_cf_r2: number;
  cost_cf_kv: number;
  total_infra_cost_pm_saas: number;
  total_infra_cost_pm_onprem: number;
  monthly_licence_revenue: number;
  annual_licence_revenue: number;
  gross_margin_pm_saas: number;
  gross_margin_pct_saas: number;
  gross_margin_pm_onprem: number;
  gross_margin_pct_onprem: number;
  catalyst_sizing: Array<{
    catalyst_name: string;
    sub_catalysts: Array<{
      name: string;
      monthly_api_calls: number;
      monthly_llm_tokens: number;
      monthly_vector_queries: number;
      cost_pm_zar: number;
    }>;
    total_cost_pm_zar: number;
  }>;
}

export interface AssessmentResults {
  catalyst_scores: CatalystScore[];
  technical_sizing: TechnicalSizing;
  total_estimated_annual_saving_zar: number;
  payback_months: number;
  narrative_summary: string;
}

export const DEFAULT_ASSESSMENT_CONFIG: AssessmentConfig = {
  saas_price_per_user_pm: 450,
  onprem_licence_fee_pa: 360000,
  hybrid_licence_fee_pa: 180000,
  cf_cost_per_1m_api_calls: 750,
  cf_d1_cost_per_gb_pm: 7.50,
  cf_r2_cost_per_gb_pm: 2.25,
  cf_vectorize_cost_per_1m_queries: 37.50,
  cf_workers_ai_cost_per_1m_tokens: 112.50,
  cf_kv_cost_per_1m_reads: 3.75,
  cf_base_pm: 375,
  onprem_support_cost_pa: 120000,
  onprem_update_cost_pa: 48000,
  ar_savings_pct: 0.8,
  ap_savings_pct: 0.5,
  invoice_recon_savings_pct: 1.2,
  procurement_savings_pct: 3.0,
  workforce_savings_pct: 2.5,
  supply_chain_savings_pct: 1.8,
  compliance_fine_avoidance_pct: 0.3,
  maintenance_savings_pct: 4.0,
  deployment_model: 'saas',
  currency: 'ZAR',
  exchange_rate_to_zar: 1.0,
  target_users: 20,
  contract_years: 3,
};

// ── Data Collection ───────────────────────────────────────────────────────
export async function collectVolumeSnapshot(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string
): Promise<VolumeSnapshot> {
  // Determine source_system from the ERP connection
  let erpSystem = 'unknown';
  try {
    const conn = await db.prepare(
      'SELECT ea.system FROM erp_connections ec JOIN erp_adapters ea ON ec.adapter_id = ea.id WHERE ec.id = ?'
    ).bind(erpConnectionId).first<{ system: string }>();
    if (conn) erpSystem = conn.system;
  } catch (err) { console.error('collectVolumeSnapshot: erp_system lookup failed:', err); }

  // Helper to safely query a single numeric value
  async function queryNum(sql: string, binds: unknown[]): Promise<number> {
    try {
      const r = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>();
      const val = r ? Object.values(r)[0] : 0;
      return typeof val === 'number' ? val : Number(val) || 0;
    } catch { return 0; }
  }

  // Calculate months of data
  const monthsOfData = await queryNum(
    "SELECT CAST((julianday('now') - julianday(MIN(invoice_date))) / 30 AS INTEGER) FROM erp_invoices WHERE tenant_id = ?",
    [tenantId]
  ) || 1;

  const monthDiv = Math.max(monthsOfData, 1);

  const [
    totalInvoices, totalPOs, totalJournals, totalBankTxns,
    totalArBalance, totalApBalance, overdueCount, overdueValue,
    avgInvoiceValue, totalRevenue12m, totalSpend12m,
    employeeCount, totalMonthlyPayroll,
    activeCustomers, activeSuppliers,
    productCount, totalInventoryValue
  ] = await Promise.all([
    queryNum('SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ?', [tenantId]),
    queryNum('SELECT COUNT(*) FROM erp_purchase_orders WHERE tenant_id = ?', [tenantId]),
    queryNum('SELECT COUNT(*) FROM erp_journal_entries WHERE tenant_id = ?', [tenantId]),
    queryNum('SELECT COUNT(*) FROM erp_bank_transactions WHERE tenant_id = ?', [tenantId]),
    queryNum("SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND payment_status != 'paid'", [tenantId]),
    queryNum("SELECT COALESCE(SUM(total), 0) FROM erp_purchase_orders WHERE tenant_id = ? AND status = 'open'", [tenantId]),
    queryNum("SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'", [tenantId]),
    queryNum("SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'", [tenantId]),
    queryNum('SELECT COALESCE(AVG(total), 0) FROM erp_invoices WHERE tenant_id = ?', [tenantId]),
    queryNum("SELECT COALESCE(SUM(total), 0) FROM erp_invoices WHERE tenant_id = ? AND invoice_date >= datetime('now', '-12 months')", [tenantId]),
    queryNum("SELECT COALESCE(SUM(total), 0) FROM erp_purchase_orders WHERE tenant_id = ? AND order_date >= datetime('now', '-12 months')", [tenantId]),
    queryNum("SELECT COUNT(*) FROM erp_employees WHERE tenant_id = ? AND status = 'active'", [tenantId]),
    queryNum("SELECT COALESCE(SUM(gross_salary), 0) FROM erp_employees WHERE tenant_id = ? AND salary_frequency = 'monthly' AND status = 'active'", [tenantId]),
    queryNum("SELECT COUNT(*) FROM erp_customers WHERE tenant_id = ? AND status = 'active'", [tenantId]),
    queryNum("SELECT COUNT(*) FROM erp_suppliers WHERE tenant_id = ? AND status = 'active'", [tenantId]),
    queryNum('SELECT COUNT(*) FROM erp_products WHERE tenant_id = ? AND is_active = 1', [tenantId]),
    queryNum('SELECT COALESCE(SUM(stock_on_hand * cost_price), 0) FROM erp_products WHERE tenant_id = ? AND is_active = 1', [tenantId]),
  ]);

  // Data completeness scoring
  const keyFields = [totalRevenue12m, totalSpend12m, employeeCount, activeCustomers, activeSuppliers, productCount, monthsOfData];
  const nonNullCount = keyFields.filter(v => v > 0).length;
  const dataCompletenessPct = Math.round((nonNullCount / keyFields.length) * 100);

  return {
    monthly_invoices: Math.round(totalInvoices / monthDiv),
    monthly_purchase_orders: Math.round(totalPOs / monthDiv),
    monthly_journal_entries: Math.round(totalJournals / monthDiv),
    monthly_bank_transactions: Math.round(totalBankTxns / monthDiv),
    total_ar_balance: totalArBalance,
    total_ap_balance: totalApBalance,
    overdue_invoice_count: overdueCount,
    overdue_invoice_value: overdueValue,
    avg_invoice_value: Math.round(avgInvoiceValue),
    total_revenue_12m: totalRevenue12m,
    total_spend_12m: totalSpend12m,
    employee_count: employeeCount,
    total_monthly_payroll: totalMonthlyPayroll,
    active_customer_count: activeCustomers,
    active_supplier_count: activeSuppliers,
    product_count: productCount,
    total_inventory_value: totalInventoryValue,
    months_of_data: monthsOfData,
    data_completeness_pct: dataCompletenessPct,
    erp_system: erpSystem,
    snapshot_date: new Date().toISOString(),
  };
}

// ── Catalyst Scoring ──────────────────────────────────────────────────────
function getConfidence(monthsOfData: number): 'high' | 'medium' | 'low' {
  if (monthsOfData >= 6) return 'high';
  if (monthsOfData >= 3) return 'medium';
  return 'low';
}

function downgradeConfidence(c: 'high' | 'medium' | 'low'): 'high' | 'medium' | 'low' {
  if (c === 'high') return 'medium';
  if (c === 'medium') return 'low';
  return 'low';
}

const confidenceMultiplier = { high: 1.0, medium: 0.7, low: 0.4 };

const domainOrder: Record<string, number> = {
  finance: 1, procurement: 2, supply_chain: 3, workforce: 4, sales: 5, compliance: 6, maintenance: 7,
};

export function scoreCatalysts(
  snapshot: VolumeSnapshot,
  config: AssessmentConfig,
  _prospectIndustry: string // eslint-disable-line @typescript-eslint/no-unused-vars
): CatalystScore[] {
  const baseConfidence = getConfidence(snapshot.months_of_data);
  const confidence = snapshot.data_completeness_pct < 40 ? downgradeConfidence(baseConfidence) : baseConfidence;

  const catalysts: CatalystScore[] = [];

  // ── FINANCE CATALYST ──────────────────────────────────────────
  if (snapshot.total_ar_balance > 0 || snapshot.monthly_invoices > 0) {
    const arSaving = snapshot.total_ar_balance * config.ar_savings_pct / 100;
    const apSaving = (snapshot.monthly_purchase_orders * 12 * snapshot.avg_invoice_value * 0.4) * config.ap_savings_pct / 100;
    const reconSaving = snapshot.total_spend_12m * config.invoice_recon_savings_pct / 100;
    const totalSaving = arSaving + apSaving + reconSaving;

    const insights: string[] = [];
    if (snapshot.overdue_invoice_count > 50) insights.push(`${snapshot.overdue_invoice_count} overdue invoices detected — high priority for AR automation`);
    else if (snapshot.overdue_invoice_count > 20) insights.push(`${snapshot.overdue_invoice_count} overdue invoices — moderate AR risk`);
    if (snapshot.total_ar_balance > 0) insights.push(`R ${formatZAR(snapshot.total_ar_balance)} outstanding AR balance — faster collection could recover R ${formatZAR(arSaving)}/year`);
    if (snapshot.monthly_purchase_orders > 0) insights.push(`${snapshot.monthly_purchase_orders} POs/month — AP automation saves R ${formatZAR(apSaving)}/year`);

    const apiCalls = snapshot.monthly_invoices * 150;
    const llmTokens = snapshot.monthly_invoices * 500;

    catalysts.push({
      catalyst_name: 'Finance',
      domain: 'finance',
      priority: 0,
      deploy_order: 0,
      estimated_annual_saving_zar: totalSaving,
      saving_components: [
        { label: 'Faster AR collection', amount_zar: arSaving, methodology: `AR balance × ${config.ar_savings_pct}% recovery rate` },
        { label: 'AP automation', amount_zar: apSaving, methodology: `PO volume × avg invoice × 40% touchable × ${config.ap_savings_pct}% saving` },
        { label: '3-way invoice reconciliation', amount_zar: reconSaving, methodology: `Total spend × ${config.invoice_recon_savings_pct}% saving` },
      ],
      data_insights: insights,
      confidence,
      sub_catalysts: [
        { name: 'AR Collection', recommended: snapshot.total_ar_balance > 0, priority_within_cluster: 1, estimated_monthly_volume: snapshot.monthly_invoices, volume_unit: 'invoices', estimated_monthly_api_calls: snapshot.monthly_invoices * 80, estimated_monthly_llm_tokens: snapshot.monthly_invoices * 200, estimated_annual_saving_zar: arSaving },
        { name: 'AP Processing', recommended: snapshot.monthly_purchase_orders > 0, priority_within_cluster: 2, estimated_monthly_volume: snapshot.monthly_purchase_orders, volume_unit: 'POs', estimated_monthly_api_calls: snapshot.monthly_purchase_orders * 60, estimated_monthly_llm_tokens: snapshot.monthly_purchase_orders * 150, estimated_annual_saving_zar: apSaving },
        { name: 'Invoice Reconciliation', recommended: snapshot.monthly_invoices > 10, priority_within_cluster: 3, estimated_monthly_volume: snapshot.monthly_invoices, volume_unit: 'invoices', estimated_monthly_api_calls: apiCalls, estimated_monthly_llm_tokens: llmTokens, estimated_annual_saving_zar: reconSaving, deploy_prerequisite: 'AR Collection' },
      ],
      estimated_monthly_api_calls: apiCalls + snapshot.monthly_invoices * 80 + snapshot.monthly_purchase_orders * 60,
      estimated_monthly_vector_queries: Math.round(snapshot.monthly_invoices * 20),
      estimated_monthly_llm_tokens: llmTokens + snapshot.monthly_invoices * 200 + snapshot.monthly_purchase_orders * 150,
      estimated_db_size_mb: Math.round((snapshot.monthly_invoices * 12 * 2) / 1024),
    });
  }

  // ── PROCUREMENT CATALYST ──────────────────────────────────────
  if (snapshot.active_supplier_count > 0 || snapshot.total_spend_12m > 0) {
    const supplierSaving = snapshot.total_spend_12m * config.procurement_savings_pct / 100;
    const poAutomationSaving = snapshot.monthly_purchase_orders * 12 * 180;
    const totalSaving = supplierSaving + poAutomationSaving;

    const insights: string[] = [];
    if (snapshot.active_supplier_count > 20) insights.push(`${snapshot.active_supplier_count} active suppliers — high potential for supplier scoring and consolidation`);
    if (snapshot.total_spend_12m > 500000) insights.push(`R ${formatZAR(snapshot.total_spend_12m)} annual spend — ${config.procurement_savings_pct}% saving = R ${formatZAR(supplierSaving)}`);
    if (snapshot.monthly_purchase_orders > 50) insights.push(`${snapshot.monthly_purchase_orders} POs/month — automation saves R ${formatZAR(poAutomationSaving)}/year at R180/manual PO`);

    catalysts.push({
      catalyst_name: 'Procurement',
      domain: 'procurement',
      priority: 0,
      deploy_order: 0,
      estimated_annual_saving_zar: totalSaving,
      saving_components: [
        { label: 'Supplier scoring & consolidation', amount_zar: supplierSaving, methodology: `Total spend × ${config.procurement_savings_pct}% saving` },
        { label: 'PO automation', amount_zar: poAutomationSaving, methodology: `${snapshot.monthly_purchase_orders} POs/month × 12 × R180 FTE cost/PO` },
      ],
      data_insights: insights,
      confidence,
      sub_catalysts: [
        { name: 'Supplier Scoring', recommended: snapshot.active_supplier_count > 5, priority_within_cluster: 1, estimated_monthly_volume: snapshot.active_supplier_count, volume_unit: 'suppliers', estimated_monthly_api_calls: snapshot.active_supplier_count * 50, estimated_monthly_llm_tokens: snapshot.active_supplier_count * 200, estimated_annual_saving_zar: supplierSaving },
        { name: 'PO Automation', recommended: snapshot.monthly_purchase_orders > 10, priority_within_cluster: 2, estimated_monthly_volume: snapshot.monthly_purchase_orders, volume_unit: 'POs', estimated_monthly_api_calls: snapshot.monthly_purchase_orders * 40, estimated_monthly_llm_tokens: snapshot.monthly_purchase_orders * 100, estimated_annual_saving_zar: poAutomationSaving, deploy_prerequisite: 'Supplier Scoring' },
      ],
      estimated_monthly_api_calls: snapshot.active_supplier_count * 50 + snapshot.monthly_purchase_orders * 40,
      estimated_monthly_vector_queries: Math.round(snapshot.active_supplier_count * 10),
      estimated_monthly_llm_tokens: snapshot.active_supplier_count * 200 + snapshot.monthly_purchase_orders * 100,
      estimated_db_size_mb: Math.round((snapshot.active_supplier_count * 5) / 1024) + 1,
    });
  }

  // ── WORKFORCE CATALYST ────────────────────────────────────────
  if (snapshot.employee_count > 0) {
    const shiftSaving = snapshot.total_monthly_payroll * config.workforce_savings_pct / 100 * 12;

    const insights: string[] = [];
    if (snapshot.employee_count > 50) insights.push(`${snapshot.employee_count} employees — high priority for shift scheduling optimisation`);
    else if (snapshot.employee_count > 20) insights.push(`${snapshot.employee_count} employees — moderate workforce optimisation potential`);
    insights.push(`Monthly payroll R ${formatZAR(snapshot.total_monthly_payroll)} — ${config.workforce_savings_pct}% saving = R ${formatZAR(shiftSaving)}/year`);

    catalysts.push({
      catalyst_name: 'Workforce',
      domain: 'workforce',
      priority: 0,
      deploy_order: 0,
      estimated_annual_saving_zar: shiftSaving,
      saving_components: [
        { label: 'Shift scheduling optimisation', amount_zar: shiftSaving, methodology: `Monthly payroll × ${config.workforce_savings_pct}% × 12 months` },
      ],
      data_insights: insights,
      confidence,
      sub_catalysts: [
        { name: 'Shift Scheduling', recommended: snapshot.employee_count > 10, priority_within_cluster: 1, estimated_monthly_volume: snapshot.employee_count, volume_unit: 'employees', estimated_monthly_api_calls: snapshot.employee_count * 30, estimated_monthly_llm_tokens: snapshot.employee_count * 50, estimated_annual_saving_zar: shiftSaving },
      ],
      estimated_monthly_api_calls: snapshot.employee_count * 30,
      estimated_monthly_vector_queries: Math.round(snapshot.employee_count * 5),
      estimated_monthly_llm_tokens: snapshot.employee_count * 50,
      estimated_db_size_mb: Math.round((snapshot.employee_count * 2) / 1024) + 1,
    });
  }

  // ── SUPPLY CHAIN CATALYST ─────────────────────────────────────
  if (snapshot.product_count > 0 || snapshot.total_inventory_value > 0) {
    const inventorySaving = snapshot.total_inventory_value * config.supply_chain_savings_pct / 100;
    const demandSaving = snapshot.total_revenue_12m * 0.5 / 100;
    const totalSaving = inventorySaving + demandSaving;

    const insights: string[] = [];
    if (snapshot.product_count > 100) insights.push(`${snapshot.product_count} products — high potential for demand forecasting`);
    if (snapshot.total_inventory_value > 1000000) insights.push(`R ${formatZAR(snapshot.total_inventory_value)} inventory — ${config.supply_chain_savings_pct}% optimisation = R ${formatZAR(inventorySaving)}/year`);

    catalysts.push({
      catalyst_name: 'Supply Chain',
      domain: 'supply_chain',
      priority: 0,
      deploy_order: 0,
      estimated_annual_saving_zar: totalSaving,
      saving_components: [
        { label: 'Inventory optimisation', amount_zar: inventorySaving, methodology: `Inventory value × ${config.supply_chain_savings_pct}% saving` },
        { label: 'Demand forecasting uplift', amount_zar: demandSaving, methodology: `Revenue × 0.5% fill rate uplift` },
      ],
      data_insights: insights,
      confidence,
      sub_catalysts: [
        { name: 'Inventory Optimisation', recommended: snapshot.total_inventory_value > 0, priority_within_cluster: 1, estimated_monthly_volume: snapshot.product_count, volume_unit: 'products', estimated_monthly_api_calls: snapshot.product_count * 10, estimated_monthly_llm_tokens: snapshot.product_count * 30, estimated_annual_saving_zar: inventorySaving },
        { name: 'Demand Forecasting', recommended: snapshot.product_count > 20, priority_within_cluster: 2, estimated_monthly_volume: snapshot.product_count, volume_unit: 'products', estimated_monthly_api_calls: snapshot.product_count * 20 * 30, estimated_monthly_llm_tokens: snapshot.product_count * 50, estimated_annual_saving_zar: demandSaving, deploy_prerequisite: 'Inventory Optimisation' },
      ],
      estimated_monthly_api_calls: snapshot.product_count * 10 + snapshot.product_count * 20 * 30,
      estimated_monthly_vector_queries: Math.round(snapshot.product_count * 5),
      estimated_monthly_llm_tokens: snapshot.product_count * 30 + snapshot.product_count * 50,
      estimated_db_size_mb: Math.round((snapshot.product_count * 3) / 1024) + 1,
    });
  }

  // ── SALES CATALYST ────────────────────────────────────────────
  if (snapshot.active_customer_count > 0 || snapshot.monthly_invoices > 0) {
    const orderMgmtSaving = snapshot.monthly_invoices * 12 * 90;

    const insights: string[] = [];
    if (snapshot.monthly_invoices > 200) insights.push(`${snapshot.monthly_invoices} invoices/month — high volume for order management automation`);
    if (snapshot.active_customer_count > 30) insights.push(`${snapshot.active_customer_count} active customers — order automation saves R ${formatZAR(orderMgmtSaving)}/year`);

    catalysts.push({
      catalyst_name: 'Sales',
      domain: 'sales',
      priority: 0,
      deploy_order: 0,
      estimated_annual_saving_zar: orderMgmtSaving,
      saving_components: [
        { label: 'Order management automation', amount_zar: orderMgmtSaving, methodology: `${snapshot.monthly_invoices} invoices/month × 12 × R90 per manual order touch` },
      ],
      data_insights: insights,
      confidence,
      sub_catalysts: [
        { name: 'Order Management', recommended: snapshot.monthly_invoices > 10, priority_within_cluster: 1, estimated_monthly_volume: snapshot.monthly_invoices, volume_unit: 'invoices', estimated_monthly_api_calls: snapshot.monthly_invoices * 80, estimated_monthly_llm_tokens: snapshot.monthly_invoices * 100, estimated_annual_saving_zar: orderMgmtSaving },
      ],
      estimated_monthly_api_calls: snapshot.monthly_invoices * 80,
      estimated_monthly_vector_queries: Math.round(snapshot.monthly_invoices * 10),
      estimated_monthly_llm_tokens: snapshot.monthly_invoices * 100,
      estimated_db_size_mb: Math.round((snapshot.monthly_invoices * 12) / 1024) + 1,
    });
  }

  // ── Sort by (saving × confidence multiplier) DESC, then domain order ──
  catalysts.sort((a, b) => {
    const scoreA = a.estimated_annual_saving_zar * confidenceMultiplier[a.confidence];
    const scoreB = b.estimated_annual_saving_zar * confidenceMultiplier[b.confidence];
    if (scoreA !== scoreB) return scoreB - scoreA;
    return (domainOrder[a.domain] || 99) - (domainOrder[b.domain] || 99);
  });

  // Assign priority and deploy_order
  catalysts.forEach((cat, idx) => {
    cat.priority = idx + 1;
    cat.deploy_order = idx + 1;
  });

  return catalysts;
}

// ── Technical Sizing ──────────────────────────────────────────────────────
export function calculateTechnicalSizing(
  catalystScores: CatalystScore[],
  config: AssessmentConfig
): TechnicalSizing {
  const totalApiCalls = catalystScores.reduce((s, c) => s + c.estimated_monthly_api_calls, 0);
  const totalVectorQueries = catalystScores.reduce((s, c) => s + c.estimated_monthly_vector_queries, 0);
  const totalLlmTokens = catalystScores.reduce((s, c) => s + c.estimated_monthly_llm_tokens, 0);
  const totalDbSizeMb = catalystScores.reduce((s, c) => s + c.estimated_db_size_mb, 0);
  const totalDbSizeGb = totalDbSizeMb / 1024;
  const totalStorageGb = totalDbSizeGb + 1; // 1GB overhead for R2/MinIO
  const totalKvReads = totalApiCalls * 0.3; // ~30% of API calls hit KV

  // SaaS cost breakdown
  const costWorkers = config.cf_base_pm + (totalApiCalls / 1_000_000) * config.cf_cost_per_1m_api_calls;
  const costD1 = totalDbSizeGb * config.cf_d1_cost_per_gb_pm;
  const costVectorize = (totalVectorQueries / 1_000_000) * config.cf_vectorize_cost_per_1m_queries;
  const costWorkersAi = (totalLlmTokens / 1_000_000) * config.cf_workers_ai_cost_per_1m_tokens;
  const costR2 = totalStorageGb * config.cf_r2_cost_per_gb_pm;
  const costKv = (totalKvReads / 1_000_000) * config.cf_kv_cost_per_1m_reads;
  const totalInfraSaas = costWorkers + costD1 + costVectorize + costWorkersAi + costR2 + costKv;

  // On-premise cost
  const totalInfraOnprem = (config.onprem_support_cost_pa + config.onprem_update_cost_pa) / 12;

  // Revenue
  const monthlyRevenue = config.saas_price_per_user_pm * config.target_users;
  const annualRevenue = monthlyRevenue * 12;

  // Margins
  const marginSaas = monthlyRevenue - totalInfraSaas;
  const marginPctSaas = monthlyRevenue > 0 ? (marginSaas / monthlyRevenue) * 100 : 0;
  const marginOnprem = (config.onprem_licence_fee_pa / 12) - totalInfraOnprem;
  const marginPctOnprem = config.onprem_licence_fee_pa > 0 ? (marginOnprem / (config.onprem_licence_fee_pa / 12)) * 100 : 0;

  // Per-catalyst breakdown
  const catalystSizing = catalystScores.map(cat => ({
    catalyst_name: cat.catalyst_name,
    sub_catalysts: cat.sub_catalysts.map(sc => {
      const apiCost = (sc.estimated_monthly_api_calls / 1_000_000) * config.cf_cost_per_1m_api_calls;
      const llmCost = (sc.estimated_monthly_llm_tokens / 1_000_000) * config.cf_workers_ai_cost_per_1m_tokens;
      return {
        name: sc.name,
        monthly_api_calls: sc.estimated_monthly_api_calls,
        monthly_llm_tokens: sc.estimated_monthly_llm_tokens,
        monthly_vector_queries: 0,
        cost_pm_zar: Math.round((apiCost + llmCost) * 100) / 100,
      };
    }),
    total_cost_pm_zar: 0,
  }));

  // Fill totals
  catalystSizing.forEach(cs => {
    cs.total_cost_pm_zar = Math.round(cs.sub_catalysts.reduce((s, sc) => s + sc.cost_pm_zar, 0) * 100) / 100;
  });

  return {
    total_monthly_api_calls: totalApiCalls,
    total_monthly_vector_queries: totalVectorQueries,
    total_monthly_llm_tokens: totalLlmTokens,
    total_db_size_gb: Math.round(totalDbSizeGb * 100) / 100,
    total_storage_gb: Math.round(totalStorageGb * 100) / 100,
    total_kv_reads_monthly: Math.round(totalKvReads),
    cost_cf_workers: Math.round(costWorkers * 100) / 100,
    cost_cf_d1: Math.round(costD1 * 100) / 100,
    cost_cf_vectorize: Math.round(costVectorize * 100) / 100,
    cost_cf_workers_ai: Math.round(costWorkersAi * 100) / 100,
    cost_cf_r2: Math.round(costR2 * 100) / 100,
    cost_cf_kv: Math.round(costKv * 100) / 100,
    total_infra_cost_pm_saas: Math.round(totalInfraSaas * 100) / 100,
    total_infra_cost_pm_onprem: Math.round(totalInfraOnprem * 100) / 100,
    monthly_licence_revenue: monthlyRevenue,
    annual_licence_revenue: annualRevenue,
    gross_margin_pm_saas: Math.round(marginSaas * 100) / 100,
    gross_margin_pct_saas: Math.round(marginPctSaas * 10) / 10,
    gross_margin_pm_onprem: Math.round(marginOnprem * 100) / 100,
    gross_margin_pct_onprem: Math.round(marginPctOnprem * 10) / 10,
    catalyst_sizing: catalystSizing,
  };
}

// ── Report Generation (PDF + Excel) ───────────────────────────────────────

function formatZAR(amount: number): string {
  return new Intl.NumberFormat('en-ZA', { maximumFractionDigits: 0 }).format(Math.round(amount));
}

export function formatCurrency(amount: number, currency: string, exchangeRate: number): string {
  if (currency === 'ZAR') return `R ${formatZAR(amount)}`;
  const converted = amount / exchangeRate;
  if (currency === 'USD') return `$ ${formatZAR(converted)}`;
  if (currency === 'EUR') return `€ ${formatZAR(converted)}`;
  return `R ${formatZAR(amount)}`;
}

// Business Case Report PDF generation
export async function generateBusinessReportPDF(
  scores: CatalystScore[],
  sizing: TechnicalSizing,
  config: AssessmentConfig,
  prospectName: string,
  narrativeSummary: string,
  snapshot: VolumeSnapshot
): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Colour palette ──
  const navy  = [27, 58, 107] as const;   // #1B3A6B
  const teal  = [0, 150, 136] as const;   // #009688
  const gold  = [255, 179, 0] as const;   // #FFB300
  const slate = [55, 71, 79] as const;    // #37474F
  const lightBg = [245, 248, 255] as const; // #F5F8FF
  const white = [255, 255, 255] as const;

  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const annualLicence = config.deployment_model === 'saas'
    ? sizing.annual_licence_revenue
    : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  // Helper: page header bar
  function pageHeader(title: string) {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 18, 'F');
    // Accent line
    doc.setFillColor(...teal);
    doc.rect(0, 18, pageW, 1.5, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(13);
    doc.text(title, 14, 12);
    // Page number
    doc.setFontSize(7);
    doc.text(`${prospectName} | Confidential`, pageW - 14, 12, { align: 'right' });
  }

  // Helper: footer
  function pageFooter() {
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text('Prepared by GONXT Technology | Atheon Intelligence Platform', 14, pageH - 8);
    doc.text(`Generated ${new Date().toLocaleDateString('en-ZA')}`, pageW - 14, pageH - 8, { align: 'right' });
  }

  // ═══════════════════════════════════════════════
  // PAGE 1 — Cover
  // ═══════════════════════════════════════════════
  // Full-page navy background
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Accent stripe
  doc.setFillColor(...teal);
  doc.rect(0, 85, pageW, 3, 'F');

  // Logo area
  doc.setTextColor(...white);
  doc.setFontSize(42);
  doc.text('ATHEON', pageW / 2, 50, { align: 'center' });
  doc.setFontSize(11);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 62, { align: 'center' });

  // Gold accent line
  doc.setFillColor(...gold);
  doc.rect(pageW / 2 - 30, 68, 60, 0.8, 'F');

  // Title block
  doc.setFontSize(20);
  doc.text('AI Catalyst Assessment', pageW / 2, 105, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Business Case & Value Proposition', pageW / 2, 115, { align: 'center' });

  // Client name
  doc.setFillColor(255, 255, 255, 0.1 as never);
  doc.setFontSize(16);
  doc.text(prospectName, pageW / 2, 140, { align: 'center' });

  // Meta info
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 160, { align: 'center' });
  doc.text(`ERP System: ${snapshot.erp_system}`, pageW / 2, 168, { align: 'center' });
  doc.text(`Data Period: ${snapshot.months_of_data} months of transaction data`, pageW / 2, 176, { align: 'center' });
  doc.text('CONFIDENTIAL — For Authorised Recipients Only', pageW / 2, 190, { align: 'center' });

  // Bottom accent
  doc.setFillColor(...gold);
  doc.rect(0, pageH - 12, pageW, 12, 'F');
  doc.setTextColor(...navy);
  doc.setFontSize(8);
  doc.text('GONXT Technology (Pty) Ltd | www.gonxt.tech | Atheon Intelligence Platform', pageW / 2, pageH - 5, { align: 'center' });

  // ═══════════════════════════════════════════════
  // PAGE 2 — Executive Summary
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Executive Summary');

  // KPI Boxes — 2 rows of 3
  const kpis = [
    { label: 'Total Est. Annual Savings', value: `R ${formatZAR(totalSaving)}`, color: teal },
    { label: 'AI Catalysts Identified', value: `${scores.length}`, color: navy },
    { label: 'Payback Period', value: `${paybackMonths} months`, color: gold },
    { label: 'Return on Investment', value: `${roi}%`, color: teal },
    { label: 'Recommended First Catalyst', value: scores[0]?.catalyst_name || 'N/A', color: navy },
    { label: 'Data Completeness', value: `${snapshot.data_completeness_pct}%`, color: gold },
  ];

  const kpiW = (pageW - 30) / 3;
  kpis.forEach((kpi, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    const x = 10 + col * (kpiW + 5);
    const ky = 28 + row * 30;

    doc.setFillColor(...lightBg);
    doc.roundedRect(x, ky, kpiW, 25, 2, 2, 'F');
    // Left accent bar
    doc.setFillColor(kpi.color[0], kpi.color[1], kpi.color[2]);
    doc.rect(x, ky, 2, 25, 'F');

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(kpi.label, x + 6, ky + 8);
    doc.setFontSize(14);
    doc.setTextColor(...slate);
    const valText = doc.splitTextToSize(kpi.value, kpiW - 10);
    doc.text(valText[0], x + 6, ky + 19);
  });

  // Narrative section
  let y = 95;
  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text('Assessment Overview', 14, y);
  y += 2;
  doc.setFillColor(...teal);
  doc.rect(14, y, 30, 0.5, 'F');
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(...slate);
  const narrativeLines = doc.splitTextToSize(narrativeSummary, pageW - 28);
  doc.text(narrativeLines, 14, y);
  y += narrativeLines.length * 4.5 + 8;

  // Data source callout box
  doc.setFillColor(245, 245, 245);
  doc.roundedRect(14, y, pageW - 28, 18, 2, 2, 'F');
  doc.setFillColor(...navy);
  doc.rect(14, y, 2, 18, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...navy);
  doc.text('DATA SOURCE', 20, y + 6);
  doc.setTextColor(...slate);
  doc.setFontSize(8);
  doc.text(`${snapshot.erp_system} | ${snapshot.months_of_data} months | ${snapshot.monthly_invoices} invoices/month | ${snapshot.employee_count} employees | ${snapshot.active_customer_count} customers`, 20, y + 13);

  pageFooter();

  // ═══════════════════════════════════════════════
  // PAGE 3 — Savings by Catalyst (visual bar chart)
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Savings by Catalyst');

  // Horizontal bar chart
  y = 28;
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Estimated Annual Savings by AI Catalyst', 14, y);
  y += 8;

  const maxSaving = Math.max(...scores.map(s => s.estimated_annual_saving_zar), 1);
  const barMaxW = pageW - 90;
  const barColors = [[0,150,136],[27,58,107],[255,179,0],[76,175,80],[156,39,176],[233,30,99],[63,81,181]] as const;

  scores.forEach((cat, idx) => {
    const barW = (cat.estimated_annual_saving_zar / maxSaving) * barMaxW;
    const color = barColors[idx % barColors.length];

    // Label
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    const labelLines = doc.splitTextToSize(cat.catalyst_name, 55);
    doc.text(labelLines[0], 14, y + 4);

    // Bar
    doc.setFillColor(color[0], color[1], color[2]);
    doc.roundedRect(72, y, Math.max(barW, 2), 7, 1, 1, 'F');

    // Value
    doc.setFontSize(7);
    doc.setTextColor(...slate);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, 72 + Math.max(barW, 2) + 3, y + 5);

    y += 12;
  });

  // Summary table
  y += 8;
  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  const tCols = ['#', 'Catalyst', 'Domain', 'Sub-Catalysts', 'Est. Annual Saving', 'Confidence'];
  const tX = [16, 24, 68, 100, 145, 182];
  tCols.forEach((col, i) => doc.text(col, tX[i], y + 5.5));

  y += 10;
  doc.setTextColor(...slate);
  scores.forEach((cat, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(...lightBg);
      doc.rect(14, y - 3.5, pageW - 28, 7, 'F');
    }
    doc.setFontSize(7);
    doc.text(`${cat.priority}`, tX[0], y);
    doc.text(cat.catalyst_name.substring(0, 25), tX[1], y);
    doc.text(cat.domain, tX[2], y);
    doc.text(`${cat.sub_catalysts.length}`, tX[3], y);
    doc.setTextColor(...navy);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, tX[4], y);
    // Confidence badge
    const confColor = cat.confidence === 'high' ? teal : cat.confidence === 'medium' ? gold : [200,200,200] as const;
    doc.setFillColor(confColor[0], confColor[1], confColor[2]);
    doc.roundedRect(tX[5], y - 3, 14, 5, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(6);
    doc.text(cat.confidence.toUpperCase(), tX[5] + 2, y);
    doc.setTextColor(...slate);
    doc.setFontSize(7);
    y += 7;
  });

  // Grand total
  y += 2;
  doc.setFillColor(...teal);
  doc.rect(14, y - 3.5, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(9);
  doc.text('TOTAL ESTIMATED ANNUAL SAVINGS', 16, y + 1);
  doc.text(`R ${formatZAR(totalSaving)}`, tX[4], y + 1);

  doc.setFontSize(6);
  doc.setTextColor(150, 150, 150);
  doc.text('All savings estimates based on industry benchmarks applied to actual ERP transaction data.', 14, y + 12);

  pageFooter();

  // ═══════════════════════════════════════════════
  // PAGES 4–N — Catalyst Deep Dives (top 5)
  // ═══════════════════════════════════════════════
  const topCatalysts = scores.slice(0, 5);
  for (const cat of topCatalysts) {
    doc.addPage();
    pageHeader(`Catalyst Deep Dive: ${cat.catalyst_name}`);

    // Header info bar
    let py = 26;
    doc.setFillColor(...lightBg);
    doc.roundedRect(14, py, pageW - 28, 16, 2, 2, 'F');
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(`Domain: ${cat.domain}`, 18, py + 6);
    doc.text(`Priority: ${cat.priority}`, 80, py + 6);
    doc.text(`Confidence: ${cat.confidence.toUpperCase()}`, 120, py + 6);
    doc.setTextColor(...navy);
    doc.text(`Est. Annual Saving: R ${formatZAR(cat.estimated_annual_saving_zar)}`, 18, py + 13);
    py += 22;

    // Data Insights
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Key Data Insights', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    doc.setTextColor(...slate);
    for (const insight of cat.data_insights) {
      doc.setFillColor(...teal);
      doc.circle(17, py - 1, 1, 'F');
      const lines = doc.splitTextToSize(insight, pageW - 36);
      doc.text(lines, 22, py);
      py += lines.length * 4 + 3;
    }

    // Savings breakdown with visual bars
    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Savings Breakdown', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    const catMaxSave = Math.max(...cat.saving_components.map(c => c.amount_zar), 1);
    for (const comp of cat.saving_components) {
      doc.setFontSize(8);
      doc.setTextColor(...slate);
      doc.text(comp.label, 18, py);
      doc.text(`R ${formatZAR(comp.amount_zar)}`, 130, py);

      // Mini bar
      const miniBarW = (comp.amount_zar / catMaxSave) * 50;
      doc.setFillColor(...teal);
      doc.roundedRect(150, py - 3, Math.max(miniBarW, 1), 4, 0.5, 0.5, 'F');

      doc.setFontSize(6);
      doc.setTextColor(150, 150, 150);
      doc.text(comp.methodology, 18, py + 4);
      doc.setTextColor(...slate);
      py += 10;
    }

    // Sub-catalyst deployment sequence
    py += 4;
    doc.setFontSize(10);
    doc.setTextColor(...navy);
    doc.text('Sub-Catalyst Deployment Sequence', 14, py);
    doc.setFillColor(...teal);
    doc.rect(14, py + 1.5, 25, 0.5, 'F');
    py += 8;

    doc.setFontSize(8);
    cat.sub_catalysts.forEach((sc, i) => {
      // Step number circle
      doc.setFillColor(...navy);
      doc.circle(19, py - 1, 3, 'F');
      doc.setTextColor(...white);
      doc.setFontSize(6);
      doc.text(`${i + 1}`, 17.5, py);

      doc.setTextColor(...slate);
      doc.setFontSize(8);
      doc.text(`${sc.name}`, 26, py);
      doc.setFontSize(7);
      doc.setTextColor(120, 120, 120);
      doc.text(`${sc.estimated_monthly_volume} ${sc.volume_unit}/month | R ${formatZAR(sc.estimated_annual_saving_zar)}/year`, 26, py + 4);
      if (sc.deploy_prerequisite) {
        doc.text(`Prerequisite: ${sc.deploy_prerequisite}`, 26, py + 8);
        py += 4;
      }
      py += 10;
    });

    pageFooter();
  }

  // ═══════════════════════════════════════════════
  // LAST PAGE — Deployment Roadmap & Next Steps
  // ═══════════════════════════════════════════════
  doc.addPage();
  pageHeader('Deployment Roadmap');

  y = 28;
  const phases = [
    { label: 'Phase 1 — Quick Wins (Month 1–2)', desc: 'Deploy highest-impact catalysts with fastest payback', catalysts: scores.filter(c => c.deploy_order <= 2), color: teal },
    { label: 'Phase 2 — Core Expansion (Month 3–4)', desc: 'Extend AI coverage to operational processes', catalysts: scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4), color: navy },
    { label: 'Phase 3 — Full Intelligence (Month 5–6)', desc: 'Complete platform deployment with advanced analytics', catalysts: scores.filter(c => c.deploy_order >= 5), color: gold },
  ];

  for (const phase of phases) {
    if (phase.catalysts.length === 0) continue;

    // Phase header
    doc.setFillColor(phase.color[0], phase.color[1], phase.color[2]);
    doc.roundedRect(14, y, pageW - 28, 8, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(9);
    doc.text(phase.label, 18, y + 5.5);
    y += 11;

    doc.setFontSize(7);
    doc.setTextColor(120, 120, 120);
    doc.text(phase.desc, 18, y);
    y += 5;

    doc.setFontSize(8);
    for (const cat of phase.catalysts) {
      doc.setTextColor(...slate);
      doc.text(`\u2022 ${cat.catalyst_name}`, 22, y);
      doc.setTextColor(...navy);
      doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}/year`, 140, y);
      y += 5;
    }
    y += 6;
  }

  // Investment Summary Box
  y += 4;
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, y, pageW - 28, 38, 3, 3, 'F');
  doc.setFillColor(...navy);
  doc.rect(14, y, 3, 38, 'F');

  doc.setFontSize(11);
  doc.setTextColor(...navy);
  doc.text('Investment Summary', 22, y + 9);
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text(`Platform Licence (${config.deployment_model.toUpperCase()}):`, 22, y + 17);
  doc.text(`R ${formatZAR(annualLicence)}/year`, 120, y + 17);
  doc.text('Estimated Annual Savings:', 22, y + 23);
  doc.setTextColor(...teal);
  doc.text(`R ${formatZAR(totalSaving)}/year`, 120, y + 23);
  doc.setTextColor(...slate);
  doc.text('Net Annual Benefit:', 22, y + 29);
  doc.text(`R ${formatZAR(totalSaving - annualLicence)}/year`, 120, y + 29);
  doc.text('Payback Period:', 22, y + 35);
  doc.setTextColor(...navy);
  doc.text(`${paybackMonths} months`, 120, y + 35);

  // CTA
  y += 50;
  doc.setFillColor(...teal);
  doc.roundedRect(pageW / 2 - 55, y, 110, 14, 3, 3, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(10);
  doc.text('Ready to activate? Contact GONXT Technology', pageW / 2, y + 9, { align: 'center' });

  pageFooter();

  return doc.output('arraybuffer');
}

// Technical Sizing Report PDF
export async function generateTechnicalReportPDF(
  scores: CatalystScore[],
  sizing: TechnicalSizing,
  config: AssessmentConfig,
  prospectName: string,
  snapshot: VolumeSnapshot
): Promise<ArrayBuffer> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // ── Atheon Colour palette ──
  const navy  = [27, 58, 107] as const;
  const teal  = [0, 150, 136] as const;
  const gold  = [255, 179, 0] as const;
  const slate = [55, 71, 79] as const;
  const lightBg = [245, 248, 255] as const;
  const white = [255, 255, 255] as const;
  const red   = [211, 47, 47] as const;
  const green = [46, 125, 50] as const;

  function techHeader(title: string) {
    doc.setFillColor(...navy);
    doc.rect(0, 0, pageW, 18, 'F');
    doc.setFillColor(...gold);
    doc.rect(0, 18, pageW, 1.2, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(12);
    doc.text(title, 14, 12);
    doc.setFontSize(7);
    doc.text('INTERNAL — GONXT Technology', pageW - 14, 12, { align: 'right' });
  }

  function techFooter() {
    doc.setFontSize(6);
    doc.setTextColor(150, 150, 150);
    doc.text(`Atheon Technical Sizing | ${prospectName} | ${new Date().toLocaleDateString('en-ZA')}`, 14, pageH - 8);
    doc.text('CONFIDENTIAL', pageW - 14, pageH - 8, { align: 'right' });
  }

  // ═══════════════════════════════════════════════
  // PAGE 1 — Cover
  // ═══════════════════════════════════════════════
  doc.setFillColor(...navy);
  doc.rect(0, 0, pageW, pageH, 'F');
  doc.setFillColor(...gold);
  doc.rect(0, 80, pageW, 2, 'F');

  doc.setTextColor(...white);
  doc.setFontSize(36);
  doc.text('ATHEON', pageW / 2, 45, { align: 'center' });
  doc.setFontSize(10);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 56, { align: 'center' });

  doc.setFontSize(18);
  doc.text('Technical Sizing Report', pageW / 2, 100, { align: 'center' });
  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text('Infrastructure, Capacity Planning & Cost Analysis', pageW / 2, 112, { align: 'center' });

  doc.setFontSize(14);
  doc.setTextColor(...white);
  doc.text(prospectName, pageW / 2, 135, { align: 'center' });

  doc.setFontSize(9);
  doc.setTextColor(180, 200, 230);
  doc.text(`ERP: ${snapshot.erp_system} | ${snapshot.months_of_data} months data`, pageW / 2, 155, { align: 'center' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 163, { align: 'center' });
  doc.text('INTERNAL USE ONLY — NOT FOR DISTRIBUTION', pageW / 2, 180, { align: 'center' });

  doc.setFillColor(...gold);
  doc.rect(0, pageH - 10, pageW, 10, 'F');
  doc.setTextColor(...navy);
  doc.setFontSize(7);
  doc.text('GONXT Technology (Pty) Ltd | Atheon Intelligence Platform', pageW / 2, pageH - 4, { align: 'center' });

  // ═══════════════════════════════════════════════
  // PAGE 2 — ERP Data Profile (with visual gauges)
  // ═══════════════════════════════════════════════
  doc.addPage();
  techHeader('ERP Data Profile');

  let y = 28;
  // Data completeness gauge
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Data Quality Score', 14, y);
  y += 4;
  const completeness = snapshot.data_completeness_pct;
  const gaugeW = 80;
  doc.setFillColor(230, 230, 230);
  doc.roundedRect(14, y, gaugeW, 6, 2, 2, 'F');
  const fillColor = completeness >= 80 ? green : completeness >= 50 ? gold : red;
  doc.setFillColor(fillColor[0], fillColor[1], fillColor[2]);
  doc.roundedRect(14, y, gaugeW * (completeness / 100), 6, 2, 2, 'F');
  doc.setFontSize(8);
  doc.setTextColor(...slate);
  doc.text(`${completeness}%`, gaugeW + 18, y + 4.5);

  // System info
  doc.text(`ERP System: ${snapshot.erp_system}`, 120, y + 4.5);
  y += 14;

  // Profile table — grouped into sections
  const sections: { title: string; rows: [string, string][] }[] = [
    { title: 'Transaction Volumes', rows: [
      ['Monthly Invoices', `${snapshot.monthly_invoices.toLocaleString()}`],
      ['Monthly Purchase Orders', `${snapshot.monthly_purchase_orders.toLocaleString()}`],
      ['Monthly Journal Entries', `${snapshot.monthly_journal_entries.toLocaleString()}`],
      ['Monthly Bank Transactions', `${snapshot.monthly_bank_transactions.toLocaleString()}`],
    ]},
    { title: 'Financial Position', rows: [
      ['Total AR Balance', `R ${formatZAR(snapshot.total_ar_balance)}`],
      ['Total AP Balance', `R ${formatZAR(snapshot.total_ap_balance)}`],
      ['Overdue Invoices', `${snapshot.overdue_invoice_count} (R ${formatZAR(snapshot.overdue_invoice_value)})`],
      ['Avg Invoice Value', `R ${formatZAR(snapshot.avg_invoice_value)}`],
      ['Revenue (12m)', `R ${formatZAR(snapshot.total_revenue_12m)}`],
      ['Spend (12m)', `R ${formatZAR(snapshot.total_spend_12m)}`],
    ]},
    { title: 'Organisation', rows: [
      ['Employees', `${snapshot.employee_count}`],
      ['Monthly Payroll', `R ${formatZAR(snapshot.total_monthly_payroll)}`],
      ['Active Customers', `${snapshot.active_customer_count}`],
      ['Active Suppliers', `${snapshot.active_supplier_count}`],
      ['Products', `${snapshot.product_count}`],
      ['Inventory Value', `R ${formatZAR(snapshot.total_inventory_value)}`],
    ]},
  ];

  for (const section of sections) {
    doc.setFillColor(...teal);
    doc.roundedRect(14, y, pageW - 28, 7, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(8);
    doc.text(section.title, 18, y + 5);
    y += 9;

    doc.setFontSize(7.5);
    for (const [label, value] of section.rows) {
      if (Math.floor((y - 28) / 5) % 2 === 0) {
        doc.setFillColor(...lightBg);
        doc.rect(14, y - 3, pageW - 28, 5, 'F');
      }
      doc.setTextColor(...slate);
      doc.text(label, 18, y);
      doc.setTextColor(...navy);
      doc.text(value, 120, y);
      y += 5;
    }
    y += 3;
  }

  techFooter();

  // ═══════════════════════════════════════════════
  // PAGE 3 — Infrastructure Sizing (SaaS) with bar chart
  // ═══════════════════════════════════════════════
  doc.addPage();
  techHeader('Infrastructure Sizing — SaaS (Cloudflare)');

  y = 28;
  const saasItems = [
    { svc: 'Workers (API)', vol: `${sizing.total_monthly_api_calls.toLocaleString()} calls/mo`, cost: sizing.cost_cf_workers },
    { svc: 'D1 Database', vol: `${sizing.total_db_size_gb} GB`, cost: sizing.cost_cf_d1 },
    { svc: 'Vectorize', vol: `${sizing.total_monthly_vector_queries.toLocaleString()} queries/mo`, cost: sizing.cost_cf_vectorize },
    { svc: 'Workers AI', vol: `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens/mo`, cost: sizing.cost_cf_workers_ai },
    { svc: 'R2 Storage', vol: `${sizing.total_storage_gb} GB`, cost: sizing.cost_cf_r2 },
    { svc: 'KV Cache', vol: `${sizing.total_kv_reads_monthly.toLocaleString()} reads/mo`, cost: sizing.cost_cf_kv },
  ];

  // Table header
  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  doc.text('Service', 18, y + 5.5);
  doc.text('Monthly Volume', 90, y + 5.5);
  doc.text('Cost (ZAR/mo)', 155, y + 5.5);
  y += 10;

  const maxCost = Math.max(...saasItems.map(i => i.cost), 1);
  for (const item of saasItems) {
    if (saasItems.indexOf(item) % 2 === 0) {
      doc.setFillColor(...lightBg);
      doc.rect(14, y - 3.5, pageW - 28, 7, 'F');
    }
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(item.svc, 18, y);
    doc.text(item.vol, 90, y);
    doc.setTextColor(...navy);
    doc.text(`R ${formatZAR(item.cost)}`, 155, y);

    // Mini cost bar
    const barW = (item.cost / maxCost) * 25;
    doc.setFillColor(...teal);
    doc.roundedRect(180, y - 2.5, Math.max(barW, 1), 4, 0.5, 0.5, 'F');
    y += 7;
  }

  // Totals row
  y += 2;
  doc.setFillColor(...navy);
  doc.rect(14, y - 3.5, pageW - 28, 8, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  doc.text('TOTAL INFRASTRUCTURE COST', 18, y + 1);
  doc.text(`R ${formatZAR(sizing.total_infra_cost_pm_saas)}/month`, 155, y + 1);
  y += 14;

  // Revenue vs Cost comparison
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Revenue vs Cost Analysis', 14, y);
  y += 8;

  const revCostItems = [
    { label: 'Monthly Revenue', value: sizing.monthly_licence_revenue, color: green },
    { label: 'Monthly Infrastructure Cost', value: sizing.total_infra_cost_pm_saas, color: red },
    { label: 'Monthly Gross Margin', value: sizing.gross_margin_pm_saas, color: teal },
  ];
  const maxRev = Math.max(...revCostItems.map(i => Math.abs(i.value)), 1);
  for (const item of revCostItems) {
    doc.setFontSize(8);
    doc.setTextColor(...slate);
    doc.text(item.label, 18, y + 4);
    const barW = (Math.abs(item.value) / maxRev) * 80;
    doc.setFillColor(item.color[0], item.color[1], item.color[2]);
    doc.roundedRect(90, y, Math.max(barW, 1), 7, 1, 1, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(7);
    doc.text(`R ${formatZAR(item.value)}`, 92, y + 5);
    y += 10;
  }

  // Margin badge
  y += 5;
  doc.setFillColor(sizing.gross_margin_pct_saas >= 70 ? green[0] : sizing.gross_margin_pct_saas >= 40 ? gold[0] : red[0],
                    sizing.gross_margin_pct_saas >= 70 ? green[1] : sizing.gross_margin_pct_saas >= 40 ? gold[1] : red[1],
                    sizing.gross_margin_pct_saas >= 70 ? green[2] : sizing.gross_margin_pct_saas >= 40 ? gold[2] : red[2]);
  doc.roundedRect(14, y, 50, 12, 3, 3, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(10);
  doc.text(`Gross Margin: ${sizing.gross_margin_pct_saas}%`, 18, y + 8);

  techFooter();

  // ═══════════════════════════════════════════════
  // PAGE 4 — On-Premise / Hybrid Sizing
  // ═══════════════════════════════════════════════
  doc.addPage();
  techHeader('Infrastructure Sizing — On-Premise / Hybrid');

  y = 28;
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('On-Premise Cost Structure', 14, y);
  doc.setFillColor(...gold);
  doc.rect(14, y + 2, 30, 0.5, 'F');
  y += 10;

  const onpremItems = [
    { label: 'Annual Support Cost', value: config.onprem_support_cost_pa, monthly: config.onprem_support_cost_pa / 12 },
    { label: 'Annual Update Cost', value: config.onprem_update_cost_pa, monthly: config.onprem_update_cost_pa / 12 },
  ];

  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 7, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  doc.text('Cost Component', 18, y + 5);
  doc.text('Annual (ZAR)', 110, y + 5);
  doc.text('Monthly (ZAR)', 155, y + 5);
  y += 9;

  for (const item of onpremItems) {
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(item.label, 18, y);
    doc.text(`R ${formatZAR(item.value)}`, 110, y);
    doc.text(`R ${formatZAR(item.monthly)}`, 155, y);
    y += 6;
  }
  y += 2;
  doc.setFillColor(...teal);
  doc.rect(14, y - 3, pageW - 28, 7, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  doc.text('TOTAL ON-PREM COST', 18, y + 1);
  doc.text(`R ${formatZAR(sizing.total_infra_cost_pm_onprem)}/month`, 155, y + 1);
  y += 14;

  // Comparison table: SaaS vs On-Prem
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Deployment Model Comparison', 14, y);
  y += 8;

  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 7, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(8);
  doc.text('Metric', 18, y + 5);
  doc.text('SaaS', 100, y + 5);
  doc.text('On-Premise', 145, y + 5);
  y += 9;

  const compRows = [
    ['Monthly Infra Cost', `R ${formatZAR(sizing.total_infra_cost_pm_saas)}`, `R ${formatZAR(sizing.total_infra_cost_pm_onprem)}`],
    ['Monthly Revenue', `R ${formatZAR(sizing.monthly_licence_revenue)}`, `R ${formatZAR(config.onprem_licence_fee_pa / 12)}`],
    ['Gross Margin/month', `R ${formatZAR(sizing.gross_margin_pm_saas)}`, `R ${formatZAR(sizing.gross_margin_pm_onprem)}`],
    ['Gross Margin %', `${sizing.gross_margin_pct_saas}%`, `${sizing.gross_margin_pct_onprem}%`],
    ['Annual Licence', `R ${formatZAR(sizing.annual_licence_revenue)}`, `R ${formatZAR(config.onprem_licence_fee_pa)}`],
  ];

  for (const [label, saas, onprem] of compRows) {
    if (compRows.indexOf([label, saas, onprem]) % 2 === 0) {
      doc.setFillColor(...lightBg);
      doc.rect(14, y - 3, pageW - 28, 6, 'F');
    }
    doc.setFontSize(7.5);
    doc.setTextColor(...slate);
    doc.text(label, 18, y);
    doc.text(saas, 100, y);
    doc.text(onprem, 145, y);
    y += 6;
  }

  techFooter();

  // ═══════════════════════════════════════════════
  // PAGE 5 — Per-Catalyst Sizing
  // ═══════════════════════════════════════════════
  doc.addPage();
  techHeader('Per-Catalyst Resource Sizing');

  y = 28;
  doc.setFillColor(...navy);
  doc.rect(14, y, pageW - 28, 7, 'F');
  doc.setTextColor(...white);
  doc.setFontSize(7);
  doc.text('Catalyst', 18, y + 5);
  doc.text('Sub-Catalysts', 65, y + 5);
  doc.text('API Calls/mo', 100, y + 5);
  doc.text('DB (MB)', 130, y + 5);
  doc.text('Vectors/mo', 150, y + 5);
  doc.text('LLM Tokens/mo', 175, y + 5);
  y += 9;

  for (const cs of sizing.catalyst_sizing) {
    if (sizing.catalyst_sizing.indexOf(cs) % 2 === 0) {
      doc.setFillColor(...lightBg);
      doc.rect(14, y - 3, pageW - 28, 6, 'F');
    }
    doc.setFontSize(6.5);
    doc.setTextColor(...slate);
    const totalApi = cs.sub_catalysts.reduce((s, sc) => s + sc.monthly_api_calls, 0);
    const totalVec = cs.sub_catalysts.reduce((s, sc) => s + sc.monthly_vector_queries, 0);
    const totalLlm = cs.sub_catalysts.reduce((s, sc) => s + sc.monthly_llm_tokens, 0);
    doc.text(cs.catalyst_name.substring(0, 28), 18, y);
    doc.text(`${cs.sub_catalysts.length}`, 65, y);
    doc.text(`${totalApi.toLocaleString()}`, 100, y);
    doc.text(`${cs.total_cost_pm_zar}`, 130, y);
    doc.text(`${totalVec.toLocaleString()}`, 150, y);
    doc.text(`${totalLlm.toLocaleString()}`, 175, y);
    y += 6;
  }

  techFooter();

  // ═══════════════════════════════════════════════
  // PAGE 6 — Pricing Recommendation
  // ═══════════════════════════════════════════════
  doc.addPage();
  techHeader('Pricing Recommendation');

  y = 32;
  const recLicence = config.deployment_model === 'saas'
    ? sizing.annual_licence_revenue
    : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
  const recMargin = config.deployment_model === 'saas' ? sizing.gross_margin_pct_saas : sizing.gross_margin_pct_onprem;
  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const paybackMonths = totalSaving > 0 ? Math.round((recLicence / totalSaving) * 12) : 0;

  // Recommendation box
  doc.setFillColor(...lightBg);
  doc.roundedRect(14, y, pageW - 28, 55, 3, 3, 'F');
  doc.setFillColor(...navy);
  doc.rect(14, y, 3, 55, 'F');

  doc.setFontSize(12);
  doc.setTextColor(...navy);
  doc.text('Recommended Configuration', 22, y + 10);

  doc.setFontSize(9);
  doc.setTextColor(...slate);
  const recItems = [
    [`Deployment Model:`, config.deployment_model.toUpperCase()],
    [`Annual Licence Fee:`, `R ${formatZAR(recLicence)}`],
    [`${config.contract_years}-Year Contract Value:`, `R ${formatZAR(recLicence * config.contract_years)}`],
    [`Gross Margin:`, `${recMargin}%`],
    [`Payback Period:`, `${paybackMonths} months`],
    [`Target Users:`, `${config.target_users}`],
  ];
  let iy = y + 18;
  for (const [label, value] of recItems) {
    doc.text(label, 22, iy);
    doc.setTextColor(...navy);
    doc.text(value, 100, iy);
    doc.setTextColor(...slate);
    iy += 7;
  }

  // Pricing tier comparison
  y += 65;
  doc.setFontSize(10);
  doc.setTextColor(...navy);
  doc.text('Pricing Tier Options', 14, y);
  y += 8;

  const tiers = [
    { name: 'SaaS', licence: sizing.annual_licence_revenue, margin: sizing.gross_margin_pct_saas, color: teal, recommended: config.deployment_model === 'saas' },
    { name: 'Hybrid', licence: config.hybrid_licence_fee_pa, margin: 0, color: gold, recommended: config.deployment_model === 'hybrid' },
    { name: 'On-Premise', licence: config.onprem_licence_fee_pa, margin: sizing.gross_margin_pct_onprem, color: navy, recommended: config.deployment_model === 'on-premise' },
  ];

  const tierW = (pageW - 38) / 3;
  tiers.forEach((tier, i) => {
    const tx = 14 + i * (tierW + 5);
    doc.setFillColor(tier.color[0], tier.color[1], tier.color[2]);
    doc.roundedRect(tx, y, tierW, 35, 2, 2, 'F');
    doc.setTextColor(...white);
    doc.setFontSize(10);
    doc.text(tier.name, tx + tierW / 2, y + 10, { align: 'center' });
    doc.setFontSize(8);
    doc.text(`R ${formatZAR(tier.licence)}/year`, tx + tierW / 2, y + 20, { align: 'center' });
    if (tier.recommended) {
      doc.setFillColor(...gold);
      doc.roundedRect(tx + 5, y + 26, tierW - 10, 6, 1, 1, 'F');
      doc.setTextColor(...navy);
      doc.setFontSize(6);
      doc.text('RECOMMENDED', tx + tierW / 2, y + 30, { align: 'center' });
    }
  });

  techFooter();

  return doc.output('arraybuffer');
}

// Excel Model generation — Atheon branded with comprehensive worksheets
export async function generateExcelModel(
  scores: CatalystScore[],
  sizing: TechnicalSizing,
  config: AssessmentConfig,
  snapshot: VolumeSnapshot
): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // ═══════════════════════════════════════════════
  // Sheet 1 — Executive Summary
  // ═══════════════════════════════════════════════
  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const annualLicence = config.deployment_model === 'saas'
    ? sizing.annual_licence_revenue
    : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
  const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;
  const roi = annualLicence > 0 ? Math.round((totalSaving / annualLicence) * 100) : 0;

  const summaryData: (string | number)[][] = [
    ['ATHEON INTELLIGENCE PLATFORM — AI Catalyst Assessment Model'],
    [''],
    ['KEY METRICS', '', 'VALUE'],
    ['Total Estimated Annual Savings', '', totalSaving],
    ['AI Catalysts Identified', '', scores.length],
    ['Recommended First Catalyst', '', scores[0]?.catalyst_name || 'N/A'],
    ['Platform Licence (Annual)', '', annualLicence],
    ['Net Annual Benefit', '', totalSaving - annualLicence],
    ['Payback Period', '', `${paybackMonths} months`],
    ['Return on Investment', '', `${roi}%`],
    ['Deployment Model', '', config.deployment_model.toUpperCase()],
    ['Contract Duration', '', `${config.contract_years} years`],
    ['Target Users', '', config.target_users],
    [''],
    ['ERP DATA PROFILE'],
    ['ERP System', '', snapshot.erp_system],
    ['Months of Data', '', snapshot.months_of_data],
    ['Data Completeness', '', `${snapshot.data_completeness_pct}%`],
    ['Monthly Invoices', '', snapshot.monthly_invoices],
    ['Monthly POs', '', snapshot.monthly_purchase_orders],
    ['Employees', '', snapshot.employee_count],
    ['Active Customers', '', snapshot.active_customer_count],
    ['Active Suppliers', '', snapshot.active_supplier_count],
    ['Total Revenue (12m)', '', snapshot.total_revenue_12m],
    ['Total Spend (12m)', '', snapshot.total_spend_12m],
    [''],
    ['DEPLOYMENT ROADMAP'],
    ['Phase 1 (Month 1-2)', '', scores.filter(c => c.deploy_order <= 2).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 2 (Month 3-4)', '', scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4).map(c => c.catalyst_name).join(', ') || 'N/A'],
    ['Phase 3 (Month 5-6)', '', scores.filter(c => c.deploy_order >= 5).map(c => c.catalyst_name).join(', ') || 'N/A'],
    [''],
    ['Generated by Atheon Intelligence Platform | GONXT Technology (Pty) Ltd'],
    [`Date: ${new Date().toLocaleDateString('en-ZA')} | CONFIDENTIAL`],
  ];

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  summarySheet['!cols'] = [{ wch: 35 }, { wch: 5 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, summarySheet, 'Executive Summary');

  // ═══════════════════════════════════════════════
  // Sheet 2 — Catalyst Savings Model
  // ═══════════════════════════════════════════════
  const savingsData: (string | number)[][] = [
    ['CATALYST SAVINGS MODEL'],
    [''],
    ['Priority', 'Catalyst', 'Domain', 'Sub-Catalyst', 'Volume/Month', 'Unit', 'Est. Annual Saving (ZAR)', 'Confidence', 'Deploy Order'],
  ];

  let grandTotal = 0;
  for (const cat of scores) {
    let catTotal = 0;
    for (const sc of cat.sub_catalysts) {
      savingsData.push([
        cat.priority, cat.catalyst_name, cat.domain, sc.name,
        sc.estimated_monthly_volume, sc.volume_unit,
        sc.estimated_annual_saving_zar, cat.confidence, cat.deploy_order,
      ]);
      catTotal += sc.estimated_annual_saving_zar;
    }
    savingsData.push(['', `${cat.catalyst_name} SUBTOTAL`, '', '', '', '', catTotal, '', '']);
    grandTotal += catTotal;
  }
  savingsData.push(['', '', '', '', '', '', '', '', '']);
  savingsData.push(['', 'GRAND TOTAL', '', '', '', '', grandTotal, '', '']);

  const savingsSheet = XLSX.utils.aoa_to_sheet(savingsData);
  savingsSheet['!cols'] = [{ wch: 8 }, { wch: 28 }, { wch: 15 }, { wch: 30 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 12 }, { wch: 12 }];
  XLSX.utils.book_append_sheet(wb, savingsSheet, 'Catalyst Savings');

  // ═══════════════════════════════════════════════
  // Sheet 3 — Catalyst Deep Dives
  // ═══════════════════════════════════════════════
  const deepDiveData: (string | number)[][] = [
    ['CATALYST DEEP DIVES'],
    [''],
  ];

  for (const cat of scores) {
    deepDiveData.push([`${cat.catalyst_name} (${cat.domain})`, '', '', '', '']);
    deepDiveData.push(['Priority', cat.priority, 'Confidence', cat.confidence, '']);
    deepDiveData.push(['Est. Annual Saving', cat.estimated_annual_saving_zar, 'Deploy Order', cat.deploy_order, '']);
    deepDiveData.push(['']);
    deepDiveData.push(['Data Insights:']);
    for (const insight of cat.data_insights) {
      deepDiveData.push([`  - ${insight}`]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Savings Components:', 'Label', 'Amount (ZAR)', 'Methodology']);
    for (const comp of cat.saving_components) {
      deepDiveData.push(['', comp.label, comp.amount_zar, comp.methodology]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['Sub-Catalysts:', 'Name', 'Volume/Month', 'Unit', 'Annual Saving (ZAR)']);
    for (const sc of cat.sub_catalysts) {
      deepDiveData.push(['', sc.name, sc.estimated_monthly_volume, sc.volume_unit, sc.estimated_annual_saving_zar]);
    }
    deepDiveData.push(['']);
    deepDiveData.push(['─────────────────────────────────────────────']);
    deepDiveData.push(['']);
  }

  const deepDiveSheet = XLSX.utils.aoa_to_sheet(deepDiveData);
  deepDiveSheet['!cols'] = [{ wch: 45 }, { wch: 30 }, { wch: 20 }, { wch: 25 }, { wch: 20 }];
  XLSX.utils.book_append_sheet(wb, deepDiveSheet, 'Catalyst Deep Dives');

  // ═══════════════════════════════════════════════
  // Sheet 4 — Volume Data (ERP Snapshot)
  // ═══════════════════════════════════════════════
  const volData: (string | number)[][] = [
    ['ERP VOLUME DATA SNAPSHOT'],
    [''],
    ['Category', 'Metric', 'Value', 'Description'],
    ['Transaction', 'Monthly Invoices', snapshot.monthly_invoices, 'Average invoices processed per month'],
    ['Transaction', 'Monthly Purchase Orders', snapshot.monthly_purchase_orders, 'Average POs per month'],
    ['Transaction', 'Monthly Journal Entries', snapshot.monthly_journal_entries, 'Average journal entries per month'],
    ['Transaction', 'Monthly Bank Transactions', snapshot.monthly_bank_transactions, 'Average bank transactions per month'],
    ['Financial', 'Total AR Balance', snapshot.total_ar_balance, 'Accounts receivable outstanding'],
    ['Financial', 'Total AP Balance', snapshot.total_ap_balance, 'Accounts payable outstanding'],
    ['Financial', 'Overdue Invoices (#)', snapshot.overdue_invoice_count, 'Number of overdue invoices'],
    ['Financial', 'Overdue Invoice Value', snapshot.overdue_invoice_value, 'Value of overdue invoices (ZAR)'],
    ['Financial', 'Avg Invoice Value', snapshot.avg_invoice_value, 'Average invoice amount (ZAR)'],
    ['Financial', 'Revenue (12m)', snapshot.total_revenue_12m, 'Total revenue last 12 months (ZAR)'],
    ['Financial', 'Spend (12m)', snapshot.total_spend_12m, 'Total spend last 12 months (ZAR)'],
    ['Organisation', 'Employees', snapshot.employee_count, 'Active employee count'],
    ['Organisation', 'Monthly Payroll', snapshot.total_monthly_payroll, 'Total monthly payroll (ZAR)'],
    ['Organisation', 'Active Customers', snapshot.active_customer_count, 'Unique active customers'],
    ['Organisation', 'Active Suppliers', snapshot.active_supplier_count, 'Unique active suppliers'],
    ['Inventory', 'Products', snapshot.product_count, 'Active product SKUs'],
    ['Inventory', 'Inventory Value', snapshot.total_inventory_value, 'Total inventory on hand (ZAR)'],
    ['Data', 'Months of Data', snapshot.months_of_data, 'Historical data depth'],
    ['Data', 'Data Completeness', snapshot.data_completeness_pct, 'Data quality score (%)'],
    ['Data', 'ERP System', snapshot.erp_system, 'Source ERP platform'],
  ];

  const volSheet = XLSX.utils.aoa_to_sheet(volData);
  volSheet['!cols'] = [{ wch: 15 }, { wch: 28 }, { wch: 20 }, { wch: 40 }];
  XLSX.utils.book_append_sheet(wb, volSheet, 'Volume Data');

  // ═══════════════════════════════════════════════
  // Sheet 5 — Infrastructure Cost Model
  // ═══════════════════════════════════════════════
  const infraData: (string | number)[][] = [
    ['INFRASTRUCTURE COST MODEL'],
    [''],
    ['Service Component', 'Monthly Volume', 'SaaS Cost (ZAR/mo)', 'On-Premise Cost (ZAR/mo)'],
    ['Workers (API Calls)', `${sizing.total_monthly_api_calls.toLocaleString()} calls`, sizing.cost_cf_workers, 0],
    ['D1 Database', `${sizing.total_db_size_gb} GB`, sizing.cost_cf_d1, 0],
    ['Vectorize (Embeddings)', `${sizing.total_monthly_vector_queries.toLocaleString()} queries`, sizing.cost_cf_vectorize, 0],
    ['Workers AI (LLM)', `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens`, sizing.cost_cf_workers_ai, 0],
    ['R2 Object Storage', `${sizing.total_storage_gb} GB`, sizing.cost_cf_r2, 0],
    ['KV Cache', `${sizing.total_kv_reads_monthly.toLocaleString()} reads`, sizing.cost_cf_kv, 0],
    ['Support Overhead', '', 0, config.onprem_support_cost_pa / 12],
    ['Update Delivery', '', 0, config.onprem_update_cost_pa / 12],
    [''],
    ['TOTALS', '', '', ''],
    ['Total Infra Cost/month', '', sizing.total_infra_cost_pm_saas, sizing.total_infra_cost_pm_onprem],
    ['Monthly Revenue', '', sizing.monthly_licence_revenue, config.onprem_licence_fee_pa / 12],
    ['Gross Margin/month', '', sizing.gross_margin_pm_saas, sizing.gross_margin_pm_onprem],
    ['Gross Margin %', '', sizing.gross_margin_pct_saas, sizing.gross_margin_pct_onprem],
    ['Annual Licence Revenue', '', sizing.annual_licence_revenue, config.onprem_licence_fee_pa],
    ['Payback Period (months)', '', grandTotal > 0 ? Math.round((sizing.annual_licence_revenue / grandTotal) * 12) : 0, grandTotal > 0 ? Math.round((config.onprem_licence_fee_pa / grandTotal) * 12) : 0],
  ];

  const infraSheet = XLSX.utils.aoa_to_sheet(infraData);
  infraSheet['!cols'] = [{ wch: 28 }, { wch: 22 }, { wch: 22 }, { wch: 22 }];
  XLSX.utils.book_append_sheet(wb, infraSheet, 'Infrastructure Costs');

  // ═══════════════════════════════════════════════
  // Sheet 6 — Assumptions & Variables
  // ═══════════════════════════════════════════════
  const varsData: (string | number)[][] = [
    ['ASSESSMENT ASSUMPTIONS & CONFIGURATION'],
    [''],
    ['Parameter', 'Value', 'Unit', 'Description'],
    ['SaaS Price/User/Month', config.saas_price_per_user_pm, 'ZAR', 'Per-user SaaS subscription price'],
    ['On-Prem Licence/Year', config.onprem_licence_fee_pa, 'ZAR', 'Annual on-premise licence fee'],
    ['Hybrid Licence/Year', config.hybrid_licence_fee_pa, 'ZAR', 'Annual hybrid licence fee'],
    ['CF Workers/1M Calls', config.cf_cost_per_1m_api_calls, 'ZAR', 'Cloudflare Workers per 1M invocations'],
    ['D1 Database/GB/Month', config.cf_d1_cost_per_gb_pm, 'ZAR', 'D1 storage cost per GB per month'],
    ['R2 Storage/GB/Month', config.cf_r2_cost_per_gb_pm, 'ZAR', 'R2 object storage per GB per month'],
    ['Vectorize/1M Queries', config.cf_vectorize_cost_per_1m_queries, 'ZAR', 'Vectorize embedding queries per 1M'],
    ['Workers AI/1M Tokens', config.cf_workers_ai_cost_per_1m_tokens, 'ZAR', 'LLM inference per 1M tokens'],
    ['KV/1M Reads', config.cf_kv_cost_per_1m_reads, 'ZAR', 'KV cache per 1M read operations'],
    ['CF Base Plan', config.cf_base_pm, 'ZAR', 'Cloudflare Workers fixed plan cost'],
    ['Support Overhead/Year', config.onprem_support_cost_pa, 'ZAR', 'GONXT annual support cost'],
    ['Update Delivery/Year', config.onprem_update_cost_pa, 'ZAR', 'Model update delivery per annum'],
    [''],
    ['SAVINGS ASSUMPTIONS'],
    ['AR Recovery Rate', config.ar_savings_pct, '%', 'Expected AR balance recovery improvement'],
    ['AP Processing Savings', config.ap_savings_pct, '%', 'AP automation efficiency gain'],
    ['Invoice Recon Savings', config.invoice_recon_savings_pct, '%', 'Reconciliation error reduction'],
    ['Procurement Savings', config.procurement_savings_pct, '%', 'Supplier scoring and spend optimization'],
    ['Workforce Savings', config.workforce_savings_pct, '%', 'Payroll scheduling optimization'],
    ['Supply Chain Savings', config.supply_chain_savings_pct, '%', 'Inventory and demand optimization'],
    ['Compliance Avoidance', config.compliance_fine_avoidance_pct, '%', 'Regulatory fine avoidance (% of revenue)'],
    ['Maintenance Savings', config.maintenance_savings_pct, '%', 'Predictive maintenance improvement'],
    [''],
    ['GENERAL'],
    ['Deployment Model', config.deployment_model, '', 'Selected deployment architecture'],
    ['Currency', config.currency, '', 'Display currency'],
    ['FX Rate to ZAR', config.exchange_rate_to_zar, '', 'Exchange rate multiplier'],
    ['Target Users', config.target_users, '', 'Number of licensed users'],
    ['Contract Duration', config.contract_years, 'years', 'Contract term length'],
  ];

  const varsSheet = XLSX.utils.aoa_to_sheet(varsData);
  varsSheet['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 8 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, varsSheet, 'Assumptions');

  // ═══════════════════════════════════════════════
  // Sheet 7 — 3-Year Financial Projection
  // ═══════════════════════════════════════════════
  const projData: (string | number)[][] = [
    ['3-YEAR FINANCIAL PROJECTION'],
    [''],
    ['Metric', 'Year 1', 'Year 2', 'Year 3', 'Total'],
    ['Estimated Savings', totalSaving, Math.round(totalSaving * 1.1), Math.round(totalSaving * 1.2), Math.round(totalSaving * 3.3)],
    ['Platform Licence Cost', annualLicence, Math.round(annualLicence * 1.03), Math.round(annualLicence * 1.06), Math.round(annualLicence * 3.09)],
    ['Net Annual Benefit', totalSaving - annualLicence, Math.round(totalSaving * 1.1 - annualLicence * 1.03), Math.round(totalSaving * 1.2 - annualLicence * 1.06), Math.round(totalSaving * 3.3 - annualLicence * 3.09)],
    ['Cumulative Savings', totalSaving, Math.round(totalSaving * 2.1), Math.round(totalSaving * 3.3), ''],
    ['Cumulative Cost', annualLicence, Math.round(annualLicence * 2.03), Math.round(annualLicence * 3.09), ''],
    ['Cumulative Net Benefit', totalSaving - annualLicence, Math.round(totalSaving * 2.1 - annualLicence * 2.03), Math.round(totalSaving * 3.3 - annualLicence * 3.09), ''],
    [''],
    ['ASSUMPTIONS'],
    ['Annual savings growth', '10%', '', '', 'Conservative estimate based on AI maturity curve'],
    ['Annual licence escalation', '3%', '', '', 'Standard contractual escalation'],
  ];

  const projSheet = XLSX.utils.aoa_to_sheet(projData);
  projSheet['!cols'] = [{ wch: 25 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 45 }];
  XLSX.utils.book_append_sheet(wb, projSheet, '3-Year Projection');

  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return buf as ArrayBuffer;
}

// ── LLM Narrative Generation ──────────────────────────────────────────────
export async function generateNarrative(
  scores: CatalystScore[],
  ai: Ai | null,
  totalSaving: number
): Promise<string> {
  const top3 = scores.slice(0, 3);
  const prompt = `Summarise the following assessment findings in exactly 2 paragraphs for a C-suite audience. Total estimated annual saving: R ${formatZAR(totalSaving)}.

Top catalysts:
${top3.map((c, i) => `${i + 1}. ${c.catalyst_name} (${c.domain}): R ${formatZAR(c.estimated_annual_saving_zar)}/year. Insights: ${c.data_insights.join('; ')}`).join('\n')}

Write in a professional, confident tone. Reference specific data points. Do not use bullet points.`;

  // Try LLM call if AI binding available
  if (ai) {
    try {
      const result = await (ai as any).run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a financial analyst at GONXT Technology writing assessment reports for Atheon AI platform prospects.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 300,
      }) as { response?: string };
      if (result?.response) return result.response;
    } catch (err) {
      console.error('Assessment narrative LLM call failed:', err);
    }
  }

  // Template fallback
  return `Based on our analysis of your transaction data, Atheon has identified ${scores.length} catalyst domains with a combined estimated annual saving of R ${formatZAR(totalSaving)}. The highest-priority recommendation is the ${top3[0]?.catalyst_name || 'Finance'} catalyst, which addresses ${top3[0]?.data_insights[0] || 'key operational inefficiencies'}.

We recommend a phased deployment starting with ${top3[0]?.catalyst_name || 'Finance'}${top3[1] ? ` followed by ${top3[1].catalyst_name}` : ''}, which together account for the majority of projected savings. The confidence level of these recommendations is ${top3[0]?.confidence || 'medium'}, based on ${scores[0]?.sub_catalysts[0]?.estimated_monthly_volume || 0} monthly transactions analysed across ${top3.length} domains.`;
}

// ── Main Assessment Runner ────────────────────────────────────────────────
export async function runAssessment(
  db: D1Database,
  ai: Ai,
  storage: R2Bucket,
  tenantId: string,
  assessmentId: string,
  erpConnectionId: string,
  config: AssessmentConfig,
  prospectIndustry: string,
  prospectName: string,
): Promise<void> {
  try {
    // 1. Mark running
    await db.prepare("UPDATE assessments SET status = 'running' WHERE id = ?").bind(assessmentId).run();

    // 2. Collect volume snapshot
    const snapshot = await collectVolumeSnapshot(db, tenantId, erpConnectionId);
    await db.prepare('UPDATE assessments SET data_snapshot = ? WHERE id = ?')
      .bind(JSON.stringify(snapshot), assessmentId).run();

    // 3. Score catalysts
    const catalystScores = scoreCatalysts(snapshot, config, prospectIndustry);

    // 4. Calculate technical sizing
    const technicalSizing = calculateTechnicalSizing(catalystScores, config);

    // 5. Generate narrative
    const totalSaving = catalystScores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
    const annualLicence = config.deployment_model === 'saas'
      ? technicalSizing.annual_licence_revenue
      : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
    const paybackMonths = annualLicence > 0 && totalSaving > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;

    const narrative = await generateNarrative(catalystScores, ai, totalSaving);

    const results: AssessmentResults = {
      catalyst_scores: catalystScores,
      technical_sizing: technicalSizing,
      total_estimated_annual_saving_zar: totalSaving,
      payback_months: paybackMonths,
      narrative_summary: narrative,
    };

    // 6–7. Generate reports (each wrapped independently — failures are non-fatal)
    let businessReportKey: string | null = null;
    let technicalReportKey: string | null = null;
    let excelModelKey: string | null = null;

    // Business PDF
    try {
      const businessKey = `assessments/${assessmentId}/business-report.pdf`;
      const businessPdf = await generateBusinessReportPDF(catalystScores, technicalSizing, config, prospectName, narrative, snapshot);
      await storage.put(businessKey, businessPdf, { httpMetadata: { contentType: 'application/pdf' } });
      businessReportKey = businessKey;
    } catch (pdfErr) {
      console.error('Business PDF generation failed:', pdfErr);
    }

    // Technical PDF
    try {
      const technicalKey = `assessments/${assessmentId}/technical-report.pdf`;
      const technicalPdf = await generateTechnicalReportPDF(catalystScores, technicalSizing, config, prospectName, snapshot);
      await storage.put(technicalKey, technicalPdf, { httpMetadata: { contentType: 'application/pdf' } });
      technicalReportKey = technicalKey;
    } catch (pdfErr) {
      console.error('Technical PDF generation failed:', pdfErr);
    }

    // Excel model
    try {
      const excelKey = `assessments/${assessmentId}/model.xlsx`;
      const excelModel = await generateExcelModel(catalystScores, technicalSizing, config, snapshot);
      await storage.put(excelKey, excelModel, { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });
      excelModelKey = excelKey;
    } catch (xlsxErr) {
      console.error('Excel model generation failed:', xlsxErr);
    }

    // 8. Mark complete with all results and report keys in a single atomic update
    await db.prepare(
      "UPDATE assessments SET status = 'complete', results = ?, data_snapshot = ?, business_report_key = ?, technical_report_key = ?, excel_model_key = ?, completed_at = datetime('now') WHERE id = ?"
    ).bind(JSON.stringify(results), JSON.stringify(snapshot), businessReportKey, technicalReportKey, excelModelKey, assessmentId).run();

  } catch (err) {
    console.error('Assessment engine error:', err);
    // 10. Mark failed — only if scoring/sizing itself failed
    await db.prepare(
      "UPDATE assessments SET status = 'failed', results = ? WHERE id = ?"
    ).bind(JSON.stringify({ error: (err as Error).message }), assessmentId).run();
  }
}
