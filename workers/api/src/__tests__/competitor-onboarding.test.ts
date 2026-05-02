/**
 * Phase 10-14b — Competitor onboarding (LLM-assisted).
 *
 * Covers:
 *  Pure parser
 *   1. parseSuggestionResponse: well-formed JSON → vetted list
 *   2. Strips code fences before parsing
 *   3. Drops invalid entries (missing name, oversized, malformed)
 *
 *  End-to-end with stubbed LLM
 *   4. Industry-aware prompt: tenant with mining KPIs gets industry
 *      passed to the LLM call
 *   5. Returns up to MAX_SUGGESTIONS (5)
 *   6. LLM error → returns [] (caller fallback path)
 *
 *  Acceptance
 *   7. acceptSuggestion inserts into competitors and is idempotent
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  parseSuggestionResponse,
  suggestCompetitors,
  acceptSuggestion,
  type SuggestedCompetitor,
} from '../services/competitor-onboarding';
import type { LlmProviderConfig, LlmResponse, LlmMessage } from '../services/llm-provider';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'cob-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedMiningMetric(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO process_metrics
       (id, tenant_id, name, value, unit, status, domain, measured_at)
     VALUES (?, ?, 'Ore Throughput', 0, 't', 'green', 'mining-ore', datetime('now'))`
  ).bind(crypto.randomUUID(), TENANT).run();
}

const STUB_LLM_CONFIG: LlmProviderConfig = {
  provider: 'workers_ai',
  model: 'stub',
  apiKey: null,
  baseUrl: null,
  enabled: true,
} as LlmProviderConfig;

describe('Phase 10-14b — competitor onboarding', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM competitors WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM process_metrics WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('parseSuggestionResponse', () => {
    it('well-formed JSON → vetted list', () => {
      const raw = JSON.stringify({
        competitors: [
          { name: 'Sibanye-Stillwater', reason: 'SA platinum + gold miner', country: 'ZA', confidence: 0.9 },
          { name: 'Anglo American Platinum', reason: 'PGM major', country: 'GB', confidence: 0.85 },
        ],
      });
      const out = parseSuggestionResponse(raw);
      expect(out.length).toBe(2);
      expect(out[0].name).toBe('Sibanye-Stillwater');
      expect(out[0].country).toBe('ZA');
      expect(out[0].confidence).toBe(0.9);
    });
    it('strips code fences', () => {
      const raw = '```json\n{"competitors":[{"name":"X Co","reason":"r"}]}\n```';
      const out = parseSuggestionResponse(raw);
      expect(out.length).toBe(1);
      expect(out[0].name).toBe('X Co');
    });
    it('drops invalid entries (missing name, oversized, malformed)', () => {
      const raw = JSON.stringify({
        competitors: [
          { reason: 'no name' },
          { name: 'A', reason: 'too short' }, // name length < 2
          { name: 'X'.repeat(100), reason: 'too long' },
          { name: 'Valid Co', reason: 'good', confidence: 1.5 }, // bad confidence ignored
          'not an object',
          null,
        ],
      });
      const out = parseSuggestionResponse(raw);
      expect(out.length).toBe(1);
      expect(out[0].name).toBe('Valid Co');
      expect(out[0].confidence).toBeUndefined(); // out-of-range filtered
    });
    it('non-JSON → empty array', () => {
      expect(parseSuggestionResponse('plain text')).toEqual([]);
      expect(parseSuggestionResponse('')).toEqual([]);
    });
  });

  describe('suggestCompetitors with stubbed LLM', () => {
    it('industry-aware prompt: mining KPIs → industries=["mining"] passed to LLM', async () => {
      await seedMiningMetric();
      let receivedMessages: LlmMessage[] | null = null;
      const stub = async (_cfg: LlmProviderConfig, messages: LlmMessage[]): Promise<LlmResponse> => {
        receivedMessages = messages;
        return {
          text: JSON.stringify({
            competitors: [
              { name: 'Sibanye-Stillwater', reason: 'SA mining peer' },
              { name: 'Anglo American', reason: 'global diversified miner' },
            ],
          }),
          tokensIn: 100, tokensOut: 50, latencyMs: 500, model: 'stub', provider: 'workers_ai',
        };
      };

      const out = await suggestCompetitors(env.DB, TENANT, 'My Mining Co', STUB_LLM_CONFIG, stub);
      expect(out.length).toBe(2);
      expect(out[0].name).toBe('Sibanye-Stillwater');
      // Verify industry was passed to LLM in user message
      const userMsg = receivedMessages!.find((m) => m.role === 'user')!.content;
      expect(userMsg).toContain('mining');
      expect(userMsg).toContain('My Mining Co');
    });

    it('returns up to 5 suggestions (cap)', async () => {
      const stub = async (): Promise<LlmResponse> => ({
        text: JSON.stringify({
          competitors: Array.from({ length: 10 }, (_, i) => ({ name: `Co ${i}`, reason: 'x' })),
        }),
        tokensIn: 100, tokensOut: 50, latencyMs: 500, model: 'stub', provider: 'workers_ai',
      });
      const out = await suggestCompetitors(env.DB, TENANT, 'X', STUB_LLM_CONFIG, stub);
      expect(out.length).toBe(5);
    });

    it('LLM throws → returns []', async () => {
      const stub = async (): Promise<LlmResponse> => { throw new Error('LLM down'); };
      const out = await suggestCompetitors(env.DB, TENANT, 'X', STUB_LLM_CONFIG, stub);
      expect(out).toEqual([]);
    });
  });

  describe('acceptSuggestion', () => {
    it('inserts into competitors and is idempotent', async () => {
      const sug: SuggestedCompetitor = { name: 'Acme Inc', reason: 'r', country: 'US' };
      const r1 = await acceptSuggestion(env.DB, TENANT, sug);
      expect(r1.inserted).toBe(true);
      expect(r1.competitorId).not.toBeNull();

      const r2 = await acceptSuggestion(env.DB, TENANT, sug);
      expect(r2.inserted).toBe(false);
      expect(r2.competitorId).toBe(r1.competitorId);

      const cnt = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM competitors WHERE tenant_id = ? AND name = ?`
      ).bind(TENANT, 'Acme Inc').first<{ n: number }>();
      expect(cnt?.n).toBe(1);
    });
    it('case-insensitive dedup', async () => {
      await acceptSuggestion(env.DB, TENANT, { name: 'Acme Inc', reason: 'r' });
      const r = await acceptSuggestion(env.DB, TENANT, { name: 'ACME INC', reason: 'r' });
      expect(r.inserted).toBe(false);
    });
  });
});
