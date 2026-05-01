/**
 * Phase 5B — every catalyst emits processContext via dispatchAction.
 *
 * Covers:
 *  1. dispatchAction injects processContext into a custom handler's output
 *     when the handler did not produce one.
 *  2. dispatchAction does NOT overwrite a handler's own processContext.
 *  3. processContext for a tenant with no profiled connection has all
 *     `sources` marked 'default' so consumers know rules are generic.
 *  4. loadProcessContextForTenant picks the most-active connection.
 *  5. scoreCatalysts adjusts AR savings up when payment_terms_days >= 45
 *     and source is high-confidence (not low-confidence/default).
 *  6. scoreCatalysts adjusts AP savings down when matching_mode = '3way'.
 *  7. scoreCatalysts adjusts invoice recon up when tolerance ≤ 2.
 *  8. scoreCatalysts does NOT adjust on low-confidence evidence.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  dispatchAction,
  registerHandler,
  registerDefaultHandler,
  _resetRegistryForTests,
  type CatalystHandler,
} from '../services/catalyst-handler-registry';
import {
  loadProcessContextForTenant,
  setProcessProfileOverrides,
  inferProcessProfile,
  DEFAULT_PROCESS_PROFILE,
} from '../services/erp-process-profile';
import { scoreCatalysts, type AssessmentConfig } from '../services/assessment-engine';
import type { TaskDefinition } from '../services/catalyst-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'phase5b-tenant';

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, slug).run();
}
async function seedAdapter(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('phase5b-adapter', 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
}
async function seedConnection(id: string, name: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'phase5b-adapter', ?, 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT, name).run();
}
async function seedInvoiceForConn(connId: string, currency: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO erp_invoices (id, tenant_id, source_system, external_id, invoice_number, invoice_date, total, currency, connection_id, status)
     VALUES (?, ?, 'SAP', ?, ?, datetime('now'), 100, ?, ?, 'open')`
  ).bind(crypto.randomUUID(), TENANT, crypto.randomUUID(), crypto.randomUUID(), currency, connId).run();
}

function makeTask(overrides: Partial<TaskDefinition> = {}): TaskDefinition {
  return {
    id: 'task-' + crypto.randomUUID(),
    clusterId: 'cluster-1',
    tenantId: TENANT,
    catalystName: 'Test',
    action: 'do_thing',
    inputData: {},
    riskLevel: 'low',
    autonomyTier: 'read-only',
    trustScore: 1,
    ...overrides,
  };
}

describe('Phase 5B — catalyst processContext + assessment profile-aware', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT, TENANT);
    await seedAdapter();
  });

  beforeEach(async () => {
    _resetRegistryForTests();
    await env.DB.prepare('DELETE FROM erp_process_profiles WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('dispatchAction injects processContext', () => {
    it('injects processContext into a handler output that does not produce one', async () => {
      await seedConnection('conn-1', 'My SAP');
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-1', { tolerance_pct: 3 });

      const h: CatalystHandler = {
        name: 'test:plain',
        match: () => true,
        execute: async () => ({ value: 42 }),
      };
      registerDefaultHandler(h);

      const out = await dispatchAction(makeTask(), env.DB);
      expect(out.value).toBe(42);
      expect(out._handler).toBe('test:plain');
      const ctx = out.processContext as { profile: { tolerance_pct: number }; connection_label: string };
      expect(ctx).toBeTruthy();
      expect(ctx.profile.tolerance_pct).toBe(3);
      expect(ctx.connection_label).toBe('My SAP');
    });

    it('does NOT overwrite a handler that produces its own processContext', async () => {
      await seedConnection('conn-2', 'Tenant SAP');
      const h: CatalystHandler = {
        name: 'test:custom-ctx',
        match: () => true,
        execute: async () => ({ value: 1, processContext: { custom: 'override' } }),
      };
      registerDefaultHandler(h);

      const out = await dispatchAction(makeTask(), env.DB);
      const ctx = out.processContext as { custom: string };
      expect(ctx.custom).toBe('override');
    });

    it('emits all-default sources when tenant has no profiled connection', async () => {
      const h: CatalystHandler = {
        name: 'test:no-profile',
        match: () => true,
        execute: async () => ({ ok: true }),
      };
      registerDefaultHandler(h);

      const out = await dispatchAction(makeTask(), env.DB);
      const ctx = out.processContext as { sources: Record<string, string>; profile: { default_currency: string } };
      expect(ctx).toBeTruthy();
      expect(ctx.sources.tolerance_pct).toBe('default');
      expect(ctx.sources.payment_terms_days).toBe('default');
      expect(ctx.profile.default_currency).toBe(DEFAULT_PROCESS_PROFILE.default_currency);
    });

    it('custom handler is preferred over default handler (and still annotated)', async () => {
      await seedConnection('conn-c', 'Custom Conn');
      const custom: CatalystHandler = {
        name: 'test:custom-runs',
        match: () => true,
        execute: async () => ({ from: 'custom' }),
      };
      const def: CatalystHandler = {
        name: 'test:default-fallback',
        match: () => true,
        execute: async () => ({ from: 'default' }),
      };
      registerHandler(custom);
      registerDefaultHandler(def);

      const out = await dispatchAction(makeTask(), env.DB);
      expect(out.from).toBe('custom');
      expect(out._handler).toBe('test:custom-runs');
      // processContext still injected for the custom handler
      expect(out.processContext).toBeTruthy();
    });
  });

  describe('loadProcessContextForTenant picks most-active connection', () => {
    it('picks the connection with the most invoices when multiple exist', async () => {
      await seedConnection('conn-small', 'Small ERP');
      await seedConnection('conn-big', 'Big ERP');
      // Make conn-big dominant
      for (let i = 0; i < 5; i++) await seedInvoiceForConn('conn-small', 'USD');
      for (let i = 0; i < 30; i++) await seedInvoiceForConn('conn-big', 'ZAR');
      // Seed an inferred profile on the big one
      await inferProcessProfile(env.DB, TENANT, 'conn-big');

      const ctx = await loadProcessContextForTenant(env.DB, TENANT);
      expect(ctx.connection_label).toBe('Big ERP');
    });
  });

  describe('scoreCatalysts honours profile (high-confidence only)', () => {
    const baseConfig: AssessmentConfig = {
      saas_price_per_user_pm: 1, onprem_licence_fee_pa: 1, hybrid_licence_fee_pa: 1,
      cf_cost_per_1m_api_calls: 1, cf_d1_cost_per_gb_pm: 1, cf_r2_cost_per_gb_pm: 1,
      cf_vectorize_cost_per_1m_queries: 1, cf_workers_ai_cost_per_1m_tokens: 1,
      cf_kv_cost_per_1m_reads: 1, cf_base_pm: 1, onprem_support_cost_pa: 1,
      onprem_update_cost_pa: 1, ar_savings_pct: 0.8, ap_savings_pct: 0.5,
      invoice_recon_savings_pct: 1.2, procurement_savings_pct: 3, workforce_savings_pct: 1,
      supply_chain_savings_pct: 1, compliance_fine_avoidance_pct: 1, maintenance_savings_pct: 1,
      deployment_model: 'saas', currency: 'ZAR', exchange_rate_to_zar: 1,
      target_users: 1, contract_years: 1,
    };
    const baseSnapshot = {
      total_ar_balance: 1_000_000, monthly_invoices: 100, overdue_invoice_count: 60,
      monthly_purchase_orders: 50, avg_invoice_value: 5_000, total_spend_12m: 10_000_000,
      months_of_data: 12, data_completeness_pct: 90, active_supplier_count: 0,
    } as Parameters<typeof scoreCatalysts>[0];

    it('boosts AR savings when payment terms ≥ 45 days (high-confidence)', () => {
      const baseline = scoreCatalysts(baseSnapshot, baseConfig, 'general');
      const baselineAr = baseline.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'Faster AR collection')!.amount_zar;
      const adjusted = scoreCatalysts(baseSnapshot, baseConfig, 'general', {
        profile: { ...DEFAULT_PROCESS_PROFILE, payment_terms_days: 60 },
        sources: { payment_terms_days: 'inferred' },
      });
      const adjustedAr = adjusted.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'Faster AR collection')!.amount_zar;
      expect(adjustedAr).toBeGreaterThan(baselineAr);
    });

    it('lowers AP savings when matching_mode = 3way (high-confidence)', () => {
      const baseline = scoreCatalysts(baseSnapshot, baseConfig, 'general');
      const baselineAp = baseline.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'AP automation')!.amount_zar;
      const adjusted = scoreCatalysts(baseSnapshot, baseConfig, 'general', {
        profile: { ...DEFAULT_PROCESS_PROFILE, matching_mode: '3way' },
        sources: { matching_mode: 'human' },
      });
      const adjustedAp = adjusted.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'AP automation')!.amount_zar;
      expect(adjustedAp).toBeLessThan(baselineAp);
    });

    it('boosts Invoice Recon savings when tolerance ≤ 2 (high-confidence)', () => {
      const baseline = scoreCatalysts(baseSnapshot, baseConfig, 'general');
      const baselineRecon = baseline.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === '3-way invoice reconciliation')!.amount_zar;
      const adjusted = scoreCatalysts(baseSnapshot, baseConfig, 'general', {
        profile: { ...DEFAULT_PROCESS_PROFILE, tolerance_pct: 2 },
        sources: { tolerance_pct: 'human' },
      });
      const adjustedRecon = adjusted.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === '3-way invoice reconciliation')!.amount_zar;
      expect(adjustedRecon).toBeGreaterThan(baselineRecon);
    });

    it('does NOT adjust on low-confidence evidence', () => {
      const baseline = scoreCatalysts(baseSnapshot, baseConfig, 'general');
      const baselineAr = baseline.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'Faster AR collection')!.amount_zar;
      const adjusted = scoreCatalysts(baseSnapshot, baseConfig, 'general', {
        profile: { ...DEFAULT_PROCESS_PROFILE, payment_terms_days: 60 },
        sources: { payment_terms_days: 'low-confidence' },
      });
      const adjustedAr = adjusted.find((c) => c.catalyst_name === 'Finance')!.saving_components
        .find((s) => s.label === 'Faster AR collection')!.amount_zar;
      expect(adjustedAr).toBe(baselineAr);
    });
  });
});
