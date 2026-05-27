/**
 * Roadmap C1 — agentic prompt-to-scenario.
 *
 * These tests cover the deterministic pieces — plan & analysis fallbacks
 * — because those are what the system relies on when Workers AI is down,
 * and what an auditor inspecting `context_data` will compare an LLM plan
 * against. The LLM path itself is exercised in the route module's
 * integration tests once they exist.
 */
import { describe, it, expect } from 'vitest';
import {
  deterministicPlan,
  deterministicAnalysis,
  type TargetedContext,
} from '../services/agentic-scenario';

function emptyContext(overrides: Partial<TargetedContext> = {}): TargetedContext {
  return {
    healthScore: 0,
    redMetrics: [],
    activeRisks: [],
    recentRuns: [],
    insights: [],
    sources: [],
    ...overrides,
  };
}

describe('agentic-scenario.deterministicPlan', () => {
  it('extracts DSO as a driver from a working-capital prompt', () => {
    const plan = deterministicPlan('What if we cut DSO from 56 to 45 days next quarter?');
    expect(plan.drivers).toContain('DSO');
    expect(plan.dataNeeded.length).toBeGreaterThan(0);
    expect(plan.confidence).toBeGreaterThan(50);
  });

  it('falls back to working-capital + risk defaults when no keyword matches', () => {
    const plan = deterministicPlan('Tell me something interesting about the business');
    expect(plan.drivers).toEqual(['Working capital', 'Risk exposure']);
    expect(plan.confidence).toBeLessThan(50);
  });

  it('caps the title at 80 chars', () => {
    const longPrompt = 'a'.repeat(200);
    const plan = deterministicPlan(longPrompt);
    expect(plan.title.length).toBeLessThanOrEqual(81);
  });

  it('matches multiple drivers when multiple are mentioned', () => {
    const plan = deterministicPlan('Improve margin while reducing risk exposure on revenue');
    expect(plan.drivers).toEqual(expect.arrayContaining(['Margin', 'Risk exposure', 'Revenue']));
  });
});

describe('agentic-scenario.deterministicAnalysis', () => {
  it('reports thin-evidence recommendation when no signals exist', () => {
    const plan = deterministicPlan('What if we sweat working capital harder?');
    const analysis = deterministicAnalysis(plan, emptyContext({ healthScore: 75 }));
    expect(analysis.recommendation).toMatch(/No active RED metrics or risks/);
    expect(analysis.confidence).toBeLessThanOrEqual(60);
  });

  it('reflects RED metrics and risks in the analysis points', () => {
    const plan = deterministicPlan('DSO and DPO improvement');
    const analysis = deterministicAnalysis(
      plan,
      emptyContext({
        healthScore: 65,
        redMetrics: [{ name: 'DSO', value: 56, unit: 'days' }],
        activeRisks: [{ title: 'AR ageing', severity: 'high', category: 'finance' }],
        sources: ['red_metrics', 'risk_alerts'],
      }),
    );
    expect(analysis.analysis_points.join(' ')).toMatch(/1 RED metric/);
    expect(analysis.analysis_points.join(' ')).toMatch(/1 active risk/);
    expect(analysis.analysis_points.join(' ')).toMatch(/red_metrics, risk_alerts/);
  });

  it('escalates to stabilise-first when health is low', () => {
    const plan = deterministicPlan('Revenue uplift via pricing');
    const analysis = deterministicAnalysis(
      plan,
      emptyContext({
        healthScore: 35,
        redMetrics: [{ name: 'Margin', value: 12 }, { name: 'AR ageing', value: 75 }],
        activeRisks: [{ title: 'Cash runway' }],
      }),
    );
    expect(analysis.recommendation).toMatch(/Stabilise base operations/);
  });

  it('produces an integer npv_impact bounded by the evidence', () => {
    const plan = deterministicPlan('Working capital optimisation');
    const analysis = deterministicAnalysis(plan, emptyContext({ healthScore: 80 }));
    expect(Number.isInteger(analysis.npv_impact)).toBe(true);
    expect(Math.abs(analysis.npv_impact)).toBeLessThan(2_000_000);
  });

  it('confidence stays within [35, 85]', () => {
    const plan = deterministicPlan('Some scenario');
    const thin = deterministicAnalysis(plan, emptyContext());
    const fat = deterministicAnalysis(plan, emptyContext({
      healthScore: 75,
      redMetrics: Array.from({ length: 6 }, (_, i) => ({ name: `m${i}` })),
      activeRisks: Array.from({ length: 6 }, (_, i) => ({ title: `r${i}` })),
    }));
    expect(thin.confidence).toBeGreaterThanOrEqual(35);
    expect(thin.confidence).toBeLessThanOrEqual(85);
    expect(fat.confidence).toBeGreaterThanOrEqual(35);
    expect(fat.confidence).toBeLessThanOrEqual(85);
  });
});
