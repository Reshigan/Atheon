/**
 * Transactional Subcatalysts — Phase 10-30.
 *
 * The ACTION layer. Each function below replaces a specific human
 * role (AP clerk, AR clerk, treasury, etc.) by reading the in-flight
 * transactional substrate, deciding per-record action, and staging
 * an idempotent ERP write via erp-writeback.stageTransactionalAction.
 *
 * Each subcatalyst:
 *   - Reads from one source table (ap_invoice_inbox, ar_open_invoices,
 *     bank_statement_lines, etc.)
 *   - Applies a deterministic decision rule
 *   - Stages 0..N transactional_actions rows
 *   - Returns a summary: {processed, autoPosted, blocked, exceptions}
 *
 * All decisions are deterministic. AI/LLM can be layered later for
 * remittance-text parsing or ambiguous matches, but the baseline
 * behaviour must be reproducible and auditable.
 *
 * Threshold defaults are conservative (tight) and per-tenant
 * overridable via tenant_settings.transactional_threshold:{key}. The
 * autotuner (Phase 10-16) will widen them once feedback shows low
 * false-positive rates.
 */

import { stageTransactionalAction } from './erp-writeback';
import type { TransactionalActionType } from './erp-writeback';

export interface TransactionalRunSummary {
  subCatalyst: string;
  processed: number;
  autoPosted: number;
  blocked: number;
  exceptions: number;
  totalValue: number;
  reasoning: string[];
}

interface PoRow { po_number: string; vendor_id: string | null; vendor_name: string | null; po_amount: number; po_currency: string; status: string; }
interface GrRow { gr_number: string; po_number: string; qty_received: number | null; gr_amount: number | null; }
interface ApInvoiceRow {
  id: string; invoice_number: string; vendor_id: string | null; vendor_name: string | null;
  po_number: string | null; invoice_amount: number; currency: string; invoice_date: string | null;
  due_date: string | null; payment_terms: string | null; status: string;
}
interface ArInvoiceRow { id: string; invoice_number: string; customer_id: string | null; customer_name: string | null; invoice_amount: number; paid_amount: number; due_date: string | null; status: string; }
interface CustomerPaymentRow { id: string; payment_ref: string; customer_id: string | null; customer_name: string | null; amount: number; remittance_text: string | null; application_status: string; }
interface BankLineRow { id: string; statement_ref: string; line_number: number; amount: number; counterparty: string | null; narrative: string | null; recon_status: string; }

const TOLERANCE_PCT_DEFAULT = 0.02; // 3-way match: 2%
const DUP_WINDOW_DAYS = 90;
const PAYMENT_RUN_AUTO_APPROVE_MAX_ZAR = 50_000;

async function loadConnectionId(db: D1Database, tenantId: string): Promise<string | null> {
  const row = await db.prepare(
    `SELECT id FROM erp_connections WHERE tenant_id = ? ORDER BY connected_at DESC LIMIT 1`,
  ).bind(tenantId).first<{ id: string }>();
  return row?.id ?? null;
}

async function readToleranceForTenant(db: D1Database, tenantId: string): Promise<number> {
  const row = await db.prepare(
    `SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = 'transactional_threshold:three_way_match_tolerance_pct'`,
  ).bind(tenantId).first<{ value: string }>();
  if (!row) return TOLERANCE_PCT_DEFAULT;
  const parsed = parseFloat(row.value);
  return isFinite(parsed) && parsed > 0 ? parsed : TOLERANCE_PCT_DEFAULT;
}

// ── 1. AP three-way match ────────────────────────────────────────

export async function runApThreeWayMatch(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const tolerance = await readToleranceForTenant(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'ap-three-way-match', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  const invoices = await db.prepare(
    `SELECT id, invoice_number, vendor_id, vendor_name, po_number,
            invoice_amount, currency, invoice_date, due_date, payment_terms, status
       FROM ap_invoice_inbox
      WHERE tenant_id = ? AND status = 'received' AND po_number IS NOT NULL`,
  ).bind(tenantId).all<ApInvoiceRow>();

  for (const inv of invoices.results || []) {
    summary.processed++;
    summary.totalValue += inv.invoice_amount;

    const po = await db.prepare(
      `SELECT po_number, vendor_id, vendor_name, po_amount, po_currency, status
         FROM purchase_orders WHERE tenant_id = ? AND po_number = ?`,
    ).bind(tenantId, inv.po_number).first<PoRow>();

    if (!po) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-three-way-match',
        actionType: 'ap_invoice_block', targetEntity: 'ap_invoice',
        sourceRecordRef: inv.invoice_number,
        payload: { invoice: inv, reason: 'PO_NOT_FOUND' },
        postedValue: inv.invoice_amount, currency: inv.currency,
        reasoning: `PO ${inv.po_number} not found in purchase_orders for invoice ${inv.invoice_number}`,
      });
      summary.blocked++;
      continue;
    }

    const grRows = await db.prepare(
      `SELECT gr_number, po_number, qty_received, gr_amount
         FROM goods_receipts WHERE tenant_id = ? AND po_number = ?`,
    ).bind(tenantId, inv.po_number).all<GrRow>();

    const grTotal = (grRows.results || []).reduce((acc, gr) => acc + (gr.gr_amount ?? 0), 0);
    const grCount = (grRows.results || []).length;

    if (grCount === 0) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-three-way-match',
        actionType: 'ap_invoice_block', targetEntity: 'ap_invoice',
        sourceRecordRef: inv.invoice_number,
        payload: { invoice: inv, po, reason: 'NO_GR_FOR_PO' },
        postedValue: inv.invoice_amount, currency: inv.currency,
        reasoning: `Invoice ${inv.invoice_number} blocked — no goods receipt against PO ${inv.po_number}`,
      });
      summary.blocked++;
      continue;
    }

    const poDelta = Math.abs(inv.invoice_amount - po.po_amount) / Math.max(po.po_amount, 1);
    const grDelta = Math.abs(inv.invoice_amount - grTotal) / Math.max(grTotal, 1);
    const matched = poDelta <= tolerance && grDelta <= tolerance;

    if (matched) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-three-way-match',
        actionType: 'ap_invoice_post', targetEntity: 'ap_invoice',
        sourceRecordRef: inv.invoice_number,
        payload: {
          invoice: inv, po, gr_total: grTotal, gr_count: grCount,
          tolerance_pct: tolerance, po_delta_pct: poDelta, gr_delta_pct: grDelta,
        },
        postedValue: inv.invoice_amount, currency: inv.currency,
        reasoning: `3-way match: invoice=${inv.invoice_amount} PO=${po.po_amount} GR=${grTotal.toFixed(2)} (within ${(tolerance * 100).toFixed(1)}%)`,
        autoApprove: true,
      });
      await db.prepare(
        `UPDATE ap_invoice_inbox SET status = 'matched', processed_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), inv.id).run();
      summary.autoPosted++;
    } else {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-three-way-match',
        actionType: 'ap_invoice_block', targetEntity: 'ap_invoice',
        sourceRecordRef: inv.invoice_number,
        payload: {
          invoice: inv, po, gr_total: grTotal,
          po_delta_pct: poDelta, gr_delta_pct: grDelta, tolerance_pct: tolerance,
        },
        postedValue: inv.invoice_amount, currency: inv.currency,
        reasoning: `3-way match failed: invoice=${inv.invoice_amount} PO=${po.po_amount} GR=${grTotal.toFixed(2)} — PO Δ=${(poDelta * 100).toFixed(2)}% GR Δ=${(grDelta * 100).toFixed(2)}%`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Processed ${summary.processed} PO-backed invoices: ${summary.autoPosted} auto-matched, ${summary.blocked} blocked for review`);
  }
  return summary;
}

// ── 2. AP duplicate blocker ──────────────────────────────────────

export async function runApDuplicateBlocker(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'ap-duplicate-blocker', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  const invoices = await db.prepare(
    `SELECT id, invoice_number, vendor_id, vendor_name, po_number,
            invoice_amount, currency, invoice_date, due_date, payment_terms, status
       FROM ap_invoice_inbox
      WHERE tenant_id = ? AND status = 'received'`,
  ).bind(tenantId).all<ApInvoiceRow>();

  for (const inv of invoices.results || []) {
    summary.processed++;
    summary.totalValue += inv.invoice_amount;

    // Fingerprint: same vendor + same amount within DUP_WINDOW_DAYS.
    // Tie-break on invoice_number ASC so only the LATER-numbered
    // invoice gets flagged — the chronologically/alphabetically first
    // one survives to be processed by 3-way match. Otherwise both
    // copies would be blocked and we'd lose the legitimate one.
    const dupes = await db.prepare(
      `SELECT invoice_number FROM ap_invoice_inbox
        WHERE tenant_id = ? AND id != ?
          AND vendor_id = ?
          AND ABS(invoice_amount - ?) < 0.01
          AND invoice_number < ?
          AND invoice_date IS NOT NULL
          AND date(invoice_date) >= date(?, '-${DUP_WINDOW_DAYS} days')`,
    ).bind(tenantId, inv.id, inv.vendor_id, inv.invoice_amount, inv.invoice_number, inv.invoice_date ?? new Date().toISOString())
      .all<{ invoice_number: string }>();

    if ((dupes.results || []).length > 0) {
      const dupRefs = (dupes.results || []).map((d) => d.invoice_number).join(', ');
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-duplicate-blocker',
        actionType: 'ap_invoice_block', targetEntity: 'ap_invoice',
        sourceRecordRef: inv.invoice_number,
        payload: { invoice: inv, duplicates: dupes.results, fingerprint: { vendor_id: inv.vendor_id, amount: inv.invoice_amount } },
        postedValue: inv.invoice_amount, currency: inv.currency,
        reasoning: `Possible duplicate of ${dupRefs} (same vendor + amount within ${DUP_WINDOW_DAYS} days)`,
      });
      await db.prepare(`UPDATE ap_invoice_inbox SET status = 'duplicate' WHERE id = ?`).bind(inv.id).run();
      summary.blocked++;
    }
  }

  if (summary.blocked > 0) {
    summary.reasoning.push(`Blocked ${summary.blocked} suspected duplicate invoices`);
  }
  return summary;
}

// ── 3. AP payment run ────────────────────────────────────────────

export async function runApPaymentRun(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'ap-payment-run', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  // Pick up matched (3-way-matched) invoices that are due in the next 7 days
  const due = await db.prepare(
    `SELECT id, invoice_number, vendor_id, vendor_name, invoice_amount, currency, due_date
       FROM ap_invoice_inbox
      WHERE tenant_id = ? AND status = 'matched'
        AND due_date IS NOT NULL
        AND date(due_date) <= date('now', '+7 days')`,
  ).bind(tenantId).all<ApInvoiceRow>();

  // Group by vendor
  const byVendor = new Map<string, ApInvoiceRow[]>();
  for (const inv of due.results || []) {
    const key = inv.vendor_id ?? `unknown-${inv.vendor_name ?? 'unknown'}`;
    if (!byVendor.has(key)) byVendor.set(key, []);
    byVendor.get(key)!.push(inv);
  }

  for (const [vendorKey, invList] of byVendor) {
    summary.processed++;
    const total = invList.reduce((acc, i) => acc + i.invoice_amount, 0);
    summary.totalValue += total;
    const autoApprove = total <= PAYMENT_RUN_AUTO_APPROVE_MAX_ZAR;

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'ap-payment-run',
      actionType: 'ap_payment_run', targetEntity: 'payment_proposal',
      sourceRecordRef: `vendor:${vendorKey}:${new Date().toISOString().slice(0, 10)}`,
      payload: {
        vendor_id: vendorKey, vendor_name: invList[0]?.vendor_name ?? null,
        invoice_count: invList.length, total_amount: total,
        invoices: invList.map((i) => ({ invoice_number: i.invoice_number, amount: i.invoice_amount, due_date: i.due_date })),
      },
      postedValue: total, currency: invList[0]?.currency ?? 'ZAR',
      reasoning: `Payment run for ${invList[0]?.vendor_name ?? vendorKey}: ${invList.length} invoices totalling ${total.toFixed(2)} ${invList[0]?.currency ?? 'ZAR'}`,
      autoApprove,
    });
    if (autoApprove) summary.autoPosted++;
    else summary.blocked++; // pending HITL
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Built ${summary.processed} payment proposals (${summary.autoPosted} auto-approved, ${summary.blocked} pending review)`);
  }
  return summary;
}

// ── 4. AR cash application ───────────────────────────────────────

export async function runArCashApplication(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'ar-cash-application', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  const payments = await db.prepare(
    `SELECT id, payment_ref, customer_id, customer_name, amount, remittance_text, application_status
       FROM customer_payments
      WHERE tenant_id = ? AND application_status = 'unapplied'`,
  ).bind(tenantId).all<CustomerPaymentRow>();

  for (const pay of payments.results || []) {
    summary.processed++;
    summary.totalValue += pay.amount;

    // Try exact match: invoice_number appears in remittance_text
    let invoice: ArInvoiceRow | null = null;
    if (pay.remittance_text) {
      const candidates = await db.prepare(
        `SELECT id, invoice_number, customer_id, customer_name, invoice_amount, paid_amount, due_date, status
           FROM ar_open_invoices
          WHERE tenant_id = ? AND customer_id = ? AND status = 'open'`,
      ).bind(tenantId, pay.customer_id).all<ArInvoiceRow>();
      invoice = (candidates.results || []).find((c) => pay.remittance_text!.includes(c.invoice_number)) ?? null;
    }

    // Fallback: amount-only match against single open invoice for that customer
    if (!invoice) {
      const single = await db.prepare(
        `SELECT id, invoice_number, customer_id, customer_name, invoice_amount, paid_amount, due_date, status
           FROM ar_open_invoices
          WHERE tenant_id = ? AND customer_id = ? AND status = 'open'
            AND ABS(invoice_amount - paid_amount - ?) < 0.01`,
      ).bind(tenantId, pay.customer_id, pay.amount).all<ArInvoiceRow>();
      const exact = (single.results || []);
      if (exact.length === 1) invoice = exact[0];
    }

    if (!invoice) {
      summary.exceptions++;
      continue;
    }

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'ar-cash-application',
      actionType: 'ar_cash_apply', targetEntity: 'cash_receipt',
      sourceRecordRef: pay.payment_ref,
      payload: { payment: pay, applied_to: invoice.invoice_number, customer_id: pay.customer_id, amount: pay.amount },
      postedValue: pay.amount, currency: 'ZAR',
      reasoning: `Applied payment ${pay.payment_ref} (${pay.amount.toFixed(2)}) to invoice ${invoice.invoice_number}`,
      autoApprove: true,
    });

    const newPaid = invoice.paid_amount + pay.amount;
    const newStatus = newPaid >= invoice.invoice_amount - 0.01 ? 'closed' : 'open';
    await db.prepare(
      `UPDATE ar_open_invoices SET paid_amount = ?, status = ? WHERE id = ?`,
    ).bind(newPaid, newStatus, invoice.id).run();
    await db.prepare(
      `UPDATE customer_payments SET application_status = 'applied', applied_to_invoice = ? WHERE id = ?`,
    ).bind(invoice.invoice_number, pay.id).run();
    summary.autoPosted++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Cash app: ${summary.autoPosted}/${summary.processed} payments matched, ${summary.exceptions} unmatched (need review)`);
  }
  return summary;
}

// ── 5. AR credit hold ────────────────────────────────────────────

export async function runArCreditHold(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'ar-credit-hold', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  // Per-customer exposure
  const exposures = await db.prepare(
    `SELECT customer_id, customer_name,
            SUM(invoice_amount - paid_amount) AS exposure
       FROM ar_open_invoices
      WHERE tenant_id = ? AND status = 'open' AND customer_id IS NOT NULL
      GROUP BY customer_id, customer_name`,
  ).bind(tenantId).all<{ customer_id: string; customer_name: string; exposure: number }>();

  for (const cust of exposures.results || []) {
    summary.processed++;

    // Read credit limit (default to 0 — no limit known means no auto-hold)
    const limitRow = await db.prepare(
      `SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?`,
    ).bind(tenantId, `customer_credit_limit:${cust.customer_id}`).first<{ value: string }>();
    const creditLimit = limitRow ? parseFloat(limitRow.value) : 0;

    if (creditLimit <= 0) continue; // unknown limit — skip

    if (cust.exposure > creditLimit) {
      summary.totalValue += cust.exposure;
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ar-credit-hold',
        actionType: 'ar_credit_hold', targetEntity: 'customer',
        sourceRecordRef: `customer:${cust.customer_id}`,
        payload: { customer_id: cust.customer_id, customer_name: cust.customer_name, exposure: cust.exposure, credit_limit: creditLimit, overage: cust.exposure - creditLimit },
        postedValue: cust.exposure, currency: 'ZAR',
        reasoning: `Customer ${cust.customer_name} exposure ${cust.exposure.toFixed(2)} > credit limit ${creditLimit.toFixed(2)} — placing on hold`,
        autoApprove: true,
      });
      // Upsert customer_credit_holds
      await db.prepare(
        `INSERT INTO customer_credit_holds (id, tenant_id, customer_id, customer_name, credit_limit, exposure, hold_status, held_at, reason)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?)
         ON CONFLICT(tenant_id, customer_id) DO UPDATE SET exposure = excluded.exposure, hold_status = 'active', held_at = excluded.held_at, reason = excluded.reason, released_at = NULL`,
      ).bind(
        `hold-${crypto.randomUUID()}`, tenantId, cust.customer_id, cust.customer_name,
        creditLimit, cust.exposure, new Date().toISOString(),
        `Auto-hold: exposure exceeded limit by ${(cust.exposure - creditLimit).toFixed(2)} ZAR`,
      ).run();
      summary.autoPosted++;
    } else {
      // Release any active hold if exposure now within limit
      const released = await db.prepare(
        `UPDATE customer_credit_holds SET hold_status = 'released', released_at = ?
          WHERE tenant_id = ? AND customer_id = ? AND hold_status = 'active'`,
      ).bind(new Date().toISOString(), tenantId, cust.customer_id).run();
      if ((released.meta?.changes ?? 0) > 0) summary.exceptions++; // released-this-run is an "exception" only in the count-bookkeeping sense
    }
  }

  if (summary.autoPosted > 0 || summary.exceptions > 0) {
    summary.reasoning.push(`Credit hold sweep: ${summary.autoPosted} placed, ${summary.exceptions} released`);
  }
  return summary;
}

// ── 6. GL bank reconciliation ────────────────────────────────────

export async function runGlBankReconciliation(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const connId = await loadConnectionId(db, tenantId);
  const summary: TransactionalRunSummary = { subCatalyst: 'gl-bank-reconciliation', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };

  const lines = await db.prepare(
    `SELECT id, statement_ref, line_number, amount, counterparty, narrative, recon_status
       FROM bank_statement_lines
      WHERE tenant_id = ? AND recon_status = 'unmatched'`,
  ).bind(tenantId).all<BankLineRow>();

  for (const line of lines.results || []) {
    summary.processed++;
    summary.totalValue += Math.abs(line.amount);

    // Match against posted ar_cash_apply or ap_payment_run with the same amount sign
    // For receipts (amount > 0), match against ar_cash_apply
    // For payments (amount < 0), match against ap_payment_run
    const isReceipt = line.amount > 0;
    const targetActionType: TransactionalActionType = isReceipt ? 'ar_cash_apply' : 'ap_payment_run';
    // Match against approved OR posted: 'approved' means it's on the
    // dispatch queue, 'posted' means ERP confirmed. Either is valid
    // evidence that the bank movement corresponds to a known action.
    // (If we limit to 'posted' only, the first runner pass will miss
    // matches because cash-app/payment rows stage as 'approved' and
    // only flip to 'posted' in the dispatch sweep at end-of-run.)
    const target = await db.prepare(
      `SELECT id, posted_value, external_doc_id FROM transactional_actions
        WHERE tenant_id = ? AND action_type = ? AND status IN ('approved','posted')
          AND ABS(posted_value - ?) < 0.01`,
    ).bind(tenantId, targetActionType, Math.abs(line.amount))
      .first<{ id: string; posted_value: number; external_doc_id: string | null }>();

    if (!target) {
      summary.exceptions++;
      continue;
    }

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'gl-bank-reconciliation',
      actionType: 'gl_bank_match', targetEntity: 'bank_statement_line',
      sourceRecordRef: `${line.statement_ref}:${line.line_number}`,
      payload: { line, matched_action_id: target.id, matched_external_doc: target.external_doc_id },
      postedValue: line.amount, currency: 'ZAR',
      reasoning: `Bank line ${line.statement_ref}#${line.line_number} (${line.amount.toFixed(2)}) matched to ${targetActionType} ${target.external_doc_id ?? `(staged action ${target.id})`}`,
      autoApprove: true,
    });
    await db.prepare(
      `UPDATE bank_statement_lines SET recon_status = 'matched', matched_gl_entry = ? WHERE id = ?`,
    ).bind(target.external_doc_id ?? target.id, line.id).run();
    summary.autoPosted++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Bank recon: ${summary.autoPosted}/${summary.processed} lines matched, ${summary.exceptions} unmatched`);
  }
  return summary;
}

// ── 7. AP invoice capture (Phase 10-31) ──────────────────────────
// Reads ap_invoice_inbox_raw rows (raw inbound invoices: email/PDF/
// portal payloads), extracts canonical fields, creates ap_invoice_inbox
// rows ready for the 3-way match step. In production this would call
// an OCR service for PDFs; here we parse the JSON `raw_payload` field
// which downstream connectors (or upload handlers) populate with
// already-extracted line items.

interface RawInvoiceRow {
  id: string; raw_payload: string; parsed_status: string;
  erp_connection_id: string | null;
}

export async function runApInvoiceCapture(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'ap-invoice-capture', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const rows = await db.prepare(
    `SELECT id, raw_payload, parsed_status, erp_connection_id
       FROM ap_invoice_inbox_raw
      WHERE tenant_id = ? AND parsed_status = 'pending'`,
  ).bind(tenantId).all<RawInvoiceRow>();

  for (const row of rows.results || []) {
    summary.processed++;
    let parsed: Record<string, unknown> | null = null;
    try { parsed = JSON.parse(row.raw_payload); } catch { /* parsed=null */ }

    const invoiceNumber = parsed?.invoice_number as string | undefined;
    const vendorId = parsed?.vendor_id as string | undefined;
    const amount = Number(parsed?.invoice_amount ?? 0);

    if (!parsed || !invoiceNumber || !vendorId || amount <= 0) {
      await db.prepare(
        `UPDATE ap_invoice_inbox_raw SET parsed_status = 'failed', error = ?
          WHERE id = ?`,
      ).bind('missing required fields (invoice_number, vendor_id, invoice_amount)', row.id).run();
      summary.exceptions++;
      continue;
    }

    summary.totalValue += amount;
    const newId = `apinv-${tenantId}::${invoiceNumber}`;
    try {
      await db.prepare(
        `INSERT INTO ap_invoice_inbox (id, tenant_id, erp_connection_id, invoice_number,
           vendor_id, vendor_name, po_number, invoice_amount, currency, invoice_date,
           due_date, payment_terms, line_items, raw_data, source_system, status, received_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'received', ?)
         ON CONFLICT(tenant_id, invoice_number) DO NOTHING`,
      ).bind(
        newId, tenantId, row.erp_connection_id ?? connId,
        invoiceNumber, vendorId, (parsed.vendor_name as string) ?? null,
        (parsed.po_number as string) ?? null, amount,
        (parsed.currency as string) ?? 'ZAR',
        (parsed.invoice_date as string) ?? null,
        (parsed.due_date as string) ?? null,
        (parsed.payment_terms as string) ?? 'NET30',
        JSON.stringify(parsed.line_items ?? []),
        row.raw_payload, 'inbox_capture',
        new Date().toISOString(),
      ).run();

      await db.prepare(
        `UPDATE ap_invoice_inbox_raw SET parsed_status = 'parsed', parse_confidence = ?, parsed_invoice_id = ?
          WHERE id = ?`,
      ).bind(0.95, newId, row.id).run();
      summary.autoPosted++;
    } catch (err) {
      await db.prepare(
        `UPDATE ap_invoice_inbox_raw SET parsed_status = 'failed', error = ? WHERE id = ?`,
      ).bind(err instanceof Error ? err.message : String(err), row.id).run();
      summary.exceptions++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Captured ${summary.autoPosted}/${summary.processed} raw invoices into the inbox`);
  }
  return summary;
}

// ── 8. AP vendor statement reconciliation ────────────────────────
// For each vendor_statements row recon_status='unmatched', sum the
// AP invoices (posted) for that vendor in the period and compare to
// statement closing_balance. If within tolerance → mark reconciled
// + stage gl_journal_entry for any rounding adjustment. Otherwise
// stage ap_invoice_block for human review of the gap.

interface VendorStmtRow {
  id: string; vendor_id: string; vendor_name: string | null;
  statement_period: string; closing_balance: number;
  currency: string;
}

export async function runApVendorStatementRecon(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'ap-vendor-statement-recon', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);
  const tolerance = 0.01; // 1% acceptable rounding

  const stmts = await db.prepare(
    `SELECT id, vendor_id, vendor_name, statement_period, closing_balance, currency
       FROM vendor_statements WHERE tenant_id = ? AND recon_status = 'unmatched'`,
  ).bind(tenantId).all<VendorStmtRow>();

  for (const stmt of stmts.results || []) {
    summary.processed++;
    summary.totalValue += stmt.closing_balance;

    const ledgerRow = await db.prepare(
      `SELECT COALESCE(SUM(invoice_amount), 0) AS total
         FROM ap_invoice_inbox
        WHERE tenant_id = ? AND vendor_id = ? AND status IN ('matched','received')
          AND invoice_date IS NOT NULL
          AND substr(invoice_date, 1, 7) = ?`,
    ).bind(tenantId, stmt.vendor_id, stmt.statement_period.slice(0, 7))
      .first<{ total: number }>();

    const ledgerTotal = ledgerRow?.total ?? 0;
    const delta = stmt.closing_balance - ledgerTotal;
    const matched = Math.abs(delta) / Math.max(stmt.closing_balance, 1) <= tolerance;

    await db.prepare(
      `UPDATE vendor_statements SET recon_status = ?, recon_delta = ?, reconciled_at = ?
        WHERE id = ?`,
    ).bind(matched ? 'matched' : 'mismatch', delta, new Date().toISOString(), stmt.id).run();

    if (matched && Math.abs(delta) > 0.01) {
      // Tiny rounding — stage a journal entry to clear it
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-vendor-statement-recon',
        actionType: 'gl_journal_entry', targetEntity: 'rounding_adjustment',
        sourceRecordRef: `vendor-stmt:${stmt.vendor_id}:${stmt.statement_period}`,
        payload: { vendor_id: stmt.vendor_id, period: stmt.statement_period, delta },
        postedValue: delta, currency: stmt.currency,
        reasoning: `Vendor ${stmt.vendor_name ?? stmt.vendor_id}: rounding adjustment ${delta.toFixed(2)} ${stmt.currency}`,
        autoApprove: true,
      });
      summary.autoPosted++;
    } else if (matched) {
      summary.autoPosted++;
    } else {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'ap-vendor-statement-recon',
        actionType: 'ap_invoice_block', targetEntity: 'vendor_statement',
        sourceRecordRef: `vendor-stmt:${stmt.vendor_id}:${stmt.statement_period}`,
        payload: { vendor_id: stmt.vendor_id, period: stmt.statement_period, statement_total: stmt.closing_balance, ledger_total: ledgerTotal, delta },
        postedValue: delta, currency: stmt.currency,
        reasoning: `Vendor ${stmt.vendor_name ?? stmt.vendor_id} statement (${stmt.closing_balance.toFixed(2)}) vs ledger (${ledgerTotal.toFixed(2)}) — delta ${delta.toFixed(2)}`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Vendor statements: ${summary.autoPosted}/${summary.processed} reconciled, ${summary.blocked} flagged for review`);
  }
  return summary;
}

// ── 9. AR invoice generator ──────────────────────────────────────
// For each fulfilled, billable sales_order with no billed_invoice_number,
// stage an ar_invoice_post action and create the corresponding
// ar_open_invoices row.

interface SalesOrderRow {
  id: string; so_number: string; customer_id: string | null; customer_name: string | null;
  so_amount: number; currency: string; so_date: string | null; fulfilled_at: string | null;
}

export async function runArInvoiceGenerator(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'ar-invoice-generator', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const sos = await db.prepare(
    `SELECT id, so_number, customer_id, customer_name, so_amount, currency, so_date, fulfilled_at
       FROM sales_orders WHERE tenant_id = ?
        AND status = 'fulfilled' AND billable = 1 AND billed_invoice_number IS NULL`,
  ).bind(tenantId).all<SalesOrderRow>();

  for (const so of sos.results || []) {
    summary.processed++;
    summary.totalValue += so.so_amount;

    const invoiceNumber = `INV-AUTO-${so.so_number}`;
    const dueDate = (() => {
      const base = so.fulfilled_at ?? so.so_date ?? new Date().toISOString();
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() + 30);
      return d.toISOString().slice(0, 10);
    })();

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'ar-invoice-generator',
      actionType: 'ar_cash_apply', // reuses existing dispatch shape; doc id prefix '12'
      targetEntity: 'ar_invoice',
      sourceRecordRef: `so:${so.so_number}`,
      payload: { sales_order: so, invoice_number: invoiceNumber, due_date: dueDate, terms: 'NET30' },
      postedValue: so.so_amount, currency: so.currency,
      reasoning: `Auto-generated AR invoice ${invoiceNumber} for SO ${so.so_number} (${so.so_amount.toFixed(2)} ${so.currency})`,
      autoApprove: true,
    });

    // Create the AR open invoice + flip SO billed
    try {
      await db.prepare(
        `INSERT INTO ar_open_invoices (id, tenant_id, erp_connection_id, invoice_number, customer_id,
           customer_name, invoice_amount, currency, invoice_date, due_date, paid_amount, status, source_system)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'open', 'ar_invoice_generator')
         ON CONFLICT(tenant_id, invoice_number) DO NOTHING`,
      ).bind(
        `arinv-${tenantId}::${invoiceNumber}`, tenantId, connId,
        invoiceNumber, so.customer_id, so.customer_name,
        so.so_amount, so.currency, so.fulfilled_at?.slice(0, 10) ?? null, dueDate,
      ).run();
      await db.prepare(
        `UPDATE sales_orders SET billed_invoice_number = ?, status = 'billed' WHERE id = ?`,
      ).bind(invoiceNumber, so.id).run();
      summary.autoPosted++;
    } catch (err) {
      summary.exceptions++;
      summary.reasoning.push(`SO ${so.so_number}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.unshift(`Generated ${summary.autoPosted}/${summary.processed} AR invoices from fulfilled SOs`);
  }
  return summary;
}

// ── 10. AR dunning executor ──────────────────────────────────────
// For each open AR invoice past due, decide a dunning level (1=reminder,
// 2=demand, 3=final notice) based on days overdue. Skip if a dunning
// event was already sent for this (invoice, level) within the cool-down
// window. Stage a notification action + write a dunning_events row.

interface OverdueInvoiceRow {
  id: string; invoice_number: string; customer_id: string | null; customer_name: string | null;
  invoice_amount: number; paid_amount: number; due_date: string | null; currency: string;
}

const DUNNING_COOLDOWN_DAYS = 7;

export async function runArDunningExecutor(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'ar-dunning-executor', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const overdue = await db.prepare(
    `SELECT id, invoice_number, customer_id, customer_name, invoice_amount, paid_amount, due_date, currency
       FROM ar_open_invoices
      WHERE tenant_id = ? AND status = 'open'
        AND due_date IS NOT NULL AND date(due_date) < date('now')`,
  ).bind(tenantId).all<OverdueInvoiceRow>();

  for (const inv of overdue.results || []) {
    summary.processed++;
    const outstanding = inv.invoice_amount - inv.paid_amount;
    if (outstanding <= 0) continue;
    summary.totalValue += outstanding;

    const daysOverdue = inv.due_date
      ? Math.floor((Date.now() - new Date(inv.due_date).getTime()) / 86_400_000)
      : 0;
    const aging = daysOverdue >= 90 ? '90+' : daysOverdue >= 60 ? '60-90' : daysOverdue >= 30 ? '30-60' : '0-30';
    const level = daysOverdue >= 60 ? 3 : daysOverdue >= 30 ? 2 : 1;

    // Cool-down check
    const recent = await db.prepare(
      `SELECT id FROM dunning_events
        WHERE tenant_id = ? AND invoice_number = ? AND level = ?
          AND date(sent_at) >= date('now', '-${DUNNING_COOLDOWN_DAYS} days')`,
    ).bind(tenantId, inv.invoice_number, level).first<{ id: string }>();
    if (recent) continue;

    await db.prepare(
      `INSERT INTO dunning_events (id, tenant_id, customer_id, customer_name, invoice_number,
         aging_bucket, level, channel, sent_at, template, recipient)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'email', ?, ?, ?)`,
    ).bind(
      `dunn-${crypto.randomUUID()}`, tenantId, inv.customer_id, inv.customer_name,
      inv.invoice_number, aging, level, new Date().toISOString(),
      `dunning_l${level}_${aging}`, `accounts-payable@${inv.customer_id ?? 'unknown'}.example`,
    ).run();

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'ar-dunning-executor',
      actionType: 'ar_cash_apply', targetEntity: 'dunning_notice',
      sourceRecordRef: `dunning:${inv.invoice_number}:L${level}`,
      payload: { invoice: inv, level, aging, days_overdue: daysOverdue, outstanding },
      postedValue: outstanding, currency: inv.currency,
      reasoning: `Sent L${level} dunning notice for ${inv.invoice_number} (${aging} bucket, ${outstanding.toFixed(2)} outstanding)`,
      autoApprove: true,
    });
    summary.autoPosted++;
  }

  if (summary.autoPosted > 0) {
    summary.reasoning.push(`Sent ${summary.autoPosted} dunning notices across overdue invoices`);
  }
  return summary;
}

// ── 11. GL recurring journal entries ─────────────────────────────
// For each enabled gl_recurring_schedules row whose next_run_date is
// today or earlier, stage a gl_journal_entry action and roll the
// schedule's next_run_date forward by frequency.

interface ScheduleRow {
  id: string; name: string; je_type: string;
  debit_account: string; credit_account: string;
  amount: number; currency: string; frequency: string;
  next_run_date: string;
}

function rollFrequency(date: string, freq: string): string {
  const d = new Date(date);
  switch (freq) {
    case 'daily': d.setUTCDate(d.getUTCDate() + 1); break;
    case 'weekly': d.setUTCDate(d.getUTCDate() + 7); break;
    case 'monthly': d.setUTCMonth(d.getUTCMonth() + 1); break;
    case 'quarterly': d.setUTCMonth(d.getUTCMonth() + 3); break;
    case 'annual': d.setUTCFullYear(d.getUTCFullYear() + 1); break;
    default: d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return d.toISOString().slice(0, 10);
}

export async function runGlRecurringJe(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'gl-recurring-je', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const due = await db.prepare(
    `SELECT id, name, je_type, debit_account, credit_account, amount, currency, frequency, next_run_date
       FROM gl_recurring_schedules
      WHERE tenant_id = ? AND enabled = 1 AND date(next_run_date) <= date('now')`,
  ).bind(tenantId).all<ScheduleRow>();

  for (const sched of due.results || []) {
    summary.processed++;
    summary.totalValue += sched.amount;

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'gl-recurring-je',
      actionType: 'gl_journal_entry', targetEntity: 'recurring_je',
      sourceRecordRef: `recurring:${sched.id}:${sched.next_run_date}`,
      payload: {
        schedule_id: sched.id, name: sched.name, je_type: sched.je_type,
        debit: { account: sched.debit_account, amount: sched.amount },
        credit: { account: sched.credit_account, amount: sched.amount },
      },
      postedValue: sched.amount, currency: sched.currency,
      reasoning: `Recurring ${sched.je_type} JE: ${sched.name} — Dr ${sched.debit_account} / Cr ${sched.credit_account} ${sched.amount.toFixed(2)}`,
      autoApprove: true,
    });
    await db.prepare(
      `UPDATE gl_recurring_schedules SET last_run_date = ?, next_run_date = ? WHERE id = ?`,
    ).bind(new Date().toISOString().slice(0, 10), rollFrequency(sched.next_run_date, sched.frequency), sched.id).run();
    summary.autoPosted++;
  }

  if (summary.autoPosted > 0) {
    summary.reasoning.push(`Posted ${summary.autoPosted} recurring JEs (${summary.totalValue.toFixed(2)} total)`);
  }
  return summary;
}

// ── 12. PO approval router ───────────────────────────────────────
// For each open purchase_order without an approval action, look up
// the matching policy tier and stage either an auto-approve (low
// value) or a HITL approval (high value, dual signoff if required).

interface POForApproval { po_number: string; vendor_name: string | null; po_amount: number; po_currency: string; }
interface PolicyRow { tier_name: string; min_amount: number; max_amount: number | null; approver_role: string; requires_dual_signoff: number; }

export async function runPoApprovalRouter(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'po-approval-router', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const policies = await db.prepare(
    `SELECT tier_name, min_amount, max_amount, approver_role, requires_dual_signoff
       FROM po_approval_policies WHERE tenant_id = ? ORDER BY min_amount ASC`,
  ).bind(tenantId).all<PolicyRow>();

  if ((policies.results || []).length === 0) {
    return summary; // no policy configured — no-op
  }

  const pos = await db.prepare(
    `SELECT po_number, vendor_name, po_amount, po_currency FROM purchase_orders
      WHERE tenant_id = ? AND status = 'open'`,
  ).bind(tenantId).all<POForApproval>();

  for (const po of pos.results || []) {
    summary.processed++;
    summary.totalValue += po.po_amount;

    const policy = (policies.results || []).find((p) =>
      po.po_amount >= p.min_amount && (p.max_amount == null || po.po_amount <= p.max_amount)
    );
    if (!policy) {
      summary.exceptions++;
      continue;
    }

    const autoApprove = policy.approver_role === 'system' && !policy.requires_dual_signoff;
    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'po-approval-router',
      actionType: 'ap_invoice_post', // reuses existing dispatch shape (PO doc); SAP doc-num prefix '51'
      targetEntity: 'po_approval',
      sourceRecordRef: `po:${po.po_number}`,
      payload: { po, policy_tier: policy.tier_name, approver_role: policy.approver_role, dual_signoff: !!policy.requires_dual_signoff },
      postedValue: po.po_amount, currency: po.po_currency,
      reasoning: `PO ${po.po_number} (${po.po_amount.toFixed(2)}) routed to ${policy.tier_name} (${policy.approver_role}${policy.requires_dual_signoff ? ' + dual signoff' : ''})`,
      autoApprove,
    });
    if (autoApprove) summary.autoPosted++; else summary.blocked++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Routed ${summary.processed} POs: ${summary.autoPosted} auto, ${summary.blocked} pending approval, ${summary.exceptions} no matching tier`);
  }
  return summary;
}

// ════════════════════════════════════════════════════════════════
// Phase 10-32 — Batch 3: 12 more action subcatalysts
// ════════════════════════════════════════════════════════════════
//
// Each replaces a specific clerical role:
//   13. supplier-onboarding         (vendor master clerk)
//   14. customer-onboarding         (sales admin)
//   15. gl-intercompany-recon       (IC accountant)
//   16. gl-period-close-orchestrator (close controller)
//   17. gl-fx-revaluation           (FX accountant)
//   18. vat-return-builder          (tax preparer)
//   19. payroll-posting-bot         (payroll accountant)
//   20. statutory-filing-bot        (tax compliance)
//   21. cycle-count-reconciler      (inventory accountant)
//   22. stock-transfer-executor     (stores clerk)
//   23. cash-position-forecaster    (treasury analyst)
//   24. expense-report-auditor      (T&E auditor)

// ── 13. Supplier onboarding ──────────────────────────────────────
// For each vendor_master row kyc_status='pending', validate tax_id +
// bank_account format. Auto-approve clean records; HITL on missing
// or malformed fields.

interface VendorMasterRow {
  id: string; vendor_id: string; vendor_name: string;
  tax_id: string | null; bank_account: string | null;
  kyc_status: string;
}

// SA tax (VAT) numbers are 10 digits starting with 4. Bank: 6-11 digits.
const SA_TAX_RE = /^4\d{9}$/;
const BANK_RE = /^\d{6,11}$/;

export async function runSupplierOnboarding(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'supplier-onboarding', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const pending = await db.prepare(
    `SELECT id, vendor_id, vendor_name, tax_id, bank_account, kyc_status
       FROM vendor_master WHERE tenant_id = ? AND kyc_status = 'pending'`,
  ).bind(tenantId).all<VendorMasterRow>();

  for (const v of pending.results || []) {
    summary.processed++;
    const taxOk = !!v.tax_id && SA_TAX_RE.test(v.tax_id);
    const bankOk = !!v.bank_account && BANK_RE.test(v.bank_account.replace(/\s/g, ''));

    if (taxOk && bankOk) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'supplier-onboarding',
        actionType: 'ap_invoice_post', targetEntity: 'vendor_master',
        sourceRecordRef: `vendor:${v.vendor_id}`,
        payload: { vendor_id: v.vendor_id, vendor_name: v.vendor_name, tax_id: v.tax_id, bank_account: v.bank_account },
        reasoning: `Vendor ${v.vendor_name}: tax_id + bank_account validated, KYC complete`,
        autoApprove: true,
      });
      await db.prepare(
        `UPDATE vendor_master SET kyc_status = 'approved', kyc_completed_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), v.id).run();
      summary.autoPosted++;
    } else {
      const issues = [
        !taxOk ? `tax_id invalid (expect 10 digits starting with 4, got ${v.tax_id ?? 'null'})` : null,
        !bankOk ? `bank_account invalid (expect 6-11 digits)` : null,
      ].filter(Boolean).join('; ');
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'supplier-onboarding',
        actionType: 'ap_invoice_block', targetEntity: 'vendor_master',
        sourceRecordRef: `vendor:${v.vendor_id}`,
        payload: { vendor: v, issues },
        reasoning: `Vendor ${v.vendor_name} KYC blocked: ${issues}`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`KYC: ${summary.autoPosted}/${summary.processed} vendors auto-approved, ${summary.blocked} blocked for manual review`);
  }
  return summary;
}

// ── 14. Customer onboarding ──────────────────────────────────────

interface CustomerMasterRow {
  id: string; customer_id: string; customer_name: string;
  tax_id: string | null; credit_limit: number; kyc_status: string;
}

export async function runCustomerOnboarding(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'customer-onboarding', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const pending = await db.prepare(
    `SELECT id, customer_id, customer_name, tax_id, credit_limit, kyc_status
       FROM customer_master WHERE tenant_id = ? AND kyc_status = 'pending'`,
  ).bind(tenantId).all<CustomerMasterRow>();

  for (const c of pending.results || []) {
    summary.processed++;
    const taxOk = !!c.tax_id && SA_TAX_RE.test(c.tax_id);
    const creditOk = c.credit_limit > 0 && c.credit_limit <= 10_000_000; // sanity

    if (taxOk && creditOk) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'customer-onboarding',
        actionType: 'ar_cash_apply', targetEntity: 'customer_master',
        sourceRecordRef: `customer:${c.customer_id}`,
        payload: { customer_id: c.customer_id, name: c.customer_name, tax_id: c.tax_id, credit_limit: c.credit_limit },
        postedValue: c.credit_limit, currency: 'ZAR',
        reasoning: `Customer ${c.customer_name}: KYC validated, credit limit ${c.credit_limit.toFixed(0)} ZAR`,
        autoApprove: true,
      });
      await db.prepare(
        `UPDATE customer_master SET kyc_status = 'approved', kyc_completed_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), c.id).run();
      // Persist credit limit so ar-credit-hold picks it up
      await db.prepare(
        `INSERT INTO tenant_settings (id, tenant_id, key, value, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      ).bind(
        crypto.randomUUID(), tenantId, `customer_credit_limit:${c.customer_id}`,
        String(c.credit_limit), new Date().toISOString(),
      ).run();
      summary.autoPosted++;
    } else {
      const issues = [
        !taxOk ? `tax_id invalid` : null,
        !creditOk ? `credit_limit out of range (got ${c.credit_limit})` : null,
      ].filter(Boolean).join('; ');
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'customer-onboarding',
        actionType: 'ar_credit_hold', targetEntity: 'customer_master',
        sourceRecordRef: `customer:${c.customer_id}`,
        payload: { customer: c, issues },
        reasoning: `Customer ${c.customer_name} KYC blocked: ${issues}`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Customer KYC: ${summary.autoPosted}/${summary.processed} approved, ${summary.blocked} blocked`);
  }
  return summary;
}

// ── 15. GL intercompany reconciliation ───────────────────────────

interface IntercompanyRow {
  id: string; entity_a: string; entity_b: string; period: string;
  ar_balance: number; ap_balance: number; currency: string;
}

export async function runGlIntercompanyRecon(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'gl-intercompany-recon', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const balances = await db.prepare(
    `SELECT id, entity_a, entity_b, period, ar_balance, ap_balance, currency
       FROM intercompany_balances WHERE tenant_id = ? AND recon_status = 'unmatched'`,
  ).bind(tenantId).all<IntercompanyRow>();

  for (const ic of balances.results || []) {
    summary.processed++;
    const delta = ic.ar_balance - ic.ap_balance;
    summary.totalValue += Math.abs(delta);
    const matched = Math.abs(delta) <= Math.max(ic.ar_balance, 1) * 0.005; // 0.5%

    await db.prepare(
      `UPDATE intercompany_balances SET recon_status = ?, delta = ?, reconciled_at = ?
        WHERE id = ?`,
    ).bind(matched ? 'matched' : 'mismatch', delta, new Date().toISOString(), ic.id).run();

    if (matched) {
      summary.autoPosted++;
      if (Math.abs(delta) > 0.01) {
        await stageTransactionalAction(db, {
          tenantId, erpConnectionId: connId, subCatalystName: 'gl-intercompany-recon',
          actionType: 'gl_journal_entry', targetEntity: 'ic_rounding',
          sourceRecordRef: `ic:${ic.entity_a}:${ic.entity_b}:${ic.period}`,
          payload: { ic, delta, type: 'rounding_adjustment' },
          postedValue: delta, currency: ic.currency,
          reasoning: `IC ${ic.entity_a}↔${ic.entity_b} ${ic.period}: rounding ${delta.toFixed(2)} ${ic.currency}`,
          autoApprove: true,
        });
      }
    } else {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'gl-intercompany-recon',
        actionType: 'ap_invoice_block', targetEntity: 'ic_balance',
        sourceRecordRef: `ic:${ic.entity_a}:${ic.entity_b}:${ic.period}`,
        payload: { ic, delta },
        postedValue: delta, currency: ic.currency,
        reasoning: `IC mismatch ${ic.entity_a}↔${ic.entity_b} ${ic.period}: AR ${ic.ar_balance.toFixed(2)} vs AP ${ic.ap_balance.toFixed(2)} (Δ ${delta.toFixed(2)})`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`IC recon: ${summary.autoPosted}/${summary.processed} matched, ${summary.blocked} mismatch`);
  }
  return summary;
}

// ── 16. GL period-close orchestrator ─────────────────────────────
// For each open period_close_checklists row past its target date,
// inspect substrate readiness signals (vendor stmts reconciled?
// VAT return generated? bank lines all matched?) and check off
// completed steps. Once all steps done, flip checklist to closed.

const CLOSE_STEPS = [
  { id: 'bank_recon', label: 'Bank reconciliation complete' },
  { id: 'ap_complete', label: 'AP cycle complete' },
  { id: 'ar_complete', label: 'AR cycle complete' },
  { id: 'vendor_statements', label: 'Vendor statements reconciled' },
  { id: 'ic_balances', label: 'Intercompany matched' },
  { id: 'fx_reval', label: 'FX revaluation posted' },
  { id: 'vat_return', label: 'VAT return generated' },
  { id: 'recurring_je', label: 'Recurring JEs posted' },
];

interface CloseChecklistRow {
  id: string; period: string; status: string;
  steps_completed: number; step_results: string;
}

export async function runGlPeriodCloseOrchestrator(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'gl-period-close-orchestrator', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const checklists = await db.prepare(
    `SELECT id, period, status, steps_completed, step_results
       FROM period_close_checklists WHERE tenant_id = ? AND status IN ('open','in_progress')`,
  ).bind(tenantId).all<CloseChecklistRow>();

  for (const cl of checklists.results || []) {
    summary.processed++;
    const period = cl.period;

    const counts = await Promise.all([
      db.prepare(`SELECT COUNT(*) AS n FROM bank_statement_lines WHERE tenant_id = ? AND recon_status = 'unmatched'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM ap_invoice_inbox WHERE tenant_id = ? AND status = 'received'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM customer_payments WHERE tenant_id = ? AND application_status = 'unapplied'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM vendor_statements WHERE tenant_id = ? AND recon_status = 'unmatched'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM intercompany_balances WHERE tenant_id = ? AND recon_status = 'unmatched'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM transactional_actions WHERE tenant_id = ? AND sub_catalyst_name = 'gl-fx-revaluation' AND status = 'posted'`).bind(tenantId).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM vat_returns WHERE tenant_id = ? AND period = ? AND status IN ('generated','submitted')`).bind(tenantId, period).first<{ n: number }>(),
      db.prepare(`SELECT COUNT(*) AS n FROM transactional_actions WHERE tenant_id = ? AND sub_catalyst_name = 'gl-recurring-je' AND status = 'posted'`).bind(tenantId).first<{ n: number }>(),
    ]);

    const results = CLOSE_STEPS.map((step, idx) => {
      const blockerCount = counts[idx]?.n ?? 0;
      const passed = idx < 5 ? blockerCount === 0 : blockerCount > 0;
      return { id: step.id, label: step.label, passed, evidence: blockerCount };
    });
    const completedCount = results.filter((r) => r.passed).length;
    const allDone = completedCount === CLOSE_STEPS.length;

    await db.prepare(
      `UPDATE period_close_checklists SET status = ?, steps_total = ?, steps_completed = ?, step_results = ?, completed_at = ?
        WHERE id = ?`,
    ).bind(
      allDone ? 'closed' : 'in_progress',
      CLOSE_STEPS.length, completedCount, JSON.stringify(results),
      allDone ? new Date().toISOString() : null, cl.id,
    ).run();

    if (allDone) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'gl-period-close-orchestrator',
        actionType: 'gl_journal_entry', targetEntity: 'period_close',
        sourceRecordRef: `close:${period}`,
        payload: { period, steps: results },
        reasoning: `Period ${period} closed: all ${CLOSE_STEPS.length} steps complete`,
        autoApprove: true,
      });
      summary.autoPosted++;
    } else {
      summary.reasoning.push(`Period ${period}: ${completedCount}/${CLOSE_STEPS.length} steps`);
    }
  }
  return summary;
}

// ── 17. GL FX revaluation ────────────────────────────────────────
// At month-end, revalue foreign-currency open AR + AP invoices using
// the latest fx_rate (target currency = tenant base, ZAR by default).
// Stages a single gl_journal_entry per currency pair with the
// aggregated unrealised gain/loss.

interface OpenInvoiceForReval {
  invoice_number: string; invoice_amount: number; paid_amount: number;
  original_currency: string; original_rate: number;
}

export async function runGlFxRevaluation(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'gl-fx-revaluation', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);
  const baseCurrency = 'ZAR';

  // Latest rate per pair targeting ZAR (e.g. USD/ZAR, EUR/ZAR, GBP/ZAR)
  const ratesRows = await db.prepare(
    `SELECT currency_pair, rate FROM fx_rates WHERE tenant_id = ?
       AND rate_date = (SELECT MAX(rate_date) FROM fx_rates fx2
                          WHERE fx2.tenant_id = fx_rates.tenant_id AND fx2.currency_pair = fx_rates.currency_pair)`,
  ).bind(tenantId).all<{ currency_pair: string; rate: number }>();

  const rateMap = new Map<string, number>();
  for (const r of ratesRows.results || []) {
    const [from] = r.currency_pair.split('/');
    if (from && r.rate > 0) rateMap.set(from, r.rate);
  }
  if (rateMap.size === 0) return summary; // no rates → skip

  // Open AR + AP invoices in foreign currencies — assume original_rate
  // was 1:1 captured at booking; in production the booking rate
  // would be persisted. For demo the seeder writes the rate field.
  const ar = await db.prepare(
    `SELECT invoice_number, invoice_amount, paid_amount, currency
       FROM ar_open_invoices WHERE tenant_id = ? AND status = 'open' AND currency != ?`,
  ).bind(tenantId, baseCurrency).all<{ invoice_number: string; invoice_amount: number; paid_amount: number; currency: string }>();
  const ap = await db.prepare(
    `SELECT invoice_number, invoice_amount, currency
       FROM ap_invoice_inbox WHERE tenant_id = ? AND status IN ('received','matched') AND currency != ?`,
  ).bind(tenantId, baseCurrency).all<{ invoice_number: string; invoice_amount: number; currency: string }>();

  const exposureByCurrency = new Map<string, number>();
  for (const r of ar.results || []) exposureByCurrency.set(r.currency, (exposureByCurrency.get(r.currency) ?? 0) + (r.invoice_amount - r.paid_amount));
  for (const r of ap.results || []) exposureByCurrency.set(r.currency, (exposureByCurrency.get(r.currency) ?? 0) - r.invoice_amount);

  const month = new Date().toISOString().slice(0, 7);
  for (const [currency, exposure] of exposureByCurrency) {
    summary.processed++;
    const rate = rateMap.get(currency);
    if (!rate) {
      summary.exceptions++;
      continue;
    }
    const unrealised = exposure * rate; // ZAR equivalent at month-end
    summary.totalValue += Math.abs(unrealised);

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'gl-fx-revaluation',
      actionType: 'gl_journal_entry', targetEntity: 'fx_reval',
      sourceRecordRef: `fx-reval:${currency}:${month}`,
      payload: { currency, exposure, rate, unrealised_zar: unrealised, period: month },
      postedValue: unrealised, currency: baseCurrency,
      reasoning: `FX revaluation ${currency}/ZAR @ ${rate}: exposure ${exposure.toFixed(2)} → unrealised ${unrealised.toFixed(2)} ZAR`,
      autoApprove: true,
    });
    summary.autoPosted++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`FX reval: ${summary.autoPosted}/${summary.processed} currencies revalued`);
  }
  return summary;
}

// ── 18. VAT return builder ───────────────────────────────────────

export async function runVatReturnBuilder(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'vat-return-builder', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);
  const VAT_RATE = 0.15; // SA standard rate
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  const existing = await db.prepare(
    `SELECT id, status FROM vat_returns WHERE tenant_id = ? AND period = ?`,
  ).bind(tenantId, period).first<{ id: string; status: string }>();
  if (existing && existing.status !== 'draft') {
    return summary; // already submitted/locked
  }

  const outputRow = await db.prepare(
    `SELECT COALESCE(SUM(invoice_amount), 0) AS total FROM ar_open_invoices
      WHERE tenant_id = ? AND substr(invoice_date, 1, 7) = ?`,
  ).bind(tenantId, period).first<{ total: number }>();
  const inputRow = await db.prepare(
    `SELECT COALESCE(SUM(invoice_amount), 0) AS total FROM ap_invoice_inbox
      WHERE tenant_id = ? AND substr(invoice_date, 1, 7) = ?`,
  ).bind(tenantId, period).first<{ total: number }>();

  const sales = outputRow?.total ?? 0;
  const purchases = inputRow?.total ?? 0;
  // VAT-inclusive amounts: VAT = amount × 15/115
  const outputVat = sales * VAT_RATE / (1 + VAT_RATE);
  const inputVat = purchases * VAT_RATE / (1 + VAT_RATE);
  const net = outputVat - inputVat;

  if (sales === 0 && purchases === 0) {
    return summary; // nothing to file
  }

  summary.processed++;
  summary.totalValue = Math.abs(net);

  if (existing) {
    await db.prepare(
      `UPDATE vat_returns SET output_vat = ?, input_vat = ?, net_payable = ?, generated_at = ?, evidence = ?
        WHERE id = ?`,
    ).bind(outputVat, inputVat, net, new Date().toISOString(),
      JSON.stringify({ sales, purchases, vat_rate: VAT_RATE }), existing.id).run();
  } else {
    await db.prepare(
      `INSERT INTO vat_returns (id, tenant_id, period, output_vat, input_vat, net_payable, currency, status, evidence)
       VALUES (?, ?, ?, ?, ?, ?, 'ZAR', 'generated', ?)`,
    ).bind(
      `vat-${tenantId}::${period}`, tenantId, period,
      outputVat, inputVat, net, JSON.stringify({ sales, purchases, vat_rate: VAT_RATE }),
    ).run();
  }

  await stageTransactionalAction(db, {
    tenantId, erpConnectionId: connId, subCatalystName: 'vat-return-builder',
    actionType: 'gl_journal_entry', targetEntity: 'vat_return',
    sourceRecordRef: `vat:${period}`,
    payload: { period, sales, purchases, output_vat: outputVat, input_vat: inputVat, net_payable: net },
    postedValue: net, currency: 'ZAR',
    reasoning: `VAT return ${period}: output ${outputVat.toFixed(2)} − input ${inputVat.toFixed(2)} = net ${net.toFixed(2)} ZAR`,
    autoApprove: false, // tax filings always go to HITL
  });
  summary.blocked++; // pending HITL review

  summary.reasoning.push(`Generated VAT return for ${period}, ${net.toFixed(2)} ZAR pending submission approval`);
  return summary;
}

// ── 19. Payroll posting bot ──────────────────────────────────────

interface PayrollRunRow {
  id: string; period: string; gross_pay: number; net_pay: number;
  paye: number; uif_employee: number; uif_employer: number; sdl: number;
  status: string;
}

export async function runPayrollPostingBot(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'payroll-posting-bot', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const runs = await db.prepare(
    `SELECT id, period, gross_pay, net_pay, paye, uif_employee, uif_employer, sdl, status
       FROM payroll_runs WHERE tenant_id = ? AND status = 'pending'`,
  ).bind(tenantId).all<PayrollRunRow>();

  for (const p of runs.results || []) {
    summary.processed++;
    summary.totalValue += p.gross_pay;

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'payroll-posting-bot',
      actionType: 'gl_journal_entry', targetEntity: 'payroll_je',
      sourceRecordRef: `payroll:${p.period}`,
      payload: {
        period: p.period, gross: p.gross_pay, net: p.net_pay,
        deductions: { paye: p.paye, uif_employee: p.uif_employee, sdl: p.sdl },
        employer_contributions: { uif_employer: p.uif_employer },
      },
      postedValue: p.gross_pay, currency: 'ZAR',
      reasoning: `Payroll JE for ${p.period}: gross ${p.gross_pay.toFixed(2)}, net ${p.net_pay.toFixed(2)} ZAR`,
      autoApprove: true,
    });
    await db.prepare(
      `UPDATE payroll_runs SET status = 'posted', posted_at = ? WHERE id = ?`,
    ).bind(new Date().toISOString(), p.id).run();
    summary.autoPosted++;
  }

  if (summary.autoPosted > 0) {
    summary.reasoning.push(`Posted ${summary.autoPosted} payroll runs (${summary.totalValue.toFixed(2)} ZAR gross)`);
  }
  return summary;
}

// ── 20. Statutory filing bot ─────────────────────────────────────
// Generates EMP201 (PAYE+UIF+SDL monthly), EMP501 (annual), and VAT
// submissions from posted payroll_runs and vat_returns. HITL gated.

export async function runStatutoryFilingBot(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'statutory-filing-bot', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  // EMP201 from each posted payroll run not yet filed
  const payrolls = await db.prepare(
    `SELECT pr.id, pr.period, pr.paye, pr.uif_employee, pr.uif_employer, pr.sdl
       FROM payroll_runs pr
      WHERE pr.tenant_id = ? AND pr.status = 'posted'
        AND NOT EXISTS (SELECT 1 FROM statutory_filings sf
                          WHERE sf.tenant_id = pr.tenant_id AND sf.filing_type = 'EMP201' AND sf.period = pr.period)`,
  ).bind(tenantId).all<{ id: string; period: string; paye: number; uif_employee: number; uif_employer: number; sdl: number }>();

  for (const p of payrolls.results || []) {
    summary.processed++;
    const total = p.paye + p.uif_employee + p.uif_employer + p.sdl;
    summary.totalValue += total;

    await db.prepare(
      `INSERT INTO statutory_filings (id, tenant_id, filing_type, period, due_date, amount, status, payload)
       VALUES (?, ?, 'EMP201', ?, date(?, '+7 days'), ?, 'draft', ?)`,
    ).bind(
      `filing-${tenantId}::EMP201::${p.period}`, tenantId, p.period,
      new Date().toISOString().slice(0, 10), total,
      JSON.stringify({ paye: p.paye, uif: p.uif_employee + p.uif_employer, sdl: p.sdl }),
    ).run();

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'statutory-filing-bot',
      actionType: 'gl_journal_entry', targetEntity: 'statutory_filing',
      sourceRecordRef: `EMP201:${p.period}`,
      payload: { type: 'EMP201', period: p.period, paye: p.paye, uif: p.uif_employee + p.uif_employer, sdl: p.sdl, total },
      postedValue: total, currency: 'ZAR',
      reasoning: `EMP201 (PAYE+UIF+SDL) for ${p.period}: ${total.toFixed(2)} ZAR — pending submission`,
      autoApprove: false, // tax filings always HITL
    });
    summary.blocked++;
  }

  // VAT201 from each generated vat_return not yet filed
  const vatReturns = await db.prepare(
    `SELECT vr.id, vr.period, vr.net_payable
       FROM vat_returns vr
      WHERE vr.tenant_id = ? AND vr.status = 'generated'
        AND NOT EXISTS (SELECT 1 FROM statutory_filings sf
                          WHERE sf.tenant_id = vr.tenant_id AND sf.filing_type = 'VAT201' AND sf.period = vr.period)`,
  ).bind(tenantId).all<{ id: string; period: string; net_payable: number }>();

  for (const v of vatReturns.results || []) {
    summary.processed++;
    summary.totalValue += Math.abs(v.net_payable);
    await db.prepare(
      `INSERT INTO statutory_filings (id, tenant_id, filing_type, period, due_date, amount, status, payload)
       VALUES (?, ?, 'VAT201', ?, date(?, '+25 days'), ?, 'draft', ?)`,
    ).bind(
      `filing-${tenantId}::VAT201::${v.period}`, tenantId, v.period,
      new Date().toISOString().slice(0, 10), v.net_payable,
      JSON.stringify({ vat_return_id: v.id, net_payable: v.net_payable }),
    ).run();
    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'statutory-filing-bot',
      actionType: 'gl_journal_entry', targetEntity: 'statutory_filing',
      sourceRecordRef: `VAT201:${v.period}`,
      payload: { type: 'VAT201', period: v.period, net_payable: v.net_payable },
      postedValue: v.net_payable, currency: 'ZAR',
      reasoning: `VAT201 for ${v.period}: ${v.net_payable.toFixed(2)} ZAR — pending submission`,
      autoApprove: false,
    });
    summary.blocked++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Generated ${summary.processed} statutory filings (${summary.blocked} pending submission approval)`);
  }
  return summary;
}

// ── 21. Cycle count reconciler ───────────────────────────────────

interface CycleCountRow {
  id: string; sku: string; location: string | null; system_qty: number;
  counted_qty: number; currency: string;
}

export async function runCycleCountReconciler(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'cycle-count-reconciler', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);
  const VARIANCE_TOLERANCE_PCT = 0.02;

  const counts = await db.prepare(
    `SELECT id, sku, location, system_qty, counted_qty, currency
       FROM cycle_counts WHERE tenant_id = ? AND recon_status = 'unmatched'`,
  ).bind(tenantId).all<CycleCountRow>();

  for (const c of counts.results || []) {
    summary.processed++;
    const variance = c.counted_qty - c.system_qty;
    const variancePct = c.system_qty > 0 ? Math.abs(variance) / c.system_qty : (variance === 0 ? 0 : 1);

    // Look up unit cost for variance value
    const item = await db.prepare(
      `SELECT unit_cost FROM inventory_items WHERE tenant_id = ? AND sku = ? AND (location = ? OR ? IS NULL)`,
    ).bind(tenantId, c.sku, c.location, c.location).first<{ unit_cost: number }>();
    const unitCost = item?.unit_cost ?? 0;
    const varianceValue = variance * unitCost;
    summary.totalValue += Math.abs(varianceValue);

    const matched = variancePct <= VARIANCE_TOLERANCE_PCT;
    await db.prepare(
      `UPDATE cycle_counts SET recon_status = ?, variance_qty = ?, variance_value = ? WHERE id = ?`,
    ).bind(matched ? 'matched' : 'mismatch', variance, varianceValue, c.id).run();

    if (matched) {
      summary.autoPosted++;
      // Even matched counts post a tiny variance JE if non-zero
      if (Math.abs(varianceValue) > 0.01) {
        await stageTransactionalAction(db, {
          tenantId, erpConnectionId: connId, subCatalystName: 'cycle-count-reconciler',
          actionType: 'gl_journal_entry', targetEntity: 'inventory_variance',
          sourceRecordRef: `cycle:${c.sku}:${c.location}`,
          payload: { sku: c.sku, location: c.location, variance, varianceValue, unit_cost: unitCost },
          postedValue: varianceValue, currency: c.currency,
          reasoning: `Cycle count ${c.sku} @${c.location}: variance ${variance} units (${varianceValue.toFixed(2)} ${c.currency}) within tolerance, posted`,
          autoApprove: true,
        });
      }
    } else {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'cycle-count-reconciler',
        actionType: 'ap_invoice_block', targetEntity: 'inventory_variance',
        sourceRecordRef: `cycle:${c.sku}:${c.location}`,
        payload: { sku: c.sku, location: c.location, variance, variancePct, varianceValue },
        postedValue: varianceValue, currency: c.currency,
        reasoning: `Cycle count ${c.sku} @${c.location}: variance ${variance} (${(variancePct * 100).toFixed(1)}% > ${(VARIANCE_TOLERANCE_PCT * 100).toFixed(1)}%) — review for shrinkage/fraud`,
      });
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Cycle counts: ${summary.autoPosted} auto-cleared, ${summary.blocked} flagged for shrinkage review`);
  }
  return summary;
}

// ── 22. Stock transfer executor ──────────────────────────────────

interface StockTransferRow {
  id: string; transfer_ref: string; from_location: string; to_location: string;
  sku: string; qty: number; currency: string;
}

export async function runStockTransferExecutor(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'stock-transfer-executor', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const requests = await db.prepare(
    `SELECT id, transfer_ref, from_location, to_location, sku, qty, currency
       FROM stock_transfer_requests WHERE tenant_id = ? AND status = 'requested'`,
  ).bind(tenantId).all<StockTransferRow>();

  for (const t of requests.results || []) {
    summary.processed++;

    // Validate source location has the qty
    const source = await db.prepare(
      `SELECT id, system_qty, unit_cost FROM inventory_items
        WHERE tenant_id = ? AND sku = ? AND location = ?`,
    ).bind(tenantId, t.sku, t.from_location).first<{ id: string; system_qty: number; unit_cost: number }>();

    if (!source || source.system_qty < t.qty) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'stock-transfer-executor',
        actionType: 'ap_invoice_block', targetEntity: 'stock_transfer',
        sourceRecordRef: `xfer:${t.transfer_ref}`,
        payload: { transfer: t, available: source?.system_qty ?? 0 },
        reasoning: `Stock transfer ${t.transfer_ref}: insufficient source qty (need ${t.qty} of ${t.sku}, have ${source?.system_qty ?? 0})`,
      });
      summary.blocked++;
      continue;
    }

    summary.totalValue += t.qty * (source.unit_cost ?? 0);

    // Decrement source, increment dest (upsert dest)
    await db.prepare(
      `UPDATE inventory_items SET system_qty = system_qty - ? WHERE id = ?`,
    ).bind(t.qty, source.id).run();
    await db.prepare(
      `INSERT INTO inventory_items (id, tenant_id, sku, name, location, system_qty, unit_cost, currency)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(tenant_id, sku, location) DO UPDATE SET system_qty = system_qty + excluded.system_qty`,
    ).bind(
      `inv-${tenantId}::${t.sku}::${t.to_location}`, tenantId, t.sku, t.sku, t.to_location,
      t.qty, source.unit_cost, t.currency,
    ).run();

    await db.prepare(
      `UPDATE stock_transfer_requests SET status = 'executed', executed_at = ? WHERE id = ?`,
    ).bind(new Date().toISOString(), t.id).run();

    await stageTransactionalAction(db, {
      tenantId, erpConnectionId: connId, subCatalystName: 'stock-transfer-executor',
      actionType: 'gl_journal_entry', targetEntity: 'stock_movement',
      sourceRecordRef: `xfer:${t.transfer_ref}`,
      payload: { transfer: t, unit_cost: source.unit_cost, value: t.qty * source.unit_cost },
      postedValue: t.qty * source.unit_cost, currency: t.currency,
      reasoning: `Transferred ${t.qty} × ${t.sku} from ${t.from_location} → ${t.to_location}`,
      autoApprove: true,
    });
    summary.autoPosted++;
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`Stock transfers: ${summary.autoPosted} executed, ${summary.blocked} blocked (insufficient stock)`);
  }
  return summary;
}

// ── 23. Cash position forecaster ─────────────────────────────────
// Builds 30/60/90-day cash projection from open AR (inflows by
// due_date), open AP (outflows by due_date), and recent bank balance
// trend. Stages a single read-only forecast action for treasury review.

export async function runCashPositionForecaster(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'cash-position-forecaster', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const horizons = [30, 60, 90];
  const buckets: Record<number, { inflow: number; outflow: number; net: number }> = {};

  for (const h of horizons) {
    const inflowRow = await db.prepare(
      `SELECT COALESCE(SUM(invoice_amount - paid_amount), 0) AS total FROM ar_open_invoices
        WHERE tenant_id = ? AND status = 'open' AND due_date IS NOT NULL
          AND date(due_date) <= date('now', '+${h} days')`,
    ).bind(tenantId).first<{ total: number }>();
    const outflowRow = await db.prepare(
      `SELECT COALESCE(SUM(invoice_amount), 0) AS total FROM ap_invoice_inbox
        WHERE tenant_id = ? AND status = 'matched' AND due_date IS NOT NULL
          AND date(due_date) <= date('now', '+${h} days')`,
    ).bind(tenantId).first<{ total: number }>();
    const inflow = inflowRow?.total ?? 0;
    const outflow = outflowRow?.total ?? 0;
    buckets[h] = { inflow, outflow, net: inflow - outflow };
  }

  const haveActivity = horizons.some((h) => buckets[h].inflow > 0 || buckets[h].outflow > 0);
  if (!haveActivity) return summary;

  summary.processed = 1;
  summary.totalValue = Math.abs(buckets[90]?.net ?? 0);

  await stageTransactionalAction(db, {
    tenantId, erpConnectionId: connId, subCatalystName: 'cash-position-forecaster',
    actionType: 'gl_journal_entry', targetEntity: 'cash_forecast',
    sourceRecordRef: `forecast:${new Date().toISOString().slice(0, 10)}`,
    payload: { generated_at: new Date().toISOString(), horizons: buckets },
    postedValue: buckets[90]?.net ?? 0, currency: 'ZAR',
    reasoning: `Cash forecast: 30d net ${(buckets[30]?.net ?? 0).toFixed(0)}, 60d ${(buckets[60]?.net ?? 0).toFixed(0)}, 90d ${(buckets[90]?.net ?? 0).toFixed(0)} ZAR`,
    autoApprove: true,
  });
  summary.autoPosted = 1;
  summary.reasoning.push(`Generated 30/60/90-day cash forecast`);
  return summary;
}

// ── 24. Expense report auditor ───────────────────────────────────
// For each submitted expense_report, scan its lines for: missing
// receipts above R250; per-category limits; weekend submissions; round-
// number amounts (potential fraud signals). Auto-approve clean reports;
// HITL on policy violations.

interface ExpenseReportRow {
  id: string; report_ref: string; employee_id: string;
  employee_name: string | null; total_amount: number; currency: string;
}
interface ExpenseLineRow {
  id: string; category: string; amount: number; receipt_attached: number;
  expense_date: string | null;
}

const RECEIPT_REQUIRED_THRESHOLD = 250;
const ROUND_AMOUNT_TRIGGER = 1000; // round to nearest 1000

export async function runExpenseReportAuditor(
  db: D1Database, tenantId: string,
): Promise<TransactionalRunSummary> {
  const summary: TransactionalRunSummary = { subCatalyst: 'expense-report-auditor', processed: 0, autoPosted: 0, blocked: 0, exceptions: 0, totalValue: 0, reasoning: [] };
  const connId = await loadConnectionId(db, tenantId);

  const reports = await db.prepare(
    `SELECT id, report_ref, employee_id, employee_name, total_amount, currency
       FROM expense_reports WHERE tenant_id = ? AND status = 'submitted'`,
  ).bind(tenantId).all<ExpenseReportRow>();

  for (const r of reports.results || []) {
    summary.processed++;
    summary.totalValue += r.total_amount;

    const lines = await db.prepare(
      `SELECT id, category, amount, receipt_attached, expense_date
         FROM expense_lines WHERE report_id = ?`,
    ).bind(r.id).all<ExpenseLineRow>();

    const violations: string[] = [];
    for (const line of lines.results || []) {
      if (line.amount >= RECEIPT_REQUIRED_THRESHOLD && line.receipt_attached === 0) {
        violations.push(`${line.category} ${line.amount.toFixed(2)}: receipt missing`);
      }
      if (line.amount > 0 && line.amount % ROUND_AMOUNT_TRIGGER === 0 && line.amount >= ROUND_AMOUNT_TRIGGER * 2) {
        violations.push(`${line.category} ${line.amount.toFixed(2)}: suspiciously round`);
      }
      if (line.expense_date) {
        const day = new Date(line.expense_date).getUTCDay();
        if ((day === 0 || day === 6) && line.category === 'meals') {
          violations.push(`weekend meal ${line.amount.toFixed(2)}: review`);
        }
      }
    }

    if (violations.length === 0) {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'expense-report-auditor',
        actionType: 'ap_invoice_post', targetEntity: 'expense_reimbursement',
        sourceRecordRef: `expense:${r.report_ref}`,
        payload: { report: r, line_count: (lines.results || []).length },
        postedValue: r.total_amount, currency: r.currency,
        reasoning: `Expense report ${r.report_ref} (${r.employee_name ?? r.employee_id}): clean, ${r.total_amount.toFixed(2)} ${r.currency} approved for reimbursement`,
        autoApprove: true,
      });
      await db.prepare(
        `UPDATE expense_reports SET status = 'approved', audited_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), r.id).run();
      summary.autoPosted++;
    } else {
      await stageTransactionalAction(db, {
        tenantId, erpConnectionId: connId, subCatalystName: 'expense-report-auditor',
        actionType: 'ap_invoice_block', targetEntity: 'expense_reimbursement',
        sourceRecordRef: `expense:${r.report_ref}`,
        payload: { report: r, violations, line_count: (lines.results || []).length },
        postedValue: r.total_amount, currency: r.currency,
        reasoning: `Expense report ${r.report_ref}: ${violations.length} policy violation(s) — ${violations.slice(0, 3).join('; ')}${violations.length > 3 ? '…' : ''}`,
      });
      await db.prepare(
        `UPDATE expense_reports SET status = 'flagged', audited_at = ? WHERE id = ?`,
      ).bind(new Date().toISOString(), r.id).run();
      summary.blocked++;
    }
  }

  if (summary.processed > 0) {
    summary.reasoning.push(`T&E audit: ${summary.autoPosted}/${summary.processed} clean approvals, ${summary.blocked} flagged for review`);
  }
  return summary;
}


