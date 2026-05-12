import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Minus, Flame, AlertTriangle } from "lucide-react";
import type { Metric } from "@/lib/api";

const trendIcon = (trend: number[]) => {
  if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend.length >= 2 && trend[trend.length - 1] < trend[0]) return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

const trendLabel = (trend: number[]) => {
  if (trend.length >= 2 && trend[trend.length - 1] > trend[0]) return 'improving';
  if (trend.length >= 2 && trend[trend.length - 1] < trend[0]) return 'declining';
  return 'stable';
};

/**
 * Chronic vs acute classification for red metrics.
 *
 * "Chronic" → the metric has been outside the red threshold for ≥70% of the
 * trend window. Operators should treat this as a project, not a page-out.
 * "Acute" → the metric just spiked. Page on-call.
 *
 * Returns null for green/amber metrics (the badge is enough) and for red
 * metrics with too little trend data to classify reliably (<3 readings).
 */
function chronicAcuteLabel(m: Metric): { label: 'chronic' | 'acute'; ratio: number } | null {
  if (m.status !== 'red') return null;
  if (!m.trend || m.trend.length < 3) return null;
  const redThreshold = m.thresholds?.red;
  if (redThreshold === null || redThreshold === undefined) return null;
  // Compare each trend reading against the red threshold. Some metrics are
  // "lower-is-worse" (e.g. uptime%) and others are "higher-is-worse"
  // (e.g. latency, defect rate). We can't tell which from the schema, so
  // count the trend points whose value is on the *current* status' side of
  // the threshold — for a currently-red metric, that's the side `m.value`
  // sits on relative to `redThreshold`.
  const currentlyAbove = (m.value ?? 0) > redThreshold;
  const breachCount = m.trend.filter(v => (currentlyAbove ? v > redThreshold : v < redThreshold)).length;
  const ratio = breachCount / m.trend.length;
  return { label: ratio >= 0.7 ? 'chronic' : 'acute', ratio };
}

interface MetricsGridProps {
  metrics: Metric[];
}

export function MetricsGrid({ metrics }: MetricsGridProps) {
  if (metrics.length === 0) {
    return <p className="text-sm t-muted text-center py-8">No metrics available yet. Run catalysts to generate metrics.</p>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
      {metrics.map((m, i) => {
        const ca = chronicAcuteLabel(m);
        return (
          <div key={i} className="p-4 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium t-muted uppercase tracking-wider">
                {m.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}
              </span>
              <div className="flex items-center gap-1.5">
                {ca && (
                  <Badge
                    variant={ca.label === 'chronic' ? 'danger' : 'warning'}
                    size="sm"
                    className="flex items-center gap-1"
                  >
                    {ca.label === 'chronic' ? <Flame size={10} /> : <AlertTriangle size={10} />}
                    <span title={`${Math.round(ca.ratio * 100)}% of recent readings breached threshold`}>{ca.label}</span>
                  </Badge>
                )}
                <Badge variant={m.status === 'red' ? 'danger' : m.status === 'amber' ? 'warning' : 'success'} size="sm">
                  {m.status}
                </Badge>
              </div>
            </div>
            <p className="text-xl font-bold t-primary">{typeof m.value === 'number' ? m.value.toFixed(1) : m.value}</p>
            <div className="flex items-center gap-1.5 mt-1">
              {trendIcon(m.trend)}
              <span className="text-xs t-muted">{trendLabel(m.trend)}</span>
              {ca?.label === 'chronic' && (
                <span className="text-caption t-muted ml-auto" title="Run a catalyst to address the underlying issue">
                  → run a catalyst
                </span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
