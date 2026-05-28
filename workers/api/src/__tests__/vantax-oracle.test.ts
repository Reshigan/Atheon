import { describe, it, expect } from 'vitest';
import { VANTAX_ORACLE, formatDataQuality } from '../services/vantax-demo';

describe('VANTAX_ORACLE — canonical reconciliation ground truth', () => {
  it('encodes the known-good seeded counts', () => {
    expect(VANTAX_ORACLE.grir).toEqual({ total: 80, matched: 65, priceVariances: 7, unmatched: 8 });
    expect(VANTAX_ORACLE.bank).toEqual({ total: 80, reconciled: 55, fees: 10, unmatchedEft: 15 });
    expect(VANTAX_ORACLE.inventory).toEqual({ total: 18, matched: 10, shortage: 4, surplus: 4 });
    expect(VANTAX_ORACLE.salesOrder).toEqual({ total: 80, matched: 55, amountVariances: 10, statusMismatch: 7, unmatched: 8 });
  });

  it('every catalyst category sums to its total', () => {
    const g = VANTAX_ORACLE.grir;
    expect(g.matched + g.priceVariances + g.unmatched).toBe(g.total);
    const b = VANTAX_ORACLE.bank;
    expect(b.reconciled + b.fees + b.unmatchedEft).toBe(b.total);
    const i = VANTAX_ORACLE.inventory;
    expect(i.matched + i.shortage + i.surplus).toBe(i.total);
    const s = VANTAX_ORACLE.salesOrder;
    expect(s.matched + s.amountVariances + s.statusMismatch + s.unmatched).toBe(s.total);
  });

  it('derives the seed dataQuality summary from the oracle', () => {
    const dq = formatDataQuality(VANTAX_ORACLE);
    expect(dq.grir).toBe('65 of 80 POs match invoices exactly (81.25%), 7 price variances (8.75%), 8 unmatched (10%)');
    expect(dq.bank).toBe('55 of 80 bank transactions reconciled (68.75%), 10 bank fees, 15 unmatched EFTs');
    expect(dq.inventory).toBe('10 of 18 products match exactly (55.56%), 4 shortage (shrinkage), 4 surplus (receiving errors)');
    expect(dq.salesOrder).toBe('55 of 80 SD invoices match AR postings exactly (68.75%), 10 amount variances, 7 status mismatches, 8 unmatched');
  });
});
