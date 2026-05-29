/**
 * Audit-log retention purge — per-tenant window with a SOC 2 floor.
 *
 * Window per tenant = max(tenant_entitlements.data_retention_days, 365).
 * Tenants may only EXTEND retention beyond the 365-day SOC 2 baseline,
 * never shorten below it. A tenant that set 90 days still keeps a full
 * year; a tenant that set 730 keeps two years.
 *
 * Covers:
 *  1. Default-retention tenant: floor (365d) wins — older rows purged,
 *     rows inside the floor survive even though the tenant set 90.
 *  2. Extended-retention tenant: its longer window is honoured —
 *     rows between the floor and its window survive.
 *  3. Per-tenant isolation: each tenant's window applies independently
 *     in a single run.
 *  4. Daily idempotency: a second run on the same UTC date no-ops
 *     (the marker gates it); clearing the marker re-enables the purge.
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { pruneAuditLogIfDue } from '../services/scheduled';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const T_DEFAULT = 'audit-ret-default';
const T_EXTENDED = 'audit-ret-extended';
const MARKER_KEY = 'audit_log_retention.last_run';

async function seedTenant(id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(id, id, id).run();
}

async function setRetention(tenantId: string, days: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO tenant_entitlements (tenant_id, data_retention_days) VALUES (?, ?)
     ON CONFLICT(tenant_id) DO UPDATE SET data_retention_days = excluded.data_retention_days`
  ).bind(tenantId, days).run();
}

async function seedAuditRow(tenantId: string, ageDays: number): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, action, layer, outcome, created_at)
     VALUES (?, ?, 'test.action', 'test', 'success', datetime('now', ?))`
  ).bind(crypto.randomUUID(), tenantId, `-${ageDays} days`).run();
}

async function countAudit(tenantId: string): Promise<number> {
  const r = await env.DB.prepare(
    `SELECT COUNT(*) as n FROM audit_log WHERE tenant_id = ?`
  ).bind(tenantId).first<{ n: number }>();
  return r?.n ?? 0;
}

async function clearMarker(): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM tenant_settings WHERE tenant_id = '__system__' AND key = ?`
  ).bind(MARKER_KEY).run();
}

describe('audit-log retention — per-tenant window with 365d floor', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant(T_DEFAULT);
    await seedTenant(T_EXTENDED);
  });

  beforeEach(async () => {
    await clearMarker();
    await env.DB.prepare('DELETE FROM audit_log WHERE tenant_id IN (?, ?)').bind(T_DEFAULT, T_EXTENDED).run();
    await env.DB.prepare('DELETE FROM tenant_entitlements WHERE tenant_id IN (?, ?)').bind(T_DEFAULT, T_EXTENDED).run();
  });

  it('default-retention tenant: 365d floor wins over the tenant 90d setting', async () => {
    await setRetention(T_DEFAULT, 90);
    await seedAuditRow(T_DEFAULT, 400); // older than floor → purged
    await seedAuditRow(T_DEFAULT, 100); // inside floor → survives (not the 90d setting)

    await pruneAuditLogIfDue(env.DB);

    expect(await countAudit(T_DEFAULT)).toBe(1);
  });

  it('extended-retention tenant: honours a window longer than the floor', async () => {
    await setRetention(T_EXTENDED, 730);
    await seedAuditRow(T_EXTENDED, 500); // between floor and window → survives
    await seedAuditRow(T_EXTENDED, 800); // beyond window → purged

    await pruneAuditLogIfDue(env.DB);

    expect(await countAudit(T_EXTENDED)).toBe(1);
  });

  it('per-tenant isolation: each tenant window applies in a single run', async () => {
    await setRetention(T_DEFAULT, 90);
    await setRetention(T_EXTENDED, 730);
    await seedAuditRow(T_DEFAULT, 400);  // > floor → purged
    await seedAuditRow(T_EXTENDED, 500); // < extended window → survives

    await pruneAuditLogIfDue(env.DB);

    expect(await countAudit(T_DEFAULT)).toBe(0);
    expect(await countAudit(T_EXTENDED)).toBe(1);
  });

  it('tenant with no entitlements row falls back to the 365d floor', async () => {
    await seedAuditRow(T_DEFAULT, 400); // older than floor → purged
    await seedAuditRow(T_DEFAULT, 200); // inside floor → survives

    await pruneAuditLogIfDue(env.DB);

    expect(await countAudit(T_DEFAULT)).toBe(1);
  });

  it('daily idempotency: second same-day run no-ops; clearing marker re-enables', async () => {
    await setRetention(T_DEFAULT, 90);
    await seedAuditRow(T_DEFAULT, 400);

    await pruneAuditLogIfDue(env.DB);
    expect(await countAudit(T_DEFAULT)).toBe(0);

    // A fresh old row arrives later the same day — the marker gates the purge.
    await seedAuditRow(T_DEFAULT, 400);
    await pruneAuditLogIfDue(env.DB);
    expect(await countAudit(T_DEFAULT)).toBe(1);

    // Clearing the marker (next UTC day) re-enables the purge.
    await clearMarker();
    await pruneAuditLogIfDue(env.DB);
    expect(await countAudit(T_DEFAULT)).toBe(0);
  });
});
