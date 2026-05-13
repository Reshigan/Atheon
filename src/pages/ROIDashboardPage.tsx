/**
 * ROI / Insights Dashboard — Phase 10-23.
 *
 * Surfaces the new Phase 10-9 → 10-22 outputs that the backend now
 * produces but had no UI:
 *
 *   - Cumulative shared-savings (billable_periods totals + Atheon
 *     revenue at the configured share %)
 *   - Forecast accuracy (within-band rate + median absolute error %,
 *     overall + per horizon)
 *   - Inference calibration (per-gate true/false positive counts +
 *     'tighten' / 'loosen' / 'hold' recommendation)
 *   - DSAR request summary (counts by type + status)
 *
 * Lean by intent: a single read-only page so customers can see the
 * Phase 10 outputs and verify they're getting value. Charts /
 * drill-down are explicitly future work.
 */

import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { HeroHeader } from '@/components/ui/hero-header';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { TrendingUp, Shield, Activity, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';
import type {
  BillingSummary, ForecastAccuracyResp, CalibrationGate, DsarSummary,
} from '@/lib/api';

function formatCurrency(value: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

function recBadge(rec: CalibrationGate['recommendation']): JSX.Element {
  if (rec === 'tighten') return <Badge variant="danger">Tighten</Badge>;
  if (rec === 'loosen') return <Badge variant="warning">Loosen</Badge>;
  return <Badge variant="outline">Hold</Badge>;
}

export default function ROIDashboardPage(): JSX.Element {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [forecast, setForecast] = useState<ForecastAccuracyResp | null>(null);
  const [calibration, setCalibration] = useState<{ gates: CalibrationGate[] } | null>(null);
  const [dsar, setDsar] = useState<DsarSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Stable loader so the error retry button can re-invoke without
  // racing the cancelled flag below.
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // SDK-only — raw api.get('/path') is banned per UI_POLISH_PRINCIPLES §6.1.
      // Adding a new endpoint? Add it to api.insightsStats first, then
      // consume the typed method here.
      const [b, f, c, d] = await Promise.all([
        api.insightsStats.billingSummary(),
        api.insightsStats.forecastAccuracy(),
        api.insightsStats.calibration(),
        api.insightsStats.dsarSummary(),
      ]);
      setBilling(b);
      setForecast(f);
      setCalibration(c);
      setDsar(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Canonical render-state contract (UI_POLISH_PRINCIPLES §6.1):
  //   1. loading → LoadingState
  //   2. error + no data → ErrorState with retry
  //   3. otherwise → real content
  if (loading) {
    return <div className="p-6"><LoadingState variant="cards" count={4} /></div>;
  }
  if (error && !billing) {
    return (
      <div className="p-6">
        <ErrorState
          title="Couldn't load ROI dashboard"
          error={error}
          onRetry={load}
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <HeroHeader
        icon={TrendingUp}
        title="ROI Dashboard"
        subtitle="Financial Proof & Inference Calibration"
        accent="sage"
      />

      {/* Billing summary — Stitch financial-proof tile pattern */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} style={{ color: 'var(--accent)' }} />
          <h2 className="text-headline-md font-semibold t-primary">Shared-savings billing</h2>
        </div>
        {billing ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors">
              <div className="text-caption uppercase tracking-wider t-muted">Periods invoiced</div>
              <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{billing.periods_count}</p>
            </div>
            <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors">
              <div className="text-caption uppercase tracking-wider t-muted">Total realised savings</div>
              <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">
                {formatCurrency(billing.total_realised_savings, billing.currency)}
              </p>
            </div>
            <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-emerald-500/40 transition-colors">
              <div className="text-caption uppercase tracking-wider t-muted">Atheon share</div>
              <p className="text-headline-lg font-bold text-emerald-500 tabular-nums font-mono mt-1">
                {formatCurrency(billing.total_atheon_revenue, billing.currency)}
              </p>
            </div>
          </div>
        ) : <div className="text-sm t-muted">No billing data yet.</div>}
      </Card>

      {/* Forecast accuracy */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={18} style={{ color: 'var(--sky)' }} />
          <h2 className="text-headline-md font-semibold t-primary">Forecast accuracy <span className="text-body-sm font-normal t-muted">(last {forecast?.lookback_days ?? 90} days)</span></h2>
        </div>
        {forecast && forecast.total_graded > 0 ? (
          <>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
              <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-sky-500/40 transition-colors">
                <div className="text-caption uppercase tracking-wider t-muted">Graded forecasts</div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{forecast.total_graded}</p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-emerald-500/40 transition-colors">
                <div className="text-caption uppercase tracking-wider t-muted">Within band</div>
                <p className="text-headline-lg font-bold text-emerald-500 tabular-nums font-mono mt-1">
                  {forecast.within_band_rate != null
                    ? `${(forecast.within_band_rate * 100).toFixed(1)}%`
                    : '—'}
                </p>
              </div>
              <div className="p-4 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-amber-500/40 transition-colors">
                <div className="text-caption uppercase tracking-wider t-muted">Median |error| %</div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">
                  {forecast.median_abs_error_pct != null
                    ? `${forecast.median_abs_error_pct.toFixed(2)}%`
                    : '—'}
                </p>
              </div>
            </div>
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-1">Horizon</th><th>Graded</th><th>Within band</th><th>Median |error|</th></tr>
              </thead>
              <tbody>
                {forecast.by_horizon.map((h) => (
                  <tr key={h.horizon_days} className="border-t border-border/40">
                    <td className="py-2">{h.horizon_days}d</td>
                    <td>{h.graded}</td>
                    <td>{h.within_band_rate != null ? `${(h.within_band_rate * 100).toFixed(1)}%` : '—'}</td>
                    <td>{h.median_abs_error_pct != null ? `${h.median_abs_error_pct.toFixed(2)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </>
        ) : <div className="text-sm text-muted-foreground">No forecasts have elapsed yet.</div>}
      </Card>

      {/* Calibration */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <AlertCircle size={18} />
          <h2 className="text-lg font-semibold">Inference calibration</h2>
        </div>
        {calibration && calibration.gates.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-1">Gate</th><th>TP</th><th>FP</th><th>TN</th><th>FN</th>
                <th>FP rate</th><th>Rec</th>
              </tr>
            </thead>
            <tbody>
              {calibration.gates.map((g) => (
                <tr key={g.gate} className="border-t border-border/40">
                  <td className="py-2 font-mono text-xs">{g.gate}</td>
                  <td>{g.true_positives}</td>
                  <td>{g.false_positives}</td>
                  <td>{g.true_negatives}</td>
                  <td>{g.false_negatives}</td>
                  <td>{g.false_positive_rate != null ? `${(g.false_positive_rate * 100).toFixed(1)}%` : '—'}</td>
                  <td>{recBadge(g.recommendation)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-sm text-muted-foreground">No calibration data.</div>}
      </Card>

      {/* DSAR */}
      <Card className="p-6">
        <div className="flex items-center gap-2 mb-3">
          <Shield size={18} />
          <h2 className="text-lg font-semibold">DSAR (POPIA / GDPR) requests</h2>
        </div>
        {dsar && dsar.by_type_and_status.length > 0 ? (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr><th className="py-1">Type</th><th>Status</th><th>Count</th></tr>
            </thead>
            <tbody>
              {dsar.by_type_and_status.map((r, i) => (
                <tr key={i} className="border-t border-border/40">
                  <td className="py-2">{r.request_type}</td>
                  <td>{r.status}</td>
                  <td>{r.n}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="text-sm text-muted-foreground">No DSAR requests recorded.</div>}
      </Card>
    </div>
  );
}
