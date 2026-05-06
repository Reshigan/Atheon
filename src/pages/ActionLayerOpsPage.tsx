/**
 * Action Layer Operations — Phase 10-34.
 *
 * Single dashboard showing all 34 transactional subcatalysts at a
 * glance: how many actions each produced (pending/posted/failed),
 * total value moved, and one-click navigation to the detail UIs
 * (AP Exceptions, Cash Application, Period Close).
 *
 * This is the operator landing page for the action layer. The
 * existing Sub-Catalyst Ops dashboard auto-discovers each subcatalyst
 * via sub_catalyst_runs; this page adds the cross-subcatalyst
 * roll-up that operators want when triaging.
 *
 * Route: /action-layer   |   Roles: OPERATOR_ROLES
 */
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { Loader2, RefreshCw, ExternalLink, Activity } from 'lucide-react';

interface SummaryRow {
  sub_catalyst_name: string;
  status: string;
  n: number;
  total_value: number;
}

// All 34 subcatalysts grouped by function so the dashboard reads
// the way operators think about their role coverage.
const GROUPS: Array<{ label: string; subs: string[]; cta?: { label: string; to: string } }> = [
  {
    label: 'Master data',
    subs: ['supplier-onboarding', 'customer-onboarding', 'item-master-sync'],
  },
  {
    label: 'Inventory',
    subs: ['stock-transfer-executor', 'cycle-count-reconciler'],
  },
  {
    label: 'Accounts payable',
    subs: ['ap-invoice-capture', 'po-approval-router', 'ap-duplicate-blocker',
      'ap-three-way-match', 'cost-centre-mapper', 'ap-payment-run',
      'ap-vendor-statement-recon'],
    cta: { label: 'Open AP Exceptions Queue', to: '/ap-exceptions' },
  },
  {
    label: 'T&E',
    subs: ['expense-report-auditor'],
  },
  {
    label: 'Accounts receivable',
    subs: ['ar-invoice-generator', 'ar-cash-application', 'ar-dunning-executor',
      'ar-credit-hold'],
    cta: { label: 'Open Cash Application Review', to: '/cash-application' },
  },
  {
    label: 'Customer service + logistics',
    subs: ['rma-processor', 'shipping-doc-generator'],
  },
  {
    label: 'Payroll',
    subs: ['payroll-posting-bot'],
  },
  {
    label: 'GL / treasury',
    subs: ['gl-recurring-je', 'gl-intercompany-recon', 'gl-fx-revaluation',
      'vat-return-builder', 'statutory-filing-bot', 'gl-bank-reconciliation',
      'cash-position-forecaster'],
  },
  {
    label: 'Audit + GRC',
    subs: ['contract-renewal-watcher', 'journal-entry-anomaly-scanner',
      'segregation-of-duties-monitor', 'access-recertification-scheduler'],
  },
  {
    label: 'Reporting + period close',
    subs: ['financial-report-packager', 'board-pack-assembler',
      'gl-period-close-orchestrator'],
    cta: { label: 'Open Period Close', to: '/period-close' },
  },
];

interface SubMetrics {
  total: number;
  posted: number;
  pending: number;
  failed: number;
  skipped: number;
  totalValue: number;
}

function statusBadgeForSub(m: SubMetrics): { variant: 'default' | 'destructive' | 'secondary' | 'outline'; label: string } {
  if (m.failed > 0)  return { variant: 'destructive', label: `${m.failed} failed` };
  if (m.pending > 0) return { variant: 'outline', label: `${m.pending} pending` };
  if (m.posted > 0)  return { variant: 'default', label: `${m.posted} posted` };
  if (m.total === 0) return { variant: 'secondary', label: 'idle' };
  return { variant: 'secondary', label: `${m.total}` };
}

function formatCurrency(v: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(v);
}

export function ActionLayerOpsPage() {
  const toast = useToast();
  const [summary, setSummary] = useState<SummaryRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.transactionalActions.summaryCounts();
      setSummary(res.counts);
    } catch (err) {
      toast.error('Failed to load action-layer summary', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const metricsBySub = useMemo(() => {
    const map = new Map<string, SubMetrics>();
    for (const row of summary) {
      const m = map.get(row.sub_catalyst_name) ?? { total: 0, posted: 0, pending: 0, failed: 0, skipped: 0, totalValue: 0 };
      m.total += row.n;
      m.totalValue += row.total_value || 0;
      if (row.status === 'posted')   m.posted += row.n;
      if (row.status === 'pending')  m.pending += row.n;
      if (row.status === 'failed')   m.failed += row.n;
      if (row.status === 'skipped')  m.skipped += row.n;
      map.set(row.sub_catalyst_name, m);
    }
    return map;
  }, [summary]);

  // Headline aggregates across all subcatalysts
  const totals = useMemo(() => {
    const t = { total: 0, posted: 0, pending: 0, failed: 0, totalValue: 0 };
    for (const m of metricsBySub.values()) {
      t.total += m.total; t.posted += m.posted;
      t.pending += m.pending; t.failed += m.failed;
      t.totalValue += m.totalValue;
    }
    return t;
  }, [metricsBySub]);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-6 w-6 text-muted-foreground" /> Action Layer Operations
          </h1>
          <p className="text-sm text-muted-foreground">All 34 transactional subcatalysts at a glance</p>
        </div>
        <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
          <RefreshCw className="h-4 w-4" /> Refresh
        </button>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5">
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total actions</div><div className="text-2xl font-semibold">{totals.total}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Posted</div><div className="text-2xl font-semibold text-green-600">{totals.posted}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Pending HITL</div><div className="text-2xl font-semibold text-amber-600">{totals.pending}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Failed</div><div className="text-2xl font-semibold text-red-600">{totals.failed}</div></Card>
        <Card className="p-3"><div className="text-xs text-muted-foreground">Total value moved</div><div className="text-lg font-semibold">{formatCurrency(totals.totalValue)}</div></Card>
      </div>

      {/* Per-group breakdown */}
      {loading ? (
        <Card className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></Card>
      ) : (
        <div className="space-y-4">
          {GROUPS.map((group) => (
            <Card key={group.label} className="overflow-hidden">
              <div className="flex items-center justify-between border-b p-3">
                <h2 className="text-sm font-semibold">{group.label}</h2>
                {group.cta && (
                  <Link to={group.cta.to} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    {group.cta.label} <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </div>
              <div className="grid grid-cols-1 divide-y md:grid-cols-2 md:divide-x md:divide-y-0">
                <div className="md:col-span-2">
                  <table className="w-full text-sm">
                    <thead className="border-b bg-muted/40">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium w-1/3">Subcatalyst</th>
                        <th className="px-3 py-2 text-right font-medium">Total</th>
                        <th className="px-3 py-2 text-right font-medium">Posted</th>
                        <th className="px-3 py-2 text-right font-medium">Pending</th>
                        <th className="px-3 py-2 text-right font-medium">Failed</th>
                        <th className="px-3 py-2 text-right font-medium">Value moved</th>
                        <th className="px-3 py-2 text-center font-medium">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.subs.map((sub) => {
                        const m = metricsBySub.get(sub) ?? { total: 0, posted: 0, pending: 0, failed: 0, skipped: 0, totalValue: 0 };
                        const badge = statusBadgeForSub(m);
                        return (
                          <tr key={sub} className="border-b last:border-0 hover:bg-muted/30">
                            <td className="px-3 py-2 font-mono text-xs">{sub}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{m.total}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-green-600">{m.posted}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-amber-600">{m.pending}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-600">{m.failed || ''}</td>
                            <td className="px-3 py-2 text-right tabular-nums text-xs text-muted-foreground">{m.totalValue > 0 ? formatCurrency(m.totalValue) : '—'}</td>
                            <td className="px-3 py-2 text-center"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default ActionLayerOpsPage;
