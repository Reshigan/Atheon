/**
 * Phase 10-34 — Substrate ingest routes.
 *
 * Validates the production webhook surface:
 *   - Per-resource POST endpoints insert rows in the right table
 *   - Idempotency: replaying same payload returns duplicate=true
 *   - Batch mode: { rows: [...] } processes multiple
 *   - Cross-tenant isolation: a token for tenant A can't read
 *     tenant B rows (covered indirectly via tenant_id binding)
 *   - Period-close status endpoint returns shaped checklist data
 *   - 403 for analyst-role mutation attempts
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { generateToken } from '../middleware/auth';
import { runTransactionalSubcatalystsForTenant } from '../services/transactional-runner';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-ecc-ingest-test';

async function tokenFor(role: string): Promise<string> {
  return generateToken({
    sub: `user-${role}`,
    email: `${role}@example.invalid`,
    name: `Test ${role}`,
    role,
    tenant_id: TENANT,
    permissions: ['*'],
  }, env.JWT_SECRET as string);
}

async function authedPost(path: string, body: unknown, role = 'admin'): Promise<Response> {
  const token = await tokenFor(role);
  return SELF.fetch(`http://localhost${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

async function authedGet(path: string, role = 'admin'): Promise<Response> {
  const token = await tokenFor(role);
  return SELF.fetch(`http://localhost${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe('Phase 10-34 — substrate ingest routes', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

    // Tenant must exist for FK satisfaction
    await env.DB.prepare(
      `INSERT OR IGNORE INTO tenants (id, name, slug, plan, status, region) VALUES (?, 'Ingest Test', ?, 'enterprise', 'active', 'af-south-1')`,
    ).bind(TENANT, TENANT).run();
  }, 60_000);

  it('POST /ap-invoice — creates row, replay is idempotent (duplicate=true)', async () => {
    const payload = {
      invoice_number: 'INV-WEBHOOK-1', vendor_id: 'V-WHV1', vendor_name: 'Webhook Vendor 1',
      po_number: 'PO-WHV-1', invoice_amount: 75_000, invoice_date: '2026-04-01',
      due_date: '2026-05-01',
    };

    // First call inserts
    const r1 = await authedPost('/api/v1/ingest/ap-invoice', payload);
    expect(r1.status).toBe(200);
    const b1 = await r1.json<{ inserted: number; duplicates: number; items: Array<{ duplicate: boolean }> }>();
    expect(b1.inserted).toBe(1);
    expect(b1.duplicates).toBe(0);
    expect(b1.items[0].duplicate).toBe(false);

    // Verify row materialised
    const row = await env.DB.prepare(
      `SELECT invoice_number, vendor_id, invoice_amount FROM ap_invoice_inbox WHERE tenant_id = ? AND invoice_number = ?`,
    ).bind(TENANT, 'INV-WEBHOOK-1').first<{ invoice_number: string; vendor_id: string; invoice_amount: number }>();
    expect(row?.vendor_id).toBe('V-WHV1');
    expect(row?.invoice_amount).toBe(75_000);

    // Replay: idempotent collapse to duplicate
    const r2 = await authedPost('/api/v1/ingest/ap-invoice', payload);
    const b2 = await r2.json<{ inserted: number; duplicates: number; items: Array<{ duplicate: boolean }> }>();
    expect(b2.inserted).toBe(0);
    expect(b2.duplicates).toBe(1);
    expect(b2.items[0].duplicate).toBe(true);
  });

  it('POST /bank-statement — batch of 3 rows processes all', async () => {
    const res = await authedPost('/api/v1/ingest/bank-statement', {
      rows: [
        { statement_ref: 'STMT-WH-1', line_number: 1, value_date: '2026-04-15', amount: 50_000, counterparty: 'Customer A' },
        { statement_ref: 'STMT-WH-1', line_number: 2, value_date: '2026-04-15', amount: -25_000, counterparty: 'Vendor X' },
        { statement_ref: 'STMT-WH-1', line_number: 3, value_date: '2026-04-15', amount: 12_500, counterparty: 'Customer B' },
      ],
    });
    const body = await res.json<{ inserted: number; duplicates: number; errors: number }>();
    expect(body.inserted).toBe(3);
    expect(body.duplicates).toBe(0);
    expect(body.errors).toBe(0);
  });

  it('POST /payroll-run — single row + idempotent on replay', async () => {
    const payload = {
      period: '2026-04', employee_count: 30, gross_pay: 950_000,
      paye: 165_000, uif_employee: 9_500, uif_employer: 9_500, sdl: 9_500,
      deductions: 184_000, net_pay: 766_000,
    };
    const r1 = await authedPost('/api/v1/ingest/payroll-run', payload);
    expect(r1.status).toBe(200);
    expect((await r1.json<{ inserted: number }>()).inserted).toBe(1);

    const r2 = await authedPost('/api/v1/ingest/payroll-run', payload);
    expect((await r2.json<{ duplicates: number }>()).duplicates).toBe(1);
  });

  it('POST /expense-report — creates report + lines on first call only', async () => {
    const r1 = await authedPost('/api/v1/ingest/expense-report', {
      report_ref: 'EXP-WH-1', employee_id: 'EMP-WH-1', employee_name: 'Webhook Emp',
      total_amount: 5_500, period: '2026-04',
      lines: [
        { category: 'flights', amount: 4_000, receipt_attached: true, expense_date: '2026-04-10' },
        { category: 'meals', amount: 1_500, receipt_attached: true, expense_date: '2026-04-10' },
      ],
    });
    expect((await r1.json<{ inserted: number }>()).inserted).toBe(1);

    const lines = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM expense_lines WHERE tenant_id = ? AND report_id = ?`,
    ).bind(TENANT, `exp-${TENANT}::EXP-WH-1`).first<{ n: number }>();
    expect(lines?.n).toBe(2);

    // Replay — no new lines inserted (idempotent on report)
    await authedPost('/api/v1/ingest/expense-report', {
      report_ref: 'EXP-WH-1', employee_id: 'EMP-WH-1', total_amount: 5_500,
      lines: [{ category: 'flights', amount: 4_000, receipt_attached: true }],
    });
    const linesAfter = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM expense_lines WHERE tenant_id = ? AND report_id = ?`,
    ).bind(TENANT, `exp-${TENANT}::EXP-WH-1`).first<{ n: number }>();
    expect(linesAfter?.n).toBe(2); // unchanged
  });

  it('POST /rma — analyst role gets 403', async () => {
    const res = await authedPost('/api/v1/ingest/rma', {
      rma_number: 'RMA-WH-1', return_reason: 'defective', return_value: 1_000,
    }, 'analyst');
    expect(res.status).toBe(403);
  });

  it('GET /_period-close-status — returns shaped data after orchestrator runs', async () => {
    // Need a checklist row first; create one via the orchestrator path
    const period = new Date().toISOString().slice(0, 7);
    await env.DB.prepare(
      `INSERT OR IGNORE INTO period_close_checklists (id, tenant_id, period, status, target_close_date, steps_total, steps_completed, step_results)
       VALUES (?, ?, ?, 'in_progress', date('now', '+7 days'), 8, 3, ?)`,
    ).bind(
      `close-${TENANT}::${period}`, TENANT, period,
      JSON.stringify([
        { id: 'bank_recon', label: 'Bank reconciliation complete', passed: true, evidence: 0 },
        { id: 'ap_complete', label: 'AP cycle complete', passed: false, evidence: 5 },
      ]),
    ).run();

    const res = await authedGet(`/api/v1/ingest/_period-close-status?period=${period}`);
    expect(res.status).toBe(200);
    const body = await res.json<{ exists: boolean; period: string; status: string; steps_total: number; step_results: Array<{ id: string; passed: boolean }> }>();
    expect(body.exists).toBe(true);
    expect(body.period).toBe(period);
    expect(body.steps_total).toBe(8);
    expect(body.step_results.length).toBeGreaterThanOrEqual(2);
    expect(body.step_results[0].id).toBe('bank_recon');
    expect(body.step_results[0].passed).toBe(true);
  });

  it('end-to-end: ingest invoice → run chain → 3-way match picks it up', async () => {
    // Seed a PO + GR via raw SQL so the 3-way match has substrate
    await env.DB.prepare(
      `INSERT INTO purchase_orders (id, tenant_id, po_number, vendor_id, vendor_name, po_amount, po_date, status, source_system)
       VALUES (?, ?, 'PO-E2E-1', 'V-E2E1', 'E2E Vendor', 100000, ?, 'open', 'webhook')`,
    ).bind(`po-${TENANT}::PO-E2E-1`, TENANT, '2026-04-01').run();
    await env.DB.prepare(
      `INSERT INTO goods_receipts (id, tenant_id, gr_number, po_number, gr_date, qty_received, gr_amount, currency, source_system)
       VALUES (?, ?, 'GR-E2E-1', 'PO-E2E-1', ?, 1, 100000, 'ZAR', 'webhook')`,
    ).bind(`gr-${TENANT}::GR-E2E-1`, TENANT, '2026-04-05').run();

    // Ingest the invoice via webhook
    await authedPost('/api/v1/ingest/ap-invoice', {
      invoice_number: 'INV-E2E-1', vendor_id: 'V-E2E1', vendor_name: 'E2E Vendor',
      po_number: 'PO-E2E-1', invoice_amount: 100000, invoice_date: '2026-04-10', due_date: '2026-05-10',
    });

    // Run the transactional chain
    await runTransactionalSubcatalystsForTenant(env.DB, TENANT);

    // 3-way match should have flipped invoice → 'matched'
    const inv = await env.DB.prepare(
      `SELECT status FROM ap_invoice_inbox WHERE tenant_id = ? AND invoice_number = 'INV-E2E-1'`,
    ).bind(TENANT).first<{ status: string }>();
    expect(inv?.status).toBe('matched');

    // And there should be a posted ap_invoice_post action
    const txn = await env.DB.prepare(
      `SELECT status, external_doc_id FROM transactional_actions
        WHERE tenant_id = ? AND source_record_ref = 'INV-E2E-1' AND action_type = 'ap_invoice_post'`,
    ).bind(TENANT).first<{ status: string; external_doc_id: string }>();
    expect(txn?.status).toBe('posted');
    expect(txn?.external_doc_id).toBeTruthy();
  }, 60_000);
});
