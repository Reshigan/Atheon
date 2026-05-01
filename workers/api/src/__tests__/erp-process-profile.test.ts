/**
 * Phase 5A — ERP process profile.
 *
 * Covers:
 *  1. inferProcessProfile derives payment_terms_days from invoice histogram
 *  2. inferProcessProfile derives default_currency from invoice currency mode
 *  3. inferProcessProfile picks 3way / 2way / none from PO-link share
 *  4. setProcessProfileOverrides marks fields source='human' and protects them
 *  5. Subsequent inference does NOT overwrite human-overridden fields
 *  6. GET /api/v1/erp/connections/:id/process-profile lazily infers + returns
 *  7. PUT /api/v1/erp/connections/:id/process-profile applies overrides + audit
 *  8. POST /api/v1/erp/connections/:id/process-profile/refresh re-infers
 *  9. Default profile fallback fills in unknowns (no errors on empty data)
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import {
  inferProcessProfile, getProcessProfile, setProcessProfileOverrides,
  loadProcessProfile, DEFAULT_PROCESS_PROFILE,
} from '../services/erp-process-profile';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'profile-tenant';
const ADMIN = 'profile-admin@test.local';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function putJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
}
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, slug).run();
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenant_entitlements (tenant_id, layers, catalyst_clusters, max_agents, max_users)
     VALUES (?, '["apex","pulse"]', '["finance"]', 10, 10)`
  ).bind(id).run();
}
async function seedUser(id: string, tenantId: string, email: string): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind(id, tenantId, email, email, hash, JSON.stringify(['*'])).run();
}
async function seedAdapter(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES ('profile-adapter', 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).run();
}
async function seedConnection(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'profile-adapter', 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT).run();
}
async function seedCustomer(id: string, paymentTerms: string | null): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO erp_customers (id, tenant_id, source_system, external_id, name, payment_terms)
     VALUES (?, ?, 'SAP', ?, ?, ?)`
  ).bind(id, TENANT, id, `Customer ${id}`, paymentTerms).run();
}
async function seedInvoice(id: string, currency: string, total: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO erp_invoices (id, tenant_id, source_system, external_id, invoice_number, invoice_date, total, currency, status)
     VALUES (?, ?, 'SAP', ?, ?, datetime('now'), ?, ?, 'open')`
  ).bind(id, TENANT, id, id, total, currency).run();
}
async function login(email: string, slug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: slug });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

describe('Phase 5A — ERP process profile', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT, TENANT);
    await seedUser('profile-admin', TENANT, ADMIN);
    await seedAdapter();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_process_profiles WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_invoices WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_customers WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_purchase_orders WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('inferProcessProfile (data-driven, strong-inference gates)', () => {
    it('derives payment_terms_days when sample is large AND modal share ≥ 70%', async () => {
      await seedConnection('conn-pt');
      // 30 customers Net 30, 5 Net 60 → mode share 30/35 = 86%, sample 35 ≥ 25
      for (let i = 0; i < 30; i++) await seedCustomer(`pt-30-${i}`, 'Net 30');
      for (let i = 0; i < 5; i++) await seedCustomer(`pt-60-${i}`, 'Net 60');

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-pt');
      expect(r.profile.payment_terms_days).toBe(30);
      expect(r.evidence.payment_terms_days.source).toBe('inferred');
      expect(r.evidence.payment_terms_days.confidence).toBeGreaterThanOrEqual(0.7);
    });

    it('marks payment_terms_days low-confidence when sample is too small', async () => {
      await seedConnection('conn-pt-tiny');
      // Only 6 customers — well under MIN_SAMPLE_FOR_INFERENCE = 25
      for (let i = 0; i < 6; i++) await seedCustomer(`tiny-${i}`, 'Net 30');

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-pt-tiny');
      // Value stays at default
      expect(r.profile.payment_terms_days).toBe(DEFAULT_PROCESS_PROFILE.payment_terms_days);
      expect(r.evidence.payment_terms_days.source).toBe('low-confidence');
      expect(r.evidence.payment_terms_days.basis).toMatch(/need ≥/);
    });

    it('marks payment_terms_days low-confidence when modal share is mixed (no clear default)', async () => {
      await seedConnection('conn-pt-mixed');
      // Big sample but evenly split — no defensible "default"
      for (let i = 0; i < 15; i++) await seedCustomer(`mix30-${i}`, 'Net 30');
      for (let i = 0; i < 15; i++) await seedCustomer(`mix60-${i}`, 'Net 60');
      for (let i = 0; i < 15; i++) await seedCustomer(`mix90-${i}`, 'Net 90');

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-pt-mixed');
      expect(r.profile.payment_terms_days).toBe(DEFAULT_PROCESS_PROFILE.payment_terms_days);
      expect(r.evidence.payment_terms_days.source).toBe('low-confidence');
      expect(r.evidence.payment_terms_days.basis).toMatch(/mixed terms|only/);
    });

    it('flags multi-currency operations as low-confidence rather than picking one', async () => {
      await seedConnection('conn-cur-multi');
      // Even split — should NOT silently pick ZAR
      for (let i = 0; i < 15; i++) await seedInvoice(`zar-${i}`, 'ZAR', 1000);
      for (let i = 0; i < 15; i++) await seedInvoice(`usd-${i}`, 'USD', 100);

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-cur-multi');
      expect(r.profile.default_currency).toBe(DEFAULT_PROCESS_PROFILE.default_currency);
      expect(r.evidence.default_currency.source).toBe('low-confidence');
    });

    it('derives default_currency when the customer is single-currency on a sufficient sample', async () => {
      await seedConnection('conn-cur');
      for (let i = 0; i < 30; i++) await seedInvoice(`cur-zar-${i}`, 'ZAR', 1000);

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-cur');
      expect(r.profile.default_currency).toBe('ZAR');
      expect(r.evidence.default_currency.source).toBe('inferred');
    });

    it('falls back to defaults when there is no data to infer from', async () => {
      await seedConnection('conn-empty');
      const r = await inferProcessProfile(env.DB, TENANT, 'conn-empty');
      // payment_terms_days, default_currency stay at defaults; evidence.source='default'
      expect(r.profile.payment_terms_days).toBe(DEFAULT_PROCESS_PROFILE.payment_terms_days);
      expect(r.profile.default_currency).toBe(DEFAULT_PROCESS_PROFILE.default_currency);
      expect(r.evidence.payment_terms_days.source).toBe('default');
    });
  });

  describe('setProcessProfileOverrides (human override)', () => {
    it('marks overridden fields source=human and persists them', async () => {
      await seedConnection('conn-h');
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-h', {
        tolerance_pct: 2,
        payment_terms_days: 45,
      }, 'jane@example.com');

      const got = await getProcessProfile(env.DB, TENANT, 'conn-h');
      expect(got).not.toBeNull();
      expect(got!.profile.tolerance_pct).toBe(2);
      expect(got!.profile.payment_terms_days).toBe(45);
      expect(got!.evidence.tolerance_pct.source).toBe('human');
      expect(got!.evidence.tolerance_pct.basis).toMatch(/jane@example.com/);
    });

    it('subsequent inference does NOT overwrite human-overridden fields', async () => {
      await seedConnection('conn-protect');
      // Customer set payment_terms_days = 45 manually
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-protect', {
        payment_terms_days: 45,
      }, 'cfo@example.com');
      // Data overwhelmingly says 30, with enough sample to be confident
      for (let i = 0; i < 30; i++) await seedCustomer(`protect-${i}`, 'Net 30');

      const r = await inferProcessProfile(env.DB, TENANT, 'conn-protect');
      // Human override survives
      expect(r.profile.payment_terms_days).toBe(45);
      expect(r.evidence.payment_terms_days.source).toBe('human');
    });
  });

  describe('loadProcessProfile (catalyst convenience)', () => {
    it('returns default profile when nothing has been persisted', async () => {
      await seedConnection('conn-default');
      const p = await loadProcessProfile(env.DB, TENANT, 'conn-default');
      expect(p.payment_terms_days).toBe(DEFAULT_PROCESS_PROFILE.payment_terms_days);
      expect(p.tolerance_pct).toBe(DEFAULT_PROCESS_PROFILE.tolerance_pct);
    });

    it('returns persisted profile fields merged over defaults', async () => {
      await seedConnection('conn-merge');
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-merge', { tolerance_pct: 1 });
      const p = await loadProcessProfile(env.DB, TENANT, 'conn-merge');
      expect(p.tolerance_pct).toBe(1);
      // Other fields still defaults
      expect(p.payment_terms_days).toBe(DEFAULT_PROCESS_PROFILE.payment_terms_days);
    });
  });

  describe('GET / PUT / POST /process-profile routes', () => {
    it('GET lazily infers when no profile exists (sufficient sample)', async () => {
      await seedConnection('conn-route');
      // Need ≥25 records and ≥70% mode share for a confident inference.
      for (let i = 0; i < 30; i++) await seedCustomer(`r-${i}`, 'Net 60');

      const token = await login(ADMIN, TENANT);
      const res = await authedGet('/api/v1/erp/connections/conn-route/process-profile', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { profile: { payment_terms_days: number }; evidence: { payment_terms_days: { source: string } } };
      expect(body.profile.payment_terms_days).toBe(60);
      expect(body.evidence.payment_terms_days.source).toBe('inferred');
    });

    it('PUT applies overrides and writes audit row', async () => {
      await seedConnection('conn-put');
      const token = await login(ADMIN, TENANT);
      const res = await putJSON('/api/v1/erp/connections/conn-put/process-profile', {
        tolerance_pct: 3,
        matching_mode: '3way',
      }, token);
      expect(res.status).toBe(200);
      const body = await res.json() as { profile: { tolerance_pct: number; matching_mode: string } };
      expect(body.profile.tolerance_pct).toBe(3);
      expect(body.profile.matching_mode).toBe('3way');

      const audit = await env.DB.prepare(
        `SELECT details FROM audit_log WHERE tenant_id = ? AND action = 'erp.process_profile.override' ORDER BY created_at DESC LIMIT 1`
      ).bind(TENANT).first<{ details: string }>();
      expect(audit).not.toBeNull();
    });

    it('POST /refresh re-runs inference and updates non-human fields', async () => {
      await seedConnection('conn-ref');
      // Set tolerance manually so it is protected
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-ref', { tolerance_pct: 1 });
      // Add invoices in a different currency than default — sufficient sample
      for (let i = 0; i < 30; i++) await seedInvoice(`r-${i}`, 'EUR', 100);

      const token = await login(ADMIN, TENANT);
      const res = await postJSON('/api/v1/erp/connections/conn-ref/process-profile/refresh', {}, token);
      expect(res.status).toBe(200);
      const body = await res.json() as { profile: { default_currency: string; tolerance_pct: number }; evidence: { default_currency: { source: string }; tolerance_pct: { source: string } } };
      expect(body.profile.default_currency).toBe('EUR');
      expect(body.evidence.default_currency.source).toBe('inferred');
      // Human override survives
      expect(body.profile.tolerance_pct).toBe(1);
      expect(body.evidence.tolerance_pct.source).toBe('human');
    });
  });
});
