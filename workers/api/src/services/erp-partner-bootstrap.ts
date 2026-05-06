/**
 * Partner-mapping bootstrap — Phase 10-47.
 *
 * Generates DRAFT mappings between Atheon canonical partner refs and
 * ERP-native external IDs by:
 *
 *   1. Discovering canonical partners from the tenant's existing data
 *      (vendors from ap_invoice_inbox + purchase_orders, customers
 *      from ar_open_invoices + customer_payments).
 *   2. Calling the right ERP client's listPartners() to fetch the
 *      ERP-side partner list.
 *   3. Fuzzy-matching by normalised name (lowercase, trim corporate
 *      suffixes like Inc/Ltd/GmbH, drop punctuation).
 *   4. Returning proposals with a confidence score; operator confirms
 *      in bulk via the route + UI.
 *
 * No proposals are auto-applied — billing-grade attribution requires
 * human confirmation, per the project's shared-savings revenue model.
 */

import { logInfo, logWarn } from './logger';
import { decrypt, isEncrypted } from './encryption';
import {
  odooAuthenticate, odooListPartners, isOdooError,
} from './erp-odoo-client';
import type { OdooConnectionConfig } from './erp-odoo-client';
import {
  xeroListContacts, isXeroError,
} from './erp-xero-client';
import type { XeroConnectionConfig } from './erp-xero-client';
import {
  netsuiteListPartners, isNetSuiteError,
} from './erp-netsuite-client';
import type { NetSuiteConnectionConfig } from './erp-netsuite-client';
import {
  sapListBusinessPartners, isSapError,
} from './erp-sap-client';
import type { SapConnectionConfig } from './erp-sap-client';
import { lookupPartnerExternalId } from './erp-partner-mapping';

export type PartnerType = 'vendor' | 'customer';

export interface CanonicalPartner {
  ref: string;          // stable ID we'll persist as atheon_partner_ref
  name: string;         // canonical display name
  occurrences: number;  // how many docs reference this partner — confidence prior
}

export interface ErpPartner {
  externalId: string;
  name: string;
  /** Optional secondary identifiers used for tiebreakers (email, vat). */
  email?: string | null;
  vat?: string | null;
}

export interface MappingProposal {
  atheon_partner_ref: string;
  atheon_partner_name: string;
  external_partner_id: string;
  external_partner_name: string;
  /** 0..1 — 1.0 = exact match after normalisation; below 0.6 we don't propose. */
  confidence: number;
  /** Why this match was suggested — for the UI to surface. */
  reason: string;
}

// ── Name normalisation ─────────────────────────────────────────────
const CORP_SUFFIXES = [
  'inc', 'incorporated', 'corp', 'corporation', 'co', 'company',
  'ltd', 'limited', 'llc', 'llp', 'lp', 'plc',
  'gmbh', 'ag', 'kg', 'ohg', 'mbh',
  'sa', 'srl', 'sarl', 'sas', 'spa', 'bv', 'nv',
  'pty', 'pte', 'oy', 'ab', 'as',
];

const STOP_WORDS = new Set(['the', 'and', '&']);

/** Lower-case, strip punctuation, drop trailing corporate suffixes,
 *  drop articles + ampersands, collapse whitespace. The result is what
 *  the matcher compares — preserves the discriminative core ("Acme",
 *  "Coca-Cola") while ignoring decorative tokens. */
export function normaliseName(name: string): string {
  if (!name) return '';
  let s = name.toLowerCase();
  // Replace common punctuation with spaces
  s = s.replace(/[.,;:!?'"`/\\\-_(){}[\]@#]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) return '';
  // Strip trailing corporate suffix tokens repeatedly (e.g. "Acme Inc Ltd")
  const tokens = s.split(' ').filter((t) => t && !STOP_WORDS.has(t));
  while (tokens.length > 1 && CORP_SUFFIXES.includes(tokens[tokens.length - 1])) {
    tokens.pop();
  }
  return tokens.join(' ');
}

/** Levenshtein distance — used for near-misses after normalisation. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = new Array<number>(b.length + 1);
  const curr = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j++) prev[j] = curr[j];
  }
  return prev[b.length];
}

/** Score 0..1 between two partner names. 1.0 = exact normalised match;
 *  scores below 0.6 mean "unmatched". */
export function nameSimilarity(a: string, b: string): number {
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1.0;
  // Substring containment — covers "Acme Corp" vs "Acme Corp Pty Ltd Subsidiary"
  if (na.length >= 4 && nb.includes(na)) return 0.92;
  if (nb.length >= 4 && na.includes(nb)) return 0.92;
  // Levenshtein on normalised forms — small edits = typos / abbreviations
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 0;
  const ratio = 1 - dist / maxLen;
  // Below 0.7 is too noisy to propose
  return ratio >= 0.7 ? ratio * 0.85 : 0;  // discount fuzzy matches vs exact
}

// ── Canonical partner discovery ─────────────────────────────────────
/** Pull distinct vendor names + occurrence counts from this tenant's
 *  AP-side data. We use vendor_id when present (more stable than name)
 *  and fall back to vendor_name as the ref. */
export async function discoverCanonicalVendors(
  db: D1Database, tenantId: string, limit = 1000,
): Promise<CanonicalPartner[]> {
  // Union AP invoices + POs so we catch vendors with no invoices yet.
  const sql = `
    SELECT vendor_ref AS ref, vendor_name AS name, SUM(n) AS occurrences FROM (
      SELECT COALESCE(NULLIF(vendor_id, ''), vendor_name) AS vendor_ref, vendor_name, COUNT(*) AS n
        FROM ap_invoice_inbox
       WHERE tenant_id = ? AND COALESCE(vendor_name, '') <> ''
       GROUP BY vendor_ref, vendor_name
      UNION ALL
      SELECT COALESCE(NULLIF(vendor_id, ''), vendor_name) AS vendor_ref, vendor_name, COUNT(*) AS n
        FROM purchase_orders
       WHERE tenant_id = ? AND COALESCE(vendor_name, '') <> ''
       GROUP BY vendor_ref, vendor_name
    )
    GROUP BY ref, name
    ORDER BY occurrences DESC
    LIMIT ?`;
  const res = await db.prepare(sql).bind(tenantId, tenantId, limit).all<{ ref: string; name: string; occurrences: number }>();
  return (res.results ?? []).map((r) => ({ ref: r.ref, name: r.name, occurrences: r.occurrences }));
}

export async function discoverCanonicalCustomers(
  db: D1Database, tenantId: string, limit = 1000,
): Promise<CanonicalPartner[]> {
  const sql = `
    SELECT customer_ref AS ref, customer_name AS name, SUM(n) AS occurrences FROM (
      SELECT COALESCE(NULLIF(customer_id, ''), customer_name) AS customer_ref, customer_name, COUNT(*) AS n
        FROM ar_open_invoices
       WHERE tenant_id = ? AND COALESCE(customer_name, '') <> ''
       GROUP BY customer_ref, customer_name
      UNION ALL
      SELECT COALESCE(NULLIF(customer_id, ''), customer_name) AS customer_ref, customer_name, COUNT(*) AS n
        FROM customer_payments
       WHERE tenant_id = ? AND COALESCE(customer_name, '') <> ''
       GROUP BY customer_ref, customer_name
    )
    GROUP BY ref, name
    ORDER BY occurrences DESC
    LIMIT ?`;
  const res = await db.prepare(sql).bind(tenantId, tenantId, limit).all<{ ref: string; name: string; occurrences: number }>();
  return (res.results ?? []).map((r) => ({ ref: r.ref, name: r.name, occurrences: r.occurrences }));
}

// ── ERP-side partner fetch ──────────────────────────────────────────
async function resolveConfig(
  db: D1Database, connectionId: string, encryptionKey: string | undefined,
): Promise<{ system: string; configJson: string } | null> {
  const row = await db.prepare(
    `SELECT ec.config, ec.encrypted_config, ea.system AS system
       FROM erp_connections ec
       LEFT JOIN erp_adapters ea ON ea.id = ec.adapter_id
      WHERE ec.id = ?`,
  ).bind(connectionId).first<{ config: string | null; encrypted_config: string | null; system: string | null }>();
  if (!row) return null;

  let configJson: string | null = null;
  if (row.encrypted_config && isEncrypted(row.encrypted_config)) {
    if (!encryptionKey || encryptionKey.length < 16) return null;
    const dec = await decrypt(row.encrypted_config, encryptionKey);
    if (!dec) return null;
    configJson = dec;
  } else if (row.config && row.config !== '{}') {
    configJson = row.config;
  }
  if (!configJson) return null;
  return { system: (row.system || '').toLowerCase(), configJson };
}

/** Fetch the ERP partner list for an `(adapter, partnerType)` pair.
 *  Throws on adapter errors so the route can surface them; returns
 *  null when the adapter isn't one of the four write-back-capable
 *  systems (Sage, QuickBooks, etc. — bootstrap doesn't apply). */
export async function fetchErpPartners(
  db: D1Database, connectionId: string, encryptionKey: string | undefined,
  partnerType: PartnerType,
): Promise<{ system: string; partners: ErpPartner[] } | null> {
  const ctx = await resolveConfig(db, connectionId, encryptionKey);
  if (!ctx) return null;
  const { system, configJson } = ctx;

  try {
    if (system === 'odoo') {
      const cfg = JSON.parse(configJson) as OdooConnectionConfig;
      const uid = await odooAuthenticate(cfg);
      const rows = await odooListPartners(cfg, uid, partnerType);
      return {
        system,
        partners: rows.map((r) => ({
          externalId: String(r.id),
          name: r.name,
          email: typeof r.email === 'string' ? r.email : null,
          vat: typeof r.vat === 'string' ? r.vat : null,
        })),
      };
    }
    if (system === 'xero') {
      const cfg = JSON.parse(configJson) as XeroConnectionConfig;
      // Fetch first 5 pages (500 contacts) — covers >95% of customers.
      const all: ErpPartner[] = [];
      for (let page = 1; page <= 5; page++) {
        const rows = await xeroListContacts(cfg, partnerType, page);
        for (const r of rows) {
          all.push({
            externalId: r.ContactID,
            name: r.Name,
            email: r.EmailAddress ?? null,
            vat: r.TaxNumber ?? null,
          });
        }
        if (rows.length < 100) break;
      }
      return { system, partners: all };
    }
    if (system === 'netsuite') {
      const cfg = JSON.parse(configJson) as NetSuiteConnectionConfig;
      const rows = await netsuiteListPartners(cfg, partnerType);
      return {
        system,
        partners: rows.map((r) => ({
          externalId: r.id,
          name: r.companyName ?? r.entityId,
          email: r.email,
        })),
      };
    }
    if (system === 'sap') {
      const cfg = JSON.parse(configJson) as SapConnectionConfig;
      const rows = await sapListBusinessPartners(cfg, partnerType);
      return {
        system,
        partners: rows.map((r) => ({
          externalId: r.BusinessPartner,
          name: r.BusinessPartnerName ?? r.BusinessPartner,
        })),
      };
    }
  } catch (err) {
    const reason = isOdooError(err) || isXeroError(err) || isNetSuiteError(err) || isSapError(err)
      ? `${err.name}: ${err.message}`
      : err instanceof Error ? err.message : String(err);
    logWarn('partner_bootstrap.fetch_failed',
      { layer: 'erp_write', action: 'partner_bootstrap.fetch' },
      { connection_id: connectionId, system, partner_type: partnerType, reason });
    throw err;
  }
  return null;
}

// ── Proposal generation ─────────────────────────────────────────────
/** Match canonical partners to ERP partners by normalised name.
 *
 * For each canonical partner, picks the best ERP candidate above the
 * confidence floor (0.6). Skips canonical partners that already have
 * a confirmed mapping in `erp_partner_mappings` so operators only
 * see new work. */
export async function generateProposals(
  db: D1Database, tenantId: string, connectionId: string,
  partnerType: PartnerType,
  canonical: CanonicalPartner[],
  erp: ErpPartner[],
): Promise<MappingProposal[]> {
  const proposals: MappingProposal[] = [];
  // Pre-compute normalised names on the ERP side once
  const erpNormed = erp.map((p) => ({ p, normed: normaliseName(p.name) }));

  for (const cp of canonical) {
    // Skip if a mapping already exists — operators don't need to see those
    const existing = await lookupPartnerExternalId(db, tenantId, connectionId, partnerType, cp.ref);
    if (existing) continue;

    let best: { p: ErpPartner; score: number; reason: string } | null = null;
    const cpNormed = normaliseName(cp.name);
    if (!cpNormed) continue;

    for (const e of erpNormed) {
      if (!e.normed) continue;
      const score = nameSimilarity(cp.name, e.p.name);
      if (score === 0) continue;
      if (!best || score > best.score) {
        let reason: string;
        if (score === 1.0) reason = 'Exact match after normalisation';
        else if (score >= 0.9) reason = 'Substring contains the canonical name';
        else reason = `Fuzzy name similarity ${(score * 100).toFixed(0)}%`;
        best = { p: e.p, score, reason };
      }
    }

    if (best && best.score >= 0.6) {
      proposals.push({
        atheon_partner_ref: cp.ref,
        atheon_partner_name: cp.name,
        external_partner_id: best.p.externalId,
        external_partner_name: best.p.name,
        confidence: Number(best.score.toFixed(3)),
        reason: best.reason,
      });
    }
  }
  // Highest confidence first — operators triage from the top.
  proposals.sort((a, b) => b.confidence - a.confidence);
  logInfo('partner_bootstrap.proposals_generated',
    { tenantId, layer: 'erp_write', action: 'partner_bootstrap.propose' },
    { connection_id: connectionId, partner_type: partnerType,
      canonical_count: canonical.length, erp_count: erp.length, proposals: proposals.length });
  return proposals;
}
