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
