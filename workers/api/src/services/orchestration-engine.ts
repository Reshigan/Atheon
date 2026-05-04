/**
 * Multi-Step Catalyst Orchestration — Phase 10-22.
 *
 * Substrate for workflows that span multiple catalysts. Example:
 *   "Fix procurement cost spike" =
 *     1. renegotiate_supplier (procurement catalyst)
 *     2. wait_for_acceptance (gate)
 *     3. reissue_po (procurement catalyst)
 *     4. update_gl_coding (finance catalyst)
 *
 * Schema (v73):
 *   orchestration_workflows         — workflow definitions per tenant
 *   orchestration_runs              — instances of a workflow
 *   orchestration_step_executions   — per-step execution rows
 *
 * Step types (v1 — extensible):
 *   'log'             — record a message; advances immediately
 *   'wait'            — wait until a duration elapses (in minutes)
 *   'catalyst_action' — placeholder for triggering a catalyst (the
 *                       catalyst-engine integration is intentionally
 *                       deferred to a follow-up PR; this step type
 *                       exists so the workflow shape is forward-compatible)
 *   'manual_gate'     — block until a user marks the step approved via
 *                       the orchestration runs API
 *
 * Engine model: pull-based. The cron tick (or a queue consumer) calls
 * `advanceRunsForTenant(db, tenantId)` which scans active runs and
 * advances each one by ONE step (or marks it completed if it's at the
 * last step). This keeps the engine simple, idempotent, and resilient
 * to crashes — a half-executed step is detectable from
 * orchestration_step_executions.status.
 *
 * Strong-inference policy:
 *   - Step types are an explicit enum; unknown types fail the run
 *     rather than silently no-op
 *   - Idempotent: re-running advanceRun on a completed run is a no-op
 *   - Best-effort per run; one run's failure doesn't abort the others
 */

import { logError, logInfo } from './logger';
import { executeTask } from './catalyst-engine';
import type { CatalystQueueMessage } from './scheduled';

// ── Types ──────────────────────────────────────────────────────────────

/** Runtime dependencies passed in by the cron / queue handler so the
 *  orchestration engine can trigger catalysts. Optional everywhere so
 *  log/wait/manual_gate workflows still run from callers that don't
 *  have the full env (e.g. tests). */
export interface OrchestrationDeps {
  cache?: KVNamespace;
  ai?: Ai;
  ollamaApiKey?: string;
  queue?: Queue<CatalystQueueMessage>;
}

export type StepType = 'log' | 'wait' | 'catalyst_action' | 'manual_gate';

export interface WorkflowStep {
  name: string;
  type: StepType;
  input?: Record<string, unknown>;
}

export interface WorkflowDefinition {
  name: string;
  description?: string;
  steps: WorkflowStep[];
}

export interface RunStatus {
  id: string;
  workflowId: string;
  status: 'running' | 'completed' | 'failed' | 'blocked';
  currentStep: number;
  totalSteps: number;
  contextData: Record<string, unknown>;
  startedAt: string;
  completedAt: string | null;
  error: string | null;
}

interface RunRow {
  id: string;
  workflow_id: string;
  status: string;
  current_step: number;
  total_steps: number;
  context_data: string;
  started_at: string;
  completed_at: string | null;
  error: string | null;
}

interface WorkflowRow {
  id: string;
  steps: string;
  enabled: number;
}

interface StepExecRow {
  id: string;
  step_index: number;
  status: string;
  input: string;
  output: string | null;
  started_at: string | null;
  completed_at: string | null;
}

// ── Workflow definition ──────────────────────────────────────────────

export async function defineWorkflow(
  db: D1Database, tenantId: string, def: WorkflowDefinition,
): Promise<{ workflowId: string }> {
  if (!def.name || def.name.length < 3) throw new Error('workflow name required (≥3 chars)');
  if (!def.steps || def.steps.length === 0) throw new Error('workflow needs at least 1 step');
  for (const step of def.steps) {
    if (!step.name || !step.type) throw new Error('every step needs name + type');
    if (!['log', 'wait', 'catalyst_action', 'manual_gate'].includes(step.type)) {
      throw new Error(`unknown step type: ${step.type}`);
    }
  }
  const id = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO orchestration_workflows (id, tenant_id, name, description, steps, enabled)
     VALUES (?, ?, ?, ?, ?, 1)`
  ).bind(id, tenantId, def.name, def.description ?? null, JSON.stringify(def.steps)).run();
  return { workflowId: id };
}

// ── Run start ─────────────────────────────────────────────────────────

export async function startRun(
  db: D1Database, tenantId: string, workflowId: string,
  startedBy: string, contextData: Record<string, unknown> = {},
): Promise<{ runId: string }> {
  const wf = await db.prepare(
    `SELECT id, steps, enabled FROM orchestration_workflows
      WHERE id = ? AND tenant_id = ? LIMIT 1`
  ).bind(workflowId, tenantId).first<WorkflowRow>();
  if (!wf) throw new Error('workflow not found');
  if (!wf.enabled) throw new Error('workflow is disabled');
  const steps = JSON.parse(wf.steps) as WorkflowStep[];
  if (steps.length === 0) throw new Error('workflow has no steps');

  const runId = crypto.randomUUID();
  await db.prepare(
    `INSERT INTO orchestration_runs
       (id, tenant_id, workflow_id, status, current_step, total_steps,
        context_data, started_by, started_at)
     VALUES (?, ?, ?, 'running', 0, ?, ?, ?, datetime('now'))`
  ).bind(runId, tenantId, workflowId, steps.length, JSON.stringify(contextData), startedBy).run();
  // Pre-create pending step execution rows for traceability
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    await db.prepare(
      `INSERT INTO orchestration_step_executions
         (id, run_id, tenant_id, step_index, step_name, step_type, status, input, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, datetime('now'))`
    ).bind(
      crypto.randomUUID(), runId, tenantId, i, s.name, s.type,
      JSON.stringify(s.input ?? {}),
    ).run();
  }
  logInfo('orchestration.run_started',
    { tenantId, layer: 'orchestration', action: 'run.start' },
    { run_id: runId, workflow_id: workflowId, total_steps: steps.length });
  return { runId };
}

// ── Step executors ────────────────────────────────────────────────────

async function execLogStep(input: Record<string, unknown>): Promise<{ output: Record<string, unknown> }> {
  return { output: { logged: true, message: input.message ?? '(no message)' } };
}

async function execWaitStep(
  input: Record<string, unknown>, startedAtIso: string | null,
): Promise<{ done: boolean; output?: Record<string, unknown> }> {
  const minutes = typeof input.minutes === 'number' && Number.isFinite(input.minutes)
    ? input.minutes : 0;
  if (minutes <= 0) return { done: true, output: { waited_minutes: 0 } };
  if (!startedAtIso) return { done: false }; // not yet started
  const elapsedMs = Date.now() - new Date(startedAtIso).getTime();
  const targetMs = minutes * 60_000;
  if (elapsedMs >= targetMs) {
    return { done: true, output: { waited_minutes: elapsedMs / 60_000 } };
  }
  return { done: false, output: { remaining_ms: targetMs - elapsedMs } };
}

// ── Step advance core ────────────────────────────────────────────────

interface AdvanceOutcome {
  status: 'advanced' | 'blocked' | 'completed' | 'failed' | 'noop';
  reason?: string;
}

async function advanceRun(
  db: D1Database, tenantId: string, run: RunRow, deps?: OrchestrationDeps,
): Promise<AdvanceOutcome> {
  if (run.status !== 'running') return { status: 'noop', reason: 'not running' };
  if (run.current_step >= run.total_steps) {
    await db.prepare(
      `UPDATE orchestration_runs
          SET status = 'completed', completed_at = datetime('now')
        WHERE id = ?`
    ).bind(run.id).run();
    return { status: 'completed' };
  }

  // Find the current step exec row
  const stepExec = await db.prepare(
    `SELECT id, step_index, status, input, output, started_at, completed_at
       FROM orchestration_step_executions
      WHERE run_id = ? AND step_index = ? LIMIT 1`
  ).bind(run.id, run.current_step).first<StepExecRow>();
  if (!stepExec) {
    await db.prepare(`UPDATE orchestration_runs SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`)
      .bind('step exec row missing', run.id).run();
    return { status: 'failed', reason: 'missing step exec row' };
  }

  const stepType = await db.prepare(
    `SELECT step_type FROM orchestration_step_executions WHERE id = ?`
  ).bind(stepExec.id).first<{ step_type: string }>();
  const type = (stepType?.step_type ?? 'unknown') as StepType;

  // Mark step started if not already
  if (stepExec.status === 'pending') {
    await db.prepare(
      `UPDATE orchestration_step_executions
          SET status = 'running', started_at = datetime('now')
        WHERE id = ?`
    ).bind(stepExec.id).run();
    stepExec.status = 'running';
    stepExec.started_at = new Date().toISOString();
  }

  let inputObj: Record<string, unknown>;
  try { inputObj = JSON.parse(stepExec.input); } catch { inputObj = {}; }

  let stepCompleted = false;
  let stepBlocked = false;
  let stepOutput: Record<string, unknown> | undefined;
  let stepError: string | undefined;

  try {
    switch (type) {
      case 'log': {
        const r = await execLogStep(inputObj);
        stepOutput = r.output;
        stepCompleted = true;
        break;
      }
      case 'wait': {
        const r = await execWaitStep(inputObj, stepExec.started_at);
        if (r.done) { stepCompleted = true; stepOutput = r.output; }
        else { stepBlocked = true; stepOutput = r.output; }
        break;
      }
      case 'manual_gate': {
        // Approval is signalled by external API setting context_data.approved_step_<index>=true.
        // (See: routes/orchestration.ts POST .../approve-step)
        const ctx = JSON.parse(run.context_data) as Record<string, unknown>;
        const flag = ctx[`approved_step_${run.current_step}`];
        if (flag === true) {
          stepCompleted = true;
          stepOutput = { approved: true };
        } else {
          stepBlocked = true;
        }
        break;
      }
      case 'catalyst_action': {
        // Phase 10-24: real catalyst-engine integration.
        //
        // State machine:
        //   1. First advance for this step (no action_id in output yet):
        //      → call executeTask, persist returned action_id, mark blocked.
        //   2. Subsequent advances:
        //      → poll catalyst_actions for verification_status:
        //        - 'verified' → step completes with action_id + outcome
        //        - 'failed'   → step fails, run fails
        //        - else       → still blocked (next sweep will re-poll)
        //
        // Required inputs on `step.input`:
        //   { clusterId, catalystName, action, actionInput?,
        //     riskLevel?: 'high'|'medium'|'low', autonomyTier?: string,
        //     trustScore?: number, companyId?: string }
        //
        // When deps (cache + ai) are not provided (e.g. test caller without
        // env), we mark the step blocked with a 'deps_missing' reason so
        // the cron path can re-try once it has the env. This keeps unit
        // tests for log/wait/manual_gate decoupled from catalyst-engine.

        let prevOutput: Record<string, unknown> = {};
        try { prevOutput = JSON.parse(stepExec.output ?? '{}'); } catch { prevOutput = {}; }
        const existingActionId = typeof prevOutput.action_id === 'string'
          ? prevOutput.action_id : null;

        if (existingActionId) {
          // Re-poll catalyst_actions for status
          const actionRow = await db.prepare(
            `SELECT status, verification_status, verification_notes, output_data
               FROM catalyst_actions WHERE id = ? AND tenant_id = ? LIMIT 1`
          ).bind(existingActionId, tenantId).first<{
            status: string; verification_status: string | null;
            verification_notes: string | null; output_data: string | null;
          }>();
          if (!actionRow) {
            stepError = `catalyst_action: action ${existingActionId} disappeared from catalyst_actions`;
          } else if (actionRow.verification_status === 'failed') {
            stepError = `catalyst_action verification failed: ${actionRow.verification_notes ?? '(no notes)'}`;
          } else if (actionRow.verification_status === 'verified') {
            stepCompleted = true;
            stepOutput = {
              action_id: existingActionId,
              status: actionRow.status,
              verification_status: actionRow.verification_status,
              output_data: actionRow.output_data ? JSON.parse(actionRow.output_data) : null,
            };
          } else {
            // 'deferred', 'skipped', or null → still waiting
            stepBlocked = true;
            stepOutput = { ...prevOutput, current_status: actionRow.status, verification_status: actionRow.verification_status };
          }
        } else {
          // First advance — kick off the action
          if (!deps?.cache || !deps?.ai) {
            stepBlocked = true;
            stepOutput = { reason: 'orchestration deps missing (cache + ai)', expected_input: inputObj };
            break;
          }
          const clusterId = typeof inputObj.clusterId === 'string' ? inputObj.clusterId : null;
          const catalystName = typeof inputObj.catalystName === 'string' ? inputObj.catalystName : null;
          const action = typeof inputObj.action === 'string' ? inputObj.action : null;
          if (!clusterId || !catalystName || !action) {
            stepError = 'catalyst_action requires clusterId + catalystName + action on step.input';
            break;
          }
          const actionInput = (inputObj.actionInput && typeof inputObj.actionInput === 'object')
            ? inputObj.actionInput as Record<string, unknown> : {};
          const riskLevel = (typeof inputObj.riskLevel === 'string'
            && ['high', 'medium', 'low'].includes(inputObj.riskLevel))
            ? inputObj.riskLevel as 'high' | 'medium' | 'low' : 'medium';
          const autonomyTier = typeof inputObj.autonomyTier === 'string'
            ? inputObj.autonomyTier : 'read-only';
          const trustScore = typeof inputObj.trustScore === 'number' ? inputObj.trustScore : 50;
          const companyId = typeof inputObj.companyId === 'string' ? inputObj.companyId : undefined;

          try {
            const taskResult = await executeTask({
              clusterId, tenantId, catalystName, action,
              inputData: actionInput, riskLevel, autonomyTier, trustScore, companyId,
            }, db, deps.cache, deps.ai, deps.ollamaApiKey, deps.queue);
            stepBlocked = true; // wait for verification on next sweep
            stepOutput = {
              action_id: taskResult.actionId,
              kicked_off_at: new Date().toISOString(),
              initial_status: taskResult.status,
            };
          } catch (err) {
            stepError = `catalyst_action executeTask failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        }
        break;
      }
      default:
        stepError = `unknown step type: ${type}`;
    }
  } catch (err) {
    stepError = err instanceof Error ? err.message : String(err);
  }

  if (stepError) {
    await db.prepare(
      `UPDATE orchestration_step_executions
          SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`
    ).bind(stepError, stepExec.id).run();
    await db.prepare(
      `UPDATE orchestration_runs
          SET status='failed', error=?, completed_at=datetime('now') WHERE id=?`
    ).bind(stepError, run.id).run();
    logError('orchestration.step_failed', new Error(stepError), { tenantId },
      { run_id: run.id, step_index: run.current_step });
    return { status: 'failed', reason: stepError };
  }
  if (stepBlocked) {
    if (stepOutput) {
      await db.prepare(
        `UPDATE orchestration_step_executions SET output=? WHERE id=?`
      ).bind(JSON.stringify(stepOutput), stepExec.id).run();
    }
    // Run stays 'running' but step is 'running' — next sweep will re-evaluate
    return { status: 'blocked' };
  }
  if (stepCompleted) {
    await db.prepare(
      `UPDATE orchestration_step_executions
          SET status='completed', output=?, completed_at=datetime('now') WHERE id=?`
    ).bind(JSON.stringify(stepOutput ?? {}), stepExec.id).run();
    const nextStep = run.current_step + 1;
    if (nextStep >= run.total_steps) {
      await db.prepare(
        `UPDATE orchestration_runs
            SET status='completed', current_step=?, completed_at=datetime('now') WHERE id=?`
      ).bind(nextStep, run.id).run();
      logInfo('orchestration.run_completed',
        { tenantId, layer: 'orchestration', action: 'run.completed' },
        { run_id: run.id });
      return { status: 'completed' };
    } else {
      await db.prepare(
        `UPDATE orchestration_runs SET current_step=? WHERE id=?`
      ).bind(nextStep, run.id).run();
      return { status: 'advanced' };
    }
  }
  return { status: 'noop' };
}

// ── Tenant sweep ─────────────────────────────────────────────────────

export interface OrchestrationSweepResult {
  runsScanned: number;
  runsAdvanced: number;
  runsCompleted: number;
  runsBlocked: number;
  runsFailed: number;
}

export async function advanceRunsForTenant(
  db: D1Database, tenantId: string, deps?: OrchestrationDeps,
): Promise<OrchestrationSweepResult> {
  const result: OrchestrationSweepResult = {
    runsScanned: 0, runsAdvanced: 0, runsCompleted: 0,
    runsBlocked: 0, runsFailed: 0,
  };
  let runs: RunRow[] = [];
  try {
    const r = await db.prepare(
      `SELECT id, workflow_id, status, current_step, total_steps,
              context_data, started_at, completed_at, error
         FROM orchestration_runs
        WHERE tenant_id = ? AND status = 'running'`
    ).bind(tenantId).all<RunRow>();
    runs = r.results || [];
  } catch (err) {
    logError('orchestration.load_runs_failed', err, { tenantId }, {});
    return result;
  }
  result.runsScanned = runs.length;
  for (const run of runs) {
    const out = await advanceRun(db, tenantId, run, deps);
    if (out.status === 'advanced') result.runsAdvanced++;
    else if (out.status === 'completed') result.runsCompleted++;
    else if (out.status === 'blocked') result.runsBlocked++;
    else if (out.status === 'failed') result.runsFailed++;
  }
  return result;
}

// ── Manual gate approval (used by routes) ────────────────────────────

export async function approveStep(
  db: D1Database, tenantId: string, runId: string, stepIndex: number,
  approvedBy: string,
): Promise<{ ok: boolean }> {
  try {
    const run = await db.prepare(
      `SELECT context_data FROM orchestration_runs
        WHERE id = ? AND tenant_id = ? AND status = 'running' LIMIT 1`
    ).bind(runId, tenantId).first<{ context_data: string }>();
    if (!run) return { ok: false };
    let ctx: Record<string, unknown> = {};
    try { ctx = JSON.parse(run.context_data) as Record<string, unknown>; } catch { /* default {} */ }
    ctx[`approved_step_${stepIndex}`] = true;
    ctx[`approved_step_${stepIndex}_by`] = approvedBy;
    ctx[`approved_step_${stepIndex}_at`] = new Date().toISOString();
    await db.prepare(
      `UPDATE orchestration_runs SET context_data = ? WHERE id = ?`
    ).bind(JSON.stringify(ctx), runId).run();
    return { ok: true };
  } catch (err) {
    logError('orchestration.approve_step_failed', err, { tenantId }, { runId, stepIndex });
    return { ok: false };
  }
}

// ── Run status reader ────────────────────────────────────────────────

export async function getRunStatus(
  db: D1Database, tenantId: string, runId: string,
): Promise<RunStatus | null> {
  try {
    const r = await db.prepare(
      `SELECT id, workflow_id, status, current_step, total_steps,
              context_data, started_at, completed_at, error
         FROM orchestration_runs
        WHERE id = ? AND tenant_id = ? LIMIT 1`
    ).bind(runId, tenantId).first<RunRow>();
    if (!r) return null;
    let context: Record<string, unknown> = {};
    try { context = JSON.parse(r.context_data) as Record<string, unknown>; } catch { /* {} */ }
    return {
      id: r.id, workflowId: r.workflow_id,
      status: r.status as RunStatus['status'],
      currentStep: r.current_step, totalSteps: r.total_steps,
      contextData: context, startedAt: r.started_at,
      completedAt: r.completed_at, error: r.error,
    };
  } catch {
    return null;
  }
}
