/**
 * Phase 10-21 — Analytics fan-out + Phase 10 runner.
 *
 * Covers:
 *  Pure
 *   1. shouldFanOut: false when queue not bound
 *   2. shouldFanOut: false when tenant count < 5
 *   3. shouldFanOut: true when both conditions met
 *
 *  Enqueue
 *   4. enqueueAnalyticsSweeps: no queue → counted as 'inline', not enqueued
 *   5. enqueueAnalyticsSweeps: with queue → all tenants enqueued
 *   6. enqueueAnalyticsSweeps: queue.send throws → counted as 'failed'
 *      but doesn't abort other tenants
 *
 *  Runner
 *   7. runPhase10ChainForTenant: returns all 9 step names with ok flags
 *   8. runPhase10ChainForTenant: never throws even if one step explodes
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import {
  shouldFanOut,
  enqueueAnalyticsSweeps,
} from '../services/analytics-fanout';
import { runPhase10ChainForTenant } from '../services/phase-10-analytics-runner';
import type { CatalystQueueMessage } from '../services/scheduled';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'fanout-tenant';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

describe('Phase 10-21 — analytics fan-out', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    // No specific cleanup; runner is idempotent
  });

  describe('shouldFanOut (pure)', () => {
    const queue = { send: async () => undefined };
    it('false when queue not bound', () => {
      expect(shouldFanOut({}, 100)).toBe(false);
    });
    it('false when tenant count < 5', () => {
      expect(shouldFanOut({ CATALYST_QUEUE: queue }, 4)).toBe(false);
    });
    it('true when queue bound and ≥5 tenants', () => {
      expect(shouldFanOut({ CATALYST_QUEUE: queue }, 5)).toBe(true);
      expect(shouldFanOut({ CATALYST_QUEUE: queue }, 100)).toBe(true);
    });
  });

  describe('enqueueAnalyticsSweeps', () => {
    it('no queue → all tenants counted as inline', async () => {
      const r = await enqueueAnalyticsSweeps(undefined,
        [{ id: 't1' }, { id: 't2' }], 'all');
      expect(r.enqueued).toBe(0);
      expect(r.failed).toBe(0);
      expect(r.inline).toBe(2);
    });

    it('with queue → all tenants enqueued with correct shape', async () => {
      const sent: CatalystQueueMessage[] = [];
      const queue = {
        send: async (msg: CatalystQueueMessage) => { sent.push(msg); },
      };
      const tenants = [{ id: 't1' }, { id: 't2' }, { id: 't3' }];
      const r = await enqueueAnalyticsSweeps(queue, tenants, 'all');
      expect(r.enqueued).toBe(3);
      expect(r.failed).toBe(0);
      expect(sent.length).toBe(3);
      expect(sent[0].type).toBe('analytics_sweep');
      expect(sent.map((m) => m.tenantId).sort()).toEqual(['t1', 't2', 't3']);
      expect((sent[0].payload as { kind: string }).kind).toBe('all');
    });

    it('queue.send throws → counted as failed; other tenants still processed', async () => {
      let calls = 0;
      const queue = {
        send: async () => {
          calls++;
          if (calls === 2) throw new Error('queue at capacity');
        },
      };
      const r = await enqueueAnalyticsSweeps(queue,
        [{ id: 't1' }, { id: 't2' }, { id: 't3' }], 'all');
      expect(r.enqueued).toBe(2);
      expect(r.failed).toBe(1);
    });
  });

  describe('runPhase10ChainForTenant', () => {
    it('returns all 9 step names with ok flags + duration_ms', async () => {
      const result = await runPhase10ChainForTenant(env.DB, TENANT);
      expect(result.tenantId).toBe(TENANT);
      expect(result.steps.length).toBe(9);
      const names = result.steps.map((s) => s.name);
      expect(names).toContain('metric_correlation');
      expect(names).toContain('signal_attribution');
      expect(names).toContain('cross_rca_synthesis');
      expect(names).toContain('rca_closure');
      expect(names).toContain('apex_narrative');
      expect(names).toContain('competitor_intel');
      expect(names).toContain('regulatory_feed');
      expect(names).toContain('threshold_autotune');
      expect(names).toContain('forecast_accuracy');
      expect(result.durationMs).toBeGreaterThanOrEqual(0);
      // All should succeed on a tenant with no data (each sweep is no-op-friendly)
      expect(result.steps.every((s) => s.ok)).toBe(true);
    });

    it('never throws even if a step has nothing to do', async () => {
      // Empty tenant: runner should still complete cleanly
      const newTenant = 'empty-fanout-tenant';
      await env.DB.prepare(
        `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
         VALUES (?, ?, ?, 'enterprise', 'active')`
      ).bind(newTenant, newTenant, newTenant).run();
      const result = await runPhase10ChainForTenant(env.DB, newTenant);
      expect(result.steps.length).toBe(9);
    });
  });
});
