/**
 * Per-tenant confidence threshold tuning (roadmap B3).
 *
 * Atheon's inference rule (preserved across sessions): prefer false
 * negatives — when sample size or mode share are too thin, ask the
 * customer rather than silently applying a weak rule. These thresholds
 * are the operator-facing knobs for that rule:
 *
 *  - auto_approve_min       : if a catalyst row's confidence ≥ this,
 *                             route directly to auto-approved
 *  - require_human_below    : if confidence < this, route to HITL
 *                             queue regardless of sample size
 *  - hard_reject_below      : if confidence < this, mark the action
 *                             as rejected with a "weak inference"
 *                             reason — never surface to billing
 *  - min_sample_size        : minimum number of supporting records
 *                             required before any rule can fire
 *  - min_mode_share         : minimum dominance of the modal value
 *                             (e.g. 0.7 = 70% agreement) required
 *                             before the rule is considered strong
 *
 * Scope resolution: most-specific first.
 *   1. row with (tenant_id, cluster_id, sub_catalyst_name)
 *   2. row with (tenant_id, cluster_id, NULL)
 *   3. row with (tenant_id, NULL, NULL) — tenant default
 *   4. hard-coded defaults (DEFAULT_THRESHOLDS below)
 *
 * The shape stays the same at every level so callers don't have to
 * special-case missing rows.
 */

import type { Env } from '../types';

export interface ConfidenceThresholds {
  autoApproveMin: number;
  requireHumanBelow: number;
  hardRejectBelow: number;
  minSampleSize: number;
  minModeShare: number;
}

export interface ConfidenceThresholdRecord extends ConfidenceThresholds {
  id: string;
  tenantId: string;
  clusterId: string | null;
  subCatalystName: string | null;
  updatedBy: string | null;
  updatedAt: string;
}

export const DEFAULT_THRESHOLDS: ConfidenceThresholds = {
  autoApproveMin: 0.9,
  requireHumanBelow: 0.7,
  hardRejectBelow: 0.4,
  minSampleSize: 25,
  minModeShare: 0.7,
};

interface ThresholdRow {
  id: string;
  tenant_id: string;
  cluster_id: string | null;
  sub_catalyst_name: string | null;
  auto_approve_min: number;
  require_human_below: number;
  hard_reject_below: number;
  min_sample_size: number;
  min_mode_share: number;
  updated_by: string | null;
  updated_at: string;
}

function rowToRecord(row: ThresholdRow): ConfidenceThresholdRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    clusterId: row.cluster_id,
    subCatalystName: row.sub_catalyst_name,
    autoApproveMin: row.auto_approve_min,
    requireHumanBelow: row.require_human_below,
    hardRejectBelow: row.hard_reject_below,
    minSampleSize: row.min_sample_size,
    minModeShare: row.min_mode_share,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

export async function listThresholds(env: Env, tenantId: string): Promise<ConfidenceThresholdRecord[]> {
  const res = await env.DB.prepare(
    `SELECT id, tenant_id, cluster_id, sub_catalyst_name, auto_approve_min, require_human_below, hard_reject_below, min_sample_size, min_mode_share, updated_by, updated_at FROM tenant_confidence_thresholds WHERE tenant_id = ? ORDER BY cluster_id NULLS FIRST, sub_catalyst_name NULLS FIRST`,
  ).bind(tenantId).all<ThresholdRow>();
  return res.results.map(rowToRecord);
}

/**
 * Resolve the effective thresholds for a given scope. Used at runtime by
 * action-creation paths (currently advisory — wire into status-routing
 * in a follow-up so existing flows don't shift under teams without a
 * heads-up).
 */
export async function resolveThresholds(
  env: Env,
  tenantId: string,
  clusterId?: string | null,
  subCatalystName?: string | null,
): Promise<ConfidenceThresholds> {
  const scopes: Array<[string | null, string | null]> = [
    [clusterId ?? null, subCatalystName ?? null],
    [clusterId ?? null, null],
    [null, null],
  ];

  for (const [cid, sub] of scopes) {
    const row = await env.DB.prepare(
      `SELECT auto_approve_min, require_human_below, hard_reject_below, min_sample_size, min_mode_share FROM tenant_confidence_thresholds WHERE tenant_id = ? AND ${cid === null ? 'cluster_id IS NULL' : 'cluster_id = ?'} AND ${sub === null ? 'sub_catalyst_name IS NULL' : 'sub_catalyst_name = ?'} LIMIT 1`,
    )
      .bind(...[tenantId, cid, sub].filter((v) => v !== null))
      .first<Pick<ThresholdRow, 'auto_approve_min' | 'require_human_below' | 'hard_reject_below' | 'min_sample_size' | 'min_mode_share'>>();
    if (row) {
      return {
        autoApproveMin: row.auto_approve_min,
        requireHumanBelow: row.require_human_below,
        hardRejectBelow: row.hard_reject_below,
        minSampleSize: row.min_sample_size,
        minModeShare: row.min_mode_share,
      };
    }
  }
  return DEFAULT_THRESHOLDS;
}

export interface UpsertThresholdInput {
  clusterId?: string | null;
  subCatalystName?: string | null;
  autoApproveMin: number;
  requireHumanBelow: number;
  hardRejectBelow: number;
  minSampleSize: number;
  minModeShare: number;
  updatedBy: string;
}

/**
 * Validate that the threshold ladder is monotonic and within bounds.
 * Returns an error message if invalid, otherwise null.
 */
export function validateThresholds(t: ConfidenceThresholds): string | null {
  const checks: Array<[boolean, string]> = [
    [t.autoApproveMin > 0 && t.autoApproveMin <= 1, 'auto_approve_min must be between 0 and 1'],
    [t.requireHumanBelow > 0 && t.requireHumanBelow <= 1, 'require_human_below must be between 0 and 1'],
    [t.hardRejectBelow >= 0 && t.hardRejectBelow <= 1, 'hard_reject_below must be between 0 and 1'],
    [t.hardRejectBelow < t.requireHumanBelow, 'hard_reject_below must be lower than require_human_below'],
    [t.requireHumanBelow < t.autoApproveMin, 'require_human_below must be lower than auto_approve_min'],
    [Number.isInteger(t.minSampleSize) && t.minSampleSize >= 1, 'min_sample_size must be a positive integer'],
    [t.minModeShare > 0 && t.minModeShare <= 1, 'min_mode_share must be between 0 and 1'],
  ];
  for (const [ok, msg] of checks) {
    if (!ok) return msg;
  }
  return null;
}

export async function upsertThreshold(
  env: Env,
  tenantId: string,
  input: UpsertThresholdInput,
): Promise<ConfidenceThresholdRecord> {
  const err = validateThresholds(input);
  if (err) throw new Error(err);

  const clusterId = input.clusterId ?? null;
  const subName = input.subCatalystName ?? null;

  const existing = await env.DB.prepare(
    `SELECT id FROM tenant_confidence_thresholds WHERE tenant_id = ? AND ${clusterId === null ? 'cluster_id IS NULL' : 'cluster_id = ?'} AND ${subName === null ? 'sub_catalyst_name IS NULL' : 'sub_catalyst_name = ?'}`,
  )
    .bind(...[tenantId, clusterId, subName].filter((v) => v !== null))
    .first<{ id: string }>();

  const now = new Date().toISOString();
  const id = existing?.id ?? crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(
      `UPDATE tenant_confidence_thresholds SET auto_approve_min = ?, require_human_below = ?, hard_reject_below = ?, min_sample_size = ?, min_mode_share = ?, updated_by = ?, updated_at = ? WHERE id = ?`,
    ).bind(
      input.autoApproveMin,
      input.requireHumanBelow,
      input.hardRejectBelow,
      input.minSampleSize,
      input.minModeShare,
      input.updatedBy,
      now,
      id,
    ).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tenant_confidence_thresholds (id, tenant_id, cluster_id, sub_catalyst_name, auto_approve_min, require_human_below, hard_reject_below, min_sample_size, min_mode_share, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      tenantId,
      clusterId,
      subName,
      input.autoApproveMin,
      input.requireHumanBelow,
      input.hardRejectBelow,
      input.minSampleSize,
      input.minModeShare,
      input.updatedBy,
      now,
    ).run();
  }

  return {
    id,
    tenantId,
    clusterId,
    subCatalystName: subName,
    autoApproveMin: input.autoApproveMin,
    requireHumanBelow: input.requireHumanBelow,
    hardRejectBelow: input.hardRejectBelow,
    minSampleSize: input.minSampleSize,
    minModeShare: input.minModeShare,
    updatedBy: input.updatedBy,
    updatedAt: now,
  };
}

export async function deleteThreshold(
  env: Env,
  tenantId: string,
  id: string,
): Promise<boolean> {
  const res = await env.DB.prepare(
    `DELETE FROM tenant_confidence_thresholds WHERE id = ? AND tenant_id = ?`,
  ).bind(id, tenantId).run();
  return (res.meta?.changes ?? 0) > 0;
}
