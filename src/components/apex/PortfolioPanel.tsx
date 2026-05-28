/**
 * <PortfolioPanel> — Apex Initiative Portfolio surface.
 *
 * Renders the tenant's strategic initiatives + capital allocation rollup
 * by business unit. Includes a stat strip, capital allocation visual,
 * initiative table with gate progression, and admin+ mutations.
 *
 * Lives inside the Apex page tabs. Data plumbed via api.apex.portfolio.
 *
 * Emil-grade craft: scale(0.97) press feedback, transform/opacity only,
 * cubic-bezier(0.23, 1, 0.32, 1) for entries; ease-in is never used.
 */

import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Modal } from '@/components/ui/modal';
import {
  Briefcase,
  Plus,
  Pencil,
  Trash2,
  Loader2,
  RefreshCw,
  Layers,
  Wallet,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type Gate = 'discovery' | 'build' | 'scale' | 'done' | 'killed';
type RAG = 'green' | 'amber' | 'red';

interface Initiative {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  sponsor: string | null;
  owner: string | null;
  gate: Gate;
  status: RAG;
  planned_value_zar: number;
  actual_value_zar: number;
  spend_to_date_zar: number;
  budget_zar: number;
  start_date: string | null;
  target_completion_date: string | null;
  business_unit: string | null;
  linked_objective_id: string | null;
  created_at: string;
  updated_at: string;
}

interface CapitalAllocation {
  unit: string;
  planned_value: number;
  actual_value: number;
  budget: number;
  spend_to_date: number;
  count: number;
}

interface PortfolioSummary {
  total: number;
  active: number;
  green: number;
  amber: number;
  red: number;
  total_planned_value: number;
  total_actual_value: number;
  total_budget: number;
  total_spend_to_date: number;
  capital_allocation: CapitalAllocation[];
}

const GATE_LABEL: Record<Gate, string> = {
  discovery: 'Discovery',
  build: 'Build',
  scale: 'Scale',
  done: 'Done',
  killed: 'Killed',
};

const GATE_ORDER: Gate[] = ['discovery', 'build', 'scale', 'done', 'killed'];

function fmtZAR(n: number): string {
  if (n === 0) return 'R 0';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `R ${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `R ${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `R ${(n / 1e3).toFixed(1)}k`;
  return `R ${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function pct(num: number, denom: number): number {
  if (denom === 0) return 0;
  return Math.max(0, Math.min(100, Math.round((num / denom) * 100)));
}

interface PortfolioPanelProps {
  tenantId?: string;
}

export function PortfolioPanel({ tenantId }: PortfolioPanelProps) {
  const currentUser = useAppStore((s) => s.user);
  const canEdit = useMemo(() => {
    const role = currentUser?.role;
    return role === 'superadmin' || role === 'support_admin' || role === 'admin' || role === 'executive';
  }, [currentUser?.role]);

  const [initiatives, setInitiatives] = useState<Initiative[]>([]);
  const [summary, setSummary] = useState<PortfolioSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<Initiative | null>(null);

  const [gateFilter, setGateFilter] = useState<Gate | 'all'>('all');
  const [unitFilter, setUnitFilter] = useState<string>('all');

  const load = useCallback(async (opts: { showLoading?: boolean } = { showLoading: true }) => {
    try {
      if (opts.showLoading) setLoading(true);
      else setRefreshing(true);
      setError(null);
      const data = await api.apex.portfolio.list(tenantId);
      setInitiatives(data.initiatives);
      setSummary(data.summary);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load portfolio');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [tenantId]);

  useEffect(() => { load({ showLoading: true }); }, [load]);

  const deleteInitiative = async (init: Initiative) => {
    if (!confirm(`Delete initiative "${init.name}"? This cannot be undone.`)) return;
    try {
      await api.apex.portfolio.remove(init.id);
      await load({ showLoading: false });
    } catch (e) {
      alert(e instanceof Error ? e.message : 'Failed to delete initiative');
    }
  };

  const businessUnits = useMemoUnits(initiatives);

  if (loading) return <LoadingState variant="cards" count={3} />;
  if (error) return <ErrorState title="Couldn't load portfolio" error={error} onRetry={() => load({ showLoading: true })} />;

  const filtered = initiatives.filter((i) => {
    if (gateFilter !== 'all' && i.gate !== gateFilter) return false;
    if (unitFilter !== 'all' && (i.business_unit ?? 'Unassigned') !== unitFilter) return false;
    return true;
  });

  const sorted = [...filtered].sort((a, b) => {
    // RAG severity, then gate progression, then by planned value desc.
    const rag = (s: RAG) => (s === 'red' ? 0 : s === 'amber' ? 1 : 2);
    if (rag(a.status) !== rag(b.status)) return rag(a.status) - rag(b.status);
    const gateIdx = (g: Gate) => GATE_ORDER.indexOf(g);
    if (gateIdx(a.gate) !== gateIdx(b.gate)) return gateIdx(a.gate) - gateIdx(b.gate);
    return b.planned_value_zar - a.planned_value_zar;
  });

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Briefcase size={16} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold t-primary">Initiative Portfolio</h3>
            <p className="text-caption t-muted">Strategic investments + capital allocation rollup</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button variant="secondary" size="sm" onClick={() => load({ showLoading: false })} disabled={refreshing}>
            {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
            <span className="ml-1">Refresh</span>
          </Button>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={() => { setEditing(null); setShowModal(true); }}>
              <Plus size={12} /> <span className="ml-1">New Initiative</span>
            </Button>
          )}
        </div>
      </div>

      {/* Summary metrics */}
      {summary && summary.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <MetricTile label="Active" value={summary.active} sublabel={`of ${summary.total} total`} />
          <MetricTile label="Planned Value" value={fmtZAR(summary.total_planned_value)} tone="accent" />
          <MetricTile label="Realised Value" value={fmtZAR(summary.total_actual_value)} sublabel={summary.total_planned_value > 0 ? `${pct(summary.total_actual_value, summary.total_planned_value)}% of plan` : undefined} />
          <MetricTile label="Spend / Budget" value={`${fmtZAR(summary.total_spend_to_date)} / ${fmtZAR(summary.total_budget)}`} sublabel={summary.total_budget > 0 ? `${pct(summary.total_spend_to_date, summary.total_budget)}% utilised` : undefined} />
        </div>
      )}

      {/* RAG strip */}
      {summary && summary.total > 0 && (
        <Card size="compact">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2">
              <Layers size={14} className="t-muted" />
              <span className="text-caption font-medium t-secondary">Portfolio Status</span>
            </div>
            <div className="flex items-center gap-3 flex-wrap">
              <StatusPill status="green" density="dot" size="sm" label={`${summary.green} on track`} />
              <StatusPill status="amber" density="dot" size="sm" label={`${summary.amber} at risk`} />
              <StatusPill status="red" density="dot" size="sm" label={`${summary.red} off track`} />
            </div>
          </div>
          {/* Stacked RAG bar — width-only animation acceptable here:
              this bar paints once on data load, not on every interaction. */}
          <div className="mt-3 h-2 w-full rounded-full overflow-hidden flex bg-[var(--bg-secondary)]">
            {summary.green > 0 && <div className="bg-emerald-500" style={{ width: `${(summary.green / Math.max(summary.active, 1)) * 100}%` }} />}
            {summary.amber > 0 && <div className="bg-amber-500" style={{ width: `${(summary.amber / Math.max(summary.active, 1)) * 100}%` }} />}
            {summary.red > 0 && <div className="bg-red-500" style={{ width: `${(summary.red / Math.max(summary.active, 1)) * 100}%` }} />}
          </div>
        </Card>
      )}

      {/* Capital allocation by business unit */}
      {summary && summary.capital_allocation.length > 0 && (
        <Card size="compact">
          <div className="flex items-center gap-2 mb-3">
            <Wallet size={14} className="t-muted" />
            <h4 className="text-sm font-semibold t-primary">Capital Allocation by Business Unit</h4>
          </div>
          <div className="space-y-3">
            {summary.capital_allocation
              .slice()
              .sort((a, b) => b.planned_value - a.planned_value)
              .map((row) => (
                <CapitalAllocationRow
                  key={row.unit}
                  row={row}
                  maxPlanned={Math.max(...summary.capital_allocation.map((r) => r.planned_value), 1)}
                />
              ))}
          </div>
        </Card>
      )}

      {/* Filter strip */}
      {initiatives.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap text-caption">
          <span className="t-muted">Filter:</span>
          <select value={gateFilter} onChange={(e) => setGateFilter(e.target.value as Gate | 'all')} className={filterCls()}>
            <option value="all">All gates</option>
            {GATE_ORDER.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
          </select>
          <select value={unitFilter} onChange={(e) => setUnitFilter(e.target.value)} className={filterCls()}>
            <option value="all">All business units</option>
            {businessUnits.map((u) => <option key={u} value={u}>{u}</option>)}
          </select>
          <span className="t-muted ml-2">{sorted.length} of {initiatives.length}</span>
        </div>
      )}

      {/* Initiatives table */}
      {sorted.length === 0 ? (
        initiatives.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No strategic initiatives yet"
            description={canEdit
              ? "Initiatives are the in-flight bets the business has made. Capture each one — the gate it's in, its planned value, and budget — so the executive team can see where capital is being deployed."
              : "Ask an executive or admin to add the strategic initiatives the business has committed to."}
            action={canEdit ? { label: 'New Initiative', onClick: () => { setEditing(null); setShowModal(true); } } : undefined}
          />
        ) : (
          <Card>
            <p className="text-caption t-muted text-center py-8">No initiatives match the current filters.</p>
          </Card>
        )
      ) : (
        <div className="space-y-3">
          {sorted.map((init) => (
            <InitiativeRow
              key={init.id}
              initiative={init}
              canEdit={canEdit}
              onEdit={() => { setEditing(init); setShowModal(true); }}
              onDelete={() => deleteInitiative(init)}
            />
          ))}
        </div>
      )}

      {showModal && (
        <InitiativeFormModal
          initiative={editing}
          onClose={() => { setShowModal(false); setEditing(null); }}
          onSaved={async () => {
            setShowModal(false);
            setEditing(null);
            await load({ showLoading: false });
          }}
        />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────

function useMemoUnits(initiatives: Initiative[]): string[] {
  return useMemo(() => {
    const set = new Set<string>();
    for (const i of initiatives) set.add(i.business_unit ?? 'Unassigned');
    return [...set].sort();
  }, [initiatives]);
}

function filterCls(): string {
  return 'bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-2 py-1 text-caption t-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
}

function selectCls(): string {
  return 'w-full bg-[var(--bg-secondary)] border border-[var(--border-subtle)] rounded-md px-3 py-2 text-sm t-primary focus:outline-none focus:ring-2 focus:ring-[var(--accent)]/40';
}

// ─────────────────────────────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────────────────────────────

function MetricTile({ label, value, sublabel, tone }: { label: string; value: string | number; sublabel?: string; tone?: 'accent' }) {
  return (
    <Card size="compact">
      <p className="text-caption t-muted">{label}</p>
      <p className={`text-headline-md font-semibold ${tone === 'accent' ? 'text-accent' : 't-primary'} mt-1 tabular-nums`}>{value}</p>
      {sublabel && <p className="text-caption t-muted mt-0.5">{sublabel}</p>}
    </Card>
  );
}

function CapitalAllocationRow({ row, maxPlanned }: { row: CapitalAllocation; maxPlanned: number }) {
  const planPct = pct(row.planned_value, maxPlanned);
  const realisedPct = pct(row.actual_value, row.planned_value);
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm font-medium t-primary truncate">{row.unit}</span>
          <span className="text-caption t-muted">·</span>
          <span className="text-caption t-muted">{row.count} initiative{row.count === 1 ? '' : 's'}</span>
        </div>
        <div className="flex items-center gap-3 text-caption">
          <span className="t-secondary tabular-nums">{fmtZAR(row.planned_value)}</span>
          <span className="t-muted">·</span>
          <span className="t-muted tabular-nums">{realisedPct}% realised</span>
        </div>
      </div>
      <div className="relative h-2 w-full rounded-full overflow-hidden bg-[var(--bg-secondary)]">
        {/* Planned (light) */}
        <div className="absolute inset-y-0 left-0 bg-[var(--accent)]/30" style={{ width: `${planPct}%` }} />
        {/* Realised (solid, capped by planned bar width) */}
        <div
          className="absolute inset-y-0 left-0 bg-[var(--accent)]"
          style={{ width: `${pct(row.actual_value, maxPlanned)}%` }}
        />
      </div>
    </div>
  );
}

function InitiativeRow({ initiative, canEdit, onEdit, onDelete }: {
  initiative: Initiative;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const init = initiative;
  const valueRealised = init.planned_value_zar > 0 ? pct(init.actual_value_zar, init.planned_value_zar) : 0;
  const budgetUsed = init.budget_zar > 0 ? pct(init.spend_to_date_zar, init.budget_zar) : 0;
  return (
    <Card size="compact" className="group">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        {/* Left — identity + gate */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h4 className="text-sm font-semibold t-primary">{init.name}</h4>
            <StatusPill status={init.status} density="dot" size="sm" />
          </div>
          {init.description && (
            <p className="text-caption t-muted mt-1 line-clamp-2">{init.description}</p>
          )}
          <div className="flex items-center gap-3 mt-2 text-caption t-muted flex-wrap">
            {init.business_unit && <span>BU: <span className="t-secondary">{init.business_unit}</span></span>}
            {init.sponsor && <span>Sponsor: <span className="t-secondary">{init.sponsor}</span></span>}
            {init.owner && <span>Owner: <span className="t-secondary">{init.owner}</span></span>}
            {init.target_completion_date && <span>Target: <span className="t-secondary">{init.target_completion_date}</span></span>}
          </div>
        </div>

        {/* Right — gate progression + values */}
        <div className="flex flex-col items-end gap-2 min-w-[12rem]">
          <GateProgressionBar gate={init.gate} />
          <div className="text-right text-caption">
            <div className="t-muted">Value <span className="t-primary tabular-nums">{fmtZAR(init.actual_value_zar)}</span> / {fmtZAR(init.planned_value_zar)}</div>
            {init.planned_value_zar > 0 && <div className="t-muted">{valueRealised}% realised</div>}
            <div className="t-muted mt-1">Spend <span className="t-primary tabular-nums">{fmtZAR(init.spend_to_date_zar)}</span> / {fmtZAR(init.budget_zar)}</div>
            {init.budget_zar > 0 && (
              <div className={budgetUsed > 100 ? 'text-red-400' : budgetUsed > 90 ? 'text-amber-400' : 't-muted'}>
                {budgetUsed}% of budget
              </div>
            )}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="flex items-center justify-end gap-1 mt-3 pt-3 border-t border-[var(--border-subtle)] opacity-0 group-hover:opacity-100 transition-opacity">
          <Button variant="ghost" size="sm" onClick={onEdit}>
            <Pencil size={12} /> <span className="ml-1">Edit</span>
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 size={12} /> <span className="ml-1 text-red-400">Delete</span>
          </Button>
        </div>
      )}
    </Card>
  );
}

function GateProgressionBar({ gate }: { gate: Gate }) {
  // 5-step gate visual: discovery → build → scale → done. `killed` is rendered
  // separately as a strike-through pill — it's not a normal progression point.
  if (gate === 'killed') {
    return <StatusPill status="failed" size="sm" label="Killed" />;
  }
  const stages: Exclude<Gate, 'killed'>[] = ['discovery', 'build', 'scale', 'done'];
  const activeIdx = stages.indexOf(gate);
  return (
    <div className="flex items-center gap-1.5">
      {stages.map((s, i) => (
        <div key={s} className="flex items-center gap-1.5">
          <div
            className="flex flex-col items-center"
            aria-label={`Gate: ${GATE_LABEL[s]}${i === activeIdx ? ' (current)' : ''}`}
          >
            <span
              className={`h-2 w-2 rounded-full transition-colors ${
                i < activeIdx ? 'bg-emerald-500' :
                i === activeIdx ? 'bg-[var(--accent)] ring-2 ring-[var(--accent)]/30' :
                'bg-[var(--bg-secondary)] border border-[var(--border-subtle)]'
              }`}
            />
            <span className={`text-[9px] uppercase tracking-wider mt-1 ${i === activeIdx ? 't-primary font-semibold' : 't-muted'}`}>
              {GATE_LABEL[s]}
            </span>
          </div>
          {i < stages.length - 1 && (
            <span className={`h-px w-3 ${i < activeIdx ? 'bg-emerald-500' : 'bg-[var(--border-subtle)]'}`} aria-hidden="true" />
          )}
        </div>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Form modal
// ─────────────────────────────────────────────────────────────────────

interface InitiativeFormModalProps {
  initiative: Initiative | null;
  onClose: () => void;
  onSaved: () => void;
}

function InitiativeFormModal({ initiative, onClose, onSaved }: InitiativeFormModalProps) {
  const [name, setName] = useState(initiative?.name ?? '');
  const [description, setDescription] = useState(initiative?.description ?? '');
  const [sponsor, setSponsor] = useState(initiative?.sponsor ?? '');
  const [owner, setOwner] = useState(initiative?.owner ?? '');
  const [businessUnit, setBusinessUnit] = useState(initiative?.business_unit ?? '');
  const [gate, setGate] = useState<Gate>(initiative?.gate ?? 'discovery');
  const [status, setStatus] = useState<RAG>(initiative?.status ?? 'green');
  const [plannedValue, setPlannedValue] = useState<string>(initiative?.planned_value_zar?.toString() ?? '0');
  const [actualValue, setActualValue] = useState<string>(initiative?.actual_value_zar?.toString() ?? '0');
  const [budget, setBudget] = useState<string>(initiative?.budget_zar?.toString() ?? '0');
  const [spend, setSpend] = useState<string>(initiative?.spend_to_date_zar?.toString() ?? '0');
  const [startDate, setStartDate] = useState(initiative?.start_date ?? '');
  const [targetDate, setTargetDate] = useState(initiative?.target_completion_date ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setErr('Name is required'); return; }
    setSubmitting(true);
    setErr(null);
    try {
      const payload = {
        name: name.trim(),
        description: description.trim() || null,
        sponsor: sponsor.trim() || null,
        owner: owner.trim() || null,
        business_unit: businessUnit.trim() || null,
        gate,
        status,
        planned_value_zar: parseFloat(plannedValue) || 0,
        actual_value_zar: parseFloat(actualValue) || 0,
        budget_zar: parseFloat(budget) || 0,
        spend_to_date_zar: parseFloat(spend) || 0,
        start_date: startDate || null,
        target_completion_date: targetDate || null,
      };
      if (initiative) {
        await api.apex.portfolio.update(initiative.id, payload);
      } else {
        await api.apex.portfolio.create(payload);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Failed to save initiative');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal open onClose={onClose} size="lg" dismissible={!submitting}>
      <Modal.Header title={initiative ? 'Edit Initiative' : 'New Initiative'} onClose={onClose} />
      <Modal.Body>
        <form onSubmit={submit} className="space-y-4" id="initiative-form">
          <Field label="Name" required>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Migrate ERP to S/4HANA" autoFocus />
          </Field>
          <Field label="Description">
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Outcome, scope, and the business case"
              rows={3}
              className={selectCls()}
            />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Field label="Business unit"><Input value={businessUnit} onChange={(e) => setBusinessUnit(e.target.value)} placeholder="e.g. Finance, Ops, IT" /></Field>
            <Field label="Sponsor"><Input value={sponsor} onChange={(e) => setSponsor(e.target.value)} placeholder="e.g. CFO" /></Field>
            <Field label="Owner"><Input value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="e.g. R. Govender" /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Gate">
              <select value={gate} onChange={(e) => setGate(e.target.value as Gate)} className={selectCls()}>
                {GATE_ORDER.map((g) => <option key={g} value={g}>{GATE_LABEL[g]}</option>)}
              </select>
            </Field>
            <Field label="RAG status">
              <select value={status} onChange={(e) => setStatus(e.target.value as RAG)} className={selectCls()}>
                <option value="green">Green — on track</option>
                <option value="amber">Amber — at risk</option>
                <option value="red">Red — off track</option>
              </select>
            </Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Planned value (ZAR)"><Input type="number" step="any" value={plannedValue} onChange={(e) => setPlannedValue(e.target.value)} /></Field>
            <Field label="Realised value (ZAR)"><Input type="number" step="any" value={actualValue} onChange={(e) => setActualValue(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Budget (ZAR)"><Input type="number" step="any" value={budget} onChange={(e) => setBudget(e.target.value)} /></Field>
            <Field label="Spend to date (ZAR)"><Input type="number" step="any" value={spend} onChange={(e) => setSpend(e.target.value)} /></Field>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Start date">
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className={selectCls()} />
            </Field>
            <Field label="Target completion">
              <input type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={selectCls()} />
            </Field>
          </div>
          {err && <p className="text-sm text-red-400">{err}</p>}
        </form>
      </Modal.Body>
      <Modal.Footer>
        <Button type="button" variant="secondary" onClick={onClose} disabled={submitting}>Cancel</Button>
        <Button type="submit" form="initiative-form" variant="primary" disabled={submitting}>
          {submitting && <Loader2 size={12} className="animate-spin mr-1" />}
          {initiative ? 'Save changes' : 'Create initiative'}
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
