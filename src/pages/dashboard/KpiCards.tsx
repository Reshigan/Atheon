import { Sparkline } from "@/components/ui/sparkline";
import { Numeric } from "@/components/ui/numeric";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

/**
 * Dashboard KPI tiles — Stitch hover-tint pattern.
 * Each tile gets an `accent` driving the hover border + sparkline colour:
 *   - sage    (default, positive metrics)
 *   - sky     (informational metrics)
 *   - bronze  (operations / catalyst metrics)
 *   - amber   (anomaly / watchlist)
 *   - red     (urgent / risk)
 * Hover border lifts using the same accent — a quiet but persistent cue.
 */
type Accent = 'sage' | 'sky' | 'bronze' | 'amber' | 'red';

const ACCENT_BORDER: Record<Accent, string> = {
  sage:   'hover:border-emerald-500/40',
  sky:    'hover:border-sky-500/40',
  bronze: 'hover:border-amber-500/40',
  amber:  'hover:border-amber-500/40',
  red:    'hover:border-red-500/40',
};

const ACCENT_SPARK: Record<Accent, string> = {
  sage:   '#A3B18A',
  sky:    '#7EB3CD',
  bronze: '#CDA37E',
  amber:  '#FBBF24',
  red:    '#F87171',
};

const trendIcon = (trend: string) => {
  if (trend === "up" || trend === "improving") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "down" || trend === "declining") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
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
}

export function KpiCard({
  label, value, trend = "stable", delta, sparkData, subline, accent = 'sage',
}: KpiCardProps): JSX.Element {
  const sparkColour = trend === "down" || trend === "declining"
    ? '#F87171'
    : ACCENT_SPARK[accent];

  return (
    <div
      className={`p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] transition-colors group ${ACCENT_BORDER[accent]}`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-caption font-medium t-muted uppercase tracking-wider">{label}</span>
        {subline && <span className="text-caption t-muted">{subline}</span>}
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
              <span className={`text-caption font-medium font-mono ${delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-red-500' : 't-muted'}`}>
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
}

export function KpiGrid({ overallScore, healthTrend, avgDelta, activeCatalysts, totalTasks, risksCount, anomaliesCount }: KpiGridProps): JSX.Element {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Atheon Score" value={overallScore} trend={healthTrend} delta={avgDelta} subline="Live" accent="sage" />
      <KpiCard label="Active Catalysts" value={activeCatalysts} trend="stable" subline={`${totalTasks} tasks`} accent="bronze" />
      <KpiCard label="Active Risks" value={risksCount} trend={risksCount > 3 ? "up" : "stable"} accent={risksCount > 3 ? 'red' : 'sage'} />
      <KpiCard label="Anomalies" value={anomaliesCount} trend={anomaliesCount > 2 ? "up" : "stable"} accent={anomaliesCount > 2 ? 'amber' : 'sage'} />
    </div>
  );
}
