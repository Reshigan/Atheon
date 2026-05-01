/**
 * ERP Schema Profiler — Phase 1 of dynamic ERP-mapping intelligence.
 *
 * On every sync, profile the actual fields each ERP/subsystem sends. Persist:
 *   - field name as it appears in the source
 *   - inferred type
 *   - up to 5 sample values (PII-redacted)
 *   - null rate over the sample
 *   - first/last seen timestamps + occurrence count
 *
 * Phase 2 will use these profiles to drive the auto-mapper. Phase 3 will detect
 * schema drift by comparing fresh profiles to the persisted ones.
 *
 * Design constraints:
 *   - Idempotent — repeated calls upsert, do not duplicate.
 *   - Cheap — bounded sample size (default 200 records) so a 50k-record sync
 *     does ~200 inserts/updates per entity, not 50k.
 *   - PII-aware — sample values are truncated to 64 chars and obvious secrets
 *     (long base64, JWT-shaped strings) are masked before persistence.
 *   - Never throws — profiling is best-effort. A profiler error must not abort
 *     the surrounding ingestion path.
 */

import { logError } from './logger';

export type FieldType = 'string' | 'number' | 'boolean' | 'null' | 'object' | 'array' | 'mixed';

interface FieldProfile {
  field: string;
  type: FieldType;
  occurrences: number;
  nulls: number;
  samples: string[];
}

const SAMPLE_LIMIT = 200;
const SAMPLES_PER_FIELD = 5;
const SAMPLE_VALUE_MAX_LEN = 64;

/** Detect the inferred type of a single value */
function inferType(v: unknown): FieldType {
  if (v === null || v === undefined) return 'null';
  if (Array.isArray(v)) return 'array';
  const t = typeof v;
  if (t === 'string' || t === 'number' || t === 'boolean') return t;
  if (t === 'object') return 'object';
  return 'mixed';
}

/** Best-effort masking of obvious secrets that may have leaked into ERP records */
function maskSensitive(s: string): string {
  // JWT-shaped: three base64url segments separated by dots. Real JWT headers
  // can be as short as 12 chars after base64-encoding ({"alg":"HS256"}), so we
  // accept 10+ chars per segment to catch them while still requiring all three.
  if (/^[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/.test(s)) return '***jwt***';
  // long contiguous base64/token-shaped string (likely a secret).
  if (s.length >= 40 && /^[A-Za-z0-9+/=_-]+$/.test(s)) return '***token***';
  return s;
}

/** Stringify a sample value for storage — bounded length, redact obvious secrets */
function sampleValue(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'object') {
    try { s = JSON.stringify(v); } catch { s = String(v); }
  } else {
    s = String(v);
  }
  s = maskSensitive(s);
  if (s.length > SAMPLE_VALUE_MAX_LEN) s = s.slice(0, SAMPLE_VALUE_MAX_LEN) + '…';
  return s;
}

/** Combine prior + new types — keeps 'mixed' once seen, otherwise narrows to the
 *  most specific. Used when the same field appears with different types across
 *  records (e.g. some Odoo fields return false instead of an empty string). */
function mergeType(prior: FieldType | undefined, next: FieldType): FieldType {
  if (prior === undefined) return next;
  if (prior === next) return prior;
  // null + concrete = concrete (nulls are absences, not the type)
  if (prior === 'null') return next;
  if (next === 'null') return prior;
  return 'mixed';
}

/** Build per-field profile from a sample of records. */
export function profileRecords(records: ReadonlyArray<Record<string, unknown>>): FieldProfile[] {
  const sample = records.length > SAMPLE_LIMIT ? records.slice(0, SAMPLE_LIMIT) : records;
  const profiles = new Map<string, FieldProfile>();

  for (const rec of sample) {
    if (!rec || typeof rec !== 'object') continue;
    for (const [field, raw] of Object.entries(rec)) {
      // Skip Atheon-internal markers if any leaked in
      if (field.startsWith('__')) continue;

      let p = profiles.get(field);
      if (!p) {
        p = { field, type: 'null', occurrences: 0, nulls: 0, samples: [] };
        profiles.set(field, p);
      }
      p.occurrences++;
      const inferred = inferType(raw);
      if (inferred === 'null' || raw === '') {
        p.nulls++;
      } else if (p.samples.length < SAMPLES_PER_FIELD) {
        const sv = sampleValue(raw);
        if (sv && !p.samples.includes(sv)) p.samples.push(sv);
      }
      p.type = mergeType(p.type === 'null' ? undefined : p.type, inferred);
    }
  }
  return [...profiles.values()];
}

/**
 * Profile a batch of synced records and persist (UPSERT) into erp_connection_schemas.
 *
 * Best-effort: errors are logged but never rethrown — the calling ingestion
 * path must not fail because profiling failed.
 */
export async function profileEntityRecords(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  sourceSystem: string,
  entityType: string,
  records: ReadonlyArray<Record<string, unknown>>,
): Promise<{ profiled: number; persisted: number }> {
  if (!records.length) return { profiled: 0, persisted: 0 };
  let persisted = 0;
  try {
    const profiles = profileRecords(records);
    if (!profiles.length) return { profiled: 0, persisted: 0 };

    // Sample size used for null_rate calculation
    const sampleSize = Math.min(records.length, SAMPLE_LIMIT);

    for (const p of profiles) {
      const nullRate = p.occurrences > 0 ? p.nulls / p.occurrences : 0;
      const samplesJson = JSON.stringify(p.samples);

      // UPSERT — keyed by (tenant_id, connection_id, entity_type, source_field).
      // On conflict: bump occurrences (cumulative), refresh samples + type +
      // null_rate to the latest observation, update last_seen_at.
      try {
        await db.prepare(
          `INSERT INTO erp_connection_schemas (
             id, tenant_id, connection_id, source_system, entity_type,
             source_field, inferred_type, sample_values, null_rate,
             occurrences, sample_size, first_seen_at, last_seen_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
           ON CONFLICT(tenant_id, connection_id, entity_type, source_field)
           DO UPDATE SET
             inferred_type = excluded.inferred_type,
             sample_values = excluded.sample_values,
             null_rate = excluded.null_rate,
             occurrences = erp_connection_schemas.occurrences + excluded.occurrences,
             sample_size = excluded.sample_size,
             source_system = excluded.source_system,
             last_seen_at = datetime('now')`
        ).bind(
          crypto.randomUUID(),
          tenantId,
          connectionId,
          sourceSystem,
          entityType,
          p.field,
          p.type,
          samplesJson,
          nullRate,
          p.occurrences,
          sampleSize,
        ).run();
        persisted++;
      } catch (err) {
        // Single-field failure should not abort the whole profile run
        logError('erp.schema.profile.field_persist_failed', err, { tenantId }, {
          connectionId, entityType, field: p.field,
        });
      }
    }
    return { profiled: profiles.length, persisted };
  } catch (err) {
    logError('erp.schema.profile.failed', err, { tenantId }, {
      connectionId, entityType, recordCount: records.length,
    });
    return { profiled: 0, persisted };
  }
}

/** Read the discovered schema for a connection, optionally filtered to one entity type. */
export async function getDiscoveredSchemas(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  entityType?: string,
): Promise<Array<{
  entity_type: string;
  source_field: string;
  inferred_type: string;
  sample_values: string[];
  null_rate: number;
  occurrences: number;
  sample_size: number;
  source_system: string;
  first_seen_at: string;
  last_seen_at: string;
}>> {
  const sql = entityType
    ? `SELECT entity_type, source_field, inferred_type, sample_values, null_rate,
              occurrences, sample_size, source_system, first_seen_at, last_seen_at
         FROM erp_connection_schemas
         WHERE tenant_id = ? AND connection_id = ? AND entity_type = ?
         ORDER BY entity_type ASC, source_field ASC`
    : `SELECT entity_type, source_field, inferred_type, sample_values, null_rate,
              occurrences, sample_size, source_system, first_seen_at, last_seen_at
         FROM erp_connection_schemas
         WHERE tenant_id = ? AND connection_id = ?
         ORDER BY entity_type ASC, source_field ASC`;
  const stmt = entityType
    ? db.prepare(sql).bind(tenantId, connectionId, entityType)
    : db.prepare(sql).bind(tenantId, connectionId);

  const res = await stmt.all<{
    entity_type: string;
    source_field: string;
    inferred_type: string;
    sample_values: string;
    null_rate: number;
    occurrences: number;
    sample_size: number;
    source_system: string;
    first_seen_at: string;
    last_seen_at: string;
  }>();

  return (res.results || []).map((r) => ({
    ...r,
    sample_values: parseSamples(r.sample_values),
  }));
}

function parseSamples(s: string | null | undefined): string[] {
  if (!s) return [];
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}
