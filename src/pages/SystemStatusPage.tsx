/**
 * System Status — Phase 10-36.
 *
 * Operator landing page for "is the platform broken, and where?"
 *
 * Surfaces in one screen:
 *   - Migration state (code version vs marker vs KV flags vs drift)
 *   - Email queue health (counts + recent failures with REAL error
 *     strings — no more "Max retries exceeded")
 *   - Secrets configured (MS Graph, Sentry, Ollama, EIA, Azure AD)
 *   - Tenant counts by status
 *   - Force-migrate action (operator types SETUP_SECRET inline)
 *
 * The driver: 2026-05-05 incident. Login was broken because of FOUR
 * silent failures (auto-migration timeout, CORS misconfig, missing
 * brand columns, missing MS Graph secrets). Operators couldn't see
 * any of them without spelunking via wrangler. This page would have
 * taken the diagnosis from ~2 hours to ~30 seconds.
 *
 * Route: /system-status   |   Roles: PLATFORM_ADMIN_ROLES
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SystemStatusReport } from '@/lib/api';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Database, Mail, KeyRound, Building2, Wrench } from 'lucide-react';

function statusBadge(ok: boolean, label: { ok: string; bad: string }) {
  return ok
    ? { variant: 'default' as const, label: label.ok, Icon: CheckCircle2, color: 'text-green-500' }
    : { variant: 'destructive' as const, label: label.bad, Icon: XCircle, color: 'text-red-500' };
}

export function SystemStatusPage() {
  const toast = useToast();
  const [status, setStatus] = useState<SystemStatusReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [migrating, setMigrating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.systemStatus.get();
      setStatus(res);
    } catch (err) {
      toast.error('Failed to load system status', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleForceMigrate = useCallback(async () => {
    const secret = window.prompt(
      'Force-migrate bypasses the fast-path and re-runs ALL DDL.\n\n' +
      'Use when schema drifted or an aborted migration left state inconsistent.\n\n' +
      'Enter SETUP_SECRET to proceed:',
    );
    if (!secret) return;
    setMigrating(true);
    try {
      const res = await api.systemStatus.forceMigrate(secret);
      toast.success(`Migration ran in ${res.durationMs}ms`, {
        message: `Tables created: ${res.tablesCreated}, indexes: ${res.indexesCreated}, columns healed: ${res.columnsHealed}, errors: ${res.errors.length}`,
      });
      load();
    } catch (err) {
      toast.error('Force-migrate failed', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setMigrating(false);
    }
  }, [toast, load]);

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center p-12">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!status) {
    return <div className="p-6 text-muted-foreground">No status available.</div>;
  }

  const migrationOk = status.migration.marker_present && !status.migration.drift;
  const emailQueueFailed = status.email.queue.failed ?? 0;
  const emailHealthy = emailQueueFailed === 0;
  const allSecretsOk = status.secrets.ms_graph_configured;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">System Status</h1>
          <p className="text-sm text-muted-foreground">
            Operator visibility · generated at {new Date(status.generated_at).toLocaleString()} ({status.elapsed_ms}ms)
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* ── Headline tiles ── */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeaderTile
          icon={<Database className="h-4 w-4" />}
          label="Migration"
          ok={migrationOk}
          okText="Up to date"
          badText={status.migration.drift ?? 'Marker missing'}
        />
        <HeaderTile
          icon={<Mail className="h-4 w-4" />}
          label="Email queue"
          ok={emailHealthy}
          okText="Healthy"
          badText={`${emailQueueFailed} failed`}
        />
        <HeaderTile
          icon={<KeyRound className="h-4 w-4" />}
          label="Secrets"
          ok={allSecretsOk}
          okText="MS Graph OK"
          badText="MS Graph not configured"
        />
        <HeaderTile
          icon={<Building2 className="h-4 w-4" />}
          label="Tenants"
          ok={status.tenants.total > 0}
          okText={`${status.tenants.total} total`}
          badText="None"
        />
      </div>

      {/* ── Migration ── */}
      <Card>
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Database className="h-4 w-4" /> Migration</h2>
          <button
            onClick={handleForceMigrate}
            disabled={migrating}
            className="flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
            title="Bypass fast-path; re-runs all DDL. Idempotent."
          >
            {migrating ? <Loader2 className="h-3 w-3 animate-spin" /> : <Wrench className="h-3 w-3" />}
            Force migrate
          </button>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 text-sm md:grid-cols-2">
          <KV label="Code version" value={status.migration.code_version} />
          <KV label="Marker version" value={status.migration.marker_version ?? '— (no marker)'} ok={!!status.migration.marker_present} />
          <KV label="Marker completed at" value={status.migration.marker_completed_at ? new Date(status.migration.marker_completed_at).toLocaleString() : '—'} />
          <KV label="Last duration" value={status.migration.marker_duration_ms != null ? `${status.migration.marker_duration_ms}ms` : '—'} />
          <KV label="KV: db:migrated:VERSION" value={status.migration.kv_migrated ?? '— (not set)'} ok={status.migration.kv_migrated === 'true'} />
          <KV label="KV: db:migrating:VERSION (lease)" value={status.migration.kv_migrating_lease ?? '— (no lease)'} />
        </div>
        {status.migration.drift && (
          <div className="border-t bg-amber-50 p-3 text-xs text-amber-900">
            <AlertTriangle className="inline h-3 w-3 mr-1" />
            <strong>Schema drift:</strong> {status.migration.drift}
          </div>
        )}
      </Card>

      {/* ── Email queue ── */}
      <Card>
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Mail className="h-4 w-4" /> Email queue</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
          {Object.entries(status.email.queue).map(([k, v]) => (
            <div key={k} className="rounded border p-2">
              <div className="text-xs text-muted-foreground capitalize">{k}</div>
              <div className="text-xl font-semibold">{v}</div>
            </div>
          ))}
          {Object.keys(status.email.queue).length === 0 && (
            <div className="col-span-full text-sm text-muted-foreground">Queue is empty.</div>
          )}
        </div>
        {status.email.recent_failures.length > 0 && (
          <div className="border-t">
            <div className="border-b bg-red-50 px-3 py-2 text-xs font-semibold text-red-900">
              Recent failures ({status.email.recent_failures.length})
            </div>
            <div className="divide-y">
              {status.email.recent_failures.map((f) => (
                <div key={f.id} className="p-3 text-xs">
                  <div className="flex items-start justify-between">
                    <div className="font-mono text-[11px]">{f.recipients}</div>
                    <div className="text-muted-foreground">{new Date(f.created_at).toLocaleString()}</div>
                  </div>
                  <div className="mt-1 truncate font-medium" title={f.subject}>{f.subject}</div>
                  <div className="mt-1 rounded bg-red-50 p-2 font-mono text-[11px] text-red-900 whitespace-pre-wrap break-all">
                    {f.error_excerpt}
                  </div>
                  <div className="mt-1 text-muted-foreground">retry count: {f.retry_count}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </Card>

      {/* ── Secrets ── */}
      <Card>
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><KeyRound className="h-4 w-4" /> Secrets configured</h2>
        </div>
        <div className="grid grid-cols-1 gap-2 p-3 md:grid-cols-2">
          <SecretRow label="MS Graph (email send)" ok={status.secrets.ms_graph_configured} hint="MS_GRAPH_CLIENT_ID + _SECRET + _TENANT_ID" />
          <SecretRow label="Azure AD (SSO login)" ok={status.secrets.azure_ad_sso_configured} hint="AZURE_AD_CLIENT_ID + _SECRET + _TENANT_ID" />
          <SecretRow label="Sentry (error tracking)" ok={status.secrets.sentry_configured} hint="SENTRY_DSN" />
          <SecretRow label="Ollama (LLM)" ok={status.secrets.ollama_configured} hint="OLLAMA_API_KEY" />
          <SecretRow label="EIA (Brent oil signal)" ok={status.secrets.eia_configured} hint="EIA_API_KEY" />
        </div>
      </Card>

      {/* ── Tenants ── */}
      <Card>
        <div className="border-b p-3">
          <h2 className="text-sm font-semibold flex items-center gap-2"><Building2 className="h-4 w-4" /> Tenants</h2>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 md:grid-cols-4">
          {Object.entries(status.tenants.by_status).map(([k, v]) => (
            <div key={k} className="rounded border p-2">
              <div className="text-xs text-muted-foreground capitalize">{k}</div>
              <div className="text-xl font-semibold">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      {/* ── Errors ── */}
      {status.errors.length > 0 && (
        <Card>
          <div className="border-b bg-red-50 p-3 text-sm font-semibold text-red-900 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Errors collecting status
          </div>
          <div className="divide-y">
            {status.errors.map((e, i) => (
              <div key={i} className="p-3 font-mono text-xs">{e}</div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function HeaderTile({ icon, label, ok, okText, badText }: {
  icon: React.ReactNode; label: string; ok: boolean; okText: string; badText: string;
}) {
  const badge = statusBadge(ok, { ok: okText, bad: badText });
  return (
    <Card className="p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">{icon}{label}</div>
      <div className="mt-1 flex items-center gap-2">
        <badge.Icon className={`h-4 w-4 ${badge.color}`} />
        <span className="text-sm font-medium">{badge.label}</span>
      </div>
    </Card>
  );
}

function KV({ label, value, ok }: { label: string; value: string; ok?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-mono text-xs ${ok === false ? 'text-amber-600' : ''}`}>{value}</span>
    </div>
  );
}

function SecretRow({ label, ok, hint }: { label: string; ok: boolean; hint: string }) {
  return (
    <div className="flex items-center justify-between rounded border p-2">
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground font-mono">{hint}</div>
      </div>
      {ok
        ? <Badge variant="default"><CheckCircle2 className="mr-1 h-3 w-3" /> Configured</Badge>
        : <Badge variant="destructive"><XCircle className="mr-1 h-3 w-3" /> Missing</Badge>
      }
    </div>
  );
}

export default SystemStatusPage;
