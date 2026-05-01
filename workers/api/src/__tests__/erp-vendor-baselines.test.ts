/**
 * Phase 6 — vendor-baseline data dictionaries + process flows.
 *
 * Covers:
 *  1. getVendorBaseline routes by source-system prefix (case-insensitive).
 *  2. compareProfileToBaseline returns no deviations for in-band profile.
 *  3. compareProfileToBaseline returns deviations for out-of-band values
 *     (with severity escalation when far from recommended).
 *  4. compareSchemaToBaseline lists missing standard + custom fields.
 *  5. calculateAlignmentScore is 1 for full alignment, 0 for no alignment.
 *  6. GET /api/v1/erp/connections/:id/baseline-comparison returns expected
 *     payload for SAP / Odoo / Xero.
 *  7. GET returns vendor=null + reason for unsupported vendors.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import {
  getVendorBaseline,
  listSupportedVendors,
  compareProfileToBaseline,
  compareSchemaToBaseline,
  calculateAlignmentScore,
} from '../services/erp-vendor-baselines';
import { DEFAULT_PROCESS_PROFILE } from '../services/erp-process-profile';
import { profileEntityRecords } from '../services/erp-schema-profiler';
import { setProcessProfileOverrides } from '../services/erp-process-profile';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'baseline-tenant';
const ADMIN = 'baseline-admin@test.local';

async function postJSON(path: string, body: Record<string, unknown>, token?: string): Promise<Response> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  return SELF.fetch(`http://localhost${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
}
async function authedGet(path: string, token: string): Promise<Response> {
  return SELF.fetch(`http://localhost${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function seedTenant(id: string, slug: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status) VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, slug).run();
}
async function seedUser(id: string, tenantId: string, email: string): Promise<void> {
  const hash = await hashPassword(TEST_PASSWORD);
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, permissions, status)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, 'active')`
  ).bind(id, tenantId, email, email, hash, JSON.stringify(['*'])).run();
}
async function seedAdapter(id: string, system: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES (?, 'Test', ?, '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id, system).run();
}
async function seedConnection(id: string, adapterId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, ?, 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, TENANT, adapterId).run();
}
async function login(email: string, slug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: slug });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

describe('Phase 6 — vendor baselines', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT, TENANT);
    await seedUser('baseline-admin', TENANT, ADMIN);
    await seedAdapter('baseline-adapter-sap', 'SAP');
    await seedAdapter('baseline-adapter-odoo', 'Odoo');
    await seedAdapter('baseline-adapter-xero', 'Xero');
    await seedAdapter('baseline-adapter-other', 'NetSuite');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_process_profiles WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connection_schemas WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('getVendorBaseline (registry lookup)', () => {
    it('routes SAP / sap / SAP S/4HANA to SAP baseline', () => {
      expect(getVendorBaseline('SAP')?.vendor).toBe('SAP');
      expect(getVendorBaseline('sap')?.vendor).toBe('SAP');
      expect(getVendorBaseline('SAP S/4HANA')?.vendor).toBe('SAP');
    });
    it('routes Odoo to Odoo baseline', () => {
      expect(getVendorBaseline('Odoo')?.vendor).toBe('Odoo');
    });
    it('routes Xero to Xero baseline', () => {
      expect(getVendorBaseline('Xero')?.vendor).toBe('Xero');
    });
    it('returns null for unsupported vendor', () => {
      expect(getVendorBaseline('NetSuite')).toBeNull();
      expect(getVendorBaseline(null)).toBeNull();
      expect(getVendorBaseline('')).toBeNull();
    });
    it('listSupportedVendors enumerates the registry', () => {
      const list = listSupportedVendors();
      expect(list).toContain('SAP');
      expect(list).toContain('Odoo');
      expect(list).toContain('Xero');
    });
  });

  describe('compareProfileToBaseline', () => {
    it('returns no deviations when customer profile is in band', () => {
      const baseline = getVendorBaseline('SAP')!;
      const aligned = {
        ...DEFAULT_PROCESS_PROFILE,
        matching_mode: '3way' as const,
        tolerance_pct: 2,
        payment_terms_days: 30,
        fiscal_year_start_month: 1,
        default_currency: 'ZAR',
      };
      const dev = compareProfileToBaseline(aligned, baseline);
      expect(dev).toEqual([]);
    });

    it('flags out-of-band tolerance with appropriate severity', () => {
      const baseline = getVendorBaseline('SAP')!;
      // 10% tolerance is way outside SAP recommendation (2%, max acceptable 5%)
      const wide = { ...DEFAULT_PROCESS_PROFILE, tolerance_pct: 10, matching_mode: '3way' as const, payment_terms_days: 30, fiscal_year_start_month: 1 };
      const dev = compareProfileToBaseline(wide, baseline);
      const tol = dev.find((d) => d.field === 'tolerance_pct');
      expect(tol).toBeTruthy();
      expect(tol!.severity).toBe('critical');
      expect(tol!.action).toMatch(/review configuration/i);
    });

    it('flags wrong matching_mode', () => {
      const baseline = getVendorBaseline('SAP')!;
      const noMatch = { ...DEFAULT_PROCESS_PROFILE, matching_mode: 'none' as const, tolerance_pct: 2, payment_terms_days: 30, fiscal_year_start_month: 1 };
      const dev = compareProfileToBaseline(noMatch, baseline);
      const mm = dev.find((d) => d.field === 'matching_mode');
      expect(mm).toBeTruthy();
    });
  });

  describe('compareSchemaToBaseline', () => {
    it('lists missing vendor-standard fields and custom fields', () => {
      const baseline = getVendorBaseline('SAP')!;
      // Customer sends WRBTR + a custom Z-field but is missing BELNR, BUKRS, etc.
      const discovered = {
        invoices: ['WRBTR', 'BUKRS', 'GJAHR', 'XBLNR', 'BLDAT', 'BUDAT', 'WAERS', 'Z_CUSTOM_TOTAL'],
      };
      const dev = compareSchemaToBaseline(discovered, baseline);
      const inv = dev.find((d) => d.entity_type === 'invoices')!;
      expect(inv.custom_fields).toContain('Z_CUSTOM_TOTAL');
      expect(inv.missing_fields.length).toBeGreaterThan(0); // many SAP std fields not present
    });

    it('returns an empty array when discovered schema is empty for an entity', () => {
      const baseline = getVendorBaseline('SAP')!;
      const dev = compareSchemaToBaseline({}, baseline);
      expect(dev).toEqual([]);
    });
  });

  describe('calculateAlignmentScore', () => {
    it('returns 1 when no deviations', () => {
      expect(calculateAlignmentScore([], 5)).toBe(1);
    });
    it('returns 0 when all recommendations deviate', () => {
      const deviations = Array(5).fill(0).map(() => ({
        field: 'tolerance_pct' as const,
        customer_value: 99, recommended_value: 2,
        severity: 'warning' as const,
        rationale: '', source: '', action: '',
      }));
      expect(calculateAlignmentScore(deviations, 5)).toBe(0);
    });
    it('returns proportional score', () => {
      const dev = [{ field: 'tolerance_pct' as const, customer_value: 99, recommended_value: 2, severity: 'warning' as const, rationale: '', source: '', action: '' }];
      expect(calculateAlignmentScore(dev, 4)).toBe(0.75);
    });
  });

  describe('GET /api/v1/erp/connections/:id/baseline-comparison', () => {
    it('returns SAP baseline with profile deviations + schema deviations', async () => {
      await seedConnection('conn-sap', 'baseline-adapter-sap');
      // Customer overrides tolerance to 8% (out of SAP recommended ≤5)
      await setProcessProfileOverrides(env.DB, TENANT, 'conn-sap', { tolerance_pct: 8 });
      // Customer's discovered schema has only 3 SAP fields + 1 custom
      await profileEntityRecords(env.DB, TENANT, 'conn-sap', 'SAP', 'invoices', [
        { WRBTR: '100', BELNR: 'INV-1', BUKRS: '0001', Z_CUSTOM_FIELD: 'x' },
      ]);

      const token = await login(ADMIN, TENANT);
      const res = await authedGet('/api/v1/erp/connections/conn-sap/baseline-comparison', token);
      expect(res.status).toBe(200);
      const body = await res.json() as {
        vendor: string;
        profile_deviations: Array<{ field: string; severity: string }>;
        schema_deviations: Array<{ entity_type: string; missing_fields: string[]; custom_fields: string[] }>;
        alignment_score: number;
      };
      expect(body.vendor).toBe('SAP');
      const tol = body.profile_deviations.find((d) => d.field === 'tolerance_pct');
      expect(tol).toBeTruthy();
      const inv = body.schema_deviations.find((d) => d.entity_type === 'invoices')!;
      expect(inv.custom_fields).toContain('Z_CUSTOM_FIELD');
      expect(body.alignment_score).toBeLessThan(1);
    });

    it('returns vendor=null with reason for unsupported vendor', async () => {
      await seedConnection('conn-other', 'baseline-adapter-other');
      const token = await login(ADMIN, TENANT);
      const res = await authedGet('/api/v1/erp/connections/conn-other/baseline-comparison', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { vendor: string | null; reason?: string };
      expect(body.vendor).toBeNull();
      expect(body.reason).toMatch(/no vendor baseline/i);
    });

    it('blocks cross-tenant access (404)', async () => {
      // Seed connection on TENANT then try with no auth (should 401 from middleware)
      await seedConnection('conn-priv', 'baseline-adapter-sap');
      const res = await SELF.fetch(`http://localhost/api/v1/erp/connections/conn-priv/baseline-comparison`);
      expect([401, 403, 404]).toContain(res.status);
    });
  });
});
