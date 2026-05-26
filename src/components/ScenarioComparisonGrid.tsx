import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { X, BarChart3, TrendingUp, TrendingDown, Minus } from "lucide-react";
import type { ScenarioItem } from "@/lib/api";

interface ScenarioComparisonGridProps {
  scenarios: ScenarioItem[];
  selectedIds: string[];
  baselineHealth: number;
  onRemove: (id: string) => void;
}

function findNumericField(
  results: Record<string, unknown> | null | undefined,
  keys: string[]
): number | null {
  if (!results) return null;
  for (const k of keys) {
    const v = results[k];
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string") {
      const parsed = Number(v);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return null;
}

function extractProjectedHealth(s: ScenarioItem, baseline: number): number | null {
  const direct = findNumericField(s.results, [
    "projected_health_score",
    "projectedHealthScore",
    "projected_score",
    "health_score",
    "score",
  ]);
  if (direct !== null) return Math.round(direct);
  // Fallback: some scenarios return delta/impact %
  const pct = findNumericField(s.results, [
    "health_delta_pct",
    "impact_pct",
    "delta_pct",
    "percentage_change",
  ]);
  if (pct !== null) return Math.round(baseline + (baseline * pct) / 100);
  return null;
}

function extractAssumptionEntries(s: ScenarioItem): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  const baseValues = (s as ScenarioItem & { baseValues?: Record<string, unknown> }).baseValues;
  if (baseValues && typeof baseValues === "object") {
    for (const [k, v] of Object.entries(baseValues)) {
      entries.push([k, String(v)]);
    }
  } else if (s.variables && Array.isArray(s.variables)) {
    for (const v of s.variables) {
      if (typeof v === "string") {
        entries.push([v, "--"]);
      } else if (v && typeof v === "object" && typeof (v as { name?: string }).name === "string") {
        const obj = v as { name: string; current?: number; hypothetical?: number; value?: number; unit?: string };
        const valueParts: string[] = [];
        if (obj.hypothetical !== undefined) {
          valueParts.push(`${obj.current ?? "?"} → ${obj.hypothetical}`);
        } else if (obj.value !== undefined) {
          valueParts.push(String(obj.value));
        }
        if (obj.unit) valueParts.push(obj.unit);
        entries.push([obj.name, valueParts.join(" ") || "--"]);
      }
    }
  }
  return entries.slice(0, 5);
}

export function ScenarioComparisonGrid({
  scenarios,
  selectedIds,
  baselineHealth,
  onRemove,
}: ScenarioComparisonGridProps) {
  if (selectedIds.length === 0) return null;

  const selected = scenarios.filter(s => selectedIds.includes(s.id));
  if (selected.length === 0) return null;

  const gridCols =
    selected.length === 1
      ? "grid-cols-1"
      : selected.length === 2
      ? "grid-cols-1 md:grid-cols-2"
      : selected.length === 3
      ? "grid-cols-1 md:grid-cols-3"
      : "grid-cols-1 md:grid-cols-2 lg:grid-cols-4";

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <BarChart3 size={14} className="text-accent" />
        <h3 className="text-sm font-semibold t-primary">Scenario Comparison</h3>
        <Badge variant="info" size="sm">
          {selected.length} pinned
        </Badge>
        <span className="text-caption t-muted">Baseline health: {baselineHealth}</span>
      </div>
      <div className={`grid ${gridCols} gap-4`}>
        {selected.map(scenario => {
          const projected = extractProjectedHealth(scenario, baselineHealth);
          const delta = projected !== null ? projected - baselineHealth : null;
          const assumptions = extractAssumptionEntries(scenario);
          const recommendation =
            typeof scenario.results?.recommendation === "string"
              ? (scenario.results.recommendation as string)
                  .replace(/```json\s*/g, "")
                  .replace(/```/g, "")
                  .replace(/\*\*/g, "")
                  .replace(/\*/g, "")
                  .split("\n")
                  .filter(l => l.trim() && !/^[{}[\]]+$/.test(l.trim()) && !/^"\w+"\s*:/.test(l.trim()))
                  .join(" ")
                  .slice(0, 180)
              : null;
          return (
            <Card key={scenario.id} className="relative">
              <button
                type="button"
                onClick={() => onRemove(scenario.id)}
                className="absolute top-3 right-3 text-gray-400 hover:text-red-400 transition-colors"
                title={`Remove ${scenario.title} from comparison`}
                aria-label={`Remove ${scenario.title} from comparison`}
              >
                <X size={14} />
              </button>
              <div className="mb-2 pr-5">
                <p className="text-label">Scenario</p>
                <h4 className="text-sm font-semibold t-primary truncate">{scenario.title}</h4>
                <Badge
                  variant={scenario.status === "completed" ? "success" : "warning"}
                  size="sm"
                  className="mt-1"
                >
                  {scenario.status}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 my-3">
                <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                  <p className="text-label">Projected Health</p>
                  <p className="text-xl font-bold t-primary mt-0.5">
                    {projected !== null ? projected : "--"}
                  </p>
                </div>
                <div className="p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                  <p className="text-label">vs Baseline</p>
                  <div className="flex items-center gap-1 mt-0.5">
                    {delta === null ? (
                      <Minus size={14} className="text-gray-400" />
                    ) : delta > 0 ? (
                      <TrendingUp size={14} className="text-emerald-400" />
                    ) : delta < 0 ? (
                      <TrendingDown size={14} className="text-red-400" />
                    ) : (
                      <Minus size={14} className="text-gray-400" />
                    )}
                    <span
                      className={`text-xl font-bold ${
                        delta === null
                          ? "t-muted"
                          : delta > 0
                          ? "text-emerald-400"
                          : delta < 0
                          ? "text-red-400"
                          : "t-primary"
                      }`}
                    >
                      {delta === null ? "--" : (delta > 0 ? "+" : "") + delta}
                    </span>
                  </div>
                </div>
              </div>
              <div className="mb-2">
                <p className="text-label mb-1">Key Assumptions</p>
                {assumptions.length === 0 ? (
                  <p className="text-caption t-muted">No assumptions recorded.</p>
                ) : (
                  <ul className="space-y-0.5">
                    {assumptions.map(([k, v]) => (
                      <li key={k} className="flex items-center justify-between text-caption">
                        <span className="t-secondary capitalize truncate mr-2">
                          {k.replace(/[_-]/g, " ")}
                        </span>
                        <span className="font-medium t-primary truncate">{v}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {recommendation && (
                <div className="pt-2 border-t border-[var(--border-card)]">
                  <p className="text-label mb-1">Analysis</p>
                  <p className="text-caption t-secondary line-clamp-3">{recommendation}</p>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
