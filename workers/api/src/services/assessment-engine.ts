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
  // Use jsPDF for PDF generation
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();

  // Page 1 — Cover
  doc.setFillColor(27, 58, 107); // #1B3A6B
  doc.rect(0, 0, pageW, 80, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(28);
  doc.text('ATHEON', pageW / 2, 30, { align: 'center' });
  doc.setFontSize(14);
  doc.text(`${prospectName} — AI Catalyst Assessment`, pageW / 2, 45, { align: 'center' });
  doc.setFontSize(10);
  doc.text('Prepared by GONXT Technology | Atheon Intelligence Platform', pageW / 2, 58, { align: 'center' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')} | Confidential`, pageW / 2, 68, { align: 'center' });

  // Page 2 — Executive Summary
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Executive Summary', 10, 10);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);

  const totalSaving = scores.reduce((s, c) => s + c.estimated_annual_saving_zar, 0);
  const annualLicence = config.deployment_model === 'saas'
    ? sizing.annual_licence_revenue
    : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
  const paybackMonths = annualLicence > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;

  // Metric boxes
  const boxes = [
    { label: 'Total Est. Annual Savings', value: `R ${formatZAR(totalSaving)}` },
    { label: 'Catalysts Identified', value: `${scores.length}` },
    { label: 'Recommended Start', value: scores[0]?.catalyst_name || 'N/A' },
    { label: 'Payback Period', value: `${paybackMonths} months` },
  ];

  const boxW = (pageW - 20) / 4;
  boxes.forEach((box, i) => {
    const x = 10 + i * boxW;
    doc.setFillColor(239, 244, 255); // #EFF4FF
    doc.rect(x, 22, boxW - 4, 25, 'F');
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(box.label, x + 2, 28);
    doc.setFontSize(14);
    doc.setTextColor(27, 58, 107);
    doc.text(box.value, x + 2, 40);
  });

  // Narrative
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  const narrativeLines = doc.splitTextToSize(narrativeSummary, pageW - 20);
  doc.text(narrativeLines, 10, 58);

  const dataSource = `${snapshot.erp_system} | ${snapshot.months_of_data} months of transaction data`;
  doc.setFontSize(8);
  doc.setTextColor(120, 120, 120);
  doc.text(`Data source: ${dataSource}`, 10, 58 + narrativeLines.length * 5 + 8);

  // Page 3 — Savings by Catalyst
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Savings by Catalyst', 10, 10);

  // Table headers
  const cols = ['Priority', 'Catalyst', 'Key Sub-Catalysts', 'Est. Annual Saving', 'Confidence'];
  const colX = [10, 30, 70, 130, 175];
  let y = 25;
  doc.setFillColor(27, 58, 107);
  doc.rect(8, y - 5, pageW - 16, 8, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(8);
  cols.forEach((col, i) => doc.text(col, colX[i], y));

  doc.setTextColor(0, 0, 0);
  y += 8;
  scores.forEach((cat, idx) => {
    if (idx % 2 === 0) {
      doc.setFillColor(239, 244, 255);
      doc.rect(8, y - 4, pageW - 16, 7, 'F');
    }
    doc.setFontSize(8);
    doc.text(`${cat.priority}`, colX[0], y);
    doc.text(cat.catalyst_name, colX[1], y);
    doc.text(cat.sub_catalysts.slice(0, 2).map(s => s.name).join(', '), colX[2], y);
    doc.text(`R ${formatZAR(cat.estimated_annual_saving_zar)}`, colX[3], y);
    doc.text(cat.confidence, colX[4], y);
    y += 7;
  });

  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text('All savings estimates based on industry benchmarks applied to your actual transaction data.', 10, y + 5);

  // Pages 4–N — Catalyst Deep Dives (top 5)
  const topCatalysts = scores.slice(0, 5);
  for (const cat of topCatalysts) {
    doc.addPage();
    doc.setFillColor(27, 58, 107);
    doc.rect(0, 0, pageW, 15, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(14);
    doc.text(`${cat.catalyst_name} — ${cat.domain}`, 10, 10);

    let py = 25;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text('Why we recommend this', 10, py);
    py += 8;

    doc.setFontSize(9);
    for (const insight of cat.data_insights) {
      const lines = doc.splitTextToSize(`• ${insight}`, pageW - 20);
      doc.text(lines, 10, py);
      py += lines.length * 5;
    }

    // Savings breakdown
    py += 5;
    doc.setFontSize(11);
    doc.text('Savings Breakdown', 10, py);
    py += 8;
    doc.setFontSize(8);
    for (const comp of cat.saving_components) {
      doc.text(`${comp.label}: R ${formatZAR(comp.amount_zar)}`, 12, py);
      doc.setTextColor(120, 120, 120);
      doc.text(`(${comp.methodology})`, 12, py + 4);
      doc.setTextColor(0, 0, 0);
      py += 10;
    }

    // Sub-catalyst deployment sequence
    py += 5;
    doc.setFontSize(11);
    doc.text('Sub-Catalyst Deployment Sequence', 10, py);
    py += 8;
    doc.setFontSize(9);
    cat.sub_catalysts.forEach((sc, i) => {
      doc.text(`${i + 1}. ${sc.name} — ${sc.estimated_monthly_volume} ${sc.volume_unit}/month`, 12, py);
      if (sc.deploy_prerequisite) {
        doc.setTextColor(120, 120, 120);
        doc.text(`Deploy after: ${sc.deploy_prerequisite}`, 16, py + 4);
        doc.setTextColor(0, 0, 0);
        py += 4;
      }
      py += 6;
    });
  }

  // Last Page — Deployment Roadmap
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Deployment Roadmap', 10, 10);

  doc.setTextColor(0, 0, 0);
  let ry = 28;
  const phases = [
    { label: 'Phase 1 (Month 1–2)', catalysts: scores.filter(c => c.deploy_order <= 2) },
    { label: 'Phase 2 (Month 3–4)', catalysts: scores.filter(c => c.deploy_order >= 3 && c.deploy_order <= 4) },
    { label: 'Phase 3 (Month 5–6)', catalysts: scores.filter(c => c.deploy_order >= 5) },
  ];

  for (const phase of phases) {
    if (phase.catalysts.length === 0) continue;
    doc.setFontSize(12);
    doc.text(phase.label, 10, ry);
    ry += 7;
    doc.setFontSize(9);
    for (const cat of phase.catalysts) {
      doc.text(`• ${cat.catalyst_name} — R ${formatZAR(cat.estimated_annual_saving_zar)}/year`, 14, ry);
      ry += 5;
    }
    ry += 5;
  }

  doc.setFontSize(11);
  doc.setTextColor(27, 58, 107);
  doc.text('Ready to activate? Contact GONXT Technology.', pageW / 2, ry + 15, { align: 'center' });

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

  // Page 1 — Cover
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 60, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(20);
  doc.text('Atheon Technical Sizing Report — INTERNAL', pageW / 2, 25, { align: 'center' });
  doc.setFontSize(12);
  doc.text(prospectName, pageW / 2, 38, { align: 'center' });
  doc.text(`Date: ${new Date().toLocaleDateString('en-ZA')}`, pageW / 2, 48, { align: 'center' });

  // Page 2 — Data Profile
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Data Profile', 10, 10);

  const profileRows: [string, string][] = [
    ['Monthly Invoices', `${snapshot.monthly_invoices}`],
    ['Monthly Purchase Orders', `${snapshot.monthly_purchase_orders}`],
    ['Monthly Journal Entries', `${snapshot.monthly_journal_entries}`],
    ['Total AR Balance', `R ${formatZAR(snapshot.total_ar_balance)}`],
    ['Total AP Balance', `R ${formatZAR(snapshot.total_ap_balance)}`],
    ['Overdue Invoices', `${snapshot.overdue_invoice_count} (R ${formatZAR(snapshot.overdue_invoice_value)})`],
    ['Total Revenue (12m)', `R ${formatZAR(snapshot.total_revenue_12m)}`],
    ['Total Spend (12m)', `R ${formatZAR(snapshot.total_spend_12m)}`],
    ['Employees', `${snapshot.employee_count}`],
    ['Monthly Payroll', `R ${formatZAR(snapshot.total_monthly_payroll)}`],
    ['Active Customers', `${snapshot.active_customer_count}`],
    ['Active Suppliers', `${snapshot.active_supplier_count}`],
    ['Products', `${snapshot.product_count}`],
    ['Inventory Value', `R ${formatZAR(snapshot.total_inventory_value)}`],
    ['Months of Data', `${snapshot.months_of_data}`],
    ['Data Completeness', `${snapshot.data_completeness_pct}%`],
    ['ERP System', snapshot.erp_system],
  ];

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  let y = 25;
  for (const [label, value] of profileRows) {
    doc.text(label, 10, y);
    doc.text(value, 100, y);
    y += 5;
  }

  // Page 3 — Infrastructure Sizing (SaaS)
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Infrastructure Sizing (SaaS)', 10, 10);

  const saasRows: [string, string, string][] = [
    ['Workers (base + API calls)', `${sizing.total_monthly_api_calls.toLocaleString()} calls/month`, `R ${formatZAR(sizing.cost_cf_workers)}`],
    ['D1 Database', `${sizing.total_db_size_gb} GB`, `R ${formatZAR(sizing.cost_cf_d1)}`],
    ['Vectorize', `${sizing.total_monthly_vector_queries.toLocaleString()} queries/month`, `R ${formatZAR(sizing.cost_cf_vectorize)}`],
    ['Workers AI', `${sizing.total_monthly_llm_tokens.toLocaleString()} tokens/month`, `R ${formatZAR(sizing.cost_cf_workers_ai)}`],
    ['R2 Storage', `${sizing.total_storage_gb} GB`, `R ${formatZAR(sizing.cost_cf_r2)}`],
    ['KV Reads', `${sizing.total_kv_reads_monthly.toLocaleString()} reads/month`, `R ${formatZAR(sizing.cost_cf_kv)}`],
  ];

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(8);
  y = 25;
  doc.text('Service', 10, y);
  doc.text('Monthly Volume', 80, y);
  doc.text('Monthly ZAR', 150, y);
  y += 6;
  for (const [svc, vol, cost] of saasRows) {
    doc.text(svc, 10, y);
    doc.text(vol, 80, y);
    doc.text(cost, 150, y);
    y += 5;
  }
  y += 3;
  doc.setFontSize(10);
  doc.text(`Total Infrastructure Cost/month: R ${formatZAR(sizing.total_infra_cost_pm_saas)}`, 10, y);
  y += 6;
  doc.text(`Monthly Revenue: R ${formatZAR(sizing.monthly_licence_revenue)}`, 10, y);
  y += 6;
  doc.text(`Gross Margin: ${sizing.gross_margin_pct_saas}%`, 10, y);

  // Page 4 — Infrastructure Sizing (On-Premise/Hybrid)
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Infrastructure Sizing (On-Premise / Hybrid)', 10, 10);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(9);
  y = 28;
  doc.text(`Support Cost (annual): R ${formatZAR(config.onprem_support_cost_pa)}`, 10, y); y += 6;
  doc.text(`Update Cost (annual): R ${formatZAR(config.onprem_update_cost_pa)}`, 10, y); y += 6;
  doc.text(`Total On-Prem Cost/month: R ${formatZAR(sizing.total_infra_cost_pm_onprem)}`, 10, y); y += 6;
  doc.text(`On-Prem Licence Fee (annual): R ${formatZAR(config.onprem_licence_fee_pa)}`, 10, y); y += 6;
  doc.text(`On-Prem Gross Margin: ${sizing.gross_margin_pct_onprem}%`, 10, y);

  // Last Page — Pricing Recommendation
  doc.addPage();
  doc.setFillColor(27, 58, 107);
  doc.rect(0, 0, pageW, 15, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.text('Pricing Recommendation', 10, 10);

  doc.setTextColor(0, 0, 0);
  doc.setFontSize(10);
  y = 28;
  doc.text(`Recommended Tier: ${config.deployment_model.toUpperCase()}`, 10, y); y += 8;

  const recLicence = config.deployment_model === 'saas'
    ? sizing.annual_licence_revenue
    : config.deployment_model === 'hybrid' ? config.hybrid_licence_fee_pa : config.onprem_licence_fee_pa;
  doc.text(`Recommended Licence Fee: R ${formatZAR(recLicence)}/year`, 10, y); y += 8;
  doc.text(`3-Year Contract Value: R ${formatZAR(recLicence * config.contract_years)}`, 10, y); y += 8;

  const recMargin = config.deployment_model === 'saas' ? sizing.gross_margin_pct_saas : sizing.gross_margin_pct_onprem;
  doc.text(`Gross Margin at Recommended Price: ${recMargin}%`, 10, y);

  return doc.output('arraybuffer');
}

// Excel Model generation
export async function generateExcelModel(
  scores: CatalystScore[],
  sizing: TechnicalSizing,
  config: AssessmentConfig,
  snapshot: VolumeSnapshot
): Promise<ArrayBuffer> {
  const XLSX = await import('xlsx');

  const wb = XLSX.utils.book_new();

  // Sheet 1 — Variables
  const varsData: (string | number)[][] = [
    ['Field', 'Value', 'Description', 'Unit'],
    ['saas_price_per_user_pm', config.saas_price_per_user_pm, 'SaaS price per user per month', 'ZAR'],
    ['onprem_licence_fee_pa', config.onprem_licence_fee_pa, 'On-premise licence fee per annum', 'ZAR'],
    ['hybrid_licence_fee_pa', config.hybrid_licence_fee_pa, 'Hybrid licence fee per annum', 'ZAR'],
    ['cf_cost_per_1m_api_calls', config.cf_cost_per_1m_api_calls, 'Cloudflare Workers cost per 1M API calls', 'ZAR'],
    ['cf_d1_cost_per_gb_pm', config.cf_d1_cost_per_gb_pm, 'D1 database cost per GB per month', 'ZAR'],
    ['cf_r2_cost_per_gb_pm', config.cf_r2_cost_per_gb_pm, 'R2 storage cost per GB per month', 'ZAR'],
    ['cf_vectorize_cost_per_1m_queries', config.cf_vectorize_cost_per_1m_queries, 'Vectorize cost per 1M queries', 'ZAR'],
    ['cf_workers_ai_cost_per_1m_tokens', config.cf_workers_ai_cost_per_1m_tokens, 'Workers AI cost per 1M tokens', 'ZAR'],
    ['cf_kv_cost_per_1m_reads', config.cf_kv_cost_per_1m_reads, 'KV cost per 1M reads', 'ZAR'],
    ['cf_base_pm', config.cf_base_pm, 'CF Workers fixed plan cost per month', 'ZAR'],
    ['onprem_support_cost_pa', config.onprem_support_cost_pa, 'GONXT support overhead per annum', 'ZAR'],
    ['onprem_update_cost_pa', config.onprem_update_cost_pa, 'Model update delivery per annum', 'ZAR'],
    ['ar_savings_pct', config.ar_savings_pct, 'AR balance recovery rate', '%'],
    ['ap_savings_pct', config.ap_savings_pct, 'AP processing saving rate', '%'],
    ['invoice_recon_savings_pct', config.invoice_recon_savings_pct, 'Invoice reconciliation saving rate', '%'],
    ['procurement_savings_pct', config.procurement_savings_pct, 'Procurement saving via supplier scoring', '%'],
    ['workforce_savings_pct', config.workforce_savings_pct, 'Payroll saving via scheduling', '%'],
    ['supply_chain_savings_pct', config.supply_chain_savings_pct, 'Inventory optimisation saving', '%'],
    ['compliance_fine_avoidance_pct', config.compliance_fine_avoidance_pct, 'Revenue % as avoided fines', '%'],
    ['maintenance_savings_pct', config.maintenance_savings_pct, 'Maintenance spend saving via prediction', '%'],
    ['deployment_model', config.deployment_model, 'Deployment model', ''],
    ['currency', config.currency, 'Display currency', ''],
    ['exchange_rate_to_zar', config.exchange_rate_to_zar, 'Exchange rate to ZAR', ''],
    ['target_users', config.target_users, 'Target number of users', ''],
    ['contract_years', config.contract_years, 'Contract duration', 'years'],
  ];

  const varsSheet = XLSX.utils.aoa_to_sheet(varsData);
  // Yellow highlight on value column (B)
  for (let i = 1; i < varsData.length; i++) {
    const cell = varsSheet[XLSX.utils.encode_cell({ r: i, c: 1 })];
    if (cell) {
      cell.s = { fill: { fgColor: { rgb: 'FFFF00' } } };
    }
  }
  XLSX.utils.book_append_sheet(wb, varsSheet, 'Variables');

  // Sheet 2 — Volume Data
  const volData: (string | number)[][] = [
    ['Metric', 'Value', 'Description'],
    ['monthly_invoices', snapshot.monthly_invoices, 'Average invoices per month'],
    ['monthly_purchase_orders', snapshot.monthly_purchase_orders, 'Average POs per month'],
    ['monthly_journal_entries', snapshot.monthly_journal_entries, 'Average journal entries per month'],
    ['monthly_bank_transactions', snapshot.monthly_bank_transactions, 'Average bank transactions per month'],
    ['total_ar_balance', snapshot.total_ar_balance, 'Total AR balance outstanding'],
    ['total_ap_balance', snapshot.total_ap_balance, 'Total AP balance outstanding'],
    ['overdue_invoice_count', snapshot.overdue_invoice_count, 'Number of overdue invoices'],
    ['overdue_invoice_value', snapshot.overdue_invoice_value, 'Value of overdue invoices'],
    ['avg_invoice_value', snapshot.avg_invoice_value, 'Average invoice value'],
    ['total_revenue_12m', snapshot.total_revenue_12m, 'Total revenue last 12 months'],
    ['total_spend_12m', snapshot.total_spend_12m, 'Total spend last 12 months'],
    ['employee_count', snapshot.employee_count, 'Active employees'],
    ['total_monthly_payroll', snapshot.total_monthly_payroll, 'Total monthly payroll'],
    ['active_customer_count', snapshot.active_customer_count, 'Active customers'],
    ['active_supplier_count', snapshot.active_supplier_count, 'Active suppliers'],
    ['product_count', snapshot.product_count, 'Active products'],
    ['total_inventory_value', snapshot.total_inventory_value, 'Total inventory value'],
    ['months_of_data', snapshot.months_of_data, 'Months of historical data'],
    ['data_completeness_pct', snapshot.data_completeness_pct, 'Data completeness score'],
    ['erp_system', snapshot.erp_system, 'Source ERP system'],
  ];

  const volSheet = XLSX.utils.aoa_to_sheet(volData);
  XLSX.utils.book_append_sheet(wb, volSheet, 'Volume Data');

  // Sheet 3 — Catalyst Savings Model
  const savingsData: (string | number)[][] = [
    ['Catalyst', 'Sub-Catalyst', 'Volume/Month', 'Unit', 'Savings Formula', 'Est. Annual Saving (ZAR)', 'Confidence'],
  ];

  let grandTotal = 0;
  for (const cat of scores) {
    let catTotal = 0;
    for (const sc of cat.sub_catalysts) {
      savingsData.push([
        cat.catalyst_name, sc.name,
        sc.estimated_monthly_volume, sc.volume_unit,
        `See Variables sheet`, sc.estimated_annual_saving_zar, cat.confidence,
      ]);
      catTotal += sc.estimated_annual_saving_zar;
    }
    savingsData.push([cat.catalyst_name + ' — SUBTOTAL', '', '', '', '', catTotal, '']);
    grandTotal += catTotal;
  }
  savingsData.push(['GRAND TOTAL', '', '', '', '', grandTotal, '']);

  const savingsSheet = XLSX.utils.aoa_to_sheet(savingsData);
  XLSX.utils.book_append_sheet(wb, savingsSheet, 'Catalyst Savings Model');

  // Sheet 4 — Infrastructure Cost Model
  const infraData: (string | number | string)[][] = [
    ['', 'SaaS', 'On-Premise'],
    ['Workers (base + API)', sizing.cost_cf_workers, 0],
    ['D1 Database', sizing.cost_cf_d1, 0],
    ['Vectorize', sizing.cost_cf_vectorize, 0],
    ['Workers AI', sizing.cost_cf_workers_ai, 0],
    ['R2 Storage', sizing.cost_cf_r2, 0],
    ['KV Reads', sizing.cost_cf_kv, 0],
    ['Support Cost/month', 0, sizing.total_infra_cost_pm_onprem * 0.714], // ~120k/168k
    ['Update Cost/month', 0, sizing.total_infra_cost_pm_onprem * 0.286], // ~48k/168k
    ['Total Infra Cost/month', sizing.total_infra_cost_pm_saas, sizing.total_infra_cost_pm_onprem],
    ['Monthly Revenue', sizing.monthly_licence_revenue, config.onprem_licence_fee_pa / 12],
    ['Gross Margin/month', sizing.gross_margin_pm_saas, sizing.gross_margin_pm_onprem],
    ['Gross Margin %', sizing.gross_margin_pct_saas, sizing.gross_margin_pct_onprem],
    ['Payback Period (months)', grandTotal > 0 ? Math.round((sizing.annual_licence_revenue / grandTotal) * 12) : 0, grandTotal > 0 ? Math.round((config.onprem_licence_fee_pa / grandTotal) * 12) : 0],
  ];

  const infraSheet = XLSX.utils.aoa_to_sheet(infraData);
  XLSX.utils.book_append_sheet(wb, infraSheet, 'Infrastructure Cost Model');

  // Write workbook to ArrayBuffer
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
      const result = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
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
    const paybackMonths = annualLicence > 0 ? Math.round((annualLicence / totalSaving) * 12) : 0;

    const narrative = await generateNarrative(catalystScores, ai, totalSaving);

    const results: AssessmentResults = {
      catalyst_scores: catalystScores,
      technical_sizing: technicalSizing,
      total_estimated_annual_saving_zar: totalSaving,
      payback_months: paybackMonths,
      narrative_summary: narrative,
    };

    // 6–7. Generate reports
    const businessPdf = await generateBusinessReportPDF(catalystScores, technicalSizing, config, prospectName, narrative, snapshot);
    const technicalPdf = await generateTechnicalReportPDF(catalystScores, technicalSizing, config, prospectName, snapshot);
    const excelModel = await generateExcelModel(catalystScores, technicalSizing, config, snapshot);

    // 8. Upload to storage
    const businessKey = `assessments/${assessmentId}/business-report.pdf`;
    const technicalKey = `assessments/${assessmentId}/technical-report.pdf`;
    const excelKey = `assessments/${assessmentId}/model.xlsx`;

    await storage.put(businessKey, businessPdf, { httpMetadata: { contentType: 'application/pdf' } });
    await storage.put(technicalKey, technicalPdf, { httpMetadata: { contentType: 'application/pdf' } });
    await storage.put(excelKey, excelModel, { httpMetadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' } });

    // 9. Mark complete
    await db.prepare(
      "UPDATE assessments SET status = 'complete', results = ?, data_snapshot = ?, business_report_key = ?, technical_report_key = ?, excel_model_key = ?, completed_at = datetime('now') WHERE id = ?"
    ).bind(
      JSON.stringify(results),
      JSON.stringify(snapshot),
      businessKey,
      technicalKey,
      excelKey,
      assessmentId
    ).run();

  } catch (err) {
    console.error('Assessment engine error:', err);
    // 10. Mark failed
    await db.prepare(
      "UPDATE assessments SET status = 'failed', results = ? WHERE id = ?"
    ).bind(JSON.stringify({ error: (err as Error).message }), assessmentId).run();
  }
}
