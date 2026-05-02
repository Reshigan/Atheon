/**
 * Competitor Onboarding — Phase 10-14.
 *
 * Phase 10-8 ingests news for whatever competitors a tenant has in
 * their `competitors` table — but until that table is populated, the
 * competitor-intel sweep is a no-op. This module suggests competitors
 * via LLM based on the tenant's inferred industry profile + tenant
 * name, so customers don't have to start from a blank slate.
 *
 * Design:
 *  - LLM is consulted, NOT trusted blindly. Suggestions are returned
 *    to the caller for review/approval. Acceptance is a separate
 *    explicit step (insertSuggestedCompetitor) — Atheon does not
 *    write rows to `competitors` autonomously.
 *  - Suggestions include a short `reason` for explainability so the
 *    customer knows WHY a particular name was suggested (geography,
 *    industry, public visibility).
 *  - Industry profile drives the prompt — the suggester knows whether
 *    to recommend mining majors or fintech challengers.
 *  - Pure dependency injection of the LLM caller so tests can stub
 *    deterministic responses without spinning up a model.
 */

import { logError } from './logger';
import { stripCodeFences } from './llm-provider';
import type { LlmMessage, LlmProviderConfig, LlmResponse } from './llm-provider';
import { inferTenantIndustryProfile } from './industry-profile';

const MAX_SUGGESTIONS = 5;

export interface SuggestedCompetitor {
  name: string;
  reason: string;
  /** ISO country guess from the LLM (e.g. ZA, US, GB). Optional. */
  country?: string;
  /** LLM's stated confidence in the relevance of this suggestion [0..1]. */
  confidence?: number;
}

export interface SuggestionContext {
  tenantId: string;
  tenantName: string;
  industries: string[];
  /** Optional hint passed to the LLM prompt — e.g. "we operate
   *  primarily in South Africa and adjacent SADC markets". */
  geographyHint?: string;
}

/** Function signature for the LLM caller. Tests pass a stub. The
 *  default implementation calls llmChatWithFallback but is constructed
 *  inside suggestCompetitors() so callers don't have to wire it. */
export type LlmCaller = (config: LlmProviderConfig, messages: LlmMessage[]) => Promise<LlmResponse>;

function buildPrompt(ctx: SuggestionContext): LlmMessage[] {
  const industryStr = ctx.industries.length > 0
    ? ctx.industries.join(', ')
    : 'general business';
  const geo = ctx.geographyHint ?? 'primarily South Africa';
  return [
    {
      role: 'system',
      content: `You are Atheon's competitor onboarding assistant. The user's company will be given. Suggest up to ${MAX_SUGGESTIONS} likely competitors based on their industry and geography. Real, named companies only — no placeholders. Each entry needs a short reason (≤ 140 chars) explaining why it's a competitor.

Respond ONLY in JSON:
{ "competitors": [
  { "name": "Company name", "reason": "why this is a competitor", "country": "ZA|US|GB|...", "confidence": 0.0..1.0 }
] }`,
    },
    {
      role: 'user',
      content: `Tenant: ${ctx.tenantName}
Industries: ${industryStr}
Geography: ${geo}

List up to ${MAX_SUGGESTIONS} named competitors.`,
    },
  ];
}

/** Parse the LLM's JSON reply into a vetted SuggestedCompetitor[]. */
export function parseSuggestionResponse(raw: string): SuggestedCompetitor[] {
  let parsed: unknown;
  try { parsed = JSON.parse(stripCodeFences(raw)); } catch { return []; }
  if (!parsed || typeof parsed !== 'object') return [];
  const obj = parsed as { competitors?: unknown };
  if (!Array.isArray(obj.competitors)) return [];
  const out: SuggestedCompetitor[] = [];
  for (const c of obj.competitors as Array<Record<string, unknown>>) {
    if (!c || typeof c !== 'object') continue;
    const name = typeof c.name === 'string' ? c.name.trim() : '';
    if (!name || name.length < 2 || name.length > 80) continue;
    const reason = typeof c.reason === 'string' ? c.reason.trim().slice(0, 200) : '';
    const country = typeof c.country === 'string'
      ? c.country.trim().toUpperCase().slice(0, 3)
      : undefined;
    const confidence = typeof c.confidence === 'number' && c.confidence >= 0 && c.confidence <= 1
      ? c.confidence
      : undefined;
    out.push({ name, reason, country, confidence });
    if (out.length >= MAX_SUGGESTIONS) break;
  }
  return out;
}

/** Suggest competitors for a tenant. Reads the industry profile,
 *  prompts the LLM, returns a vetted list. Does NOT write to
 *  `competitors` — caller decides whether to accept each. */
export async function suggestCompetitors(
  db: D1Database, tenantId: string, tenantName: string,
  llmConfig: LlmProviderConfig, llmCall: LlmCaller,
  geographyHint?: string,
): Promise<SuggestedCompetitor[]> {
  let industries: string[] = [];
  try {
    const profile = await inferTenantIndustryProfile(db, tenantId);
    industries = profile.industries;
  } catch {
    industries = ['general'];
  }
  const messages = buildPrompt({ tenantId, tenantName, industries, geographyHint });
  try {
    const response = await llmCall(llmConfig, messages);
    return parseSuggestionResponse(response.text);
  } catch (err) {
    logError('competitor_onboarding.llm_call_failed', err, { tenantId },
      { tenant_name: tenantName, industries });
    return [];
  }
}

/** Accept a suggestion: insert into `competitors`. Idempotent — re-
 *  inserting the same name for the same tenant is a no-op. */
export async function acceptSuggestion(
  db: D1Database, tenantId: string, suggestion: SuggestedCompetitor,
): Promise<{ inserted: boolean; competitorId: string | null }> {
  // Look up existing first — competitors lacks a UNIQUE constraint on
  // (tenant_id, name) at the schema level, so dedupe at the app layer.
  try {
    const existing = await db.prepare(
      `SELECT id FROM competitors WHERE tenant_id = ? AND lower(name) = ? LIMIT 1`
    ).bind(tenantId, suggestion.name.toLowerCase()).first<{ id: string }>();
    if (existing) return { inserted: false, competitorId: existing.id };
  } catch {
    // Continue to attempt insert; worst case the read failed but write
    // can still succeed.
  }

  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO competitors (id, tenant_id, name, industry, signals_count)
       VALUES (?, ?, ?, ?, 0)`
    ).bind(id, tenantId, suggestion.name, suggestion.country ?? null).run();
    return { inserted: true, competitorId: id };
  } catch (err) {
    logError('competitor_onboarding.insert_failed', err, { tenantId },
      { name: suggestion.name });
    return { inserted: false, competitorId: null };
  }
}
