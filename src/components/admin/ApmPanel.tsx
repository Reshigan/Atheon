/**
 * Roadmap C5 — APM dashboard panel.
 *
 * Surfaces per-route latency percentiles and error rate from Cloudflare
 * Analytics Engine via /api/v1/admin/apm/summary. Embedded in PlatformHealth
 * as a tab rather than its own page — ops want the latency view next to
 * the health snapshot, not a separate route.
 *
 * When the worker falls back to the KV rollup (no AE credentials), the
 * percentile columns collapse to a single "avg" column with a banner —
 * the data exists but isn't fine-grained enough to compute p95/p99.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { api, ApiError } from '@/lib/api';
import { AlertTriangle, Gauge, RefreshCw } from 'lucide-react';

type Window = '15m' | '1h' | '6h' | '24h';

interface RouteSummary {
  route: string;
  requestCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number;
  slowRate: number;
}

interface ApmResponse {
  source: 'analytics-engine' | 'kv-fallback';
  window: string;
  generatedAt: string;
  routes: RouteSummary[];
}

function latencyBadge(ms: number): 'success' | 'warning' | 'danger' | 'default' {
  if (ms === 0) return 'default';
  if (ms < 200) return 'success';
  if (ms < 500) return 'warning';
  return 'danger';
}

function errorBadge(rate: number): 'success' | 'warning' | 'danger' {
  if (rate >= 0.05) return 'danger';   // ≥5% 5xx is paging territory
  if (rate >= 0.01) return 'warning';  // ≥1% is unusual
  return 'success';
}

function formatRate(rate: number): string {
  if (rate === 0) return '0%';
  if (rate < 0.001) return '<0.1%';
  return `${(rate * 100).toFixed(1)}%`;
}

export function ApmPanel() {
  const [windowSel, setWindowSel] = useState<Window>('1h');
  const [data, setData] = useState<ApmResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (selected: Window) => {
    setError(null);
    try {
      const res = await api.adminApm.summary(selected);
      setData(res);
    } catch (err) {
      // Surface a 403 differently — common when this lands on a non-admin
      // login while testing the route.
      if (err instanceof ApiError && err.status === 403) {
        setError(new Error('APM dashboard requires superadmin or support_admin.'));
      } else {
        setError(err as Error);
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    load(windowSel);
  }, [windowSel, load]);

  const handleRefresh = () => {
    setRefreshing(true);
    load(windowSel);
  };

  if (loading) return <LoadingState variant="table" count={6} columns={6} />;
  if (error) return <ErrorState error={error} onRetry={handleRefresh} title="Couldn't load APM metrics" />;
  if (!data) return null;

  const isFallback = data.source === 'kv-fallback';
  const total = data.routes.reduce((acc, r) => acc + r.requestCount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Gauge size={16} className="text-accent" />
          <span className="text-sm font-medium t-primary">Route latency & error rate</span>
          <span className="text-caption t-muted">
            · {total.toLocaleString()} requests · updated {new Date(data.generatedAt).toLocaleTimeString()}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <div role="radiogroup" aria-label="Time window" className="inline-flex rounded-md border border-[var(--border-card)] overflow-hidden text-xs">
            {(['15m', '1h', '6h', '24h'] as Window[]).map((w) => (
              <button
                key={w}
                type="button"
                role="radio"
                aria-checked={windowSel === w}
                onClick={() => setWindowSel(w)}
                className={`px-2.5 py-1 transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] ${
                  windowSel === w
                    ? 'bg-accent/15 text-accent font-medium'
                    : 't-muted hover:t-primary hover:bg-[var(--bg-secondary)]'
                }`}
              >
                {w}
              </button>
            ))}
          </div>
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            aria-label="Refresh APM data"
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border border-[var(--border-card)] t-secondary hover:t-primary disabled:opacity-50 transition-colors"
          >
            <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {isFallback && (
        <div className="flex items-start gap-2 px-3 py-2 rounded-md text-body-sm pill-warning" role="status">
          <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" />
          <span>
            Analytics Engine credentials not configured. Showing the KV-based rollup —
            percentile columns collapse to a rolling average. Set <code className="font-mono text-xs">CF_ACCOUNT_ID</code> and <code className="font-mono text-xs">CF_AE_READ_TOKEN</code> for full p95/p99.
          </span>
        </div>
      )}

      <Card className="p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-[var(--bg-secondary)] text-left">
              <tr>
                <th className="px-3 py-2 font-medium t-muted">Route</th>
                <th className="px-3 py-2 font-medium t-muted text-right">Requests</th>
                <th className="px-3 py-2 font-medium t-muted text-right">{isFallback ? 'Avg ms' : 'p50'}</th>
                {!isFallback && <th className="px-3 py-2 font-medium t-muted text-right">p95</th>}
                {!isFallback && <th className="px-3 py-2 font-medium t-muted text-right">p99</th>}
                <th className="px-3 py-2 font-medium t-muted text-right">Slow</th>
                <th className="px-3 py-2 font-medium t-muted text-right">Errors</th>
              </tr>
            </thead>
            <tbody>
              {data.routes.length === 0 ? (
                <tr><td colSpan={isFallback ? 5 : 7} className="px-3 py-6 text-center t-muted">
                  No traffic in this window yet.
                </td></tr>
              ) : data.routes.map((r) => (
                <tr key={r.route} className="border-t border-[var(--border-card)]">
                  <td className="px-3 py-2 font-mono text-xs t-primary truncate max-w-[20rem]" title={r.route}>{r.route}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.requestCount.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant={latencyBadge(r.p50Ms)} className="text-caption tabular-nums">{r.p50Ms} ms</Badge>
                  </td>
                  {!isFallback && (
                    <td className="px-3 py-2 text-right">
                      <Badge variant={latencyBadge(r.p95Ms)} className="text-caption tabular-nums">{r.p95Ms} ms</Badge>
                    </td>
                  )}
                  {!isFallback && (
                    <td className="px-3 py-2 text-right">
                      <Badge variant={latencyBadge(r.p99Ms)} className="text-caption tabular-nums">{r.p99Ms} ms</Badge>
                    </td>
                  )}
                  <td className="px-3 py-2 text-right tabular-nums t-muted">{formatRate(r.slowRate)}</td>
                  <td className="px-3 py-2 text-right">
                    <Badge variant={errorBadge(r.errorRate)} className="text-caption tabular-nums">{formatRate(r.errorRate)}</Badge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
