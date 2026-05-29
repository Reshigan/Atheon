/**
 * CorrelationMatrix — heatmap visualisation of cross-metric correlations.
 *
 * Spec: FRONTEND_ENHANCEMENTS.md §2.2.3
 *  - Matrix (N × N) with metrics on both axes; cell colour encodes correlation
 *    strength, colour family encodes positive (emerald) vs negative (red)
 *    correlation. Preferred over force-directed graph — no heavy deps, readable
 *    at N > 10.
 *  - Hover tooltip shows the pair + strength.
 *
 * Positivity is inferred from `correlationType`: anything containing "negative"
 * or "inverse" renders red; everything else renders emerald. Strength is the
 * absolute correlation `confidence` (0..1).
 *
 * Pure SVG / divs — no new dependencies.
 */
import { useMemo, useState } from "react";
import type { CorrelationItem } from "@/lib/api";
import { Link2, Info } from "lucide-react";

interface CorrelationMatrixProps {
  correlations: CorrelationItem[];
  /** Max metrics to show — guards against DOM explosion on very wide data. */
  maxMetrics?: number;
}

interface CellInfo {
  rowMetric: string;
  colMetric: string;
  strength: number; // 0..1 — absolute
  signed: number; // -1..1 — with sign
  item: CorrelationItem | null;
}

/** Resolve sign from correlationType heuristic — -1 for negative, +1 otherwise. */
function signFor(c: CorrelationItem): number {
  const t = (c.correlationType || "").toLowerCase();
  if (t.includes("negative") || t.includes("inverse")) return -1;
  return 1;
}

/** Short label for long metric names. */
function shortLabel(s: string, max = 14): string {
  if (!s) return "—";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export function CorrelationMatrix({ correlations, maxMetrics = 20 }: CorrelationMatrixProps) {
  const [hovered, setHovered] = useState<CellInfo | null>(null);

  const { metrics, cellMap } = useMemo(() => {
    const metricSet = new Set<string>();
    for (const c of correlations) {
      if (c.metricA) metricSet.add(String(c.metricA));
      if (c.metricB) metricSet.add(String(c.metricB));
    }
    const allMetrics = Array.from(metricSet);

    // If too many metrics, pick the ones with the most / strongest correlations
    let kept: string[] = allMetrics;
    if (allMetrics.length > maxMetrics) {
      const score: Record<string, number> = {};
      for (const c of correlations) {
        const s = Math.abs(c.confidence || 0);
        score[c.metricA] = (score[c.metricA] || 0) + s;
        score[c.metricB] = (score[c.metricB] || 0) + s;
      }
      kept = allMetrics
        .sort((a, b) => (score[b] || 0) - (score[a] || 0))
        .slice(0, maxMetrics);
    }

    const keptSet = new Set(kept);
    const map = new Map<string, CorrelationItem>();
    for (const c of correlations) {
      if (!keptSet.has(c.metricA) || !keptSet.has(c.metricB)) continue;
      // Symmetric: store both orderings, highest confidence wins on duplicates
      const kf = `${c.metricA}|${c.metricB}`;
      const kr = `${c.metricB}|${c.metricA}`;
      const existing = map.get(kf);
      if (!existing || Math.abs(c.confidence) > Math.abs(existing.confidence)) {
        map.set(kf, c);
        map.set(kr, c);
      }
    }
    return { metrics: kept, cellMap: map };
  }, [correlations, maxMetrics]);

  const totalMetrics = useMemo(() => {
    const s = new Set<string>();
    for (const c of correlations) {
      if (c.metricA) s.add(String(c.metricA));
      if (c.metricB) s.add(String(c.metricB));
    }
    return s.size;
  }, [correlations]);

  if (metrics.length === 0) {
    return (
      <div className="flex items-center gap-3 py-6 px-4 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
        <Link2 className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
        <p className="text-sm t-muted">
          Not enough correlation data to render a matrix yet.
        </p>
      </div>
    );
  }

  const truncated = totalMetrics > metrics.length;

  const cellColour = (signed: number): string => {
    const strength = Math.min(1, Math.abs(signed));
    if (strength < 0.05) return "var(--bg-card-solid)";
    // Accent for positive, neg for negative. Alpha scales with strength.
    if (signed >= 0) {
      const alpha = 0.12 + strength * 0.78; // 0.12..0.90
      return `rgb(var(--accent-rgb) / ${alpha.toFixed(3)})`;
    }
    const alpha = 0.12 + strength * 0.78;
    return `rgb(var(--neg-rgb) / ${alpha.toFixed(3)})`;
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold t-primary flex items-center gap-2">
          <Link2 className="w-4 h-4 text-accent" />
          Correlation Matrix
        </h4>
        <div className="flex items-center gap-3 text-caption t-muted">
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: "rgb(var(--accent-rgb) / 0.85)" }} />
            Positive
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block w-3 h-3 rounded" style={{ background: "rgb(var(--neg-rgb) / 0.85)" }} />
            Negative
          </span>
          <span className="flex items-center gap-1">
            <Info size={10} /> Darker = stronger
          </span>
        </div>
      </div>

      {truncated && (
        <p className="text-caption t-muted">
          Showing top {metrics.length} of {totalMetrics} metrics (by total correlation strength).
        </p>
      )}

      <div className="overflow-auto max-w-full rounded-md border border-[var(--border-card)] bg-[var(--bg-secondary)]">
        <table className="text-caption border-collapse">
          <thead>
            <tr>
              <th className="sticky left-0 top-0 z-20 bg-[var(--bg-secondary)] p-2 text-left font-medium t-muted border-b border-r border-[var(--border-card)]">
                &nbsp;
              </th>
              {metrics.map((m) => (
                <th
                  key={m}
                  title={m}
                  className="p-1 text-left font-medium t-muted border-b border-[var(--border-card)] align-bottom"
                  style={{ height: 96, minWidth: 32, maxWidth: 32 }}
                >
                  <div
                    className="inline-block origin-bottom-left whitespace-nowrap"
                    style={{ transform: "rotate(-60deg) translateX(4px)", transformOrigin: "left bottom" }}
                  >
                    {shortLabel(m, 18)}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {metrics.map((rowMetric) => (
              <tr key={rowMetric}>
                <th
                  scope="row"
                  title={rowMetric}
                  className="sticky left-0 z-10 bg-[var(--bg-secondary)] p-2 text-left font-medium t-secondary border-r border-[var(--border-card)] whitespace-nowrap"
                  style={{ minWidth: 140, maxWidth: 180 }}
                >
                  {shortLabel(rowMetric, 22)}
                </th>
                {metrics.map((colMetric) => {
                  if (rowMetric === colMetric) {
                    return (
                      <td
                        key={colMetric}
                        className="border-b border-[var(--border-card)] text-center t-muted"
                        style={{ width: 32, height: 32, background: "var(--bg-card-solid)" }}
                        aria-label={`${rowMetric} self`}
                      >
                        ·
                      </td>
                    );
                  }
                  const item = cellMap.get(`${rowMetric}|${colMetric}`) || null;
                  const signed = item ? signFor(item) * Math.abs(item.confidence) : 0;
                  const strength = Math.abs(signed);
                  const cellInfo: CellInfo = {
                    rowMetric,
                    colMetric,
                    strength,
                    signed,
                    item,
                  };
                  const isHovered =
                    hovered &&
                    hovered.rowMetric === rowMetric &&
                    hovered.colMetric === colMetric;
                  return (
                    <td
                      key={colMetric}
                      className={`border-b border-[var(--border-card)] cursor-default transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
                        isHovered ? "ring-2 ring-accent/60 ring-inset" : ""
                      }`}
                      style={{
                        width: 32,
                        height: 32,
                        background: cellColour(signed),
                      }}
                      onMouseEnter={() => setHovered(cellInfo)}
                      onMouseLeave={() =>
                        setHovered((h) =>
                          h && h.rowMetric === rowMetric && h.colMetric === colMetric ? null : h,
                        )
                      }
                      aria-label={
                        item
                          ? `${rowMetric} and ${colMetric}: ${(strength * 100).toFixed(0)}% ${
                              signed >= 0 ? "positive" : "negative"
                            }`
                          : `${rowMetric} and ${colMetric}: no correlation`
                      }
                      title={
                        item
                          ? `${rowMetric} ↔ ${colMetric}\nStrength: ${(strength * 100).toFixed(
                              0,
                            )}% (${signed >= 0 ? "positive" : "negative"})${
                              item.lagDays ? `\nLag: ${item.lagDays}d` : ""
                            }`
                          : `${rowMetric} ↔ ${colMetric} — no correlation`
                      }
                    />
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Hover detail panel */}
      {hovered && hovered.item ? (
        <div className="flex items-start gap-3 p-3 rounded-md bg-[var(--bg-secondary)] border border-accent/20">
          <Link2 className="w-4 h-4 text-accent flex-shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium t-primary">
              {hovered.rowMetric} ↔ {hovered.colMetric}
            </p>
            <p className="text-caption t-muted mt-0.5">
              {hovered.signed >= 0 ? "Positive" : "Negative"} correlation · strength{" "}
              <span
                className={`font-medium ${
                  hovered.signed >= 0 ? "text-accent" : "text-neg"
                }`}
              >
                {(hovered.strength * 100).toFixed(0)}%
              </span>
              {hovered.item.lagDays
                ? ` · lag ${hovered.item.lagDays} day${hovered.item.lagDays === 1 ? "" : "s"}`
                : ""}
            </p>
            {hovered.item.description ? (
              <p className="text-caption t-secondary mt-1">{hovered.item.description}</p>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-caption t-muted italic">
          Hover a cell to see pair details.
        </p>
      )}
    </div>
  );
}
