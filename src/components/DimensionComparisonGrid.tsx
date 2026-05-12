import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Sparkline } from "@/components/ui/sparkline";
import { Skeleton } from "@/components/ui/skeleton";
import { X, AlertTriangle, TrendingUp, TrendingDown, Minus, BarChart3 } from "lucide-react";
import { api } from "@/lib/api";
import type { HealthDimensionTraceResponse, Risk } from "@/lib/api";

interface DimensionComparisonGridProps {
  selectedDimensions: string[];
  onRemove: (dimension: string) => void;
  risks: Risk[];
  companyId?: string;
}

const trendIcon = (trend: string, size = 12) => {
  if (trend === "up" || trend === "improving") return <TrendingUp size={size} className="text-emerald-400" />;
  if (trend === "down" || trend === "declining") return <TrendingDown size={size} className="text-red-400" />;
  return <Minus size={size} className="text-gray-400" />;
};

const toneFor = (score: number | null) => {
  if (score === null || score === undefined) return "#9ca3af";
  if (score >= 80) return "#10b981";
  if (score >= 60) return "#f59e0b";
  return "#ef4444";
};

export function DimensionComparisonGrid({ selectedDimensions, onRemove, risks, companyId }: DimensionComparisonGridProps) {
  const [data, setData] = useState<Record<string, HealthDimensionTraceResponse | null>>({});
  const [loading, setLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    async function loadDimensions() {
      for (const dim of selectedDimensions) {
        if (data[dim] !== undefined) continue;
        setLoading(prev => ({ ...prev, [dim]: true }));
        try {
          const result = await api.apex.healthDimension(dim, undefined, companyId);
          if (!cancelled) {
            setData(prev => ({ ...prev, [dim]: result ?? null }));
          }
        } catch (err) {
          console.error(`Failed to load dimension ${dim}:`, err);
          if (!cancelled) {
            setData(prev => ({ ...prev, [dim]: null }));
          }
        } finally {
          if (!cancelled) setLoading(prev => ({ ...prev, [dim]: false }));
        }
      }
    }
    loadDimensions();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDimensions.join("|"), companyId]);

  if (selectedDimensions.length === 0) return null;

  const gridCols =
    selectedDimensions.length === 1
      ? "grid-cols-1"
      : selectedDimensions.length === 2
      ? "grid-cols-1 md:grid-cols-2"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold t-primary">Dimension Comparison</h3>
        <Badge variant="info" size="sm">
          {selectedDimensions.length} pinned
        </Badge>
      </div>
      <div className={`grid ${gridCols} gap-4`}>
        {selectedDimensions.map(dim => {
          const result = data[dim];
          const isLoading = loading[dim];
          const dimensionRisks = risks.filter(r => r.category?.toLowerCase() === dim.toLowerCase()).slice(0, 3);
          const sparklinePoints =
            result?.traceability?.relevantKpis?.slice(0, 12).map(k => Number(k.value) || 0) ?? [];
          const tone = toneFor(result?.score ?? null);
          return (
            <Card key={dim} variant="default" className="relative">
              <button
                type="button"
                onClick={() => onRemove(dim)}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-400 transition-colors"
                title={`Remove ${dim} from comparison`}
                aria-label={`Remove ${dim} from comparison`}
              >
                <X size={14} />
              </button>
              <div className="mb-2">
                <p className="text-label">Dimension</p>
                <h4 className="text-base font-semibold t-primary capitalize">{dim}</h4>
              </div>
              {isLoading ? (
                <Skeleton variant="card" height={100} />
              ) : result ? (
                <>
                  <div className="flex items-end justify-between mb-3">
                    <div>
                      <p className="text-label">Current</p>
                      <p className="text-3xl font-bold" style={{ color: tone }}>
                        {result.score ?? "--"}
                      </p>
                      <div className="flex items-center gap-1 mt-1">
                        {trendIcon(result.trend)}
                        <span className={`text-caption ${(result.delta ?? 0) >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                          {(result.delta ?? 0) > 0 ? "+" : ""}
                          {result.delta ?? 0}
                        </span>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-label">Target</p>
                      <p className="text-sm font-medium t-primary">80</p>
                    </div>
                  </div>
                  <Progress
                    value={result.score ?? 0}
                    color={(result.score ?? 0) >= 80 ? "emerald" : (result.score ?? 0) >= 60 ? "amber" : "red"}
                    size="sm"
                  />
                  {sparklinePoints.length >= 2 && (
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-caption t-muted">Recent trend</span>
                      <Sparkline data={sparklinePoints} width={100} height={24} color={tone} />
                    </div>
                  )}
                  <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                    <p className="text-label mb-1.5">
                      Top Risks ({dimensionRisks.length})
                    </p>
                    {dimensionRisks.length === 0 ? (
                      <p className="text-caption t-muted">No risks tagged to this dimension.</p>
                    ) : (
                      <ul className="space-y-1">
                        {dimensionRisks.map(r => (
                          <li key={r.id} className="flex items-start gap-1.5 text-caption">
                            <AlertTriangle
                              size={10}
                              className={
                                r.severity === "critical"
                                  ? "text-red-400 mt-0.5"
                                  : r.severity === "high"
                                  ? "text-amber-400 mt-0.5"
                                  : "t-muted mt-0.5"
                              }
                            />
                            <span className="t-secondary truncate flex-1">{r.title}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="text-xs t-muted">No data available for this dimension.</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
