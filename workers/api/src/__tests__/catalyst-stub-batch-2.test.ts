/**
 * Stub batch 2 — bespoke handler tests.
 *
 * Same pattern as batch 1: seed realistic fixtures, assert each handler
 * returns its domain-specific `type` discriminator + the expected
 * evidence numbers.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import '../services/catalyst-engine';
import { dispatchAction } from '../services/catalyst-handler-registry';
import type { TaskDefinition } from '../services/catalyst-engine';

const TENANT = 'stub-batch-2-tenant';

function makeTask(overrides: Partial<TaskDefinition>): TaskDefinition {
  return {
    id: `b2-${crypto.randomUUID()}`,
    clusterId: 'b2-cluster',
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
  await runSql(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`,
    TENANT, 'Batch-2 Test', 'b2-test',
  );
  await runSql(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system) VALUES ('b2-adapter', 'Test', 'test')`,
  );

  // Suppliers covering services / freight / generic categories.
  await runSql(
    `INSERT OR REPLACE INTO erp_suppliers (id, tenant_id, name, supplier_group, risk_score, status, country) VALUES
     (?, ?, 'Acme Consulting Services', 'consulting', 0.3, 'active', 'ZA'),
     (?, ?, 'BPO Solutions',             'bpo',        0.5, 'active', 'ZA'),
     (?, ?, 'FastFreight Logistics',     'freight',    0.2, 'active', 'ZA'),
     (?, ?, 'Generic Co',                'wholesale',  0.4, 'active', 'ZA')`,
    'b2-sup-1', TENANT, 'b2-sup-2', TENANT, 'b2-sup-3', TENANT, 'b2-sup-4', TENANT,
  );

  const today = new Date().toISOString().slice(0, 10);
  const old65 = new Date(Date.now() - 65 * 86400 * 1000).toISOString().slice(0, 10);
  // POs:
  //   - 2 services POs, one delayed (SLA breach proxy)
  //   - 2 freight POs, one delayed (logistics on-time signal)
  //   - 1 large open (pending) PO above RFP threshold + an old stale one
  await runSql(
    `INSERT OR REPLACE INTO erp_purchase_orders (id, tenant_id, po_number, supplier_id, supplier_name, order_date, delivery_date, total, delivery_status, status) VALUES
     (?, ?, 'B2-1', ?, 'Acme Consulting Services', ?, ?, 200000, 'delivered', 'approved'),
     (?, ?, 'B2-2', ?, 'BPO Solutions',             ?, ?, 150000, 'delayed',   'approved'),
     (?, ?, 'B2-3', ?, 'BPO Solutions',             ?, ?, 100000, 'delayed',   'approved'),
     (?, ?, 'B2-4', ?, 'FastFreight Logistics',     ?, ?, 50000,  'delivered', 'approved'),
     (?, ?, 'B2-5', ?, 'FastFreight Logistics',     ?, ?, 50000,  'delayed',   'approved'),
     (?, ?, 'B2-6', ?, 'Generic Co',                ?, ?, 250000, 'delivered', 'pending'),
     (?, ?, 'B2-7', ?, 'Generic Co',                ?, ?, 150000, 'delivered', 'pending')`,
    'b2-po-1', TENANT, 'b2-sup-1', today, today,
    'b2-po-2', TENANT, 'b2-sup-2', today, today,
    'b2-po-3', TENANT, 'b2-sup-2', today, today,
    'b2-po-4', TENANT, 'b2-sup-3', today, today,
    'b2-po-5', TENANT, 'b2-sup-3', today, today,
    'b2-po-6', TENANT, 'b2-sup-4', today, today,
    'b2-po-7', TENANT, 'b2-sup-4', old65, old65, // stale RFP
  );

  // Employees: 1 recent hire (incomplete - no department),
  //            1 recent hire complete,
  //            1 employee 400 days tenured (past anniversary),
  //            1 employee 30 days tenured.
  const days = (n: number) => new Date(Date.now() - n * 86400 * 1000).toISOString().slice(0, 10);
  await runSql(
    `INSERT OR REPLACE INTO erp_employees (id, tenant_id, employee_number, first_name, last_name, department, position, hire_date, gross_salary, status) VALUES
     (?, ?, 'B2-E1', 'Alice', 'A', NULL,        'Op', ?, 40000, 'active'),
     (?, ?, 'B2-E2', 'Bob',   'B', 'Operations','Op', ?, 50000, 'active'),
     (?, ?, 'B2-E3', 'Carol', 'C', 'Engineering','Eng', ?, 70000, 'active'),
     (?, ?, 'B2-E4', 'Dave',  'D', 'Sales',     'Rep', ?, 45000, 'active')`,
    'b2-emp-1', TENANT, days(45),
    'b2-emp-2', TENANT, days(30),
    'b2-emp-3', TENANT, days(400),
    'b2-emp-4', TENANT, days(30),
  );

  // Customers: one over-limit, one near-limit, one healthy.
  await runSql(
    `INSERT OR REPLACE INTO erp_customers (id, tenant_id, name, customer_group, credit_limit, credit_balance, status) VALUES
     (?, ?, 'OverLimit Co', 'enterprise', 100000, 120000, 'active'),
     (?, ?, 'NearLimit Co', 'enterprise', 100000,  90000, 'active'),
     (?, ?, 'Healthy Co',   'enterprise', 100000,  20000, 'active')`,
    'b2-cust-1', TENANT, 'b2-cust-2', TENANT, 'b2-cust-3', TENANT,
  );
}

describe('Stub batch 2 — bespoke handlers', () => {
  beforeAll(async () => {
    const migRes = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST',
      headers: { 'X-Setup-Secret': 'test-setup-secret-for-testing123' },
    });
    if (migRes.status !== 200) throw new Error(`Migration failed: ${migRes.status}`);
    await seedFixtures();
  });

  it('Outsourcing Governance flags services vendors with delayed SLA', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'outsourcing governance review',
    }), env.DB);
    expect(out.type).toBe('procurement_outsourcing_governance');
    expect(out._handler).toBe('batch2:outsourcing-governance');
    expect(out.serviceVendorCount).toBeGreaterThanOrEqual(2);
    // BPO Solutions is 100% delayed (2/2) — should breach
    expect(out.slaBreachCount).toBeGreaterThanOrEqual(1);
  });

  it('RFP Management flags stale open RFPs', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Procurement Catalyst',
      action: 'rfp management lifecycle',
    }), env.DB);
    expect(out.type).toBe('procurement_rfp_management');
    expect(out.openRfpCount).toBeGreaterThanOrEqual(2);
    expect(out.staleRfpCount).toBeGreaterThanOrEqual(1);
  });

  it('Logistics Management computes on-time delivery for freight vendors', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Logistics Catalyst',
      action: 'logistics management review',
    }), env.DB);
    expect(out.type).toBe('logistics_management');
    expect(out.freightVendorCount).toBeGreaterThanOrEqual(1);
    // FastFreight: 1 delivered + 1 delayed → 50% on-time
    expect(out.onTimeDeliveryPct).toBeLessThanOrEqual(80);
  });

  it('Onboarding Automation flags incomplete recent-hire records', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'HR Catalyst',
      action: 'onboarding automation status',
    }), env.DB);
    expect(out.type).toBe('hr_onboarding_automation');
    expect(out.recentHires).toBeGreaterThanOrEqual(2);
    // Alice has no department → incomplete
    expect(out.incompleteOnboardings).toBeGreaterThanOrEqual(1);
  });

  it('Performance Reviews lists employees past first anniversary', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'HR Catalyst',
      action: 'performance reviews cycle',
    }), env.DB);
    expect(out.type).toBe('hr_performance_reviews');
    // Carol is 400 days tenured → due
    expect(out.dueForAnnualReview).toBeGreaterThanOrEqual(1);
  });

  it('Customer Credit Scoring separates over-limit / near-limit / healthy', async () => {
    const out = await dispatchAction(makeTask({
      catalystName: 'Finance Catalyst',
      action: 'customer credit scoring review',
    }), env.DB);
    expect(out.type).toBe('finance_customer_credit_scoring');
    expect(out.overLimitCount).toBeGreaterThanOrEqual(1);
    expect(out.nearLimitCount).toBeGreaterThanOrEqual(1);
    expect(out.healthyCount).toBeGreaterThanOrEqual(1);
  });
});
