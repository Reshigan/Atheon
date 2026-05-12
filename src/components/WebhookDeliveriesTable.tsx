/**
 * WebhookDeliveriesTable — polls `/deliveries` every 30s and renders recent attempts.
 *
 * Status taxonomy (backend PR #225):
 *   delivered    — 2xx, final
 *   pending      — queued or between retries
 *   failed       — a single attempt failed (non-2xx / timeout); may still be retrying
 *   dead_letter  — exhausted retries, gave up
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckCircle, Clock, XCircle, AlertOctagon, RefreshCw, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { WebhookDelivery, WebhookDeliveryStatus } from "@/lib/api";

interface WebhookDeliveriesTableProps {
  webhookId: string;
  /** Poll interval in ms. Defaults to 30 s; pass 0 to disable polling. */
  pollIntervalMs?: number;
  limit?: number;
}

const STATUS_META: Record<WebhookDeliveryStatus, { label: string; variant: 'success' | 'warning' | 'danger' | 'info'; icon: typeof CheckCircle }> = {
  delivered: { label: 'Delivered', variant: 'success', icon: CheckCircle },
  pending: { label: 'Pending', variant: 'warning', icon: Clock },
  failed: { label: 'Failed', variant: 'danger', icon: XCircle },
  dead_letter: { label: 'Dead letter', variant: 'danger', icon: AlertOctagon },
};

function formatRelative(iso: string): string {
  try {
    const d = new Date(iso);
    const diff = Date.now() - d.getTime();
    const s = Math.round(diff / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.round(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const days = Math.round(h / 24);
    return `${days}d ago`;
  } catch {
    return iso;
  }
}

export function WebhookDeliveriesTable({ webhookId, pollIntervalMs = 30_000, limit = 25 }: WebhookDeliveriesTableProps) {
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async (opts?: { silent?: boolean }) => {
    if (!opts?.silent) setRefreshing(true);
    try {
      const res = await api.webhooks.deliveries(webhookId, limit);
      if (!mountedRef.current) return;
      setDeliveries(res.deliveries || []);
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to load deliveries');
    } finally {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [webhookId, limit]);

  useEffect(() => {
    mountedRef.current = true;
    setLoading(true);
    load();
    return () => {
      mountedRef.current = false;
    };
  }, [load]);

  useEffect(() => {
    if (!pollIntervalMs) return;
    const id = setInterval(() => load({ silent: true }), pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs, load]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold t-primary">Recent deliveries</h3>
          <p className="text-caption t-muted">
            Last {limit} attempts{pollIntervalMs ? ` — auto-refreshes every ${Math.round(pollIntervalMs / 1000)}s` : ''}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => load()} disabled={refreshing}>
          {refreshing ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
          Refresh
        </Button>
      </div>

      {error && (
        <div className="text-xs p-2 rounded bg-red-500/10 text-red-400 border border-red-500/20">
          {error}
        </div>
      )}

      <div
        className="rounded-lg border overflow-hidden"
        style={{ borderColor: 'var(--border-card)' }}
      >
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left t-muted" style={{ background: 'var(--bg-secondary)' }}>
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Event</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium text-right">Attempts</th>
              <th className="px-3 py-2 font-medium text-right">HTTP</th>
              <th className="px-3 py-2 font-medium">Last error</th>
            </tr>
          </thead>
          <tbody>
            {loading && deliveries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center t-muted">
                  <Loader2 size={14} className="inline animate-spin mr-1" /> Loading deliveries…
                </td>
              </tr>
            )}
            {!loading && deliveries.length === 0 && !error && (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center t-muted">
                  No deliveries yet. Use the Test button to send a sample payload.
                </td>
              </tr>
            )}
            {deliveries.map((d) => {
              const meta = STATUS_META[d.status] || STATUS_META.pending;
              const Icon = meta.icon;
              return (
                <tr key={d.id} className="border-t" style={{ borderColor: 'var(--border-card)' }}>
                  <td className="px-3 py-2 t-secondary whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      <span title={d.created_at}>{formatRelative(d.created_at)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <code className="font-mono t-primary">{d.event_type}</code>
                  </td>
                  <td className="px-3 py-2">
                    <Badge variant={meta.variant}>
                      <Icon size={10} className="mr-1" /> {meta.label}
                    </Badge>
                  </td>
                  <td className="px-3 py-2 t-secondary text-right">{d.attempts}</td>
                  <td className="px-3 py-2 t-secondary text-right">
                    {d.http_status ?? '—'}
                  </td>
                  <td className="px-3 py-2 t-muted max-w-xs truncate" title={d.last_error || ''}>
                    {d.last_error || '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
