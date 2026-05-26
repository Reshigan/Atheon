import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { StatusPill } from '@/components/ui/status-pill';
import { Sparkline } from '@/components/ui/sparkline';
import { LoadingState, ErrorState, EmptyState } from '@/components/ui/state';
import { Timer, RefreshCw, AlertOctagon, TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAppStore } from '@/stores/appStore';

type SLAResp = Awaited<ReturnType<typeof api.pulse.sla>>;
type SLAItem = SLAResp['items'][number];

function fmtHours(n: number): string {
  if (n >= 168) return `${(n / 168).toFixed(1)}w`;
  if (n >= 24) return `${(n / 24).toFixed(1)}d`;
  if (n >= 1) return `${n.toFixed(1)}h`;
  return `${Math.round(n * 60)}m`;
}

function pillForStatus(status: 'green' | 'amber' | 'red'): React.ReactNode {
  if (status === 'green') return <StatusPill status="completed" label="On track" />;
  if (status === 'amber') return <StatusPill status="amber" label="At risk" />;
  return <StatusPill status="failed" label="Breaching" />;
}

function deltaTrend(trend: SLAItem['trend']): { dir: 'up' | 'down' | 'flat'; pct: number } {
  if (trend.length < 2) return { dir: 'flat', pct: 0 };
  const first = trend[0].adherencePct;
  const last = trend[trend.length - 1].adherencePct;
  const diff = last - first;
  if (Math.abs(diff) < 0.5) return { dir: 'flat', pct: diff };
  return { dir: diff > 0 ? 'up' : 'down', pct: diff };
}

export function SLAAdherencePanel() {
  const companyId = useAppStore((s) => s.selectedCompanyId);
  const [data, setData] = useState<SLAResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [domainFilter, setDomainFilter] = useState<string>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.pulse.sla(companyId || undefined);
      setData(resp);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load SLA adherence');
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => { load(); }, [load]);

  const domains = useMemo(() => {
    if (!data) return [] as string[];
    const set = new Set<string>();
    data.items.forEach((it) => set.add(it.domain));
    return Array.from(set).sort();
  }, [data]);

  const filteredItems = useMemo(() => {
    if (!data) return [];
    if (domainFilter === 'all') return data.items;
    return data.items.filter((it) => it.domain === domainFilter);
  }, [data, domainFilter]);

  if (loading) return <LoadingState variant="cards" count={4} />;
  if (error) return <Card><ErrorState error={error} onRetry={load} /></Card>;
  if (!data || data.items.length === 0) {
    return (
      <Card>
        <div className="flex items-center gap-1.5 mb-3">
          <Timer size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">SLA Adherence</h3>
        </div>
        <EmptyState title="No SLAs configured" description="Set process SLA targets to track adherence and breaches." />
      </Card>
    );
  }

  return (
    <div className="space-y-4 animate-fadeIn">
      {/* Summary strip */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <SummaryTile
          label="SLAs tracked"
          value={String(data.summary.totalSlas)}
          icon={<Timer size={14} className="text-accent" />}
        />
        <SummaryTile
          label="Avg adherence"
          value={`${data.summary.avgAdherencePct.toFixed(1)}%`}
          icon={<TrendingUp size={14} className={data.summary.avgAdherencePct >= 95 ? 'text-emerald-500' : data.summary.avgAdherencePct >= 85 ? 'text-amber-400' : 'text-red-500'} />}
          tone={data.summary.avgAdherencePct < 85 ? 'red' : 'neutral'}
        />
        <SummaryTile
          label="Breaching SLAs"
          value={String(data.summary.breachingSlas)}
          icon={<AlertOctagon size={14} className={data.summary.breachingSlas > 0 ? 'text-red-500' : 't-muted'} />}
          tone={data.summary.breachingSlas > 0 ? 'red' : 'neutral'}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        {domains.length > 1 && (
          <div className="flex items-center gap-1 flex-wrap">
            <span className="text-xs t-muted font-medium mr-1">Domain:</span>
            <button
              onClick={() => setDomainFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] ${domainFilter === 'all' ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted hover:t-primary'}`}
            >All</button>
            {domains.map((d) => (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-[background-color,color] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] capitalize ${domainFilter === d ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted hover:t-primary'}`}
              >{d}</button>
            ))}
          </div>
        )}
        <button
          onClick={load}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,transform] duration-[var(--dur-press,160ms)] [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] active:scale-[0.97]"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* SLA cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {filteredItems.map((sla) => <SLACard key={sla.id} sla={sla} />)}
      </div>
    </div>
  );
}

function SLACard({ sla }: { sla: SLAItem }) {
  const delta = deltaTrend(sla.trend);
  const trendData = sla.trend.map((t) => t.adherencePct);
  const accent = sla.status === 'green' ? '#10b981' : sla.status === 'amber' ? '#fbbf24' : '#f87171';
  const adherenceLabel = sla.latest ? `${sla.latest.adherencePct.toFixed(1)}%` : '—';
  const avgVsTarget = sla.latest ? sla.latest.avgHours / sla.targetHours : 0;

  return (
    <Card>
      <div className="flex items-start justify-between mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <Timer size={14} className="text-accent flex-shrink-0" />
            <h3 className="text-sm font-semibold t-primary truncate">{sla.processName}</h3>
          </div>
          <p className="text-caption t-muted mt-0.5 capitalize">{sla.domain} · target {fmtHours(sla.targetHours)} · {sla.thresholdPct.toFixed(0)}% threshold</p>
        </div>
        {pillForStatus(sla.status)}
      </div>

      <div className="grid grid-cols-3 gap-2.5 mb-3">
        <Tile
          label="Adherence"
          value={adherenceLabel}
          accent={accent}
          big
        />
        <Tile
          label="Avg cycle"
          value={sla.latest ? fmtHours(sla.latest.avgHours) : '—'}
          sub={sla.latest ? `${(avgVsTarget * 100).toFixed(0)}% of target` : undefined}
        />
        <Tile
          label="Breaches"
          value={sla.latest ? String(sla.latest.breachedCount) : '—'}
          sub={sla.latest ? `of ${sla.latest.totalItems}` : undefined}
          tone={sla.latest && sla.latest.breachedCount > 0 ? 'red' : 'neutral'}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 text-caption">
          {delta.dir === 'up' ? <TrendingUp size={12} className="text-emerald-500" /> : delta.dir === 'down' ? <TrendingDown size={12} className="text-red-500" /> : <Minus size={12} className="t-muted" />}
          <span className={`tabular-nums font-mono ${delta.dir === 'up' ? 'text-emerald-500' : delta.dir === 'down' ? 'text-red-500' : 't-muted'}`}>
            {delta.pct === 0 ? '0' : `${delta.pct > 0 ? '+' : ''}${delta.pct.toFixed(1)}pp`}
          </span>
          <span className="t-muted">30d</span>
        </div>
        {trendData.length > 0 && <Sparkline data={trendData} width={120} height={24} color={accent} />}
      </div>

      {sla.owner && (
        <p className="text-caption t-muted mt-2.5 pt-2.5 border-t border-[var(--border-card)]">Owner: <span className="t-secondary">{sla.owner}</span></p>
      )}
    </Card>
  );
}

function SummaryTile({ label, value, icon, tone = 'neutral' }: {
  label: string; value: string; icon: React.ReactNode; tone?: 'neutral' | 'red';
}) {
  return (
    <div
      className="p-2.5 rounded-lg border"
      style={{
        background: tone === 'red' ? 'rgba(248,113,113,0.06)' : 'var(--bg-card-solid)',
        borderColor: tone === 'red' ? 'rgba(248,113,113,0.30)' : 'var(--border-card)',
      }}
    >
      <div className="flex items-center gap-1.5 mb-1">
        {icon}
        <span className="text-caption font-medium t-muted uppercase tracking-wider">{label}</span>
      </div>
      <div className="text-body-md font-bold t-primary tabular-nums font-mono">{value}</div>
    </div>
  );
}

function Tile({ label, value, sub, accent, tone = 'neutral', big = false }: {
  label: string; value: string; sub?: string; accent?: string; tone?: 'neutral' | 'red'; big?: boolean;
}) {
  return (
    <div
      className="p-2 rounded-md border"
      style={{
        background: tone === 'red' ? 'rgba(248,113,113,0.06)' : 'var(--bg-card-solid)',
        borderColor: tone === 'red' ? 'rgba(248,113,113,0.30)' : 'var(--border-card)',
      }}
    >
      <div className="text-caption font-medium t-muted uppercase tracking-wider">{label}</div>
      <div
        className={`font-bold tabular-nums font-mono mt-0.5 ${big ? 'text-body-md' : 'text-caption'}`}
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {sub && <div className="text-caption t-muted mt-0.5">{sub}</div>}
    </div>
  );
}
