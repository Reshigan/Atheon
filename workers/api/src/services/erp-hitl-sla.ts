/**
 * HITL SLA — Phase 8-3 of dynamic ERP intelligence.
 *
 * Pending-approval actions can sit forever if no one approves them. This
 * service runs every cron tick (15 min) and:
 *   1. Flags actions sitting in pending_approval for > WARN_HOURS as
 *      "warning" — fires a single notification per stale action.
 *   2. Auto-escalates actions sitting > ESCALATE_HOURS by writing
 *      `escalation_level` on the row + a higher-severity notification.
 *   3. Optionally auto-rejects after AUTO_REJECT_HOURS to keep the queue
 *      from growing unbounded.
 *
 * Idempotent — uses `escalation_level` column to avoid re-firing the same
 * notification on every cron tick.
 */

import { logError, logInfo } from './logger';

const WARN_HOURS = 24;
const ESCALATE_HOURS = 48;
const AUTO_REJECT_HOURS = 168; // 7 days

interface PendingActionRow {
  id: string;
  catalyst_name: string;
  action_type: string | null;
  value_zar: number | null;
  connection_id: string | null;
  escalation_level: string | null;
  created_at: string;
}

function ageHours(createdAtIso: string, nowMs: number): number {
  const t = new Date(createdAtIso).getTime();
  if (!isFinite(t)) return 0;
  return Math.max(0, (nowMs - t) / (1000 * 60 * 60));
}

async function notifyStaleAction(
  db: D1Database, tenantId: string, row: PendingActionRow,
  level: 'warning' | 'escalated' | 'auto_rejected', hours: number,
): Promise<void> {
  const titles = {
    warning: `Action awaiting approval for ${Math.floor(hours)}h`,
    escalated: `ESCALATED — action awaiting approval for ${Math.floor(hours)}h`,
    auto_rejected: `Auto-rejected — action sat in queue for ${Math.floor(hours)}h`,
  };
  const severities = { warning: 'warning' as const, escalated: 'warning' as const, auto_rejected: 'info' as const };
  const valueZar = row.value_zar || 0;
  const valueStr = valueZar >= 1000 ? `R ${(valueZar / 1000).toFixed(0)}k` : `R ${valueZar.toFixed(0)}`;
  try {
    await db.prepare(
      `INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, metadata, read)
       VALUES (?, ?, 'system', ?, ?, ?, ?, ?, 0)`
    ).bind(
      crypto.randomUUID(), tenantId, titles[level],
      `${row.catalyst_name} → ${row.action_type || 'action'} (${valueStr}) has been pending approval. Approve or reject from the action queue.`,
      severities[level],
      '/integrations',
      JSON.stringify({ actionId: row.id, catalyst: row.catalyst_name, hours: Math.floor(hours), level }),
    ).run();
  } catch (err) {
    logError('hitl_sla.notify_failed', err, { tenantId }, { actionId: row.id, level });
  }
}

/** Sweep this tenant's pending-approval actions; notify, escalate,
 *  or auto-reject as their age dictates. Returns counts for logging. */
export async function escalateStaleActions(
  db: D1Database, tenantId: string, nowMs: number = Date.now(),
): Promise<{ warned: number; escalated: number; rejected: number; checked: number }> {
  const result = { warned: 0, escalated: 0, rejected: 0, checked: 0 };
  try {
    const res = await db.prepare(
      `SELECT id, catalyst_name, action_type, value_zar, connection_id, escalation_level, created_at
         FROM catalyst_actions
        WHERE tenant_id = ? AND status = 'pending_approval'`
    ).bind(tenantId).all<PendingActionRow>();

    for (const row of res.results || []) {
      result.checked++;
      const hours = ageHours(row.created_at, nowMs);
      const lvl = row.escalation_level || '';

      if (hours >= AUTO_REJECT_HOURS) {
        // Auto-reject. Mark status='rejected' with a system reason.
        try {
          await db.prepare(
            `UPDATE catalyst_actions SET status = 'rejected', escalation_level = 'auto_rejected',
                    output_data = ?, completed_at = datetime('now')
              WHERE id = ? AND tenant_id = ?`
          ).bind(
            JSON.stringify({ ok: false, status: 'rejected', summary: `Auto-rejected after ${Math.floor(hours)}h in queue`, error: 'sla_timeout' }),
            row.id, tenantId,
          ).run();
          await notifyStaleAction(db, tenantId, row, 'auto_rejected', hours);
          result.rejected++;
        } catch (err) {
          logError('hitl_sla.auto_reject_failed', err, { tenantId }, { actionId: row.id });
        }
        continue;
      }

      if (hours >= ESCALATE_HOURS && lvl !== 'escalated' && lvl !== 'auto_rejected') {
        try {
          await db.prepare(
            `UPDATE catalyst_actions SET escalation_level = 'escalated' WHERE id = ? AND tenant_id = ?`
          ).bind(row.id, tenantId).run();
          await notifyStaleAction(db, tenantId, row, 'escalated', hours);
          result.escalated++;
        } catch (err) {
          logError('hitl_sla.escalate_failed', err, { tenantId }, { actionId: row.id });
        }
        continue;
      }

      if (hours >= WARN_HOURS && !lvl) {
        try {
          await db.prepare(
            `UPDATE catalyst_actions SET escalation_level = 'warned' WHERE id = ? AND tenant_id = ?`
          ).bind(row.id, tenantId).run();
          await notifyStaleAction(db, tenantId, row, 'warning', hours);
          result.warned++;
        } catch (err) {
          logError('hitl_sla.warn_failed', err, { tenantId }, { actionId: row.id });
        }
      }
    }
    if (result.warned + result.escalated + result.rejected > 0) {
      logInfo('hitl_sla.sweep_completed', { tenantId, layer: 'erp', action: 'hitl_sla.sweep' }, result);
    }
  } catch (err) {
    logError('hitl_sla.sweep_failed', err, { tenantId }, {});
  }
  return result;
}

// Exported for tests
export const _SLA_HOURS = { WARN_HOURS, ESCALATE_HOURS, AUTO_REJECT_HOURS };
