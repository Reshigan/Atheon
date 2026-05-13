/**
 * ADMIN-010: Integration Health Monitoring
 * Per-connection sync status, error count, circuit breaker state, freshness.
 * Route: /integration-health | Role: admin, support_admin, superadmin
 *
 * Data: GET /api/v1/erp/connections/health — aggregates erp_connections,
 * audit_log error counts, and KV-backed circuit breaker state. No mocks.
 * Distinct from ConnectivityPage (adapter CRUD); this view is sync-health-focused.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { HeroHeader } from '@/components/ui/hero-header';
import { api, ApiError } from '@/lib/api';
import type { IntegrationHealthConnection } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LoadingState, ErrorState } from '@/components/ui/state';
import {
  Wifi, CheckCircle, XCircle, AlertTriangle, Clock,
  RefreshCw, Zap, Activity,
} from 'lucide-react';

function statusVariant(status: string): 'success' | 'warning' | 'danger' | 'default' {
  const s = status.toLowerCase();
  if (s === 'connected' || s === 'active' || s === 'healthy') return 'success';
  if (s === 'pending' || s === 'provisioning' || s === 'degraded') return 'warning';
  if (s === 'disconnected' || s === 'error' || s === 'failed') return 'danger';
  return 'default';
}

function statusIcon(status: string) {
  const v = statusVariant(status);
  if (v === 'success') return <CheckCircle size={14} className="text-emerald-400" />;
  if (v === 'warning') return <AlertTriangle size={14} className="text-amber-400" />;
  if (v === 'danger') return <XCircle size={14} className="text-red-400" />;
  return <Activity size={14} className="t-muted" />;
}

function freshnessColor(freshness: 'fresh' | 'stale' | 'cold'): string {
  if (freshness === 'fresh') return 'var(--accent)';
  if (freshness === 'stale') return '#f59e0b';
  return '#ef4444';
}

function freshnessLabel(conn: IntegrationHealthConnection): string {
  if (conn.hoursSinceSync == null) return 'Never synced';
  const h = conn.hoursSinceSync;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))}m ago`;
  if (h < 24) return `${Math.round(h)}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function circuitVariant(state: string): 'success' | 'warning' | 'danger' {
  if (state === 'CLOSED') return 'success';
  if (state === 'HALF_OPEN') return 'warning';
  return 'danger';
}

export function IntegrationHealthPage() {
  const { activeTab, setActiveTab } = useTabState('connections');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<IntegrationHealthConnection[]>([]);
  const toast = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.erp.connectionsHealth();
      setConnections(res.connections);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load integration health', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const summary = useMemo(() => {
    return {
      total: connections.length,
      healthy: connections.filter((c) => statusVariant(c.status) === 'success' && c.freshness === 'fresh' && c.errorsLast30d === 0).length,
      errored: connections.filter((c) => statusVariant(c.status) === 'danger' || c.circuitState === 'OPEN').length,
      records: connections.reduce((s, c) => s + (c.recordsSynced || 0), 0),
      errors: connections.reduce((s, c) => s + (c.errorsLast30d || 0), 0),
    };
  }, [connections]);

  const tabs = [
    { id: 'connections', label: 'Connections', icon: <Wifi size={14} />, count: connections.length },
    { id: 'errors', label: 'Errors', icon: <AlertTriangle size={14} />, count: summary.errors },
    { id: 'freshness', label: 'Data Freshness', icon: <Clock size={14} /> },
  ];

  if (loading && connections.length === 0) return <LoadingState variant="list" count={3} />;

  if (error && connections.length === 0) {
    return (
      <ErrorState
        title="Couldn't load integration health"
        error={error}
        onRetry={handleRefresh}
      />
    );
  }

  const erroredConnections = connections.filter((c) => c.errorsLast30d > 0 || c.circuitState === 'OPEN' || c.circuitState === 'HALF_OPEN');

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <HeroHeader
          icon={Wifi}
          title="Integration Health"
          subtitle="Per-connection sync status, circuit breakers & data freshness"
          accent="sky"
        />
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-label">Connections</p>
          <p className="text-xl font-bold t-primary">{summary.total}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Healthy</p>
          <p className="text-xl font-bold text-emerald-400">{summary.healthy}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Errored</p>
          <p className="text-xl font-bold text-red-400">{summary.errored}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Records Synced</p>
          <p className="text-xl font-bold t-primary">
            {summary.records >= 1000 ? `${(summary.records / 1000).toFixed(1)}k` : summary.records.toLocaleString()}
          </p>
        </Card>
      </div>

      {connections.length === 0 ? (
        <Card className="p-8 text-center">
          <Wifi size={24} className="mx-auto t-muted mb-2" />
          <p className="text-sm t-muted">No ERP connections configured for this tenant yet.</p>
        </Card>
      ) : (
        <>
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

          <TabPanel id="connections" activeTab={activeTab}>
            <div className="space-y-2">
              {connections.map((c) => (
                <Card key={c.id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                      {statusIcon(c.status)}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium t-primary truncate">{c.name}</p>
                          {c.adapter_name && <Badge variant="default" className="text-caption">{c.adapter_name}</Badge>}
                          <Badge variant={statusVariant(c.status)} className="text-caption">{c.status}</Badge>
                          <Badge variant={circuitVariant(c.circuitState)} className="text-caption">
                            <Zap size={9} className="inline mr-0.5" />
                            {c.circuitState}
                          </Badge>
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2 text-caption">
                          <div>
                            <span className="t-muted">Last Sync</span>
                            <p className="t-primary">{c.lastSync ? new Date(c.lastSync).toLocaleString() : 'Never'}</p>
                          </div>
                          <div>
                            <span className="t-muted">Freshness</span>
                            <p style={{ color: freshnessColor(c.freshness) }}>{freshnessLabel(c)} ({c.freshness})</p>
                          </div>
                          <div>
                            <span className="t-muted">Records</span>
                            <p className="t-primary">{c.recordsSynced.toLocaleString()}</p>
                          </div>
                          <div>
                            <span className="t-muted">Errors (30d)</span>
                            <p className={c.errorsLast30d > 0 ? 'text-red-400' : 't-primary'}>{c.errorsLast30d}</p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          </TabPanel>

          <TabPanel id="errors" activeTab={activeTab}>
            {erroredConnections.length === 0 ? (
              <Card className="p-8 text-center">
                <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2" />
                <p className="text-sm t-muted">No errors in the last 30 days.</p>
              </Card>
            ) : (
              <div className="space-y-2">
                {erroredConnections.map((c) => (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="flex items-start gap-3">
                        <XCircle size={14} className="text-red-400 mt-0.5" />
                        <div>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium t-primary">{c.name}</p>
                            {c.adapter_name && <Badge variant="default" className="text-caption">{c.adapter_name}</Badge>}
                          </div>
                          <p className="text-xs t-muted mt-0.5">
                            {c.errorsLast30d} error{c.errorsLast30d === 1 ? '' : 's'} in the last 30 days
                            {c.circuitState !== 'CLOSED' && ` · Circuit breaker: ${c.circuitState} (${c.circuitFailures} failures)`}
                          </p>
                          {c.lastSync && (
                            <p className="text-caption t-muted mt-1 flex items-center gap-1">
                              <Clock size={10} /> Last sync: {new Date(c.lastSync).toLocaleString()}
                            </p>
                          )}
                        </div>
                      </div>
                      <Badge variant="danger" className="text-caption">{c.errorsLast30d} errors</Badge>
                    </div>
                  </Card>
                ))}
              </div>
            )}
          </TabPanel>

          <TabPanel id="freshness" activeTab={activeTab}>
            <div className="space-y-2">
              {connections.map((c) => {
                const hours = c.hoursSinceSync ?? 999;
                const pct = Math.min(100, (hours / 24) * 100);
                return (
                  <Card key={c.id} className="p-4">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium t-primary">{c.name}</span>
                        {c.adapter_name && <Badge variant="default" className="text-caption">{c.adapter_name}</Badge>}
                      </div>
                      <span className="text-xs font-medium" style={{ color: freshnessColor(c.freshness) }}>
                        {freshnessLabel(c)}
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: freshnessColor(c.freshness) }}
                      />
                    </div>
                    <p className="text-caption t-muted mt-1">
                      fresh ≤ 1h · stale ≤ 24h · cold &gt; 24h
                    </p>
                  </Card>
                );
              })}
            </div>
          </TabPanel>
        </>
      )}
    </div>
  );
}
