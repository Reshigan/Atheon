/**
 * ADMIN-003: Company Health Dashboard
 * Admin+ view of per-tenant adoption, catalyst usage, LLM usage, entitlements.
 * Route: /company-health | Role: admin, support_admin, superadmin
 *
 * All metrics are read from real data via
 *   GET /api/v1/admin-tooling/company-health/:tenantId
 * No client-side mock data.
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { api, ApiError } from '@/lib/api';
import type { CompanyHealthDetail } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import {
  Users, BarChart3, Brain, Shield,
  Activity, Zap, Clock, AlertCircle, Building2, Wifi, RefreshCw,
} from 'lucide-react';

export function CompanyHealthPage() {
  const { activeTab, setActiveTab } = useTabState('adoption');
  const user = useAppStore((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CompanyHealthDetail | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    if (!user?.tenantId) {
      setError('No tenant context');
      setLoading(false);
      return;
    }
    setError(null);
    try {
      const res = await api.adminTooling.companyHealthDetail(user.tenantId);
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load company health', {
        message: msg,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [user?.tenantId, toast]);

  useEffect(() => { load(); }, [load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load();
  };

  const tabs = [
    { id: 'adoption', label: 'User Adoption', icon: <Users size={14} /> },
    { id: 'catalysts', label: 'Catalyst Usage', icon: <Zap size={14} /> },
    { id: 'ai-usage', label: 'LLM Usage', icon: <Brain size={14} /> },
    { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
  ];

  if (loading && !data) return <LoadingState variant="cards" count={4} />;
  if (error && !data) {
    return (
      <ErrorState
        title="Couldn't load company health"
        error={error}
        onRetry={handleRefresh}
      />
    );
  }
  if (!data) return null;

  const activePct = data.users.total > 0 ? Math.round((data.users.active / data.users.total) * 100) : 0;
  const userPct = data.entitlements?.maxUsers
    ? Math.min(100, Math.round((data.users.total / data.entitlements.maxUsers) * 100))
    : 0;

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <BarChart3 className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Company Health</h1>
            <p className="text-xs t-muted">
              {data.tenant.name} &middot; plan: <span className="t-primary">{data.tenant.plan}</span>
            </p>
          </div>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-[var(--border-card)] t-secondary hover:t-primary hover:bg-[var(--bg-secondary)] transition-all"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent" />
            <span className="text-label">Active Users</span>
          </div>
          <p className="text-xl font-bold t-primary">
            {data.users.active}<span className="text-sm t-muted">/{data.users.total}</span>
          </p>
          <p className="text-caption t-muted">{activePct}% of tenant users active</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-accent" />
            <span className="text-label">Catalyst Actions</span>
          </div>
          <p className="text-xl font-bold t-primary">{data.catalysts.actionsLast30d.toLocaleString()}</p>
          <p className="text-caption t-muted">Last 30 days</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Brain size={14} className="text-accent" />
            <span className="text-label">LLM Tokens</span>
          </div>
          <p className="text-xl font-bold t-primary">
            {data.llm.tokens30d >= 1_000_000
              ? `${(data.llm.tokens30d / 1_000_000).toFixed(2)}M`
              : data.llm.tokens30d >= 1_000
                ? `${(data.llm.tokens30d / 1_000).toFixed(1)}k`
                : data.llm.tokens30d.toLocaleString()}
          </p>
          <p className="text-caption t-muted">Last 30 days</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Wifi size={14} className="text-accent" />
            <span className="text-label">ERP Connections</span>
          </div>
          <p className="text-xl font-bold t-primary">
            {data.erp.connectedCount}<span className="text-sm t-muted">/{data.erp.connections}</span>
          </p>
          <p className="text-caption t-muted">Connected / total</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="adoption" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">User Status</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="t-muted">Total Users</span>
                <span className="t-primary font-medium">{data.users.total}</span>
              </div>
              <div className="flex justify-between">
                <span className="t-muted">Active</span>
                <span className="t-primary font-medium">{data.users.active}</span>
              </div>
              <div className="flex justify-between">
                <span className="t-muted">Last Login</span>
                <span className="t-primary font-medium">
                  {data.users.lastLoginAt ? new Date(data.users.lastLoginAt).toLocaleString() : 'Never'}
                </span>
              </div>
              {data.entitlements && (
                <>
                  <div className="flex justify-between pt-2 border-t border-[var(--border-card)]">
                    <span className="t-muted">Seat Utilisation</span>
                    <span className="t-primary font-medium">{userPct}% of {data.entitlements.maxUsers} seats</span>
                  </div>
                  <div className="h-2 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all"
                      style={{
                        width: `${userPct}%`,
                        background: userPct >= 90 ? '#ef4444' : userPct >= 70 ? '#f59e0b' : 'var(--accent)',
                      }}
                    />
                  </div>
                </>
              )}
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Shield size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Users by Role</span>
            </div>
            {Object.keys(data.users.byRole).length === 0 ? (
              <p className="text-xs t-muted">No users.</p>
            ) : (
              <div className="space-y-2">
                {Object.entries(data.users.byRole).map(([role, count]) => (
                  <div key={role} className="flex items-center justify-between">
                    <span className="text-xs t-primary capitalize">{role.replace('_', ' ')}</span>
                    <Badge variant="default" className="text-caption">{count}</Badge>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="catalysts" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Zap size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Catalyst Clusters</span>
            </div>
            <p className="text-2xl font-bold t-primary">{data.catalysts.clusters}</p>
            <p className="text-xs t-muted mt-1">Configured clusters</p>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Recent Activity</span>
            </div>
            <p className="text-2xl font-bold t-primary">{data.catalysts.actionsLast30d.toLocaleString()}</p>
            <p className="text-xs t-muted mt-1 flex items-center gap-1">
              <Clock size={10} /> Actions in last 30 days
            </p>
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="ai-usage" activeTab={activeTab}>
        <Card className="p-4">
          <div className="flex items-center gap-2 mb-3">
            <Brain size={14} className="text-accent" />
            <span className="text-sm font-medium t-primary">LLM Usage (Last 30 Days)</span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <p className="text-label">Total Tokens</p>
              <p className="text-2xl font-bold t-primary">{data.llm.tokens30d.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-label flex items-center gap-1">
                Estimated Cost
                {data.llm.costIsEstimate && <Badge variant="warning" className="text-caption">ESTIMATE</Badge>}
              </p>
              <p className="text-2xl font-bold t-primary">${data.llm.estCostUsd.toFixed(2)}</p>
            </div>
          </div>
          {data.llm.costIsEstimate && (
            <p className="text-caption t-muted mt-3 flex items-start gap-1">
              <AlertCircle size={10} className="mt-0.5 flex-shrink-0" />
              <span>{data.llm.costNote}</span>
            </p>
          )}
        </Card>
      </TabPanel>

      <TabPanel id="entitlements" activeTab={activeTab}>
        {!data.entitlements ? (
          <Card className="p-6 text-center">
            <p className="text-sm t-muted">No entitlements configured for this tenant.</p>
          </Card>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Users size={14} className="text-accent" />
                <span className="text-sm font-medium t-primary">Capacity</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="t-muted">Max Users</span><span className="t-primary font-medium">{data.entitlements.maxUsers}</span></div>
                <div className="flex justify-between"><span className="t-muted">Max Agents</span><span className="t-primary font-medium">{data.entitlements.maxAgents}</span></div>
                <div className="flex justify-between"><span className="t-muted">Data Retention</span><span className="t-primary font-medium">{data.entitlements.dataRetentionDays} days</span></div>
              </div>
            </Card>
            <Card className="p-4">
              <div className="flex items-center gap-2 mb-3">
                <Building2 size={14} className="text-accent" />
                <span className="text-sm font-medium t-primary">Access</span>
              </div>
              <div className="space-y-2 text-xs">
                <div className="flex justify-between"><span className="t-muted">SSO</span><Badge variant={data.entitlements.ssoEnabled ? 'success' : 'default'} className="text-caption">{data.entitlements.ssoEnabled ? 'Enabled' : 'Disabled'}</Badge></div>
                <div className="flex justify-between"><span className="t-muted">API Access</span><Badge variant={data.entitlements.apiAccess ? 'success' : 'default'} className="text-caption">{data.entitlements.apiAccess ? 'Enabled' : 'Disabled'}</Badge></div>
                <div className="flex justify-between"><span className="t-muted">Custom Branding</span><Badge variant={data.entitlements.customBranding ? 'success' : 'default'} className="text-caption">{data.entitlements.customBranding ? 'Enabled' : 'Disabled'}</Badge></div>
              </div>
            </Card>
            <Card className="p-4 sm:col-span-2">
              <div className="flex items-center gap-2 mb-3">
                <Shield size={14} className="text-accent" />
                <span className="text-sm font-medium t-primary">Layers & Clusters</span>
              </div>
              <div className="space-y-3 text-xs">
                <div>
                  <p className="t-muted mb-1">Layers</p>
                  <div className="flex flex-wrap gap-1">
                    {data.entitlements.layers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.layers.map((l) => (
                      <Badge key={l} variant="info" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="t-muted mb-1">Catalyst Clusters</p>
                  <div className="flex flex-wrap gap-1">
                    {data.entitlements.catalystClusters.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.catalystClusters.map((l) => (
                      <Badge key={l} variant="info" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="t-muted mb-1">LLM Tiers</p>
                  <div className="flex flex-wrap gap-1">
                    {data.entitlements.llmTiers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.llmTiers.map((l) => (
                      <Badge key={l} variant="default" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                <div>
                  <p className="t-muted mb-1">Autonomy Tiers</p>
                  <div className="flex flex-wrap gap-1">
                    {data.entitlements.autonomyTiers.length === 0 && <span className="t-muted">(none)</span>}
                    {data.entitlements.autonomyTiers.map((l) => (
                      <Badge key={l} variant="default" className="text-caption">{l}</Badge>
                    ))}
                  </div>
                </div>
                {data.entitlements.features.length > 0 && (
                  <div>
                    <p className="t-muted mb-1">Features</p>
                    <div className="flex flex-wrap gap-1">
                      {data.entitlements.features.map((l) => (
                        <Badge key={l} variant="success" className="text-caption">{l}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          </div>
        )}
      </TabPanel>
    </div>
  );
}
