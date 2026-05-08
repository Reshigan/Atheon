import { useState, useEffect, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel } from "@/components/ui/tabs";

import { api } from "@/lib/api";
import { ActionQueuePanel } from "@/components/dashboard/ActionQueuePanel";
import { useSelectedCompanyId } from "@/stores/appStore";
import { ProvenanceLink } from "@/components/ui/provenance-link";
import { usePullToRefresh } from "@/hooks/usePullToRefresh";
import { cleanLlmText } from "@/lib/utils";
import type { HealthScore, Briefing, Risk, ScenarioItem, HealthHistoryResponse, HealthDimensionTraceResponse, RiskTraceResponse, ApexInsightsResponse, RadarContextResponse, BoardReportItem, PeerBenchmarksResponse } from "@/lib/api";
import { PeerComparisonBar } from "@/components/ui/peer-comparison-bar";
import { Portal } from "@/components/ui/portal";
import { TraceabilityModal } from "@/components/TraceabilityModal";
import { Skeleton } from "@/components/ui/skeleton";
import { FlipCard } from "@/components/ui/flip-card";
import {
 Crown, TrendingUp, TrendingDown, Minus, AlertTriangle, FileText,
 Play, BarChart3, Shield, Lightbulb, Loader2, AlertCircle, X,
 Plus, ChevronRight, ChevronLeft, Trash2, Link2, ArrowRight, Eye,
 CheckCircle2, XCircle, Gauge, Radar, Globe, Zap, RefreshCw, PinOff, Pin, Sparkles
} from "lucide-react";
import { CSVExportButton } from "@/components/common/CSVExportButton";
import { SectionFreshness } from "@/components/common/FreshnessIndicator";
import { RiskMatrix } from "./apex/RiskMatrix";
import { DimensionComparisonGrid } from "@/components/DimensionComparisonGrid";
import { HealthTrendChart } from "@/components/HealthTrendChart";
import { RiskHeatMap } from "@/components/RiskHeatMap";
import { ScenarioComparisonGrid } from "@/components/ScenarioComparisonGrid";
import { recommendForRisk, catalystDeployUrl } from "@/lib/catalyst-recommendation";


const trendIcon = (trend: string, size = 14) => {
 if (trend === 'up' || trend === 'improving') return <TrendingUp size={size} className="text-emerald-400" />;
 if (trend === 'down' || trend === 'declining') return <TrendingDown size={size} className="text-red-400" />;
 return <Minus size={size} className="text-gray-400" />;
};

const severityColor = (s: string) => s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

const riskImpactLabel = (probability: number) => probability >= 0.7 ? 'Very High' : probability >= 0.5 ? 'High' : probability >= 0.3 ? 'Medium' : 'Low';
const riskLikelihoodBar = (probability: number) => Math.round(probability * 100);

/**
 * Pre-built scenario templates — solve the blank-page problem on the
 * What-If tab. Each template fully specifies the inputs to
 * `api.apex.createScenario()` so a click runs the analysis end-to-end
 * without the user filling the 3-step wizard from scratch. Templates
 * cover the executive-grade questions a CEO actually asks: customer
 * concentration, input shocks, FX, supplier risk, workforce, working
 * capital. Add a new template by appending an entry — the UI grid auto-
 * resizes.
 */
interface ScenarioTemplate {
  id: string;
  title: string;
  description: string;
  modelType: 'what-if' | 'sensitivity' | 'monte-carlo' | 'stress-test';
  query: string;
  variables: Array<{ name: string; baseValue: string }>;
}

const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    id: 'top-3-customer-loss',
    title: 'Lose top 3 customers',
    description: 'Revenue + cash impact if the three largest customers churn within a quarter.',
    modelType: 'what-if',
    query: 'Quantify revenue and free-cash-flow impact if our top 3 customers by revenue churn within the next 90 days. Compare against current run-rate; flag the biggest single-point-of-failure.',
    variables: [
      { name: 'top_customer_count', baseValue: '3' },
      { name: 'churn_window_days', baseValue: '90' },
    ],
  },
  {
    id: 'input-cost-shock-15',
    title: 'Input cost shock +15%',
    description: 'Margin compression from a sustained 15% rise in raw-material or COGS inputs.',
    modelType: 'sensitivity',
    query: 'Project gross margin and EBITDA under a sustained +15% rise in cost-of-goods inputs over the next 6 months. Identify which product lines erode fastest and whether price pass-through is feasible.',
    variables: [
      { name: 'input_cost_increase_pct', baseValue: '15' },
      { name: 'horizon_months', baseValue: '6' },
    ],
  },
  {
    id: 'fx-zar-usd-10',
    title: 'ZAR/USD ±10%',
    description: 'P&L sensitivity to a 10-percent move in ZAR/USD on imports and exports.',
    modelType: 'sensitivity',
    query: 'Run a P&L sensitivity to a ±10% move in ZAR/USD across all foreign-currency receivables, payables, and inventory holdings. Highlight natural-hedge opportunities.',
    variables: [
      { name: 'zar_usd_move_pct', baseValue: '10' },
    ],
  },
  {
    id: 'key-supplier-default',
    title: 'Key supplier defaults',
    description: 'Operational and revenue impact if our highest-risk supplier fails to deliver.',
    modelType: 'stress-test',
    query: 'Identify the supplier with the highest combined risk score × open PO value, and project operational + revenue impact if they default on outstanding deliveries. Recommend secondary-source switching or buffer-stock build.',
    variables: [
      { name: 'risk_threshold', baseValue: '0.6' },
    ],
  },
  {
    id: 'attrition-spike',
    title: 'Workforce attrition +25%',
    description: 'Capacity and replacement-cost impact if voluntary attrition rises 25 percent.',
    modelType: 'sensitivity',
    query: 'Project capacity loss and recruiting-cost impact if voluntary attrition rises 25% above the trailing 12-month baseline. Highlight the departments most exposed.',
    variables: [
      { name: 'attrition_uplift_pct', baseValue: '25' },
    ],
  },
  {
    id: 'ar-collection-delay-30d',
    title: 'AR collection delay +30 days',
    description: 'Working-capital impact if days-sales-outstanding rises by a full month.',
    modelType: 'what-if',
    query: 'Project working-capital and short-term funding impact if AR days-sales-outstanding rises by 30 days across the customer base. Flag which customer segments are most likely to drive this drift.',
    variables: [
      { name: 'dso_increase_days', baseValue: '30' },
    ],
  },
];

/**
 * Executive Brief hero — three cards above the tabs delivering on the
 * "Executive Intelligence" promise on first paint. No tab clicks, no AI
 * Insights button required.
 *
 *   1. Health      — overall score + delta vs prior period
 *   2. Top Risks   — top 3 by impact value, jump-link to Risk Overview tab
 *   3. Strategic Signal — most recent / highest-relevance radar signal
 *
 * Each card stays useful when its data is empty — it tells the user what
 * needs to happen to populate it (no silent blank cards).
 */
function ExecutiveBriefHero({
  health, healthHistory, briefing, risks, radarContext, onJumpToTab,
}: {
  health: HealthScore | null;
  healthHistory: HealthHistoryResponse | null;
  briefing: Briefing | null;
  risks: Risk[];
  radarContext: RadarContextResponse | null;
  onJumpToTab: (id: string) => void;
}): JSX.Element {
  const overall = health?.overall ?? 0;
  const histPoints = healthHistory?.history?.map(h => h.overallScore) ?? [];
  const delta = healthHistory?.delta ?? briefing?.healthDelta ?? null;
  const deltaPositive = (delta ?? 0) > 0;

  const top3 = [...risks]
    .filter(r => r.severity === 'critical' || r.severity === 'high')
    .sort((a, b) => (b.impactValue || 0) - (a.impactValue || 0))
    .slice(0, 3);

  const topSignal = radarContext?.signals
    ?.slice()
    .sort((a, b) => (b.relevanceScore || 0) - (a.relevanceScore || 0))[0];

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4" data-testid="apex-brief-hero">
      {/* ── Health ── */}
      <Card className="p-5 cursor-pointer hover:border-accent/40 transition-colors" onClick={() => onJumpToTab('health')}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Crown className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold t-primary">Business Health</h3>
          </div>
          {delta !== null && (
            <span className={`text-xs font-medium ${deltaPositive ? 'text-emerald-400' : delta < 0 ? 'text-red-400' : 't-muted'}`}>
              {deltaPositive ? '+' : ''}{delta} pts
            </span>
          )}
        </div>
        <div className="flex items-center gap-4">
          <ScoreRing score={overall} size="md" />
          <div className="flex-1 min-w-0">
            <div className="text-3xl font-semibold t-primary leading-none">{Math.round(overall)}</div>
            <div className="text-xs t-muted mt-1">
              {overall >= 80 ? 'Strong posture' : overall >= 60 ? 'Mixed posture' : overall > 0 ? 'Action required' : 'Awaiting data'}
            </div>
            {histPoints.length >= 2 && (
              <div className="mt-2"><Sparkline data={histPoints} width={120} height={20} /></div>
            )}
          </div>
        </div>
      </Card>

      {/* ── Top Risks ── */}
      <Card className="p-5 cursor-pointer hover:border-accent/40 transition-colors" onClick={() => onJumpToTab('risks')}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400" />
            <h3 className="text-sm font-semibold t-primary">Top Risks</h3>
          </div>
          <span className="text-xs t-muted">{risks.length} active</span>
        </div>
        {top3.length > 0 ? (
          <div className="space-y-2">
            {top3.map(r => (
              <div key={r.id} className="flex items-start gap-2 text-xs">
                <Badge variant={severityColor(r.severity)} size="sm">{r.severity}</Badge>
                <div className="flex-1 min-w-0">
                  <div className="t-primary font-medium truncate">{r.title}</div>
                  {r.impactValue ? (
                    <div className="t-muted text-[10px] mt-0.5">
                      Impact: {r.impactUnit === 'ZAR' || r.impactUnit === 'currency'
                        ? `R${Math.round(r.impactValue).toLocaleString()}`
                        : `${r.impactValue.toLocaleString()} ${r.impactUnit ?? ''}`}
                    </div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-xs t-muted py-3">
            No critical or high risks active.
            {risks.length === 0 && ' Run an assessment to populate the risk register.'}
          </div>
        )}
      </Card>

      {/* ── Strategic Signal ── */}
      <Card className="p-5 cursor-pointer hover:border-accent/40 transition-colors" onClick={() => onJumpToTab('strategic-context')}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Radar className="w-4 h-4 text-accent" />
            <h3 className="text-sm font-semibold t-primary">Strategic Signal</h3>
          </div>
          {radarContext?.summary ? (
            <span className="text-xs t-muted">{radarContext.summary.activeSignals} active</span>
          ) : null}
        </div>
        {topSignal ? (
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant={severityColor(topSignal.severity)} size="sm">{topSignal.severity}</Badge>
              <span className="text-[10px] t-muted uppercase tracking-wider">{topSignal.signalType}</span>
            </div>
            <div className="text-sm font-medium t-primary line-clamp-2 mb-1">{topSignal.title}</div>
            <div className="text-xs t-muted line-clamp-2">{topSignal.description}</div>
          </div>
        ) : briefing?.summary ? (
          <div className="text-xs t-secondary line-clamp-4 leading-relaxed">{briefing.summary}</div>
        ) : (
          <div className="text-xs t-muted py-3">
            No strategic signals captured yet. Sources from the Radar tab populate this card.
          </div>
        )}
      </Card>
    </div>
  );
}

export function ApexPage() {
 const navigate = useNavigate();
 const companyId = useSelectedCompanyId();
 const [activeTab, setActiveTab] = useState<string>('health');
 const [expandedRisk, setExpandedRisk] = useState<string | null>(null);
 const [health, setHealth] = useState<HealthScore | null>(null);
 const [briefing, setBriefing] = useState<Briefing | null>(null);
 const [risks, setRisks] = useState<Risk[]>([]);
 const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [creatingScenario, setCreatingScenario] = useState(false);
 const [actionError, setActionError] = useState<string | null>(null);
 // A1-4: Health history for sparkline + delta
 const [healthHistory, setHealthHistory] = useState<HealthHistoryResponse | null>(null);
 
 
 // Flip card state for dashboard cards
 const [flippedCards, setFlippedCards] = useState<Record<string, boolean>>({});
 const toggleFlip = (cardId: string) => setFlippedCards(prev => ({ ...prev, [cardId]: !prev[cardId] }));

 // Traceability modal state
 const [showTraceabilityModal, setShowTraceabilityModal] = useState(false);
 const [traceabilityData, setTraceabilityData] = useState<HealthDimensionTraceResponse | RiskTraceResponse | null>(null);
 const [traceabilityType, setTraceabilityType] = useState<'dimension' | 'risk'>('dimension');

 // AI Executive Insights state
 const [execInsights, setExecInsights] = useState<ApexInsightsResponse | null>(null);
 const [execInsightsLoading, setExecInsightsLoading] = useState(false);

 // Radar / Strategic Context state
 const [radarContext, setRadarContext] = useState<RadarContextResponse | null>(null);
 const [radarLoading, setRadarLoading] = useState(false);
 const [radarSignalForm, setRadarSignalForm] = useState({ source_name: '', category: 'regulatory', title: '', summary: '', source_url: '', sentiment: 'neutral' });
 const [creatingSignal, setCreatingSignal] = useState(false);
 const [showSignalForm, setShowSignalForm] = useState(false);
 const [expandedSignal, setExpandedSignal] = useState<string | null>(null);
 const [boardReports, setBoardReports] = useState<BoardReportItem[]>([]);
 const [generatingReport, setGeneratingReport] = useState(false);
 const [showBoardReport, setShowBoardReport] = useState<string | null>(null);

 // §11.4 Peer Benchmarks state
 const [peerBenchmarks, setPeerBenchmarks] = useState<PeerBenchmarksResponse | null>(null);
 const [peerLoading, setPeerLoading] = useState(false);

 // 2.1.1 Dimension comparison state
 const [selectedDimensions, setSelectedDimensions] = useState<string[]>([]);
 const toggleDimensionCompare = (key: string) =>
  setSelectedDimensions(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]);

 // 2.1.3 Risk heat map filter state
 const [riskHeatFilter, setRiskHeatFilter] = useState<{ category: string; severity: string } | null>(null);
 const visibleRisks = riskHeatFilter
  ? risks.filter(r =>
     r.category?.toLowerCase() === riskHeatFilter.category.toLowerCase() &&
     (r.severity ?? '').toLowerCase() === riskHeatFilter.severity.toLowerCase()
    )
  : risks;

 // 2.1.4 Scenario comparison state
 const [selectedScenarios, setSelectedScenarios] = useState<string[]>([]);
 const toggleScenarioCompare = (id: string) =>
  setSelectedScenarios(prev => prev.includes(id) ? prev.filter(s => s !== id) : [...prev, id]);

 const handleGenerateBoardReport = async () => {
  setGeneratingReport(true);
  try {
   const report = await api.boardReport.generate();
   setBoardReports(prev => [report, ...prev]);
   setShowBoardReport(report.id);
  } catch (err) { console.error('Failed to generate board report:', err); }
  setGeneratingReport(false);
 };

 const loadRadarContext = async () => {
  setRadarLoading(true);
  try {
   const data = await api.radar.getContext();
   setRadarContext(data);
  } catch (err) { console.error('Failed to load radar context:', err); }
  setRadarLoading(false);
 };

 const handleCreateSignal = async () => {
  if (creatingSignal || !radarSignalForm.title.trim()) return;
  setCreatingSignal(true);
  try {
   await api.radar.createSignal({
    category: radarSignalForm.category,
    title: radarSignalForm.title,
    summary: radarSignalForm.summary,
    source_url: radarSignalForm.source_url || undefined,
    source_name: radarSignalForm.source_name || 'manual',
    sentiment: radarSignalForm.sentiment,
   });
   setShowSignalForm(false);
   setRadarSignalForm({ source_name: '', category: 'regulatory', title: '', summary: '', source_url: '', sentiment: 'neutral' });
   loadRadarContext();
  } catch (err) {
   setActionError(err instanceof Error ? err.message : 'Failed to create signal');
  }
  setCreatingSignal(false);
 };

 const loadExecInsights = async () => {
  setExecInsightsLoading(true);
  try {
   const result = await api.apex.insights(undefined, companyId || undefined);
   setExecInsights(result);
  } catch (err) { console.error('Failed to load executive insights:', err); }
  setExecInsightsLoading(false);
 };

 // Scenario Builder Modal state
 const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);
 const [builderStep, setBuilderStep] = useState(1);
 const [scenarioTitle, setScenarioTitle] = useState('');
 const [scenarioDescription, setScenarioDescription] = useState('');
 const [scenarioModelType, setScenarioModelType] = useState('what-if');
 const [scenarioQuery, setScenarioQuery] = useState('');
 const [scenarioVariables, setScenarioVariables] = useState<Array<{ name: string; baseValue: string }>>([{ name: '', baseValue: '' }]);
 
 const handleOpenDimensionTrace = async (dimension: string) => {
  try {
   const data = await api.apex.healthDimension(dimension, undefined, companyId || undefined);
   if (!data || data.score === null) {
     console.warn('No traceability data available for dimension:', dimension);
     setActionError('No traceability data available yet. Run a catalyst in this domain to generate health data.');
     return;
   }
   setTraceabilityData(data);
   setTraceabilityType('dimension');
   setShowTraceabilityModal(true);
  } catch (err) {
   console.error('Failed to load dimension traceability:', err);
   setActionError('Failed to load traceability data. Please ensure catalysts have been run for this domain.');
  }
 };
 
 const handleOpenRiskTrace = async (riskId: string) => {
  try {
   const data = await api.apex.riskTrace(riskId, undefined, companyId || undefined);
   if (!data || !data.riskAlert) {
     console.warn('No traceability data available for risk:', riskId);
     setActionError('No traceability data available for this risk.');
     return;
   }
   setTraceabilityData(data);
   setTraceabilityType('risk');
   setShowTraceabilityModal(true);
  } catch (err) {
   console.error('Failed to load risk traceability:', err);
   setActionError('Failed to load risk traceability data.');
  }
 };

 const resetScenarioBuilder = () => {
 setBuilderStep(1);
 setScenarioTitle('');
 setScenarioDescription('');
 setScenarioModelType('what-if');
 setScenarioQuery('');
 setScenarioVariables([{ name: '', baseValue: '' }]);
 };

 const handleCreateScenario = async () => {
 if (creatingScenario) return;
 setCreatingScenario(true);
 setActionError(null);
 try {
 const vars = scenarioVariables.filter(v => v.name.trim());
 const result = await api.apex.createScenario({
 title: scenarioTitle || `Scenario ${scenarios.length + 1}`,
 description: scenarioDescription || `${scenarioModelType} analysis`,
 input_query: scenarioQuery || `${scenarioModelType} analysis: ${vars.map(v => v.name).join(', ')}`,
 variables: vars.map(v => v.name),
 model_type: scenarioModelType,
 base_values: Object.fromEntries(vars.map(v => [v.name, v.baseValue])),
 });
 if (result.id) {
 const s = await api.apex.scenarios(undefined, undefined, companyId || undefined);
 setScenarios(s.scenarios);
 }
 setShowScenarioBuilder(false);
 resetScenarioBuilder();
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to create scenario');
 }
 setCreatingScenario(false);
 };

 const addVariable = () => setScenarioVariables(prev => [...prev, { name: '', baseValue: '' }]);
 const removeVariable = (idx: number) => setScenarioVariables(prev => prev.filter((_, i) => i !== idx));
 const updateVariable = (idx: number, field: 'name' | 'baseValue', value: string) =>
 setScenarioVariables(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));

 // One-click scenario from a curated template — bypasses the 3-step wizard
 // for the questions an exec actually asks. Closes the blank-page problem
 // on /apex What-If.
 const [runningTemplate, setRunningTemplate] = useState<string | null>(null);
 const runScenarioTemplate = async (template: ScenarioTemplate) => {
   if (runningTemplate) return;
   setRunningTemplate(template.id);
   setActionError(null);
   try {
     const result = await api.apex.createScenario({
       title: template.title,
       description: template.description,
       input_query: template.query,
       variables: template.variables.map(v => v.name),
       model_type: template.modelType,
       base_values: Object.fromEntries(template.variables.map(v => [v.name, v.baseValue])),
     });
     if (result.id) {
       const s = await api.apex.scenarios(undefined, undefined, companyId || undefined);
       setScenarios(s.scenarios);
     }
   } catch (err) {
     setActionError(err instanceof Error ? err.message : 'Failed to run scenario template');
   }
   setRunningTemplate(null);
 };

 // Data loader — extracted as a callback so both the initial effect and the
 // mobile pull-to-refresh gesture can reuse it.
 //
 // The hero strip above the tabs (Health · Top Risks · Strategic Signal) needs
 // health, risks, AND radar context populated on first paint, so radar is
 // eager-loaded here rather than tab-gated. Briefing carries the headline
 // narrative; without it the hero still works but loses its summary line.
 const loadApexData = useCallback(async (opts: { showLoading?: boolean } = {}) => {
  if (opts.showLoading) setLoading(true);
  const co = companyId || undefined;
  const [h, b, r, s, hh, br, rc] = await Promise.allSettled([
   api.apex.health(undefined, undefined, co),
   api.apex.briefing(undefined, undefined, co),
   api.apex.risks(undefined, undefined, co),
   api.apex.scenarios(undefined, undefined, co),
   api.apex.healthHistory(undefined, undefined, co),
   api.boardReport.list(),
   api.radar.getContext(),
  ]);
  if (h.status === 'fulfilled') setHealth(h.value);
  if (b.status === 'fulfilled') setBriefing(b.value);
  if (r.status === 'fulfilled') setRisks(r.value.risks);
  if (s.status === 'fulfilled') setScenarios(s.value.scenarios);
  if (hh.status === 'fulfilled') setHealthHistory(hh.value);
  if (br.status === 'fulfilled') setBoardReports(br.value.reports);
  if (rc.status === 'fulfilled') setRadarContext(rc.value);
  if (opts.showLoading) setLoading(false);
 }, [companyId]);

 useEffect(() => {
  loadApexData({ showLoading: true });
 }, [loadApexData]);

 // Mobile pull-to-refresh — active on small viewports where the page is a
 // single scroll column. On desktop the gesture is inert (no touch events).
 const { containerProps: pullProps, pullDistance, refreshing } = usePullToRefresh(
  () => loadApexData({ showLoading: false })
 );

 const overallScore = health?.overall ?? 0;
 const dimensions = health?.dimensions
 ? Object.entries(health.dimensions).map(([key, val]) => ({
 key, name: key.charAt(0).toUpperCase() + key.slice(1),
 score: val.score, trend: val.trend as string,
 change: val.delta ?? 0, weight: 0.2,
 sparkline: []}))
 .sort((a, b) => a.score - b.score) // Dynamic Layout: severity-driven sort (worst first)
 : [];

  const tabs = [
 { id: 'health', label: 'Business Health', icon: <Crown size={14} /> },
 { id: 'briefing', label: 'Leadership Summary', icon: <FileText size={14} /> },
 { id: 'risks', label: 'Risk Overview', icon: <AlertTriangle size={14} />, count: risks.length },
 { id: 'scenarios', label: 'What-If Analysis', icon: <BarChart3 size={14} /> },
 { id: 'strategic-context', label: 'Strategic Context', icon: <Radar size={14} />, count: radarContext?.summary?.activeSignals },
 { id: 'peer-benchmarks', label: 'Peer Benchmarks', icon: <Globe size={14} />, count: peerBenchmarks?.benchmarks?.length || undefined },
 ];

  const pageHeader = (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3">
      <h1 className="text-3xl sm:text-4xl font-bold t-primary">Apex</h1>
      <Badge variant="info">Executive Intelligence</Badge>
      <SectionFreshness section="Health" />
    </div>
  );

  if (loading) {
  return (
  <div className="space-y-6 animate-fadeIn">
  {pageHeader}
  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
  {[1,2,3,4].map(i => <Skeleton key={i} variant="card" height={120} />)}
  </div>
  <div className="flex items-center justify-center h-48">
  <Loader2 className="w-8 h-8 text-accent animate-spin" />
  </div>
  </div>
  );
  }

  return (
 <div
  ref={pullProps.ref}
  onTouchStart={pullProps.onTouchStart}
  onTouchMove={pullProps.onTouchMove}
  onTouchEnd={pullProps.onTouchEnd}
  className="space-y-6 animate-fadeIn"
 >
 {/* Mobile pull-to-refresh indicators (touch-only; invisible on desktop). */}
 {pullDistance > 0 && (
  <div className="flex justify-center py-2 md:hidden" style={{ height: pullDistance }}>
   <RefreshCw
    className={`w-5 h-5 t-muted ${pullDistance > 50 ? 'text-accent' : ''}`}
    style={{ transform: `rotate(${pullDistance * 3}deg)` }}
   />
  </div>
 )}
 {refreshing && (
  <div className="flex justify-center py-3 md:hidden">
   <RefreshCw className="w-5 h-5 text-accent animate-spin" />
  </div>
 )}
 <div className="space-y-4">
 {pageHeader}
 <div className="flex items-center gap-2 flex-shrink-0">
 <CSVExportButton endpoint="/api/radar/signals" filename="apex-radar-signals.csv" label="Export Signals" />
 <CSVExportButton endpoint="/api/board-report" filename="board-reports.csv" label="Export Reports" />
 </div>
 </div>

 {/* v63 — executive view of pending high-value write-back actions.
     Shows the actions awaiting CFO/CEO approval that move the savings
     numbers reported in the assessment from "advisory" to "realized". */}
 <ActionQueuePanel variant="executive" allowApprove limit={10} title="Actions awaiting your approval" />

 {actionError && (
 <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
 <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
 <p className="text-sm text-red-400 flex-1">{actionError}</p>
 <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300" title="Dismiss error"><X size={14} /></button>
 </div>
 )}

 {/*
   Executive Brief — three-card hero, generated above the fold so an
   executive opening Apex sees Health · Top Risks · Strategic Signal in
   the first paint instead of a tab carousel. Same data the tabs render;
   this is just structural promotion. Each card links to its tab for
   drill-down. See PR (this one) and IA audit notes in commit message.
 */}
 <ExecutiveBriefHero
   health={health}
   healthHistory={healthHistory}
   briefing={briefing}
   risks={risks}
   radarContext={radarContext}
   onJumpToTab={setActiveTab}
 />

 <div className="flex items-center gap-3">
  <div className="flex-1 overflow-x-auto">
   <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
  </div>
  <button
   onClick={loadExecInsights}
   disabled={execInsightsLoading}
   className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 transition-all disabled:opacity-50 flex-shrink-0"
   title="Generate AI-powered executive insights"
  >
   <Lightbulb size={12} className={execInsightsLoading ? 'animate-pulse' : ''} />
   {execInsightsLoading ? 'Analyzing...' : 'AI Insights'}
  </button>
 </div>

 {/* AI Executive Insights Panel */}
 {execInsights && (
  <Card className="border-purple-500/20 bg-purple-500/5">
   <div className="flex items-center justify-between mb-3">
    <div className="flex items-center gap-2">
     <Lightbulb size={16} className="text-purple-400" />
     <h3 className="text-sm font-semibold t-primary">Atheon Intelligence — Executive Summary</h3>
    </div>
    <span className="text-[10px] t-muted">{execInsights.poweredBy}</span>
   </div>
   <p className="text-sm t-secondary mb-3 whitespace-pre-line">{cleanLlmText(execInsights.executiveSummary)}</p>
   {execInsights.performanceDrivers.length > 0 && (
    <div className="mb-3">
     <p className="text-xs font-medium t-primary mb-1.5">Performance Drivers</p>
     <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {execInsights.performanceDrivers.map((d, i) => (
       <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
        <div className="flex-1">
         <p className="text-xs font-medium t-primary">{d.dimension}</p>
         <p className="text-[10px] t-muted">{d.driver}</p>
        </div>
        <Badge variant={d.impact === 'positive' ? 'success' : d.impact === 'negative' ? 'danger' : 'default'} size="sm">{d.trend}</Badge>
       </div>
      ))}
     </div>
    </div>
   )}
   {execInsights.issues.length > 0 && (
    <div className="mb-3">
     <p className="text-xs font-medium t-primary mb-1.5">Key Issues</p>
     <div className="space-y-1.5">
      {execInsights.issues.map((issue, i) => (
       <div key={i} className="flex items-start gap-2 text-xs">
        <AlertTriangle size={10} className={issue.severity === 'critical' ? 'text-red-400' : issue.severity === 'high' ? 'text-amber-400' : 'text-gray-400'} />
        <div>
         <span className="font-medium t-primary">{issue.title}</span>
         <span className="t-muted"> — {issue.description}</span>
         <Badge variant="info" size="sm" className="ml-1">{issue.affectedDomain}</Badge>
        </div>
       </div>
      ))}
     </div>
    </div>
   )}
   {execInsights.crossDepartmentCorrelations.length > 0 && (
    <div className="mb-3">
     <p className="text-xs font-medium t-primary mb-1.5">Cross-Department Correlations</p>
     <div className="flex flex-wrap gap-1.5">
      {execInsights.crossDepartmentCorrelations.map((c, i) => (
       <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[10px] t-muted border border-[var(--border-card)]">
        {c}
       </span>
      ))}
     </div>
    </div>
   )}
   {execInsights.strategicImplications.length > 0 && (
    <div>
     <p className="text-xs font-medium t-primary mb-1.5">Strategic Implications</p>
     <ul className="space-y-1">
      {execInsights.strategicImplications.map((s, i) => (
       <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
        <ArrowRight size={10} className="text-purple-400 mt-0.5 flex-shrink-0" />
        {s}
       </li>
      ))}
     </ul>
    </div>
   )}
  </Card>
 )}

 {/* Business Health Tab */}
 {activeTab === 'health' && (
 <TabPanel>
  {/*
   * Mobile-only above-the-fold strip (consolidated from ExecutiveMobilePage):
   * a tight 3-card summary (overall score + quick counts) plus a horizontal
   * scroll-snap KPI carousel for dimensions. Hidden on md+ where the full
   * grid below provides the same information in a richer layout.
   */}
  <div className="md:hidden space-y-4 mb-4">
   <div className="grid grid-cols-3 gap-2">
    <Card className="flex flex-col items-center justify-center py-3 px-2">
     <ScoreRing score={overallScore} size="sm" />
     <p className="text-[10px] t-muted mt-1 text-center">Health</p>
    </Card>
    <Card className="flex flex-col items-center justify-center py-3 px-2">
     <p className="text-2xl font-bold text-red-400">{risks.length}</p>
     <p className="text-[10px] t-muted text-center">Risks</p>
    </Card>
    <Card className="flex flex-col items-center justify-center py-3 px-2">
     <p className="text-2xl font-bold text-amber-400">{dimensions.filter(d => d.score < 60).length}</p>
     <p className="text-[10px] t-muted text-center">Critical</p>
    </Card>
   </div>

   {dimensions.length > 0 && (
    <div
     className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-2 -mx-4 px-4"
     style={{ scrollbarWidth: 'none' }}
     aria-label="Business dimension KPIs"
    >
     {dimensions.map((dim) => (
      <button
       key={dim.key}
       onClick={() => handleOpenDimensionTrace(dim.key)}
       className="snap-center flex-shrink-0 w-[140px] rounded-xl p-4 text-left hover:bg-[var(--bg-secondary)] transition-colors"
       style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)', minHeight: 44 }}
       aria-label={`${dim.name} dimension — open traceability`}
      >
       <p className="text-[10px] t-muted uppercase tracking-wider mb-1">{dim.name}</p>
       <p className="text-xl font-bold t-primary">{dim.score}</p>
       <div className="flex items-center gap-1 mt-1">
        {trendIcon(dim.trend, 12)}
        <span className="text-xs t-muted">{dim.trend || 'stable'}</span>
       </div>
      </button>
     ))}
    </div>
   )}
  </div>

  {/* 2.1.1 Dimension Comparison Grid (pinned dimensions) */}
  <DimensionComparisonGrid
   selectedDimensions={selectedDimensions}
   onRemove={(d) => setSelectedDimensions(prev => prev.filter(x => x !== d))}
   risks={risks}
   companyId={companyId || undefined}
  />

  {/* 2.1.2 Health Score Trend Chart */}
  <HealthTrendChart companyId={companyId || undefined} initialHistory={healthHistory} />

  {/* Top Row: Health Ring + Dimensions */}
  <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
   <FlipCard
    className="lg:col-span-1"
    isFlipped={!!flippedCards['apex-health']}
    onFlip={() => toggleFlip('apex-health')}
    front={
     <Card variant="black" className="h-full flex flex-col items-center justify-center">
      <ScoreRing score={overallScore} size="xl" label="Overall Health" />
      {health?.calculatedAt && healthHistory && (
       <div className="flex flex-col items-center gap-2 mt-4">
        {healthHistory.history.length > 1 && (
         <Sparkline data={healthHistory.history.map(h => h.overallScore)} width={120} height={30} color={healthHistory.delta >= 0 ? '#10b981' : '#ef4444'} />
        )}
        <div className="flex items-center gap-2">
         {trendIcon(healthHistory.delta > 0 ? 'up' : healthHistory.delta < 0 ? 'down' : 'stable')}
         <span className={`text-sm ${healthHistory.delta >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>{healthHistory.deltaLabel}</span>
        </div>
       </div>
      )}
      {!health?.calculatedAt && overallScore === 0 && (
       <p className="text-xs t-muted mt-4 text-center">No health data yet. Run a catalyst to populate metrics.</p>
      )}
     </Card>
    }
    back={
     <Card variant="black" className="h-full">
      <div className="flex items-center justify-between mb-3">
       <h4 className="text-sm font-semibold t-primary">Health Score Breakdown</h4>
      </div>
      <div className="space-y-2.5">
       {dimensions.map((dim) => (
        <div key={dim.key} className="flex items-center gap-2">
         <span className="text-xs t-secondary w-32 truncate">{dim.name}</span>
         <div className="flex-1">
          <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="sm" />
         </div>
         <span className="text-xs font-bold t-primary w-8 text-right">{dim.score}</span>
        </div>
       ))}
       {dimensions.length === 0 && (
        <p className="text-xs t-muted text-center py-4">No dimension data yet</p>
       )}
      </div>
      <div className="mt-3 pt-2 border-t border-[var(--border-card)]">
       <div className="flex justify-between text-xs">
        <span className="t-muted">Composite Score</span>
        <span className="font-bold t-primary">{overallScore}/100</span>
       </div>
      </div>
     </Card>
    }
   />

   <Card className="lg:col-span-2">
    <h3 className="text-lg font-semibold t-primary mb-4">Business Dimensions</h3>
    {dimensions.length === 0 || overallScore === 0 ? (
     <div className="flex items-center gap-3 py-6 px-4">
      <Crown className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
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
          <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-400' : dim.change < 0 ? 'text-red-400' : 'text-gray-400'}`}>
           {dim.change > 0 ? '+' : ''}{dim.change}
          </span>
         </div>
         <Sparkline data={dim.sparkline} width={60} height={20} color={dim.score >= 80 ? '#10b981' : dim.score >= 60 ? '#f59e0b' : '#ef4444'} />
         <button
          onClick={() => toggleDimensionCompare(dim.key)}
          className={`text-[10px] flex items-center gap-0.5 transition-all ml-2 ${selectedDimensions.includes(dim.key) ? 'text-accent opacity-100' : 'opacity-0 group-hover:opacity-100 text-accent hover:text-accent/80'}`}
          title={selectedDimensions.includes(dim.key) ? `Remove ${dim.name} from comparison` : `Compare ${dim.name}`}
          aria-pressed={selectedDimensions.includes(dim.key)}
         >
          {selectedDimensions.includes(dim.key) ? <PinOff size={10} /> : <Pin size={10} />}
          <span className="hidden sm:inline">{selectedDimensions.includes(dim.key) ? 'Unpin' : 'Compare'}</span>
         </button>
         <button
          onClick={() => handleOpenDimensionTrace(dim.key)}
          className="opacity-0 group-hover:opacity-100 text-[10px] text-accent hover:text-accent/80 flex items-center gap-0.5 transition-all ml-1"
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

  {/* Status Breakdown Cards (Static — FlipCards removed per UI cleanup) */}
  <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
   <Card className="h-full">
    <div className="flex items-center justify-between mb-2">
     <span className="text-xs t-muted uppercase tracking-wider">Dimensions</span>
     <Gauge size={14} className="text-accent" />
    </div>
    <p className="text-2xl font-bold t-primary">{dimensions.length}</p>
    <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
     {dimensions.slice(0, 3).map((d) => (
      <div key={d.key} className="flex items-center justify-between text-[10px]">
       <span className="t-secondary truncate mr-2">{d.name}</span>
       <span className={`font-medium ${d.score >= 80 ? 'text-emerald-400' : d.score >= 60 ? 'text-amber-400' : 'text-red-400'}`}>{d.score}</span>
      </div>
     ))}
    </div>
   </Card>
   <Card className="h-full">
    <div className="flex items-center justify-between mb-2">
     <span className="text-xs t-muted uppercase tracking-wider">Healthy</span>
     <CheckCircle2 size={14} className="text-emerald-400" />
    </div>
    <p className="text-2xl font-bold text-emerald-400">{dimensions.filter(d => d.score >= 80).length}</p>
    <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
     {dimensions.filter(d => d.score >= 80).slice(0, 3).map((d) => (
      <div key={d.key} className="flex items-center justify-between text-[10px]">
       <span className="t-secondary truncate mr-2">{d.name}</span>
       <span className="font-medium text-emerald-400">{d.score}</span>
      </div>
     ))}
    </div>
   </Card>
   <Card className="h-full">
    <div className="flex items-center justify-between mb-2">
     <span className="text-xs t-muted uppercase tracking-wider">At Risk</span>
     <AlertTriangle size={14} className="text-amber-400" />
    </div>
    <p className="text-2xl font-bold text-amber-400">{dimensions.filter(d => d.score >= 60 && d.score < 80).length}</p>
    <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
     {dimensions.filter(d => d.score >= 60 && d.score < 80).slice(0, 3).map((d) => (
      <div key={d.key} className="flex items-center justify-between text-[10px]">
       <span className="t-secondary truncate mr-2">{d.name}</span>
       <span className="font-medium text-amber-400">{d.score}</span>
      </div>
     ))}
    </div>
   </Card>
   <Card className="h-full">
    <div className="flex items-center justify-between mb-2">
     <span className="text-xs t-muted uppercase tracking-wider">Critical</span>
     <XCircle size={14} className="text-red-400" />
    </div>
    <p className="text-2xl font-bold text-red-400">{dimensions.filter(d => d.score < 60).length}</p>
    <div className="mt-2 pt-2 border-t border-[var(--border-card)] space-y-1 max-h-24 overflow-y-auto">
     {dimensions.filter(d => d.score < 60).slice(0, 3).map((d) => (
      <div key={d.key} className="flex items-center justify-between text-[10px]">
       <span className="t-secondary truncate mr-2">{d.name}</span>
       <span className="font-medium text-red-400">{d.score}</span>
      </div>
     ))}
    </div>
   </Card>
  </div>

  {/* Executive Summary + Risk Snapshot */}
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
   <Card variant="black">
    <div className="flex items-center gap-2 mb-3">
     <BarChart3 className="w-4 h-4 text-accent" />
     <h3 className="text-lg font-semibold">Executive Summary</h3>
    </div>
    <p className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--text-muted)' }}>
     {briefing?.summary || `Atheon is monitoring ${dimensions.length} business dimensions across your enterprise. Overall health score is ${overallScore}/100. ${dimensions.filter(d => d.score < 60).length > 0 ? `${dimensions.filter(d => d.score < 60).length} dimension(s) require immediate attention.` : 'All dimensions are within acceptable thresholds.'} ${risks.length > 0 ? `There are ${risks.length} active risk alert(s) requiring review.` : 'No active risk alerts detected.'}`}
    </p>
   </Card>

   <Card>
    <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
     <Shield className="w-4 h-4 text-accent" /> Risk Snapshot
    </h3>
    <div className="space-y-2.5">
     {risks.length === 0 ? (
      <div className="flex flex-col items-center justify-center py-6 text-center">
       <Shield className="w-8 h-8 t-muted mb-2 opacity-30" />
       <p className="text-sm t-muted">No active risks detected.</p>
       <p className="text-xs t-muted mt-1">Run a catalyst to scan for organisational risks.</p>
      </div>
     ) : (
      risks.slice(0, 4).map((risk, i) => (
       <div key={risk.id} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
        <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: risk.severity === 'critical' ? 'rgba(239,68,68,0.15)' : 'var(--accent)', color: risk.severity === 'critical' ? '#ef4444' : '#fff' }}>
         {i + 1}
        </div>
        <div className="flex-1 min-w-0">
         <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium t-primary">{risk.title}</span>
          <Badge variant={severityColor(risk.severity)} size="sm">{risk.severity}</Badge>
         </div>
         <p className="text-xs t-muted mt-0.5 truncate">{risk.description}</p>
         <div className="flex items-center gap-2 mt-1">
          <span className="text-[10px] t-muted">Impact: {risk.impactValue} {risk.impactUnit}</span>
          <span className="text-[10px] t-muted">|</span>
          <span className="text-[10px] t-muted">{risk.category}</span>
         </div>
        </div>
       </div>
      ))
     )}
    </div>
   </Card>
  </div>
 </TabPanel>
 )}

 {/* Executive Briefing Tab */}
 {activeTab === 'briefing' && (
 <TabPanel>
 <Card>
 <div className="flex items-center gap-2 mb-3">
 <FileText className="w-4 h-4 text-accent" />
  <h3 className="text-lg font-semibold t-primary">Daily Executive Briefing</h3>
 </div>
 {briefing?.summary ? (
 <>
 <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{briefing.summary}</p>
 {(briefing.healthDelta !== null || briefing.redMetricCount !== null || briefing.anomalyCount !== null || briefing.activeRiskCount !== null) && (
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
 {briefing.healthDelta !== null && (
 <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Health Delta</span>
 <p className={`text-lg font-bold mt-0.5 ${(briefing.healthDelta ?? 0) >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
   <ProvenanceLink
     title="Health delta vs prior period"
     subtitle="Difference between this period's overall health score and the previous one."
     sources={[
       { label: 'Period delta', value: `${(briefing.healthDelta ?? 0) > 0 ? '+' : ''}${briefing.healthDelta} pts` },
       { label: 'Underlying score history', value: 'View Health tab', linkTo: '/apex#health' },
       { label: 'Provenance ledger', value: 'View Trust', linkTo: '/trust' },
     ]}
   >
     {(briefing.healthDelta ?? 0) > 0 ? '+' : ''}{briefing.healthDelta} pts
   </ProvenanceLink>
 </p>
 </div>
 )}
 {briefing.redMetricCount !== null && (
 <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">RED Metrics</span>
 <p className={`text-lg font-bold mt-0.5 ${(briefing.redMetricCount ?? 0) > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
   <ProvenanceLink
     title={`${briefing.redMetricCount} RED metric${briefing.redMetricCount === 1 ? '' : 's'}`}
     subtitle="Process metrics whose current status crossed the red threshold."
     sources={[
       { label: 'Pulse — Metrics', value: 'Filter to RED', linkTo: '/pulse' },
       { label: 'Threshold rules', value: 'process_metrics.threshold_red', hint: 'Customer-tunable per metric.' },
     ]}
   >
     {briefing.redMetricCount}
   </ProvenanceLink>
 </p>
 </div>
 )}
 {briefing.anomalyCount !== null && (
 <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Anomalies</span>
 <p className={`text-lg font-bold mt-0.5 ${(briefing.anomalyCount ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
   <ProvenanceLink
     title={`${briefing.anomalyCount} unresolved anomal${briefing.anomalyCount === 1 ? 'y' : 'ies'}`}
     subtitle="Open anomalies — values that breached the dynamic-band detector and haven't been resolved or suppressed."
     sources={[
       { label: 'Pulse — Anomalies', value: 'View list', linkTo: '/pulse' },
       { label: 'Detector', value: 'metric-correlation-engine + threshold-autotune' },
     ]}
   >
     {briefing.anomalyCount}
   </ProvenanceLink>
 </p>
 </div>
 )}
 {briefing.activeRiskCount !== null && (
 <div className="p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Active Risks</span>
 <p className={`text-lg font-bold mt-0.5 ${(briefing.activeRiskCount ?? 0) > 0 ? 'text-amber-400' : 'text-emerald-400'}`}>
   <ProvenanceLink
     title={`${briefing.activeRiskCount} active risk${briefing.activeRiskCount === 1 ? '' : 's'}`}
     subtitle="risk_alerts rows where status='active' — each carries a probability + impact value derived from the underlying observations."
     sources={[
       { label: 'Risks tab', value: 'Open list', linkTo: '/apex#risks' },
       { label: 'Audit trail', value: 'View events', linkTo: '/audit?layer=risk' },
     ]}
   >
     {briefing.activeRiskCount}
   </ProvenanceLink>
 </p>
 </div>
 )}
 </div>
 )}
 </>
 ) : (
  <div className="flex items-center gap-3 py-6 px-4">
 <FileText className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No executive briefing generated yet</p>
 </div>
 )}
 </Card>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mt-6">
 <Card>
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <TrendingUp className="w-4 h-4 text-accent" /> KPI Movements
 </h3>
 <div className="space-y-3">
 {(briefing?.kpiMovements || []).map((kpi) => (
 <div key={kpi.kpi} className="flex items-center justify-between py-2 border-b border-[var(--border-card)] last:border-0">
 <span className="text-sm t-secondary">{kpi.kpi}</span>
 <div className="flex items-center gap-2">
 <span className="text-sm font-medium t-primary">{kpi.movement}</span>
 <span className="text-xs t-secondary">{kpi.period}</span>
 </div>
 </div>
 ))}
 </div>
 </Card>

 <Card>
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <AlertTriangle className="w-4 h-4 text-red-400" /> Top Risks
 </h3>
 <div className="space-y-3">
 {(briefing?.risks || []).map((risk, i) => (
 <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-start justify-between gap-2">
 <h4 className="text-sm font-medium t-primary">{risk}</h4>
 <Badge variant="warning" size="sm">risk</Badge>
 </div>
 </div>
 ))}
 </div>
 </Card>

 <Card variant="mint">
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <Lightbulb className="w-4 h-4 text-emerald-400" /> Opportunities
 </h3>
 <div className="space-y-3">
 {(briefing?.opportunities || []).map((opp, i) => (
 <div key={i} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-start justify-between gap-2">
 <h4 className="text-sm font-medium t-primary">{opp}</h4>
 <Badge variant="success" size="sm">opportunity</Badge>
 </div>
 </div>
 ))}
 </div>
 </Card>
 </div>

 {(briefing?.decisionsNeeded || []).length > 0 && (
 <Card className="mt-6">
 <h3 className="text-base font-semibold flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> Decisions Required
 </h3>
 {(briefing?.decisionsNeeded || []).map((dec, i) => (
 <div key={i} className="p-4 rounded-lg bg-accent/5 border border-accent/10 mt-3">
 <h4 className="text-sm font-semibold text-amber-800">{dec}</h4>
 </div>
 ))}
 </Card>
 )}
 </TabPanel>
 )}

 {/* Risk Alerts Tab */}
 {activeTab === 'risks' && (
 <TabPanel><div className="space-y-4">
 {/* 2.1.3 Risk Heat Map — category × severity */}
 <RiskHeatMap
  risks={risks}
  activeFilter={riskHeatFilter}
  onCellClick={(category, severity) => setRiskHeatFilter(prev => prev && prev.category === category && prev.severity === severity ? null : { category, severity })}
  onClearFilter={() => setRiskHeatFilter(null)}
 />
 {/* TASK-002: Decomposed RiskMatrix sub-component for grouped severity view */}
 <RiskMatrix risks={visibleRisks} />
 {risks.length === 0 && (
  <div className="flex items-center gap-3 py-6 px-4">
 <Shield className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No risk alerts detected yet</p>
 </div>
 )}
 {riskHeatFilter && visibleRisks.length === 0 && risks.length > 0 && (
  <div className="flex items-center gap-3 py-6 px-4 rounded-xl bg-[var(--bg-secondary)] border border-[var(--border-card)]">
   <AlertCircle className="w-4 h-4 t-muted flex-shrink-0" />
   <p className="text-sm t-muted flex-1">No risks match the selected filter.</p>
   <button onClick={() => setRiskHeatFilter(null)} className="text-xs text-accent hover:text-accent/80">Clear filter</button>
  </div>
 )}
 {visibleRisks.map((risk) => (
 <div
 key={risk.id}
  onClick={() => setExpandedRisk(expandedRisk === risk.id ? null : risk.id)}
 className="group rounded-2xl p-5 cursor-pointer hover:-translate-y-0.5 transition-all"
 style={{
  background: 'var(--bg-card-solid)',
  border: expandedRisk === risk.id ? '1px solid rgba(74, 107, 90, 0.20)' : '1px solid var(--border-card)',
  boxShadow: '0 2px 12px rgba(100, 120, 180, 0.07), 0 0 0 1px rgba(255,255,255,0.5)',
 }}
 >
 <div className="flex items-start gap-4">
 <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
 risk.severity === 'critical' ? 'bg-red-500/10' : risk.severity === 'high' ? 'bg-accent/10' : 'bg-accent/10'
 }`}>
 <AlertTriangle className={`w-5 h-5 ${
 risk.severity === 'critical' ? 'text-red-400' : risk.severity === 'high' ? 'text-accent' : 'text-accent'
 }`} />
 </div>
 <div className="flex-1 min-w-0">
  <div className="flex items-start justify-between gap-3">
 <h3 className="text-base font-semibold t-primary">{risk.title}</h3>
 <div className="flex items-center gap-2 flex-shrink-0">
 <button
 onClick={(e) => { e.stopPropagation(); handleOpenRiskTrace(risk.id); }}
 className="opacity-0 group-hover:opacity-100 text-accent hover:text-accent/80 transition-all"
 title="Trace to source"
 >
 <Link2 size={14} />
 </button>
 <Badge variant={severityColor(risk.severity)}>{risk.severity}</Badge>
 </div>
 </div>
 <p className="text-sm t-muted mt-1">{risk.description}</p>
 <div className="flex items-center justify-between gap-3 mt-2">
   <div className="flex items-center gap-4 text-xs text-gray-400">
     <span>Probability: {Math.round(risk.probability * 100)}%</span>
     <span>Impact: {risk.impactValue} {risk.impactUnit}</span>
   </div>
   {(() => {
     const rec = recommendForRisk({ category: risk.category, title: risk.title });
     if (!rec) return null;
     return (
       <Button
         variant="primary"
         size="sm"
         onClick={(e) => { e.stopPropagation(); navigate(catalystDeployUrl(rec)); }}
         data-testid={`mitigate-risk-${risk.id}`}
         title={`Open ${rec.catalyst} → ${rec.subCatalyst}`}
       >
         <Zap size={12} className="mr-1" /> Mitigate
       </Button>
     );
   })()}
 </div>

 {expandedRisk === risk.id && (
 <div className="mt-4 space-y-4 animate-fadeIn">
 {/* Risk Report Header */}
 <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-center gap-2 mb-3">
 <FileText className="w-4 h-4 text-accent" />
 <h4 className="text-sm font-semibold t-primary">Risk Review</h4>
 </div>

 {/* Risk Matrix Summary */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
 <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Likelihood</span>
 <p className="text-sm font-bold t-primary mt-0.5">{riskImpactLabel(risk.probability)}</p>
 <div className="h-1.5 rounded-full mt-1.5 overflow-hidden" style={{ background: 'var(--bg-secondary)' }}>
 <div className="h-full rounded-full" style={{ width: `${riskLikelihoodBar(risk.probability)}%`, background: risk.severity === 'critical' ? '#ef4444' : risk.severity === 'high' ? '#f59e0b' : 'var(--accent)' }} />
 </div>
 </div>
 <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Financial Impact</span>
 <p className="text-sm font-bold t-primary mt-0.5">
   <ProvenanceLink
     title={`Financial impact — ${risk.title}`}
     subtitle={`${risk.severity} severity · ${risk.category} domain · ${Math.round(risk.probability * 100)}% probability`}
     sources={[
       { label: 'Risk ID', value: risk.id },
       { label: 'Severity', value: risk.severity, tone: risk.severity === 'critical' ? 'danger' : risk.severity === 'high' ? 'warning' : 'info' },
       { label: 'Category', value: risk.category },
       { label: 'Probability', value: `${Math.round(risk.probability * 100)}%` },
       { label: 'Currency', value: risk.impactUnit ?? 'ZAR', tone: 'outline' },
       { label: 'Detected', value: risk.detectedAt ? new Date(risk.detectedAt).toLocaleString() : 'Unknown' },
       { label: 'Audit trail', value: 'View events', linkTo: `/audit?resource=risk_alert&resource_id=${encodeURIComponent(risk.id)}` },
     ]}
     detail={
       <p className="text-xs t-secondary leading-relaxed">
         The exposure is computed as <code className="font-mono">probability × estimated_loss</code>.
         The estimated loss is itself derived from the risk's underlying observations
         (linked metrics, anomalies, RCAs). Each observation is recorded in
         <code className="font-mono"> audit_log</code> and stamped into the
         provenance ledger so the figure is reproducible from the raw ERP records.
       </p>
     }
   >
     {risk.impactValue.toLocaleString()} {risk.impactUnit}
   </ProvenanceLink>
 </p>
 </div>
 <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Risk Category</span>
 <p className="text-sm font-bold t-primary mt-0.5 capitalize">{risk.category}</p>
 </div>
 <div className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
 <span className="text-[10px] t-muted uppercase tracking-wider">Detected</span>
 <p className="text-sm font-bold t-primary mt-0.5">{risk.detectedAt ? new Date(risk.detectedAt).toLocaleDateString() : '--'}</p>
 </div>
 </div>

 {/* Impact Analysis */}
 <div className="mb-4">
 <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">What This Means</h5>
 <p className="text-sm t-muted leading-relaxed">
 This {risk.severity}-severity risk in the <span className="font-medium t-primary">{risk.category}</span> domain
 has a <span className="font-medium t-primary">{Math.round(risk.probability * 100)}%</span> probability of occurrence.
 If materialised, the estimated financial exposure is <span className="font-medium t-primary">{risk.impactValue.toLocaleString()} {risk.impactUnit}</span>.
 {risk.severity === 'critical' ? ' Immediate executive attention is required.' : risk.severity === 'high' ? ' This requires prompt management action.' : ' Standard monitoring protocols apply.'}
 </p>
 </div>

 {/* Risk Score Visual */}
 <div className="mb-4">
 <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Severity Gauge</h5>
 <div className="flex items-center gap-3">
 <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: 'var(--bg-card-solid)' }}>
 <div className="h-full rounded-full transition-all duration-700" style={{
 width: `${Math.round(risk.probability * 100)}%`,
 background: risk.severity === 'critical' ? 'linear-gradient(90deg, #ef4444, #dc2626)' : risk.severity === 'high' ? 'linear-gradient(90deg, #f59e0b, #d97706)' : 'linear-gradient(90deg, var(--accent), var(--accent))'
 }} />
 </div>
 <span className="text-xs font-bold t-primary w-10 text-right">{Math.round(risk.probability * 100)}/100</span>
 </div>
 </div>
 </div>

 {/* Recommended Actions */}
 <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-center gap-2 mb-3">
 <Shield className="w-4 h-4 text-accent" />
 <h4 className="text-sm font-semibold t-primary">Recommended Next Steps</h4>
 </div>
 <div className="space-y-2.5">
 {risk.recommendedActions.map((action, i) => (
 <div key={i} className="flex items-start gap-3 p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
 <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0" style={{ background: 'var(--accent)', color: '#fff' }}>
 {i + 1}
 </div>
 <div className="flex-1">
 <span className="text-sm t-primary">{action}</span>
 <div className="flex items-center gap-2 mt-1">
 <span className="text-[10px] t-muted">Priority: {i === 0 ? 'Immediate' : i === 1 ? 'Short-term' : 'Medium-term'}</span>
 <span className="text-[10px] t-muted">|</span>
 <span className="text-[10px] t-muted">Owner: Risk Committee</span>
 </div>
 </div>
 </div>
 ))}
 </div>
 </div>

 {/* A4-3: Source Attribution — drill-through link */}
 {risk.subCatalystName && risk.clusterId && (
 <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
 <button
 onClick={(e) => { e.stopPropagation(); window.location.href = `/catalysts?cluster=${risk.clusterId}&sub=${encodeURIComponent(risk.subCatalystName!)}&ops=1`; }}
 className="flex items-center gap-2 text-xs text-accent hover:text-accent/80 transition-colors"
 >
 <Link2 size={12} />
 <span>Source: <span className="font-medium">{risk.subCatalystName}</span></span>
 {risk.sourceRunId && <span className="t-muted">· Run {risk.sourceRunId.slice(0, 8)}</span>}
 <ArrowRight size={10} />
 </button>
 </div>
 )}

 {/* Status Footer */}
 <div className="flex items-center justify-between pt-2">
 <div className="flex items-center gap-2">
 <Badge variant={risk.status === 'mitigated' ? 'success' : risk.status === 'monitoring' ? 'info' : 'warning'} size="sm">
 {risk.status || 'open'}
 </Badge>
 <span className="text-[10px] t-muted">Last updated: {risk.detectedAt ? new Date(risk.detectedAt).toLocaleString() : 'N/A'}</span>
 </div>
 </div>
 </div>
 )}
 </div>
 </div>
 </div>
 ))}
 </div></TabPanel>
 )}

 {/* Scenario Modelling Tab */}
 {activeTab === 'scenarios' && (
 <TabPanel><div className="space-y-6">
 {/* 2.1.4 Scenario comparison grid */}
 <ScenarioComparisonGrid
  scenarios={scenarios}
  selectedIds={selectedScenarios}
  baselineHealth={overallScore}
  onRemove={(id) => setSelectedScenarios(prev => prev.filter(x => x !== id))}
 />
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">What-If Analysis</h3>
 <Button variant="primary" size="sm" onClick={() => { resetScenarioBuilder(); setShowScenarioBuilder(true); }} title="Create a new what-if scenario analysis"><Plus size={14} /> New Scenario</Button>
 </div>

 {/* Quick-start templates — solve the blank-page problem on What-If.
     Click runs the scenario end-to-end; result lands in the list below. */}
 <Card className="p-4">
   <div className="flex items-center gap-2 mb-3">
     <Sparkles className="w-4 h-4 text-accent" />
     <h4 className="text-sm font-semibold t-primary">Quick-start scenarios</h4>
     <Badge variant="info" size="sm">One-click</Badge>
   </div>
   <p className="text-xs t-muted mb-3">
     Pre-built executive what-ifs grounded in your live ERP data. Click to run; results appear below.
   </p>
   <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
     {SCENARIO_TEMPLATES.map(t => (
       <button
         key={t.id}
         onClick={() => runScenarioTemplate(t)}
         disabled={!!runningTemplate}
         className="text-left p-3 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:border-accent/40 hover:bg-accent/5 transition-all disabled:opacity-50 disabled:cursor-wait"
         data-testid={`scenario-template-${t.id}`}
       >
         <div className="flex items-start justify-between gap-2 mb-1">
           <span className="text-sm font-medium t-primary">{t.title}</span>
           {runningTemplate === t.id ? (
             <Loader2 size={12} className="text-accent animate-spin flex-shrink-0 mt-1" />
           ) : (
             <Play size={12} className="text-accent flex-shrink-0 mt-1" />
           )}
         </div>
         <p className="text-[11px] t-muted line-clamp-2">{t.description}</p>
         <div className="text-[10px] t-muted mt-1.5 capitalize">{t.modelType.replace('-', ' ')}</div>
       </button>
     ))}
   </div>
 </Card>

 {scenarios.length === 0 && !runningTemplate && (
 <div className="flex flex-col items-center justify-center py-8 text-center">
 <BarChart3 className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No scenarios run yet.</p>
 <p className="text-xs t-muted mt-1">Pick a quick-start template above or click &quot;New Scenario&quot; for a custom run.</p>
 </div>
 )}
   {scenarios.map((scenario) => {
  // Filter out internal/technical fields that should never be shown to users
  const hiddenFields = new Set(['model', 'source', 'generated_at', 'recommendation', 'analysis_points']);

  // If recommendation contains embedded JSON, extract structured fields from it
  const effectiveResults = scenario.results ? { ...scenario.results } : null;
  if (effectiveResults && typeof effectiveResults.recommendation === 'string') {
    const rec = (effectiveResults.recommendation as string).replace(/```json\s*/g, '').replace(/```/g, '').replace(/\*\*/g, '').replace(/\*/g, '').trim();
    try {
      const parsed = JSON.parse(rec) as Record<string, unknown>;
      // If the recommendation string was actually a JSON object with known fields, merge them
      if (parsed && typeof parsed === 'object' && ('npv_impact' in parsed || 'recommendation' in parsed || 'confidence' in parsed)) {
        if (typeof parsed.recommendation === 'string') effectiveResults.recommendation = parsed.recommendation;
        if (Array.isArray(parsed.analysis_points)) effectiveResults.analysis_points = parsed.analysis_points;
        // Merge numeric/metric fields that aren't already set
        for (const [k, v] of Object.entries(parsed)) {
          if (k !== 'recommendation' && k !== 'analysis_points' && !(k in effectiveResults)) {
            (effectiveResults as Record<string, unknown>)[k] = v;
          }
        }
      }
    } catch { /* not JSON, keep as-is */ }
  }

  const resultEntries: [string, string | number][] = effectiveResults
    ? Object.entries(effectiveResults).filter(([key]) => !hiddenFields.has(key)).map(([k, v]) => [k, typeof v === 'number' ? v : String(v)])
    : [];
  const hasResults = resultEntries.length > 0 || !!effectiveResults?.recommendation;
  return (
   <Card key={scenario.id}>
    <div className="flex items-start justify-between gap-3">
     <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
       <h3 className="text-base font-semibold t-primary">{scenario.title}</h3>
       <Badge variant={scenario.status === 'completed' ? 'success' : 'warning'}>{scenario.status}</Badge>
      </div>
      <p className="text-sm t-muted mt-1">{scenario.description}</p>
      <div className="flex items-center gap-3 mt-2 text-[10px] t-muted">
       {scenario.variables.length > 0 && <span>Variables: {scenario.variables.join(', ')}</span>}
       {scenario.createdAt && <span>Created: {new Date(scenario.createdAt).toLocaleDateString()}</span>}
      </div>
     </div>
     <button
      type="button"
      onClick={() => toggleScenarioCompare(scenario.id)}
      className={`flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${selectedScenarios.includes(scenario.id) ? 'bg-accent/20 text-accent border border-accent/40' : 'bg-[var(--bg-secondary)] text-accent border border-[var(--border-card)] hover:bg-accent/10'}`}
      title={selectedScenarios.includes(scenario.id) ? 'Remove from comparison' : 'Add to comparison'}
      aria-pressed={selectedScenarios.includes(scenario.id)}
     >
      {selectedScenarios.includes(scenario.id) ? <PinOff size={11} /> : <Pin size={11} />}
      {selectedScenarios.includes(scenario.id) ? 'Unpin' : 'Compare'}
     </button>
    </div>

    {/* Scenario Report */}
    {hasResults && (
     <div className="mt-4 space-y-4 animate-fadeIn">
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-accent" />
        <h4 className="text-sm font-semibold t-primary">Results Overview</h4>
         {/* Spec 7 LLM-4: AI unavailable indicator */}
         {effectiveResults?.source === 'fallback' && (
          <Badge variant="warning" size="sm">AI unavailable — data-driven estimate</Badge>
        )}
       </div>

       {/* Key Metrics Grid */}
       {resultEntries.length > 0 && (
       <div className={`grid grid-cols-2 ${resultEntries.length >= 3 ? 'md:grid-cols-3' : ''} gap-3 mb-4`}>
        {resultEntries.map(([key, val]) => (
         <div key={key} className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
          <span className="text-[10px] t-muted uppercase tracking-wider">{key.replace(/[_-]/g, ' ')}</span>
          <p className="text-lg font-bold t-primary mt-0.5">{typeof val === 'number' ? val.toLocaleString() : val}</p>
         </div>
        ))}
       </div>
       )}

       {/* AI Analysis — Recommendation */}
       {typeof effectiveResults?.recommendation === 'string' && effectiveResults.recommendation.length > 0 && (
       <div className="mb-4">
        <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Analysis</h5>
        <div className="text-sm t-secondary leading-relaxed space-y-2">
         {(effectiveResults.recommendation as string)
          .replace(/```json\s*/g, '').replace(/```/g, '')
          .replace(/\*\*/g, '').replace(/\*/g, '')
          .split('\n').filter((line: string) => line.trim())
          .filter((line: string) => !/^[{}[\]]+$/.test(line.trim()) && !/^"\w+"\s*:/.test(line.trim()))
          .map((line: string, i: number) => (
           <p key={i}>{line.trim()}</p>
          ))}
        </div>
       </div>
       )}

       {/* Analysis Points */}
       {Array.isArray(effectiveResults?.analysis_points) && (effectiveResults.analysis_points as string[]).length > 0 && (
       <div className="mb-4">
        <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Key Findings</h5>
        <ul className="space-y-1.5">
         {(effectiveResults.analysis_points as string[]).map((point: string, i: number) => (
          <li key={i} className="flex items-start gap-2 text-sm t-secondary">
           <span className="text-accent mt-1">{'\u2022'}</span>
           <span>{String(point).replace(/\*\*/g, '').replace(/\*/g, '')}</span>
          </li>
         ))}
        </ul>
       </div>
       )}

       {/* Recommendations */}
       <div>
        <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">What to Watch</h5>
        <div className="space-y-2">
         {scenario.variables.map((variable, i) => (
          <div key={i} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
           <Lightbulb className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
           <span className="text-sm t-secondary">Monitor <span className="font-medium t-primary">{variable}</span> closely and review thresholds if deviation exceeds projected ranges.</span>
          </div>
         ))}
         {scenario.variables.length === 0 && (
          <div className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
           <Lightbulb className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
           <span className="text-sm t-secondary">Review the projected outcomes and incorporate findings into strategic planning.</span>
          </div>
         )}
        </div>
       </div>
      </div>
     </div>
    )}

    {/* Pending state */}
    {!hasResults && scenario.status !== 'completed' && (
     <div className="mt-4 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-center">
      <Loader2 className="w-5 h-5 text-accent animate-spin mx-auto mb-2" />
      <p className="text-sm t-muted">Scenario is being processed...</p>
      <p className="text-[10px] t-muted mt-1">Results will appear here once the analysis completes.</p>
     </div>
    )}

    {/* Completed but no results */}
    {!hasResults && scenario.status === 'completed' && (
     <div className="mt-4 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-center">
      <BarChart3 className="w-5 h-5 t-muted mx-auto mb-2 opacity-40" />
      <p className="text-sm t-muted">No results were generated for this scenario.</p>
     </div>
    )}
   </Card>
  );
 })}
 </div></TabPanel>
 )}

 {/* Scenario Builder Modal */}
 {showScenarioBuilder && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-5 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <BarChart3 size={18} className="text-accent" /> Scenario Builder
 </h3>
 <button onClick={() => setShowScenarioBuilder(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>

 {/* Step Indicator */}
 <div className="flex items-center gap-2">
 {[1, 2, 3].map((s) => (
 <div key={s} className="flex items-center gap-2 flex-1">
 <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${
 builderStep >= s ? 'bg-accent text-white' : 'bg-[var(--bg-secondary)] t-muted border border-[var(--border-card)]'
 }`}>{s}</div>
 <span className={`text-[10px] ${builderStep >= s ? 't-primary font-medium' : 't-muted'}`}>
 {s === 1 ? 'Details' : s === 2 ? 'Model' : 'Variables'}
 </span>
 {s < 3 && <div className={`flex-1 h-0.5 ${builderStep > s ? 'bg-accent' : 'bg-[var(--border-card)]'}`} />}
 </div>
 ))}
 </div>

 {/* Step 1: Scenario Details */}
 {builderStep === 1 && (
 <div className="space-y-3">
 <div>
 <label className="text-xs t-muted">Scenario Title</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={scenarioTitle}
 onChange={e => setScenarioTitle(e.target.value)}
 placeholder="e.g. Revenue decline impact analysis"
 autoFocus
 />
 </div>
 <div>
 <label className="text-xs t-muted">Description</label>
 <textarea
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary resize-none"
 rows={3}
 value={scenarioDescription}
 onChange={e => setScenarioDescription(e.target.value)}
 placeholder="Describe the scenario you want to model..."
 />
 </div>
 </div>
 )}

 {/* Step 2: Model Type */}
 {builderStep === 2 && (
 <div className="space-y-3">
 <label className="text-xs t-muted">Select Analysis Model</label>
 <div className="grid grid-cols-2 gap-3">
 {[
 { id: 'what-if', label: 'What-If', desc: 'Change one or more variables and see the impact' },
 { id: 'sensitivity', label: 'Sensitivity', desc: 'Determine which variables have the most effect' },
 { id: 'monte-carlo', label: 'Monte Carlo', desc: 'Simulate thousands of random outcomes' },
 { id: 'stress-test', label: 'Stress Test', desc: 'Test extreme scenarios against your model' },
 ].map(m => (
 <button
 key={m.id}
 onClick={() => setScenarioModelType(m.id)}
 className={`p-3 rounded-lg border text-left transition-all ${
 scenarioModelType === m.id
 ? 'bg-accent/10 border-accent/40 ring-1 ring-accent/30'
 : 'bg-[var(--bg-secondary)] border-[var(--border-card)] hover:border-gray-400'
 }`}
 >
 <span className={`text-sm font-medium ${scenarioModelType === m.id ? 'text-accent' : 't-primary'}`}>{m.label}</span>
 <p className="text-[10px] t-muted mt-1">{m.desc}</p>
 </button>
 ))}
 </div>
 <div>
 <label className="text-xs t-muted">Analysis Query</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={scenarioQuery}
 onChange={e => setScenarioQuery(e.target.value)}
 placeholder="e.g. What if revenue drops by 10%?"
 />
 </div>
 </div>
 )}

 {/* Step 3: Variables */}
 {builderStep === 3 && (
 <div className="space-y-3">
 <div className="flex items-center justify-between">
 <label className="text-xs t-muted">Input Variables</label>
 <button onClick={addVariable} className="text-xs text-accent hover:text-accent/80 flex items-center gap-1">
 <Plus size={12} /> Add Variable
 </button>
 </div>
 {scenarioVariables.map((v, idx) => (
 <div key={idx} className="flex items-center gap-2">
 <input
 className="flex-1 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={v.name}
 onChange={e => updateVariable(idx, 'name', e.target.value)}
 placeholder="Variable name (e.g. revenue)"
 />
 <input
 className="w-32 px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={v.baseValue}
 onChange={e => updateVariable(idx, 'baseValue', e.target.value)}
 placeholder="Base value"
 />
 {scenarioVariables.length > 1 && (
 <button onClick={() => removeVariable(idx)} className="text-red-400 hover:text-red-300 p-1">
 <Trash2 size={14} />
 </button>
 )}
 </div>
 ))}
 <p className="text-[10px] t-muted">Define the variables you want to vary in your {scenarioModelType} analysis and their baseline values.</p>
 </div>
 )}

 {/* Navigation Buttons */}
 <div className="flex items-center justify-between pt-2">
 <div>
 {builderStep > 1 && (
 <Button variant="secondary" size="sm" onClick={() => setBuilderStep(s => s - 1)}>
 <ChevronLeft size={14} /> Back
 </Button>
 )}
 </div>
 <div className="flex gap-2">
 <Button variant="secondary" size="sm" onClick={() => setShowScenarioBuilder(false)}>Cancel</Button>
 {builderStep < 3 ? (
 <Button variant="primary" size="sm" onClick={() => setBuilderStep(s => s + 1)} disabled={builderStep === 1 && !scenarioTitle.trim()}>
 Next <ChevronRight size={14} />
 </Button>
 ) : (
 <Button variant="primary" size="sm" onClick={handleCreateScenario} disabled={creatingScenario || scenarioVariables.every(v => !v.name.trim())}>
 {creatingScenario ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Create Scenario
 </Button>
 )}
 </div>
 </div>
 </div>
 </div></Portal>
 )}
 
 {/* Strategic Context Tab */}
 {activeTab === 'strategic-context' && (
  <TabPanel>
   {radarLoading && !radarContext && (
    <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
   )}
   {!radarLoading && !radarContext && (
    <Card className="text-center py-12">
     <Radar className="w-10 h-10 t-muted mx-auto mb-3 opacity-30" />
     <p className="text-sm font-medium t-primary">No strategic context yet</p>
     <p className="text-xs t-muted mt-1">Add external signals to build your strategic radar.</p>
     <Button variant="primary" size="sm" className="mt-4" onClick={() => { loadRadarContext(); }}>Load Strategic Context</Button>
    </Card>
   )}
   {radarContext && (
    <div className="space-y-4">
     {/* Summary Cards */}
     <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><div className="text-center"><p className="text-2xl font-bold t-primary">{radarContext.summary.totalSignals}</p><p className="text-[10px] t-muted uppercase">Total Signals</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold text-amber-400">{radarContext.summary.activeSignals}</p><p className="text-[10px] t-muted uppercase">Active Signals</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold text-red-400">{radarContext.summary.criticalImpacts}</p><p className="text-[10px] t-muted uppercase">Critical Impacts</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold text-purple-400 capitalize">{radarContext.summary.overallSentiment}</p><p className="text-[10px] t-muted uppercase">Sentiment</p></div></Card>
     </div>

     {/* Strategic Context Card */}
     {radarContext.context && (
      <Card className="border-purple-500/20 bg-purple-500/5">
       <div className="flex items-center gap-2 mb-2">
        <Globe size={16} className="text-purple-400" />
        <h3 className="text-sm font-semibold t-primary">{radarContext.context.title}</h3>
        <Badge variant={radarContext.context.sentiment === 'positive' ? 'success' : radarContext.context.sentiment === 'negative' ? 'danger' : 'info'} size="sm">{radarContext.context.sentiment}</Badge>
       </div>
       <p className="text-xs t-secondary mb-3">{radarContext.context.summary}</p>
       {radarContext.context.factors.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
         {radarContext.context.factors.map((f, i) => (
          <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--bg-secondary)] text-[10px] t-muted border border-[var(--border-card)]">
           {f.direction === 'positive' ? <TrendingUp size={10} className="text-emerald-400" /> : f.direction === 'negative' ? <TrendingDown size={10} className="text-red-400" /> : <Minus size={10} />}
           {f.name}
          </span>
         ))}
        </div>
       )}
      </Card>
     )}

     {/* Board Report */}
     <Card className="border-accent/20 bg-accent/5">
      <div className="flex items-center justify-between">
       <div className="flex items-center gap-2">
        <FileText size={16} className="text-accent" />
        <div>
         <h3 className="text-sm font-semibold t-primary">Board Report Generator</h3>
         <p className="text-[10px] t-muted">Generate a comprehensive executive board report with all V2 intelligence data.</p>
        </div>
       </div>
       <Button variant="primary" size="sm" onClick={handleGenerateBoardReport} disabled={generatingReport}>
        {generatingReport ? <Loader2 size={12} className="animate-spin" /> : <FileText size={12} />} Generate Report
       </Button>
      </div>
      {boardReports.length > 0 && (
       <div className="mt-3 pt-3 border-t border-[var(--border-card)] space-y-1">
        {boardReports.slice(0, 3).map(report => (
         <div key={report.id} className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-secondary)]">
          <div className="flex items-center gap-2">
           <Badge variant={report.status === 'completed' ? 'success' : report.status === 'generating' ? 'warning' : 'danger'} size="sm">{report.status}</Badge>
           <span className="text-xs t-primary">{report.title || report.reportMonth}</span>
          </div>
          <div className="flex items-center gap-2">
           <span className="text-[10px] t-muted">{new Date(report.generatedAt).toLocaleDateString()}</span>
           {report.pdfUrl && <button onClick={() => api.boardReport.downloadPdf(report.id, report.title)} className="text-[10px] text-accent hover:underline flex items-center gap-0.5"><FileText size={10} />PDF</button>}
           {report.contentMarkdown && <button onClick={() => setShowBoardReport(showBoardReport === report.id ? null : report.id)} className="text-[10px] text-accent hover:underline">View</button>}
          </div>
         </div>
        ))}
        {showBoardReport && boardReports.find(r => r.id === showBoardReport)?.contentMarkdown && (
         <div className="mt-2 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] max-h-64 overflow-y-auto">
          <pre className="text-xs t-secondary whitespace-pre-wrap">{boardReports.find(r => r.id === showBoardReport)?.contentMarkdown}</pre>
         </div>
        )}
       </div>
      )}
     </Card>

     {/* Signals List */}
     <div className="flex items-center justify-between">
      <h3 className="text-sm font-semibold t-primary">External Signals</h3>
      <div className="flex gap-2">
       <Button variant="secondary" size="sm" onClick={loadRadarContext}><RefreshCw size={12} /> Refresh</Button>
       <Button variant="primary" size="sm" onClick={() => setShowSignalForm(true)}><Plus size={12} /> Add Signal</Button>
      </div>
     </div>

     {showSignalForm && (
      <Card className="border-accent/20">
       <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
         <label className="text-[10px] t-muted uppercase block mb-1">Title *</label>
         <input className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={radarSignalForm.title} onChange={e => setRadarSignalForm(p => ({ ...p, title: e.target.value }))} placeholder="e.g. SARB Rate Hike Expected" />
        </div>
        <div>
         <label className="text-[10px] t-muted uppercase block mb-1">Source</label>
         <input className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={radarSignalForm.source_name} onChange={e => setRadarSignalForm(p => ({ ...p, source_name: e.target.value }))} placeholder="e.g. Reuters, Bloomberg" />
        </div>
        <div className="md:col-span-2">
         <label className="text-[10px] t-muted uppercase block mb-1">Description</label>
         <textarea className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" rows={2} value={radarSignalForm.summary} onChange={e => setRadarSignalForm(p => ({ ...p, summary: e.target.value }))} placeholder="Describe the external signal..." />
        </div>
        <div>
         <label className="text-[10px] t-muted uppercase block mb-1">Type</label>
         <select className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={radarSignalForm.category} onChange={e => setRadarSignalForm(p => ({ ...p, category: e.target.value }))}>
          <option value="regulatory">Regulatory</option><option value="market">Market</option><option value="competitor">Competitor</option><option value="economic">Economic</option><option value="technology">Technology</option><option value="geopolitical">Geopolitical</option>
         </select>
        </div>
        <div>
         <label className="text-[10px] t-muted uppercase block mb-1">Sentiment</label>
         <select className="w-full px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={radarSignalForm.sentiment} onChange={e => setRadarSignalForm(p => ({ ...p, sentiment: e.target.value }))}>
          <option value="positive">Positive</option><option value="neutral">Neutral</option><option value="negative">Negative</option><option value="mixed">Mixed</option>
         </select>
        </div>
       </div>
       <div className="flex justify-end gap-2 mt-3">
        <Button variant="secondary" size="sm" onClick={() => setShowSignalForm(false)}>Cancel</Button>
        <Button variant="primary" size="sm" onClick={handleCreateSignal} disabled={creatingSignal || !radarSignalForm.title.trim()}>
         {creatingSignal ? <Loader2 size={12} className="animate-spin" /> : <Zap size={12} />} Create & Analyse
        </Button>
       </div>
      </Card>
     )}

     {radarContext.signals.length === 0 ? (
      <Card className="text-center py-8">
       <p className="text-xs t-muted">No signals detected. Add external signals to build your strategic context.</p>
      </Card>
     ) : (
      <div className="space-y-2">
       {radarContext.signals.map(signal => (
        <Card key={signal.id} hover onClick={() => setExpandedSignal(expandedSignal === signal.id ? null : signal.id)}>
         <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
           <Badge variant={severityColor(signal.severity)} size="sm">{signal.severity}</Badge>
           <span className="text-sm font-medium t-primary">{signal.title}</span>
           <Badge variant="info" size="sm">{signal.signalType}</Badge>
          </div>
          <div className="flex items-center gap-2 text-[10px] t-muted">
           <span>{signal.source}</span>
           <Badge variant={signal.status === 'analysed' ? 'success' : signal.status === 'dismissed' ? 'default' : 'warning'} size="sm">{signal.status}</Badge>
          </div>
         </div>
         {expandedSignal === signal.id && (
          <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
           <p className="text-xs t-secondary mb-2">{signal.description}</p>
           {signal.url && <a href={signal.url} target="_blank" rel="noopener noreferrer" className="text-xs text-accent hover:underline flex items-center gap-1"><Link2 size={10} />{signal.url}</a>}
           <p className="text-[10px] t-muted mt-2">Detected: {new Date(signal.detectedAt).toLocaleDateString()} · Relevance: {Math.round(signal.relevanceScore)}%</p>
          </div>
         )}
        </Card>
       ))}
      </div>
     )}

     {/* Impacts Summary */}
     {radarContext.impacts.length > 0 && (
      <div>
       <h3 className="text-sm font-semibold t-primary mb-2">Impact Analysis</h3>
       <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {radarContext.impacts.map((impact, i) => (
         <Card key={i}>
          <div className="flex items-center justify-between mb-1">
           <Badge variant="info" size="sm">{impact.dimension}</Badge>
           <div className="flex items-center gap-1">
            {impact.impactDirection === 'positive' ? <TrendingUp size={12} className="text-emerald-400" /> : impact.impactDirection === 'negative' ? <TrendingDown size={12} className="text-red-400" /> : <Minus size={12} />}
            <span className="text-xs t-primary">{Math.round(impact.impactMagnitude)}%</span>
           </div>
          </div>
          {impact.recommendedActions.length > 0 && (
           <ul className="mt-1 space-y-0.5">
            {impact.recommendedActions.slice(0, 2).map((action, j) => (
             <li key={j} className="text-[10px] t-muted flex items-start gap-1"><ArrowRight size={8} className="mt-0.5 flex-shrink-0" />{action}</li>
            ))}
           </ul>
          )}
         </Card>
        ))}
       </div>
      </div>
     )}
    </div>
   )}
  </TabPanel>
 )}

 {/* §11.4 Peer Benchmarks Tab */}
 {activeTab === 'peer-benchmarks' && (
  <TabPanel>
   {!peerBenchmarks && !peerLoading && (
    <Card className="text-center py-12">
     <Globe className="w-10 h-10 t-muted mx-auto mb-3 opacity-30" />
     <p className="text-sm font-medium t-primary">Peer Benchmarks</p>
     <p className="text-xs t-muted mt-1">Compare your performance against anonymised industry peers.</p>
     <Button variant="primary" size="sm" className="mt-4" onClick={() => {
      setPeerLoading(true);
      api.peerBenchmarks.get().then(setPeerBenchmarks).catch(() => { /* non-critical — button stays visible */ }).finally(() => setPeerLoading(false));
     }}>Load Benchmarks</Button>
    </Card>
   )}
   {peerLoading && (
    <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
   )}
   {peerBenchmarks && (
    <div className="space-y-4">
     <div className="flex items-center justify-between">
      <div>
       <h3 className="text-sm font-semibold t-primary">Industry: {peerBenchmarks.industry}</h3>
       <p className="text-[10px] t-muted">{peerBenchmarks.total} dimension{peerBenchmarks.total !== 1 ? 's' : ''} benchmarked</p>
      </div>
      <Button variant="secondary" size="sm" onClick={() => {
       setPeerLoading(true);
       api.peerBenchmarks.get().then(setPeerBenchmarks).catch(() => { /* non-critical — keep existing data */ }).finally(() => setPeerLoading(false));
      }}><RefreshCw size={12} /> Refresh</Button>
     </div>
     {peerBenchmarks.benchmarks.length === 0 ? (
      <Card className="text-center py-8">
       <p className="text-xs t-muted">Not enough peers in your industry yet (minimum 3 tenants required for anonymity).</p>
      </Card>
     ) : (
      <div className="space-y-3">
       {peerBenchmarks.benchmarks.map((b, i) => (
        <PeerComparisonBar key={i} benchmark={b} />
       ))}
      </div>
     )}
    </div>
   )}
  </TabPanel>
 )}

 {/* Traceability Modal */}
 {showTraceabilityModal && traceabilityData && (
  <TraceabilityModal
   data={traceabilityData}
   type={traceabilityType}
   onClose={() => { setShowTraceabilityModal(false); setTraceabilityData(null); }}
  />
 )}
 
 </div>
 );
}
