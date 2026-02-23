import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { processMetrics, anomalies, processFlows, correlationEvents } from "@/data/mockData";
import { Activity, AlertTriangle, GitBranch, Link2, ArrowRight } from "lucide-react";

export function PulsePage() {
  const { activeTab, setActiveTab } = useTabState('monitoring');

  const tabs = [
    { id: 'monitoring', label: 'Live Monitoring', icon: <Activity size={14} /> },
    { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={14} />, count: anomalies.length },
    { id: 'processes', label: 'Process Mining', icon: <GitBranch size={14} /> },
    { id: 'correlations', label: 'Correlations', icon: <Link2 size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
          <Activity className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-white">Atheon Pulse</h1>
          <p className="text-sm text-neutral-400">Process Intelligence - Operational Nervous System</p>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'monitoring' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {processMetrics.map((metric) => (
              <Card key={metric.id} hover>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-neutral-500 truncate">{metric.name}</span>
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                  }`} />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold text-white">{metric.value}</span>
                    <span className="text-sm text-neutral-500 ml-1">{metric.unit}</span>
                  </div>
                  <Sparkline
                    data={metric.trend}
                    width={80}
                    height={30}
                    color={metric.status === 'green' ? '#10b981' : metric.status === 'amber' ? '#f59e0b' : '#ef4444'}
                  />
                </div>
                <div className="mt-3">
                  <div className="flex items-center justify-between text-[10px] text-neutral-600 mb-1">
                    <span>Threshold</span>
                    <span className="text-emerald-500">{metric.threshold.green} (green)</span>
                  </div>
                  <Progress
                    value={metric.value}
                    max={metric.threshold.red * 1.2}
                    color={metric.status === 'green' ? 'emerald' : metric.status === 'amber' ? 'amber' : 'red'}
                    size="sm"
                  />
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'anomalies' && (
        <TabPanel>
          <div className="space-y-4">
            {anomalies.map((anom) => (
              <Card key={anom.id}>
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    anom.severity === 'critical' ? 'bg-red-500/15' : anom.severity === 'high' ? 'bg-amber-500/15' : 'bg-blue-500/15'
                  }`}>
                    <AlertTriangle className={`w-5 h-5 ${
                      anom.severity === 'critical' ? 'text-red-400' : anom.severity === 'high' ? 'text-amber-400' : 'text-blue-400'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <h3 className="text-base font-semibold text-white">{anom.metric}</h3>
                      <Badge variant={anom.severity === 'critical' ? 'danger' : anom.severity === 'high' ? 'warning' : 'info'}>
                        +{anom.deviation}% deviation
                      </Badge>
                    </div>
                    <p className="text-sm text-neutral-400 mt-1">{anom.hypothesis}</p>
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div className="p-2 rounded bg-neutral-800/40">
                        <span className="text-[10px] text-neutral-600">Expected</span>
                        <p className="text-sm font-medium text-neutral-300">{anom.expectedValue}</p>
                      </div>
                      <div className="p-2 rounded bg-neutral-800/40">
                        <span className="text-[10px] text-neutral-600">Actual</span>
                        <p className="text-sm font-medium text-red-400">{anom.actualValue}</p>
                      </div>
                      <div className="p-2 rounded bg-neutral-800/40">
                        <span className="text-[10px] text-neutral-600">Detected</span>
                        <p className="text-sm font-medium text-neutral-300">{new Date(anom.detectedAt).toLocaleTimeString()}</p>
                      </div>
                    </div>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'processes' && (
        <TabPanel>
          <div className="space-y-6">
            {processFlows.map((flow) => (
              <Card key={flow.id}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white">{flow.name}</h3>
                    <div className="flex items-center gap-4 mt-1 text-xs text-neutral-500">
                      <span>{flow.variants} variants</span>
                      <span>Avg duration: {flow.avgDuration} days</span>
                      <span>Conformance: {flow.conformanceRate}%</span>
                    </div>
                  </div>
                  <Badge variant={flow.conformanceRate >= 80 ? 'success' : 'warning'}>{flow.conformanceRate}% conformance</Badge>
                </div>

                {/* Process Flow Visualization */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                  {flow.steps.map((step, i) => (
                    <div key={step.id} className="flex items-center gap-2">
                      <div className={`p-3 rounded-lg border min-w-32 ${
                        step.status === 'bottleneck' ? 'bg-red-500/10 border-red-500/30' :
                        step.status === 'degraded' ? 'bg-amber-500/10 border-amber-500/30' :
                        'bg-neutral-800/40 border-neutral-700/50'
                      }`}>
                        <span className="text-sm font-medium text-neutral-200">{step.name}</span>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-neutral-500">
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
                        <ArrowRight className="w-4 h-4 text-neutral-600 flex-shrink-0" />
                      )}
                    </div>
                  ))}
                </div>

                {flow.bottlenecks.length > 0 && (
                  <div className="mt-3 p-3 rounded-lg bg-red-500/5 border border-red-500/10">
                    <span className="text-xs font-medium text-red-400">Bottlenecks: </span>
                    <span className="text-xs text-neutral-400">{flow.bottlenecks.join(', ')}</span>
                  </div>
                )}
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'correlations' && (
        <TabPanel>
          <div className="space-y-4">
            {correlationEvents.map((event) => (
              <Card key={event.id}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-2 rounded-lg bg-blue-500/15 text-center min-w-20">
                      <span className="text-xs text-blue-400 font-medium">{event.sourceSystem}</span>
                    </div>
                    <div className="flex-1 relative">
                      <div className="h-px bg-gradient-to-r from-blue-500/50 to-indigo-500/50" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-neutral-900 border border-neutral-700 text-[10px] text-neutral-400">
                        {event.lag}d lag
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-500/15 text-center min-w-20">
                      <span className="text-xs text-indigo-400 font-medium">{event.targetSystem}</span>
                    </div>
                  </div>
                  <Badge variant="info">{Math.round(event.confidence * 100)}%</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Source Event</span>
                    <p className="text-sm text-neutral-300">{event.sourceEvent}</p>
                  </div>
                  <div className="p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Target Impact</span>
                    <p className="text-sm text-neutral-300">{event.targetImpact}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}
    </div>
  );
}
