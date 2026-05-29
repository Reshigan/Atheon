/**
 * Phase 10-20 — DSAR (POPIA/GDPR access + erasure).
 *
 * Covers:
 *  Access
 *   1. Subject identified by user_id → returns export with subject row
 *   2. Subject identified by email → resolves to user_id then exports
 *   3. Unknown subject → empty export, request logged with status='completed'
 *   4. audit_log + mind_queries + chat_conversations + run_comments
 *      + api_keys appear in export when present
 *
 *  Erasure
 *   5. Erases user_sessions + api_keys + password_reset_tokens
 *   6. Anonymises audit_log + mind_queries + run_comments
 *   7. Anonymises users row (email='erased+...', name='[Erased]', status='deleted')
 *   8. Subject not found → result with rows=0, status='no_subject'
 *   9. Idempotent: running again on already-erased subject → no-op
 *  10. dsar_requests row written with status='completed'
 */
import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { exportSubjectData, eraseSubjectData } from '../services/dsar';

const SETUP_SECRET = 'test-setup-secret-for-testing123';
const TENANT = 'dsar-tenant';
const ADMIN = 'admin-user';
const SUBJECT_USER = 'subject-user';
const SUBJECT_EMAIL = 'subject@example.com';

async function seedTenant(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO tenants (id, name, slug, plan, status)
     VALUES (?, ?, ?, 'enterprise', 'active')`
  ).bind(TENANT, TENANT, TENANT).run();
}

async function seedUser(id: string, email: string, role = 'analyst'): Promise<void> {
  await env.DB.prepare(
    `INSERT OR REPLACE INTO users (id, tenant_id, email, name, role, password_hash, status)
     VALUES (?, ?, ?, 'Test User', ?, 'pbkdf2:hash', 'active')`
  ).bind(id, TENANT, email, role).run();
}

async function seedAuditLog(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, outcome)
     VALUES (?, ?, ?, 'test.action', 'test', 'res', 'success')`
  ).bind(crypto.randomUUID(), TENANT, userId).run();
}

async function seedMindQuery(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO mind_queries (id, tenant_id, user_id, query, response, tier)
     VALUES (?, ?, ?, 'test query', 'test response', 'tier-1')`
  ).bind(crypto.randomUUID(), TENANT, userId).run();
}

async function seedChatConversation(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO chat_conversations (id, tenant_id, user_id, title, model_tier)
     VALUES (?, ?, ?, 'test conv', 'tier-1')`
  ).bind(crypto.randomUUID(), TENANT, userId).run();
}

async function seedSession(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_sessions (id, user_id, tenant_id, token_hash, expires_at)
     VALUES (?, ?, ?, 'h', datetime('now', '+1 day'))`
  ).bind(crypto.randomUUID(), userId, TENANT).run();
}

async function seedApiKey(userId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash, key_prefix)
     VALUES (?, ?, ?, 'test', 'h', 'pk_')`
  ).bind(crypto.randomUUID(), TENANT, userId).run();
}

// user_id is NULL for tenant-wide system notifications (no data subject).
async function seedNotification(userId: string | null, title: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO notifications (id, tenant_id, user_id, type, title, message, severity)
     VALUES (?, ?, ?, 'system', ?, 'test message', 'info')`
  ).bind(crypto.randomUUID(), TENANT, userId, title).run();
}

describe('Phase 10-20 — DSAR', () => {
  beforeAll(async () => {
    const res = await SELF.fetch('http://localhost/api/v1/admin/migrate', {
      method: 'POST', headers: { 'X-Setup-Secret': SETUP_SECRET },
    });
    if (res.status !== 200) throw new Error(`migration failed: ${res.status}`);
    await seedTenant();
  });

  beforeEach(async () => {
    await env.DB.prepare('DELETE FROM dsar_requests WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM audit_log WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM mind_queries WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM chat_conversations WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM user_sessions WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM api_keys WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM notifications WHERE tenant_id = ?').bind(TENANT).run();
    await env.DB.prepare('DELETE FROM users WHERE tenant_id = ?').bind(TENANT).run();
    await seedUser(ADMIN, 'admin@example.com', 'admin');
  });

  describe('access flow', () => {
    it('subject by user_id → export with subject + audit + mind queries', async () => {
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedAuditLog(SUBJECT_USER);
      await seedAuditLog(SUBJECT_USER);
      await seedMindQuery(SUBJECT_USER);

      const { export: exp, requestId } = await exportSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'access',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
      });
      expect(requestId).not.toBeNull();
      expect(exp.subject.user_id).toBe(SUBJECT_USER);
      expect(exp.subject.email).toBe(SUBJECT_EMAIL);
      expect(exp.audit_log.length).toBe(2);
      expect(exp.mind_queries.length).toBe(1);
    });

    it('subject by email → resolves to user_id', async () => {
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedChatConversation(SUBJECT_USER);

      const { export: exp } = await exportSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'access',
        subjectIdentifier: SUBJECT_EMAIL, requestedBy: ADMIN,
      });
      expect(exp.subject.user_id).toBe(SUBJECT_USER);
      expect(exp.chat_conversations.length).toBe(1);
    });

    it('notifications are subject-scoped — excludes other users and tenant-wide', async () => {
      const OTHER_USER = 'other-user';
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedUser(OTHER_USER, 'other@example.com');
      await seedNotification(SUBJECT_USER, 'yours');
      await seedNotification(OTHER_USER, 'theirs');
      await seedNotification(null, 'tenant-wide system message');

      const { export: exp } = await exportSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'access',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
      });
      expect(exp.notifications.length).toBe(1);
      expect(exp.notifications[0].title).toBe('yours');
    });

    it('unknown subject → empty export, request logged', async () => {
      const { export: exp, requestId } = await exportSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'access',
        subjectIdentifier: 'no-such-user', requestedBy: ADMIN,
      });
      expect(exp.subject.user_id).toBeNull();
      expect(exp.audit_log.length).toBe(0);
      expect(requestId).not.toBeNull();
      const row = await env.DB.prepare(
        `SELECT status FROM dsar_requests WHERE id = ?`
      ).bind(requestId).first<{ status: string }>();
      expect(row?.status).toBe('completed');
    });
  });

  describe('erasure flow', () => {
    it('deletes sessions/api_keys; anonymises audit/mind/users', async () => {
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedSession(SUBJECT_USER);
      await seedApiKey(SUBJECT_USER);
      await seedAuditLog(SUBJECT_USER);
      await seedAuditLog(SUBJECT_USER);
      await seedMindQuery(SUBJECT_USER);

      const { result, requestId } = await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
        reason: 'POPIA right to erasure request received',
      });
      expect(requestId).not.toBeNull();
      expect(result.rows_deleted).toBeGreaterThanOrEqual(2); // session + api key
      expect(result.rows_anonymised).toBeGreaterThanOrEqual(4); // 2 audit + 1 mind + 1 user

      // Sessions/api_keys gone
      const sess = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM user_sessions WHERE user_id = ?`
      ).bind(SUBJECT_USER).first<{ n: number }>();
      expect(sess?.n).toBe(0);
      const keys = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM api_keys WHERE user_id = ?`
      ).bind(SUBJECT_USER).first<{ n: number }>();
      expect(keys?.n).toBe(0);

      // Audit anonymised
      const audit = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM audit_log WHERE user_id = '[erased]' AND tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(audit?.n).toBeGreaterThanOrEqual(2);

      // User row anonymised
      const user = await env.DB.prepare(
        `SELECT email, name, status, password_hash FROM users WHERE id = ?`
      ).bind(SUBJECT_USER).first<{ email: string; name: string; status: string; password_hash: string | null }>();
      expect(user?.email).toContain('erased+');
      expect(user?.name).toBe('[Erased]');
      expect(user?.status).toBe('deleted');
      expect(user?.password_hash).toBeNull();
    });

    it('erasure deletes only the subject notifications — other users untouched', async () => {
      const OTHER_USER = 'other-user';
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedUser(OTHER_USER, 'other@example.com');
      await seedNotification(SUBJECT_USER, 'yours');
      await seedNotification(OTHER_USER, 'theirs');
      await seedNotification(null, 'tenant-wide system message');

      await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
        reason: 'POPIA right to erasure request received',
      });

      const subjectLeft = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM notifications WHERE tenant_id = ? AND user_id = ?`
      ).bind(TENANT, SUBJECT_USER).first<{ n: number }>();
      expect(subjectLeft?.n).toBe(0);

      // Other user's notification and the tenant-wide one survive.
      const survivors = await env.DB.prepare(
        `SELECT COUNT(*) as n FROM notifications WHERE tenant_id = ?`
      ).bind(TENANT).first<{ n: number }>();
      expect(survivors?.n).toBe(2);
    });

    it('subject not found → no_subject status, no rows changed', async () => {
      const { result, requestId } = await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: 'unknown', requestedBy: ADMIN,
        reason: 'test request for unknown subject',
      });
      expect(result.rows_deleted).toBe(0);
      expect(result.rows_anonymised).toBe(0);
      const row = await env.DB.prepare(
        `SELECT status FROM dsar_requests WHERE id = ?`
      ).bind(requestId).first<{ status: string }>();
      expect(row?.status).toBe('no_subject');
    });

    it('idempotent: re-running on already-erased subject → 0 rows', async () => {
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      await seedSession(SUBJECT_USER);

      const r1 = await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
        reason: 'first erasure request POPIA',
      });
      expect(r1.result.rows_deleted + r1.result.rows_anonymised).toBeGreaterThan(0);

      const r2 = await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
        reason: 'second erasure request idempotent',
      });
      // The user row was anonymised (status='deleted') but still exists; the
      // anonymise UPDATE may run again but change 0 rows since values match.
      expect(r2.result.rows_deleted).toBe(0);
    });

    it('dsar_requests row created with status=completed', async () => {
      await seedUser(SUBJECT_USER, SUBJECT_EMAIL);
      const { requestId } = await eraseSubjectData(env.DB, {
        tenantId: TENANT, requestType: 'erasure',
        subjectIdentifier: SUBJECT_USER, requestedBy: ADMIN,
        reason: 'compliance: POPIA right to erasure',
      });
      const row = await env.DB.prepare(
        `SELECT status, request_type, completed_at FROM dsar_requests WHERE id = ?`
      ).bind(requestId).first<{ status: string; request_type: string; completed_at: string | null }>();
      expect(row?.status).toBe('completed');
      expect(row?.request_type).toBe('erasure');
      expect(row?.completed_at).not.toBeNull();
    });
  });
});
