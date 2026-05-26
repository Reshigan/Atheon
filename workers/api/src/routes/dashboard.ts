import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';

const dashboard = new Hono<AppBindings>();

const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  const defaultTenantId = auth?.tenantId || c.req.query('tenant_id') || '';
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

function isAdminPlus(role?: string): boolean {
  return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'executive';
}

// GET /dashboard/working-capital — latest snapshot + 30d history
dashboard.get('/working-capital', async (c) => {
  const tenantId = getTenantId(c);

  const latest = await c.env.DB.prepare(
    'SELECT * FROM dashboard_working_capital WHERE tenant_id = ? ORDER BY snapshot_date DESC LIMIT 1'
  ).bind(tenantId).first<Record<string, unknown>>();

  const history = await c.env.DB.prepare(
    'SELECT snapshot_date, cash_position_zar, ar_total_zar, dso_days, dpo_days, dsi_days, working_capital_zar FROM dashboard_working_capital WHERE tenant_id = ? ORDER BY snapshot_date DESC LIMIT 30'
  ).bind(tenantId).all<Record<string, unknown>>();

  if (!latest) {
    return c.json({
      latest: null,
      history: [],
      sparklines: { cash: [], dso: [], dpo: [], wc: [] },
    });
  }

  const sortedHistory = (history.results || []).slice().reverse();
  const sparklines = {
    cash: sortedHistory.map((h) => Number(h.cash_position_zar) || 0),
    dso: sortedHistory.map((h) => Number(h.dso_days) || 0),
    dpo: sortedHistory.map((h) => Number(h.dpo_days) || 0),
    wc: sortedHistory.map((h) => Number(h.working_capital_zar) || 0),
  };

  let priorSnapshot: Record<string, unknown> | null = null;
  if (sortedHistory.length >= 2) priorSnapshot = sortedHistory[sortedHistory.length - 2] || null;

  const arTotal = Number(latest.ar_total_zar) || 0;
  const buckets = arTotal > 0 ? {
    currentPct: (Number(latest.ar_current_zar) || 0) / arTotal * 100,
    days30Pct: (Number(latest.ar_30_zar) || 0) / arTotal * 100,
    days60Pct: (Number(latest.ar_60_zar) || 0) / arTotal * 100,
    days90PlusPct: (Number(latest.ar_90_plus_zar) || 0) / arTotal * 100,
  } : { currentPct: 0, days30Pct: 0, days60Pct: 0, days90PlusPct: 0 };

  const delta = priorSnapshot ? {
    cash: (Number(latest.cash_position_zar) || 0) - (Number(priorSnapshot.cash_position_zar) || 0),
    dsoDays: (Number(latest.dso_days) || 0) - (Number(priorSnapshot.dso_days) || 0),
    workingCapital: (Number(latest.working_capital_zar) || 0) - (Number(priorSnapshot.working_capital_zar) || 0),
  } : { cash: 0, dsoDays: 0, workingCapital: 0 };

  return c.json({
    latest: {
      snapshotDate: latest.snapshot_date,
      cashPositionZar: Number(latest.cash_position_zar) || 0,
      arTotalZar: arTotal,
      arCurrentZar: Number(latest.ar_current_zar) || 0,
      ar30Zar: Number(latest.ar_30_zar) || 0,
      ar60Zar: Number(latest.ar_60_zar) || 0,
      ar90PlusZar: Number(latest.ar_90_plus_zar) || 0,
      apTotalZar: Number(latest.ap_total_zar) || 0,
      dsoDays: Number(latest.dso_days) || 0,
      dpoDays: Number(latest.dpo_days) || 0,
      dsiDays: Number(latest.dsi_days) || 0,
      workingCapitalZar: Number(latest.working_capital_zar) || 0,
    },
    buckets,
    delta,
    sparklines,
    history: sortedHistory,
  });
});

// POST /dashboard/working-capital — upsert a daily snapshot (admin+)
dashboard.post('/working-capital', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const snapshotDate = typeof body.snapshotDate === 'string' ? body.snapshotDate : new Date().toISOString().slice(0, 10);
  const num = (k: string) => typeof body[k] === 'number' ? body[k] as number : 0;
  const id = `dwc_${snapshotDate}_${tenantId}`.replace(/[^a-zA-Z0-9_]/g, '_');

  await c.env.DB.prepare(
    `INSERT INTO dashboard_working_capital (id, tenant_id, snapshot_date, cash_position_zar, ar_total_zar, ar_current_zar, ar_30_zar, ar_60_zar, ar_90_plus_zar, ap_total_zar, dso_days, dpo_days, dsi_days, working_capital_zar)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, snapshot_date) DO UPDATE SET
       cash_position_zar = excluded.cash_position_zar,
       ar_total_zar = excluded.ar_total_zar,
       ar_current_zar = excluded.ar_current_zar,
       ar_30_zar = excluded.ar_30_zar,
       ar_60_zar = excluded.ar_60_zar,
       ar_90_plus_zar = excluded.ar_90_plus_zar,
       ap_total_zar = excluded.ap_total_zar,
       dso_days = excluded.dso_days,
       dpo_days = excluded.dpo_days,
       dsi_days = excluded.dsi_days,
       working_capital_zar = excluded.working_capital_zar`
  ).bind(
    id, tenantId, snapshotDate,
    num('cashPositionZar'), num('arTotalZar'), num('arCurrentZar'),
    num('ar30Zar'), num('ar60Zar'), num('ar90PlusZar'),
    num('apTotalZar'), num('dsoDays'), num('dpoDays'), num('dsiDays'),
    num('workingCapitalZar')
  ).run();

  return c.json({ ok: true, id });
});

// GET /dashboard/close-cycle — current open cycle + task summary
dashboard.get('/close-cycle', async (c) => {
  const tenantId = getTenantId(c);

  const cycle = await c.env.DB.prepare(
    `SELECT * FROM dashboard_close_cycles
     WHERE tenant_id = ? AND status IN ('in_progress', 'pending')
     ORDER BY target_close_date ASC LIMIT 1`
  ).bind(tenantId).first<Record<string, unknown>>();

  if (!cycle) {
    const last = await c.env.DB.prepare(
      `SELECT * FROM dashboard_close_cycles WHERE tenant_id = ? ORDER BY target_close_date DESC LIMIT 1`
    ).bind(tenantId).first<Record<string, unknown>>();
    if (!last) return c.json({ cycle: null, tasks: [], summary: null });
    return c.json({ cycle: shapeCycle(last), tasks: [], summary: shapeSummary(last) });
  }

  const tasks = await c.env.DB.prepare(
    `SELECT id, task_name, owner, status, due_date, blocking, completed_at
     FROM dashboard_close_tasks WHERE tenant_id = ? AND cycle_id = ? ORDER BY blocking DESC, due_date ASC`
  ).bind(tenantId, cycle.id).all<Record<string, unknown>>();

  return c.json({
    cycle: shapeCycle(cycle),
    tasks: (tasks.results || []).map((t) => ({
      id: t.id,
      taskName: t.task_name,
      owner: t.owner,
      status: t.status,
      dueDate: t.due_date,
      blocking: !!t.blocking,
      completedAt: t.completed_at,
    })),
    summary: shapeSummary(cycle),
  });
});

function shapeCycle(c: Record<string, unknown>) {
  return {
    id: c.id,
    periodLabel: c.period_label,
    startDate: c.start_date,
    targetCloseDate: c.target_close_date,
    status: c.status,
    totalTasks: Number(c.total_tasks) || 0,
    completedTasks: Number(c.completed_tasks) || 0,
    blockingTasks: Number(c.blocking_tasks) || 0,
    onSchedule: !!c.on_schedule,
    notes: c.notes,
  };
}

function shapeSummary(c: Record<string, unknown>) {
  const total = Number(c.total_tasks) || 0;
  const completed = Number(c.completed_tasks) || 0;
  const blocking = Number(c.blocking_tasks) || 0;
  const target = c.target_close_date as string;
  const now = new Date();
  const targetDate = new Date(target + 'T00:00:00Z');
  const daysRemaining = Math.ceil((targetDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
  return {
    progressPct: total > 0 ? (completed / total) * 100 : 0,
    daysRemaining,
    blockingCount: blocking,
    onSchedule: !!c.on_schedule,
  };
}

// PATCH /dashboard/close-cycle/:id — admin+ updates the cycle (mark a task complete, etc.)
dashboard.patch('/close-cycle/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const updates: string[] = [];
  const params: unknown[] = [];
  const stringFields = ['status', 'notes'];
  for (const f of stringFields) {
    if (typeof body[f] === 'string') { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  const numFields = ['total_tasks', 'completed_tasks', 'blocking_tasks'];
  for (const f of numFields) {
    if (typeof body[f] === 'number') { updates.push(`${f} = ?`); params.push(body[f]); }
  }
  if (typeof body.on_schedule === 'boolean') { updates.push('on_schedule = ?'); params.push(body.on_schedule ? 1 : 0); }
  if (!updates.length) return c.json({ error: 'no fields to update' }, 400);
  updates.push("updated_at = datetime('now')");
  params.push(id, tenantId);
  const res = await c.env.DB.prepare(`UPDATE dashboard_close_cycles SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`).bind(...params).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);
  return c.json({ ok: true });
});

// PATCH /dashboard/close-tasks/:id — toggle a single task complete
dashboard.patch('/close-tasks/:id', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth || !isAdminPlus(auth.role)) return c.json({ error: 'Forbidden' }, 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const { data: body, errors } = await getValidatedJsonBody<Record<string, unknown>>(c, []);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const status = typeof body.status === 'string' ? body.status : null;
  if (!status) return c.json({ error: 'status required' }, 400);

  const completedAt = status === 'completed' ? new Date().toISOString() : null;
  const res = await c.env.DB.prepare(
    `UPDATE dashboard_close_tasks SET status = ?, completed_at = ? WHERE id = ? AND tenant_id = ?`
  ).bind(status, completedAt, id, tenantId).run();
  if (!res.meta.changes) return c.json({ error: 'not found' }, 404);

  const task = await c.env.DB.prepare('SELECT cycle_id FROM dashboard_close_tasks WHERE id = ? AND tenant_id = ?').bind(id, tenantId).first<Record<string, unknown>>();
  if (task) {
    const counts = await c.env.DB.prepare(
      `SELECT COUNT(*) as total, SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed, SUM(CASE WHEN blocking = 1 AND status != 'completed' THEN 1 ELSE 0 END) as blocking
       FROM dashboard_close_tasks WHERE tenant_id = ? AND cycle_id = ?`
    ).bind(tenantId, task.cycle_id).first<Record<string, unknown>>();
    if (counts) {
      await c.env.DB.prepare(
        `UPDATE dashboard_close_cycles SET total_tasks = ?, completed_tasks = ?, blocking_tasks = ?, updated_at = datetime('now') WHERE id = ? AND tenant_id = ?`
      ).bind(Number(counts.total) || 0, Number(counts.completed) || 0, Number(counts.blocking) || 0, task.cycle_id, tenantId).run();
    }
  }

  return c.json({ ok: true });
});

export default dashboard;
