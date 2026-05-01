/**
 * ERP Schema Drift Detector — Phase 3 of dynamic ERP-mapping intelligence.
 *
 * Customer-side ERP changes (a new SAP Z-field appears, a custom Odoo
 * module is enabled, a column rename, a column removal) silently shift
 * the data shape Atheon receives. Without detection, the auto-mapper's
 * cached mappings become stale, the catalysts under-extract, and the
 * shared-savings reports end up under-reporting savings.
 *
 * Drift is detected by comparing a per-connection schema *snapshot* (the
 * set of fields seen the previous time we ran) to the current set. We
 * only fire a drift event when the set genuinely changed; this runs
 * every cron tick (every 15 minutes) so we report drift within minutes
 * of the next sync, not days later.
 *
 * Outputs:
 *   - A row in `erp_schema_drift_events` per detected drift.
 *   - A `notifications` row so the customer sees it in-app.
 *
 * Snapshot storage: small JSON blob in `tenant_settings` keyed by
 * `erp_drift_snapshot:{connection_id}:{entity_type}` — just the array of
 * field names (no values) so it stays tiny.
 */

import { logInfo, logError } from './logger';

const SNAPSHOT_KEY_PREFIX = 'erp_drift_snapshot';

/** Phase 8-3: minimum hours between drift events for the same
 *  (connection, entity). Prevents notification spam when a volatile ERP
 *  schema churns frequently. */
const DEBOUNCE_HOURS = 6;

interface SnapshotPayload {
  fields: string[];
  takenAt: string;
}

interface DriftReport {
  tenantId: string;
  connectionId: string;
  entityType: string;
  added: string[];
  removed: string[];
  totalCurrent: number;
  totalPrevious: number;
}

/** Read the previous snapshot for a (connection, entity), if any. */
async function readSnapshot(
  db: D1Database, tenantId: string, connectionId: string, entityType: string,
): Promise<SnapshotPayload | null> {
  const key = `${SNAPSHOT_KEY_PREFIX}:${connectionId}:${entityType}`;
  const row = await db.prepare(
    'SELECT value FROM tenant_settings WHERE tenant_id = ? AND key = ?'
  ).bind(tenantId, key).first<{ value: string }>();
  if (!row) return null;
  try {
    const parsed = JSON.parse(row.value) as SnapshotPayload;
    if (Array.isArray(parsed?.fields)) return parsed;
    return null;
  } catch {
    return null;
  }
}

/** Persist the current snapshot. UPSERT keyed by (tenant, key). */
async function writeSnapshot(
  db: D1Database, tenantId: string, connectionId: string, entityType: string, fields: string[],
): Promise<void> {
  const key = `${SNAPSHOT_KEY_PREFIX}:${connectionId}:${entityType}`;
  const value = JSON.stringify({ fields, takenAt: new Date().toISOString() } satisfies SnapshotPayload);
  // tenant_settings has UNIQUE(tenant_id, key). Use INSERT … ON CONFLICT.
  await db.prepare(
    `INSERT INTO tenant_settings (id, tenant_id, key, value)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tenant_id, key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`
  ).bind(crypto.randomUUID(), tenantId, key, value).run();
}

/** Persist a drift event row + an in-app notification. */
async function persistDriftEvent(db: D1Database, report: DriftReport): Promise<void> {
  // erp_schema_drift_events table is created lazily via the migrate.ts self-
  // healing path (added in v59). Insert idempotently.
  try {
    await db.prepare(
      `INSERT INTO erp_schema_drift_events (
         id, tenant_id, connection_id, entity_type,
         added_fields, removed_fields, total_current, total_previous, detected_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), report.tenantId, report.connectionId, report.entityType,
      JSON.stringify(report.added), JSON.stringify(report.removed),
      report.totalCurrent, report.totalPrevious,
    ).run();
  } catch (err) {
    logError('erp.drift.event_persist_failed', err, { tenantId: report.tenantId }, {
      connectionId: report.connectionId, entityType: report.entityType,
    });
  }

  // Notification — surface to the user so they can review + remap.
  const summary = `${report.added.length} new, ${report.removed.length} removed`;
  try {
    await db.prepare(
      `INSERT INTO notifications (id, tenant_id, type, title, message, severity, action_url, metadata, read)
       VALUES (?, ?, 'system', ?, ?, ?, ?, ?, 0)`
    ).bind(
      crypto.randomUUID(), report.tenantId, `ERP schema drift on ${report.entityType}`,
      `Detected ${summary} field${report.added.length + report.removed.length === 1 ? '' : 's'} on connection ${report.connectionId} (${report.entityType}). Review the field mappings to ensure assessment & report numbers stay accurate.`,
      report.removed.length > 0 ? 'warning' : 'info',
      `/integrations`,
      JSON.stringify({ connectionId: report.connectionId, entityType: report.entityType, added: report.added, removed: report.removed }),
    ).run();
  } catch (err) {
    logError('erp.drift.notification_failed', err, { tenantId: report.tenantId }, {
      connectionId: report.connectionId, entityType: report.entityType,
    });
  }
}

/**
 * Main entry point — called from the cron tick. Sweeps every (connection,
 * entity) profile for the tenant, compares to snapshots, fires drift
 * events for any change, then refreshes the snapshot.
 */
export async function detectErpSchemaDrift(
  db: D1Database, tenantId: string,
): Promise<{ checked: number; driftCount: number }> {
  let checked = 0, driftCount = 0;
  try {
    // Distinct (connection, entity) pairs with at least one profiled field
    const pairs = await db.prepare(
      `SELECT DISTINCT connection_id, entity_type
         FROM erp_connection_schemas
        WHERE tenant_id = ?`
    ).bind(tenantId).all<{ connection_id: string; entity_type: string }>();

    for (const p of pairs.results || []) {
      checked++;
      try {
        // Current field set
        const fieldsRes = await db.prepare(
          `SELECT source_field FROM erp_connection_schemas
            WHERE tenant_id = ? AND connection_id = ? AND entity_type = ?
         ORDER BY source_field ASC`
        ).bind(tenantId, p.connection_id, p.entity_type).all<{ source_field: string }>();
        const current = (fieldsRes.results || []).map((r) => r.source_field);

        const snap = await readSnapshot(db, tenantId, p.connection_id, p.entity_type);
        if (!snap) {
          // First time we see this connection/entity — store baseline, no drift event.
          await writeSnapshot(db, tenantId, p.connection_id, p.entity_type, current);
          continue;
        }

        const prev = new Set(snap.fields);
        const cur = new Set(current);
        const added = current.filter((f) => !prev.has(f));
        const removed = snap.fields.filter((f) => !cur.has(f));

        if (added.length === 0 && removed.length === 0) continue;

        // Phase 8-3 debounce: if we already fired a drift event for this
        // (connection, entity) within the last DEBOUNCE_HOURS, refresh
        // the snapshot but suppress the notification + event row. This
        // protects customers from notification spam on volatile schemas.
        try {
          const recent = await db.prepare(
            `SELECT detected_at FROM erp_schema_drift_events
              WHERE tenant_id = ? AND connection_id = ? AND entity_type = ?
                AND detected_at > datetime('now', ?)
              ORDER BY detected_at DESC LIMIT 1`
          ).bind(tenantId, p.connection_id, p.entity_type, `-${DEBOUNCE_HOURS} hours`).first<{ detected_at: string }>();
          if (recent) {
            await writeSnapshot(db, tenantId, p.connection_id, p.entity_type, current);
            continue;
          }
        } catch { /* if the lookup fails, fall through to fire the event */ }

        await persistDriftEvent(db, {
          tenantId, connectionId: p.connection_id, entityType: p.entity_type,
          added, removed, totalCurrent: current.length, totalPrevious: snap.fields.length,
        });
        driftCount++;

        // Refresh snapshot to the new baseline.
        await writeSnapshot(db, tenantId, p.connection_id, p.entity_type, current);
      } catch (err) {
        logError('erp.drift.pair_failed', err, { tenantId }, {
          connectionId: p.connection_id, entityType: p.entity_type,
        });
      }
    }
    if (driftCount > 0) {
      logInfo('erp.drift.detected', { tenantId, layer: 'erp', action: 'erp.drift' }, { checked, driftCount });
    }
  } catch (err) {
    logError('erp.drift.failed', err, { tenantId }, {});
  }
  return { checked, driftCount };
}
