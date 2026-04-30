/**
 * Stub-batch-1 handler test — exercises the 8 bespoke handlers added to
 * convert previously-stubbed sub-catalysts into evidence-grounded
 * specialists.
 *
 * Each test seeds realistic fixtures and asserts the handler returns its
 * domain-specific `type` discriminator + the expected evidence numbers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import '../services/catalyst-engine';
import { dispatchAction } from '../services/catalyst-handler-registry';
import type { TaskDefinition } from '../services/catalyst-engine';

const TENANT = 'stub-batch-1-tenant';

function makeTask(overrides: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: `b1-${crypto.randomUUID()}`,
    clusterId: 'b1-cluster',
    tenantId: TENANT,
    catalystName: '',
    action: '',
    inputData: {},
    riskLevel: 'low',
    autonomyTier: 'read-only',
    trustScore: 50,
    ...overrides,
  };
}

async function runSql(sql: string, ...binds: unknown[]): Promise<void> {
  await env.DB.prepare(sql).bind(...binds).run();
}

async function seedFixtures(): Promise<void> {
  await runSql(`INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`, TENANT, 'Batch-1 Test', 'b1-test');

  // Adapters required for the FK on erp_connections — we use them anyway
  // to seed multiple suppliers below.
  await runSql(`INSERT OR IGNORE INTO erp_adapters (id, name, system) VALUES ('b1-adapter', 'Test', 'test')`);

  // Suppliers: high-risk, low-risk, medium-risk; mixed activity.
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country) VALUES
     (?, ?, 'High Risk Co', 'wholesale', 0.8, 'active', 'ZA'),
     (?, ?, 'Steady Co',    'wholesale', 0.3, 'active', 'ZA'),
     (?, ?, 'Acme SaaS',    'wholesale', 0.4, 'active', 'ZA')`,
    'b1-sup-1', TENANT, 'b1-sup-2', TENANT, 'b1-sup-3', TENANT,
  );

  // Products in two distinct categories so Strategic Sourcing has data.
  await runSql(
    `INSERT OR REPLACE INTO erp_products (id, tenant_id, sku, name, category, stock_on_hand, reorder_level, reorder_quantity, cost_price, selling_price, is_active, warehouse) VALUES
     (?, ?, 'B1-A', 'Widget A', 'widgets', 50, 10, 20, 100, 200, 1, 'WH-1'),
     (?, ?, 'B1-B', 'Gadget B', 'gadgets', 50, 10, 20, 50, 120, 1, 'WH-1')`,
    'b1-prod-1', TENANT, 'b1-prod-2', TENANT,
  );

  const today = new Date().toISOString().slice(0, 10);
  // POs: 2 in widgets (different suppliers → consolidation candidate),
  //      1 large above tender threshold,
  //      2 same-supplier same-amount within recent window (duplicate-spend signal),
  //      1 SaaS-flagged supplier.
  await runSql(
    `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_id, supplier_name, order_date, delivery_date, total, delivery_status, status) VALUES
     (?, ?, 'PO-1', ?, 'Steady Co',    ?, ?, 350000, 'delivered', 'approved'),
     (?, ?, 'PO-2', ?, 'High Risk Co', ?, ?, 200000, 'delayed',   'approved'),
     (?, ?, 'PO-3', ?, 'Steady Co',    ?, ?, 100000, 'delivered', 'approved'),
     (?, ?, 'PO-4', ?, 'Steady Co',    ?, ?, 100000, 'delivered', 'approved'),
     (?, ?, 'PO-5', ?, 'Acme SaaS',    ?, ?, 75000,  'delivered', 'approved')`,
    'b1-po-1', TENANT, 'b1-sup-2', today, today,
    'b1-po-2', TENANT, 'b1-sup-1', today, today,
    'b1-po-3', TENANT, 'b1-sup-2', today, today,
    'b1-po-4', TENANT, 'b1-sup-2', today, today,
    'b1-po-5', TENANT, 'b1-sup-3', today, today,
  );

  // Employees in two departments for Cost Allocation / Financial Reporting.
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, gross_salary, status) VALUES
     (?, ?, 'B1-E1', 'Alice', 'A', 'Engineering', 'Eng',     '2022-01-01', 60000, 'active'),
     (?, ?, 'B1-E2', 'Bob',   'B', 'Engineering', 'Eng',     '2022-01-01', 60000, 'active'),
     (?, ?, 'B1-E3', 'Carol', 'C', 'Operations',  'Manager', '2021-01-01', 80000, 'active')`,
    'b1-emp-1', TENANT, 'b1-emp-2', TENANT, 'b1-emp-3', TENANT,
  );

  // Invoices spanning 4 months of history for Budget Forecasting.
  for (let m = 0; m < 4; m++) {
    const date = new Date(Date.now() - m * 30 * 86400 * 1000).toISOString().slice(0, 10);
    await runSql(
      `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status) VALUES (?, ?, ?, NULL, 'Test Customer', ?, ?, ?, 0, 'paid', 'issued')`,
      `b1-inv-${m}`, TENANT, `INV-B1-${m}`, date, date, 100000 + m * 5000,
    );
  }
  // Plus an unpaid invoice to make AR visible in Financial Reporting.
  await runSql(
    `INSERT OR REPLACE INTO erp_invoices (id, tenant_id, invoice_number, customer_id, customer_name, invoice_date, due_date, total, amount_due, payment_status, status) VALUES (?, ?, ?, NULL, 'Slow Payer', ?, ?, 250000, 250000, 'unpaid', 'issued')`,
    'b1-inv-overdue', TENANT, 'INV-B1-OD', today, today,
  );
}

describe('Stub batch 1 — bespoke handlers', () => {
  beforeAll(async () => {
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);
    await seedFixtures();
  });

  it('Strategic Sourcing surfaces categorised spend + concentration risks', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'run strategic sourcing analysis',
    }), env.DB);
    expect(out.type).toBe('procurement_strategic_sourcing');
    expect(out._handler).toBe('batch1:strategic-sourcing');
    expect(Array.isArray(out.categoryBreakdown)).toBe(true);
  });

  it('Vendor Scoring ranks suppliers and flags low scores', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'compute vendor scoring scorecard',
    }), env.DB);
    expect(out.type).toBe('procurement_vendor_scoring');
    expect(out._handler).toBe('batch1:vendor-scoring');
    expect(out.supplierCount).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(out.bottomScored)).toBe(true);
  });

  it('Tender Management flags POs above the policy threshold', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'tender management review',
    }), env.DB);
    expect(out.type).toBe('procurement_tender_management');
    expect(out.thresholdZar).toBe(250000);
    // PO-1 is 350k → above threshold
    expect(out.poCountAboveThreshold).toBeGreaterThanOrEqual(1);
  });

  it('Cost Optimization flags duplicate-spend candidates', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'cost optimization scan',
    }), env.DB);
    expect(out.type).toBe('procurement_cost_optimization');
    // PO-3 + PO-4 are same supplier + same rounded amount → duplicate group
    expect(out.suspectDuplicateGroupCount).toBeGreaterThanOrEqual(1);
  });

  it('SaaS License Management identifies SaaS-tagged spend', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'saas license management audit',
    }), env.DB);
    expect(out.type).toBe('procurement_saas_license_management');
    // Acme SaaS PO should match
    expect(out.saasSupplierCount).toBeGreaterThanOrEqual(1);
  });

  it('Cost Allocation computes department headcount shares', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Finance Operations Catalyst',
      action: 'cost allocation by department',
    }), env.DB);
    expect(out.type).toBe('finance_cost_allocation');
    expect(out.departmentCount).toBeGreaterThanOrEqual(2);
    // 3 employees total: 2 Engineering, 1 Operations → shares ~67% / ~33%
    const allocations = out.allocations as Array<{ department: string; sharePct: number }>;
    const eng = allocations.find(a => a.department === 'Engineering');
    expect(eng?.sharePct).toBeGreaterThan(50);
  });

  it('Budget Forecasting projects from rolling-3-month average', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Finance Operations Catalyst',
      action: 'budget forecasting projection',
    }), env.DB);
    expect(out.type).toBe('finance_budget_forecasting');
    expect(out.historyMonths).toBeGreaterThanOrEqual(3);
    expect(Array.isArray(out.projection)).toBe(true);
    expect((out.projection as unknown[]).length).toBe(3);
  });

  it('Financial Reporting summarises AR/AP/payroll + top customer', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Finance Catalyst',
      action: 'generate financial reporting snapshot',
    }), env.DB);
    expect(out.type).toBe('finance_financial_reporting');
    // Unpaid 250k invoice should be visible in AR
    expect(out.accountsReceivable).toBeGreaterThanOrEqual(250000);
    // Total payroll = 60k+60k+80k = 200k
    expect(out.monthlyPayroll).toBe(200000);
  });
});
