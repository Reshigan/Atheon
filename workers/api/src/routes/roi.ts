/**
 * ROI Tracking Routes
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { calculateROI } from '../services/pattern-engine-v2';
import { toCSV, csvResponse } from '../services/csv-export';
import { computeRoiAttribution } from '../services/erp-attribution';

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
  let byConnection: Awaited<ReturnType<typeof computeRoiAttribution>> = [];
  try {
    byConnection = await computeRoiAttribution(c.env.DB, tenantId, recovered);
  } catch { /* leave empty */ }

  return c.json({
    id: row.id, period: row.period,
    totalDiscrepancyValueIdentified: row.total_discrepancy_value_identified,
    totalDiscrepancyValueRecovered: row.total_discrepancy_value_recovered,
    totalPreventedLosses: row.total_downstream_losses_prevented,
    totalPersonHoursSaved: row.total_person_hours_saved,
    totalCatalystRuns: row.total_catalyst_runs,
    platformCost: row.licence_cost_annual,
    roiMultiple: row.roi_multiple, calculatedAt: row.calculated_at,
    breakdown: { byCluster: [], byConnection },
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
