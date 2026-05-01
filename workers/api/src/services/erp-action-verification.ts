/**
 * Post-action verification — Phase 8-4.
 *
 * After a write-back action completes, re-read the ERP entity to confirm
 * the change actually took effect. If verification fails, we mark the
 * action with `verification_status='failed'` so:
 *   1. The customer sees the discrepancy in the Action Queue.
 *   2. ROI attribution can downgrade — value shouldn't count toward
 *      "automated by Atheon" if we can't confirm the ERP recorded it.
 *
 * Verification rules per vendor are intentionally narrow in v1:
 *   - Xero `invoice_post` → re-fetch the invoice, expect Status=AUTHORISED.
 *   - Xero `ap_payment_release` → re-fetch the payment by id, expect existence.
 *   - Other vendors → marked `verification_status='deferred'` with a note
 *     until per-vendor verification rules ship.
 *   - Stub-mode actions → marked `verification_status='skipped'` with reason
 *     "stub mode action — nothing to verify in ERP".
 *
 * Cron integration: runs once per scheduled tick (15 min). Only verifies
 * actions completed within the last 24h that haven't been verified yet.
 * Idempotent — uses verification_status to avoid re-verifying.
 */

import { logError, logInfo } from './logger';
import type { XeroCredentials } from './erp-xero-live';

export type VerificationStatus = 'verified' | 'failed' | 'deferred' | 'skipped' | null;

interface CompletedActionRow {
  id: string;
  catalyst_name: string;
  action_type: string | null;
  connection_id: string | null;
  output_data: string | null;
  input_data: string | null;
  vendor: string | null;
  verification_status: string | null;
}

interface VerificationOutcome {
  status: Exclude<VerificationStatus, null>;
  notes: string;
}

const VERIFY_LOOKBACK_HOURS = 24;

async function loadConnectionVendor(
  db: D1Database, tenantId: string, connectionId: string,
): Promise<{ vendor: string; credentials: Record<string, unknown> } | null> {
  try {
    const r = await db.prepare(
      `SELECT ec.config, ec.encrypted_config, ea.system as vendor
         FROM erp_connections ec
         JOIN erp_adapters ea ON ec.adapter_id = ea.id
        WHERE ec.id = ? AND ec.tenant_id = ?`
    ).bind(connectionId, tenantId).first<{ config: string; encrypted_config: string | null; vendor: string }>();
    if (!r) return null;
    let credentials: Record<string, unknown> = {};
    try { credentials = r.config ? JSON.parse(r.config) : {}; } catch { /* tolerate */ }
    // Note: we deliberately don't decrypt here — verification cron runs
    // without the request encryption key. Verification calls work only when
    // tokens are stored unencrypted (legacy) OR the cron runner has been
    // wired with ENCRYPTION_KEY from env. Where neither, we 'defer' the
    // verification and log. This keeps the cron path safe.
    return { vendor: r.vendor, credentials };
  } catch {
    return null;
  }
}

// ── Per-vendor verifiers ───────────────────────────────────────────────

async function verifyXeroAction(
  actionType: string, payload: Record<string, unknown>, output: Record<string, unknown> | null,
  creds: XeroCredentials,
): Promise<VerificationOutcome> {
  if (!creds.access_token || !creds.xero_tenant_id || !creds.live_mode) {
    return { status: 'skipped', notes: 'Xero credentials not in live_mode — verification skipped' };
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${creds.access_token}`,
    Accept: 'application/json',
    'Xero-tenant-id': creds.xero_tenant_id,
  };

  if (actionType === 'invoice_post') {
    const invoiceId = payload.invoice_id || (output?.erp_reference as string | undefined);
    if (!invoiceId) return { status: 'failed', notes: 'No invoice_id available to verify' };
    const url = `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return { status: 'failed', notes: `Xero re-fetch returned HTTP ${res.status}` };
      const body = await res.json() as { Invoices?: Array<{ Status?: string }> };
      const status = body.Invoices?.[0]?.Status;
      if (status === 'AUTHORISED' || status === 'PAID') {
        return { status: 'verified', notes: `Invoice ${invoiceId} status=${status}` };
      }
      return { status: 'failed', notes: `Invoice ${invoiceId} status=${status} — expected AUTHORISED` };
    } catch (err) {
      return { status: 'deferred', notes: `Verification call threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  if (actionType === 'ap_payment_release') {
    const paymentId = (output?.erp_reference as string | undefined);
    if (!paymentId) return { status: 'deferred', notes: 'No payment id in action output — cannot verify' };
    const url = `https://api.xero.com/api.xro/2.0/Payments/${paymentId}`;
    try {
      const res = await fetch(url, { headers });
      if (!res.ok) return { status: 'failed', notes: `Xero re-fetch returned HTTP ${res.status}` };
      return { status: 'verified', notes: `Payment ${paymentId} found` };
    } catch (err) {
      return { status: 'deferred', notes: `Verification call threw: ${err instanceof Error ? err.message : String(err)}` };
    }
  }

  return { status: 'deferred', notes: `No Xero verifier implemented for action_type=${actionType}` };
}

async function verifyAction(
  db: D1Database, tenantId: string, row: CompletedActionRow,
): Promise<VerificationOutcome> {
  // Stub-mode actions need no verification — by definition no ERP write happened.
  let outputData: Record<string, unknown> | null = null;
  try { if (row.output_data) outputData = JSON.parse(row.output_data); } catch { /* tolerate */ }
  if (outputData && (outputData.mode === 'stub' || outputData.mode === 'preview')) {
    return { status: 'skipped', notes: `${outputData.mode} mode — no ERP write to verify` };
  }

  let inputPayload: Record<string, unknown> = {};
  try {
    if (row.input_data) {
      const parsed = JSON.parse(row.input_data);
      inputPayload = (parsed.payload || {}) as Record<string, unknown>;
    }
  } catch { /* tolerate */ }

  if (!row.connection_id) return { status: 'deferred', notes: 'No connection_id on action — cannot verify' };
  const conn = await loadConnectionVendor(db, tenantId, row.connection_id);
  if (!conn) return { status: 'deferred', notes: 'Connection not found' };

  if (conn.vendor.toLowerCase().startsWith('xero')) {
    return verifyXeroAction(row.action_type || '', inputPayload, outputData, conn.credentials as XeroCredentials);
  }

  return { status: 'deferred', notes: `No verifier implemented for vendor=${conn.vendor}` };
}

/** Sweep recently-completed actions for the tenant; verify each that
 *  hasn't been verified yet. Best-effort. */
export async function verifyCompletedActions(
  db: D1Database, tenantId: string,
): Promise<{ checked: number; verified: number; failed: number; deferred: number; skipped: number }> {
  const result = { checked: 0, verified: 0, failed: 0, deferred: 0, skipped: 0 };
  try {
    const res = await db.prepare(
      `SELECT id, catalyst_name, action_type, connection_id, output_data, input_data, vendor, verification_status
         FROM catalyst_actions
        WHERE tenant_id = ?
          AND status = 'completed'
          AND verification_status IS NULL
          AND completed_at > datetime('now', ?)`
    ).bind(tenantId, `-${VERIFY_LOOKBACK_HOURS} hours`).all<CompletedActionRow>();

    for (const row of res.results || []) {
      result.checked++;
      try {
        const outcome = await verifyAction(db, tenantId, row);
        await db.prepare(
          `UPDATE catalyst_actions
              SET verification_status = ?, verification_notes = ?, verified_at = datetime('now')
            WHERE id = ? AND tenant_id = ?`
        ).bind(outcome.status, outcome.notes, row.id, tenantId).run();
        if (outcome.status === 'verified') result.verified++;
        else if (outcome.status === 'failed') result.failed++;
        else if (outcome.status === 'skipped') result.skipped++;
        else result.deferred++;

        // Failed verification → notify, since this means the ERP didn't
        // actually record what we claimed. ROI attribution will exclude
        // these from "automated by Atheon" — the read path filters on
        // verification_status != 'failed'.
        if (outcome.status === 'failed') {
          try {
            await db.prepare(
              `INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, metadata, read)
               VALUES (?, ?, 'system', ?, ?, 'warning', '/integrations', ?, 0)`
            ).bind(
              crypto.randomUUID(), tenantId,
              `Action verification failed — ${row.catalyst_name}`,
              `An automated action completed but Atheon could not verify the ERP recorded the change. ${outcome.notes}`,
              JSON.stringify({ actionId: row.id, verification_status: outcome.status }),
            ).run();
          } catch (err) {
            logError('action_verification.notify_failed', err, { tenantId }, { actionId: row.id });
          }
        }
      } catch (err) {
        logError('action_verification.action_failed', err, { tenantId }, { actionId: row.id });
      }
    }
    if (result.checked > 0) {
      logInfo('action_verification.sweep_completed', { tenantId, layer: 'erp', action: 'action_verification' }, result);
    }
  } catch (err) {
    logError('action_verification.sweep_failed', err, { tenantId }, {});
  }
  return result;
}
