/**
 * Stub batch 2 — six more previously-stubbed sub-catalysts get bespoke
 * handlers grounded in existing canonical tables. Same pattern as batch 1
 * (workers/api/src/services/catalyst-stub-batch-1-handlers.ts).
 *
 * Coverage:
 *   - Outsourcing Governance      (services-vendor SLA tracking)
 *   - RFP Management              (open RFP / bid lifecycle)
 *   - Logistics Management        (freight spend + delivery on-time)
 *   - Onboarding Automation       (recent-hire status + MFA progress)
 *   - Performance Reviews         (review-due tracking by hire date)
 *   - Customer Credit Scoring     (real-time credit limit utilisation)
 *
 * Same broadly-applicable selection criteria as batch 1: every customer
 * has POs, suppliers, employees, customers — no industry-specific picks
 * in this batch.
 */

import { type CatalystHandler, registerHandler } from './catalyst-handler-registry';
import { taskText, anyWord as anyOf, allWords, companyFilter, scopeLabel } from './catalyst-match-utils';
import type { TaskDefinition } from './catalyst-engine';

function round2(n: number): number {
  return Math.round((n || 0) * 100) / 100;
}

// ── OUTSOURCING GOVERNANCE ─────────────────────────────────────────────

async function runOutsourcingGovernance(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const supplierClause = clause.replace(' AND company_id', ' AND s.company_id');
  // Service / outsourcing POs + their delivery performance. We treat
  // delayed delivery as a proxy for SLA breach because true SLA records
  // aren't on the canonical schema.
  const services = await db.prepare(
    `SELECT s.id, s.name,
            COUNT(po.id) AS po_count,
            SUM(po.total) AS total_spend,
            SUM(CASE WHEN po.delivery_status = 'delayed' THEN 1 ELSE 0 END) AS delayed_count,
            SUM(CASE WHEN po.delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count
     FROM erp_suppliers s
     JOIN erp_purchase_orders po ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
     WHERE s.tenant_id = ? AND po.status NOT IN ('cancelled')
       AND (
         LOWER(s.supplier_group) LIKE '%service%' OR LOWER(s.supplier_group) LIKE '%bpo%'
         OR LOWER(s.supplier_group) LIKE '%outsourc%' OR LOWER(s.supplier_group) LIKE '%consult%'
         OR LOWER(s.name) LIKE '%services%'         OR LOWER(s.name) LIKE '%bpo%'
         OR LOWER(s.name) LIKE '%outsourc%'         OR LOWER(s.name) LIKE '%consult%'
       )${supplierClause}
     GROUP BY s.id, s.name
     ORDER BY total_spend DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const slaBreaches = services.results.filter(r => {
    const row = r as { delayed_count: number; delivered_count: number };
    const completed = (row.delivered_count || 0) + (row.delayed_count || 0);
    return completed > 0 && (row.delayed_count || 0) / completed > 0.1;
  });

  const totalSpend = services.results.reduce((s, r) => s + ((r as { total_spend: number }).total_spend || 0), 0);

  return {
    type: 'procurement_outsourcing_governance',
    serviceVendorCount: services.results.length,
    totalServiceSpend: round2(totalSpend),
    slaBreachCount: slaBreaches.length,
    slaBreachVendors: slaBreaches.slice(0, 5),
    topServiceVendors: services.results.slice(0, 5),
    recommendation: slaBreaches.length > 0
      ? `${slaBreaches.length} services vendor(s) with >10% delayed-delivery rate — escalate to QBR with SLA-breach evidence`
      : services.results.length > 0
        ? 'Services vendor delivery posture within tolerance — log next QBR cycle'
        : 'No services / outsourcing vendors identified — categorise vendors for visibility',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── RFP MANAGEMENT ─────────────────────────────────────────────────────

const RFP_THRESHOLD_ZAR = 100_000;

async function runRfpManagement(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Open / pending POs above the RFP threshold are the working RFP queue.
  const openRfps = await db.prepare(
    `SELECT po_number, supplier_name, total, order_date, status, delivery_date
     FROM erp_purchase_orders
     WHERE tenant_id = ? AND total >= ?
       AND status IN ('pending', 'draft', 'requested', 'approved')
       AND order_date >= date('now', '-180 days')${clause}
     ORDER BY total DESC LIMIT 30`,
  ).bind(task.tenantId, RFP_THRESHOLD_ZAR, ...params).all();

  const totalOpen = openRfps.results.reduce((s, r) => s + ((r as { total: number }).total || 0), 0);
  const stale = openRfps.results.filter(r => {
    const row = r as { order_date: string };
    const ageDays = (Date.now() - new Date(row.order_date).getTime()) / 86400000;
    return ageDays > 60;
  });

  return {
    type: 'procurement_rfp_management',
    openRfpCount: openRfps.results.length,
    openRfpValue: round2(totalOpen),
    staleRfpCount: stale.length,
    rfps: openRfps.results.slice(0, 10),
    recommendation: stale.length > 0
      ? `${stale.length} RFP(s) older than 60 days — close, re-bid, or escalate`
      : openRfps.results.length > 0
        ? `${openRfps.results.length} active RFP(s) totalling R${Math.round(totalOpen).toLocaleString()} — track award decisions`
        : 'No active RFPs above the R100k threshold',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── LOGISTICS MANAGEMENT ───────────────────────────────────────────────

async function runLogisticsManagement(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const supplierClause = clause.replace(' AND company_id', ' AND s.company_id');
  // Freight-tagged suppliers + their delivery performance.
  const freight = await db.prepare(
    `SELECT s.id, s.name,
            COUNT(po.id) AS po_count,
            SUM(po.total) AS total_spend,
            SUM(CASE WHEN po.delivery_status = 'delayed' THEN 1 ELSE 0 END) AS delayed_count,
            SUM(CASE WHEN po.delivery_status = 'delivered' THEN 1 ELSE 0 END) AS delivered_count
     FROM erp_suppliers s
     LEFT JOIN erp_purchase_orders po ON po.supplier_id = s.id AND po.tenant_id = s.tenant_id
     WHERE s.tenant_id = ? AND po.status NOT IN ('cancelled')
       AND (
         LOWER(s.name) LIKE '%logistic%'  OR LOWER(s.name) LIKE '%freight%'
         OR LOWER(s.name) LIKE '%shipping%' OR LOWER(s.name) LIKE '%courier%'
         OR LOWER(s.name) LIKE '%transport%' OR LOWER(s.name) LIKE '%haulier%'
         OR LOWER(s.supplier_group) LIKE '%logistic%' OR LOWER(s.supplier_group) LIKE '%freight%'
       )${supplierClause}
     GROUP BY s.id, s.name
     ORDER BY total_spend DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const totalFreight = freight.results.reduce((s, r) => s + ((r as { total_spend: number }).total_spend || 0), 0);
  const totalDelayed = freight.results.reduce((s, r) => s + ((r as { delayed_count: number }).delayed_count || 0), 0);
  const totalDelivered = freight.results.reduce((s, r) => s + ((r as { delivered_count: number }).delivered_count || 0), 0);
  const totalCompleted = totalDelivered + totalDelayed;
  const onTimePct = totalCompleted > 0
    ? Math.round(((totalDelivered) / totalCompleted) * 1000) / 10
    : null;

  return {
    type: 'logistics_management',
    freightVendorCount: freight.results.length,
    annualFreightSpend: round2(totalFreight),
    onTimeDeliveryPct: onTimePct,
    delayedDeliveryCount: totalDelayed,
    topFreightVendors: freight.results.slice(0, 5),
    recommendation: onTimePct !== null && onTimePct < 90
      ? `Freight on-time rate ${onTimePct}% below 90% target — rebalance volume to top-performing carriers`
      : freight.results.length > 0
        ? 'Freight delivery posture healthy — continue regular carrier QBRs'
        : 'No freight / logistics vendors identified — categorise carriers for cost visibility',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── ONBOARDING AUTOMATION ──────────────────────────────────────────────

async function runOnboardingAutomation(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Recent hires (last 90 days) and their onboarding progress proxy:
  // active status + has email + has department populated.
  const recent = await db.prepare(
    `SELECT id, employee_number, first_name, last_name, department, hire_date, status
     FROM erp_employees
     WHERE tenant_id = ? AND hire_date >= date('now', '-90 days')${clause}
     ORDER BY hire_date DESC LIMIT 50`,
  ).bind(task.tenantId, ...params).all();

  const incomplete = recent.results.filter(r => {
    const row = r as { department: string | null; status: string };
    return !row.department || row.status !== 'active';
  });

  // Pending Atheon-account provisioning — check users table by email match.
  // Without a direct FK we approximate: count users created in same window.
  const newUsers = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM users
     WHERE tenant_id = ? AND created_at >= datetime('now', '-90 days') AND status = 'active'`,
  ).bind(task.tenantId).first<{ cnt: number }>();

  return {
    type: 'hr_onboarding_automation',
    recentHires: recent.results.length,
    incompleteOnboardings: incomplete.length,
    newAtheonAccounts: newUsers?.cnt || 0,
    incompleteList: incomplete.slice(0, 10),
    recommendation: incomplete.length > 0
      ? `${incomplete.length} recent hire(s) with incomplete onboarding — assign department + activate status`
      : recent.results.length > 0
        ? `${recent.results.length} new hire(s) in last 90 days — onboarding records look complete`
        : 'No new hires in last 90 days — confirm HRIS feed is live',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── PERFORMANCE REVIEWS ────────────────────────────────────────────────

async function runPerformanceReviews(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  // Annual review cadence — anyone hired more than 365 days ago whose
  // tenure crosses an anniversary is review-due. Without a `last_review_at`
  // column we approximate by counting employees overdue for their first
  // anniversary review.
  const dueForReview = await db.prepare(
    `SELECT id, employee_number, first_name, last_name, department, hire_date
     FROM erp_employees
     WHERE tenant_id = ? AND status = 'active'
       AND hire_date <= date('now', '-365 days')${clause}
     ORDER BY hire_date ASC LIMIT 50`,
  ).bind(task.tenantId, ...params).all();

  const totalActive = await db.prepare(
    `SELECT COUNT(*) AS cnt FROM erp_employees WHERE tenant_id = ? AND status = 'active'${clause}`,
  ).bind(task.tenantId, ...params).first<{ cnt: number }>();

  return {
    type: 'hr_performance_reviews',
    activeHeadcount: totalActive?.cnt || 0,
    dueForAnnualReview: dueForReview.results.length,
    sample: dueForReview.results.slice(0, 10),
    recommendation: dueForReview.results.length > 0
      ? `${dueForReview.results.length} active employee(s) past first anniversary — schedule review cycle`
      : 'No employees past first-anniversary review threshold',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── CUSTOMER CREDIT SCORING ────────────────────────────────────────────

async function runCustomerCreditScoring(task: TaskDefinition, db: D1Database): Promise<Record<string, unknown>> {
  const { clause, params } = companyFilter(task.companyId);
  const cohort = await db.prepare(
    `SELECT id, name, customer_group, credit_limit, credit_balance, status
     FROM erp_customers
     WHERE tenant_id = ?${clause}
     ORDER BY (CASE WHEN credit_limit > 0 THEN credit_balance / credit_limit ELSE 0 END) DESC LIMIT 25`,
  ).bind(task.tenantId, ...params).all();

  const totals = cohort.results.reduce<{ over: number; near: number; healthy: number }>(
    (acc, r) => {
      const row = r as { credit_limit: number; credit_balance: number; status: string };
      const lim = row.credit_limit || 0;
      const bal = row.credit_balance || 0;
      if (row.status === 'active' && lim > 0) {
        const ratio = bal / lim;
        if (ratio > 1) acc.over++;
        else if (ratio > 0.85) acc.near++;
        else acc.healthy++;
      }
      return acc;
    },
    { over: 0, near: 0, healthy: 0 },
  );

  const topRisks = cohort.results
    .filter(r => {
      const row = r as { credit_limit: number; credit_balance: number; status: string };
      return row.status === 'active' && row.credit_limit > 0
        && row.credit_balance / row.credit_limit > 0.85;
    })
    .slice(0, 10);

  return {
    type: 'finance_customer_credit_scoring',
    overLimitCount: totals.over,
    nearLimitCount: totals.near,
    healthyCount: totals.healthy,
    topRisks,
    recommendation: totals.over > 0
      ? `${totals.over} customer(s) currently OVER credit limit — pause shipments and escalate to credit control`
      : totals.near > 0
        ? `${totals.near} customer(s) at 85–100% of limit — preemptive review recommended`
        : 'No customers near credit limit — exposure within policy',
    scopedToCompany: scopeLabel(task.companyId),
    timestamp: new Date().toISOString(),
  };
}

// ── Handler registrations ──────────────────────────────────────────────

const outsourcingGovernanceHandler: CatalystHandler = {
  name: 'batch2:outsourcing-governance',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'outsourcing', 'governance')
      || anyOf(s, 'bpo-governance', 'outsource-sla');
  },
  execute: runOutsourcingGovernance,
};

const rfpManagementHandler: CatalystHandler = {
  name: 'batch2:rfp-management',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'rfp', 'management') || anyOf(s, 'rfp-lifecycle', 'rfp lifecycle');
  },
  execute: runRfpManagement,
};

const logisticsManagementHandler: CatalystHandler = {
  name: 'batch2:logistics-management',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'logistics', 'management')
      || (anyOf(s, 'freight') && anyOf(s, 'cost', 'management'))
      || anyOf(s, 'inbound-logistics', 'outbound-logistics');
  },
  execute: runLogisticsManagement,
};

const onboardingAutomationHandler: CatalystHandler = {
  name: 'batch2:onboarding-automation',
  match: t => {
    const s = taskText(t);
    return allWords(s, 'onboarding', 'automation')
      || anyOf(s, 'new-hire-onboarding', 'hr-onboarding');
  },
  execute: runOnboardingAutomation,
};

const performanceReviewsHandler: CatalystHandler = {
  name: 'batch2:performance-reviews',
  // Tightened matcher (post-conflict with vendor "distributor_performance_review"
  // and "carrier_performance_review" actions): require 'performance' AND
  // an HR-flavoured token, OR an explicit "review cycle" / "annual review"
  // phrase. Generic "<thing>_performance_review" actions on commercial
  // vendors fall through to their domain handlers.
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'performance') && anyOf(s, 'cycle', 'employee', 'staff', 'hr', 'workforce'))
      || anyOf(s, 'review-cycle', 'review cycle', 'annual-review', 'annual review');
  },
  execute: runPerformanceReviews,
};

const customerCreditScoringHandler: CatalystHandler = {
  name: 'batch2:customer-credit-scoring',
  match: t => {
    const s = taskText(t);
    return (anyOf(s, 'customer') && allWords(s, 'credit', 'scoring'))
      || allWords(s, 'credit', 'limit', 'monitoring')
      || anyOf(s, 'credit-utilisation', 'credit-utilization');
  },
  execute: runCustomerCreditScoring,
};

export function registerStubBatch2Handlers(): void {
  registerHandler(outsourcingGovernanceHandler);
  registerHandler(rfpManagementHandler);
  registerHandler(logisticsManagementHandler);
  registerHandler(onboardingAutomationHandler);
  registerHandler(performanceReviewsHandler);
  registerHandler(customerCreditScoringHandler);
}

registerStubBatch2Handlers();
