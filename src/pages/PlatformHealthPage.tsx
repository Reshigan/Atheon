/**
 * ADMIN-001: Platform Health Dashboard
 * Superadmin-only real-time view of infrastructure, tenant roster, and system alerts.
 * Route: /platform-health | Role: superadmin only
 *
 * Endpoints (all confirmed in workers/api/src/routes/admin-tooling.ts):
 *   - GET /api/v1/admin-tooling/platform-health  (ADMIN-001, superadmin only)
 *   - GET /api/v1/admin-tooling/tenants-read     (ADMIN-011, support_admin+)
 *   - GET /api/v1/admin-tooling/system-alerts    (ADMIN-012, admin+)
 *
 * Behaviour on failure: surfaces a toast with requestId and shows an empty
 * state — no more silent fallback to fake mock data.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { LoadingState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import { CompanyHealthPage } from './CompanyHealthPage';
import { api, ApiError } from '@/lib/api';
import {
  Activity, Server, Database, AlertTriangle,
  CheckCircle, XCircle, Clock, RefreshCw,
  Users, Building2, Zap,
} from 'lucide-react';

// ── Response shapes (mirrors workers/api/src/routes/admin-tooling.ts) ──
interface PlatformHealthResponse {
  success?: boolean;
  infrastructure?: {
    apiResponseMs?: number;
    totalRequestsLastHour?: number;
    dbStatus?: 'healthy' | 'degraded' | 'critical';
    workerStatus?: 'healthy' | 'degraded' | 'critical';
  };
  tenants?: { total?: number };
  users?: { total?: number };
  timestamp?: string;
}

interface TenantReadRow {
  id: string;
  name: string;
  slug?: string;
  plan?: string;
  status?: string;
  region?: string;
  created_at?: string;
}

interface SystemAlertRow {
  id?: string;
  severity?: 'critical' | 'warning' | 'info';
  title?: string;
  message?: string;
  source?: string;
  createdAt?: string;
  created_at?: string;
  acknowledged?: boolean;
}

// ── Helpers ──
const healthStatusColor = (s?: string) => {
  if (s === 'healthy') return 'success';
  if (s === 'degraded') return 'warning';
  return 'danger';
};

const tenantStatusColor = (s?: string) => {
  if (s === 'active') return 'success';
  if (s === 'provisioning' || s === 'pending') return 'warning';
  if (s === 'suspended' || s === 'deleted') return 'danger';
  return 'default';
};

const alertSeverityIcon = (sev?: string) => {
  if (sev === 'critical') return <XCircle size={16} className="text-red-400 mt-0.5" />;
  if (sev === 'warning') return <AlertTriangle size={16} className="text-amber-400 mt-0.5" />;
  return <Activity size={16} className="text-blue-400 mt-0.5" />;
};

export function PlatformHealthPage() {
  // Role-conditional surface (May 2026 backlog merge): superadmins see
  // cross-tenant infrastructure here; non-superadmin admins see their own
  // tenant's adoption / catalyst usage / LLM usage / entitlements via the
  // embedded CompanyHealthPage. Both URLs (`/platform-health` and the
  // redirect from `/company-health`) land here so the sidebar has a single
  // "Operations Health" entry per UI_POLISH_PRINCIPLES §6.2.
  const userRole = useAppStore((s) => s.user?.role);
  if (userRole && userRole !== 'superadmin' && userRole !== 'support_admin') {
    return <CompanyHealthPage />;
  }

  return <SuperadminPlatformHealth />;
}

function SuperadminPlatformHealth() {
  const toast = useToast();
  const { activeTab, setActiveTab } = useTabState('infrastructure');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const [platformHealth, setPlatformHealth] = useState<PlatformHealthResponse | null>(null);
  const [tenants, setTenants] = useState<TenantReadRow[]>([]);
  const [alerts, setAlerts] = useState<SystemAlertRow[]>([]);

  const loadData = useCallback(async () => {
    const [ph, tr, al] = await Promise.allSettled([
      api.adminTooling.platformHealth(),
      api.adminTooling.tenantsRead(),
      api.adminTooling.systemAlerts(),
    ]);

    if (ph.status === 'fulfilled') {
      setPlatformHealth(ph.value as PlatformHealthResponse);
    } else {
      setPlatformHealth(null);
      const err = ph.reason;
      toast.error('Failed to load platform health', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }

    if (tr.status === 'fulfilled') {
      const rows = (tr.value?.tenants as unknown as TenantReadRow[] | undefined) ?? [];
      setTenants(rows);
    } else {
      setTenants([]);
      // Non-fatal — a superadmin on a fresh environment may see no tenants.
      // Only surface a toast on real errors (not silent 403s).
      const err = tr.reason;
      if (err instanceof ApiError && err.status !== 403) {
        toast.error('Failed to load tenants', {
          message: err.message,
          requestId: err.requestId,
        });
      }
    }

    if (al.status === 'fulfilled') {
      const rows = (al.value?.alerts as unknown as SystemAlertRow[] | undefined) ?? [];
      setAlerts(rows);
    } else {
      setAlerts([]);
      const err = al.reason;
      if (err instanceof ApiError && err.status !== 403) {
        toast.error('Failed to load system alerts', {
          message: err.message,
          requestId: err.requestId,
        });
      }
    }
  }, [toast]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await loadData();
      setLoading(false);
    })();
  }, [loadData]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  };

  const infra = platformHealth?.infrastructure ?? {};
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged);
  const criticalAlerts = alerts.filter(a => a.severity === 'critical');

  const tabs = [
    { id: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} /> },
    { id: 'tenants', label: 'Tenant Roster', icon: <Building2 size={14} />, count: tenants.length },
    { id: 'alerts', label: 'System Alerts', icon: <AlertTriangle size={14} />, count: unacknowledgedAlerts.length },
  ];

  if (loading) return <LoadingState variant="cards" count={4} />;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Activity className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Platform Health</h1>
            <p className="text-xs t-muted">
              Real-time infrastructure & tenant monitoring
              {platformHealth?.timestamp && (
                <> · updated {new Date(platformHealth.timestamp).toLocaleTimeString()}</>
              )}
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all disabled:opacity-50"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Database size={14} className="text-accent" />
            <span className="text-label">DB Status</span>
          </div>
          <p className="text-xl font-bold t-primary capitalize">{infra.dbStatus ?? '—'}</p>
          <p className="text-caption t-muted">Worker: {infra.workerStatus ?? '—'}</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent" />
            <span className="text-label">Platform Users</span>
          </div>
          <p className="text-xl font-bold t-primary">{platformHealth?.users?.total ?? '—'}</p>
          <p className="text-caption t-muted">Across {platformHealth?.tenants?.total ?? tenants.length} tenants</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent" />
            <span className="text-label">API Calls (1h)</span>
          </div>
          <p className="text-xl font-bold t-primary">
            {typeof infra.totalRequestsLastHour === 'number'
              ? infra.totalRequestsLastHour.toLocaleString()
              : '—'}
          </p>
          <p className="text-caption t-muted">Avg {infra.apiResponseMs ?? '—'} ms</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <AlertTriangle size={14} className="text-amber-400" />
            <span className="text-label">Active Alerts</span>
          </div>
          <p className="text-xl font-bold t-primary">{unacknowledgedAlerts.length}</p>
          <p className="text-caption t-muted">{criticalAlerts.length} critical</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="infrastructure" activeTab={activeTab}>
        {!platformHealth ? (
          <Card className="p-8 text-center">
            <XCircle size={24} className="mx-auto text-red-400 mb-2" />
            <p className="text-sm t-primary font-medium">Infrastructure data unavailable</p>
            <p className="text-xs t-muted mt-1">
              /api/v1/admin-tooling/platform-health failed or returned no data. Try refresh.
            </p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">API Response Time</span>
                <Badge variant={
                  typeof infra.apiResponseMs !== 'number' ? 'default' :
                  infra.apiResponseMs < 200 ? 'success' :
                  infra.apiResponseMs < 500 ? 'warning' : 'danger'
                } className="text-caption">
                  {typeof infra.apiResponseMs !== 'number' ? 'n/a' :
                   infra.apiResponseMs < 200 ? 'healthy' :
                   infra.apiResponseMs < 500 ? 'degraded' : 'critical'}
                </Badge>
              </div>
              <p className="text-2xl font-bold t-primary">
                {infra.apiResponseMs ?? '—'}
                <span className="text-sm t-muted ml-1">ms</span>
              </p>
              <p className="text-caption t-muted mt-1">Rolling avg, last 60 min</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">Requests / Hour</span>
                <CheckCircle size={14} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-bold t-primary">
                {typeof infra.totalRequestsLastHour === 'number'
                  ? infra.totalRequestsLastHour.toLocaleString()
                  : '—'}
              </p>
              <p className="text-caption t-muted mt-1">Observed inbound traffic</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">D1 Database</span>
                <Badge variant={healthStatusColor(infra.dbStatus)} className="text-caption">
                  {infra.dbStatus ?? 'unknown'}
                </Badge>
              </div>
              <p className="text-2xl font-bold t-primary capitalize">{infra.dbStatus ?? '—'}</p>
              <p className="text-caption t-muted mt-1">SELECT 1 probe</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">Worker</span>
                <Badge variant={healthStatusColor(infra.workerStatus)} className="text-caption">
                  {infra.workerStatus ?? 'unknown'}
                </Badge>
              </div>
              <p className="text-2xl font-bold t-primary capitalize">{infra.workerStatus ?? '—'}</p>
              <p className="text-caption t-muted mt-1">Cloudflare Worker runtime</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">Total Tenants</span>
                <Building2 size={14} className="text-accent" />
              </div>
              <p className="text-2xl font-bold t-primary">{platformHealth.tenants?.total ?? '—'}</p>
              <p className="text-caption t-muted mt-1">Non-deleted tenants</p>
            </Card>

            <Card className="p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted">Total Users</span>
                <Users size={14} className="text-accent" />
              </div>
              <p className="text-2xl font-bold t-primary">{platformHealth.users?.total ?? '—'}</p>
              <p className="text-caption t-muted mt-1">All tenants combined</p>
            </Card>
          </div>
        )}
      </TabPanel>

      <TabPanel id="tenants" activeTab={activeTab}>
        {tenants.length === 0 ? (
          <Card className="p-8 text-center">
            <Building2 size={24} className="mx-auto t-muted mb-2" />
            <p className="text-sm t-muted">No tenants visible.</p>
            <p className="text-caption t-muted mt-1">
              Requires support_admin or superadmin role.
            </p>
          </Card>
        ) : (
          <div className="space-y-2">
            {tenants.map((t) => (
              <Card key={t.id} className="p-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Building2 size={14} className="text-accent" />
                  </div>
                  <div>
                    <p className="text-sm font-medium t-primary">{t.name}</p>
                    <p className="text-caption t-muted">
                      {t.slug ? `${t.slug} · ` : ''}
                      {t.region ?? 'no region'}
                      {t.plan ? ` · ${t.plan}` : ''}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 text-xs">
                  {t.created_at && (
                    <div className="text-right hidden sm:block">
                      <p className="t-muted">Created</p>
                      <p className="font-medium t-primary">{new Date(t.created_at).toLocaleDateString()}</p>
                    </div>
                  )}
                  <Badge variant={tenantStatusColor(t.status)}>{t.status ?? 'unknown'}</Badge>
                </div>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel id="alerts" activeTab={activeTab}>
        <div className="space-y-2">
          {alerts.length === 0 ? (
            <Card className="p-8 text-center">
              <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2" />
              <p className="text-sm t-muted">No active alerts</p>
              <p className="text-caption t-muted mt-1">
                Alerts are published to KV (alerts:{'<tenant>'}) by background jobs.
              </p>
            </Card>
          ) : alerts.map((a, idx) => (
            <Card key={a.id ?? idx} className="p-4 flex items-start gap-3">
              {alertSeverityIcon(a.severity)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium t-primary">{a.title ?? 'Alert'}</p>
                  <Badge
                    variant={a.severity === 'critical' ? 'danger' : a.severity === 'warning' ? 'warning' : 'info'}
                    className="text-caption"
                  >
                    {a.severity ?? 'info'}
                  </Badge>
                  {a.acknowledged && <Badge variant="default" className="text-caption">acknowledged</Badge>}
                </div>
                {a.message && <p className="text-xs t-muted mt-0.5">{a.message}</p>}
                <p className="text-caption t-muted mt-1 flex items-center gap-1">
                  <Clock size={10} />
                  {(() => {
                    const ts = a.createdAt || a.created_at;
                    return ts ? new Date(ts).toLocaleString() : 'unknown time';
                  })()}
                  {a.source && ` · ${a.source}`}
                </p>
              </div>
            </Card>
          ))}
        </div>
      </TabPanel>
    </div>
  );
}
