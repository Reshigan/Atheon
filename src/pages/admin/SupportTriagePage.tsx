/**
 * v48: Support Triage — admin-only ticket list.
 * Filter by status, peek into a ticket, bulk-assign to yourself, close tickets
 * in bulk. For deep replies use the regular ticket detail page which also
 * exposes admin PATCH fields via the API.
 * Route: /support-triage | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SupportTicket } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';
import { LifeBuoy, Filter, Loader2, CheckCircle, UserPlus } from 'lucide-react';

const STATUS_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  open: 'info',
  in_progress: 'warning',
  waiting_customer: 'warning',
  resolved: 'success',
  closed: 'default',
};

const PRIORITY_VARIANT: Record<string, 'default' | 'success' | 'warning' | 'danger' | 'info'> = {
  low: 'default',
  normal: 'info',
  high: 'warning',
  urgent: 'danger',
};

const STATUS_FILTERS = ['all', 'open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;
type StatusFilter = typeof STATUS_FILTERS[number];

const ASSIGNABLE_STATUSES = ['open', 'in_progress', 'waiting_customer', 'resolved', 'closed'] as const;

export function SupportTriagePage() {
  const toast = useToast();
  const currentUser = useAppStore((s) => s.user);

  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [busyId, setBusyId] = useState<string | null>(null);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.support.list({
        limit: 100,
        status: statusFilter === 'all' ? undefined : statusFilter,
      });
      setTickets(res.tickets);
    } catch (err) {
      showError('Failed to load tickets', err, 'Network error');
    }
  }, [statusFilter, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await api.support.list({
          limit: 100,
          status: statusFilter === 'all' ? undefined : statusFilter,
        });
        if (!cancelled) setTickets(res.tickets);
      } catch (err) {
        if (!cancelled) showError('Failed to load tickets', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [statusFilter, showError]);

  const handleAssignSelf = async (t: SupportTicket) => {
    if (!currentUser) return;
    setBusyId(t.id);
    try {
      await api.support.update(t.id, {
        assignee_user_id: currentUser.id,
        status: t.status === 'open' ? 'in_progress' : t.status,
      });
      toast.success('Assigned to you');
      await reload();
    } catch (err) {
      showError('Could not assign', err, 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const handleStatus = async (t: SupportTicket, status: string) => {
    setBusyId(t.id);
    try {
      await api.support.update(t.id, { status });
      toast.success(`Status set to ${status.replace('_', ' ')}`);
      await reload();
    } catch (err) {
      showError('Could not update status', err, 'Please try again.');
    } finally {
      setBusyId(null);
    }
  };

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: tickets.length };
    for (const t of tickets) {
      c[t.status] = (c[t.status] ?? 0) + 1;
    }
    return c;
  }, [tickets]);

  return (
    <div className="p-5 max-w-6xl mx-auto space-y-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center"
               style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}>
            <LifeBuoy size={20} />
          </div>
          <div>
            <h1 className="text-xl font-semibold t-primary">Support Triage</h1>
            <p className="text-xs t-muted mt-0.5">
              All tickets for this tenant. Assign, change status, and reply via detail view.
            </p>
          </div>
        </div>
      </header>

      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <Filter size={14} className="t-muted" />
          <span className="text-xs t-muted">Status:</span>
          {STATUS_FILTERS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-2.5 py-1 rounded-md text-xs transition-all ${
                statusFilter === s
                  ? 'font-medium'
                  : 't-secondary hover:bg-[var(--bg-secondary)]'
              }`}
              style={statusFilter === s ? { background: 'var(--accent-subtle)', color: 'var(--accent)' } : undefined}
              data-testid={`support-triage-filter-${s}`}
            >
              {s.replace('_', ' ')}
              {s === statusFilter && counts[s] !== undefined && (
                <span className="ml-1 opacity-70">({counts[s]})</span>
              )}
            </button>
          ))}
        </div>
      </Card>

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-10 t-muted text-sm gap-2">
            <Loader2 size={16} className="animate-spin" />
            Loading tickets…
          </div>
        </Card>
      ) : tickets.length === 0 ? (
        <Card>
          <div className="text-center py-10">
            <LifeBuoy size={28} className="mx-auto t-muted mb-3" />
            <p className="text-sm t-secondary">No tickets match this filter.</p>
          </div>
        </Card>
      ) : (
        <div className="space-y-2" data-testid="support-triage-list">
          {tickets.map((t) => {
            const isAssignedToMe = !!currentUser && t.assignee_user_id === currentUser.id;
            return (
              <Card key={t.id} data-testid="support-triage-row">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Link
                        to={`/support-tickets/${t.id}`}
                        className="text-sm font-semibold t-primary hover:underline truncate"
                      >
                        {t.subject}
                      </Link>
                      <Badge variant={STATUS_VARIANT[t.status] ?? 'default'}>{t.status.replace('_', ' ')}</Badge>
                      <Badge variant={PRIORITY_VARIANT[t.priority] ?? 'default'}>{t.priority}</Badge>
                      <Badge variant="default">{t.category.replace('_', ' ')}</Badge>
                      {isAssignedToMe && <Badge variant="success">assigned to you</Badge>}
                    </div>
                    <p className="text-xs t-muted mt-1 line-clamp-2">{t.body}</p>
                    <div className="text-caption t-muted mt-1">
                      Opened {new Date(t.created_at).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 min-w-[140px] items-end">
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={!currentUser || busyId === t.id || isAssignedToMe}
                      onClick={() => handleAssignSelf(t)}
                      data-testid={`support-triage-assign-${t.id}`}
                    >
                      {busyId === t.id ? <Loader2 size={12} className="animate-spin" /> : <UserPlus size={12} />}
                      {isAssignedToMe ? 'Mine' : 'Assign me'}
                    </Button>
                    <select
                      value={t.status}
                      disabled={busyId === t.id}
                      onChange={(e) => handleStatus(t, e.target.value)}
                      className="text-xs rounded-md px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]"
                      style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
                      data-testid={`support-triage-status-${t.id}`}
                    >
                      {ASSIGNABLE_STATUSES.map((s) => (
                        <option key={s} value={s}>{s.replace('_', ' ')}</option>
                      ))}
                    </select>
                    {t.status === 'resolved' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busyId === t.id}
                        onClick={() => handleStatus(t, 'closed')}
                      >
                        <CheckCircle size={12} />
                        Close
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
