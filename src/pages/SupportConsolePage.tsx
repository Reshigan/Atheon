/**
 * ADMIN-002: Support Console
 * Support admin console with tenant search, live activity timeline (from audit_log),
 * quick-action tiles, and tenant detail modal.
 *
 * Route: /support | Role: superadmin, support_admin
 *
 * Data sources:
 *   - Tenants: GET /api/tenants                                (cross-tenant)
 *   - Activity: GET /api/audit/log?tenant_id=...               (per-tenant when one is selected, tenant-wide otherwise)
 *   - Impersonate: wired via navigate('/impersonate') -> ImpersonationPage
 *   - Bulk users:  wired via navigate('/bulk-users') -> BulkUserManagementPage
 *
 * NOTE: The Tickets tab currently has no backend — we render a clear
 * "not yet implemented" empty-state rather than mock data.
 */
import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Tenant, AuditEntry } from '@/lib/api';
import {
  Search, Building2, Users, Activity, Shield, Eye,
  AlertTriangle, Loader2, RefreshCw, MessageSquare,
  FileText, Settings, ArrowRight, ExternalLink, User,
} from 'lucide-react';

type ActionId = 'impersonate' | 'bulk' | 'audit' | 'systemAlerts' | 'dataGovernance' | 'featureFlags';

interface QuickAction {
  id: ActionId;
  icon: React.ReactNode;
  title: string;
  desc: string;
  to: string;
}

export function SupportConsolePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { activeTab, setActiveTab } = useTabState('search');
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [activities, setActivities] = useState<AuditEntry[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadTenants = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.tenants.list();
      setTenants(res.tenants);
      setFilteredTenants(res.tenants);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tenants';
      setError(message);
      toast.error('Failed to load tenants', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  // Activity feed — loads when a tenant is selected (per-tenant) or when the
  // Activity tab is opened with no selection (caller's own tenant).
  const loadActivity = useCallback(async (tenantId?: string) => {
    setActivityLoading(true);
    try {
      const res = await api.audit.log(tenantId);
      setActivities(res.entries.slice(0, 50));
    } catch (err) {
      toast.error('Failed to load activity', {
        message: err instanceof Error ? err.message : 'Could not load audit entries',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
      setActivities([]);
    } finally {
      setActivityLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  // Load activity when the activity tab becomes active (or when selection changes)
  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivity(selectedTenant?.id);
    }
  }, [activeTab, selectedTenant, loadActivity]);

  useEffect(() => {
    if (!searchQuery.trim()) {
      setFilteredTenants(tenants);
    } else {
      const q = searchQuery.toLowerCase();
      setFilteredTenants(tenants.filter(t =>
        t.name.toLowerCase().includes(q) || t.slug.toLowerCase().includes(q) || t.id.includes(q)
      ));
    }
  }, [searchQuery, tenants]);

  const tabs = [
    { id: 'search', label: 'Tenant Search', icon: <Search size={14} /> },
    { id: 'tickets', label: 'Tickets', icon: <MessageSquare size={14} /> },
    { id: 'activity', label: 'Activity', icon: <Activity size={14} /> },
    { id: 'quick-actions', label: 'Quick Actions', icon: <Settings size={14} /> },
  ];

  const quickActions: QuickAction[] = [
    { id: 'impersonate', icon: <Eye size={16} />, title: 'View as User', desc: 'Impersonate a user to see their view (15-minute session, fully audited)', to: '/impersonate' },
    { id: 'bulk', icon: <Users size={16} />, title: 'Bulk User Management', desc: 'Import users from CSV or run bulk actions', to: '/bulk-users' },
    { id: 'audit', icon: <FileText size={16} />, title: 'Audit Log', desc: 'View detailed audit trail for a tenant', to: '/audit' },
    { id: 'systemAlerts', icon: <AlertTriangle size={16} />, title: 'System Alerts', desc: 'Review active alerts and alert rules', to: '/system-alerts' },
    { id: 'dataGovernance', icon: <Shield size={16} />, title: 'Data Governance', desc: 'DSAR + retention controls', to: '/data-governance' },
    { id: 'featureFlags', icon: <Settings size={16} />, title: 'Feature Flags', desc: 'Toggle platform features per tenant', to: '/feature-flags' },
  ];

  const outcomeColor = (outcome: string) => outcome === 'success' ? 'text-emerald-400' : outcome === 'denied' ? 'text-red-400' : 'text-amber-400';
  const activityIcon = (layer: string) => {
    switch ((layer || '').toLowerCase()) {
      case 'auth': case 'session': return <User size={12} className="text-accent" />;
      case 'admin-tooling': case 'admin': return <Shield size={12} className="text-blue-400" />;
      case 'iam': case 'rbac': return <Users size={12} className="text-emerald-400" />;
      case 'config': case 'settings': return <Settings size={12} className="text-amber-400" />;
      default: return <Activity size={12} className="t-muted" />;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-accent animate-spin" />
      </div>
    );
  }

  if (error && tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 gap-3">
        <AlertTriangle className="w-8 h-8 text-red-400" />
        <p className="text-sm t-primary">{error}</p>
        <button
          onClick={loadTenants}
          className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
          <Shield className="w-5 h-5 text-accent" />
        </div>
        <div>
          <h1 className="text-lg font-semibold t-primary">Support Console</h1>
          <p className="text-xs t-muted">Cross-tenant support tools & activity monitoring</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-label">Total Tenants</p>
          <p className="text-xl font-bold t-primary">{tenants.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Active</p>
          <p className="text-xl font-bold t-primary">{tenants.filter(t => t.status === 'active').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Suspended</p>
          <p className="text-xl font-bold text-amber-400">{tenants.filter(t => t.status === 'suspended').length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Recent Events</p>
          <p className="text-xl font-bold t-primary">{activities.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="search" activeTab={activeTab}>
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              className="w-full pl-9 pr-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
              placeholder="Search by tenant name, slug, or ID..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>
          {filteredTenants.length === 0 ? (
            <Card className="p-6 text-center">
              <p className="text-sm t-muted">No tenants match &ldquo;{searchQuery}&rdquo;</p>
            </Card>
          ) : (
            <div className="space-y-2">
              {filteredTenants.map((t) => (
                <Card key={t.id} className="p-4 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer" onClick={() => setSelectedTenant(t)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <Building2 size={16} className="text-accent" />
                      <div>
                        <p className="text-sm font-medium t-primary">{t.name}</p>
                        <p className="text-caption t-muted">{t.slug} · {t.industry || 'general'} · {t.plan}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={t.status === 'active' ? 'success' : t.status === 'suspended' ? 'danger' : 'warning'}>{t.status}</Badge>
                      <ArrowRight size={14} className="t-muted" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      </TabPanel>

      <TabPanel id="tickets" activeTab={activeTab}>
        {/* TODO(support): Wire ticket list once the support ticketing backend lands.
            Expected endpoint: GET /api/v1/support/tickets (not yet implemented). */}
        <Card className="p-6 text-center space-y-2">
          <MessageSquare size={24} className="mx-auto t-muted" />
          <p className="text-sm font-medium t-primary">Support tickets — not yet implemented</p>
          <p className="text-xs t-muted">
            There is no backend endpoint for support tickets yet. Once <code className="font-mono text-caption">/api/v1/support/tickets</code> exists, this tab will list open/escalated tickets. For now, use the audit Activity tab for a live cross-tenant event stream.
          </p>
        </Card>
      </TabPanel>

      <TabPanel id="activity" activeTab={activeTab}>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs t-muted">
            {selectedTenant
              ? <>Showing activity for <span className="t-primary font-medium">{selectedTenant.name}</span></>
              : <>Showing recent activity across your tenant scope</>}
          </p>
          <div className="flex items-center gap-2">
            {selectedTenant && (
              <button
                onClick={() => setSelectedTenant(null)}
                className="text-caption t-muted hover:t-primary"
              >
                Clear filter
              </button>
            )}
            <button
              onClick={() => loadActivity(selectedTenant?.id)}
              className="flex items-center gap-1 text-caption t-muted hover:t-primary"
              disabled={activityLoading}
              aria-label="Refresh activity"
            >
              <RefreshCw size={12} className={activityLoading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>
        {activityLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : activities.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-sm t-muted">No recent activity.</p>
          </Card>
        ) : (
          <div className="space-y-1">
            {activities.map((a) => (
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors">
                <div className="w-6 h-6 rounded-full bg-[var(--bg-secondary)] flex items-center justify-center mt-0.5 flex-shrink-0">
                  {activityIcon(a.layer)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs t-primary">
                    <span className="font-medium">{a.action}</span>
                    {a.resource && <span className="t-muted"> · {a.resource}</span>}
                  </p>
                  <p className="text-caption t-muted">
                    <span className="font-mono">{a.layer}</span>
                    <span> · </span>
                    <span className={outcomeColor(a.outcome)}>{a.outcome}</span>
                    <span> · {new Date(a.createdAt).toLocaleString()}</span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel id="quick-actions" activeTab={activeTab}>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {quickActions.map((qa) => (
            <button
              key={qa.id}
              onClick={() => navigate(qa.to)}
              className="text-left card-glass p-4 rounded-2xl hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center text-accent flex-shrink-0">
                  {qa.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium t-primary">{qa.title}</p>
                  <p className="text-caption t-muted">{qa.desc}</p>
                </div>
                <ArrowRight size={14} className="t-muted flex-shrink-0 mt-1" />
              </div>
            </button>
          ))}
        </div>
      </TabPanel>

      {/* Tenant Detail Modal */}
      {selectedTenant && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setSelectedTenant(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-lg w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold t-primary">{selectedTenant.name}</h3>
              <button onClick={() => setSelectedTenant(null)} className="t-muted hover:t-primary" aria-label="Close">×</button>
            </div>
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="t-muted text-xs">ID:</span><p className="font-mono text-caption t-primary break-all">{selectedTenant.id}</p></div>
                <div><span className="t-muted text-xs">Slug:</span><p className="t-primary">{selectedTenant.slug}</p></div>
                <div><span className="t-muted text-xs">Industry:</span><p className="t-primary">{selectedTenant.industry || 'general'}</p></div>
                <div><span className="t-muted text-xs">Plan:</span><Badge variant="info">{selectedTenant.plan}</Badge></div>
                <div><span className="t-muted text-xs">Status:</span><Badge variant={selectedTenant.status === 'active' ? 'success' : 'warning'}>{selectedTenant.status}</Badge></div>
                <div><span className="t-muted text-xs">Region:</span><p className="t-primary">{selectedTenant.region}</p></div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                onClick={() => { setActiveTab('activity'); }}
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1"
              >
                <Activity size={12} /> View activity
              </button>
              <button
                onClick={() => navigate('/impersonate')}
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1"
              >
                <Eye size={12} /> Impersonate user
              </button>
              <button
                onClick={() => navigate('/audit')}
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1"
              >
                <ExternalLink size={12} /> Full audit log
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
