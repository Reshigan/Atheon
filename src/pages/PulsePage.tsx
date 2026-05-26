import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Numeric } from "@/components/ui/numeric";
import { HeroHeader } from "@/components/ui/hero-header";
import { SharedSavingsStrip } from "@/components/SharedSavingsStrip";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { LoadingState, ErrorState } from "@/components/ui/state";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";

import { api, ApiError } from "@/lib/api";
import { cleanLlmText, formatDuration, formatDays } from "@/lib/utils";
import type { Metric, AnomalyItem, ProcessItem, CorrelationItem, PulseSummary, CatalystRunItem, CatalystRunSummary, MetricTraceResponse, HealthDimensionTraceResponse, PulseInsightsResponse, DiagnosticSummaryResponse, DiagnosticAnalysisItem, DiagnosticAnalysisDetail, CostOfInactionResponse } from "@/lib/api";
import { ActionQueuePanel } from "@/components/dashboard/ActionQueuePanel";
import { CostOfInactionTicker } from "@/components/ui/cost-of-inaction-ticker";
import { useAppStore, useSelectedCompanyId } from "@/stores/appStore";
import { useToast } from "@/components/ui/toast";
import { TraceabilityModal } from "@/components/TraceabilityModal";
import { MetricFilterBar, type MetricStatus } from "@/components/MetricFilterBar";
import { AnomalyDetectionControls, type AnomalySensitivity } from "@/components/AnomalyDetectionControls";
import { CorrelationMatrix } from "@/components/CorrelationMatrix";
import {
  Activity, AlertTriangle, GitBranch, Link2, ArrowRight, Loader2,
  TrendingUp, TrendingDown, Minus, Shield, Lightbulb, ChevronDown,
  ChevronUp, Clock, Zap, Target, Eye, CheckCircle2, XCircle,
  BarChart3, Gauge, Filter, AlertCircle, Workflow, Play,
  UserCheck, FileWarning, RefreshCw, List, Stethoscope, ChevronRight, Wrench, X, DollarSign
} from "lucide-react";
import { CSVExportButton } from "@/components/common/CSVExportButton";
import { SectionFreshness } from "@/components/common/FreshnessIndicator";
import { MetricsGrid } from "./pulse/MetricsGrid";
import { AnomalyList } from "./pulse/AnomalyList";
// FlipCard removed per UI cleanup spec

/* ── helpers ──────────────────────────────────────────────── */
const trendIcon = (trend: string, size = 14) => {
  if (trend === 'up' || trend === 'improving') return <TrendingUp size={size} className="text-emerald-400" />;
  if (trend === 'down' || trend === 'declining') return <TrendingDown size={size} className="text-red-400" />;
  return <Minus size={size} className="text-gray-400" />;
};

const CURRENCY_UNITS = new Set(['ZAR', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'CNY', 'NGN', 'KES']);
const formatMetricValue = (value: unknown, unit?: string | null): string => {
  if (typeof value !== 'number' || !isFinite(value)) return String(value ?? '');
  const u = (unit || '').toUpperCase();
  if (CURRENCY_UNITS.has(u)) {
    try {
      return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: u, maximumFractionDigits: 0 }).format(value);
    } catch {
      return value.toLocaleString('en-ZA', { maximumFractionDigits: 0 });
    }
  }
  if (u === '%' || u === 'PERCENT' || u === 'PCT') return `${value.toFixed(1)}%`;
  return value.toLocaleString('en-ZA', { maximumFractionDigits: 1 });
};

/**
 * PulseActionRequired — strip at the top of the Overview tab summarising
 * what needs attention right now. Three categories:
 *
 *   - Red metrics            (status === 'red')
 *   - Critical / high anomalies (open + severity in {critical, high})
 *   - Low-conformance processes (conformanceRate < 70%)
 *
 * Each chip jumps to the relevant tab. The strip is hidden when nothing
 * is actionable — quiet operations should produce a quiet UI.
 */
function PulseActionRequired({
  metrics, anomalies, processes, onJumpToTab,
}: {
  metrics: Metric[];
  anomalies: AnomalyItem[];
  processes: ProcessItem[];
  onJumpToTab: (id: string) => void;
}): JSX.Element | null {
  const redMetrics = metrics.filter(m => m.status === 'red');
  const criticalAnomalies = anomalies.filter(
    a => (a.status === 'open' || !a.status) && (a.severity === 'critical' || a.severity === 'high'),
  );
  const lowConformance = processes.filter(p => (p.conformanceRate ?? 100) < 70);
  const totalActions = redMetrics.length + criticalAnomalies.length + lowConformance.length;
  if (totalActions === 0) return null;

  const items: Array<{
    key: string; tab: string; count: number; label: string; tone: string; subline: string;
  }> = [];
  if (redMetrics.length > 0) {
    items.push({
      key: 'red-metrics',
      tab: 'monitoring',
      count: redMetrics.length,
      label: 'Red metrics',
      tone: 'text-red-400 border-red-500/30 bg-red-500/5',
      subline: redMetrics.slice(0, 2).map(m => m.name).join(', ') + (redMetrics.length > 2 ? ` +${redMetrics.length - 2} more` : ''),
    });
  }
  if (criticalAnomalies.length > 0) {
    items.push({
      key: 'critical-anomalies',
      tab: 'anomalies',
      count: criticalAnomalies.length,
      label: 'Critical / high anomalies',
      tone: 'text-amber-400 border-amber-500/30 bg-amber-500/5',
      subline: criticalAnomalies.slice(0, 2).map(a => a.metric).join(', ') + (criticalAnomalies.length > 2 ? ` +${criticalAnomalies.length - 2} more` : ''),
    });
  }
  if (lowConformance.length > 0) {
    items.push({
      key: 'low-conformance',
      tab: 'processes',
      count: lowConformance.length,
      label: 'Low-conformance processes',
      tone: 'text-orange-400 border-orange-500/30 bg-orange-500/5',
      subline: lowConformance.slice(0, 2).map(p => p.name).join(', ') + (lowConformance.length > 2 ? ` +${lowConformance.length - 2} more` : ''),
    });
  }

  return (
    <Card className="p-4 mb-6 border-red-500/20 bg-red-500/5" data-testid="pulse-action-required">
      <div className="flex items-center gap-2 mb-3">
        <AlertCircle className="w-4 h-4 text-red-400" />
        <h3 className="text-sm font-semibold t-primary">Action Required</h3>
        <Badge variant="danger" size="sm">{totalActions}</Badge>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        {items.map(item => (
          <button
            key={item.key}
            onClick={() => onJumpToTab(item.tab)}
            className={`text-left p-3 rounded-lg border transition-all hover:scale-[1.01] ${item.tone}`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium t-primary">{item.label}</span>
              <span className="text-lg font-bold">{item.count}</span>
            </div>
            <div className="text-caption t-muted truncate">{item.subline}</div>
            <div className="flex items-center gap-1 text-caption mt-1.5 opacity-80">
              <ArrowRight size={10} /> Jump to {item.tab}
            </div>
          </button>
        ))}
      </div>
    </Card>
  );
}

const statusColor = (s: string) =>
  s === 'green' ? 'text-emerald-400' : s === 'amber' ? 'text-amber-400' : s === 'red' ? 'text-red-400' : 'text-gray-400';

const conformanceColor = (rate: number): 'emerald' | 'amber' | 'red' =>
  rate >= 90 ? 'emerald' : rate >= 75 ? 'amber' : 'red';

const confidenceLabel = (c: number) =>
  c >= 0.85 ? 'Very Strong' : c >= 0.7 ? 'Strong' : c >= 0.5 ? 'Moderate' : 'Weak';

const confidenceColor = (c: number) =>
  c >= 0.85 ? 'text-emerald-400' : c >= 0.7 ? 'text-blue-400' : c >= 0.5 ? 'text-amber-400' : 'text-gray-400';

/* ── Operational Health Score (computed from metrics) ───── */
function computeOperationalHealth(metrics: Metric[], summary: PulseSummary | null, anomalies: AnomalyItem[], processes: ProcessItem[]) {
  const total = summary?.totalMetrics ?? metrics.length;
  if (total === 0) return { score: 0, trend: 'stable', dimensions: {} as Record<string, { score: number; trend: string; delta: number }> };

  const green = summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length;
  const amber = summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length;
  const red = summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length;

  // Weighted score: green=100, amber=60, red=20
  const score = total > 0 ? Math.round((green * 100 + amber * 60 + red * 20) / total) : 0;

  // Compute dimension scores
  const avgConformance = processes.length > 0
    ? Math.round(processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length)
    : 0;
  const anomalyPressure = Math.max(0, 100 - (anomalies.filter(a => a.status === 'open' || !a.status).length * 15));
  const metricHealth = score;
  const processEfficiency = processes.length > 0
    ? Math.round(processes.reduce((s, p) => s + (p.bottlenecks.length === 0 ? 100 : Math.max(20, 100 - p.bottlenecks.length * 25)), 0) / processes.length)
    : 0;

  return {
    score,
    trend: score >= 80 ? 'improving' : score >= 60 ? 'stable' : 'declining',
    dimensions: {
      'Metric Health': { score: metricHealth, trend: metricHealth >= 80 ? 'improving' : 'stable', delta: 0 },
      'Process Conformance': { score: avgConformance, trend: avgConformance >= 85 ? 'improving' : 'stable', delta: 0 },
      'Anomaly Pressure': { score: anomalyPressure, trend: anomalyPressure >= 80 ? 'improving' : 'declining', delta: 0 },
      'Process Efficiency': { score: processEfficiency, trend: processEfficiency >= 80 ? 'improving' : 'stable', delta: 0 },
    } as Record<string, { score: number; trend: string; delta: number }>,
  };
}

/* ── Insights engine ──────────────────────────────── */
interface Insight {
  icon: typeof Shield;
  title: string;
  description: string;
  priority: 'Critical' | 'High' | 'Medium' | 'Low';
  category: 'Metrics' | 'Processes' | 'Anomalies' | 'Trends';
  impact?: string;
  action?: string;
}

function generateInsights(metrics: Metric[], anomalies: AnomalyItem[], processes: ProcessItem[], _summary?: PulseSummary | null): Insight[] {
  void _summary;
  const insights: Insight[] = [];

  // Critical metrics requiring immediate action
  const redMetrics = metrics.filter(m => m.status === 'red');
  if (redMetrics.length > 0) {
    const affectedDomain = redMetrics[0].name.includes('AP') || redMetrics[0].name.includes('Payable') ? 'Accounts Payable' 
      : redMetrics[0].name.includes('Finance') ? 'Financial Operations'
      : redMetrics[0].name.includes('HR') || redMetrics[0].name.includes('Leave') ? 'Human Resources'
      : 'core business processes';
    
    insights.push({
      icon: AlertCircle,
      title: `${redMetrics.length} Critical Metric${redMetrics.length > 1 ? 's' : ''} Breaching Thresholds`,
      description: `${redMetrics.map(m => m.name).join(', ')} ${redMetrics.length > 1 ? 'are' : 'is'} failing to meet minimum thresholds. This indicates systematic issues in ${affectedDomain.toLowerCase()}.`,
      priority: 'Critical',
      category: 'Metrics',
      impact: `Immediate operational impact — affected processes may be blocked or failing.`,
      action: 'Review catalyst execution logs and source system data quality immediately.',
    });
  }

  // Degrading trends
  const decliningMetrics = metrics.filter(m => {
    const trend = Array.isArray(m.trend) ? m.trend : [];
    return trend.length >= 3 && trend[trend.length - 1] < trend[0] - 10;
  });
  if (decliningMetrics.length > 0) {
    insights.push({
      icon: TrendingDown,
      title: `${decliningMetrics.length} Metric${decliningMetrics.length > 1 ? 's' : ''} Showing Downward Trend`,
      description: `${decliningMetrics.map(m => m.name).join(', ')} ${decliningMetrics.length > 1 ? 'have' : 'has'} declined by more than 10 points over recent measurements. Early intervention can prevent threshold breaches.`,
      priority: 'High',
      category: 'Trends',
      impact: 'Proactive action now can prevent future critical alerts.',
      action: 'Investigate root cause and consider adjusting process parameters or catalyst configurations.',
    });
  }

  // Process conformance issues
  const lowConformance = processes.filter(p => p.conformanceRate < 70);
  if (lowConformance.length > 0) {
    const avgConformance = Math.round(lowConformance.reduce((s, p) => s + p.conformanceRate, 0) / lowConformance.length);
    insights.push({
      icon: GitBranch,
      title: `Process Conformance Below Target (${lowConformance.length} process${lowConformance.length > 1 ? 'es' : ''})`,
      description: `${lowConformance.map(p => p.name).join(', ')} ${lowConformance.length > 1 ? 'are' : 'is'} operating below 70% conformance. This suggests workarounds, manual interventions, or training gaps.`,
      priority: 'High',
      category: 'Processes',
      impact: `Average conformance: ${avgConformance}% vs 85% target — indicates process deviation.`,
      action: 'Review process variants and enforce standard operating procedures. Consider additional user training.',
    });
  }

  // Critical anomalies
  const critAnomalies = anomalies.filter(a => a.severity === 'critical' && (a.status === 'open' || !a.status));
  if (critAnomalies.length > 0) {
    const avgDeviation = Math.round(critAnomalies.reduce((s, a) => s + a.deviation, 0) / critAnomalies.length);
    insights.push({
      icon: AlertTriangle,
      title: `${critAnomalies.length} Critical Anomalie${critAnomalies.length > 1 ? 's' : 'y'} Detected`,
      description: `Statistical anomalies detected in ${critAnomalies.map(a => a.metric).join(', ')}. These represent significant deviations from expected patterns that may indicate data quality issues, fraud, or system malfunctions.`,
      priority: 'Critical',
      category: 'Anomalies',
      impact: `Average deviation: ${avgDeviation}% from baseline — requires investigation.`,
      action: 'Investigate anomaly details and correlate with recent system changes or business events.',
    });
  }

  // Bottleneck identification
  const bottleneckProcesses = processes.filter(p => p.bottlenecks.length > 0); const bottleneckCount = bottleneckProcesses.reduce((s, p) => s + p.bottlenecks.length, 0);
  if (bottleneckCount > 0) {
    const affectedProcesses = bottleneckProcesses.map(p => p.name).join(", ");
    insights.push({
      icon: Activity,
      title: `${bottleneckCount} Process Bottleneck${bottleneckCount > 1 ? 's' : ''} Identified`,
      description: `Bottlenecks detected in ${affectedProcesses}. These steps are constraining throughput and increasing cycle time.`,
      priority: 'Medium',
      category: 'Processes',
      impact: 'Bottlenecks increase processing time and resource consumption.',
      action: 'Analyze bottleneck steps for automation opportunities or resource reallocation.',
    });
  }

  // Positive insights (when things are going well)
  if (redMetrics.length === 0 && decliningMetrics.length === 0 && critAnomalies.length === 0) {
    const healthyMetrics = metrics.filter(m => m.status === 'green');
    if (healthyMetrics.length >= metrics.length * 0.8 && metrics.length > 0) {
      insights.push({
        icon: CheckCircle2,
        title: 'Strong Operational Performance',
        description: `${healthyMetrics.length} of ${metrics.length} metrics (${Math.round(healthyMetrics.length / metrics.length * 100)}%) are within healthy thresholds. Your operational processes are performing well.`,
        priority: 'Low',
        category: 'Metrics',
        impact: 'Maintain current monitoring frequency and continue best practices.',
        action: 'Consider using this stable period for process optimization initiatives.',
      });
    }
  }

  return insights;
}

/* ── Narrative generator ─────────────────────────────────── */
function generateNarrative(metrics: Metric[], anomalies: AnomalyItem[], processes: ProcessItem[], summary: PulseSummary | null): string {
  const total = summary?.totalMetrics ?? metrics.length;
  const green = summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length;
  const amber = summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length;
  const red = summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length;
  const openAnomalies = anomalies.filter(a => a.status === 'open' || !a.status).length;
  const critAnomalies = anomalies.filter(a => a.severity === 'critical').length;
  const bottleneckCount = processes.reduce((s, p) => s + p.bottlenecks.length, 0);
  const avgConformance = processes.length > 0
    ? Math.round(processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length)
    : 0;

  if (total === 0) return 'No operational metrics are being tracked yet. Deploy a catalyst from the Catalysts page to start monitoring your business processes.';

  let narrative = `Atheon Pulse is monitoring ${total} operational metric${total > 1 ? 's' : ''} across your enterprise. `;

  if (red > 0) {
    narrative += `${red} metric${red > 1 ? 's are' : ' is'} in critical (red) status, requiring immediate attention. `;
  }
  if (amber > 0) {
    narrative += `${amber} metric${amber > 1 ? 's are' : ' is'} at warning (amber) level. `;
  }
  if (green > 0 && red === 0 && amber === 0) {
    narrative += `All metrics are within healthy thresholds — excellent operational performance. `;
  } else if (green > 0) {
    narrative += `${green} metric${green > 1 ? 's' : ''} remain${green === 1 ? 's' : ''} healthy. `;
  }

  if (openAnomalies > 0) {
    narrative += `\n\nAnomaly Detection has flagged ${openAnomalies} open anomal${openAnomalies > 1 ? 'ies' : 'y'}`;
    if (critAnomalies > 0) narrative += ` (${critAnomalies} critical)`;
    narrative += '. ';
  }

  if (processes.length > 0) {
    narrative += `\n\nProcess Mining is tracking ${processes.length} business process${processes.length > 1 ? 'es' : ''} with an average conformance rate of ${avgConformance}%. `;
    if (bottleneckCount > 0) {
      narrative += `${bottleneckCount} bottleneck${bottleneckCount > 1 ? 's have' : ' has'} been identified for optimisation. `;
    }
  }

  return narrative;
}

/* ════════════════════════════════════════════════════════════
   PULSE PAGE
   ════════════════════════════════════════════════════════════ */
export function PulsePage() {
  const industry = useAppStore((s) => s.industry);
  const companyId = useSelectedCompanyId();
  const toast = useToast();
  const { activeTab, setActiveTab } = useTabState('dashboard');

  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([]);
  const [summary, setSummary] = useState<PulseSummary | null>(null);
  // ISO timestamp of the last summary/metrics load — surfaced by MetricSource
  // popovers on the headline status-breakdown tiles so freshness is auditable.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Expandable states
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [expandedAnomaly, setExpandedAnomaly] = useState<string | null>(null);
  // §2.2.2 Anomaly detection — which sensitivity button is currently running
  const [detectingSensitivity, setDetectingSensitivity] = useState<AnomalySensitivity | null>(null);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [expandedCorrelation, setExpandedCorrelation] = useState<string | null>(null);

  // Filter states — §2.2.1 multi-select metric filtering
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<MetricStatus[]>([]);
  const [categoryFilter, setCategoryFilter] = useState<string[]>([]);
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');

  // Catalyst runs state
  const [catalystRuns, setCatalystRuns] = useState<CatalystRunItem[]>([]);
  const [catalystSummary, setCatalystSummary] = useState<CatalystRunSummary[]>([]);
  const [catalystFilter, setCatalystFilter] = useState<string>('all');
  const [expandedRun, setExpandedRun] = useState<string | null>(null);
  const [runsLoading, setRunsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // AI Insights state
  const [aiInsights, setAiInsights] = useState<PulseInsightsResponse | null>(null);
  const [aiInsightsLoading, setAiInsightsLoading] = useState(false);

  // Diagnostics state
  const [diagSummary, setDiagSummary] = useState<DiagnosticSummaryResponse | null>(null);
  const [diagAnalyses, setDiagAnalyses] = useState<DiagnosticAnalysisItem[]>([]);
  const [diagDetail, setDiagDetail] = useState<DiagnosticAnalysisDetail | null>(null);
  const [diagLoading, setDiagLoading] = useState(false);
  const [diagError, setDiagError] = useState<string | null>(null);

  // §11.5 Cost of Inaction state
  const [costOfInaction, setCostOfInaction] = useState<CostOfInactionResponse | null>(null);
  const [coiLoading, setCoiLoading] = useState(false);
  const [analysingMetric, setAnalysingMetric] = useState<string | null>(null);
  const [expandedAnalysis, setExpandedAnalysis] = useState<string | null>(null);

  const loadDiagnostics = async () => {
    setDiagLoading(true);
    setDiagError(null);
    try {
      const [s, a] = await Promise.allSettled([
        api.diagnostics.getSummary(),
        api.diagnostics.getAnalyses(),
      ]);
      if (s.status === 'fulfilled') setDiagSummary(s.value);
      if (a.status === 'fulfilled') setDiagAnalyses(a.value.analyses);
      // Both calls rejecting is a real failure — show the user, not just the console.
      if (s.status === 'rejected' && a.status === 'rejected') {
        const reason = s.reason instanceof Error ? s.reason.message
          : a.reason instanceof Error ? a.reason.message
          : 'Failed to load diagnostics';
        setDiagError(reason);
        console.error('Failed to load diagnostics:', s.reason, a.reason);
      }
    } catch (err) {
      setDiagError(err instanceof Error ? err.message : 'Failed to load diagnostics');
      console.error('Failed to load diagnostics:', err);
    }
    setDiagLoading(false);
  };

  const handleAnalyseMetric = async (metricId: string) => {
    if (analysingMetric) return;
    setAnalysingMetric(metricId);
    try {
      const result = await api.diagnostics.analyseMetric(metricId);
      setDiagDetail(result);
      loadDiagnostics();
    } catch (err) { console.error('Failed to analyse metric:', err); }
    setAnalysingMetric(null);
  };

  const handleViewAnalysis = async (analysisId: string) => {
    try {
      const detail = await api.diagnostics.getAnalysis(analysisId);
      setDiagDetail(detail);
    } catch (err) { console.error('Failed to load analysis:', err); }
  };
  const [domainFilter, setDomainFilter] = useState<string>('all');
  const [availableDomains, setAvailableDomains] = useState<string[]>([]);

  // Traceability modal state
  const [showMetricTraceModal, setShowMetricTraceModal] = useState(false);
  const [metricTraceData, setMetricTraceData] = useState<MetricTraceResponse | null>(null);
  const [, setLoadingMetricTrace] = useState(false);
  // Dimension trace state
  const [showDimTraceModal, setShowDimTraceModal] = useState(false);
  const [dimTraceData, setDimTraceData] = useState<HealthDimensionTraceResponse | null>(null);
  const [, setLoadingDimTrace] = useState(false);

  // Load AI insights
  const loadAiInsights = async (domain?: string) => {
    setAiInsightsLoading(true);
    try {
      const result = await api.pulse.insights(domain && domain !== 'all' ? domain : undefined, undefined, companyId || undefined);
      setAiInsights(result);
    } catch (err) { console.error('Failed to load AI insights:', err); }
    setAiInsightsLoading(false);
  };

  // Load domains on mount
  useEffect(() => {
    api.pulse.domains().then(d => setAvailableDomains(d.domains || [])).catch((err) => { 
      console.error('Failed to load domains', err);
      // Non-critical -不影响主要功能 - silently fail but log for debugging
    });
  }, []);

  const handleOpenMetricTrace = async (metricId: string) => {
    setLoadingMetricTrace(true);
    try {
      const data = await api.pulse.metricTrace(metricId, undefined, companyId || undefined);
      if (!data || !data.metric) {
        console.warn('No traceability data available for metric:', metricId);
        setActionError('No traceability data available for this metric.');
        return;
      }
      setMetricTraceData(data);
      setShowMetricTraceModal(true);
    } catch (err) {
      console.error('Failed to load metric traceability:', err);
      setActionError('Failed to load metric traceability data. This metric may not have source attribution yet.');
    } finally {
      setLoadingMetricTrace(false);
    }
  };

  // Map Pulse client-side dimension keys to valid Apex server dimension keys
  const pulseDimToApexDim: Record<string, string> = {
    'Metric Health': 'operational',
    'Process Conformance': 'process',
    'Anomaly Pressure': 'risk',
    'Process Efficiency': 'process',
  };

  const handleOpenDimensionTrace = async (dimension: string) => {
    const apexDimension = pulseDimToApexDim[dimension] || dimension;
    setLoadingDimTrace(true);
    try {
      const data = await api.apex.healthDimension(apexDimension, undefined, companyId || undefined);
      if (!data || data.score === null) {
        setActionError('No traceability data available yet. Run a catalyst in this domain to generate health data.');
        return;
      }
      setDimTraceData(data);
      setShowDimTraceModal(true);
    } catch (err) {
      console.error('Failed to load dimension traceability', err);
      setActionError('Failed to load traceability data. Please ensure catalysts have been run for this domain.');
    } finally {
      setLoadingDimTrace(false);
    }
  };


  /**
   * §2.2.2 — Trigger ML anomaly re-detection at a chosen sensitivity.
   * Uses the typed api client (threads companyId & X-Request-ID) and surfaces
   * outcomes via toast, including the request-id on error for support.
   */
  async function handleDetectAnomalies(sensitivity: AnomalySensitivity) {
    if (detectingSensitivity) return;
    setDetectingSensitivity(sensitivity);
    try {
      const result = await api.pulse.detectAnomalies(
        undefined,
        sensitivity,
        undefined,
        companyId || undefined,
      );
      const count = typeof result?.count === 'number' ? result.count : 0;
      toast.success(
        count === 0 ? 'No anomalies detected' : `Detected ${count} anomal${count === 1 ? 'y' : 'ies'}`,
        count === 0
          ? `No metrics exceeded the ${sensitivity}-sensitivity Z-score threshold.`
          : `Sensitivity: ${sensitivity}. Reloading the anomaly list…`,
      );
      // Refresh the anomalies list after a successful detection run
      const ind = industry !== 'general' ? industry : undefined;
      const a = await api.pulse.anomalies(undefined, ind, companyId || undefined);
      setAnomalies(a.anomalies);
    } catch (err) {
      console.error('ML detection failed:', err);
      const message = err instanceof Error ? err.message : 'Unexpected error';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Failed to detect anomalies', { message, requestId });
    } finally {
      setDetectingSensitivity(null);
    }
  }

  // Pulse anomaly actions — the "Recommended Next Steps" buttons on the
  // expanded anomaly card. Every one of these must DO something real so the
  // queue stays trustworthy on a customer demo.
  const [anomalyActionPending, setAnomalyActionPending] = useState<string | null>(null);
  async function handleAnomalyStatus(anomalyId: string, status: 'investigating' | 'resolved', label: string) {
    if (anomalyActionPending) return;
    setAnomalyActionPending(`${anomalyId}:${status}`);
    try {
      await api.pulse.updateAnomalyStatus(anomalyId, status);
      const ind = industry !== 'general' ? industry : undefined;
      const a = await api.pulse.anomalies(undefined, ind, companyId || undefined);
      setAnomalies(a.anomalies);
      toast.success(label, status === 'investigating'
        ? 'Anomaly opened for investigation; tracked in the queue until resolved.'
        : 'Anomaly closed; outcome recorded in the audit trail.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Action failed', { message, requestId });
    } finally {
      setAnomalyActionPending(null);
    }
  }
  async function handleAnomalyRerun(anomalyId: string) {
    if (anomalyActionPending) return;
    setAnomalyActionPending(`${anomalyId}:rerun`);
    try {
      const result = await api.pulse.detectAnomalies(undefined, 'high', undefined, companyId || undefined);
      const ind = industry !== 'general' ? industry : undefined;
      const a = await api.pulse.anomalies(undefined, ind, companyId || undefined);
      setAnomalies(a.anomalies);
      const count = typeof result?.count === 'number' ? result.count : 0;
      toast.success('Data quality re-checked', `Z-score sweep at high sensitivity completed; ${count} anomal${count === 1 ? 'y' : 'ies'} flagged.`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Re-check failed', { message, requestId });
    } finally {
      setAnomalyActionPending(null);
    }
  }

  // Red-metric "Run Catalyst" — triggers the Pulse refresh which fans out
  // catalysts across all clusters and re-evaluates the metric status.
  const [refreshingMetric, setRefreshingMetric] = useState<string | null>(null);
  async function handleRefreshForMetric(metricId: string, metricName: string) {
    if (refreshingMetric) return;
    setRefreshingMetric(metricId);
    try {
      await api.pulse.refresh(undefined, companyId || undefined);
      const ind = industry !== 'general' ? industry : undefined;
      const [m, s] = await Promise.all([
        api.pulse.metrics(undefined, ind, companyId || undefined),
        api.pulse.summary(undefined, ind, companyId || undefined),
      ]);
      setMetrics(m.metrics);
      setSummary(s);
      toast.success(`Catalysts run for ${metricName}`, 'Process flows + metrics refreshed; check the trace popover for new evidence.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unexpected error';
      const requestId = err instanceof ApiError ? err.requestId : null;
      toast.error('Catalyst run failed', { message, requestId });
    } finally {
      setRefreshingMetric(null);
    }
  }

  useEffect(() => {
    async function load() {
      setLoading(true);
      const ind = industry !== 'general' ? industry : undefined;
      const co = companyId || undefined;
      const [m, a, p, cor, s] = await Promise.allSettled([
        api.pulse.metrics(undefined, ind, co),
        api.pulse.anomalies(undefined, ind, co),
        api.pulse.processes(undefined, ind, co),
        api.pulse.correlations(undefined, ind, co),
        api.pulse.summary(undefined, ind, co),
      ]);
      if (m.status === 'fulfilled') setMetrics(m.value.metrics);
      if (a.status === 'fulfilled') setAnomalies(a.value.anomalies);
      if (cor.status === 'fulfilled') setCorrelations(cor.value.correlations);
      if (s.status === 'fulfilled') setSummary(s.value);
      setLoadedAt(new Date().toISOString());

      // Auto-refresh process mining from catalyst runs if no processes exist yet
      const hasProcesses = p.status === 'fulfilled' && p.value.processes.length > 0;
      if (hasProcesses) {
        setProcesses(p.value.processes);
      } else {
        try {
          const refreshResult = await api.pulse.refresh(undefined, co);
          if (refreshResult.refreshed) {
            // Re-fetch processes and metrics after refresh
            const [newP, newM, newS] = await Promise.allSettled([
              api.pulse.processes(undefined, ind, co),
              api.pulse.metrics(undefined, ind, co),
              api.pulse.summary(undefined, ind, co),
            ]);
            if (newP.status === 'fulfilled') setProcesses(newP.value.processes);
            if (newM.status === 'fulfilled') setMetrics(newM.value.metrics);
            if (newS.status === 'fulfilled') setSummary(newS.value);
          }
        } catch (err) { console.error('Pulse auto-refresh failed', err); }
      }

      setLoading(false);
    }
    load();
  }, [industry, companyId]);

  const health = computeOperationalHealth(metrics, summary, anomalies, processes);
  const insights = generateInsights(metrics, anomalies, processes, summary);
  const narrative = generateNarrative(metrics, anomalies, processes, summary);
  const dimensions = Object.entries(health.dimensions).map(([key, val]) => ({
    key, name: key,
    score: val.score, trend: val.trend,
    change: val.delta,
    sparkline: [],
  }));

  // Derive available categories from metrics.sourceSystem for the category filter
  const availableCategories = Array.from(
    new Set(metrics.map(m => m.sourceSystem).filter((s): s is string => !!s && s.length > 0))
  ).sort();

  // Filtered metrics — §2.2.1: multi-select status + category + case-insensitive
  // substring search. Empty filter arrays behave as "all".
  // Dynamic Layout: red first, then amber, then green.
  const statusPriority: Record<string, number> = { red: 0, amber: 1, green: 2 };
  const normalisedSearch = searchQuery.trim().toLowerCase();
  const filteredMetrics = metrics
    .filter(m => statusFilter.length === 0 || statusFilter.includes(m.status as MetricStatus))
    .filter(m => categoryFilter.length === 0 || (m.sourceSystem && categoryFilter.includes(m.sourceSystem)))
    .filter(m => !normalisedSearch || m.name.toLowerCase().includes(normalisedSearch))
    .sort((a, b) => (statusPriority[a.status] ?? 3) - (statusPriority[b.status] ?? 3));

  // Filtered anomalies
  const filteredAnomalies = anomalies
    .filter(a => anomalyFilter === 'all' || a.severity === anomalyFilter);

  // Load catalyst runs when tab is selected
  useEffect(() => {
    if (activeTab !== 'catalyst-runs') return;
    async function loadRuns() {
      setRunsLoading(true);
      try {
        const filterParam = catalystFilter !== 'all' ? catalystFilter : undefined;
        const data = await api.pulse.catalystRuns(undefined, filterParam, companyId || undefined);
        setCatalystRuns(data.runs);
        setCatalystSummary(data.summary);
      } catch (err) { console.error('Failed to load catalyst runs', err); }
      setRunsLoading(false);
    }
    loadRuns();
  }, [activeTab, catalystFilter, companyId]);

  // Auto-load diagnostics on tab open — silent failure was confusing users
  // (the tab rendered a "no data yet" message even when the API errored).
  useEffect(() => {
    if (activeTab !== 'diagnostics') return;
    if (diagSummary || diagLoading) return;
    loadDiagnostics();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  const handleManualRefresh = async () => {
    setRefreshing(true);
    try {
      const co = companyId || undefined;
      await api.pulse.refresh(undefined, co);
      const ind = industry !== 'general' ? industry : undefined;
      const [newP, newM, newS] = await Promise.allSettled([
        api.pulse.processes(undefined, ind, co),
        api.pulse.metrics(undefined, ind, co),
        api.pulse.summary(undefined, ind, co),
      ]);
      if (newP.status === 'fulfilled') setProcesses(newP.value.processes);
      if (newM.status === 'fulfilled') setMetrics(newM.value.metrics);
      if (newS.status === 'fulfilled') setSummary(newS.value);
      // Also refresh catalyst runs if on that tab
      if (activeTab === 'catalyst-runs') {
        const filterParam = catalystFilter !== 'all' ? catalystFilter : undefined;
        const data = await api.pulse.catalystRuns(undefined, filterParam, co);
        setCatalystRuns(data.runs);
        setCatalystSummary(data.summary);
      }
    } catch (err) { console.error('Manual refresh failed', err); }
    setRefreshing(false);
  };

  const tabs = [
    { id: 'dashboard', label: 'Overview', icon: <Gauge size={14} /> },
    { id: 'monitoring', label: 'Metrics', icon: <Activity size={14} />, count: metrics.length || undefined },
    { id: 'diagnostics', label: 'Diagnostics', icon: <Stethoscope size={14} />, count: diagSummary?.criticalFindings || undefined },
    { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={14} />, count: anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length || undefined },
    { id: 'processes', label: 'Processes', icon: <GitBranch size={14} /> },
    { id: 'correlations', label: 'Correlations', icon: <Link2 size={14} /> },
    { id: 'cost-of-inaction', label: 'Cost of Inaction', icon: <DollarSign size={14} /> },
  ];

  const pageHeader = (
    <HeroHeader
      icon={Activity}
      title="Pulse"
      subtitle="Process Intelligence & Anomaly Detection"
      accent="sky"
      trailing={<SectionFreshness section="Diagnostics" />}
    />
  );

  if (loading) {
    return (
      <div className="space-y-6 animate-fadeIn">
        {pageHeader}
        <LoadingState variant="cards" count={4} />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <SharedSavingsStrip />
      {/* Header */}
      <div className="space-y-4">
        {pageHeader}
        <div className="flex items-center justify-end">
          <CSVExportButton endpoint="/api/diagnostics" filename="pulse-diagnostics.csv" label="Export Diagnostics" />
        </div>
      </div>

      {actionError && (
        <div className="flex items-center gap-3 p-3 bg-amber-500/10 border border-amber-500/20 rounded-xl">
          <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />
          <p className="text-sm text-amber-400 flex-1">{actionError}</p>
          <button onClick={() => setActionError(null)} className="text-amber-400 hover:text-amber-300" title="Dismiss"><X size={14} /></button>
        </div>
      )}

      {/* v63 — operational view of the write-back action queue.
          Shows recent activity + lets the operator approve/reject inline. */}
      <ActionQueuePanel variant="operational" allowApprove limit={20} />


      {/* Department Filter */}
      {availableDomains.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs t-muted font-medium">Department:</span>
          <div className="flex items-center gap-1 flex-wrap">
            <button
              onClick={() => setDomainFilter('all')}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all ${domainFilter === 'all' ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted hover:t-primary'}`}
            >All</button>
            {availableDomains.map(d => (
              <button
                key={d}
                onClick={() => setDomainFilter(d)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-all capitalize ${domainFilter === d ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted hover:t-primary'}`}
              >{d}</button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-3">
        <div className="flex-1 overflow-x-auto">
          <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
        </div>
        <button
          onClick={() => loadAiInsights(domainFilter)}
          disabled={aiInsightsLoading}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-all disabled:opacity-50 flex-shrink-0"
          title="Generate AI-powered operational insights"
        >
          <Lightbulb size={12} className={aiInsightsLoading ? 'animate-pulse' : ''} />
          {aiInsightsLoading ? 'Analyzing...' : 'AI Insights'}
        </button>
        <button
          onClick={handleManualRefresh}
          disabled={refreshing}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-all disabled:opacity-50 flex-shrink-0"
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh Mining'}
        </button>
      </div>

      {/* AI Insights Panel */}
      {aiInsights && (
        <Card className="border-purple-500/20 bg-purple-500/5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Lightbulb size={16} className="text-purple-400" />
              <h3 className="text-sm font-semibold t-primary">Atheon Intelligence — Operational Insights</h3>
              {aiInsights.domain !== 'all' && <Badge variant="info" size="sm">{aiInsights.domain}</Badge>}
            </div>
            <span className="text-caption t-muted">{aiInsights.poweredBy}</span>
          </div>
          <p className="text-sm t-secondary mb-3 whitespace-pre-line">{cleanLlmText(aiInsights.insights)}</p>
          {aiInsights.recommendations.length > 0 && (
            <div className="mb-3">
              <p className="text-xs font-medium t-primary mb-1.5">Recommendations</p>
              <ul className="space-y-1">
                {aiInsights.recommendations.map((rec, i) => (
                  <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
                    <ArrowRight size={10} className="text-purple-400 mt-0.5 flex-shrink-0" />
                    {rec}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {aiInsights.drivers.length > 0 && (
            <div>
              <p className="text-xs font-medium t-primary mb-1.5">Insight Drivers (Traceability)</p>
              <div className="flex flex-wrap gap-1.5">
                {aiInsights.drivers.map((driver, i) => (
                  <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] text-caption t-muted border border-[var(--border-card)]">
                    <Eye size={8} /> {driver.source}: {driver.metric || driver.description || driver.type}
                  </span>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 1: Operations Dashboard
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'dashboard' && (
        <TabPanel>
          {/*
            Action Required strip — surfaces urgency above the metrics grid
            so an operator landing on Pulse sees what needs attention before
            they scroll. Each item links to the relevant tab so deep-dive is
            one click. Hidden when nothing is actionable (avoids empty noise).
          */}
          <PulseActionRequired
            metrics={metrics}
            anomalies={anomalies}
            processes={processes}
            onJumpToTab={setActiveTab}
          />

          {/* TASK-002: Decomposed MetricsGrid sub-component for compact overview */}
          <MetricsGrid metrics={filteredMetrics} />

          {/* Top Row: Status Strip + Dimensions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card variant="black" className="lg:col-span-1 flex flex-col items-center justify-center">
              {/* Pulse Status Strip (visual differentiation from Apex ring) */}
              <p className="text-label mb-2">Operational Health</p>
              <p className="text-3xl font-bold t-primary mb-3">{health.score}<span className="text-sm font-normal t-muted">/100</span></p>
              <div className="w-full h-3 rounded-full overflow-hidden flex" title={`Green: ${summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length} | Amber: ${summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length} | Red: ${summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length}`}>
                {(() => {
                  const green = summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length;
                  const amber = summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length;
                  const red = summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length;
                  const total = green + amber + red || 1;
                  return (
                    <>
                      <div className="bg-emerald-500 h-full" style={{ width: `${(green / total) * 100}%` }} />
                      <div className="bg-amber-500 h-full" style={{ width: `${(amber / total) * 100}%` }} />
                      <div className="bg-red-500 h-full" style={{ width: `${(red / total) * 100}%` }} />
                    </>
                  );
                })()}
              </div>
              <div className="flex items-center justify-between w-full mt-2 text-caption">
                <span className="text-emerald-400">{summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length} green</span>
                <span className="text-amber-400">{summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length} amber</span>
                <span className="text-red-400">{summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length} red</span>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {trendIcon(health.trend)}
                <span className={`text-sm ${health.trend === 'improving' ? 'text-emerald-400' : health.trend === 'declining' ? 'text-red-400' : 'text-gray-400'}`}>
                  {health.trend === 'improving' ? 'Improving' : health.trend === 'declining' ? 'Needs Attention' : 'Stable'}
                </span>
              </div>
              {health.score === 0 && (
                <p className="text-xs t-muted mt-4 text-center">No health data yet. Run a catalyst to populate metrics.</p>
              )}
              <div className="mt-3 pt-2 border-t border-[var(--border-card)] w-full space-y-1.5">
                {Object.entries(health.dimensions).slice(0, 4).map(([name, dim]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="text-caption t-secondary w-24 truncate">{name}</span>
                    <div className="flex-1">
                      <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="sm" />
                    </div>
                    <span className="text-caption font-bold t-primary w-6 text-right">{dim.score}</span>
                  </div>
                ))}
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <h3 className="text-lg font-semibold t-primary mb-4">Operational Dimensions</h3>
              {dimensions.length === 0 || health.score === 0 ? (
                <div className="flex items-center gap-3 py-6 px-4">
                  <Gauge className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
                  <p className="text-sm t-muted">No dimensions available yet</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dimensions.map((dim) => (
                    <div key={dim.key} className="group flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                      <div className="sm:w-44 flex-shrink-0">
                        <span className="text-sm t-secondary">{dim.name}</span>
                      </div>
                      <div className="flex-1">
                        <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="md" />
                      </div>
                      <div className="flex items-center gap-3 sm:gap-0">
                        <div className="w-12 text-right">
                          <span className="text-sm font-bold t-primary">{dim.score}</span>
                        </div>
                        <div className="flex items-center gap-1 w-20">
                          {trendIcon(dim.trend, 12)}
                          <span className={`text-xs ${dim.trend === 'improving' ? 'text-emerald-400' : dim.trend === 'declining' ? 'text-red-400' : 'text-gray-400'}`}>
                            {dim.trend === 'improving' ? 'Up' : dim.trend === 'declining' ? 'Down' : 'Stable'}
                          </span>
                        </div>
                        <Sparkline data={dim.sparkline} width={60} height={20} color={dim.trend === 'improving' ? '#10b981' : dim.trend === 'declining' ? '#ef4444' : '#6b7280'} />
                        <button
                          onClick={() => handleOpenDimensionTrace(dim.key)}
                          className="opacity-0 group-hover:opacity-100 text-caption text-accent hover:text-accent/80 flex items-center gap-0.5 transition-all ml-2"
                          title={`Trace ${dim.name}`}
                        >
                          <Eye size={10} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Status Breakdown — Stitch hover-tint bento with Numeric.
              Each tile carries a MetricSource so the operator can audit
              which endpoint + threshold yielded the count. */}
          {(() => {
            const totalMetrics = summary?.totalMetrics ?? metrics.length;
            const green = summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length;
            const amber = summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length;
            const red   = summary?.statusBreakdown?.red   ?? metrics.filter(m => m.status === 'red').length;
            const baseProvenance: Partial<MetricProvenance> = {
              table: 'pulse_metrics',
              endpoint: 'GET /api/pulse/summary',
              window: 'Latest snapshot',
              refreshedAt: loadedAt,
            };
            return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption uppercase tracking-wider t-muted">Total Metrics</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Total metrics',
                    definition: 'Distinct business metrics Pulse is computing for this tenant — KPIs ingested from connectors plus catalyst-produced metrics.',
                    query: 'COUNT(DISTINCT metric_name) FROM pulse_metrics WHERE tenant_id = ?',
                    sample: totalMetrics,
                  }} />
                  <Activity size={14} className="text-accent" />
                </div>
              </div>
              <Numeric value={totalMetrics} size="lg" />
              <div className="mt-3 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {metrics.slice(0, 3).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{m.name}</span>
                    <span className={`font-medium font-mono ${statusColor(m.status)}`}>{formatMetricValue(m.value, m.unit)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-emerald-500/40 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption uppercase tracking-wider t-muted">Healthy</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Healthy metrics',
                    definition: 'Metrics whose latest reading is within the configured healthy band (status = green).',
                    query: "COUNT(*) FROM pulse_metrics WHERE tenant_id = ? AND status = 'green'",
                    sample: green,
                    notes: [{ label: 'Threshold', value: 'status = green' }],
                  }} />
                  <CheckCircle2 size={14} className="text-emerald-400" />
                </div>
              </div>
              <p className="text-headline-lg font-bold text-emerald-400 tabular-nums font-mono">
                <Numeric value={green} size="lg" />
              </p>
              <div className="mt-3 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {metrics.filter(m => m.status === 'green').slice(0, 3).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{m.name}</span>
                    <span className="font-medium font-mono text-emerald-400">{formatMetricValue(m.value, m.unit)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-amber-500/40 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption uppercase tracking-wider t-muted">Warning</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Warning metrics',
                    definition: 'Metrics whose latest reading falls in the warning band (status = amber). Trending toward critical but not yet breached.',
                    query: "COUNT(*) FROM pulse_metrics WHERE tenant_id = ? AND status = 'amber'",
                    sample: amber,
                    notes: [{ label: 'Threshold', value: 'status = amber' }],
                  }} />
                  <AlertTriangle size={14} className="text-amber-400" />
                </div>
              </div>
              <p className="text-headline-lg font-bold text-amber-400 tabular-nums font-mono">
                <Numeric value={amber} size="lg" />
              </p>
              <div className="mt-3 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {metrics.filter(m => m.status === 'amber').slice(0, 3).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{m.name}</span>
                    <span className="font-medium font-mono text-amber-400">{formatMetricValue(m.value, m.unit)}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-red-500/40 transition-colors h-full">
              <div className="flex items-center justify-between mb-2">
                <span className="text-caption uppercase tracking-wider t-muted">Critical</span>
                <div className="flex items-center gap-1">
                  <MetricSource source={{
                    ...baseProvenance,
                    label: 'Critical metrics',
                    definition: 'Metrics whose latest reading has breached the critical threshold (status = red). These force operator review.',
                    query: "COUNT(*) FROM pulse_metrics WHERE tenant_id = ? AND status = 'red'",
                    sample: red,
                    notes: [{ label: 'Threshold', value: 'status = red' }],
                  }} />
                  <XCircle size={14} className="text-red-400" />
                </div>
              </div>
              <p className="text-headline-lg font-bold text-red-400 tabular-nums font-mono">
                <Numeric value={red} size="lg" />
              </p>
              <div className="mt-3 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
                {metrics.filter(m => m.status === 'red').slice(0, 3).map((m, i) => (
                  <div key={i} className="flex items-center justify-between text-caption">
                    <span className="t-secondary truncate mr-2">{m.name}</span>
                    <span className="font-medium font-mono text-red-400">{formatMetricValue(m.value, m.unit)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
            );
          })()}

          {/* Narrative + Insights */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Operational Narrative */}
            <Card variant="black">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-accent" />
                <h3 className="text-lg font-semibold">Operational Summary</h3>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>
                {narrative}
              </p>
            </Card>

            {/* Insights */}
            <Card>
              <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-emerald-400" /> Insights
              </h3>
              <div className="space-y-2.5">
                {insights.map((insight, i) => {
                  const Icon = insight.icon;
                  return (
                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium t-primary flex items-center gap-1.5">
                            <Icon size={12} className="text-accent flex-shrink-0" />
                            {insight.title}
                          </span>
                        </div>
                        <p className="text-xs t-muted mt-0.5">{insight.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-caption t-muted">Priority: {insight.priority}</span>
                          <span className="text-caption t-muted">|</span>
                          <span className="text-caption t-muted">{insight.category}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </Card>
          </div>
        </TabPanel>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 2: Live Monitoring
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'monitoring' && (
        <TabPanel>
          {/* §2.2.1 Metric Filter Bar — search + multi-select status + category */}
          <MetricFilterBar
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            statusFilter={statusFilter}
            onStatusFilterChange={setStatusFilter}
            categoryFilter={categoryFilter}
            onCategoryFilterChange={setCategoryFilter}
            availableCategories={availableCategories}
            resultCount={filteredMetrics.length}
            totalCount={metrics.length}
          />

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMetrics.length === 0 && (
              <div className="col-span-full flex items-center gap-3 py-6 px-4">
                <Activity className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
                <p className="text-sm t-muted">
                  {metrics.length === 0
                    ? 'No metrics available yet'
                    : 'No metrics match the current filters'}
                </p>
              </div>
            )}
            {filteredMetrics.map((metric) => {
              const isExpanded = expandedMetric === metric.id;
              return (
                <Card
                  key={metric.id}
                  hover
                  onClick={() => setExpandedMetric(isExpanded ? null : metric.id)}
                  className={`group ${isExpanded ? 'border-accent/20 col-span-1 md:col-span-2 lg:col-span-3' : ''}`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-secondary truncate flex-1">{metric.name}</span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleOpenMetricTrace(metric.id); }}
                        className="opacity-0 group-hover:opacity-100 text-accent hover:text-accent/80 transition-all"
                        title="Trace to source"
                      >
                        <Link2 size={12} />
                      </button>
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                      }`} />
                      {isExpanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                    </div>
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <span className={`text-2xl font-bold ${statusColor(metric.status)}`}>{formatMetricValue(metric.value, metric.unit)}</span>
                      <span className="text-sm t-secondary ml-1">{metric.unit}</span>
                    </div>
                    <Sparkline
                      data={metric.trend || []}
                      width={80}
                      height={30}
                      color={metric.status === 'green' ? '#10b981' : metric.status === 'amber' ? '#f59e0b' : '#ef4444'}
                    />
                  </div>

                  <div className="mt-3">
                    <div className="flex items-center justify-between text-caption t-muted mb-1">
                      <span>Threshold</span>
                      <span className="text-emerald-500">{metric.thresholds?.green ?? 'N/A'} (green)</span>
                    </div>
                    <Progress
                      value={metric.value}
                      max={(metric.thresholds?.red ?? metric.value) * 1.2}
                      color={metric.status === 'green' ? 'emerald' : metric.status === 'amber' ? 'amber' : 'red'}
                      size="sm"
                    />
                  </div>

                  {/* Expanded Detail */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-[var(--border-card)] space-y-4 animate-fadeIn">
                      {/* Threshold Breakdown */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <Gauge className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Metric Analysis</h4>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Current Value</span>
                            <p className={`text-lg font-bold mt-0.5 ${statusColor(metric.status)}`}>{formatMetricValue(metric.value, metric.unit)}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Green Threshold</span>
                            <p className="text-lg font-bold text-emerald-400 mt-0.5">{metric.thresholds?.green ?? '\u2014'}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Amber Threshold</span>
                            <p className="text-lg font-bold text-amber-400 mt-0.5">{metric.thresholds?.amber ?? '\u2014'}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Red Threshold</span>
                            <p className="text-lg font-bold text-red-400 mt-0.5">{metric.thresholds?.red ?? '\u2014'}</p>
                          </div>
                        </div>

                        {/* Status Gauge */}
                        <div className="mb-4">
                          <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Status Gauge</h5>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card-solid)' }}>
                              <div className="h-full rounded-full transition-all duration-700" style={{
                                width: `${Math.min(100, (metric.value / ((metric.thresholds?.red ?? metric.value) * 1.2)) * 100)}%`,
                                background: metric.status === 'red' ? 'linear-gradient(90deg, #ef4444, #dc2626)' : metric.status === 'amber' ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, #10b981, #059669)',
                              }} />
                            </div>
                            <span className="text-xs font-bold t-primary w-16 text-right">{formatMetricValue(metric.value, metric.unit)}</span>
                          </div>
                        </div>

                        {/* Trend Analysis */}
                        {metric.trend && metric.trend.length > 1 && (
                          <div className="mb-4">
                            <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Trend (Recent Readings)</h5>
                            <div className="flex items-center gap-2">
                              <Sparkline data={metric.trend} width={200} height={40} color={metric.status === 'green' ? '#10b981' : metric.status === 'amber' ? '#f59e0b' : '#ef4444'} />
                              <div className="text-xs t-muted">
                                <p>Min: {Math.min(...metric.trend)}</p>
                                <p>Max: {Math.max(...metric.trend)}</p>
                                <p>Avg: {Math.round(metric.trend.reduce((a, b) => a + b, 0) / metric.trend.length)}</p>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Source & Timing */}
                        <div className="flex items-center gap-4 text-caption t-muted">
                          {metric.sourceSystem && <span>Source: {metric.sourceSystem}</span>}
                          {metric.measuredAt && <span>Last measured: {new Date(metric.measuredAt).toLocaleString()}</span>}
                        </div>

                        {/* P1-3 / A4-2: Source Attribution — clickable link to CatalystsPage ops panel */}
                        {metric.subCatalystName && metric.clusterId && (
                          <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                            <button
                              onClick={(e) => { e.stopPropagation(); window.location.href = `/catalysts?cluster=${metric.clusterId}&sub=${encodeURIComponent(metric.subCatalystName!)}&ops=1`; }}
                              className="flex items-center gap-2 text-xs text-accent hover:text-accent/80 transition-colors"
                            >
                              <Link2 size={12} />
                              <span>Source: <span className="font-medium">{metric.subCatalystName}</span></span>
                              {metric.sourceRunId && <span className="t-muted">· Run {metric.sourceRunId.slice(0, 8)}</span>}
                              <ArrowRight size={10} />
                            </button>
                          </div>
                        )}
                      </div>

                      {/* What This Means — for red/amber metrics, surfaces a
                          Run Catalyst button that triggers the full pulse
                          refresh (catalysts re-run, metrics re-evaluated). */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">What This Means</h4>
                        </div>
                        <p className="text-sm t-muted leading-relaxed">
                          <span className="font-medium t-primary">{metric.name}</span> is currently at{' '}
                          <span className={`font-medium ${statusColor(metric.status)}`}>{formatMetricValue(metric.value, metric.unit)}</span>
                          {metric.status === 'green' && ', which is within healthy operational parameters. Continue monitoring to maintain this performance.'}
                          {metric.status === 'amber' && '. This is approaching warning levels — consider proactive investigation to prevent escalation to critical status.'}
                          {metric.status === 'red' && '. This has breached the critical threshold and requires immediate attention. Investigate root cause and implement corrective action.'}
                        </p>
                        {(metric.status === 'red' || metric.status === 'amber') && (
                          <div className="mt-3 flex items-center gap-2 flex-wrap">
                            <Button
                              size="sm"
                              variant="primary"
                              disabled={refreshingMetric !== null}
                              onClick={(e) => { e.stopPropagation(); handleRefreshForMetric(metric.id, metric.name); }}
                              aria-label={`Run catalyst for ${metric.name}`}
                            >
                              {refreshingMetric === metric.id ? (
                                <Loader2 size={12} className="animate-spin" />
                              ) : (
                                <Play size={12} />
                              )}
                              {refreshingMetric === metric.id ? 'Running…' : 'Run Catalyst'}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={(e) => { e.stopPropagation(); handleOpenMetricTrace(metric.id); }}
                              aria-label={`Open trace for ${metric.name}`}
                            >
                              <Eye size={12} />
                              Open Trace
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 3: Anomaly Detection
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'anomalies' && (
        <TabPanel>
          {/* §2.2.2 Anomaly Detection Controls — Low / Medium / High sensitivity */}
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold t-primary">Anomaly Detection</h3>
          </div>
          <AnomalyDetectionControls
            onDetect={handleDetectAnomalies}
            runningSensitivity={detectingSensitivity}
          />

          {/* TASK-002: Decomposed AnomalyList sub-component for compact view */}
          <AnomalyList anomalies={filteredAnomalies} />

          {/* Anomaly Severity Filter */}
          <div className="flex items-center gap-2 mb-4">
            <Filter size={14} className="text-gray-400" />
            {(['all', 'critical', 'high', 'medium', 'low'] as const).map(f => (
              <button
                key={f}
                onClick={() => setAnomalyFilter(f)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  anomalyFilter === f
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400'
                }`}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
              </button>
            ))}
            <span className="text-xs t-muted ml-auto">{filteredAnomalies.length} anomal{filteredAnomalies.length !== 1 ? 'ies' : 'y'}</span>
          </div>

          <div className="space-y-4">
            {filteredAnomalies.length === 0 && (
              <div className="flex items-center gap-3 py-6 px-4">
                <AlertTriangle className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
                <p className="text-sm t-muted">No anomalies {anomalyFilter !== 'all' ? `with ${anomalyFilter} severity` : 'detected yet'}</p>
              </div>
            )}
            {filteredAnomalies.map((anom) => {
              const isExpanded = expandedAnomaly === anom.id;
              const deviationPct = Math.abs(anom.deviation);
              return (
                <Card
                  key={anom.id}
                  hover
                  onClick={() => setExpandedAnomaly(isExpanded ? null : anom.id)}
                  className={isExpanded ? 'border-accent/20' : ''}
                >
                  <div className="flex items-start gap-4">
                    <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                      anom.severity === 'critical' ? 'bg-red-500/10' : anom.severity === 'high' ? 'bg-amber-500/10' : 'bg-accent/10'
                    }`}>
                      <AlertTriangle className={`w-5 h-5 ${
                        anom.severity === 'critical' ? 'text-red-400' : anom.severity === 'high' ? 'text-amber-400' : 'text-accent'
                      }`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-base font-semibold t-primary">{anom.metric}</h3>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <StatusPill status={anom.severity} size="sm" />
                          <Badge variant={deviationPct >= 50 ? 'danger' : deviationPct >= 25 ? 'warning' : 'info'}>
                            +{deviationPct}% deviation
                          </Badge>
                          {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                        </div>
                      </div>
                      <p className="text-sm t-muted mt-1">{anom.hypothesis}</p>

                      {/* Quick Stats */}
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
                        <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                          <span className="text-caption t-muted">Expected</span>
                          <p className="text-sm font-medium t-secondary">{anom.expectedValue}</p>
                        </div>
                        <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                          <span className="text-caption t-muted">Actual</span>
                          <p className="text-sm font-medium text-red-400">{anom.actualValue}</p>
                        </div>
                        <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                          <span className="text-caption t-muted">Detected</span>
                          <p className="text-sm font-medium t-secondary">{new Date(anom.detectedAt).toLocaleString()}</p>
                        </div>
                      </div>

                      {/* Expanded Investigation Report */}
                      {isExpanded && (
                        <div className="mt-4 space-y-4 animate-fadeIn">
                          {/* Deviation Gauge */}
                          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                            <div className="flex items-center gap-2 mb-3">
                              <Gauge className="w-4 h-4 text-accent" />
                              <h4 className="text-sm font-semibold t-primary">Anomaly Investigation</h4>
                            </div>

                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-label">Deviation</span>
                                <p className={`text-lg font-bold mt-0.5 ${deviationPct >= 50 ? 'text-red-400' : deviationPct >= 25 ? 'text-amber-400' : 'text-accent'}`}>+{deviationPct}%</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-label">Severity</span>
                                <p className={`text-lg font-bold mt-0.5 capitalize ${anom.severity === 'critical' ? 'text-red-400' : anom.severity === 'high' ? 'text-amber-400' : 'text-accent'}`}>{anom.severity}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-label">Status</span>
                                <p className="text-lg font-bold t-primary mt-0.5 capitalize">{anom.status || 'open'}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-label">Delta</span>
                                <p className="text-lg font-bold text-red-400 mt-0.5">{(anom.actualValue - anom.expectedValue).toFixed(1)}</p>
                              </div>
                            </div>

                            {/* Severity Gauge */}
                            <div className="mb-4">
                              <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Deviation Severity</h5>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card-solid)' }}>
                                  <div className="h-full rounded-full transition-all duration-700" style={{
                                    width: `${Math.min(100, deviationPct)}%`,
                                    background: deviationPct >= 50 ? 'linear-gradient(90deg, #ef4444, #dc2626)' : deviationPct >= 25 ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, var(--accent), var(--accent))',
                                  }} />
                                </div>
                                <span className="text-xs font-bold t-primary w-12 text-right">{deviationPct}%</span>
                              </div>
                            </div>

                            {/* What This Means */}
                            <div className="mb-4">
                              <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">What This Means</h5>
                              <p className="text-sm t-muted leading-relaxed">
                                The <span className="font-medium t-primary">{anom.metric}</span> metric has deviated{' '}
                                <span className={`font-medium ${deviationPct >= 50 ? 'text-red-400' : 'text-amber-400'}`}>{deviationPct}%</span>{' '}
                                from its expected value of <span className="font-medium t-primary">{anom.expectedValue}</span>,
                                reaching <span className="font-medium text-red-400">{anom.actualValue}</span>.
                                {anom.severity === 'critical' ? ' This is a critical deviation requiring immediate investigation and remediation.' :
                                 anom.severity === 'high' ? ' This is a significant deviation — prompt action is recommended to prevent further escalation.' :
                                 ' This deviation is within manageable bounds but should be monitored.'}
                              </p>
                            </div>
                          </div>

                          {/* Recommended Actions — every step is a live button.
                              Dead static text on a finance demo erodes trust faster
                              than an empty card; the operator must be able to act
                              from the same surface where they triaged. */}
                          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                            <div className="flex items-center gap-2 mb-3">
                              <Shield className="w-4 h-4 text-accent" />
                              <h4 className="text-sm font-semibold t-primary">Recommended Next Steps</h4>
                            </div>
                            <div className="space-y-2.5">
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleAnomalyStatus(anom.id, 'investigating', 'Investigation opened'); }}
                                disabled={anomalyActionPending === `${anom.id}:investigating` || anom.status === 'investigating' || anom.status === 'resolved'}
                                className="w-full flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
                                aria-label={`Investigate ${anom.metric}`}
                              >
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>1</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">
                                    {anomalyActionPending === `${anom.id}:investigating` ? 'Opening investigation…' : `Investigate root cause: ${anom.hypothesis}`}
                                  </span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-caption t-muted">Priority: {anom.severity === 'critical' ? 'Immediate' : 'Short-term'}</span>
                                    <span className="text-caption t-muted">|</span>
                                    <span className="text-caption t-muted">Owner: Operations Team</span>
                                    {anom.status === 'investigating' && <Badge variant="info" size="sm">Open</Badge>}
                                  </div>
                                </div>
                                <ArrowRight size={14} className="t-muted self-center flex-shrink-0" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleAnomalyRerun(anom.id); }}
                                disabled={anomalyActionPending === `${anom.id}:rerun`}
                                className="w-full flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
                                aria-label="Re-check data quality"
                              >
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>2</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">
                                    {anomalyActionPending === `${anom.id}:rerun` ? 'Re-running Z-score sweep…' : 'Verify data quality (re-run detection at high sensitivity)'}
                                  </span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-caption t-muted">Priority: Short-term</span>
                                    <span className="text-caption t-muted">|</span>
                                    <span className="text-caption t-muted">Owner: Data Engineering</span>
                                  </div>
                                </div>
                                <ArrowRight size={14} className="t-muted self-center flex-shrink-0" />
                              </button>
                              <button
                                type="button"
                                onClick={(e) => { e.stopPropagation(); handleAnomalyStatus(anom.id, 'resolved', deviationPct >= 50 ? 'Anomaly escalated + closed' : 'Anomaly resolved'); }}
                                disabled={anomalyActionPending === `${anom.id}:resolved` || anom.status === 'resolved'}
                                className="w-full flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/50 disabled:opacity-50 disabled:cursor-not-allowed text-left transition-colors"
                                aria-label={deviationPct >= 50 ? 'Escalate to management' : 'Mark resolved'}
                              >
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>3</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">
                                    {anomalyActionPending === `${anom.id}:resolved`
                                      ? 'Closing…'
                                      : deviationPct >= 50
                                        ? 'Escalate to management and close anomaly (records audit trail)'
                                        : 'Mark resolved and close anomaly (records audit trail)'}
                                  </span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-caption t-muted">Priority: {deviationPct >= 50 ? 'Immediate' : 'Medium-term'}</span>
                                    <span className="text-caption t-muted">|</span>
                                    <span className="text-caption t-muted">Owner: {deviationPct >= 50 ? 'Management' : 'Operations Team'}</span>
                                    {anom.status === 'resolved' && <Badge variant="success" size="sm">Closed</Badge>}
                                  </div>
                                </div>
                                <ArrowRight size={14} className="t-muted self-center flex-shrink-0" />
                              </button>
                            </div>
                          </div>

                          {/* Status Footer */}
                          <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={anom.status === 'resolved' ? 'success' : anom.status === 'investigating' ? 'info' : 'warning'} size="sm">
                                {anom.status || 'open'}
                              </Badge>
                              <span className="text-caption t-muted">Detected: {new Date(anom.detectedAt).toLocaleString()}</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 4: Process Mining
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'processes' && (
        <TabPanel>
          <div className="space-y-6">
            {processes.length === 0 && (
              <div className="flex items-center gap-3 py-6 px-4">
                <GitBranch className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
                <p className="text-sm t-muted">No process flows mapped yet</p>
              </div>
            )}

            {/* Process Health Summary — Stitch hover-tint bento */}
            {processes.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-accent/40 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption uppercase tracking-wider t-muted">Processes</span>
                    <GitBranch size={14} className="text-accent" />
                  </div>
                  <Numeric value={processes.length} size="lg" />
                  <p className="text-caption t-muted mt-1">Mapped & monitored</p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-emerald-500/40 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption uppercase tracking-wider t-muted">Avg Conformance</span>
                    <Target size={14} className="text-emerald-400" />
                  </div>
                  <p className={`text-headline-lg font-bold tabular-nums font-mono ${
                    (processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length) >= 80 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>{Math.round(processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length)}<span className="text-body">%</span></p>
                  <p className="text-caption t-muted mt-1">Target: 85%+</p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-sky-500/40 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption uppercase tracking-wider t-muted">Total Variants</span>
                    <Workflow size={14} style={{ color: 'var(--sky)' }} />
                  </div>
                  <Numeric value={processes.reduce((s, p) => s + p.variants, 0)} size="lg" />
                  <p className="text-caption t-muted mt-1">Across all processes</p>
                </div>
                <div className="p-4 rounded-2xl bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-red-500/40 transition-colors">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-caption uppercase tracking-wider t-muted">Bottlenecks</span>
                    <AlertTriangle size={14} className="text-red-400" />
                  </div>
                  <p className={`text-headline-lg font-bold tabular-nums font-mono ${processes.reduce((s, p) => s + p.bottlenecks.length, 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    <Numeric value={processes.reduce((s, p) => s + p.bottlenecks.length, 0)} size="lg" />
                  </p>
                  <p className="text-caption t-muted mt-1">Steps requiring attention</p>
                </div>
              </div>
            )}

            {processes.map((flow) => {
              const isExpanded = expandedProcess === flow.id;
              const healthySteps = flow.steps.filter(s => s.status === 'healthy').length;
              const totalSteps = flow.steps.length;
              const stepHealth = totalSteps > 0 ? Math.round((healthySteps / totalSteps) * 100) : 0;

              return (
                <Card
                  key={flow.id}
                  hover
                  onClick={() => setExpandedProcess(isExpanded ? null : flow.id)}
                  className={isExpanded ? 'border-accent/20' : ''}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold t-primary">{flow.name}</h3>
                        {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                      </div>
                      <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
                        <span>{flow.variants} variants</span>
                        {/* Backend stores avg_duration in seconds. formatDuration
                            picks the right unit (s/m/h/d/mo) and renders "—"
                            for unknown / non-finite values rather than the bare
                            `Infinity` / `undefined` strings the UI used to show. */}
                        <span>Avg duration: {formatDuration(flow.avgDuration)}</span>
                        <span>{totalSteps} steps</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={flow.conformanceRate >= 85 ? 'success' : flow.conformanceRate >= 70 ? 'warning' : 'danger'}>
                        {flow.conformanceRate}% conformance
                      </Badge>
                    </div>
                  </div>

                  {/* Process Flow Visualization */}
                  <div className="flex items-center gap-2 overflow-x-auto pb-2">
                    {flow.steps.map((step, i) => (
                      <div key={step.id} className="flex items-center gap-2">
                        <div className={`p-3 rounded-lg border min-w-32 ${
                          step.status === 'bottleneck' ? 'bg-red-500/10 border-red-500/20' :
                          step.status === 'degraded' ? 'bg-amber-500/10 border-amber-500/20' :
                          'bg-[var(--bg-secondary)] border-[var(--border-card)]'
                        }`}>
                          <span className="text-sm font-medium t-primary">{step.name}</span>
                          <div className="flex items-center gap-3 mt-1 text-caption t-muted">
                            {/* Step-level avgDuration / throughput are not always
                                populated by the backend (process_flows.steps
                                stores just `{ name, count }` in some paths).
                                Render only when we actually have a value. */}
                            {Number.isFinite(step.avgDuration) && step.avgDuration > 0 && (
                              <span>{formatDuration(step.avgDuration)} avg</span>
                            )}
                            {Number.isFinite(step.throughput) && step.throughput > 0 && (
                              <span>{step.throughput}/day</span>
                            )}
                          </div>
                          {step.status !== 'healthy' && (
                            <Badge variant={step.status === 'bottleneck' ? 'danger' : 'warning'} size="sm" className="mt-1">
                              {step.status}
                            </Badge>
                          )}
                        </div>
                        {i < flow.steps.length - 1 && (
                          <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
                        )}
                      </div>
                    ))}
                  </div>

                  {flow.bottlenecks.length > 0 && (
                    <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                      <span className="text-xs font-medium text-red-400">Bottlenecks: </span>
                      <span className="text-xs t-muted">{flow.bottlenecks.join(', ')}</span>
                    </div>
                  )}

                  {/* Expanded Process Detail */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-[var(--border-card)] space-y-4 animate-fadeIn">
                      {/* Process Health Report */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <BarChart3 className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Process Health Report</h4>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Conformance</span>
                            <p className={`text-lg font-bold mt-0.5 ${flow.conformanceRate >= 85 ? 'text-emerald-400' : flow.conformanceRate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{flow.conformanceRate}%</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Step Health</span>
                            <p className={`text-lg font-bold mt-0.5 ${stepHealth >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{stepHealth}%</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Avg Duration</span>
                            <p className="text-lg font-bold t-primary mt-0.5">{formatDuration(flow.avgDuration)}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Process Variants</span>
                            <p className="text-lg font-bold t-primary mt-0.5">{flow.variants}</p>
                          </div>
                        </div>

                        {/* Conformance Gauge */}
                        <div className="mb-4">
                          <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Conformance Gauge</h5>
                          <Progress value={flow.conformanceRate} color={conformanceColor(flow.conformanceRate)} size="md" />
                        </div>

                        {/* Step-by-Step Breakdown */}
                        <div className="mb-4">
                          <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Step-by-Step Analysis</h5>
                          <div className="space-y-2">
                            {flow.steps.map((step) => (
                              <div key={step.id} className="flex items-center gap-3 p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                                  step.status === 'bottleneck' ? 'bg-red-500' : step.status === 'degraded' ? 'bg-amber-500' : 'bg-emerald-500'
                                }`} />
                                <span className="text-sm t-primary flex-1">{step.name}</span>
                                <div className="flex items-center gap-4 text-xs t-muted">
                                  {Number.isFinite(step.avgDuration) && step.avgDuration > 0 ? (
                                    <span className="flex items-center gap-1"><Clock size={10} /> {formatDuration(step.avgDuration)}</span>
                                  ) : null}
                                  {Number.isFinite(step.throughput) && step.throughput > 0 ? (
                                    <span className="flex items-center gap-1"><Zap size={10} /> {step.throughput}/day</span>
                                  ) : null}
                                  <Badge
                                    variant={step.status === 'bottleneck' ? 'danger' : step.status === 'degraded' ? 'warning' : 'success'}
                                    size="sm"
                                  >
                                    {step.status}
                                  </Badge>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Optimisation Insights */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Optimisation Insights</h4>
                        </div>
                        <div className="space-y-2.5">
                          {flow.bottlenecks.length > 0 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>1</div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Address bottleneck{flow.bottlenecks.length > 1 ? 's' : ''} at: {flow.bottlenecks.join(', ')}</span>
                                <p className="text-caption t-muted mt-0.5">Consider resource reallocation, automation, or process redesign to reduce cycle time.</p>
                              </div>
                            </div>
                          )}
                          {flow.variants > 3 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>{flow.bottlenecks.length > 0 ? '2' : '1'}</div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Reduce process variants from {flow.variants} to improve standardisation</span>
                                <p className="text-caption t-muted mt-0.5">High variant count suggests inconsistent execution. Review and enforce SOPs.</p>
                              </div>
                            </div>
                          )}
                          {flow.conformanceRate < 85 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: 'var(--text-on-accent)' }}>
                                {(flow.bottlenecks.length > 0 ? 1 : 0) + (flow.variants > 3 ? 1 : 0) + 1}
                              </div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Improve conformance from {flow.conformanceRate}% to target 85%+</span>
                                <p className="text-caption t-muted mt-0.5">Identify top deviation paths and implement controls to guide process execution.</p>
                              </div>
                            </div>
                          )}
                          {flow.bottlenecks.length === 0 && flow.variants <= 3 && flow.conformanceRate >= 85 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <span className="text-sm t-primary">This process is performing well</span>
                                <p className="text-caption t-muted mt-0.5">No immediate optimisations required. Continue monitoring for drift.</p>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}

      {/* ══════════════════════════════════════════════════════
          TAB 5: Cross-System Correlations
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'correlations' && (
        <TabPanel>
          {/* Correlation Summary */}
          {correlations.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label">Correlations</span>
                  <Link2 size={14} className="text-accent" />
                </div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{correlations.length}</p>
                <p className="text-caption t-muted mt-1">Discovered patterns</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label">Avg Confidence</span>
                  <Target size={14} className="text-emerald-400" />
                </div>
                <p className={`text-2xl font-bold ${
                  (correlations.reduce((s, c) => s + c.confidence, 0) / correlations.length) >= 0.7 ? 'text-emerald-400' : 'text-amber-400'
                }`}>{Math.round((correlations.reduce((s, c) => s + c.confidence, 0) / correlations.length) * 100)}%</p>
                <p className="text-caption t-muted mt-1">Pattern reliability</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label">Unique Systems</span>
                  <Workflow size={14} className="text-blue-400" />
                </div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">
                  {new Set([...correlations.map(c => c.sourceSystem), ...correlations.map(c => c.targetSystem)]).size}
                </p>
                <p className="text-caption t-muted mt-1">Connected sources</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-label">Avg Lag</span>
                  <Clock size={14} className="text-gray-400" />
                </div>
                <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{formatDays(correlations.reduce((s, c) => s + (Number.isFinite(c.lagDays) ? c.lagDays : 0), 0) / correlations.length)}</p>
                <p className="text-caption t-muted mt-1">Between events</p>
              </Card>
            </div>
          )}

          {/* §2.2.3 Correlation Matrix — heatmap visualisation (SVG/HTML, no deps) */}
          {correlations.length > 0 && (
            <Card className="mb-6">
              <CorrelationMatrix correlations={correlations} />
            </Card>
          )}

          <div className="space-y-4">
            {correlations.length === 0 && (
              <div className="flex items-center gap-3 py-6 px-4">
                <Link2 className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
                <p className="text-sm t-muted">No correlations discovered yet</p>
              </div>
            )}
            {correlations.map((event) => {
              const isExpanded = expandedCorrelation === event.id;
              const confPct = Math.round(event.confidence * 100);
              return (
                <Card
                  key={event.id}
                  hover
                  onClick={() => setExpandedCorrelation(isExpanded ? null : event.id)}
                  className={isExpanded ? 'border-accent/20' : ''}
                >
                  {/* Connection Visualization */}
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-3 flex-1">
                      <div className="p-2.5 rounded-lg bg-accent/10 text-center min-w-24">
                        <span className="text-xs text-accent font-medium">{event.sourceSystem}</span>
                      </div>
                      <div className="flex-1 relative">
                        <div className="h-px bg-gradient-to-r from-accent/40 to-blue-500/30" />
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-card)] text-caption text-gray-500">
                          {formatDays(event.lagDays)} lag
                        </div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-accent/10 text-center min-w-24">
                        <span className="text-xs text-accent font-medium">{event.targetSystem}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={confPct >= 70 ? 'success' : confPct >= 50 ? 'info' : 'default'}>{confPct}%</Badge>
                      {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                    </div>
                  </div>

                  {/* Quick Info */}
                  <div className="grid grid-cols-2 gap-4 mt-3">
                    <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-caption t-muted">Source Event</span>
                      <p className="text-sm t-secondary">{event.sourceEvent}</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-caption t-muted">Target Impact</span>
                      <p className="text-sm t-secondary">{event.targetImpact}</p>
                    </div>
                  </div>

                  {/* Expanded Correlation Detail */}
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t border-[var(--border-card)] space-y-4 animate-fadeIn">
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <Link2 className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Correlation Analysis</h4>
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Confidence</span>
                            <p className={`text-lg font-bold mt-0.5 ${confidenceColor(event.confidence)}`}>
                              {confidenceLabel(event.confidence)}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Time Lag</span>
                            <p className="text-lg font-bold t-primary mt-0.5">{formatDays(event.lagDays, { long: true })}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Source</span>
                            <p className="text-lg font-bold text-accent mt-0.5">{event.sourceSystem}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-label">Target</span>
                            <p className="text-lg font-bold text-blue-400 mt-0.5">{event.targetSystem}</p>
                          </div>
                        </div>

                        {/* Confidence Gauge */}
                        <div className="mb-4">
                          <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Pattern Strength</h5>
                          <div className="flex items-center gap-3">
                            <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card-solid)' }}>
                              <div className="h-full rounded-full transition-all duration-700" style={{
                                width: `${confPct}%`,
                                background: confPct >= 70 ? 'linear-gradient(90deg, #10b981, #059669)' : confPct >= 50 ? 'linear-gradient(90deg, var(--accent), var(--accent))' : 'linear-gradient(90deg, #9ca3af, #6b7280)',
                              }} />
                            </div>
                            <span className="text-xs font-bold t-primary w-10 text-right">{confPct}%</span>
                          </div>
                        </div>

                        {/* What This Means */}
                        <div className="mb-4">
                          <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">What This Means</h5>
                          <p className="text-sm t-muted leading-relaxed">
                            When <span className="font-medium text-accent">{event.sourceEvent}</span> occurs in{' '}
                            <span className="font-medium t-primary">{event.sourceSystem}</span>, there is a{' '}
                            <span className={`font-medium ${confidenceColor(event.confidence)}`}>{confPct}%</span> probability
                            that <span className="font-medium text-blue-400">{event.targetImpact}</span> will follow in{' '}
                            <span className="font-medium t-primary">{event.targetSystem}</span> within{' '}
                            <span className="font-medium t-primary">{formatDays(event.lagDays, { long: true })}</span>.
                            {confPct >= 70 ? ' This is a strong, actionable correlation that can be used for predictive planning.' :
                             confPct >= 50 ? ' This pattern is moderately reliable — use it as an early warning signal alongside other indicators.' :
                             ' This is a weak correlation that requires further data collection to validate.'}
                          </p>
                        </div>
                      </div>

                      {/* Business Implications */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Business Implications</h4>
                        </div>
                        <div className="space-y-2.5">
                          <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <Eye className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-sm t-primary">Set up automated alerts on <span className="font-medium">{event.sourceSystem}</span> for early detection</span>
                              <p className="text-caption t-muted mt-0.5">Use the {formatDays(event.lagDays)} lag as a predictive window to prepare for downstream impact.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <Shield className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-sm t-primary">Build contingency plans for <span className="font-medium">{event.targetImpact.toLowerCase()}</span></span>
                              <p className="text-caption t-muted mt-0.5">Pre-position resources and response protocols to mitigate impact when the source event is detected.</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center gap-2 text-caption t-muted">
                        <span>Discovered: {event.detectedAt ? new Date(event.detectedAt).toLocaleString() : 'N/A'}</span>
                      </div>
                    </div>
                  )}
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}
      {/* ══════════════════════════════════════════════════════
          TAB 6: Catalyst Runs — Transaction-Level Reporting
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'catalyst-runs' && (
        <TabPanel>
          {/* Summary Cards */}
          {catalystSummary.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
              <Card variant="black">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                    <Play className="w-5 h-5 text-accent" />
                  </div>
                  <div>
                    <p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{catalystSummary.reduce((s, c) => s + (c.totalRuns as number || 0), 0)}</p>
                    <p className="text-xs t-muted">Total Runs</p>
                  </div>
                </div>
              </Card>
              <Card variant="black">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                    <CheckCircle2 className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-headline-lg font-bold text-emerald-400 tabular-nums font-mono">{catalystSummary.reduce((s, c) => s + (c.completed as number || 0), 0)}</p>
                    <p className="text-xs t-muted">Completed</p>
                  </div>
                </div>
              </Card>
              <Card variant="black">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-red-500/10 flex items-center justify-center">
                    <FileWarning className="w-5 h-5 text-red-400" />
                  </div>
                  <div>
                    <p className="text-headline-lg font-bold text-red-400 tabular-nums font-mono">{catalystSummary.reduce((s, c) => s + (c.exceptions as number || 0), 0)}</p>
                    <p className="text-xs t-muted">Exceptions</p>
                  </div>
                </div>
              </Card>
              <Card variant="black">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                    <UserCheck className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <p className="text-headline-lg font-bold text-amber-400 tabular-nums font-mono">{catalystSummary.reduce((s, c) => s + (c.pending as number || 0), 0)}</p>
                    <p className="text-xs t-muted">Pending Review</p>
                  </div>
                </div>
              </Card>
            </div>
          )}

          {/* Per-Catalyst Summary Table */}
          {catalystSummary.length > 0 && (
            <Card variant="black" className="mb-6">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-accent" />
                <h3 className="text-sm font-semibold t-primary">Catalyst Performance Summary</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--border-card)]">
                      <th className="text-left py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Catalyst</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Total</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Completed</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Exceptions</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Pending</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Avg Confidence</th>
                      <th className="text-center py-2 px-3 text-xs font-semibold t-muted uppercase tracking-wider">Success Rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {catalystSummary.map((cat) => (
                      <tr
                        key={cat.catalystName}
                        className="border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)] cursor-pointer transition-colors"
                        onClick={() => setCatalystFilter(catalystFilter === cat.catalystName ? 'all' : cat.catalystName)}
                      >
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${cat.successRate >= 80 ? 'bg-emerald-400' : cat.successRate >= 60 ? 'bg-amber-400' : 'bg-red-400'}`} />
                            <span className={`font-medium ${catalystFilter === cat.catalystName ? 'text-accent' : 't-primary'}`}>{cat.catalystName}</span>
                          </div>
                        </td>
                        <td className="text-center py-2.5 px-3 t-secondary">{cat.totalRuns}</td>
                        <td className="text-center py-2.5 px-3 text-emerald-400">{cat.completed}</td>
                        <td className="text-center py-2.5 px-3 text-red-400">{cat.exceptions}</td>
                        <td className="text-center py-2.5 px-3 text-amber-400">{cat.pending}</td>
                        <td className="text-center py-2.5 px-3">
                          <span className={`font-medium ${cat.avgConfidence >= 0.8 ? 'text-emerald-400' : cat.avgConfidence >= 0.6 ? 'text-amber-400' : 'text-red-400'}`}>
                            {(cat.avgConfidence * 100).toFixed(0)}%
                          </span>
                        </td>
                        <td className="text-center py-2.5 px-3">
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-16 h-1.5 rounded-full overflow-hidden bg-[var(--bg-card-solid)]">
                              <div
                                className="h-full rounded-full transition-all"
                                style={{
                                  width: `${cat.successRate}%`,
                                  background: cat.successRate >= 80 ? '#10b981' : cat.successRate >= 60 ? '#f59e0b' : '#ef4444',
                                }}
                              />
                            </div>
                            <span className={`text-xs font-medium ${cat.successRate >= 80 ? 'text-emerald-400' : cat.successRate >= 60 ? 'text-amber-400' : 'text-red-400'}`}>
                              {Number(cat.successRate).toFixed(1)}%
                            </span>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          {/* Filter Bar */}
          <div className="flex items-center gap-2 mb-4">
            <Filter size={14} className="text-gray-400" />
            <button
              onClick={() => setCatalystFilter('all')}
              className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                catalystFilter === 'all'
                  ? 'bg-accent/20 text-accent border border-accent/30'
                  : 'bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400'
              }`}
            >
              All Catalysts
            </button>
            {catalystSummary.map(cat => (
              <button
                key={cat.catalystName}
                onClick={() => setCatalystFilter(catalystFilter === cat.catalystName ? 'all' : cat.catalystName)}
                className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                  catalystFilter === cat.catalystName
                    ? 'bg-accent/20 text-accent border border-accent/30'
                    : 'bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400'
                }`}
              >
                {cat.catalystName}
              </button>
            ))}
            <span className="text-xs t-muted ml-auto">
              {catalystRuns.length} run{catalystRuns.length !== 1 ? 's' : ''}
              {catalystFilter !== 'all' && ` for ${catalystFilter}`}
            </span>
          </div>

          {/* Run List */}
          {runsLoading ? (
            <div className="flex items-center justify-center h-48">
              <Loader2 className="w-8 h-8 text-accent animate-spin" />
            </div>
          ) : catalystRuns.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <List className="w-10 h-10 t-muted mb-3 opacity-30" />
              <p className="text-sm t-muted">No catalyst runs found{catalystFilter !== 'all' ? ` for ${catalystFilter}` : ''}.</p>
              <p className="text-xs t-muted mt-1">Execute a catalyst to generate run data.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {catalystRuns.map((run) => {
                const isExpanded = expandedRun === run.id;
                const statusColors: Record<string, string> = {
                  completed: 'text-emerald-400 bg-emerald-500/10',
                  exception: 'text-red-400 bg-red-500/10',
                  pending: 'text-amber-400 bg-amber-500/10',
                  running: 'text-blue-400 bg-blue-500/10',
                };
                const statusIcons: Record<string, typeof CheckCircle2> = {
                  completed: CheckCircle2,
                  exception: XCircle,
                  pending: Clock,
                  running: Activity,
                };
                const StatusIcon = statusIcons[run.status] || AlertCircle;
                const colorClass = statusColors[run.status] || 'text-gray-400 bg-gray-500/10';

                return (
                  <Card
                    key={run.id}
                    hover
                    onClick={() => setExpandedRun(isExpanded ? null : run.id)}
                    className={isExpanded ? 'border-accent/20' : ''}
                  >
                    <div className="flex items-start gap-4">
                      <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass.split(' ')[1]}`}>
                        <StatusIcon className={`w-5 h-5 ${colorClass.split(' ')[0]}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-base font-semibold t-primary">{run.catalystName}</h3>
                            <p className="text-xs t-muted mt-0.5">{run.action}</p>
                          </div>
                          <div className="flex items-center gap-2 flex-shrink-0">
                            <Badge variant={run.status === 'completed' ? 'success' : run.status === 'exception' ? 'danger' : 'warning'}>
                              {run.status}
                            </Badge>
                            {run.needsHumanReview && (
                              <Badge variant="warning">
                                <UserCheck size={10} className="mr-1" />
                                HITL
                              </Badge>
                            )}
                            <span className={`text-xs font-medium ${run.confidence >= 0.8 ? 'text-emerald-400' : run.confidence >= 0.6 ? 'text-amber-400' : 'text-red-400'}`}>
                              {(run.confidence * 100).toFixed(0)}%
                            </span>
                            {isExpanded ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                          </div>
                        </div>

                        {/* Quick Stats Row */}
                        <div className="flex items-center gap-4 mt-2 text-xs t-muted">
                          <span className="flex items-center gap-1">
                            <Clock size={10} />
                            {new Date(run.createdAt).toLocaleString()}
                          </span>
                          {run.completedAt && (
                            <span className="flex items-center gap-1">
                              <Zap size={10} />
                              {Math.round((new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s
                            </span>
                          )}
                        </div>

                        {/* Expanded Details */}
                        {isExpanded && (
                          <div className="mt-4 space-y-4 animate-fadeIn">
                            {/* Run Details Grid */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <span className="text-label">Status</span>
                                <p className={`text-lg font-bold mt-0.5 capitalize ${colorClass.split(' ')[0]}`}>{run.status}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <span className="text-label">Confidence</span>
                                <p className={`text-lg font-bold mt-0.5 ${run.confidence >= 0.8 ? 'text-emerald-400' : run.confidence >= 0.6 ? 'text-amber-400' : 'text-red-400'}`}>
                                  {(run.confidence * 100).toFixed(0)}%
                                </p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <span className="text-label">Duration</span>
                                <p className="text-lg font-bold t-primary mt-0.5">
                                  {run.completedAt
                                    ? `${Math.round((new Date(run.completedAt).getTime() - new Date(run.createdAt).getTime()) / 1000)}s`
                                    : 'In progress'}
                                </p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <span className="text-label">Review</span>
                                <p className={`text-lg font-bold mt-0.5 ${run.needsHumanReview ? 'text-amber-400' : 'text-emerald-400'}`}>
                                  {run.needsHumanReview ? 'Required' : 'Auto'}
                                </p>
                              </div>
                            </div>

                            {/* Confidence Gauge */}
                            <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                              <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Decision Confidence</h5>
                              <div className="flex items-center gap-3">
                                <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card-solid)' }}>
                                  <div className="h-full rounded-full transition-all duration-700" style={{
                                    width: `${run.confidence * 100}%`,
                                    background: run.confidence >= 0.8 ? 'linear-gradient(90deg, #10b981, #059669)' : run.confidence >= 0.6 ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, #ef4444, #dc2626)',
                                  }} />
                                </div>
                                <span className="text-xs font-bold t-primary w-10 text-right">{(run.confidence * 100).toFixed(0)}%</span>
                              </div>
                            </div>

                            {/* Input Data */}
                            {run.inputData && Object.keys(run.inputData).length > 0 && (
                              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <div className="flex items-center gap-2 mb-2">
                                  <ArrowRight className="w-4 h-4 text-accent" />
                                  <h4 className="text-sm font-semibold t-primary">Input Data</h4>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {Object.entries(run.inputData).slice(0, 10).map(([key, value]) => (
                                    <div key={key} className="flex items-start gap-2 p-2 rounded bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                      <span className="text-label min-w-[80px]">{key}</span>
                                      <span className="text-xs t-secondary break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Output Data / Results */}
                            {run.outputData && Object.keys(run.outputData).length > 0 && (
                              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <div className="flex items-center gap-2 mb-2">
                                  <Target className="w-4 h-4 text-accent" />
                                  <h4 className="text-sm font-semibold t-primary">Output / Results</h4>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                                  {Object.entries(run.outputData).slice(0, 10).map(([key, value]) => (
                                    <div key={key} className="flex items-start gap-2 p-2 rounded bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                      <span className="text-label min-w-[80px]">{key}</span>
                                      <span className="text-xs t-secondary break-all">{typeof value === 'object' ? JSON.stringify(value) : String(value)}</span>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Reasoning */}
                            {run.reasoning && (
                              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <div className="flex items-center gap-2 mb-2">
                                  <Lightbulb className="w-4 h-4 text-accent" />
                                  <h4 className="text-sm font-semibold t-primary">AI Reasoning</h4>
                                </div>
                                <p className="text-sm t-muted leading-relaxed">{run.reasoning}</p>
                              </div>
                            )}

                            {/* Approval Info */}
                            {run.approvedBy && (
                              <div className="flex items-center gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
                                <UserCheck className="w-4 h-4 text-emerald-400" />
                                <span className="text-sm text-emerald-400">Approved by: <span className="font-medium">{run.approvedBy}</span></span>
                              </div>
                            )}

                            {/* Assigned Users */}
                            {run.assignedTo && (run.assignedTo.validators?.length || run.assignedTo.exceptionHandlers?.length || run.assignedTo.escalation?.length) ? (
                              <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                                <div className="flex items-center gap-2 mb-2">
                                  <UserCheck className="w-4 h-4 text-accent" />
                                  <h4 className="text-sm font-semibold t-primary">Assigned Users</h4>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                                  {run.assignedTo.validators && run.assignedTo.validators.length > 0 && (
                                    <div>
                                      <span className="text-emerald-400 font-medium block mb-1">Validators</span>
                                      {run.assignedTo.validators.map((u, i) => (
                                        <p key={i} className="t-secondary">{u}</p>
                                      ))}
                                    </div>
                                  )}
                                  {run.assignedTo.exceptionHandlers && run.assignedTo.exceptionHandlers.length > 0 && (
                                    <div>
                                      <span className="text-amber-400 font-medium block mb-1">Exception Handlers</span>
                                      {run.assignedTo.exceptionHandlers.map((u, i) => (
                                        <p key={i} className="t-secondary">{u}</p>
                                      ))}
                                    </div>
                                  )}
                                  {run.assignedTo.escalation && run.assignedTo.escalation.length > 0 && (
                                    <div>
                                      <span className="text-red-400 font-medium block mb-1">Escalation</span>
                                      {run.assignedTo.escalation.map((u, i) => (
                                        <p key={i} className="t-secondary">{u}</p>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            ) : null}

                            {/* Footer */}
                            <div className="flex items-center gap-4 text-caption t-muted">
                              <span>Created: {new Date(run.createdAt).toLocaleString()}</span>
                              {run.completedAt && <span>Completed: {new Date(run.completedAt).toLocaleString()}</span>}
                              <span className="font-mono">{run.id.substring(0, 8)}</span>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </TabPanel>
      )}

      {/* Diagnostics Tab */}
      {activeTab === 'diagnostics' && (
        <TabPanel>
          {diagLoading && !diagSummary && (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
          )}
          {!diagLoading && !diagSummary && diagError && (
            <ErrorState
              title="Couldn't load diagnostics"
              error={diagError}
              onRetry={loadDiagnostics}
            />
          )}
          {!diagLoading && !diagSummary && !diagError && (
            <Card className="flex items-center gap-3 py-6 px-4">
              <Stethoscope className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
              <p className="text-sm t-muted">No diagnostics data yet</p>
              <Button variant="primary" size="sm" className="ml-auto" onClick={loadDiagnostics}>Load Diagnostics</Button>
            </Card>
          )}
          {diagSummary && (
            <div className="space-y-4">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Card><div className="text-center"><p className="text-headline-lg font-bold t-primary tabular-nums font-mono">{diagSummary.totalAnalyses}</p><p className="text-label">Total Analyses</p></div></Card>
                <Card><div className="text-center"><p className="text-headline-lg font-bold text-amber-400 tabular-nums font-mono">{diagSummary.pendingAnalyses}</p><p className="text-label">Pending</p></div></Card>
                <Card><div className="text-center"><p className="text-headline-lg font-bold text-emerald-400 tabular-nums font-mono">{diagSummary.completedAnalyses}</p><p className="text-label">Completed</p></div></Card>
                <Card><div className="text-center"><p className="text-headline-lg font-bold text-red-400 tabular-nums font-mono">{diagSummary.undiagnosedMetrics}</p><p className="text-label">Undiagnosed</p></div></Card>
                <Card><div className="text-center"><p className="text-headline-lg font-bold text-red-400 tabular-nums font-mono">{diagSummary.criticalFindings}</p><p className="text-label">Critical Findings</p></div></Card>
                <Card><div className="text-center"><p className="text-2xl font-bold text-accent">{diagSummary.activeFixes}</p><p className="text-label">Active Fixes</p></div></Card>
              </div>

              {/* Quick Diagnose: Red/Amber metrics */}
              {metrics.filter(m => m.status === 'red' || m.status === 'amber').length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold t-primary mb-2">Quick Diagnose — At-Risk Metrics</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                    {metrics.filter(m => m.status === 'red' || m.status === 'amber').slice(0, 6).map(m => (
                      <Card key={m.id} className={m.status === 'red' ? 'border-red-500/20' : 'border-amber-500/20'}>
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <span className={`w-2 h-2 rounded-full ${m.status === 'red' ? 'bg-red-400' : 'bg-amber-400'}`} />
                            <span className="text-xs font-medium t-primary truncate">{m.name}</span>
                          </div>
                          <Button variant="secondary" size="sm" onClick={() => handleAnalyseMetric(m.id)} disabled={analysingMetric === m.id}>
                            {analysingMetric === m.id ? <Loader2 size={10} className="animate-spin" /> : <Stethoscope size={10} />}
                            <span className="ml-1">Diagnose</span>
                          </Button>
                        </div>
                        <div className="flex items-center gap-2 mt-1 text-caption t-muted">
                          <span>Value: {typeof m.value === 'number' ? m.value.toFixed(1) : m.value}</span>
                          <span>· Source: {m.sourceSystem || 'General'}</span>
                        </div>
                      </Card>
                    ))}
                  </div>
                </div>
              )}

              {/* Analyses List */}
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold t-primary">Diagnostic Analyses</h3>
                <Button variant="secondary" size="sm" onClick={loadDiagnostics}><RefreshCw size={12} /> Refresh</Button>
              </div>

              {diagAnalyses.length === 0 ? (
                <div className="flex items-center gap-3 py-4 px-4">
                  <Stethoscope className="w-4 h-4 t-muted opacity-40 flex-shrink-0" />
                  <p className="text-xs t-muted">No analyses yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {diagAnalyses.map(analysis => (
                    <Card key={analysis.id} hover onClick={() => { setExpandedAnalysis(expandedAnalysis === analysis.id ? null : analysis.id); if (expandedAnalysis !== analysis.id) handleViewAnalysis(analysis.id); }}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`w-1 h-4 rounded-full flex-shrink-0 ${analysis.metricStatus === 'red' ? 'bg-red-400' : analysis.metricStatus === 'amber' ? 'bg-amber-400' : 'bg-emerald-400'}`} />
                          <Badge variant={analysis.status === 'completed' ? 'success' : analysis.status === 'failed' ? 'danger' : 'warning'} size="sm">{analysis.status}</Badge>
                          <span className="text-sm font-medium t-primary">{analysis.metricName}</span>
                        </div>
                        <div className="flex items-center gap-2 text-caption t-muted">
                          <span>{new Date(analysis.createdAt).toLocaleDateString()}</span>
                          <ChevronRight size={12} className={expandedAnalysis === analysis.id ? 'rotate-90 transition-transform' : 'transition-transform'} />
                        </div>
                      </div>
                      {expandedAnalysis === analysis.id && diagDetail && diagDetail.analysis.id === analysis.id && (
                        <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                          <p className="text-xs font-medium t-primary mb-2">Causal Chain (L0–L{diagDetail.causalChain.length > 0 ? diagDetail.causalChain[diagDetail.causalChain.length - 1].level : 0})</p>
                          <div className="space-y-2">
                            {diagDetail.causalChain.map((link, i) => (
                              <div key={link.id} className="flex items-start gap-3">
                                <div className="flex flex-col items-center">
                                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-caption font-bold ${link.level === 0 ? 'bg-red-500/20 text-red-400' : link.causeType === 'root' ? 'bg-purple-500/20 text-purple-400' : 'bg-[var(--bg-secondary)] t-muted'}`}>L{link.level}</div>
                                  {i < diagDetail.causalChain.length - 1 && <div className="w-px h-4 bg-[var(--border-card)]" />}
                                </div>
                                <div className="flex-1">
                                  <div className="flex items-center gap-2">
                                    <span className="text-xs font-medium t-primary">{link.title}</span>
                                    <Badge variant={link.fixPriority === 'critical' ? 'danger' : link.fixPriority === 'high' ? 'warning' : 'info'} size="sm">{link.fixPriority}</Badge>
                                    <span className="text-caption t-muted">Confidence: {Math.round(link.confidence)}%</span>
                                  </div>
                                  <p className="text-caption t-secondary mt-0.5">{link.description}</p>
                                  {link.recommendedFix && (
                                    <div className="flex items-start gap-1 mt-1 text-caption text-emerald-400">
                                      <Wrench size={10} className="mt-0.5 flex-shrink-0" />
                                      <span>{link.recommendedFix}</span>
                                    </div>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                          {diagDetail.fixes.length > 0 && (
                            <div className="mt-3">
                              <p className="text-xs font-medium t-primary mb-1">Fix Tracking</p>
                              {diagDetail.fixes.map(fix => (
                                <div key={fix.id} className="flex items-center justify-between text-caption p-1.5 rounded bg-[var(--bg-secondary)]">
                                  <span className="t-primary">{fix.chainTitle}</span>
                                  <Badge variant={fix.status === 'completed' ? 'success' : fix.status === 'in_progress' ? 'info' : 'warning'} size="sm">{fix.status}</Badge>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </TabPanel>
      )}

      {/* §11.5 Cost of Inaction Tab */}
      {activeTab === 'cost-of-inaction' && (
        <TabPanel>
          {!costOfInaction && !coiLoading && (
            <Card className="flex items-center gap-3 py-6 px-4">
              <AlertCircle className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
              <p className="text-sm t-muted">No cost-of-inaction data yet</p>
              <Button variant="primary" size="sm" className="ml-auto" onClick={() => {
                setCoiLoading(true);
                api.costOfInaction.get().then(setCostOfInaction).catch(() => { /* non-critical — ticker stays hidden */ }).finally(() => setCoiLoading(false));
              }}>Calculate Cost</Button>
            </Card>
          )}
          {coiLoading && (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
          )}
          {costOfInaction && (
            <div className="space-y-4">
              <CostOfInactionTicker data={costOfInaction} />
              <Button variant="secondary" size="sm" onClick={() => {
                setCoiLoading(true);
                api.costOfInaction.get().then(setCostOfInaction).catch(() => { /* non-critical — keep existing data */ }).finally(() => setCoiLoading(false));
              }}><RefreshCw size={12} /> Recalculate</Button>
            </div>
          )}
        </TabPanel>
      )}

      {/* Metric Traceability Modal */}
      {showMetricTraceModal && metricTraceData && (
        <TraceabilityModal
          data={metricTraceData as MetricTraceResponse}
          type="metric"
          onClose={() => { setShowMetricTraceModal(false); setMetricTraceData(null); }}
        />
      )}

      {/* Dimension Traceability Modal */}
      {showDimTraceModal && dimTraceData && (
        <TraceabilityModal
          data={dimTraceData}
          type="dimension"
          onClose={() => { setShowDimTraceModal(false); setDimTraceData(null); }}
        />
      )}
    </div>
  );
}
