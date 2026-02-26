import { useEffect, useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "@/lib/api";
import type { ControlPlaneHealth, DeploymentItem } from "@/lib/api";
import {
 Bot, Play, Square, RefreshCw, Plus, Server, Cloud, GitBranch,
 CheckCircle, XCircle, Activity, ChevronDown, ChevronUp,
 Settings, Shield, Cpu, Loader2, X, Trash2, AlertCircle
} from "lucide-react";

const statusConfig: Record<string, { icon: typeof CheckCircle; color: string; label: string }> = {
 running: { icon: CheckCircle, color: 'text-emerald-400', label: 'Running' },
 deploying: { icon: RefreshCw, color: 'text-accent', label: 'Deploying' },
 stopped: { icon: Square, color: 'text-gray-400', label: 'Stopped' },
 error: { icon: XCircle, color: 'text-red-400', label: 'Error' },
 pending: { icon: Activity, color: 'text-accent', label: 'Pending' }};

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
 const [health, setHealth] = useState<ControlPlaneHealth | null>(null);
 const [loading, setLoading] = useState(true);
 const [showDeploy, setShowDeploy] = useState(false);
 const [deployForm, setDeployForm] = useState({ name: '', agent_type: 'catalyst', deployment_model: 'saas', version: '1.0.0', cluster_id: '' });
 const [clusters, setClusters] = useState<{ id: string; name: string }[]>([]);
 const [actionError, setActionError] = useState<string | null>(null);
 const [deploying, setDeploying] = useState(false);
 const [updatingDeployment, setUpdatingDeployment] = useState<string | null>(null);
 const [showEditConfig, setShowEditConfig] = useState(false);
 const [editingDeployment, setEditingDeployment] = useState<DeploymentItem | null>(null);
 const [editVersion, setEditVersion] = useState('');
 const [editConfig, setEditConfig] = useState<DeploymentConfig>({});

 const handleDeploy = async () => {
 if (!deployForm.name.trim()) return;
 setDeploying(true);
 setActionError(null);
 try {
 const payload: Record<string, unknown> = {
 name: deployForm.name,
 agent_type: deployForm.agent_type,
 deployment_model: deployForm.deployment_model,
 version: deployForm.version};
 if (deployForm.cluster_id) payload.cluster_id = deployForm.cluster_id;
 await api.controlplane.createDeployment(payload);
 await refresh();
 setShowDeploy(false);
 setDeployForm({ name: '', agent_type: 'catalyst', deployment_model: 'saas', version: '1.0.0', cluster_id: '' });
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Deploy failed');
 }
 setDeploying(false);
 };

 const refresh = async () => {
 const [d, h] = await Promise.allSettled([
 api.controlplane.deployments(),
 api.controlplane.health(),
 ]);
 if (d.status === 'fulfilled') setDeployments(d.value.deployments);
 if (h.status === 'fulfilled') setHealth(h.value);
 };

 const updateStatus = async (deploymentId: string, status: string) => {
 if (updatingDeployment) return;
 setUpdatingDeployment(deploymentId);
 setActionError(null);
 try {
 await api.controlplane.updateDeployment(deploymentId, { status });
 await refresh();
 } catch (err) {
 setActionError(err instanceof Error ? err.message : `Failed to set status to ${status}`);
 }
 setUpdatingDeployment(null);
 };

 const restartDeployment = async (deploymentId: string) => {
 if (updatingDeployment) return;
 setUpdatingDeployment(deploymentId);
 setActionError(null);
 try {
 await api.controlplane.updateDeployment(deploymentId, { status: 'deploying' });
 // Brief delay to simulate restart
 await new Promise(r => setTimeout(r, 800));
 await api.controlplane.updateDeployment(deploymentId, { status: 'running' });
 await refresh();
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Restart failed');
 }
 setUpdatingDeployment(null);
 };

 const openEditDeploymentConfig = (dep: DeploymentItem) => {
 setEditingDeployment(dep);
 setEditVersion(dep.version || '1.0.0');
 setEditConfig((dep.config as DeploymentConfig) || {});
 setShowEditConfig(true);
 };

 const saveDeploymentConfig = async () => {
 if (!editingDeployment || updatingDeployment) return;
 setUpdatingDeployment(editingDeployment.id);
 setActionError(null);
 try {
 await api.controlplane.updateDeployment(editingDeployment.id, {
 version: editVersion,
 config: editConfig});
 await refresh();
 setShowEditConfig(false);
 setEditingDeployment(null);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to save config');
 }
 setUpdatingDeployment(null);
 };

 const deleteDeployment = async (deploymentId: string) => {
 if (updatingDeployment) return;
 if (!confirm('Are you sure you want to delete this deployment?')) return;
 setUpdatingDeployment(deploymentId);
 setActionError(null);
 try {
 await api.controlplane.deleteDeployment(deploymentId);
 await refresh();
 setExpandedDep(null);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Delete failed');
 }
 setUpdatingDeployment(null);
 };

 useEffect(() => {
 async function load() {
 setLoading(true);
 await refresh();
 // Load clusters for deploy modal
 try {
 const cl = await api.catalysts.clusters();
 setClusters(cl.clusters.map(c => ({ id: c.id, name: c.name })));
 } catch { /* ignore */ }
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
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
 </div>
 );
 }

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-xl bg-accent/15 flex items-center justify-center">
 <Cpu className="w-5 h-5 text-accent" />
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Agent Control Plane</h1>
 <p className="text-sm t-muted">Deploy, manage, and monitor Catalyst agents per tenant</p>
 </div>
 </div>
 <Button variant="primary" size="sm" onClick={() => setShowDeploy(true)}><Plus size={14} /> Deploy Agent</Button>
 </div>

 {/* Deploy Modal */}
 {showDeploy && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Deploy New Agent</h3>
 <button onClick={() => setShowDeploy(false)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div><label className="text-xs t-muted">Agent Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={deployForm.name} onChange={e => setDeployForm(p => ({ ...p, name: e.target.value }))} placeholder="finance-catalyst-01" /></div>
 <div><label className="text-xs t-muted">Agent Type</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={deployForm.agent_type} onChange={e => setDeployForm(p => ({ ...p, agent_type: e.target.value }))}><option value="catalyst">Catalyst</option><option value="monitor">Monitor</option><option value="orchestrator">Orchestrator</option></select></div>
 <div><label className="text-xs t-muted">Deployment Model</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={deployForm.deployment_model} onChange={e => setDeployForm(p => ({ ...p, deployment_model: e.target.value }))}><option value="saas">SaaS</option><option value="on-premise">On-Premise</option><option value="hybrid">Hybrid</option></select></div>
 {clusters.length > 0 && (
 <div><label className="text-xs t-muted">Cluster (optional)</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={deployForm.cluster_id} onChange={e => setDeployForm(p => ({ ...p, cluster_id: e.target.value }))}><option value="">No cluster</option>{clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
 )}
 <div><label className="text-xs t-muted">Version</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm font-mono" value={deployForm.version} onChange={e => setDeployForm(p => ({ ...p, version: e.target.value }))} /></div>
 </div>
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowDeploy(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleDeploy} disabled={deploying || !deployForm.name.trim()}>
 {deploying ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Deploy
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Edit Config Modal */}
 {showEditConfig && editingDeployment && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-xl space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Edit Deployment Config</h3>
 <button
 onClick={() => { setShowEditConfig(false); setEditingDeployment(null); }}
 className="text-gray-400 hover:text-gray-400"
 >
 <X size={18} />
 </button>
 </div>

 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div>
 <label className="text-xs t-muted">Version</label>
 <input
 className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm font-mono"
 value={editVersion}
 onChange={(e) => setEditVersion(e.target.value)}
 />
 </div>
 <div>
 <label className="text-xs t-muted">Replicas</label>
 <input
 type="number"
 min={1}
 className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm"
 value={String(editConfig.replicas ?? 1)}
 onChange={(e) => setEditConfig((p) => ({ ...p, replicas: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }))}
 />
 </div>
 <div>
 <label className="text-xs t-muted">Max Concurrent Tasks</label>
 <input
 type="number"
 min={1}
 className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm"
 value={String(editConfig.maxConcurrentTasks ?? 10)}
 onChange={(e) => setEditConfig((p) => ({ ...p, maxConcurrentTasks: Math.max(1, parseInt(e.target.value || '10', 10) || 10) }))}
 />
 </div>
 <div>
 <label className="text-xs t-muted">Confidence Threshold (%)</label>
 <input
 type="number"
 min={0}
 max={100}
 className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm"
 value={String(Math.round(((editConfig.confidenceThreshold ?? 0.85) as number) * 100))}
 onChange={(e) => {
 const pct = Math.min(100, Math.max(0, parseInt(e.target.value || '85', 10) || 0));
 setEditConfig((p) => ({ ...p, confidenceThreshold: pct / 100 }));
 }}
 />
 </div>
 </div>

 <p className="text-[10px] text-gray-400">Configuration updates apply on next heartbeat/restart.</p>

 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => { setShowEditConfig(false); setEditingDeployment(null); }}>Cancel</Button>
 <Button
 variant="primary"
 size="sm"
 onClick={saveDeploymentConfig}
 disabled={updatingDeployment === editingDeployment.id}
 >
 {updatingDeployment === editingDeployment.id ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />} Save
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Error Banner */}
 {actionError && (
 <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
 <AlertCircle size={16} />
 <span>{actionError}</span>
 <button onClick={() => setActionError(null)} className="ml-auto text-red-400 hover:text-red-400"><X size={14} /></button>
 </div>
 )}

 {/* Health Overview */}
 {health && (
 <Card>
 <div className="flex items-center gap-3 mb-3">
 <Activity size={16} className="text-accent" />
 <h3 className="text-sm font-semibold t-primary">Platform Health</h3>
 </div>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
 <div><span className="text-[10px] text-gray-400">Overall Health</span><p className="text-lg font-bold text-emerald-400">{health.overallHealth}%</p></div>
 <div><span className="text-[10px] text-gray-400">Overall Uptime</span><p className="text-lg font-bold t-primary">{health.overallUptime}%</p></div>
 <div><span className="text-[10px] text-gray-400">Deployment Status</span><div className="flex gap-2 mt-0.5">{Object.entries(health.deploymentStatus || {}).map(([s, c]) => <Badge key={s} variant={s === 'running' ? 'success' : s === 'stopped' ? 'danger' : 'default'} size="sm">{s}: {c}</Badge>)}</div></div>
 <div><span className="text-[10px] text-gray-400">Last Checked</span><p className="text-sm font-bold t-primary">{new Date(health.lastChecked).toLocaleTimeString()}</p></div>
 </div>
 </Card>
 )}

 {/* Summary */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <span className="text-xs t-secondary">Total Deployments</span>
 <p className="text-2xl font-bold t-primary mt-1">{deployments.length}</p>
 <span className="text-xs text-emerald-400">{computed.running} running</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Total Replicas</span>
 <p className="text-2xl font-bold t-primary mt-1">{computed.totalReplicas}</p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Avg Uptime</span>
 <p className="text-2xl font-bold text-emerald-400 mt-1">
 {computed.avgUptime.toFixed(2)}%
 </p>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Avg Health</span>
 <p className="text-2xl font-bold t-primary mt-1">
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
 <div className="w-10 h-10 rounded-lg bg-accent/15 flex items-center justify-center">
 <Bot className="w-5 h-5 text-accent" />
 </div>
 <div>
 <h3 className="text-base font-semibold t-primary">{dep.name || dep.clusterName || dep.id}</h3>
 <div className="flex flex-wrap items-center gap-2 mt-1">
 <span className="text-xs t-muted">{dep.tenantName || dep.tenantId}</span>
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
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-4">
 <div className=" text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Replicas</span>
 <p className="text-sm font-bold t-primary">{replicas}</p>
 </div>
 <div className=" text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Uptime</span>
 <p className="text-sm font-bold text-emerald-400">{dep.uptime.toFixed(1)}%</p>
 </div>
 <div className=" text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Version</span>
 <p className="text-sm font-bold t-primary">{dep.version}</p>
 </div>
 <div className=" text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Tasks</span>
 <p className="text-sm font-bold t-primary">{dep.tasksExecuted.toLocaleString()}</p>
 </div>
 <div className=" text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Heartbeat</span>
 <p className="text-sm font-bold t-primary">{dep.lastHeartbeat ? new Date(dep.lastHeartbeat).toLocaleTimeString() : 'N/A'}</p>
 </div>
 </div>

 {expandedDep === dep.id && (
 <div className="mt-4 space-y-4 animate-fadeIn">
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {/* Config */}
 <div className=" p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
 <Settings size={14} className="text-accent" /> Configuration
 </h4>
 <div className="space-y-2 text-xs">
 <div className="flex justify-between"><span className="text-gray-400">Replicas</span><span className="t-primary">{replicas}</span></div>
 <div className="flex justify-between"><span className="text-gray-400">Max Concurrent Tasks</span><span className="t-primary">{cfg.maxConcurrentTasks ?? 'N/A'}</span></div>
 <div className="flex justify-between"><span className="text-gray-400">Confidence Threshold</span><span className="t-primary">{typeof cfg.confidenceThreshold === 'number' ? `${Math.round(cfg.confidenceThreshold * 100)}%` : 'N/A'}</span></div>
 <div className="flex justify-between"><span className="text-gray-400">Escalation Policy</span><Badge variant="outline" size="sm">{cfg.escalationPolicy ?? 'N/A'}</Badge></div>
 <div className="flex justify-between"><span className="text-gray-400">CPU / Memory</span><span className="t-primary">{cfg.resourceLimits?.cpuMillicores ?? '?'}m / {cfg.resourceLimits?.memoryMb ?? '?'}MB</span></div>
 </div>
 </div>

 {/* Permissions */}
 <div className=" p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
 <Shield size={14} className="text-emerald-400" /> Action Permissions
 </h4>
 <div className="space-y-2">
 <div>
 <span className="text-[10px] text-gray-400">Allowed Actions</span>
 <div className="flex flex-wrap gap-1 mt-1">
 {(Array.isArray(cfg.allowedActions) ? cfg.allowedActions : []).map((a: string) => (
 <Badge key={a} variant="success" size="sm">{a}</Badge>
 ))}
 {(!cfg.allowedActions || (Array.isArray(cfg.allowedActions) && cfg.allowedActions.length === 0)) && (
 <span className="text-xs t-secondary">None</span>
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
 <span className="text-xs t-secondary">None</span>
 )}
 </div>
 </div>
 </div>
 </div>
 </div>

 <div className="flex flex-wrap gap-2">
 {dep.status === 'running' && (
 <Button
 variant="danger"
 size="sm"
 onClick={(e) => { e.stopPropagation(); updateStatus(dep.id, 'stopped'); }}
 disabled={updatingDeployment === dep.id}
 >
 <Square size={12} /> Stop
 </Button>
 )}
 {dep.status === 'stopped' && (
 <Button
 variant="success"
 size="sm"
 onClick={(e) => { e.stopPropagation(); updateStatus(dep.id, 'running'); }}
 disabled={updatingDeployment === dep.id}
 >
 <Play size={12} /> Start
 </Button>
 )}
 <Button
 variant="secondary"
 size="sm"
 onClick={(e) => { e.stopPropagation(); restartDeployment(dep.id); }}
 disabled={updatingDeployment === dep.id}
 >
 <RefreshCw size={12} /> Restart
 </Button>
 <Button
 variant="secondary"
 size="sm"
 onClick={(e) => { e.stopPropagation(); openEditDeploymentConfig(dep); }}
 disabled={updatingDeployment === dep.id}
 >
 <Settings size={12} /> Edit Config
 </Button>
 <Button
 variant="danger"
 size="sm"
 onClick={(e) => { e.stopPropagation(); deleteDeployment(dep.id); }}
 disabled={updatingDeployment === dep.id}
 >
 <Trash2 size={12} /> Delete
 </Button>
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
