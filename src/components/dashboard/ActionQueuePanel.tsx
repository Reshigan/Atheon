/**
 * ActionQueuePanel — shared component for surfacing write-back actions.
 *
 * Used across:
 *   - Dashboard (compact: just pending count + open the queue)
 *   - PulsePage (operational: throughput + recent activity)
 *   - ApexPage (executive: high-value pending + value at stake)
 *   - IntegrationsPage (per-connection drilldown — different component
 *     because it's scoped to one connection)
 *
 * Three render modes via the `variant` prop:
 *   - 'compact' — single card, count + value + "Review" CTA
 *   - 'operational' — full table with approve/reject inline
 *   - 'executive' — high-value subset with rationale
 *
 * Phase 1 / WORLD_CLASS §A.2: columns where every visible row carries no
 * value are NOT rendered. The table reduces to the columns that actually
 * answer a question. Status, Value, Mode pill, Created — each gated.
 * Status renders via the canonical <StatusPill> primitive; values via
 * <Numeric> for tabular-nums alignment.
 */

import { Fragment, useEffect, useMemo, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StatusPill, type StatusKind } from '@/components/ui/status-pill';
import { Numeric } from '@/components/ui/numeric';
import { api, ApiError } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, Inbox, Zap, ChevronRight, FileText } from 'lucide-react';

type ActionRow = Awaited<ReturnType<typeof api.erp.listAllActions>>['actions'][number];
type Summary = Awaited<ReturnType<typeof api.erp.actionsSummary>>['summary'];

interface ActionQueuePanelProps {
  variant: 'compact' | 'operational' | 'executive';
  /** Title override; defaults are variant-specific. */
  title?: string;
  /** Limit how many rows are shown in operational/executive variants. */
  limit?: number;
  /** When true, inline approve/reject buttons are shown (operational). */
  allowApprove?: boolean;
}

/** Concise relative time — "2h ago" / "3d ago" / "just now". Falls back to
 *  the locale date string for anything > 60 days. */
function relTime(iso?: string | null): string {
  if (!iso) return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '—';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 60) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

/** Map the backend's action status string to a StatusKind from the
 *  canonical pill vocabulary. Unknown strings render as neutral. */
function statusToKind(s: string | null | undefined): StatusKind {
  if (!s) return 'pending';
  if (s === 'pending_approval') return 'pending';
  if (s === 'in_progress') return 'in_progress';
  if (s === 'completed') return 'completed';
  if (s === 'verified') return 'verified';
  if (s === 'failed') return 'failed';
  if (s === 'rejected') return 'rejected';
  if (s === 'deferred') return 'deferred';
  return 'info';
}

export function ActionQueuePanel({
  variant, title, limit, allowApprove = false,
}: ActionQueuePanelProps): JSX.Element {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api.erp.actionsSummary(),
        api.erp.listAllActions({
          status: variant === 'executive' ? 'pending_approval' : undefined,
          limit: limit || 25,
        }),
      ]);
      setSummary(s.summary);
      setActions(a.actions);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load actions');
    } finally {
      setLoading(false);
    }
  }, [variant, limit]);

  useEffect(() => { void load(); }, [load]);

  const handleApprove = useCallback(async (a: ActionRow) => {
    if (!a.connection_id) return;
    setPendingId(a.id);
    setError(null);
    try {
      await api.erp.approveAction(a.connection_id, a.id);
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Approve failed'); }
    finally { setPendingId(null); }
  }, [load]);

  const handleReject = useCallback(async (a: ActionRow) => {
    if (!a.connection_id) return;
    setPendingId(a.id);
    setError(null);
    try {
      await api.erp.rejectAction(a.connection_id, a.id, 'Rejected via dashboard');
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : 'Reject failed'); }
    finally { setPendingId(null); }
  }, [load]);

  // Column visibility — every column is gated on "at least one row has data".
  // Empty columns waste the operator's eye. This is the heart of the §A.2 fix.
  const columns = useMemo(() => {
    const hasValue = actions.some(a => Number.isFinite(a.value_zar) && (a.value_zar as number) > 0);
    const hasMode = actions.some(a => {
      const out = a.output as { mode?: 'live' | 'stub' | 'preview' } | null;
      return !!out?.mode;
    });
    return { hasValue, hasMode };
  }, [actions]);

  // ────────────────────────────────────────────────────────────
  // Compact variant — single card with one number; gated on summary.
  // ────────────────────────────────────────────────────────────
  if (variant === 'compact') {
    const pending = summary?.pending_approval_count ?? 0;
    const valueAtStake = summary?.pending_approval_value_zar ?? 0;
    return (
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Inbox size={18} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-caption t-muted">Actions awaiting approval</p>
            {loading ? (
              <span className="t-muted"><Loader2 size={14} className="animate-spin inline" /></span>
            ) : (
              <Numeric value={pending} size="xl" tone={pending > 0 ? 'negative' : 'mute'} />
            )}
            {!loading && valueAtStake > 0 && (
              <p className="text-caption t-muted">
                <Numeric value={valueAtStake} unit="ZAR" compact size="sm" tone="mute" /> at stake
              </p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  // ────────────────────────────────────────────────────────────
  // Operational / executive variant — table with conditional columns.
  // ────────────────────────────────────────────────────────────
  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-h2 t-primary flex items-center gap-2">
            <Zap size={14} /> {title || (variant === 'executive' ? 'Pending high-value actions' : 'Action Queue')}
          </h3>
          {!loading && summary && (
            <p className="text-caption t-muted">
              {summary.pending_approval_count} pending · {summary.completed_count} completed
              {summary.completed_value_zar > 0 && (
                <> · <Numeric value={summary.completed_value_zar} unit="ZAR" compact size="sm" tone="mute" /> acted on</>
              )}
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-caption">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-body-sm t-muted py-4 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : actions.length === 0 ? (
        <div className="text-body-sm t-muted py-4 text-center">No actions to review.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead>
              <tr className="border-b border-[var(--border-card)] text-left t-muted">
                <th className="py-1 pr-3 font-medium text-label">Catalyst</th>
                <th className="py-1 pr-3 font-medium text-label">Action</th>
                {columns.hasValue && (
                  <th className="py-1 pr-3 font-medium text-label text-right">Value</th>
                )}
                <th className="py-1 pr-3 font-medium text-label">Status</th>
                <th className="py-1 pr-3 font-medium text-label">Created</th>
                {allowApprove && (
                  <th className="py-1 pr-3 font-medium text-label">Actions</th>
                )}
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => {
                const out = a.output as { mode?: 'live' | 'stub' | 'preview'; summary?: string } | null;
                const hasDetail = !!a.reasoning || !!out?.summary || !!a.source_finding_id;
                const isExpanded = expandedId === a.id;
                const toggle = () => setExpandedId(isExpanded ? null : a.id);
                return (
                  <Fragment key={a.id}>
                  <tr
                    className={`border-b border-[var(--border-card)]/50 ${hasDetail ? 'cursor-pointer hover:bg-[var(--bg-secondary)]/40' : ''}`}
                    onClick={hasDetail ? toggle : undefined}
                    role={hasDetail ? 'button' : undefined}
                    tabIndex={hasDetail ? 0 : undefined}
                    aria-expanded={hasDetail ? isExpanded : undefined}
                    aria-label={hasDetail ? `${a.catalyst_name}: ${a.action_type}. ${isExpanded ? 'Hide' : 'Show'} reasoning and outcome.` : undefined}
                    onKeyDown={hasDetail ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}
                  >
                    <td className="py-1.5 pr-3 t-primary">
                      <div className="flex items-center gap-1.5">
                        {hasDetail && (
                          <ChevronRight
                            size={12}
                            className={`t-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                            aria-hidden="true"
                          />
                        )}
                        {a.catalyst_name}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 font-mono t-muted">{a.action_type}</td>
                    {columns.hasValue && (
                      <td className="py-1.5 pr-3 text-right">
                        <Numeric
                          value={Number.isFinite(a.value_zar) && (a.value_zar as number) > 0 ? (a.value_zar as number) : null}
                          unit="ZAR"
                          compact
                          size="sm"
                        />
                      </td>
                    )}
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <StatusPill status={statusToKind(a.status)} size="sm" />
                        {/* v64 — execution mode (live vs stub) only renders when
                            present. Stops "completed" + bare row when mode is unset. */}
                        {columns.hasMode && out?.mode && (
                          <StatusPill
                            status={out.mode === 'live' ? 'verified' : out.mode === 'stub' ? 'pending' : 'info'}
                            label={out.mode}
                            size="sm"
                            density="outline"
                            noGlyph
                          />
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 t-muted tabular-nums" title={a.created_at ?? ''}>
                      {relTime(a.created_at)}
                    </td>
                    {allowApprove && (
                      <td className="py-1.5 pr-3" onClick={(e) => e.stopPropagation()}>
                        {a.status === 'pending_approval' ? (
                          <div className="flex items-center gap-1">
                            <Button variant="ghost" size="sm"
                              onClick={() => void handleApprove(a)} disabled={pendingId === a.id}
                              title="Approve and execute">
                              {pendingId === a.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve
                            </Button>
                            <Button variant="ghost" size="sm" className="text-red-400 hover:text-red-300"
                              onClick={() => void handleReject(a)} disabled={pendingId === a.id}>
                              <XCircle size={12} /> Reject
                            </Button>
                          </div>
                        ) : (
                          <span className="opacity-40" aria-label="No action available">—</span>
                        )}
                      </td>
                    )}
                  </tr>
                  {hasDetail && isExpanded && (
                    <tr className="border-b border-[var(--border-card)]/50 bg-[var(--bg-secondary)]/40">
                      <td colSpan={2 + (columns.hasValue ? 1 : 0) + 2 + (allowApprove ? 1 : 0)} className="px-3 py-3">
                        <div className="grid gap-3 md:grid-cols-2">
                          {a.reasoning && (
                            <div>
                              <p className="text-label t-muted mb-1 flex items-center gap-1.5">
                                <FileText size={11} aria-hidden="true" /> Why this is recommended
                              </p>
                              <p className="text-body-sm t-primary whitespace-pre-line">{a.reasoning}</p>
                            </div>
                          )}
                          {out?.summary && (
                            <div>
                              <p className="text-label t-muted mb-1 flex items-center gap-1.5">
                                <CheckCircle size={11} aria-hidden="true" /> Outcome ({out.mode ?? 'completed'})
                              </p>
                              <p className="text-body-sm t-primary whitespace-pre-line">{out.summary}</p>
                            </div>
                          )}
                          {a.source_finding_id && (
                            <div className="md:col-span-2">
                              <p className="text-label t-muted mb-1">Linked finding</p>
                              <code className="text-caption font-mono t-secondary break-all">{a.source_finding_id}</code>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
