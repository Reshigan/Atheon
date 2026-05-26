/**
 * ADMIN-002: Support Console
 * Support admin console with tenant search, live activity timeline (from audit_log),
 * quick-action tiles, tenant detail modal, and a tenant-scoped Tickets tab
 * backed by the support_tickets / support_ticket_replies tables.
 *
 * Route: /support | Role: superadmin, support_admin
 *
 * Data sources:
 *   - Tenants:  GET /api/tenants                                (cross-tenant)
 *   - Activity: GET /api/audit/log?tenant_id=...                (per-tenant when one is selected, tenant-wide otherwise)
 *   - Tickets:  GET /api/v1/support/tickets, POST/PATCH/replies (admins see all, users see their own)
 *   - Impersonate: wired via navigate('/impersonate') -> ImpersonationPage
 *   - Bulk users:  wired via navigate('/bulk-users') -> BulkUserManagementPage
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { EmptyState, ErrorState, FormError } from '@/components/ui/state';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { HeroHeader } from '@/components/ui/hero-header';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { Tenant, AuditEntry, SupportTicket, SupportTicketReply } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import {
  Search, Building2, Users, Activity, Shield, Eye,
  AlertTriangle, Loader2, RefreshCw, MessageSquare,
  FileText, Settings, ArrowRight, ExternalLink, User,
  Plus, Send,
} from 'lucide-react';

type ActionId = 'impersonate' | 'bulk' | 'audit' | 'systemAlerts' | 'dataGovernance' | 'featureFlags';

interface QuickAction {
  id: ActionId;
  icon: React.ReactNode;
  title: string;
  desc: string;
  to: string;
}

const TICKET_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
const TICKET_CATEGORIES = ['general', 'bug', 'billing', 'feature_request', 'access', 'other'] as const;
const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const;

function ticketStatusVariant(status: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (status) {
    case 'resolved':
    case 'closed':
      return 'success';
    case 'waiting_customer':
      return 'warning';
    case 'in_progress':
      return 'info';
    case 'open':
    default:
      return 'danger';
  }
}

function ticketPriorityVariant(priority: string): 'success' | 'warning' | 'danger' | 'info' {
  switch (priority) {
    case 'urgent':
      return 'danger';
    case 'high':
      return 'warning';
    case 'low':
      return 'success';
    case 'normal':
    default:
      return 'info';
  }
}

function ticketStatusLabel(status: string): string {
  return status.replace(/_/g, ' ');
}

export function SupportConsolePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);
  const { activeTab, setActiveTab } = useTabState('search');
  const [loading, setLoading] = useState(true);
  const [activityLoading, setActivityLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [filteredTenants, setFilteredTenants] = useState<Tenant[]>([]);
  const [activities, setActivities] = useState<AuditEntry[]>([]);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketsLoading, setTicketsLoading] = useState(false);
  const [ticketsError, setTicketsError] = useState<string | null>(null);
  const [ticketStatusFilter, setTicketStatusFilter] = useState<string>('');
  const [createTicketOpen, setCreateTicketOpen] = useState(false);
  const [openTicketId, setOpenTicketId] = useState<string | null>(null);
  const [openTicketDetail, setOpenTicketDetail] = useState<{
    ticket: SupportTicket;
    replies: SupportTicketReply[];
  } | null>(null);
  const [ticketDetailLoading, setTicketDetailLoading] = useState(false);
  const [ticketDetailError, setTicketDetailError] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [replySubmitting, setReplySubmitting] = useState(false);

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

  const loadTickets = useCallback(async () => {
    setTicketsLoading(true);
    setTicketsError(null);
    try {
      const res = await api.support.list({
        limit: 50,
        status: ticketStatusFilter || undefined,
      });
      setTickets(res.tickets);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load tickets';
      setTicketsError(message);
    } finally {
      setTicketsLoading(false);
    }
  }, [ticketStatusFilter]);

  const loadTicketDetail = useCallback(async (id: string) => {
    setTicketDetailLoading(true);
    setTicketDetailError(null);
    try {
      const res = await api.support.get(id);
      setOpenTicketDetail({ ticket: res.ticket, replies: res.replies });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to load ticket';
      setTicketDetailError(message);
      setOpenTicketDetail(null);
    } finally {
      setTicketDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTenants();
  }, [loadTenants]);

  // Load activity when the activity tab becomes active (or when selection changes)
  useEffect(() => {
    if (activeTab === 'activity') {
      loadActivity(selectedTenant?.id);
    }
  }, [activeTab, selectedTenant, loadActivity]);

  // Load tickets when the tickets tab becomes active or the filter changes
  useEffect(() => {
    if (activeTab === 'tickets') {
      loadTickets();
    }
  }, [activeTab, loadTickets]);

  // Load the detail panel when a ticket is opened
  useEffect(() => {
    if (openTicketId) {
      loadTicketDetail(openTicketId);
    } else {
      setOpenTicketDetail(null);
      setTicketDetailError(null);
      setReplyDraft('');
    }
  }, [openTicketId, loadTicketDetail]);

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

  const openTicketCount = useMemo(
    () => tickets.filter((t) => t.status === 'open' || t.status === 'in_progress').length,
    [tickets],
  );

  const isPlatformAdmin =
    currentUser?.role === 'superadmin' || currentUser?.role === 'support_admin';

  const tabs = [
    { id: 'search', label: 'Tenant Search', icon: <Search size={14} /> },
    {
      id: 'tickets',
      label: 'Tickets',
      icon: <MessageSquare size={14} />,
      count: openTicketCount > 0 ? openTicketCount : undefined,
    },
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
          className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors active:scale-[0.97]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <HeroHeader
        icon={Shield}
        title="Support Console"
        subtitle="Cross-tenant support tools & activity monitoring"
        accent="sage"
      />

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
              aria-label="Search tenants by name, slug, or ID"
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
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <label htmlFor="ticket-status-filter" className="sr-only">Filter tickets by status</label>
              <select
                id="ticket-status-filter"
                value={ticketStatusFilter}
                onChange={(e) => setTicketStatusFilter(e.target.value)}
                className="px-2.5 py-1.5 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
              >
                <option value="">All statuses</option>
                {TICKET_STATUSES.map((s) => (
                  <option key={s} value={s}>{ticketStatusLabel(s)}</option>
                ))}
              </select>
              <button
                onClick={loadTickets}
                disabled={ticketsLoading}
                className="flex items-center gap-1 text-caption t-muted hover:t-primary"
                aria-label="Refresh tickets"
              >
                <RefreshCw size={12} className={ticketsLoading ? 'animate-spin' : ''} /> Refresh
              </button>
            </div>
            <Button size="sm" onClick={() => setCreateTicketOpen(true)}>
              <Plus size={12} /> New ticket
            </Button>
          </div>

          {ticketsError && tickets.length === 0 ? (
            <ErrorState error={ticketsError} onRetry={loadTickets} />
          ) : ticketsLoading && tickets.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-5 h-5 text-accent animate-spin" />
            </div>
          ) : tickets.length === 0 ? (
            <EmptyState
              icon={MessageSquare}
              title={ticketStatusFilter ? `No ${ticketStatusLabel(ticketStatusFilter)} tickets` : 'No tickets yet'}
              description={
                isPlatformAdmin
                  ? 'Tickets filed by tenant users will appear here.'
                  : 'Open a ticket and our support team will respond within one business day.'
              }
              action={{ label: 'Open a ticket', onClick: () => setCreateTicketOpen(true) }}
            />
          ) : (
            <div className="space-y-2">
              {tickets.map((t) => (
                <Card
                  key={t.id}
                  className="p-4 hover:bg-[var(--bg-secondary)] transition-colors cursor-pointer"
                  onClick={() => setOpenTicketId(t.id)}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium t-primary truncate">{t.subject}</p>
                      <p className="text-caption t-muted truncate">
                        <span className="font-mono">#{t.id.slice(0, 8)}</span>
                        <span> · {t.category}</span>
                        <span> · {new Date(t.updated_at).toLocaleString()}</span>
                      </p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <Badge variant={ticketPriorityVariant(t.priority)}>{t.priority}</Badge>
                      <Badge variant={ticketStatusVariant(t.status)}>{ticketStatusLabel(t.status)}</Badge>
                      <ArrowRight size={14} className="t-muted" />
                    </div>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
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
              <div key={a.id} className="flex items-start gap-3 p-3 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors active:scale-[0.97]">
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
              className="text-left card-glass p-4 rounded-2xl hover:bg-[var(--bg-secondary)] transition-colors active:scale-[0.97]"
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
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1 active:scale-[0.97]"
              >
                <Activity size={12} /> View activity
              </button>
              <button
                onClick={() => navigate('/impersonate')}
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1 active:scale-[0.97]"
              >
                <Eye size={12} /> Impersonate user
              </button>
              <button
                onClick={() => navigate('/audit')}
                className="px-3 py-1.5 rounded-lg bg-accent/10 text-accent text-xs hover:bg-accent/20 transition-colors flex items-center gap-1 active:scale-[0.97]"
              >
                <ExternalLink size={12} /> Full audit log
              </button>
            </div>
          </div>
        </div>
      )}

      <CreateTicketModal
        open={createTicketOpen}
        onClose={() => setCreateTicketOpen(false)}
        onCreated={(ticket) => {
          setCreateTicketOpen(false);
          toast.success('Ticket opened', { message: `#${ticket.id.slice(0, 8)} — we'll respond shortly.` });
          loadTickets();
          setOpenTicketId(ticket.id);
        }}
      />

      <TicketDetailModal
        open={openTicketId !== null}
        loading={ticketDetailLoading}
        error={ticketDetailError}
        detail={openTicketDetail}
        replyDraft={replyDraft}
        replySubmitting={replySubmitting}
        isPlatformAdmin={isPlatformAdmin}
        currentUserId={currentUser?.id}
        onClose={() => setOpenTicketId(null)}
        onReplyChange={setReplyDraft}
        onRetry={() => openTicketId && loadTicketDetail(openTicketId)}
        onSubmitReply={async () => {
          if (!openTicketId || !replyDraft.trim()) return;
          setReplySubmitting(true);
          try {
            await api.support.addReply(openTicketId, replyDraft.trim());
            setReplyDraft('');
            await loadTicketDetail(openTicketId);
            loadTickets();
          } catch (err) {
            toast.error('Failed to send reply', {
              message: err instanceof Error ? err.message : 'Could not post reply',
              requestId: err instanceof ApiError ? err.requestId : null,
            });
          } finally {
            setReplySubmitting(false);
          }
        }}
        onStatusChange={async (status) => {
          if (!openTicketId) return;
          try {
            await api.support.update(openTicketId, { status });
            await loadTicketDetail(openTicketId);
            loadTickets();
          } catch (err) {
            toast.error('Failed to update status', {
              message: err instanceof Error ? err.message : 'Could not update ticket',
              requestId: err instanceof ApiError ? err.requestId : null,
            });
          }
        }}
        onPriorityChange={async (priority) => {
          if (!openTicketId) return;
          try {
            await api.support.update(openTicketId, { priority });
            await loadTicketDetail(openTicketId);
            loadTickets();
          } catch (err) {
            toast.error('Failed to update priority', {
              message: err instanceof Error ? err.message : 'Could not update ticket',
              requestId: err instanceof ApiError ? err.requestId : null,
            });
          }
        }}
      />
    </div>
  );
}

// ─── Create-ticket modal ────────────────────────────────────────────────
interface CreateTicketModalProps {
  open: boolean;
  onClose: () => void;
  onCreated: (ticket: SupportTicket) => void;
}

function CreateTicketModal({ open, onClose, onCreated }: CreateTicketModalProps) {
  const toast = useToast();
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<string>('general');
  const [priority, setPriority] = useState<string>('normal');
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setSubject('');
      setBody('');
      setCategory('general');
      setPriority('normal');
      setSubmitting(false);
      setFormError(null);
    }
  }, [open]);

  const submit = async () => {
    setFormError(null);
    const s = subject.trim();
    const b = body.trim();
    if (!s) { setFormError('Subject is required'); return; }
    if (!b) { setFormError('Body is required'); return; }

    setSubmitting(true);
    try {
      const res = await api.support.create({ subject: s, body: b, category, priority });
      onCreated(res.ticket);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to create ticket';
      setFormError(message);
      toast.error('Failed to create ticket', {
        message,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} size="lg" dismissible={!submitting}>
      <Modal.Header
        title="Open a support ticket"
        description="Describe the issue. Our team will reply on this thread."
        onClose={!submitting ? onClose : undefined}
      />
      <Modal.Body className="space-y-3">
        <div>
          <label htmlFor="ticket-subject" className="text-xs font-medium t-muted block mb-1">Subject</label>
          <input
            id="ticket-subject"
            type="text"
            maxLength={200}
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            disabled={submitting}
            placeholder="One-line summary"
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="ticket-category" className="text-xs font-medium t-muted block mb-1">Category</label>
            <select
              id="ticket-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
            >
              {TICKET_CATEGORIES.map((c) => (
                <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="ticket-priority" className="text-xs font-medium t-muted block mb-1">Priority</label>
            <select
              id="ticket-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              disabled={submitting}
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
            >
              {TICKET_PRIORITIES.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="ticket-body" className="text-xs font-medium t-muted block mb-1">Description</label>
          <textarea
            id="ticket-body"
            rows={6}
            maxLength={10000}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            disabled={submitting}
            placeholder="What happened? Include steps, errors, and the impact."
            className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          />
        </div>
        <FormError error={formError} />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button onClick={submit} disabled={submitting || !subject.trim() || !body.trim()}>
          {submitting ? <><Loader2 size={12} className="animate-spin" /> Opening</> : <><Plus size={12} /> Open ticket</>}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

// ─── Ticket detail modal ───────────────────────────────────────────────
interface TicketDetailModalProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  detail: { ticket: SupportTicket; replies: SupportTicketReply[] } | null;
  replyDraft: string;
  replySubmitting: boolean;
  isPlatformAdmin: boolean;
  currentUserId: string | undefined;
  onClose: () => void;
  onReplyChange: (v: string) => void;
  onRetry: () => void;
  onSubmitReply: () => Promise<void>;
  onStatusChange: (status: string) => Promise<void>;
  onPriorityChange: (priority: string) => Promise<void>;
}

function TicketDetailModal({
  open, loading, error, detail,
  replyDraft, replySubmitting, isPlatformAdmin, currentUserId,
  onClose, onReplyChange, onRetry, onSubmitReply, onStatusChange, onPriorityChange,
}: TicketDetailModalProps) {
  const ticket = detail?.ticket;
  const replies = detail?.replies ?? [];
  const isClosed = ticket?.status === 'closed';

  return (
    <Modal open={open} onClose={onClose} size="lg" dismissible={!replySubmitting}>
      <Modal.Header
        title={ticket ? ticket.subject : 'Ticket'}
        description={ticket ? `#${ticket.id.slice(0, 8)} · opened ${new Date(ticket.created_at).toLocaleString()}` : undefined}
        onClose={!replySubmitting ? onClose : undefined}
      />
      <Modal.Body className="space-y-4">
        {loading && !detail ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-5 h-5 text-accent animate-spin" />
          </div>
        ) : error && !detail ? (
          <ErrorState error={error} onRetry={onRetry} />
        ) : ticket ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={ticketStatusVariant(ticket.status)}>{ticketStatusLabel(ticket.status)}</Badge>
              <Badge variant={ticketPriorityVariant(ticket.priority)}>{ticket.priority}</Badge>
              <Badge variant="info">{ticket.category}</Badge>
              {isPlatformAdmin && (
                <div className="ml-auto flex items-center gap-2">
                  <label htmlFor="ticket-status-set" className="sr-only">Set status</label>
                  <select
                    id="ticket-status-set"
                    value={ticket.status}
                    onChange={(e) => onStatusChange(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
                  >
                    {TICKET_STATUSES.map((s) => (
                      <option key={s} value={s}>{ticketStatusLabel(s)}</option>
                    ))}
                  </select>
                  <label htmlFor="ticket-priority-set" className="sr-only">Set priority</label>
                  <select
                    id="ticket-priority-set"
                    value={ticket.priority}
                    onChange={(e) => onPriorityChange(e.target.value)}
                    className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
                  >
                    {TICKET_PRIORITIES.map((p) => (
                      <option key={p} value={p}>{p}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            <Card className="p-3 space-y-1">
              <p className="text-caption t-muted">
                <span>Opened by </span>
                <span className="font-mono t-primary">{ticket.user_id === currentUserId ? 'you' : ticket.user_id.slice(0, 8)}</span>
              </p>
              <p className="text-sm t-primary whitespace-pre-wrap">{ticket.body}</p>
            </Card>

            {replies.length > 0 && (
              <div className="space-y-2">
                <p className="text-caption t-muted uppercase tracking-wider">Replies</p>
                {replies.map((r) => (
                  <Card key={r.id} className="p-3 space-y-1">
                    <p className="text-caption t-muted">
                      <span className="font-mono t-primary">
                        {r.user_id === currentUserId ? 'you' : r.user_id.slice(0, 8)}
                      </span>
                      <span> · {new Date(r.created_at).toLocaleString()}</span>
                    </p>
                    <p className="text-sm t-primary whitespace-pre-wrap">{r.body}</p>
                  </Card>
                ))}
              </div>
            )}

            {isClosed ? (
              <Card className="p-3 text-center">
                <p className="text-xs t-muted">This ticket is closed. Re-open it to add new replies.</p>
              </Card>
            ) : (
              <div>
                <label htmlFor="ticket-reply" className="text-xs font-medium t-muted block mb-1">Add a reply</label>
                <textarea
                  id="ticket-reply"
                  rows={3}
                  maxLength={10000}
                  value={replyDraft}
                  onChange={(e) => onReplyChange(e.target.value)}
                  disabled={replySubmitting}
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                />
                <div className="mt-2 flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => onSubmitReply()}
                    disabled={replySubmitting || !replyDraft.trim()}
                  >
                    {replySubmitting ? <><Loader2 size={12} className="animate-spin" /> Sending</> : <><Send size={12} /> Send reply</>}
                  </Button>
                </div>
              </div>
            )}
          </>
        ) : null}
      </Modal.Body>
    </Modal>
  );
}
