import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import { Card } from "@/components/ui/card";
import { Loader2, TrendingUp } from "lucide-react";
import { chartTheme, chartPalette, tooltipStyle } from "@/lib/chart-theme";
import { api } from "@/lib/api";
import type { HealthHistoryResponse } from "@/lib/api";

interface HealthTrendChartProps {
  companyId?: string;
  initialHistory?: HealthHistoryResponse | null;
}

type TimeRange = 7 | 30 | 90;

function formatDate(d: string) {
  try {
    return new Date(d).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch {
    return d;
  }
}

export function HealthTrendChart({ companyId, initialHistory = null }: HealthTrendChartProps) {
  const [range, setRange] = useState<TimeRange>(30);
  const [history, setHistory] = useState<HealthHistoryResponse | null>(initialHistory);
  const [loading, setLoading] = useState(false);
  const [showDimensions, setShowDimensions] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      try {
        const limit = range === 7 ? 30 : range === 30 ? 90 : 180;
        const result = await api.apex.healthHistory(undefined, limit, companyId);
        if (!cancelled) setHistory(result);
      } catch (err) {
        console.error("Failed to load health history:", err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [range, companyId]);

  const { chartData, dimensionKeys } = useMemo(() => {
    if (!history || history.history.length === 0) return { chartData: [], dimensionKeys: [] as string[] };
    const cutoff = Date.now() - range * 24 * 60 * 60 * 1000;
    const filtered = history.history
      .filter(h => new Date(h.recordedAt).getTime() >= cutoff)
      .sort((a, b) => new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime());
    const keys = new Set<string>();
    const data = filtered.map(h => {
      const row: Record<string, string | number> = {
        date: formatDate(h.recordedAt),
        rawDate: h.recordedAt,
        overall: Math.round(h.overallScore),
      };
      if (h.dimensions && typeof h.dimensions === "object") {
        for (const [k, v] of Object.entries(h.dimensions)) {
          const val =
            typeof v === "number"
              ? v
              : typeof v === "object" && v !== null && "score" in (v as Record<string, unknown>)
              ? Number((v as Record<string, unknown>).score)
              : null;
          if (val !== null && !Number.isNaN(val)) {
            row[k] = Math.round(val);
            keys.add(k);
          }
        }
      }
      return row;
    });
    return { chartData: data, dimensionKeys: Array.from(keys).sort() };
  }, [history, range]);

  const isEmpty = !loading && chartData.length === 0;

  return (
    <Card className="mb-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-2">
          <TrendingUp size={16} className="text-accent" />
          <h3 className="text-sm font-semibold t-primary">Atheon Score Trend</h3>
        </div>
        <div className="flex items-center gap-2">
          {dimensionKeys.length > 0 && (
            <label className="flex items-center gap-1.5 text-caption t-muted cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showDimensions}
                onChange={e => setShowDimensions(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Show dimensions
            </label>
          )}
          <div
            className="inline-flex rounded-md border border-[var(--border-card)] overflow-hidden"
            role="group"
            aria-label="Time range selector"
          >
            {([7, 30, 90] as TimeRange[]).map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRange(r)}
                className={`px-2.5 py-1 text-caption font-medium transition-colors ${
                  range === r
                    ? "bg-accent text-[var(--text-on-accent)]"
                    : "bg-[var(--bg-secondary)] t-muted hover:t-primary"
                }`}
                aria-pressed={range === r}
              >
                {r}d
              </button>
            ))}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-6 h-6 text-accent animate-spin" />
        </div>
      ) : isEmpty ? (
        <div className="flex flex-col items-center justify-center h-48 text-center">
          <TrendingUp className="w-8 h-8 t-muted opacity-30 mb-2" />
          <p className="text-sm t-muted">Run a catalyst in any domain to generate health history.</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <LineChart data={chartData} margin={{ top: 5, right: 10, left: -10, bottom: 5 }}>
            <CartesianGrid stroke={chartTheme.grid.stroke} strokeWidth={chartTheme.grid.strokeWidth} />
            <XAxis
              dataKey="date"
              tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }}
              minTickGap={20}
            />
            <YAxis
              domain={[0, 100]}
              tick={{ fill: chartTheme.text.fill, fontSize: chartTheme.text.fontSize }}
            />
            <Tooltip contentStyle={tooltipStyle.contentStyle} />
            <Legend wrapperStyle={{ fontSize: 11 }} iconType="circle" />
            <Line
              type="monotone"
              dataKey="overall"
              name="Overall"
              stroke={chartPalette[0]}
              strokeWidth={2.5}
              dot={{ r: 3 }}
              activeDot={{ r: 5 }}
            />
            {showDimensions &&
              dimensionKeys.map((k, i) => (
                <Line
                  key={k}
                  type="monotone"
                  dataKey={k}
                  name={k.charAt(0).toUpperCase() + k.slice(1)}
                  stroke={chartPalette[(i + 1) % chartPalette.length]}
                  strokeWidth={1.5}
                  strokeDasharray="4 2"
                  dot={false}
                />
              ))}
          </LineChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}
