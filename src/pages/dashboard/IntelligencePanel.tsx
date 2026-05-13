import { StatusPill } from "@/components/ui/status-pill";
import { Lightbulb, AlertTriangle, ArrowRight } from "lucide-react";
import { cleanLlmText } from "@/lib/utils";
import { DashCard } from "./DashCard";
import type { DashboardIntelligenceResponse } from "@/lib/api";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

const trendIcon = (trend: string) => {
  if (trend === "up" || trend === "improving") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "down" || trend === "declining") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

interface IntelligencePanelProps {
  data: DashboardIntelligenceResponse;
}

export function IntelligencePanel({ data }: IntelligencePanelProps) {
  return (
    <DashCard className="!border-purple-500/20 !bg-purple-500/5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Lightbulb size={16} className="text-purple-400" />
          <h3 className="text-sm font-semibold t-primary">Atheon Intelligence</h3>
        </div>
        <span className="text-caption t-muted">{data.poweredBy}</span>
      </div>
      <p className="text-sm t-secondary mb-3 whitespace-pre-line">{cleanLlmText(data.summary)}</p>
      {data.keyMetrics.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium t-primary mb-1.5">Key Metrics</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
            {data.keyMetrics.map((m, i) => (
              <div key={i} className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                <p className="text-caption t-muted">{m.name}</p>
                <p className="text-sm font-bold t-primary">{typeof m.value === 'number' ? m.value.toFixed(1) : m.value}</p>
                <div className="flex items-center gap-1">
                  {trendIcon(m.trend)}
                  <span className="text-caption t-muted">{m.status === 'red' ? 'Critical' : m.status === 'amber' ? 'Warning' : 'Healthy'}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      {data.topRisks.length > 0 && (
        <div className="mb-3">
          <p className="text-xs font-medium t-primary mb-1.5">Top Risks</p>
          <div className="space-y-1">
            {data.topRisks.map((r, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <AlertTriangle size={10} className={r.severity === 'critical' ? 'text-red-400' : r.severity === 'high' ? 'text-amber-400' : 'text-gray-400'} />
                <span className="t-primary font-medium">{r.title}</span>
                <StatusPill status={r.severity} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}
      {data.recommendedActions.length > 0 && (
        <div>
          <p className="text-xs font-medium t-primary mb-1.5">Recommended Actions</p>
          <ul className="space-y-1">
            {data.recommendedActions.map((a, i) => (
              <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
                <ArrowRight size={10} className="text-purple-400 mt-0.5 flex-shrink-0" />
                {a}
              </li>
            ))}
          </ul>
        </div>
      )}
    </DashCard>
  );
}
