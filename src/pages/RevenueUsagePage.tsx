/**
 * ADMIN-007: Revenue & Usage Dashboard
 * Superadmin /revenue route with MRR/ARR, plan distribution, growth trends,
 * LLM usage aggregate. All data pulled from real aggregation endpoint:
 *   GET /api/v1/admin/revenue-usage
 * No client-side mock data. MRR is estimated from plan tier — labeled as such.
 * Route: /revenue | Role: superadmin only
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { HeroHeader } from '@/components/ui/hero-header';
import { api, ApiError } from '@/lib/api';
import type { RevenueUsageResponse } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import { LoadingState, ErrorState } from '@/components/ui/state';
import {
  DollarSign, TrendingUp, PieChart, Activity,
  Building2, CreditCard, RefreshCw, Users, Brain, AlertCircle,
} from 'lucide-react';

const PLAN_COLORS: Record<string, string> = {
  enterprise: '#818cf8',
  professional: '#3b82f6',
  starter: '#10b981',
  trial: '#6b7280',
};

function planColor(plan: string): string {
  return PLAN_COLORS[plan.toLowerCase()] || '#6b7280';
}

export function RevenueUsagePage() {
  const { activeTab, setActiveTab } = useTabState('overview');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<RevenueUsageResponse | null>(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await api.adminAggregation.revenueUsage();
      setData(res);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      toast.error('Failed to load revenue & usage', {
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

  const tabs = [
    { id: 'overview', label: 'Overview', icon: <DollarSign size={14} /> },
    { id: 'plans', label: 'Plan Distribution', icon: <PieChart size={14} /> },
    { id: 'growth', label: 'Growth Trends', icon: <TrendingUp size={14} /> },
    { id: 'usage', label: 'LLM Usage', icon: <Activity size={14} /> },
  ];

  // Render-state contract (UI_POLISH_PRINCIPLES §6.1):
  if (loading && !data) return <LoadingState variant="cards" count={4} />;
  if (error && !data) {
    return (
      <ErrorState
        title="Couldn't load revenue & usage"
        error={error}
        onRetry={handleRefresh}
      />
    );
  }
  if (!data) return null;

  const { summary, byPlan, growth, llm } = data;
  const maxMonthCount = Math.max(...growth.newTenantsByMonth.map((g) => g.count), 1);
  const totalByPlan = byPlan.reduce((s, p) => s + p.count, 0);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <HeroHeader
          icon={DollarSign}
          title="Revenue & Usage"
          subtitle="Platform-wide metrics, plan distribution & LLM usage"
          accent="sage"
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

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-label">Estimated MRR</span>
            {summary.pricingIsEstimate && <Badge variant="warning" className="text-caption">EST</Badge>}
          </div>
          <p className="text-xl font-bold t-primary mt-1">${summary.estMrrUsd.toLocaleString()}</p>
          <p className="text-caption t-muted">Derived from plan tier</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-1 mb-1">
            <span className="text-label">Estimated ARR</span>
            {summary.pricingIsEstimate && <Badge variant="warning" className="text-caption">EST</Badge>}
          </div>
          <p className="text-xl font-bold t-primary mt-1">${summary.estArrUsd.toLocaleString()}</p>
          <p className="text-caption t-muted">MRR × 12</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Building2 size={14} className="text-accent" />
            <span className="text-label">Total Tenants</span>
          </div>
          <p className="text-xl font-bold t-primary">{summary.totalTenants.toLocaleString()}</p>
          <p className="text-caption t-muted">Active (not deleted)</p>
        </Card>
        <Card className="p-3">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-accent" />
            <span className="text-label">Total Users</span>
          </div>
          <p className="text-xl font-bold t-primary">{summary.totalUsers.toLocaleString()}</p>
          <p className="text-caption t-muted">Across all tenants</p>
        </Card>
      </div>

      {summary.pricingIsEstimate && (
        <Card className="p-3 border-l-2 border-amber-400/50">
          <p className="text-caption t-muted flex items-start gap-1.5">
            <AlertCircle size={12} className="text-amber-400 mt-0.5 flex-shrink-0" />
            <span>{summary.pricingNote}</span>
          </p>
        </Card>
      )}

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="overview" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="p-4">
            <h3 className="text-sm font-medium t-primary mb-3 flex items-center gap-2">
              <CreditCard size={14} className="text-accent" /> Estimated Revenue Breakdown
            </h3>
            <div className="space-y-3">
              {byPlan.length === 0 ? (
                <p className="text-xs t-muted">No plan data.</p>
              ) : byPlan.map((p) => (
                <div key={p.plan} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full" style={{ background: planColor(p.plan) }} />
                    <span className="text-xs t-primary capitalize">{p.plan}</span>
                    <Badge variant="default" className="text-caption">{p.count} tenants</Badge>
                  </div>
                  <span className="text-xs font-medium t-primary">${p.estMrrUsd.toLocaleString()}/mo</span>
                </div>
              ))}
              <div className="border-t border-[var(--border-card)] pt-2 flex justify-between">
                <span className="text-xs font-medium t-primary">Total (est.)</span>
                <span className="text-sm font-bold text-accent">${summary.estMrrUsd.toLocaleString()}/mo</span>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <h3 className="text-sm font-medium t-primary mb-3 flex items-center gap-2">
              <Brain size={14} className="text-accent" /> Top Tenants by LLM Tokens (30d)
            </h3>
            {llm.topTenants.length === 0 ? (
              <p className="text-xs t-muted">No LLM usage recorded in the last 30 days.</p>
            ) : (
              <div className="space-y-2">
                {llm.topTenants.map((t, i) => (
                  <div key={t.tenantId || i} className="flex items-center justify-between p-2 rounded-lg hover:bg-[var(--bg-secondary)]">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-caption t-muted w-4 flex-shrink-0">{i + 1}.</span>
                      <span className="text-xs t-primary truncate">{t.name}</span>
                      <Badge variant="default" className="text-caption">{t.plan}</Badge>
                    </div>
                    <span className="text-xs font-medium text-accent flex-shrink-0">{t.tokens30d.toLocaleString()} tok</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </TabPanel>

      <TabPanel id="plans" activeTab={activeTab}>
        <Card className="p-4">
          <h3 className="text-sm font-medium t-primary mb-4">Plan Distribution</h3>
          {byPlan.length === 0 ? (
            <p className="text-xs t-muted">No tenants yet.</p>
          ) : (
            <div className="space-y-3">
              {byPlan.map((p) => {
                const pct = totalByPlan > 0 ? (p.count / totalByPlan) * 100 : 0;
                return (
                  <div key={p.plan}>
                    <div className="flex justify-between text-xs mb-1">
                      <span className="t-primary font-medium capitalize">{p.plan}</span>
                      <span className="t-muted">{p.count} tenants ({pct.toFixed(0)}%)</span>
                    </div>
                    <div className="h-3 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, background: planColor(p.plan) }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </TabPanel>

      <TabPanel id="growth" activeTab={activeTab}>
        <Card className="p-4">
          <h3 className="text-sm font-medium t-primary mb-4">New Tenants per Month (Last 6 Months)</h3>
          {growth.newTenantsByMonth.length === 0 ? (
            <p className="text-xs t-muted">No growth data.</p>
          ) : (
            <>
              <div className="flex items-end gap-2 h-40">
                {growth.newTenantsByMonth.map((g) => {
                  const heightPct = (g.count / maxMonthCount) * 100;
                  return (
                    <div key={g.month} className="flex-1 flex flex-col items-center gap-1">
                      <span className="text-caption font-medium t-primary">{g.count}</span>
                      <div
                        className="w-full rounded-t-md bg-accent/80 transition-all"
                        style={{ height: `${Math.max(heightPct, 2)}%`, minHeight: g.count > 0 ? 8 : 2 }}
                      />
                      <span className="text-caption t-muted">{g.month.slice(-2)}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-caption t-muted mt-3">Bars show number of new tenants signed up per month (YYYY-MM).</p>
            </>
          )}
        </Card>
      </TabPanel>

      <TabPanel id="usage" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Brain size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Platform LLM Usage</span>
            </div>
            <div className="space-y-2 text-xs">
              <div className="flex justify-between"><span className="t-muted">Total Tokens (30d)</span><span className="t-primary font-medium">{llm.totalTokens30d.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="t-muted">LLM Calls (30d)</span><span className="t-primary font-medium">{llm.callCount30d.toLocaleString()}</span></div>
              <div className="flex justify-between"><span className="t-muted">Tenants Using LLM</span><span className="t-primary font-medium">{llm.topTenants.length}</span></div>
            </div>
          </Card>
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp size={14} className="text-accent" />
              <span className="text-sm font-medium t-primary">Top 10 Tenants by Spend</span>
            </div>
            {llm.topTenants.length === 0 ? (
              <p className="text-xs t-muted">No LLM usage to report.</p>
            ) : (
              <div className="space-y-1.5 text-xs">
                {llm.topTenants.map((t, i) => (
                  <div key={t.tenantId || i} className="flex items-center justify-between">
                    <span className="t-primary truncate">{i + 1}. {t.name}</span>
                    <span className="t-muted flex-shrink-0 ml-2">{t.tokens30d.toLocaleString()} tok</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </TabPanel>
    </div>
  );
}
