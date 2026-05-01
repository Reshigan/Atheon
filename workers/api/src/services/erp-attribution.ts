/**
 * ERP Attribution — Phase 4 of dynamic ERP-mapping intelligence.
 *
 * Under the shared-savings revenue model, when Atheon claims $X recovered for
 * a customer, the customer needs to see WHICH ERP / subsystem each dollar
 * came from. A multi-ERP customer running SAP for finance + Odoo for ops +
 * a custom CSV for payroll will dispute a billed amount unless they can
 * trace it to the source.
 *
 * Attribution model — pragmatic v1:
 *   - Compute per-source-system **input volume**: how many records (across
 *     canonical ERP tables) the connection contributed to the period.
 *   - Compute per-source-system **input value**: sum of canonical
 *     `outstanding_balance` / `total` across those records.
 *   - Split the period's recovered total proportionally by input value (or
 *     input volume when no value is available).
 *
 * This is an approximation, not a per-record audit trail (Phase 5+ work),
 * but it's defensible: "your SAP records contributed 64 % of the input
 * volume that produced $500k recovered, so $320k is attributed to SAP".
 *
 * Per-connection attribution (the next finer grain) requires connection_id
 * on the canonical tables — added as a self-heal column in v60 so old
 * rows fall back to source_system-level attribution while new rows get
 * connection-level.
 */

export interface AttributionRow {
  /** Either a connection_id (preferred) or a source_system (fallback). */
  key: string;
  /** Human-readable label (connection name or "SAP"/"Odoo"/etc.). */
  label: string;
  /** What kind of key this is — drives whether the UI can deep-link to a connection. */
  kind: 'connection' | 'source_system';
  /** Number of canonical records sourced from this key. */
  inputRecords: number;
  /** Sum of outstanding_balance + invoice totals from this key (currency: tenant default). */
  inputValue: number;
  /** Share of the period's input value (0-1). */
  share: number;
  /** Recovered value attributed to this key (recoveredTotal * share). */
  recoveredValue: number;
}

const CANONICAL_TABLES = [
  { name: 'erp_invoices', valueColumn: 'total' },
  { name: 'erp_purchase_orders', valueColumn: 'total' },
  { name: 'erp_customers', valueColumn: 'outstanding_balance' },
  { name: 'erp_suppliers', valueColumn: 'outstanding_balance' },
] as const;

interface RawSourceVolume {
  connection_id: string | null;
  source_system: string;
  records: number;
  value: number;
}

/** Aggregate input volume + value from canonical ERP tables across all entity types.
 *  Groups by (connection_id, source_system). Falls back to source_system grouping
 *  when connection_id is null on the row (legacy data pre-v60). */
async function readSourceVolumes(db: D1Database, tenantId: string): Promise<RawSourceVolume[]> {
  const map = new Map<string, RawSourceVolume>();
  for (const tbl of CANONICAL_TABLES) {
    let rows: Array<{ connection_id: string | null; source_system: string | null; records: number; total: number }> = [];
    try {
      // Tolerate missing connection_id column (pre-v60 deploys) by falling back
      // to a source_system-only query.
      const res = await db.prepare(
        `SELECT connection_id, source_system,
                COUNT(*) as records,
                COALESCE(SUM(${tbl.valueColumn}), 0) as total
           FROM ${tbl.name}
          WHERE tenant_id = ?
          GROUP BY connection_id, source_system`
      ).bind(tenantId).all<{ connection_id: string | null; source_system: string | null; records: number; total: number }>();
      rows = res.results || [];
    } catch {
      try {
        const res = await db.prepare(
          `SELECT NULL as connection_id, source_system,
                  COUNT(*) as records,
                  COALESCE(SUM(${tbl.valueColumn}), 0) as total
             FROM ${tbl.name}
            WHERE tenant_id = ?
            GROUP BY source_system`
        ).bind(tenantId).all<{ connection_id: null; source_system: string | null; records: number; total: number }>();
        rows = res.results || [];
      } catch {
        rows = [];
      }
    }
    for (const r of rows) {
      const ss = r.source_system || 'unknown';
      const cid = r.connection_id;
      const key = cid ? `c:${cid}` : `s:${ss}`;
      const prev = map.get(key);
      if (prev) {
        prev.records += r.records || 0;
        prev.value += r.total || 0;
      } else {
        map.set(key, { connection_id: cid, source_system: ss, records: r.records || 0, value: r.total || 0 });
      }
    }
  }
  return [...map.values()];
}

/** Resolve connection labels for any rows that have a connection_id. Falls back
 *  to source_system label (e.g. "SAP") when the connection has been deleted. */
async function resolveLabels(
  db: D1Database, tenantId: string, raw: RawSourceVolume[],
): Promise<Map<string, string>> {
  const labels = new Map<string, string>();
  const connIds = raw.map((r) => r.connection_id).filter((x): x is string => !!x);
  if (connIds.length > 0) {
    const placeholders = connIds.map(() => '?').join(',');
    try {
      const res = await db.prepare(
        `SELECT id, name FROM erp_connections WHERE tenant_id = ? AND id IN (${placeholders})`
      ).bind(tenantId, ...connIds).all<{ id: string; name: string }>();
      for (const r of res.results || []) labels.set(r.id, r.name || r.id);
    } catch { /* non-fatal */ }
  }
  return labels;
}

/** Build the attribution rows from raw volumes + a recovered total to split. */
function buildAttribution(
  raw: ReadonlyArray<RawSourceVolume>,
  labels: Map<string, string>,
  recoveredTotal: number,
): AttributionRow[] {
  if (!raw.length) return [];
  const totalValue = raw.reduce((acc, r) => acc + r.value, 0);
  const totalRecords = raw.reduce((acc, r) => acc + r.records, 0);

  // If there's no value to weight on, fall back to record count.
  const useValue = totalValue > 0;
  const denom = useValue ? totalValue : totalRecords;

  return raw
    .map<AttributionRow>((r) => {
      const share = denom > 0 ? (useValue ? r.value : r.records) / denom : 0;
      return {
        key: r.connection_id ? `c:${r.connection_id}` : `s:${r.source_system}`,
        label: r.connection_id ? (labels.get(r.connection_id) || r.source_system) : r.source_system,
        kind: r.connection_id ? 'connection' : 'source_system',
        inputRecords: r.records,
        inputValue: r.value,
        share: Number(share.toFixed(4)),
        recoveredValue: Number((recoveredTotal * share).toFixed(2)),
      };
    })
    .sort((a, b) => b.recoveredValue - a.recoveredValue);
}

/** Public entry — compute attribution for a tenant given a recovered total
 *  (typically read from `roi_tracking.total_discrepancy_value_recovered`). */
export async function computeRoiAttribution(
  db: D1Database,
  tenantId: string,
  recoveredTotal: number,
): Promise<AttributionRow[]> {
  const raw = await readSourceVolumes(db, tenantId);
  const labels = await resolveLabels(db, tenantId, raw);
  return buildAttribution(raw, labels, recoveredTotal);
}
