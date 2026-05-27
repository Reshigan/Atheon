/**
 * Audit Pack generator. Produces an immutable signed JSON evidence
 * bundle for a billable period or a single billable line item, and
 * stores it in R2 so an external auditor (Big-4 / SOX reviewer) can
 * later verify the SHA-256 hash + HMAC signature.
 *
 * Why: every R of shared-savings revenue must trace back to an ERP
 * record, a field mapping, and a confidence. The audit pack is the
 * deliverable auditors sign off; it has to be tamper-evident.
 *
 * Workflow:
 *   1. Build the JSON body from D1 (period + all its line items, or
 *      one line item + its parent period).
 *   2. Canonicalise (stable key order, no whitespace) and hash SHA-256.
 *   3. HMAC-SHA256 the hash with JWT_SECRET — a re-issued pack from
 *      the same body produces the same signature, so auditors can
 *      verify offline without needing to call the API.
 *   4. Write JSON to R2 at `audit-packs/{tenantId}/{packId}.json`
 *      with custom metadata (hash, signature, kind, source-id).
 *   5. Insert a row in audit_packs so the UI can list historical packs.
 *
 * The HMAC key is JWT_SECRET because it's already rotated and protected
 * the same way as session tokens; rotating it invalidates old packs'
 * signatures, but the hashes still verify the body's integrity.
 */

import type { Env } from '../types';

export type AuditPackKind = 'billable-period' | 'billable-line-item';

export interface PeriodPackBody {
  kind: 'billable-period';
  tenantId: string;
  period: {
    id: string;
    periodStart: string;
    periodEnd: string;
    totalRealisedSavingsZar: number;
    atheonSharePct: number;
    atheonRevenueZar: number;
    currency: string;
    status: string;
    generatedAt: string;
  };
  lineItems: Array<{
    id: string;
    rcaId: string;
    metricName: string;
    attributedSavingsZar: number;
    confidence: number;
    evidence: Record<string, unknown>;
    createdAt: string;
  }>;
  summary: {
    lineItemCount: number;
    totalAttributedSavingsZar: number;
    avgConfidence: number;
    minConfidence: number;
  };
  generatedAt: string;
  schemaVersion: '1.0';
}

export interface LineItemPackBody {
  kind: 'billable-line-item';
  tenantId: string;
  lineItem: {
    id: string;
    periodId: string;
    rcaId: string;
    metricName: string;
    attributedSavingsZar: number;
    confidence: number;
    evidence: Record<string, unknown>;
    createdAt: string;
  };
  parentPeriod: {
    id: string;
    periodStart: string;
    periodEnd: string;
    status: string;
  } | null;
  generatedAt: string;
  schemaVersion: '1.0';
}

export type AuditPackBody = PeriodPackBody | LineItemPackBody;

export interface AuditPackRecord {
  packId: string;
  tenantId: string;
  kind: AuditPackKind;
  sourceId: string;
  hash: string;
  signature: string;
  r2Key: string;
  sizeBytes: number;
  generatedBy: string;
  generatedAt: string;
}

interface BillablePeriodRow {
  id: string;
  tenant_id: string;
  period_start: string;
  period_end: string;
  total_realised_savings: number;
  atheon_share_pct: number;
  atheon_revenue: number;
  currency: string;
  status: string;
  generated_at: string;
}

interface BillableLineItemRow {
  id: string;
  period_id: string;
  tenant_id: string;
  rca_id: string;
  metric_name: string;
  attributed_savings: number;
  confidence: number;
  evidence: string;
  created_at: string;
}

function canonicalStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalStringify).join(',')}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalStringify((value as Record<string, unknown>)[k])}`);
  return `{${parts.join(',')}}`;
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256Hex(key: string, input: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(input));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function parseEvidence(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw || '{}');
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export async function buildPeriodPack(env: Env, tenantId: string, periodId: string): Promise<PeriodPackBody | null> {
  const periodRow = await env.DB.prepare(
    `SELECT id, tenant_id, period_start, period_end, total_realised_savings, atheon_share_pct, atheon_revenue, currency, status, generated_at FROM billable_periods WHERE id = ? AND tenant_id = ?`,
  ).bind(periodId, tenantId).first<BillablePeriodRow>();
  if (!periodRow) return null;

  const lineRes = await env.DB.prepare(
    `SELECT id, period_id, tenant_id, rca_id, metric_name, attributed_savings, confidence, evidence, created_at FROM billable_line_items WHERE period_id = ? AND tenant_id = ? ORDER BY attributed_savings DESC`,
  ).bind(periodId, tenantId).all<BillableLineItemRow>();

  const lineItems = lineRes.results.map((r) => ({
    id: r.id,
    rcaId: r.rca_id,
    metricName: r.metric_name,
    attributedSavingsZar: Math.round(r.attributed_savings),
    confidence: +(+r.confidence).toFixed(2),
    evidence: parseEvidence(r.evidence),
    createdAt: r.created_at,
  }));

  const lineItemCount = lineItems.length;
  const totalAttributedSavings = lineItems.reduce((s, li) => s + li.attributedSavingsZar, 0);
  const avgConfidence = lineItemCount > 0 ? +(lineItems.reduce((s, li) => s + li.confidence, 0) / lineItemCount).toFixed(3) : 0;
  const minConfidence = lineItemCount > 0 ? Math.min(...lineItems.map((li) => li.confidence)) : 0;

  return {
    kind: 'billable-period',
    tenantId,
    period: {
      id: periodRow.id,
      periodStart: periodRow.period_start,
      periodEnd: periodRow.period_end,
      totalRealisedSavingsZar: Math.round(periodRow.total_realised_savings),
      atheonSharePct: periodRow.atheon_share_pct,
      atheonRevenueZar: Math.round(periodRow.atheon_revenue),
      currency: periodRow.currency,
      status: periodRow.status,
      generatedAt: periodRow.generated_at,
    },
    lineItems,
    summary: {
      lineItemCount,
      totalAttributedSavingsZar: totalAttributedSavings,
      avgConfidence,
      minConfidence,
    },
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0',
  };
}

export async function buildLineItemPack(env: Env, tenantId: string, lineItemId: string): Promise<LineItemPackBody | null> {
  const lineRow = await env.DB.prepare(
    `SELECT id, period_id, tenant_id, rca_id, metric_name, attributed_savings, confidence, evidence, created_at FROM billable_line_items WHERE id = ? AND tenant_id = ?`,
  ).bind(lineItemId, tenantId).first<BillableLineItemRow>();
  if (!lineRow) return null;

  const periodRow = await env.DB.prepare(
    `SELECT id, period_start, period_end, status FROM billable_periods WHERE id = ? AND tenant_id = ?`,
  ).bind(lineRow.period_id, tenantId).first<{ id: string; period_start: string; period_end: string; status: string }>();

  return {
    kind: 'billable-line-item',
    tenantId,
    lineItem: {
      id: lineRow.id,
      periodId: lineRow.period_id,
      rcaId: lineRow.rca_id,
      metricName: lineRow.metric_name,
      attributedSavingsZar: Math.round(lineRow.attributed_savings),
      confidence: +(+lineRow.confidence).toFixed(2),
      evidence: parseEvidence(lineRow.evidence),
      createdAt: lineRow.created_at,
    },
    parentPeriod: periodRow
      ? { id: periodRow.id, periodStart: periodRow.period_start, periodEnd: periodRow.period_end, status: periodRow.status }
      : null,
    generatedAt: new Date().toISOString(),
    schemaVersion: '1.0',
  };
}

export async function signAndStorePack(
  env: Env,
  tenantId: string,
  generatedBy: string,
  body: AuditPackBody,
): Promise<AuditPackRecord> {
  const packId = crypto.randomUUID();
  const canonical = canonicalStringify(body);
  const hash = await sha256Hex(canonical);
  const signature = await hmacSha256Hex(env.JWT_SECRET, hash);
  const r2Key = `audit-packs/${tenantId}/${packId}.json`;

  const wrappedPayload = JSON.stringify(
    {
      packId,
      hash,
      signature,
      signedWith: 'HMAC-SHA256/JWT_SECRET',
      body,
    },
    null,
    2,
  );

  await env.STORAGE.put(r2Key, wrappedPayload, {
    httpMetadata: { contentType: 'application/json' },
    customMetadata: {
      'tenant-id': tenantId,
      'pack-kind': body.kind,
      'pack-hash': hash,
      'pack-signature': signature,
      'generated-by': generatedBy,
    },
  });

  const sourceId =
    body.kind === 'billable-period' ? body.period.id : body.lineItem.id;
  const sizeBytes = new TextEncoder().encode(wrappedPayload).length;
  const generatedAt = new Date().toISOString();

  await env.DB.prepare(
    `INSERT INTO audit_packs (id, tenant_id, kind, source_id, hash, signature, r2_key, size_bytes, generated_by, generated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).bind(packId, tenantId, body.kind, sourceId, hash, signature, r2Key, sizeBytes, generatedBy, generatedAt).run();

  return {
    packId,
    tenantId,
    kind: body.kind,
    sourceId,
    hash,
    signature,
    r2Key,
    sizeBytes,
    generatedBy,
    generatedAt,
  };
}
