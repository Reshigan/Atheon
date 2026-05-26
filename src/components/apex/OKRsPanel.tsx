/**
 * <OKRsPanel> — Apex Strategic OKRs surface.
 *
 * Renders the tenant's objectives + key-results for a chosen quarter,
 * with a stat strip, objective cards, and inline admin+ mutations.
 *
 * Lives inside the Apex page tabs. Data plumbed via api.apex.okrs.
 *
 * Emil-grade craft: scale(0.97) press feedback on tappable buttons,
 * subtle origin-aware modal entrance, transition (transform, opacity)
 * with cubic-bezier(0.23, 1, 0.32, 1) — never animate width/height.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScoreRing } from '@/components/ui/score-ring';
import { Progress } from '@/components/ui/progress';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Modal } from '@/components/ui/modal';
import {
  Target,
  Plus,
  Pencil,
  Trash2,
  ChevronDown,
  ChevronUp,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type ObjectiveStatus = 'on_track' | 'at_risk' | 'off_track' | 'achieved';
type KRStatus = ObjectiveStatus;
type Priority = 'p1' | 'p2' | 'normal';

interface KeyResult {
  id: string;
  objective_id: string;
  description: string;
  metric: string | null;
  target_value: number | null;
  current_value: number | null;
  unit: string | null;
  status: KRStatus;
  due_date: string | null;
}

interface Objective {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  owner: string | null;
  status: ObjectiveStatus;
  priority: Priority;
  quarter: string;
  progress_pct: number;
  created_at: string;
  updated_at: string;
  key_results: KeyResult[];
}

interface Summary {
  total: number;
  on_track: number;
  at_risk: number;
  off_track: number;
  achieved: number;
  avg_progress: number;
}

const STATUS_TO_PILL: Record<ObjectiveStatus, 'green' | 'amber' | 'red' | 'completed'> = {
  on_track: 'green',
  at_risk: 'amber',
  off_track: 'red',
  achieved: 'completed',
};

function currentQuarter(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `${d.getFullYear()}-Q${q}`;
}

function quarterOptions(): string[] {
  const d = new Date();
  const cy = d.getFullYear();
  const cq = Math.floor(d.getMonth() / 3) + 1;
  const opts: string[] = [];
  // 4 backward, current, 3 forward — enough to plan ~2 yrs in either direction.
  for (let i = -4; i <= 3; i += 1) {
    let q = cq + i;
    let y = cy;
    while (q <= 0) { q += 4; y -= 1; }
    while (q > 4) { q -= 4; y += 1; }
    opts.push(`${y}-Q${q}`);
  }
  // Unique, ascending.
  return [...new Set(opts)].sort();
}

function krProgress(kr: KeyResult): number {
  if (kr.target_value == null || kr.current_value == null || kr.target_value === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((kr.current_value / kr.target_value) * 100)));
}

function fmtNum(n: number | null | undefined, unit: string | null | undefined): string {
  if (n == null) return '—';
  const formatted = Math.abs(n) >= 1000
    ? n.toLocaleString(undefined, { maximumFractionDigits: 0 })
    : n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return unit ? `${formatted} ${unit}` : formatted;
}

interface OKRsPanelProps {
  tenantId?: string;
}

export function OKRsPanel({ tenantId }: OKRsPanelProps) {
  const currentUser = useAppStore((s) => s.user);
  const canEdit = useMemo(() => {
    const role = currentUser?.role;
    return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'executive';
  }, [currentUser?.role]);

  const [quarter, setQuarter] = useState<string>(currentQuarter());
  const [objectives, setObjectives] = useState<Objective[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const [showObjectiveModal, setShowObjectiveModal] = useState(false);
  const [editingObjective, setEditingObjective] = useState<Objective | null>(null);
  const [showKRModal, setShowKRModal] = useState(false);
  const [krParentObjective, setKRParentObjective] = useState<Objective | null>(null);
  const [editingKR, setEditingKR] = useState<KeyResult | null>(null);

  const load = useCallback(async (opts: { showLoading?: boolean } = { showLoading: true }) => {
    try {
      if (opts.showLoading) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const data = await api.apex.okrs.list(quarter, tenantId);
      setObjectives(data.objectives);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load objectives');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [quarter, tenantId]);

  useEffect(() => { load({ showLoading: true }); }, [load]);

  const toggleExpand = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const deleteObjective = async (obj: Objective) => {
    if (!confirm(`Delete objective "${obj.title}" and all its key results? This cannot be undone.`)) return;
    try {
      await api.apex.okrs.remove(obj.id);
      await load({ showLoading: false });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete objective');
    }
  };

  const deleteKR = async (kr: KeyResult) => {
    if (!confirm('Delete this key result?')) return;
    try {
      await api.apex.okrs.removeKeyResult(kr.id);
      await load({ showLoading: false });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete key result');
    }
  };

  if (loading) return <LoadingState variant="cards" count={3} />;
  if (error) return <ErrorState title="Couldn't load OKRs" error={error} onRetry={() => load({ showLoading: true })} />;

  const sortedObjectives = [...objectives].sort((a, b) => {
    // Priority p1 first, then by status severity, then by progress (lowest first).
    const pri = (o: Objective) => (o.priority === 'p1' ? 0 : o.priority === 'p2' ? 1 : 2);
    if (pri(a) !== pri(b)) return pri(a) - pri(b);
    const sev = (s: ObjectiveStatus) => (s === 'off_track' ? 0 : s === 'at_risk' ? 1 : s === 'on_track' ? 2 : 3);
    if (sev(a.status) !== sev(b.status)) return sev(a.status) - sev(b.status);
    return a.progress_pct - b.progress_pct;
  });

  return (
    <div className="space-y-5">
      {/* Header strip — quarter selector + summary chips + add button */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Target size={16} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold t-primary">Strategic Objectives</h3>
            <p className="text-caption t-muted">OKRs for the executive team · {quarter}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={quarter}
            onChange={(e) => setQuarter(e.target.value)}
            className="text-sm bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2 py-1 t-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
            aria-label="Select quarter"
          >
            {quarterOptions().map((q) => (
              <option key={q} value={q}>{q}</option>
            ))}
          </select>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => load({ showLoading: false })}
            disabled={refreshing}
            aria-label="Refresh objectives"
          >
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            <span className="ml-1">Refresh</span>
          </Button>
          {canEdit && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => { setEditingObjective(null); setShowObjectiveModal(true); }}
            >
              <Plus size={12} /> <span className="ml-1">New Objective</span>
            </Button>
          )}
        </div>
      </div>

      {/* Summary chips — avg progress + status counts. Stays terse on mobile. */}
      {summary && summary.total > 0 && (
        <Card size="compact">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-3">
              <ScoreRing score={Math.round(summary.avg_progress)} size="sm" />
              <div>
                <div className="text-xs font-medium t-muted">Avg. Progress</div>
                <div className="text-sm t-primary font-semibold">
                  {Math.round(summary.avg_progress)}<span className="t-muted text-xs">%</span>
                </div>
              </div>
            </div>
            <div className="h-8 w-px bg-[var(--border-subtle)]" aria-hidden="true" />
            <div className="flex items-center gap-3 flex-wrap">
              <SummaryChip label="On track" count={summary.on_track} tone="green" />
              <SummaryChip label="At risk" count={summary.at_risk} tone="amber" />
              <SummaryChip label="Off track" count={summary.off_track} tone="red" />
              <SummaryChip label="Achieved" count={summary.achieved} tone="completed" />
              <SummaryChip label="Total" count={summary.total} tone="neutral" />
            </div>
          </div>
        </Card>
      )}

      {/* Objective cards */}
      {sortedObjectives.length === 0 ? (
        <EmptyState
          icon={Target}
          title={`No objectives set for ${quarter} yet`}
          description={canEdit
            ? `Create the strategic objectives the executive team will commit to this quarter. Each objective tracks its progress through measurable key results.`
            : `No objectives have been set for ${quarter}. Ask an executive or admin to create them.`}
          action={canEdit
            ? { label: 'New Objective', onClick: () => { setEditingObjective(null); setShowObjectiveModal(true); } }
            : undefined}
        />
      ) : (
        <div className="space-y-3">
          {sortedObjectives.map((obj) => (
            <ObjectiveCard
              key={obj.id}
              objective={obj}
              expanded={expanded.has(obj.id)}
              onToggleExpand={() => toggleExpand(obj.id)}
              canEdit={canEdit}
              onEdit={() => { setEditingObjective(obj); setShowObjectiveModal(true); }}
              onDelete={() => deleteObjective(obj)}
              onAddKR={() => { setKRParentObjective(obj); setEditingKR(null); setShowKRModal(true); }}
              onEditKR={(kr) => { setKRParentObjective(obj); setEditingKR(kr); setShowKRModal(true); }}
              onDeleteKR={(kr) => deleteKR(kr)}
            />
          ))}
        </div>
      )}

      {/* Objective create/edit modal */}
      {showObjectiveModal && (
        <ObjectiveFormModal
          quarter={quarter}
          objective={editingObjective}
          onClose={() => { setShowObjectiveModal(false); setEditingObjective(null); }}
          onSaved={async () => {
            setShowObjectiveModal(false);
            setEditingObjective(null);
            await load({ showLoading: false });
          }}
        />
      )}

      {/* KR create/edit modal */}
      {showKRModal && krParentObjective && (
        <KRFormModal
          objective={krParentObjective}
          kr={editingKR}
          onClose={() => { setShowKRModal(false); setKRParentObjective(null); setEditingKR(null); }}
          onSaved={async () => {
            setShowKRModal(false);
            setKRParentObjective(null);
            setEditingKR(null);
            await load({ showLoading: false });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function SummaryChip({ label, count, tone }: { label: string; count: number; tone: 'green' | 'amber' | 'red' | 'completed' | 'neutral' }) {
  if (tone === 'neutral') {
    return (
      <span className="inline-flex items-center gap-1.5 text-caption">
        <span className="t-muted">{label}</span>
        <span className="font-semibold t-primary">{count}</span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-caption">
      <StatusPill status={tone} density="dot" size="sm" label={`${count} ${label}`} />
    </span>
  );
}

function ObjectiveCard(props: {
  objective: Objective;
  expanded: boolean;
  onToggleExpand: () => void;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onAddKR: () => void;
  onEditKR: (kr: KeyResult) => void;
  onDeleteKR: (kr: KeyResult) => void;
}) {
  const { objective: obj, expanded, onToggleExpand, canEdit, onEdit, onDelete, onAddKR, onEditKR, onDeleteKR } = props;
  return (
    <Card className="!p-0 overflow-hidden" size="compact">
      {/* Header — clickable to expand. Card padding is zeroed because
          the button + expanded body manage their own padding. */}
      <button
        type="button"
        onClick={onToggleExpand}
        className="w-full text-left p-4 flex items-start gap-4 hover:bg-[var(--bg-secondary)]/40 transition-colors active:scale-[0.997] origin-center"
        style={{ transitionDuration: '160ms', transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
        aria-expanded={expanded}
        aria-label={`${expanded ? 'Collapse' : 'Expand'} objective ${obj.title}`}
      >
        <ScoreRing score={Math.round(obj.progress_pct)} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-semibold t-primary truncate">{obj.title}</h4>
                {obj.priority === 'p1' && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-[var(--accent)]/15 text-[var(--accent)] font-semibold">P1</span>
                )}
                {obj.priority === 'p2' && (
                  <span className="text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-blue-500/15 text-blue-300 font-semibold">P2</span>
                )}
              </div>
              {obj.description && (
                <p className="text-caption t-muted mt-1 line-clamp-2">{obj.description}</p>
              )}
              <div className="flex items-center gap-3 mt-2 text-caption t-muted">
                {obj.owner && <span>Owner: <span className="t-secondary">{obj.owner}</span></span>}
                <span>{obj.key_results.length} key result{obj.key_results.length === 1 ? '' : 's'}</span>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <StatusPill status={STATUS_TO_PILL[obj.status]} size="sm" />
              {expanded ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
            </div>
          </div>
        </div>
      </button>

      {/* Expanded — KR list */}
      {expanded && (
        <div className="border-t border-[var(--border-subtle)] bg-[var(--bg-secondary)]/30">
          <div className="p-4 space-y-3">
            {obj.key_results.length === 0 ? (
              <p className="text-caption t-muted italic">No key results yet. Add one to start tracking progress.</p>
            ) : (
              obj.key_results.map((kr) => (
                <div key={kr.id} className="flex items-start gap-3 group">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-3 mb-1.5">
                      <p className="text-sm t-primary truncate">{kr.description}</p>
                      <StatusPill status={STATUS_TO_PILL[kr.status]} size="sm" density="dot" />
                    </div>
                    <Progress
                      value={krProgress(kr)}
                      size="md"
                      color={kr.status === 'off_track' ? 'red' : kr.status === 'at_risk' ? 'amber' : kr.status === 'achieved' ? 'emerald' : 'blue'}
                    />
                    <div className="flex items-center justify-between text-caption mt-1">
                      <span className="t-muted">
                        {fmtNum(kr.current_value, kr.unit)}
                        <span className="opacity-60"> / </span>
                        {fmtNum(kr.target_value, kr.unit)}
                        {kr.metric && <span className="opacity-50 ml-1">· {kr.metric}</span>}
                      </span>
                      {kr.due_date && <span className="t-muted">Due {kr.due_date}</span>}
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <IconButton onClick={() => onEditKR(kr)} label={`Edit ${kr.description}`}>
                        <Pencil size={12} />
                      </IconButton>
                      <IconButton onClick={() => onDeleteKR(kr)} label={`Delete ${kr.description}`} tone="danger">
                        <Trash2 size={12} />
                      </IconButton>
                    </div>
                  )}
                </div>
              ))
            )}
            {canEdit && (
              <div className="flex items-center justify-between pt-2 border-t border-[var(--border-subtle)]">
                <Button variant="ghost" size="sm" onClick={onAddKR}>
                  <Plus size={12} /> <span className="ml-1">Add key result</span>
                </Button>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="sm" onClick={onEdit}>
                    <Pencil size={12} /> <span className="ml-1">Edit</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onDelete}>
                    <Trash2 size={12} /> <span className="ml-1 text-red-400">Delete</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}

function IconButton({ children, onClick, label, tone }: { children: React.ReactNode; onClick: () => void; label: string; tone?: 'danger' }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      aria-label={label}
      className={`p-1 rounded transition-all hover:bg-[var(--bg-tertiary)] active:scale-[0.92] ${tone === 'danger' ? 'text-red-400 hover:text-red-300' : 't-muted hover:t-primary'}`}
      style={{ transitionDuration: '120ms', transitionTimingFunction: 'cubic-bezier(0.23, 1, 0.32, 1)' }}
    >
      {children}
    </button>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Modals
// ─────────────────────────────────────────────────────────────────────

interface ObjectiveFormModalProps {
  quarter: string;
  objective: Objective | null;
  onClose: () => void;
  onSaved: () => void;
}

function ObjectiveFormModal({ quarter, objective, onClose, onSaved }: ObjectiveFormModalProps) {
  const [title, setTitle] = useState(objective?.title ?? '');
  const [description, setDescription] = useState(objective?.description ?? '');
  const [owner, setOwner] = useState(objective?.owner ?? '');
  const [priority, setPriority] = useState<Priority>(objective?.priority ?? 'normal');
  const [status, setStatus] = useState<ObjectiveStatus>(objective?.status ?? 'on_track');
  const [progressPct, setProgressPct] = useState<number>(objective?.progress_pct ?? 0);
  const [q, setQ] = useState(objective?.quarter ?? quarter);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) { setErr('Title is required'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const payload = {
        title: title.trim(),
        description: description.trim() || null,
        owner: owner.trim() || null,
        priority,
        status,
        quarter: q,
        progress_pct: progressPct,
      };
      if (objective) {
        await api.apex.okrs.update(objective.id, payload);
      } else {
        await api.apex.okrs.create(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save objective');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" dismissible={!submitting}>
      <Modal.Header title={objective ? 'Edit Objective' : 'New Objective'} onClose={onClose} />
      <Modal.Body>
      <form onSubmit={submit} className="space-y-4" id="objective-form">
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Achieve 95% gross margin on Q-end close" autoFocus />
        </Field>
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Why this objective matters and what success looks like"
            rows={3}
            className="w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-sm t-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40"
          />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Owner"><Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. CFO, R. Govender" /></Field>
          <Field label="Quarter">
            <select value={q} onChange={(e) => setQ(e.target.value)} className={selectCls()}>
              {quarterOptions().map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={selectCls()}>
              <option value="p1">P1 — top priority</option>
              <option value="p2">P2 — secondary</option>
              <option value="normal">Normal</option>
            </select>
          </Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as ObjectiveStatus)} className={selectCls()}>
              <option value="on_track">On track</option>
              <option value="at_risk">At risk</option>
              <option value="off_track">Off track</option>
              <option value="achieved">Achieved</option>
            </select>
          </Field>
          <Field label="Progress %">
            <input
              type="number"
              min={0}
              max={100}
              value={progressPct}
              onChange={(e) => setProgressPct(Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
              className={selectCls()}
            />
          </Field>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </form>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" form="objective-form" variant="primary" disabled={submitting}>
          {submitting && <Loader2 size={12} className="animate-spin mr-1" />}
          {objective ? 'Save changes' : 'Create objective'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

interface KRFormModalProps {
  objective: Objective;
  kr: KeyResult | null;
  onClose: () => void;
  onSaved: () => void;
}

function KRFormModal({ objective, kr, onClose, onSaved }: KRFormModalProps) {
  const [description, setDescription] = useState(kr?.description ?? '');
  const [metric, setMetric] = useState(kr?.metric ?? '');
  const [unit, setUnit] = useState(kr?.unit ?? '');
  const [targetValue, setTargetValue] = useState<string>(kr?.target_value?.toString() ?? '');
  const [currentValue, setCurrentValue] = useState<string>(kr?.current_value?.toString() ?? '');
  const [status, setStatus] = useState<KRStatus>(kr?.status ?? 'on_track');
  const [dueDate, setDueDate] = useState(kr?.due_date ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!description.trim()) { setErr('Description is required'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const payload = {
        description: description.trim(),
        metric: metric.trim() || null,
        unit: unit.trim() || null,
        target_value: targetValue === '' ? null : parseFloat(targetValue),
        current_value: currentValue === '' ? null : parseFloat(currentValue),
        status,
        due_date: dueDate || null,
      };
      if (kr) {
        await api.apex.okrs.updateKeyResult(kr.id, payload);
      } else {
        await api.apex.okrs.addKeyResult(objective.id, payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save key result');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="md" dismissible={!submitting}>
      <Modal.Header title={kr ? 'Edit Key Result' : 'New Key Result'} onClose={onClose} />
      <Modal.Body>
      <form onSubmit={submit} className="space-y-4" id="kr-form">
        <p className="text-caption t-muted">For objective: <span className="t-secondary">{objective.title}</span></p>
        <Field label="Description" required>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Cut DSO from 52 to 38 days" autoFocus />
        </Field>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Metric"><Input value={metric} onChange={(e) => setMetric(e.target.value)} placeholder="e.g. DSO, NPS, % uptime" /></Field>
          <Field label="Unit"><Input value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. days, %, ZAR" /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Current value"><Input type="number" step="any" value={currentValue} onChange={(e) => setCurrentValue(e.target.value)} /></Field>
          <Field label="Target value"><Input type="number" step="any" value={targetValue} onChange={(e) => setTargetValue(e.target.value)} /></Field>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value as KRStatus)} className={selectCls()}>
              <option value="on_track">On track</option>
              <option value="at_risk">At risk</option>
              <option value="off_track">Off track</option>
              <option value="achieved">Achieved</option>
            </select>
          </Field>
          <Field label="Due date">
            <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={selectCls()} />
          </Field>
        </div>
        {err && <p className="text-sm text-red-400">{err}</p>}
      </form>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" form="kr-form" variant="primary" disabled={submitting}>
          {submitting && <Loader2 size={12} className="animate-spin mr-1" />}
          {kr ? 'Save changes' : 'Add key result'}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-caption font-medium t-secondary block mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </span>
      {children}
    </label>
  );
}

function selectCls(): string {
  return 'w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-sm t-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
}
