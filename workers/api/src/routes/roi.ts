/**
 * ROI Tracking Routes
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { calculateROI } from '../services/pattern-engine-v2';
import { toCSV, csvResponse } from '../services/csv-export';
import { computeRoiAttribution } from '../services/erp-attribution';

interface RoiActionAttribution {
  automated_count: number;
  automated_value_zar: number;
  pending_count: number;
  pending_value_zar: number;
  rejected_count: number;
  rejected_value_zar: number;
  open_value_zar: number;
}

/** Compute the action-state attribution split for the ROI response.
 *  This bridges the gap between "value identified" and "value realised":
 *    automated_value_zar   — Atheon wrote-back actions that completed
 *    pending_value_zar     — actions in the approval queue, value at stake
 *    open_value_zar        — identified opportunity not yet covered by an
 *                            automated or pending action (i.e. customer
 *                            still needs to act, or Atheon hasn't surfaced
 *                            an automation for it yet)
 *  This is the v1 attribution model — proves the loop is closed
 *  end-to-end. Future work: add a finding-resolution signal (customer
 *  confirms they did it manually) to introduce an `advisory_acted`
 *  bucket between automated and open. */
async function computeActionAttribution(
  db: D1Database, tenantId: string, totalIdentifiedZar: number,
): Promise<RoiActionAttribution> {
  const result = {
    automated_count: 0, automated_value_zar: 0,
    pending_count: 0, pending_value_zar: 0,
    rejected_count: 0, rejected_value_zar: 0,
    open_value_zar: 0,
  };
  try {
    const rows = await db.prepare(
      `SELECT status, COUNT(*) as count, COALESCE(SUM(value_zar), 0) as value_zar
         FROM catalyst_actions
        WHERE tenant_id = ?
        GROUP BY status`
    ).bind(tenantId).all<{ status: string; count: number; value_zar: number }>();
    for (const r of rows.results || []) {
      if (r.status === 'completed') {
        result.automated_count = r.count; result.automated_value_zar = r.value_zar;
      } else if (r.status === 'pending_approval') {
        result.pending_count = r.count; result.pending_value_zar = r.value_zar;
      } else if (r.status === 'rejected') {
        result.rejected_count = r.count; result.rejected_value_zar = r.value_zar;
      }
    }
  } catch { /* tolerate */ }

  result.open_value_zar = Math.max(
    0,
    totalIdentifiedZar - result.automated_value_zar - result.pending_value_zar,
  );
  return result;
}

const roi = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// GET /api/roi/ — Latest ROI
roi.get('/', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const row = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first();
  if (!row) return c.json({ id: '', totalDiscrepancyValueIdentified: 0, totalDiscrepancyValueRecovered: 0, totalPreventedLosses: 0, totalPersonHoursSaved: 0, roiMultiple: 0, platformCost: 0, calculatedAt: '', breakdown: { byCluster: [], byConnection: [] } });

  // §9.4 CSV export
  if (c.req.query('format') === 'csv') {
    const csvRow = [{
      period: row.period, identified: row.total_discrepancy_value_identified,
      recovered: row.total_discrepancy_value_recovered, prevented: row.total_downstream_losses_prevented,
      hoursSaved: row.total_person_hours_saved, runs: row.total_catalyst_runs,
      cost: row.licence_cost_annual, roiMultiple: row.roi_multiple, calculatedAt: row.calculated_at,
    }];
    return csvResponse(toCSV(csvRow, [
      { key: 'period', label: 'Period' }, { key: 'identified', label: 'Value Identified (ZAR)' },
      { key: 'recovered', label: 'Value Recovered (ZAR)' }, { key: 'prevented', label: 'Prevented Losses (ZAR)' },
      { key: 'hoursSaved', label: 'Person Hours Saved' }, { key: 'runs', label: 'Catalyst Runs' },
      { key: 'cost', label: 'Platform Cost (ZAR)' }, { key: 'roiMultiple', label: 'ROI Multiple' },
    ]), 'roi-tracking.csv');
  }

  // v60 attribution — split the recovered total per ERP/subsystem connection
  // so the customer can audit which connection drove which dollars under the
  // shared-savings model. Best-effort: never fails the response.
  const recovered = (row.total_discrepancy_value_recovered as number) || 0;
  const identified = (row.total_discrepancy_value_identified as number) || 0;
  let byConnection: Awaited<ReturnType<typeof computeRoiAttribution>> = [];
  try {
    byConnection = await computeRoiAttribution(c.env.DB, tenantId, recovered);
  } catch { /* leave empty */ }

  // v63 — split identified opportunity by action state (automated vs
  // pending vs open). This proves the read→action loop is closed
  // end-to-end and shows the customer where each rand of opportunity
  // sits in the realisation pipeline.
  const byActionState = await computeActionAttribution(c.env.DB, tenantId, identified);

  return c.json({
    id: row.id, period: row.period,
    totalDiscrepancyValueIdentified: row.total_discrepancy_value_identified,
    totalDiscrepancyValueRecovered: row.total_discrepancy_value_recovered,
    totalPreventedLosses: row.total_downstream_losses_prevented,
    totalPersonHoursSaved: row.total_person_hours_saved,
    totalCatalystRuns: row.total_catalyst_runs,
    platformCost: row.licence_cost_annual,
    roiMultiple: row.roi_multiple, calculatedAt: row.calculated_at,
    breakdown: { byCluster: [], byConnection, byActionState },
  });
});

// GET /api/roi/history — ROI history
roi.get('/history', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const limit = Math.min(parseInt(c.req.query('limit') || '12', 10) || 12, 36);
  const results = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY period DESC LIMIT ?').bind(tenantId, limit).all();
  const history = results.results.map((r: Record<string, unknown>) => ({
    period: r.period,
    totalDiscrepancyValueIdentified: r.total_discrepancy_value_identified,
    totalDiscrepancyValueRecovered: r.total_discrepancy_value_recovered,
    roiMultiple: r.roi_multiple, calculatedAt: r.calculated_at,
  }));
  return c.json({ history, total: history.length });
});

// GET /api/roi/export — Export ROI data
roi.get('/export', async (c) => {
  const tenantId = getTenantId(c);
  if (!tenantId) return c.json({ error: 'tenant_id required' }, 400);

  // Recalculate first
  try { await calculateROI(c.env.DB, tenantId); } catch { /* use existing data */ }

  const results = await c.env.DB.prepare('SELECT * FROM roi_tracking WHERE tenant_id = ? ORDER BY period DESC').bind(tenantId).all();
  const rows = results.results.map((r: Record<string, unknown>) => ({
    period: r.period,
    identified: r.total_discrepancy_value_identified,
    recovered: r.total_discrepancy_value_recovered,
    prevented: r.total_downstream_losses_prevented,
    personHours: r.total_person_hours_saved,
    runs: r.total_catalyst_runs,
    licenceCost: r.licence_cost_annual,
    roiMultiple: r.roi_multiple,
  }));
  return c.json({ export: rows, total: rows.length, currency: 'ZAR' });
});

export default roi;
