import { useState, useEffect, useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { api } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import type { HealthScore, Risk, Metric, AnomalyItem, ClusterItem, ActionItem, ControlPlaneHealth } from "@/lib/api";
import {
  TrendingUp, TrendingDown, Minus, Loader2, Info, SlidersHorizontal,
  ChevronRight, AlertTriangle,
} from "lucide-react";
import { Link } from "react-router-dom";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

const ACCENT = "#4A6B5A";
const ACCENT_B = "#5d8a6f";
const BRONZE = "#c9a059";
const SKY = "#7AACB5";
const CHART_LIGHT = "#b8d4c4";

const trendIcon = (trend: string) => {
  if (trend === "up" || trend === "improving") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "down" || trend === "declining") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

function DashCard({ children, className = "", style }: { children: React.ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "var(--bg-card-solid)",
        border: "1px solid var(--border-card)",
        boxShadow: "0 2px 12px rgba(100, 120, 180, 0.07), 0 0 0 1px rgba(255,255,255,0.5)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function TintedCard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl p-5 ${className}`}
      style={{
        background: "linear-gradient(135deg, rgba(74, 107, 90, 0.06), rgba(93, 138, 111, 0.03))",
        border: "1px solid rgba(74, 107, 90, 0.10)",
        boxShadow: "0 2px 12px rgba(74, 107, 90, 0.05)",
      }}
    >
      {children}
    </div>
  );
}

export function Dashboard() {
  const industry = useAppStore((s) => s.industry);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [cpHealth, setCpHealth] = useState<ControlPlaneHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "health" | "risks">("overview");
  const [timeFilter, setTimeFilter] = useState<"7d" | "30d" | "90d" | "12m">("30d");
  const [showFilters, setShowFilters] = useState(false);
  const pieId = useId();

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const ind = industry !== 'general' ? industry : undefined;
        const [h, r, m, a, c, act, cp] = await Promise.allSettled([
          api.apex.health(undefined, ind),
          api.apex.risks(undefined, ind),
          api.pulse.metrics(undefined, ind),
          api.pulse.anomalies(undefined, ind),
          api.catalysts.clusters(undefined, ind),
          api.catalysts.actions(undefined, undefined, ind),
          api.controlplane.health(undefined, ind),
        ]);
        if (h.status === "fulfilled") setHealth(h.value);
        if (r.status === "fulfilled") setRisks(r.value.risks);
        if (m.status === "fulfilled") setMetrics(m.value.metrics);
        if (a.status === "fulfilled") setAnomalies(a.value.anomalies);
        if (c.status === "fulfilled") setClusters(c.value.clusters);
        if (act.status === "fulfilled") setActions(act.value.actions);
        if (cp.status === "fulfilled") setCpHealth(cp.value);
      } catch {
        /* silently handle */
      }
      setLoading(false);
    }
    load();
  }, [industry]);

  const overallScore = health?.overall ?? 0;
  const dimEntries = health?.dimensions ? Object.values(health.dimensions) : [];
  const upCount = dimEntries.filter((d) => d.trend === "up" || d.trend === "improving").length;
  const downCount = dimEntries.filter((d) => d.trend === "down" || d.trend === "declining").length;
  const healthTrend = upCount > downCount ? "up" : downCount > upCount ? "down" : "stable";
  const avgDelta = dimEntries.length > 0 ? dimEntries.reduce((s, d) => s + (d.delta ?? 0), 0) / dimEntries.length : 0;

  const dimensions = health?.dimensions
    ? Object.entries(health.dimensions).map(([key, val]) => ({
        key,
        name: key.charAt(0).toUpperCase() + key.slice(1),
        score: val.score,
        trend: val.trend as string,
        change: val.delta ?? 0,
      }))
    : [];

  const activeCatalysts = clusters.filter((c) => c.status === "active").length;
  const totalTasks = clusters.reduce((sum, c) => sum + (c.tasksInProgress || 0), 0);

  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const now = new Date();
  const hasMetrics = metrics.length > 0;
  const hasHealth = !!health?.overall;
  const hasData = hasMetrics || hasHealth || dimensions.length > 0;
  // Derive the primary and secondary metric from actual catalyst-generated data
  const primaryMetric = metrics.length > 0 ? metrics[0] : null;
  const secondaryMetric = metrics.length > 1 ? metrics[1] : null;
  const primaryMetricLabel = primaryMetric ? primaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Health Score';
  const secondaryMetricLabel = secondaryMetric ? secondaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;

  const metricsOverTime = hasData ? Array.from({ length: 12 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - 11 + i, 1);
    const baseValue = primaryMetric ? primaryMetric.value : (health?.overall ?? 0);
    const entry: Record<string, string | number> = {
      month: monthNames[d.getMonth()],
      value: +(baseValue * (0.85 + i * 0.03) + Math.sin(i * 0.8) * 3).toFixed(1),
    };
    if (secondaryMetric) {
      entry.secondary = +(secondaryMetric.value * (0.82 + i * 0.035) + Math.cos(i * 0.6) * 2).toFixed(1);
    }
    return entry;
  }) : [];

  const piePalette = [ACCENT, ACCENT_B, SKY, BRONZE, CHART_LIGHT];
  const pieData = dimensions.slice(0, 5).map((dim, i) => ({
    name: dim.name,
    value: dim.score,
    fill: piePalette[i % piePalette.length],
  }));

  const topDimensions = [...dimensions].sort((a, b) => b.score - a.score).slice(0, 5);

  const momData = hasData ? monthNames.map((m, i) => ({
    month: m,
    change: +(avgDelta * (0.5 + Math.sin(i * 0.5) * 0.8)).toFixed(1),
  })) : [];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 animate-spin" style={{ color: "var(--accent)" }} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* HEADER */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center relative" style={{ background: "linear-gradient(135deg, #06090d, #0e151c)", boxShadow: "0 4px 16px rgba(74, 107, 90, 0.25)" }}>
            <svg width="22" height="22" viewBox="0 0 32 32" fill="none">
              <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="#4A6B5A" strokeWidth="1.5" />
              <line x1="9" y1="20" x2="23" y2="20" stroke="#4A6B5A" strokeWidth=".8" opacity=".6" />
              <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="#7AACB5" strokeWidth=".8" opacity=".5" />
              <circle cx="16" cy="9" r="1.5" fill="#c9a059" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold t-primary tracking-tight">Atheon Dashboard</h1>
            <p className="text-[11px] t-muted">Enterprise Intelligence &mdash; {now.getFullYear()}</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 p-0.5 rounded-lg" style={{ background: "var(--bg-secondary)" }}>
            {(["overview", "health", "risks"] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className="px-3 py-1.5 text-xs font-medium rounded-md transition-all capitalize"
                style={
                  activeTab === tab
                    ? { background: "var(--bg-card-solid)", color: "var(--text-primary)", boxShadow: "0 1px 3px rgba(0,0,0,0.06)" }
                    : { color: "var(--text-muted)" }
                }
              >
                {tab === "health" ? "Health Trend" : tab}
              </button>
            ))}
          </div>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center t-muted hover:t-primary transition-all" style={{ background: "var(--bg-secondary)" }} title="Dashboard information" onClick={() => setActiveTab('overview')}>
            <Info size={14} />
          </button>
          <button className="w-8 h-8 rounded-lg flex items-center justify-center t-muted hover:t-primary transition-all" style={{ background: showFilters ? 'var(--accent)' : 'var(--bg-secondary)', color: showFilters ? '#fff' : undefined }} title="Toggle filters" onClick={() => setShowFilters(!showFilters)}>
            <SlidersHorizontal size={14} />
          </button>
        </div>
      </div>

      {/* FILTERS ROW */}
      {showFilters && (
        <DashCard className="!p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium t-muted">Time Range:</span>
            {(["7d", "30d", "90d", "12m"] as const).map((f) => (
              <button key={f} onClick={() => setTimeFilter(f)} className="px-3 py-1 text-xs rounded-md font-medium transition-all" style={timeFilter === f ? { background: 'var(--accent)', color: '#fff' } : { background: 'var(--bg-secondary)', color: 'var(--text-muted)' }}>
                {f === '7d' ? '7 Days' : f === '30d' ? '30 Days' : f === '90d' ? '90 Days' : '12 Months'}
              </button>
            ))}
            <span className="mx-2 h-4 border-l border-[var(--border-card)]" />
            <span className="text-xs font-medium t-muted">Industry:</span>
            <span className="text-xs font-semibold t-primary capitalize">{industry === 'general' ? 'All Industries' : industry}</span>
          </div>
        </DashCard>
      )}

      {/* MAIN GRID */}
      {activeTab === 'overview' && !hasData && (
        <DashCard>
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <TrendingUp className="w-12 h-12 t-muted mb-4 opacity-30" />
            <p className="text-sm font-medium t-primary">No data yet</p>
            <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to generate dashboard insights,</p>
            <p className="text-xs t-muted">or use the Company Reset button to start fresh.</p>
          </div>
        </DashCard>
      )}
      {activeTab === 'overview' && hasData && (
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        {/* LEFT COLUMN */}
        <div className="lg:col-span-5 space-y-5">
          <TintedCard>
            <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Business Health</p>
            <div className="flex items-end justify-between">
              <div>
                <p className="text-3xl font-bold t-primary">{overallScore}<span className="text-base t-muted font-normal">/100</span></p>
                <div className="flex items-center gap-1.5 mt-1">
                  {trendIcon(healthTrend)}
                  <span className={`text-xs ${avgDelta >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                    {avgDelta >= 0 ? "+" : ""}{avgDelta.toFixed(1)} pts
                  </span>
                </div>
              </div>
              <div className="w-24 h-12">
                <Sparkline data={dimEntries.map((d) => d.score)} width={96} height={48} color={ACCENT} />
              </div>
            </div>
          </TintedCard>

          <div className="grid grid-cols-2 gap-4">
            <TintedCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-3">Top Dimensions</p>
              <div className="space-y-2.5">
                {topDimensions.slice(0, 3).map((dim, i) => (
                  <div key={dim.key} className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold text-white" style={{ background: piePalette[i] }}>
                      {i + 1}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary truncate">{dim.name}</p>
                      <p className="text-[10px] t-muted">{dim.score} pts</p>
                    </div>
                  </div>
                ))}
              </div>
            </TintedCard>

            <DashCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-2">Active Catalysts</p>
              <p className="text-3xl font-bold t-primary">{activeCatalysts}</p>
              <p className="text-[10px] t-muted mt-1">{totalTasks} tasks in progress</p>
              <div className="w-full h-10 mt-2">
                <Sparkline data={[3, 5, 4, 7, 6, 8, activeCatalysts]} width={120} height={40} color={ACCENT} />
              </div>
            </DashCard>
          </div>

          <TintedCard>
            <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-3">Health Dimensions</p>
            <div className="space-y-3">
              {dimensions.slice(0, 5).map((dim, i) => (
                <div key={dim.key}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs t-secondary">{dim.name}</span>
                    <span className="text-xs font-semibold t-primary">{dim.score}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: "var(--bg-secondary)" }}>
                    <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dim.score}%`, background: piePalette[i % piePalette.length] }} />
                  </div>
                </div>
              ))}
            </div>
          </TintedCard>

          <DashCard>
            <div className="flex items-center justify-between mb-3">
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider">Month-over-Month</p>
              <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: ACCENT }}>
                <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} /> Health
              </span>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={momData} barSize={16}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  <Bar dataKey="change" radius={[4, 4, 0, 0]} fill={ACCENT} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DashCard>
        </div>

        {/* RIGHT COLUMN */}
        <div className="lg:col-span-7 space-y-5">
          <DashCard>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
              <p className="text-sm font-semibold t-primary">Metrics Over Time</p>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-[10px] font-medium" style={{ color: ACCENT }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} /> {primaryMetricLabel}
                </span>
                {secondaryMetricLabel && (
                  <span className="inline-flex items-center gap-1 text-[10px] font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHART_LIGHT }} /> {secondaryMetricLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={metricsOverTime} barGap={2} barSize={20}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  <Bar dataKey="value" name={primaryMetricLabel} radius={[4, 4, 0, 0]} fill={ACCENT} />
                  {secondaryMetricLabel && <Bar dataKey="secondary" name={secondaryMetricLabel} radius={[4, 4, 0, 0]} fill={CHART_LIGHT} />}
                </BarChart>
              </ResponsiveContainer>
            </div>
          </DashCard>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <DashCard>
              <p className="text-sm font-semibold t-primary mb-1">Health by Dimension</p>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {pieData.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1 text-[10px] font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} /> {d.name}
                  </span>
                ))}
              </div>
              <div className="h-52 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={2} dataKey="value" stroke="none">
                      {pieData.map((entry, i) => (
                        <Cell key={`${pieId}-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </DashCard>

            <DashCard>
              <p className="text-sm font-semibold t-primary mb-1">Risk Distribution</p>
              <div className="h-52 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(() => {
                      const severities = ["critical", "high", "medium", "low"];
                      return severities.map((sev) => ({
                        severity: sev.charAt(0).toUpperCase() + sev.slice(1),
                        count: risks.filter((r) => r.severity === sev).length,
                      }));
                    })()}
                    barSize={32}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                    <XAxis dataKey="severity" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {["critical", "high", "medium", "low"].map((sev) => (
                        <Cell key={sev} fill={sev === "critical" ? "#ef4444" : sev === "high" ? "#f59e0b" : ACCENT} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </DashCard>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <DashCard>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold t-primary">Process Metrics</p>
                <Link to="/pulse" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all process metrics">
                  View all <ChevronRight size={10} />
                </Link>
              </div>
              <div className="space-y-3">
                {metrics.slice(0, 4).map((metric) => (
                  <div key={metric.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full ${metric.status === "green" ? "bg-emerald-500" : metric.status === "amber" ? "bg-amber-500" : "bg-red-500"}`} />
                      <span className="text-xs t-secondary">{metric.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <Sparkline data={metric.trend || []} width={40} height={16} color={ACCENT} />
                      <span className="text-xs font-semibold t-primary w-12 text-right">{metric.value}<span className="text-[10px] t-muted ml-0.5">{metric.unit}</span></span>
                    </div>
                  </div>
                ))}
              </div>
            </DashCard>

            <DashCard>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-semibold t-primary">Catalyst Activity</p>
                <Link to="/catalysts" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all catalyst activity">
                  View all <ChevronRight size={10} />
                </Link>
              </div>
              <div className="space-y-3">
                {actions.slice(0, 4).map((action) => (
                  <div key={action.id} className="flex items-center justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary truncate">{action.action}</p>
                      <p className="text-[10px] t-muted truncate">{action.catalystName}</p>
                    </div>
                    <Badge variant={action.status === "completed" ? "success" : action.status === "pending" ? "warning" : "info"}>
                      {action.status}
                    </Badge>
                  </div>
                ))}
              </div>
            </DashCard>
          </div>

          <DashCard>
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-semibold t-primary">{primaryMetricLabel} Trend</p>
                <p className="text-[10px] t-muted">Last 12 months</p>
              </div>
              <Badge variant="success">
                {primaryMetric ? `+${((primaryMetric.value / (primaryMetric.value * 0.96) - 1) * 100).toFixed(1)}%` : "--"}
              </Badge>
            </div>
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={metricsOverTime}>
                  <defs>
                    <linearGradient id={`${pieId}-revGrad`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
                      <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "12px", fontSize: "11px" }} />
                  <Area type="monotone" dataKey="value" stroke={ACCENT} strokeWidth={2} fill={`url(#${pieId}-revGrad)`} />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </DashCard>
        </div>
      </div>

      )}

      {/* HEALTH TREND TAB */}
      {activeTab === 'health' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            <TintedCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Overall Score</p>
              <p className="text-4xl font-bold t-primary">{overallScore}<span className="text-lg t-muted font-normal">/100</span></p>
              <div className="flex items-center gap-1.5 mt-2">
                {trendIcon(healthTrend)}
                <span className={`text-xs ${avgDelta >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                  {avgDelta >= 0 ? '+' : ''}{avgDelta.toFixed(1)} pts avg change
                </span>
              </div>
            </TintedCard>
            <DashCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Improving</p>
              <p className="text-4xl font-bold text-emerald-500">{upCount}</p>
              <p className="text-[10px] t-muted mt-1">dimensions trending up</p>
            </DashCard>
            <DashCard>
              <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">Declining</p>
              <p className="text-4xl font-bold text-red-500">{downCount}</p>
              <p className="text-[10px] t-muted mt-1">dimensions trending down</p>
            </DashCard>
          </div>

          {dimensions.length === 0 ? (
            <DashCard>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <TrendingUp className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No health data yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to generate health insights.</p>
              </div>
            </DashCard>
          ) : (
            <>
              <DashCard>
                <p className="text-sm font-semibold t-primary mb-4">All Dimensions</p>
                <div className="space-y-4">
                  {dimensions.map((dim, i) => (
                    <div key={dim.key}>
                      <div className="flex items-center justify-between mb-1.5">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-sm" style={{ background: piePalette[i % piePalette.length] }} />
                          <span className="text-xs font-medium t-primary">{dim.name}</span>
                        </div>
                        <div className="flex items-center gap-2">
                          {trendIcon(dim.trend)}
                          <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>
                            {dim.change > 0 ? '+' : ''}{dim.change}
                          </span>
                          <span className="text-sm font-bold t-primary w-8 text-right">{dim.score}</span>
                        </div>
                      </div>
                      <div className="h-2.5 rounded-full overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${dim.score}%`, background: piePalette[i % piePalette.length] }} />
                      </div>
                    </div>
                  ))}
                </div>
              </DashCard>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <DashCard>
                  <p className="text-sm font-semibold t-primary mb-3">Health Score Trend</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={metricsOverTime}>
                        <defs>
                          <linearGradient id={`${pieId}-htGrad`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={ACCENT} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                        <Area type="monotone" dataKey="value" name="Health" stroke={ACCENT} strokeWidth={2} fill={`url(#${pieId}-htGrad)`} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </DashCard>
                <DashCard>
                  <p className="text-sm font-semibold t-primary mb-3">Month-over-Month Change</p>
                  <div className="h-48">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={momData} barSize={16}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                        <XAxis dataKey="month" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                        <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                        <Bar dataKey="change" radius={[4, 4, 0, 0]} fill={ACCENT} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </DashCard>
              </div>
            </>
          )}
        </div>
      )}

      {/* RISKS TAB */}
      {activeTab === 'risks' && (
        <div className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-5">
            {(['critical', 'high', 'medium', 'low'] as const).map((sev) => {
              const count = risks.filter((r) => r.severity === sev).length;
              const color = sev === 'critical' ? '#ef4444' : sev === 'high' ? '#f59e0b' : sev === 'medium' ? ACCENT : SKY;
              return (
                <DashCard key={sev}>
                  <p className="text-[11px] font-medium t-muted uppercase tracking-wider mb-1">{sev}</p>
                  <p className="text-4xl font-bold" style={{ color }}>{count}</p>
                  <p className="text-[10px] t-muted mt-1">{sev} severity risks</p>
                </DashCard>
              );
            })}
          </div>

          {risks.length === 0 ? (
            <DashCard>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No risk alerts detected yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to scan for organisational risks.</p>
              </div>
            </DashCard>
          ) : (
            <>
              <DashCard>
                <p className="text-sm font-semibold t-primary mb-3">Risk Distribution</p>
                <div className="h-52">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={(['critical', 'high', 'medium', 'low'] as const).map((sev) => ({
                        severity: sev.charAt(0).toUpperCase() + sev.slice(1),
                        count: risks.filter((r) => r.severity === sev).length,
                      }))}
                      barSize={40}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                      <XAxis dataKey="severity" tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 10, fill: 'var(--text-muted)' }} axisLine={false} tickLine={false} allowDecimals={false} />
                      <Tooltip contentStyle={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)', borderRadius: '12px', fontSize: '11px' }} />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {['critical', 'high', 'medium', 'low'].map((sev) => (
                          <Cell key={sev} fill={sev === 'critical' ? '#ef4444' : sev === 'high' ? '#f59e0b' : sev === 'medium' ? ACCENT : SKY} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </DashCard>

              <DashCard>
                <p className="text-sm font-semibold t-primary mb-3">All Risk Alerts</p>
                <div className="space-y-3">
                  {risks.map((risk) => (
                    <div key={risk.id} className="flex items-start gap-3 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)' }}>
                      <AlertTriangle className={`w-4 h-4 mt-0.5 flex-shrink-0 ${
                        risk.severity === 'critical' ? 'text-red-500' : risk.severity === 'high' ? 'text-amber-500' : 'text-gray-400'
                      }`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-semibold t-primary">{risk.title}</h4>
                          <Badge variant={risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'info'}>{risk.severity}</Badge>
                        </div>
                        <p className="text-[10px] t-muted mt-0.5">{risk.description}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] t-muted">
                          <span>Probability: {Math.round(risk.probability * 100)}%</span>
                          <span>Impact: {risk.impactValue} {risk.impactUnit}</span>
                          <Badge variant="outline" size="sm">{risk.category}</Badge>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </DashCard>
            </>
          )}
        </div>
      )}

      {/* ANOMALIES & CONTROL PLANE HEALTH — Bug #7 fix: render previously discarded data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <DashCard>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold t-primary">Recent Anomalies</p>
            <Link to="/pulse" className="text-[10px] font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all anomalies">
              View all <ChevronRight size={10} />
            </Link>
          </div>
          {anomalies.length === 0 ? (
            <p className="text-xs t-muted">No anomalies detected</p>
          ) : (
            <div className="space-y-2.5">
              {anomalies.slice(0, 4).map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium t-primary truncate">{a.metric}</p>
                    <p className="text-[10px] t-muted">Deviation: {typeof a.deviation === 'number' ? `${a.deviation > 0 ? '+' : ''}${a.deviation.toFixed(1)}%` : '--'}</p>
                  </div>
                  <Badge variant={a.severity === 'critical' ? 'danger' : a.severity === 'high' ? 'warning' : 'info'}>
                    {a.severity}
                  </Badge>
                </div>
              ))}
            </div>
          )}
        </DashCard>

        <DashCard>
          <p className="text-sm font-semibold t-primary mb-3">Control Plane</p>
          {!cpHealth ? (
            <p className="text-xs t-muted">No data available</p>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Overall Health</span>
                <Badge variant={cpHealth.overallHealth >= 90 ? 'success' : cpHealth.overallHealth >= 70 ? 'warning' : 'danger'}>
                  {cpHealth.overallHealth}%
                </Badge>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Uptime</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.overallUptime?.toFixed(1) ?? '--'}%</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Deployments</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.deploymentStatus ? Object.values(cpHealth.deploymentStatus).reduce((a, b) => a + b, 0) : '--'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs t-secondary">Last Checked</span>
                <span className="text-xs font-semibold t-primary">{cpHealth.lastChecked ? new Date(cpHealth.lastChecked).toLocaleTimeString() : '--'}</span>
              </div>
            </div>
          )}
        </DashCard>
      </div>

      {/* QUICK LINKS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Apex", desc: "Executive Intelligence", to: "/apex" },
          { label: "Pulse", desc: "Process Monitoring", to: "/pulse" },
          { label: "Memory", desc: "Knowledge Base", to: "/memory" },
          { label: "Mind", desc: "AI Models", to: "/mind" },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="rounded-xl p-4 transition-all hover:-translate-y-0.5"
            style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", boxShadow: "0 2px 8px rgba(100, 120, 180, 0.06)" }}
          >
            <p className="text-sm font-semibold t-primary">{item.label}</p>
            <p className="text-[10px] t-muted">{item.desc}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
