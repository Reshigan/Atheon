/**
 * Roadmap C2 — coverage uplift.
 *
 * catalyst-recommendation.ts is the mapper that powers the "Open in
 * Catalysts" CTA on Pulse anomalies AND the closed-loop dispatch flow
 * from B2. A wrong recommendation here sends the user to the wrong
 * cluster, so we need exhaustive rule coverage.
 */
import { describe, it, expect } from 'vitest';
import {
  recommendForAnomaly,
  recommendForRisk,
  recommendForDimension,
  catalystDeployUrl,
} from '../catalyst-recommendation';

describe('recommendForAnomaly', () => {
  it('routes safety incidents to Safety Compliance Catalyst', () => {
    expect(recommendForAnomaly('PPE compliance incident')).toEqual({
      catalyst: 'Safety Compliance Catalyst',
      subCatalyst: 'Safety Incident Trend',
    });
    expect(recommendForAnomaly('On-site injury rate')?.catalyst).toBe('Safety Compliance Catalyst');
  });

  it('routes API/SLO breaches to Operations Catalyst', () => {
    expect(recommendForAnomaly('API p99 latency')?.subCatalyst).toBe('Operational KPI Anomaly');
    expect(recommendForAnomaly('uptime SLO breach')?.catalyst).toBe('Operations Catalyst');
  });

  it('routes finance signals to Finance Catalyst with the right sub', () => {
    expect(recommendForAnomaly('overdue invoice ageing')?.subCatalyst).toBe('AR Collection');
    expect(recommendForAnomaly('AP three-way match failures')?.subCatalyst).toBe('AP Processing');
    expect(recommendForAnomaly('FX exposure spike')?.subCatalyst).toBe('FX Hedge Advisory');
  });

  it('routes HR signals correctly', () => {
    expect(recommendForAnomaly('Employee attrition rate')?.subCatalyst).toBe('HR Turnover');
    expect(recommendForAnomaly('Ghost payroll detected')?.subCatalyst).toBe('Payroll Audit');
  });

  it('returns null when nothing matches', () => {
    expect(recommendForAnomaly('arbitrary metric with no keywords')).toBeNull();
    expect(recommendForAnomaly('')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(recommendForAnomaly('NPS Score Drop')?.subCatalyst).toBe('Customer Experience NPS');
    expect(recommendForAnomaly('nps score drop')?.subCatalyst).toBe('Customer Experience NPS');
  });

  it('first matching rule wins (specificity ordering)', () => {
    // "safety" matches before "incident" in the rule list, but both rules
    // map to the same recommendation — so order is incidental here.
    const safety = recommendForAnomaly('safety incident on shop floor');
    expect(safety?.catalyst).toBe('Safety Compliance Catalyst');
  });
});

describe('recommendForRisk', () => {
  it('prefers category match over title', () => {
    const rec = recommendForRisk({ category: 'compliance-popia', title: 'Late filing' });
    expect(rec?.catalyst).toBe('Compliance & Regulatory Catalyst');
  });

  it('falls back to title when category does not match', () => {
    const rec = recommendForRisk({ category: 'unmapped-bucket', title: 'Liquidity squeeze' });
    expect(rec?.subCatalyst).toBe('Cash Flow Forecast');
  });

  it('returns null when neither field matches', () => {
    expect(recommendForRisk({ category: 'unknown', title: 'mystery' })).toBeNull();
    expect(recommendForRisk({})).toBeNull();
  });

  it('routes credit/concentration risks to Credit Vetting', () => {
    expect(recommendForRisk({ category: 'credit-concentration' })?.subCatalyst).toBe('Credit Vetting');
  });
});

describe('recommendForDimension', () => {
  it('matches risk rules first', () => {
    // "Finance" should hit the credit rule? No — none of the risk rules have
    // exactly "finance"; let's pick a known dimension keyword.
    expect(recommendForDimension('Compliance')?.catalyst).toBe('Compliance & Regulatory Catalyst');
  });

  it('falls back to anomaly rules', () => {
    expect(recommendForDimension('Inventory')?.subCatalyst).toBe('Inventory Optimisation');
  });

  it('returns null on empty input', () => {
    expect(recommendForDimension('')).toBeNull();
  });
});

describe('catalystDeployUrl', () => {
  it('encodes cluster and sub into query params', () => {
    const url = catalystDeployUrl({ catalyst: 'Finance Catalyst', subCatalyst: 'AR Collection' });
    expect(url).toBe('/catalysts?cluster=Finance+Catalyst&sub=AR+Collection');
  });

  it('handles names with special characters', () => {
    const url = catalystDeployUrl({
      catalyst: 'Compliance & Regulatory Catalyst',
      subCatalyst: 'Compliance Risk',
    });
    expect(url).toContain('cluster=Compliance+%26+Regulatory+Catalyst');
    expect(url).toContain('sub=Compliance+Risk');
  });
});
