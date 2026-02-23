import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/ui/score-ring";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { businessHealthScore, executiveBriefing, riskAlerts, scenarios } from "@/data/mockData";
import {
  Crown, TrendingUp, TrendingDown, Minus, AlertTriangle, FileText,
  Play, CheckCircle, ArrowRight, BarChart3, Shield, Lightbulb
} from "lucide-react";
import { XAxis, YAxis, Tooltip, ResponsiveContainer, BarChart, Bar, Cell } from "recharts";

const trendIcon = (trend: string, size = 14) => {
  if (trend === 'up') return <TrendingUp size={size} className="text-emerald-400" />;
  if (trend === 'down') return <TrendingDown size={size} className="text-red-400" />;
  return <Minus size={size} className="text-neutral-500" />;
};

const severityColor = (s: string) => s === 'critical' ? 'danger' : s === 'high' ? 'warning' : s === 'medium' ? 'info' : 'default';

export function ApexPage() {
  const { activeTab, setActiveTab } = useTabState('health');
  const [expandedRisk, setExpandedRisk] = useState<string | null>(null);

  const tabs = [
    { id: 'health', label: 'Business Health', icon: <Crown size={14} /> },
    { id: 'briefing', label: 'Executive Briefing', icon: <FileText size={14} /> },
    { id: 'risks', label: 'Risk Alerts', icon: <AlertTriangle size={14} />, count: riskAlerts.length },
    { id: 'scenarios', label: 'Scenario Modelling', icon: <BarChart3 size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-amber-500/15 flex items-center justify-center">
            <Crown className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Atheon Apex</h1>
            <p className="text-sm text-neutral-400">Executive Intelligence - C-Suite Command Centre</p>
          </div>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {/* Business Health Tab */}
      {activeTab === 'health' && (
        <TabPanel>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <Card className="lg:col-span-1 flex flex-col items-center justify-center" glow>
              <ScoreRing score={businessHealthScore.overall} size="xl" label="Overall Health" sublabel="Composite Index" />
              <div className="flex items-center gap-2 mt-4">
                {trendIcon(businessHealthScore.trend)}
                <span className="text-sm text-emerald-400">+2.3 points (7d)</span>
              </div>
            </Card>

            <Card className="lg:col-span-2">
              <h3 className="text-lg font-semibold text-white mb-4">Dimension Breakdown</h3>
              <div className="space-y-4">
                {businessHealthScore.dimensions.map((dim) => (
                  <div key={dim.key} className="flex items-center gap-4">
                    <div className="w-36 flex-shrink-0">
                      <span className="text-sm text-neutral-300">{dim.name}</span>
                      <span className="block text-[10px] text-neutral-600">Weight: {(dim.weight * 100).toFixed(0)}%</span>
                    </div>
                    <div className="flex-1">
                      <Progress value={dim.score} color={dim.score >= 80 ? 'emerald' : dim.score >= 60 ? 'amber' : 'red'} size="md" />
                    </div>
                    <div className="w-12 text-right">
                      <span className="text-sm font-bold text-white">{dim.score}</span>
                    </div>
                    <div className="flex items-center gap-1 w-20">
                      {trendIcon(dim.trend, 12)}
                      <span className={`text-xs ${dim.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {dim.change > 0 ? '+' : ''}{dim.change}
                      </span>
                    </div>
                    <Sparkline data={dim.sparkline} width={60} height={20} color={dim.trend === 'up' ? '#10b981' : dim.trend === 'down' ? '#ef4444' : '#6b7280'} />
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
            <Card glow>
              <div className="flex items-center gap-2 mb-3">
                <FileText className="w-4 h-4 text-amber-400" />
                <h3 className="text-lg font-semibold text-white">Daily Executive Briefing</h3>
                <Badge variant="info">Today</Badge>
              </div>
              <p className="text-sm text-neutral-300 leading-relaxed">{executiveBriefing.narrative}</p>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* KPI Movements */}
              <Card>
                <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                  <TrendingUp className="w-4 h-4 text-indigo-400" /> KPI Movements
                </h3>
                <div className="space-y-3">
                  {executiveBriefing.kpiMovements.map((kpi) => (
                    <div key={kpi.kpi} className="flex items-center justify-between py-2 border-b border-neutral-800/50 last:border-0">
                      <span className="text-sm text-neutral-300">{kpi.kpi}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-white">{kpi.value}{kpi.unit && ` ${kpi.unit}`}</span>
                        <div className="flex items-center gap-1">
                          {trendIcon(kpi.trend, 12)}
                          <span className={`text-xs ${kpi.change >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                            {kpi.change > 0 ? '+' : ''}{kpi.change}%
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top Risks */}
              <Card>
                <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-400" /> Top Risks
                </h3>
                <div className="space-y-3">
                  {executiveBriefing.topRisks.map((risk) => (
                    <div key={risk.id} className="p-3 rounded-lg bg-neutral-800/40">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-medium text-neutral-200">{risk.title}</h4>
                        <Badge variant={severityColor(risk.severity)} size="sm">{risk.severity}</Badge>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">{risk.description}</p>
                    </div>
                  ))}
                </div>
              </Card>

              {/* Top Opportunities */}
              <Card>
                <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                  <Lightbulb className="w-4 h-4 text-emerald-400" /> Opportunities
                </h3>
                <div className="space-y-3">
                  {executiveBriefing.topOpportunities.map((opp) => (
                    <div key={opp.id} className="p-3 rounded-lg bg-neutral-800/40">
                      <div className="flex items-start justify-between gap-2">
                        <h4 className="text-sm font-medium text-neutral-200">{opp.title}</h4>
                        <Badge variant="success" size="sm">{Math.round(opp.confidence * 100)}%</Badge>
                      </div>
                      <p className="text-xs text-neutral-500 mt-1">{opp.description}</p>
                    </div>
                  ))}
                </div>
              </Card>
            </div>

            {/* Required Decisions */}
            {executiveBriefing.requiredDecisions.length > 0 && (
              <Card className="border-amber-500/20">
                <h3 className="text-base font-semibold text-white mb-3 flex items-center gap-2">
                  <Shield className="w-4 h-4 text-amber-400" /> Decisions Required
                </h3>
                {executiveBriefing.requiredDecisions.map((dec) => (
                  <div key={dec.id} className="p-4 rounded-lg bg-amber-500/5 border border-amber-500/10">
                    <h4 className="text-sm font-semibold text-amber-200">{dec.title}</h4>
                    <p className="text-xs text-neutral-400 mt-1">{dec.description}</p>
                    <div className="flex gap-2 mt-3">
                      {dec.options.map((opt) => (
                        <Button
                          key={opt.id}
                          variant={opt.id === dec.recommendedOption ? 'success' : 'secondary'}
                          size="sm"
                        >
                          {opt.id === dec.recommendedOption && <CheckCircle size={12} />}
                          {opt.label}
                        </Button>
                      ))}
                    </div>
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
            {riskAlerts.map((risk) => (
              <Card
                key={risk.id}
                hover
                onClick={() => setExpandedRisk(expandedRisk === risk.id ? null : risk.id)}
                className={expandedRisk === risk.id ? 'border-indigo-500/30' : ''}
              >
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    risk.severity === 'critical' ? 'bg-red-500/15' : risk.severity === 'high' ? 'bg-amber-500/15' : 'bg-blue-500/15'
                  }`}>
                    <AlertTriangle className={`w-5 h-5 ${
                      risk.severity === 'critical' ? 'text-red-400' : risk.severity === 'high' ? 'text-amber-400' : 'text-blue-400'
                    }`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-3">
                      <h3 className="text-base font-semibold text-white">{risk.title}</h3>
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <Badge variant={severityColor(risk.severity)}>{risk.severity}</Badge>
                        <Badge variant="outline">{risk.category}</Badge>
                      </div>
                    </div>
                    <p className="text-sm text-neutral-400 mt-1">{risk.description}</p>
                    <div className="flex items-center gap-4 mt-2 text-xs text-neutral-500">
                      <span>Confidence: {Math.round(risk.confidence * 100)}%</span>
                      <span>Probability: {Math.round(risk.probability * 100)}%</span>
                      <span>Impact: {Math.round(risk.impact * 100)}%</span>
                    </div>

                    {expandedRisk === risk.id && (
                      <div className="mt-4 p-4 rounded-lg bg-neutral-800/40 border border-neutral-800/50 animate-fadeIn">
                        <h4 className="text-sm font-semibold text-white mb-2">Recommended Actions</h4>
                        <div className="space-y-2">
                          {risk.recommendedActions.map((action, i) => (
                            <div key={i} className="flex items-start gap-2">
                              <ArrowRight className="w-3.5 h-3.5 text-indigo-400 mt-0.5 flex-shrink-0" />
                              <span className="text-sm text-neutral-300">{action}</span>
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
              <h3 className="text-lg font-semibold text-white">Scenario Analysis</h3>
              <Button variant="primary" size="sm"><Play size={14} /> New Scenario</Button>
            </div>
            {scenarios.map((scenario) => (
              <Card key={scenario.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="text-base font-semibold text-white">{scenario.name}</h3>
                    <p className="text-sm text-neutral-400 mt-1">{scenario.description}</p>
                  </div>
                  <Badge variant={scenario.status === 'completed' ? 'success' : 'warning'}>{scenario.status}</Badge>
                </div>

                {scenario.results && (
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="p-3 rounded-lg bg-neutral-800/40">
                        <span className="text-xs text-neutral-500">Revenue Impact</span>
                        <p className={`text-lg font-bold ${scenario.results.revenue >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {scenario.results.revenue > 0 ? '+' : ''}{scenario.results.revenue}M
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-neutral-800/40">
                        <span className="text-xs text-neutral-500">Cost Impact</span>
                        <p className={`text-lg font-bold ${scenario.results.cost <= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {scenario.results.cost > 0 ? '+' : ''}{scenario.results.cost}M
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-neutral-800/40">
                        <span className="text-xs text-neutral-500">Net Profit</span>
                        <p className={`text-lg font-bold ${scenario.results.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                          {scenario.results.profit > 0 ? '+' : ''}{scenario.results.profit}M
                        </p>
                      </div>
                      <div className="p-3 rounded-lg bg-neutral-800/40">
                        <span className="text-xs text-neutral-500">Probability</span>
                        <p className="text-lg font-bold text-indigo-400">{Math.round(scenario.results.probability * 100)}%</p>
                      </div>
                    </div>
                    <div className="h-40">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={scenario.results.timeline}>
                          <XAxis dataKey="month" tick={{ fill: '#737373', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <YAxis tick={{ fill: '#737373', fontSize: 10 }} axisLine={false} tickLine={false} />
                          <Tooltip contentStyle={{ background: '#171717', border: '1px solid #262626', borderRadius: '8px', fontSize: '12px' }} />
                          <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                            {scenario.results.timeline.map((entry, index) => (
                              <Cell key={index} fill={entry.value >= 0 ? '#10b981' : '#ef4444'} />
                            ))}
                          </Bar>
                        </BarChart>
                      </ResponsiveContainer>
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
