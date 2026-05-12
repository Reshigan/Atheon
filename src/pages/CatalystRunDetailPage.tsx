import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "@/components/ui/card";
import { Modal } from "@/components/ui/modal";
import { LoadingState } from "@/components/ui/state";
import { useParams, useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api";
import type { SubCatalystRunItem, SubCatalystRunItemsResponse, RunComment } from "@/lib/api";
import { useToast, type ToastApi } from "@/components/ui/toast";
import { useAppStore } from "@/stores/appStore";
import { CatalystSimulatorCard } from "@/components/CatalystSimulatorCard";
import {
  RunItemsFilterBar,
  type ItemStatus,
  type ReviewStatus,
  type Severity,
} from "@/components/RunItemsFilterBar";
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, AlertCircle,
  Activity, Database, BarChart3, Download, FileText,
  ThumbsUp, ThumbsDown, MessageCircle, Send, Loader2, Trash2,
} from "lucide-react";

const ADMIN_ROLES = new Set(['superadmin', 'support_admin', 'admin', 'executive']);


interface RunDetail {
  id: string;
  clusterId?: string;
  subCatalystName: string;
  clusterName: string;
  clusterDomain: string;
  status: string;
  matched: number;
  discrepancies: number;
  exceptions: number;
  totalValue: number;
  startedAt: string;
  completedAt: string;
  kpis: Array<{ name: string; value: number; status: string; unit: string; target: number }>;
  metrics: Array<{ id: string; name: string; value: number; unit: string; status: string }>;
  sourceData: Array<{ id: string; sourceSystem: string; recordType: string; value: number; status: string }>;
}

// CSV-safe cell (mirrors AuditPage.csvSafe: prevents formula injection).
function csvSafe(val: unknown): string {
  if (val === null || val === undefined) return '""';
  const s = String(val).replace(/"/g, '""');
  if (/^[=+\-@\t\r]/.test(s)) return `"'${s}"`;
  return `"${s}"`;
}

function triggerDownload(content: string, filename: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Confirm dialog — uses the canonical Modal primitive so this page no
// longer reinvents overlay / ESC / scroll-lock / aria-modal mechanics.
function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirm', confirmVariant = 'primary',
  onConfirm, onCancel, busy,
}: {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  confirmVariant?: 'primary' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}) {
  return (
    <Modal open={open} onClose={onCancel} size="sm" dismissible={!busy}>
      <Modal.Header
        title={title}
        // Inline X is suppressed while the mutation is in flight via the
        // Modal's `dismissible` prop above; no need to disable here too.
        onClose={onCancel}
      />
      <Modal.Body>
        <p className="text-body-sm t-muted">{message}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="ghost" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          variant={confirmVariant === 'danger' ? 'ghost' : 'primary'}
          className={confirmVariant === 'danger' ? 'text-red-400 hover:bg-red-400/10' : undefined}
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? <Loader2 size={14} className="animate-spin mr-2" /> : null}
          {confirmLabel}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}

export function CatalystRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  // `useToast()` returns a freshly-constructed object on every render (its
  // helper methods close over the provider's addToast). Including `toast` in
  // any useCallback dep array therefore invalidates the callback on every
  // render, which — when those callbacks feed a useEffect — triggers an
  // infinite load loop (see #re-render-loop). Stash the API in a ref so we
  // can call the latest version without destabilising memoised callbacks.
  const toastRef = useRef<ToastApi>(toast);
  toastRef.current = toast;
  const [run, setRun] = useState<RunDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<{ message: string; requestId: string | null } | null>(null);

  // Items (server-paginated, client-filtered on top)
  const [items, setItems] = useState<SubCatalystRunItemsResponse | null>(null);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [itemPage, setItemPage] = useState(0);

  // Client-side filter state
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<ItemStatus[]>([]);
  const [reviewFilter, setReviewFilter] = useState<ReviewStatus[]>([]);
  const [severityFilter, setSeverityFilter] = useState<Severity[]>([]);

  // Approval workflow state
  const [selectedItemIds, setSelectedItemIds] = useState<Set<string>>(new Set());
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const [bulkReviewing, setBulkReviewing] = useState(false);
  const [confirm, setConfirm] = useState<null | {
    kind: 'single' | 'bulk';
    action: ReviewStatus;
    itemId?: string;
    count: number;
  }>(null);

  // Comments
  const [comments, setComments] = useState<RunComment[]>([]);
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [addingComment, setAddingComment] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);
  const currentUser = useAppStore((s) => s.user);
  const canDeleteComment = useCallback(
    (comment: RunComment) =>
      !!currentUser &&
      (comment.user_id === currentUser.id || ADMIN_ROLES.has(currentUser.role)),
    [currentUser],
  );

  // Export state
  const [exporting, setExporting] = useState(false);

  const loadRun = useCallback(async () => {
    if (!runId) return;
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.catalysts.runDetail(runId);
      setRun(data);
    } catch (err) {
      console.error('Failed to load run details:', err);
      const message = err instanceof Error ? err.message : 'Failed to load run details';
      const requestId = err instanceof ApiError ? err.requestId : null;
      setLoadError({ message, requestId });
      toastRef.current.error('Failed to load run', { message, requestId });
    } finally {
      setLoading(false);
    }
  }, [runId]);

  const loadItems = useCallback(async (page = 0) => {
    if (!runId) return;
    setItemsLoading(true);
    setItemsError(null);
    try {
      const res = await api.catalysts.getRunItems(runId, { limit: 50, offset: page * 50 });
      setItems(res);
      setItemPage(page);
    } catch (err) {
      console.error('Failed to load run items:', err);
      const message = err instanceof Error ? err.message : 'Failed to load items';
      const requestId = err instanceof ApiError ? err.requestId : null;
      setItemsError(message);
      toastRef.current.error('Failed to load items', { message, requestId });
    } finally {
      setItemsLoading(false);
    }
  }, [runId]);

  const loadComments = useCallback(async () => {
    if (!runId) return;
    setCommentsLoading(true);
    try {
      const res = await api.catalysts.getRunComments(runId);
      setComments(res.comments);
    } catch (err) {
      console.error('Failed to load comments:', err);
      const message = err instanceof Error ? err.message : 'Failed to load comments';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toastRef.current.error('Failed to load comments', { message, requestId });
    } finally {
      setCommentsLoading(false);
    }
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    loadRun();
    loadItems(0);
    loadComments();
  }, [runId, loadRun, loadItems, loadComments]);

  // ─ Client-side filtered items (for search, multi-status, severity) ─
  const filteredItems = useMemo(() => {
    const base = items?.items ?? [];
    const q = searchQuery.trim().toLowerCase();
    return base.filter((it) => {
      if (q) {
        const hay = [
          it.source_ref, it.target_ref, it.source_entity, it.target_entity,
          it.discrepancy_reason, it.discrepancy_field, it.exception_type,
          it.exception_detail, it.category, String(it.item_number),
        ].filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (statusFilter.length > 0 && !statusFilter.includes(it.item_status as ItemStatus)) return false;
      if (reviewFilter.length > 0 && !reviewFilter.includes(it.review_status as ReviewStatus)) return false;
      if (severityFilter.length > 0) {
        if (!it.exception_severity) return false;
        if (!severityFilter.includes(it.exception_severity as Severity)) return false;
      }
      return true;
    });
  }, [items, searchQuery, statusFilter, reviewFilter, severityFilter]);

  // ─ Approval handlers ─
  const askReview = (action: ReviewStatus, itemId?: string) => {
    if (itemId) {
      setConfirm({ kind: 'single', action, itemId, count: 1 });
    } else {
      setConfirm({ kind: 'bulk', action, count: selectedItemIds.size });
    }
  };

  const doReview = async () => {
    if (!confirm || !runId) return;
    const { kind, action, itemId } = confirm;
    try {
      if (kind === 'single' && itemId) {
        setReviewingId(itemId);
        const res = await api.catalysts.reviewRunItem(runId, itemId, { review_status: action });
        toast.success(`Item ${action}`, `Review status updated (${res.review_status})`);
      } else if (kind === 'bulk') {
        setBulkReviewing(true);
        const res = await api.catalysts.bulkReviewRunItems(runId, {
          item_ids: Array.from(selectedItemIds),
          review_status: action,
        });
        toast.success(`${res.updated} items ${action}`, 'Bulk review complete');
        setSelectedItemIds(new Set());
      }
      setConfirm(null);
      await loadItems(itemPage);
    } catch (err) {
      console.error('Review failed:', err);
      const message = err instanceof Error ? err.message : 'Review failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Review failed', { message, requestId });
    } finally {
      setReviewingId(null);
      setBulkReviewing(false);
    }
  };

  const handleAddComment = async () => {
    if (!runId || !newComment.trim()) return;
    setAddingComment(true);
    try {
      await api.catalysts.addRunComment(runId, { comment: newComment.trim() });
      setNewComment('');
      await loadComments();
      toast.success('Comment added');
    } catch (err) {
      console.error('Add comment failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to add comment';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Failed to add comment', { message, requestId });
    } finally {
      setAddingComment(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!runId) return;
    setDeletingCommentId(commentId);
    setComments((prev) => prev.filter((c) => c.id !== commentId));
    try {
      await api.catalysts.deleteRunComment(runId, commentId);
      toast.success('Comment deleted');
    } catch (err) {
      console.error('Delete comment failed:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete comment';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Failed to delete comment', { message, requestId });
      await loadComments();
    } finally {
      setDeletingCommentId(null);
    }
  };

  // ─ Export ─
  const handleExportCsv = async () => {
    if (!runId) return;
    if (!items || items.items.length === 0) {
      toast.warning('Nothing to export', 'No items loaded for this run');
      return;
    }
    setExporting(true);
    try {
      // Export the full dataset by paging through the backend.
      const all: SubCatalystRunItem[] = [];
      const pageSize = 200;
      const total = items.total || items.items.length;
      for (let offset = 0; offset < total; offset += pageSize) {
        const res = await api.catalysts.getRunItems(runId, { limit: pageSize, offset });
        all.push(...res.items);
        if (res.items.length < pageSize) break;
      }
      const headers = [
        'item_number', 'item_status', 'category',
        'source_ref', 'source_entity', 'source_amount', 'source_currency', 'source_date',
        'target_ref', 'target_entity', 'target_amount', 'target_currency', 'target_date',
        'match_confidence', 'match_method',
        'discrepancy_field', 'discrepancy_amount', 'discrepancy_pct', 'discrepancy_reason',
        'exception_type', 'exception_severity', 'exception_detail',
        'review_status', 'reviewed_by', 'reviewed_at', 'review_notes', 'reclassified_to',
      ];
      const lines = [headers.join(',')];
      for (const it of all) {
        lines.push(headers.map((h) => csvSafe((it as unknown as Record<string, unknown>)[h])).join(','));
      }
      triggerDownload(lines.join('\n'), `catalyst-run-${runId}-items.csv`, 'text/csv');
      toast.success('CSV exported', `${all.length} item${all.length === 1 ? '' : 's'} downloaded`);
    } catch (err) {
      console.error('CSV export failed:', err);
      const message = err instanceof Error ? err.message : 'Export failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Export failed', { message, requestId });
    } finally {
      setExporting(false);
    }
  };

  const handleExportJson = async () => {
    if (!runId || !run) return;
    setExporting(true);
    try {
      const all: SubCatalystRunItem[] = [];
      const pageSize = 200;
      const total = items?.total ?? items?.items.length ?? 0;
      for (let offset = 0; offset < total; offset += pageSize) {
        const res = await api.catalysts.getRunItems(runId, { limit: pageSize, offset });
        all.push(...res.items);
        if (res.items.length < pageSize) break;
      }
      const payload = {
        run,
        totals: items?.totals,
        review_progress: items?.review_progress,
        items: all,
        exported_at: new Date().toISOString(),
      };
      triggerDownload(JSON.stringify(payload, null, 2), `catalyst-run-${runId}.json`, 'application/json');
      toast.success('JSON exported', `${all.length} item${all.length === 1 ? '' : 's'} downloaded`);
    } catch (err) {
      console.error('JSON export failed:', err);
      const message = err instanceof Error ? err.message : 'Export failed';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Export failed', { message, requestId });
    } finally {
      setExporting(false);
    }
  };

  if (loading) return <LoadingState variant="cards" count={4} />;

  if (!run) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Card className="p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
          <h2 className="text-xl font-semibold t-primary mb-2">Run Not Found</h2>
          <p className="text-sm t-muted mb-4">
            {loadError?.message || "The catalyst run you're looking for doesn't exist or you don't have access to it."}
          </p>
          {loadError?.requestId && (
            <p className="text-caption t-muted font-mono mb-4">Request ID: {loadError.requestId}</p>
          )}
          <div className="flex gap-2 justify-center">
            <Button variant="ghost" onClick={loadRun}>Retry</Button>
            <Button variant="primary" onClick={() => navigate('/catalysts')}>
              <ArrowLeft size={14} className="mr-2" /> Back to Catalysts
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  const StatusIcon = run.status === 'success' ? CheckCircle2
    : run.status === 'failed' ? XCircle
    : run.status === 'partial' ? AlertCircle
    : Clock;

  const allFilteredSelected = filteredItems.length > 0 && filteredItems.every((it) => selectedItemIds.has(it.id));
  const pendingSelectedCount = Array.from(selectedItemIds).filter((id) =>
    (items?.items ?? []).find((it) => it.id === id)?.review_status === 'pending'
  ).length;

  return (
    <div className="min-h-screen bg-[var(--bg-primary)]">
      {/* Header */}
      <div className="border-b border-[var(--border-card)] bg-[var(--bg-secondary)]">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-4">
              <button
                onClick={() => navigate('/catalysts')}
                className="p-2 hover:bg-[var(--bg-card-solid)] rounded-lg transition-colors"
                aria-label="Back to Catalysts"
              >
                <ArrowLeft size={20} className="t-muted" />
              </button>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-2xl font-bold t-primary">Catalyst Run</h1>
                  <Badge variant={run.status === 'success' ? 'success' : run.status === 'failed' ? 'danger' : 'warning'}>
                    <StatusIcon size={12} className="mr-1" />
                    {run.status}
                  </Badge>
                </div>
                <p className="text-sm t-muted mt-1">{run.subCatalystName} • {run.clusterName}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-2 text-sm t-muted mr-2">
                <Clock size={14} />
                <span>{new Date(run.startedAt).toLocaleString()}</span>
              </div>
              <Button variant="ghost" onClick={handleExportCsv} disabled={exporting || !items}>
                {exporting ? <Loader2 size={14} className="animate-spin mr-2" /> : <Download size={14} className="mr-2" />}
                Export CSV
              </Button>
              <Button variant="ghost" onClick={handleExportJson} disabled={exporting || !items}>
                <FileText size={14} className="mr-2" /> Export JSON
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Key Metrics */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 size={20} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-label">Matched Records</p>
                <p className="text-2xl font-bold t-primary">{run.matched?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                <AlertCircle size={20} className="text-amber-400" />
              </div>
              <div>
                <p className="text-label">Discrepancies</p>
                <p className="text-2xl font-bold t-primary">{run.discrepancies?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                <XCircle size={20} className="text-red-400" />
              </div>
              <div>
                <p className="text-label">Exceptions</p>
                <p className="text-2xl font-bold t-primary">{run.exceptions?.toLocaleString() || '0'}</p>
              </div>
            </div>
          </Card>

          <Card className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
                <Database size={20} className="text-blue-400" />
              </div>
              <div>
                <p className="text-label">Total Value</p>
                <p className="text-2xl font-bold t-primary">
                  {run.totalValue ? `R ${(run.totalValue / 1000000).toFixed(2)}M` : 'N/A'}
                </p>
              </div>
            </div>
          </Card>
        </div>

        {/* Run Items — filtering + approval workflow */}
        <Card className="p-6 mb-6">
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <div className="flex items-center gap-3">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">
                Run Items {items && <span className="t-muted text-sm font-normal">({items.total})</span>}
              </h3>
            </div>
            {items?.review_progress && (
              <div className="flex gap-3 text-xs t-muted">
                <span className="text-emerald-400">{items.review_progress.approved} approved</span>
                <span className="text-red-400">{items.review_progress.rejected} rejected</span>
                <span className="text-amber-400">{items.review_progress.deferred} deferred</span>
                <span>{items.review_progress.pending} pending</span>
              </div>
            )}
          </div>

          <RunItemsFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            reviewFilter={reviewFilter}
            onReviewFilterChange={setReviewFilter}
            severityFilter={severityFilter}
            onSeverityFilterChange={setSeverityFilter}
            resultCount={filteredItems.length}
            totalCount={items?.items.length ?? 0}
          />

          {/* Bulk actions bar */}
          {selectedItemIds.size > 0 && (
            <div className="flex items-center gap-2 mb-3 p-2 rounded-lg bg-accent/5 border border-accent/20">
              <span className="text-xs t-primary">{selectedItemIds.size} selected</span>
              {pendingSelectedCount < selectedItemIds.size && (
                <span className="text-caption t-muted">
                  ({pendingSelectedCount} pending, {selectedItemIds.size - pendingSelectedCount} already reviewed)
                </span>
              )}
              <div className="flex gap-1 ml-auto">
                <Button
                  size="sm" variant="ghost"
                  className="text-xs text-emerald-400 hover:bg-emerald-400/10"
                  onClick={() => askReview('approved')}
                  disabled={bulkReviewing || selectedItemIds.size === 0}
                >
                  <ThumbsUp size={12} className="mr-1" /> Approve
                </Button>
                <Button
                  size="sm" variant="ghost"
                  className="text-xs text-red-400 hover:bg-red-400/10"
                  onClick={() => askReview('rejected')}
                  disabled={bulkReviewing || selectedItemIds.size === 0}
                >
                  <ThumbsDown size={12} className="mr-1" /> Reject
                </Button>
                <Button size="sm" variant="ghost" className="text-xs" onClick={() => setSelectedItemIds(new Set())}>
                  Clear
                </Button>
              </div>
            </div>
          )}

          {itemsLoading ? (
            <div className="flex items-center gap-2 justify-center p-8 t-muted text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading items...
            </div>
          ) : itemsError ? (
            <div className="text-center py-8 text-sm text-red-400">
              {itemsError}
              <div className="mt-2">
                <Button size="sm" variant="ghost" onClick={() => loadItems(itemPage)}>Retry</Button>
              </div>
            </div>
          ) : !items || items.items.length === 0 ? (
            <div className="text-center py-8 text-sm t-muted">
              No items found for this run.
            </div>
          ) : filteredItems.length === 0 ? (
            <div className="text-center py-8 text-sm t-muted">
              No items match the current filters.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--border-card)]">
                    <th className="py-2 px-2 w-8">
                      <input
                        type="checkbox"
                        aria-label="Select all filtered items"
                        checked={allFilteredSelected}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedItemIds(new Set([...selectedItemIds, ...filteredItems.map((it) => it.id)]));
                          } else {
                            const next = new Set(selectedItemIds);
                            filteredItems.forEach((it) => next.delete(it.id));
                            setSelectedItemIds(next);
                          }
                        }}
                      />
                    </th>
                    <th className="py-2 px-2 t-muted font-medium text-left">#</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Status</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Source</th>
                    <th className="py-2 px-2 t-muted font-medium text-right">Source Amt</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Target</th>
                    <th className="py-2 px-2 t-muted font-medium text-right">Target Amt</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Discrepancy</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Review</th>
                    <th className="py-2 px-2 t-muted font-medium text-left">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const selected = selectedItemIds.has(item.id);
                    const isReviewing = reviewingId === item.id;
                    return (
                      <tr
                        key={item.id}
                        className={`border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)] ${selected ? 'bg-accent/5' : ''}`}
                      >
                        <td className="py-2 px-2">
                          <input
                            type="checkbox"
                            aria-label={`Select item ${item.item_number}`}
                            checked={selected}
                            onChange={(e) => {
                              const next = new Set(selectedItemIds);
                              if (e.target.checked) next.add(item.id);
                              else next.delete(item.id);
                              setSelectedItemIds(next);
                            }}
                          />
                        </td>
                        <td className="py-2 px-2 t-muted font-mono text-xs">{item.item_number}</td>
                        <td className="py-2 px-2">
                          <Badge
                            variant={item.item_status === 'matched' ? 'success' : item.item_status === 'discrepancy' ? 'warning' : item.item_status === 'exception' ? 'danger' : 'info'}
                            className="text-xs"
                          >
                            {item.item_status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          <div className="t-primary truncate max-w-[160px]" title={item.source_ref}>{item.source_ref || '-'}</div>
                          {item.source_entity && <div className="t-muted text-xs truncate max-w-[160px]" title={item.source_entity}>{item.source_entity}</div>}
                        </td>
                        <td className="py-2 px-2 text-right t-primary font-mono">
                          {typeof item.source_amount === 'number' ? item.source_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </td>
                        <td className="py-2 px-2">
                          <div className="t-primary truncate max-w-[160px]" title={item.target_ref}>{item.target_ref || '-'}</div>
                          {item.target_entity && <div className="t-muted text-xs truncate max-w-[160px]" title={item.target_entity}>{item.target_entity}</div>}
                        </td>
                        <td className="py-2 px-2 text-right t-primary font-mono">
                          {typeof item.target_amount === 'number' ? item.target_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'}
                        </td>
                        <td className="py-2 px-2">
                          {typeof item.discrepancy_amount === 'number' && item.discrepancy_amount !== 0 ? (
                            <span className="text-amber-400">
                              {item.discrepancy_amount.toFixed(2)}
                              {typeof item.discrepancy_pct === 'number' ? ` (${item.discrepancy_pct.toFixed(1)}%)` : ''}
                            </span>
                          ) : item.exception_type ? (
                            <span className="text-red-400">{item.exception_type}{item.exception_severity ? ` • ${item.exception_severity}` : ''}</span>
                          ) : (
                            <span className="t-muted">-</span>
                          )}
                          {item.discrepancy_reason && (
                            <div className="text-xs t-muted truncate max-w-[200px]" title={item.discrepancy_reason}>{item.discrepancy_reason}</div>
                          )}
                        </td>
                        <td className="py-2 px-2">
                          <Badge
                            variant={item.review_status === 'approved' ? 'success' : item.review_status === 'rejected' ? 'danger' : item.review_status === 'deferred' ? 'warning' : 'info'}
                            className="text-xs"
                          >
                            {item.review_status}
                          </Badge>
                        </td>
                        <td className="py-2 px-2">
                          {item.review_status === 'pending' ? (
                            <div className="flex gap-1">
                              <button
                                className="p-1 rounded text-emerald-400 hover:bg-emerald-400/10 disabled:opacity-50"
                                onClick={() => askReview('approved', item.id)}
                                disabled={isReviewing}
                                title="Approve"
                                aria-label="Approve item"
                              >
                                {isReviewing ? <Loader2 size={12} className="animate-spin" /> : <ThumbsUp size={12} />}
                              </button>
                              <button
                                className="p-1 rounded text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                                onClick={() => askReview('rejected', item.id)}
                                disabled={isReviewing}
                                title="Reject"
                                aria-label="Reject item"
                              >
                                <ThumbsDown size={12} />
                              </button>
                            </div>
                          ) : (
                            <span className="text-caption t-muted">{item.reviewed_by ? `by ${item.reviewed_by}` : '-'}</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>

              {/* Pagination */}
              {items.total > 50 && (
                <div className="flex justify-center items-center gap-2 mt-3 pt-3 border-t border-[var(--border-card)]">
                  <Button size="sm" variant="ghost" disabled={itemPage === 0 || itemsLoading} onClick={() => loadItems(itemPage - 1)}>
                    Prev
                  </Button>
                  <span className="text-xs t-muted">
                    Page {itemPage + 1} of {Math.ceil(items.total / 50)}
                  </span>
                  <Button size="sm" variant="ghost" disabled={(itemPage + 1) * 50 >= items.total || itemsLoading} onClick={() => loadItems(itemPage + 1)}>
                    Next
                  </Button>
                </div>
              )}
            </div>
          )}
        </Card>

        {/* Comments thread */}
        <Card className="p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            <MessageCircle className="w-5 h-5 text-accent" />
            <h3 className="text-lg font-semibold t-primary">Comments ({comments.length})</h3>
          </div>

          <div className="space-y-3 max-h-80 overflow-y-auto mb-4">
            {commentsLoading ? (
              <div className="flex items-center gap-2 justify-center p-4 t-muted text-sm">
                <Loader2 size={14} className="animate-spin" /> Loading comments...
              </div>
            ) : comments.length === 0 ? (
              <p className="text-sm t-muted text-center py-4">No comments yet. Be the first to add one.</p>
            ) : (
              comments.map((c) => (
                <div key={c.id} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-medium t-primary">{c.user_name || c.user_id}</span>
                    <span className="text-xs t-muted">{new Date(c.created_at).toLocaleString()}</span>
                    {c.item_id && (
                      <Badge variant="info" className="text-caption">on item</Badge>
                    )}
                    {canDeleteComment(c) && (
                      <button
                        type="button"
                        aria-label="Delete comment"
                        title="Delete comment"
                        className="ml-auto inline-flex items-center justify-center rounded-md p-1 text-[var(--text-muted)] hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50"
                        disabled={deletingCommentId === c.id}
                        onClick={() => handleDeleteComment(c.id)}
                        data-testid={`delete-comment-${c.id}`}
                      >
                        {deletingCommentId === c.id
                          ? <Loader2 size={14} className="animate-spin" />
                          : <Trash2 size={14} />}
                      </button>
                    )}
                  </div>
                  <p className="text-sm t-primary whitespace-pre-wrap">{c.comment}</p>
                </div>
              ))
            )}
          </div>

          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary focus:outline-none focus:border-accent/40"
              placeholder="Add a comment..."
              value={newComment}
              onChange={(e) => setNewComment(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey && newComment.trim()) { e.preventDefault(); handleAddComment(); } }}
              disabled={addingComment}
            />
            <Button variant="primary" onClick={handleAddComment} disabled={addingComment || !newComment.trim()}>
              {addingComment ? <Loader2 size={14} className="animate-spin mr-2" /> : <Send size={14} className="mr-2" />}
              Post
            </Button>
          </div>
        </Card>

        {/* Catalyst simulator — predicts the next run's recovery against
            this customer's data and tightens the per-tenant calibration
            with each completed run's residual. World-first capability. */}
        {run.clusterId && (
          <CatalystSimulatorCard
            clusterId={run.clusterId}
            subCatalystName={run.subCatalystName}
          />
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* KPIs Generated */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <BarChart3 className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">KPIs Generated ({run.kpis?.length || 0})</h3>
            </div>
            {run.kpis && run.kpis.length > 0 ? (
              <div className="space-y-3">
                {run.kpis.map((kpi, i) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{String(kpi.name)}</span>
                      <Badge variant={kpi.status === 'green' ? 'success' : kpi.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {String(kpi.status)}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="t-muted">Value: <span className="t-primary font-medium">{String(kpi.value)} {String(kpi.unit)}</span></span>
                      <span className="t-muted">Target: <span className="t-primary">{String(kpi.target)} {String(kpi.unit)}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No KPIs generated in this run
              </div>
            )}
          </Card>

          {/* Metrics Created in Pulse */}
          <Card className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <Activity className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Metrics Created in Pulse ({run.metrics?.length || 0})</h3>
            </div>
            {run.metrics && run.metrics.length > 0 ? (
              <div className="space-y-3">
                {run.metrics.map((metric, i) => (
                  <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium t-primary">{String(metric.name)}</span>
                      <Badge variant={metric.status === 'green' ? 'success' : metric.status === 'amber' ? 'warning' : 'danger'} className="text-xs">
                        {String(metric.status)}
                      </Badge>
                    </div>
                    <div className="text-sm t-muted">
                      Value: <span className="t-primary font-medium">{String(metric.value)} {String(metric.unit)}</span>
                    </div>
                    <button
                      onClick={() => navigate(`/pulse?metric=${metric.id}`)}
                      className="text-xs text-accent hover:underline mt-1"
                    >
                      View in Pulse →
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No metrics created in this run
              </div>
            )}
          </Card>

          {/* Source Data Attribution */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Database className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Source Data Processed</h3>
            </div>
            {run.sourceData && run.sourceData.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-card)]">
                      <th className="text-left py-2 px-3 t-muted font-medium">Record ID</th>
                      <th className="text-left py-2 px-3 t-muted font-medium">Source System</th>
                      <th className="text-left py-2 px-3 t-muted font-medium">Record Type</th>
                      <th className="text-right py-2 px-3 t-muted font-medium">Value</th>
                      <th className="text-center py-2 px-3 t-muted font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {run.sourceData.slice(0, 50).map((record, i) => (
                      <tr key={i} className="border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)]">
                        <td className="py-2 px-3 t-primary font-mono text-xs">{String(record.id)}</td>
                        <td className="py-2 px-3 t-muted">{String(record.sourceSystem)}</td>
                        <td className="py-2 px-3 t-muted">{String(record.recordType)}</td>
                        <td className="py-2 px-3 text-right t-primary">{typeof record.value === 'number' ? record.value.toLocaleString() : String(record.value)}</td>
                        <td className="py-2 px-3 text-center">
                          <Badge variant={record.status === 'matched' ? 'success' : record.status === 'discrepancy' ? 'warning' : 'danger'} className="text-xs">
                            {String(record.status)}
                          </Badge>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {run.sourceData.length > 50 && (
                  <p className="text-xs t-muted text-center py-4">
                    Showing 50 of {run.sourceData.length} records
                  </p>
                )}
              </div>
            ) : (
              <div className="text-center py-8 text-sm t-muted">
                No source data attribution available
              </div>
            )}
          </Card>

          {/* Execution Timeline */}
          <Card className="p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Clock className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Execution Timeline</h3>
            </div>
            <div className="space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-blue-400 mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Run Started</p>
                  <p className="text-xs t-muted">{new Date(run.startedAt).toLocaleString()}</p>
                </div>
              </div>
              {run.completedAt && (
                <div className="flex items-start gap-3">
                  <div className={`w-3 h-3 rounded-full mt-1.5 ${run.status === 'success' ? 'bg-emerald-400' : run.status === 'failed' ? 'bg-red-400' : 'bg-amber-400'}`} />
                  <div className="flex-1">
                    <p className="text-sm font-medium t-primary">Run Completed</p>
                    <p className="text-xs t-muted">{new Date(run.completedAt).toLocaleString()}</p>
                    <p className="text-xs t-muted mt-1">
                      Duration: {Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000 / 60)} minutes
                    </p>
                  </div>
                </div>
              )}
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-accent mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Health Scores Updated</p>
                  <p className="text-xs t-muted">Apex health dimensions recalculated with new data</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-3 h-3 rounded-full bg-accent mt-1.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">Pulse Metrics Refreshed</p>
                  <p className="text-xs t-muted">{run.metrics?.length || 0} operational metrics updated</p>
                </div>
              </div>
            </div>
          </Card>
        </div>
      </div>

      {/* Confirm dialog */}
      <ConfirmDialog
        open={!!confirm}
        title={
          confirm?.kind === 'bulk'
            ? `${confirm.action === 'approved' ? 'Approve' : confirm.action === 'rejected' ? 'Reject' : confirm.action === 'deferred' ? 'Defer' : 'Update'} ${confirm.count} items?`
            : confirm
              ? `${confirm.action === 'approved' ? 'Approve' : confirm.action === 'rejected' ? 'Reject' : 'Update'} this item?`
              : ''
        }
        message={
          confirm?.kind === 'bulk'
            ? `This will mark ${confirm.count} selected item${confirm.count === 1 ? '' : 's'} as "${confirm.action}". Only pending items will be updated.`
            : 'This action will update the review status for this item. Any downstream KPIs or metrics tied to this run will reflect the change on next refresh.'
        }
        confirmLabel={confirm?.action === 'approved' ? 'Approve' : confirm?.action === 'rejected' ? 'Reject' : 'Confirm'}
        confirmVariant={confirm?.action === 'rejected' ? 'danger' : 'primary'}
        onConfirm={doReview}
        onCancel={() => setConfirm(null)}
        busy={reviewingId !== null || bulkReviewing}
      />
    </div>
  );
}
