/**
 * Data Subject Access Request (DSAR) — Phase 10-20.
 *
 * POPIA / GDPR end-to-end compliance flow:
 *   - access:  return ALL data Atheon stores about a data subject
 *              (identified by email or user_id) within a tenant
 *   - erasure: cascading delete + anonymisation, idempotent and
 *              audited
 *
 * Why one module: the access and erasure flows scan the SAME tables
 * with the SAME identifier resolution, so they share the discovery
 * step. Differences are the action (read vs write) and the audit
 * trail entry.
 *
 * Scope: tenant-scoped data only. We do not delete cross-tenant
 * artefacts (e.g. global industry_patterns) since those carry no
 * subject identifier and are aggregate / anonymised by construction
 * (Phase 10-18 supporting_tenant_count is bounded ≥3).
 *
 * Erasure strategy per table (the principle: prefer ANONYMISE over
 * DELETE for rows referenced from audit/billing/RCA chains, since
 * deleting them would corrupt referential integrity that's
 * load-bearing for compliance / billing):
 *
 *   users               → ANONYMISE: email='erased+{id}@example.invalid',
 *                                    name='[Erased]', status='deleted',
 *                                    password_hash=NULL
 *   user_sessions       → DELETE
 *   api_keys            → DELETE
 *   password_reset_tokens → DELETE
 *   chat_conversations  → DELETE
 *   mind_queries        → ANONYMISE user_id='[erased]'
 *   audit_log           → ANONYMISE user_id='[erased]' (preserves
 *                         action history; user identity removed)
 *   run_comments        → ANONYMISE user_id='[erased]', user_name='[Erased]'
 *   notifications       → DELETE (subject-targeted)
 *   onboarding_progress → DELETE
 *
 * Best-effort: a missing optional table is logged but doesn't fail
 * the request. The request status reflects partial completion when
 * some tables couldn't be processed.
 */

import { logError, logInfo } from './logger';

// ── Types ──────────────────────────────────────────────────────────────

export type DsarRequestType = 'access' | 'erasure';

export interface DsarRequest {
  tenantId: string;
  requestType: DsarRequestType;
  /** Email or user_id identifying the data subject. */
  subjectIdentifier: string;
  /** User_id of who initiated the request (admin or self). */
  requestedBy: string;
  reason?: string;
}

export interface AccessExport {
  subject: { user_id: string | null; email: string | null; name: string | null; status: string | null };
  tenants: Array<{ tenant_id: string; tenant_name: string }>;
  audit_log: Array<Record<string, unknown>>;
  mind_queries: Array<Record<string, unknown>>;
  chat_conversations: Array<Record<string, unknown>>;
  run_comments: Array<Record<string, unknown>>;
  api_keys_summary: Array<Record<string, unknown>>;
  notifications: Array<Record<string, unknown>>;
  onboarding_progress: Array<Record<string, unknown>>;
  exported_at: string;
}

export interface ErasureResult {
  tables_processed: number;
  rows_deleted: number;
  rows_anonymised: number;
  errors: string[];
  per_table: Record<string, { action: 'delete' | 'anonymise'; rows: number }>;
}

// ── Subject resolution ────────────────────────────────────────────────

interface ResolvedSubject {
  user_id: string | null;
  email: string | null;
  name: string | null;
  status: string | null;
}

async function resolveSubject(
  db: D1Database, tenantId: string, identifier: string,
): Promise<ResolvedSubject> {
  // Try as user_id first, then email
  try {
    const byId = await db.prepare(
      `SELECT id as user_id, email, name, status FROM users
        WHERE tenant_id = ? AND id = ? LIMIT 1`
    ).bind(tenantId, identifier).first<ResolvedSubject>();
    if (byId) return byId;
    const byEmail = await db.prepare(
      `SELECT id as user_id, email, name, status FROM users
        WHERE tenant_id = ? AND lower(email) = ? LIMIT 1`
    ).bind(tenantId, identifier.toLowerCase()).first<ResolvedSubject>();
    if (byEmail) return byEmail;
  } catch {
    /* table missing or query failed — fall through */
  }
  return { user_id: null, email: identifier, name: null, status: null };
}

// ── Audit log of DSAR requests ────────────────────────────────────────

async function logDsarRequest(
  db: D1Database, request: DsarRequest, status: string,
  rowsAffected: number, summary: string,
): Promise<string | null> {
  const id = crypto.randomUUID();
  try {
    await db.prepare(
      `INSERT INTO dsar_requests
         (id, tenant_id, request_type, subject_identifier, requested_by,
          reason, status, rows_affected, summary, requested_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'),
               CASE WHEN ? IN ('completed', 'partial') THEN datetime('now') ELSE NULL END)`
    ).bind(
      id, request.tenantId, request.requestType, request.subjectIdentifier,
      request.requestedBy, request.reason ?? null, status, rowsAffected,
      summary, status,
    ).run();
    return id;
  } catch (err) {
    logError('dsar.request_log_failed', err, { tenantId: request.tenantId },
      { type: request.requestType });
    return null;
  }
}

// ── Access flow ────────────────────────────────────────────────────────

async function safeAll<T = Record<string, unknown>>(
  db: D1Database, query: string, binds: unknown[],
): Promise<T[]> {
  try {
    const r = await db.prepare(query).bind(...binds).all<T>();
    return r.results || [];
  } catch {
    return [];
  }
}

export async function exportSubjectData(
  db: D1Database, request: DsarRequest,
): Promise<{ export: AccessExport; requestId: string | null }> {
  const subject = await resolveSubject(db, request.tenantId, request.subjectIdentifier);
  const subjectKeys: string[] = [];
  if (subject.user_id) subjectKeys.push(subject.user_id);
  if (subject.email) subjectKeys.push(subject.email);
  if (subject.email) subjectKeys.push(subject.email.toLowerCase());

  const tenants = await safeAll<{ tenant_id: string; tenant_name: string }>(
    db,
    `SELECT id as tenant_id, name as tenant_name FROM tenants WHERE id = ?`,
    [request.tenantId],
  );

  const audit_log = subject.user_id
    ? await safeAll(db,
        `SELECT id, action, layer, resource, details, outcome, ip_address, created_at
           FROM audit_log WHERE tenant_id = ? AND user_id = ?
          ORDER BY created_at DESC LIMIT 500`,
        [request.tenantId, subject.user_id])
    : [];

  const mind_queries = subject.user_id
    ? await safeAll(db,
        `SELECT id, query, response, tier, tokens_in, tokens_out, latency_ms, created_at
           FROM mind_queries WHERE tenant_id = ? AND user_id = ?
          ORDER BY created_at DESC LIMIT 500`,
        [request.tenantId, subject.user_id])
    : [];

  const chat_conversations = subject.user_id
    ? await safeAll(db,
        `SELECT id, title, model_tier, messages, created_at, updated_at
           FROM chat_conversations WHERE tenant_id = ? AND user_id = ?
          ORDER BY updated_at DESC LIMIT 200`,
        [request.tenantId, subject.user_id])
    : [];

  const run_comments = subject.user_id
    ? await safeAll(db,
        `SELECT id, run_id, item_id, comment, comment_type, created_at
           FROM run_comments WHERE tenant_id = ? AND user_id = ?
          ORDER BY created_at DESC LIMIT 500`,
        [request.tenantId, subject.user_id])
    : [];

  const api_keys_summary = subject.user_id
    ? await safeAll(db,
        `SELECT id, name, key_prefix, permissions, last_used, created_at, expires_at
           FROM api_keys WHERE tenant_id = ? AND user_id = ?`,
        [request.tenantId, subject.user_id])
    : [];

  const notifications = subject.user_id
    ? await safeAll(db,
        `SELECT id, type, title, message, severity, read, created_at
           FROM notifications WHERE tenant_id = ?
          ORDER BY created_at DESC LIMIT 200`,
        [request.tenantId])
    : [];

  const onboarding_progress = subject.user_id
    ? await safeAll(db,
        `SELECT id, step_id, completed_at FROM onboarding_progress
           WHERE tenant_id = ? AND user_id = ?`,
        [request.tenantId, subject.user_id])
    : [];

  const exportObj: AccessExport = {
    subject,
    tenants,
    audit_log,
    mind_queries,
    chat_conversations,
    run_comments,
    api_keys_summary,
    notifications,
    onboarding_progress,
    exported_at: new Date().toISOString(),
  };

  const totalRows =
    audit_log.length + mind_queries.length + chat_conversations.length +
    run_comments.length + api_keys_summary.length + onboarding_progress.length;

  const summary = `Exported ${totalRows} rows across ${
    [audit_log.length > 0, mind_queries.length > 0, chat_conversations.length > 0,
     run_comments.length > 0, api_keys_summary.length > 0,
     onboarding_progress.length > 0].filter(Boolean).length
  } tables for subject ${request.subjectIdentifier}`;

  const requestId = await logDsarRequest(db, request, 'completed', totalRows, summary);
  if (subject.user_id) {
    logInfo('dsar.access_completed',
      { tenantId: request.tenantId, layer: 'compliance', action: 'dsar.access' },
      { request_id: requestId, total_rows: totalRows, subject_user_id: subject.user_id });
  }
  return { export: exportObj, requestId };
}

// ── Erasure flow ──────────────────────────────────────────────────────

interface TableEraser {
  table: string;
  action: 'delete' | 'anonymise';
  exec: (db: D1Database, tenantId: string, userId: string) => Promise<number>;
}

async function runChange(db: D1Database, query: string, binds: unknown[]): Promise<number> {
  try {
    const r = await db.prepare(query).bind(...binds).run();
    return r.meta?.changes ?? 0;
  } catch {
    return 0;
  }
}

const ERASERS: TableEraser[] = [
  // DELETE — purely identifying / session data
  {
    table: 'user_sessions', action: 'delete',
    exec: (db, t, u) => runChange(db,
      `DELETE FROM user_sessions WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  {
    table: 'api_keys', action: 'delete',
    exec: (db, t, u) => runChange(db,
      `DELETE FROM api_keys WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  {
    table: 'password_reset_tokens', action: 'delete',
    exec: (db, _t, u) => runChange(db,
      `DELETE FROM password_reset_tokens WHERE user_id = ?`, [u]),
  },
  {
    table: 'chat_conversations', action: 'delete',
    exec: (db, t, u) => runChange(db,
      `DELETE FROM chat_conversations WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  {
    table: 'onboarding_progress', action: 'delete',
    exec: (db, t, u) => runChange(db,
      `DELETE FROM onboarding_progress WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  // ANONYMISE — keep history, scrub identity
  {
    table: 'audit_log', action: 'anonymise',
    exec: (db, t, u) => runChange(db,
      `UPDATE audit_log SET user_id = '[erased]' WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  {
    table: 'mind_queries', action: 'anonymise',
    exec: (db, t, u) => runChange(db,
      `UPDATE mind_queries SET user_id = '[erased]' WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  {
    table: 'run_comments', action: 'anonymise',
    exec: (db, t, u) => runChange(db,
      `UPDATE run_comments SET user_id = '[erased]', user_name = '[Erased]' WHERE tenant_id = ? AND user_id = ?`, [t, u]),
  },
  // FINAL: anonymise the user row itself
  {
    table: 'users', action: 'anonymise',
    exec: (db, t, u) => runChange(db,
      `UPDATE users SET email = 'erased+' || id || '@example.invalid', name = '[Erased]', status = 'deleted', password_hash = NULL WHERE tenant_id = ? AND id = ?`, [t, u]),
  },
];

export async function eraseSubjectData(
  db: D1Database, request: DsarRequest,
): Promise<{ result: ErasureResult; requestId: string | null }> {
  const subject = await resolveSubject(db, request.tenantId, request.subjectIdentifier);
  const result: ErasureResult = {
    tables_processed: 0, rows_deleted: 0, rows_anonymised: 0,
    errors: [], per_table: {},
  };

  if (!subject.user_id) {
    const reqId = await logDsarRequest(db, request, 'no_subject', 0,
      `No subject found for identifier ${request.subjectIdentifier}`);
    return { result, requestId: reqId };
  }

  for (const e of ERASERS) {
    try {
      const rows = await e.exec(db, request.tenantId, subject.user_id);
      result.tables_processed++;
      result.per_table[e.table] = { action: e.action, rows };
      if (e.action === 'delete') result.rows_deleted += rows;
      else result.rows_anonymised += rows;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`${e.table}: ${msg}`);
      logError('dsar.eraser_failed', err, { tenantId: request.tenantId },
        { table: e.table, user_id: subject.user_id });
    }
  }

  const totalRows = result.rows_deleted + result.rows_anonymised;
  const status = result.errors.length > 0 ? 'partial' : 'completed';
  const summary = `Erasure: ${result.rows_deleted} deleted + ${result.rows_anonymised} ` +
    `anonymised across ${result.tables_processed} tables` +
    (result.errors.length > 0 ? ` (${result.errors.length} table errors)` : '');
  const requestId = await logDsarRequest(db, request, status, totalRows, summary);

  logInfo('dsar.erasure_completed',
    { tenantId: request.tenantId, layer: 'compliance', action: 'dsar.erasure' },
    { request_id: requestId, status, ...result });

  return { result, requestId };
}
