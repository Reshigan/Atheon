import { useEffect, useState, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Sparkline } from '@/components/ui/sparkline';
import { StatusPill } from '@/components/ui/status-pill';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Wallet, TrendingUp, TrendingDown, Minus, RefreshCw } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type WCResp = Awaited<ReturnType<typeof api.dashboard.workingCapital>>;

function fmtZAR(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `R ${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `R ${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `R ${(n / 1_000).toFixed(0)}k`;
  return `R ${Math.round(n)}`;
}

function fmtDelta(n: number): string {
  if (n === 0) return '0';
  const sign = n > 0 ? '+' : '';
  return `${sign}${fmtZAR(n)}`;
}

export function WorkingCapitalCard() {
  const companyId = useAppStore((s) => s.selectedCompanyId);
  const [data, setData] = useState<WCResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.dashboard.workingCapital(companyId || undefined);
      setData(resp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load working capital');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Card><LoadingState label="Loading working capital..." /></Card>;
  if (error) return <Card><ErrorState error={error} onRetry={load} compact /></Card>;
  if (!data || !data.latest) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <Wallet size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Working Capital</h3>
        </div>
        <EmptyState title="No working-capital snapshot yet" description="Connect an ERP or seed the demo tenant to populate." />
      </Card>
    );
  }

  const { latest, buckets, delta, sparklines } = data;
  const dsoTrend = delta.dsoDays < 0 ? 'down' : delta.dsoDays > 0 ? 'up' : 'flat';
  const cashTrend = delta.cash > 0 ? 'up' : delta.cash < 0 ? 'down' : 'flat';

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-1.5">
          <Wallet size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Working Capital</h3>
          <span className="text-caption t-muted ml-1">· snapshot {latest.snapshotDate}</span>
        </div>
        <button
          onClick={load}
          className="w-7 h-7 rounded-md flex items-center justify-center t-muted hover:t-primary transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
          style={{ background: 'var(--bg-secondary)' }}
          aria-label="Refresh working capital"
        >
          <RefreshCw size={12} />
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <Metric
          label="Cash position"
          value={fmtZAR(latest.cashPositionZar)}
          delta={delta.cash}
          deltaLabel={fmtDelta(delta.cash)}
          trend={cashTrend}
          spark={sparklines.cash}
          accent="emerald"
        />
        <Metric
          label="Working capital"
          value={fmtZAR(latest.workingCapitalZar)}
          delta={delta.workingCapital}
          deltaLabel={fmtDelta(delta.workingCapital)}
          trend={delta.workingCapital > 0 ? 'up' : delta.workingCapital < 0 ? 'down' : 'flat'}
          spark={sparklines.wc}
          accent="sage"
        />
        <Metric
          label="DSO"
          value={`${latest.dsoDays.toFixed(1)} days`}
          delta={delta.dsoDays}
          deltaLabel={`${delta.dsoDays > 0 ? '+' : ''}${delta.dsoDays.toFixed(1)}d`}
          trend={dsoTrend}
          invertTrend
          spark={sparklines.dso}
          accent="sky"
        />
        <Metric
          label="DPO / DSI"
          value={`${latest.dpoDays.toFixed(0)} / ${latest.dsiDays.toFixed(0)}`}
          delta={0}
          deltaLabel="Days payable / Days inventory"
          trend="flat"
          spark={sparklines.dpo}
          accent="bronze"
        />
      </div>

      <div>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-caption font-medium t-muted uppercase tracking-wider">AR aging</span>
          <span className="text-caption t-muted">{fmtZAR(latest.arTotalZar)} total</span>
        </div>
        <div className="h-2 rounded-full overflow-hidden flex" style={{ background: 'var(--bg-secondary)' }}>
          <div className="h-full transition-[width] duration-[var(--dur-quick,200ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
               style={{ width: `${buckets.currentPct}%`, background: '#10b981' }}
               title={`Current: ${buckets.currentPct.toFixed(0)}% (${fmtZAR(latest.arCurrentZar)})`} />
          <div className="h-full transition-[width] duration-[var(--dur-quick,200ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
               style={{ width: `${buckets.days30Pct}%`, background: '#7EB3CD' }}
               title={`30 days: ${buckets.days30Pct.toFixed(0)}% (${fmtZAR(latest.ar30Zar)})`} />
          <div className="h-full transition-[width] duration-[var(--dur-quick,200ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
               style={{ width: `${buckets.days60Pct}%`, background: '#fbbf24' }}
               title={`60 days: ${buckets.days60Pct.toFixed(0)}% (${fmtZAR(latest.ar60Zar)})`} />
          <div className="h-full transition-[width] duration-[var(--dur-quick,200ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]"
               style={{ width: `${buckets.days90PlusPct}%`, background: '#f87171' }}
               title={`90+ days: ${buckets.days90PlusPct.toFixed(0)}% (${fmtZAR(latest.ar90PlusZar)})`} />
        </div>
        <div className="flex items-center gap-3 mt-2 text-caption">
          <BucketLegend swatch="#10b981" label="Current" pct={buckets.currentPct} />
          <BucketLegend swatch="#7EB3CD" label="1–30" pct={buckets.days30Pct} />
          <BucketLegend swatch="#fbbf24" label="31–60" pct={buckets.days60Pct} />
          <BucketLegend swatch="#f87171" label="60+" pct={buckets.days90PlusPct} />
          {buckets.days90PlusPct > 8 && (
            <StatusPill status="failed" label={`${buckets.days90PlusPct.toFixed(0)}% > 60d — action needed`} />
          )}
        </div>
      </div>
    </Card>
  );
}

function BucketLegend({ swatch, label, pct }: { swatch: string; label: string; pct: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2 h-2 rounded-sm" style={{ background: swatch }} />
      <span className="t-muted">{label}</span>
      <span className="t-secondary tabular-nums font-mono">{pct.toFixed(0)}%</span>
    </div>
  );
}

interface MetricProps {
  label: string;
  value: string;
  delta: number;
  deltaLabel: string;
  trend: 'up' | 'down' | 'flat';
  invertTrend?: boolean;
  spark: number[];
  accent: 'emerald' | 'sky' | 'sage' | 'bronze';
}

const ACCENT_SPARK: Record<MetricProps['accent'], string> = {
  emerald: '#10b981',
  sky: '#7EB3CD',
  sage: '#A3B18A',
  bronze: '#CDA37E',
};

function Metric({ label, value, delta, deltaLabel, trend, invertTrend = false, spark, accent }: MetricProps) {
  const positive = invertTrend ? trend === 'down' : trend === 'up';
  const negative = invertTrend ? trend === 'up' : trend === 'down';
  const trendIcon = trend === 'up' ? <TrendingUp size={11} /> : trend === 'down' ? <TrendingDown size={11} /> : <Minus size={11} />;
  const trendColor = positive ? 'text-emerald-500' : negative ? 'text-red-500' : 't-muted';

  return (
    <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
      <div className="text-caption font-medium t-muted uppercase tracking-wider mb-1">{label}</div>
      <div className="text-body-md font-bold t-primary tabular-nums font-mono leading-tight">{value}</div>
      <div className="flex items-center justify-between mt-1.5">
        <div className={`flex items-center gap-1 text-caption ${trendColor}`}>
          {trendIcon}
          <span className="tabular-nums font-mono">{delta === 0 ? deltaLabel : deltaLabel}</span>
        </div>
        {spark.length > 0 && <Sparkline data={spark} width={50} height={18} color={ACCENT_SPARK[accent]} />}
      </div>
    </div>
  );
}
