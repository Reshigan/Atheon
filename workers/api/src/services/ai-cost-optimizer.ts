/**
 * AI Cost Optimization Service
 *
 * Three strategies:
 * 1. AI Gateway Response Caching — cache identical queries in KV
 * 2. Tiered Model Routing — 80% small model, 20% large model
 * 3. Cost Tracking & Budget Enforcement — per-tenant monthly limits
 */

import type { OllamaChatMessage, OllamaChatResponse } from './ollama';
import { chatWithFallback } from './ollama';

// ═══ 1. RESPONSE CACHING ═══

const CACHE_PREFIX = 'ai_cache:';
const CACHE_TTL_SHORT = 300;    // 5 min — volatile queries
const CACHE_TTL_STANDARD = 3600; // 1 hour — analytical queries
const CACHE_TTL_LONG = 86400;   // 24 hours — compliance/templates

type QueryCategory = 'volatile' | 'standard' | 'static';

function classifyQueryCategory(query: string): QueryCategory {
  const q = query.toLowerCase();
  const volatilePatterns = [
    'current', 'right now', 'today', 'this moment', 'live', 'real-time',
    'stock on hand', 'cash position', 'bank balance', 'pending orders',
    'in progress', 'active alerts', 'unread',
  ];
  if (volatilePatterns.some(p => q.includes(p))) return 'volatile';

  const staticPatterns = [
    'compliance', 'regulation', 'policy', 'template', 'standard',
    'what is', 'define', 'explain', 'how does', 'best practice',
    'popia', 'gdpr', 'sox', 'ifrs', 'b-bbee', 'vat rate',
    'audit requirement', 'governance framework', 'escalation policy',
  ];
  if (staticPatterns.some(p => q.includes(p))) return 'static';
  return 'standard';
}

async function generateCacheKey(tenantId: string, query: string, tier: string, cacheVersion?: string): Promise<string> {
  const ver = cacheVersion || '0';
  const normalized = `${tenantId}:${tier}:${ver}:${query.toLowerCase().trim().replace(/\s+/g, ' ')}`;
  const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  const hex = Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  return `${CACHE_PREFIX}${hex}`;
}

async function getCacheVersion(cache: KVNamespace, tenantId: string): Promise<string> {
  return (await cache.get(`ai_cache_version:${tenantId}`)) || '0';
}

interface CachedAIResponse {
  response: string;
  citations: string[];
  model: string;
  tokensIn: number;
  tokensOut: number;
  cachedAt: string;
  category: QueryCategory;
}

export async function getCachedResponse(
  cache: KVNamespace, tenantId: string, query: string, tier: string,
): Promise<CachedAIResponse | null> {
  const version = await getCacheVersion(cache, tenantId);
  const key = await generateCacheKey(tenantId, query, tier, version);
  const cached = await cache.get(key);
  if (!cached) return null;
  try { return JSON.parse(cached) as CachedAIResponse; } catch { return null; }
}

export async function cacheResponse(
  cache: KVNamespace, tenantId: string, query: string, tier: string,
  response: string, citations: string[], model: string,
  tokensIn: number, tokensOut: number,
): Promise<void> {
  const version = await getCacheVersion(cache, tenantId);
  const key = await generateCacheKey(tenantId, query, tier, version);
  const category = classifyQueryCategory(query);
  const ttl = category === 'volatile' ? CACHE_TTL_SHORT
    : category === 'static' ? CACHE_TTL_LONG : CACHE_TTL_STANDARD;
  await cache.put(key, JSON.stringify({
    response, citations, model, tokensIn, tokensOut,
    cachedAt: new Date().toISOString(), category,
  } satisfies CachedAIResponse), { expirationTtl: ttl });
}

// ═══ 2. TIERED MODEL ROUTING ═══

export type QueryComplexity = 'simple' | 'complex';

export interface TieredModelConfig {
  simple: { ollamaModel: string; workersAiModel: string; maxTokens: number; temperature: number };
  complex: { ollamaModel: string; workersAiModel: string; maxTokens: number; temperature: number };
}

export const DEFAULT_TIERED_CONFIG: TieredModelConfig = {
  simple: {
    ollamaModel: 'Reshigan/atheon',
    workersAiModel: '@cf/google/gemma-2b-it',
    maxTokens: 1024,
    temperature: 0.5,
  },
  complex: {
    ollamaModel: 'Reshigan/atheon',
    workersAiModel: '@cf/meta/llama-3.1-70b-instruct',
    maxTokens: 4096,
    temperature: 0.3,
  },
};

export function classifyComplexity(query: string, context?: { tier?: string }): QueryComplexity {
  if (context?.tier === 'tier-3') return 'complex';
  const q = query.toLowerCase();

  const complexPatterns = [
    'why', 'root cause', 'investigate', 'diagnose', 'explain why',
    'what if', 'what happens', 'scenario', 'simulate', 'forecast', 'predict',
    'recommend', 'suggest', 'strategy', 'optimize', 'improve', 'plan',
    'should we', 'how can we', 'what should',
    'correlation', 'correlate', 'cross-functional', 'impact on', 'affect',
    'downstream', 'upstream', 'ripple',
    'compare', 'versus', 'vs', 'benchmark',
    'all divisions', 'every department', 'across all', 'company-wide',
  ];

  if (complexPatterns.some(p => q.includes(p))) return 'complex';
  const wordCount = q.split(/\s+/).length;
  const multiClause = (q.match(/\band\b|\bor\b|\bbut\b|\bwhile\b|\balso\b/g) || []).length >= 2;
  const multiQuestion = (q.match(/\bwho\b|\bwhat\b|\bwhen\b|\bwhere\b|\bwhy\b|\bhow\b/g) || []).length >= 2;
  if ((wordCount > 25 && multiClause) || multiQuestion) return 'complex';
  return 'simple';
}

export async function routedChat(
  ollamaApiKey: string | undefined, ai: Ai,
  messages: OllamaChatMessage[], query: string,
  options?: { tier?: string; config?: TieredModelConfig },
): Promise<OllamaChatResponse & { complexity: QueryComplexity; routingReason: string }> {
  const config = options?.config || DEFAULT_TIERED_CONFIG;
  const complexity = classifyComplexity(query, { tier: options?.tier });
  const mc = complexity === 'complex' ? config.complex : config.simple;
  const result = await chatWithFallback(ollamaApiKey, ai, {
    model: mc.ollamaModel, messages, maxTokens: mc.maxTokens,
    temperature: mc.temperature, workersAiModel: mc.workersAiModel,
  });
  return {
    ...result, complexity,
    routingReason: complexity === 'complex'
      ? 'Complex: multi-step reasoning / scenario / cross-department detected'
      : 'Simple: data retrieval / status check / standard report',
  };
}

// ═══ 3. COST TRACKING ═══

const COST_RATES: Record<string, { input: number; output: number }> = {
  '@cf/google/gemma-2b-it':           { input: 0.0001, output: 0.0002 },
  '@cf/meta/llama-3.1-8b-instruct':   { input: 0.0003, output: 0.0006 },
  '@cf/meta/llama-3.1-70b-instruct':  { input: 0.0035, output: 0.0070 },
  '@cf/baai/bge-base-en-v1.5':        { input: 0.00005, output: 0 },
  'Reshigan/atheon':                   { input: 0.0002, output: 0.0004 },
  'default':                           { input: 0.001, output: 0.002 },
};

const PLAN_BUDGETS_USD: Record<string, number> = {
  starter: 10, professional: 50, enterprise: 200, unlimited: Infinity,
};

interface TenantCostRecord {
  tenantId: string; month: string;
  totalTokensIn: number; totalTokensOut: number; totalQueries: number;
  cacheHits: number; cacheSavings: number;
  simpleRouted: number; complexRouted: number;
  estimatedCostUSD: number;
  byModel: Record<string, { tokensIn: number; tokensOut: number; queries: number; costUSD: number }>;
  lastUpdated: string;
}

export function estimateCost(model: string, tokensIn: number, tokensOut: number): number {
  const r = COST_RATES[model] || COST_RATES['default'];
  return (tokensIn / 1000) * r.input + (tokensOut / 1000) * r.output;
}

export async function getTenantCostRecord(cache: KVNamespace, tenantId: string): Promise<TenantCostRecord> {
  const month = new Date().toISOString().substring(0, 7);
  const existing = await cache.get(`ai_cost:${tenantId}:${month}`);
  if (existing) try { return JSON.parse(existing); } catch { /* fall through */ }
  return {
    tenantId, month, totalTokensIn: 0, totalTokensOut: 0, totalQueries: 0,
    cacheHits: 0, cacheSavings: 0, simpleRouted: 0, complexRouted: 0,
    estimatedCostUSD: 0, byModel: {}, lastUpdated: new Date().toISOString(),
  };
}

export async function recordAICost(
  cache: KVNamespace, tenantId: string, model: string,
  tokensIn: number, tokensOut: number, complexity: QueryComplexity, wasCache: boolean,
): Promise<{ costUSD: number; monthlyTotal: number }> {
  const rec = await getTenantCostRecord(cache, tenantId);
  const cost = wasCache ? 0 : estimateCost(model, tokensIn, tokensOut);
  rec.totalTokensIn += tokensIn;
  rec.totalTokensOut += tokensOut;
  rec.totalQueries += 1;
  rec.estimatedCostUSD += cost;
  rec.lastUpdated = new Date().toISOString();
  if (wasCache) { rec.cacheHits++; rec.cacheSavings += estimateCost(model, tokensIn, tokensOut); }
  if (complexity === 'simple') rec.simpleRouted++; else rec.complexRouted++;
  if (!rec.byModel[model]) rec.byModel[model] = { tokensIn: 0, tokensOut: 0, queries: 0, costUSD: 0 };
  rec.byModel[model].tokensIn += tokensIn;
  rec.byModel[model].tokensOut += tokensOut;
  rec.byModel[model].queries += 1;
  rec.byModel[model].costUSD += cost;
  const month = new Date().toISOString().substring(0, 7);
  await cache.put(`ai_cost:${tenantId}:${month}`, JSON.stringify(rec), { expirationTtl: 86400 * 35 });
  return { costUSD: cost, monthlyTotal: rec.estimatedCostUSD };
}

export async function checkBudgetStatus(
  cache: KVNamespace, tenantId: string, plan: string,
): Promise<{ status: 'ok' | 'warning' | 'critical' | 'exceeded'; usedUSD: number; budgetUSD: number; percentUsed: number }> {
  const rec = await getTenantCostRecord(cache, tenantId);
  const budget = PLAN_BUDGETS_USD[plan] || PLAN_BUDGETS_USD['starter'];
  const pct = budget === Infinity ? 0 : (rec.estimatedCostUSD / budget) * 100;
  const status = pct >= 100 ? 'exceeded' : pct >= 95 ? 'critical' : pct >= 80 ? 'warning' : 'ok';
  return { status, usedUSD: rec.estimatedCostUSD, budgetUSD: budget, percentUsed: pct };
}

// ═══ 4. UNIFIED OPTIMIZED CHAT ═══

export interface OptimizedChatResponse {
  response: string; model: string; tokensIn: number; tokensOut: number;
  provider: 'ollama-cloud' | 'workers-ai';
  cached: boolean; cacheCategory?: QueryCategory;
  complexity: QueryComplexity; routingReason: string;
  estimatedCostUSD: number; monthlyTotalUSD: number; cacheSavingsUSD?: number;
}

export async function optimizedChat(
  ollamaApiKey: string | undefined, ai: Ai, cache: KVNamespace,
  tenantId: string, messages: OllamaChatMessage[], query: string,
  options?: { tier?: string; config?: TieredModelConfig; skipCache?: boolean },
): Promise<OptimizedChatResponse> {
  const tier = options?.tier || 'tier-1';

  // Step 1: Cache check
  if (!options?.skipCache) {
    const cached = await getCachedResponse(cache, tenantId, query, tier);
    if (cached) {
      const cr = await recordAICost(cache, tenantId, cached.model, cached.tokensIn, cached.tokensOut, 'simple', true);
      return {
        response: cached.response, model: cached.model,
        tokensIn: cached.tokensIn, tokensOut: cached.tokensOut,
        provider: 'workers-ai', cached: true, cacheCategory: cached.category,
        complexity: 'simple',
        routingReason: `Cache hit (${cached.category}, cached ${cached.cachedAt})`,
        estimatedCostUSD: 0, monthlyTotalUSD: cr.monthlyTotal,
        cacheSavingsUSD: estimateCost(cached.model, cached.tokensIn, cached.tokensOut),
      };
    }
  }

  // Step 2+3: Classify + route
  const result = await routedChat(ollamaApiKey, ai, messages, query, { tier, config: options?.config });

  // Step 4: Cache response
  try {
    await cacheResponse(cache, tenantId, query, tier, result.response, [], result.model, result.tokensIn, result.tokensOut);
  } catch (err) { console.error('Cache write failed:', err); }

  // Step 5: Track cost
  const cr = await recordAICost(cache, tenantId, result.model, result.tokensIn, result.tokensOut, result.complexity, false);

  return {
    response: result.response, model: result.model,
    tokensIn: result.tokensIn, tokensOut: result.tokensOut,
    provider: result.provider, cached: false,
    complexity: result.complexity, routingReason: result.routingReason,
    estimatedCostUSD: cr.costUSD, monthlyTotalUSD: cr.monthlyTotal,
  };
}
