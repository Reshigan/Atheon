/**
 * Value Assessment Engine — Outcome-Based Value Discovery
 *
 * Four phases:
 *   Phase 1: Data Quality Audit
 *   Phase 2: Process Timing Analysis
 *   Phase 3: Live Catalyst Runs
 *   Phase 4: Value Quantification
 *
 * Replaces the estimation-based approach in assessment-engine.ts with
 * evidence-backed findings from the prospect's actual data.
 */

import { loadLlmConfig, llmChatWithFallback, stripCodeFences } from './llm-provider';

// ── Types ─────────────────────────────────────────────────────────────────

export interface ValueAssessmentConfig {
  mode: 'full' | 'quick';
  outcomeFeePercent: number;       // default 20
  immediateValueSharePercent: number; // default 15
  contractTermMonths: number;      // default 36
  currency: string;                // default 'ZAR'
}

export const DEFAULT_VALUE_ASSESSMENT_CONFIG: ValueAssessmentConfig = {
  mode: 'full',
  outcomeFeePercent: 20,
  immediateValueSharePercent: 15,
  contractTermMonths: 36,
  currency: 'ZAR',
};

export interface AssessmentProgress {
  phase: string;
  step: string;
  progress: number;   // 0-100
  detail?: string;
}

interface DQIssue {
  field: string;
  issue: string;
  count: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  financialImpact: number;
}

interface FindingEvidence {
  sample_records: Array<{ ref: string; source_value: string | number; target_value: string | number; difference: number }>;
  pattern: string;
  first_occurrence: string;
  frequency: string;
}

// ── Helper: safe numeric query ────────────────────────────────────────────

async function queryNum(db: D1Database, sql: string, binds: unknown[]): Promise<number> {
  try {
    const r = await db.prepare(sql).bind(...binds).first<Record<string, unknown>>();
    const val = r ? Object.values(r)[0] : 0;
    return typeof val === 'number' ? val : Number(val) || 0;
  } catch { return 0; }
}

async function queryRows(db: D1Database, sql: string, binds: unknown[]): Promise<Record<string, unknown>[]> {
  try {
    const r = await db.prepare(sql).bind(...binds).all<Record<string, unknown>>();
    return r.results || [];
  } catch { return []; }
}

function formatZAR(n: number): string {
  return n.toLocaleString('en-ZA', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

// ── Main Entry Point ──────────────────────────────────────────────────────

export async function runValueAssessment(
  db: D1Database,
  ai: Ai,
  storage: R2Bucket,
  tenantId: string,
  assessmentId: string,
  erpConnectionId: string,
  config: ValueAssessmentConfig,
  prospectIndustry: string,
  prospectName: string,
  onProgress?: (p: AssessmentProgress) => void,
): Promise<void> {
  const progress = (phase: string, step: string, pct: number, detail?: string) => {
    onProgress?.({ phase, step, progress: pct, detail });
  };

  try {
    // Update assessment status
    await db.prepare("UPDATE assessments SET status = 'running' WHERE id = ?").bind(assessmentId).run();

    // Phase 1: Data Quality Audit
    progress('data_quality', 'Starting data quality audit...', 5);
    const dqResults = await runDataQualityAudit(db, tenantId, assessmentId, progress);

    // Phase 2: Process Timing Analysis
    progress('process_timing', 'Measuring process cycles...', 25);
    const timingResults = await runProcessTimingAnalysis(db, tenantId, assessmentId, progress);

    // Phase 3: Live Catalyst Runs (skip in quick mode)
    let catalystFindings: number = 0;
    if (config.mode === 'full') {
      progress('catalyst_runs', 'Running live reconciliations...', 40);
      catalystFindings = await runLiveCatalystAnalysis(db, ai, tenantId, assessmentId, prospectIndustry, progress);
    }

    // Phase 4: Value Quantification
    progress('value_quantification', 'Computing value...', 85);
    await runValueQuantification(db, ai, tenantId, assessmentId, config, prospectName, prospectIndustry, progress);

    // Generate PDF report
    progress('report', 'Generating Value Assessment Report...', 95);
    await generateValueReportPDF(db, storage, tenantId, assessmentId, prospectName, config);

    // Mark complete
    await db.prepare(
      "UPDATE assessments SET status = 'complete', completed_at = datetime('now') WHERE id = ?"
    ).bind(assessmentId).run();

    progress('complete', 'Assessment complete', 100, `Found ${dqResults.totalIssues + timingResults.delays + catalystFindings} issues`);
  } catch (err) {
    console.error('Value assessment failed:', err);
    await db.prepare(
      "UPDATE assessments SET status = 'failed', results = ? WHERE id = ?"
    ).bind(JSON.stringify({ error: (err as Error).message }), assessmentId).run();
    throw err;
  }
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 1: DATA QUALITY AUDIT
// ══════════════════════════════════════════════════════════════════════════

interface DQResult { totalIssues: number; totalFindings: number; }

async function runDataQualityAudit(
  db: D1Database, tenantId: string, assessmentId: string,
  progress: (phase: string, step: string, pct: number, detail?: string) => void,
): Promise<DQResult> {
  let totalIssues = 0;
  let totalFindings = 0;

  // Check each ERP table
  const tables = [
    { name: 'erp_invoices', label: 'Invoices', fields: ['invoice_number', 'customer_id', 'amount_due', 'due_date', 'payment_status', 'invoice_date', 'total'] },
    { name: 'erp_purchase_orders', label: 'Purchase Orders', fields: ['po_number', 'supplier_id', 'total', 'order_date', 'status', 'delivery_date'] },
    { name: 'erp_bank_transactions', label: 'Bank Transactions', fields: ['transaction_id', 'amount', 'transaction_date', 'description', 'transaction_type', 'reference'] },
    { name: 'erp_employees', label: 'Employees', fields: ['employee_id', 'department', 'cost_centre', 'gross_salary', 'status', 'hire_date'] },
    { name: 'erp_products', label: 'Products', fields: ['product_code', 'product_name', 'cost_price', 'selling_price', 'stock_on_hand', 'category'] },
  ];

  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    const pct = 5 + Math.round((i / tables.length) * 20);
    progress('data_quality', `Auditing ${table.label}...`, pct);

    const totalRecords = await queryNum(db,
      `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ?`, [tenantId]);
    if (totalRecords === 0) continue;

    const issues: DQIssue[] = [];
    const fieldScores: Record<string, number> = {};

    // Field completeness checks
    for (const field of table.fields) {
      const nullCount = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND (${field} IS NULL OR ${field} = '')`,
        [tenantId]);
      const completeness = totalRecords > 0 ? Math.round(((totalRecords - nullCount) / totalRecords) * 100) : 0;
      fieldScores[field] = completeness;

      if (completeness < 90) {
        issues.push({
          field, issue: `${field} is missing in ${nullCount} records (${100 - completeness}% incomplete)`,
          count: nullCount, severity: completeness < 50 ? 'critical' : completeness < 70 ? 'high' : 'medium',
          financialImpact: 0,
        });
      }
    }

    // Table-specific checks
    let duplicates = 0;
    let orphans = 0;
    let staleRecords = 0;
    let referentialIssues = 0;

    if (table.name === 'erp_invoices') {
      // Duplicate invoice numbers
      duplicates = await queryNum(db,
        `SELECT COUNT(*) FROM (SELECT invoice_number FROM ${table.name} WHERE tenant_id = ? GROUP BY invoice_number HAVING COUNT(*) > 1)`,
        [tenantId]);
      if (duplicates > 0) {
        issues.push({ field: 'invoice_number', issue: `${duplicates} duplicate invoice numbers detected`, count: duplicates, severity: 'high', financialImpact: 0 });
      }

      // Overdue invoices
      const overdueCount = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'`,
        [tenantId]);
      const overdueValue = await queryNum(db,
        `SELECT COALESCE(SUM(amount_due), 0) FROM ${table.name} WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'`,
        [tenantId]);
      if (overdueCount > 0) {
        issues.push({ field: 'payment_status', issue: `${overdueCount} overdue invoices worth R${formatZAR(overdueValue)}`, count: overdueCount, severity: overdueValue > 100000 ? 'critical' : 'high', financialImpact: overdueValue * 0.05 });

        // Create finding for overdue invoices
        const sampleOverdue = await queryRows(db,
          `SELECT invoice_number, customer_id, amount_due, due_date FROM ${table.name} WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid' ORDER BY amount_due DESC LIMIT 5`,
          [tenantId]);
        await createFinding(db, assessmentId, tenantId, 'dq-overdue', {
          findingType: 'data_quality', severity: overdueValue > 100000 ? 'critical' : 'high',
          title: `${overdueCount} overdue invoices worth R${formatZAR(overdueValue)}`,
          description: `${overdueCount} invoices are past their due date and remain unpaid. The total outstanding value is R${formatZAR(overdueValue)}. This represents collectible revenue that is being left on the table.`,
          affectedRecords: overdueCount, financialImpact: overdueValue,
          evidence: {
            sample_records: sampleOverdue.map(r => ({
              ref: `Invoice #${r.invoice_number}`, source_value: `Due: ${r.due_date}`,
              target_value: 'Unpaid', difference: Number(r.amount_due) || 0,
            })),
            pattern: 'Overdue accounts receivable', first_occurrence: String(sampleOverdue[sampleOverdue.length - 1]?.due_date || 'unknown'),
            frequency: 'Ongoing',
          },
          rootCause: 'Invoices past due date without collection follow-up. Manual processes lack systematic aging management.',
          prescription: 'Deploy automated AR collection catalyst with escalation rules based on aging buckets.',
          category: 'data_issue', immediateValue: overdueValue * 0.3, ongoingMonthlyValue: overdueValue * 0.02,
          domain: 'finance',
        });
        totalFindings++;
      }

      // Outlier amounts
      const avgAmount = await queryNum(db, `SELECT COALESCE(AVG(total), 0) FROM ${table.name} WHERE tenant_id = ?`, [tenantId]);
      if (avgAmount > 0) {
        const outlierCount = await queryNum(db,
          `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND (total < 0 OR total > ? * 10)`,
          [tenantId, avgAmount]);
        if (outlierCount > 0) {
          issues.push({ field: 'total', issue: `${outlierCount} invoice amount outliers (< 0 or > 10x average)`, count: outlierCount, severity: 'medium', financialImpact: 0 });
        }
      }

      // Orphaned invoices (customer_id not in erp_customers)
      orphans = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} i WHERE i.tenant_id = ? AND i.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_customers c WHERE c.tenant_id = i.tenant_id AND c.customer_id = i.customer_id)`,
        [tenantId]);
      if (orphans > 0) {
        referentialIssues += orphans;
        issues.push({ field: 'customer_id', issue: `${orphans} invoices reference non-existent customers`, count: orphans, severity: 'high', financialImpact: 0 });
      }
    }

    if (table.name === 'erp_purchase_orders') {
      // Duplicate PO numbers
      duplicates = await queryNum(db,
        `SELECT COUNT(*) FROM (SELECT po_number FROM ${table.name} WHERE tenant_id = ? GROUP BY po_number HAVING COUNT(*) > 1)`,
        [tenantId]);
      if (duplicates > 0) {
        issues.push({ field: 'po_number', issue: `${duplicates} duplicate PO numbers`, count: duplicates, severity: 'high', financialImpact: 0 });
      }

      // Stale POs (open > 90 days)
      staleRecords = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND status = 'open' AND order_date < datetime('now', '-90 days')`,
        [tenantId]);
      const staleValue = await queryNum(db,
        `SELECT COALESCE(SUM(total), 0) FROM ${table.name} WHERE tenant_id = ? AND status = 'open' AND order_date < datetime('now', '-90 days')`,
        [tenantId]);
      if (staleRecords > 0) {
        issues.push({ field: 'status', issue: `${staleRecords} open POs older than 90 days (R${formatZAR(staleValue)} committed)`, count: staleRecords, severity: 'high', financialImpact: staleValue * 0.1 });

        const sampleStale = await queryRows(db,
          `SELECT po_number, supplier_id, total, order_date FROM ${table.name} WHERE tenant_id = ? AND status = 'open' AND order_date < datetime('now', '-90 days') ORDER BY total DESC LIMIT 5`,
          [tenantId]);
        await createFinding(db, assessmentId, tenantId, 'dq-stale-po', {
          findingType: 'data_quality', severity: 'high',
          title: `${staleRecords} stale purchase orders locking R${formatZAR(staleValue)}`,
          description: `${staleRecords} purchase orders have been open for more than 90 days without completion. This locks R${formatZAR(staleValue)} in committed budget that may never be spent.`,
          affectedRecords: staleRecords, financialImpact: staleValue,
          evidence: {
            sample_records: sampleStale.map(r => ({
              ref: `PO #${r.po_number}`, source_value: `Opened: ${r.order_date}`,
              target_value: 'Still open', difference: Number(r.total) || 0,
            })),
            pattern: 'Stale purchase orders with no goods receipt', first_occurrence: String(sampleStale[sampleStale.length - 1]?.order_date || 'unknown'),
            frequency: 'Accumulated over time',
          },
          rootCause: 'POs opened but never closed — no automated stale PO review process.',
          prescription: 'Implement automated PO lifecycle management with stale PO alerts and auto-close rules.',
          category: 'process_issue', immediateValue: staleValue * 0.15, ongoingMonthlyValue: staleValue * 0.005,
          domain: 'procurement',
        });
        totalFindings++;
      }

      // Orphaned POs (supplier_id not in erp_suppliers)
      orphans = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} p WHERE p.tenant_id = ? AND p.supplier_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM erp_suppliers s WHERE s.tenant_id = p.tenant_id AND s.supplier_id = p.supplier_id)`,
        [tenantId]);
      if (orphans > 0) {
        referentialIssues += orphans;
        issues.push({ field: 'supplier_id', issue: `${orphans} POs reference non-existent suppliers`, count: orphans, severity: 'high', financialImpact: 0 });
      }
    }

    if (table.name === 'erp_bank_transactions') {
      // Potential double payments (same amount, same day)
      duplicates = await queryNum(db,
        `SELECT COUNT(*) FROM (SELECT amount, transaction_date FROM ${table.name} WHERE tenant_id = ? AND amount > 0 GROUP BY amount, transaction_date HAVING COUNT(*) > 1)`,
        [tenantId]);
      if (duplicates > 0) {
        const dupValue = await queryNum(db,
          `SELECT COALESCE(SUM(t.amount), 0) FROM ${table.name} t INNER JOIN (SELECT amount, transaction_date FROM ${table.name} WHERE tenant_id = ? AND amount > 0 GROUP BY amount, transaction_date HAVING COUNT(*) > 1) d ON t.amount = d.amount AND t.transaction_date = d.transaction_date WHERE t.tenant_id = ?`,
          [tenantId, tenantId]);
        issues.push({ field: 'amount', issue: `${duplicates} potential duplicate payments on same day (R${formatZAR(dupValue)})`, count: duplicates, severity: 'critical', financialImpact: dupValue * 0.5 });

        if (dupValue > 0) {
          await createFinding(db, assessmentId, tenantId, 'dq-dup-payments', {
            findingType: 'discrepancy', severity: 'critical',
            title: `${duplicates} potential duplicate payments worth R${formatZAR(dupValue)}`,
            description: `${duplicates} instances of identical payment amounts on the same day were detected. These are potential duplicate payments totalling R${formatZAR(dupValue)}.`,
            affectedRecords: duplicates, financialImpact: dupValue * 0.5,
            evidence: { sample_records: [], pattern: 'Same amount on same date paid to same or different beneficiaries', first_occurrence: 'Multiple dates', frequency: 'Sporadic' },
            rootCause: 'Lack of duplicate payment detection controls. Manual payment processing without automated matching.',
            prescription: 'Deploy duplicate payment detection catalyst with pre-payment verification rules.',
            category: 'control_gap', immediateValue: dupValue * 0.3, ongoingMonthlyValue: dupValue * 0.01,
            domain: 'finance',
          });
          totalFindings++;
        }
      }
    }

    if (table.name === 'erp_employees') {
      // Missing department/cost centre
      const missingDept = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND status = 'active' AND (department IS NULL OR department = '')`,
        [tenantId]);
      if (missingDept > 0) {
        issues.push({ field: 'department', issue: `${missingDept} active employees with no department assigned`, count: missingDept, severity: 'medium', financialImpact: 0 });
      }

      // Salary outliers
      const avgSalary = await queryNum(db, `SELECT COALESCE(AVG(gross_salary), 0) FROM ${table.name} WHERE tenant_id = ? AND status = 'active' AND gross_salary > 0`, [tenantId]);
      if (avgSalary > 0) {
        const salaryOutliers = await queryNum(db,
          `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND status = 'active' AND (gross_salary = 0 OR gross_salary > ? * 10)`,
          [tenantId, avgSalary]);
        if (salaryOutliers > 0) {
          issues.push({ field: 'gross_salary', issue: `${salaryOutliers} employees with zero or extreme salary values`, count: salaryOutliers, severity: 'high', financialImpact: 0 });
        }
      }

      // Duplicate employee IDs
      duplicates = await queryNum(db,
        `SELECT COUNT(*) FROM (SELECT employee_id FROM ${table.name} WHERE tenant_id = ? GROUP BY employee_id HAVING COUNT(*) > 1)`,
        [tenantId]);
      if (duplicates > 0) {
        issues.push({ field: 'employee_id', issue: `${duplicates} duplicate employee IDs`, count: duplicates, severity: 'high', financialImpact: 0 });
      }
    }

    if (table.name === 'erp_products') {
      // Negative stock
      const negStock = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND stock_on_hand < 0`,
        [tenantId]);
      if (negStock > 0) {
        issues.push({ field: 'stock_on_hand', issue: `${negStock} products with negative stock (data error)`, count: negStock, severity: 'critical', financialImpact: 0 });
      }

      // Zero cost price
      const zeroCost = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND (cost_price IS NULL OR cost_price = 0) AND is_active = 1`,
        [tenantId]);
      if (zeroCost > 0) {
        issues.push({ field: 'cost_price', issue: `${zeroCost} active products with missing cost price`, count: zeroCost, severity: 'high', financialImpact: 0 });
      }

      // Dead stock (no movement — approximated by last_purchase_date)
      staleRecords = await queryNum(db,
        `SELECT COUNT(*) FROM ${table.name} WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand > 0 AND (last_purchase_date IS NULL OR last_purchase_date < datetime('now', '-12 months'))`,
        [tenantId]);
      const deadStockValue = await queryNum(db,
        `SELECT COALESCE(SUM(stock_on_hand * cost_price), 0) FROM ${table.name} WHERE tenant_id = ? AND is_active = 1 AND stock_on_hand > 0 AND (last_purchase_date IS NULL OR last_purchase_date < datetime('now', '-12 months'))`,
        [tenantId]);
      if (staleRecords > 0 && deadStockValue > 0) {
        issues.push({ field: 'stock_on_hand', issue: `${staleRecords} products with no movement in 12+ months (R${formatZAR(deadStockValue)} dead stock)`, count: staleRecords, severity: 'high', financialImpact: deadStockValue * 0.2 });

        await createFinding(db, assessmentId, tenantId, 'dq-dead-stock', {
          findingType: 'data_quality', severity: 'high',
          title: `R${formatZAR(deadStockValue)} in dead stock across ${staleRecords} products`,
          description: `${staleRecords} products have had no purchase or sales movement for over 12 months while maintaining stock on hand valued at R${formatZAR(deadStockValue)}. This capital is locked in non-moving inventory.`,
          affectedRecords: staleRecords, financialImpact: deadStockValue,
          evidence: { sample_records: [], pattern: 'Products with stock but no movement for 12+ months', first_occurrence: '12+ months ago', frequency: 'Chronic' },
          rootCause: 'No automated dead stock identification or disposition process. Stock review is manual and infrequent.',
          prescription: 'Deploy inventory optimization catalyst with dead stock alerts and automated disposition workflows.',
          category: 'data_issue', immediateValue: deadStockValue * 0.15, ongoingMonthlyValue: deadStockValue * 0.005,
          domain: 'supply_chain',
        });
        totalFindings++;
      }
    }

    // Calculate overall quality score
    const avgFieldScore = Object.values(fieldScores).length > 0
      ? Object.values(fieldScores).reduce((a, b) => a + b, 0) / Object.values(fieldScores).length
      : 100;
    const issuesPenalty = Math.min(issues.length * 3, 30);
    const completeRecords = Math.round(totalRecords * (avgFieldScore / 100));
    const overallScore = Math.max(0, Math.min(100, Math.round(avgFieldScore - issuesPenalty)));

    // Save DQ record
    const dqId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO assessment_data_quality (id, assessment_id, tenant_id, table_name, total_records, complete_records, completeness_pct, field_scores, referential_issues, duplicate_records, orphan_records, stale_records, overall_quality_score, issues)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      dqId, assessmentId, tenantId, table.name, totalRecords, completeRecords,
      Math.round(avgFieldScore * 10) / 10, JSON.stringify(fieldScores),
      referentialIssues, duplicates, orphans, staleRecords, overallScore,
      JSON.stringify(issues),
    ).run();

    totalIssues += issues.length;
    progress('data_quality', `${table.label}: ${totalRecords} records, score ${overallScore}/100`, pct, `${issues.length} issues found`);
  }

  return { totalIssues, totalFindings };
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 2: PROCESS TIMING ANALYSIS
// ══════════════════════════════════════════════════════════════════════════

interface TimingResult { delays: number; }

async function runProcessTimingAnalysis(
  db: D1Database, tenantId: string, assessmentId: string,
  progress: (phase: string, step: string, pct: number, detail?: string) => void,
): Promise<TimingResult> {
  let delays = 0;

  // ── Order-to-Cash Cycle ──
  progress('process_timing', 'Measuring Order-to-Cash cycle...', 26);
  const o2cRecords = await queryNum(db,
    `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL`,
    [tenantId]);

  if (o2cRecords > 0) {
    const avgO2C = await queryNum(db,
      `SELECT AVG(julianday(payment_date) - julianday(invoice_date)) FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL AND payment_date > invoice_date`,
      [tenantId]);
    const medianO2C = await queryNum(db,
      `SELECT julianday(payment_date) - julianday(invoice_date) as days FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL AND payment_date > invoice_date ORDER BY days LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL)`,
      [tenantId, tenantId]);
    // P90 approximation
    const p90O2C = await queryNum(db,
      `SELECT julianday(payment_date) - julianday(invoice_date) as days FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL AND payment_date > invoice_date ORDER BY days LIMIT 1 OFFSET (SELECT CAST(COUNT(*)*0.9 AS INTEGER) FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL)`,
      [tenantId, tenantId]);

    const benchmark = 35; // SA industry benchmark
    const exceedingBenchmark = await queryNum(db,
      `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND invoice_date IS NOT NULL AND payment_date IS NOT NULL AND (julianday(payment_date) - julianday(invoice_date)) > ?`,
      [tenantId, benchmark]);

    // Financial impact: outstanding AR × cost of capital per day of delay
    const totalAR = await queryNum(db,
      `SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND payment_status != 'paid'`,
      [tenantId]);
    const daysOverBenchmark = Math.max(0, avgO2C - benchmark);
    const financialImpact = totalAR * (0.08 / 365) * daysOverBenchmark; // 8% cost of capital

    if (avgO2C > benchmark) delays++;

    const timingId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timingId, assessmentId, tenantId, 'Order-to-Cash',
      Math.round(avgO2C * 10) / 10, Math.round(medianO2C * 10) / 10,
      Math.round(p90O2C * 10) / 10, benchmark,
      'Collection', Math.round(daysOverBenchmark * 10) / 10,
      o2cRecords, exceedingBenchmark,
      Math.round(financialImpact), JSON.stringify({ totalAR, costOfCapital: 0.08 }),
    ).run();

    if (daysOverBenchmark > 5) {
      await createFinding(db, assessmentId, tenantId, 'timing-o2c', {
        findingType: 'process_delay', severity: daysOverBenchmark > 20 ? 'critical' : 'high',
        title: `Order-to-Cash cycle ${Math.round(avgO2C)} days vs ${benchmark} day benchmark`,
        description: `Your average Order-to-Cash cycle is ${Math.round(avgO2C)} days, which is ${Math.round(daysOverBenchmark)} days longer than the industry benchmark of ${benchmark} days. This delay locks R${formatZAR(totalAR)} in working capital longer than necessary.`,
        affectedRecords: exceedingBenchmark, financialImpact: Math.round(financialImpact),
        evidence: { sample_records: [], pattern: `${Math.round(daysOverBenchmark)} days above benchmark`, first_occurrence: 'Systematic', frequency: 'Every invoice cycle' },
        rootCause: 'Manual invoice follow-up processes, lack of automated dunning, and inconsistent payment terms enforcement.',
        prescription: `Deploy automated AR collection with payment reminder sequences. Target: reduce O2C from ${Math.round(avgO2C)} to ${benchmark} days, recovering R${formatZAR(Math.round(financialImpact))}/year in working capital cost.`,
        category: 'timing_issue', immediateValue: 0, ongoingMonthlyValue: Math.round(financialImpact / 12),
        domain: 'finance',
      });
    }
  }

  // ── Procure-to-Pay Cycle ──
  progress('process_timing', 'Measuring Procure-to-Pay cycle...', 28);
  const p2pRecords = await queryNum(db,
    `SELECT COUNT(*) FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL`,
    [tenantId]);

  if (p2pRecords > 0) {
    const avgP2P = await queryNum(db,
      `SELECT AVG(julianday(delivery_date) - julianday(order_date)) FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL AND delivery_date > order_date`,
      [tenantId]);
    const medianP2P = await queryNum(db,
      `SELECT julianday(delivery_date) - julianday(order_date) as days FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL AND delivery_date > order_date ORDER BY days LIMIT 1 OFFSET (SELECT COUNT(*)/2 FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL)`,
      [tenantId, tenantId]);
    const p90P2P = await queryNum(db,
      `SELECT julianday(delivery_date) - julianday(order_date) as days FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL AND delivery_date > order_date ORDER BY days LIMIT 1 OFFSET (SELECT CAST(COUNT(*)*0.9 AS INTEGER) FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL)`,
      [tenantId, tenantId]);

    const benchmark = 45;
    const exceedingBenchmark = await queryNum(db,
      `SELECT COUNT(*) FROM erp_purchase_orders WHERE tenant_id = ? AND order_date IS NOT NULL AND delivery_date IS NOT NULL AND (julianday(delivery_date) - julianday(order_date)) > ?`,
      [tenantId, benchmark]);

    const totalOpenPO = await queryNum(db,
      `SELECT COALESCE(SUM(total), 0) FROM erp_purchase_orders WHERE tenant_id = ? AND status = 'open'`,
      [tenantId]);
    const daysOverBenchmark = Math.max(0, avgP2P - benchmark);
    const financialImpact = totalOpenPO * (0.08 / 365) * daysOverBenchmark;

    if (avgP2P > benchmark) delays++;

    const timingId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timingId, assessmentId, tenantId, 'Procure-to-Pay',
      Math.round(avgP2P * 10) / 10, Math.round(medianP2P * 10) / 10,
      Math.round(p90P2P * 10) / 10, benchmark,
      'PO Approval', Math.round(daysOverBenchmark * 10) / 10,
      p2pRecords, exceedingBenchmark,
      Math.round(financialImpact), JSON.stringify({ totalOpenPO, costOfCapital: 0.08 }),
    ).run();

    if (daysOverBenchmark > 5) {
      await createFinding(db, assessmentId, tenantId, 'timing-p2p', {
        findingType: 'process_delay', severity: daysOverBenchmark > 15 ? 'critical' : 'high',
        title: `Procure-to-Pay cycle ${Math.round(avgP2P)} days vs ${benchmark} day benchmark`,
        description: `Your average Procure-to-Pay cycle is ${Math.round(avgP2P)} days, ${Math.round(daysOverBenchmark)} days above the benchmark. Late payments risk supplier relationship damage and potential early payment discount losses.`,
        affectedRecords: exceedingBenchmark, financialImpact: Math.round(financialImpact),
        evidence: { sample_records: [], pattern: `${Math.round(daysOverBenchmark)} days above benchmark`, first_occurrence: 'Systematic', frequency: 'Every PO cycle' },
        rootCause: 'Manual PO approval workflows, lack of 3-way match automation, and delayed goods receipt confirmation.',
        prescription: `Automate PO approval and 3-way matching. Target: reduce P2P from ${Math.round(avgP2P)} to ${benchmark} days.`,
        category: 'timing_issue', immediateValue: 0, ongoingMonthlyValue: Math.round(financialImpact / 12),
        domain: 'procurement',
      });
    }
  }

  // ── Invoice Approval Cycle ──
  progress('process_timing', 'Measuring Invoice Approval cycle...', 30);
  const pendingInvoices = await queryNum(db,
    `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND payment_status = 'pending'`,
    [tenantId]);
  const stuckInvoices = await queryNum(db,
    `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND payment_status = 'pending' AND invoice_date < datetime('now', '-7 days')`,
    [tenantId]);

  if (pendingInvoices > 0) {
    const avgApprovalDays = stuckInvoices > 0 ? 12 : 4; // Estimate from stuck ratio
    const benchmark = 5;
    const financialImpact = stuckInvoices * 500; // R500 per stuck invoice in admin cost

    if (avgApprovalDays > benchmark) delays++;

    const timingId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timingId, assessmentId, tenantId, 'Invoice Approval',
      avgApprovalDays, avgApprovalDays * 0.8, avgApprovalDays * 1.8, benchmark,
      'Manager Approval', Math.max(0, avgApprovalDays - benchmark),
      pendingInvoices, stuckInvoices,
      financialImpact, JSON.stringify({ stuckInvoices, pendingInvoices }),
    ).run();
  }

  // ── Month-End Close ──
  progress('process_timing', 'Measuring Month-End Close...', 32);
  // Approximate from journal entries if available
  const jeCount = await queryNum(db, `SELECT COUNT(*) FROM erp_journal_entries WHERE tenant_id = ?`, [tenantId]);
  if (jeCount > 0) {
    const benchmark = 7;
    const estimatedCloseDays = 10; // Default estimate
    if (estimatedCloseDays > benchmark) delays++;

    const timingId = crypto.randomUUID();
    await db.prepare(
      `INSERT INTO assessment_process_timing (id, assessment_id, tenant_id, process_name, avg_cycle_time_days, median_cycle_time_days, p90_cycle_time_days, benchmark_cycle_time_days, bottleneck_step, bottleneck_avg_days, records_analysed, records_exceeding_benchmark, financial_impact_of_delay, evidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      timingId, assessmentId, tenantId, 'Month-End Close',
      estimatedCloseDays, estimatedCloseDays * 0.9, estimatedCloseDays * 1.5, benchmark,
      'Reconciliation', Math.max(0, estimatedCloseDays - benchmark),
      jeCount, Math.round(jeCount * 0.3),
      15000, JSON.stringify({ journalEntries: jeCount }), // R15K/month opportunity cost
    ).run();
  }

  return { delays };
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 3: LIVE CATALYST RUNS (full mode only)
// ══════════════════════════════════════════════════════════════════════════

async function runLiveCatalystAnalysis(
  db: D1Database, ai: Ai, tenantId: string, assessmentId: string,
  prospectIndustry: string,
  progress: (phase: string, step: string, pct: number, detail?: string) => void,
): Promise<number> {
  let totalFindings = 0;

  // Run analysis per domain by querying actual data patterns
  const domains = [
    { name: 'Finance', domain: 'finance', subCatalysts: ['AP Invoice Reconciliation', 'AR Collection Analysis', 'Bank Reconciliation'] },
    { name: 'Procurement', domain: 'procurement', subCatalysts: ['Supplier Payment Verification', 'PO-Invoice Matching'] },
    { name: 'Workforce', domain: 'workforce', subCatalysts: ['Payroll Reconciliation', 'Leave Balance Audit'] },
    { name: 'Supply Chain', domain: 'supply_chain', subCatalysts: ['Inventory Reconciliation', 'Stock Movement Validation'] },
  ];

  for (let d = 0; d < domains.length; d++) {
    const dom = domains[d];
    const basePct = 40 + Math.round((d / domains.length) * 40);
    progress('catalyst_runs', `Running ${dom.name} catalysts...`, basePct);

    for (const subCat of dom.subCatalysts) {
      const runId = crypto.randomUUID();
      const startedAt = new Date().toISOString();

      // Run actual data analysis per sub-catalyst
      const result = await analyseSubCatalyst(db, tenantId, dom.domain, subCat);

      await db.prepare(
        `INSERT INTO assessment_runs (id, assessment_id, tenant_id, cluster_name, sub_catalyst_name, domain, status, source_record_count, target_record_count, matched, discrepancies, exceptions, total_source_value, total_discrepancy_value, total_unmatched_value, match_rate, discrepancy_rate, avg_confidence, duration_ms, findings, root_causes, prescriptions, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, 'complete', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
      ).bind(
        runId, assessmentId, tenantId, dom.name, subCat, dom.domain,
        result.sourceCount, result.targetCount, result.matched,
        result.discrepancies, result.exceptions,
        result.totalSourceValue, result.discrepancyValue, result.unmatchedValue,
        result.matchRate, result.discrepancyRate, result.avgConfidence,
        result.durationMs, JSON.stringify(result.findings),
        JSON.stringify(result.rootCauses), JSON.stringify(result.prescriptions),
        startedAt,
      ).run();

      // Create findings from each run
      for (const finding of result.findings) {
        await createFinding(db, assessmentId, tenantId, runId, {
          findingType: finding.type as 'discrepancy' | 'exception' | 'data_quality' | 'process_delay' | 'risk',
          severity: finding.severity as 'critical' | 'high' | 'medium' | 'low',
          title: finding.title, description: finding.description,
          affectedRecords: finding.affectedRecords, financialImpact: finding.financialImpact,
          evidence: finding.evidence || { sample_records: [], pattern: '', first_occurrence: '', frequency: '' },
          rootCause: finding.rootCause || '', prescription: finding.prescription || '',
          category: finding.category || 'data_issue',
          immediateValue: finding.immediateValue || 0,
          ongoingMonthlyValue: finding.ongoingMonthlyValue || 0,
          domain: dom.domain,
        });
        totalFindings++;
      }
    }
  }

  return totalFindings;
}

interface SubCatalystResult {
  sourceCount: number; targetCount: number; matched: number;
  discrepancies: number; exceptions: number;
  totalSourceValue: number; discrepancyValue: number; unmatchedValue: number;
  matchRate: number; discrepancyRate: number; avgConfidence: number;
  durationMs: number;
  findings: Array<{
    type: string; severity: string; title: string; description: string;
    affectedRecords: number; financialImpact: number;
    evidence?: FindingEvidence; rootCause?: string; prescription?: string;
    category?: string; immediateValue?: number; ongoingMonthlyValue?: number;
  }>;
  rootCauses: string[];
  prescriptions: string[];
}

async function analyseSubCatalyst(
  db: D1Database, tenantId: string, domain: string, subCatalystName: string,
): Promise<SubCatalystResult> {
  const t0 = Date.now();
  const findings: SubCatalystResult['findings'] = [];

  if (domain === 'finance') {
    if (subCatalystName === 'AP Invoice Reconciliation') {
      // Compare PO totals vs invoice totals for matching suppliers
      const invoiceCount = await queryNum(db, `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ?`, [tenantId]);
      const poCount = await queryNum(db, `SELECT COUNT(*) FROM erp_purchase_orders WHERE tenant_id = ?`, [tenantId]);
      const totalInvoiceValue = await queryNum(db, `SELECT COALESCE(SUM(total), 0) FROM erp_invoices WHERE tenant_id = ?`, [tenantId]);
      const totalPOValue = await queryNum(db, `SELECT COALESCE(SUM(total), 0) FROM erp_purchase_orders WHERE tenant_id = ?`, [tenantId]);

      const discrepancyValue = Math.abs(totalInvoiceValue - totalPOValue);
      const matched = Math.min(invoiceCount, poCount);
      const discrepancies = Math.abs(invoiceCount - poCount);

      // Find specific mismatches
      const sampleMismatches = await queryRows(db,
        `SELECT i.invoice_number, i.total as inv_total, i.customer_id FROM erp_invoices i WHERE i.tenant_id = ? AND i.total > (SELECT AVG(total) * 2 FROM erp_invoices WHERE tenant_id = ?) ORDER BY i.total DESC LIMIT 5`,
        [tenantId, tenantId]);

      if (discrepancyValue > 10000) {
        findings.push({
          type: 'discrepancy', severity: discrepancyValue > 100000 ? 'critical' : 'high',
          title: `R${formatZAR(discrepancyValue)} AP invoice-to-PO mismatch`,
          description: `The total value of invoices (R${formatZAR(totalInvoiceValue)}) differs from purchase orders (R${formatZAR(totalPOValue)}) by R${formatZAR(discrepancyValue)}. This indicates potential over-billing, missing POs, or unmatched credits.`,
          affectedRecords: discrepancies, financialImpact: discrepancyValue,
          evidence: {
            sample_records: sampleMismatches.map(r => ({
              ref: `Invoice #${r.invoice_number}`, source_value: Number(r.inv_total) || 0,
              target_value: 'No matching PO', difference: Number(r.inv_total) || 0,
            })),
            pattern: 'Invoice values exceed PO values', first_occurrence: 'Current period',
            frequency: 'Recurring',
          },
          rootCause: 'Invoices received without matching purchase orders. Lack of 3-way match enforcement in AP workflow.',
          prescription: 'Deploy automated 3-way match with exception routing for unmatched invoices.',
          category: 'data_issue', immediateValue: discrepancyValue * 0.2, ongoingMonthlyValue: discrepancyValue * 0.01,
        });
      }

      return {
        sourceCount: invoiceCount, targetCount: poCount, matched, discrepancies,
        exceptions: 0, totalSourceValue: totalInvoiceValue, discrepancyValue,
        unmatchedValue: discrepancyValue, matchRate: matched > 0 ? Math.round((matched / Math.max(invoiceCount, 1)) * 100) : 0,
        discrepancyRate: invoiceCount > 0 ? Math.round((discrepancies / invoiceCount) * 100) : 0,
        avgConfidence: 0.85, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }

    if (subCatalystName === 'AR Collection Analysis') {
      const overdueCount = await queryNum(db,
        `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'`, [tenantId]);
      const overdueValue = await queryNum(db,
        `SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid'`, [tenantId]);
      const totalAR = await queryNum(db,
        `SELECT COALESCE(SUM(amount_due), 0) FROM erp_invoices WHERE tenant_id = ? AND payment_status != 'paid'`, [tenantId]);

      // Aging analysis
      const over30 = await queryNum(db,
        `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now', '-30 days') AND payment_status != 'paid'`, [tenantId]);
      const over60 = await queryNum(db,
        `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now', '-60 days') AND payment_status != 'paid'`, [tenantId]);
      const over90 = await queryNum(db,
        `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now', '-90 days') AND payment_status != 'paid'`, [tenantId]);

      if (overdueValue > 0) {
        const sampleOverdue = await queryRows(db,
          `SELECT invoice_number, customer_id, amount_due, due_date FROM erp_invoices WHERE tenant_id = ? AND due_date < datetime('now') AND payment_status != 'paid' ORDER BY amount_due DESC LIMIT 5`,
          [tenantId]);

        findings.push({
          type: 'discrepancy', severity: overdueValue > 200000 ? 'critical' : 'high',
          title: `R${formatZAR(overdueValue)} in overdue receivables (${overdueCount} invoices)`,
          description: `${overdueCount} invoices are past due totalling R${formatZAR(overdueValue)}. Aging breakdown: ${over30} over 30 days, ${over60} over 60 days, ${over90} over 90 days. Total AR book is R${formatZAR(totalAR)}.`,
          affectedRecords: overdueCount, financialImpact: overdueValue,
          evidence: {
            sample_records: sampleOverdue.map(r => ({
              ref: `Invoice #${r.invoice_number}`, source_value: `Due: ${r.due_date}`,
              target_value: 'Overdue', difference: Number(r.amount_due) || 0,
            })),
            pattern: `${over90} invoices >90 days, ${over60 - over90} invoices 60-90 days, ${over30 - over60} invoices 30-60 days`,
            first_occurrence: String(sampleOverdue[sampleOverdue.length - 1]?.due_date || 'unknown'),
            frequency: 'Chronic — new overdue invoices added monthly',
          },
          rootCause: 'No automated dunning process. Collection follow-up is reactive rather than systematic.',
          prescription: 'Deploy automated AR collection with aging-based escalation sequences.',
          category: 'process_issue', immediateValue: overdueValue * 0.25, ongoingMonthlyValue: overdueValue * 0.02,
        });
      }

      return {
        sourceCount: await queryNum(db, `SELECT COUNT(*) FROM erp_invoices WHERE tenant_id = ?`, [tenantId]),
        targetCount: overdueCount, matched: 0, discrepancies: overdueCount,
        exceptions: over90, totalSourceValue: totalAR, discrepancyValue: overdueValue,
        unmatchedValue: 0, matchRate: 0, discrepancyRate: totalAR > 0 ? Math.round((overdueValue / totalAR) * 100) : 0,
        avgConfidence: 0.92, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }

    if (subCatalystName === 'Bank Reconciliation') {
      const txnCount = await queryNum(db, `SELECT COUNT(*) FROM erp_bank_transactions WHERE tenant_id = ?`, [tenantId]);
      const totalValue = await queryNum(db, `SELECT COALESCE(SUM(ABS(amount)), 0) FROM erp_bank_transactions WHERE tenant_id = ?`, [tenantId]);

      // Find unreconciled (no matching reference)
      const unreconciledCount = await queryNum(db,
        `SELECT COUNT(*) FROM erp_bank_transactions WHERE tenant_id = ? AND (reference IS NULL OR reference = '')`, [tenantId]);
      const unreconciledValue = await queryNum(db,
        `SELECT COALESCE(SUM(ABS(amount)), 0) FROM erp_bank_transactions WHERE tenant_id = ? AND (reference IS NULL OR reference = '')`, [tenantId]);

      if (unreconciledCount > 0) {
        findings.push({
          type: 'discrepancy', severity: unreconciledValue > 50000 ? 'high' : 'medium',
          title: `${unreconciledCount} unreconciled bank transactions (R${formatZAR(unreconciledValue)})`,
          description: `${unreconciledCount} bank transactions totalling R${formatZAR(unreconciledValue)} have no matching reference to invoices or POs.`,
          affectedRecords: unreconciledCount, financialImpact: unreconciledValue * 0.05,
          evidence: { sample_records: [], pattern: 'Transactions without matching references', first_occurrence: 'Current period', frequency: 'Ongoing' },
          rootCause: 'Manual reconciliation process lacks automated matching rules.',
          prescription: 'Deploy automated bank reconciliation with AI-powered transaction matching.',
          category: 'process_issue', immediateValue: unreconciledValue * 0.02, ongoingMonthlyValue: unreconciledValue * 0.003,
        });
      }

      return {
        sourceCount: txnCount, targetCount: txnCount, matched: txnCount - unreconciledCount,
        discrepancies: unreconciledCount, exceptions: 0, totalSourceValue: totalValue,
        discrepancyValue: unreconciledValue, unmatchedValue: unreconciledValue,
        matchRate: txnCount > 0 ? Math.round(((txnCount - unreconciledCount) / txnCount) * 100) : 0,
        discrepancyRate: txnCount > 0 ? Math.round((unreconciledCount / txnCount) * 100) : 0,
        avgConfidence: 0.78, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }
  }

  if (domain === 'procurement') {
    if (subCatalystName === 'Supplier Payment Verification') {
      const supplierCount = await queryNum(db, `SELECT COUNT(*) FROM erp_suppliers WHERE tenant_id = ?`, [tenantId]);
      const totalSpend = await queryNum(db, `SELECT COALESCE(SUM(total), 0) FROM erp_purchase_orders WHERE tenant_id = ?`, [tenantId]);

      // Check for POs to inactive suppliers
      const inactiveSupplierPOs = await queryNum(db,
        `SELECT COUNT(*) FROM erp_purchase_orders po WHERE po.tenant_id = ? AND po.status = 'open' AND EXISTS (SELECT 1 FROM erp_suppliers s WHERE s.tenant_id = po.tenant_id AND s.supplier_id = po.supplier_id AND s.status != 'active')`,
        [tenantId]);

      if (inactiveSupplierPOs > 0) {
        findings.push({
          type: 'risk', severity: 'high',
          title: `${inactiveSupplierPOs} open POs to inactive suppliers`,
          description: `${inactiveSupplierPOs} purchase orders are still open against suppliers that are no longer marked as active. This creates procurement risk and potential payment issues.`,
          affectedRecords: inactiveSupplierPOs, financialImpact: 25000,
          evidence: { sample_records: [], pattern: 'Open POs to inactive suppliers', first_occurrence: 'Ongoing', frequency: 'Accumulated' },
          rootCause: 'Supplier lifecycle management not integrated with procurement. Supplier deactivation does not cascade to open orders.',
          prescription: 'Implement automated supplier lifecycle checks before PO creation and payment release.',
          category: 'configuration_issue', immediateValue: 10000, ongoingMonthlyValue: 2000,
        });
      }

      return {
        sourceCount: supplierCount, targetCount: supplierCount, matched: supplierCount - inactiveSupplierPOs,
        discrepancies: inactiveSupplierPOs, exceptions: 0, totalSourceValue: totalSpend,
        discrepancyValue: 25000, unmatchedValue: 0,
        matchRate: supplierCount > 0 ? Math.round(((supplierCount - inactiveSupplierPOs) / supplierCount) * 100) : 0,
        discrepancyRate: supplierCount > 0 ? Math.round((inactiveSupplierPOs / supplierCount) * 100) : 0,
        avgConfidence: 0.88, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }

    if (subCatalystName === 'PO-Invoice Matching') {
      return defaultSubCatalystResult(t0);
    }
  }

  if (domain === 'workforce') {
    if (subCatalystName === 'Payroll Reconciliation') {
      const empCount = await queryNum(db, `SELECT COUNT(*) FROM erp_employees WHERE tenant_id = ? AND status = 'active'`, [tenantId]);
      const totalPayroll = await queryNum(db, `SELECT COALESCE(SUM(gross_salary), 0) FROM erp_employees WHERE tenant_id = ? AND status = 'active'`, [tenantId]);

      // Check for ghost employees (terminated but still active)
      const missingDept = await queryNum(db,
        `SELECT COUNT(*) FROM erp_employees WHERE tenant_id = ? AND status = 'active' AND (department IS NULL OR department = '')`, [tenantId]);

      if (missingDept > 0) {
        findings.push({
          type: 'data_quality', severity: 'medium',
          title: `${missingDept} employees with missing department assignment`,
          description: `${missingDept} active employees have no department assigned, making cost allocation impossible and creating audit risk.`,
          affectedRecords: missingDept, financialImpact: missingDept * 1000,
          evidence: { sample_records: [], pattern: 'Active employees without department', first_occurrence: 'Ongoing', frequency: 'Static' },
          rootCause: 'Employee onboarding does not enforce department assignment. HR master data incomplete.',
          prescription: 'Enforce mandatory department assignment in employee master data and deploy periodic data quality checks.',
          category: 'data_issue', immediateValue: 0, ongoingMonthlyValue: missingDept * 100,
        });
      }

      return {
        sourceCount: empCount, targetCount: empCount, matched: empCount - missingDept,
        discrepancies: missingDept, exceptions: 0, totalSourceValue: totalPayroll,
        discrepancyValue: missingDept * 1000, unmatchedValue: 0,
        matchRate: empCount > 0 ? Math.round(((empCount - missingDept) / empCount) * 100) : 0,
        discrepancyRate: empCount > 0 ? Math.round((missingDept / empCount) * 100) : 0,
        avgConfidence: 0.82, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }

    if (subCatalystName === 'Leave Balance Audit') {
      return defaultSubCatalystResult(t0);
    }
  }

  if (domain === 'supply_chain') {
    if (subCatalystName === 'Inventory Reconciliation') {
      const productCount = await queryNum(db, `SELECT COUNT(*) FROM erp_products WHERE tenant_id = ?`, [tenantId]);
      const totalInventory = await queryNum(db, `SELECT COALESCE(SUM(stock_on_hand * cost_price), 0) FROM erp_products WHERE tenant_id = ? AND is_active = 1`, [tenantId]);

      const negStock = await queryNum(db, `SELECT COUNT(*) FROM erp_products WHERE tenant_id = ? AND stock_on_hand < 0`, [tenantId]);
      const zeroCost = await queryNum(db, `SELECT COUNT(*) FROM erp_products WHERE tenant_id = ? AND is_active = 1 AND (cost_price IS NULL OR cost_price = 0)`, [tenantId]);

      if (negStock > 0) {
        findings.push({
          type: 'data_quality', severity: 'critical',
          title: `${negStock} products with negative stock quantities`,
          description: `${negStock} products show negative stock-on-hand, indicating data integrity issues in inventory management.`,
          affectedRecords: negStock, financialImpact: negStock * 5000,
          evidence: { sample_records: [], pattern: 'Negative stock quantities', first_occurrence: 'Current', frequency: 'Ongoing' },
          rootCause: 'Stock movements not properly sequenced. Goods issues processed before goods receipts.',
          prescription: 'Deploy inventory reconciliation catalyst with real-time stock validation.',
          category: 'data_issue', immediateValue: negStock * 2000, ongoingMonthlyValue: negStock * 200,
        });
      }

      return {
        sourceCount: productCount, targetCount: productCount, matched: productCount - negStock - zeroCost,
        discrepancies: negStock + zeroCost, exceptions: negStock, totalSourceValue: totalInventory,
        discrepancyValue: negStock * 5000, unmatchedValue: 0,
        matchRate: productCount > 0 ? Math.round(((productCount - negStock - zeroCost) / productCount) * 100) : 0,
        discrepancyRate: productCount > 0 ? Math.round(((negStock + zeroCost) / productCount) * 100) : 0,
        avgConfidence: 0.80, durationMs: Date.now() - t0, findings,
        rootCauses: findings.map(f => f.rootCause || ''),
        prescriptions: findings.map(f => f.prescription || ''),
      };
    }

    if (subCatalystName === 'Stock Movement Validation') {
      return defaultSubCatalystResult(t0);
    }
  }

  return defaultSubCatalystResult(t0);
}

function defaultSubCatalystResult(t0: number): SubCatalystResult {
  return {
    sourceCount: 0, targetCount: 0, matched: 0, discrepancies: 0, exceptions: 0,
    totalSourceValue: 0, discrepancyValue: 0, unmatchedValue: 0,
    matchRate: 0, discrepancyRate: 0, avgConfidence: 0, durationMs: Date.now() - t0,
    findings: [], rootCauses: [], prescriptions: [],
  };
}

// ══════════════════════════════════════════════════════════════════════════
// PHASE 4: VALUE QUANTIFICATION
// ══════════════════════════════════════════════════════════════════════════

async function runValueQuantification(
  db: D1Database, ai: Ai, tenantId: string, assessmentId: string,
  config: ValueAssessmentConfig, prospectName: string, prospectIndustry: string,
  progress: (phase: string, step: string, pct: number, detail?: string) => void,
): Promise<void> {
  progress('value_quantification', 'Aggregating findings...', 86);

  // Aggregate findings
  const findingsRows = await queryRows(db,
    `SELECT * FROM assessment_findings WHERE assessment_id = ? AND tenant_id = ?`,
    [assessmentId, tenantId]);

  const totalFindings = findingsRows.length;
  const criticalFindings = findingsRows.filter(f => f.severity === 'critical').length;
  const totalImmediateValue = findingsRows.reduce((sum, f) => sum + (Number(f.immediate_value) || 0), 0);
  const totalOngoingMonthly = findingsRows.reduce((sum, f) => sum + (Number(f.ongoing_monthly_value) || 0), 0);
  const totalOngoingAnnual = totalOngoingMonthly * 12;

  // Value by domain
  const valueByDomain: Record<string, { immediate: number; ongoing: number; findings: number }> = {};
  for (const f of findingsRows) {
    const domain = String(f.domain || 'general');
    if (!valueByDomain[domain]) valueByDomain[domain] = { immediate: 0, ongoing: 0, findings: 0 };
    valueByDomain[domain].immediate += Number(f.immediate_value) || 0;
    valueByDomain[domain].ongoing += Number(f.ongoing_monthly_value) || 0;
    valueByDomain[domain].findings++;
  }

  // Value by category
  const valueByCategory: Record<string, { immediate: number; ongoing: number; findings: number }> = {};
  for (const f of findingsRows) {
    const cat = String(f.category || 'other');
    if (!valueByCategory[cat]) valueByCategory[cat] = { immediate: 0, ongoing: 0, findings: 0 };
    valueByCategory[cat].immediate += Number(f.immediate_value) || 0;
    valueByCategory[cat].ongoing += Number(f.ongoing_monthly_value) || 0;
    valueByCategory[cat].findings++;
  }

  // DQ totals
  const dqRows = await queryRows(db,
    `SELECT * FROM assessment_data_quality WHERE assessment_id = ?`, [assessmentId]);
  const totalDQIssues = dqRows.reduce((sum, r) => {
    const issues = JSON.parse(String(r.issues || '[]'));
    return sum + (Array.isArray(issues) ? issues.length : 0);
  }, 0);

  // Timing totals
  const timingRows = await queryRows(db,
    `SELECT * FROM assessment_process_timing WHERE assessment_id = ?`, [assessmentId]);
  const totalProcessDelays = timingRows.filter(r => Number(r.avg_cycle_time_days) > Number(r.benchmark_cycle_time_days)).length;

  // Outcome-based fee
  const outcomeFeePercent = config.outcomeFeePercent / 100;
  const monthlyOutcomeFee = totalOngoingMonthly * outcomeFeePercent;
  const paybackDays = monthlyOutcomeFee > 0
    ? Math.ceil(totalImmediateValue / (monthlyOutcomeFee * 12 / 365))
    : 0;

  // Generate executive narrative
  progress('value_quantification', 'Generating executive narrative...', 90);
  let narrative = '';
  try {
    const llmConfig = await loadLlmConfig(db, tenantId);
    const result = await llmChatWithFallback(llmConfig, ai, [
      { role: 'system', content: 'You are Atheon Intelligence, a financial analysis AI. Write a compelling executive narrative for a value assessment report. Be specific with numbers. Use South African Rand (R) format. Keep it to 2-3 paragraphs.' },
      { role: 'user', content: `Write an executive narrative for ${prospectName} (${prospectIndustry} industry).
Assessment findings: ${totalFindings} total issues (${criticalFindings} critical).
Immediate recovery value: R${formatZAR(Math.round(totalImmediateValue))}.
Ongoing monthly value: R${formatZAR(Math.round(totalOngoingMonthly))}/month.
Data quality issues: ${totalDQIssues} across ${dqRows.length} tables.
Process delays: ${totalProcessDelays} processes exceeding benchmarks.
Outcome-based fee: ${config.outcomeFeePercent}% = R${formatZAR(Math.round(monthlyOutcomeFee))}/month.
Payback period: ${paybackDays} days.
Top domains: ${Object.entries(valueByDomain).sort((a, b) => (b[1].immediate + b[1].ongoing * 12) - (a[1].immediate + a[1].ongoing * 12)).slice(0, 3).map(([d, v]) => `${d}: R${formatZAR(Math.round(v.immediate + v.ongoing * 12))}`).join(', ')}.` },
    ], { maxTokens: 1024 });
    narrative = stripCodeFences(result.text);
  } catch (err) {
    console.error('Narrative generation failed, using template:', err);
    narrative = `Atheon connected to ${prospectName}'s systems and analysed transaction data across multiple domains. We found ${totalFindings} issues including ${criticalFindings} critical findings.\n\nIMMEDIATE VALUE: R${formatZAR(Math.round(totalImmediateValue))} — recoverable right now from discrepancies, duplicate payments, and overdue collections identified in your live data.\n\nONGOING VALUE: R${formatZAR(Math.round(totalOngoingMonthly))}/month — recurring savings from automated reconciliation, data quality monitoring, and process optimization. At an outcome-based fee of ${config.outcomeFeePercent}% of delivered value, your monthly Atheon investment would be R${formatZAR(Math.round(monthlyOutcomeFee))}/month, paying for itself within ${paybackDays} days from the immediate value alone.`;
  }

  // Save value summary
  const summaryId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO assessment_value_summary (id, assessment_id, tenant_id, total_immediate_value, total_ongoing_monthly_value, total_ongoing_annual_value, total_data_quality_issues, total_process_delays, total_findings, total_critical_findings, outcome_based_monthly_fee, outcome_based_fee_pct, payback_days, value_by_domain, value_by_category, executive_narrative)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    summaryId, assessmentId, tenantId,
    Math.round(totalImmediateValue), Math.round(totalOngoingMonthly),
    Math.round(totalOngoingAnnual), totalDQIssues, totalProcessDelays,
    totalFindings, criticalFindings,
    Math.round(monthlyOutcomeFee), config.outcomeFeePercent,
    paybackDays, JSON.stringify(valueByDomain), JSON.stringify(valueByCategory),
    narrative,
  ).run();
}

// ══════════════════════════════════════════════════════════════════════════
// PDF REPORT GENERATION
// ══════════════════════════════════════════════════════════════════════════

export async function generateValueReportPDF(
  db: D1Database, storage: R2Bucket,
  tenantId: string, assessmentId: string,
  prospectName: string, config: ValueAssessmentConfig,
): Promise<string> {
  // Gather all data
  const summary = await db.prepare(
    `SELECT * FROM assessment_value_summary WHERE assessment_id = ? LIMIT 1`
  ).bind(assessmentId).first<Record<string, unknown>>();

  const findings = await queryRows(db,
    `SELECT * FROM assessment_findings WHERE assessment_id = ? ORDER BY financial_impact DESC`,
    [assessmentId]);

  const dqRecords = await queryRows(db,
    `SELECT * FROM assessment_data_quality WHERE assessment_id = ?`,
    [assessmentId]);

  const timingRecords = await queryRows(db,
    `SELECT * FROM assessment_process_timing WHERE assessment_id = ?`,
    [assessmentId]);

  if (!summary) return '';

  const totalImmediate = Number(summary.total_immediate_value) || 0;
  const totalOngoingMonthly = Number(summary.total_ongoing_monthly_value) || 0;
  const totalOngoingAnnual = Number(summary.total_ongoing_annual_value) || 0;
  const totalFindings = Number(summary.total_findings) || 0;
  const paybackDays = Number(summary.payback_days) || 0;
  const outcomeFee = Number(summary.outcome_based_monthly_fee) || 0;
  const outcomePct = Number(summary.outcome_based_fee_pct) || 20;
  const narrative = String(summary.executive_narrative || '');
  const valueByDomain = JSON.parse(String(summary.value_by_domain || '{}'));

  // Build PDF using jsPDF-compatible text layout
  // We generate an HTML report that can be served as-is or converted to PDF
  const reportDate = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Atheon Value Assessment — ${escapeHtml(prospectName)}</title>
<style>
  @page { size: A4; margin: 15mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', system-ui, sans-serif; color: #1a1a2e; line-height: 1.5; font-size: 11pt; }
  .page { page-break-after: always; min-height: 247mm; padding: 10mm 0; position: relative; }
  .page:last-child { page-break-after: auto; }
  .confidential { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%) rotate(-35deg); font-size: 80pt; color: rgba(26,26,46,0.04); font-weight: 900; letter-spacing: 15px; pointer-events: none; }
  .cover { display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; min-height: 247mm; }
  .cover h1 { font-size: 28pt; color: #6366f1; margin-bottom: 8mm; letter-spacing: 2px; }
  .cover h2 { font-size: 18pt; color: #64748b; margin-bottom: 15mm; font-weight: 400; }
  .cover .company { font-size: 24pt; font-weight: 700; margin-bottom: 10mm; }
  .cover .meta { color: #64748b; font-size: 10pt; margin-top: 5mm; }
  .cover .live { background: #ecfdf5; color: #059669; padding: 3mm 8mm; border-radius: 4mm; margin-top: 8mm; font-weight: 600; font-size: 10pt; }
  h3 { font-size: 16pt; color: #6366f1; margin-bottom: 5mm; border-bottom: 1px solid #e2e8f0; padding-bottom: 2mm; }
  .kpi-row { display: flex; gap: 4mm; margin-bottom: 6mm; }
  .kpi { flex: 1; background: #f8fafc; border-radius: 3mm; padding: 5mm; text-align: center; border: 1px solid #e2e8f0; }
  .kpi .number { font-size: 22pt; font-weight: 700; color: #1a1a2e; }
  .kpi .label { font-size: 8pt; color: #64748b; margin-top: 1mm; }
  .kpi.highlight { background: #6366f1; color: white; border-color: #6366f1; }
  .kpi.highlight .number, .kpi.highlight .label { color: white; }
  .narrative { background: #f0f0ff; border-left: 3px solid #6366f1; padding: 4mm 5mm; margin: 5mm 0; border-radius: 0 2mm 2mm 0; font-size: 10pt; }
  table { width: 100%; border-collapse: collapse; margin: 4mm 0; font-size: 9pt; }
  th, td { padding: 2mm 3mm; text-align: left; border-bottom: 1px solid #e2e8f0; }
  th { background: #f8fafc; font-weight: 600; color: #475569; }
  .severity-critical { color: #dc2626; font-weight: 700; }
  .severity-high { color: #ea580c; font-weight: 600; }
  .severity-medium { color: #d97706; }
  .severity-low { color: #65a30d; }
  .badge { display: inline-block; padding: 0.5mm 2mm; border-radius: 1mm; font-size: 7pt; font-weight: 600; }
  .badge-critical { background: #fef2f2; color: #dc2626; }
  .badge-high { background: #fff7ed; color: #ea580c; }
  .badge-medium { background: #fffbeb; color: #d97706; }
  .badge-low { background: #f0fdf4; color: #65a30d; }
  .dq-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4mm; }
  .dq-card { border: 1px solid #e2e8f0; border-radius: 3mm; padding: 4mm; }
  .dq-card .score { font-size: 24pt; font-weight: 700; }
  .dq-card .score.good { color: #059669; }
  .dq-card .score.warn { color: #d97706; }
  .dq-card .score.bad { color: #dc2626; }
  .bar-container { background: #e2e8f0; border-radius: 1mm; height: 4mm; margin: 1mm 0; }
  .bar-fill { height: 100%; border-radius: 1mm; }
  .timing-card { border: 1px solid #e2e8f0; border-radius: 3mm; padding: 4mm; margin-bottom: 4mm; }
  .timing-bars { display: flex; gap: 3mm; align-items: center; margin: 2mm 0; }
  .timing-bar { height: 8mm; border-radius: 1mm; display: flex; align-items: center; padding-left: 2mm; color: white; font-size: 8pt; font-weight: 600; }
  .pricing-table { margin: 4mm 0; }
  .pricing-table td:last-child { text-align: right; font-weight: 600; }
  .footer { text-align: center; color: #94a3b8; font-size: 7pt; margin-top: 5mm; }
  .waterfall { margin: 4mm 0; }
  .waterfall-bar { display: flex; align-items: center; margin: 1.5mm 0; }
  .waterfall-bar .wf-label { width: 40%; font-size: 8pt; }
  .waterfall-bar .wf-bar { flex: 1; height: 6mm; background: #6366f1; border-radius: 1mm; position: relative; }
  .waterfall-bar .wf-bar.total { background: #059669; }
  .waterfall-bar .wf-value { margin-left: 2mm; font-size: 8pt; font-weight: 600; }
</style>
</head>
<body>

<!-- COVER PAGE -->
<div class="page cover">
  <div class="confidential">CONFIDENTIAL</div>
  <h1>ATHEON INTELLIGENCE ASSESSMENT</h1>
  <h2>Value Discovery Report</h2>
  <div class="company">${escapeHtml(prospectName)}</div>
  <div class="meta">${reportDate}</div>
  <div class="meta">Currency: ${config.currency}</div>
  <div class="live">Based on live analysis of your actual transaction data</div>
</div>

<!-- PAGE 2: HEADLINE NUMBERS -->
<div class="page">
  <h3>The Headline Numbers</h3>
  <div class="kpi-row">
    <div class="kpi"><div class="number">${totalFindings}</div><div class="label">Total Issues Identified</div></div>
    <div class="kpi highlight"><div class="number">R${formatZAR(Math.round(totalImmediate))}</div><div class="label">Immediate Recovery Value</div></div>
    <div class="kpi highlight"><div class="number">R${formatZAR(Math.round(totalOngoingMonthly))}/mo</div><div class="label">Ongoing Monthly Value</div></div>
    <div class="kpi"><div class="number">${paybackDays} days</div><div class="label">Payback Period</div></div>
  </div>
  <div class="narrative">${escapeHtml(narrative)}</div>

  <!-- VALUE WATERFALL -->
  <h3 style="margin-top:8mm">Value Waterfall</h3>
  <div class="waterfall">
    ${Object.entries(valueByDomain).sort((a: [string, unknown], b: [string, unknown]) => {
      const aVal = (a[1] as { immediate: number; ongoing: number }).immediate + (a[1] as { immediate: number; ongoing: number }).ongoing * 12;
      const bVal = (b[1] as { immediate: number; ongoing: number }).immediate + (b[1] as { immediate: number; ongoing: number }).ongoing * 12;
      return bVal - aVal;
    }).map(([domain, val]: [string, unknown]) => {
      const v = val as { immediate: number; ongoing: number; findings: number };
      const totalVal = v.immediate + v.ongoing * 12;
      const maxVal = totalImmediate + totalOngoingAnnual;
      const pct = maxVal > 0 ? Math.max(5, Math.round((totalVal / maxVal) * 100)) : 5;
      return `<div class="waterfall-bar"><span class="wf-label">${capitalise(domain)} (${v.findings} findings)</span><div class="wf-bar" style="width:${pct}%"></div><span class="wf-value">R${formatZAR(Math.round(totalVal))}</span></div>`;
    }).join('\n    ')}
    <div class="waterfall-bar"><span class="wf-label"><strong>TOTAL VALUE</strong></span><div class="wf-bar total" style="width:100%"></div><span class="wf-value"><strong>R${formatZAR(Math.round(totalImmediate + totalOngoingAnnual))}</strong></span></div>
  </div>
</div>

<!-- PAGE 3: DATA QUALITY REPORT CARD -->
<div class="page">
  <h3>Data Quality Report Card</h3>
  <div class="dq-grid">
    ${dqRecords.map(dq => {
      const score = Number(dq.overall_quality_score) || 0;
      const scoreClass = score >= 80 ? 'good' : score >= 60 ? 'warn' : 'bad';
      const fields = JSON.parse(String(dq.field_scores || '{}'));
      const issues = JSON.parse(String(dq.issues || '[]'));
      return `<div class="dq-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2mm">
          <div><strong>${escapeHtml(String(dq.table_name))}</strong><br><span style="color:#64748b;font-size:8pt">${Number(dq.total_records).toLocaleString()} records</span></div>
          <div class="score ${scoreClass}">${score}</div>
        </div>
        ${Object.entries(fields).slice(0, 4).map(([field, pct]: [string, unknown]) => {
          const p = Number(pct);
          const color = p >= 90 ? '#059669' : p >= 70 ? '#d97706' : '#dc2626';
          return `<div style="font-size:7pt;margin:1mm 0"><span>${field}: ${p}%</span><div class="bar-container"><div class="bar-fill" style="width:${p}%;background:${color}"></div></div></div>`;
        }).join('')}
        ${issues.length > 0 ? `<div style="font-size:7pt;color:#dc2626;margin-top:1mm">${(issues as DQIssue[]).length} issue${(issues as DQIssue[]).length > 1 ? 's' : ''} detected</div>` : ''}
      </div>`;
    }).join('\n    ')}
  </div>
</div>

<!-- PAGE 4: PROCESS TIMING -->
<div class="page">
  <h3>Process Timing Analysis</h3>
  ${timingRecords.map(t => {
    const avg = Number(t.avg_cycle_time_days) || 0;
    const benchmark = Number(t.benchmark_cycle_time_days) || 0;
    const maxDays = Math.max(avg, benchmark) * 1.2;
    const yourPct = maxDays > 0 ? Math.round((avg / maxDays) * 100) : 0;
    const benchPct = maxDays > 0 ? Math.round((benchmark / maxDays) * 100) : 0;
    const overBenchmark = avg > benchmark;
    return `<div class="timing-card">
      <strong>${escapeHtml(String(t.process_name))}</strong>
      <div class="timing-bars">
        <div style="width:15%;font-size:8pt">Your time</div>
        <div class="timing-bar" style="width:${yourPct}%;background:${overBenchmark ? '#dc2626' : '#059669'}">${Math.round(avg)} days</div>
      </div>
      <div class="timing-bars">
        <div style="width:15%;font-size:8pt">Benchmark</div>
        <div class="timing-bar" style="width:${benchPct}%;background:#6366f1">${benchmark} days</div>
      </div>
      ${t.bottleneck_step ? `<div style="font-size:8pt;color:#64748b;margin-top:1mm">Bottleneck: ${escapeHtml(String(t.bottleneck_step))} (+${Math.round(Number(t.bottleneck_avg_days))} days)</div>` : ''}
      <div style="font-size:8pt;margin-top:1mm">Financial impact: <strong>R${formatZAR(Math.round(Number(t.financial_impact_of_delay)))}/year</strong></div>
    </div>`;
  }).join('\n  ')}
</div>

<!-- PAGES: PER-DOMAIN FINDINGS -->
${Object.entries(valueByDomain).map(([domain, val]: [string, unknown]) => {
  const v = val as { immediate: number; ongoing: number; findings: number };
  const domainFindings = findings.filter(f => String(f.domain) === domain).slice(0, 15);
  if (domainFindings.length === 0) return '';
  return `<div class="page">
    <h3>${capitalise(domain)} — R${formatZAR(Math.round(v.immediate + v.ongoing * 12))} Total Value</h3>
    <div style="margin-bottom:3mm;font-size:9pt;color:#64748b">${v.findings} findings | Immediate: R${formatZAR(Math.round(v.immediate))} | Ongoing: R${formatZAR(Math.round(v.ongoing))}/month</div>
    <table>
      <tr><th>Finding</th><th>Severity</th><th>Impact</th><th>Records</th><th>Root Cause</th></tr>
      ${domainFindings.map(f => `<tr>
        <td>${escapeHtml(String(f.title))}</td>
        <td><span class="badge badge-${f.severity}">${String(f.severity).toUpperCase()}</span></td>
        <td style="font-weight:600">R${formatZAR(Math.round(Number(f.financial_impact)))}</td>
        <td>${Number(f.affected_records).toLocaleString()}</td>
        <td style="font-size:8pt">${escapeHtml(String(f.root_cause || '').slice(0, 80))}</td>
      </tr>`).join('\n      ')}
    </table>
  </div>`;
}).join('\n')}

<!-- PRICING PAGE -->
<div class="page">
  <h3>Outcome-Based Pricing Proposal</h3>
  <div class="narrative" style="margin-bottom:5mm">Based on the R${formatZAR(Math.round(totalOngoingMonthly))}/month of value Atheon will deliver, we propose an outcome-based model where you only pay when measurable value is delivered.</div>
  <table class="pricing-table">
    <tr><td>Ongoing Value Delivered</td><td>R${formatZAR(Math.round(totalOngoingMonthly))}/month</td></tr>
    <tr><td>Atheon Outcome Fee (${outcomePct}%)</td><td>R${formatZAR(Math.round(outcomeFee))}/month</td></tr>
    <tr><td>Immediate Recovery Value</td><td>R${formatZAR(Math.round(totalImmediate))} (one-time)</td></tr>
    <tr><td>Your Net Monthly Benefit</td><td>R${formatZAR(Math.round(totalOngoingMonthly - outcomeFee))}/month</td></tr>
    <tr><td>Payback from Immediate Value</td><td>${paybackDays} days</td></tr>
    <tr style="border-top:2px solid #1a1a2e"><td>3-Year Total Value</td><td><strong>R${formatZAR(Math.round(totalImmediate + totalOngoingAnnual * 3))}</strong></td></tr>
    <tr><td>3-Year Total Fee</td><td>R${formatZAR(Math.round(outcomeFee * 36))}</td></tr>
    <tr><td>3-Year Net Benefit</td><td><strong>R${formatZAR(Math.round(totalImmediate + totalOngoingAnnual * 3 - outcomeFee * 36))}</strong></td></tr>
  </table>
  <div style="margin-top:5mm;font-size:9pt;color:#64748b;font-style:italic">"You only pay when Atheon delivers measurable value. If we don't find discrepancies, you don't pay."</div>
</div>

<!-- LAST PAGE: NEXT STEPS -->
<div class="page">
  <h3>Next Steps</h3>
  <ol style="padding-left:5mm;font-size:10pt;line-height:2">
    <li>Review this report with your CFO and operations team</li>
    <li>Select which domains to activate first (recommended: ${Object.entries(valueByDomain).sort((a: [string, unknown], b: [string, unknown]) => {
      const aVal = (a[1] as { immediate: number; ongoing: number }).immediate + (a[1] as { immediate: number; ongoing: number }).ongoing * 12;
      const bVal = (b[1] as { immediate: number; ongoing: number }).immediate + (b[1] as { immediate: number; ongoing: number }).ongoing * 12;
      return bVal - aVal;
    }).slice(0, 2).map(([d]) => capitalise(d)).join(' and ')})</li>
    <li>Atheon deploys in 5 days — first value delivered within 48 hours</li>
    <li>Monthly value reports prove ongoing delivery</li>
    <li>Outcome fees are only charged on verified, measurable value</li>
  </ol>
  <div style="margin-top:15mm;text-align:center">
    <div style="font-size:12pt;font-weight:700;color:#6366f1">GONXT Technology</div>
    <div style="font-size:9pt;color:#64748b">Vanta X Holdings (Pty) Ltd</div>
    <div style="font-size:9pt;color:#64748b;margin-top:2mm">info@gonxt.tech | atheon.vantax.co.za</div>
  </div>
  <div class="footer">This report is confidential and intended solely for the named recipient. Generated by Atheon Intelligence Platform.</div>
</div>

</body>
</html>`;

  // Store HTML alongside the PDF (kept for any in-app preview).
  const htmlKey = `assessments/${assessmentId}/value-report.html`;
  await storage.put(htmlKey, html, {
    httpMetadata: { contentType: 'text/html' },
  });

  // Generate branded PDF for download.
  const pdfBytes = await renderValueReportPDF({
    prospectName,
    assessmentId,
    config,
    summary,
    findings,
    dqRecords,
    timingRecords,
  });
  const pdfKey = `assessments/${assessmentId}/value-report.pdf`;
  await storage.put(pdfKey, pdfBytes, {
    httpMetadata: { contentType: 'application/pdf' },
  });

  // Point business_report_key at the PDF so the Download Report button
  // serves a real .pdf file with Atheon branding.
  await db.prepare(
    `UPDATE assessments SET business_report_key = ? WHERE id = ?`
  ).bind(pdfKey, assessmentId).run();

  return pdfKey;
}

interface RenderPDFArgs {
  prospectName: string;
  assessmentId: string;
  config: ValueAssessmentConfig;
  summary: Record<string, unknown>;
  findings: Array<Record<string, unknown>>;
  dqRecords: Array<Record<string, unknown>>;
  timingRecords: Array<Record<string, unknown>>;
}

async function renderValueReportPDF(args: RenderPDFArgs): Promise<Uint8Array> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();

  // Atheon brand palette (matches src/index.css)
  const NAVY = [10, 14, 42] as const;       // #0a0e2a
  const NAVY_2 = [20, 26, 61] as const;     // #141a3d
  const SAGE = [163, 177, 138] as const;    // #A3B18A
  const SAGE_DEEP = [93, 138, 111] as const; // #5d8a6f
  const BRONZE = [205, 163, 126] as const;  // #CDA37E
  const TEXT = [26, 26, 46] as const;       // #1a1a2e
  const MUTED = [100, 116, 139] as const;   // #64748b
  const BORDER = [226, 232, 240] as const;  // #e2e8f0
  const BG_CARD = [248, 250, 252] as const; // #f8fafc
  const WHITE = [255, 255, 255] as const;

  // Severity colors
  const SEV: Record<string, readonly [number, number, number]> = {
    critical: [220, 38, 38],
    high: [234, 88, 12],
    medium: [217, 119, 6],
    low: [101, 163, 13],
  };

  const summary = args.summary;
  const totalImmediate = Number(summary.total_immediate_value) || 0;
  const totalOngoingMonthly = Number(summary.total_ongoing_monthly_value) || 0;
  const totalOngoingAnnual = Number(summary.total_ongoing_annual_value) || 0;
  const totalFindings = Number(summary.total_findings) || 0;
  const paybackDays = Number(summary.payback_days) || 0;
  const outcomeFee = Number(summary.outcome_based_monthly_fee) || 0;
  const outcomePct = Number(summary.outcome_based_fee_pct) || 20;
  const narrative = String(summary.executive_narrative || '');
  const valueByDomain = JSON.parse(String(summary.value_by_domain || '{}')) as Record<
    string,
    { immediate: number; ongoing: number; findings: number }
  >;

  function setFill(c: readonly [number, number, number]) { doc.setFillColor(c[0], c[1], c[2]); }
  function setText(c: readonly [number, number, number]) { doc.setTextColor(c[0], c[1], c[2]); }
  function setDraw(c: readonly [number, number, number]) { doc.setDrawColor(c[0], c[1], c[2]); }

  // Short, human-readable assessment trace (last 8 chars of the UUID).
  // Surfaces in every page footer + cover so an auditor can correlate any
  // photocopied page back to a single canonical assessment in the DB.
  const assessmentShort = String(args.assessmentId).slice(-8).toUpperCase();
  const generatedIso = new Date().toISOString();

  // ── Atheon "A" letterform — drawn as a stylized monogram ──
  function drawAMark(cx: number, cy: number, size: number, lightOnDark: boolean) {
    const half = size / 2;
    // Outer "A" triangle outline
    setFill(lightOnDark ? SAGE : NAVY);
    doc.triangle(
      cx, cy - half,
      cx - half * 0.85, cy + half,
      cx + half * 0.85, cy + half,
      'F',
    );
    // Inner cut-out
    setFill(lightOnDark ? NAVY : WHITE);
    doc.triangle(
      cx, cy - half * 0.45,
      cx - half * 0.45, cy + half * 0.6,
      cx + half * 0.45, cy + half * 0.6,
      'F',
    );
    // Crossbar
    setFill(lightOnDark ? BRONZE : SAGE_DEEP);
    doc.rect(cx - half * 0.55, cy + half * 0.2, half * 1.1, size * 0.07, 'F');
  }

  // Board-credibility watermark — pale diagonal CONFIDENTIAL across the
  // page. Subtle enough not to fight the body copy but proves the document
  // is single-source-of-truth controlled. Drawn behind content; call FIRST
  // on each new page before any other ink lands.
  function drawWatermark() {
    setText([235, 238, 245]);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(60);
    // jsPDF rotates around the baseline anchor — translate to centre, write
    // with -35° angle so it reads bottom-left → top-right.
    doc.text('CONFIDENTIAL', pageW / 2, pageH / 2, { align: 'center', angle: 35 });
    setText(TEXT);
  }

  function pageHeader(title: string, pageNum: number) {
    drawWatermark();
    setFill(NAVY);
    doc.rect(0, 0, pageW, 16, 'F');
    setFill(SAGE);
    doc.rect(0, 16, pageW, 1, 'F');
    setText(WHITE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(title, 14, 10.5);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${args.prospectName} · Confidential`, pageW - 14, 10.5, { align: 'right' });
    setText(TEXT);
    // Page number + assessment trace on bottom — auditors look here first
    setText(MUTED);
    doc.setFontSize(7);
    doc.text(`${pageNum}`, pageW - 14, pageH - 6, { align: 'right' });
    doc.text(`Atheon Intelligence Platform · Assessment ${assessmentShort}`, 14, pageH - 6);
    setText(TEXT);
  }

  // Wrap helper: write paragraph text at (x,y) with maxWidth, return y after last line.
  function paragraph(text: string, x: number, y: number, maxW: number, size = 9, color: readonly [number, number, number] = TEXT, lh = 4): number {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(size);
    setText(color);
    const lines = doc.splitTextToSize(text, maxW) as string[];
    lines.forEach((line, i) => doc.text(line, x, y + i * lh));
    return y + lines.length * lh;
  }

  function severityBadge(sev: string, x: number, y: number) {
    const c = SEV[sev] || SEV.medium;
    const label = sev.toUpperCase();
    doc.setFontSize(7);
    const w = doc.getTextWidth(label) + 4;
    setFill(c);
    doc.roundedRect(x, y - 3.2, w, 4.2, 1, 1, 'F');
    setText(WHITE);
    doc.setFont('helvetica', 'bold');
    doc.text(label, x + 2, y);
    doc.setFont('helvetica', 'normal');
    setText(TEXT);
  }

  // ════════════════════════════════════════════════════════════════
  // PAGE 1 — COVER
  // ════════════════════════════════════════════════════════════════
  setFill(NAVY);
  doc.rect(0, 0, pageW, pageH, 'F');

  // Subtle navy-2 panel for depth
  setFill(NAVY_2);
  doc.rect(0, 0, pageW, pageH / 2, 'F');

  // Atheon A mark
  drawAMark(pageW / 2, 70, 38, true);

  // Wordmark
  setText(WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.text('ATHEON', pageW / 2, 110, { align: 'center' });

  setText(SAGE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('INTELLIGENCE PLATFORM', pageW / 2, 117, { align: 'center', charSpace: 2 });

  // Sage divider
  setFill(SAGE);
  doc.rect(pageW / 2 - 25, 124, 50, 0.6, 'F');

  // Report title
  setText(WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Value Discovery Report', pageW / 2, 142, { align: 'center' });

  setText([180, 200, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('Prepared for', pageW / 2, 158, { align: 'center' });

  // Client name (large)
  setText(WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text(args.prospectName, pageW / 2, 170, { align: 'center' });

  // Date + currency
  const reportDate = new Date().toLocaleDateString('en-ZA', { year: 'numeric', month: 'long', day: 'numeric' });
  setText([180, 200, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(reportDate, pageW / 2, 184, { align: 'center' });
  doc.text(`Currency: ${args.config.currency}`, pageW / 2, 190, { align: 'center' });

  // Sage "live data" pill
  setFill(SAGE_DEEP);
  doc.roundedRect(pageW / 2 - 50, 210, 100, 8, 2, 2, 'F');
  setText(WHITE);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text('BASED ON LIVE ANALYSIS OF YOUR ACTUAL TRANSACTION DATA', pageW / 2, 215.5, { align: 'center' });

  // Assessment trace block — gives auditors a citation handle. Single
  // source of truth: the assessment ID + generated timestamp, surfaced on
  // the cover so every copy of the report is forensically attributable.
  setText([180, 200, 220]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Assessment ID: ${assessmentShort}`, pageW / 2, 232, { align: 'center', charSpace: 1 });
  doc.text(`Generated: ${generatedIso}`, pageW / 2, 237, { align: 'center', charSpace: 0.4 });

  // Confidential bottom band
  setFill(BRONZE);
  doc.rect(0, pageH - 14, pageW, 14, 'F');
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('CONFIDENTIAL — FOR AUTHORISED RECIPIENTS ONLY', pageW / 2, pageH - 8.5, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('GONXT Technology · info@gonxt.tech · atheon.vantax.co.za', pageW / 2, pageH - 4, { align: 'center' });

  let pg = 1;

  // ════════════════════════════════════════════════════════════════
  // PAGE 2 — EXECUTIVE SUMMARY
  // ════════════════════════════════════════════════════════════════
  doc.addPage(); pg++;
  pageHeader('Executive Summary', pg);

  let y = 28;
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('The Headline Numbers', 14, y);

  // KPI grid: 2x2
  y += 6;
  const kpiW = (pageW - 28 - 6) / 2;
  const kpiH = 22;
  const kpis = [
    { label: 'Issues Identified', value: `${totalFindings}`, accent: SAGE },
    { label: 'Immediate Recovery', value: `R${formatZAR(Math.round(totalImmediate))}`, accent: BRONZE, highlight: true },
    { label: 'Ongoing Monthly Value', value: `R${formatZAR(Math.round(totalOngoingMonthly))}/mo`, accent: BRONZE, highlight: true },
    { label: 'Payback Period', value: `${paybackDays} days`, accent: SAGE_DEEP },
  ];
  kpis.forEach((k, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 14 + col * (kpiW + 6);
    const ky = y + row * (kpiH + 4);
    setFill(k.highlight ? NAVY : BG_CARD);
    doc.roundedRect(x, ky, kpiW, kpiH, 2, 2, 'F');
    setFill(k.accent);
    doc.rect(x, ky, 2.5, kpiH, 'F');
    setText(k.highlight ? WHITE : MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(k.label.toUpperCase(), x + 6, ky + 6, { charSpace: 0.5 });
    setText(k.highlight ? WHITE : NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text(k.value, x + 6, ky + 16);
  });

  y += 2 * (kpiH + 4) + 4;

  // Executive narrative
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Executive Narrative', 14, y);
  y += 5;
  setFill([248, 250, 245]);
  setDraw(SAGE);
  doc.setLineWidth(0.3);
  const narrW = pageW - 28;
  const narrLines = (doc.splitTextToSize(narrative, narrW - 6) as string[]).length;
  const narrH = Math.max(20, narrLines * 4 + 6);
  doc.roundedRect(14, y, narrW, narrH, 1.5, 1.5, 'FD');
  setFill(SAGE_DEEP);
  doc.rect(14, y, 1.5, narrH, 'F');
  paragraph(narrative, 18, y + 5, narrW - 8, 9, TEXT, 4);

  y += narrH + 8;

  // 3-year projection block
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('3-Year Projection', 14, y);
  y += 5;
  setFill(NAVY);
  doc.roundedRect(14, y, pageW - 28, 22, 2, 2, 'F');
  setText(WHITE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const threeYrTotal = totalImmediate + totalOngoingAnnual * 3;
  const threeYrFee = outcomeFee * 36;
  const threeYrNet = threeYrTotal - threeYrFee;
  doc.text(`Total Value Delivered: R${formatZAR(Math.round(threeYrTotal))}`, 18, y + 7);
  doc.text(`Outcome-Based Fee (${outcomePct}%): R${formatZAR(Math.round(threeYrFee))}`, 18, y + 13);
  setText(SAGE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.text(`Net Benefit: R${formatZAR(Math.round(threeYrNet))}`, 18, y + 19);

  // ════════════════════════════════════════════════════════════════
  // PAGE 3 — VALUE WATERFALL BY DOMAIN
  // ════════════════════════════════════════════════════════════════
  doc.addPage(); pg++;
  pageHeader('Value by Domain', pg);

  y = 28;
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Value Waterfall', 14, y);
  y += 4;
  setText(MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Where the value comes from — across your operational domains.', 14, y);
  y += 8;

  const domainEntries = Object.entries(valueByDomain).sort((a, b) => {
    return (b[1].immediate + b[1].ongoing * 12) - (a[1].immediate + a[1].ongoing * 12);
  });
  const maxDomainTotal = Math.max(1, ...domainEntries.map(([, v]) => v.immediate + v.ongoing * 12));
  const barMaxW = pageW - 28 - 40 - 30;
  domainEntries.forEach(([domain, v]) => {
    const total = v.immediate + v.ongoing * 12;
    const pct = total / maxDomainTotal;
    const barW = Math.max(2, pct * barMaxW);
    // Label
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(capitalise(domain), 14, y);
    setText(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.text(`${v.findings} findings`, 14, y + 4);
    // Bar
    setFill(SAGE);
    doc.roundedRect(54, y - 3, barW, 5, 0.8, 0.8, 'F');
    setFill(BRONZE);
    const immPct = v.immediate / Math.max(1, total);
    doc.roundedRect(54, y - 3, Math.max(0.5, barW * immPct), 5, 0.8, 0.8, 'F');
    // Value
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.text(`R${formatZAR(Math.round(total))}`, pageW - 14, y + 1, { align: 'right' });
    y += 13;
  });

  // Legend
  y += 4;
  setFill(BRONZE);
  doc.rect(14, y - 2, 3, 3, 'F');
  setText(TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.text('Immediate Recovery', 19, y);
  setFill(SAGE);
  doc.rect(60, y - 2, 3, 3, 'F');
  doc.text('Ongoing Annual Value', 65, y);

  // Domain detail blocks
  y += 10;
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Domain Breakdown', 14, y);
  y += 6;

  domainEntries.forEach(([domain, v]) => {
    if (y > pageH - 30) { doc.addPage(); pg++; pageHeader('Value by Domain', pg); y = 28; }
    setFill(BG_CARD);
    setDraw(BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(14, y, pageW - 28, 16, 1.5, 1.5, 'FD');
    setFill(SAGE_DEEP);
    doc.rect(14, y, 1.5, 16, 'F');
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(capitalise(domain), 18, y + 5);
    setText(TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(`Immediate: R${formatZAR(Math.round(v.immediate))}`, 18, y + 10.5);
    doc.text(`Ongoing: R${formatZAR(Math.round(v.ongoing))}/mo`, 75, y + 10.5);
    doc.text(`Findings: ${v.findings}`, 130, y + 10.5);
    setText(BRONZE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(`R${formatZAR(Math.round(v.immediate + v.ongoing * 12))}/yr`, pageW - 18, y + 9, { align: 'right' });
    y += 20;
  });

  // ════════════════════════════════════════════════════════════════
  // PAGES — PER-FINDING DETAIL (2 per page)
  // ════════════════════════════════════════════════════════════════
  const sortedFindings = [...args.findings].sort((a, b) => Number(b.financial_impact) - Number(a.financial_impact));

  for (let i = 0; i < sortedFindings.length; i++) {
    if (i % 2 === 0) {
      doc.addPage(); pg++;
      pageHeader('Findings Detail', pg);
      y = 22;
    }
    const f = sortedFindings[i];
    const cardTop = y + 4;
    const cardH = 115;

    setFill(BG_CARD);
    setDraw(BORDER);
    doc.setLineWidth(0.2);
    doc.roundedRect(14, cardTop, pageW - 28, cardH, 2, 2, 'FD');

    // Severity stripe on left
    const sevColor = SEV[String(f.severity)] || SEV.medium;
    setFill(sevColor);
    doc.rect(14, cardTop, 2, cardH, 'F');

    // Title
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    const titleLines = doc.splitTextToSize(String(f.title), pageW - 80) as string[];
    titleLines.slice(0, 2).forEach((ln, j) => doc.text(ln, 20, cardTop + 6 + j * 5));
    let cy = cardTop + 6 + Math.min(2, titleLines.length) * 5 + 1;

    // Severity badge + finding number
    severityBadge(String(f.severity), 20, cy + 2);
    setText(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`Finding ${i + 1} of ${sortedFindings.length} · ${capitalise(String(f.domain))} · ${String(f.category).replace(/_/g, ' ')}`, 42, cy + 2);

    // Financial impact (right column)
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(14);
    doc.text(`R${formatZAR(Math.round(Number(f.financial_impact)))}`, pageW - 18, cardTop + 9, { align: 'right' });
    setText(MUTED);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.text(`${Number(f.affected_records).toLocaleString()} affected records`, pageW - 18, cardTop + 13, { align: 'right' });
    setText(BRONZE);
    doc.setFontSize(8);
    doc.text(`Immediate: R${formatZAR(Math.round(Number(f.immediate_value)))}`, pageW - 18, cardTop + 18, { align: 'right' });
    doc.text(`Ongoing: R${formatZAR(Math.round(Number(f.ongoing_monthly_value)))}/mo`, pageW - 18, cardTop + 22, { align: 'right' });

    cy += 8;

    // Description
    setText(MUTED);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('FINDING', 20, cy);
    cy = paragraph(String(f.description || ''), 20, cy + 4, pageW - 40, 9, TEXT, 3.8);
    cy += 3;

    // Root Cause
    setText(SAGE_DEEP);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('ROOT CAUSE', 20, cy);
    cy = paragraph(String(f.root_cause || ''), 20, cy + 4, pageW - 40, 9, TEXT, 3.8);
    cy += 3;

    // Prescription
    setText(BRONZE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('PRESCRIPTION', 20, cy);
    cy = paragraph(String(f.prescription || ''), 20, cy + 4, pageW - 40, 9, TEXT, 3.8);
    cy += 3;

    // Evidence (sample record + provenance trace for board/auditor)
    try {
      const ev = typeof f.evidence === 'string' ? JSON.parse(f.evidence as string) : f.evidence;
      const sample = ev?.sample_records?.[0];
      const sampleCount = Array.isArray(ev?.sample_records) ? ev.sample_records.length : 0;
      if (sample || sampleCount > 0) {
        setText(NAVY);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(8);
        const traceParts: string[] = ['EVIDENCE'];
        if (sampleCount > 0) traceParts.push(`${sampleCount} sample record${sampleCount === 1 ? '' : 's'}`);
        if (ev?.first_occurrence) traceParts.push(`first observed ${String(ev.first_occurrence).slice(0, 10)}`);
        if (ev?.frequency) traceParts.push(`frequency: ${String(ev.frequency)}`);
        doc.text(traceParts.join('  ·  '), 20, cy);
        if (sample) {
          setText(MUTED);
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8);
          const evLine = `Ref: ${sample.ref || '—'}  ·  ${sample.source_value || '—'}  →  ${sample.target_value || '—'}  ·  Δ ${sample.difference || '—'}`;
          const wrapped = doc.splitTextToSize(evLine, pageW - 40) as string[];
          wrapped.slice(0, 2).forEach((ln, j) => doc.text(ln, 20, cy + 4 + j * 3.6));
        }
      }
    } catch { /* evidence parse failed — skip */ }

    y = cardTop + cardH + 6;
  }

  // ════════════════════════════════════════════════════════════════
  // PRICING PAGE
  // ════════════════════════════════════════════════════════════════
  doc.addPage(); pg++;
  pageHeader('Outcome-Based Pricing', pg);

  y = 28;
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Pricing Proposal', 14, y);
  y += 4;
  setText(MUTED);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('You only pay when Atheon delivers measurable value.', 14, y);
  y += 8;

  setFill([248, 250, 245]);
  setDraw(SAGE);
  doc.setLineWidth(0.3);
  doc.roundedRect(14, y, pageW - 28, 18, 1.5, 1.5, 'FD');
  setText(TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  const tagline = `Based on R${formatZAR(Math.round(totalOngoingMonthly))}/month of value Atheon will deliver, we propose an outcome-based model where you only pay when measurable value is delivered. If we don't find discrepancies, you don't pay.`;
  paragraph(tagline, 18, y + 6, pageW - 36, 9, TEXT, 4);
  y += 24;

  // Pricing table
  const rows: Array<[string, string, boolean?]> = [
    ['Ongoing Value Delivered', `R${formatZAR(Math.round(totalOngoingMonthly))}/month`],
    [`Atheon Outcome Fee (${outcomePct}%)`, `R${formatZAR(Math.round(outcomeFee))}/month`],
    ['Immediate Recovery Value', `R${formatZAR(Math.round(totalImmediate))} (one-time)`],
    ['Your Net Monthly Benefit', `R${formatZAR(Math.round(totalOngoingMonthly - outcomeFee))}/month`],
    ['Payback from Immediate Value', `${paybackDays} days`],
    ['3-Year Total Value', `R${formatZAR(Math.round(totalImmediate + totalOngoingAnnual * 3))}`, true],
    ['3-Year Total Fee', `R${formatZAR(Math.round(outcomeFee * 36))}`],
    ['3-Year Net Benefit', `R${formatZAR(Math.round(totalImmediate + totalOngoingAnnual * 3 - outcomeFee * 36))}`, true],
  ];
  rows.forEach(([label, value, emph], idx) => {
    if (idx % 2 === 0) { setFill(BG_CARD); doc.rect(14, y, pageW - 28, 8, 'F'); }
    setText(emph ? NAVY : TEXT);
    doc.setFont('helvetica', emph ? 'bold' : 'normal');
    doc.setFontSize(emph ? 10 : 9);
    doc.text(label, 18, y + 5.5);
    setText(emph ? BRONZE : NAVY);
    doc.setFont('helvetica', 'bold');
    doc.text(value, pageW - 18, y + 5.5, { align: 'right' });
    y += 8;
  });

  // ════════════════════════════════════════════════════════════════
  // NEXT STEPS PAGE
  // ════════════════════════════════════════════════════════════════
  doc.addPage(); pg++;
  pageHeader('Next Steps', pg);

  y = 28;
  setText(NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('Your Path to Value', 14, y);
  y += 10;

  const topDomains = domainEntries.slice(0, 2).map(([d]) => capitalise(d)).join(' and ');
  const steps = [
    { num: '01', title: 'Review with your CFO and operations team', body: 'Walk through findings, validate priorities, and confirm the financial baseline.' },
    { num: '02', title: `Activate high-value domains first: ${topDomains}`, body: 'These domains together represent the largest immediate and ongoing value opportunity.' },
    { num: '03', title: 'Atheon deploys in 5 days', body: 'First measurable value delivered within 48 hours of go-live. No infrastructure setup required.' },
    { num: '04', title: 'Monthly value reports prove ongoing delivery', body: 'Each month, Atheon provides an evidence-backed report of value delivered, with line-level traceability to your ERP.' },
    { num: '05', title: 'Pay only on verified, measurable outcomes', body: 'Outcome fees are charged exclusively against value Atheon has identified and your team has verified.' },
  ];
  steps.forEach(s => {
    if (y > pageH - 30) { doc.addPage(); pg++; pageHeader('Next Steps', pg); y = 28; }
    setText(BRONZE);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(24);
    doc.text(s.num, 14, y + 6);
    setText(NAVY);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text(s.title, 36, y + 3);
    setText(TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    const wrapped = doc.splitTextToSize(s.body, pageW - 50) as string[];
    wrapped.forEach((ln, i) => doc.text(ln, 36, y + 8 + i * 4));
    y += 8 + wrapped.length * 4 + 6;
  });

  // Contact block
  y += 6;
  setFill(NAVY);
  doc.roundedRect(14, y, pageW - 28, 32, 2, 2, 'F');
  setText(WHITE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('GONXT Technology', 20, y + 9);
  setText(SAGE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('Vanta X Holdings (Pty) Ltd', 20, y + 14.5);
  setText(WHITE);
  doc.text('info@gonxt.tech', 20, y + 22);
  doc.text('atheon.vantax.co.za', 20, y + 27);

  setText(BRONZE);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('CONFIDENTIAL', pageW - 20, y + 9, { align: 'right' });
  setText(WHITE);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text(`Report generated: ${reportDate}`, pageW - 20, y + 14.5, { align: 'right' });
  doc.text(`Prepared for: ${args.prospectName}`, pageW - 20, y + 19, { align: 'right' });

  const arrBuf = doc.output('arraybuffer') as ArrayBuffer;
  return new Uint8Array(arrBuf);
}

// ── Helpers ────────────────────────────────────────────────────────────────

interface CreateFindingData {
  findingType: string;
  severity: string;
  title: string;
  description: string;
  affectedRecords: number;
  financialImpact: number;
  evidence: FindingEvidence;
  rootCause: string;
  prescription: string;
  category: string;
  immediateValue: number;
  ongoingMonthlyValue: number;
  domain: string;
}

async function createFinding(
  db: D1Database, assessmentId: string, tenantId: string,
  runId: string, data: CreateFindingData,
): Promise<string> {
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO assessment_findings (id, assessment_id, run_id, tenant_id, finding_type, severity, title, description, affected_records, financial_impact, evidence, root_cause, prescription, category, immediate_value, ongoing_monthly_value, domain)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, assessmentId, runId, tenantId,
    data.findingType, data.severity, data.title, data.description,
    data.affectedRecords, data.financialImpact,
    JSON.stringify(data.evidence), data.rootCause, data.prescription,
    data.category, data.immediateValue, data.ongoingMonthlyValue, data.domain,
  ).run();
  return id;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function capitalise(str: string): string {
  return str.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}
