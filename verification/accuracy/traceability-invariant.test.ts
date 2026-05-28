import { describe, it, expect, beforeAll } from 'vitest';
import { queryD1 } from '../lib/d1';
import { readManifest } from '../lib/manifest';

interface LineItem {
  id: string;
  period_id: string;
  tenant_id: string;
  rca_id: string | null;
  attributed_savings: number | null;
  confidence: number | null;
  evidence: string | null;
}
interface Period { id: string; total_realised_savings: number | null; }

/**
 * Shared-savings billing is a real invoice: every claimed Rand must trace to an
 * ERP-derived RCA, a confidence, and evidence. globalSetup has already reseeded
 * and materialised billing; we assert the invariant against the live D1.
 */
describe('billable_line_items traceability invariant (exhaustive)', () => {
  let tenantId = '';
  let items: LineItem[] = [];
  let periods: Period[] = [];

  beforeAll(async () => {
    tenantId = readManifest().tenantId;
    items = await queryD1<LineItem>(
      `SELECT id, period_id, tenant_id, rca_id, attributed_savings, confidence, evidence
         FROM billable_line_items WHERE tenant_id = '${tenantId}'`,
    );
    periods = await queryD1<Period>(
      `SELECT id, total_realised_savings FROM billable_periods WHERE tenant_id = '${tenantId}'`,
    );
  });

  it('produced at least one billable line item', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('every line item carries savings >= 0, confidence, evidence and a resolvable rca_id', async () => {
    const offenders: string[] = [];
    for (const li of items) {
      if (li.attributed_savings === null || li.attributed_savings < 0) offenders.push(`${li.id}: savings=${li.attributed_savings}`);
      if (li.confidence === null) offenders.push(`${li.id}: null confidence`);
      if (!li.evidence || li.evidence.trim() === '') offenders.push(`${li.id}: empty evidence`);
      if (!li.rca_id) offenders.push(`${li.id}: null rca_id`);
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);

    // rca_id must resolve to a real RCA row for this tenant.
    const rcaIds = [...new Set(items.map(i => i.rca_id).filter(Boolean))] as string[];
    const inList = rcaIds.map(id => `'${id}'`).join(',');
    const found = await queryD1<{ id: string }>(
      `SELECT id FROM root_cause_analyses WHERE tenant_id = '${tenantId}' AND id IN (${inList})`,
    );
    expect(found.length).toBe(rcaIds.length);
  });

  it('SUM(attributed_savings) reconciles to billable_periods.total_realised_savings', () => {
    for (const p of periods) {
      const sum = items
        .filter(i => i.period_id === p.id)
        .reduce((acc, i) => acc + (i.attributed_savings ?? 0), 0);
      const recorded = p.total_realised_savings ?? 0;
      // Rounding tolerance: 1 currency unit.
      expect(Math.abs(sum - recorded)).toBeLessThanOrEqual(1);
    }
  });
});
