/**
 * Action Layer — Operator Queue (Phase S).
 *
 * Lifts the Stitch "Action Layer — Dispatch Queue" screen 1:1:
 *
 *   ┌─ HeroHeader: Operator Queue
 *   │
 *   ├─ 5 status tiles — Pending · Previewed · Completed · Failed · Rejected
 *   │  Each tile: count (large mono), total ZAR value (small mono), hover tint
 *   │
 *   ├─ Status filter chips + "Clear filter"
 *   │
 *   └─ Actions table: id · type · catalyst · value · status pill · review
 *
 * Wire-up: api.erp.actionsSummary() + api.erp.listAllActions({status?}).
 * Approve / Reject route through api.erp.approveAction / rejectAction —
 * each row gets a small inline button-pair on the right when status is
 * `pending` or `previewed`.
 *
 * Role-gated to PLATFORM_ADMIN_ROLES; backend mirrors this.
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState, ErrorState } from '@/components/ui/state';
import { HeroHeader } from '@/components/ui/hero-header';
import { StatusPill } from '@/components/ui/status-pill';
import { Numeric } from '@/components/ui/numeric';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import {
  Inbox, CheckCircle2, XCircle, AlertOctagon, FileSearch, RefreshCw, Check, X as XIcon,
  Bookmark, BookmarkPlus, Trash2, Link2,
} from 'lucide-react';
import { SortHeader, cycleSort, type SortSpec } from '@/components/ui/sort-header';
import { ActionEvidenceDrawer } from '@/components/action/ActionEvidenceDrawer';
import { MetricSource, type MetricProvenance } from '@/components/ui/metric-source';

interface ActionItem {
  id: string;
  catalyst_name: string;
  action_type: string;
  status: string;
  value_zar: number;
  source_finding_id?: string | null;
  connection_id?: string | null;
  idempotency_key?: string | null;
  output?: unknown;
  reasoning?: string | null;
  approved_by?: string | null;
  created_at: string;
  completed_at?: string | null;
}

interface SummaryShape {
  pending_approval_count: number; pending_approval_value_zar: number;
  completed_count: number; completed_value_zar: number;
  rejected_count: number; rejected_value_zar: number;
  failed_count: number; failed_value_zar: number;
  previewed_count: number; previewed_value_zar: number;
  total_count: number; total_value_zar: number;
}

type StatusFilter = 'all' | 'pending_approval' | 'previewed' | 'completed' | 'failed' | 'rejected';

// SAP-grade sortable columns. `null` means unsorted (server order).
type SortKey = 'status' | 'ref' | 'type' | 'catalyst' | 'value' | 'created';

// User-saved view: a named (filter, sort) pair persisted to localStorage so
// operators can flip between routines like "My open high-value" or
// "Today's rejections" without rebuilding the filter each session.
interface SavedView {
  id: string;
  label: string;
  filter: StatusFilter;
  sort: SortSpec<SortKey> | null;
}

const SAVED_VIEWS_KEY = 'atheon:operator-queue:saved-views:v1';
function loadSavedViews(): SavedView[] {
  try {
    const raw = localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is SavedView =>
      v && typeof v.id === 'string' && typeof v.label === 'string' && typeof v.filter === 'string',
    );
  } catch {
    return [];
  }
}
function persistSavedViews(views: SavedView[]) {
  try {
    localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views));
  } catch {
    // localStorage may be unavailable (private browsing) — silently no-op
  }
}

const TILE_DEFS: Array<{
  key: Exclude<StatusFilter, 'all'>;
  label: string;
  countKey: keyof SummaryShape;
  valueKey: keyof SummaryShape;
  icon: typeof Inbox;
  accent: string;
  hoverBorder: string;
}> = [
  { key: 'pending_approval', label: 'Pending',   countKey: 'pending_approval_count', valueKey: 'pending_approval_value_zar', icon: Inbox,         accent: '#FBBF24', hoverBorder: 'hover:border-amber-500/40' },
  { key: 'previewed',        label: 'Previewed', countKey: 'previewed_count',         valueKey: 'previewed_value_zar',         icon: FileSearch,    accent: '#7EB3CD', hoverBorder: 'hover:border-sky-500/40' },
  { key: 'completed',        label: 'Completed', countKey: 'completed_count',         valueKey: 'completed_value_zar',         icon: CheckCircle2,  accent: '#34D399', hoverBorder: 'hover:border-emerald-500/40' },
  { key: 'failed',           label: 'Failed',    countKey: 'failed_count',            valueKey: 'failed_value_zar',            icon: XCircle,       accent: '#F87171', hoverBorder: 'hover:border-red-500/40' },
  { key: 'rejected',         label: 'Rejected',  countKey: 'rejected_count',          valueKey: 'rejected_value_zar',          icon: AlertOctagon,  accent: '#F97316', hoverBorder: 'hover:border-orange-500/40' },
];

// Plain-English definitions for each status. Surfaced by MetricSource on
// the tile so an operator can audit exactly what the count represents.
const TILE_DEFINITIONS: Record<Exclude<StatusFilter, 'all'>, string> = {
  pending_approval: 'Catalyst write-back proposals queued for human approval before dispatch.',
  previewed:        'Actions run in preview mode — payload composed and validated but not yet committed to the ERP.',
  completed:        'Actions successfully dispatched to the ERP and confirmed by the connector.',
  failed:           'Actions whose ERP write-back returned an error — usually a validation or auth failure on the target system.',
  rejected:         'Actions explicitly rejected by an operator. Cleared from the queue but retained for audit.',
};

function shortRef(id: string): string {
  // Friendly short-ref for the queue table — last 10 chars uppercase.
  return id.length > 10 ? id.slice(-10).toUpperCase() : id.toUpperCase();
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function ActionLayerPage(): JSX.Element {
  const toast = useToast();
  const [summary, setSummary] = useState<SummaryShape | null>(null);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [actingOn, setActingOn] = useState<string | null>(null);
  // SAP-grade multi-select for batch approve/reject across the queue.
  // Selection is keyed by action id and survives filter changes only for
  // ids that remain visible — drops the rest on filter switch so the bulk
  // bar never claims to act on rows the user can't see.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  // SAP-style sortable columns. Default: newest first (Created desc).
  const [sort, setSort] = useState<SortSpec<SortKey> | null>({ key: 'created', dir: 'desc' });
  // localStorage-persisted saved views (filter + sort presets).
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  // Drill-through: action id of the row whose evidence drawer is open.
  const [drillId, setDrillId] = useState<string | null>(null);
  // When the summary was last loaded — fuels MetricSource "Refreshed" rows
  // on the 5 status tiles so operators can see staleness at a glance.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setRefreshing(true);
    setError(null);
    try {
      const [sum, list] = await Promise.all([
        api.erp.actionsSummary(),
        api.erp.listAllActions({ status: filter === 'all' ? undefined : filter, limit: 200 }),
      ]);
      setSummary(sum.summary);
      setActions(list.actions);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load action queue');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter]);

  useEffect(() => { void load(); }, [load]);

  // Prune selection to only ids that are still in the visible action set
  // whenever the page reloads / filter changes.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      const ids = new Set(actions.map((a) => a.id));
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [actions]);

  // Only pending / previewed rows are actionable in bulk — completed /
  // failed / rejected rows have nothing more we can do server-side.
  const actionableIds = useMemo(
    () => actions.filter((a) => a.status === 'pending_approval' || a.status === 'pending' || a.status === 'previewed').map((a) => a.id),
    [actions],
  );
  const selectedCount = selected.size;
  const allActionableSelected = actionableIds.length > 0 && actionableIds.every((id) => selected.has(id));

  const toggleRow = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const toggleAll = () => {
    setSelected((prev) => {
      if (allActionableSelected) return new Set();
      const next = new Set(prev);
      for (const id of actionableIds) next.add(id);
      return next;
    });
  };
  const clearSelection = () => setSelected(new Set());

  // ── Sortable columns ────────────────────────────────────────────
  // Cycle: unsorted → asc → desc → unsorted (per column).
  const onSortColumn = (key: SortKey) => setSort((prev) => cycleSort(prev, key));
  const sortedActions = useMemo(() => {
    if (!sort) return actions;
    const { key, dir } = sort;
    const mult = dir === 'asc' ? 1 : -1;
    const get = (a: ActionItem): string | number => {
      switch (key) {
        case 'status':   return a.status;
        case 'ref':      return a.id;
        case 'type':     return a.action_type;
        case 'catalyst': return a.catalyst_name;
        case 'value':    return a.value_zar;
        case 'created':  return new Date(a.created_at).getTime();
      }
    };
    return [...actions].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * mult;
      return String(av).localeCompare(String(bv)) * mult;
    });
  }, [actions, sort]);

  // ── Saved views (filter + sort presets) ─────────────────────────
  const saveCurrentView = () => {
    const label = window.prompt('Name this view (e.g. "Open high-value"):');
    const trimmed = label?.trim();
    if (!trimmed) return;
    const view: SavedView = {
      id: `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`,
      label: trimmed.slice(0, 40),
      filter,
      sort,
    };
    const next = [...savedViews, view];
    setSavedViews(next);
    persistSavedViews(next);
    toast.success('View saved', trimmed);
  };
  const applyView = (view: SavedView) => {
    setFilter(view.filter);
    setSort(view.sort);
  };
  const deleteView = (id: string) => {
    const next = savedViews.filter((v) => v.id !== id);
    setSavedViews(next);
    persistSavedViews(next);
  };
  const currentMatchesView = useCallback(
    (v: SavedView): boolean => {
      if (v.filter !== filter) return false;
      if ((v.sort == null) !== (sort == null)) return false;
      if (v.sort && sort) {
        if (v.sort.key !== sort.key || v.sort.dir !== sort.dir) return false;
      }
      return true;
    },
    [filter, sort],
  );

  // ── Bulk approve / reject ───────────────────────────────────────
  // Server has no batch endpoint, so we fan-out serially with a Promise.all
  // chunked at 4 concurrent so we don't blow the per-tenant rate limit. We
  // collect successes + failures and toast a summary, then refresh the list.
  const runBulk = async (kind: 'approve' | 'reject') => {
    const target = actions.filter((a) => selected.has(a.id));
    if (target.length === 0) return;
    let reason: string | undefined;
    if (kind === 'reject') {
      const input = window.prompt(`Reject reason (applied to all ${target.length} selected):`);
      if (input === null) return; // user cancelled
      reason = input.trim() || undefined;
    }
    setBulkBusy(true);
    let ok = 0;
    const errors: string[] = [];
    const CONCURRENCY = 4;
    for (let i = 0; i < target.length; i += CONCURRENCY) {
      const batch = target.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(async (a) => {
        if (!a.connection_id) {
          errors.push(`${shortRef(a.id)}: no connection_id`);
          return;
        }
        try {
          if (kind === 'approve') {
            await api.erp.approveAction(a.connection_id, a.id);
          } else {
            await api.erp.rejectAction(a.connection_id, a.id, reason);
          }
          ok++;
        } catch (err) {
          errors.push(`${shortRef(a.id)}: ${err instanceof ApiError ? err.message : 'failed'}`);
        }
      }));
    }
    setBulkBusy(false);
    setSelected(new Set());
    const verb = kind === 'approve' ? 'Approved' : 'Rejected';
    if (errors.length === 0) {
      toast.success(`${verb} ${ok} action${ok === 1 ? '' : 's'}`);
    } else if (ok === 0) {
      toast.error(`${verb} failed`, errors[0]);
    } else {
      toast.error(`${verb} ${ok} of ${target.length}`, `${errors.length} failed: ${errors[0]}`);
    }
    void load(true);
  };

  // ── Approve / Reject ────────────────────────────────────────────
  const handleApprove = async (a: ActionItem) => {
    if (!a.connection_id) {
      toast.error('Cannot approve', 'Action has no connection_id.');
      return;
    }
    setActingOn(a.id);
    try {
      await api.erp.approveAction(a.connection_id, a.id);
      toast.success(`Approved ${shortRef(a.id)}`);
      void load(true);
    } catch (err) {
      toast.error('Approve failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setActingOn(null);
    }
  };
  const handleReject = async (a: ActionItem) => {
    if (!a.connection_id) {
      toast.error('Cannot reject', 'Action has no connection_id.');
      return;
    }
    const reason = window.prompt('Optional rejection reason:') ?? undefined;
    setActingOn(a.id);
    try {
      await api.erp.rejectAction(a.connection_id, a.id, reason);
      toast.success(`Rejected ${shortRef(a.id)}`);
      void load(true);
    } catch (err) {
      toast.error('Reject failed', err instanceof ApiError ? err.message : undefined);
    } finally {
      setActingOn(null);
    }
  };

  // ── Status → StatusPill kind mapping ────────────────────────────
  const statusToPillKind = (s: string): string => {
    if (s === 'pending_approval' || s === 'pending') return 'pending';
    if (s === 'previewed')   return 'in_progress';
    if (s === 'completed')   return 'completed';
    if (s === 'failed')      return 'failed';
    if (s === 'rejected')    return 'rejected';
    return s;
  };

  const filterChip = (key: StatusFilter, label: string, count: number | null) => {
    const active = filter === key;
    return (
      <button
        key={key}
        type="button"
        onClick={() => setFilter(key)}
        className={`px-3 py-1 rounded-full text-body-sm transition-colors ${
          active
            ? 'font-medium border'
            : 't-secondary hover:t-primary border border-transparent hover:bg-[var(--bg-secondary)]'
        }`}
        style={active ? { background: 'var(--accent-subtle)', borderColor: 'rgba(163, 177, 138, 0.40)', color: 'var(--accent)' } : undefined}
        aria-pressed={active}
      >
        {label}{count !== null ? ` (${count})` : ''}
      </button>
    );
  };

  const totalRowsLabel = useMemo(() => {
    if (filter === 'all') return `${actions.length} of ${summary?.total_count ?? actions.length}`;
    return `${actions.length} ${filter.replace(/_/g, ' ')}`;
  }, [actions.length, filter, summary]);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <HeroHeader
          icon={Inbox}
          title="Operator Queue"
          subtitle="Resolve transactional discrepancies requiring manual intervention"
          accent="amber"
        />
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={refreshing}>
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </Button>
      </div>

      {error && !loading && <ErrorState error={error} onRetry={() => void load()} />}

      {loading ? (
        <LoadingState variant="cards" count={4} />
      ) : (
        <>
          {/* 5 status tiles — Stitch dispatch-queue pattern. Each tile is a
              filter toggle AND carries a MetricSource so the operator can
              audit where its count + ZAR value came from. Tile is a div
              (not button) so the MetricSource trigger can nest safely. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            {TILE_DEFS.map((tile) => {
              const Icon = tile.icon;
              const count = (summary?.[tile.countKey] as number | undefined) ?? 0;
              const value = (summary?.[tile.valueKey] as number | undefined) ?? 0;
              const isActiveFilter = filter === tile.key;
              const tileProvenance: MetricProvenance = {
                label: `${tile.label} actions`,
                definition: TILE_DEFINITIONS[tile.key],
                table: 'catalyst_actions',
                endpoint: 'GET /api/erp/actions/summary',
                query: `SELECT COUNT(*), SUM(value_zar)\n  FROM catalyst_actions\n WHERE tenant_id = ?\n   AND status = '${tile.key}'`,
                window: 'All time',
                sample: count,
                refreshedAt: loadedAt,
                drillTo: `/action-layer?status=${tile.key}`,
                notes: [{ label: 'Value', value: <Numeric value={value} unit="ZAR" compact size="sm" /> }],
              };
              return (
                <div
                  key={tile.key}
                  role="button"
                  tabIndex={0}
                  onClick={() => setFilter(isActiveFilter ? 'all' : tile.key)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setFilter(isActiveFilter ? 'all' : tile.key);
                    }
                  }}
                  className={`text-left p-4 rounded-2xl bg-[var(--bg-card-solid)] border transition-colors cursor-pointer ${tile.hoverBorder} ${
                    isActiveFilter ? 'border-accent' : 'border-[var(--border-card)]'
                  }`}
                  aria-pressed={isActiveFilter}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption uppercase tracking-wider t-muted">{tile.label}</span>
                    <div className="flex items-center gap-1">
                      <MetricSource source={tileProvenance} />
                      <Icon size={16} style={{ color: tile.accent }} />
                    </div>
                  </div>
                  <div className="text-headline-lg font-bold t-primary tabular-nums font-mono">
                    <Numeric value={count} size="lg" />
                  </div>
                  <div className="text-caption font-mono t-muted mt-1">
                    <Numeric value={value} unit="ZAR" compact size="sm" tone="mute" />
                  </div>
                </div>
              );
            })}
          </div>

          {/* Filter chips + total row */}
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-2 flex-wrap">
              {filterChip('all', 'All', summary?.total_count ?? null)}
              {filterChip('pending_approval', 'Pending', summary?.pending_approval_count ?? null)}
              {filterChip('previewed', 'Previewed', summary?.previewed_count ?? null)}
              {filterChip('completed', 'Completed', summary?.completed_count ?? null)}
              {filterChip('failed', 'Failed', summary?.failed_count ?? null)}
              {filterChip('rejected', 'Rejected', summary?.rejected_count ?? null)}
            </div>
            <span className="text-caption t-muted">{totalRowsLabel}</span>
          </div>

          {/* Saved views — SAP-style preset strip. Save current (filter + sort)
              as a named view, click to re-apply, hover row × to delete. */}
          <div className="flex items-center gap-2 flex-wrap">
            <Bookmark size={14} className="t-muted" aria-hidden="true" />
            <span className="text-caption uppercase tracking-wider t-muted font-medium">Saved views</span>
            {savedViews.length === 0 && (
              <span className="text-caption t-muted italic">No saved views yet — set a filter + sort, then save.</span>
            )}
            {savedViews.map((v) => {
              const active = currentMatchesView(v);
              return (
                <span
                  key={v.id}
                  className={`group inline-flex items-center gap-1 pl-3 pr-1 py-1 rounded-full text-body-sm border transition-colors ${
                    active ? 'font-medium' : 'border-transparent hover:bg-[var(--bg-secondary)]'
                  }`}
                  style={active ? { background: 'var(--accent-subtle)', borderColor: 'rgba(163, 177, 138, 0.40)', color: 'var(--accent)' } : { borderColor: 'var(--border-card)' }}
                >
                  <button
                    type="button"
                    onClick={() => applyView(v)}
                    className="text-inherit hover:underline-offset-2"
                    title={`Apply: ${v.filter}${v.sort ? ` · ${v.sort.key} ${v.sort.dir}` : ''}`}
                  >
                    {v.label}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteView(v.id)}
                    className="p-0.5 rounded-full opacity-50 hover:opacity-100 hover:bg-[var(--bg-elevated)] transition-opacity"
                    aria-label={`Delete view ${v.label}`}
                    title="Delete view"
                  >
                    <Trash2 size={11} />
                  </button>
                </span>
              );
            })}
            <button
              type="button"
              onClick={saveCurrentView}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-body-sm t-secondary hover:t-primary border border-dashed transition-colors hover:bg-[var(--bg-secondary)]"
              style={{ borderColor: 'var(--border-card)' }}
              title="Save current filter + sort as a named view"
            >
              <BookmarkPlus size={12} /> Save current
            </button>
          </div>

          {/* Bulk action bar — slides in when rows are selected. SAP-style
              dispatch queue: select N rows → Approve / Reject N. */}
          {selectedCount > 0 && (
            <div
              className="flex items-center justify-between gap-3 px-4 py-2.5 rounded-xl"
              style={{
                background: 'var(--accent-subtle)',
                border: '1px solid rgba(163, 177, 138, 0.40)',
              }}
            >
              <div className="flex items-center gap-3">
                <span className="text-body-sm font-medium t-primary">
                  <Numeric value={selectedCount} size="sm" /> selected
                </span>
                <button
                  type="button"
                  onClick={clearSelection}
                  className="text-caption t-muted hover:t-primary transition-colors"
                >
                  Clear
                </button>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void runBulk('approve')}
                  disabled={bulkBusy}
                >
                  <Check size={12} /> Approve {selectedCount}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => void runBulk('reject')}
                  disabled={bulkBusy}
                >
                  <XIcon size={12} /> Reject {selectedCount}
                </Button>
              </div>
            </div>
          )}

          {/* Actions table */}
          {actions.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Nothing in the queue"
              description={
                filter === 'all'
                  ? 'No dispatched actions yet. Catalysts will populate this queue when they raise write-back proposals.'
                  : `No actions with status "${filter.replace(/_/g, ' ')}".`
              }
            />
          ) : (
            <Card className="p-0 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead className="text-caption uppercase tracking-wider t-muted sticky top-0 z-10" style={{ background: 'var(--bg-card-solid)' }}>
                    <tr className="border-b border-[var(--border-card)]">
                      <th className="text-center px-3 py-3 font-medium w-10">
                        <input
                          type="checkbox"
                          checked={allActionableSelected}
                          onChange={toggleAll}
                          disabled={actionableIds.length === 0}
                          title={
                            actionableIds.length === 0
                              ? 'No selectable rows'
                              : allActionableSelected
                                ? 'Clear selection'
                                : `Select all ${actionableIds.length} actionable`
                          }
                          aria-label="Select all"
                          className="rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                          style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
                        />
                      </th>
                      <SortHeader sortKey="status"   label="Status"   sort={sort} onSort={onSortColumn} />
                      <SortHeader sortKey="ref"      label="Ref"      sort={sort} onSort={onSortColumn} />
                      <SortHeader sortKey="type"     label="Type"     sort={sort} onSort={onSortColumn} />
                      <SortHeader sortKey="catalyst" label="Catalyst" sort={sort} onSort={onSortColumn} />
                      <SortHeader sortKey="value"    label="Value"    sort={sort} onSort={onSortColumn} align="right" />
                      <SortHeader sortKey="created"  label="Created"  sort={sort} onSort={onSortColumn} />
                      <th className="text-right px-4 py-3 font-medium">Review</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedActions.map((a) => {
                      const isPending = a.status === 'pending_approval' || a.status === 'pending';
                      const isPreviewed = a.status === 'previewed';
                      const canAct = isPending || isPreviewed;
                      const isSelected = selected.has(a.id);
                      return (
                        <tr
                          key={a.id}
                          className="border-b border-[var(--border-card)] last:border-0 hover:bg-[var(--bg-secondary)] transition-colors"
                          style={isSelected ? { background: 'var(--accent-subtle)' } : undefined}
                        >
                          <td className="px-3 py-3 text-center">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleRow(a.id)}
                              disabled={!canAct}
                              title={canAct ? (isSelected ? 'Deselect row' : 'Select row') : `${a.status.replace(/_/g, ' ')} actions can't be bulk-actioned`}
                              aria-label={`Select action ${shortRef(a.id)}`}
                              className="rounded cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                              style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
                            />
                          </td>
                          <td className="px-4 py-3"><StatusPill status={statusToPillKind(a.status)} size="sm" /></td>
                          <td className="px-4 py-3">
                            {/* Ref is now a drill-through: opens the evidence
                                drawer with the full chain (finding, sample
                                records, confidence, execution trace). */}
                            <button
                              type="button"
                              onClick={() => setDrillId(a.id)}
                              className="font-mono t-primary hover:text-accent transition-colors inline-flex items-center gap-1 group"
                              title="Open evidence chain"
                            >
                              {shortRef(a.id)}
                              <Link2 size={11} className="opacity-0 group-hover:opacity-60 transition-opacity" />
                            </button>
                          </td>
                          <td className="px-4 py-3 t-secondary">{a.action_type.replace(/_/g, ' ')}</td>
                          <td className="px-4 py-3 t-muted">{a.catalyst_name}</td>
                          <td className="px-4 py-3 text-right">
                            <Numeric value={a.value_zar} unit="ZAR" compact size="sm" />
                          </td>
                          <td className="px-4 py-3 t-muted" title={new Date(a.created_at).toLocaleString()}>{relativeTime(a.created_at)}</td>
                          <td className="px-4 py-3 text-right">
                            <div className="inline-flex items-center gap-1">
                              {/* Open-evidence is always available — even on
                                  completed/rejected rows, the chain is still
                                  the audit-trail record of what shipped. */}
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setDrillId(a.id)}
                                title="Open evidence chain"
                              >
                                <FileSearch size={12} />
                              </Button>
                              {canAct ? (
                                <>
                                  <Button
                                    variant="primary"
                                    size="sm"
                                    onClick={() => void handleApprove(a)}
                                    disabled={actingOn === a.id}
                                    title="Approve & dispatch"
                                  >
                                    <Check size={12} />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => void handleReject(a)}
                                    disabled={actingOn === a.id}
                                    title="Reject"
                                  >
                                    <XIcon size={12} />
                                  </Button>
                                </>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}

      {/* Drill-through drawer — opens when the operator clicks a Ref cell
          or the FileSearch button. Loads the full evidence chain
          (finding, sample records, confidence, execution trace) and
          carries Approve / Reject CTAs so action can be taken without
          leaving the chain of evidence. */}
      <ActionEvidenceDrawer
        actionId={drillId}
        onClose={() => setDrillId(null)}
        onActed={() => void load(true)}
      />
    </div>
  );
}

export default ActionLayerPage;
