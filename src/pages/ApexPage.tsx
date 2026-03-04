import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { HealthScore, Briefing, Risk, ScenarioItem } from "@/lib/api";
import { Portal } from "@/components/ui/portal";
import {
 Crown, TrendingUp, TrendingDown, Minus, AlertTriangle, FileText,
 Play, BarChart3, Shield, Lightbulb, Loader2, AlertCircle, X,
 Plus, ChevronRight, ChevronLeft, Trash2
} from "lucide-react";


const trendIcon = (trend: string, size = 14) => {
 if (trend === 'up' || trend === 'improving') return <TrendingUp size={size} className="text-emerald-400" />;
 if (trend === 'down' || trend === 'declining') return <TrendingDown size={size} className="text-red-400" />;
 return <Minus size={size} className="text-gray-400" />;
};

const severityColor = (s: string) => s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

const riskImpactLabel = (probability: number) => probability >= 0.7 ? 'Very High' : probability >= 0.5 ? 'High' : probability >= 0.3 ? 'Medium' : 'Low';
const riskLikelihoodBar = (probability: number) => Math.round(probability * 100);

export function ApexPage() {
 const { activeTab, setActiveTab } = useTabState('health');
 const [expandedRisk, setExpandedRisk] = useState<string | null>(null);
 const [health, setHealth] = useState<HealthScore | null>(null);
 const [briefing, setBriefing] = useState<Briefing | null>(null);
 const [risks, setRisks] = useState<Risk[]>([]);
 const [scenarios, setScenarios] = useState<ScenarioItem[]>([]);
 const [loading, setLoading] = useState(true);
 const [creatingScenario, setCreatingScenario] = useState(false);
 const [actionError, setActionError] = useState<string | null>(null);

 // Scenario Builder Modal state
 const [showScenarioBuilder, setShowScenarioBuilder] = useState(false);
 const [builderStep, setBuilderStep] = useState(1);
 const [scenarioTitle, setScenarioTitle] = useState('');
 const [scenarioDescription, setScenarioDescription] = useState('');
 const [scenarioModelType, setScenarioModelType] = useState('what-if');
 const [scenarioQuery, setScenarioQuery] = useState('');
 const [scenarioVariables, setScenarioVariables] = useState<Array<{ name: string; baseValue: string }>>([{ name: '', baseValue: '' }]);

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
 const s = await api.apex.scenarios();
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

 useEffect(() => {
 async function load() {
 setLoading(true);
 const [h, b, r, s] = await Promise.allSettled([
 api.apex.health(), api.apex.briefing(), api.apex.risks(), api.apex.scenarios(),
 ]);
 if (h.status === 'fulfilled') setHealth(h.value);
 if (b.status === 'fulfilled') setBriefing(b.value);
 if (r.status === 'fulfilled') setRisks(r.value.risks);
 if (s.status === 'fulfilled') setScenarios(s.value.scenarios);
 setLoading(false);
 }
 load();
 }, []);

 const overallScore = health?.overall ?? 0;
 const dimensions = health?.dimensions
 ? Object.entries(health.dimensions).map(([key, val]) => ({
 key, name: key.charAt(0).toUpperCase() + key.slice(1),
 score: val.score, trend: val.trend as string,
 change: val.delta ?? 0, weight: 0.2,
 sparkline: [val.score - 6, val.score - 4, val.score - 3, val.score - 2, val.score - 1, val.score]}))
 : [];

 const tabs = [
 { id: 'health', label: 'Business Health', icon: <Crown size={14} /> },
 { id: 'briefing', label: 'Leadership Summary', icon: <FileText size={14} /> },
 { id: 'risks', label: 'Risk Overview', icon: <AlertTriangle size={14} />, count: risks.length },
 { id: 'scenarios', label: 'What-If Analysis', icon: <BarChart3 size={14} /> },
 ];

 if (loading) {
 return (
 <div className="flex items-center justify-center h-96">
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div>
 <h1 className="text-3xl sm:text-4xl font-bold t-primary" >Atheon Apex</h1>
 <p className="text-sm t-muted mt-1">Your strategic overview — insights that matter, when they matter</p>
 </div>

 {actionError && (
 <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
 <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
 <p className="text-sm text-red-400 flex-1">{actionError}</p>
 <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300" title="Dismiss error"><X size={14} /></button>
 </div>
 )}

 <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

 {/* Business Health Tab */}
 {activeTab === 'health' && (
 <TabPanel>
 <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
 <Card variant="black" className="lg:col-span-1 flex flex-col items-center justify-center">
 <ScoreRing score={overallScore} size="xl" label="Overall Health" sublabel="Composite Index" />
 {health?.calculatedAt && (
 <div className="flex items-center gap-2 mt-4">
 {trendIcon('up')}
 <span className="text-sm text-emerald-400">+2.3 points (7d)</span>
 </div>
 )}
 {!health?.calculatedAt && overallScore === 0 && (
 <p className="text-xs t-muted mt-4 text-center">No health data yet. Run a catalyst to populate.</p>
 )}
 </Card>

 <Card className="lg:col-span-2">
 <h3 className="text-lg font-semibold t-primary mb-4">Performance Areas</h3>
 {dimensions.length === 0 && (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <Crown className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No dimensions available yet.</p>
 <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to start generating insights.</p>
 </div>
 )}
 <div className="space-y-4">
 {dimensions.map((dim) => (
 <div key={dim.key} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
 <div className="sm:w-36 flex-shrink-0">
 <span className="text-sm t-secondary">{dim.name}</span>
 <span className="block text-[10px] text-gray-400">Weight: {(dim.weight * 100).toFixed(0)}%</span>
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
 <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
 {dim.change > 0 ? '+' : ''}{dim.change}
 </span>
 </div>
 <Sparkline data={dim.sparkline} width={60} height={20} color={dim.trend === 'up' || dim.trend === 'improving' ? '#10b981' : dim.trend === 'down' || dim.trend === 'declining' ? '#ef4444' : '#6b7280'} />
 </div>
 </div>
 ))}
 </div>
 </Card>
 </div>
 </TabPanel>
 )}

 {/* Executive Briefing Tab */}
 {activeTab === 'briefing' && (
 <TabPanel>
 <div className="space-y-6">
 {/* Narrative */}
 <Card variant="black">
 <div className="flex items-center gap-2 mb-3">
 <FileText className="w-4 h-4 text-accent" />
 <h3 className="text-lg font-semibold">Daily Executive Briefing</h3>
 <Badge variant="info">Today</Badge>
 </div>
 {briefing?.summary ? (
 <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>{briefing.summary}</p>
 ) : (
 <div className="flex flex-col items-center justify-center py-8 text-center">
 <FileText className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No executive briefing generated yet.</p>
 <p className="text-xs t-muted mt-1">Run a catalyst to generate your first briefing.</p>
 </div>
 )}
 </Card>

 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 {/* KPI Movements */}
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

 {/* Top Risks */}
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

 {/* Top Opportunities */}
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

 {/* Required Decisions */}
 {(briefing?.decisionsNeeded || []).length > 0 && (
 <Card variant="black">
 <h3 className="text-base font-semibold flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> Decisions Required
 </h3>
 {(briefing?.decisionsNeeded || []).map((dec, i) => (
 <div key={i} className="p-4 rounded-lg bg-accent/5 border border-accent/10">
 <h4 className="text-sm font-semibold text-amber-800">{dec}</h4>
 </div>
 ))}
 </Card>
 )}
 </div>
 </TabPanel>
 )}

 {/* Risk Alerts Tab */}
 {activeTab === 'risks' && (
 <TabPanel>
 <div className="space-y-4">
 {risks.length === 0 && (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <Shield className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No risk alerts detected yet.</p>
 <p className="text-xs t-muted mt-1">Run a catalyst to scan for organisational risks.</p>
 </div>
 )}
 {risks.map((risk) => (
 <Card
 key={risk.id}
 hover
 onClick={() => setExpandedRisk(expandedRisk === risk.id ? null : risk.id)}
 className={expandedRisk === risk.id ? 'border-accent/20' : ''}
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
 <Badge variant={severityColor(risk.severity)}>{risk.severity}</Badge>
 <Badge variant="outline">{risk.category}</Badge>
 </div>
 </div>
 <p className="text-sm t-muted mt-1">{risk.description}</p>
 <div className="flex items-center gap-4 mt-2 text-xs text-gray-400">
 <span>Probability: {Math.round(risk.probability * 100)}%</span>
 <span>Impact: {risk.impactValue} {risk.impactUnit}</span>
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
 <p className="text-sm font-bold t-primary mt-0.5">{risk.impactValue.toLocaleString()} {risk.impactUnit}</p>
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
 </Card>
 ))}
 </div>
 </TabPanel>
 )}

 {/* Scenario Modelling Tab */}
 {activeTab === 'scenarios' && (
 <TabPanel>
 <div className="space-y-6">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">What-If Analysis</h3>
 <Button variant="primary" size="sm" onClick={() => { resetScenarioBuilder(); setShowScenarioBuilder(true); }} title="Create a new what-if scenario analysis"><Plus size={14} /> New Scenario</Button>
 </div>
 {scenarios.length === 0 && (
 <div className="flex flex-col items-center justify-center py-8 text-center">
 <BarChart3 className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No scenarios created yet.</p>
 <p className="text-xs t-muted mt-1">Click &quot;New Scenario&quot; above to create your first what-if analysis.</p>
 </div>
 )}
 {scenarios.map((scenario) => {
  const resultEntries = scenario.results ? Object.entries(scenario.results) : [];
  const hasResults = resultEntries.length > 0;
  return (
   <Card key={scenario.id}>
    <div className="flex items-start justify-between">
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
    </div>

    {/* Scenario Report */}
    {hasResults && (
     <div className="mt-4 space-y-4 animate-fadeIn">
      <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <div className="flex items-center gap-2 mb-3">
        <BarChart3 className="w-4 h-4 text-accent" />
        <h4 className="text-sm font-semibold t-primary">Results Overview</h4>
       </div>

       {/* Key Metrics Grid */}
       <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        {resultEntries.slice(0, 4).map(([key, val]) => (
         <div key={key} className="p-2.5 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
          <span className="text-[10px] t-muted uppercase tracking-wider">{key.replace(/[_-]/g, ' ')}</span>
          <p className="text-lg font-bold t-primary mt-0.5">{String(val)}</p>
         </div>
        ))}
       </div>

       {/* Analysis Narrative */}
       <div className="mb-4">
        <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Key Findings</h5>
        <p className="text-sm t-muted leading-relaxed">
         The <span className="font-medium t-primary">{scenario.title}</span> scenario analysis
         evaluated {scenario.variables.length > 0 ? `the impact of changes to ${scenario.variables.join(', ')}` : 'the projected outcomes'}.
         {resultEntries.length > 0 && ` The model produced ${resultEntries.length} output metric${resultEntries.length > 1 ? 's' : ''}.`}
         {scenario.inputQuery && ` Query: "${scenario.inputQuery}".`}
        </p>
       </div>

       {/* All Results Table */}
       {resultEntries.length > 4 && (
        <div className="mb-4">
         <h5 className="text-xs font-semibold t-primary mb-2 uppercase tracking-wider">Detailed Results</h5>
         <div className="space-y-1.5">
          {resultEntries.slice(4).map(([key, val]) => (
           <div key={key} className="flex items-center justify-between py-1.5 border-b border-[var(--border-card)] last:border-0">
            <span className="text-xs t-secondary capitalize">{key.replace(/[_-]/g, ' ')}</span>
            <span className="text-xs font-semibold t-primary">{String(val)}</span>
           </div>
          ))}
         </div>
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
 </div>
 </TabPanel>
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
 </div>
 );
}
