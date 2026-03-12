/**
 * AI Cost Analytics API
 * GET  /api/v1/ai-costs         — Current month summary
 * GET  /api/v1/ai-costs/budget  — Budget status
 * GET  /api/v1/ai-costs/history — Last 6 months
 * POST /api/v1/ai-costs/cache/flush — Flush cache
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getTenantCostRecord, checkBudgetStatus, DEFAULT_TIERED_CONFIG } from '../services/ai-cost-optimizer';

const aiCosts = new Hono<AppBindings>();

function getTenantId(c: { get: (k: string) => unknown }): string {
  return (c.get('auth') as AuthContext)?.tenantId || 'unknown';
}

aiCosts.get('/', async (c) => {
  const tenantId = getTenantId(c);
  const rec = await getTenantCostRecord(c.env.CACHE, tenantId);
  const hitRate = rec.totalQueries > 0 ? ((rec.cacheHits / rec.totalQueries) * 100).toFixed(1) : '0.0';
  const simplePct = rec.totalQueries > 0 ? ((rec.simpleRouted / rec.totalQueries) * 100).toFixed(1) : '0.0';

  return c.json({
    month: rec.month,
    summary: {
      totalQueries: rec.totalQueries,
      totalTokensIn: rec.totalTokensIn,
      totalTokensOut: rec.totalTokensOut,
      estimatedCostUSD: Number(rec.estimatedCostUSD.toFixed(4)),
    },
    caching: { hits: rec.cacheHits, hitRate: `${hitRate}%`, estimatedSavingsUSD: Number(rec.cacheSavings.toFixed(4)) },
    routing: {
      simpleQueries: rec.simpleRouted, complexQueries: rec.complexRouted,
      simplePercent: `${simplePct}%`, targetSplit: '80/20',
      simpleModel: DEFAULT_TIERED_CONFIG.simple.workersAiModel,
      complexModel: DEFAULT_TIERED_CONFIG.complex.workersAiModel,
    },
    byModel: rec.byModel,
  });
});

aiCosts.get('/budget', async (c) => {
  const tenantId = getTenantId(c);
  const status = await checkBudgetStatus(c.env.CACHE, tenantId, 'enterprise');
  return c.json({
    status: status.status,
    usedUSD: Number(status.usedUSD.toFixed(4)),
    budgetUSD: status.budgetUSD === Infinity ? 'unlimited' : status.budgetUSD,
    percentUsed: Number(status.percentUsed.toFixed(1)),
  });
});

aiCosts.get('/history', async (c) => {
  const tenantId = getTenantId(c);
  const months: Array<{ month: string; queries: number; costUSD: number; cacheHits: number }> = [];
  for (let i = 0; i < 6; i++) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    const month = d.toISOString().substring(0, 7);
    const data = await c.env.CACHE.get(`ai_cost:${tenantId}:${month}`);
    if (data) {
      try {
        const r = JSON.parse(data);
        months.push({ month, queries: r.totalQueries, costUSD: Number(r.estimatedCostUSD.toFixed(4)), cacheHits: r.cacheHits });
      } catch { months.push({ month, queries: 0, costUSD: 0, cacheHits: 0 }); }
    } else {
      months.push({ month, queries: 0, costUSD: 0, cacheHits: 0 });
    }
  }
  return c.json({ tenantId, history: months });
});

aiCosts.post('/cache/flush', async (c) => {
  const tenantId = getTenantId(c);
  const vKey = `ai_cache_version:${tenantId}`;
  const cur = await c.env.CACHE.get(vKey);
  const nv = String(Number(cur || '0') + 1);
  await c.env.CACHE.put(vKey, nv, { expirationTtl: 86400 * 365 });
  return c.json({ success: true, message: 'AI cache flushed', cacheVersion: nv });
});

export default aiCosts;
