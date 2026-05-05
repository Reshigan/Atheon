/**
 * Cash Application Review — Phase 10-30 / 10-31.
 *
 * Audit + HITL surface for AR-side action subcatalysts:
 *   - ar-cash-application      (auto-applied receipts, one-click revert via Skip)
 *   - ar-credit-hold           (customer holds — review or release)
 *   - ar-dunning-executor      (sent dunning notices — verify cadence)
 *   - ar-invoice-generator     (auto-generated AR invoices from SOs)
 *
 * Most rows are 'posted' (auto-approved). The page focuses on
 * showing what the bots did so an AR controller can spot anomalies
 * without combing through the audit log.
 *
 * Route: /cash-application   |   Roles: operator+
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { TransactionalActionListItem, TransactionalActionDetail } from '@/lib/api';
import { Loader2, RefreshCw, CheckCircle2, XCircle, Eye, FileText, AlertTriangle } from 'lucide-react';

const AR_SUBCATALYSTS = new Set([
  'ar-cash-application',
  'ar-credit-hold',
  'ar-dunning-executor',
  'ar-invoice-generator',
]);

const STATUS_BADGE: Record<string, { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string }> = {
  pending: { variant: 'outline', label: 'Pending' },
  approved: { variant: 'secondary', label: 'Approved' },
  posted: { variant: 'default', label: 'Posted' },
  failed: { variant: 'destructive', label: 'Failed' },
  skipped: { variant: 'secondary', label: 'Skipped' },
};

function formatCurrency(value: number | null, currency: string): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: currency || 'ZAR', maximumFractionDigits: 0 }).format(value);
}

function formatAge(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 60) return `${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

interface SummaryRow {
  sub_catalyst_name: string;
  status: string;
  n: number;
  total_value: number;
}

export function CashApplicationReviewPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TransactionalActionListItem[]>([]);
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('posted');
  const [selected, setSelected] = useState<TransactionalActionDetail | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [list, sum] = await Promise.all([
        api.transactionalActions.list({ status: statusFilter, limit: 200 }),
        api.transactionalActions.summaryCounts(),
      ]);
      setItems(list.actions.filter((a) => AR_SUBCATALYSTS.has(a.sub_catalyst_name)));
      setSummary(sum.counts.filter((c) => AR_SUBCATALYSTS.has(c.sub_catalyst_name)));
    } catch (err) {
      toast.error('Failed to load cash application activity', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [statusFilter, toast]);

  useEffect(() => { load(); }, [load]);

  const openDetail = useCallback(async (id: string) => {
    try {
      const res = await api.transactionalActions.detail(id);
      setSelected(res.action);
    } catch (err) {
      toast.error('Failed to load detail', { message: err instanceof Error ? err.message : 'Unknown error' });
    }
  }, [toast]);

  const handleApprove = useCallback(async () => {
    if (!selected) return;
    setActionLoading(true);
    try {
      await api.transactionalActions.approve(selected.id);
      toast.success('Approved + dispatched');
      setSelected(null);
      load();
    } catch (err) {
      toast.error('Approve failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setActionLoading(false);
    }
  }, [selected, toast, load]);

  const handleSkip = useCallback(async () => {
    if (!selected) return;
    const reason = window.prompt('Reason for skipping/reverting (optional):') || '';
    setActionLoading(true);
    try {
      await api.transactionalActions.skip(selected.id, reason);
      toast.success('Skipped', { message: reason || 'No reason provided' });
      setSelected(null);
      load();
    } catch (err) {
      toast.error('Skip failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setActionLoading(false);
    }
  }, [selected, toast, load]);

  // Build per-subcatalyst tile data from the summary endpoint
  const tilesBySub = Array.from(AR_SUBCATALYSTS).map((sub) => {
    const rows = summary.filter((s) => s.sub_catalyst_name === sub);
    const total = rows.reduce((acc, r) => acc + r.n, 0);
    const posted = rows.find((r) => r.status === 'posted')?.n ?? 0;
    const value = rows.reduce((acc, r) => acc + (r.total_value || 0), 0);
    return { sub, total, posted, value };
  });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Cash Application Review</h1>
          <p className="text-sm text-muted-foreground">AR receipts · credit holds · dunning · auto-generated invoices</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border bg-background px-3 py-1 text-sm"
          >
            <option value="posted">Posted (auto-applied)</option>
            <option value="pending">Pending</option>
            <option value="failed">Failed</option>
            <option value="skipped">Skipped / reverted</option>
          </select>
          <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Per-subcatalyst summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {tilesBySub.map((t) => (
          <Card key={t.sub} className="p-3">
            <div className="text-xs text-muted-foreground">{t.sub}</div>
            <div className="text-2xl font-semibold">{t.total}</div>
            <div className="text-xs text-muted-foreground">{t.posted} posted · {formatCurrency(t.value, 'ZAR')}</div>
          </Card>
        ))}
      </div>

      {/* Activity table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <FileText className="h-8 w-8" />
            <div className="text-sm">No {statusFilter} AR activity in window.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Subcatalyst</th>
                  <th className="px-3 py-2 text-left font-medium">Source ref</th>
                  <th className="px-3 py-2 text-left font-medium">Action</th>
                  <th className="px-3 py-2 text-right font-medium">Value</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Reasoning</th>
                  <th className="px-3 py-2 text-right font-medium">Age</th>
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => {
                  const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE.posted;
                  return (
                    <tr key={a.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{a.sub_catalyst_name}</td>
                      <td className="px-3 py-2 font-mono text-xs">{a.source_record_ref ?? '—'}</td>
                      <td className="px-3 py-2 text-xs">{a.action_type}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{formatCurrency(a.posted_value, a.currency)}</td>
                      <td className="px-3 py-2"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                      <td className="px-3 py-2 max-w-md truncate text-xs text-muted-foreground" title={a.reasoning ?? ''}>
                        {a.reasoning ?? '—'}
                      </td>
                      <td className="px-3 py-2 text-right text-xs text-muted-foreground">{formatAge(a.created_at)}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => openDetail(a.id)}
                          className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted"
                        >
                          <Eye className="h-3 w-3" /> Detail
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Detail modal */}
      {selected && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={() => setSelected(null)}>
          <Card className="max-h-[90vh] w-full max-w-3xl overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="border-b p-4">
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-muted-foreground" />
                    <h2 className="text-lg font-semibold">{selected.sub_catalyst_name}</h2>
                    <Badge variant={STATUS_BADGE[selected.status]?.variant ?? 'outline'}>
                      {STATUS_BADGE[selected.status]?.label ?? selected.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {selected.action_type} · {selected.target_entity} · {formatCurrency(selected.posted_value, selected.currency)}
                  </div>
                </div>
                <button onClick={() => setSelected(null)} className="rounded p-1 hover:bg-muted">
                  <XCircle className="h-5 w-5" />
                </button>
              </div>
            </div>
            <div className="max-h-[60vh] overflow-auto p-4 text-sm">
              <div className="mb-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Reasoning</div>
                <div className="mt-1">{selected.reasoning ?? '—'}</div>
              </div>
              {selected.error && (
                <div className="mb-3 rounded border border-destructive/30 bg-destructive/10 p-2 text-xs">
                  <div className="flex items-center gap-1 font-semibold"><AlertTriangle className="h-3 w-3" /> Error</div>
                  <div className="mt-1 font-mono">{selected.error}</div>
                </div>
              )}
              <div className="mb-3">
                <div className="text-xs font-semibold uppercase text-muted-foreground">Payload</div>
                <pre className="mt-1 max-h-72 overflow-auto rounded bg-muted/40 p-2 text-xs">
                  {JSON.stringify(selected.payload, null, 2)}
                </pre>
              </div>
              <div className="mb-3 grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">Idempotency key:</span> <span className="font-mono">{selected.idempotency_key}</span></div>
                <div><span className="text-muted-foreground">Payload hash:</span> <span className="font-mono">{selected.payload_hash?.slice(0, 16)}…</span></div>
                <div><span className="text-muted-foreground">Posted at:</span> {selected.posted_at ? new Date(selected.posted_at).toLocaleString() : '—'}</div>
                <div><span className="text-muted-foreground">External doc:</span> {selected.external_doc_id ?? '—'}</div>
              </div>
            </div>
            {(selected.status === 'pending' || selected.status === 'posted') && (
              <div className="flex justify-end gap-2 border-t p-3">
                <button
                  onClick={handleSkip}
                  disabled={actionLoading}
                  className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                  title={selected.status === 'posted' ? 'Mark this auto-applied receipt as needing manual review' : 'Skip this pending action'}
                >
                  <XCircle className="h-4 w-4" /> {selected.status === 'posted' ? 'Flag for revert' : 'Skip'}
                </button>
                {selected.status === 'pending' && (
                  <button
                    onClick={handleApprove}
                    disabled={actionLoading}
                    className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                    Approve & Post
                  </button>
                )}
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default CashApplicationReviewPage;
