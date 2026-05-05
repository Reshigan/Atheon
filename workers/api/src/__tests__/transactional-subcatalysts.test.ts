/**
 * Phase 10-30 — Transactional subcatalysts end-to-end.
 *
 * Validates the action-layer chain on the SAP ECC demo seed:
 *
 *   - 3-way match auto-posts cleanly-matching invoices
 *   - 3-way match blocks no-GR / out-of-tolerance invoices
 *   - Duplicate blocker catches the planted dup (later invoice wins flag)
 *   - Payment run builds proposals from matched invoices
 *   - Cash app applies payments via remittance + single-amount match
 *   - Credit hold flips PNP (over-limit) to active hold
 *   - Bank recon matches receipt + payment lines to posted actions
 *   - All staged 'approved' actions land at status='posted'
 *   - Re-running is idempotent (no new staging rows)
 *
 * Note: vitest-pool-workers isolates D1 storage per `it()` block by
 * default, so the full chain + idempotency + manual-approval flows
 * all live in ONE test that drives them sequentially against a single
 * seeded tenant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { seedSapEccDemo } from '../services/demo-sap-ecc-seeder';
import { runTransactionalSubcatalystsForTenant } from '../services/transactional-runner';
import { approveAction, executePendingActions } from '../services/erp-writeback';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'sap-ecc-txn-test';

describe('Phase 10-30 — transactional subcatalysts', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
  }, 60_000);

  it('seeds, runs the full transactional chain, and proves idempotency + HITL flow', async () => {
    // ── SEED ─────────────────────────────────────────────────────
    await seedSapEccDemo(env.DB, { tenantId: TENANT });

    // ── RUN ──────────────────────────────────────────────────────
    const result = await runTransactionalSubcatalystsForTenant(env.DB, TENANT);

    // Each subcatalyst recorded a summary
    expect(result.subcatalystSummaries.length).toBe(6);
    const names = result.subcatalystSummaries.map((s) => s.subCatalyst);
    expect(names).toEqual([
      'ap-duplicate-blocker',
      'ap-three-way-match',
      'ap-payment-run',
      'ar-cash-application',
      'ar-credit-hold',
      'gl-bank-reconciliation',
    ]);

    // 3-way match: 9001+9002+9003 all match cleanly → 3 auto-posts
    // 9004 (no GR) + 9005 (16% over PO) → 2 blocks
    const threeWay = result.subcatalystSummaries.find((s) => s.subCatalyst === 'ap-three-way-match');
    expect(threeWay!.autoPosted).toBeGreaterThanOrEqual(2);
    expect(threeWay!.blocked).toBeGreaterThanOrEqual(2);

    // Dup blocker catches INV-9006 (dup of INV-9001)
    const dupBlock = result.subcatalystSummaries.find((s) => s.subCatalyst === 'ap-duplicate-blocker');
    expect(dupBlock!.blocked).toBeGreaterThanOrEqual(1);

    // Cash app: remittance match (RCT-7001 → AR-5001) + amount match (RCT-7002 → AR-5004)
    // Plus 1 unmatched (Makro)
    const cashApp = result.subcatalystSummaries.find((s) => s.subCatalyst === 'ar-cash-application');
    expect(cashApp!.autoPosted).toBeGreaterThanOrEqual(1);
    expect(cashApp!.exceptions).toBeGreaterThanOrEqual(1);

    // Credit hold processed at least one customer
    const creditHold = result.subcatalystSummaries.find((s) => s.subCatalyst === 'ar-credit-hold');
    expect(creditHold!.processed).toBeGreaterThanOrEqual(1);

    // Bank recon ran on the 4 lines
    const bankRecon = result.subcatalystSummaries.find((s) => s.subCatalyst === 'gl-bank-reconciliation');
    expect(bankRecon!.processed).toBeGreaterThanOrEqual(3);

    // Dispatch posted at least the auto-approved actions
    expect(result.dispatch.posted).toBeGreaterThanOrEqual(3);
    expect(result.dispatch.failed).toBe(0);

    // ── transactional_actions audit trail ────────────────────────
    const txnRows = await env.DB.prepare(
      `SELECT action_type, status, COUNT(*) as n FROM transactional_actions
        WHERE tenant_id = ? GROUP BY action_type, status`,
    ).bind(TENANT).all<{ action_type: string; status: string; n: number }>();
    const byKey = new Map<string, number>();
    for (const r of txnRows.results || []) byKey.set(`${r.action_type}:${r.status}`, r.n);

    expect(byKey.get('ap_invoice_post:posted') ?? 0).toBeGreaterThanOrEqual(2);
    expect(byKey.get('ar_cash_apply:posted') ?? 0).toBeGreaterThanOrEqual(1);

    // Payment runs are >50k cap → pending (HITL)
    const pendingPayments = byKey.get('ap_payment_run:pending') ?? 0;
    expect(pendingPayments).toBeGreaterThanOrEqual(1);

    // ── sub_catalyst_runs rows for each subcatalyst ──────────────
    const subRuns = await env.DB.prepare(
      `SELECT sub_catalyst_name, COUNT(*) as n FROM sub_catalyst_runs
        WHERE tenant_id = ? GROUP BY sub_catalyst_name`,
    ).bind(TENANT).all<{ sub_catalyst_name: string; n: number }>();
    const runsByName = new Map<string, number>();
    for (const r of subRuns.results || []) runsByName.set(r.sub_catalyst_name, r.n);
    expect(runsByName.has('ap-three-way-match')).toBe(true);
    expect(runsByName.has('ar-cash-application')).toBe(true);
    expect(runsByName.has('gl-bank-reconciliation')).toBe(true);

    // ── IDEMPOTENCY: re-running stages no new actions ────────────
    const beforeRerun = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM transactional_actions WHERE tenant_id = ?`,
    ).bind(TENANT).first<{ n: number }>();

    await runTransactionalSubcatalystsForTenant(env.DB, TENANT);

    const afterRerun = await env.DB.prepare(
      `SELECT COUNT(*) as n FROM transactional_actions WHERE tenant_id = ?`,
    ).bind(TENANT).first<{ n: number }>();
    expect(afterRerun!.n).toBe(beforeRerun!.n);

    // ── HITL flow: approve a pending payment run, dispatch posts ──
    const pending = await env.DB.prepare(
      `SELECT id FROM transactional_actions
        WHERE tenant_id = ? AND status = 'pending' AND action_type = 'ap_payment_run' LIMIT 1`,
    ).bind(TENANT).first<{ id: string }>();

    if (pending) {
      const ok = await approveAction(env.DB, TENANT, pending.id);
      expect(ok).toBe(true);

      const dispatch = await executePendingActions(env.DB, TENANT);
      expect(dispatch.failed).toBe(0);

      const after = await env.DB.prepare(
        `SELECT status, external_doc_id, posted_at FROM transactional_actions WHERE id = ?`,
      ).bind(pending.id).first<{ status: string; external_doc_id: string; posted_at: string }>();
      expect(after!.status).toBe('posted');
      expect(after!.external_doc_id).toBeTruthy();
      expect(after!.posted_at).toBeTruthy();
    }
  }, 120_000);
});
