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

/**
 * GET /api/v1/insights-stats/platform-totals
 *
 * Cross-feature rollup for the header chip + ROI dashboard. Pulls a single
 * row of totals from the tenant's full operating history so the operator
 * sees one number per thing-that-matters across every catalyst, every run,
 * every action — not just the latest period.
 *
 * Returns lifetime aggregates by default; pass `?lookback_days=N` to scope
 * to a window. All counts are best-effort: failures on individual tables
 * fall back to 0 rather than breaking the chip.
 */
stats.get('/platform-totals', async (c) => {
  const tid = tenant(c);
  if (!tid) return c.json({ error: 'tenant_id required' }, 400);
  const daysParam = c.req.query('lookback_days');
  const lookbackDays = daysParam ? Math.max(1, Math.min(3650, parseInt(daysParam, 10) || 365)) : null;
  const sinceClause = lookbackDays
    ? ` AND created_at > datetime('now', '-${lookbackDays} days')`
    : '';

  // Helper: best-effort single-row aggregate. Returns null on any failure
  // so callers fall back to 0 rather than 500-ing the whole rollup.
  async function safeOne<T extends Record<string, unknown>>(sql: string): Promise<T | null> {
    try {
      return await c.env.DB.prepare(sql).bind(tid).first<T>();
    } catch { return null; }
  }

  const [runs, items, actions, savings, anomalies, risksRow] = await Promise.all([
    safeOne<{ n: number; matched: number; disc: number; exc: number }>(
      `SELECT COUNT(*) as n,
              COALESCE(SUM(matched), 0) as matched,
              COALESCE(SUM(discrepancies), 0) as disc,
              COALESCE(SUM(exceptions_raised), 0) as exc
         FROM sub_catalyst_runs WHERE tenant_id = ?${sinceClause}`,
    ),
    safeOne<{ n: number; matched: number; disc: number; exc: number; total_value: number; disc_value: number }>(
      `SELECT COUNT(*) as n,
              SUM(CASE WHEN item_status = 'matched' THEN 1 ELSE 0 END) as matched,
              SUM(CASE WHEN item_status = 'discrepancy' THEN 1 ELSE 0 END) as disc,
              SUM(CASE WHEN item_status = 'exception' THEN 1 ELSE 0 END) as exc,
              COALESCE(SUM(source_amount), 0) as total_value,
              COALESCE(SUM(discrepancy_amount), 0) as disc_value
         FROM sub_catalyst_run_items WHERE tenant_id = ?${sinceClause}`,
    ),
    safeOne<{ verified: number; pending: number; total: number }>(
      `SELECT
         SUM(CASE WHEN verification_status = 'verified' THEN 1 ELSE 0 END) as verified,
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
         COUNT(*) as total
       FROM catalyst_actions WHERE tenant_id = ?${sinceClause}`,
    ),
    safeOne<{ realised: number; atheon: number; currency: string }>(
      `SELECT
         COALESCE(SUM(total_realised_savings), 0) as realised,
         COALESCE(SUM(atheon_revenue), 0) as atheon,
         COALESCE(MAX(currency), 'ZAR') as currency
       FROM billable_periods WHERE tenant_id = ?`,
    ),
    safeOne<{ open: number; total: number }>(
      `SELECT SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open,
              COUNT(*) as total
         FROM anomalies WHERE tenant_id = ?${sinceClause}`,
    ),
    safeOne<{ critical: number; high: number; total: number }>(
      `SELECT
         SUM(CASE WHEN severity = 'critical' THEN 1 ELSE 0 END) as critical,
         SUM(CASE WHEN severity = 'high' THEN 1 ELSE 0 END) as high,
         COUNT(*) as total
       FROM risk_alerts WHERE tenant_id = ?${sinceClause}`,
    ),
  ]);

  return c.json({
    lookback_days: lookbackDays,
    runs: {
      total: runs?.n ?? 0,
      matched: runs?.matched ?? 0,
      discrepancies: runs?.disc ?? 0,
      exceptions: runs?.exc ?? 0,
    },
    items: {
      total: items?.n ?? 0,
      matched: items?.matched ?? 0,
      discrepancies: items?.disc ?? 0,
      exceptions: items?.exc ?? 0,
      processed_value: items?.total_value ?? 0,
      discrepancy_value: items?.disc_value ?? 0,
    },
    actions: {
      total: actions?.total ?? 0,
      verified: actions?.verified ?? 0,
      pending: actions?.pending ?? 0,
    },
    risks: {
      total: risksRow?.total ?? 0,
      critical: risksRow?.critical ?? 0,
      high: risksRow?.high ?? 0,
    },
    anomalies: {
      total: anomalies?.total ?? 0,
      open: anomalies?.open ?? 0,
    },
    savings: {
      total_realised: savings?.realised ?? 0,
      atheon_revenue: savings?.atheon ?? 0,
      currency: savings?.currency ?? 'ZAR',
    },
  });
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
