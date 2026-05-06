/**
 * Substrate Ingest Routes — Phase 10-34.
 *
 * Production callers (email-to-invoice services, T&E SaaS, payroll
 * vendors, bank statement parsers, ERP middleware) post here to fill
 * the action-layer substrate tables. Once a row lands, the next cron
 * tick's transactional runner picks it up and processes it.
 *
 * Every endpoint:
 *   - Tenant-scoped via existing JWT auth (auth.tenantId)
 *   - Mutation requires admin/operator/integration role
 *   - Idempotent via the substrate table's natural-key UNIQUE
 *     constraint — duplicate replays collapse to no-op
 *   - Returns { id, duplicate } so the caller knows whether the
 *     row was newly created or already existed
 *
 * Why a dedicated /ingest namespace instead of mounting under each
 * resource: production webhook callers want one well-known prefix
 * to point their integration at, with a single auth model. The
 * existing resource routes (e.g. /api/v1/billing) are read-mostly
 * surfaces shaped around the UI; the ingest surface is write-only
 * and shaped around the source-of-truth feed.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { logInfo, logWarn } from '../services/logger';

const ingest = new Hono<AppBindings>();

const MUTATION_ROLES = new Set([
  'superadmin', 'support_admin', 'admin', 'operator', 'integration',
]);

function getTenantId(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || '';
}

function getRole(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.role || '';
}

function authGate(c: { get: (k: string) => unknown }): { tenantId: string; ok: boolean; reason?: string } {
  const tenantId = getTenantId(c);
  if (!tenantId) return { tenantId: '', ok: false, reason: 'tenant scope required' };
  if (!MUTATION_ROLES.has(getRole(c))) return { tenantId, ok: false, reason: 'forbidden' };
  return { tenantId, ok: true };
}

/** Generic upsert helper: inserts a row, returns whether the
 *  natural-key UNIQUE made it a no-op. Used by every endpoint so
 *  idempotency is consistent across the surface. */
async function upsertRow(
  db: D1Database,
  insertSql: string,
  binds: unknown[],
  selectIdSql: string,
  selectIdBinds: unknown[],
): Promise<{ id: string; duplicate: boolean }> {
  // Try select first — saves a roundtrip on hot duplicate paths
  const existing = await db.prepare(selectIdSql).bind(...selectIdBinds).first<{ id: string }>();
  if (existing) return { id: existing.id, duplicate: true };

  try {
    await db.prepare(insertSql).bind(...binds).run();
  } catch (err) {
    // UNIQUE-violation race: another caller inserted between our
    // select and insert. Re-read to get their id; surface true error
    // for any other failure.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('UNIQUE') || msg.includes('SQLITE_CONSTRAINT')) {
      const row = await db.prepare(selectIdSql).bind(...selectIdBinds).first<{ id: string }>();
      if (row) return { id: row.id, duplicate: true };
    }
    throw err;
  }
  const fresh = await db.prepare(selectIdSql).bind(...selectIdBinds).first<{ id: string }>();
  return { id: fresh?.id ?? '', duplicate: false };
}

interface IngestBatchResponse<T = { id: string; duplicate: boolean }> {
  inserted: number;
  duplicates: number;
  errors: number;
  items: T[];
  errorDetails?: string[];
}

async function processBatch<T>(
  items: T[],
  process: (item: T) => Promise<{ id: string; duplicate: boolean }>,
  context: string,
  tenantId: string,
): Promise<IngestBatchResponse> {
  const result: IngestBatchResponse = { inserted: 0, duplicates: 0, errors: 0, items: [], errorDetails: [] };
  for (const item of items) {
    try {
      const out = await process(item);
      result.items.push(out);
      if (out.duplicate) result.duplicates++; else result.inserted++;
    } catch (err) {
      result.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      result.errorDetails!.push(msg);
      logWarn('ingest.row_failed', { tenantId, layer: 'ingest', action: context }, { error: msg });
    }
  }
  if (result.errorDetails!.length === 0) delete result.errorDetails;
  logInfo('ingest.batch_completed',
    { tenantId, layer: 'ingest', action: context },
    { inserted: result.inserted, duplicates: result.duplicates, errors: result.errors });
  return result;
}

// ════════════════════════════════════════════════════════════════
// AP — invoice inbox (raw + parsed) + vendor statements
// ════════════════════════════════════════════════════════════════

interface RawInvoiceBody {
  source_channel?: string;       // 'email' | 'portal' | 'webhook'
  received_at?: string;
  raw_payload: Record<string, unknown>;
  erp_connection_id?: string | null;
}

ingest.post('/ap-invoice-raw', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: RawInvoiceBody[] } | RawInvoiceBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: RawInvoiceBody[] }).rows : [body as RawInvoiceBody];

  const result = await processBatch(rows, async (row) => {
    const id = `raw-${gate.tenantId}::${(row.raw_payload?.invoice_number as string) ?? crypto.randomUUID()}`;
    return upsertRow(c.env.DB,
      `INSERT INTO ap_invoice_inbox_raw (id, tenant_id, erp_connection_id, source_channel, received_at, raw_payload, parsed_status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [id, gate.tenantId, row.erp_connection_id ?? null, row.source_channel ?? 'webhook',
       row.received_at ?? new Date().toISOString(), JSON.stringify(row.raw_payload)],
      `SELECT id FROM ap_invoice_inbox_raw WHERE id = ?`, [id],
    );
  }, 'ap-invoice-raw', gate.tenantId);
  return c.json(result);
});

interface ApInvoiceBody {
  invoice_number: string;
  vendor_id?: string;
  vendor_name?: string;
  po_number?: string;
  invoice_amount: number;
  currency?: string;
  invoice_date?: string;
  due_date?: string;
  payment_terms?: string;
  line_items?: unknown[];
  source_system?: string;
  erp_connection_id?: string | null;
}

ingest.post('/ap-invoice', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: ApInvoiceBody[] } | ApInvoiceBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: ApInvoiceBody[] }).rows : [body as ApInvoiceBody];

  const result = await processBatch(rows, async (row) => {
    const id = `apinv-${gate.tenantId}::${row.invoice_number}`;
    return upsertRow(c.env.DB,
      `INSERT INTO ap_invoice_inbox (id, tenant_id, erp_connection_id, invoice_number, vendor_id, vendor_name,
         po_number, invoice_amount, currency, invoice_date, due_date, payment_terms, line_items, source_system, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received')`,
      [id, gate.tenantId, row.erp_connection_id ?? null, row.invoice_number, row.vendor_id ?? null, row.vendor_name ?? null,
       row.po_number ?? null, row.invoice_amount, row.currency ?? 'ZAR', row.invoice_date ?? null,
       row.due_date ?? null, row.payment_terms ?? 'NET30', JSON.stringify(row.line_items ?? []), row.source_system ?? 'webhook'],
      `SELECT id FROM ap_invoice_inbox WHERE tenant_id = ? AND invoice_number = ?`,
      [gate.tenantId, row.invoice_number],
    );
  }, 'ap-invoice', gate.tenantId);
  return c.json(result);
});

interface VendorStatementBody {
  vendor_id: string;
  vendor_name?: string;
  statement_period: string; // YYYY-MM
  opening_balance?: number;
  closing_balance: number;
  currency?: string;
  invoices?: unknown[];
  source_system?: string;
}

ingest.post('/vendor-statement', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: VendorStatementBody[] } | VendorStatementBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: VendorStatementBody[] }).rows : [body as VendorStatementBody];

  const result = await processBatch(rows, async (row) => {
    const id = `stmt-${gate.tenantId}::${row.vendor_id}::${row.statement_period}`;
    return upsertRow(c.env.DB,
      `INSERT INTO vendor_statements (id, tenant_id, vendor_id, vendor_name, statement_period, opening_balance, closing_balance, currency, invoices, source_system, recon_status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched')`,
      [id, gate.tenantId, row.vendor_id, row.vendor_name ?? null, row.statement_period,
       row.opening_balance ?? 0, row.closing_balance, row.currency ?? 'ZAR',
       JSON.stringify(row.invoices ?? []), row.source_system ?? 'webhook'],
      `SELECT id FROM vendor_statements WHERE tenant_id = ? AND vendor_id = ? AND statement_period = ?`,
      [gate.tenantId, row.vendor_id, row.statement_period],
    );
  }, 'vendor-statement', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// AR — sales orders + customer payments
// ════════════════════════════════════════════════════════════════

interface SalesOrderBody {
  so_number: string;
  customer_id?: string;
  customer_name?: string;
  so_amount: number;
  currency?: string;
  so_date?: string;
  fulfilled_at?: string;
  status?: string;
  billable?: boolean;
  line_items?: unknown[];
}

ingest.post('/sales-order', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: SalesOrderBody[] } | SalesOrderBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: SalesOrderBody[] }).rows : [body as SalesOrderBody];

  const result = await processBatch(rows, async (row) => {
    const id = `so-${gate.tenantId}::${row.so_number}`;
    return upsertRow(c.env.DB,
      `INSERT INTO sales_orders (id, tenant_id, so_number, customer_id, customer_name, so_amount, currency, so_date, fulfilled_at, billable, status, line_items, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'webhook')`,
      [id, gate.tenantId, row.so_number, row.customer_id ?? null, row.customer_name ?? null,
       row.so_amount, row.currency ?? 'ZAR', row.so_date ?? null, row.fulfilled_at ?? null,
       row.billable === false ? 0 : 1, row.status ?? 'open', JSON.stringify(row.line_items ?? [])],
      `SELECT id FROM sales_orders WHERE tenant_id = ? AND so_number = ?`,
      [gate.tenantId, row.so_number],
    );
  }, 'sales-order', gate.tenantId);
  return c.json(result);
});

interface CustomerPaymentBody {
  payment_ref: string;
  customer_id?: string;
  customer_name?: string;
  amount: number;
  currency?: string;
  received_date?: string;
  remittance_text?: string;
}

ingest.post('/customer-payment', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: CustomerPaymentBody[] } | CustomerPaymentBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: CustomerPaymentBody[] }).rows : [body as CustomerPaymentBody];

  const result = await processBatch(rows, async (row) => {
    const id = `pay-${gate.tenantId}::${row.payment_ref}`;
    return upsertRow(c.env.DB,
      `INSERT INTO customer_payments (id, tenant_id, payment_ref, customer_id, customer_name, amount, currency, received_date, remittance_text, application_status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unapplied', 'webhook')`,
      [id, gate.tenantId, row.payment_ref, row.customer_id ?? null, row.customer_name ?? null,
       row.amount, row.currency ?? 'ZAR', row.received_date ?? new Date().toISOString().slice(0, 10),
       row.remittance_text ?? null],
      `SELECT id FROM customer_payments WHERE tenant_id = ? AND payment_ref = ?`,
      [gate.tenantId, row.payment_ref],
    );
  }, 'customer-payment', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Treasury — bank statements
// ════════════════════════════════════════════════════════════════

interface BankLineBody {
  statement_ref: string;
  line_number: number;
  value_date?: string;
  amount: number;
  currency?: string;
  counterparty?: string;
  narrative?: string;
}

ingest.post('/bank-statement', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: BankLineBody[] } | BankLineBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: BankLineBody[] }).rows : [body as BankLineBody];

  const result = await processBatch(rows, async (row) => {
    const id = `bnk-${gate.tenantId}::${row.statement_ref}::${row.line_number}`;
    return upsertRow(c.env.DB,
      `INSERT INTO bank_statement_lines (id, tenant_id, statement_ref, line_number, value_date, amount, currency, counterparty, narrative, recon_status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', 'webhook')`,
      [id, gate.tenantId, row.statement_ref, row.line_number, row.value_date ?? null,
       row.amount, row.currency ?? 'ZAR', row.counterparty ?? null, row.narrative ?? null],
      `SELECT id FROM bank_statement_lines WHERE tenant_id = ? AND statement_ref = ? AND line_number = ?`,
      [gate.tenantId, row.statement_ref, row.line_number],
    );
  }, 'bank-statement', gate.tenantId);
  return c.json(result);
});

interface FxRateBody {
  currency_pair: string;
  rate: number;
  rate_date: string;
  source?: string;
}

ingest.post('/fx-rate', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: FxRateBody[] } | FxRateBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: FxRateBody[] }).rows : [body as FxRateBody];

  const result = await processBatch(rows, async (row) => {
    const id = `fx-${gate.tenantId}::${row.currency_pair}::${row.rate_date}`;
    return upsertRow(c.env.DB,
      `INSERT INTO fx_rates (id, tenant_id, currency_pair, rate, rate_date, source)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, gate.tenantId, row.currency_pair, row.rate, row.rate_date, row.source ?? 'webhook'],
      `SELECT id FROM fx_rates WHERE tenant_id = ? AND currency_pair = ? AND rate_date = ?`,
      [gate.tenantId, row.currency_pair, row.rate_date],
    );
  }, 'fx-rate', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Payroll
// ════════════════════════════════════════════════════════════════

interface PayrollRunBody {
  period: string; // YYYY-MM
  employee_count?: number;
  gross_pay: number;
  paye?: number; uif_employee?: number; uif_employer?: number; sdl?: number;
  deductions?: number; net_pay: number;
  currency?: string;
  raw_data?: Record<string, unknown>;
}

ingest.post('/payroll-run', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: PayrollRunBody[] } | PayrollRunBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: PayrollRunBody[] }).rows : [body as PayrollRunBody];

  const result = await processBatch(rows, async (row) => {
    const id = `payroll-${gate.tenantId}::${row.period}`;
    return upsertRow(c.env.DB,
      `INSERT INTO payroll_runs (id, tenant_id, period, employee_count, gross_pay, paye, uif_employee, uif_employer, sdl, deductions, net_pay, currency, status, raw_data)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [id, gate.tenantId, row.period, row.employee_count ?? 0, row.gross_pay,
       row.paye ?? 0, row.uif_employee ?? 0, row.uif_employer ?? 0, row.sdl ?? 0,
       row.deductions ?? 0, row.net_pay, row.currency ?? 'ZAR',
       JSON.stringify(row.raw_data ?? {})],
      `SELECT id FROM payroll_runs WHERE tenant_id = ? AND period = ?`,
      [gate.tenantId, row.period],
    );
  }, 'payroll-run', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// T&E — expense reports + lines (paired in one POST)
// ════════════════════════════════════════════════════════════════

interface ExpenseReportBody {
  report_ref: string;
  employee_id: string;
  employee_name?: string;
  period?: string;
  total_amount: number;
  currency?: string;
  lines: Array<{
    category: string;
    amount: number;
    currency?: string;
    merchant?: string;
    expense_date?: string;
    receipt_attached?: boolean;
  }>;
}

ingest.post('/expense-report', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: ExpenseReportBody[] } | ExpenseReportBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: ExpenseReportBody[] }).rows : [body as ExpenseReportBody];

  const result = await processBatch(rows, async (row) => {
    const reportId = `exp-${gate.tenantId}::${row.report_ref}`;
    const upsert = await upsertRow(c.env.DB,
      `INSERT INTO expense_reports (id, tenant_id, employee_id, employee_name, report_ref, period, total_amount, currency, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      [reportId, gate.tenantId, row.employee_id, row.employee_name ?? null, row.report_ref,
       row.period ?? null, row.total_amount, row.currency ?? 'ZAR'],
      `SELECT id FROM expense_reports WHERE tenant_id = ? AND report_ref = ?`,
      [gate.tenantId, row.report_ref],
    );
    if (!upsert.duplicate) {
      // Insert lines only on first creation to keep idempotent
      for (const line of row.lines || []) {
        await c.env.DB.prepare(
          `INSERT INTO expense_lines (id, report_id, tenant_id, category, amount, currency, merchant, expense_date, receipt_attached)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).bind(
          `expl-${crypto.randomUUID()}`, reportId, gate.tenantId,
          line.category, line.amount, line.currency ?? 'ZAR',
          line.merchant ?? null, line.expense_date ?? null,
          line.receipt_attached ? 1 : 0,
        ).run();
      }
    }
    return upsert;
  }, 'expense-report', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Inventory — cycle counts + stock transfers
// ════════════════════════════════════════════════════════════════

interface CycleCountBody {
  sku: string;
  location?: string;
  count_date: string;
  system_qty: number;
  counted_qty: number;
  currency?: string;
  counted_by?: string;
}

ingest.post('/cycle-count', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: CycleCountBody[] } | CycleCountBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: CycleCountBody[] }).rows : [body as CycleCountBody];

  const result = await processBatch(rows, async (row) => {
    // No natural-key UNIQUE on cycle_counts (multiple counts per SKU
    // per day are valid). Use deterministic id for idempotency at
    // the (sku, location, date) level.
    const id = `cycle-${gate.tenantId}::${row.sku}::${row.location ?? '_none_'}::${row.count_date}`;
    return upsertRow(c.env.DB,
      `INSERT INTO cycle_counts (id, tenant_id, sku, location, count_date, system_qty, counted_qty, currency, counted_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, gate.tenantId, row.sku, row.location ?? null, row.count_date,
       row.system_qty, row.counted_qty, row.currency ?? 'ZAR', row.counted_by ?? 'webhook'],
      `SELECT id FROM cycle_counts WHERE id = ?`, [id],
    );
  }, 'cycle-count', gate.tenantId);
  return c.json(result);
});

interface StockTransferBody {
  transfer_ref: string;
  from_location: string;
  to_location: string;
  sku: string;
  qty: number;
  currency?: string;
  requested_by?: string;
}

ingest.post('/stock-transfer', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: StockTransferBody[] } | StockTransferBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: StockTransferBody[] }).rows : [body as StockTransferBody];

  const result = await processBatch(rows, async (row) => {
    const id = `xfer-${gate.tenantId}::${row.transfer_ref}`;
    return upsertRow(c.env.DB,
      `INSERT INTO stock_transfer_requests (id, tenant_id, transfer_ref, from_location, to_location, sku, qty, currency, requested_by, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'requested')`,
      [id, gate.tenantId, row.transfer_ref, row.from_location, row.to_location,
       row.sku, row.qty, row.currency ?? 'ZAR', row.requested_by ?? 'webhook'],
      `SELECT id FROM stock_transfer_requests WHERE tenant_id = ? AND transfer_ref = ?`,
      [gate.tenantId, row.transfer_ref],
    );
  }, 'stock-transfer', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Customer service + logistics
// ════════════════════════════════════════════════════════════════

interface RmaBody {
  rma_number: string;
  customer_id?: string;
  customer_name?: string;
  order_ref?: string;
  sku?: string;
  qty?: number;
  return_reason: string;
  return_value: number;
  currency?: string;
  original_invoice_date?: string;
}

ingest.post('/rma', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: RmaBody[] } | RmaBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: RmaBody[] }).rows : [body as RmaBody];

  const result = await processBatch(rows, async (row) => {
    const id = `rma-${gate.tenantId}::${row.rma_number}`;
    return upsertRow(c.env.DB,
      `INSERT INTO rma_requests (id, tenant_id, rma_number, customer_id, customer_name, order_ref, sku, qty, return_reason, return_value, currency, original_invoice_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, gate.tenantId, row.rma_number, row.customer_id ?? null, row.customer_name ?? null,
       row.order_ref ?? null, row.sku ?? null, row.qty ?? 1, row.return_reason,
       row.return_value, row.currency ?? 'ZAR', row.original_invoice_date ?? null],
      `SELECT id FROM rma_requests WHERE tenant_id = ? AND rma_number = ?`,
      [gate.tenantId, row.rma_number],
    );
  }, 'rma', gate.tenantId);
  return c.json(result);
});

interface ShipmentBody {
  shipment_ref: string;
  so_number?: string;
  carrier?: string;
  tracking_number?: string;
  destination_country?: string;
  ready_to_ship?: boolean;
  value?: number;
  currency?: string;
}

ingest.post('/shipment', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: ShipmentBody[] } | ShipmentBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: ShipmentBody[] }).rows : [body as ShipmentBody];

  const result = await processBatch(rows, async (row) => {
    const id = `ship-${gate.tenantId}::${row.shipment_ref}`;
    return upsertRow(c.env.DB,
      `INSERT INTO shipments (id, tenant_id, shipment_ref, so_number, carrier, tracking_number, destination_country, ready_to_ship, doc_status, value, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      [id, gate.tenantId, row.shipment_ref, row.so_number ?? null, row.carrier ?? null,
       row.tracking_number ?? null, row.destination_country ?? null,
       row.ready_to_ship === false ? 0 : 1, row.value ?? 0, row.currency ?? 'ZAR'],
      `SELECT id FROM shipments WHERE tenant_id = ? AND shipment_ref = ?`,
      [gate.tenantId, row.shipment_ref],
    );
  }, 'shipment', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Contracts + intercompany balances
// ════════════════════════════════════════════════════════════════

interface ContractBody {
  contract_ref: string;
  counterparty_id?: string;
  counterparty_name: string;
  contract_type?: string;
  annual_value: number;
  currency?: string;
  start_date?: string;
  end_date: string;
  auto_renew?: boolean;
  notice_period_days?: number;
  owner_user_id?: string;
}

ingest.post('/contract', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: ContractBody[] } | ContractBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: ContractBody[] }).rows : [body as ContractBody];

  const result = await processBatch(rows, async (row) => {
    const id = `contract-${gate.tenantId}::${row.contract_ref}`;
    return upsertRow(c.env.DB,
      `INSERT INTO contracts (id, tenant_id, contract_ref, counterparty_id, counterparty_name, contract_type, annual_value, currency, start_date, end_date, auto_renew, notice_period_days, status, owner_user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
      [id, gate.tenantId, row.contract_ref, row.counterparty_id ?? null, row.counterparty_name,
       row.contract_type ?? 'service', row.annual_value, row.currency ?? 'ZAR',
       row.start_date ?? null, row.end_date, row.auto_renew ? 1 : 0,
       row.notice_period_days ?? 30, row.owner_user_id ?? null],
      `SELECT id FROM contracts WHERE tenant_id = ? AND contract_ref = ?`,
      [gate.tenantId, row.contract_ref],
    );
  }, 'contract', gate.tenantId);
  return c.json(result);
});

interface ICBalanceBody {
  entity_a: string;
  entity_b: string;
  period: string;
  ar_balance: number;
  ap_balance: number;
  currency?: string;
}

ingest.post('/intercompany-balance', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, gate.reason === 'forbidden' ? 403 : 400);
  const body = await c.req.json<{ rows: ICBalanceBody[] } | ICBalanceBody>();
  const rows = Array.isArray((body as { rows: unknown }).rows) ? (body as { rows: ICBalanceBody[] }).rows : [body as ICBalanceBody];

  const result = await processBatch(rows, async (row) => {
    const id = `ic-${gate.tenantId}::${row.entity_a}-${row.entity_b}::${row.period}`;
    return upsertRow(c.env.DB,
      `INSERT INTO intercompany_balances (id, tenant_id, entity_a, entity_b, period, ar_balance, ap_balance, currency, recon_status, source_system)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'unmatched', 'webhook')`,
      [id, gate.tenantId, row.entity_a, row.entity_b, row.period,
       row.ar_balance, row.ap_balance, row.currency ?? 'ZAR'],
      `SELECT id FROM intercompany_balances WHERE tenant_id = ? AND entity_a = ? AND entity_b = ? AND period = ?`,
      [gate.tenantId, row.entity_a, row.entity_b, row.period],
    );
  }, 'intercompany-balance', gate.tenantId);
  return c.json(result);
});

// ════════════════════════════════════════════════════════════════
// Period close — direct readiness query (used by Period Close UI)
// ════════════════════════════════════════════════════════════════

ingest.get('/_period-close-status', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);

  const period = c.req.query('period') ?? new Date().toISOString().slice(0, 7);
  const checklist = await c.env.DB.prepare(
    `SELECT period, status, steps_total, steps_completed, step_results, target_close_date, started_at, completed_at
       FROM period_close_checklists WHERE tenant_id = ? AND period = ?`,
  ).bind(tenantId, period).first<{
    period: string; status: string; steps_total: number; steps_completed: number;
    step_results: string; target_close_date: string | null;
    started_at: string; completed_at: string | null;
  }>();

  if (!checklist) {
    return c.json({ exists: false, period });
  }

  let stepResults: unknown = [];
  try { stepResults = JSON.parse(checklist.step_results); } catch { /* keep [] */ }

  return c.json({
    exists: true,
    period: checklist.period,
    status: checklist.status,
    steps_total: checklist.steps_total,
    steps_completed: checklist.steps_completed,
    target_close_date: checklist.target_close_date,
    started_at: checklist.started_at,
    completed_at: checklist.completed_at,
    step_results: stepResults,
  });
});

ingest.get('/_period-close-history', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant scope required' }, 400);

  const rows = await c.env.DB.prepare(
    `SELECT period, status, steps_completed, steps_total, started_at, completed_at
       FROM period_close_checklists WHERE tenant_id = ? ORDER BY period DESC LIMIT 24`,
  ).bind(tenantId).all<Record<string, unknown>>();
  return c.json({ history: rows.results || [] });
});

export default ingest;
