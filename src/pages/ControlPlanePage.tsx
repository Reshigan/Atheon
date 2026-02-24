import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ControlPlaneHealth, DeploymentItem } from "@/lib/api";
import {
  Bot, Play, Square, RefreshCw, Plus, Server, Cloud, GitBranch,
  CheckCircle, XCircle, Activity, ChevronDown, ChevronUp,
  Settings, Shield, Cpu, Loader2
} from "lucide-react";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
  running: { icon: CheckCircle, color: 'text-emerald-600', label: 'Running' },
  deploying: { icon: RefreshCw, color: 'text-blue-600', label: 'Deploying' },
  stopped: { icon: Square, color: 'text-gray-400', label: 'Stopped' },
  error: { icon: XCircle, color: 'text-red-600', label: 'Error' },
  pending: { icon: Activity, color: 'text-amber-600', label: 'Pending' },
};

interface DeploymentConfig {
  replicas?: number;
  maxConcurrentTasks?: number;
  confidenceThreshold?: number;
  escalationPolicy?: string;
  resourceLimits?: { cpuMillicores?: number; memoryMb?: number };
  allowedActions?: string[];
  blockedActions?: string[];
}

function healthVariant(score: number): 'success' | 'warning' | 'danger' {
  if (score >= 80) return 'success';
  if (score >= 60) return 'warning';
  return 'danger';
}

export function ControlPlanePage() {
  const [expandedDep, setExpandedDep] = useState<string | null>(null);
  const [deployments, setDeployments] = useState<DeploymentItem[]>([]);
  const [_health, setHealth] = useState<ControlPlaneHealth | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [d, h] = await Promise.allSettled([
        api.controlplane.deployments(),
        api.controlplane.health(),
      ]);
      if (d.status === 'fulfilled') setDeployments(d.value.deployments);
      if (h.status === 'fulfilled') setHealth(h.value);
      setLoading(false);
    }
    load();
  }, []);

  const computed = useMemo(() => {
    const running = deployments.filter(d => d.status === 'running').length;
    const totalReplicas = deployments.reduce((s, d) => {
      const cfg = d.config as DeploymentConfig;
      return s + (typeof cfg.replicas === 'number' ? cfg.replicas : 1);
    }, 0);
    const avgUptime = deployments.length
      ? deployments.reduce((s, d) => s + (d.uptime || 0), 0) / deployments.length
      : 0;
    const avgHealth = deployments.length
      ? deployments.reduce((s, d) => s + (d.healthScore || 0), 0) / deployments.length
      : 0;
    return { running, totalReplicas, avgUptime, avgHealth };
  }, [deployments]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 flex items-center justify-center">
            <Cpu className="w-5 h-5 text-cyan-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Agent Control Plane</h1>
            <p className="text-sm text-gray-500">Deploy, manage, and monitor Catalyst agents per tenant</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> Deploy Agent</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Total Deployments</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{deployments.length}</p>
          <span className="text-xs text-emerald-600">{computed.running} running</span>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Total Replicas</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{computed.totalReplicas}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Avg Uptime</span>
          <p className="text-2xl font-bold text-emerald-600 mt-1">
            {computed.avgUptime.toFixed(2)}%
          </p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Avg Health</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">
            {Math.round(computed.avgHealth)}%
          </p>
        </Card>
      </div>

      {/* Deployments List */}
      <div className="space-y-4">
        {deployments.map((dep) => {
          const sConfig = statusConfig[dep.status] || statusConfig.pending;
          const StatusIcon = sConfig.icon;
          const cfg = dep.config as DeploymentConfig;
          const replicas = typeof cfg.replicas === 'number' ? cfg.replicas : 1;
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
                    <h3 className="text-base font-semibold text-gray-900">{dep.name || dep.clusterName || dep.id}</h3>
                    <div className="flex items-center gap-3 mt-1">
                      <span className="text-xs text-gray-500">{dep.tenantName || dep.tenantId}</span>
                      <Badge variant={dep.deploymentModel === 'saas' ? 'info' : dep.deploymentModel === 'on-premise' ? 'warning' : 'default'} size="sm">
                        {dep.deploymentModel === 'saas' && <Cloud size={10} className="mr-1" />}
                        {dep.deploymentModel === 'on-premise' && <Server size={10} className="mr-1" />}
                        {dep.deploymentModel === 'hybrid' && <GitBranch size={10} className="mr-1" />}
                        {dep.deploymentModel}
                      </Badge>
                      <Badge variant="outline" size="sm">{dep.agentType}</Badge>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <StatusIcon size={14} className={sConfig.color} />
                    <span className={`text-sm font-medium ${sConfig.color}`}>{sConfig.label}</span>
                  </div>
                  <Badge variant={healthVariant(dep.healthScore)} size="sm">{dep.healthScore}%</Badge>
                  {expandedDep === dep.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
                </div>
              </div>

              {/* Quick Metrics */}
              <div className="grid grid-cols-5 gap-3 mt-4">
                <div className="text-center p-2 rounded bg-gray-100">
                  <span className="text-[10px] text-gray-400">Replicas</span>
                  <p className="text-sm font-bold text-gray-900">{replicas}</p>
                </div>
                <div className="text-center p-2 rounded bg-gray-100">
                  <span className="text-[10px] text-gray-400">Uptime</span>
                  <p className="text-sm font-bold text-emerald-600">{dep.uptime.toFixed(1)}%</p>
                </div>
                <div className="text-center p-2 rounded bg-gray-100">
                  <span className="text-[10px] text-gray-400">Version</span>
                  <p className="text-sm font-bold text-gray-900">{dep.version}</p>
                </div>
                <div className="text-center p-2 rounded bg-gray-100">
                  <span className="text-[10px] text-gray-400">Tasks</span>
                  <p className="text-sm font-bold text-gray-900">{dep.tasksExecuted.toLocaleString()}</p>
                </div>
                <div className="text-center p-2 rounded bg-gray-100">
                  <span className="text-[10px] text-gray-400">Heartbeat</span>
                  <p className="text-sm font-bold text-gray-900">{dep.lastHeartbeat ? new Date(dep.lastHeartbeat).toLocaleTimeString() : 'N/A'}</p>
                </div>
              </div>

              {expandedDep === dep.id && (
                <div className="mt-4 space-y-4 animate-fadeIn">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Config */}
                    <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Settings size={14} className="text-cyan-400" /> Configuration
                      </h4>
                      <div className="space-y-2 text-xs">
                        <div className="flex justify-between"><span className="text-gray-400">Replicas</span><span className="text-gray-800">{replicas}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Max Concurrent Tasks</span><span className="text-gray-800">{cfg.maxConcurrentTasks ?? 'N/A'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Confidence Threshold</span><span className="text-gray-800">{typeof cfg.confidenceThreshold === 'number' ? `${Math.round(cfg.confidenceThreshold * 100)}%` : 'N/A'}</span></div>
                        <div className="flex justify-between"><span className="text-gray-400">Escalation Policy</span><Badge variant="outline" size="sm">{cfg.escalationPolicy ?? 'N/A'}</Badge></div>
                        <div className="flex justify-between"><span className="text-gray-400">CPU / Memory</span><span className="text-gray-800">{cfg.resourceLimits?.cpuMillicores ?? '?'}m / {cfg.resourceLimits?.memoryMb ?? '?'}MB</span></div>
                      </div>
                    </div>

                    {/* Permissions */}
                    <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Shield size={14} className="text-emerald-600" /> Action Permissions
                      </h4>
                      <div className="space-y-2">
                        <div>
                          <span className="text-[10px] text-gray-400">Allowed Actions</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(Array.isArray(cfg.allowedActions) ? cfg.allowedActions : []).map((a: string) => (
                              <Badge key={a} variant="success" size="sm">{a}</Badge>
                            ))}
                            {(!cfg.allowedActions || (Array.isArray(cfg.allowedActions) && cfg.allowedActions.length === 0)) && (
                              <span className="text-xs text-gray-400">None</span>
                            )}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-gray-400">Blocked Actions</span>
                          <div className="flex flex-wrap gap-1 mt-1">
                            {(Array.isArray(cfg.blockedActions) ? cfg.blockedActions : []).map((a: string) => (
                              <Badge key={a} variant="danger" size="sm">{a}</Badge>
                            ))}
                            {(!cfg.blockedActions || (Array.isArray(cfg.blockedActions) && cfg.blockedActions.length === 0)) && (
                              <span className="text-xs text-gray-400">None</span>
                            )}
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
