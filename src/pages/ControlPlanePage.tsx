import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { agentDeployments, tenants } from "@/data/tenantData";
import {
  Bot, Play, Square, RefreshCw, Plus, Server, Cloud, GitBranch,
  CheckCircle, XCircle, Activity, ChevronDown, ChevronUp,
  Settings, Shield, Cpu
} from "lucide-react";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  running: { icon: CheckCircle, color: 'text-emerald-400', label: 'Running' },
  deploying: { icon: RefreshCw, color: 'text-blue-400', label: 'Deploying' },
  stopped: { icon: Square, color: 'text-neutral-500', label: 'Stopped' },
  error: { icon: XCircle, color: 'text-red-400', label: 'Error' },
  pending: { icon: Activity, color: 'text-amber-400', label: 'Pending' },
};

const healthColor = (status: string) => {
  if (status === 'healthy') return 'success';
  if (status === 'degraded') return 'warning';
  return 'danger';
};

export function ControlPlanePage() {
  const [expandedDep, setExpandedDep] = useState<string | null>(null);

  const running = agentDeployments.filter(d => d.status === 'running').length;
  const totalAgents = agentDeployments.reduce((s, d) => s + d.config.replicas, 0);

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Agent Control Plane</h1>
            <p className="text-sm text-neutral-400">Deploy, manage, and monitor Catalyst agents per tenant</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> Deploy Agent</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Total Deployments</span>
          <p className="text-2xl font-bold text-white mt-1">{agentDeployments.length}</p>
          <span className="text-xs text-emerald-400">{running} running</span>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Total Replicas</span>
          <p className="text-2xl font-bold text-white mt-1">{totalAgents}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Avg Uptime</span>
          <p className="text-2xl font-bold text-emerald-400 mt-1">
            {(agentDeployments.filter(d => d.status === 'running').reduce((s, d) => s + d.healthCheck.uptime, 0) / running).toFixed(2)}%
          </p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Avg Throughput</span>
          <p className="text-2xl font-bold text-white mt-1">
            {Math.round(agentDeployments.filter(d => d.status === 'running').reduce((s, d) => s + d.healthCheck.tasksPerMinute, 0) / running)} tasks/min
          </p>
        </Card>
      </div>

      {/* Deployments List */}
      <div className="space-y-4">
        {agentDeployments.map((dep) => {
          const tenant = tenants.find(t => t.id === dep.tenantId);
          const sConfig = statusConfig[dep.status];
          const StatusIcon = sConfig.icon;
          return (
            <Card
              key={dep.id}
              hover
              onClick={() => setExpandedDep(expandedDep === dep.id ? null : dep.id)}
            >
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/15 flex items-center justify-center">
                    <Bot className="w-5 h-5 text-cyan-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-semibold text-white">{dep.clusterName}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-neutral-400">{tenant?.name || dep.tenantId}</span>
                      <Badge variant={dep.deploymentModel === 'saas' ? 'info' : dep.deploymentModel === 'on-premise' ? 'warning' : 'default'} size="sm">
                        {dep.deploymentModel === 'saas' && <Cloud size={10} className="mr-1" />}
                        {dep.deploymentModel === 'on-premise' && <Server size={10} className="mr-1" />}
                        {dep.deploymentModel === 'hybrid' && <GitBranch size={10} className="mr-1" />}
                        {dep.deploymentModel}
                      </Badge>
                      <Badge variant="outline" size="sm">{dep.autonomyTier}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <StatusIcon size={14} className={sConfig.color} />
                    <span className={`text-sm font-medium ${sConfig.color}`}>{sConfig.label}</span>
                  </div>
                  <Badge variant={healthColor(dep.healthCheck.status) as 'success' | 'warning' | 'danger'} size="sm">
                    {dep.healthCheck.status}
                  </Badge>
                  {expandedDep === dep.id ? <ChevronUp size={14} className="text-neutral-500" /> : <ChevronDown size={14} className="text-neutral-500" />}
                </div>
              </div>

              {/* Quick Metrics */}
              <div className="grid grid-cols-5 gap-3 mt-4">
                <div className="text-center p-2 rounded bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600">Replicas</span>
                  <p className="text-sm font-bold text-white">{dep.config.replicas}</p>
                </div>
                <div className="text-center p-2 rounded bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600">Uptime</span>
                  <p className="text-sm font-bold text-emerald-400">{dep.healthCheck.uptime}%</p>
                </div>
                <div className="text-center p-2 rounded bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600">P95 Latency</span>
                  <p className="text-sm font-bold text-white">{dep.healthCheck.latencyP95}ms</p>
                </div>
                <div className="text-center p-2 rounded bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600">Error Rate</span>
                  <p className={`text-sm font-bold ${dep.healthCheck.errorRate < 0.1 ? 'text-emerald-400' : 'text-amber-400'}`}>{dep.healthCheck.errorRate}%</p>
                </div>
                <div className="text-center p-2 rounded bg-neutral-800/40">
                  <span className="text-[10px] text-neutral-600">Tasks/min</span>
                  <p className="text-sm font-bold text-white">{dep.healthCheck.tasksPerMinute}</p>
                </div>
              </div>

              {expandedDep === dep.id && (
                <div className="mt-4 space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Config */}
                    <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-800/50">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Settings size={14} className="text-cyan-400" /> Configuration
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-neutral-500">Max Concurrent Tasks</span><span className="text-neutral-200">{dep.config.maxConcurrentTasks}</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Confidence Threshold</span><span className="text-neutral-200">{dep.config.confidenceThreshold * 100}%</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Escalation Policy</span><Badge variant="outline" size="sm">{dep.config.escalationPolicy}</Badge></div>
                        <div className="flex justify-between"><span className="text-neutral-500">CPU / Memory</span><span className="text-neutral-200">{dep.config.resourceLimits.cpuMillicores}m / {dep.config.resourceLimits.memoryMb}MB</span></div>
                        <div className="flex justify-between"><span className="text-neutral-500">Deployed By</span><span className="text-neutral-200">{dep.deployedBy}</span></div>
                      </div>
                    </div>

                    {/* Permissions */}
                    <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-800/50">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Shield size={14} className="text-emerald-400" /> Action Permissions
                      </h4>
                      <div className="space-y-2">
                        <div>
                          <span className="text-[10px] text-neutral-600">Allowed Actions</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {dep.config.allowedActions.map(a => (
                              <Badge key={a} variant="success" size="sm">{a}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-600">Blocked Actions</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {dep.config.blockedActions.map(a => (
                              <Badge key={a} variant="danger" size="sm">{a}</Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-2">
                    {dep.status === 'running' && <Button variant="danger" size="sm"><Square size={12} /> Stop</Button>}
                    {dep.status === 'stopped' && <Button variant="success" size="sm"><Play size={12} /> Start</Button>}
                    <Button variant="secondary" size="sm"><RefreshCw size={12} /> Restart</Button>
                    <Button variant="secondary" size="sm"><Settings size={12} /> Edit Config</Button>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
