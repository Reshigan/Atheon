/**
 * ERP Auto-Mapper — Phase 2 of dynamic ERP-mapping intelligence.
 *
 * Covers:
 *  1. suggestForCanonical — exact, normalised, hint, and fuzzy paths
 *  2. Type-aware penalties (numeric canonical rejects boolean source)
 *  3. Null-rate penalty
 *  4. persistSuggestions — UPSERT, auto-apply threshold, human-mapping protection
 *  5. getActiveMappings — returns only status='active', ordered by source priority
 *  6. runAutoMapper — end-to-end (read schema → suggest → persist)
 *  7. GET /api/v1/erp/connections/:id/mappings — list endpoint
 *  8. POST /api/v1/erp/connections/:id/mappings/refresh — re-run endpoint
 *  9. Resolver loadResolvedMappings — mappings prepended to static aliases
 * 10. extractAmountWith / extractRefWith / extractEntityWith pure extractors
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { hashPassword } from '../middleware/auth';
import {
  suggestForCanonical,
  suggestMappings,
  persistSuggestions,
  getActiveMappings,
  listAllMappings,
  runAutoMapper,
  CANONICAL_FIELDS,
  AUTO_APPLY_CONFIDENCE,
  type FieldCandidate,
} from '../services/erp-auto-mapper';
import {
  loadResolvedMappings,
  invalidateMappingCache,
  extractAmountWith,
  extractRefWith,
  extractEntityWith,
  extractAmountStatic,
} from '../services/erp-field-resolver';
import { profileEntityRecords } from '../services/erp-schema-profiler';

const TEST_PASSWORD = 'SecurePass1!';
const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT_A = 'mapper-tenant-a';
const ADMIN_A = 'mapper-admin-a@test.local';

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
async function seedAdapter(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_adapters (id, name, system, version, protocol, status, operations, auth_methods)
     VALUES (?, 'Test', 'SAP', '1.0', 'REST', 'available', '[]', '[]')`
  ).bind(id).run();
}
async function seedConnection(id: string, tenantId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO erp_connections (id, tenant_id, adapter_id, name, status, config, sync_frequency, records_synced)
     VALUES (?, ?, 'mapper-adapter', 'Test', 'connected', '{}', 'realtime', 0)`
  ).bind(id, tenantId).run();
}
async function login(email: string, tenantSlug: string): Promise<string> {
  const res = await postJSON('/api/v1/auth/login', { email, password: TEST_PASSWORD, tenant_slug: tenantSlug });
  if (res.status !== 200) throw new Error(`login ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

describe('ERP Auto-Mapper (v58 — dynamic field mapping)', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(TENANT_A, TENANT_A);
    await seedUser('mapper-admin-a', TENANT_A, ADMIN_A);
    await seedAdapter('mapper-adapter');
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM erp_field_mappings WHERE tenant_id = ?').bind(TENANT_A).run();
    await env.DB.prepare('DELETE FROM erp_connection_schemas WHERE tenant_id = ?').bind(TENANT_A).run();
    await env.DB.prepare('DELETE FROM erp_connections WHERE tenant_id = ?').bind(TENANT_A).run();
  });

  describe('suggestForCanonical (matching strategy)', () => {
    it('exact alias match → confidence 1.0', () => {
      const candidates: FieldCandidate[] = [{ source_field: 'WRBTR', inferred_type: 'string', null_rate: 0 }];
      const s = suggestForCanonical(CANONICAL_FIELDS.amount, candidates);
      expect(s).toBeTruthy();
      expect(s!.source_field).toBe('WRBTR');
      expect(s!.confidence).toBeGreaterThanOrEqual(0.95);
      expect(s!.rationale).toMatch(/exact|alias/i);
    });

    it('hint substring match → moderate confidence', () => {
      const candidates: FieldCandidate[] = [
        { source_field: 'total_amount_excl_vat', inferred_type: 'number', null_rate: 0 },
      ];
      const s = suggestForCanonical(CANONICAL_FIELDS.amount, candidates);
      expect(s).toBeTruthy();
      expect(s!.source_field).toBe('total_amount_excl_vat');
      expect(s!.confidence).toBeGreaterThan(0.5);
      expect(s!.confidence).toBeLessThan(1);
      expect(s!.rationale).toMatch(/hint/i);
    });

    it('rejects boolean source for numeric canonical', () => {
      const candidates: FieldCandidate[] = [
        { source_field: 'is_paid', inferred_type: 'boolean', null_rate: 0 },
      ];
      const s = suggestForCanonical(CANONICAL_FIELDS.amount, candidates);
      expect(s).toBeNull();
    });

    it('penalises high null rate', () => {
      const a: FieldCandidate[] = [{ source_field: 'WRBTR', inferred_type: 'string', null_rate: 0 }];
      const b: FieldCandidate[] = [{ source_field: 'WRBTR', inferred_type: 'string', null_rate: 0.95 }];
      const sa = suggestForCanonical(CANONICAL_FIELDS.amount, a)!;
      const sb = suggestForCanonical(CANONICAL_FIELDS.amount, b)!;
      expect(sb.confidence).toBeLessThan(sa.confidence);
    });

    it('picks the single best candidate when multiple are present', () => {
      const candidates: FieldCandidate[] = [
        { source_field: 'random_field', inferred_type: 'string', null_rate: 0 },
        { source_field: 'WRBTR', inferred_type: 'string', null_rate: 0 },
        { source_field: 'totally_unrelated', inferred_type: 'object', null_rate: 0 },
      ];
      const s = suggestForCanonical(CANONICAL_FIELDS.amount, candidates);
      expect(s!.source_field).toBe('WRBTR');
    });
  });

  describe('suggestMappings (all canonicals)', () => {
    it('produces one suggestion per canonical that has a credible candidate', () => {
      const candidates: FieldCandidate[] = [
        { source_field: 'WRBTR', inferred_type: 'string', null_rate: 0 },
        { source_field: 'BELNR', inferred_type: 'string', null_rate: 0 },
        { source_field: 'LIFNR', inferred_type: 'string', null_rate: 0 },
      ];
      const s = suggestMappings(candidates);
      const fields = s.map((x) => x.canonical_field).sort();
      expect(fields).toEqual(expect.arrayContaining(['amount', 'ref', 'entity']));
    });
  });

  describe('persistSuggestions + getActiveMappings', () => {
    it('UPSERTs and applies the auto-confidence threshold', async () => {
      await seedConnection('conn-x', TENANT_A);
      await persistSuggestions(env.DB, TENANT_A, 'conn-x', 'invoices', [
        { canonical_field: 'amount', source_field: 'WRBTR', confidence: 1.0, rationale: 'exact', learned_from: 'rule' },
        { canonical_field: 'amount', source_field: 'fuzzy_amt', confidence: 0.6, rationale: 'fuzzy', learned_from: 'auto' },
      ]);
      const active = await getActiveMappings(env.DB, TENANT_A, 'conn-x', 'invoices');
      expect(active.amount).toEqual(['WRBTR']); // 0.6 was below auto-apply threshold
    });

    it('protects human-confirmed mappings from being overwritten by auto suggestions', async () => {
      await seedConnection('conn-h', TENANT_A);
      // Human first
      await persistSuggestions(env.DB, TENANT_A, 'conn-h', 'invoices', [
        { canonical_field: 'amount', source_field: 'CUSTOM_FIELD', confidence: 1.0, rationale: 'human says so', learned_from: 'human' },
      ]);
      // Auto tries to overwrite with a different decision
      await persistSuggestions(env.DB, TENANT_A, 'conn-h', 'invoices', [
        { canonical_field: 'amount', source_field: 'CUSTOM_FIELD', confidence: 0.4, rationale: 'auto disagrees', learned_from: 'auto' },
      ]);
      const all = await listAllMappings(env.DB, TENANT_A, 'conn-h', 'invoices');
      const human = all.find((r) => r.source_field === 'CUSTOM_FIELD')!;
      expect(human.learned_from).toBe('human');
      expect(human.confidence).toBe(1.0);
      expect(human.rationale).toBe('human says so');
    });
  });

  describe('runAutoMapper (end-to-end)', () => {
    it('reads discovered schema and persists mappings', async () => {
      await seedConnection('conn-e2e', TENANT_A);
      // Profile a fake SAP-shaped invoice batch
      await profileEntityRecords(env.DB, TENANT_A, 'conn-e2e', 'SAP', 'invoices', [
        { WRBTR: '100.00', BELNR: 'INV-001', LIFNR: 'V001', BUDAT: '2026-04-01' },
        { WRBTR: '200.50', BELNR: 'INV-002', LIFNR: 'V002', BUDAT: '2026-04-02' },
      ]);
      const r = await runAutoMapper(env.DB, TENANT_A, 'conn-e2e', 'invoices');
      expect(r.suggestions.length).toBeGreaterThan(0);
      expect(r.autoApplied).toBeGreaterThan(0);
      const active = await getActiveMappings(env.DB, TENANT_A, 'conn-e2e', 'invoices');
      expect(active.amount).toContain('WRBTR');
      expect(active.ref).toContain('BELNR');
      expect(active.entity).toContain('LIFNR');
      expect(active.date).toContain('BUDAT');
    });
  });

  describe('Resolver: loadResolvedMappings + extract*With', () => {
    it('prepends mapped fields to static aliases (mapped wins on first non-null hit)', async () => {
      await seedConnection('conn-r', TENANT_A);
      // Custom field first; persist as active human mapping
      await persistSuggestions(env.DB, TENANT_A, 'conn-r', 'invoices', [
        { canonical_field: 'amount', source_field: 'Z_CUSTOM_AMT', confidence: 1.0, rationale: 'tenant override', learned_from: 'human' },
      ]);
      await invalidateMappingCache({ tenantId: TENANT_A, connectionId: 'conn-r', entityType: 'invoices' });
      const resolved = await loadResolvedMappings(env.DB, { tenantId: TENANT_A, connectionId: 'conn-r', entityType: 'invoices' });
      // Z_CUSTOM_AMT should appear before any of the static SAP aliases
      const amount = resolved.fields.amount;
      const idxCustom = amount.indexOf('Z_CUSTOM_AMT');
      const idxStatic = amount.indexOf('WRBTR');
      expect(idxCustom).toBeGreaterThanOrEqual(0);
      expect(idxCustom).toBeLessThan(idxStatic);
    });

    it('extractAmountWith picks the first non-empty matching field', () => {
      const fields = ['Z_CUSTOM_AMT', 'WRBTR', 'amount', 'total'];
      expect(extractAmountWith({ Z_CUSTOM_AMT: '500.00' }, fields)).toBe(500);
      expect(extractAmountWith({ WRBTR: '300.00' }, fields)).toBe(300);
      expect(extractAmountWith({ amount: '100.00' }, fields)).toBe(100);
      // Z_CUSTOM_AMT empty falls through to WRBTR
      expect(extractAmountWith({ Z_CUSTOM_AMT: '', WRBTR: '750' }, fields)).toBe(750);
    });

    it('extractRefWith / extractEntityWith mirror the same selection rule', () => {
      expect(extractRefWith({ BELNR: 'X123' }, ['BELNR', 'invoice_number'])).toBe('X123');
      expect(extractEntityWith({ LIFNR: 'V99' }, ['LIFNR', 'name'])).toBe('V99');
    });

    it('static fallback (extractAmountStatic) keeps existing behaviour unchanged', () => {
      expect(extractAmountStatic({ WRBTR: '42.50' })).toBe(42.5);
      expect(extractAmountStatic({ amount_total: 99 })).toBe(99);
      expect(extractAmountStatic({ unknown_field: 1 })).toBe(0);
    });
  });

  describe('GET /api/v1/erp/connections/:id/mappings', () => {
    it('returns mappings grouped by canonical field', async () => {
      await seedConnection('conn-list', TENANT_A);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-list', 'SAP', 'invoices', [
        { WRBTR: '1', BELNR: 'X', LIFNR: 'V' },
      ]);
      await runAutoMapper(env.DB, TENANT_A, 'conn-list', 'invoices');

      const token = await login(ADMIN_A, TENANT_A);
      const res = await authedGet('/api/v1/erp/connections/conn-list/mappings', token);
      expect(res.status).toBe(200);
      const body = await res.json() as { activeCount: number; mappings: Record<string, unknown[]> };
      expect(body.activeCount).toBeGreaterThan(0);
      expect(body.mappings.amount).toBeTruthy();
    });
  });

  describe('POST /api/v1/erp/connections/:id/mappings/refresh', () => {
    it('re-runs the auto-mapper for all entities with discovered schema', async () => {
      await seedConnection('conn-ref', TENANT_A);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-ref', 'SAP', 'invoices', [
        { WRBTR: '1', BELNR: 'X' },
      ]);
      await profileEntityRecords(env.DB, TENANT_A, 'conn-ref', 'SAP', 'suppliers', [
        { LIFNR: 'V1', NAME1: 'Acme' },
      ]);

      const token = await login(ADMIN_A, TENANT_A);
      const res = await postJSON('/api/v1/erp/connections/conn-ref/mappings/refresh', {}, token);
      expect(res.status).toBe(200);
      const body = await res.json() as { entitiesProcessed: number; autoApplied: number };
      expect(body.entitiesProcessed).toBe(2);
      expect(body.autoApplied).toBeGreaterThan(0);
    });
  });

  it('AUTO_APPLY_CONFIDENCE constant is sane (between 0.5 and 1)', () => {
    expect(AUTO_APPLY_CONFIDENCE).toBeGreaterThan(0.5);
    expect(AUTO_APPLY_CONFIDENCE).toBeLessThanOrEqual(1);
  });
});
