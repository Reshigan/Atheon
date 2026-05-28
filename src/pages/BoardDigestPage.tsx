/**
 * /board-digest — Quarterly digest landing for Board Members & Audit Committee.
 *
 * Phase AU sales-unblocker: large enterprises need to be able to invite
 * Board / Audit Committee members to Atheon for quarterly review WITHOUT
 * giving them executive-grade operational access. The `board_member` role
 * (added in this phase) lands here and sees ONLY this page: the headline
 * outcomes the board cares about and nothing else.
 *
 * Surfaces, top-to-bottom:
 *   1. Shared-savings hero — Atheon recovered RX • billed RY • multiple Zx
 *   2. Atheon health score (overall + QoQ delta)
 *   3. Critical risks + active anomalies summary
 *   4. Forecast accuracy headline (within-band rate)
 *   5. Compliance posture (MFA coverage + CC6.1 status)
 *
 * Every tile carries a MetricSource so a non-technical board member can
 * still inspect the provenance behind any number.
 */
import { useCallback, useEffect, useState } from 'react';
import { HeroHeader } from '@/components/ui/hero-header';
import { Card } from '@/components/ui/card';
import { Numeric } from '@/components/ui/numeric';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { MetricSource, type MetricProvenance } from '@/components/ui/metric-source';
import { api, ApiError } from '@/lib/api';
import type { HealthScore, BillingSummary, ForecastAccuracyResp } from '@/lib/api';
import { TrendingUp, ShieldCheck, AlertTriangle, Activity, Crown } from 'lucide-react';

function formatCurrency(value: number, currency = 'ZAR'): string {
  try {
    return new Intl.NumberFormat('en-ZA', {
      style: 'currency', currency, maximumFractionDigits: 0,
    }).format(value);
  } catch {
    return `${currency} ${value.toLocaleString()}`;
  }
}

export default function BoardDigestPage(): JSX.Element {
  const [billing, setBilling] = useState<BillingSummary | null>(null);
  const [forecast, setForecast] = useState<ForecastAccuracyResp | null>(null);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risksCount, setRisksCount] = useState<number>(0);
  const [anomaliesCount, setAnomaliesCount] = useState<number>(0);
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [b, f, h, r, a] = await Promise.allSettled([
        api.insightsStats.billingSummary(),
        api.insightsStats.forecastAccuracy(),
        api.apex.health(),
        api.apex.risks(),
        api.pulse.anomalies(),
      ]);
      if (b.status === 'fulfilled') setBilling(b.value);
      if (f.status === 'fulfilled') setForecast(f.value);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (r.status === 'fulfilled') setRisksCount(r.value.risks.length);
      if (a.status === 'fulfilled') setAnomaliesCount(a.value.anomalies.length);
      setLoadedAt(new Date().toISOString());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load digest');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  if (loading) return <div className="p-6"><LoadingState variant="cards" count={4} /></div>;
  if (error) return <div className="p-6"><ErrorState title="Couldn't load board digest" error={error} onRetry={() => void load()} /></div>;

  const recovered = billing?.total_realised_savings ?? 0;
  const billed = billing?.total_atheon_revenue ?? 0;
  const multiple = billed > 0 ? recovered / billed : 0;
  const currency = billing?.currency ?? 'ZAR';
  const overallScore = Math.round(health?.overall ?? 0);
  const withinBand = forecast?.within_band_rate;

  const baseProvenance: Partial<MetricProvenance> = {
    refreshedAt: loadedAt,
    window: 'Cumulative since first sync',
  };

  return (
    <div className="p-6 space-y-6 max-w-5xl mx-auto" data-testid="board-digest-page">
      <HeroHeader
        icon={Crown}
        title="Board Digest"
        subtitle="Quarterly outcomes — shared-savings, health, risk"
        accent="sage"
      />

      {/* Shared-savings hero — this IS the purchase decision in one tile.
          R0 until you save R1, presented as a single readable line. */}
      <Card className="p-6" style={{ background: 'rgba(163, 177, 138, 0.06)', borderColor: 'rgba(163, 177, 138, 0.30)' }}>
        <div className="flex items-center gap-2 mb-4">
          <TrendingUp size={18} style={{ color: 'var(--accent)' }} />
          <h2 className="text-headline-md font-semibold t-primary">Shared-savings to date</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div>
            <div className="flex items-center justify-between">
              <div className="text-caption uppercase tracking-wider t-muted">Recovered for the business</div>
              <MetricSource source={{
                ...baseProvenance,
                label: 'Total realised savings',
                definition: 'Cumulative operator-confirmed savings across every closed billing period. Each Rand traces to a catalyst action and a source ERP record.',
                table: 'billable_periods',
                endpoint: 'GET /api/insights-stats/billing/summary',
                query: 'SUM(realised_savings_zar) FROM billable_periods',
                notes: [{ label: 'Currency', value: currency }],
              }} />
            </div>
            <p className="text-headline-xl font-bold text-emerald-500 tabular-nums font-mono mt-1">{formatCurrency(recovered, currency)}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <div className="text-caption uppercase tracking-wider t-muted">Atheon billed to date</div>
              <MetricSource source={{
                ...baseProvenance,
                label: 'Atheon revenue (shared-savings share)',
                definition: 'Atheon revenue invoiced under the shared-savings model: contracted % × realised savings. Customer banks the savings first; Atheon bills after.',
                table: 'billable_periods',
                endpoint: 'GET /api/insights-stats/billing/summary',
                query: 'SUM(atheon_revenue_zar) FROM billable_periods',
                notes: [{ label: 'Model', value: 'shared-savings (no upfront fee)' }],
              }} />
            </div>
            <p className="text-headline-xl font-bold t-primary tabular-nums font-mono mt-1">{formatCurrency(billed, currency)}</p>
          </div>
          <div>
            <div className="flex items-center justify-between">
              <div className="text-caption uppercase tracking-wider t-muted">ROI multiple</div>
              <MetricSource source={{
                ...baseProvenance,
                label: 'ROI multiple',
                definition: 'Recovered ÷ billed. The headline outcome metric the audit committee tracks each quarter.',
                query: 'total_realised_savings / NULLIF(total_atheon_revenue, 0)',
              }} />
            </div>
            <p className="text-headline-xl font-bold text-emerald-500 tabular-nums font-mono mt-1">{multiple > 0 ? `${multiple.toFixed(1)}x` : '—'}</p>
          </div>
        </div>
      </Card>

      {/* Business health + risk + anomaly summary */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption uppercase tracking-wider t-muted">Atheon Score</span>
            <div className="flex items-center gap-1">
              <MetricSource source={{
                ...baseProvenance,
                label: 'Atheon Score',
                definition: 'Composite health score across every monitored business dimension (0–100).',
                table: 'health_scores',
                endpoint: 'GET /api/apex/health',
                window: 'Latest snapshot',
              }} />
              <Activity size={14} className="text-accent" />
            </div>
          </div>
          <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{overallScore}<span className="text-body-sm font-normal t-muted ml-1">/ 100</span></p>
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption uppercase tracking-wider t-muted">Critical risks</span>
            <div className="flex items-center gap-1">
              <MetricSource source={{
                ...baseProvenance,
                label: 'Critical risks',
                definition: 'Open business risks flagged by Apex still requiring action.',
                table: 'apex_risks',
                endpoint: 'GET /api/apex/risks',
                query: "COUNT(*) FROM apex_risks WHERE status IN ('open','monitoring')",
                sample: risksCount,
              }} />
              <AlertTriangle size={14} className="text-amber-400" />
            </div>
          </div>
          <p className={`text-headline-lg font-bold tabular-nums font-mono mt-1 ${risksCount === 0 ? 'text-emerald-500' : risksCount > 3 ? 'text-red-400' : 'text-amber-400'}`}>{risksCount}</p>
        </Card>
        <Card>
          <div className="flex items-center justify-between mb-2">
            <span className="text-caption uppercase tracking-wider t-muted">Active anomalies</span>
            <div className="flex items-center gap-1">
              <MetricSource source={{
                ...baseProvenance,
                label: 'Active anomalies',
                definition: 'Statistical anomalies detected by Pulse that have not yet been acknowledged.',
                table: 'pulse_anomalies',
                endpoint: 'GET /api/pulse/anomalies',
                query: "COUNT(*) FROM pulse_anomalies WHERE status = 'active'",
                sample: anomaliesCount,
              }} />
              <Activity size={14} className="text-sky-400" />
            </div>
          </div>
          <p className={`text-headline-lg font-bold tabular-nums font-mono mt-1 ${anomaliesCount === 0 ? 'text-emerald-500' : 'text-amber-400'}`}>{anomaliesCount}</p>
        </Card>
      </div>

      {/* Forecast quality + compliance posture */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <Activity size={16} style={{ color: 'var(--sky)' }} />
            <h3 className="text-body font-semibold t-primary">Forecast accuracy</h3>
            <MetricSource source={{
              ...baseProvenance,
              label: 'Forecast within-band rate',
              definition: 'Share of graded forecasts whose actual outcome landed inside the predicted confidence interval. Higher = more trustworthy forecasts.',
              table: 'forecasts',
              endpoint: 'GET /api/insights-stats/forecast/accuracy',
              window: `Last ${forecast?.lookback_days ?? 90} days`,
              sample: forecast?.total_graded ?? 0,
            }} />
          </div>
          {forecast && forecast.total_graded > 0 ? (
            <div className="flex items-baseline gap-3">
              <span className="text-headline-lg font-bold text-emerald-500 tabular-nums font-mono">
                {withinBand != null ? `${(withinBand * 100).toFixed(1)}%` : '—'}
              </span>
              <span className="text-caption t-muted">
                across <Numeric value={forecast.total_graded} size="sm" /> graded forecasts (last {forecast.lookback_days}d)
              </span>
            </div>
          ) : (
            <p className="text-body-sm t-muted">No forecasts have elapsed yet.</p>
          )}
        </Card>
        <Card>
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={16} className="text-accent" />
            <h3 className="text-body font-semibold t-primary">Compliance posture</h3>
            <MetricSource source={{
              ...baseProvenance,
              label: 'Compliance posture',
              definition: 'High-level SOC 2 + POPIA posture. Detailed evidence pack is in /compliance (auditor + admin only).',
              endpoint: 'GET /api/compliance/evidence-pack',
              notes: [{ label: 'Detail access', value: 'Auditor + Admin roles only' }],
            }} />
          </div>
          <p className="text-body-sm t-secondary">
            Atheon enforces SOC 2 CC6.1 (MFA), CC6.2 (access reviews), and CC7.3 (incident response).
            Detailed evidence is available to your internal audit team via the Auditor role — ask the
            platform admin to issue read-only credentials.
          </p>
        </Card>
      </div>

      <div className="text-caption t-muted text-center pt-2">
        Digest reflects the latest available snapshot. For a quarter-boundary cut, ask your platform admin to download a Board Pack PDF from /apex.
      </div>
    </div>
  );
}
