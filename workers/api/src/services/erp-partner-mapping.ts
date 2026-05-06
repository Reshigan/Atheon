/**
 * ERP partner-ID mapping — Phase 10-45.
 *
 * Atheon canonical records carry partner refs as strings (e.g.
 * "vendor-acme-001", or the source-system natural key like a SAP
 * BUKRS partner code). Each ERP wants something different in its
 * write-back call:
 *
 *   - Odoo:     numeric res.partner.id (integer)
 *   - Xero:     ContactID (UUID string)
 *   - NetSuite: vendor / customer internalId (numeric string)
 *   - SAP:      InvoicingParty / Customer (BUKRS partner code)
 *
 * Rather than ask every subcatalyst that stages a transactional
 * action to know about every adapter's ID convention, we keep a
 * mapping table per (tenant, erp_connection, partner_type) and look
 * up at dispatch time.
 *
 * The mapping is NOT auto-populated — operators set it via the
 * `/api/v1/erp/connections/:id/partner-mappings` admin route, or via
 * a one-shot bootstrap that calls each ERP's contact/vendor list and
 * fuzzy-matches by name. This module only owns lookup + upsert.
 */

import { logWarn } from './logger';

export type PartnerType = 'vendor' | 'customer';

export interface PartnerMapping {
  id: string;
  tenant_id: string;
  erp_connection_id: string;
  partner_type: PartnerType;
  atheon_partner_ref: string;
  external_partner_id: string;
  external_partner_name: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

/** Look up the external (ERP-native) partner ID for an Atheon ref.
 *  Returns null when no mapping exists; callers should treat the
 *  payload-supplied ID as authoritative if present. */
export async function lookupPartnerExternalId(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  partnerType: PartnerType,
  atheonPartnerRef: string,
): Promise<string | null> {
  if (!atheonPartnerRef) return null;
  const row = await db.prepare(
    `SELECT external_partner_id FROM erp_partner_mappings
      WHERE tenant_id = ? AND erp_connection_id = ?
        AND partner_type = ? AND atheon_partner_ref = ?`,
  ).bind(tenantId, erpConnectionId, partnerType, atheonPartnerRef)
   .first<{ external_partner_id: string }>();
  return row?.external_partner_id ?? null;
}

/** Same as lookupPartnerExternalId but returns the numeric form
 *  (Odoo res.partner.id is INTEGER, not string). Returns null if the
 *  mapping value isn't a valid integer. */
export async function lookupPartnerExternalIdNumeric(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  partnerType: PartnerType,
  atheonPartnerRef: string,
): Promise<number | null> {
  const raw = await lookupPartnerExternalId(db, tenantId, erpConnectionId, partnerType, atheonPartnerRef);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    logWarn('partner_mapping.non_numeric',
      { tenantId, layer: 'erp_write', action: 'partner_lookup' },
      { connection_id: erpConnectionId, partner_type: partnerType, atheon_ref: atheonPartnerRef, value: raw });
    return null;
  }
  return n;
}

/** Idempotent upsert keyed on (tenant, conn, type, atheon_ref). */
export async function upsertPartnerMapping(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  partnerType: PartnerType,
  atheonPartnerRef: string,
  externalPartnerId: string,
  externalPartnerName?: string | null,
  metadata?: Record<string, unknown>,
): Promise<{ id: string; created: boolean }> {
  const existing = await db.prepare(
    `SELECT id FROM erp_partner_mappings
      WHERE tenant_id = ? AND erp_connection_id = ?
        AND partner_type = ? AND atheon_partner_ref = ?`,
  ).bind(tenantId, erpConnectionId, partnerType, atheonPartnerRef).first<{ id: string }>();

  const meta = JSON.stringify(metadata ?? {});

  if (existing) {
    await db.prepare(
      `UPDATE erp_partner_mappings
          SET external_partner_id = ?, external_partner_name = ?, metadata = ?,
              updated_at = datetime('now')
        WHERE id = ?`,
    ).bind(externalPartnerId, externalPartnerName ?? null, meta, existing.id).run();
    return { id: existing.id, created: false };
  }

  const id = `pmap-${crypto.randomUUID()}`;
  await db.prepare(
    `INSERT INTO erp_partner_mappings
       (id, tenant_id, erp_connection_id, partner_type, atheon_partner_ref,
        external_partner_id, external_partner_name, metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(
    id, tenantId, erpConnectionId, partnerType, atheonPartnerRef,
    externalPartnerId, externalPartnerName ?? null, meta,
  ).run();
  return { id, created: true };
}

export async function listPartnerMappings(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  partnerType?: PartnerType,
  limit = 500,
): Promise<PartnerMapping[]> {
  if (partnerType) {
    const res = await db.prepare(
      `SELECT * FROM erp_partner_mappings
        WHERE tenant_id = ? AND erp_connection_id = ? AND partner_type = ?
        ORDER BY atheon_partner_ref LIMIT ?`,
    ).bind(tenantId, erpConnectionId, partnerType, limit).all<PartnerMapping>();
    return res.results || [];
  }
  const res = await db.prepare(
    `SELECT * FROM erp_partner_mappings
      WHERE tenant_id = ? AND erp_connection_id = ?
      ORDER BY partner_type, atheon_partner_ref LIMIT ?`,
  ).bind(tenantId, erpConnectionId, limit).all<PartnerMapping>();
  return res.results || [];
}

export async function deletePartnerMapping(
  db: D1Database,
  tenantId: string,
  erpConnectionId: string,
  partnerType: PartnerType,
  atheonPartnerRef: string,
): Promise<boolean> {
  const res = await db.prepare(
    `DELETE FROM erp_partner_mappings
      WHERE tenant_id = ? AND erp_connection_id = ?
        AND partner_type = ? AND atheon_partner_ref = ?`,
  ).bind(tenantId, erpConnectionId, partnerType, atheonPartnerRef).run();
  return (res.meta?.changes ?? 0) > 0;
}
