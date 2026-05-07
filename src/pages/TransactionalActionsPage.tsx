/**
 * TransactionalActionsPage — operator surface for the action-layer queue.
 *
 * Phases 10-30 (queue) + 10-48 (retry/backoff/dead-letter) + 10-49
 * (this admin surface).
 *
 *   - Lists rows from `transactional_actions` with status filter
 *   - Default filter shows dead_letter + failed (the rows ops actually
 *     needs to act on)
 *   - Per-row actions: Revive (dead_letter only), Approve (pending),
 *     Skip (pending/approved)
 *   - Summary chips at the top (count + value per status)
 *
 * Why a separate page from /catalysts: the older catalyst_actions
 * table is the legacy approve/reject queue tracked on the dashboard;
 * transactional_actions is the action-layer dispatch queue (AP/AR/GL
 * automation) that needs the dead_letter recovery UX.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Workflow, RotateCcw, Check, X as XIcon, Loader2, AlertTriangle, AlertOctagon,
  Clock, CheckCircle, XCircle, RefreshCw, Search,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";

type Status = 'pending' | 'approved' | 'posted' | 'failed' | 'dead_letter' | 'skipped';

interface Action {
  id: string;
  erp_connection_id: string | null;
  sub_catalyst_name: string;
  action_type: string;
  target_entity: string;
  source_record_ref: string | null;
  status: Status;
  external_doc_id: string | null;
  posted_at: string | null;
  error: string | null;
  retry_count: number;
  next_retry_at: string | null;
  dead_letter_at: string | null;
  posted_value: number | null;
  currency: string;
  created_at: string;
  updated_at: string;
}

const STATUS_META: Record<Status, { label: string; variant: 'success' | 'warning' | 'danger' | 'info' | 'outline'; icon: typeof CheckCircle }> = {
  pending:     { label: 'Pending',     variant: 'warning', icon: Clock },
  approved:    { label: 'Approved',    variant: 'info',    icon: Check },
  posted:      { label: 'Posted',      variant: 'success', icon: CheckCircle },
  failed:      { label: 'Failed',      variant: 'danger',  icon: AlertTriangle },
  dead_letter: { label: 'Dead letter', variant: 'danger',  icon: AlertOctagon },
  skipped:     { label: 'Skipped',     variant: 'outline', icon: XCircle },
};

const ALL_STATUSES: Status[] = ['dead_letter', 'failed', 'pending', 'approved', 'posted', 'skipped'];

export function TransactionalActionsPage() {
  const toast = useToast();
  const [actions, setActions] = useState<Action[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Default to "rows that need attention" — dead_letter first, then failed
  const [statusFilter, setStatusFilter] = useState<Status | 'all' | 'attention'>('attention');
  const [search, setSearch] = useState('');
  const [summary, setSummary] = useState<Record<Status, { count: number; total_value: number }> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // 'attention' uses two requests in parallel; otherwise filter server-side
      if (statusFilter === 'attention') {
        const [dead, failed, sum] = await Promise.all([
          api.erp.transactionalActions({ status: 'dead_letter', limit: 200 }),
          api.erp.transactionalActions({ status: 'failed', limit: 200 }),
          api.erp.transactionalActionsSummary(),
        ]);
        setActions([...dead.actions, ...failed.actions]);
        setSummary(sum.summary);
      } else {
        const [list, sum] = await Promise.all([
          api.erp.transactionalActions(statusFilter === 'all' ? { limit: 500 } : { status: statusFilter, limit: 500 }),
          api.erp.transactionalActionsSummary(),
        ]);
        setActions(list.actions as Action[]);
        setSummary(sum.summary);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const lc = search.toLowerCase().trim();
    if (!lc) return actions;
    return actions.filter((a) =>
      a.target_entity.toLowerCase().includes(lc)
      || a.source_record_ref?.toLowerCase().includes(lc)
      || a.sub_catalyst_name.toLowerCase().includes(lc)
      || a.action_type.toLowerCase().includes(lc)
      || (a.error?.toLowerCase().includes(lc) ?? false),
    );
  }, [actions, search]);

  const handleRevive = async (id: string) => {
    setBusyId(id);
    try {
      await api.erp.reviveTransactionalAction(id);
      toast.success('Action revived', 'It will be picked up by the next dispatch sweep.');
      await load();
    } catch (err) {
      toast.error('Revive failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const handleApprove = async (id: string) => {
    setBusyId(id);
    try {
      await api.erp.approveTransactionalAction(id);
      toast.success('Approved');
      await load();
    } catch (err) {
      toast.error('Approve failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  const handleSkip = async (id: string) => {
    const reason = window.prompt('Reason for skipping this action?');
    if (!reason) return;
    setBusyId(id);
    try {
      await api.erp.skipTransactionalAction(id, reason);
      toast.success('Skipped');
      await load();
    } catch (err) {
      toast.error('Skip failed', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: 'var(--accent-subtle)' }}>
            <Workflow className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Action Layer</h1>
            <p className="text-sm t-muted">
              AP/AR/GL transactional dispatch queue. Revive dead-lettered rows after fixing the underlying cause.
            </p>
          </div>
        </div>
        <Button variant="outline" size="md" onClick={load} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {/* Summary chips */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
          {ALL_STATUSES.map((s) => {
            const meta = STATUS_META[s];
            const Icon = meta.icon;
            const data = summary[s];
            return (
              <Card key={s} hover className="cursor-pointer" onClick={() => setStatusFilter(s)}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Icon size={14} className="flex-shrink-0 t-muted" />
                    <div className="min-w-0">
                      <div className="text-[10px] uppercase tracking-wide t-muted truncate">{meta.label}</div>
                      <div className="text-lg font-bold t-primary">{data.count}</div>
                    </div>
                  </div>
                  {data.total_value > 0 && (
                    <div className="text-[10px] t-muted text-right">
                      ${data.total_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Filter bar */}
      <Card>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1 flex-wrap">
            <FilterChip label="Needs attention" active={statusFilter === 'attention'} onClick={() => setStatusFilter('attention')} />
            <FilterChip label="All" active={statusFilter === 'all'} onClick={() => setStatusFilter('all')} />
            {ALL_STATUSES.map((s) => (
              <FilterChip
                key={s}
                label={STATUS_META[s].label}
                active={statusFilter === s}
                onClick={() => setStatusFilter(s)}
              />
            ))}
          </div>
          <div className="ml-auto relative">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 t-muted pointer-events-none" />
            <input
              type="text"
              placeholder="Search entity / ref / error…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-7 pr-2 py-1 rounded-md text-xs"
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-card)',
                width: 240,
              }}
            />
          </div>
        </div>
      </Card>

      {error && (
        <Card variant="outline" className="border-red-500/30">
          <p className="text-sm text-red-400 flex items-center gap-2">
            <AlertTriangle size={14} /> {error}
          </p>
        </Card>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-10 t-muted">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading actions…
          </div>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <div className="text-center py-10 space-y-2">
            <Workflow className="w-10 h-10 t-muted mx-auto" />
            <h3 className="text-sm font-semibold t-primary">
              {statusFilter === 'attention' ? 'Nothing needs attention' : 'No actions match'}
            </h3>
            <p className="text-xs t-muted max-w-md mx-auto">
              {statusFilter === 'attention'
                ? 'No dead-lettered or failed actions in the queue. The action layer is healthy.'
                : 'Try a different status filter or clear your search term.'}
            </p>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {filtered.map((a) => (
            <ActionRow
              key={a.id}
              action={a}
              busy={busyId === a.id}
              onRevive={() => handleRevive(a.id)}
              onApprove={() => handleApprove(a.id)}
              onSkip={() => handleSkip(a.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Filter chip ─────────────────────────────────────────────────────
function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="px-3 py-1 rounded-full text-xs font-medium transition-colors"
      style={{
        background: active ? 'var(--accent-subtle)' : 'transparent',
        color: active ? 'var(--color-accent)' : 'var(--text-muted)',
        border: `1px solid ${active ? 'var(--color-accent)' : 'var(--border-card)'}`,
      }}
    >
      {label}
    </button>
  );
}

// ─── Action row ──────────────────────────────────────────────────────
function ActionRow({
  action: a, busy, onRevive, onApprove, onSkip,
}: {
  action: Action;
  busy: boolean;
  onRevive: () => void;
  onApprove: () => void;
  onSkip: () => void;
}) {
  const meta = STATUS_META[a.status];
  const SIcon = meta.icon;

  return (
    <Card>
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant={meta.variant} size="sm">
              <SIcon size={10} className="mr-1" /> {meta.label}
            </Badge>
            <code className="text-sm font-mono t-primary">{a.target_entity}</code>
            <span className="text-xs t-muted">·</span>
            <span className="text-xs t-secondary">{a.action_type}</span>
            <span className="text-xs t-muted">·</span>
            <span className="text-xs t-secondary">{a.sub_catalyst_name}</span>
            {a.posted_value !== null && (
              <Badge variant="outline" size="sm">
                {a.currency} {a.posted_value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </Badge>
            )}
            {a.retry_count > 0 && (
              <Badge variant="outline" size="sm">retries: {a.retry_count}</Badge>
            )}
          </div>
          {a.source_record_ref && (
            <p className="text-[11px] t-muted">
              Source ref: <code className="font-mono">{a.source_record_ref}</code>
              {a.external_doc_id && (
                <> → ERP doc <code className="font-mono text-accent">{a.external_doc_id}</code></>
              )}
            </p>
          )}
          {a.error && (
            <p className="text-[11px] text-red-400/90 truncate" title={a.error}>
              <AlertTriangle size={10} className="inline mr-1 -mt-0.5" />
              {a.error}
            </p>
          )}
          {a.next_retry_at && a.status === 'failed' && (
            <p className="text-[10px] t-muted">
              Next retry at {new Date(a.next_retry_at).toLocaleString()}
            </p>
          )}
          {a.dead_letter_at && (
            <p className="text-[10px] t-muted">
              Dead-lettered {new Date(a.dead_letter_at).toLocaleString()} after {a.retry_count} retries
            </p>
          )}
          <p className="text-[10px] t-muted">
            Updated {new Date(a.updated_at).toLocaleString()}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {a.status === 'dead_letter' && (
            <Button variant="primary" size="sm" onClick={onRevive} disabled={busy}>
              {busy ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Revive
            </Button>
          )}
          {a.status === 'pending' && (
            <Button variant="primary" size="sm" onClick={onApprove} disabled={busy}>
              <Check size={12} /> Approve
            </Button>
          )}
          {(a.status === 'pending' || a.status === 'approved') && (
            <Button variant="outline" size="sm" onClick={onSkip} disabled={busy}>
              <XIcon size={12} /> Skip
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

export default TransactionalActionsPage;
