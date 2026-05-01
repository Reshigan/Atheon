/**
 * ERP Auto-Mapper — Phase 2 of dynamic ERP-mapping intelligence.
 *
 * Given a connection's discovered schema (Phase 1's profiles), suggest
 * field mappings from canonical fields (`amount`, `ref`, `entity`,
 * `currency`, `date`, …) to the actual source field names the connection
 * uses. Persist suggestions in `erp_field_mappings` with a confidence
 * score; high-confidence (>= AUTO_APPLY_CONFIDENCE) mappings auto-apply,
 * lower-confidence ones land in a review queue (Phase 3 UI).
 *
 * Matching strategy (rule-based + fuzzy, no LLM yet — Phase 3 adds that):
 *   1. **Exact match**: source field matches a known alias verbatim
 *      (e.g. `WRBTR` ↔ `amount`). Confidence 1.0.
 *   2. **Case/underscore-insensitive match**: `amount_total` ↔ `amount`.
 *      Confidence 0.95.
 *   3. **Substring match**: `total_amount_excl_vat` matches `amount` because
 *      it contains it. Confidence 0.75 minus length penalty.
 *   4. **Fuzzy match**: Damerau-Levenshtein within edit distance ≤ 2.
 *      Confidence based on similarity.
 *   5. **Type signal**: if the canonical field is numeric (amount, value),
 *      penalise non-numeric source fields heavily.
 *
 * AUTO_APPLY_CONFIDENCE (default 0.85) is the threshold — anything below
 * is suggested but not active until confirmed.
 *
 * The resolver (extractAmount/extractRef/extractEntity) consults the
 * persisted mappings before falling back to the static dictionary, so all
 * 470 sub-catalysts + assessment + report endpoints become customisation-
 * aware in one swing.
 */

import { logError } from './logger';

export type CanonicalField = 'amount' | 'ref' | 'entity' | 'currency' | 'date' | 'status' | 'company';
export type LearnedFrom = 'auto' | 'human' | 'rule';

export interface CanonicalDefinition {
  field: CanonicalField;
  /** Domain: financial values, identifiers, names, etc. — drives type-aware penalties */
  domain: 'numeric' | 'string' | 'date' | 'currency';
  /** Known source aliases across vanilla ERPs. Order is irrelevant. */
  aliases: string[];
  /** Substrings that strongly indicate this canonical field. Used in fuzzy + substring matching. */
  hints: string[];
}

/**
 * Catalogue of canonical fields. Aliases are the union of known field names
 * across vanilla ERPs; the auto-mapper extends this set per-tenant via the
 * persisted `erp_field_mappings` table once it learns customisations.
 */
export const CANONICAL_FIELDS: Record<CanonicalField, CanonicalDefinition> = {
  amount: {
    field: 'amount',
    domain: 'numeric',
    aliases: [
      'WRBTR', 'DMBTR', 'NETWR', 'KWBTR', 'NETPR', 'ITEM_NETWR',           // SAP
      'amount_total', 'amount_untaxed', 'amount_residual', 'price_subtotal', // Odoo
      'total', 'amount', 'Total', 'Amount', 'TotalAmt', 'SubTotal',         // Xero/QB
      'balance', 'Balance', 'value', 'Value',                               // generic
    ],
    hints: ['amount', 'total', 'value', 'price', 'balance', 'netwr', 'wrbtr'],
  },
  ref: {
    field: 'ref',
    domain: 'string',
    aliases: [
      'BELNR', 'EBELN', 'VBELN', 'XBLNR', 'AUGBL',                         // SAP
      'invoice_number', 'po_number', 'number', 'name', 'ref', 'reference',  // Odoo/generic
      'InvoiceNumber', 'PurchaseOrderNumber', 'Id', 'id',                  // Xero/QB
    ],
    hints: ['number', 'ref', 'reference', 'id', 'belnr', 'ebeln', 'vbeln', 'doc_num'],
  },
  entity: {
    field: 'entity',
    domain: 'string',
    aliases: [
      'LIFNR', 'KUNNR', 'KUNAG', 'NAME1',                                   // SAP
      'customer_name', 'supplier_name', 'partner_name', 'name',             // Odoo/generic
      'ContactName', 'Name', 'DisplayName',                                 // Xero/QB
    ],
    hints: ['name', 'partner', 'customer', 'supplier', 'vendor', 'contact', 'account_name', 'lifnr', 'kunnr'],
  },
  currency: {
    field: 'currency',
    domain: 'currency',
    aliases: [
      'WAERS', 'HWAER', 'currency_id', 'currency', 'Currency', 'CurrencyCode', 'CurrencyRef',
    ],
    hints: ['currency', 'curr', 'waers', 'iso_code'],
  },
  date: {
    field: 'date',
    domain: 'date',
    aliases: [
      'BUDAT', 'BLDAT', 'AEDAT', 'DOC_DATE', 'POSTING_DATE',               // SAP
      'date', 'invoice_date', 'date_invoice', 'date_order', 'created_at',  // Odoo/generic
      'Date', 'DueDate', 'IssueDate', 'TxnDate',                            // Xero/QB
    ],
    hints: ['date', 'budat', 'bldat', 'posted', 'created', 'issued'],
  },
  status: {
    field: 'status',
    domain: 'string',
    aliases: [
      'GBSTK', 'AUGRU', 'state', 'status', 'Status', 'invoice_state', 'doc_status',
    ],
    hints: ['state', 'status', 'gbstk', 'is_paid', 'is_open'],
  },
  company: {
    field: 'company',
    domain: 'string',
    aliases: [
      'BUKRS', 'company_id', 'CompanyId', 'TenantId', 'OrganisationId', 'company_code',
    ],
    hints: ['company', 'tenant', 'organisation', 'bukrs', 'org_id'],
  },
};

/** Threshold above which an auto-mapping is treated as active (resolver uses it
 *  without human confirmation). Below this: persisted as suggestion only. */
export const AUTO_APPLY_CONFIDENCE = 0.85;

/** Default confidence for human-confirmed mappings — always trumps auto. */
export const HUMAN_CONFIDENCE = 1.0;

// ── String similarity helpers ──

function normalise(s: string): string {
  return s.toLowerCase().replace(/[_\s-]+/g, '');
}

/** Damerau-Levenshtein distance, capped to maxDist for efficiency on long strings */
function damerauLevenshtein(a: string, b: string, maxDist = 4): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  const prev2: number[] = new Array(n + 1).fill(0);
  const prev: number[] = new Array(n + 1).fill(0);
  const cur: number[] = new Array(n + 1).fill(0);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(
        cur[j - 1] + 1,        // insert
        prev[j] + 1,           // delete
        prev[j - 1] + cost,    // substitute
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        cur[j] = Math.min(cur[j], prev2[j - 2] + 1); // transposition
      }
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > maxDist) return maxDist + 1;
    for (let j = 0; j <= n; j++) { prev2[j] = prev[j]; prev[j] = cur[j]; }
  }
  return prev[n];
}

/** Similarity in [0, 1] — 1 means identical, 0 means nothing in common. */
function similarity(a: string, b: string): number {
  if (!a && !b) return 1;
  if (!a || !b) return 0;
  const dist = damerauLevenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return Math.max(0, 1 - dist / maxLen);
}

// ── Suggestion engine ──

export interface FieldCandidate {
  source_field: string;
  inferred_type: string;
  /** Optional: whether this field was always non-empty in the sample */
  null_rate: number;
}

export interface MappingSuggestion {
  canonical_field: CanonicalField;
  source_field: string;
  confidence: number;
  rationale: string;
  learned_from: LearnedFrom;
}

/** Pick the best source-field match for one canonical field */
export function suggestForCanonical(
  canonical: CanonicalDefinition,
  candidates: ReadonlyArray<FieldCandidate>,
): MappingSuggestion | null {
  if (!candidates.length) return null;
  const aliasSet = new Set(canonical.aliases);
  const aliasNormSet = new Set(canonical.aliases.map(normalise));

  let best: MappingSuggestion | null = null;

  for (const c of candidates) {
    // Reject obviously wrong types early — a numeric canonical field shouldn't
    // map to a boolean or array source.
    if (canonical.domain === 'numeric' && (c.inferred_type === 'boolean' || c.inferred_type === 'array' || c.inferred_type === 'object')) {
      continue;
    }
    if (canonical.domain === 'date' && c.inferred_type === 'boolean') continue;

    const src = c.source_field;
    const srcN = normalise(src);
    let confidence = 0;
    let rationale = '';
    let from: LearnedFrom = 'rule';

    if (aliasSet.has(src)) {
      confidence = 1.0; rationale = 'exact alias match';
    } else if (aliasNormSet.has(srcN)) {
      confidence = 0.95; rationale = 'normalised alias match';
    } else {
      // Hint substring or fuzzy match
      const hintHit = canonical.hints.find((h) => srcN.includes(normalise(h)));
      if (hintHit) {
        // Substring confidence drops with how much extra noise there is
        const ratio = normalise(hintHit).length / Math.max(srcN.length, 1);
        confidence = 0.6 + 0.3 * ratio;
        rationale = `contains hint "${hintHit}"`;
        from = 'auto';
      } else {
        // Fuzzy: best similarity against any alias
        let bestSim = 0; let bestAlias = '';
        for (const a of canonical.aliases) {
          const s = similarity(srcN, normalise(a));
          if (s > bestSim) { bestSim = s; bestAlias = a; }
        }
        if (bestSim >= 0.7) {
          confidence = bestSim * 0.9; // cap fuzzy at 0.9
          rationale = `fuzzy match to "${bestAlias}" (sim=${bestSim.toFixed(2)})`;
          from = 'auto';
        }
      }
    }

    // Type-aware bonus / penalty
    if (canonical.domain === 'numeric' && c.inferred_type === 'number') {
      confidence = Math.min(1, confidence + 0.05);
    } else if (canonical.domain === 'numeric' && c.inferred_type === 'string') {
      // Many ERPs deliver numbers as strings ("1234.56") — only mild penalty
      confidence = Math.max(0, confidence - 0.02);
    }

    // Penalise fields that are mostly null
    if (c.null_rate > 0.8) confidence = Math.max(0, confidence - 0.15);

    if (confidence > 0 && (!best || confidence > best.confidence)) {
      best = {
        canonical_field: canonical.field,
        source_field: src,
        confidence: Number(confidence.toFixed(3)),
        rationale,
        learned_from: from,
      };
    }
  }
  return best;
}

/** Suggest mappings for every canonical field given a list of candidate source fields. */
export function suggestMappings(candidates: ReadonlyArray<FieldCandidate>): MappingSuggestion[] {
  const out: MappingSuggestion[] = [];
  for (const def of Object.values(CANONICAL_FIELDS)) {
    const s = suggestForCanonical(def, candidates);
    if (s) out.push(s);
  }
  return out;
}

// ── Persistence ──

export interface PersistResult {
  inserted: number;
  updated: number;
  autoApplied: number;
  suggested: number;
}

export interface PersistedMapping {
  canonical_field: string;
  source_field: string;
  confidence: number;
  learned_from: string;
  rationale: string | null;
  status: string;
}

/** Persist suggestions into erp_field_mappings (UPSERT). High-confidence
 *  mappings are marked status='active' (auto-applied); others 'suggested'. */
export async function persistSuggestions(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  entityType: string,
  suggestions: ReadonlyArray<MappingSuggestion>,
): Promise<PersistResult> {
  const result: PersistResult = { inserted: 0, updated: 0, autoApplied: 0, suggested: 0 };
  for (const s of suggestions) {
    const status = s.confidence >= AUTO_APPLY_CONFIDENCE ? 'active' : 'suggested';
    if (status === 'active') result.autoApplied++;
    else result.suggested++;

    try {
      // UPSERT — never overwrite a human-confirmed mapping with a lower-
      // confidence auto suggestion. We do this by guarding on learned_from
      // in the conflict update.
      await db.prepare(
        `INSERT INTO erp_field_mappings (
           id, tenant_id, connection_id, entity_type, canonical_field,
           source_field, confidence, learned_from, rationale, status
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(tenant_id, connection_id, entity_type, canonical_field, source_field)
         DO UPDATE SET
           confidence = CASE WHEN erp_field_mappings.learned_from = 'human'
                             THEN erp_field_mappings.confidence
                             ELSE excluded.confidence END,
           rationale = CASE WHEN erp_field_mappings.learned_from = 'human'
                            THEN erp_field_mappings.rationale
                            ELSE excluded.rationale END,
           status = CASE WHEN erp_field_mappings.learned_from = 'human'
                         THEN erp_field_mappings.status
                         ELSE excluded.status END,
           updated_at = datetime('now')`
      ).bind(
        crypto.randomUUID(), tenantId, connectionId, entityType, s.canonical_field,
        s.source_field, s.confidence, s.learned_from, s.rationale, status,
      ).run();
      result.inserted++;
    } catch (err) {
      logError('erp.mapping.persist_failed', err, { tenantId }, {
        connectionId, entityType, canonical: s.canonical_field, source: s.source_field,
      });
    }
  }
  return result;
}

/** Get active mappings for a (tenant, connection, entity), keyed by canonical field.
 *  Returns the BEST (highest confidence) source field per canonical when multiple
 *  active rows exist (e.g. WRBTR vs DMBTR for amount — pick the one with higher
 *  confidence, typically non-null and human-confirmed). */
export async function getActiveMappings(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  entityType: string,
): Promise<Record<string, string[]>> {
  const res = await db.prepare(
    `SELECT canonical_field, source_field, confidence, learned_from
       FROM erp_field_mappings
      WHERE tenant_id = ? AND connection_id = ? AND entity_type = ? AND status = 'active'
   ORDER BY canonical_field ASC,
            CASE learned_from WHEN 'human' THEN 0 WHEN 'rule' THEN 1 ELSE 2 END ASC,
            confidence DESC`
  ).bind(tenantId, connectionId, entityType).all<{
    canonical_field: string;
    source_field: string;
    confidence: number;
    learned_from: string;
  }>();

  const out: Record<string, string[]> = {};
  for (const row of res.results || []) {
    if (!out[row.canonical_field]) out[row.canonical_field] = [];
    out[row.canonical_field].push(row.source_field);
  }
  return out;
}

/** List all mappings for a connection (active + suggested), for the review UI. */
export async function listAllMappings(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  entityType?: string,
): Promise<PersistedMapping[]> {
  const sql = entityType
    ? `SELECT canonical_field, source_field, confidence, learned_from, rationale, status
         FROM erp_field_mappings
        WHERE tenant_id = ? AND connection_id = ? AND entity_type = ?
     ORDER BY entity_type ASC, canonical_field ASC, confidence DESC`
    : `SELECT canonical_field, source_field, confidence, learned_from, rationale, status
         FROM erp_field_mappings
        WHERE tenant_id = ? AND connection_id = ?
     ORDER BY canonical_field ASC, confidence DESC`;
  const stmt = entityType
    ? db.prepare(sql).bind(tenantId, connectionId, entityType)
    : db.prepare(sql).bind(tenantId, connectionId);
  const res = await stmt.all<PersistedMapping>();
  return res.results || [];
}

/** Run the auto-mapper for a (tenant, connection, entity): read discovered
 *  schema, suggest mappings, persist. Idempotent — repeated calls refresh
 *  the mappings without overwriting human-confirmed rows. */
export async function runAutoMapper(
  db: D1Database,
  tenantId: string,
  connectionId: string,
  entityType: string,
): Promise<PersistResult & { suggestions: MappingSuggestion[] }> {
  const candidates = await db.prepare(
    `SELECT source_field, inferred_type, null_rate
       FROM erp_connection_schemas
      WHERE tenant_id = ? AND connection_id = ? AND entity_type = ?`
  ).bind(tenantId, connectionId, entityType).all<{
    source_field: string;
    inferred_type: string;
    null_rate: number;
  }>();

  const suggestions = suggestMappings(candidates.results || []);
  const persisted = await persistSuggestions(db, tenantId, connectionId, entityType, suggestions);
  return { ...persisted, suggestions };
}
