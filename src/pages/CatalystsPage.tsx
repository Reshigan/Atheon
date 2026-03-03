import { useState, useEffect, useRef } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ClusterItem, ActionItem, GovernanceData, SubCatalyst, DataSourceConfig, ERPConnection } from "@/lib/api";
import {
 Zap, Bot, Shield, CheckCircle, Clock, XCircle, Eye, Wrench, Send,
 ChevronDown, ChevronUp, Loader2, Upload, Calendar, AlertTriangle,
 Play, X, FileText, Plus, Settings, Database, Mail, Cloud, HardDrive, Trash2, AlertCircle
} from "lucide-react";
import type { AutonomyTier } from "@/types";
import { useAppStore } from "@/stores/appStore";

const tierConfig: Record<AutonomyTier, { label: string; icon: typeof Eye; color: string }> = {
 'read-only': { label: 'Read-Only', icon: Eye, color: 'text-accent' },
 'assisted': { label: 'Assisted', icon: Wrench, color: 'text-accent' },
 'transactional': { label: 'Transactional', icon: Send, color: 'text-emerald-400' }};

const statusIcon = (status: string) => {
 if (status === 'completed') return <CheckCircle size={14} className="text-emerald-400" />;
 if (status === 'pending') return <Clock size={14} className="text-accent" />;
 if (status === 'approved') return <CheckCircle size={14} className="text-accent" />;
 if (status === 'exception') return <AlertTriangle size={14} className="text-red-400" />;
 if (status === 'rejected' || status === 'failed') return <XCircle size={14} className="text-red-400" />;
 return <Zap size={14} className="text-accent" />;
};

const statusBadgeVariant = (status: string): 'success' | 'warning' | 'danger' | 'info' => {
 if (status === 'completed') return 'success';
 if (status === 'pending') return 'warning';
 if (status === 'exception') return 'danger';
 if (status === 'rejected' || status === 'failed') return 'danger';
 return 'info';
};

export function CatalystsPage() {
 const user = useAppStore((s) => s.user);
 const isAdmin = user?.role === 'admin' || user?.role === 'executive';
 const { activeTab, setActiveTab } = useTabState('clusters');
 const [expandedAction, setExpandedAction] = useState<string | null>(null);
 const [clusters, setClusters] = useState<ClusterItem[]>([]);
 const [actions, setActions] = useState<ActionItem[]>([]);
 const [governance, setGovernance] = useState<GovernanceData | null>(null);
 const [loading, setLoading] = useState(true);
 const [updatingAction, setUpdatingAction] = useState<string | null>(null);

 // Manual Execution state
 const [showManualExec, setShowManualExec] = useState(false);
 const [manualForm, setManualForm] = useState({
 cluster_id: '', catalyst_name: '', action: '',
 start_datetime: '', end_datetime: '', reasoning: ''});
 const [manualFile, setManualFile] = useState<File | null>(null);
 const [executing, setExecuting] = useState(false);
 const [execError, setExecError] = useState<string | null>(null);
 const [execSuccess, setExecSuccess] = useState<string | null>(null);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const quickRunFileRef = useRef<HTMLInputElement>(null);

 // Quick Run modal state (streamlined per-sub-catalyst execution)
 const [showQuickRun, setShowQuickRun] = useState(false);
 const [quickRunClusterId, setQuickRunClusterId] = useState('');
 const [quickRunClusterName, setQuickRunClusterName] = useState('');
 const [quickRunSubName, setQuickRunSubName] = useState('');
 const [quickRunAction, setQuickRunAction] = useState('');
 const [quickRunStart, setQuickRunStart] = useState('');
 const [quickRunEnd, setQuickRunEnd] = useState('');
 const [quickRunFile, setQuickRunFile] = useState<File | null>(null);
 const [quickRunning, setQuickRunning] = useState(false);
 const [quickRunError, setQuickRunError] = useState<string | null>(null);
 const [quickRunSuccess, setQuickRunSuccess] = useState<string | null>(null);

 const openQuickRun = (clusterId: string, clusterName: string, subName: string) => {
 setQuickRunClusterId(clusterId);
 setQuickRunClusterName(clusterName);
 setQuickRunSubName(subName);
 setQuickRunAction('');
 // Default date range: now to +7 days
 const now = new Date();
 const end = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
 setQuickRunStart(now.toISOString().slice(0, 16));
 setQuickRunEnd(end.toISOString().slice(0, 16));
 setQuickRunFile(null);
 setQuickRunError(null);
 setQuickRunSuccess(null);
 setShowQuickRun(true);
 };

 const handleQuickRunExecute = async () => {
 if (!quickRunAction.trim() || !quickRunStart || !quickRunEnd) {
 setQuickRunError('Action description and date range are required');
 return;
 }
 setQuickRunning(true);
 setQuickRunError(null);
 setQuickRunSuccess(null);
 try {
 const formData = new FormData();
 formData.append('cluster_id', quickRunClusterId);
 formData.append('catalyst_name', quickRunSubName);
 formData.append('action', quickRunAction.trim());
 formData.append('start_datetime', quickRunStart);
 formData.append('end_datetime', quickRunEnd);
 formData.append('reasoning', `Quick run from sub-catalyst card: ${quickRunSubName}`);
 if (quickRunFile) formData.append('file', quickRunFile);

 const result = await api.catalysts.manualExecute(formData);
 setQuickRunSuccess(result.message);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 setTimeout(() => {
 setShowQuickRun(false);
 setQuickRunSuccess(null);
 }, 2000);
 } catch (err) {
 setQuickRunError(err instanceof Error ? err.message : 'Execution failed');
 }
 setQuickRunning(false);
 };

 // Deploy Catalyst state
 const [showDeployCatalyst, setShowDeployCatalyst] = useState(false);
 const [deployForm, setDeployForm] = useState({ name: '', domain: 'finance', autonomy_tier: 'assisted', description: '' });
 const [deploying, setDeploying] = useState(false);
 const [deployError, setDeployError] = useState<string | null>(null);
 const [actionError, setActionError] = useState<string | null>(null);

 const handleApprove = async (actionId: string) => {
 if (updatingAction) return;
 setUpdatingAction(actionId);
 setActionError(null);
 try {
 await api.catalysts.approveAction(actionId);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to approve action');
 }
 setUpdatingAction(null);
 };

 const handleReject = async (actionId: string) => {
 if (updatingAction) return;
 setUpdatingAction(actionId);
 setActionError(null);
 try {
 await api.catalysts.rejectAction(actionId);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to reject action');
 }
 setUpdatingAction(null);
 };

 const handleManualExecute = async () => {
 if (!manualForm.cluster_id || !manualForm.catalyst_name || !manualForm.action || !manualForm.start_datetime || !manualForm.end_datetime) {
 setExecError('All fields are required');
 return;
 }
 setExecuting(true);
 setExecError(null);
 setExecSuccess(null);
 try {
 const formData = new FormData();
 formData.append('cluster_id', manualForm.cluster_id);
 formData.append('catalyst_name', manualForm.catalyst_name);
 formData.append('action', manualForm.action);
 formData.append('start_datetime', manualForm.start_datetime);
 formData.append('end_datetime', manualForm.end_datetime);
 if (manualForm.reasoning) formData.append('reasoning', manualForm.reasoning);
 if (manualFile) formData.append('file', manualFile);

 const result = await api.catalysts.manualExecute(formData);
 setExecSuccess(result.message);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 setTimeout(() => {
 setShowManualExec(false);
 setManualForm({ cluster_id: '', catalyst_name: '', action: '', start_datetime: '', end_datetime: '', reasoning: '' });
 setManualFile(null);
 setExecSuccess(null);
 }, 2000);
 } catch (err) {
 setExecError(err instanceof Error ? err.message : 'Execution failed');
 }
 setExecuting(false);
 };

 const handleDeployCatalyst = async () => {
 if (!deployForm.name.trim() || deploying) return;
 setDeploying(true);
 setDeployError(null);
 try {
 await api.catalysts.createCluster({
 name: deployForm.name.trim(),
 domain: deployForm.domain,
 autonomy_tier: deployForm.autonomy_tier,
 description: deployForm.description || `${deployForm.name} catalyst cluster`});
 const ind2 = industry !== 'general' ? industry : undefined;
 const c = await api.catalysts.clusters(undefined, ind2);
 setClusters(c.clusters);
 setShowDeployCatalyst(false);
 setDeployForm({ name: '', domain: 'finance', autonomy_tier: 'assisted', description: '' });
 } catch (err) {
 setDeployError(err instanceof Error ? err.message : 'Failed to deploy catalyst');
 }
 setDeploying(false);
 };

 const industry = useAppStore((s) => s.industry);
 const [togglingSubCatalyst, setTogglingSubCatalyst] = useState<string | null>(null);

 // Data source configuration state
 const [showDataSourceConfig, setShowDataSourceConfig] = useState(false);
 const [dsClusterId, setDsClusterId] = useState('');
 const [dsSubName, setDsSubName] = useState('');
 const [dsType, setDsType] = useState<'erp' | 'email' | 'cloud_storage' | 'upload'>('erp');
 const [dsConfig, setDsConfig] = useState<Record<string, unknown>>({});
 const [dsSaving, setDsSaving] = useState(false);
 const [dsError, setDsError] = useState<string | null>(null);
 const [dsExisting, setDsExisting] = useState<DataSourceConfig | undefined>(undefined);
 const [erpConnections, setErpConnections] = useState<ERPConnection[]>([]);

 const openDataSourceConfig = async (clusterId: string, sub: SubCatalyst) => {
 setDsClusterId(clusterId);
 setDsSubName(sub.name);
 setDsExisting(sub.data_source);
 if (sub.data_source) {
 setDsType(sub.data_source.type);
 setDsConfig(sub.data_source.config || {});
 } else {
 // Pre-fill from tenant's connected ERP if available
 setDsType('erp');
 try {
 const erpData = await api.erp.connections();
 const connected = erpData.connections.filter(c => c.status === 'connected');
 setErpConnections(connected);
 if (connected.length > 0) {
 const primary = connected[0];
 setDsConfig({
 erp_type: primary.adapterSystem.toLowerCase(),
 connection_id: primary.id,
 module: '',
 });
 } else {
 setDsConfig({});
 }
 } catch {
 setDsConfig({});
 setErpConnections([]);
 }
 }
 setDsError(null);
 setShowDataSourceConfig(true);
 };

 const handleSaveDataSource = async () => {
 if (dsSaving) return;
 setDsSaving(true);
 setDsError(null);
 try {
 await api.catalysts.setDataSource(dsClusterId, dsSubName, { type: dsType, config: dsConfig });
 const ind = industry !== 'general' ? industry : undefined;
 const c = await api.catalysts.clusters(undefined, ind);
 setClusters(c.clusters);
 setShowDataSourceConfig(false);
 } catch (err) {
 setDsError(err instanceof Error ? err.message : 'Failed to save data source');
 }
 setDsSaving(false);
 };

 const handleRemoveDataSource = async () => {
 if (dsSaving) return;
 setDsSaving(true);
 setDsError(null);
 try {
 await api.catalysts.removeDataSource(dsClusterId, dsSubName);
 const ind = industry !== 'general' ? industry : undefined;
 const c = await api.catalysts.clusters(undefined, ind);
 setClusters(c.clusters);
 setShowDataSourceConfig(false);
 } catch (err) {
 setDsError(err instanceof Error ? err.message : 'Failed to remove data source');
 }
 setDsSaving(false);
 };

 useEffect(() => {
 async function load() {
 setLoading(true);
 const ind = industry !== 'general' ? industry : undefined;
 const [c, a, g] = await Promise.allSettled([
 api.catalysts.clusters(undefined, ind), api.catalysts.actions(undefined, undefined, ind), api.catalysts.governance(undefined, ind),
 ]);
 if (c.status === 'fulfilled') setClusters(c.value.clusters);
 if (a.status === 'fulfilled') setActions(a.value.actions);
 if (g.status === 'fulfilled') setGovernance(g.value);
 setLoading(false);
 }
 load();
 }, [industry]);

 const handleToggleSubCatalyst = async (clusterId: string, subName: string) => {
 const key = `${clusterId}:${subName}`;
 if (togglingSubCatalyst) return;
 setTogglingSubCatalyst(key);
 try {
 await api.catalysts.toggleSubCatalyst(clusterId, subName);
 const ind = industry !== 'general' ? industry : undefined;
 const c = await api.catalysts.clusters(undefined, ind);
 setClusters(c.clusters);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to toggle sub-catalyst');
 }
 setTogglingSubCatalyst(null);
 };

 const exceptionCount = actions.filter(a => a.status === 'exception').length;

 const tabs = [
 { id: 'clusters', label: 'Catalyst Clusters', icon: <Bot size={14} /> },
 { id: 'actions', label: 'Action Log', icon: <Zap size={14} />, count: actions.length },
 { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle size={14} />, count: exceptionCount },
 ...(isAdmin ? [{ id: 'governance', label: 'Governance', icon: <Shield size={14} /> }] : []),
 ];

 if (loading) {
 return (
 <div className="flex items-center justify-center h-96">
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
 </div>
 );
 }

 const renderActionCard = (action: ActionItem, showExceptionHighlight = false) => {
 const isException = action.status === 'exception';
 const outputData = action.outputData as Record<string, string> | undefined;
 const inputData = action.inputData as Record<string, unknown> | undefined;
 const isManual = inputData?.manual === true;

 return (
 <Card
 key={action.id}
 hover
 onClick={() => setExpandedAction(expandedAction === action.id ? null : action.id)}
 className={isException && showExceptionHighlight ? 'ring-1 ring-red-500/40 bg-red-500/[0.03]' : ''}
 >
 <div className="flex items-start justify-between">
 <div className="flex items-start gap-3">
 {statusIcon(action.status)}
 <div>
 <h3 className="text-sm font-semibold t-primary">{action.action}</h3>
 <div className="flex items-center gap-2 mt-0.5">
 <p className="text-xs t-secondary">{action.catalystName}</p>
 {isManual && <Badge variant="outline" size="sm">Manual</Badge>}
 </div>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant={statusBadgeVariant(action.status)}>
 {action.status}
 </Badge>
 <span className="text-xs t-secondary">{Math.round(action.confidence * 100)}%</span>
 {expandedAction === action.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
 </div>
 </div>
 <p className="text-xs t-muted mt-1 line-clamp-2">{action.reasoning || ''}</p>

 {expandedAction === action.id && (
 <div className="mt-4 space-y-3 animate-fadeIn">
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-xs font-semibold text-gray-400 mb-1">Reasoning Chain</h4>
 <p className="text-xs t-muted">{action.reasoning || 'No reasoning provided'}</p>
 </div>

 {isException && outputData && (
 <div className="p-3 rounded-lg bg-red-500/[0.08] border border-red-500/20">
 <div className="flex items-center gap-2 mb-2">
 <AlertTriangle size={14} className="text-red-400" />
 <h4 className="text-xs font-semibold text-red-400">Exception Details</h4>
 </div>
 {outputData.exception_type && (
 <Badge variant="danger" size="sm" className="mb-2">{outputData.exception_type.replace(/_/g, ' ')}</Badge>
 )}
 <p className="text-xs text-red-500/80 mt-1">{outputData.exception_detail || ''}</p>
 {outputData.suggested_action && (
 <div className="mt-2 p-2 rounded bg-amber-500/[0.06] border border-accent/20">
 <p className="text-xs text-amber-700"><strong>Suggested Action:</strong> {outputData.suggested_action}</p>
 </div>
 )}
 </div>
 )}

 {inputData && Object.keys(inputData).length > 0 && (
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-xs font-semibold text-gray-400 mb-2">Input Data</h4>
 <div className="grid grid-cols-2 gap-2">
 {Object.entries(inputData).filter(([k]) => k !== 'manual' && k !== 'file_preview').map(([key, val]) => (
 <div key={key}>
 <span className="text-[10px] text-gray-500">{key.replace(/_/g, ' ')}</span>
 <p className="text-xs t-secondary">{typeof val === 'object' ? JSON.stringify(val) : String(val)}</p>
 </div>
 ))}
 </div>
 </div>
 )}

 {action.status === 'completed' && outputData && !isException && (
 <div className="p-3 rounded-lg bg-emerald-500/[0.06] border border-emerald-500/20">
 <h4 className="text-xs font-semibold text-emerald-400 mb-1">Result</h4>
 <p className="text-xs text-emerald-700">{outputData.detail || JSON.stringify(outputData)}</p>
 </div>
 )}

 {isAdmin && (action.status === 'pending' || action.status === 'exception') && (
 <div className="flex gap-2">
 <Button variant="success" size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(action.id); }} disabled={updatingAction === action.id} title="Approve this catalyst action">
 {updatingAction === action.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Approve
 </Button>
 <Button variant="danger" size="sm" onClick={(e) => { e.stopPropagation(); handleReject(action.id); }} disabled={updatingAction === action.id} title="Reject this catalyst action">
 <XCircle size={12} /> Reject
 </Button>
 </div>
 )}
 </div>
 )}
 </Card>
 );
 };

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div>
 <h1 className="text-3xl sm:text-4xl font-bold t-primary" >Atheon Catalysts</h1>
 <p className="text-sm t-muted mt-1">Autonomous Execution — Intelligent Workers</p>
 </div>
 {isAdmin && (
 <div className="flex gap-2">
 <Button variant="secondary" size="sm" onClick={() => setShowManualExec(true)} title="Manually trigger a catalyst action">
 <Upload size={14} /> Manual Execute
 </Button>
 <Button variant="primary" size="sm" onClick={() => setShowDeployCatalyst(true)} title="Create and deploy a new catalyst cluster">
 <Plus size={14} /> Deploy Catalyst
 </Button>
 </div>
 )}
 </div>

 {actionError && (
 <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
 <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
 <p className="text-sm text-red-400 flex-1">{actionError}</p>
 <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
 </div>
 )}

 {exceptionCount > 0 && (
 <div className="flex items-center gap-3 p-3 bg-red-500/[0.08] border border-red-500/20 rounded-xl">
 <AlertTriangle size={18} className="text-red-400 flex-shrink-0" />
 <div className="flex-1">
 <p className="text-sm font-medium text-red-500">{exceptionCount} exception{exceptionCount > 1 ? 's' : ''} require{exceptionCount === 1 ? 's' : ''} attention</p>
 <p className="text-xs text-red-400/70">Review and resolve catalyst exceptions before running new jobs</p>
 </div>
 <Button variant="danger" size="sm" onClick={() => setActiveTab('exceptions')} title="View and resolve catalyst exceptions">View Exceptions</Button>
 </div>
 )}

 {showManualExec && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2"><Play size={18} className="text-accent" /> Manual Catalyst Execution</h3>
 <button onClick={() => { setShowManualExec(false); setExecError(null); setExecSuccess(null); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div>
 <label className="text-xs t-muted">Catalyst Cluster</label>
 <select className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={manualForm.cluster_id} onChange={e => setManualForm(p => ({ ...p, cluster_id: e.target.value }))}>
 <option value="">Select a cluster...</option>
 {clusters.map(c => <option key={c.id} value={c.id}>{c.name} ({c.domain})</option>)}
 </select>
 </div>
 <div>
 <label className="text-xs t-muted">Catalyst Name</label>
 <input className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={manualForm.catalyst_name} onChange={e => setManualForm(p => ({ ...p, catalyst_name: e.target.value }))} placeholder="e.g. Invoice Reconciliation" />
 </div>
 <div>
 <label className="text-xs t-muted">Action</label>
 <input className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={manualForm.action} onChange={e => setManualForm(p => ({ ...p, action: e.target.value }))} placeholder="e.g. Reconcile Feb 2026 invoices" />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> Start Date/Time</label>
 <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={manualForm.start_datetime} onChange={e => setManualForm(p => ({ ...p, start_datetime: e.target.value }))} />
 </div>
 <div>
 <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> End Date/Time</label>
 <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={manualForm.end_datetime} onChange={e => setManualForm(p => ({ ...p, end_datetime: e.target.value }))} />
 </div>
 </div>
 <div>
 <label className="text-xs t-muted">Upload File (optional)</label>
 <div className="mt-1 p-4 border-2 border-dashed border-[var(--border-card)] rounded-lg text-center cursor-pointer hover:border-amber-500/30 transition-colors" onClick={() => fileInputRef.current?.click()}>
 {manualFile ? (
 <div className="flex items-center justify-center gap-2">
 <FileText size={16} className="text-accent" />
 <span className="text-sm t-secondary">{manualFile.name}</span>
 <button onClick={(e) => { e.stopPropagation(); setManualFile(null); }} className="text-gray-500 hover:text-red-400"><X size={14} /></button>
 </div>
 ) : (
 <div><Upload size={20} className="mx-auto text-gray-500 mb-1" /><p className="text-xs t-muted">Click to upload CSV, Excel, or PDF file</p></div>
 )}
 <input ref={fileInputRef} type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf,.json,.txt" onChange={e => setManualFile(e.target.files?.[0] || null)} />
 </div>
 </div>
 <div>
 <label className="text-xs t-muted">Reasoning (optional)</label>
 <textarea className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary resize-none" rows={2} value={manualForm.reasoning} onChange={e => setManualForm(p => ({ ...p, reasoning: e.target.value }))} placeholder="Why is this being run manually?" />
 </div>
 </div>
 {execError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {execError}</div>
 )}
 {execSuccess && (
 <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2"><CheckCircle size={14} /> {execSuccess}</div>
 )}
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => { setShowManualExec(false); setExecError(null); setExecSuccess(null); }}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleManualExecute} disabled={executing || !manualForm.cluster_id || !manualForm.catalyst_name || !manualForm.action || !manualForm.start_datetime || !manualForm.end_datetime}>
 {executing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Execute
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {showDeployCatalyst && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Deploy New Catalyst</h3>
 <button onClick={() => { setShowDeployCatalyst(false); setDeployError(null); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div><label className="text-xs t-muted">Cluster Name</label><input className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={deployForm.name} onChange={e => setDeployForm(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Finance Catalyst" /></div>
 <div><label className="text-xs t-muted">Domain</label><select className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={deployForm.domain} onChange={e => setDeployForm(p => ({ ...p, domain: e.target.value }))}><option value="finance">Finance</option><option value="procurement">Procurement</option><option value="supply-chain">Supply Chain</option><option value="hr">HR</option><option value="sales">Sales</option><option value="operations">Operations</option><option value="compliance">Compliance</option></select></div>
 <div><label className="text-xs t-muted">Autonomy Tier</label><select className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={deployForm.autonomy_tier} onChange={e => setDeployForm(p => ({ ...p, autonomy_tier: e.target.value }))}><option value="read-only">Read-Only</option><option value="assisted">Assisted</option><option value="transactional">Transactional</option></select></div>
 <div><label className="text-xs t-muted">Description (optional)</label><textarea className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary resize-none" rows={2} value={deployForm.description} onChange={e => setDeployForm(p => ({ ...p, description: e.target.value }))} placeholder="What does this catalyst do?" /></div>
 </div>
 {deployError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {deployError}</div>
 )}
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => { setShowDeployCatalyst(false); setDeployError(null); }}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleDeployCatalyst} disabled={deploying || !deployForm.name.trim()}>
 {deploying ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Deploy
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 <Tabs tabs={tabs}activeTab={activeTab} onTabChange={setActiveTab} />

 {activeTab === 'clusters' && (
 <TabPanel>
 <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
 {clusters.map((cluster) => {
 const tier = tierConfig[cluster.autonomyTier as AutonomyTier] || tierConfig['read-only'];
 const TierIcon = tier.icon;
 return (
 <Card key={cluster.id} hover>
 <div className="flex items-start justify-between">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
 <Bot className="w-5 h-5 text-accent" />
 </div>
 <div>
 <h3 className="text-base font-semibold t-primary">{cluster.name}</h3>
 <div className="flex items-center gap-2 mt-0.5">
 <TierIcon size={12} className={tier.color} />
 <span className={`text-xs ${tier.color}`}>{tier.label}</span>
 {cluster.domain && (
 <Badge variant="outline" size="sm">{cluster.domain}</Badge>
 )}
 </div>
 </div>
 </div>
 <Badge variant={cluster.status === 'active' ? 'success' : cluster.status === 'paused' ? 'warning' : 'danger'}>
 {cluster.status}
 </Badge>
 </div>

 <p className="text-xs t-secondary mt-3">{cluster.description}</p>

 <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Trust Score</span>
 <p className="text-sm font-bold t-primary">{cluster.trustScore}%</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Agents</span>
 <p className="text-sm font-bold t-primary">{cluster.agentCount}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Completed</span>
 <p className="text-sm font-bold t-primary">{(cluster.tasksCompleted / 1000).toFixed(1)}K</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400">Success Rate</span>
 <p className="text-sm font-bold text-emerald-400">{cluster.successRate}%</p>
 </div>
 </div>

 <div className="mt-3">
 <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
 <span>Trust Score</span>
 <span>{cluster.trustScore}%</span>
 </div>
 <Progress value={cluster.trustScore} color={cluster.trustScore >= 90 ? 'emerald' : cluster.trustScore >= 80 ? 'blue' : 'amber'} size="sm" />
 </div>

 {/* Sub-Catalysts */}
 {cluster.subCatalysts && cluster.subCatalysts.length > 0 && (
 <div className="mt-4 border-t border-[var(--border-card)] pt-3">
 <h4 className="text-xs font-semibold t-secondary mb-2 flex items-center gap-1.5">
 <Zap size={12} className="text-accent" /> Sub-Catalysts
 </h4>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 {cluster.subCatalysts.map((sub: SubCatalyst) => (
 <div key={sub.name} className={`flex items-center justify-between p-2 rounded-lg border ${sub.enabled ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-gray-500/5 border-gray-500/20 opacity-60'}`}>
 <div className="flex items-center gap-2 min-w-0">
 <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sub.enabled ? 'bg-emerald-400' : 'bg-gray-400'}`} />
 <div className="min-w-0">
 <div className="flex items-center gap-1.5">
 <span className="text-xs font-medium t-primary truncate">{sub.name}</span>
 {sub.data_source && (
 <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
 sub.data_source.type === 'erp' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
 sub.data_source.type === 'email' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
 sub.data_source.type === 'cloud_storage' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
 }`}>
 {sub.data_source.type === 'erp' && <><Database size={8} /> ERP</>}
 {sub.data_source.type === 'email' && <><Mail size={8} /> Email</>}
 {sub.data_source.type === 'cloud_storage' && <><Cloud size={8} /> Cloud</>}
 {sub.data_source.type === 'upload' && <><HardDrive size={8} /> Upload</>}
 </span>
 )}
 </div>
 {sub.description && <span className="text-[10px] t-secondary block truncate">{sub.description}</span>}
 </div>
 </div>
 <div className="flex items-center gap-1.5 flex-shrink-0">
 {sub.enabled && (
 <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); openQuickRun(cluster.id, cluster.name, sub.name); }} title="Quick run this sub-catalyst">
 <Play size={10} className="mr-1" /> Run
 </Button>
 )}
 {isAdmin && (
 <>
 <button
 onClick={(e) => { e.stopPropagation(); openDataSourceConfig(cluster.id, sub); }}
 className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent/10 transition-colors"
 title="Configure data source"
 >
 <Settings size={12} className="text-accent" />
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); handleToggleSubCatalyst(cluster.id, sub.name); }}
 disabled={togglingSubCatalyst === `${cluster.id}:${sub.name}`}
 className={`relative w-8 h-4 rounded-full transition-colors ${sub.enabled ? 'bg-emerald-500' : 'bg-gray-400'} ${togglingSubCatalyst === `${cluster.id}:${sub.name}` ? 'opacity-50' : ''}`}
 title={sub.enabled ? 'Disable this sub-catalyst' : 'Enable this sub-catalyst'}
 >
 <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${sub.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
 </button>
 </>
 )}
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </Card>
 );
 })}
 </div>
 </TabPanel>
 )}

 {activeTab === 'actions' && (
 <TabPanel>
 <div className="space-y-3">
 {actions.map((action) => renderActionCard(action, false))}
 {actions.length === 0 && (
 <div className="text-center py-12 text-gray-500"><Zap size={32} className="mx-auto mb-2 opacity-50" /><p className="text-sm">No catalyst actions yet</p></div>
 )}
 </div>
 </TabPanel>
 )}

 {activeTab === 'exceptions' && (
 <TabPanel>
 <div className="space-y-3">
 {actions.filter(a => a.status === 'exception').map((action) => renderActionCard(action, true))}
 {exceptionCount === 0 && (
 <div className="text-center py-12 text-gray-500"><CheckCircle size={32} className="mx-auto mb-2 text-emerald-500 opacity-50" /><p className="text-sm">No exceptions — all clear</p></div>
 )}
 </div>
 </TabPanel>
 )}

 {activeTab === 'governance' && (
 <TabPanel>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
 <Card>
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <Eye className="w-4 h-4 text-accent" /> Autonomy Tiers
 </h3>
 <div className="space-y-3">
 {Object.entries(tierConfig).map(([key, config]) => {
 const Icon = config.icon;
 const count = clusters.filter(c => c.autonomyTier === key).length;
 return (
 <div key={key} className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div className="flex items-center gap-2">
 <Icon size={14} className={config.color} />
 <span className="text-sm t-secondary">{config.label}</span>
 </div>
 <Badge variant="outline">{count} clusters</Badge>
 </div>
 );
 })}
 </div>
 </Card>

 <Card>
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <Shield className="w-4 h-4 text-accent" /> Trust Scores
 </h3>
 <div className="space-y-3">
 {clusters.slice(0, 5).map((cluster) => (
 <div key={cluster.id} className="flex items-center justify-between">
 <span className="text-sm t-secondary truncate">{cluster.name}</span>
 <div className="flex items-center gap-2">
 <Progress value={cluster.trustScore} color={cluster.trustScore >= 90 ? 'emerald' : 'amber'} size="sm" className="w-20" />
 <span className="text-sm font-medium t-primary w-10 text-right">{cluster.trustScore}%</span>
 </div>
 </div>
 ))}
 </div>
 </Card>

 <Card>
 <h3 className="text-base font-semibold t-primary mb-3 flex items-center gap-2">
 <Zap className="w-4 h-4 text-accent" /> Governance Metrics
 </h3>
 <div className="space-y-3">
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">Total Actions</span>
 <p className="text-lg font-bold text-accent">{governance?.totalActions ?? 0}</p>
 <p className="text-[10px] text-gray-400">All catalyst executions</p>
 </div>
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">Pending Approvals</span>
 <p className="text-lg font-bold text-accent">{governance?.pendingApprovals ?? 0}</p>
 <p className="text-[10px] text-gray-400">Awaiting human review</p>
 </div>
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">Approved / Rejected</span>
 <p className="text-lg font-bold t-primary">
 <span className="text-emerald-400">{governance?.approved ?? 0}</span>
 {' / '}
 <span className="text-red-500">{governance?.rejected ?? 0}</span>
 </p>
 <p className="text-[10px] text-gray-400">Human override decisions</p>
 </div>
 </div>
 </Card>
 </div>
 </TabPanel>
 )}

 {/* Quick Run Modal */}
 {showQuickRun && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2"><Play size={18} className="text-emerald-400" /> Run Sub-Catalyst</h3>
 <button onClick={() => { setShowQuickRun(false); setQuickRunError(null); setQuickRunSuccess(null); }} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>

 <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
 <div className="flex items-center gap-2">
 <Bot size={16} className="text-accent" />
 <div>
 <p className="text-sm font-medium t-primary">{quickRunSubName}</p>
 <p className="text-[10px] t-secondary">{quickRunClusterName}</p>
 </div>
 </div>
 </div>

 <div className="space-y-3">
 <div>
 <label className="text-xs t-muted">What should this catalyst do?</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={quickRunAction}
 onChange={e => setQuickRunAction(e.target.value)}
 placeholder={`e.g. Process all outstanding ${quickRunSubName.toLowerCase()} tasks`}
 autoFocus
 />
 </div>
 <div className="grid grid-cols-2 gap-3">
 <div>
 <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> From</label>
 <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={quickRunStart} onChange={e => setQuickRunStart(e.target.value)} />
 </div>
 <div>
 <label className="text-xs t-muted flex items-center gap-1"><Calendar size={10} /> To</label>
 <input type="datetime-local" className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary" value={quickRunEnd} onChange={e => setQuickRunEnd(e.target.value)} />
 </div>
 </div>
 <div>
 <label className="text-xs t-muted">Attach file (optional)</label>
 <div className="mt-1 p-3 border-2 border-dashed border-[var(--border-card)] rounded-lg text-center cursor-pointer hover:border-accent/30 transition-colors" onClick={() => quickRunFileRef.current?.click()}>
 {quickRunFile ? (
 <div className="flex items-center justify-center gap-2">
 <FileText size={14} className="text-accent" />
 <span className="text-xs t-secondary">{quickRunFile.name}</span>
 <button onClick={(e) => { e.stopPropagation(); setQuickRunFile(null); }} className="text-gray-500 hover:text-red-400"><X size={12} /></button>
 </div>
 ) : (
 <div><Upload size={16} className="mx-auto text-gray-500 mb-1" /><p className="text-[10px] t-muted">CSV, Excel, or PDF</p></div>
 )}
 <input ref={quickRunFileRef} type="file" className="hidden" accept=".csv,.xlsx,.xls,.pdf,.json,.txt" onChange={e => setQuickRunFile(e.target.files?.[0] || null)} />
 </div>
 </div>
 </div>

 {quickRunError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2"><AlertTriangle size={14} /> {quickRunError}</div>
 )}
 {quickRunSuccess && (
 <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-lg text-emerald-400 text-sm flex items-center gap-2"><CheckCircle size={14} /> {quickRunSuccess}</div>
 )}

 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => { setShowQuickRun(false); setQuickRunError(null); setQuickRunSuccess(null); }}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleQuickRunExecute} disabled={quickRunning || !quickRunAction.trim() || !quickRunStart || !quickRunEnd}>
 {quickRunning ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />} Execute
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Data Source Configuration Modal */}
 {showDataSourceConfig && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <Settings size={18} className="text-accent" /> Configure Data Source
 </h3>
 <button onClick={() => setShowDataSourceConfig(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>

 <p className="text-xs t-secondary">
 Configure where <span className="font-semibold text-accent">{dsSubName}</span> gets its input data from.
 </p>

 {/* Data Source Type Selector */}
 <div>
 <label className="text-xs t-muted block mb-1.5">Data Source Type</label>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 {([
 { type: 'erp' as const, label: 'ERP', icon: Database, selectedBg: 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30', selectedText: 'text-blue-400' },
 { type: 'email' as const, label: 'Email', icon: Mail, selectedBg: 'bg-purple-500/10 border-purple-500/40 ring-1 ring-purple-500/30', selectedText: 'text-purple-400' },
 { type: 'cloud_storage' as const, label: 'Cloud', icon: Cloud, selectedBg: 'bg-cyan-500/10 border-cyan-500/40 ring-1 ring-cyan-500/30', selectedText: 'text-cyan-400' },
 { type: 'upload' as const, label: 'Upload', icon: HardDrive, selectedBg: 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30', selectedText: 'text-amber-400' },
 ]).map((opt) => {
 const Icon = opt.icon;
 const selected = dsType === opt.type;
 return (
 <button
 key={opt.type}
 onClick={() => { setDsType(opt.type); setDsConfig({}); }}
 className={`flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all ${
 selected
 ? opt.selectedBg
 : 'bg-[var(--bg-secondary)] border-[var(--border-card)] hover:border-gray-400'
 }`}
 >
 <Icon size={18} className={selected ? opt.selectedText : 'text-gray-400'} />
 <span className={`text-xs font-medium ${selected ? opt.selectedText : 't-secondary'}`}>{opt.label}</span>
 </button>
 );
 })}
 </div>
 </div>

 {/* Dynamic Config Fields */}
 <div className="space-y-3">
 {dsType === 'erp' && (
 <>
 <div>
 <label className="text-xs t-muted">ERP System</label>
 <select
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.erp_type as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, erp_type: e.target.value }))}
 >
 <option value="">Select ERP...</option>
 {erpConnections.length > 0 ? (
 erpConnections.map(conn => (
 <option key={conn.id} value={conn.adapterSystem.toLowerCase()}>
 {conn.adapterName} ({conn.status})
 </option>
 ))
 ) : (
 <>
 <option value="sap">SAP</option>
 <option value="xero">Xero</option>
 <option value="sage">Sage</option>
 <option value="pastel">Pastel</option>
 </>
 )}
 </select>
 {erpConnections.length > 0 && (
 <p className="text-[10px] text-emerald-400 mt-1 flex items-center gap-1">
 <CheckCircle size={10} /> Pre-filled from your connected ERP adapter
 </p>
 )}
 </div>
 <div>
 <label className="text-xs t-muted">Module (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.module as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, module: e.target.value }))}
 placeholder="e.g. Accounts Payable, General Ledger"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Connection ID (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.connection_id as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, connection_id: e.target.value }))}
 placeholder="ERP connection identifier"
 />
 </div>
 </>
 )}

 {dsType === 'email' && (
 <>
 <div>
 <label className="text-xs t-muted">Mailbox Address</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.mailbox as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, mailbox: e.target.value }))}
 placeholder="e.g. invoices@company.com"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Folder (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.folder as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, folder: e.target.value }))}
 placeholder="e.g. Inbox, Remittances"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Subject Filter (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.filter as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, filter: e.target.value }))}
 placeholder="e.g. Remittance, Payment Advice"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Accepted File Types (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.file_types as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, file_types: e.target.value }))}
 placeholder="e.g. pdf, xlsx, csv"
 />
 </div>
 </>
 )}

 {dsType === 'cloud_storage' && (
 <>
 <div>
 <label className="text-xs t-muted">Cloud Provider</label>
 <select
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.provider as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, provider: e.target.value }))}
 >
 <option value="">Select provider...</option>
 <option value="onedrive">OneDrive</option>
 <option value="sharepoint">SharePoint</option>
 <option value="google_drive">Google Drive</option>
 <option value="dropbox">Dropbox</option>
 </select>
 </div>
 <div>
 <label className="text-xs t-muted">Folder Path</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.path as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, path: e.target.value }))}
 placeholder="e.g. /Finance/Invoices"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Accepted File Types (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.file_types as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, file_types: e.target.value }))}
 placeholder="e.g. pdf, xlsx, csv"
 />
 </div>
 </>
 )}

 {dsType === 'upload' && (
 <>
 <div>
 <label className="text-xs t-muted">Accepted File Types (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.file_types as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, file_types: e.target.value }))}
 placeholder="e.g. csv, xlsx, pdf"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Max File Size (MB, optional)</label>
 <input
 type="number"
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.max_size_mb as number) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, max_size_mb: e.target.value ? Number(e.target.value) : undefined }))}
 placeholder="e.g. 25"
 />
 </div>
 <p className="text-[10px] t-secondary">
 Manual file upload — users will upload files directly through the platform.
 </p>
 </>
 )}
 </div>

 {dsError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
 <AlertTriangle size={14} /> {dsError}
 </div>
 )}

 <div className="flex items-center justify-between pt-2">
 <div>
 {dsExisting && (
 <button
 onClick={handleRemoveDataSource}
 disabled={dsSaving}
 className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
 >
 <Trash2 size={12} /> Remove Data Source
 </button>

 )}
 </div>
 <div className="flex gap-3">
 <Button variant="secondary" size="sm" onClick={() => setShowDataSourceConfig(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveDataSource} disabled={dsSaving}>
 {dsSaving ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />} Save Configuration
 </Button>
 </div>
 </div>
 </div>
 </div></Portal>
 )}
 </div>
 );
}
