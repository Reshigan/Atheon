import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { ScoreRing } from "@/components/ui/score-ring";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Metric, AnomalyItem, ProcessItem, CorrelationItem, PulseSummary } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import {
  Activity, AlertTriangle, GitBranch, Link2, ArrowRight, Loader2,
  TrendingUp, TrendingDown, Minus, Shield, Lightbulb, ChevronDown,
  ChevronUp, Clock, Zap, Target, Eye, CheckCircle2, XCircle,
  BarChart3, Gauge, Search, Filter, AlertCircle, Workflow
} from "lucide-react";
import { SkeletonCard } from "@/components/ui/skeleton";

/* ── helpers ──────────────────────────────────────────────── */
const trendIcon = (trend: string, size = 14) => {
  if (trend === 'up' || trend === 'improving') return <TrendingUp size={size} className="text-emerald-400" />;
  if (trend === 'down' || trend === 'declining') return <TrendingDown size={size} className="text-red-400" />;
  return <Minus size={size} className="text-gray-400" />;
};

const statusColor = (s: string) =>
  s === 'green' ? 'text-emerald-400' : s === 'amber' ? 'text-amber-400' : s === 'red' ? 'text-red-400' : 'text-gray-400';

const severityVariant = (s: string): 'danger' | 'warning' | 'info' | 'default' =>
  s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

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

/* ── Recommendations engine ──────────────────────────────── */
interface Recommendation {
  icon: typeof Shield;
  title: string;
  description: string;
  priority: string;
  category: string;
}

function generateRecommendations(metrics: Metric[], anomalies: AnomalyItem[], processes: ProcessItem[]): Recommendation[] {
  const recs: Recommendation[] = [];

  const redMetrics = metrics.filter(m => m.status === 'red');
  if (redMetrics.length > 0) {
    recs.push({
      icon: AlertCircle,
      title: `${redMetrics.length} Critical Metric${redMetrics.length > 1 ? 's' : ''} Breaching Thresholds`,
      description: `${redMetrics.map(m => m.name).join(', ')} ${redMetrics.length > 1 ? 'are' : 'is'} in red status. Immediate investigation required to prevent operational impact.`,
      priority: 'Immediate',
      category: 'Metrics',
    });
  }

  const amberMetrics = metrics.filter(m => m.status === 'amber');
  if (amberMetrics.length >= 2) {
    recs.push({
      icon: Eye,
      title: `${amberMetrics.length} Metrics Approaching Warning Levels`,
      description: `Monitor ${amberMetrics.slice(0, 3).map(m => m.name).join(', ')} closely. Consider proactive action before they breach red thresholds.`,
      priority: 'Short-term',
      category: 'Metrics',
    });
  }

  const criticalAnomalies = anomalies.filter(a => a.severity === 'critical');
  if (criticalAnomalies.length > 0) {
    recs.push({
      icon: Zap,
      title: `${criticalAnomalies.length} Critical Anomal${criticalAnomalies.length > 1 ? 'ies' : 'y'} Detected`,
      description: `Critical deviations in ${criticalAnomalies.map(a => a.metric).join(', ')}. Root cause analysis and remediation should be prioritised.`,
      priority: 'Immediate',
      category: 'Anomalies',
    });
  }

  const bottleneckProcesses = processes.filter(p => p.bottlenecks.length > 0);
  if (bottleneckProcesses.length > 0) {
    const totalBottlenecks = bottleneckProcesses.reduce((s, p) => s + p.bottlenecks.length, 0);
    recs.push({
      icon: Workflow,
      title: `${totalBottlenecks} Process Bottleneck${totalBottlenecks > 1 ? 's' : ''} Identified`,
      description: `${bottleneckProcesses.map(p => p.name).join(', ')} ${bottleneckProcesses.length > 1 ? 'have' : 'has'} bottleneck steps. Consider process re-engineering or resource reallocation.`,
      priority: 'Short-term',
      category: 'Processes',
    });
  }

  const lowConformance = processes.filter(p => p.conformanceRate < 75);
  if (lowConformance.length > 0) {
    recs.push({
      icon: Target,
      title: `${lowConformance.length} Process${lowConformance.length > 1 ? 'es' : ''} Below Conformance Target`,
      description: `${lowConformance.map(p => `${p.name} (${p.conformanceRate}%)`).join(', ')}. Review process variants and enforce standard operating procedures.`,
      priority: 'Medium-term',
      category: 'Processes',
    });
  }

  if (recs.length === 0) {
    recs.push({
      icon: CheckCircle2,
      title: 'All Systems Operating Normally',
      description: 'No critical issues detected. Continue monitoring and maintain current operational standards.',
      priority: 'Ongoing',
      category: 'General',
    });
  }

  return recs;
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
  const { activeTab, setActiveTab } = useTabState('dashboard');

  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([]);
  const [summary, setSummary] = useState<PulseSummary | null>(null);
  const [loading, setLoading] = useState(true);

  // Expandable states
  const [expandedMetric, setExpandedMetric] = useState<string | null>(null);
  const [expandedAnomaly, setExpandedAnomaly] = useState<string | null>(null);
  const [expandedProcess, setExpandedProcess] = useState<string | null>(null);
  const [expandedCorrelation, setExpandedCorrelation] = useState<string | null>(null);

  // Filter states
  const [metricFilter, setMetricFilter] = useState<'all' | 'green' | 'amber' | 'red'>('all');
  const [anomalyFilter, setAnomalyFilter] = useState<'all' | 'critical' | 'high' | 'medium' | 'low'>('all');
  const [metricSearch, setMetricSearch] = useState('');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const ind = industry !== 'general' ? industry : undefined;
      const [m, a, p, co, s] = await Promise.allSettled([
        api.pulse.metrics(undefined, ind),
        api.pulse.anomalies(undefined, ind),
        api.pulse.processes(undefined, ind),
        api.pulse.correlations(undefined, ind),
        api.pulse.summary(undefined, ind),
      ]);
      if (m.status === 'fulfilled') setMetrics(m.value.metrics);
      if (a.status === 'fulfilled') setAnomalies(a.value.anomalies);
      if (p.status === 'fulfilled') setProcesses(p.value.processes);
      if (co.status === 'fulfilled') setCorrelations(co.value.correlations);
      if (s.status === 'fulfilled') setSummary(s.value);
      setLoading(false);
    }
    load();
  }, [industry]);

  const health = computeOperationalHealth(metrics, summary, anomalies, processes);
  const recommendations = generateRecommendations(metrics, anomalies, processes);
  const narrative = generateNarrative(metrics, anomalies, processes, summary);
  const dimensions = Object.entries(health.dimensions).map(([key, val]) => ({
    key, name: key,
    score: val.score, trend: val.trend,
    change: val.delta,
    sparkline: [val.score - 5, val.score - 3, val.score - 2, val.score - 1, val.score, val.score + 1],
  }));

  // Filtered metrics
  const filteredMetrics = metrics
    .filter(m => metricFilter === 'all' || m.status === metricFilter)
    .filter(m => !metricSearch || m.name.toLowerCase().includes(metricSearch.toLowerCase()));

  // Filtered anomalies
  const filteredAnomalies = anomalies
    .filter(a => anomalyFilter === 'all' || a.severity === anomalyFilter);

  const tabs = [
    { id: 'dashboard', label: 'Operations Dashboard', icon: <Gauge size={14} /> },
    { id: 'monitoring', label: 'Live Monitoring', icon: <Activity size={14} />, count: metrics.length || undefined },
    { id: 'anomalies', label: 'Anomaly Detection', icon: <AlertTriangle size={14} />, count: anomalies.filter(a => a.severity === 'critical' || a.severity === 'high').length || undefined },
    { id: 'processes', label: 'Process Mining', icon: <GitBranch size={14} /> },
    { id: 'correlations', label: 'Cross-System Correlations', icon: <Link2 size={14} /> },
  ];

  if (loading) {
    return (
      <div className="space-y-6 animate-fadeIn">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold t-primary">Atheon Pulse</h1>
          <p className="text-sm t-muted mt-1">Process Intelligence — real-time operational monitoring, anomaly detection & process mining</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <SkeletonCard key={i} />)}
        </div>
        <div className="flex items-center justify-center h-48">
          <Loader2 className="w-8 h-8 text-accent animate-spin" />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h1 className="text-3xl sm:text-4xl font-bold t-primary">Atheon Pulse</h1>
        <p className="text-sm t-muted mt-1">Process Intelligence — real-time operational monitoring, anomaly detection & process mining</p>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* ══════════════════════════════════════════════════════
          TAB 1: Operations Dashboard
          ══════════════════════════════════════════════════════ */}
      {activeTab === 'dashboard' && (
        <TabPanel>
          {/* Top Row: Health Ring + Dimensions */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <Card variant="black" className="lg:col-span-1 flex flex-col items-center justify-center">
              <ScoreRing score={health.score} size="xl" label="Operational Health" sublabel="Composite Index" />
              <div className="flex items-center gap-2 mt-4">
                {trendIcon(health.trend)}
                <span className={`text-sm ${health.trend === 'improving' ? 'text-emerald-400' : health.trend === 'declining' ? 'text-red-400' : 'text-gray-400'}`}>
                  {health.trend === 'improving' ? 'Improving' : health.trend === 'declining' ? 'Needs Attention' : 'Stable'}
                </span>
              </div>
              {health.score === 0 && (
                <p className="text-xs t-muted mt-4 text-center">No health data yet. Run a catalyst to populate metrics.</p>
              )}
            </Card>

            <Card className="lg:col-span-2">
              <h3 className="text-lg font-semibold t-primary mb-4">Operational Dimensions</h3>
              {dimensions.length === 0 || health.score === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Gauge className="w-10 h-10 t-muted mb-3 opacity-30" />
                  <p className="text-sm t-muted">No dimensions available yet.</p>
                  <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to start generating operational insights.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {dimensions.map((dim) => (
                    <div key={dim.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
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
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </div>

          {/* Status Breakdown Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            <Card hover onClick={() => { setMetricFilter('all'); setActiveTab('monitoring'); }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Total Metrics</span>
                <Activity size={14} className="text-accent" />
              </div>
              <p className="text-2xl font-bold t-primary">{summary?.totalMetrics ?? metrics.length}</p>
              <p className="text-[10px] t-muted mt-1">Being monitored</p>
            </Card>
            <Card hover onClick={() => { setMetricFilter('green'); setActiveTab('monitoring'); }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Healthy</span>
                <CheckCircle2 size={14} className="text-emerald-400" />
              </div>
              <p className="text-2xl font-bold text-emerald-400">{summary?.statusBreakdown?.green ?? metrics.filter(m => m.status === 'green').length}</p>
              <p className="text-[10px] t-muted mt-1">Within thresholds</p>
            </Card>
            <Card hover onClick={() => { setMetricFilter('amber'); setActiveTab('monitoring'); }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Warning</span>
                <AlertTriangle size={14} className="text-amber-400" />
              </div>
              <p className="text-2xl font-bold text-amber-400">{summary?.statusBreakdown?.amber ?? metrics.filter(m => m.status === 'amber').length}</p>
              <p className="text-[10px] t-muted mt-1">Approaching limits</p>
            </Card>
            <Card hover onClick={() => { setMetricFilter('red'); setActiveTab('monitoring'); }}>
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs t-muted uppercase tracking-wider">Critical</span>
                <XCircle size={14} className="text-red-400" />
              </div>
              <p className="text-2xl font-bold text-red-400">{summary?.statusBreakdown?.red ?? metrics.filter(m => m.status === 'red').length}</p>
              <p className="text-[10px] t-muted mt-1">Breaching thresholds</p>
            </Card>
          </div>

          {/* Narrative + Recommendations */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Operational Narrative */}
            <Card variant="black">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-4 h-4 text-accent" />
                <h3 className="text-lg font-semibold">Operational Summary</h3>
                <Badge variant="info">Live</Badge>
              </div>
              <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>
                {narrative}
              </p>
            </Card>

            {/* Recommendations */}
            <Card>
              <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-emerald-400" /> Recommendations
              </h3>
              <div className="space-y-2.5">
                {recommendations.map((rec, i) => {
                  const Icon = rec.icon;
                  return (
                    <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>
                        {i + 1}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <span className="text-sm font-medium t-primary flex items-center gap-1.5">
                            <Icon size={12} className="text-accent flex-shrink-0" />
                            {rec.title}
                          </span>
                        </div>
                        <p className="text-xs t-muted mt-0.5">{rec.description}</p>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] t-muted">Priority: {rec.priority}</span>
                          <span className="text-[10px] t-muted">|</span>
                          <span className="text-[10px] t-muted">{rec.category}</span>
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
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            <div className="relative flex-1 min-w-48 max-w-sm">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
                placeholder="Search metrics..."
                value={metricSearch}
                onChange={e => setMetricSearch(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-1.5">
              <Filter size={14} className="text-gray-400" />
              {(['all', 'green', 'amber', 'red'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setMetricFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition-all ${
                    metricFilter === f
                      ? 'bg-accent/20 text-accent border border-accent/30'
                      : 'bg-[var(--bg-secondary)] border border-[var(--border-card)] t-muted hover:border-gray-400'
                  }`}
                >
                  {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredMetrics.length === 0 && (
              <div className="col-span-full flex flex-col items-center justify-center py-12 text-center">
                <Activity className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No metrics {metricFilter !== 'all' ? `with ${metricFilter} status` : 'available yet'}.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to start monitoring your processes.</p>
              </div>
            )}
            {filteredMetrics.map((metric) => {
              const isExpanded = expandedMetric === metric.id;
              return (
                <Card
                  key={metric.id}
                  hover
                  onClick={() => setExpandedMetric(isExpanded ? null : metric.id)}
                  className={isExpanded ? 'border-accent/20 col-span-1 md:col-span-2 lg:col-span-3' : ''}
                >
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-secondary truncate flex-1">{metric.name}</span>
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${
                        metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                      }`} />
                      {isExpanded ? <ChevronUp size={12} className="text-gray-400" /> : <ChevronDown size={12} className="text-gray-400" />}
                    </div>
                  </div>

                  <div className="flex items-end justify-between">
                    <div>
                      <span className={`text-2xl font-bold ${statusColor(metric.status)}`}>{metric.value}</span>
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
                    <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
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
                            <span className="text-[10px] t-muted uppercase tracking-wider">Current Value</span>
                            <p className={`text-lg font-bold mt-0.5 ${statusColor(metric.status)}`}>{metric.value} {metric.unit}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Green Threshold</span>
                            <p className="text-lg font-bold text-emerald-400 mt-0.5">{metric.thresholds?.green ?? '\u2014'}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Amber Threshold</span>
                            <p className="text-lg font-bold text-amber-400 mt-0.5">{metric.thresholds?.amber ?? '\u2014'}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Red Threshold</span>
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
                            <span className="text-xs font-bold t-primary w-16 text-right">{metric.value} {metric.unit}</span>
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
                        <div className="flex items-center gap-4 text-[10px] t-muted">
                          {metric.sourceSystem && <span>Source: {metric.sourceSystem}</span>}
                          {metric.measuredAt && <span>Last measured: {new Date(metric.measuredAt).toLocaleString()}</span>}
                        </div>
                      </div>

                      {/* What This Means */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-2">
                          <Lightbulb className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">What This Means</h4>
                        </div>
                        <p className="text-sm t-muted leading-relaxed">
                          <span className="font-medium t-primary">{metric.name}</span> is currently at{' '}
                          <span className={`font-medium ${statusColor(metric.status)}`}>{metric.value} {metric.unit}</span>
                          {metric.status === 'green' && ', which is within healthy operational parameters. Continue monitoring to maintain this performance.'}
                          {metric.status === 'amber' && '. This is approaching warning levels — consider proactive investigation to prevent escalation to critical status.'}
                          {metric.status === 'red' && '. This has breached the critical threshold and requires immediate attention. Investigate root cause and implement corrective action.'}
                        </p>
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
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <AlertTriangle className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No anomalies {anomalyFilter !== 'all' ? `with ${anomalyFilter} severity` : 'detected yet'}.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to start anomaly detection.</p>
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
                          <Badge variant={severityVariant(anom.severity)}>{anom.severity}</Badge>
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
                          <span className="text-[10px] text-gray-400">Expected</span>
                          <p className="text-sm font-medium t-secondary">{anom.expectedValue}</p>
                        </div>
                        <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                          <span className="text-[10px] text-gray-400">Actual</span>
                          <p className="text-sm font-medium text-red-400">{anom.actualValue}</p>
                        </div>
                        <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                          <span className="text-[10px] text-gray-400">Detected</span>
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
                                <span className="text-[10px] t-muted uppercase tracking-wider">Deviation</span>
                                <p className={`text-lg font-bold mt-0.5 ${deviationPct >= 50 ? 'text-red-400' : deviationPct >= 25 ? 'text-amber-400' : 'text-accent'}`}>+{deviationPct}%</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-[10px] t-muted uppercase tracking-wider">Severity</span>
                                <p className={`text-lg font-bold mt-0.5 capitalize ${anom.severity === 'critical' ? 'text-red-400' : anom.severity === 'high' ? 'text-amber-400' : 'text-accent'}`}>{anom.severity}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-[10px] t-muted uppercase tracking-wider">Status</span>
                                <p className="text-lg font-bold t-primary mt-0.5 capitalize">{anom.status || 'open'}</p>
                              </div>
                              <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <span className="text-[10px] t-muted uppercase tracking-wider">Delta</span>
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

                          {/* Recommended Actions */}
                          <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                            <div className="flex items-center gap-2 mb-3">
                              <Shield className="w-4 h-4 text-accent" />
                              <h4 className="text-sm font-semibold t-primary">Recommended Next Steps</h4>
                            </div>
                            <div className="space-y-2.5">
                              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>1</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">Investigate root cause: {anom.hypothesis}</span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] t-muted">Priority: {anom.severity === 'critical' ? 'Immediate' : 'Short-term'}</span>
                                    <span className="text-[10px] t-muted">|</span>
                                    <span className="text-[10px] t-muted">Owner: Operations Team</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>2</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">Verify data quality and check for upstream system changes</span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] t-muted">Priority: Short-term</span>
                                    <span className="text-[10px] t-muted">|</span>
                                    <span className="text-[10px] t-muted">Owner: Data Engineering</span>
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                                <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>3</div>
                                <div className="flex-1">
                                  <span className="text-sm t-primary">{deviationPct >= 50 ? 'Escalate to management and implement corrective action plan' : 'Monitor for recurrence and adjust thresholds if necessary'}</span>
                                  <div className="flex items-center gap-2 mt-1">
                                    <span className="text-[10px] t-muted">Priority: {deviationPct >= 50 ? 'Immediate' : 'Medium-term'}</span>
                                    <span className="text-[10px] t-muted">|</span>
                                    <span className="text-[10px] t-muted">Owner: {deviationPct >= 50 ? 'Management' : 'Operations Team'}</span>
                                  </div>
                                </div>
                              </div>
                            </div>
                          </div>

                          {/* Status Footer */}
                          <div className="flex items-center justify-between pt-2">
                            <div className="flex items-center gap-2">
                              <Badge variant={anom.status === 'resolved' ? 'success' : anom.status === 'investigating' ? 'info' : 'warning'} size="sm">
                                {anom.status || 'open'}
                              </Badge>
                              <span className="text-[10px] t-muted">Detected: {new Date(anom.detectedAt).toLocaleString()}</span>
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
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <GitBranch className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No process flows mapped yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to discover and map your business processes.</p>
              </div>
            )}

            {/* Process Health Summary */}
            {processes.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-muted uppercase tracking-wider">Processes</span>
                    <GitBranch size={14} className="text-accent" />
                  </div>
                  <p className="text-2xl font-bold t-primary">{processes.length}</p>
                  <p className="text-[10px] t-muted mt-1">Mapped & monitored</p>
                </Card>
                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-muted uppercase tracking-wider">Avg Conformance</span>
                    <Target size={14} className="text-emerald-400" />
                  </div>
                  <p className={`text-2xl font-bold ${
                    (processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length) >= 80 ? 'text-emerald-400' : 'text-amber-400'
                  }`}>{Math.round(processes.reduce((s, p) => s + p.conformanceRate, 0) / processes.length)}%</p>
                  <p className="text-[10px] t-muted mt-1">Target: 85%+</p>
                </Card>
                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-muted uppercase tracking-wider">Total Variants</span>
                    <Workflow size={14} className="text-blue-400" />
                  </div>
                  <p className="text-2xl font-bold t-primary">{processes.reduce((s, p) => s + p.variants, 0)}</p>
                  <p className="text-[10px] t-muted mt-1">Across all processes</p>
                </Card>
                <Card>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs t-muted uppercase tracking-wider">Bottlenecks</span>
                    <AlertTriangle size={14} className="text-red-400" />
                  </div>
                  <p className={`text-2xl font-bold ${processes.reduce((s, p) => s + p.bottlenecks.length, 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                    {processes.reduce((s, p) => s + p.bottlenecks.length, 0)}
                  </p>
                  <p className="text-[10px] t-muted mt-1">Steps requiring attention</p>
                </Card>
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
                        <span>Avg duration: {flow.avgDuration} days</span>
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
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-400">
                            <span>{step.avgDuration}d avg</span>
                            <span>{step.throughput}/day</span>
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
                            <span className="text-[10px] t-muted uppercase tracking-wider">Conformance</span>
                            <p className={`text-lg font-bold mt-0.5 ${flow.conformanceRate >= 85 ? 'text-emerald-400' : flow.conformanceRate >= 70 ? 'text-amber-400' : 'text-red-400'}`}>{flow.conformanceRate}%</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Step Health</span>
                            <p className={`text-lg font-bold mt-0.5 ${stepHealth >= 80 ? 'text-emerald-400' : 'text-amber-400'}`}>{stepHealth}%</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Avg Duration</span>
                            <p className="text-lg font-bold t-primary mt-0.5">{flow.avgDuration}d</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Process Variants</span>
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
                                  <span className="flex items-center gap-1"><Clock size={10} /> {step.avgDuration}d</span>
                                  <span className="flex items-center gap-1"><Zap size={10} /> {step.throughput}/day</span>
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

                      {/* Optimisation Recommendations */}
                      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                        <div className="flex items-center gap-2 mb-3">
                          <Lightbulb className="w-4 h-4 text-accent" />
                          <h4 className="text-sm font-semibold t-primary">Optimisation Recommendations</h4>
                        </div>
                        <div className="space-y-2.5">
                          {flow.bottlenecks.length > 0 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>1</div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Address bottleneck{flow.bottlenecks.length > 1 ? 's' : ''} at: {flow.bottlenecks.join(', ')}</span>
                                <p className="text-[10px] t-muted mt-0.5">Consider resource reallocation, automation, or process redesign to reduce cycle time.</p>
                              </div>
                            </div>
                          )}
                          {flow.variants > 3 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>{flow.bottlenecks.length > 0 ? '2' : '1'}</div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Reduce process variants from {flow.variants} to improve standardisation</span>
                                <p className="text-[10px] t-muted mt-0.5">High variant count suggests inconsistent execution. Review and enforce SOPs.</p>
                              </div>
                            </div>
                          )}
                          {flow.conformanceRate < 85 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>
                                {(flow.bottlenecks.length > 0 ? 1 : 0) + (flow.variants > 3 ? 1 : 0) + 1}
                              </div>
                              <div className="flex-1">
                                <span className="text-sm t-primary">Improve conformance from {flow.conformanceRate}% to target 85%+</span>
                                <p className="text-[10px] t-muted mt-0.5">Identify top deviation paths and implement controls to guide process execution.</p>
                              </div>
                            </div>
                          )}
                          {flow.bottlenecks.length === 0 && flow.variants <= 3 && flow.conformanceRate >= 85 && (
                            <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                              <CheckCircle2 className="w-5 h-5 text-emerald-400 flex-shrink-0 mt-0.5" />
                              <div className="flex-1">
                                <span className="text-sm t-primary">This process is performing well</span>
                                <p className="text-[10px] t-muted mt-0.5">No immediate optimisations required. Continue monitoring for drift.</p>
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
                  <span className="text-xs t-muted uppercase tracking-wider">Correlations</span>
                  <Link2 size={14} className="text-accent" />
                </div>
                <p className="text-2xl font-bold t-primary">{correlations.length}</p>
                <p className="text-[10px] t-muted mt-1">Discovered patterns</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs t-muted uppercase tracking-wider">Avg Confidence</span>
                  <Target size={14} className="text-emerald-400" />
                </div>
                <p className={`text-2xl font-bold ${
                  (correlations.reduce((s, c) => s + c.confidence, 0) / correlations.length) >= 0.7 ? 'text-emerald-400' : 'text-amber-400'
                }`}>{Math.round((correlations.reduce((s, c) => s + c.confidence, 0) / correlations.length) * 100)}%</p>
                <p className="text-[10px] t-muted mt-1">Pattern reliability</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs t-muted uppercase tracking-wider">Unique Systems</span>
                  <Workflow size={14} className="text-blue-400" />
                </div>
                <p className="text-2xl font-bold t-primary">
                  {new Set([...correlations.map(c => c.sourceSystem), ...correlations.map(c => c.targetSystem)]).size}
                </p>
                <p className="text-[10px] t-muted mt-1">Connected sources</p>
              </Card>
              <Card>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs t-muted uppercase tracking-wider">Avg Lag</span>
                  <Clock size={14} className="text-gray-400" />
                </div>
                <p className="text-2xl font-bold t-primary">{Math.round(correlations.reduce((s, c) => s + c.lagDays, 0) / correlations.length)}d</p>
                <p className="text-[10px] t-muted mt-1">Between events</p>
              </Card>
            </div>
          )}

          <div className="space-y-4">
            {correlations.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Link2 className="w-10 h-10 t-muted mb-3 opacity-30" />
                <p className="text-sm t-muted">No correlations discovered yet.</p>
                <p className="text-xs t-muted mt-1">Run a catalyst to identify cross-system correlations.</p>
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
                        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-[var(--bg-secondary)] border border-[var(--border-card)] text-[10px] text-gray-500">
                          {event.lagDays}d lag
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
                      <span className="text-[10px] text-gray-400">Source Event</span>
                      <p className="text-sm t-secondary">{event.sourceEvent}</p>
                    </div>
                    <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                      <span className="text-[10px] text-gray-400">Target Impact</span>
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
                            <span className="text-[10px] t-muted uppercase tracking-wider">Confidence</span>
                            <p className={`text-lg font-bold mt-0.5 ${confidenceColor(event.confidence)}`}>
                              {confidenceLabel(event.confidence)}
                            </p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Time Lag</span>
                            <p className="text-lg font-bold t-primary mt-0.5">{event.lagDays} day{event.lagDays !== 1 ? 's' : ''}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Source</span>
                            <p className="text-lg font-bold text-accent mt-0.5">{event.sourceSystem}</p>
                          </div>
                          <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <span className="text-[10px] t-muted uppercase tracking-wider">Target</span>
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
                            <span className="font-medium t-primary">{event.lagDays} day{event.lagDays !== 1 ? 's' : ''}</span>.
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
                              <p className="text-[10px] t-muted mt-0.5">Use the {event.lagDays}-day lag as a predictive window to prepare for downstream impact.</p>
                            </div>
                          </div>
                          <div className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                            <Shield className="w-4 h-4 text-accent mt-0.5 flex-shrink-0" />
                            <div className="flex-1">
                              <span className="text-sm t-primary">Build contingency plans for <span className="font-medium">{event.targetImpact.toLowerCase()}</span></span>
                              <p className="text-[10px] t-muted mt-0.5">Pre-position resources and response protocols to mitigate impact when the source event is detected.</p>
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center gap-2 text-[10px] t-muted">
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
    </div>
  );
}
