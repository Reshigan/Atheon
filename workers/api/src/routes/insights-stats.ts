/**
 * Insights Stats Routes — Phase 10-23.
 *
 * Read-only aggregates used by the ROI / Insights dashboard:
 *
 *   GET /api/v1/insights-stats/calibration?lookback_days=90
 *     Per-gate stats (true/false positive counts + recommendation:
 *     'tighten' | 'loosen' | 'hold')
 *
 *   GET /api/v1/insights-stats/forecast-accuracy?lookback_days=90
 *     Within-band rate + median absolute error %, overall + by horizon
 *
 *   GET /api/v1/insights-stats/billing-summary
 *     Cumulative shared-savings revenue: total billable_periods,
 *     total realised savings, total atheon revenue
 *
 *   GET /api/v1/insights-stats/dsar-summary
 *     DSAR request counts by type + status
 *
 * Tenant-scoped via tenantIsolation middleware.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getAllCalibrationStats } from '../services/inference-calibration';
import { getForecastAccuracyStats } from '../services/forecast-accuracy-tracker';

const stats = new Hono<AppBindings>();

function tenant(c: { get: (k: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || '';
}

stats.get('/calibration', async (c) => {
  const tid = tenant(c);
  if (!tid) return c.json({ error: 'tenant_id required' }, 400);
  const days = Math.max(7, Math.min(365, parseInt(c.req.query('lookback_days') || '90', 10) || 90));
  const all = await getAllCalibrationStats(c.env.DB, tid, days);
  return c.json({ lookback_days: days, gates: all });
});

stats.get('/forecast-accuracy', async (c) => {
  const tid = tenant(c);
  if (!tid) return c.json({ error: 'tenant_id required' }, 400);
  const days = Math.max(7, Math.min(365, parseInt(c.req.query('lookback_days') || '90', 10) || 90));
  const result = await getForecastAccuracyStats(c.env.DB, tid, days);
  return c.json({ lookback_days: days, ...result });
});

stats.get('/billing-summary', async (c) => {
  const tid = tenant(c);
  if (!tid) return c.json({ error: 'tenant_id required' }, 400);
  try {
    const r = await c.env.DB.prepare(
      `SELECT
         COUNT(*) AS periods_count,
         COALESCE(SUM(total_realised_savings), 0) AS total_realised_savings,
         COALESCE(SUM(atheon_revenue), 0) AS total_atheon_revenue,
         COALESCE(MAX(currency), 'ZAR') AS currency
       FROM billable_periods WHERE tenant_id = ?`
    ).bind(tid).first<{
      periods_count: number; total_realised_savings: number;
      total_atheon_revenue: number; currency: string;
    }>();
    return c.json({
      periods_count: r?.periods_count ?? 0,
      total_realised_savings: r?.total_realised_savings ?? 0,
      total_atheon_revenue: r?.total_atheon_revenue ?? 0,
      currency: r?.currency ?? 'ZAR',
    });
  } catch {
    return c.json({ periods_count: 0, total_realised_savings: 0, total_atheon_revenue: 0, currency: 'ZAR' });
  }
});

stats.get('/dsar-summary', async (c) => {
  const tid = tenant(c);
  if (!tid) return c.json({ error: 'tenant_id required' }, 400);
  try {
    const r = await c.env.DB.prepare(
      `SELECT request_type, status, COUNT(*) as n FROM dsar_requests
        WHERE tenant_id = ?
        GROUP BY request_type, status`
    ).bind(tid).all<{ request_type: string; status: string; n: number }>();
    return c.json({ by_type_and_status: r.results || [] });
  } catch {
    return c.json({ by_type_and_status: [] });
  }
});

export default stats;
