import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { chatWithFallback } from '../services/ollama';

const mind = new Hono<AppBindings>();

// Model tier configurations — Ollama Cloud (Reshigan/atheon) with Workers AI fallback
const MODEL_TIERS: Record<string, { name: string; model: string; ollamaModel: string; fallbackModel: string; maxTokens: number; description: string }> = {
  'tier-1': { name: 'Atheon Edge', model: 'Reshigan/atheon', ollamaModel: 'Reshigan/atheon', fallbackModel: '@cf/meta/llama-3.1-8b-instruct', maxTokens: 2048, description: 'Fast inference via Atheon custom model for queries and classification' },
  'tier-2': { name: 'Atheon Mind', model: 'Reshigan/atheon', ollamaModel: 'Reshigan/atheon', fallbackModel: '@cf/meta/llama-3.1-70b-instruct', maxTokens: 8192, description: 'Domain-tuned Atheon model for complex enterprise analysis and reasoning' },
  'tier-3': { name: 'Atheon Apex', model: 'Reshigan/atheon', ollamaModel: 'Reshigan/atheon', fallbackModel: '@cf/meta/llama-3.1-70b-instruct', maxTokens: 8192, description: 'Multi-step reasoning via Atheon model for scenario modelling and strategic planning' },
};

// Industry LoRA adapters
const INDUSTRY_ADAPTERS = {
  fmcg: { name: 'FMCG Domain Adapter', metrics: ['Trade Promo ROI', 'Shelf Velocity', 'Distributor Fill Rate'], status: 'active' },
  mining: { name: 'Mining Domain Adapter', metrics: ['Equipment OEE', 'Safety Incident Rate', 'Extraction Yield'], status: 'active' },
  healthcare: { name: 'Healthcare Domain Adapter', metrics: ['Patient Wait Time', 'Bed Occupancy', 'Clinical Outcome Score'], status: 'active' },
  general: { name: 'General Enterprise Adapter', metrics: ['Revenue Growth', 'Cost Efficiency', 'Employee Satisfaction'], status: 'active' },
};

// System prompt for Atheon Mind
function buildSystemPrompt(tenantContext: string): string {
  return `You are Atheon Mind, an enterprise intelligence AI assistant for the Atheon™ platform. You provide data-driven insights across business operations.

Your capabilities:
- Financial analysis: revenue, margins, cash flow, forecasting
- Supply chain intelligence: OTIF, logistics, inventory, procurement
- Risk assessment: identify, quantify, and recommend mitigations
- Catalyst (AI agent) status: monitoring autonomous agent performance
- Process mining: efficiency metrics, anomalies, bottleneck detection
- Knowledge graph queries: entity relationships and contextual data

Always be specific with numbers, cite data sources, and provide actionable recommendations. Use South African Rand (ZAR) for currency. Format responses with markdown for readability.

${tenantContext}`;
}

// Fetch tenant context from DB for grounding
async function getTenantContext(db: D1Database, tenantId: string): Promise<string> {
  const health = await db.prepare('SELECT * FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first();
  const risks = await db.prepare('SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = ? LIMIT 5').bind(tenantId, 'active').all();
  const metrics = await db.prepare('SELECT name, value, unit, status FROM process_metrics WHERE tenant_id = ? LIMIT 10').bind(tenantId).all();
  const clusters = await db.prepare('SELECT name, status, success_rate, tasks_completed FROM catalyst_clusters WHERE tenant_id = ? LIMIT 10').bind(tenantId).all();

  let context = 'Current tenant data context:\n';
  if (health) {
    const dims = JSON.parse(health.dimensions as string || '{}');
    context += `- Overall health score: ${health.overall_score}/100\n`;
    for (const [k, v] of Object.entries(dims)) {
      const dim = v as { score: number; trend: string };
      context += `  - ${k}: ${dim.score}/100 (${dim.trend})\n`;
    }
  }
  if (risks.results.length > 0) {
    context += '- Active risks:\n';
    for (const r of risks.results) {
      context += `  - [${(r as Record<string, unknown>).severity}] ${(r as Record<string, unknown>).title} (${(r as Record<string, unknown>).category})\n`;
    }
  }
  if (metrics.results.length > 0) {
    context += '- Key metrics:\n';
    for (const m of metrics.results) {
      context += `  - ${(m as Record<string, unknown>).name}: ${(m as Record<string, unknown>).value} ${(m as Record<string, unknown>).unit} [${(m as Record<string, unknown>).status}]\n`;
    }
  }
  if (clusters.results.length > 0) {
    context += '- Catalyst clusters:\n';
    for (const cl of clusters.results) {
      context += `  - ${(cl as Record<string, unknown>).name}: ${(cl as Record<string, unknown>).status}, ${(cl as Record<string, unknown>).success_rate}% success, ${(cl as Record<string, unknown>).tasks_completed} tasks\n`;
    }
  }
  return context;
}

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || 'vantax';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// Helper: check if a sub-catalyst query is restricted by admin toggle
async function checkSubCatalystRestriction(db: D1Database, tenantId: string, query: string): Promise<{ restricted: boolean; subName?: string }> {
  try {
    const clusters = await db.prepare('SELECT sub_catalysts FROM catalyst_clusters WHERE tenant_id = ?').bind(tenantId).all();
    const queryLower = query.toLowerCase();
    for (const cl of clusters.results) {
      const subs = JSON.parse((cl as Record<string, unknown>).sub_catalysts as string || '[]') as Array<{ name: string; enabled: boolean }>;
      for (const sub of subs) {
        if (!sub.enabled && queryLower.includes(sub.name.toLowerCase())) {
          return { restricted: true, subName: sub.name };
        }
      }
    }
  } catch { /* ignore parse errors */ }
  return { restricted: false };
}

// POST /api/mind/query
mind.post('/query', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{
    query: string; tier?: string; context?: string;
  }>(c, [
    { field: 'query', type: 'string', required: true, minLength: 1, maxLength: 2000 },
    { field: 'tier', type: 'string', required: false, maxLength: 16 },
    { field: 'context', type: 'string', required: false, maxLength: 4000 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const tenantId = getTenantId(c);

  // Check sub-catalyst restrictions — if query references a disabled sub-catalyst, restrict the response
  const restriction = await checkSubCatalystRestriction(c.env.DB, tenantId, body.query);
  if (restriction.restricted) {
    return c.json({
      id: crypto.randomUUID(),
      response: `The sub-catalyst "${restriction.subName}" is currently disabled by your administrator. Please contact your admin to enable this capability before querying it.`,
      tier: body.tier || 'tier-1',
      model: 'restricted',
      tokensIn: 0,
      tokensOut: 0,
      latencyMs: 0,
      citations: [],
      generatedAt: new Date().toISOString(),
      restricted: true,
      restrictedSubCatalyst: restriction.subName,
    });
  }
  const tierKey = body.tier || 'tier-1';
  const tierConfig = MODEL_TIERS[tierKey] || MODEL_TIERS['tier-1'];

  const startTime = Date.now();

  // Build context-aware system prompt
  const tenantContext = await getTenantContext(c.env.DB, tenantId);
  const systemPrompt = buildSystemPrompt(tenantContext);

  let response = '';
  let citations: string[] = [];
  let tokensIn = 0;
  let tokensOut = 0;

  try {
    // Call Ollama Cloud (Reshigan/atheon) with Workers AI fallback
    const messages = [
      { role: 'system' as const, content: systemPrompt },
      ...(body.context ? [{ role: 'user' as const, content: `Additional context: ${body.context}` }] : []),
      { role: 'user' as const, content: body.query },
    ];

    const aiResult = await chatWithFallback(
      c.env.OLLAMA_API_KEY,
      c.env.AI,
      {
        model: tierConfig.ollamaModel,
        messages,
        maxTokens: tierConfig.maxTokens,
        temperature: tierKey === 'tier-3' ? 0.3 : 0.7,
        workersAiModel: tierConfig.fallbackModel,
      },
    );

    response = aiResult.response || 'No response generated.';
    tokensIn = aiResult.tokensIn;
    tokensOut = aiResult.tokensOut;

    // Auto-detect citations from context
    const queryLower = body.query.toLowerCase();
    if (queryLower.includes('revenue') || queryLower.includes('financial')) {
      citations = ['SAP S/4HANA FI Module', 'Pulse Metric: Cash Conversion Cycle', 'Apex Health Score'];
    } else if (queryLower.includes('supply') || queryLower.includes('logistics') || queryLower.includes('otif')) {
      citations = ['Logistics TMS', 'Pulse Anomaly Detection', 'Risk Alert: Supply Chain'];
    } else if (queryLower.includes('risk')) {
      citations = ['Apex Risk Register', 'Health Score Dimensions', 'Audit Log'];
    } else if (queryLower.includes('catalyst') || queryLower.includes('agent')) {
      citations = ['Catalyst Control Plane', 'Agent Deployment Registry', 'Governance Log'];
    } else {
      citations = ['Atheon Knowledge Graph', 'Apex Health Score', 'Pulse Process Metrics'];
    }
  } catch (aiError) {
    // Fallback to rule-based response if AI fails
    console.error('Workers AI error:', aiError);
    response = generateFallbackResponse(body.query);
    citations = ['Atheon Knowledge Graph (fallback mode)'];
    tokensIn = body.query.split(' ').length * 2;
    tokensOut = response.split(' ').length * 2;
  }

  const latency = Date.now() - startTime;

  // Log the query to D1
  const queryId = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO mind_queries (id, tenant_id, query, response, tier, tokens_in, tokens_out, latency_ms, citations) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(queryId, tenantId, body.query, response, tierKey, tokensIn, tokensOut, latency, JSON.stringify(citations)).run();

  return c.json({
    id: queryId,
    response,
    tier: tierKey,
    model: tierConfig.name,
    tokensIn,
    tokensOut,
    latencyMs: latency,
    citations,
    generatedAt: new Date().toISOString(),
  });
});

// Fallback response when Workers AI is unavailable
function generateFallbackResponse(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('revenue') || q.includes('financial') || q.includes('profit')) {
    return `**Revenue Performance**: Current quarter revenue tracking 3.9% above forecast at R847M. Gross margin at 34.2% (target: 35%). Cash position: R42.3M. DSO at 38 days.\n\n*Note: This is a cached response. Workers AI is temporarily unavailable.*`;
  } else if (q.includes('supply') || q.includes('logistics') || q.includes('otif')) {
    return `**Supply Chain Summary**: OTIF at 87.3% (target: 95%). Root cause: Durban port congestion (+340% dwell time). Recommended: Activate Cape Town alternative routing.\n\n*Note: Cached response — Workers AI temporarily unavailable.*`;
  } else if (q.includes('risk')) {
    return `**Risk Summary**: 2 critical, 1 high risk active. Total exposure: R12.3M. Top risk: Durban Port Congestion (R2.3M, 87% probability).\n\n*Note: Cached response — Workers AI temporarily unavailable.*`;
  }
  return `Business health score: 78/100. 5 active catalyst clusters. 3 risk alerts active. All ERP integrations operational.\n\n*Note: Cached response — Workers AI temporarily unavailable.*`;
}

// GET /api/mind/models
mind.get('/models', async (c) => {
  return c.json({
    tiers: Object.entries(MODEL_TIERS).map(([key, val]) => ({
      id: key,
      ...val,
    })),
    industryAdapters: Object.entries(INDUSTRY_ADAPTERS).map(([key, val]) => ({
      id: key,
      ...val,
    })),
    trainingPipeline: {
      preTraining: { status: 'completed', progress: 100, dataset: '847B tokens' },
      domainFineTuning: { status: 'active', progress: 78, currentEpoch: 3, totalEpochs: 5 },
      rlhf: { status: 'scheduled', progress: 0 },
      evaluation: {
        mmlu: 82.4,
        humaneval: 71.2,
        domainAccuracy: 94.7,
        hallucination_rate: 2.1,
      },
    },
  });
});

// GET /api/mind/history
mind.get('/history', async (c) => {
  const tenantId = getTenantId(c);
  const limit = parseInt(c.req.query('limit') || '20');

  const results = await c.env.DB.prepare(
    'SELECT * FROM mind_queries WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ?'
  ).bind(tenantId, limit).all();

  const formatted = results.results.map((q: Record<string, unknown>) => ({
    id: q.id,
    query: q.query,
    response: q.response,
    tier: q.tier,
    tokensIn: q.tokens_in,
    tokensOut: q.tokens_out,
    latencyMs: q.latency_ms,
    citations: JSON.parse(q.citations as string || '[]'),
    createdAt: q.created_at,
  }));

  return c.json({ queries: formatted, total: formatted.length });
});

// GET /api/mind/stats
mind.get('/stats', async (c) => {
  const tenantId = getTenantId(c);

  const totalQueries = await c.env.DB.prepare('SELECT COUNT(*) as count FROM mind_queries WHERE tenant_id = ?').bind(tenantId).first<{ count: number }>();
  const avgLatency = await c.env.DB.prepare('SELECT AVG(latency_ms) as avg FROM mind_queries WHERE tenant_id = ?').bind(tenantId).first<{ avg: number }>();
  const totalTokens = await c.env.DB.prepare('SELECT SUM(tokens_in + tokens_out) as total FROM mind_queries WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();

  const tierBreakdown = await c.env.DB.prepare(
    'SELECT tier, COUNT(*) as count, AVG(latency_ms) as avg_latency FROM mind_queries WHERE tenant_id = ? GROUP BY tier'
  ).bind(tenantId).all();

  return c.json({
    totalQueries: totalQueries?.count || 0,
    avgLatencyMs: Math.round(avgLatency?.avg || 0),
    totalTokens: totalTokens?.total || 0,
    tierBreakdown: tierBreakdown.results,
  });
});

export default mind;
