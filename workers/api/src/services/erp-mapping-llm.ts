/**
 * ERP Mapping LLM Fallback — Phase 3 of dynamic ERP-mapping intelligence.
 *
 * For source fields the rule-based + fuzzy matcher could not place with
 * confidence (e.g. heavily customised SAP Z-fields like `ZZ_INVOICE_NETPRICE`,
 * obscure subsystem outputs, non-English column names), call an LLM with the
 * field name + a few sample values and let it suggest the best canonical
 * mapping with rationale.
 *
 * Cost guardrails:
 *   - Only invoked for fields without an existing active or suggested mapping.
 *   - Suggestions cached in KV per (tenant, connection, entity, field) for 7
 *     days — re-runs only on schema drift (the field's sample values change).
 *   - Hard cap on number of fields per invocation (default 20) so a sync of
 *     a brand-new connection with 200 unknown fields doesn't burn $$.
 *   - Falls back to Workers AI if the configured provider is unavailable.
 *
 * The LLM output is treated as a *suggestion*, not auto-applied: confidence
 * is capped at AUTO_APPLY_CONFIDENCE - 0.05 so it always lands in the review
 * queue. Customers must confirm before billing artefacts trust an LLM
 * suggestion (shared-savings audit defensibility).
 */

import { llmChatWithFallback, loadLlmConfig } from './llm-provider';
import {
  CANONICAL_FIELDS,
  AUTO_APPLY_CONFIDENCE,
  type CanonicalField,
  type MappingSuggestion,
} from './erp-auto-mapper';
import { logError, logInfo } from './logger';

const LLM_CACHE_TTL_SECONDS = 7 * 24 * 60 * 60; // 7 days
const MAX_FIELDS_PER_RUN = 20;
const LLM_SUGGESTION_CONFIDENCE = Math.max(0.5, AUTO_APPLY_CONFIDENCE - 0.05);

interface UnmappedField {
  source_field: string;
  inferred_type: string;
  sample_values: string[];
  null_rate: number;
}

interface LlmSuggestion {
  source_field: string;
  canonical_field: CanonicalField | 'unknown';
  rationale: string;
}

const CANONICAL_DESCRIPTIONS: Record<CanonicalField, string> = {
  amount: 'a financial amount (invoice total, line value, balance due)',
  ref: 'a document reference number (invoice number, PO number, journal ID)',
  entity: 'the name of a business entity (vendor, customer, supplier, partner)',
  currency: 'a currency code (ISO 4217: ZAR, USD, EUR)',
  date: 'a date (posting date, invoice date, document date)',
  status: 'a document status (open, paid, cancelled, posted)',
  company: 'a company / organisation / business-unit identifier',
};

function buildPrompt(fields: ReadonlyArray<UnmappedField>, entityType: string, sourceSystem: string): string {
  const canonicalList = (Object.entries(CANONICAL_DESCRIPTIONS) as Array<[CanonicalField, string]>)
    .map(([k, v]) => `  - ${k}: ${v}`)
    .join('\n');
  const fieldList = fields
    .map((f) => {
      const samples = (f.sample_values || []).slice(0, 3).map((s) => JSON.stringify(s)).join(', ');
      const nullPct = Math.round((f.null_rate || 0) * 100);
      return `  - ${f.source_field} (type: ${f.inferred_type}, null: ${nullPct}%, samples: [${samples}])`;
    })
    .join('\n');

  return `You are an ERP integration expert mapping unfamiliar source fields from ${sourceSystem} (${entityType} entity) to Atheon's canonical model.

Canonical fields you may map to:
${canonicalList}

Source fields needing classification:
${fieldList}

For each source field, decide which canonical field (or "unknown" if none fits) it represents based on field name, inferred type, and sample values. Respond ONLY with a JSON array, one object per field, no commentary:

[{"source_field": "...", "canonical_field": "amount|ref|entity|currency|date|status|company|unknown", "rationale": "short reason citing the evidence"}]`;
}

function safeJsonExtract(text: string): unknown {
  // LLMs occasionally wrap JSON in fences or chatter; strip code fences and
  // look for the first array-shaped substring.
  const stripped = text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const start = stripped.indexOf('[');
  const end = stripped.lastIndexOf(']');
  if (start === -1 || end === -1 || end <= start) return null;
  try { return JSON.parse(stripped.slice(start, end + 1)); } catch { return null; }
}

function sanitiseSuggestions(parsed: unknown): LlmSuggestion[] {
  if (!Array.isArray(parsed)) return [];
  const out: LlmSuggestion[] = [];
  const validCanonicals = new Set([...Object.keys(CANONICAL_FIELDS), 'unknown']);
  for (const raw of parsed) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;
    const sf = typeof r.source_field === 'string' ? r.source_field : null;
    const cf = typeof r.canonical_field === 'string' ? r.canonical_field : null;
    const ra = typeof r.rationale === 'string' ? r.rationale : '';
    if (!sf || !cf || !validCanonicals.has(cf)) continue;
    out.push({ source_field: sf, canonical_field: cf as CanonicalField | 'unknown', rationale: ra.slice(0, 240) });
  }
  return out;
}

/** Build per-field cache key — tied to the sample values so a schema drift
 *  invalidates the cache automatically. */
function fieldCacheKey(
  tenantId: string, connectionId: string, entityType: string, field: UnmappedField,
): string {
  // Hash sample values to keep keys short
  const sampleSig = (field.sample_values || []).slice(0, 3).join('|');
  return `erp-mapping-llm:${tenantId}:${connectionId}:${entityType}:${field.source_field}:${sampleSig.length}-${sampleSig.slice(0, 30)}`;
}

/**
 * Suggest canonical mappings for fields the rule-based mapper couldn't place.
 *
 * Returns: list of MappingSuggestions ready to feed into persistSuggestions.
 *          All suggestions are capped at LLM_SUGGESTION_CONFIDENCE so they
 *          always land in the human-review queue (status='suggested') —
 *          billing artefacts never trust LLM output without confirmation.
 *
 * Best-effort: any LLM error returns an empty list. The caller (auto-mapper
 * trigger in the sync path) treats LLM fallback as opportunistic.
 */
export async function suggestUnmappedWithLlm(
  db: D1Database,
  ai: Ai,
  tenantId: string,
  connectionId: string,
  entityType: string,
  sourceSystem: string,
  unmapped: ReadonlyArray<UnmappedField>,
  kv?: KVNamespace,
): Promise<MappingSuggestion[]> {
  if (!unmapped.length) return [];

  // Bound the number of fields per LLM call.
  const fields = unmapped.slice(0, MAX_FIELDS_PER_RUN);

  // KV cache check — skip fields whose sample-signature is already cached.
  const fresh: UnmappedField[] = [];
  const cached: LlmSuggestion[] = [];
  if (kv) {
    for (const f of fields) {
      try {
        const c = await kv.get(fieldCacheKey(tenantId, connectionId, entityType, f), 'json') as LlmSuggestion | null;
        if (c) cached.push(c); else fresh.push(f);
      } catch { fresh.push(f); }
    }
  } else {
    fresh.push(...fields);
  }

  let llmOut: LlmSuggestion[] = [];
  if (fresh.length > 0) {
    try {
      const config = await loadLlmConfig(db, tenantId);
      const prompt = buildPrompt(fresh, entityType, sourceSystem);
      const t0 = Date.now();
      const res = await llmChatWithFallback(
        config, ai,
        [{ role: 'user', content: prompt }],
        { maxTokens: 800, temperature: 0.1, timeoutMs: 12000 },
      );
      const parsed = safeJsonExtract(res.text);
      llmOut = sanitiseSuggestions(parsed);
      logInfo('erp.mapping.llm.completed', { tenantId, layer: 'erp', action: 'erp.mapping.llm' }, {
        connectionId, entityType, fieldsRequested: fresh.length, suggestionsReturned: llmOut.length,
        durationMs: Date.now() - t0, provider: config.provider,
      });

      // Persist to cache so next sync skips the same fields.
      if (kv) {
        await Promise.all(
          fresh.map(async (f) => {
            const sug = llmOut.find((s) => s.source_field === f.source_field);
            if (!sug) return;
            try {
              await kv.put(
                fieldCacheKey(tenantId, connectionId, entityType, f),
                JSON.stringify(sug),
                { expirationTtl: LLM_CACHE_TTL_SECONDS },
              );
            } catch { /* non-fatal */ }
          }),
        );
      }
    } catch (err) {
      logError('erp.mapping.llm.failed', err, { tenantId }, {
        connectionId, entityType, fieldCount: fresh.length,
      });
    }
  }

  const all = [...cached, ...llmOut];
  // Convert to MappingSuggestion shape; drop 'unknown' classifications.
  return all
    .filter((s) => s.canonical_field !== 'unknown')
    .map<MappingSuggestion>((s) => ({
      canonical_field: s.canonical_field as CanonicalField,
      source_field: s.source_field,
      confidence: LLM_SUGGESTION_CONFIDENCE,
      rationale: `LLM: ${s.rationale}`,
      learned_from: 'auto',
    }));
}
