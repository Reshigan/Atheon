import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/ui/sparkline";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Metric, AnomalyItem, ProcessItem, CorrelationItem } from "@/lib/api";
import { Activity, AlertTriangle, GitBranch, Link2, ArrowRight, Loader2 } from "lucide-react";

export function PulsePage() {
  const { activeTab, setActiveTab } = useTabState('monitoring');
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [anomalies, setAnomalies] = useState<AnomalyItem[]>([]);
  const [processes, setProcesses] = useState<ProcessItem[]>([]);
  const [correlations, setCorrelations] = useState<CorrelationItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [m, a, p, c] = await Promise.allSettled([
        api.pulse.metrics(), api.pulse.anomalies(), api.pulse.processes(), api.pulse.correlations(),
      ]);
      if (m.status === 'fulfilled') setMetrics(m.value.metrics);
      if (a.status === 'fulfilled') setAnomalies(a.value.anomalies);
      if (p.status === 'fulfilled') setProcesses(p.value.processes);
      if (c.status === 'fulfilled') setCorrelations(c.value.correlations);
      setLoading(false);
    }
    load();
  }, []);

  const tabs = [
    { id: 'monitoring', label: 'Live Monitoring', icon: <Activity size={14} /> },
    { id: 'anomalies', label: 'Anomalies', icon: <AlertTriangle size={14} />, count: anomalies.length },
    { id: 'processes', label: 'Process Mining', icon: <GitBranch size={14} /> },
    { id: 'correlations', label: 'Correlations', icon: <Link2 size={14} /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
          <Activity className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Atheon Pulse</h1>
          <p className="text-sm text-gray-500">Process Intelligence - Operational Nervous System</p>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'monitoring' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {metrics.map((metric) => (
              <Card key={metric.id} hover>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-400 truncate">{metric.name}</span>
                  <span className={`w-2.5 h-2.5 rounded-full ${
                    metric.status === 'green' ? 'bg-emerald-500' : metric.status === 'amber' ? 'bg-amber-500' : 'bg-red-500'
                  }`} />
                </div>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-2xl font-bold text-gray-900">{metric.value}</span>
                    <span className="text-sm text-gray-400 ml-1">{metric.unit}</span>
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
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'anomalies' && (
        <TabPanel>
          <div className="space-y-4">
            {anomalies.map((anom: AnomalyItem) => (
              <Card key={anom.id}>
                <div className="flex items-start gap-4">
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${
                    anom.severity === 'critical' ? 'bg-red-50' : anom.severity === 'high' ? 'bg-amber-50' : 'bg-blue-50'
                  }`}>
                    <AlertTriangle className={`w-5 h-5 ${
                      anom.severity === 'critical' ? 'text-red-600' : anom.severity === 'high' ? 'text-amber-600' : 'text-blue-600'
                    }`} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-start justify-between">
                      <h3 className="text-base font-semibold text-gray-900">{anom.metric}</h3>
                      <Badge variant={anom.severity === 'critical' ? 'danger' : anom.severity === 'high' ? 'warning' : 'info'}>
                        +{anom.deviation}% deviation
                      </Badge>
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{anom.hypothesis}</p>
                    <div className="grid grid-cols-3 gap-4 mt-3">
                      <div className="p-2 rounded bg-gray-100">
                        <span className="text-[10px] text-gray-400">Expected</span>
                        <p className="text-sm font-medium text-gray-600">{anom.expectedValue}</p>
                      </div>
                      <div className="p-2 rounded bg-gray-100">
                        <span className="text-[10px] text-gray-400">Actual</span>
                        <p className="text-sm font-medium text-red-600">{anom.actualValue}</p>
                      </div>
                      <div className="p-2 rounded bg-gray-100">
                        <span className="text-[10px] text-gray-400">Detected</span>
                        <p className="text-sm font-medium text-gray-600">{new Date(anom.detectedAt).toLocaleTimeString()}</p>
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
            {processes.map((flow) => (
              <Card key={flow.id}>
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900">{flow.name}</h3>
                    <div className="flex items-center gap-4 mt-1 text-xs text-gray-400">
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
                        step.status === 'bottleneck' ? 'bg-red-50 border-red-200' :
                        step.status === 'degraded' ? 'bg-amber-50 border-amber-200' :
                        'bg-gray-100 border-gray-200'
                      }`}>
                        <span className="text-sm font-medium text-gray-800">{step.name}</span>
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
                    <span className="text-xs font-medium text-red-600">Bottlenecks: </span>
                    <span className="text-xs text-gray-500">{flow.bottlenecks.join(', ')}</span>
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
            {correlations.map((event) => (
              <Card key={event.id}>
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="p-2 rounded-lg bg-blue-50 text-center min-w-20">
                      <span className="text-xs text-blue-600 font-medium">{event.sourceSystem}</span>
                    </div>
                    <div className="flex-1 relative">
                      <div className="h-px bg-gradient-to-r from-blue-500/50 to-indigo-500/50" />
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-full bg-white border border-gray-300 text-[10px] text-gray-500">
                        {event.lagDays}d lag
                      </div>
                    </div>
                    <div className="p-2 rounded-lg bg-indigo-50 text-center min-w-20">
                      <span className="text-xs text-indigo-600 font-medium">{event.targetSystem}</span>
                    </div>
                  </div>
                  <Badge variant="info">{Math.round(event.confidence * 100)}%</Badge>
                </div>
                <div className="grid grid-cols-2 gap-4 mt-3">
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Source Event</span>
                    <p className="text-sm text-gray-600">{event.sourceEvent}</p>
                  </div>
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Target Impact</span>
                    <p className="text-sm text-gray-600">{event.targetImpact}</p>
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
