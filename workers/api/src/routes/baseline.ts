/**
 * §11.2 Baseline Snapshots — Before/After Comparison
 * POST /capture, GET /, GET /comparison
 */

import { Hono } from 'hono';
import type { AppBindings } from '../types';

const app = new Hono<AppBindings>();

// Helper: capture a baseline snapshot
async function captureSnapshot(db: D1Database, tenantId: string, snapshotType: string): Promise<string> {
  const id = crypto.randomUUID();

  // Get current health score
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();
  const healthScore = (health?.overall_score as number) || 0;
  const dimensions = (health?.dimensions as string) || '{}';

  // Get metric status counts
  const greens = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'green'").bind(tenantId).first<{ c: number }>();
  const ambers = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'amber'").bind(tenantId).first<{ c: number }>();
  const reds = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'red'").bind(tenantId).first<{ c: number }>();

  // Get discrepancy value
  const discVal = await db.prepare(
    'SELECT SUM(total_discrepancy_value) as total FROM sub_catalyst_runs WHERE tenant_id = ?'
  ).bind(tenantId).first<{ total: number | null }>();

  // Get process conformance
  const conformance = await db.prepare(
    'SELECT AVG(conformance_rate) as avg FROM process_flows WHERE tenant_id = ?'
  ).bind(tenantId).first<{ avg: number | null }>();

  // Get catalyst success rate
  const successRate = await db.prepare(
    'SELECT AVG(success_rate) as avg FROM catalyst_effectiveness WHERE tenant_id = ?'
  ).bind(tenantId).first<{ avg: number | null }>();

  // Get ROI
  const roi = await db.prepare(
    'SELECT total_discrepancy_value_recovered FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(tenantId).first();

  await db.prepare(
    `INSERT INTO baseline_snapshots (id, tenant_id, snapshot_type, health_score, dimensions,
     metric_count_green, metric_count_amber, metric_count_red,
     total_discrepancy_value, total_process_conformance, avg_catalyst_success_rate,
     roi_at_snapshot, raw_data, captured_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}', datetime('now'))`
  ).bind(
    id, tenantId, snapshotType, healthScore, dimensions,
    greens?.c || 0, ambers?.c || 0, reds?.c || 0,
    discVal?.total || 0, conformance?.avg || 0, successRate?.avg || 0,
    (roi?.total_discrepancy_value_recovered as number) || 0,
  ).run();

  return id;
}

// POST /capture — Capture a snapshot now
app.post('/capture', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;

  let body: { snapshotType?: string } = {};
  try { body = await c.req.json(); } catch { /* empty body OK */ }

  const snapshotType = body.snapshotType || 'manual';

  // Check if day_zero already exists
  if (snapshotType === 'day_zero') {
    const existing = await db.prepare(
      "SELECT id FROM baseline_snapshots WHERE tenant_id = ? AND snapshot_type = 'day_zero'"
    ).bind(auth.tenantId).first();
    if (existing) {
      return c.json({ error: 'Day zero snapshot already exists', existingId: existing.id }, 409);
    }
  }

  const id = await captureSnapshot(db, auth.tenantId, snapshotType);
  return c.json({ id, snapshotType });
});

// GET / — List all snapshots
app.get('/', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;

  const snapshots = await db.prepare(
    'SELECT * FROM baseline_snapshots WHERE tenant_id = ? ORDER BY captured_at ASC'
  ).bind(auth.tenantId).all();

  return c.json({
    snapshots: snapshots.results.map((s: Record<string, unknown>) => ({
      id: s.id,
      snapshotType: s.snapshot_type,
      healthScore: s.health_score,
      dimensions: JSON.parse((s.dimensions as string) || '{}'),
      metricCountGreen: s.metric_count_green,
      metricCountAmber: s.metric_count_amber,
      metricCountRed: s.metric_count_red,
      totalDiscrepancyValue: s.total_discrepancy_value,
      totalProcessConformance: s.total_process_conformance,
      avgCatalystSuccessRate: s.avg_catalyst_success_rate,
      roiAtSnapshot: s.roi_at_snapshot,
      capturedAt: s.captured_at,
    })),
  });
});

// GET /comparison — Before/after comparison between day_zero and current
app.get('/comparison', async (c) => {
  const auth = c.get('auth');
  const db = c.env.DB;

  const dayZero = await db.prepare(
    "SELECT * FROM baseline_snapshots WHERE tenant_id = ? AND snapshot_type = 'day_zero' LIMIT 1"
  ).bind(auth.tenantId).first();

  if (!dayZero) {
    return c.json({ dayZero: null, current: null, improvement: null, narrative: 'No day zero snapshot captured yet' });
  }

  // Get current values
  const health = await db.prepare(
    'SELECT overall_score, dimensions FROM health_scores WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(auth.tenantId).first();
  const greens = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'green'").bind(auth.tenantId).first<{ c: number }>();
  const ambers = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'amber'").bind(auth.tenantId).first<{ c: number }>();
  const reds = await db.prepare("SELECT COUNT(*) as c FROM process_metrics WHERE tenant_id = ? AND status = 'red'").bind(auth.tenantId).first<{ c: number }>();
  const roi = await db.prepare(
    'SELECT total_discrepancy_value_recovered, roi_multiple FROM roi_tracking WHERE tenant_id = ? ORDER BY calculated_at DESC LIMIT 1'
  ).bind(auth.tenantId).first();
  const conformance = await db.prepare(
    'SELECT AVG(conformance_rate) as avg FROM process_flows WHERE tenant_id = ?'
  ).bind(auth.tenantId).first<{ avg: number | null }>();
  const successRate = await db.prepare(
    'SELECT AVG(success_rate) as avg FROM catalyst_effectiveness WHERE tenant_id = ?'
  ).bind(auth.tenantId).first<{ avg: number | null }>();
  const discVal = await db.prepare(
    'SELECT SUM(total_discrepancy_value) as total FROM sub_catalyst_runs WHERE tenant_id = ?'
  ).bind(auth.tenantId).first<{ total: number | null }>();

  const currentHealth = (health?.overall_score as number) || 0;
  const baselineHealth = (dayZero.health_score as number) || 0;

  const dayZeroSnapshot = {
    id: dayZero.id as string,
    snapshotType: dayZero.snapshot_type as string,
    healthScore: baselineHealth,
    dimensions: JSON.parse((dayZero.dimensions as string) || '{}'),
    metricCountGreen: dayZero.metric_count_green as number,
    metricCountAmber: dayZero.metric_count_amber as number,
    metricCountRed: dayZero.metric_count_red as number,
    totalDiscrepancyValue: dayZero.total_discrepancy_value as number,
    totalProcessConformance: dayZero.total_process_conformance as number,
    avgCatalystSuccessRate: dayZero.avg_catalyst_success_rate as number,
    roiAtSnapshot: dayZero.roi_at_snapshot as number,
    capturedAt: dayZero.captured_at as string,
  };

  const currentSnapshot = {
    id: 'current',
    snapshotType: 'current',
    healthScore: currentHealth,
    dimensions: JSON.parse((health?.dimensions as string) || '{}'),
    metricCountGreen: greens?.c || 0,
    metricCountAmber: ambers?.c || 0,
    metricCountRed: reds?.c || 0,
    totalDiscrepancyValue: discVal?.total || 0,
    totalProcessConformance: conformance?.avg || 0,
    avgCatalystSuccessRate: successRate?.avg || 0,
    roiAtSnapshot: (roi?.total_discrepancy_value_recovered as number) || 0,
    capturedAt: new Date().toISOString(),
  };

  const improvement = {
    healthScore: currentHealth - baselineHealth,
    metricCountGreen: (greens?.c || 0) - (dayZero.metric_count_green as number),
    discrepancyValue: (discVal?.total || 0) - (dayZero.total_discrepancy_value as number),
    processConformance: (conformance?.avg || 0) - (dayZero.total_process_conformance as number),
    catalystSuccessRate: (successRate?.avg || 0) - (dayZero.avg_catalyst_success_rate as number),
    roi: (roi?.roi_multiple as number) || 0,
  };

  // Generate narrative
  const direction = improvement.healthScore >= 0 ? 'improved' : 'declined';
  const recovered = (roi?.total_discrepancy_value_recovered as number) || 0;
  const redDelta = (reds?.c || 0) - (dayZero.metric_count_red as number);
  const narrative = `Since deploying Atheon on ${(dayZero.captured_at as string).split('T')[0]}, your health score has ${direction} from ${baselineHealth} to ${currentHealth} (${improvement.healthScore >= 0 ? '+' : ''}${improvement.healthScore} points). ${redDelta < 0 ? `${Math.abs(redDelta)} fewer red metrics.` : ''} ${recovered > 0 ? `R${recovered.toLocaleString()} recovered through catalyst operations.` : ''}`;

  return c.json({ dayZero: dayZeroSnapshot, current: currentSnapshot, improvement, narrative });
});

export { captureSnapshot };
export default app;
