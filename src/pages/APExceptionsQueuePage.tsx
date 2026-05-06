/**
 * AP Exceptions Queue — Phase 10-30 / 10-31.
 *
 * Operator console for the action-layer subcatalysts that produce
 * pending/failed transactional_actions on the AP side: 3-way match
 * blocks, duplicate-blocker holds, vendor-statement mismatches, PO
 * approval-router HITL items.
 *
 * Each row links to a detail modal that:
 *   - Renders the full payload (invoice, PO, GR, deltas)
 *   - Shows reasoning + payload hash (for provenance)
 *   - Offers Approve (auto-dispatches inline) and Skip (with reason)
 *
 * Route: /ap-exceptions   |   Roles: operator+
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { TransactionalActionListItem, TransactionalActionDetail } from '@/lib/api';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Eye, FileText } from 'lucide-react';

const AP_SUBCATALYSTS = new Set([
  'ap-three-way-match',
  'ap-duplicate-blocker',
  'ap-vendor-statement-recon',
  'ap-payment-run',
  'po-approval-router',
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

export function APExceptionsQueuePage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [items, setItems] = useState<TransactionalActionListItem[]>([]);
  const [statusFilter, setStatusFilter] = useState<string>('pending');
  const [selected, setSelected] = useState<TransactionalActionDetail | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  // Bulk-action selection state — set of row ids
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Pull all rows in the chosen status bucket; client-side filter to AP subcatalysts
      const res = await api.transactionalActions.list({ status: statusFilter, limit: 200 });
      setItems(res.actions.filter((a) => AP_SUBCATALYSTS.has(a.sub_catalyst_name)));
      // Drop any selected ids that are no longer in the list (status changed)
      setSelectedIds((prev) => {
        const stillThere = new Set<string>();
        const ids = new Set(res.actions.map((a) => a.id));
        for (const id of prev) if (ids.has(id)) stillThere.add(id);
        return stillThere;
      });
    } catch (err) {
      toast.error('Failed to load AP exceptions', {
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
      const res = await api.transactionalActions.approve(selected.id);
      toast.success('Approved + dispatched', { message: `Posted: ${res.dispatched.posted}, failed: ${res.dispatched.failed}` });
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
    const reason = window.prompt('Reason for skipping (optional):') || '';
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

  const counts = items.reduce<Record<string, number>>((acc, a) => {
    acc[a.sub_catalyst_name] = (acc[a.sub_catalyst_name] ?? 0) + 1;
    return acc;
  }, {});

  // ── Bulk action helpers ───────────────────────────────────────
  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  // Only pending rows are bulk-actionable. Approved/posted/etc. don't
  // make sense to bulk-mutate.
  const bulkActionable = items.filter((a) => a.status === 'pending');
  const allBulkSelected = bulkActionable.length > 0 && bulkActionable.every((a) => selectedIds.has(a.id));
  const someBulkSelected = bulkActionable.some((a) => selectedIds.has(a.id));

  const toggleSelectAll = useCallback(() => {
    setSelectedIds((prev) => {
      if (allBulkSelected) {
        // Deselect everything (across all statuses, in case some non-pending got picked)
        return new Set();
      }
      const next = new Set(prev);
      for (const a of bulkActionable) next.add(a.id);
      return next;
    });
  }, [allBulkSelected, bulkActionable]);

  const handleBulkApprove = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (!window.confirm(`Approve ${ids.length} action${ids.length === 1 ? '' : 's'}?\n\nEach will be staged for dispatch and posted to the ERP. This is irreversible once posted.`)) {
      return;
    }
    setBulkBusy(true);
    try {
      const res = await api.transactionalActions.bulkApprove(ids);
      const errCount = res.errors.length;
      const errSummary = errCount > 0 ? ` · ${errCount} error${errCount === 1 ? '' : 's'}` : '';
      toast.success(`Bulk approved ${res.approved}/${ids.length}`, {
        message: `Posted: ${res.dispatched.posted}, failed: ${res.dispatched.failed}${errSummary}`,
      });
      if (errCount > 0) {
        // Surface specific errors so the operator knows which rows didn't go through
        // eslint-disable-next-line no-console
        console.warn('Bulk approve errors:', res.errors);
      }
      setSelectedIds(new Set());
      load();
    } catch (err) {
      toast.error('Bulk approve failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, toast, load]);

  const handleBulkSkip = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const reason = window.prompt(
      `Skip ${ids.length} action${ids.length === 1 ? '' : 's'}?\n\nReason (will be stored on each row + audit log):`,
      '',
    );
    if (reason === null) return;
    setBulkBusy(true);
    try {
      const res = await api.transactionalActions.bulkSkip(ids, reason || undefined);
      const errCount = res.errors.length;
      toast.success(`Bulk skipped ${res.skipped}/${ids.length}`, {
        message: errCount > 0 ? `${errCount} error${errCount === 1 ? '' : 's'}` : 'All skipped',
      });
      setSelectedIds(new Set());
      load();
    } catch (err) {
      toast.error('Bulk skip failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBulkBusy(false);
    }
  }, [selectedIds, toast, load]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">AP Exceptions Queue</h1>
          <p className="text-sm text-muted-foreground">3-way match · duplicate · vendor-statement · payment-run · PO approval</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border bg-background px-3 py-1 text-sm"
          >
            <option value="pending">Pending (HITL)</option>
            <option value="failed">Failed</option>
            <option value="approved">Approved</option>
            <option value="posted">Posted</option>
            <option value="skipped">Skipped</option>
          </select>
          <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Sub-catalyst summary tiles */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        {Array.from(AP_SUBCATALYSTS).map((sub) => (
          <Card key={sub} className="p-3">
            <div className="text-xs text-muted-foreground">{sub}</div>
            <div className="text-2xl font-semibold">{counts[sub] ?? 0}</div>
          </Card>
        ))}
      </div>

      {/* Bulk action bar — only shows when there are selected pending rows */}
      {selectedIds.size > 0 && statusFilter === 'pending' && (
        <Card className="flex items-center justify-between bg-primary/5 p-3">
          <div className="text-sm">
            <strong>{selectedIds.size}</strong> selected
            <span className="ml-2 text-xs text-muted-foreground">(Escape to clear)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setSelectedIds(new Set())}
              className="rounded border px-3 py-1 text-xs hover:bg-muted"
            >
              Clear
            </button>
            <button
              onClick={handleBulkSkip}
              disabled={bulkBusy}
              className="flex items-center gap-1 rounded border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <XCircle className="h-3 w-3" />}
              Skip selected
            </button>
            <button
              onClick={handleBulkApprove}
              disabled={bulkBusy}
              className="flex items-center gap-1 rounded bg-primary px-3 py-1 text-xs text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {bulkBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              Approve & post selected
            </button>
          </div>
        </Card>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : items.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <CheckCircle2 className="h-8 w-8 text-green-500" />
            <div className="text-sm">No {statusFilter} AP exceptions — clean queue.</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 w-8">
                    {/* Header checkbox: select-all bulk-actionable (pending) rows */}
                    {bulkActionable.length > 0 && (
                      <input
                        type="checkbox"
                        checked={allBulkSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = !allBulkSelected && someBulkSelected;
                        }}
                        onChange={toggleSelectAll}
                        title={allBulkSelected ? 'Deselect all' : 'Select all pending'}
                        className="cursor-pointer"
                      />
                    )}
                  </th>
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
                  const badge = STATUS_BADGE[a.status] ?? STATUS_BADGE.pending;
                  const selectable = a.status === 'pending';
                  const isSelected = selectedIds.has(a.id);
                  return (
                    <tr key={a.id} className={`border-b hover:bg-muted/30 ${isSelected ? 'bg-primary/5' : ''}`}>
                      <td className="px-3 py-2 w-8">
                        {selectable && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelect(a.id)}
                            className="cursor-pointer"
                            aria-label={`Select ${a.source_record_ref ?? a.id}`}
                          />
                        )}
                      </td>
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
                          <Eye className="h-3 w-3" /> Review
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
                <div><span className="text-muted-foreground">Created:</span> {new Date(selected.created_at).toLocaleString()}</div>
                <div><span className="text-muted-foreground">External doc:</span> {selected.external_doc_id ?? '—'}</div>
              </div>
            </div>
            {selected.status === 'pending' && (
              <div className="flex justify-end gap-2 border-t p-3">
                <button
                  onClick={handleSkip}
                  disabled={actionLoading}
                  className="flex items-center gap-1 rounded border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <XCircle className="h-4 w-4" /> Skip
                </button>
                <button
                  onClick={handleApprove}
                  disabled={actionLoading}
                  className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {actionLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                  Approve & Post
                </button>
              </div>
            )}
          </Card>
        </div>
      )}
    </div>
  );
}

export default APExceptionsQueuePage;
