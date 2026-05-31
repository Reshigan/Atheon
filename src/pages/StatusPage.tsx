/**
 * /status — public platform status + incident timeline (Phase AZ).
 *
 * Procurement teams probe this URL during vendor risk assessments at
 * 3000+-headcount enterprises. The page polls /api/status every 30s and
 * renders:
 *   - One-line overall status banner (operational / degraded / outage)
 *   - 4 component tiles (API / database / cache / storage)
 *   - DR / RTO / RPO / data residency disclosure block
 *   - 90-day incident timeline with per-incident update chronology
 *
 * Public — no auth, no role checks, no tenant scope. Same data is
 * returned regardless of who's looking.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AsyncPageContent, statusFrom } from '@/components/ui/async';
import { api, ApiError } from '@/lib/api';
import type { StatusIncident } from '@/lib/api';
import {
  CheckCircle2, AlertTriangle, XCircle, RefreshCw, Activity, Database,
  Globe, Shield, Clock, ArrowLeft,
} from 'lucide-react';

const POLL_INTERVAL_MS = 30000;

type ComponentStatus = string;

interface StatusResponse {
  status: string;
  components: Record<string, ComponentStatus>;
  probes: { database_ms: number };
  activeIncident: StatusIncident | null;
  incidents: StatusIncident[];
  checkedAt: string;
}

const SEVERITY_LABEL: Record<string, string> = {
  operational: 'All systems operational',
  degraded: 'Degraded performance',
  partial_outage: 'Partial outage',
  major_outage: 'Major outage',
};

const SEVERITY_TONE: Record<string, { bg: string; border: string; color: string; icon: typeof CheckCircle2 }> = {
  operational: { bg: 'rgb(var(--accent-rgb) / 0.07)', border: 'rgb(var(--accent-rgb) / 0.30)', color: 'var(--accent)', icon: CheckCircle2 },
  degraded: { bg: 'rgb(var(--warning-rgb) / 0.07)', border: 'rgb(var(--warning-rgb) / 0.30)', color: 'var(--warning)', icon: AlertTriangle },
  partial_outage: { bg: 'rgb(var(--warning-rgb) / 0.07)', border: 'rgb(var(--warning-rgb) / 0.30)', color: 'var(--warning)', icon: AlertTriangle },
  major_outage: { bg: 'rgb(var(--neg-rgb) / 0.07)', border: 'rgb(var(--neg-rgb) / 0.30)', color: 'var(--neg)', icon: XCircle },
};

function componentPillTone(s: ComponentStatus): { label: string; color: string } {
  if (s === 'operational') return { label: 'Operational', color: 'var(--accent)' };
  if (s === 'degraded') return { label: 'Degraded', color: 'var(--warning)' };
  if (s === 'partial_outage') return { label: 'Partial outage', color: 'var(--warning)' };
  if (s === 'major_outage') return { label: 'Major outage', color: 'var(--neg)' };
  return { label: s, color: 'var(--text-muted)' };
}

function ComponentTile({ label, icon: Icon, status, hint }: { label: string; icon: typeof CheckCircle2; status: ComponentStatus; hint?: string }) {
  const pill = componentPillTone(status);
  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon size={16} className="t-muted" />
          <span className="text-body-sm font-medium t-primary">{label}</span>
        </div>
        <span className="text-caption font-medium" style={{ color: pill.color }}>{pill.label}</span>
      </div>
      {hint && <div className="text-caption t-muted mt-2">{hint}</div>}
    </Card>
  );
}

export default function StatusPage(): JSX.Element {
  const [data, setData] = useState<StatusResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const res = await api.status.get();
      setData(res as StatusResponse);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load status');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
    const t = setInterval(() => { void load(true); }, POLL_INTERVAL_MS);
    return () => clearInterval(t);
  }, [load]);

  const status = statusFrom({ loading: loading && !data, error: error && !data ? error : null, isEmpty: false });
  if (status !== 'success') {
    return (
      <div className="p-6 max-w-5xl mx-auto">
        <AsyncPageContent
          status={status}
          error={error}
          onRetry={() => void load()}
          errorTitle="Couldn't load status"
          loadingVariant="cards"
          loadingCount={4}
        >
          {null}
        </AsyncPageContent>
      </div>
    );
  }

  const overall = data?.status ?? 'operational';
  const tone = SEVERITY_TONE[overall] ?? SEVERITY_TONE.operational;
  const ToneIcon = tone.icon;

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
            <span className="t-muted text-caption">·</span>
            <h1 className="text-headline-xl font-bold t-primary tracking-tight">Atheon Platform Status</h1>
          </div>
          <button
            onClick={() => void load()}
            disabled={refreshing}
            className="inline-flex items-center gap-1 text-caption t-muted hover:t-primary"
            title="Refresh now"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
            Refreshed {data ? new Date(data.checkedAt).toLocaleTimeString() : '—'}
          </button>
        </div>

        {/* Overall status banner */}
        <Card className="p-6" style={{ background: tone.bg, borderColor: tone.border }}>
          <div className="flex items-center gap-3">
            <ToneIcon size={24} style={{ color: tone.color }} />
            <div>
              <h2 className="text-headline-md font-bold" style={{ color: tone.color }}>{SEVERITY_LABEL[overall] ?? overall}</h2>
              <p className="text-body-sm t-muted mt-0.5">Auto-refreshes every {POLL_INTERVAL_MS / 1000}s. Subscribe via your monitoring tool against <code className="font-mono">https://atheon-api.vantax.co.za/api/status</code>.</p>
            </div>
          </div>
        </Card>

        {/* Active incident banner */}
        {data?.activeIncident && (
          <Card className="p-5" style={{ background: SEVERITY_TONE[data.activeIncident.severity]?.bg, borderColor: SEVERITY_TONE[data.activeIncident.severity]?.border }}>
            <div className="flex items-center justify-between gap-3 mb-2">
              <h3 className="text-body font-semibold t-primary">{data.activeIncident.title}</h3>
              <Badge variant="warning" size="sm">{data.activeIncident.status}</Badge>
            </div>
            {data.activeIncident.impact && <p className="text-body-sm t-secondary mb-3">{data.activeIncident.impact}</p>}
            {data.activeIncident.updates.length > 0 && (
              <div className="space-y-2 pt-3 border-t" style={{ borderColor: 'var(--border-card)' }}>
                {data.activeIncident.updates.slice().reverse().map((u, i) => (
                  <div key={i} className="text-caption">
                    <span className="t-muted">{new Date(u.at).toLocaleString()}</span>
                    <span className="t-muted"> · </span>
                    <span className="font-medium t-primary uppercase tracking-wider">{u.status}</span>
                    <p className="t-secondary mt-0.5">{u.message}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* Component tiles */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <ComponentTile label="API" icon={Globe} status={data?.components.api ?? 'operational'} hint="Cloudflare Workers" />
          <ComponentTile
            label="Database"
            icon={Database}
            status={data?.components.database ?? 'operational'}
            hint={data ? `D1 · ${data.probes.database_ms}ms probe` : 'D1'}
          />
          <ComponentTile label="Cache" icon={Activity} status={data?.components.cache ?? 'operational'} hint="Cloudflare KV" />
          <ComponentTile label="Object storage" icon={Shield} status={data?.components.storage ?? 'operational'} hint="Cloudflare R2" />
        </div>

        {/* DR / RTO / RPO / data residency disclosure */}
        <Card className="p-6">
          <div className="flex items-center gap-2 mb-3">
            <Shield size={16} className="text-accent" />
            <h3 className="text-body font-semibold t-primary">Continuity &amp; data residency</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-body-sm">
            <div>
              <div className="text-caption uppercase tracking-wider t-muted mb-1">Recovery Time Objective (RTO)</div>
              <div className="t-primary font-medium">≤ 4 hours</div>
              <p className="text-caption t-muted mt-0.5">Time to restore service after a regional incident.</p>
            </div>
            <div>
              <div className="text-caption uppercase tracking-wider t-muted mb-1">Recovery Point Objective (RPO)</div>
              <div className="t-primary font-medium">≤ 1 hour</div>
              <p className="text-caption t-muted mt-0.5">Max data loss in a disaster scenario (hourly D1 backups).</p>
            </div>
            <div>
              <div className="text-caption uppercase tracking-wider t-muted mb-1">Primary region</div>
              <div className="t-primary font-medium">Cloudflare Global Network · D1 pinned to af-south-1 (Johannesburg)</div>
              <p className="text-caption t-muted mt-0.5">Workers run at the closest edge; durable state (D1, R2) is region-pinned.</p>
            </div>
            <div>
              <div className="text-caption uppercase tracking-wider t-muted mb-1">Backup cadence</div>
              <div className="t-primary font-medium">Hourly D1 snapshots · 30-day retention</div>
              <p className="text-caption t-muted mt-0.5">Backed up via GitHub Actions workflow <code className="font-mono">backup-d1.yml</code>.</p>
            </div>
          </div>
          <div className="mt-4 pt-4 border-t text-caption t-muted" style={{ borderColor: 'var(--border-card)' }}>
            Compliance: SOC 2 Type II controls implemented (CC6.1, CC6.2, CC7.3, CC8.1).
            POPIA + GDPR DSAR support is live on the Compliance tab. For full SOC 2 evidence + sub-processor list,
            ask your administrator to issue an Auditor-role login.
          </div>
        </Card>

        {/* Incident timeline */}
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b flex items-center justify-between" style={{ borderColor: 'var(--border-card)' }}>
            <div className="flex items-center gap-2">
              <Clock size={14} className="t-muted" />
              <h3 className="text-body font-semibold t-primary">Incident history</h3>
            </div>
            <span className="text-caption t-muted">Last 90 days · {data?.incidents.length ?? 0} incident{(data?.incidents.length ?? 0) === 1 ? '' : 's'}</span>
          </div>
          {!data || data.incidents.length === 0 ? (
            <div className="p-8 text-center">
              <CheckCircle2 size={28} className="mx-auto mb-2" style={{ color: 'rgb(var(--accent-rgb) / 0.40)' }} />
              <p className="text-body-sm t-primary font-medium">No incidents in the last 90 days</p>
              <p className="text-caption t-muted mt-1">All systems have been operational.</p>
            </div>
          ) : (
            <div className="divide-y" style={{ borderColor: 'var(--border-card)' }}>
              {data.incidents.map((i) => (
                <details key={i.id} className="group" style={{ borderColor: 'var(--border-card)' }}>
                  <summary className="px-5 py-4 cursor-pointer flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-body-sm font-medium t-primary">{i.title}</span>
                        <Badge variant={i.resolvedAt ? 'success' : 'warning'} size="sm">{i.resolvedAt ? 'Resolved' : i.status}</Badge>
                      </div>
                      <div className="text-caption t-muted mt-1">
                        Started {new Date(i.startedAt).toLocaleString()}
                        {i.resolvedAt && <> · Resolved {new Date(i.resolvedAt).toLocaleString()}</>}
                      </div>
                    </div>
                  </summary>
                  {i.updates.length > 0 && (
                    <div className="px-5 pb-4 space-y-2">
                      {i.updates.slice().reverse().map((u, idx) => (
                        <div key={idx} className="text-caption">
                          <span className="t-muted">{new Date(u.at).toLocaleString()}</span>
                          <span className="t-muted"> · </span>
                          <span className="font-medium t-primary uppercase tracking-wider">{u.status}</span>
                          <p className="t-secondary mt-0.5">{u.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </details>
              ))}
            </div>
          )}
        </Card>

        <div className="text-caption t-muted text-center pt-2">
          For partner contracts, security questionnaires, or DPA templates, contact your Atheon CS team.
        </div>
      </div>
    </div>
  );
}
