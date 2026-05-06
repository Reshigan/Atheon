/**
 * Phase 10-45 — ERP partner-ID mapping.
 *
 * Validates that the mapping table works as a single source of truth
 * for translating Atheon canonical partner refs (string) into ERP-
 * native external IDs (numeric for Odoo, GUID for Xero, internalId for
 * NetSuite, BUKRS code for SAP).
 *
 *   - lookupPartnerExternalId returns null when no mapping exists
 *   - upsert inserts when missing, updates when present (idempotent)
 *   - lookupPartnerExternalIdNumeric returns null on non-numeric refs
 *   - listPartnerMappings filters by partner_type when supplied
 *   - delete returns true when a row was removed, false otherwise
 *   - the (tenant, conn, type, atheon_ref) UNIQUE constraint prevents
 *     duplicate inserts via raw SQL
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  lookupPartnerExternalId, lookupPartnerExternalIdNumeric,
  upsertPartnerMapping, listPartnerMappings, deletePartnerMapping,
} from '../services/erp-partner-mapping';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'pmap-tenant';
const CONN = 'pmap-conn-1';

beforeAll(async () => {
  const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
    method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
  });
  if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);

  // Tenant + adapter row + connection row (FK chain)
  await env.DB.prepare(`DELETE FROM erp_partner_mappings WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM erp_connections WHERE tenant_id = ?`).bind(TENANT).run();
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(TENANT).run();
  await env.DB.prepare(
    `INSERT INTO tenants (id, name, slug, plan, status)
     VALUES (?, 'Partner Mapping Test', ?, 'enterprise', 'active')`,
  ).bind(TENANT, `pmap-${Date.now()}`).run();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO erp_adapters (id, name, system, status) VALUES ('odoo', 'Odoo', 'odoo', 'available')`,
  ).run();
  await env.DB.prepare(
    `INSERT INTO erp_connections (id, tenant_id, adapter_id, name, status, sync_frequency, records_synced, connected_at)
     VALUES (?, ?, 'odoo', 'Odoo Test', 'active', 'hourly', 0, datetime('now'))`,
  ).bind(CONN, TENANT).run();
}, 60_000);

describe('Phase 10-45 — partner-ID mapping', () => {
  it('returns null when no mapping exists', async () => {
    expect(await lookupPartnerExternalId(env.DB, TENANT, CONN, 'vendor', 'unknown-vendor-1')).toBeNull();
  });

  it('upsert inserts a new mapping then updates it idempotently', async () => {
    const ins = await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'vendor-acme-001', '17', 'Acme Corp');
    expect(ins.created).toBe(true);
    expect(ins.id).toMatch(/^pmap-/);

    const upd = await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'vendor-acme-001', '42', 'Acme Corp Ltd');
    expect(upd.created).toBe(false);
    expect(upd.id).toBe(ins.id);

    const ext = await lookupPartnerExternalId(env.DB, TENANT, CONN, 'vendor', 'vendor-acme-001');
    expect(ext).toBe('42');
  });

  it('lookupPartnerExternalIdNumeric returns numeric for Odoo-shaped IDs', async () => {
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'vendor-num', '99');
    const n = await lookupPartnerExternalIdNumeric(env.DB, TENANT, CONN, 'vendor', 'vendor-num');
    expect(n).toBe(99);
  });

  it('lookupPartnerExternalIdNumeric returns null when external id is not an integer', async () => {
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'vendor-uuid', 'abc-uuid-not-numeric');
    const n = await lookupPartnerExternalIdNumeric(env.DB, TENANT, CONN, 'vendor', 'vendor-uuid');
    expect(n).toBeNull();
  });

  it('partner_type isolates vendor vs customer entries with the same atheon_ref', async () => {
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'shared-ref', '1');
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'customer', 'shared-ref', '2');
    expect(await lookupPartnerExternalId(env.DB, TENANT, CONN, 'vendor', 'shared-ref')).toBe('1');
    expect(await lookupPartnerExternalId(env.DB, TENANT, CONN, 'customer', 'shared-ref')).toBe('2');
  });

  it('listPartnerMappings filters by partner_type when supplied', async () => {
    const all = await listPartnerMappings(env.DB, TENANT, CONN);
    const vendors = await listPartnerMappings(env.DB, TENANT, CONN, 'vendor');
    const customers = await listPartnerMappings(env.DB, TENANT, CONN, 'customer');
    expect(all.length).toBe(vendors.length + customers.length);
    for (const v of vendors) expect(v.partner_type).toBe('vendor');
    for (const c of customers) expect(c.partner_type).toBe('customer');
  });

  it('delete removes the row and returns true; subsequent delete returns false', async () => {
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'doomed', '500');
    const a = await deletePartnerMapping(env.DB, TENANT, CONN, 'vendor', 'doomed');
    expect(a).toBe(true);
    const b = await deletePartnerMapping(env.DB, TENANT, CONN, 'vendor', 'doomed');
    expect(b).toBe(false);
    expect(await lookupPartnerExternalId(env.DB, TENANT, CONN, 'vendor', 'doomed')).toBeNull();
  });

  it('UNIQUE(tenant, conn, type, atheon_ref) constraint prevents raw INSERT duplicates', async () => {
    await upsertPartnerMapping(env.DB, TENANT, CONN, 'vendor', 'unique-test', '1');
    let threw = false;
    try {
      await env.DB.prepare(
        `INSERT INTO erp_partner_mappings (id, tenant_id, erp_connection_id, partner_type, atheon_partner_ref, external_partner_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).bind('pmap-dup', TENANT, CONN, 'vendor', 'unique-test', '999').run();
    } catch {
      threw = true;
    }
    expect(threw).toBe(true);
  });
});
