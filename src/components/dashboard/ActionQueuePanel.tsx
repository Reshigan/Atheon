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
 */

import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { CheckCircle, XCircle, Loader2, Inbox, Zap } from 'lucide-react';

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

function ZAR(amount: number): string {
  if (!amount) return 'R 0';
  if (amount >= 1_000_000) return `R ${(amount / 1_000_000).toFixed(1)}m`;
  if (amount >= 1_000) return `R ${(amount / 1_000).toFixed(0)}k`;
  return `R ${amount.toFixed(0)}`;
}

export function ActionQueuePanel({ variant, title, limit, allowApprove = false }: ActionQueuePanelProps): JSX.Element {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [actions, setActions] = useState<ActionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, a] = await Promise.all([
        api.erp.actionsSummary(),
        api.erp.listAllActions({ status: variant === 'executive' ? 'pending_approval' : undefined, limit: limit || 25 }),
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

  if (variant === 'compact') {
    return (
      <Card>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
            <Inbox size={18} className="text-amber-400" />
          </div>
          <div className="flex-1">
            <p className="text-xs t-muted">Actions awaiting approval</p>
            {loading ? (
              <div className="text-base t-muted"><Loader2 size={14} className="animate-spin inline" /></div>
            ) : (
              <p className="text-2xl font-bold t-primary">{summary?.pending_approval_count ?? 0}</p>
            )}
            {!loading && summary && summary.pending_approval_value_zar > 0 && (
              <p className="text-xs t-muted">{ZAR(summary.pending_approval_value_zar)} value at stake</p>
            )}
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold t-primary flex items-center gap-2">
            <Zap size={14} /> {title || (variant === 'executive' ? 'Pending high-value actions' : 'Action Queue')}
          </h3>
          {!loading && summary && (
            <p className="text-xs t-muted">
              {summary.pending_approval_count} pending · {summary.completed_count} completed · {ZAR(summary.completed_value_zar)} acted on
            </p>
          )}
        </div>
        <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
          {loading ? <Loader2 size={12} className="animate-spin" /> : 'Refresh'}
        </Button>
      </div>

      {error && (
        <div className="mb-2 p-2 rounded bg-red-500/10 border border-red-500/20 text-red-400 text-xs">{error}</div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs t-muted py-4 justify-center">
          <Loader2 size={14} className="animate-spin" /> Loading…
        </div>
      ) : actions.length === 0 ? (
        <div className="text-xs t-muted py-4 text-center">No actions to review.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-[var(--border-card)] text-left t-muted">
                <th className="py-1 pr-3 font-medium">Catalyst</th>
                <th className="py-1 pr-3 font-medium">Action</th>
                <th className="py-1 pr-3 font-medium">Value</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 pr-3 font-medium">Created</th>
                {allowApprove && <th className="py-1 pr-3 font-medium">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {actions.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border-card)]/50">
                  <td className="py-1 pr-3 t-primary">{a.catalyst_name}</td>
                  <td className="py-1 pr-3 font-mono t-muted">{a.action_type}</td>
                  <td className="py-1 pr-3 t-primary">{ZAR(a.value_zar || 0)}</td>
                  <td className="py-1 pr-3">
                    <Badge variant={
                      a.status === 'completed' ? 'success'
                      : a.status === 'pending_approval' ? 'warning'
                      : a.status === 'rejected' || a.status === 'failed' ? 'danger'
                      : 'default'
                    } size="sm">{a.status}</Badge>
                    {(() => {
                      // v64 — surface execution mode (live vs stub) so the
                      // customer never confuses "completed (stub)" with a
                      // real ERP write. mode lives on a.output.mode for
                      // dispatcher-routed adapters.
                      const out = a.output as { mode?: 'live' | 'stub' | 'preview' } | null;
                      if (!out?.mode) return null;
                      const variant = out.mode === 'live' ? 'success' : out.mode === 'stub' ? 'warning' : 'info';
                      return <Badge variant={variant} size="sm" className="ml-1">{out.mode}</Badge>;
                    })()}
                  </td>
                  <td className="py-1 pr-3 t-muted">{a.created_at ? new Date(a.created_at).toLocaleString() : ''}</td>
                  {allowApprove && (
                    <td className="py-1 pr-3">
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
                        <span className="opacity-50">—</span>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
