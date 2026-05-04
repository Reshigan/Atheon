/**
 * Phase 10-22 — Multi-step catalyst orchestration.
 *
 * Covers:
 *  Define + start
 *   1. defineWorkflow rejects empty steps / invalid step type
 *   2. defineWorkflow persists row + steps JSON
 *   3. startRun creates run + pre-creates step exec rows
 *
 *  Advance — log step
 *   4. log step → completes immediately, run advances
 *
 *  Advance — wait step
 *   5. wait step with minutes=0 → completes immediately
 *   6. wait step with minutes>0 → blocked until elapsed
 *
 *  Advance — manual_gate step
 *   7. manual_gate → blocked initially; approveStep → unblocks
 *
 *  Advance — catalyst_action step
 *   8. catalyst_action → blocked (deferred to follow-up PR)
 *
 *  Sweep
 *   9. advanceRunsForTenant: multi-run, multi-step in one call
 *  10. Run status reader returns shape
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  defineWorkflow,
  startRun,
  approveStep,
  getRunStatus,
  advanceRunsForTenant,
} from '../services/orchestration-engine';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'orch-tenant';
const USER = 'orch-user';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

describe('Phase 10-22 — orchestration', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM orchestration_step_executions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM orchestration_runs WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM orchestration_workflows WHERE tenant_id = ?').bind(TENANT).run();
  });

  describe('defineWorkflow', () => {
    it('rejects empty steps', async () => {
      await expect(defineWorkflow(env.DB, TENANT, { name: 'empty', steps: [] }))
        .rejects.toThrow();
    });
    it('rejects invalid step type', async () => {
      await expect(defineWorkflow(env.DB, TENANT, {
        name: 'bad-type',
        steps: [{ name: 'oops', type: 'nope' as 'log' }],
      })).rejects.toThrow();
    });
    it('persists workflow + steps JSON', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'simple', description: 'test',
        steps: [
          { name: 'first', type: 'log', input: { message: 'hello' } },
          { name: 'second', type: 'log', input: { message: 'world' } },
        ],
      });
      const row = await env.DB.prepare(
        `SELECT name, steps FROM orchestration_workflows WHERE id = ?`
      ).bind(workflowId).first<{ name: string; steps: string }>();
      expect(row?.name).toBe('simple');
      const steps = JSON.parse(row!.steps);
      expect(steps.length).toBe(2);
      expect(steps[0].input.message).toBe('hello');
    });
  });

  describe('startRun', () => {
    it('creates run + pre-creates step exec rows', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'simple', steps: [
          { name: 'a', type: 'log' }, { name: 'b', type: 'log' }, { name: 'c', type: 'log' },
        ],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);
      const run = await getRunStatus(env.DB, TENANT, runId);
      expect(run?.status).toBe('running');
      expect(run?.totalSteps).toBe(3);
      expect(run?.currentStep).toBe(0);
      const steps = await env.DB.prepare(
        `SELECT step_index, step_name, status FROM orchestration_step_executions WHERE run_id = ? ORDER BY step_index ASC`
      ).bind(runId).all<{ step_index: number; step_name: string; status: string }>();
      expect(steps.results?.length).toBe(3);
      expect(steps.results?.[0].status).toBe('pending');
    });
  });

  describe('advance — log step', () => {
    it('log step completes immediately', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'log-only', steps: [
          { name: 's1', type: 'log', input: { message: 'one' } },
          { name: 's2', type: 'log', input: { message: 'two' } },
        ],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);

      const r1 = await advanceRunsForTenant(env.DB, TENANT);
      expect(r1.runsAdvanced).toBe(1);
      const status1 = await getRunStatus(env.DB, TENANT, runId);
      expect(status1?.currentStep).toBe(1);

      const r2 = await advanceRunsForTenant(env.DB, TENANT);
      expect(r2.runsCompleted).toBe(1);
      const status2 = await getRunStatus(env.DB, TENANT, runId);
      expect(status2?.status).toBe('completed');
      expect(status2?.completedAt).not.toBeNull();
    });
  });

  describe('advance — wait step', () => {
    it('wait minutes=0 → completes immediately', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'wait-zero', steps: [{ name: 'w', type: 'wait', input: { minutes: 0 } }],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);
      await advanceRunsForTenant(env.DB, TENANT);
      const s = await getRunStatus(env.DB, TENANT, runId);
      expect(s?.status).toBe('completed');
    });
    it('wait minutes>0 → blocked', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'wait-five', steps: [{ name: 'w', type: 'wait', input: { minutes: 5 } }],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);
      const r = await advanceRunsForTenant(env.DB, TENANT);
      expect(r.runsBlocked).toBe(1);
      const s = await getRunStatus(env.DB, TENANT, runId);
      expect(s?.status).toBe('running'); // blocked-but-running
      expect(s?.currentStep).toBe(0);
    });
  });

  describe('advance — manual_gate', () => {
    it('manual_gate blocked initially; approve → unblocks', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'gated', steps: [
          { name: 'wait-for-approval', type: 'manual_gate' },
          { name: 'log', type: 'log', input: { message: 'approved' } },
        ],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);

      const r1 = await advanceRunsForTenant(env.DB, TENANT);
      expect(r1.runsBlocked).toBe(1);
      const s1 = await getRunStatus(env.DB, TENANT, runId);
      expect(s1?.currentStep).toBe(0);

      const ap = await approveStep(env.DB, TENANT, runId, 0, USER);
      expect(ap.ok).toBe(true);

      const r2 = await advanceRunsForTenant(env.DB, TENANT);
      expect(r2.runsAdvanced).toBe(1);
      const s2 = await getRunStatus(env.DB, TENANT, runId);
      expect(s2?.currentStep).toBe(1);

      const r3 = await advanceRunsForTenant(env.DB, TENANT);
      expect(r3.runsCompleted).toBe(1);
    });
  });

  describe('advance — catalyst_action', () => {
    it('catalyst_action → blocked (deferred to follow-up PR)', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'with-action', steps: [
          { name: 'cat', type: 'catalyst_action', input: { catalyst: 'procurement' } },
        ],
      });
      const { runId } = await startRun(env.DB, TENANT, workflowId, USER);
      const r = await advanceRunsForTenant(env.DB, TENANT);
      expect(r.runsBlocked).toBe(1);
      const s = await getRunStatus(env.DB, TENANT, runId);
      expect(s?.status).toBe('running');
    });
  });

  describe('sweep + status reader', () => {
    it('multi-run tenant sweep advances each independently', async () => {
      const { workflowId } = await defineWorkflow(env.DB, TENANT, {
        name: 'multi', steps: [{ name: 'l', type: 'log' }],
      });
      const { runId: r1 } = await startRun(env.DB, TENANT, workflowId, USER);
      const { runId: r2 } = await startRun(env.DB, TENANT, workflowId, USER);
      const { runId: r3 } = await startRun(env.DB, TENANT, workflowId, USER);

      const result = await advanceRunsForTenant(env.DB, TENANT);
      expect(result.runsScanned).toBe(3);
      expect(result.runsCompleted).toBe(3);

      for (const id of [r1, r2, r3]) {
        const s = await getRunStatus(env.DB, TENANT, id);
        expect(s?.status).toBe('completed');
      }
    });
  });
});
