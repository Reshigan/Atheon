import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Numeric } from "@/components/ui/numeric";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { DashCard } from "./DashCard";

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
  badge?: string;
  badgeVariant?: "default" | "success" | "warning" | "danger";
}

export function KpiCard({ label, value, trend = "stable", delta, sparkData, badge, badgeVariant = "default" }: KpiCardProps) {
  return (
    <DashCard>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium t-muted uppercase tracking-wider">{label}</span>
        {badge && <Badge variant={badgeVariant} size="sm">{badge}</Badge>}
      </div>
      <div className="flex items-end justify-between">
        <div>
          {typeof value === 'number' ? (
            <Numeric value={value} size="xl" />
          ) : (
            <p className="text-2xl font-bold t-primary tabular-nums">{value}</p>
          )}
          <div className="flex items-center gap-1.5 mt-1">
            {trendIcon(trend)}
            {delta !== undefined && (
              <span className={`text-xs font-medium ${delta > 0 ? 'text-emerald-500' : delta < 0 ? 'text-red-500' : 't-muted'}`}>
                {delta > 0 ? '+' : ''}{delta.toFixed(1)}%
              </span>
            )}
          </div>
        </div>
        {sparkData && sparkData.length > 0 && (
          <Sparkline data={sparkData} width={60} height={24} color={trend === "down" || trend === "declining" ? "#ef4444" : "#A3B18A"} />
        )}
      </div>
    </DashCard>
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

export function KpiGrid({ overallScore, healthTrend, avgDelta, activeCatalysts, totalTasks, risksCount, anomaliesCount }: KpiGridProps) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      <KpiCard label="Atheon Score" value={overallScore} trend={healthTrend} delta={avgDelta} badge="Live" badgeVariant="success" />
      <KpiCard label="Active Catalysts" value={activeCatalysts} trend="stable" badge={`${totalTasks} tasks`} />
      <KpiCard label="Active Risks" value={risksCount} trend={risksCount > 3 ? "up" : "stable"} badgeVariant={risksCount > 3 ? "danger" : "default"} />
      <KpiCard label="Anomalies" value={anomaliesCount} trend={anomaliesCount > 2 ? "up" : "stable"} badgeVariant={anomaliesCount > 2 ? "warning" : "default"} />
    </div>
  );
}
