import { Sparkline } from "@/components/ui/sparkline";
import { Numeric } from "@/components/ui/numeric";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

type Accent = 'sage' | 'sky' | 'bronze' | 'amber' | 'red';

const ACCENT_BORDER: Record<Accent, string> = {
  sage:   'hover:border-[var(--accent)]',
  sky:    'hover:border-[var(--info)]',
  bronze: 'hover:border-[var(--warning)]',
  amber:  'hover:border-[var(--warning)]',
  red:    'hover:border-[var(--neg)]',
};

const ACCENT_SPARK: Record<Accent, string> = {
  sage:   'var(--accent)',
  sky:    'var(--info)',
  bronze: 'var(--bronze)',
  amber:  'var(--warning)',
  red:    'var(--neg)',
};

const trendIcon = (trend: string) => {
  if (trend === "up" || trend === "improving") return <TrendingUp className="w-3.5 h-3.5 text-accent" />;
  if (trend === "down" || trend === "declining") return <TrendingDown className="w-3.5 h-3.5" style={{ color: 'var(--neg)' }} />;
  return <Minus className="w-3.5 h-3.5 t-muted" />;
};

interface KpiCardProps {
  label: string;
  value: string | number;
  trend?: string;
  delta?: number;
  sparkData?: number[];
  /** Subtitle shown to the right of the label (e.g. "42 tasks"). Replaces
   *  the prior `badge` prop — keeps the tile typographically clean. */
  subline?: string;
  accent?: Accent;
  /** Source-of-measure metadata. When provided, renders an inline ⓘ trigger
   *  on the card that opens a popover with the endpoint/table/query behind
   *  the value. Optional so existing callers stay valid. */
  source?: MetricProvenance;
}

export function KpiCard({
  label, value, trend = "stable", delta, sparkData, subline, accent = 'sage', source,
}: KpiCardProps): JSX.Element {
  const sparkColour = trend === "down" || trend === "declining"
    ? 'var(--neg)'
    : ACCENT_SPARK[accent];

  return (
    <div
      className={`p-4 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] transition-colors group ${ACCENT_BORDER[accent]}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-caption font-medium t-muted uppercase tracking-wider">{label}</span>
        <div className="flex items-center gap-1.5">
          {subline && <span className="text-caption t-muted">{subline}</span>}
          {source && <MetricSource source={source} />}
        </div>
      </div>
      <div className="flex items-end justify-between">
        <div>
          {typeof value === 'number' ? (
            <Numeric value={value} size="lg" />
          ) : (
            <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{value}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            {trendIcon(trend)}
            {delta !== undefined && (
              <span className={`text-caption font-medium font-mono ${delta > 0 ? 'text-accent' : delta < 0 ? '' : 't-muted'}`} style={delta < 0 ? { color: 'var(--neg)' } : undefined}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {sparkData && sparkData.length > 0 && (
          <Sparkline data={sparkData} width={60} height={24} color={sparkColour} />
        )}
      </div>
    </div>
  );
}

interface KpiGridProps {
  overallScore: number;
  healthTrend: string;
  avgDelta: number;
  activeCatalysts: number;
  totalTasks: number;
  risksCount: number;
  anomaliesCount: number;
  /** ISO timestamp of last load — feeds the MetricSource freshness rows
   *  on every tile. Optional so callers that don't track this stay valid. */
  refreshedAt?: string | null;
}

export function KpiGrid({
  overallScore, healthTrend, avgDelta, activeCatalysts, totalTasks,
  risksCount, anomaliesCount, refreshedAt,
}: KpiGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Atheon Score" value={overallScore} trend={healthTrend} delta={avgDelta} subline="Live" accent="sage" source={{
        label: 'Atheon Score',
        definition: 'Overall business-health score (0–100), a weighted composite across all monitored dimensions.',
        table: 'health_scores',
        endpoint: 'GET /api/apex/health',
        query: 'health_scores.overall — latest snapshot for tenant',
        window: 'Latest snapshot',
        refreshedAt,
        notes: [{ label: 'Δ vs prior', value: `${avgDelta > 0 ? '+' : ''}${avgDelta.toFixed(1)}%` }],
        drillTo: '/apex',
      }} />
      <KpiCard label="Active Catalysts" value={activeCatalysts} trend="stable" subline={`${totalTasks} tasks`} accent="bronze" source={{
        label: 'Active catalysts',
        definition: 'Catalyst clusters currently in active state. Each cluster is a domain-specific automation (AR aging, GR/IR matching, etc.).',
        table: 'catalyst_clusters',
        endpoint: 'GET /api/catalysts/clusters',
        query: "COUNT(*) FROM catalyst_clusters WHERE tenant_id = ? AND status = 'active'",
        window: 'Snapshot at load',
        refreshedAt,
        notes: [{ label: 'Tasks in flight', value: totalTasks }],
        drillTo: '/catalysts',
      }} />
      <KpiCard label="Active Risks" value={risksCount} trend={risksCount > 3 ? "up" : "stable"} accent={risksCount > 3 ? 'red' : 'sage'} source={{
        label: 'Active risks',
        definition: 'Open business risks flagged by Apex that still require attention.',
        table: 'apex_risks',
        endpoint: 'GET /api/apex/risks',
        query: "COUNT(*) FROM apex_risks WHERE tenant_id = ? AND status IN ('open', 'monitoring')",
        window: 'Snapshot at load',
        refreshedAt,
        sample: risksCount,
        drillTo: '/apex',
      }} />
      <KpiCard label="Anomalies" value={anomaliesCount} trend={anomaliesCount > 2 ? "up" : "stable"} accent={anomaliesCount > 2 ? 'amber' : 'sage'} source={{
        label: 'Active anomalies',
        definition: 'Statistical anomalies detected by Pulse that have not yet been acknowledged.',
        table: 'pulse_anomalies',
        endpoint: 'GET /api/pulse/anomalies',
        query: "COUNT(*) FROM pulse_anomalies WHERE tenant_id = ? AND status = 'active'",
        window: 'Snapshot at load',
        refreshedAt,
        sample: anomaliesCount,
        drillTo: '/pulse',
      }} />
    </div>
  );
}
