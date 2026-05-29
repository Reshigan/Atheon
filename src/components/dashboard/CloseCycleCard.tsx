import { useCallback, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { CalendarCheck, CheckCircle2, Clock, AlertOctagon, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type CloseResp = Awaited<ReturnType<typeof api.dashboard.closeCycle>>;
type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked';

const STATUS_META: Record<TaskStatus, { label: string; icon: typeof CheckCircle2; tone: string; toneStyle?: CSSProperties }> = {
  completed:   { label: 'Done',         icon: CheckCircle2, tone: 'text-accent' },
  in_progress: { label: 'In progress',  icon: Clock,        tone: '' , toneStyle: { color: 'var(--info)' } },
  pending:     { label: 'Pending',      icon: Clock,        tone: 't-muted' },
  blocked:     { label: 'Blocked',      icon: AlertOctagon, tone: '', toneStyle: { color: 'var(--neg)' } },
};

export function CloseCycleCard() {
  const companyId = useAppStore((s) => s.selectedCompanyId);
  const role = useAppStore((s) => s.user?.role);
  const isAdminPlus = role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'executive';

  const [data, setData] = useState<CloseResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.dashboard.closeCycle(companyId || undefined);
      setData(resp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load close cycle');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const onToggle = useCallback(async (id: string, next: TaskStatus) => {
    if (!isAdminPlus) return;
    setBusyId(id);
    try {
      await api.dashboard.updateCloseTask(id, next);
      await load();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to update task');
    } finally {
      setBusyId(null);
    }
  }, [isAdminPlus, load]);

  const sortedTasks = useMemo(() => {
    if (!data?.tasks) return [];
    const order: Record<TaskStatus, number> = { blocked: 0, in_progress: 1, pending: 2, completed: 3 };
    return [...data.tasks].sort((a, b) => {
      if (a.blocking !== b.blocking) return a.blocking ? -1 : 1;
      const ao = order[a.status as TaskStatus] ?? 99;
      const bo = order[b.status as TaskStatus] ?? 99;
      if (ao !== bo) return ao - bo;
      return (a.dueDate || '').localeCompare(b.dueDate || '');
    });
  }, [data?.tasks]);

  if (loading) return <Card><LoadingState label="Loading close cycle..." /></Card>;
  if (error) return <Card><ErrorState error={error} onRetry={load} compact /></Card>;
  if (!data || !data.cycle || !data.summary) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <CalendarCheck size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Period Close</h3>
        </div>
        <EmptyState title="No close cycle in progress" description="The next month-end will appear here once started." />
      </Card>
    );
  }

  const { cycle, summary } = data;
  const daysLabel = summary.daysRemaining > 0
    ? `${summary.daysRemaining} day${summary.daysRemaining === 1 ? '' : 's'} remaining`
    : summary.daysRemaining === 0 ? 'Closes today' : `${Math.abs(summary.daysRemaining)} day${Math.abs(summary.daysRemaining) === 1 ? '' : 's'} overdue`;
  const progressTone: 'emerald' | 'blue' | 'amber' | 'red' = summary.progressPct >= 80
    ? 'emerald'
    : summary.progressPct >= 50 ? 'blue'
    : summary.blockingCount > 0 ? 'amber'
    : 'blue';
  const onSchedulePill = summary.onSchedule && summary.daysRemaining >= 0
    ? <StatusPill status="completed" label="On schedule" />
    : summary.daysRemaining < 0
      ? <StatusPill status="failed" label="Overdue" />
      : <StatusPill status="amber" label="At risk" />;

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-1.5">
            <CalendarCheck size={14} className="text-accent" />
            <h3 className="text-sm font-semibold t-primary">Period Close</h3>
            <span className="text-caption t-muted ml-1">· {cycle.periodLabel}</span>
          </div>
          <p className="text-caption t-muted mt-0.5">Target {cycle.targetCloseDate} — {daysLabel}</p>
        </div>
        <button
          onClick={load}
          className="w-7 h-7 rounded-md flex items-center justify-center t-muted hover:t-primary transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          style={{ background: 'var(--bg-secondary)' }}
          aria-label="Refresh close cycle"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <SummaryTile label="Tasks complete" value={`${cycle.completedTasks} / ${cycle.totalTasks}`} icon={<CheckCircle2 size={14} className="text-accent" />} />
        <SummaryTile label="Blocking" value={String(summary.blockingCount)} icon={<AlertOctagon size={14} className={summary.blockingCount > 0 ? '' : 't-muted'} style={summary.blockingCount > 0 ? { color: 'var(--neg)' } : undefined} />} tone={summary.blockingCount > 0 ? 'red' : 'neutral'} />
        <SummaryTile label="Status" value={daysLabel} icon={<Clock size={14} style={{ color: 'var(--info)' }} />} stretchValue trailing={onSchedulePill} />
      </div>

      <div className="mb-3">
        <div className="flex items-center justify-between mb-1">
          <span className="text-caption font-medium t-muted uppercase tracking-wider">Progress</span>
          <span className="text-caption t-secondary tabular-nums font-mono">{summary.progressPct.toFixed(0)}%</span>
        </div>
        <Progress value={summary.progressPct} max={100} size="md" color={progressTone} />
      </div>

      {cycle.notes && (
        <p className="text-caption t-secondary mb-3 italic">{cycle.notes}</p>
      )}

      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-caption t-muted hover:t-primary mb-2 transition-[color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
      >
        {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        {expanded ? 'Hide task list' : `Show task list (${sortedTasks.length})`}
      </button>

      {expanded && (
        <ul className="space-y-1.5">
          {sortedTasks.map((t) => {
            const meta = STATUS_META[t.status as TaskStatus] || STATUS_META.pending;
            const Icon = meta.icon;
            const nextStatus: TaskStatus = t.status === 'completed' ? 'in_progress' : 'completed';
            return (
              <li
                key={t.id}
                className="flex items-center gap-2 p-2 rounded-md transition-[background-color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] hover:bg-[var(--bg-secondary)]"
              >
                <button
                  onClick={() => onToggle(t.id, nextStatus)}
                  disabled={!isAdminPlus || busyId === t.id}
                  className="flex-shrink-0 disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.95] transition-transform duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
                  aria-label={`Toggle ${t.taskName} to ${nextStatus}`}
                >
                  <Icon size={14} className={meta.tone} style={meta.toneStyle} />
                </button>
                <div className="flex-1 min-w-0">
                  <p className={`text-caption font-medium ${t.status === 'completed' ? 't-muted line-through' : 't-primary'}`}>
                    {t.taskName}
                  </p>
                  <p className="text-caption t-muted">
                    {t.owner || 'Unassigned'}{t.dueDate ? ` · due ${t.dueDate}` : ''}
                  </p>
                </div>
                {t.blocking && t.status !== 'completed' && <StatusPill status="failed" label="Blocking" />}
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

function SummaryTile({ label, value, icon, tone = 'neutral', stretchValue = false, trailing }: {
  label: string; value: string; icon: ReactNode;
  tone?: 'neutral' | 'red'; stretchValue?: boolean; trailing?: ReactNode;
}) {
  return (
    <div
      className="p-2.5 rounded-md border"
      style={{
        background: tone === 'red' ? 'rgb(var(--neg-rgb) / 0.06)' : 'var(--bg-card-solid)',
        borderColor: tone === 'red' ? 'rgb(var(--neg-rgb) / 0.30)' : 'var(--border-card)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-caption font-medium t-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className={`font-bold t-primary tabular-nums font-mono ${stretchValue ? 'text-caption' : 'text-body-md'}`}>{value}</div>
      {trailing && <div className="mt-1">{trailing}</div>}
    </div>
  );
}
