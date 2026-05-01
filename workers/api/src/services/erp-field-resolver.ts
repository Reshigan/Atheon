/**
 * ERP Field Resolver — Phase 2 of dynamic ERP-mapping intelligence.
 *
 * The single point of truth for "what is the amount/ref/entity in this ERP
 * record". All 470 sub-catalysts, the assessment engine, and the report
 * engine consult this resolver — never raw column names — so a customer's
 * customisations (Z-fields, custom Odoo modules, NetSuite custom segments)
 * flow through identically to all three.
 *
 * Resolution order per canonical field:
 *   1. **Per-connection mapping** (erp_field_mappings, status='active') —
 *      the customer-confirmed or high-confidence auto-mapped source fields
 *      for this specific ERP/subsystem instance.
 *   2. **Static dictionary** (CANONICAL_FIELDS aliases) — the vanilla ERP
 *      defaults that work without any learning.
 *
 * Mappings are loaded once per (tenant, connection, entity) and cached in
 * KV with a 5-minute TTL so the hot extraction path doesn't query D1 on
 * every record. The cache key includes the connection so two ERPs in the
 * same tenant don't share mapped fields.
 *
 * Backward compat: when no connectionId is supplied (legacy call sites),
 * the resolver falls back to the union-of-all-aliases behaviour the static
 * extractAmount used to provide. This keeps the migration drop-in safe.
 */

import { CANONICAL_FIELDS, getActiveMappings, type CanonicalField } from './erp-auto-mapper';

const CACHE_TTL_SECONDS = 300; // 5 minutes — short enough that human edits propagate fast

/** Per-record context: which connection sourced this record. */
export interface RecordContext {
  tenantId: string;
  connectionId: string;
  entityType: string;
}

/** Lazy-loaded resolved mapping for one (tenant, connection, entity). */
interface ResolvedMappings {
  /** Ordered list of source fields to try for each canonical field, mappings first then dictionary. */
  fields: Record<string, string[]>;
  loadedAt: number;
}

const inProcessCache = new Map<string, ResolvedMappings>();

function cacheKey(ctx: RecordContext): string {
  return `${ctx.tenantId}|${ctx.connectionId}|${ctx.entityType}`;
}

/** Build the field list for a canonical field: mappings (if any) prepended to
 *  the static aliases, deduped while preserving order. */
function mergeFields(mapped: string[] | undefined, canonical: CanonicalField): string[] {
  const aliases = CANONICAL_FIELDS[canonical].aliases;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const f of [...(mapped || []), ...aliases]) {
    if (!seen.has(f)) { seen.add(f); out.push(f); }
  }
  return out;
}

/** Load resolved mappings for a (tenant, connection, entity), with KV cache.
 *  Caller may pass `kv` to enable cross-isolate caching; without it, only the
 *  in-process LRU is used. Best-effort: any DB or KV error falls back to the
 *  static dictionary. */
export async function loadResolvedMappings(
  db: D1Database,
  ctx: RecordContext,
  kv?: KVNamespace,
): Promise<ResolvedMappings> {
  const key = cacheKey(ctx);
  const inProc = inProcessCache.get(key);
  if (inProc && Date.now() - inProc.loadedAt < CACHE_TTL_SECONDS * 1000) {
    return inProc;
  }

  // KV cache lookup
  if (kv) {
    try {
      const cached = await kv.get(`erp-mapping:${key}`, 'json') as ResolvedMappings | null;
      if (cached && cached.fields) {
        inProcessCache.set(key, cached);
        return cached;
      }
    } catch { /* non-fatal */ }
  }

  // D1 lookup — read active mappings, build resolved field list per canonical
  let mapped: Record<string, string[]> = {};
  try {
    mapped = await getActiveMappings(db, ctx.tenantId, ctx.connectionId, ctx.entityType);
  } catch {
    // No mappings or DB error — fall through to static dictionary only
    mapped = {};
  }

  const fields: Record<string, string[]> = {};
  for (const canonical of Object.keys(CANONICAL_FIELDS) as CanonicalField[]) {
    fields[canonical] = mergeFields(mapped[canonical], canonical);
  }

  const resolved: ResolvedMappings = { fields, loadedAt: Date.now() };
  inProcessCache.set(key, resolved);
  if (kv) {
    try {
      await kv.put(`erp-mapping:${key}`, JSON.stringify(resolved), { expirationTtl: CACHE_TTL_SECONDS });
    } catch { /* non-fatal */ }
  }
  return resolved;
}

/** Invalidate the cache for a (tenant, connection, entity) — call after a
 *  human edits a mapping or a fresh auto-map run shifts the active set. */
export async function invalidateMappingCache(
  ctx: RecordContext,
  kv?: KVNamespace,
): Promise<void> {
  const key = cacheKey(ctx);
  inProcessCache.delete(key);
  if (kv) {
    try { await kv.delete(`erp-mapping:${key}`); } catch { /* non-fatal */ }
  }
}

// ── Pure extractors ──
// These take an explicit field list (built by loadResolvedMappings) so the
// hot path never re-queries D1 per record. The legacy static-only path is
// a special case where the caller passes the union of CANONICAL_FIELDS aliases.

/** Extract the financial amount from a record using the supplied field list.
 *  Returns the absolute value (sub-catalysts treat positive and negative
 *  amounts symmetrically for matched/unmatched totals). */
export function extractAmountWith(rec: Record<string, unknown> | null | undefined, fieldList: string[]): number {
  if (!rec) return 0;
  for (const f of fieldList) {
    const v = rec[f];
    if (v !== undefined && v !== null && v !== '') {
      const num = parseFloat(String(v));
      if (!isNaN(num)) return Math.abs(num);
    }
  }
  return 0;
}

/** Extract the reference / document number using the supplied field list. */
export function extractRefWith(rec: Record<string, unknown> | null | undefined, fieldList: string[]): string {
  if (!rec) return '';
  for (const f of fieldList) {
    const v = rec[f];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

/** Extract the entity name (vendor/customer/partner) using the supplied field list. */
export function extractEntityWith(rec: Record<string, unknown> | null | undefined, fieldList: string[]): string {
  if (!rec) return '';
  for (const f of fieldList) {
    const v = rec[f];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

/** Extract any canonical field — generic helper for currency, date, status, company. */
export function extractFieldWith(rec: Record<string, unknown> | null | undefined, fieldList: string[]): string {
  return extractRefWith(rec, fieldList);
}

// ── Convenience: the static-only fallback used when no connectionId is known ──
// This preserves the pre-Phase-2 behaviour for callers that don't yet have
// per-connection context (legacy paths, ad-hoc reports). All static aliases
// for the canonical field are tried in order.

const STATIC_AMOUNT_FIELDS = CANONICAL_FIELDS.amount.aliases;
const STATIC_REF_FIELDS = CANONICAL_FIELDS.ref.aliases;
const STATIC_ENTITY_FIELDS = CANONICAL_FIELDS.entity.aliases;

export function extractAmountStatic(rec: Record<string, unknown> | null | undefined): number {
  return extractAmountWith(rec, STATIC_AMOUNT_FIELDS);
}
export function extractRefStatic(rec: Record<string, unknown> | null | undefined): string {
  return extractRefWith(rec, STATIC_REF_FIELDS);
}
export function extractEntityStatic(rec: Record<string, unknown> | null | undefined): string {
  return extractEntityWith(rec, STATIC_ENTITY_FIELDS);
}

// ── Async resolver: load mappings + extract in one call ──
// Use this from sub-catalyst handlers, the assessment engine, and the report
// engine — anywhere the full per-connection mapping must apply.

export async function extractAmountFor(
  db: D1Database,
  ctx: RecordContext,
  rec: Record<string, unknown> | null | undefined,
  kv?: KVNamespace,
): Promise<number> {
  const resolved = await loadResolvedMappings(db, ctx, kv);
  return extractAmountWith(rec, resolved.fields.amount || STATIC_AMOUNT_FIELDS);
}

export async function extractRefFor(
  db: D1Database,
  ctx: RecordContext,
  rec: Record<string, unknown> | null | undefined,
  kv?: KVNamespace,
): Promise<string> {
  const resolved = await loadResolvedMappings(db, ctx, kv);
  return extractRefWith(rec, resolved.fields.ref || STATIC_REF_FIELDS);
}

export async function extractEntityFor(
  db: D1Database,
  ctx: RecordContext,
  rec: Record<string, unknown> | null | undefined,
  kv?: KVNamespace,
): Promise<string> {
  const resolved = await loadResolvedMappings(db, ctx, kv);
  return extractEntityWith(rec, resolved.fields.entity || STATIC_ENTITY_FIELDS);
}
