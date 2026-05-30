import { useState, useEffect, useId, useCallback, useRef } from "react";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Sparkline } from "@/components/ui/sparkline";
import { DashboardSkeleton } from "@/components/ui/skeleton";
// FlipCard removed per UI cleanup spec
import { Progress } from "@/components/ui/progress";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
// cleanLlmText now used by IntelligencePanel sub-component
import { useAppStore, useSelectedCompanyId } from "@/stores/appStore";
import { ActionQueuePanel } from "@/components/dashboard/ActionQueuePanel";
import type { HealthScore, Risk, Metric, AnomalyItem, ClusterItem, ActionItem, ControlPlaneHealth, HealthDimensionTraceResponse, DashboardIntelligenceResponse, RadarContextResponse, DiagnosticSummaryResponse, ROITrackingResponse, BaselineComparisonResponse } from "@/lib/api";
import { TraceabilityModal } from "@/components/TraceabilityModal";
import {
  ChevronRight, AlertTriangle, RefreshCw, Eye, Lightbulb, X,
  CheckCircle2, XCircle, Gauge, Shield, Radar, Stethoscope, Coins, ArrowRight,
} from "lucide-react";
import { chartPalette, chartAccentB, chartLight } from "@/lib/chart-theme";
import { SectionFreshness } from "@/components/common/FreshnessIndicator";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";
import { PageHeader } from "@/components/ui/page-header";
import { MetricGrid } from "@/components/ui/metric-grid";
import { SharedSavingsStrip } from "@/components/SharedSavingsStrip";
import { WorkingCapitalCard } from "@/components/dashboard/WorkingCapitalCard";
import { CloseCycleCard } from "@/components/dashboard/CloseCycleCard";
import { KpiGrid } from "./dashboard/KpiCards";
import { IntelligencePanel } from "./dashboard/IntelligencePanel";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell,
  ResponsiveContainer, Tooltip, XAxis, YAxis, CartesianGrid,
} from "recharts";

// All chart colors derive from chart-theme.ts so brand-palette changes
// flow through every chart from one place.
const ACCENT = chartPalette[0];
const ACCENT_B = chartAccentB;
const BRONZE = chartPalette[1];
const SKY = chartPalette[2];
const CHART_LIGHT = chartLight;

// TASK-010: Personalized greeting
function getGreeting(name?: string): string {
  const hour = new Date().getHours();
  let g = "Good morning";
  if (hour >= 12 && hour < 17) g = "Good afternoon";
  if (hour >= 17) g = "Good evening";
  return name ? `${g}, ${name}` : g;
}

type TimeRange = "today" | "7d" | "30d" | "90d";

// DashCard + TintedCard were local re-implementations of the Card primitive
// (ui/card.tsx) — having both made Dashboard "feel like a different system"
// per the 2026-05-12 polish audit. The 30 call sites now use:
//   <Card>            for the standard tile  (was <DashCard>)
//   <Card variant="default">  for the tinted hero  (was <TintedCard>)
// See docs/UI_POLISH_PRINCIPLES.md §4 for the canonical card pattern.

export function Dashboard() {
  const industry = useAppStore((s) => s.industry);
  const user = useAppStore((s) => s.user);
  const companyId = useSelectedCompanyId();
  const toast = useToast();
  const mfaEnforcementWarning = useAppStore((s) => s.mfaEnforcementWarning);
  const [health, setHealth] = useState<HealthScore | null>(null);
  const [risks, setRisks] = useState<Risk[]>([]);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [clusters, setClusters] = useState<ClusterItem[]>([]);
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [cpHealth, setCpHealth] = useState<ControlPlaneHealth | null>(null);
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [loading, setLoading] = useState(true);
  // Tabs removed per UI cleanup spec — overview is now the entire page
  // UX-05: Silent auto-refresh every 60s (no user-facing toggle)
  const [lastRefreshed, setLastRefreshed] = useState<Date>(new Date());
  const [refreshFlash, setRefreshFlash] = useState(false);
  const refreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pieId = useId();

  // Dashboard Intelligence state
  const [dashIntel, setDashIntel] = useState<DashboardIntelligenceResponse | null>(null);
  const [dashIntelLoading, setDashIntelLoading] = useState(false);

  // New engine summary state
  const [radarCtx, setRadarCtx] = useState<RadarContextResponse | null>(null);
  const [diagSummary, setDiagSummary] = useState<DiagnosticSummaryResponse | null>(null);
  const [roiData, setRoiData] = useState<ROITrackingResponse | null>(null);

  // §11.2 Baseline journey state
  const [baselineComparison, setBaselineComparison] = useState<BaselineComparisonResponse | null>(null);
  const [history, setHistory] = useState<{
    series: Array<{ month: string; value: number; secondary: number | null }>;
    mom_changes: Array<{ month: string; change: number }>;
    primary_label: string | null;
    secondary_label: string | null;
  } | null>(null);

  const loadDashboardIntelligence = async () => {
    setDashIntelLoading(true);
    try {
      const result = await api.apex.dashboardIntelligence(undefined, companyId || undefined);
      setDashIntel(result);
    } catch (err) { console.error('Failed to load dashboard intelligence:', err); }
    setDashIntelLoading(false);
  };

  // Traceability modal state
  const [showTraceModal, setShowTraceModal] = useState(false);
  const [traceData, setTraceData] = useState<HealthDimensionTraceResponse | null>(null);
  const [, setLoadingTrace] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const handleOpenDimensionTrace = async (dimension: string) => {
    setLoadingTrace(true);
    try {
      const data = await api.apex.healthDimension(dimension, undefined, companyId || undefined);
      if (!data || data.score === null) {
        setActionError('No traceability data available yet. Run a catalyst in this domain to generate health data.');
        return;
      }
      setTraceData(data);
      setShowTraceModal(true);
    } catch (err) {
      console.error('Failed to load dimension traceability', err);
      setActionError('Failed to load traceability data. Please ensure catalysts have been run for this domain.');
      toast.error('Failed to load traceability', {
        message: err instanceof Error ? err.message : 'Please ensure catalysts have been run for this domain.',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoadingTrace(false);
    }
  };

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const ind = industry !== 'general' ? industry : undefined;
      const co = companyId || undefined;
      const [h, r, m, a, c, act, cp] = await Promise.allSettled([
        api.apex.health(undefined, ind, co),
        api.apex.risks(undefined, ind, co),
        api.pulse.metrics(undefined, ind, co),
        api.pulse.anomalies(undefined, ind, co),
        api.catalysts.clusters(undefined, ind, co),
        api.catalysts.actions(undefined, undefined, ind, co),
        api.controlplane.health(undefined, ind),
      ]);
      if (h.status === "fulfilled") setHealth(h.value);
      if (r.status === "fulfilled") setRisks(r.value.risks);
      if (m.status === "fulfilled") setMetrics(m.value.metrics);
      if (a.status === "fulfilled") setAnomalies(a.value.anomalies);
      if (c.status === "fulfilled") setClusters(c.value.clusters);
      if (act.status === "fulfilled") setActions(act.value.actions);
      if (cp.status === "fulfilled") setCpHealth(cp.value);
    } catch (err) {
      console.error('Failed to load dashboard data', err);
    }
    setLoading(false);
    setLastRefreshed(new Date());
  }, [industry, companyId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Load new engine summaries + baseline comparison
  useEffect(() => {
    Promise.allSettled([
      api.radar.getContext(),
      api.diagnostics.getSummary(),
      api.roi.get(),
      api.baseline.comparison(),
      api.pulse.history(6),
    ]).then(([rc, ds, roi, bc, hist]) => {
      if (rc.status === 'fulfilled') setRadarCtx(rc.value);
      if (ds.status === 'fulfilled') setDiagSummary(ds.value);
      if (roi.status === 'fulfilled') setRoiData(roi.value);
      if (bc.status === 'fulfilled') setBaselineComparison(bc.value);
      if (hist.status === 'fulfilled') setHistory(hist.value);
    }).catch(() => { /* allSettled won't reject, but guard the .then() chain */ });
  }, []);

  // UX-05: Silent auto-refresh every 60s
  useEffect(() => {
    if (refreshTimerRef.current) clearInterval(refreshTimerRef.current);
    refreshTimerRef.current = setInterval(() => {
      loadData().then(() => {
        setRefreshFlash(true);
        setTimeout(() => setRefreshFlash(false), 2000);
      }).catch(() => { /* silent auto-refresh failure */ });
    }, 60000);
    return () => { if (refreshTimerRef.current) clearInterval(refreshTimerRef.current); };
  }, [loadData]);

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

  // Derive the primary and secondary metric from actual catalyst-generated data
  const primaryMetric = metrics.length > 0 ? metrics[0] : null;
  const secondaryMetric = metrics.length > 1 ? metrics[1] : null;
  const primaryMetricLabel = primaryMetric ? primaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Health Score';
  const secondaryMetricLabel = secondaryMetric ? secondaryMetric.name.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : null;

  // Metrics over time — sourced from /api/pulse/history (top-2 process metrics
  // bucketed by month). Falls back to [] until the worker responds so the chart
  // renders an empty state instead of synthesized data.
  const metricsOverTime: Record<string, string | number>[] = (history?.series ?? []).map((row) => ({
    month: row.month,
    value: row.value,
    secondary: row.secondary ?? 0,
  }));

  const piePalette = [ACCENT, ACCENT_B, SKY, BRONZE, CHART_LIGHT];
  const pieData = dimensions.slice(0, 5).map((dim, i) => ({
    name: dim.name,
    value: dim.score,
    fill: piePalette[i % piePalette.length],
  }));

  // ── Executive band figures (MetricGrid + journey split) ───────────────
  // Recovered value leads the band; the Atheon score + catalyst counts sit
  // beside it. The journey panel renders the baseline→current trajectory —
  // the only honest health time-series we have (two snapshots, not faked).
  const valueRecovered = roiData?.totalDiscrepancyValueRecovered ?? 0;
  const catalystCount = clusters.length;
  const pendingApprovals = actions.filter((a) => a.status === 'pending' || a.status === 'pending_approval').length;
  const completedActions = actions.filter((a) => a.status === 'completed').length;
  const scoreDelta = baselineComparison?.improvement?.healthScore ?? Math.round(avgDelta);
  const baselineScore = baselineComparison?.dayZero?.healthScore ?? null;
  const topDimensionKey = dimensions.length > 0
    ? dimensions.reduce((top, d) => (d.score > top.score ? d : top), dimensions[0]).key
    : null;
  const journeySeries = baselineComparison?.dayZero?.healthScore != null && baselineComparison?.current?.healthScore != null
    ? [baselineComparison.dayZero.healthScore, baselineComparison.current.healthScore]
    : [];
  const journeyStart = baselineComparison?.dayZero?.capturedAt
    ? new Date(baselineComparison.dayZero.capturedAt).toLocaleDateString('en-ZA', { month: 'short', year: '2-digit' }).toUpperCase()
    : 'Baseline';

  // U12: Progressive skeleton loading instead of spinner
  if (loading && !health) {
    return <DashboardSkeleton />;
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* CFO-facing shared-savings strip — slim banner showing cumulative
          recovered + billed + ROI multiple. Hidden for tenants without
          realised savings yet; dismissible per session. */}
      <SharedSavingsStrip />

      {/* MASTHEAD — Swiss page-band: letterspaced eyebrow + live tick, the
          greeting set in Archivo display, a single restrained dek, closed by
          a 1.5px ink rule. The signature figures move into the MetricGrid
          band below; the masthead carries identity, not numbers. Operating
          controls (time range + refresh) sit in the actions slot. */}
      <PageHeader
        eyebrow="Atheon · Enterprise Intelligence"
        live
        title={getGreeting(user?.name)}
        dek="A real-time operating picture for the people who answer for the numbers."
        actions={
          <div className="flex items-center gap-2">
            <SectionFreshness section="Health" />
            <select
              value={timeRange}
              onChange={(e) => setTimeRange(e.target.value as TimeRange)}
              className="px-2 py-1 rounded-md text-xs t-secondary"
              style={{ background: "var(--bg-secondary)", border: "1px solid var(--border-card)" }}
              aria-label="Time range"
            >
              <option value="today">Today</option>
              <option value="7d">7 Days</option>
              <option value="30d">30 Days</option>
              <option value="90d">90 Days</option>
            </select>
            <span className="text-caption tnum t-muted transition-colors duration-500" style={refreshFlash ? { color: 'var(--positive)' } : undefined}>
              Updated: {lastRefreshed.toLocaleTimeString()}
            </span>
            <button
              className="w-8 h-8 rounded-md flex items-center justify-center t-muted hover:t-primary transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
              style={{ background: "var(--bg-secondary)" }}
              title={`Last refreshed: ${lastRefreshed.toLocaleTimeString()}`}
              onClick={() => loadData().then(() => { setRefreshFlash(true); setTimeout(() => setRefreshFlash(false), 2000); }).catch(() => { /* manual refresh failure handled by loadData */ })}
              aria-label="Refresh dashboard data"
            >
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        }
      />

      {mfaEnforcementWarning && (
        <div
          role="alert"
          className="flex items-start gap-3 p-3 rounded-md"
          style={{
            background: mfaEnforcementWarning.daysRemaining <= 0 ? 'rgb(var(--neg-rgb) / 0.08)' : 'rgba(154, 107, 31, 0.08)',
            border: mfaEnforcementWarning.daysRemaining <= 0 ? '1px solid rgb(var(--neg-rgb) / 0.30)' : '1px solid rgba(154, 107, 31, 0.30)',
          }}
        >
          <AlertTriangle
            size={16}
            className="flex-shrink-0 mt-0.5"
            style={{ color: mfaEnforcementWarning.daysRemaining <= 0 ? 'var(--neg)' : 'var(--warning)' }}
          />
          <div className="flex-1">
            <p className="text-sm font-semibold" style={{ color: mfaEnforcementWarning.daysRemaining <= 0 ? 'var(--neg)' : 'var(--warning)' }}>
              {mfaEnforcementWarning.daysRemaining <= 0
                ? 'MFA is now required for your role'
                : `MFA required for your role — enable within ${mfaEnforcementWarning.daysRemaining} day${mfaEnforcementWarning.daysRemaining === 1 ? '' : 's'} to keep access.`}
            </p>
            {mfaEnforcementWarning.reason && (
              <p className="text-xs t-muted mt-0.5">{mfaEnforcementWarning.reason}</p>
            )}
          </div>
          <Link
            to={mfaEnforcementWarning.mfaSetupUrl || '/settings/mfa'}
            className="text-xs font-medium px-2.5 py-1 rounded-md whitespace-nowrap"
            style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}
          >
            Enable MFA now
          </Link>
        </div>
      )}

      {actionError && (
        <div
          className="flex items-center gap-3 p-3 rounded-md"
          style={{ background: 'rgba(154, 107, 31, 0.08)', border: '1px solid rgba(154, 107, 31, 0.25)' }}
        >
          <AlertTriangle size={16} className="flex-shrink-0" style={{ color: 'var(--warning)' }} />
          <p className="text-sm flex-1" style={{ color: 'var(--warning)' }}>{actionError}</p>
          <button type="button" onClick={() => setActionError(null)} className="hover:t-primary focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] rounded p-0.5" style={{ color: 'var(--warning)' }} aria-label="Dismiss error message" title="Dismiss"><X size={14} aria-hidden="true" /></button>
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          onClick={loadDashboardIntelligence}
          disabled={dashIntelLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium t-secondary hover:t-primary border border-[var(--border-card)] hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] disabled:opacity-50 ml-auto active:scale-[0.97]"
          style={{ background: 'var(--bg-card-solid)' }}
          title="Generate AI-powered dashboard intelligence"
        >
          <Lightbulb size={12} className={dashIntelLoading ? 'animate-pulse' : ''} style={{ color: 'var(--accent)' }} />
          {dashIntelLoading ? 'Analyzing...' : 'AI Insights'}
        </button>
      </div>

      {/* Dashboard Intelligence Panel — uses decomposed sub-component (TASK-002) */}
      {dashIntel && <IntelligencePanel data={dashIntel} />}

      {/* Wave 3 — CFO morning view: cash + working capital + period close.
          These two cards answer the first two questions a CFO has each
          morning: "where's our cash + working capital trending?" and
          "are we closing on time?". They drill into ERP-grounded data
          but never duplicate the Apex tabs (which are quarterly), the
          KpiGrid (which is operational), or the SharedSavingsStrip
          (which is cumulative billing). */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <WorkingCapitalCard />
        <CloseCycleCard />
      </div>

      {/* Executive band. One MetricGrid carries the three signature figures
          (recovered value lead · Atheon score · catalysts), then a hairline
          split pairs the business-dimension ledger against the single
          Atheon-journey figure. */}
      <>
      <MetricGrid
        className="py-1"
        cells={[
          {
            k: 'Value recovered',
            value: `R${Math.round(valueRecovered).toLocaleString('en-ZA')}`,
            sub: valueRecovered > 0
              ? `Verified · traced to ERP record across ${catalystCount} catalyst run${catalystCount === 1 ? '' : 's'}`
              : 'No recovered value yet · run a catalyst to begin',
            lead: true,
          },
          {
            k: 'Atheon score',
            value: overallScore,
            delta: scoreDelta,
            sub: baselineScore != null ? `from baseline ${baselineScore}` : `${upCount} improving · ${downCount} declining`,
          },
          {
            k: 'Catalysts run',
            value: catalystCount,
            sub: `${pendingApprovals} awaiting your approval`,
          },
        ]}
      />

      {/* Lower split — business-dimension ledger | Atheon journey. The whole
          dimension row is the trace trigger (Eye affordance on hover); the
          top-scoring dimension reads in the accent, the rest in ink. */}
      <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr]">
        <div className="lg:pr-7 lg:border-r" style={{ borderColor: 'var(--border-card)' }}>
          <p className="text-label mb-3">Business dimensions</p>
          {dimensions.length === 0 ? (
            <div className="flex flex-col items-start gap-2 py-3">
              <p className="text-sm t-muted">No dimensions yet.</p>
              <Link to="/catalysts" className="inline-flex items-center gap-1.5 text-caption font-medium t-accent hover:underline">
                Run a catalyst to start <ArrowRight size={12} />
              </Link>
            </div>
          ) : (
            <div>
              {dimensions.map((dim) => (
                <button
                  key={dim.key}
                  type="button"
                  onClick={() => handleOpenDimensionTrace(dim.key)}
                  className="group w-full flex items-center gap-3.5 py-2.5 border-t first:border-t-0 text-left transition-colors hover:bg-[var(--bg-secondary)] focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] rounded-sm"
                  style={{ borderColor: 'var(--border-card)' }}
                  title={`Trace ${dim.name}`}
                  aria-label={`Open trace for ${dim.name}`}
                >
                  <span className="flex-[0_0_132px] text-body-sm font-semibold t-primary truncate flex items-center gap-1.5">
                    {dim.name}
                    <Eye size={11} className="md:opacity-0 md:group-hover:opacity-100 t-muted transition-opacity" aria-hidden="true" />
                  </span>
                  <span className="flex-1 h-1.5 relative overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
                    <span
                      className="absolute inset-y-0 left-0"
                      style={{ width: `${dim.score}%`, background: dim.key === topDimensionKey ? 'var(--accent)' : 'var(--text-primary)' }}
                    />
                  </span>
                  <span className="flex-[0_0_38px] text-right font-mono text-body-sm font-medium tnum t-primary">{dim.score}</span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="lg:pl-7 mt-6 lg:mt-0">
          <p className="text-label mb-3">Your Atheon journey</p>
          <div className="flex items-end gap-4">
            <span className="font-black tnum leading-[0.82] tracking-[-0.05em] text-[clamp(56px,7vw,72px)] t-primary">{overallScore}</span>
            <div className="pb-2">
              <div className="font-mono text-sm font-bold" style={{ color: scoreDelta >= 0 ? 'var(--positive)' : 'var(--neg)' }}>
                {scoreDelta >= 0 ? '↑ +' : '↓ '}{Math.abs(scoreDelta)}
              </div>
              {baselineScore != null && (
                <div className="font-mono text-caption t-muted">baseline {baselineScore}</div>
              )}
            </div>
          </div>
          {journeySeries.length >= 2 && (
            <div className="mt-4">
              <Sparkline data={journeySeries} width={300} height={56} className="w-full" />
              <div className="flex justify-between font-mono text-[9px] t-muted mt-1.5 uppercase tracking-wider">
                <span>{journeyStart}</span>
                <span>Today</span>
              </div>
            </div>
          )}
          {baselineComparison?.narrative && (
            <p className="text-caption t-secondary mt-3 max-w-[42ch]">{baselineComparison.narrative}</p>
          )}
        </div>
      </div>

      {/* "Changed" strip — overnight movement · what needs you · assurance.
          1.5px ink top-rule echoes the masthead; the accent flags only the
          one item that asks for a human decision. */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-4" style={{ borderTop: '1.5px solid var(--line-strong)' }}>
        <div>
          <p className="text-label">Overnight</p>
          <p className="text-body-sm t-secondary mt-1.5 leading-relaxed">
            {completedActions > 0
              ? <><span className="font-mono font-semibold" style={{ color: 'var(--accent)' }}>{completedActions}</span> catalyst{completedActions === 1 ? '' : 's'} closed against flagged transactions.</>
              : 'No catalysts closed in the last cycle.'}
          </p>
        </div>
        <div>
          <p className="text-label" style={{ color: 'var(--accent)' }}>Needs you</p>
          <p className="text-body-sm t-secondary mt-1.5 leading-relaxed">
            {pendingApprovals > 0
              ? <>Approve <b className="t-primary font-semibold">{pendingApprovals}</b> write-back{pendingApprovals === 1 ? '' : 's'} awaiting your review — <Link to="/action-layer" className="t-accent hover:underline">open the queue</Link>.</>
              : 'Nothing awaiting approval right now.'}
          </p>
        </div>
        <div>
          <p className="text-label">Assurance</p>
          <p className="text-body-sm t-secondary mt-1.5 leading-relaxed">
            Every figure traces to an ERP record with field mapping &amp; confidence — audit-ready.
          </p>
        </div>
      </div>

      {/* TASK-002: Decomposed KPI Grid sub-component */}
      <KpiGrid
        overallScore={overallScore}
        healthTrend={healthTrend}
        avgDelta={avgDelta}
        activeCatalysts={activeCatalysts}
        totalTasks={totalTasks}
        risksCount={risks.length}
        anomaliesCount={anomalies.length}
        refreshedAt={lastRefreshed.toISOString()}
      />

      {/* Status Breakdown Cards (Static — FlipCards removed per UI cleanup).
          Each card now carries a MetricSource so the operator can audit
          where the count came from: Apex health endpoint, dimension
          score threshold, refresh timestamp. */}
      {(() => {
        const healthyCount  = dimensions.filter(d => d.score >= 80).length;
        const atRiskCount   = dimensions.filter(d => d.score >= 60 && d.score < 80).length;
        const criticalCount = dimensions.filter(d => d.score < 60).length;
        const baseProvenance: Partial<MetricProvenance> = {
          table: 'health_scores',
          endpoint: 'GET /api/apex/health',
          window: 'Latest snapshot',
          refreshedAt: lastRefreshed.toISOString(),
        };
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-label">Dimensions</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Monitored dimensions',
                    definition: 'Number of business health dimensions Atheon is tracking for this tenant.',
                    query: 'COUNT(DISTINCT dimension) FROM health_scores WHERE tenant_id = ?',
                    sample: dimensions.length,
                    drillTo: '/pulse',
                  }} />
                  <Gauge size={14} className="text-accent" />
                </div>
              </div>
              <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{dimensions.length}</p>
              <p className="text-caption t-muted mt-1">monitored areas</p>
              <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {dimensions.slice(0, 3).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium font-mono tnum" style={{ color: d.score >= 80 ? 'var(--positive)' : d.score >= 60 ? 'var(--warning)' : 'var(--neg)' }}>{d.score}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-label">Healthy</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Healthy dimensions',
                    definition: 'Dimensions whose latest health score is at or above the healthy threshold (≥ 80).',
                    query: "COUNT(*) FROM health_scores WHERE tenant_id = ? AND score >= 80",
                    sample: healthyCount,
                    notes: [{ label: 'Threshold', value: 'score ≥ 80' }],
                  }} />
                  <CheckCircle2 size={14} style={{ color: 'var(--positive)' }} />
                </div>
              </div>
              <p className="text-headline-lg font-bold tabular-nums font-mono" style={{ color: 'var(--positive)' }}>{healthyCount}</p>
              <p className="text-caption t-muted mt-1">above threshold</p>
              <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {dimensions.filter(d => d.score >= 80).slice(0, 3).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium font-mono tnum" style={{ color: 'var(--positive)' }}>{d.score}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-label">At Risk</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'At-risk dimensions',
                    definition: 'Dimensions whose latest health score falls in the warning band (60 ≤ score < 80).',
                    query: 'COUNT(*) FROM health_scores WHERE tenant_id = ? AND score >= 60 AND score < 80',
                    sample: atRiskCount,
                    notes: [{ label: 'Threshold', value: '60 ≤ score < 80' }],
                  }} />
                  <AlertTriangle size={14} style={{ color: 'var(--warning)' }} />
                </div>
              </div>
              <p className="text-headline-lg font-bold tabular-nums font-mono" style={{ color: 'var(--warning)' }}>{atRiskCount}</p>
              <p className="text-caption t-muted mt-1">needs attention</p>
              <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {dimensions.filter(d => d.score >= 60 && d.score < 80).slice(0, 3).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium font-mono tnum" style={{ color: 'var(--warning)' }}>{d.score}</span>
                  </div>
                ))}
              </div>
            </Card>
            <Card className="h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-label">Critical</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Critical dimensions',
                    definition: 'Dimensions whose latest health score is below the critical threshold (< 60). These force operator review.',
                    query: 'COUNT(*) FROM health_scores WHERE tenant_id = ? AND score < 60',
                    sample: criticalCount,
                    notes: [{ label: 'Threshold', value: 'score < 60' }],
                  }} />
                  <XCircle size={14} style={{ color: 'var(--neg)' }} />
                </div>
              </div>
              <p className="text-headline-lg font-bold tabular-nums font-mono" style={{ color: 'var(--neg)' }}>{criticalCount}</p>
              <p className="text-caption t-muted mt-1">requires action</p>
              <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {dimensions.filter(d => d.score < 60).slice(0, 3).map((d) => (
                  <div key={d.key} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{d.name}</span>
                    <span className="font-medium font-mono tnum" style={{ color: 'var(--neg)' }}>{d.score}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      })()}

      {/* v63 — write-back action queue: pending count + value at stake.
          Shipped in Phase 7-2 alongside Pulse / Apex equivalents so the
          customer sees actions across every surface they land on. */}
      <ActionQueuePanel variant="compact" />

      {/* V2 Engine Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 stagger">
        {/* Strategic Context Card */}
        <Link to="/apex" className="block">
          <Card className="h-full hover:border-[var(--accent)]/30 hover:-translate-y-px active:scale-[0.98] transition-[background-color,color,box-shadow,transform,border-color] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Radar size={16} className="text-accent" />
                <span className="text-sm font-semibold t-primary">Strategic Context</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {radarCtx ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-headline-lg font-bold t-primary tabular-nums font-mono">{radarCtx.signals?.length ?? 0}</span>
                  <span className="text-xs t-muted">active signals</span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={radarCtx.context?.sentiment === 'negative' ? 'danger' : radarCtx.context?.sentiment === 'positive' ? 'success' : 'warning'} size="sm">
                    {radarCtx.context?.sentiment ?? 'neutral'}
                  </Badge>
                  <span className="text-caption t-muted">market sentiment</span>
                </div>
                {radarCtx.context?.confidence != null && (
                  <Progress value={radarCtx.context.confidence} color={radarCtx.context.confidence >= 70 ? 'emerald' : 'amber'} size="sm" />
                )}
              </div>
            ) : (
              <p className="text-xs t-muted">No signals detected yet</p>
            )}
          </Card>
        </Link>

        {/* Active Diagnostics Card */}
        <Link to="/pulse" className="block">
          <Card className="h-full hover:border-[var(--accent)]/30 hover:-translate-y-px active:scale-[0.98] transition-[background-color,color,box-shadow,transform,border-color] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Stethoscope size={16} className="text-accent" />
                <span className="text-sm font-semibold t-primary">Active Diagnostics</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {diagSummary ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-headline-lg font-bold t-primary tabular-nums font-mono">{diagSummary.totalAnalyses ?? 0}</span>
                  <span className="text-xs t-muted">analyses completed</span>
                </div>
                <div className="flex items-center gap-3">
                  {diagSummary.criticalFindings > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--neg)' }} />
                      <span className="text-xs" style={{ color: 'var(--neg)' }}>{diagSummary.criticalFindings} critical</span>
                    </div>
                  )}
                  {diagSummary.pendingAnalyses > 0 && (
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 rounded-full" style={{ background: 'var(--warning)' }} />
                      <span className="text-xs" style={{ color: 'var(--warning)' }}>{diagSummary.pendingAnalyses} pending</span>
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No diagnostics yet</p>
            )}
          </Card>
        </Link>

        {/* ROI Card */}
        <Link to="/catalysts" className="block">
          <Card className="h-full hover:border-[var(--accent)]/30 hover:-translate-y-px active:scale-[0.98] transition-[background-color,color,transform,border-color] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] cursor-pointer">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Coins size={16} className="text-accent" />
                <span className="text-sm font-semibold t-primary">ROI Tracking</span>
              </div>
              <ChevronRight size={14} className="t-muted" />
            </div>
            {roiData?.roiMultiple != null ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="text-headline-lg font-bold tabular-nums font-mono" style={{ color: 'var(--accent)' }}>
                    {roiData.roiMultiple}x
                  </span>
                  <span className="text-xs t-muted">return multiple</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-caption t-muted">Recovered</p>
                    <p className="text-xs font-medium font-mono tnum" style={{ color: 'var(--positive)' }}>
                      R{((roiData.totalDiscrepancyValueRecovered ?? 0) / 1000000).toFixed(1)}M
                    </p>
                  </div>
                  <div>
                    <p className="text-caption t-muted">Prevented</p>
                    <p className="text-xs font-medium font-mono tnum" style={{ color: 'var(--accent)' }}>
                      R{((roiData.totalPreventedLosses ?? 0) / 1000000).toFixed(1)}M
                    </p>
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs t-muted">No ROI data yet</p>
            )}
          </Card>
        </Link>
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-7 space-y-5">
          <Card>
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mb-4">
              <p className="text-sm font-semibold t-primary">Metrics Over Time</p>
              <div className="flex items-center gap-3">
                <span className="inline-flex items-center gap-1 text-caption font-medium" style={{ color: ACCENT }}>
                  <span className="w-2 h-2 rounded-full" style={{ background: ACCENT }} /> {primaryMetricLabel}
                </span>
                {secondaryMetricLabel && (
                  <span className="inline-flex items-center gap-1 text-caption font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: CHART_LIGHT }} /> {secondaryMetricLabel}
                  </span>
                )}
              </div>
            </div>
            <div className="h-56">
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
                  <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "2px", fontSize: "11px" }} />
                  <Area type="monotone" dataKey="value" name={primaryMetricLabel} stroke={ACCENT} strokeWidth={2} fill={`url(#${pieId}-revGrad)`} />
                  {secondaryMetricLabel && <Area type="monotone" dataKey="secondary" name={secondaryMetricLabel} stroke={CHART_LIGHT} strokeWidth={2} fill="none" />}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            <Card>
              <p className="text-sm font-semibold t-primary mb-1">Health by Dimension</p>
              <div className="flex flex-wrap items-center gap-3 mb-3">
                {pieData.map((d) => (
                  <span key={d.name} className="inline-flex items-center gap-1 text-caption font-medium t-muted">
                    <span className="w-2 h-2 rounded-full" style={{ background: d.fill }} /> {d.name}
                  </span>
                ))}
              </div>
              <div className="h-44 flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} cx="50%" cy="50%" innerRadius={45} outerRadius={70} paddingAngle={2} dataKey="value" stroke="none">
                      {pieData.map((entry, i) => (
                        <Cell key={`${pieId}-${i}`} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "2px", fontSize: "11px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <p className="text-sm font-semibold t-primary mb-1">Risk Distribution</p>
              <div className="h-44 mt-2">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={(() => {
                      const severities = ["critical", "high", "medium", "low"];
                      return severities.map((sev) => ({
                        severity: sev.charAt(0).toUpperCase() + sev.slice(1),
                        count: risks.filter((r) => r.severity === sev).length,
                      }));
                    })()}
                    barSize={28}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--divider)" vertical={false} />
                    <XAxis dataKey="severity" tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: "var(--text-muted)" }} axisLine={false} tickLine={false} allowDecimals={false} />
                    <Tooltip contentStyle={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)", borderRadius: "2px", fontSize: "11px" }} />
                    <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                      {["critical", "high", "medium", "low"].map((sev) => (
                        <Cell key={sev} fill={sev === "critical" ? "var(--neg)" : sev === "high" ? "var(--warning)" : ACCENT} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          </div>
        </div>

        {/* Right sidebar: Quick summaries */}
        <div className="lg:col-span-5 space-y-5">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary flex items-center gap-1.5"><Shield size={14} className="text-accent" /> Risk Summary</p>
              <Link to="/apex" className="text-caption font-medium flex items-center gap-0.5" style={{ color: ACCENT }}>
                View all <ChevronRight size={10} />
              </Link>
            </div>
            {risks.length === 0 ? (
              <p className="text-xs t-muted py-4 text-center">No active risks detected</p>
            ) : (
              <div className="space-y-2">
                {risks.slice(0, 4).map((risk) => (
                  <div key={risk.id} className="flex items-start gap-2 p-2 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                    <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" style={{ color: risk.severity === 'critical' ? 'var(--neg)' : risk.severity === 'high' ? 'var(--warning)' : 'var(--text-muted)' }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium t-primary truncate">{risk.title}</p>
                      <p className="text-caption t-muted truncate">{risk.description}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <StatusPill status={risk.severity} size="sm" />
                        <span className="text-caption t-muted">{risk.category}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary">Process Metrics</p>
              <Link to="/pulse" className="text-caption font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all process metrics">
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="space-y-2.5">
              {metrics.slice(0, 5).map((metric) => (
                <div key={metric.id} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full" style={{ background: metric.status === "green" ? "var(--positive)" : metric.status === "amber" ? "var(--warning)" : "var(--neg)" }} />
                    <span className="text-xs t-secondary">{metric.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Sparkline data={metric.trend || []} width={40} height={16} color={ACCENT} />
                    <span className="text-xs font-semibold t-primary w-12 text-right">{metric.value}<span className="text-caption t-muted ml-0.5">{metric.unit}</span></span>
                  </div>
                </div>
              ))}
            </div>
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <p className="text-sm font-semibold t-primary">Catalyst Activity</p>
              <Link to="/catalysts" className="text-caption font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all catalyst activity">
                View all <ChevronRight size={10} />
              </Link>
            </div>
            <div className="flex items-center gap-4 mb-3">
              <div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{activeCatalysts}</p>
                <p className="text-caption t-muted">active</p>
              </div>
              <div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{totalTasks}</p>
                <p className="text-caption t-muted">tasks</p>
              </div>
            </div>
            <div className="space-y-2">
              {actions.slice(0, 3).map((action) => (
                <div key={action.id} className="flex items-center justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium t-primary truncate">{action.action}</p>
                    <p className="text-caption t-muted truncate">{action.catalystName}</p>
                  </div>
                  <Badge variant={action.status === "completed" ? "success" : action.status === "pending" ? "warning" : "info"}>
                    {action.status}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </div>
      </>


      {/* ANOMALIES & CONTROL PLANE HEALTH — Bug #7 fix: render previously discarded data */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card>
          <div className="flex items-center justify-between mb-3">
            <p className="text-sm font-semibold t-primary">Recent Anomalies</p>
            <Link to="/pulse" className="text-caption font-medium flex items-center gap-0.5" style={{ color: ACCENT }} title="View all anomalies">
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
                    <p className="text-caption t-muted">Deviation: {typeof a.deviation === 'number' ? `${a.deviation > 0 ? '+' : ''}${a.deviation.toFixed(1)}%` : '--'}</p>
                  </div>
                  <StatusPill status={a.severity} size="sm" />
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
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
        </Card>
      </div>

      {/* QUICK LINKS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 stagger">
        {[
          { label: "Apex", desc: "Executive Intelligence", to: "/apex" },
          { label: "Pulse", desc: "Process Monitoring", to: "/pulse" },
          { label: "Memory", desc: "Knowledge Base", to: "/memory" },
          { label: "Mind", desc: "AI Models", to: "/mind" },
        ].map((item) => (
          <Link
            key={item.label}
            to={item.to}
            className="rounded-md p-4 transition-[background-color,color,transform,border-color] duration-[var(--dur-quick)] [transition-timing-function:var(--ease-out)] hover:-translate-y-0.5 active:scale-[0.98] hover:border-[var(--accent)]/30"
            style={{ background: "var(--bg-card-solid)", border: "1px solid var(--border-card)" }}
          >
            <p className="text-sm font-semibold t-primary">{item.label}</p>
            <p className="text-caption t-muted">{item.desc}</p>
          </Link>
        ))}
      </div>

      {/* Traceability Modal */}
      {showTraceModal && traceData && (
        <TraceabilityModal
          data={traceData}
          type="dimension"
          onClose={() => { setShowTraceModal(false); setTraceData(null); }}
        />
      )}
    </div>
  );
}
