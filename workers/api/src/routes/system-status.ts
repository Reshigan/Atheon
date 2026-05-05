/**
 * System Status — Phase 10-36.
 *
 * Single read-only endpoint that surfaces the operator-relevant
 * platform state in one JSON response. The driver behind today's
 * 2026-05-05 incident: failures across migration, email, auth, and
 * KV state were ALL silent — recovery required spelunking with
 * wrangler. This page is the antidote.
 *
 * Returns:
 *   - migration: { current_version, deployed_version, marker_present, marker_completed_at }
 *   - email_queue: { pending, sent, failed, recent_errors }
 *   - kv_flags: { migrated, migrating, migration_state }
 *   - secrets_health: { ms_graph_configured, sentry_configured, ... }
 *   - worker: { build_version, started_at }
 *   - tenants: { total, active }
 *
 * GET /api/v1/admin/system-status — admin or superadmin only.
 *
 * No mutation endpoints here — operator actions (force migrate, retry
 * email, clear lockout) live on their respective routes; this page
 * just shows you WHERE the problem is so you know which one to call.
 */

import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { MIGRATION_VERSION } from '../services/migrate';

const systemStatus = new Hono<AppBindings>();

const READ_ROLES = new Set(['superadmin', 'support_admin', 'admin']);

function authGate(c: { get: (k: string) => unknown }): { ok: boolean; reason?: string } {
  const auth = c.get('auth') as AuthContext | undefined;
  const role = auth?.role || '';
  if (!READ_ROLES.has(role)) return { ok: false, reason: 'forbidden' };
  return { ok: true };
}

systemStatus.get('/', async (c) => {
  const gate = authGate(c);
  if (!gate.ok) return c.json({ error: gate.reason }, 403);

  // Run lookups in parallel — no single failure blocks the whole report.
  // Each block wraps in try so one broken table doesn't cascade.
  const t0 = Date.now();

  const [
    marker,
    emailCounts,
    recentEmailErrors,
    migratedKv,
    migratingKv,
    tenantCounts,
  ] = await Promise.allSettled([
    c.env.DB.prepare(
      `SELECT version, completed_at, duration_ms FROM _migration_meta
        ORDER BY completed_at DESC LIMIT 1`,
    ).first<{ version: string; completed_at: string; duration_ms: number }>(),
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM email_queue GROUP BY status`,
    ).all<{ status: string; n: number }>(),
    c.env.DB.prepare(
      `SELECT id, recipients, subject, substr(error, 1, 400) AS error_excerpt, created_at, retry_count
         FROM email_queue WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10`,
    ).all<{ id: string; recipients: string; subject: string; error_excerpt: string; created_at: string; retry_count: number }>(),
    c.env.CACHE.get(`db:migrated:${MIGRATION_VERSION}`),
    c.env.CACHE.get(`db:migrating:${MIGRATION_VERSION}`),
    c.env.DB.prepare(
      `SELECT status, COUNT(*) AS n FROM tenants GROUP BY status`,
    ).all<{ status: string; n: number }>(),
  ]);

  const env = c.env as typeof c.env & {
    MS_GRAPH_CLIENT_ID?: string;
    MS_GRAPH_CLIENT_SECRET?: string;
    MS_GRAPH_TENANT_ID?: string;
    SENTRY_DSN?: string;
    OLLAMA_API_KEY?: string;
    EIA_API_KEY?: string;
    AZURE_AD_CLIENT_ID?: string;
  };

  const markerVal = marker.status === 'fulfilled' ? marker.value : null;
  const emailByStatus: Record<string, number> = {};
  if (emailCounts.status === 'fulfilled') {
    for (const r of emailCounts.value.results || []) emailByStatus[r.status] = r.n;
  }
  const tenantByStatus: Record<string, number> = {};
  if (tenantCounts.status === 'fulfilled') {
    for (const r of tenantCounts.value.results || []) tenantByStatus[r.status] = r.n;
  }

  return c.json({
    generated_at: new Date().toISOString(),
    elapsed_ms: Date.now() - t0,
    migration: {
      code_version: MIGRATION_VERSION,
      marker_present: !!markerVal,
      marker_version: markerVal?.version ?? null,
      marker_completed_at: markerVal?.completed_at ?? null,
      marker_duration_ms: markerVal?.duration_ms ?? null,
      kv_migrated: migratedKv.status === 'fulfilled' ? migratedKv.value : null,
      kv_migrating_lease: migratingKv.status === 'fulfilled' ? migratingKv.value : null,
      drift: markerVal?.version !== MIGRATION_VERSION
        ? `marker says ${markerVal?.version ?? 'none'}, code expects ${MIGRATION_VERSION}`
        : null,
    },
    email: {
      queue: emailByStatus,
      recent_failures: recentEmailErrors.status === 'fulfilled'
        ? (recentEmailErrors.value.results || [])
        : [],
    },
    secrets: {
      ms_graph_configured: !!(env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET && env.MS_GRAPH_TENANT_ID),
      sentry_configured: !!env.SENTRY_DSN,
      ollama_configured: !!env.OLLAMA_API_KEY,
      eia_configured: !!env.EIA_API_KEY,
      azure_ad_sso_configured: !!env.AZURE_AD_CLIENT_ID,
    },
    tenants: {
      total: Object.values(tenantByStatus).reduce((a, b) => a + b, 0),
      by_status: tenantByStatus,
    },
    errors: [
      marker.status === 'rejected' ? `migration_marker: ${String(marker.reason).slice(0, 200)}` : null,
      emailCounts.status === 'rejected' ? `email_counts: ${String(emailCounts.reason).slice(0, 200)}` : null,
      tenantCounts.status === 'rejected' ? `tenant_counts: ${String(tenantCounts.reason).slice(0, 200)}` : null,
    ].filter(Boolean),
  });
});

export default systemStatus;
