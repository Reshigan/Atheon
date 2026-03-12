import { useState, useEffect, useRef } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { ClusterItem, ActionItem, GovernanceData, SubCatalyst, DataSourceConfig, DataSourceType, ERPConnection, ExecutionLogEntry, FieldMapping, ExecutionConfig, ExecutionResult } from "@/lib/api";
import {
 Zap, Bot, Shield, CheckCircle, Clock, XCircle, Eye, Wrench, Send,
 ChevronDown, ChevronUp, Loader2, Upload, Calendar, AlertTriangle,
 Play, X, FileText, Plus, Settings, Database, Mail, Cloud, HardDrive, Trash2, AlertCircle,
 ScrollText, ArrowUpRight, MessageSquare, Cog, Link2, Sparkles, BarChart3, Activity
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
 const isAdmin = user?.role === 'superadmin' || user?.role === 'support_admin' || user?.role === 'admin' || user?.role === 'executive';
 const { activeTab, setActiveTab } = useTabState('clusters');
 const [expandedAction, setExpandedAction] = useState<string | null>(null);
 const [clusters, setClusters] = useState<ClusterItem[]>([]);
 const [actions, setActions] = useState<ActionItem[]>([]);
 const [governance, setGovernance] = useState<GovernanceData | null>(null);
 const [loading, setLoading] = useState(true);
 const [updatingAction, setUpdatingAction] = useState<string | null>(null);

 // Execution Logs state
 const [executionLogs, setExecutionLogs] = useState<ExecutionLogEntry[]>([]);
 const [logsLoading, setLogsLoading] = useState(false);
 const [selectedLogAction, setSelectedLogAction] = useState<string | null>(null);

 // Exception Management state
 const [resolveNotes, setResolveNotes] = useState('');
 const [activeNotesAction, setActiveNotesAction] = useState<string | null>(null);
 const [resolvingAction, setResolvingAction] = useState<string | null>(null);
 const [escalatingAction, setEscalatingAction] = useState<string | null>(null);

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
 const [dsSources, setDsSources] = useState<DataSourceConfig[]>([]);
 const [dsEditIndex, setDsEditIndex] = useState<number | null>(null); // which source is being edited
 const [dsType, setDsType] = useState<DataSourceType>('erp');
 const [dsConfig, setDsConfig] = useState<Record<string, unknown>>({});
 const [dsSaving, setDsSaving] = useState(false);
 const [dsError, setDsError] = useState<string | null>(null);
 const [erpConnections, setErpConnections] = useState<ERPConnection[]>([]);

 // Helper: get existing data sources from sub-catalyst (backward compat with data_source)
 const getSubDataSources = (sub: SubCatalyst): DataSourceConfig[] => {
   if (sub.data_sources && sub.data_sources.length > 0) return sub.data_sources;
   if (sub.data_source) return [sub.data_source];
   return [];
 };

 const openDataSourceConfig = async (clusterId: string, sub: SubCatalyst) => {
 setDsClusterId(clusterId);
 setDsSubName(sub.name);
 const existing = getSubDataSources(sub);
 setDsSources(existing);
 setDsEditIndex(null);
 setDsType('erp');
 setDsConfig({});
 // Pre-fetch ERP connections
 try {
 const erpData = await api.erp.connections();
 const connected = erpData.connections.filter(c => c.status === 'connected');
 setErpConnections(connected);
 } catch {
 setErpConnections([]);
 }
 setDsError(null);
 setShowDataSourceConfig(true);
 };

 const dsStartAddNew = async () => {
 setDsEditIndex(-1); // -1 means adding new
 setDsType('erp');
 // Pre-fill from ERP connections if available
 if (erpConnections.length > 0) {
 const primary = erpConnections[0];
 setDsConfig({
 erp_type: primary.adapterSystem.toLowerCase(),
 connection_id: primary.id,
 module: '',
 });
 } else {
 setDsConfig({});
 }
 };

 const dsStartEdit = (index: number) => {
 const src = dsSources[index];
 setDsEditIndex(index);
 setDsType(src.type);
 setDsConfig({ ...src.config });
 };

 const dsCancelEdit = () => {
 setDsEditIndex(null);
 setDsType('erp');
 setDsConfig({});
 };

 const dsConfirmEdit = () => {
 const newEntry: DataSourceConfig = { type: dsType, config: { ...dsConfig } };
 if (dsEditIndex === -1) {
 // Adding new
 setDsSources(prev => [...prev, newEntry]);
 } else if (dsEditIndex !== null && dsEditIndex >= 0) {
 // Editing existing
 setDsSources(prev => prev.map((s, i) => i === dsEditIndex ? newEntry : s));
 }
 setDsEditIndex(null);
 setDsType('erp');
 setDsConfig({});
 };

 const dsRemoveSource = (index: number) => {
 setDsSources(prev => prev.filter((_, i) => i !== index));
 if (dsEditIndex === index) {
 setDsEditIndex(null);
 setDsType('erp');
 setDsConfig({});
 }
 };

 const handleSaveDataSources = async () => {
 if (dsSaving) return;
 setDsSaving(true);
 setDsError(null);
 try {
 if (dsSources.length === 0) {
 // Remove all data sources
 await api.catalysts.removeDataSource(dsClusterId, dsSubName);
 } else {
 await api.catalysts.setDataSources(dsClusterId, dsSubName, dsSources);
 }
 const ind = industry !== 'general' ? industry : undefined;
 const c = await api.catalysts.clusters(undefined, ind);
 setClusters(c.clusters);
 setShowDataSourceConfig(false);
 } catch (err) {
 setDsError(err instanceof Error ? err.message : 'Failed to save data sources');
 }
 setDsSaving(false);
 };

 const handleRemoveAllDataSources = async () => {
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
 setDsError(err instanceof Error ? err.message : 'Failed to remove data sources');
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

 // Schedule configuration state
 const [showScheduleConfig, setShowScheduleConfig] = useState(false);
 const [schedClusterId, setSchedClusterId] = useState('');
 const [schedSubName, setSchedSubName] = useState('');
 const [schedFrequency, setSchedFrequency] = useState<'manual' | 'daily' | 'weekly' | 'monthly'>('manual');
 const [schedDayOfWeek, setSchedDayOfWeek] = useState(1);
 const [schedDayOfMonth, setSchedDayOfMonth] = useState(1);
 const [schedTimeOfDay, setSchedTimeOfDay] = useState('06:00');
 const [schedSaving, setSchedSaving] = useState(false);
 const [schedError, setSchedError] = useState<string | null>(null);
 const [schedExisting, setSchedExisting] = useState<SubCatalyst['schedule'] | undefined>(undefined);

 const openScheduleConfig = (clusterId: string, sub: SubCatalyst) => {
   setSchedClusterId(clusterId);
   setSchedSubName(sub.name);
   setSchedExisting(sub.schedule);
   if (sub.schedule) {
     setSchedFrequency(sub.schedule.frequency);
     setSchedDayOfWeek(sub.schedule.day_of_week ?? 1);
     setSchedDayOfMonth(sub.schedule.day_of_month ?? 1);
     setSchedTimeOfDay(sub.schedule.time_of_day ?? '06:00');
   } else {
     setSchedFrequency('manual');
     setSchedDayOfWeek(1);
     setSchedDayOfMonth(1);
     setSchedTimeOfDay('06:00');
   }
   setSchedError(null);
   setShowScheduleConfig(true);
 };

 const handleSaveSchedule = async () => {
   if (schedSaving) return;
   setSchedSaving(true);
   setSchedError(null);
   try {
     await api.catalysts.setSchedule(schedClusterId, schedSubName, {
       frequency: schedFrequency,
       ...(schedFrequency === 'weekly' ? { day_of_week: schedDayOfWeek } : {}),
       ...(schedFrequency === 'monthly' ? { day_of_month: schedDayOfMonth } : {}),
       ...(schedFrequency !== 'manual' ? { time_of_day: schedTimeOfDay } : {}),
     });
     const ind = industry !== 'general' ? industry : undefined;
     const c = await api.catalysts.clusters(undefined, ind);
     setClusters(c.clusters);
     setShowScheduleConfig(false);
   } catch (err) {
     setSchedError(err instanceof Error ? err.message : 'Failed to save schedule');
   }
   setSchedSaving(false);
 };

 const handleRemoveSchedule = async () => {
   if (schedSaving) return;
   setSchedSaving(true);
   setSchedError(null);
   try {
     await api.catalysts.removeSchedule(schedClusterId, schedSubName);
     const ind = industry !== 'general' ? industry : undefined;
     const c = await api.catalysts.clusters(undefined, ind);
     setClusters(c.clusters);
     setShowScheduleConfig(false);
   } catch (err) {
     setSchedError(err instanceof Error ? err.message : 'Failed to remove schedule');
   }
   setSchedSaving(false);
 };

 // Field mapping configuration state
 const [showFieldMappingConfig, setShowFieldMappingConfig] = useState(false);
 const [fmClusterId, setFmClusterId] = useState('');
 const [fmSubName, setFmSubName] = useState('');
 const [fmMappings, setFmMappings] = useState<FieldMapping[]>([]);
 const [fmSuggesting, setFmSuggesting] = useState(false);
 const [fmSaving, setFmSaving] = useState(false);
 const [fmError, setFmError] = useState<string | null>(null);
 const [fmDataSources, setFmDataSources] = useState<DataSourceConfig[]>([]);

 // Execution configuration state
 const [showExecutionConfig, setShowExecutionConfig] = useState(false);
 const [execClusterId, setExecClusterId] = useState('');
 const [execSubName, setExecSubName] = useState('');
 const [execMode, setExecMode] = useState<ExecutionConfig['mode']>('reconciliation');
 const [execSaving, setExecSaving] = useState(false);
 const [execCfgError, setExecCfgError] = useState<string | null>(null);

 // Execution result state
 const [showExecResult, setShowExecResult] = useState(false);
 const [execResult, setExecResult] = useState<ExecutionResult | null>(null);
 const [subExecuting, setSubExecuting] = useState<string | null>(null); // "clusterId:subName" currently executing

 const openFieldMappingConfig = (clusterId: string, sub: SubCatalyst) => {
   setFmClusterId(clusterId);
   setFmSubName(sub.name);
   setFmMappings(sub.field_mappings || []);
   setFmDataSources(getSubDataSources(sub));
   setFmError(null);
   setShowFieldMappingConfig(true);
 };

 const handleSuggestMappings = async () => {
   if (fmSuggesting) return;
   setFmSuggesting(true);
   setFmError(null);
   try {
     const result = await api.catalysts.suggestFieldMappings(fmClusterId, fmSubName);
     setFmMappings(result.suggestions);
   } catch (err) {
     setFmError(err instanceof Error ? err.message : 'Failed to get suggestions');
   }
   setFmSuggesting(false);
 };

 const handleSaveFieldMappings = async () => {
   if (fmSaving) return;
   setFmSaving(true);
   setFmError(null);
   try {
     await api.catalysts.setFieldMappings(fmClusterId, fmSubName, fmMappings);
     const ind = industry !== 'general' ? industry : undefined;
     const c = await api.catalysts.clusters(undefined, ind);
     setClusters(c.clusters);
     setShowFieldMappingConfig(false);
   } catch (err) {
     setFmError(err instanceof Error ? err.message : 'Failed to save field mappings');
   }
   setFmSaving(false);
 };

 const handleRemoveMapping = (index: number) => {
   setFmMappings(prev => prev.filter((_, i) => i !== index));
 };

 const openExecutionConfig = (clusterId: string, sub: SubCatalyst) => {
   setExecClusterId(clusterId);
   setExecSubName(sub.name);
   setExecMode(sub.execution_config?.mode || 'reconciliation');
   setExecCfgError(null);
   setShowExecutionConfig(true);
 };

 const handleSaveExecutionConfig = async () => {
   if (execSaving) return;
   setExecSaving(true);
   setExecCfgError(null);
   try {
     await api.catalysts.setExecutionConfig(execClusterId, execSubName, { mode: execMode });
     const ind = industry !== 'general' ? industry : undefined;
     const c = await api.catalysts.clusters(undefined, ind);
     setClusters(c.clusters);
     setShowExecutionConfig(false);
   } catch (err) {
     setExecCfgError(err instanceof Error ? err.message : 'Failed to save execution config');
   }
   setExecSaving(false);
 };

 const handleExecuteSubCatalyst = async (clusterId: string, subName: string) => {
   const key = `${clusterId}:${subName}`;
   if (subExecuting) return;
   setSubExecuting(key);
   try {
     const result = await api.catalysts.executeSubCatalyst(clusterId, subName);
     setExecResult(result);
     setShowExecResult(true);
     // Refresh clusters to get updated last_execution
     const ind = industry !== 'general' ? industry : undefined;
     const c = await api.catalysts.clusters(undefined, ind);
     setClusters(c.clusters);
   } catch (err) {
     setExecResult({
       id: '', sub_catalyst: subName, cluster_id: clusterId,
       executed_at: new Date().toISOString(), duration_ms: 0,
       status: 'failed', mode: 'unknown',
       summary: { total_records_source: 0, total_records_target: 0, matched: 0, unmatched_source: 0, unmatched_target: 0, discrepancies: 0 },
       error: err instanceof Error ? err.message : 'Execution failed',
     });
     setShowExecResult(true);
   }
   setSubExecuting(null);
 };

 const exceptionCount = actions.filter(a => a.status === 'exception' || a.status === 'escalated').length;

 // Load execution logs when tab changes or action selected
 const loadExecutionLogs = async (actionId?: string) => {
 setLogsLoading(true);
 try {
 const result = actionId
 ? await api.catalysts.executionLogsForAction(actionId)
 : await api.catalysts.executionLogs();
 setExecutionLogs(result.logs);
 } catch { setExecutionLogs([]); }
 setLogsLoading(false);
 };

 const handleResolveException = async (actionId: string) => {
 setResolvingAction(actionId);
 try {
 await api.catalysts.resolveException(actionId, (activeNotesAction === actionId ? resolveNotes : '') || undefined);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 setResolveNotes('');
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to resolve exception');
 }
 setResolvingAction(null);
 };

 const handleEscalateException = async (actionId: string) => {
 setEscalatingAction(actionId);
 try {
 await api.catalysts.escalateException(actionId);
 const ind = industry !== 'general' ? industry : undefined;
 const a = await api.catalysts.actions(undefined, undefined, ind);
 setActions(a.actions);
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to escalate exception');
 }
 setEscalatingAction(null);
 };

 // Auto-load execution logs when tab is activated
 useEffect(() => {
 if (activeTab === 'execution-logs') {
 loadExecutionLogs(selectedLogAction || undefined);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeTab]);

 const tabs = [
 { id: 'clusters', label: 'Catalyst Clusters', icon: <Bot size={14} /> },
 { id: 'actions', label: 'Action Log', icon: <Zap size={14} />, count: actions.length },
 { id: 'execution-logs', label: 'Execution Logs', icon: <ScrollText size={14} /> },
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
 <Button variant="primary" size="sm" onClick={() => setShowDeployCatalyst(true)} title="Create a new catalyst cluster">
 <Plus size={14} /> New Cluster
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
 {getSubDataSources(sub).map((ds, dsIdx) => (
 <span key={dsIdx} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
 ds.type === 'erp' ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20' :
 ds.type === 'email' ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' :
 ds.type === 'cloud_storage' ? 'bg-cyan-500/10 text-cyan-400 border border-cyan-500/20' :
 ds.type === 'custom_system' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
 }`}>
 {ds.type === 'erp' && <><Database size={8} /> ERP</>}
 {ds.type === 'email' && <><Mail size={8} /> Email</>}
 {ds.type === 'cloud_storage' && <><Cloud size={8} /> Cloud</>}
 {ds.type === 'upload' && <><HardDrive size={8} /> Upload</>}
 {ds.type === 'custom_system' && <><Cog size={8} /> {(ds.config.system_name as string) || 'Custom'}</>}
 </span>
 ))}
 </div>
 {sub.description && <span className="text-[10px] t-secondary block truncate">{sub.description}</span>}
 </div>
 </div>
 <div className="flex items-center gap-1.5 flex-shrink-0">
 {sub.schedule && sub.schedule.frequency !== 'manual' && (
 <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" title={sub.schedule.next_run ? `Next run: ${new Date(sub.schedule.next_run).toLocaleString()}` : ''}>
 <Calendar size={8} />
 {sub.schedule.frequency === 'daily' ? 'Daily' : sub.schedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'}
 {sub.schedule.time_of_day ? ` ${sub.schedule.time_of_day}` : ''}
 </span>
 )}
 {sub.enabled && getSubDataSources(sub).length >= 2 && sub.field_mappings && sub.field_mappings.length > 0 && (
 <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); handleExecuteSubCatalyst(cluster.id, sub.name); }} disabled={subExecuting === `${cluster.id}:${sub.name}`} title="Execute reconciliation/comparison">
 {subExecuting === `${cluster.id}:${sub.name}`? <Loader2 size={10} className="mr-1 animate-spin" /> : <Activity size={10} className="mr-1" />} Execute
 </Button>
 )}
 {sub.enabled && (
 <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={(e) => { e.stopPropagation(); openQuickRun(cluster.id, cluster.name, sub.name); }} title="Quick run this sub-catalyst">
 <Play size={10} className="mr-1" /> Run
 </Button>
 )}
 {sub.last_execution && (
 <button
 onClick={(e) => { e.stopPropagation(); setExecResult(sub.last_execution as ExecutionResult); setShowExecResult(true); }}
 className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium ${
   sub.last_execution.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
   sub.last_execution.status === 'partial' ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' :
   'bg-red-500/10 text-red-400 border border-red-500/20'
 }`}
 title={`Last execution: ${sub.last_execution.status} — ${sub.last_execution.summary.matched} matched, ${sub.last_execution.summary.discrepancies} discrepancies`}
 >
 <BarChart3 size={8} />
 {sub.last_execution.summary.matched} matched / {sub.last_execution.summary.discrepancies} disc.
 </button>
 )}
 {isAdmin && (
 <>
 {getSubDataSources(sub).length >= 2 && (
 <button
 onClick={(e) => { e.stopPropagation(); openFieldMappingConfig(cluster.id, sub); }}
 className="h-6 w-6 flex items-center justify-center rounded hover:bg-teal-500/10 transition-colors"
 title="Configure field mappings"
 >
 <Link2 size={12} className={sub.field_mappings && sub.field_mappings.length > 0 ? 'text-teal-400' : 'text-gray-400'} />
 </button>
 )}
 <button
 onClick={(e) => { e.stopPropagation(); openExecutionConfig(cluster.id, sub); }}
 className="h-6 w-6 flex items-center justify-center rounded hover:bg-orange-500/10 transition-colors"
 title="Configure execution mode"
 >
 <Activity size={12} className={sub.execution_config ? 'text-orange-400' : 'text-gray-400'} />
 </button>
 <button
 onClick={(e) => { e.stopPropagation(); openScheduleConfig(cluster.id, sub); }}
 className="h-6 w-6 flex items-center justify-center rounded hover:bg-indigo-500/10 transition-colors"
 title="Configure schedule"
 >
 <Calendar size={12} className="text-indigo-400" />
 </button>
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

 {/* Execution Logs Tab */}
 {activeTab === 'execution-logs' && (
 <TabPanel>
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <ScrollText size={18} className="text-accent" /> Execution Logs
 </h3>
 <div className="flex items-center gap-2">
 <select
 className="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs t-primary"
 value={selectedLogAction || ''}
 onChange={(e) => {
 const val = e.target.value || null;
 setSelectedLogAction(val);
 loadExecutionLogs(val || undefined);
 }}
 >
 <option value="">All recent logs</option>
 {actions.map(a => (
 <option key={a.id} value={a.id}>{a.catalystName} — {a.action.slice(0, 40)}</option>
 ))}
 </select>
 <Button variant="secondary" size="sm" onClick={() => loadExecutionLogs(selectedLogAction || undefined)}>
 <Loader2 size={12} className={logsLoading ? 'animate-spin' : ''} /> Refresh
 </Button>
 </div>
 </div>

 {logsLoading && (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {!logsLoading && executionLogs.length === 0 && (
 <div className="text-center py-12 text-gray-500">
 <ScrollText size={32} className="mx-auto mb-2 opacity-50" />
 <p className="text-sm">No execution logs yet</p>
 <p className="text-xs t-muted mt-1">Run a catalyst to generate step-by-step execution logs.</p>
 </div>
 )}

 {!logsLoading && executionLogs.length > 0 && (
 <div className="relative">
 {/* Timeline line */}
 <div className="absolute left-[19px] top-6 bottom-2 w-0.5 bg-[var(--border-card)]" />

 <div className="space-y-1">
 {executionLogs.map((log) => (
 <div key={log.id} className="relative flex items-start gap-3 pl-1">
 {/* Timeline dot */}
 <div className={`relative z-10 w-[18px] h-[18px] rounded-full flex items-center justify-center flex-shrink-0 mt-1 ${
 log.status === 'completed' ? 'bg-emerald-500/20' :
 log.status === 'running' ? 'bg-accent/20' :
 log.status === 'failed' ? 'bg-red-500/20' : 'bg-gray-500/20'
 }`}>
 {log.status === 'completed' ? <CheckCircle size={10} className="text-emerald-400" /> :
 log.status === 'running' ? <Loader2 size={10} className="text-accent animate-spin" /> :
 log.status === 'failed' ? <XCircle size={10} className="text-red-400" /> :
 <Clock size={10} className="text-gray-400" />}
 </div>

 <div className="flex-1 p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] min-w-0">
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <Badge variant={log.status === 'completed' ? 'success' : log.status === 'running' ? 'info' : log.status === 'failed' ? 'danger' : 'warning'} size="sm">
 Step {log.stepNumber}
 </Badge>
 <span className="text-sm font-medium t-primary truncate">{log.stepName}</span>
 </div>
 {log.durationMs !== null && log.durationMs > 0 && (
 <span className="text-[10px] text-gray-400 flex-shrink-0">{log.durationMs}ms</span>
 )}
 </div>
 <p className="text-xs t-muted mt-1">{log.detail}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 </TabPanel>
 )}

 {activeTab === 'exceptions' && (
 <TabPanel>
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <AlertTriangle size={18} className="text-red-400" /> Exception Management
 </h3>
 <p className="text-xs t-muted">{exceptionCount} exception{exceptionCount !== 1 ? 's' : ''} requiring review</p>
 </div>

 {exceptionCount === 0 && (
 <div className="text-center py-12 text-gray-500">
 <CheckCircle size={32} className="mx-auto mb-2 text-emerald-500 opacity-50" />
 <p className="text-sm">No exceptions — all clear</p>
 <p className="text-xs t-muted mt-1">All catalyst actions are running normally.</p>
 </div>
 )}

 {actions.filter(a => a.status === 'exception' || a.status === 'escalated').map((action) => {
  const outputData = action.outputData as Record<string, unknown> | undefined;
  const exType = typeof outputData?.exception_type === 'string' ? outputData.exception_type : '';
  const exSeverity = typeof outputData?.severity === 'string' ? outputData.severity : '';
  const exDetail = (typeof outputData?.exception_detail === 'string' ? outputData.exception_detail : '') || (typeof outputData?.detail === 'string' ? outputData.detail : '') || 'Exception occurred during catalyst execution';
  const exSummary = (outputData?.execution_summary && typeof outputData.execution_summary === 'object') ? outputData.execution_summary as Record<string, number> : null;
  const exSamples = Array.isArray(outputData?.discrepancy_sample) ? outputData.discrepancy_sample as Array<Record<string, string>> : [];
  const exSuggested = typeof outputData?.suggested_action === 'string' ? outputData.suggested_action : '';
  return (
  <Card key={action.id} className="ring-1 ring-red-500/30 bg-red-500/[0.02]">
  <div className="flex items-start justify-between">
  <div className="flex items-start gap-3">
  <AlertTriangle size={16} className="text-red-400 mt-0.5" />
  <div>
  <h3 className="text-sm font-semibold t-primary">{action.action}</h3>
  <p className="text-xs t-secondary mt-0.5">{action.catalystName}</p>
  </div>
  </div>
  <div className="flex items-center gap-2">
  <Badge variant={action.status === 'escalated' ? 'warning' : 'danger'}>{action.status}</Badge>
  <span className="text-xs t-secondary">{new Date(action.createdAt).toLocaleDateString()}</span>
  </div>
  </div>

  {outputData && (
  <div className="mt-3 p-3 rounded-lg bg-red-500/[0.06] border border-red-500/20">
  <div className="flex items-center gap-2 mb-2 flex-wrap">
  {exType && (
  <Badge variant="danger" size="sm">{exType.replace(/_/g, ' ')}</Badge>
  )}
  {exSeverity && (
  <Badge variant={exSeverity === 'high' ? 'danger' : exSeverity === 'medium' ? 'warning' : 'outline'} size="sm">{exSeverity} severity</Badge>
  )}
  </div>
  <p className="text-xs text-red-500/80">{exDetail}</p>
  {exSummary && (
  <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2 text-[10px]">
  {([
    ['Source', exSummary.total_records_source],
    ['Target', exSummary.total_records_target],
    ['Matched', exSummary.matched],
    ['Unmatched Src', exSummary.unmatched_source],
    ['Unmatched Tgt', exSummary.unmatched_target],
    ['Discrepancies', exSummary.discrepancies],
  ] as Array<[string, number | undefined]>).map(([label, val]) => (
    <div key={label} className="p-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] text-center">
      <div className="t-muted">{label}</div>
      <div className="font-semibold t-primary">{val ?? '—'}</div>
    </div>
  ))}
  </div>
  )}
  {exSamples.length > 0 && (
  <details className="mt-2">
  <summary className="text-xs t-secondary cursor-pointer hover:text-accent">View sample discrepancies ({exSamples.length})</summary>
  <div className="mt-1 space-y-1 max-h-32 overflow-y-auto">
  {exSamples.map((d, i) => (
    <div key={i} className="text-[10px] p-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
      <span className="font-medium t-primary">{d.field || 'field'}</span>: source=<span className="text-emerald-600">{d.source_value || '—'}</span> vs target=<span className="text-red-500">{d.target_value || '—'}</span>
    </div>
  ))}
  </div>
  </details>
  )}
  {exSuggested && (
  <div className="mt-2 p-2 rounded bg-amber-500/[0.08] border border-accent/20">
  <p className="text-xs text-amber-700"><strong>Suggested:</strong> {exSuggested}</p>
  </div>
  )}
  </div>
  )}

 {/* Resolution Actions */}
 {isAdmin && (action.status === 'exception' || action.status === 'escalated') && (
 <div className="mt-3 space-y-2">
 <div className="flex items-center gap-2">
 <input
 className="flex-1 px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs t-primary"
 placeholder="Resolution notes (optional)..."
 value={activeNotesAction === action.id ? resolveNotes : ''}
 onChange={(e) => { setActiveNotesAction(action.id); setResolveNotes(e.target.value); }}
 onClick={(e) => e.stopPropagation()}
 />
 </div>
 <div className="flex gap-2">
 <Button variant="success" size="sm" onClick={(e) => { e.stopPropagation(); handleResolveException(action.id); }} disabled={resolvingAction === action.id}>
 {resolvingAction === action.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />} Resolve
 </Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleEscalateException(action.id); }} disabled={escalatingAction === action.id}>
 {escalatingAction === action.id ? <Loader2 size={12} className="animate-spin" /> : <ArrowUpRight size={12} />} Escalate
 </Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleApprove(action.id); }} disabled={updatingAction === action.id}>
 <MessageSquare size={12} /> Override & Approve
 </Button>
 </div>
 </div>
 )}
 </Card>
 );
 })}
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
 <Settings size={18} className="text-accent" /> Configure Data Sources
 </h3>
 <button onClick={() => setShowDataSourceConfig(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>

 <p className="text-xs t-secondary">
 Configure where <span className="font-semibold text-accent">{dsSubName}</span> gets its input data from. A sub-catalyst can have multiple data sources.
 </p>

 {/* Existing Data Sources List */}
 {dsSources.length > 0 && dsEditIndex === null && (
 <div className="space-y-2">
 <label className="text-xs t-muted block">Configured Data Sources ({dsSources.length})</label>
 {dsSources.map((src, i) => {
 const dsIcon = src.type === 'erp' ? Database : src.type === 'email' ? Mail : src.type === 'cloud_storage' ? Cloud : src.type === 'custom_system' ? Cog : HardDrive;
 const DsIcon = dsIcon;
 const dsColor = src.type === 'erp' ? 'text-blue-400' : src.type === 'email' ? 'text-purple-400' : src.type === 'cloud_storage' ? 'text-cyan-400' : src.type === 'custom_system' ? 'text-rose-400' : 'text-amber-400';
 const dsBg = src.type === 'erp' ? 'bg-blue-500/5 border-blue-500/20' : src.type === 'email' ? 'bg-purple-500/5 border-purple-500/20' : src.type === 'cloud_storage' ? 'bg-cyan-500/5 border-cyan-500/20' : src.type === 'custom_system' ? 'bg-rose-500/5 border-rose-500/20' : 'bg-amber-500/5 border-amber-500/20';
 const dsLabel = src.type === 'erp' ? `ERP (${(src.config.erp_type as string) || 'unknown'})` : src.type === 'email' ? `Email (${(src.config.mailbox as string) || '...'})` : src.type === 'cloud_storage' ? `Cloud (${(src.config.provider as string) || '...'})` : src.type === 'custom_system' ? `Custom: ${(src.config.system_name as string) || 'System'}` : 'Manual Upload';
 return (
 <div key={i} className={`flex items-center justify-between p-3 rounded-lg border ${dsBg}`}>
 <div className="flex items-center gap-2 min-w-0">
 <DsIcon size={16} className={dsColor} />
 <div className="min-w-0">
 <span className={`text-xs font-medium ${dsColor}`}>{dsLabel}</span>
 {src.type === 'erp' && !!src.config.module && <span className="text-[10px] t-muted block">{String(src.config.module)}</span>}
 {src.type === 'custom_system' && !!src.config.endpoint_url && <span className="text-[10px] t-muted block truncate">{String(src.config.endpoint_url)}</span>}
 </div>
 </div>
 <div className="flex items-center gap-1 flex-shrink-0">
 <button onClick={() => dsStartEdit(i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-accent/10 transition-colors" title="Edit">
 <Settings size={12} className="text-accent" />
 </button>
 <button onClick={() => dsRemoveSource(i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-500/10 transition-colors" title="Remove">
 <Trash2 size={12} className="text-red-400" />
 </button>
 </div>
 </div>
 );
 })}
 </div>
 )}

 {/* Empty state */}
 {dsSources.length === 0 && dsEditIndex === null && (
 <div className="text-center py-6 border border-dashed border-[var(--border-card)] rounded-lg">
 <Database size={24} className="mx-auto text-gray-400 mb-2" />
 <p className="text-xs t-muted">No data sources configured yet.</p>
 <p className="text-[10px] t-muted mt-1">Click &quot;Add Data Source&quot; to connect one.</p>
 </div>
 )}

 {/* Add New Data Source button (shown when not editing) */}
 {dsEditIndex === null && (
 <button
 onClick={dsStartAddNew}
 className="flex items-center gap-2 w-full p-3 rounded-lg border border-dashed border-[var(--border-card)] hover:border-accent/40 hover:bg-accent/5 transition-all text-xs t-secondary"
 >
 <Plus size={14} className="text-accent" /> Add Data Source
 </button>
 )}

 {/* Data Source Editor (shown when adding or editing) */}
 {dsEditIndex !== null && (
 <div className="border border-accent/30 rounded-lg p-4 space-y-3 bg-accent/5">
 <div className="flex items-center justify-between">
 <span className="text-xs font-semibold t-primary">{dsEditIndex === -1 ? 'Add New Data Source' : `Edit Data Source #${dsEditIndex + 1}`}</span>
 <button onClick={dsCancelEdit} className="text-gray-400 hover:text-gray-600 text-xs">Cancel</button>
 </div>

 {/* Data Source Type Selector */}
 <div>
 <label className="text-xs t-muted block mb-1.5">Data Source Type</label>
 <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
 {([
 { type: 'erp' as const, label: 'ERP', icon: Database, selectedBg: 'bg-blue-500/10 border-blue-500/40 ring-1 ring-blue-500/30', selectedText: 'text-blue-400' },
 { type: 'email' as const, label: 'Email', icon: Mail, selectedBg: 'bg-purple-500/10 border-purple-500/40 ring-1 ring-purple-500/30', selectedText: 'text-purple-400' },
 { type: 'cloud_storage' as const, label: 'Cloud', icon: Cloud, selectedBg: 'bg-cyan-500/10 border-cyan-500/40 ring-1 ring-cyan-500/30', selectedText: 'text-cyan-400' },
 { type: 'upload' as const, label: 'Upload', icon: HardDrive, selectedBg: 'bg-amber-500/10 border-amber-500/40 ring-1 ring-amber-500/30', selectedText: 'text-amber-400' },
 { type: 'custom_system' as const, label: 'Custom', icon: Cog, selectedBg: 'bg-rose-500/10 border-rose-500/40 ring-1 ring-rose-500/30', selectedText: 'text-rose-400' },
 ] satisfies Array<{ type: DataSourceType; label: string; icon: typeof Database; selectedBg: string; selectedText: string }>).map((opt) => {
 const Icon = opt.icon;
 const selected = dsType === opt.type;
 return (
 <button
 key={opt.type}
 onClick={() => { setDsType(opt.type); setDsConfig({}); }}
 className={`flex flex-col items-center gap-1 p-2 rounded-lg border transition-all ${
 selected
 ? opt.selectedBg
 : 'bg-[var(--bg-secondary)] border-[var(--border-card)] hover:border-gray-400'
 }`}
 >
 <Icon size={16} className={selected ? opt.selectedText : 'text-gray-400'} />
 <span className={`text-[10px] font-medium ${selected ? opt.selectedText : 't-secondary'}`}>{opt.label}</span>
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

 {dsType === 'custom_system' && (
 <>
 <div>
 <label className="text-xs t-muted">System Name</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.system_name as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, system_name: e.target.value }))}
 placeholder="e.g. Banking Portal, HR System, Legacy ERP"
 />
 </div>
 <div>
 <label className="text-xs t-muted">System Description (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.description as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, description: e.target.value }))}
 placeholder="e.g. Internal banking reconciliation system"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Endpoint URL (optional)</label>
 <input
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.endpoint_url as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, endpoint_url: e.target.value }))}
 placeholder="e.g. https://internal-system.company.com/api"
 />
 </div>
 <div>
 <label className="text-xs t-muted">Authentication Type (optional)</label>
 <select
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.auth_type as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, auth_type: e.target.value }))}
 >
 <option value="">None / Not applicable</option>
 <option value="api_key">API Key</option>
 <option value="oauth2">OAuth 2.0</option>
 <option value="basic_auth">Basic Auth</option>
 <option value="certificate">Client Certificate</option>
 <option value="custom">Custom Token</option>
 </select>
 </div>
 <div>
 <label className="text-xs t-muted">Data Format (optional)</label>
 <select
 className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
 value={(dsConfig.data_format as string) || ''}
 onChange={e => setDsConfig(prev => ({ ...prev, data_format: e.target.value }))}
 >
 <option value="">Auto-detect</option>
 <option value="json">JSON</option>
 <option value="xml">XML</option>
 <option value="csv">CSV</option>
 <option value="fixed_width">Fixed Width</option>
 <option value="proprietary">Proprietary</option>
 </select>
 </div>
 <p className="text-[10px] t-secondary flex items-center gap-1">
 <Cog size={10} /> For in-house or customized systems not covered by standard adapters.
 </p>
 </>
 )}
 </div>

 {/* Confirm/Cancel for individual source */}
 <div className="flex gap-2 pt-1">
 <Button variant="secondary" size="sm" onClick={dsCancelEdit}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={dsConfirmEdit}>
 <CheckCircle size={12} className="mr-1" /> {dsEditIndex === -1 ? 'Add Source' : 'Update Source'}
 </Button>
 </div>
 </div>
 )}

 {dsError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
 <AlertTriangle size={14} /> {dsError}
 </div>
 )}

 {/* Footer Actions */}
 <div className="flex items-center justify-between pt-2 border-t border-[var(--border-card)]">
 <div>
 {dsSources.length > 0 && dsEditIndex === null && (
 <button
 onClick={handleRemoveAllDataSources}
 disabled={dsSaving}
 className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
 >
 <Trash2 size={12} /> Remove All
 </button>
 )}
 </div>
 <div className="flex gap-3">
 <Button variant="secondary" size="sm" onClick={() => setShowDataSourceConfig(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveDataSources} disabled={dsSaving || dsEditIndex !== null}>
 {dsSaving ? <Loader2 size={14} className="animate-spin" /> : <Settings size={14} />} Save All ({dsSources.length})
 </Button>
 </div>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Schedule Configuration Modal */}
 {showScheduleConfig && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <Calendar size={18} className="text-indigo-400" /> Schedule Configuration
 </h3>
 <button onClick={() => setShowScheduleConfig(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
 </div>

 <p className="text-xs t-secondary">
 Configure when <span className="font-semibold text-indigo-400">{schedSubName}</span> should run automatically.
 </p>

 {/* Frequency Selector */}
 <div>
 <label className="text-xs t-muted block mb-1.5">Run Frequency</label>
 <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
 {([
   { value: 'manual' as const, label: 'Manual', desc: 'On demand' },
   { value: 'daily' as const, label: 'Daily', desc: 'Every day' },
   { value: 'weekly' as const, label: 'Weekly', desc: 'Once a week' },
   { value: 'monthly' as const, label: 'Monthly', desc: '1st of month' },
 ]).map((opt) => (
   <button
     key={opt.value}
     onClick={() => setSchedFrequency(opt.value)}
     className={`flex flex-col items-center gap-1 p-3 rounded-lg border transition-all ${
       schedFrequency === opt.value
         ? 'bg-indigo-500/10 border-indigo-500/40 ring-1 ring-indigo-500/30'
         : 'bg-[var(--bg-secondary)] border-[var(--border-card)] hover:border-gray-400'
     }`}
   >
     <span className={`text-xs font-medium ${schedFrequency === opt.value ? 'text-indigo-400' : 't-secondary'}`}>{opt.label}</span>
     <span className="text-[9px] t-muted">{opt.desc}</span>
   </button>
 ))}
 </div>
 </div>

 {/* Day of Week (for weekly) */}
 {schedFrequency === 'weekly' && (
 <div>
 <label className="text-xs t-muted block mb-1.5">Day of Week</label>
 <select
   className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
   value={schedDayOfWeek}
   onChange={e => setSchedDayOfWeek(Number(e.target.value))}
 >
   <option value={0}>Sunday</option>
   <option value={1}>Monday</option>
   <option value={2}>Tuesday</option>
   <option value={3}>Wednesday</option>
   <option value={4}>Thursday</option>
   <option value={5}>Friday</option>
   <option value={6}>Saturday</option>
 </select>
 </div>
 )}

 {/* Day of Month (for monthly) */}
 {schedFrequency === 'monthly' && (
 <div>
 <label className="text-xs t-muted block mb-1.5">Day of Month</label>
 <select
   className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
   value={schedDayOfMonth}
   onChange={e => setSchedDayOfMonth(Number(e.target.value))}
 >
   {Array.from({ length: 31 }, (_, i) => i + 1).map(d => (
     <option key={d} value={d}>{d}{d === 1 ? 'st' : d === 2 ? 'nd' : d === 3 ? 'rd' : 'th'}</option>
   ))}
 </select>
 </div>
 )}

 {/* Time of Day (for non-manual) */}
 {schedFrequency !== 'manual' && (
 <div>
 <label className="text-xs t-muted block mb-1.5">Time of Day (UTC)</label>
 <input
   type="time"
   className="w-full px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
   value={schedTimeOfDay}
   onChange={e => setSchedTimeOfDay(e.target.value)}
 />
 <p className="text-[9px] t-muted mt-1">All times are in UTC. Your local time may differ.</p>
 </div>
 )}

 {/* Current Schedule Info */}
 {schedExisting && schedExisting.frequency !== 'manual' && (
 <div className="p-3 bg-indigo-500/5 border border-indigo-500/20 rounded-lg space-y-1">
 <p className="text-xs t-secondary">
   <span className="font-medium text-indigo-400">Current:</span>{' '}
   {schedExisting.frequency === 'daily' ? 'Daily' : schedExisting.frequency === 'weekly' ? `Weekly (${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][schedExisting.day_of_week ?? 0]})` : `Monthly (${schedExisting.day_of_month}${schedExisting.day_of_month === 1 ? 'st' : schedExisting.day_of_month === 2 ? 'nd' : schedExisting.day_of_month === 3 ? 'rd' : 'th'})`}
   {schedExisting.time_of_day ? ` at ${schedExisting.time_of_day} UTC` : ''}
 </p>
 {schedExisting.last_run && (
   <p className="text-[10px] t-muted">Last run: {new Date(schedExisting.last_run).toLocaleString()}</p>
 )}
 {schedExisting.next_run && (
   <p className="text-[10px] t-muted">Next run: {new Date(schedExisting.next_run).toLocaleString()}</p>
 )}
 </div>
 )}

 {schedError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
 <AlertTriangle size={14} /> {schedError}
 </div>
 )}

 <div className="flex items-center justify-between pt-2">
 <div>
 {schedExisting && schedExisting.frequency !== 'manual' && (
   <button
     onClick={handleRemoveSchedule}
     disabled={schedSaving}
     className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300 transition-colors"
   >
     <Trash2 size={12} /> Remove Schedule
   </button>
 )}
 </div>
 <div className="flex gap-3">
 <Button variant="secondary" size="sm" onClick={() => setShowScheduleConfig(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveSchedule} disabled={schedSaving}>
 {schedSaving ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />} Save Schedule
 </Button>
 </div>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Field Mapping Configuration Modal */}
 {showFieldMappingConfig && (
 <Portal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowFieldMappingConfig(false)}>
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl shadow-xl p-6 w-full max-w-2xl max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <Link2 className="w-5 h-5 text-teal-400" />
 <h3 className="text-lg font-semibold t-primary">Field Mappings</h3>
 </div>
 <button onClick={() => setShowFieldMappingConfig(false)} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
 </div>
 <p className="text-xs t-secondary mb-3">Map data elements between sources for <span className="font-medium text-teal-400">{fmSubName}</span></p>

 {/* Data Sources Summary */}
 <div className="flex items-center gap-2 mb-4">
 {fmDataSources.map((ds, i) => (
 <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="font-bold text-accent">#{i}</span>
 {ds.type === 'erp' && <><Database size={10} className="text-blue-400" /> ERP</>}
 {ds.type === 'email' && <><Mail size={10} className="text-purple-400" /> Email</>}
 {ds.type === 'cloud_storage' && <><Cloud size={10} className="text-cyan-400" /> Cloud</>}
 {ds.type === 'upload' && <><HardDrive size={10} className="text-amber-400" /> Upload</>}
 {ds.type === 'custom_system' && <><Cog size={10} className="text-rose-400" /> {String(ds.config.system_name || 'Custom')}</>}
 </span>
 ))}
 </div>

 {/* Smart Suggest Button */}
 <div className="mb-4">
 <Button variant="secondary" size="sm" onClick={handleSuggestMappings} disabled={fmSuggesting || fmDataSources.length < 2}>
 {fmSuggesting ? <Loader2 size={14} className="animate-spin mr-1" /> : <Sparkles size={14} className="mr-1" />}
 Smart Suggest Mappings
 </Button>
 {fmDataSources.length < 2 && <span className="text-[10px] text-amber-400 ml-2">Need at least 2 data sources</span>}
 </div>

 {/* Existing Mappings */}
 {fmMappings.length > 0 ? (
 <div className="space-y-2 mb-4">
 <div className="grid grid-cols-[40px_1fr_24px_1fr_80px_60px_32px] gap-2 text-[10px] font-semibold t-secondary px-2">
 <span>Src</span><span>Source Field</span><span></span><span>Target Field</span><span>Match Type</span><span>Conf.</span><span></span>
 </div>
 {fmMappings.map((fm, i) => (
 <div key={fm.id || i} className="grid grid-cols-[40px_1fr_24px_1fr_80px_60px_32px] gap-2 items-center p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] font-bold text-accent">#{fm.source_index}</span>
 <input
   className="bg-transparent border border-[var(--border-card)] rounded px-2 py-1 text-xs t-primary"
   value={fm.source_field}
   onChange={e => setFmMappings(prev => prev.map((m, j) => j === i ? { ...m, source_field: e.target.value } : m))}
 />
 <span className="text-center text-gray-400">→</span>
 <input
   className="bg-transparent border border-[var(--border-card)] rounded px-2 py-1 text-xs t-primary"
   value={fm.target_field}
   onChange={e => setFmMappings(prev => prev.map((m, j) => j === i ? { ...m, target_field: e.target.value } : m))}
 />
 <select
   className="bg-transparent border border-[var(--border-card)] rounded px-1 py-1 text-[10px] t-primary"
   value={fm.match_type}
   onChange={e => setFmMappings(prev => prev.map((m, j) => j === i ? { ...m, match_type: e.target.value as FieldMapping['match_type'] } : m))}
 >
   <option value="exact">Exact</option>
   <option value="fuzzy">Fuzzy</option>
   <option value="contains">Contains</option>
   <option value="numeric_tolerance">Numeric ±</option>
   <option value="date_range">Date Range</option>
 </select>
 <span className={`text-[10px] font-medium text-center ${fm.confidence >= 0.8 ? 'text-emerald-400' : fm.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
   {(fm.confidence * 100).toFixed(0)}%
 </span>
 <button onClick={() => handleRemoveMapping(i)} className="h-6 w-6 flex items-center justify-center rounded hover:bg-red-500/10 transition-colors">
   <Trash2 size={12} className="text-red-400" />
 </button>
 </div>
 ))}
 </div>
 ) : (
 <div className="p-6 text-center bg-[var(--bg-secondary)] rounded-lg border border-dashed border-[var(--border-card)] mb-4">
 <Link2 className="w-8 h-8 text-gray-400 mx-auto mb-2" />
 <p className="text-xs t-secondary">No field mappings configured</p>
 <p className="text-[10px] t-muted mt-1">Click &quot;Smart Suggest&quot; to auto-detect matching fields</p>
 </div>
 )}

 {/* Add Manual Mapping */}
 <button
   onClick={() => setFmMappings(prev => [...prev, {
     id: crypto.randomUUID(), source_index: 0, target_index: 1,
     source_field: '', target_field: '', match_type: 'exact',
     confidence: 1.0, auto_suggested: false,
   }])}
   className="flex items-center gap-1.5 text-xs text-teal-400 hover:text-teal-300 transition-colors mb-4"
 >
   <Plus size={12} /> Add Manual Mapping
 </button>

 {fmError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2 mb-4">
 <AlertTriangle size={14} /> {fmError}
 </div>
 )}

 <div className="flex justify-end gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowFieldMappingConfig(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveFieldMappings} disabled={fmSaving}>
 {fmSaving ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Save Mappings
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Execution Config Modal */}
 {showExecutionConfig && (
 <Portal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowExecutionConfig(false)}>
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl shadow-xl p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <Activity className="w-5 h-5 text-orange-400" />
 <h3 className="text-lg font-semibold t-primary">Execution Mode</h3>
 </div>
 <button onClick={() => setShowExecutionConfig(false)} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
 </div>
 <p className="text-xs t-secondary mb-4">Configure how <span className="font-medium text-orange-400">{execSubName}</span> processes data</p>

 <div className="space-y-2 mb-4">
 {([
   { mode: 'reconciliation' as const, label: 'Reconciliation', desc: 'Match and compare records between two data sources', icon: <Link2 size={14} /> },
   { mode: 'validation' as const, label: 'Validation', desc: 'Check data quality and completeness in a single source', icon: <CheckCircle size={14} /> },
   { mode: 'compare' as const, label: 'Comparison', desc: 'Side-by-side comparison of record counts between sources', icon: <BarChart3 size={14} /> },
   { mode: 'extract' as const, label: 'Extract', desc: 'Pull and aggregate data from all configured sources', icon: <FileText size={14} /> },
   { mode: 'sync' as const, label: 'Sync', desc: 'Synchronize records between data sources', icon: <ArrowUpRight size={14} /> },
 ]).map(opt => (
   <button
     key={opt.mode}
     onClick={() => setExecMode(opt.mode)}
     className={`w-full flex items-start gap-3 p-3 rounded-lg border transition-colors text-left ${
       execMode === opt.mode
         ? 'bg-orange-500/10 border-orange-500/30 ring-1 ring-orange-500/20'
         : 'bg-[var(--bg-secondary)] border-[var(--border-card)] hover:border-orange-500/20'
     }`}
   >
     <div className={`mt-0.5 ${execMode === opt.mode ? 'text-orange-400' : 'text-gray-400'}`}>{opt.icon}</div>
     <div>
       <p className={`text-sm font-medium ${execMode === opt.mode ? 'text-orange-400' : 't-primary'}`}>{opt.label}</p>
       <p className="text-[10px] t-muted">{opt.desc}</p>
     </div>
   </button>
 ))}
 </div>

 {execCfgError && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2 mb-4">
 <AlertTriangle size={14} /> {execCfgError}
 </div>
 )}

 <div className="flex justify-end gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowExecutionConfig(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveExecutionConfig} disabled={execSaving}>
 {execSaving ? <Loader2 size={14} className="animate-spin" /> : <Activity size={14} />} Save Config
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Execution Result Modal */}
 {showExecResult && execResult && (
 <Portal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowExecResult(false)}>
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl shadow-xl p-6 w-full max-w-3xl max-h-[85vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <BarChart3 className={`w-5 h-5 ${execResult.status === 'completed' ? 'text-emerald-400' : execResult.status === 'partial' ? 'text-amber-400' : 'text-red-400'}`} />
 <h3 className="text-lg font-semibold t-primary">Execution Results</h3>
 <Badge variant={execResult.status === 'completed' ? 'success' : execResult.status === 'partial' ? 'warning' : 'danger'}>
   {execResult.status}
 </Badge>
 </div>
 <button onClick={() => setShowExecResult(false)} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
 </div>

 <div className="flex items-center gap-4 text-xs t-secondary mb-4">
 <span><span className="font-medium t-primary">{execResult.sub_catalyst}</span></span>
 <span>Mode: <span className="font-medium text-orange-400">{execResult.mode}</span></span>
 <span>Duration: <span className="font-medium t-primary">{execResult.duration_ms}ms</span></span>
 <span>At: <span className="font-medium t-primary">{new Date(execResult.executed_at).toLocaleString()}</span></span>
 </div>

 {execResult.error && (
 <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2 mb-4">
 <AlertTriangle size={14} /> {execResult.error}
 </div>
 )}

 {/* Summary Grid */}
 <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400 block">Source Records</span>
 <p className="text-lg font-bold t-primary">{execResult.summary.total_records_source}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-[10px] text-gray-400 block">Target Records</span>
 <p className="text-lg font-bold t-primary">{execResult.summary.total_records_target}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
 <span className="text-[10px] text-emerald-400 block">Matched</span>
 <p className="text-lg font-bold text-emerald-400">{execResult.summary.matched}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
 <span className="text-[10px] text-amber-400 block">Unmatched (Src)</span>
 <p className="text-lg font-bold text-amber-400">{execResult.summary.unmatched_source}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
 <span className="text-[10px] text-amber-400 block">Unmatched (Tgt)</span>
 <p className="text-lg font-bold text-amber-400">{execResult.summary.unmatched_target}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-red-500/5 border border-red-500/20">
 <span className="text-[10px] text-red-400 block">Discrepancies</span>
 <p className="text-lg font-bold text-red-400">{execResult.summary.discrepancies}</p>
 </div>
 </div>

 {/* Match Rate Progress */}
 {execResult.summary.total_records_source > 0 && (
 <div className="mb-4">
 <div className="flex items-center justify-between text-xs t-secondary mb-1">
 <span>Match Rate</span>
 <span className="font-medium">{((execResult.summary.matched / execResult.summary.total_records_source) * 100).toFixed(1)}%</span>
 </div>
 <Progress value={(execResult.summary.matched / execResult.summary.total_records_source) * 100} color={execResult.summary.matched / execResult.summary.total_records_source >= 0.9 ? 'emerald' : execResult.summary.matched / execResult.summary.total_records_source >= 0.7 ? 'blue' : 'amber'} size="sm" />
 </div>
 )}

 {/* Discrepancy Details */}
 {execResult.discrepancies && execResult.discrepancies.length > 0 && (
 <div>
 <h4 className="text-sm font-semibold t-primary mb-2 flex items-center gap-1.5">
 <AlertCircle size={14} className="text-red-400" /> Discrepancy Details ({execResult.discrepancies.length})
 </h4>
 <div className="max-h-60 overflow-y-auto space-y-1">
 {execResult.discrepancies.map((d, i) => (
 <div key={i} className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs">
 <div className="flex items-center justify-between">
 <span className="font-medium t-primary">{d.field}</span>
 {d.difference && <span className="text-red-400 text-[10px]">{d.difference}</span>}
 </div>
 <div className="flex gap-4 mt-1 text-[10px]">
 <span className="t-secondary">Source: <span className="t-primary">{String(d.source_value ?? 'null')}</span></span>
 <span className="t-secondary">Target: <span className="t-primary">{String(d.target_value ?? 'null')}</span></span>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}

 <div className="flex justify-end pt-4">
 <Button variant="secondary" size="sm" onClick={() => setShowExecResult(false)}>Close</Button>
 </div>
 </div>
 </div></Portal>
 )}
 </div>
 );
}
