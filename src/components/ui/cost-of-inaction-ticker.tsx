/**
 * §11.5 Cost-of-Inaction Ticker — Real-time cost display
 */
import { useState, useEffect, useRef } from 'react';
import { api } from '@/lib/api';
import type { CostOfInactionResponse } from '@/lib/api';
import { AlertTriangle, Clock, TrendingUp } from 'lucide-react';
import { StatusPill, type StatusKind } from '@/components/ui/status-pill';
import { formatDays } from '@/lib/utils';

function formatCurrency(value: number): string {
  if (value >= 1_000_000) return `R${(value / 1_000_000).toFixed(2)}M`;
  if (value >= 1_000) return `R${(value / 1_000).toFixed(0)}k`;
  return `R${value.toFixed(0)}`;
}

export function CostOfInactionTicker({ compact = false, data: externalData }: { compact?: boolean; data?: CostOfInactionResponse }) {
  const [internalData, setInternalData] = useState<CostOfInactionResponse | null>(null);
  const data = externalData ?? internalData;
  const [displayCost, setDisplayCost] = useState(0);
  const tickerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (!externalData) {
      api.costOfInaction.get()
        .then(setInternalData)
        .catch(() => { /* non-critical — ticker stays hidden */ });
    }
  }, [externalData]);

  // Animate the ticker — increment by daily cost / 86400 per second
  useEffect(() => {
    if (!data || data.dailyCost === 0) return;
    setDisplayCost(data.accruedCost);
    const perSecond = data.dailyCost / 86400;
    tickerRef.current = setInterval(() => {
      setDisplayCost((prev) => prev + perSecond);
    }, 1000);
    return () => { if (tickerRef.current) clearInterval(tickerRef.current); };
  }, [data]);

  if (!data) return null;
  if (data.activeRcaCount === 0 && data.totalExposure === 0) return null;

  if (compact) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded bg-[rgb(var(--neg-rgb)/0.10)] border border-[rgb(var(--neg-rgb)/0.20)]">
        <AlertTriangle size={12} className="text-[var(--neg)] flex-shrink-0" />
        <span className="text-xs font-mono font-bold text-[var(--neg)]">{formatCurrency(displayCost)}</span>
        <span className="text-caption t-muted">cost of inaction</span>
      </div>
    );
  }

  return (
    <div className="rounded-md p-4 bg-[rgb(var(--neg-rgb)/0.05)] border border-[rgb(var(--neg-rgb)/0.15)]">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle size={14} className="text-[var(--neg)]" />
        <h4 className="text-xs font-semibold t-primary">Cost of Inaction</h4>
      </div>

      <div className="text-center mb-3">
        <p className="text-3xl font-mono font-bold text-[var(--neg)] tabular-nums">
          {formatCurrency(displayCost)}
        </p>
        <p className="text-caption t-muted mt-1">Accrued cost from unresolved issues</p>
      </div>

      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="p-2 rounded bg-[var(--bg-secondary)]">
          <p className="text-sm font-bold t-primary">{formatCurrency(data.dailyCost)}</p>
          <p className="text-caption t-muted">Daily</p>
        </div>
        <div className="p-2 rounded bg-[var(--bg-secondary)]">
          <Clock size={10} className="inline mr-1 t-muted" />
          <span className="text-sm font-bold t-primary">{formatDays(data.avgDaysOpen)}</span>
          <p className="text-caption t-muted">Avg Open</p>
        </div>
        <div className="p-2 rounded bg-[var(--bg-secondary)]">
          <TrendingUp size={10} className="inline mr-1 text-[var(--neg)]" />
          <span className="text-sm font-bold text-[var(--neg)]">{formatCurrency(data.projectedMonthlyCost)}</span>
          <p className="text-caption t-muted">30-Day Proj.</p>
        </div>
      </div>

      {data.rcaBreakdown.length > 0 && (
        <div className="mt-3 space-y-1">
          {data.rcaBreakdown.slice(0, 3).map((rca) => (
            <div key={rca.rcaId} className="flex items-center justify-between text-caption">
              <span className="t-secondary truncate max-w-[60%]">{rca.metricName}</span>
              <div className="flex items-center gap-2">
                <StatusPill
                  status={(rca.severity === 'red' ? 'red' : rca.severity === 'amber' ? 'amber' : 'info') as StatusKind}
                  label={formatDays(rca.daysOpen)}
                  size="sm"
                  noGlyph
                />
                <span className="t-muted">{rca.pendingPrescriptions} pending</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
