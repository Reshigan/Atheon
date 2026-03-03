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
import {
 Crown, TrendingUp, TrendingDown, Minus, AlertTriangle, FileText,
 Play, ArrowRight, BarChart3, Shield, Lightbulb, Loader2, AlertCircle, X
} from "lucide-react";


const trendIcon = (trend: string, size = 14) => {
 if (trend === 'up' || trend === 'improving') return <TrendingUp size={size} className="text-emerald-400" />;
 if (trend === 'down' || trend === 'declining') return <TrendingDown size={size} className="text-red-400" />;
 return <Minus size={size} className="text-gray-400" />;
};

const severityColor = (s: string) => s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

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

 const handleNewScenario = async () => {
 if (creatingScenario) return;
 setCreatingScenario(true);
 setActionError(null);
 try {
 const result = await api.apex.createScenario({
 title: `Scenario ${scenarios.length + 1}`,
 description: 'New what-if analysis',
 input_query: 'What if revenue drops by 10%?',
 variables: ['revenue', 'margin', 'headcount']});
 if (result.id) {
 const s = await api.apex.scenarios();
 setScenarios(s.scenarios);
 }
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to create scenario');
 }
 setCreatingScenario(false);
 };

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
 { id: 'briefing', label: 'Executive Briefing', icon: <FileText size={14} /> },
 { id: 'risks', label: 'Risk Alerts', icon: <AlertTriangle size={14} />, count: risks.length },
 { id: 'scenarios', label: 'Scenario Modelling', icon: <BarChart3 size={14} /> },
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
 <p className="text-sm t-muted mt-1">Executive Intelligence — C-Suite Command Centre</p>
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
 <h3 className="text-lg font-semibold t-primary mb-4">Dimension Breakdown</h3>
 {dimensions.length === 0 && (
 <div className="flex flex-col items-center justify-center py-12 text-center">
 <Crown className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No dimensions available yet.</p>
 <p className="text-xs t-muted mt-1">Run a catalyst from the Catalysts page to generate health insights.</p>
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
 <div className="mt-4 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] animate-fadeIn">
 <h4 className="text-sm font-semibold t-primary mb-2">Recommended Actions</h4>
 <div className="space-y-2">
 {risk.recommendedActions.map((action, i) => (
 <div key={i} className="flex items-start gap-2">
 <ArrowRight className="w-3.5 h-3.5 text-accent mt-0.5 flex-shrink-0" />
 <span className="text-sm t-secondary">{action}</span>
 </div>
 ))}
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
 <h3 className="text-lg font-semibold t-primary">Scenario Analysis</h3>
 <Button variant="primary" size="sm" onClick={handleNewScenario} title="Create a new what-if scenario analysis"><Play size={14} /> New Scenario</Button>
 </div>
 {scenarios.length === 0 && (
 <div className="flex flex-col items-center justify-center py-8 text-center">
 <BarChart3 className="w-10 h-10 t-muted mb-3 opacity-30" />
 <p className="text-sm t-muted">No scenarios created yet.</p>
 <p className="text-xs t-muted mt-1">Click &quot;New Scenario&quot; above to create your first what-if analysis.</p>
 </div>
 )}
 {scenarios.map((scenario) => (
 <Card key={scenario.id}>
 <div className="flex items-start justify-between">
 <div>
 <h3 className="text-base font-semibold t-primary">{scenario.title}</h3>
 <p className="text-sm t-muted mt-1">{scenario.description}</p>
 </div>
 <Badge variant={scenario.status === 'completed' ? 'success' : 'warning'}>{scenario.status}</Badge>
 </div>

 {scenario.results && (
 <div className="mt-4">
 <div className="grid grid-cols-2 gap-3">
 {Object.entries(scenario.results).slice(0, 4).map(([key, val]) => (
 <div key={key} className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">{key}</span>
 <p className="text-lg font-bold t-primary">{String(val)}</p>
 </div>
 ))}
 </div>
 </div>
 )}
 </Card>
 ))}
 </div>
 </TabPanel>
 )}
 </div>
 );
}
