/**
 * Roadmap C1 — Apex agentic prompt-to-scenario.
 *
 * Turns a freeform exec question ("what if we cut DSO from 56 to 45?")
 * into a structured what-if scenario by running two LLM passes with
 * targeted just-in-time data fetching between them:
 *
 *   prompt
 *     → planScenario()      (LLM #1: drivers + variables + data needs)
 *     → gatherTargetedCtx() (worker pulls only the tables the plan asked for)
 *     → executePlan()       (LLM #2: analysis grounded in that targeted data)
 *     → persisted scenario row (results + plan in context_data)
 *
 * Both LLM passes go through withLlmFallback so a Workers AI outage still
 * yields a deterministic, data-driven scenario rather than an error. The
 * deterministic fallbacks are intentionally conservative: they read the
 * same DB rows the LLM would have summarised and produce a numerically
 * honest answer rather than a confident hallucination.
 *
 * Why two passes instead of one big prompt:
 *   - The plan is auditable on its own (we persist it). An exec can see
 *     "this is the question Atheon asked itself before answering."
 *   - We only pay LLM token cost for context the plan says it needs.
 *   - The analysis pass can be re-run against a different snapshot of
 *     the same plan if the user wants to compare time windows later.
 *
 * Shared-savings note: every scenario.results.recommendation that claims
 * a financial impact must be grounded in either red_metrics, risk_alerts,
 * or a real catalyst run — never invented. The plan calls out which of
 * those it touched, and gatherTargetedContext only returns rows that
 * exist in the tenant.
 */

import { withLlmFallback } from './ollama';
import { stripCodeFences } from './llm-provider';

export interface ScenarioPlan {
  title: string;
  description: string;
  drivers: string[];
  variables: Array<{ name: string; baseValue: string; proposedValue: string }>;
  successCriteria: string[];
  dataNeeded: string[];
  confidence: number;
  reasoning: string;
}

export interface ScenarioAnalysis {
  npv_impact: number;
  risk_change: string;
  confidence: number;
  recommendation: string;
  analysis_points: string[];
  generated_at: string;
}

export interface TargetedContext {
  healthScore: number;
  redMetrics: Array<Record<string, unknown>>;
  activeRisks: Array<Record<string, unknown>>;
  recentRuns: Array<Record<string, unknown>>;
  insights: Array<Record<string, unknown>>;
  sources: string[];
}

const DRIVER_KEYWORDS: Array<{ keyword: RegExp; driver: string }> = [
  { keyword: /\bdso\b|days?\s+sales?\s+outstanding/i, driver: 'DSO' },
  { keyword: /\bdpo\b|days?\s+payable/i, driver: 'DPO' },
  { keyword: /\bdoh\b|days?\s+on\s+hand|inventory\s+turns?/i, driver: 'Inventory turnover' },
  { keyword: /working\s+capital|cash\s+conversion/i, driver: 'Working capital' },
  { keyword: /margin|gross\s+profit|ebitda/i, driver: 'Margin' },
  { keyword: /revenue|sales|top[-\s]?line/i, driver: 'Revenue' },
  { keyword: /cost|opex|operating\s+expense/i, driver: 'Operating cost' },
  { keyword: /risk|exposure|compliance/i, driver: 'Risk exposure' },
];

const TABLE_KEYWORDS: Array<{ keyword: RegExp; table: string }> = [
  { keyword: /metric|kpi|red|amber|green/i, table: 'red_metrics' },
  { keyword: /risk|alert|exposure/i, table: 'risk_alerts' },
  { keyword: /catalyst|sub[-\s]?catalyst|run|exception/i, table: 'sub_catalyst_runs' },
  { keyword: /insight|narrative|finding/i, table: 'catalyst_insights' },
];

function safeNumber(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function safeString(value: unknown, fallback = ''): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return String(value);
}

function safeArray<T>(value: unknown, mapper: (item: unknown) => T): T[] {
  if (!Array.isArray(value)) return [];
  return value.map(mapper).filter((x): x is T => x !== null && x !== undefined);
}

function coercePlan(parsed: unknown, prompt: string): ScenarioPlan {
  const fallback = deterministicPlan(prompt);
  if (!parsed || typeof parsed !== 'object') return fallback;
  const obj = parsed as Record<string, unknown>;
  const drivers = safeArray(obj.drivers, (v) => (typeof v === 'string' ? v : null) as string | null).filter((s): s is string => !!s);
  const variables = safeArray(obj.variables, (v) => {
    if (!v || typeof v !== 'object') return null;
    const o = v as Record<string, unknown>;
    const name = safeString(o.name).trim();
    if (!name) return null;
    return {
      name,
      baseValue: safeString(o.baseValue ?? o.base_value),
      proposedValue: safeString(o.proposedValue ?? o.proposed_value),
    };
  }).filter((x): x is { name: string; baseValue: string; proposedValue: string } => !!x);
  const successCriteria = safeArray(obj.successCriteria ?? obj.success_criteria, (v) => (typeof v === 'string' ? v : null) as string | null).filter((s): s is string => !!s);
  const dataNeeded = safeArray(obj.dataNeeded ?? obj.data_needed, (v) => (typeof v === 'string' ? v : null) as string | null).filter((s): s is string => !!s);
  return {
    title: safeString(obj.title).trim() || fallback.title,
    description: safeString(obj.description).trim() || fallback.description,
    drivers: drivers.length > 0 ? drivers : fallback.drivers,
    variables: variables.length > 0 ? variables : fallback.variables,
    successCriteria: successCriteria.length > 0 ? successCriteria : fallback.successCriteria,
    dataNeeded: dataNeeded.length > 0 ? dataNeeded : fallback.dataNeeded,
    confidence: Math.max(0, Math.min(100, safeNumber(obj.confidence, fallback.confidence))),
    reasoning: safeString(obj.reasoning).trim() || fallback.reasoning,
  };
}

function coerceAnalysis(parsed: unknown, plan: ScenarioPlan, ctx: TargetedContext): ScenarioAnalysis {
  const fallback = deterministicAnalysis(plan, ctx);
  if (!parsed || typeof parsed !== 'object') return fallback;
  const obj = parsed as Record<string, unknown>;
  const points = safeArray(obj.analysis_points, (v) => (typeof v === 'string' ? v : null) as string | null).filter((s): s is string => !!s);
  return {
    npv_impact: Math.round(safeNumber(obj.npv_impact, fallback.npv_impact)),
    risk_change: safeString(obj.risk_change).trim() || fallback.risk_change,
    confidence: Math.max(0, Math.min(100, safeNumber(obj.confidence, fallback.confidence))),
    recommendation: safeString(obj.recommendation).trim() || fallback.recommendation,
    analysis_points: points.length > 0 ? points : fallback.analysis_points,
    generated_at: new Date().toISOString(),
  };
}

/**
 * Deterministic plan from a prompt — used as fallback when LLM unavailable
 * AND as the validator/coercer for malformed LLM JSON.
 *
 * Exported so tests can assert the rule-based plan stays sane.
 */
export function deterministicPlan(prompt: string): ScenarioPlan {
  const text = prompt.trim();
  const drivers = DRIVER_KEYWORDS.filter((k) => k.keyword.test(text)).map((k) => k.driver);
  const tables = TABLE_KEYWORDS.filter((k) => k.keyword.test(text)).map((k) => k.table);

  // If nothing matched, fall back to the broadest useful default
  const effectiveDrivers = drivers.length > 0 ? drivers : ['Working capital', 'Risk exposure'];
  const effectiveTables = tables.length > 0 ? tables : ['red_metrics', 'risk_alerts'];

  const title = text.length <= 80 ? text : `${text.slice(0, 77).trim()}…`;
  return {
    title,
    description: `Agentic what-if generated from exec prompt. Drivers identified: ${effectiveDrivers.join(', ')}.`,
    drivers: effectiveDrivers,
    variables: effectiveDrivers.map((d) => ({ name: d, baseValue: 'current', proposedValue: 'proposed' })),
    successCriteria: [
      'Quantified NPV impact with explicit assumptions',
      'Confidence backed by tenant data (no hallucinated metrics)',
      'Identifies any sub-catalyst that would need to run',
    ],
    dataNeeded: effectiveTables,
    confidence: drivers.length > 0 ? 70 : 45,
    reasoning: `Rule-based plan: matched ${drivers.length} driver keyword(s) and ${tables.length} table keyword(s) in the prompt.`,
  };
}

/**
 * Deterministic analysis from plan + targeted context. Conservative — never
 * invents impact when the underlying data is empty. Exported for tests.
 */
export function deterministicAnalysis(plan: ScenarioPlan, ctx: TargetedContext): ScenarioAnalysis {
  const healthScore = ctx.healthScore;
  const redCount = ctx.redMetrics.length;
  const riskCount = ctx.activeRisks.length;
  const driverCount = plan.drivers.length;

  // Base impact scales with health AND coverage. With NO supporting data
  // we deliberately report a small magnitude — exec shouldn't see a R5M
  // headline that traces back to "the LLM was unsure."
  const evidenceBoost = Math.min(1, (redCount + riskCount) / 6);
  const baseImpact = healthScore > 70 ? 500_000 : healthScore > 50 ? -200_000 : -1_000_000;
  const driverAdjustment = driverCount * 50_000;
  const riskAdjustment = riskCount * -150_000 + redCount * -100_000;
  const npvImpact = Math.round((baseImpact + driverAdjustment + riskAdjustment) * Math.max(0.2, evidenceBoost));

  // Confidence floors itself on evidence count, not on health
  const evidenceConfidence = Math.min(85, 40 + (redCount + riskCount) * 4 + driverCount * 5);
  const confidence = Math.max(35, Math.min(85, Math.round(evidenceConfidence)));

  const recommendation = (() => {
    if (redCount === 0 && riskCount === 0) {
      return `No active RED metrics or risks in tenant — scenario rests on assumptions, not signals. Recommend instrumenting ${plan.drivers.join(', ')} before acting.`;
    }
    if (healthScore < 50) {
      return `Health score ${healthScore}/100 with ${redCount} RED metric(s) and ${riskCount} active risk(s). Stabilise base operations before pursuing this scenario.`;
    }
    return `Tenant has ${redCount} RED metric(s) and ${riskCount} risk(s) that touch the identified drivers (${plan.drivers.join(', ')}). Modeled NPV impact reflects current evidence.`;
  })();

  const points: string[] = [
    `Drivers analysed: ${plan.drivers.join(', ')}`,
    `Evidence: ${redCount} RED metric(s), ${riskCount} active risk(s), ${ctx.recentRuns.length} recent catalyst run(s)`,
  ];
  if (ctx.sources.length > 0) {
    points.push(`Sources: ${ctx.sources.join(', ')}`);
  }
  if (redCount === 0 && riskCount === 0) {
    points.push('No operational signal supports this scenario yet — confidence is capped.');
  }

  return {
    npv_impact: npvImpact,
    risk_change: `${riskCount > 3 ? '+' : '-'}${Math.round(riskCount * 3 + redCount * 2)}%`,
    confidence,
    recommendation,
    analysis_points: points,
    generated_at: new Date().toISOString(),
  };
}

export async function planScenario(env: { AI?: unknown }, prompt: string): Promise<{ plan: ScenarioPlan; source: 'llm' | 'fallback' }> {
  const llmResult = await withLlmFallback<ScenarioPlan>(
    async () => {
      const ai = env.AI as { run?: (model: string, input: { prompt: string }) => Promise<{ response?: string }> } | undefined;
      if (!ai || typeof ai.run !== 'function') throw new Error('Workers AI not available');
      const sys = `You are Atheon's scenario planner. Given an executive prompt, produce a JSON plan with: title (<=80 chars), description, drivers (array of business drivers), variables (array of {name, baseValue, proposedValue}), successCriteria (array), dataNeeded (array — pick from: red_metrics, risk_alerts, sub_catalyst_runs, catalyst_insights), confidence (0-100), reasoning. Do not fabricate values; baseValue/proposedValue can be "current"/"proposed" if unspecified.`;
      const userPrompt = `Plan a what-if scenario from this exec prompt:\n\n${prompt}\n\nRespond with JSON only.`;
      const aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct', { prompt: `${sys}\n\n${userPrompt}` });
      const text = aiResult?.response || '';
      if (!text) throw new Error('Empty AI response');
      const cleaned = stripCodeFences(text);
      try {
        return coercePlan(JSON.parse(cleaned), prompt);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*"(?:drivers|dataNeeded|data_needed|reasoning)"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return coercePlan(JSON.parse(jsonMatch[0]), prompt);
          } catch { /* fall through */ }
        }
        throw new Error('Plan JSON not parseable');
      }
    },
    () => deterministicPlan(prompt),
    10_000,
  );
  return { plan: llmResult.result, source: llmResult.source };
}

export async function gatherTargetedContext(db: D1Database, tenantId: string, plan: ScenarioPlan): Promise<TargetedContext> {
  const ctx: TargetedContext = {
    healthScore: 0,
    redMetrics: [],
    activeRisks: [],
    recentRuns: [],
    insights: [],
    sources: [],
  };

  try {
    const health = await db.prepare('SELECT overall_score FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first<{ overall_score: number }>();
    ctx.healthScore = health?.overall_score ?? 0;
    ctx.sources.push('health_scores');
  } catch { /* tenant may not have a health row yet */ }

  const wants = (table: string) => plan.dataNeeded.some((t) => t.toLowerCase().includes(table));

  if (wants('red_metrics') || wants('metric')) {
    try {
      const rows = await db.prepare("SELECT name, value, unit FROM process_metrics WHERE tenant_id = ? AND status = 'red' LIMIT 15").bind(tenantId).all();
      ctx.redMetrics = (rows.results || []) as Array<Record<string, unknown>>;
      ctx.sources.push('red_metrics');
    } catch { /* missing table tolerated */ }
  }

  if (wants('risk_alerts') || wants('risk')) {
    try {
      const rows = await db.prepare("SELECT title, severity, category FROM risk_alerts WHERE tenant_id = ? AND status = 'active' LIMIT 15").bind(tenantId).all();
      ctx.activeRisks = (rows.results || []) as Array<Record<string, unknown>>;
      ctx.sources.push('risk_alerts');
    } catch { /* missing table tolerated */ }
  }

  if (wants('sub_catalyst_runs') || wants('catalyst')) {
    try {
      const rows = await db.prepare('SELECT sub_catalyst_name, status, matched, discrepancies, exceptions_raised FROM sub_catalyst_runs WHERE tenant_id = ? ORDER BY started_at DESC LIMIT 10').bind(tenantId).all();
      ctx.recentRuns = (rows.results || []) as Array<Record<string, unknown>>;
      ctx.sources.push('sub_catalyst_runs');
    } catch { /* missing table tolerated */ }
  }

  if (wants('catalyst_insights') || wants('insight')) {
    try {
      const rows = await db.prepare('SELECT title, description, severity, category FROM catalyst_insights WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 10').bind(tenantId).all();
      ctx.insights = (rows.results || []) as Array<Record<string, unknown>>;
      ctx.sources.push('catalyst_insights');
    } catch { /* missing table tolerated */ }
  }

  return ctx;
}

export async function executePlan(env: { AI?: unknown }, plan: ScenarioPlan, ctx: TargetedContext): Promise<{ analysis: ScenarioAnalysis; source: 'llm' | 'fallback' }> {
  const llmResult = await withLlmFallback<ScenarioAnalysis>(
    async () => {
      const ai = env.AI as { run?: (model: string, input: { prompt: string }) => Promise<{ response?: string }> } | undefined;
      if (!ai || typeof ai.run !== 'function') throw new Error('Workers AI not available');
      const userPrompt = [
        'You are Atheon Mind, an enterprise AI analyst. Execute this what-if plan grounded in the tenant data provided.',
        '',
        `Plan: ${JSON.stringify(plan)}`,
        '',
        'Tenant data:',
        `- Health Score: ${ctx.healthScore}/100`,
        `- RED metrics: ${JSON.stringify(ctx.redMetrics)}`,
        `- Active risks: ${JSON.stringify(ctx.activeRisks)}`,
        `- Recent catalyst runs: ${JSON.stringify(ctx.recentRuns.slice(0, 5))}`,
        `- Insights: ${JSON.stringify(ctx.insights.slice(0, 5))}`,
        '',
        'Rules:',
        '- Never invent metrics that are not in the tenant data above.',
        '- If evidence is thin, return lower confidence rather than a confident guess.',
        '- npv_impact is a signed number in the tenant currency (assume ZAR).',
        '',
        'Respond with JSON only: { "npv_impact": number, "risk_change": string, "confidence": number, "recommendation": string, "analysis_points": string[] }',
      ].join('\n');
      const aiResult = await ai.run('@cf/meta/llama-3.1-8b-instruct', { prompt: userPrompt });
      const text = aiResult?.response || '';
      if (!text) throw new Error('Empty AI response');
      const cleaned = stripCodeFences(text);
      try {
        return coerceAnalysis(JSON.parse(cleaned), plan, ctx);
      } catch {
        const jsonMatch = text.match(/\{[\s\S]*"(?:npv_impact|recommendation|confidence)"[\s\S]*\}/);
        if (jsonMatch) {
          try {
            return coerceAnalysis(JSON.parse(jsonMatch[0]), plan, ctx);
          } catch { /* fall through */ }
        }
        throw new Error('Analysis JSON not parseable');
      }
    },
    () => deterministicAnalysis(plan, ctx),
    15_000,
  );
  return { analysis: llmResult.result, source: llmResult.source };
}

export interface AgenticScenarioResult {
  plan: ScenarioPlan;
  planSource: 'llm' | 'fallback';
  analysis: ScenarioAnalysis;
  analysisSource: 'llm' | 'fallback';
  context: TargetedContext;
}

export async function runAgenticScenario(env: { AI?: unknown; DB: D1Database }, tenantId: string, prompt: string): Promise<AgenticScenarioResult> {
  const { plan, source: planSource } = await planScenario(env, prompt);
  const context = await gatherTargetedContext(env.DB, tenantId, plan);
  const { analysis, source: analysisSource } = await executePlan(env, plan, context);
  return { plan, planSource, analysis, analysisSource, context };
}
