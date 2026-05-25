/**
 * §11.8 Executive Mobile View — Single-Page Summary
 * GET /api/executive-summary — Returns everything needed for the mobile executive page
 * Target: loads in < 2 seconds
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

const app = new Hono<AppBindings>();

// GET / — Full executive summary for mobile view
app.get('/', async (c) => {
  const auth = c.get('auth');
  const tenantId = auth.tenantId;
  const db = c.env.DB;

  // Parallel queries for speed
  const [health, roi, activeRcas, pendingRx, signals, scoreHistory, targets, baseline] = await Promise.all([
    db.prepare('SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first(),
    db.prepare('SELECT total_discrepancy_value_recovered, roi_multiple, platform_cost FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1').bind(tenantId).first(),
    db.prepare("SELECT COUNT(*) as cnt FROM root_cause_analyses WHERE tenant_id = ? AND status = 'active'").bind(tenantId).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM diagnostic_prescriptions WHERE tenant_id = ? AND status = 'pending'").bind(tenantId).first<{ cnt: number }>(),
    db.prepare("SELECT COUNT(*) as cnt FROM external_signals WHERE tenant_id = ? AND detected_at >= datetime('now', '-7 days')").bind(tenantId).first<{ cnt: number }>(),
    db.prepare('SELECT score, recorded_at FROM atheon_score_history WHERE tenant_id = ? ORDER BY recorded_at DESC LIMIT 12').bind(tenantId).all(),
    db.prepare("SELECT target_type, target_name, target_value, current_value, status FROM health_targets WHERE tenant_id = ? AND status = 'active' LIMIT 5").bind(tenantId).all(),
    db.prepare("SELECT health_score, captured_at FROM baseline_snapshots WHERE tenant_id = ? AND snapshot_type = 'day_zero' LIMIT 1").bind(tenantId).first(),
  ]);

  const healthScore = (health?.overall_score as number) || 0;
  const dimensions = health?.dimensions ? JSON.parse(health.dimensions as string) : {};

  // Calculate Atheon Score inline (same logic as atheon-score route)
  const roiMultiple = (roi?.roi_multiple as number) || 0;
  const roiScore = Math.min(roiMultiple * 10, 100);
  const totalRcas = await db.prepare('SELECT COUNT(*) as total FROM root_cause_analyses WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();
  const resolvedRcas = await db.prepare("SELECT COUNT(*) as total FROM root_cause_analyses WHERE tenant_id = ? AND status = 'resolved'").bind(tenantId).first<{ total: number }>();
  const diagScore = (totalRcas?.total || 0) === 0 ? 100 : Math.round(((resolvedRcas?.total || 0) / (totalRcas?.total || 1)) * 100);
  const signalCount = await db.prepare('SELECT COUNT(*) as c FROM external_signals WHERE tenant_id = ?').bind(tenantId).first<{ c: number }>();
  const compCount = await db.prepare('SELECT COUNT(*) as c FROM competitors WHERE tenant_id = ?').bind(tenantId).first<{ c: number }>();
  const awarenessScore = Math.min(Math.round(((signalCount?.c || 0) + (compCount?.c || 0)) / 10 * 100), 100);
  const effectiveness = await db.prepare('SELECT AVG(recovery_rate) as avg_rate FROM catalyst_effectiveness WHERE tenant_id = ?').bind(tenantId).first<{ avg_rate: number | null }>();
  const effectivenessScore = Math.round(Math.min((effectiveness?.avg_rate || 0) * 100, 100));

  const atheonScore = Math.round(healthScore * 0.30 + roiScore * 0.20 + diagScore * 0.20 + awarenessScore * 0.15 + effectivenessScore * 0.15);

  // Top risks
  const topRisks = await db.prepare(
    "SELECT title, severity, impact_value FROM risk_alerts WHERE tenant_id = ? AND status = 'active' ORDER BY CASE severity WHEN 'critical' THEN 1 WHEN 'high' THEN 2 ELSE 3 END LIMIT 3"
  ).bind(tenantId).all();

  // Trend data
  const trend = (scoreHistory.results || []).map((r: Record<string, unknown>) => ({
    score: r.score as number,
    date: r.recorded_at as string,
  })).reverse();

  // Baseline comparison
  let journeyImprovement: number | null = null;
  if (baseline?.health_score) {
    journeyImprovement = healthScore - (baseline.health_score as number);
  }

  return c.json({
    atheonScore,
    healthScore,
    dimensions,
    roi: {
      recovered: (roi?.total_discrepancy_value_recovered as number) || 0,
      multiple: roiMultiple,
      cost: (roi?.platform_cost as number) || 0,
    },
    diagnostics: {
      activeRcas: activeRcas?.cnt || 0,
      pendingPrescriptions: pendingRx?.cnt || 0,
    },
    signals: {
      newThisWeek: signals?.cnt || 0,
    },
    topRisks: topRisks.results.map((r: Record<string, unknown>) => ({
      title: r.title,
      severity: r.severity,
      impactValue: r.impact_value,
    })),
    targets: targets.results.map((t: Record<string, unknown>) => ({
      targetType: t.target_type,
      targetName: t.target_name,
      targetValue: t.target_value,
      currentValue: t.current_value,
      status: t.status,
    })),
    trend,
    journey: {
      baselineHealthScore: (baseline?.health_score as number) || null,
      baselineDate: (baseline?.captured_at as string) || null,
      improvement: journeyImprovement,
    },
  });
});

export default app;
