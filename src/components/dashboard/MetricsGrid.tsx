/**
 * SPEC-004: Frontend Component Decomposition — Metrics Grid
 * Extracted from Dashboard.tsx for reuse across pages.
 */
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export interface MetricItem {
  id: string;
  label: string;
  value: number | string;
  unit?: string;
  trend?: 'up' | 'down' | 'stable';
  changePercent?: number;
  status?: 'healthy' | 'warning' | 'critical';
}

interface Props {
  metrics: MetricItem[];
  columns?: 2 | 3 | 4;
  onMetricClick?: (metric: MetricItem) => void;
}

const statusDot = {
  healthy: 'bg-emerald-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
};

const trendConfig = {
  up: { icon: <TrendingUp size={10} />, color: 'text-emerald-500' },
  down: { icon: <TrendingDown size={10} />, color: 'text-red-500' },
  stable: { icon: <Minus size={10} />, color: 'text-gray-400' },
};

export function MetricsGrid({ metrics, columns = 4, onMetricClick }: Props) {
  return (
    <div className={`grid gap-3 grid-cols-2 md:grid-cols-${columns}`}>
      {metrics.map((metric) => (
        <button
          key={metric.id}
          onClick={() => onMetricClick?.(metric)}
          className="p-3 rounded-xl text-left transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] hover:bg-[var(--bg-secondary)] active:scale-[0.97]"
          style={{ border: '1px solid var(--border-card)' }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-label truncate">{metric.label}</span>
            {metric.status && (
              <div className={`w-1.5 h-1.5 rounded-full ${statusDot[metric.status]}`} />
            )}
          </div>
          <div className="flex items-end gap-1">
            <span className="text-lg font-bold t-primary">
              {typeof metric.value === 'number' ? metric.value.toLocaleString() : metric.value}
            </span>
            {metric.unit && <span className="text-caption t-muted mb-0.5">{metric.unit}</span>}
          </div>
          {metric.trend && metric.changePercent !== undefined && (
            <div className={`flex items-center gap-1 mt-1 ${trendConfig[metric.trend].color}`}>
              {trendConfig[metric.trend].icon}
              <span className="text-caption">
                {metric.changePercent > 0 ? '+' : ''}{metric.changePercent.toFixed(1)}%
              </span>
            </div>
          )}
        </button>
      ))}
    </div>
  );
}
