import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { Grid3x3, X } from "lucide-react";
import type { Risk } from "@/lib/api";

interface RiskHeatMapProps {
  risks: Risk[];
  activeFilter: { category: string; severity: string } | null;
  onCellClick: (category: string, severity: string) => void;
  onClearFilter: () => void;
}

const SEVERITY_ORDER = ["critical", "high", "medium", "low"] as const;
type Severity = (typeof SEVERITY_ORDER)[number];

const SEVERITY_COLOR: Record<Severity, { base: string; rgb: string; label: string }> = {
  critical: { base: "rgb(239, 68, 68)", rgb: "239, 68, 68", label: "Critical" },
  high: { base: "rgb(249, 115, 22)", rgb: "249, 115, 22", label: "High" },
  medium: { base: "rgb(245, 158, 11)", rgb: "245, 158, 11", label: "Medium" },
  low: { base: "rgb(16, 185, 129)", rgb: "16, 185, 129", label: "Low" },
};

function normaliseSeverity(s: string | undefined | null): Severity | null {
  if (!s) return null;
  const lower = s.toLowerCase();
  if (lower === "critical" || lower === "high" || lower === "medium" || lower === "low") return lower;
  return null;
}

function toTitleCase(s: string): string {
  if (!s) return "";
  return s
    .split(/[_\s-]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

export function RiskHeatMap({ risks, activeFilter, onCellClick, onClearFilter }: RiskHeatMapProps) {
  const { categories, counts, maxCount } = useMemo(() => {
    const counter: Record<string, number> = {};
    for (const r of risks) {
      if (!r.category) continue;
      counter[r.category] = (counter[r.category] || 0) + 1;
    }
    const sortedCats = Object.entries(counter)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([k]) => k);

    const map: Record<string, Record<Severity, number>> = {};
    let max = 0;
    for (const cat of sortedCats) {
      map[cat] = { critical: 0, high: 0, medium: 0, low: 0 };
    }
    for (const r of risks) {
      const sev = normaliseSeverity(r.severity);
      if (!sev || !map[r.category]) continue;
      map[r.category][sev] += 1;
      if (map[r.category][sev] > max) max = map[r.category][sev];
    }
    return { categories: sortedCats, counts: map, maxCount: max };
  }, [risks]);

  if (risks.length === 0 || categories.length === 0) return null;

  return (
    <Card className="mb-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Grid3x3 size={14} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Risk Heat Map</h3>
          <span className="text-caption t-muted">
            {risks.length} risk{risks.length === 1 ? "" : "s"} across {categories.length} categor
            {categories.length === 1 ? "y" : "ies"}
          </span>
        </div>
        {activeFilter && (
          <button
            type="button"
            onClick={onClearFilter}
            className="flex items-center gap-1 text-caption text-accent hover:text-accent/80"
            title="Clear filter"
          >
            <X size={11} /> Clear filter ({toTitleCase(activeFilter.category)} /{" "}
            {SEVERITY_COLOR[activeFilter.severity as Severity]?.label ?? activeFilter.severity})
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse" role="grid" aria-label="Risk heat map">
          <thead>
            <tr>
              <th className="text-left text-label font-normal px-2 py-1.5">
                Severity
              </th>
              {categories.map(cat => (
                <th
                  key={cat}
                  className="text-left text-label font-normal px-2 py-1.5 capitalize"
                  scope="col"
                >
                  {toTitleCase(cat)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {SEVERITY_ORDER.map(sev => (
              <tr key={sev}>
                <th
                  scope="row"
                  className="text-left text-caption font-medium t-secondary px-2 py-1.5"
                  style={{ color: SEVERITY_COLOR[sev].base }}
                >
                  {SEVERITY_COLOR[sev].label}
                </th>
                {categories.map(cat => {
                  const count = counts[cat]?.[sev] ?? 0;
                  const opacity = maxCount > 0 ? 0.1 + (count / maxCount) * 0.85 : 0.1;
                  const isActive =
                    activeFilter?.category === cat && activeFilter?.severity === sev;
                  const isDimmed =
                    activeFilter && (activeFilter.category !== cat || activeFilter.severity !== sev);
                  const cellBg =
                    count === 0
                      ? "var(--bg-secondary)"
                      : `rgba(${SEVERITY_COLOR[sev].rgb}, ${opacity.toFixed(2)})`;
                  return (
                    <td key={cat} className="p-0.5">
                      <button
                        type="button"
                        disabled={count === 0}
                        onClick={() => onCellClick(cat, sev)}
                        className={`w-full min-h-[48px] rounded-md flex items-center justify-center text-sm font-semibold transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
                          count === 0
                            ? "cursor-default t-muted"
                            : "cursor-pointer hover:ring-2 hover:ring-accent/40"
                        } ${isActive ? "ring-2 ring-accent" : ""} ${isDimmed ? "opacity-40" : ""}`}
                        style={{
                          background: cellBg,
                          color: count === 0 ? undefined : SEVERITY_COLOR[sev].base,
                        }}
                        aria-label={`${count} ${sev} ${toTitleCase(cat)} risks${
                          count > 0 ? ". Click to filter." : ""
                        }`}
                        aria-pressed={isActive}
                      >
                        {count}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
