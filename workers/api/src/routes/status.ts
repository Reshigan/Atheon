/**
 * Public platform status + incident timeline.
 *
 * Phase AZ procurement gate: enterprises with 3000+ headcount run vendor
 * risk assessments that require a public status page + documented uptime.
 * This route surfaces:
 *   - Live D1 health (same probe as /healthz, but presented for humans)
 *   - Latest incident (if any open) so impacted customers see it without
 *     having to refresh the dashboard
 *   - Last 90 days of resolved incidents for the procurement narrative
 *
 * Public (no auth) by design — Status pages are part of the trust surface
 * and Big-4 reviewers will probe this URL during vendor onboarding.
 */
import { Hono } from 'hono';
import type { AppBindings } from '../types';

const status = new Hono<AppBindings>();

interface IncidentRow {
  id: string;
  title: string;
  severity: string;
  status: string;
  impact: string | null;
  components: string;
  updates: string;
  started_at: string;
  resolved_at: string | null;
  updated_at: string;
}

function parseJsonArray(s: string | null | undefined, fallback: unknown[] = []): unknown[] {
  if (!s) return fallback;
  try { const v = JSON.parse(s); return Array.isArray(v) ? v : fallback; } catch { return fallback; }
}

function rowToPublic(r: IncidentRow) {
  return {
    id: r.id,
    title: r.title,
    severity: r.severity,
    status: r.status,
    impact: r.impact,
    components: parseJsonArray(r.components),
    updates: parseJsonArray(r.updates),
    startedAt: r.started_at,
    resolvedAt: r.resolved_at,
    updatedAt: r.updated_at,
  };
}

// GET /api/status — composite public status payload.
status.get('/', async (c) => {
  // The public status endpoint must never 500 — if it does, monitoring
  // tools think we're down. So both the open-incident and recent-history
  // queries are individually wrapped: a missing table or query error
  // degrades gracefully to "no incidents" rather than blowing up the
  // entire status payload.
  let open: IncidentRow | null = null;
  try {
    open = await c.env.DB.prepare(
      `SELECT id, title, severity, status, impact, components, updates,
              started_at, resolved_at, updated_at
         FROM system_incidents
        WHERE resolved_at IS NULL
        ORDER BY CASE severity
                   WHEN 'major_outage' THEN 1
                   WHEN 'partial_outage' THEN 2
                   WHEN 'degraded' THEN 3
                   ELSE 4 END,
                 started_at DESC
        LIMIT 1`
    ).first<IncidentRow>();
  } catch {
    // table missing on a brand-new deploy — treat as no open incident
    open = null;
  }

  let recent: { results?: IncidentRow[] } = { results: [] };
  try {
    recent = await c.env.DB.prepare(
      `SELECT id, title, severity, status, impact, components, updates,
              started_at, resolved_at, updated_at
         FROM system_incidents
        WHERE started_at >= datetime('now', '-90 days')
        ORDER BY started_at DESC
        LIMIT 40`
    ).all<IncidentRow>();
  } catch {
    recent = { results: [] };
  }

  // 3. D1 health probe — same path /healthz uses but mapped to the
  // status-page vocabulary (operational / degraded).
  let dbHealthy = true;
  let dbLatencyMs = 0;
  try {
    const t0 = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    dbLatencyMs = Date.now() - t0;
    dbHealthy = dbLatencyMs < 2000;
  } catch {
    dbHealthy = false;
  }

  const overallStatus = open
    ? open.severity
    : (dbHealthy ? 'operational' : 'degraded');

  return c.json({
    status: overallStatus,
    components: {
      api: 'operational',
      database: dbHealthy ? 'operational' : 'degraded',
      // We don't probe cache + storage on the public path to avoid letting
      // anonymous traffic exercise our quota — they're flagged operational
      // unless an incident says otherwise.
      cache: 'operational',
      storage: 'operational',
    },
    probes: {
      database_ms: dbLatencyMs,
    },
    activeIncident: open ? rowToPublic(open) : null,
    incidents: (recent.results ?? []).map(rowToPublic),
    checkedAt: new Date().toISOString(),
  });
});

// GET /api/status/incidents/:id — drill into one incident (public).
status.get('/incidents/:id', async (c) => {
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, title, severity, status, impact, components, updates,
            started_at, resolved_at, updated_at
       FROM system_incidents
      WHERE id = ?`
  ).bind(id).first<IncidentRow>();
  if (!row) return c.json({ error: 'Incident not found' }, 404);
  return c.json(rowToPublic(row));
});

export default status;
