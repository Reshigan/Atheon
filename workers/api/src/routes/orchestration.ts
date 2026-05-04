/**
 * Orchestration Routes — Phase 10-22.
 *
 * POST  /api/v1/orchestration/workflows                  — define new workflow
 * GET   /api/v1/orchestration/workflows                  — list workflows
 * POST  /api/v1/orchestration/workflows/:id/runs         — start a run
 * GET   /api/v1/orchestration/runs/:id                   — get run status
 * POST  /api/v1/orchestration/runs/:id/approve-step      — approve a manual_gate step
 *       Body: { step_index: number }
 * POST  /api/v1/orchestration/runs/:id/advance           — manually trigger advance
 *       (cron sweeps run periodically too)
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import {
  defineWorkflow,
  startRun,
  approveStep,
  getRunStatus,
  advanceRunsForTenant,
  type WorkflowDefinition,
} from '../services/orchestration-engine';

const orch = new Hono<AppBindings>();

function getAuth(c: { get: (key: string) => unknown }): AuthContext | null {
  return (c.get('auth') as AuthContext | undefined) ?? null;
}

orch.post('/workflows', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  let body: WorkflowDefinition;
  try { body = await c.req.json<WorkflowDefinition>(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  try {
    const { workflowId } = await defineWorkflow(c.env.DB, auth.tenantId, body);
    return c.json({ workflow_id: workflowId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'invalid workflow' }, 400);
  }
});

orch.get('/workflows', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const r = await c.env.DB.prepare(
    `SELECT id, name, description, steps, enabled, created_at, updated_at
       FROM orchestration_workflows WHERE tenant_id = ?
      ORDER BY created_at DESC LIMIT 100`
  ).bind(auth.tenantId).all();
  return c.json({ workflows: r.results || [] });
});

interface StartRunBody { context_data?: Record<string, unknown> }

orch.post('/workflows/:id/runs', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const wfId = c.req.param('id');
  let body: StartRunBody = {};
  try { body = await c.req.json<StartRunBody>(); } catch { /* empty body OK */ }
  try {
    const { runId } = await startRun(c.env.DB, auth.tenantId, wfId,
      auth.userId || 'unknown', body.context_data ?? {});
    return c.json({ run_id: runId }, 201);
  } catch (e) {
    return c.json({ error: e instanceof Error ? e.message : 'failed to start' }, 400);
  }
});

orch.get('/runs/:id', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const runId = c.req.param('id');
  const status = await getRunStatus(c.env.DB, auth.tenantId, runId);
  if (!status) return c.json({ error: 'run not found' }, 404);
  return c.json(status);
});

interface ApproveBody { step_index: number }

orch.post('/runs/:id/approve-step', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const runId = c.req.param('id');
  let body: ApproveBody;
  try { body = await c.req.json<ApproveBody>(); }
  catch { return c.json({ error: 'invalid JSON body' }, 400); }
  if (typeof body.step_index !== 'number') return c.json({ error: 'step_index required' }, 400);
  const r = await approveStep(c.env.DB, auth.tenantId, runId, body.step_index,
    auth.userId || 'unknown');
  return c.json(r);
});

orch.post('/runs/:id/advance', async (c) => {
  const auth = getAuth(c);
  if (!auth?.tenantId) return c.json({ error: 'tenant_id required' }, 400);
  const result = await advanceRunsForTenant(c.env.DB, auth.tenantId);
  return c.json(result);
});

export default orch;
