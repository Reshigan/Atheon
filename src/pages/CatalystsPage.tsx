import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { LoadingState } from "@/components/ui/state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import type { ClusterItem, ActionItem, GovernanceData, SubCatalyst, DataSourceConfig, DataSourceType, ERPConnection, ExecutionLogEntry, FieldMapping, ExecutionConfig, ExecutionResult, HitlConfigListItem, IAMUser, RunAnalytics, RunAnalyticsAggregate, CatalystIntelligenceOverview, ROITrackingResponse, CatalystPrescriptionItem, SuccessStoriesResponse } from "@/lib/api";
import { SuccessStoryCard } from "@/components/ui/success-story-card";
import { HeroHeader } from "@/components/ui/hero-header";
import { StatusPill } from "@/components/ui/status-pill";
import {
 Zap, Bot, Shield, CheckCircle, Clock, XCircle, Eye, Wrench, Send,
 ChevronDown, ChevronUp, Loader2, Upload, Calendar, AlertTriangle,
 Play, X, FileText, Plus, Settings, Database, Mail, Cloud, HardDrive, Trash2, AlertCircle,
 ScrollText, ArrowUpRight, MessageSquare, Cog, Link2, Sparkles, BarChart3, Activity, Users,
 Brain, TrendingUp, TrendingDown, GitBranch, RefreshCw, Target, MoreHorizontal
} from "lucide-react";
import type { AutonomyTier } from "@/types";
import { useAppStore, useSelectedCompanyId } from "@/stores/appStore";
import { SubCatalystOpsPanel } from "@/components/SubCatalystOpsPanel";
import { CSVExportButton } from "@/components/common/CSVExportButton";
import { SectionFreshness } from "@/components/common/FreshnessIndicator";

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
 const companyId = useSelectedCompanyId();
 const toast = useToast();
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

 // Sub-Catalyst Ops Panel state
 const [opsPanel, setOpsPanel] = useState<{ clusterId: string; clusterName: string; subName: string } | null>(null);
  // Overflow menu state for sub-catalyst action buttons
 const [overflowMenu, setOverflowMenu] = useState<string | null>(null);
 const overflowRef = useRef<HTMLDivElement>(null);

 // Click-outside handler to dismiss overflow menu
 useEffect(() => {
   if (!overflowMenu) return;
   const handler = (e: MouseEvent) => {
     if (overflowRef.current && !overflowRef.current.contains(e.target as Node)) setOverflowMenu(null);
   };
   document.addEventListener('mousedown', handler);
   return () => document.removeEventListener('mousedown', handler);
 }, [overflowMenu]);

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
 const a = await api.catalysts.actions(undefined, undefined, undefined, companyId || undefined);
 setActions(a.actions);
 setTimeout(() => {
 setShowQuickRun(false);
 setQuickRunSuccess(null);
 }, 2000);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Execution failed';
 setQuickRunError(message);
 toast.error('Quick run failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setQuickRunning(false);
 };

 const [actionError, setActionError] = useState<string | null>(null);

 const handleApprove = async (actionId: string) => {
 if (updatingAction) return;
 setUpdatingAction(actionId);
 setActionError(null);
 try {
 await api.catalysts.approveAction(actionId);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const a = await api.catalysts.actions(undefined, undefined, ind, companyId || undefined);
 setActions(a.actions);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Failed to approve action';
 setActionError(message);
 toast.error('Approval failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setUpdatingAction(null);
 };

 const handleReject = async (actionId: string) => {
 if (updatingAction) return;
 setUpdatingAction(actionId);
 setActionError(null);
 try {
 await api.catalysts.rejectAction(actionId);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const a = await api.catalysts.actions(undefined, undefined, ind, companyId || undefined);
 setActions(a.actions);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Failed to reject action';
 setActionError(message);
 toast.error('Rejection failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
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
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const a = await api.catalysts.actions(undefined, undefined, ind, companyId || undefined);
 setActions(a.actions);
 setTimeout(() => {
 setShowManualExec(false);
 setManualForm({ cluster_id: '', catalyst_name: '', action: '', start_datetime: '', end_datetime: '', reasoning: '' });
 setManualFile(null);
 setExecSuccess(null);
 }, 2000);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Execution failed';
 setExecError(message);
 toast.error('Manual execution failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setExecuting(false);
 };

 // Industry filter removed — Catalysts page always shows all functional areas
 const [togglingSubCatalyst, setTogglingSubCatalyst] = useState<string | null>(null);

  // Currently selected sub-catalyst for configuration
 const [configSub, setConfigSub] = useState<SubCatalyst | null>(null);
 const [configClusterId, setConfigClusterId] = useState('');

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
 setConfigSub(sub);
 setConfigClusterId(clusterId);
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
  } catch (err) {
  console.error('Failed to load ERP connections', err);
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
 // Try plural endpoint first; fall back to singular for backward compat
 try {
   await api.catalysts.setDataSources(dsClusterId, dsSubName, dsSources);
 } catch (pluralErr) {
   const msg = pluralErr instanceof Error ? pluralErr.message : '';
   if (msg === 'Not found' || msg === 'Not Found') {
     // Plural endpoint not available — save first source via singular endpoint
     await api.catalysts.setDataSource(dsClusterId, dsSubName, dsSources[0]);
   } else {
     throw pluralErr;
   }
 }
 }
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
 setClusters(c.clusters);
 setShowDataSourceConfig(false);
 } catch (err) {
 setDsError(err instanceof Error ? err.message : 'Failed to remove data sources');
 }
 setDsSaving(false);
 };

 // A4-1: URL parameter drill-through — open ops panel from Pulse/Apex source links
 useEffect(() => {
 const params = new URLSearchParams(window.location.search);
 const clusterParam = params.get('cluster');
 const subParam = params.get('sub');
 const opsParam = params.get('ops');
 if (clusterParam && subParam && opsParam === '1') {
  // Find cluster name from ID (will be set after clusters load)
  setOpsPanel({ clusterId: clusterParam, clusterName: clusterParam, subName: subParam });
  // Clean URL params without reload
  window.history.replaceState({}, '', window.location.pathname);
 }
 }, []);

 useEffect(() => {
 async function load() {
 setLoading(true);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const co = companyId || undefined;
 const [c, a, g] = await Promise.allSettled([
 api.catalysts.clusters(undefined, ind, co), api.catalysts.actions(undefined, undefined, ind, co), api.catalysts.governance(undefined, ind, co),
 ]);
 if (c.status === 'fulfilled') {
  setClusters(c.value.clusters);
 } else if (c.status === 'rejected') {
  const err = c.reason;
  toast.error('Failed to load catalyst clusters', {
    message: err instanceof Error ? err.message : 'Unknown error',
    requestId: err instanceof ApiError ? err.requestId : null,
  });
 }
 if (a.status === 'fulfilled') setActions(a.value.actions);
 else if (a.status === 'rejected') {
  const err = a.reason;
  toast.error('Failed to load catalyst actions', {
    message: err instanceof Error ? err.message : 'Unknown error',
    requestId: err instanceof ApiError ? err.requestId : null,
  });
 }
 if (g.status === 'fulfilled') setGovernance(g.value);
 setLoading(false);
 }
 load();
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [companyId]); // Reload when selected company scope changes

 // A4-1: Resolve ops panel cluster name once clusters are loaded
 useEffect(() => {
   if (opsPanel && clusters.length > 0 && opsPanel.clusterName === opsPanel.clusterId) {
     const cluster = clusters.find((cl: ClusterItem) => cl.id === opsPanel.clusterId);
     if (cluster) {
       setOpsPanel({ ...opsPanel, clusterName: cluster.name });
     }
   }
 }, [opsPanel, clusters]);

 // Deep-link from Pulse anomalies / Apex risks: ?cluster=Foo&sub=Bar opens
 // the SubCatalystOpsPanel for that pairing as soon as clusters are loaded.
 // Falls back to a toast if the cluster name doesn't resolve (e.g. stale
 // catalog entry on the recommendation side). The query string is consumed
 // (cleared) after handling so a back-navigation doesn't keep re-firing.
 const [searchParams, setSearchParams] = useSearchParams();
 useEffect(() => {
   const wantedCluster = searchParams.get('cluster');
   const wantedSub = searchParams.get('sub');
   if (!wantedCluster || clusters.length === 0) return;
   const cluster = clusters.find(c => c.name.toLowerCase() === wantedCluster.toLowerCase());
   if (cluster) {
     const sub = wantedSub
       ? cluster.subCatalysts?.find(s => s.name.toLowerCase() === wantedSub.toLowerCase())
       : cluster.subCatalysts?.[0];
     if (sub) {
       setOpsPanel({ clusterId: cluster.id, clusterName: cluster.name, subName: sub.name });
     }
   } else {
     toast.error('Catalyst not found', {
       message: `No catalyst named "${wantedCluster}" — opening the catalogue.`,
     });
   }
   // Clear the consumed params so re-renders don't re-trigger the effect.
   const next = new URLSearchParams(searchParams);
   next.delete('cluster');
   next.delete('sub');
   setSearchParams(next, { replace: true });
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [clusters]);

 const handleToggleSubCatalyst = async (clusterId: string, subName: string) => {
 const key = `${clusterId}:${subName}`;
 if (togglingSubCatalyst) return;
 setTogglingSubCatalyst(key);
 try {
 await api.catalysts.toggleSubCatalyst(clusterId, subName);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
 setClusters(c.clusters);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Failed to toggle sub-catalyst';
 setActionError(message);
 toast.error('Toggle failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setTogglingSubCatalyst(null);
 };


 // Catalyst Intelligence state
 const [intellOverview, setIntellOverview] = useState<CatalystIntelligenceOverview | null>(null);
 const [intellLoading, setIntellLoading] = useState(false);
 const [expandedPattern, setExpandedPattern] = useState<string | null>(null);

 // §11.6 Success Stories state
 const [successStories, setSuccessStories] = useState<SuccessStoriesResponse | null>(null);
 const [storiesLoading, setStoriesLoading] = useState(false);
 const [roiData, setRoiData] = useState<ROITrackingResponse | null>(null);
 const [prescriptions, setPrescriptions] = useState<CatalystPrescriptionItem[]>([]);

 const loadSuccessStories = async () => {
   setStoriesLoading(true);
   try {
     const res = await api.successStories.get();
     setSuccessStories(res);
   } catch (err) {
     console.error('Failed to load success stories', err);
     toast.error('Failed to load peer insights', {
       message: err instanceof Error ? err.message : 'Unknown error',
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
   setStoriesLoading(false);
 };

 const loadIntelligence = async () => {
   setIntellLoading(true);
   try {
     const [overview, roiRes, rxRes] = await Promise.allSettled([
       api.catalystIntelligence.getOverview(),
       api.roi.get(),
       api.catalystIntelligence.getPrescriptions(undefined, undefined),
     ]);
     if (overview.status === 'fulfilled') setIntellOverview(overview.value);
     else if (overview.status === 'rejected') {
       const err = overview.reason;
       toast.error('Failed to load catalyst intelligence', {
         message: err instanceof Error ? err.message : 'Unknown error',
         requestId: err instanceof ApiError ? err.requestId : null,
       });
     }
     if (roiRes.status === 'fulfilled') setRoiData(roiRes.value);
     if (rxRes.status === 'fulfilled') setPrescriptions(rxRes.value.prescriptions ?? []);
   } catch (err) { console.error('Failed to load intelligence:', err); }
   setIntellLoading(false);
 };

 const handleDiscoverPatterns = async () => {
   try {
     await api.catalystIntelligence.analyse();
     loadIntelligence();
   } catch (err) {
     console.error('Failed to discover patterns:', err);
     toast.error('Pattern discovery failed', {
       message: err instanceof Error ? err.message : 'Unknown error',
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
 };

 const handleDiscoverDependencies = async () => {
   try {
     await api.catalystIntelligence.discoverDependencies();
     loadIntelligence();
   } catch (err) {
     console.error('Failed to discover dependencies:', err);
     toast.error('Dependency mapping failed', {
       message: err instanceof Error ? err.message : 'Unknown error',
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
 };

 // HITL Permissions state
 const [hitlConfigs, setHitlConfigs] = useState<HitlConfigListItem[]>([]); 
 const [hitlUsers, setHitlUsers] = useState<IAMUser[]>([]);
 const [hitlUsersMap, setHitlUsersMap] = useState<Record<string, { email: string; name: string }>>({});
 const [hitlLoading, setHitlLoading] = useState(false);
 const [hitlSaving, setHitlSaving] = useState(false);
 const [hitlError, setHitlError] = useState<string | null>(null);
 const [hitlEditCluster, setHitlEditCluster] = useState('');
 const [hitlEditSub, setHitlEditSub] = useState('');
 const [hitlValidators, setHitlValidators] = useState<string[]>([]);
 const [hitlExceptionHandlers, setHitlExceptionHandlers] = useState<string[]>([]);
 const [hitlEscalation, setHitlEscalation] = useState<string[]>([]);
 const [hitlNotifyCompletion, setHitlNotifyCompletion] = useState(false);
 const [hitlNotifyException, setHitlNotifyException] = useState(true);
 const [hitlNotifyApproval, setHitlNotifyApproval] = useState(true);
 const [showHitlModal, setShowHitlModal] = useState(false);

 // Run Analytics state
 const [runAnalytics, setRunAnalytics] = useState<RunAnalytics[]>([]);
 const [runAggregate, setRunAggregate] = useState<RunAnalyticsAggregate | null>(null);
 const [analyticsLoading, setAnalyticsLoading] = useState(false);
 const [analyticsCluster, setAnalyticsCluster] = useState('all');
 const [expandedAnalyticsRun, setExpandedAnalyticsRun] = useState<string | null>(null);
 const [runDetailActions, setRunDetailActions] = useState<Record<string, Array<{ id: string; action: string; status: string; confidence: number; assignedTo?: string; processingTimeMs?: number; createdAt: string }>>>({});
 const [runDetailLoading, setRunDetailLoading] = useState<string | null>(null);

 const loadHitlConfigs = async () => {
   setHitlLoading(true);
   try {
     const [configRes, usersRes] = await Promise.allSettled([
       api.catalysts.hitlConfig(),
       api.iam.users(),
     ]);
     if (configRes.status === 'fulfilled') {
       setHitlConfigs(configRes.value.configs || []);
       if (configRes.value.users) setHitlUsersMap(configRes.value.users);
     } else if (configRes.status === 'rejected') {
       const err = configRes.reason;
       toast.error('Failed to load review assignments', {
         message: err instanceof Error ? err.message : 'Unknown error',
         requestId: err instanceof ApiError ? err.requestId : null,
       });
     }
     if (usersRes.status === 'fulfilled') setHitlUsers(usersRes.value.users);
    } catch (err) { console.error('Failed to load HITL configs', err); }
    setHitlLoading(false);
 };

 const loadRunAnalytics = async () => {
   setAnalyticsLoading(true);
   try {
     const clusterParam = analyticsCluster !== 'all' ? analyticsCluster : undefined;
     const res = await api.catalysts.runAnalytics(clusterParam, undefined, 50);
     setRunAnalytics(res.runs);
     setRunAggregate(res.aggregate);
    } catch (err) {
     console.error('Failed to load run analytics', err);
     toast.error('Failed to load run analytics', {
       message: err instanceof Error ? err.message : 'Unknown error',
       requestId: err instanceof ApiError ? err.requestId : null,
     });
    }
    setAnalyticsLoading(false);
 };

 const openHitlEdit = (clusterId: string, subName: string) => {
   setHitlEditCluster(clusterId);
   setHitlEditSub(subName);
   const existing = hitlConfigs.find(c => c.clusterId === clusterId && (c.subCatalystName || '') === subName);
   if (existing) {
     setHitlValidators(existing.validatorUserIds || []);
     setHitlExceptionHandlers(existing.exceptionHandlerUserIds || []);
     setHitlEscalation(existing.escalationUserIds || []);
     setHitlNotifyCompletion(existing.notifyOnCompletion);
     setHitlNotifyException(existing.notifyOnException);
     setHitlNotifyApproval(existing.notifyOnApprovalNeeded);
   } else {
     setHitlValidators([]);
     setHitlExceptionHandlers([]);
     setHitlEscalation([]);
     setHitlNotifyCompletion(false);
     setHitlNotifyException(true);
     setHitlNotifyApproval(true);
   }
   setHitlError(null);
   setShowHitlModal(true);
 };

 const handleSaveHitl = async () => {
   if (hitlSaving) return;
   setHitlSaving(true);
   setHitlError(null);
   try {
     const cluster = clusters.find(c => c.id === hitlEditCluster);
     await api.catalysts.saveHitlConfig({
       cluster_id: hitlEditCluster,
       sub_catalyst_name: hitlEditSub || undefined,
       domain: cluster?.domain || 'general',
       validator_user_ids: hitlValidators,
       exception_handler_user_ids: hitlExceptionHandlers,
       escalation_user_ids: hitlEscalation,
       notify_on_completion: hitlNotifyCompletion,
       notify_on_exception: hitlNotifyException,
       notify_on_approval_needed: hitlNotifyApproval,
     });
     await loadHitlConfigs();
     setShowHitlModal(false);
   } catch (err) {
     setHitlError(err instanceof Error ? err.message : 'Failed to save HITL config');
   }
   setHitlSaving(false);
 };

 const handleDeleteHitl = async (clusterId: string, subName?: string) => {
   if (!confirm('Remove this HITL configuration?')) return;
   try {
     await api.catalysts.deleteHitlConfig(clusterId, subName || undefined);
     await loadHitlConfigs();
   } catch (err) {
     console.error('Failed to delete HITL config', err);
     toast.error('Failed to delete assignment', {
       message: err instanceof Error ? err.message : 'Unknown error',
       requestId: err instanceof ApiError ? err.requestId : null,
     });
   }
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
     const ind = undefined; // Catalysts page shows all functional areas regardless of industry
     const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
     const ind = undefined; // Catalysts page shows all functional areas regardless of industry
     const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
     const ind = undefined; // Catalysts page shows all functional areas regardless of industry
     const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
     const ind = undefined; // Catalysts page shows all functional areas regardless of industry
     const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
     const result = await api.catalysts.executeSubCatalyst(clusterId, subName, undefined, companyId || undefined);
     setExecResult(result);
     setShowExecResult(true);
     // Refresh clusters to get updated last_execution
     const ind = undefined; // Catalysts page shows all functional areas regardless of industry
     const c = await api.catalysts.clusters(undefined, ind, companyId || undefined);
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
 } catch (err) {
 console.error('Failed to load execution logs', err);
 setExecutionLogs([]);
 toast.error('Failed to load execution logs', {
 message: err instanceof Error ? err.message : 'Unknown error',
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setLogsLoading(false);
 };

 const handleResolveException = async (actionId: string) => {
 setResolvingAction(actionId);
 try {
 await api.catalysts.resolveException(actionId, (activeNotesAction === actionId ? resolveNotes : '') || undefined);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const a = await api.catalysts.actions(undefined, undefined, ind, companyId || undefined);
 setActions(a.actions);
 setResolveNotes('');
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Failed to resolve exception';
 setActionError(message);
 toast.error('Resolve exception failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setResolvingAction(null);
 };

 const handleEscalateException = async (actionId: string) => {
 setEscalatingAction(actionId);
 try {
 await api.catalysts.escalateException(actionId);
 const ind = undefined; // Catalysts page shows all functional areas regardless of industry
 const a = await api.catalysts.actions(undefined, undefined, ind, companyId || undefined);
 setActions(a.actions);
 } catch (err) {
 const message = err instanceof Error ? err.message : 'Failed to escalate exception';
 setActionError(message);
 toast.error('Escalate exception failed', {
 message,
 requestId: err instanceof ApiError ? err.requestId : null,
 });
 }
 setEscalatingAction(null);
 };


 useEffect(() => {
   if (activeTab === 'hitl-permissions') loadHitlConfigs();
   if (activeTab === 'run-analytics') loadRunAnalytics();
   if (activeTab === 'intelligence' && !intellOverview && !intellLoading) loadIntelligence();
   if (activeTab === 'success-stories' && !successStories && !storiesLoading) loadSuccessStories();
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeTab, analyticsCluster]);

 // Auto-load execution logs when tab is activated
 useEffect(() => {
 if (activeTab === 'execution-logs') {
 loadExecutionLogs(selectedLogAction || undefined);
 }
 // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [activeTab]);

 const tabs = [
 { id: 'clusters', label: 'Catalyst Clusters', icon: <Bot size={14} /> },
 { id: 'intelligence', label: 'Intelligence', icon: <Brain size={14} />, count: intellOverview?.summary?.criticalPatterns || undefined },
 { id: 'success-stories', label: 'Peer Insights', icon: <Sparkles size={14} />, count: successStories?.stories?.length || undefined },
 { id: 'actions', label: 'Action Log', icon: <Zap size={14} />, count: actions.length },
 { id: 'execution-logs', label: 'Execution Logs', icon: <ScrollText size={14} /> },
 { id: 'exceptions', label: 'Exceptions', icon: <AlertTriangle size={14} />, count: exceptionCount },
  ...(isAdmin ? [{ id: 'hitl-permissions', label: 'Review Assignments', icon: <Users size={14} /> }] : []),
  { id: 'run-analytics', label: 'Run Analytics', icon: <BarChart3 size={14} /> },
  ...(isAdmin ? [{ id: 'governance', label: 'Governance', icon: <Shield size={14} /> }] : []),
 ];

 if (loading) return <LoadingState variant="cards" count={6} />;

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
 <span className="text-caption text-gray-500">{key.replace(/_/g, ' ')}</span>
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
 <div className="space-y-4 flex-1">
 <HeroHeader
  icon={Zap}
  title="Catalysts"
  subtitle="Autonomous Execution & Catalyst Orchestration"
  accent="bronze"
  trailing={<SectionFreshness section="Catalyst Runs" />}
 />
  <div className="flex items-center gap-2 flex-shrink-0">
 <CSVExportButton endpoint="/api/catalyst-intelligence/patterns" filename="catalyst-patterns.csv" label="Export Patterns" />
 <CSVExportButton endpoint="/api/roi" filename="roi-tracking.csv" label="Export ROI" />
 </div>
 </div>
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


 <Tabs tabs={tabs}activeTab={activeTab} onTabChange={setActiveTab} />

 {activeTab === 'clusters' && (
 <TabPanel>
 {/* Cluster cards — the canonical entry point for running / configuring
     sub-catalysts. The TASK-002 3-up grid (ClusterList / SubCatalystPanel
     / ExecutionHistory) that used to live above duplicated everything on
     these cards, so we removed it per user request 2026-05-12. The
     decomposed sub-components are kept in /pages/catalysts/* for future
     use (e.g. a dedicated /pages/catalysts/list page) — they aren't
     deleted, just unrendered here. */}
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
 <span className="text-caption t-muted">Trust Score</span>
 <p className="text-sm font-bold t-primary">{Number(cluster.trustScore).toFixed(1)}%</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption t-muted">Agents</span>
 <p className="text-sm font-bold t-primary">{cluster.agentCount}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption t-muted">Completed</span>
 <p className="text-sm font-bold t-primary">{(cluster.tasksCompleted / 1000).toFixed(1)}K</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption t-muted">Success Rate</span>
 <p className="text-sm font-bold text-emerald-400">{Number(cluster.successRate).toFixed(1)}%</p>
 </div>
 </div>

 <div className="mt-3">
 <div className="flex items-center justify-between text-caption t-muted mb-1">
 <span>Trust Score</span>
 <span>{Number(cluster.trustScore).toFixed(1)}%</span>
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
 <div key={sub.name} className={`p-2.5 rounded-lg border space-y-1.5 ${sub.enabled ? 'bg-emerald-500/5 border-emerald-500/20' : 'bg-gray-500/5 border-gray-500/20 opacity-60'}`}>
 {/* Row 1: Name + Toggle */}
 <div className="flex items-center justify-between gap-2">
 <div className="flex items-center gap-2 min-w-0">
 <div className={`w-2 h-2 rounded-full flex-shrink-0 ${sub.enabled ? 'bg-emerald-400' : 'bg-gray-400'}`} />
 <span className="text-xs font-medium t-primary truncate">{sub.name}</span>
 </div>
 {isAdmin && (
 <button
 onClick={(e) => { e.stopPropagation(); handleToggleSubCatalyst(cluster.id, sub.name); }}
 disabled={togglingSubCatalyst === `${cluster.id}:${sub.name}`}
 className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${sub.enabled ? 'bg-emerald-500' : 'bg-gray-400'} ${togglingSubCatalyst === `${cluster.id}:${sub.name}` ? 'opacity-50' : ''}`}
 title={sub.enabled ? 'Disable this sub-catalyst' : 'Enable this sub-catalyst'}
 >
 <span className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${sub.enabled ? 'translate-x-4' : 'translate-x-0'}`} />
 </button>
 )}
 </div>
 {/* Row 2: Description (optional) */}
 {sub.description && <p className="text-caption t-secondary truncate pl-4">{sub.description}</p>}
 {/* Row 3: Status badges — data sources, schedule, last execution */}
 {(getSubDataSources(sub).length > 0 || (sub.schedule && sub.schedule.frequency !== 'manual') || sub.last_execution) && (
 <div className="flex items-center gap-1.5 flex-wrap pl-4">
 {getSubDataSources(sub).map((ds, dsIdx) => (
 <span key={dsIdx} className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption font-medium ${
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
 {sub.schedule && sub.schedule.frequency !== 'manual' && (
 <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption font-medium bg-indigo-500/10 text-indigo-400 border border-indigo-500/20" title={sub.schedule.next_run ? `Next run: ${new Date(sub.schedule.next_run).toLocaleString()}` : ''}>
 <Calendar size={8} />
 {sub.schedule.frequency === 'daily' ? 'Daily' : sub.schedule.frequency === 'weekly' ? 'Weekly' : 'Monthly'}
 {sub.schedule.time_of_day ? ` ${sub.schedule.time_of_day}` : ''}
 </span>
 )}
 {sub.last_execution && (
 <button
 onClick={(e) => { e.stopPropagation(); setExecResult(sub.last_execution as ExecutionResult); setShowExecResult(true); }}
 className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-caption font-medium ${
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
 </div>
 )}
  {/* Row 4: Action buttons — 2 buttons + overflow menu per UI cleanup */}
 <div className="flex items-center gap-1 pl-4">
 {sub.enabled && (
 <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={(e) => { e.stopPropagation(); if (getSubDataSources(sub).length >= 2 && sub.field_mappings && sub.field_mappings.length > 0) { handleExecuteSubCatalyst(cluster.id, sub.name); } else { openQuickRun(cluster.id, cluster.name, sub.name); } }} disabled={subExecuting === `${cluster.id}:${sub.name}`} title="Run this sub-catalyst">
 {subExecuting === `${cluster.id}:${sub.name}` ? <Loader2 size={10} className="mr-1 animate-spin" /> : <Play size={10} className="mr-1" />} Run
 </Button>
 )}
 <Button size="sm" variant="ghost" className="h-7 px-3 text-xs" onClick={(e) => { e.stopPropagation(); setOpsPanel({ clusterId: cluster.id, clusterName: cluster.name, subName: sub.name }); }} title="View operations dashboard">
 <BarChart3 size={10} className="mr-1 text-accent" /> Ops
 </Button>
  <div className="relative" ref={overflowRef}>
 <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={(e) => { e.stopPropagation(); setOverflowMenu(overflowMenu === `${cluster.id}:${sub.name}` ? null : `${cluster.id}:${sub.name}`); }} title="More actions">
 <MoreHorizontal size={14} />
 </Button>
 {overflowMenu === `${cluster.id}:${sub.name}` && (
 <div className="absolute right-0 top-full mt-1 z-50 w-48 rounded-lg border border-[var(--border-card)] bg-[var(--bg-primary)] shadow-lg py-1">
 {isAdmin && <button className="w-full text-left px-3 py-1.5 text-xs t-secondary hover:bg-[var(--bg-secondary)] flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setOverflowMenu(null); openDataSourceConfig(cluster.id, sub); }}><Database size={10} /> Configure Data Sources</button>}
  {isAdmin && <button className="w-full text-left px-3 py-1.5 text-xs t-secondary hover:bg-[var(--bg-secondary)] flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setOverflowMenu(null); openScheduleConfig(cluster.id, sub); }}><Calendar size={10} /> Set Schedule</button>}
 {isAdmin && <button className="w-full text-left px-3 py-1.5 text-xs t-secondary hover:bg-[var(--bg-secondary)] flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setOverflowMenu(null); openFieldMappingConfig(cluster.id, sub); }}><Link2 size={10} /> Field Mappings</button>}
 {isAdmin && <button className="w-full text-left px-3 py-1.5 text-xs t-secondary hover:bg-[var(--bg-secondary)] flex items-center gap-2" onClick={(e) => { e.stopPropagation(); setOverflowMenu(null); openExecutionConfig(cluster.id, sub); }}><Cog size={10} /> Execution Mode</button>}
 </div>
 )}
 </div>
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
 <div className="flex items-center gap-3 py-6 px-4"><Zap size={16} className="t-muted opacity-40 flex-shrink-0" /><p className="text-sm t-muted">No catalyst actions yet</p></div>
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
 <Button variant="secondary" size="sm" onClick={() => loadExecutionLogs(selectedLogAction || undefined)} disabled={logsLoading}>
 {logsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
 </Button>
 </div>
 </div>

 {logsLoading && (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {!logsLoading && executionLogs.length === 0 && (
  <div className="flex items-center gap-3 py-6 px-4">
 <ScrollText size={16} className="t-muted opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No execution logs yet</p>
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
 <span className="text-caption t-muted flex-shrink-0">{log.durationMs}ms</span>
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
  <div className="flex items-center gap-3 py-6 px-4">
 <CheckCircle size={16} className="text-emerald-500 opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No exceptions — all clear</p>
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
  <StatusPill status={exSeverity} size="sm" />
  )}
  </div>
  <p className="text-xs text-red-500/80">{exDetail}</p>
  {exSummary && (
  <div className="mt-2 grid grid-cols-3 sm:grid-cols-6 gap-2 text-caption">
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
    <div key={i} className="text-caption p-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
      <span className="font-medium t-primary">{d.field || 'field'}</span>: source=<span className="text-emerald-600">{typeof d.source_value === 'number' ? Number(d.source_value).toFixed(2) : String(d.source_value || '—')}</span> vs target=<span className="text-red-500">{typeof d.target_value === 'number' ? Number(d.target_value).toFixed(2) : String(d.target_value || '—')}</span>
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

 {activeTab === 'hitl-permissions' && (
 <TabPanel>
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <Users size={18} className="text-accent" /> Review Assignments
 </h3>
 <p className="text-xs t-muted">{hitlConfigs.length} configuration{hitlConfigs.length !== 1 ? 's' : ''} active</p>
 </div>

 {hitlLoading && (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {!hitlLoading && clusters.length > 0 && (
 <div className="space-y-4">
 {clusters.map(cluster => {
   const clusterConfigs = hitlConfigs.filter(c => c.clusterId === cluster.id);
   const clusterLevelConfig = clusterConfigs.find(c => !c.subCatalystName);
   return (
   <Card key={cluster.id}>
   <div className="flex items-center justify-between mb-3">
     <div className="flex items-center gap-2">
       <Bot size={16} className="text-accent" />
       <h4 className="text-sm font-semibold t-primary">{cluster.name}</h4>
       <Badge variant="outline" size="sm">{cluster.domain}</Badge>
     </div>
     <Button variant="secondary" size="sm" onClick={() => openHitlEdit(cluster.id, '')}>
       <Settings size={12} /> {clusterLevelConfig ? 'Edit' : 'Configure'} Cluster Default
     </Button>
   </div>

   {clusterLevelConfig && (
   <div className="p-3 rounded-lg bg-accent/5 border border-accent/20 mb-3">
     <p className="text-label mb-2">Cluster Default Assignments</p>
     <div className="grid grid-cols-3 gap-3 text-xs">
       <div>
         <span className="text-emerald-400 font-medium">Validators:</span>
         <p className="t-secondary mt-0.5">{clusterLevelConfig.validatorUserIds.length > 0 ? clusterLevelConfig.validatorUserIds.map(id => hitlUsersMap[id]?.email || id).join(', ') : 'None'}</p>
       </div>
       <div>
         <span className="text-amber-400 font-medium">Exception Handlers:</span>
         <p className="t-secondary mt-0.5">{clusterLevelConfig.exceptionHandlerUserIds.length > 0 ? clusterLevelConfig.exceptionHandlerUserIds.map(id => hitlUsersMap[id]?.email || id).join(', ') : 'None'}</p>
       </div>
       <div>
         <span className="text-red-400 font-medium">Escalation:</span>
         <p className="t-secondary mt-0.5">{clusterLevelConfig.escalationUserIds.length > 0 ? clusterLevelConfig.escalationUserIds.map(id => hitlUsersMap[id]?.email || id).join(', ') : 'None'}</p>
       </div>
     </div>
   </div>
   )}

   {cluster.subCatalysts && cluster.subCatalysts.length > 0 && (
   <div className="space-y-2">
     <p className="text-label">Sub-Catalyst Overrides</p>
     {cluster.subCatalysts.map((sub: SubCatalyst) => {
       const subConfig = clusterConfigs.find(c => c.subCatalystName === sub.name);
       return (
       <div key={sub.name} className="flex items-center justify-between p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
         <div className="flex items-center gap-2 min-w-0">
           <div className={`w-2 h-2 rounded-full ${sub.enabled ? 'bg-emerald-400' : 'bg-gray-400'}`} />
           <span className="text-xs font-medium t-primary truncate">{sub.name}</span>
           {subConfig && <Badge variant="success" size="sm">Custom</Badge>}
         </div>
         <div className="flex items-center gap-2">
           {subConfig && (
             <button onClick={() => handleDeleteHitl(cluster.id, sub.name)} className="text-xs text-red-400 hover:text-red-300">
               <Trash2 size={12} />
             </button>
           )}
           <Button variant="secondary" size="sm" onClick={() => openHitlEdit(cluster.id, sub.name)}>
             <Users size={10} /> {subConfig ? 'Edit' : 'Assign'}
           </Button>
         </div>
       </div>
       );
     })}
   </div>
   )}
   </Card>
   );
 })}
 </div>
 )}

 {!hitlLoading && clusters.length === 0 && (
  <div className="flex items-center gap-3 py-6 px-4">
 <Users size={16} className="t-muted opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No catalyst clusters configured</p>
 </div>
 )}
 </div>
 </TabPanel>
 )}

 {activeTab === 'run-analytics' && (
 <TabPanel>
 <div className="space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary flex items-center gap-2">
 <BarChart3 size={18} className="text-accent" /> Run Analytics & Insights
 </h3>
 <div className="flex items-center gap-2">
   <select
     className="px-3 py-1.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-xs t-primary"
     value={analyticsCluster}
     onChange={e => setAnalyticsCluster(e.target.value)}
   >
     <option value="all">All Clusters</option>
     {clusters.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
   </select>
   <Button variant="secondary" size="sm" onClick={loadRunAnalytics} disabled={analyticsLoading}>
     {analyticsLoading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />} Refresh
   </Button>
 </div>
 </div>

 {analyticsLoading && (
 <div className="flex items-center justify-center py-8">
 <Loader2 className="w-6 h-6 text-accent animate-spin" />
 </div>
 )}

 {!analyticsLoading && runAggregate && (
 <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
   <Card variant="black"><div className="text-center"><p className="text-label">Total Runs</p><p className="text-xl font-bold t-primary mt-1">{runAggregate.totalRuns}</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Items Processed</p><p className="text-xl font-bold t-primary mt-1">{runAggregate.totalItems}</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Completed</p><p className="text-xl font-bold text-emerald-400 mt-1">{runAggregate.totalCompleted}</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Exceptions</p><p className="text-xl font-bold text-red-400 mt-1">{runAggregate.totalExceptions}</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Escalated</p><p className="text-xl font-bold text-amber-400 mt-1">{runAggregate.totalEscalated}</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Avg Confidence</p><p className="text-xl font-bold text-blue-400 mt-1">{(runAggregate.avgConfidence * 100).toFixed(0)}%</p></div></Card>
   <Card variant="black"><div className="text-center"><p className="text-label">Automation Rate</p><p className="text-xl font-bold text-accent mt-1">{(runAggregate.automationRate * 100).toFixed(0)}%</p></div></Card>
 </div>
 )}

 {!analyticsLoading && runAnalytics.length === 0 && (
  <div className="flex items-center gap-3 py-6 px-4">
 <BarChart3 size={16} className="t-muted opacity-40 flex-shrink-0" />
 <p className="text-sm t-muted">No run analytics yet</p>
 </div>
 )}

 {!analyticsLoading && runAnalytics.length > 0 && (
 <div className="space-y-3">
 {runAnalytics.map(run => {
   const isExp = expandedAnalyticsRun === run.id;
   return (
   <Card key={run.id} hover onClick={() => setExpandedAnalyticsRun(isExp ? null : run.id)} className={isExp ? 'border-accent/20' : ''}>
   <div className="flex items-start justify-between">
     <div>
       <div className="flex items-center gap-2">
         <h4 className="text-sm font-semibold t-primary">{run.clusterName || run.clusterId}</h4>
         {run.subCatalystName && <Badge variant="outline" size="sm">{run.subCatalystName}</Badge>}
       </div>
       <p className="text-xs t-muted mt-0.5">Run {run.runId.slice(0, 8)} &mdash; {new Date(run.startedAt).toLocaleString()}</p>
     </div>
     <div className="flex items-center gap-2">
       <Badge variant={run.status === 'completed' ? 'success' : run.status === 'running' ? 'info' : 'warning'}>{run.status}</Badge>
       {run.durationMs && <span className="text-xs t-muted">{(run.durationMs / 1000).toFixed(1)}s</span>}
       {isExp ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
     </div>
   </div>

   <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3">
     <div className="text-center p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <span className="text-caption t-muted">Total</span>
       <p className="text-sm font-bold t-primary">{run.summary.total}</p>
     </div>
     <div className="text-center p-2 rounded bg-emerald-500/5 border border-emerald-500/20">
       <span className="text-caption text-emerald-400">Completed</span>
       <p className="text-sm font-bold text-emerald-400">{run.summary.completed}</p>
     </div>
     <div className="text-center p-2 rounded bg-red-500/5 border border-red-500/20">
       <span className="text-caption text-red-400">Exceptions</span>
       <p className="text-sm font-bold text-red-400">{run.summary.exceptions}</p>
     </div>
     <div className="text-center p-2 rounded bg-amber-500/5 border border-amber-500/20">
       <span className="text-caption text-amber-400">Escalated</span>
       <p className="text-sm font-bold text-amber-400">{run.summary.escalated}</p>
     </div>
     <div className="text-center p-2 rounded bg-blue-500/5 border border-blue-500/20">
       <span className="text-caption text-blue-400">Pending</span>
       <p className="text-sm font-bold text-blue-400">{run.summary.pending}</p>
     </div>
     <div className="text-center p-2 rounded bg-accent/5 border border-accent/20">
       <span className="text-caption text-accent">Auto-Approved</span>
       <p className="text-sm font-bold text-accent">{run.summary.autoApproved}</p>
     </div>
   </div>

   {isExp && (
   <div className="mt-4 space-y-3 animate-fadeIn">
     <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <h5 className="text-xs font-semibold t-primary mb-2">Confidence Distribution</h5>
       <div className="flex items-end gap-1 h-16">
         {Object.entries(run.confidence.distribution).map(([bucket, count]) => {
           const maxCount = Math.max(...Object.values(run.confidence.distribution), 1);
           const height = (count / maxCount) * 100;
           return (
             <div key={bucket} className="flex-1 flex flex-col items-center gap-1">
               <div className="w-full rounded-t bg-accent/30" style={{ height: `${Math.max(height, 4)}%` }} />
               <span className="text-[8px] t-muted">{bucket}</span>
             </div>
           );
         })}
       </div>
       <div className="flex justify-between mt-2 text-caption t-muted">
         <span>Avg: <span className="font-medium t-primary">{(run.confidence.avg * 100).toFixed(0)}%</span></span>
         <span>Min: <span className="font-medium t-primary">{(run.confidence.min * 100).toFixed(0)}%</span></span>
         <span>Max: <span className="font-medium t-primary">{(run.confidence.max * 100).toFixed(0)}%</span></span>
       </div>
     </div>

     {/* Per-Run Transaction Detail */}
     <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <div className="flex items-center justify-between mb-2">
         <h5 className="text-xs font-semibold t-primary flex items-center gap-1"><ScrollText size={12} className="text-accent" /> Transaction Detail</h5>
         {!runDetailActions[run.runId] && (
           <Button variant="secondary" size="sm" onClick={async (e) => {
             e.stopPropagation();
             setRunDetailLoading(run.runId);
             try {
               const res = await api.catalysts.runAnalyticsDetail(run.runId);
               setRunDetailActions(prev => ({ ...prev, [run.runId]: res.actions }));
              } catch (err) {
               console.error('Failed to load run detail', err);
               toast.error('Failed to load run items', {
                 message: err instanceof Error ? err.message : 'Unknown error',
                 requestId: err instanceof ApiError ? err.requestId : null,
               });
              }
              setRunDetailLoading(null);
           }}>
             {runDetailLoading === run.runId ? <Loader2 size={10} className="animate-spin" /> : <Eye size={10} />} Load Items
           </Button>
         )}
       </div>
       {runDetailLoading === run.runId && (
         <div className="flex items-center justify-center py-4">
           <Loader2 className="w-4 h-4 text-accent animate-spin" />
           <span className="text-xs t-muted ml-2">Loading transaction items...</span>
         </div>
       )}
       {runDetailActions[run.runId] && runDetailActions[run.runId].length === 0 && (
         <p className="text-xs t-muted text-center py-3">No individual action items recorded for this run.</p>
       )}
       {runDetailActions[run.runId] && runDetailActions[run.runId].length > 0 && (
         <div className="space-y-1 max-h-[300px] overflow-y-auto">
           <div className="grid grid-cols-12 gap-2 text-caption t-muted uppercase tracking-wider font-semibold pb-1 border-b border-[var(--border-card)] sticky top-0 bg-[var(--bg-secondary)]">
             <span className="col-span-4">Action</span>
             <span className="col-span-2">Status</span>
             <span className="col-span-2 text-right">Confidence</span>
             <span className="col-span-2">Assigned To</span>
             <span className="col-span-2 text-right">Time</span>
           </div>
           {runDetailActions[run.runId].map((item) => (
             <div key={item.id} className="grid grid-cols-12 gap-2 items-center py-1.5 border-b border-[var(--border-card)]/50 hover:bg-[var(--bg-card-solid)]/50 rounded px-1">
               <span className="col-span-4 text-xs t-secondary truncate" title={item.action}>{item.action}</span>
               <span className="col-span-2">
                 <Badge variant={item.status === 'completed' || item.status === 'approved' ? 'success' : item.status === 'exception' || item.status === 'failed' || item.status === 'rejected' ? 'danger' : item.status === 'escalated' ? 'warning' : 'info'} size="sm">{item.status}</Badge>
               </span>
               <span className={`col-span-2 text-xs font-medium text-right ${item.confidence >= 0.8 ? 'text-emerald-400' : item.confidence >= 0.6 ? 'text-amber-400' : 'text-red-400'}`}>
                 {(item.confidence * 100).toFixed(0)}%
               </span>
               <span className="col-span-2 text-caption t-muted truncate">{item.assignedTo || '—'}</span>
               <span className="col-span-2 text-caption t-muted text-right">{item.processingTimeMs ? `${(item.processingTimeMs / 1000).toFixed(1)}s` : '—'}</span>
             </div>
           ))}
         </div>
       )}
     </div>

     {run.insights.length > 0 && (
     <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
       <h5 className="text-xs font-semibold t-primary mb-2 flex items-center gap-1"><Sparkles size={12} className="text-accent" /> AI Insights</h5>
       <ul className="space-y-1">
         {run.insights.map((insight, i) => (
           <li key={i} className="text-xs t-secondary flex items-start gap-1.5">
             <span className="text-accent mt-0.5">&bull;</span> {insight}
           </li>
         ))}
       </ul>
     </div>
     )}
   </div>
   )}
   </Card>
   );
 })}
 </div>
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
 <span className="text-sm font-medium t-primary w-10 text-right">{Number(cluster.trustScore).toFixed(1)}%</span>
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
 <p className="text-caption t-muted">All catalyst executions</p>
 </div>
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">Pending Approvals</span>
 <p className="text-lg font-bold text-accent">{governance?.pendingApprovals ?? 0}</p>
 <p className="text-caption t-muted">Awaiting human review</p>
 </div>
 <div className="p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-xs t-secondary">Approved / Rejected</span>
 <p className="text-lg font-bold t-primary">
 <span className="text-emerald-400">{governance?.approved ?? 0}</span>
 {' / '}
 <span className="text-red-500">{governance?.rejected ?? 0}</span>
 </p>
 <p className="text-caption t-muted">Human override decisions</p>
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
 <p className="text-caption t-secondary">{quickRunClusterName}</p>
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
 <div><Upload size={16} className="mx-auto text-gray-500 mb-1" /><p className="text-caption t-muted">CSV, Excel, or PDF</p></div>
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
 Configure <span className="font-semibold text-accent">{dsSubName}</span> sub-catalyst settings.
 </p>

 {/* Quick-access config navigation */}
 {configSub && (
 <div className="flex flex-wrap gap-2">
  <button
 type="button"
 disabled
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-accent/10 text-accent border border-accent/30 disabled:opacity-80"
 >
 <Database size={12} /> Data Sources
 </button>
 <button
 onClick={() => { setShowDataSourceConfig(false); openScheduleConfig(configClusterId, configSub); }}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border-card)] t-secondary hover:border-indigo-500/30 hover:text-indigo-400 transition-colors"
 >
 <Calendar size={12} /> Schedule
 </button>
 <button
 onClick={() => { setShowDataSourceConfig(false); openExecutionConfig(configClusterId, configSub); }}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border-card)] t-secondary hover:border-orange-500/30 hover:text-orange-400 transition-colors"
 >
 <Activity size={12} /> Execution Mode
 </button>
 {getSubDataSources(configSub).length >= 2 && (
 <button
 onClick={() => { setShowDataSourceConfig(false); openFieldMappingConfig(configClusterId, configSub); }}
 className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-[var(--bg-secondary)] border border-[var(--border-card)] t-secondary hover:border-teal-500/30 hover:text-teal-400 transition-colors"
 >
 <Link2 size={12} /> Field Mappings
 </button>
 )}
 </div>
 )}

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
 {src.type === 'erp' && !!src.config.module && <span className="text-caption t-muted block">{String(src.config.module)}</span>}
 {src.type === 'custom_system' && !!src.config.endpoint_url && <span className="text-caption t-muted block truncate">{String(src.config.endpoint_url)}</span>}
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
 <p className="text-caption t-muted mt-1">Click &quot;Add Data Source&quot; to connect one.</p>
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
 <span className={`text-caption font-medium ${selected ? opt.selectedText : 't-secondary'}`}>{opt.label}</span>
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
 <option value="odoo">Odoo</option>
 </>
 )}
 </select>
 {erpConnections.length > 0 && (
 <p className="text-caption text-emerald-400 mt-1 flex items-center gap-1">
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
 <p className="text-caption t-secondary">
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
 <p className="text-caption t-secondary flex items-center gap-1">
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
     <span className="text-caption t-muted">{opt.desc}</span>
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
 <p className="text-caption t-muted mt-1">All times are in UTC. Your local time may differ.</p>
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
   <p className="text-caption t-muted">Last run: {new Date(schedExisting.last_run).toLocaleString()}</p>
 )}
 {schedExisting.next_run && (
   <p className="text-caption t-muted">Next run: {new Date(schedExisting.next_run).toLocaleString()}</p>
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
 <span key={i} className="inline-flex items-center gap-1 px-2 py-1 rounded text-caption font-medium bg-[var(--bg-secondary)] border border-[var(--border-card)]">
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
 {fmDataSources.length < 2 && <span className="text-caption text-amber-400 ml-2">Need at least 2 data sources</span>}
 </div>

 {/* Existing Mappings */}
 {fmMappings.length > 0 ? (
 <div className="space-y-2 mb-4">
 <div className="grid grid-cols-[40px_1fr_24px_1fr_80px_60px_32px] gap-2 text-caption font-semibold t-secondary px-2">
 <span>Src</span><span>Source Field</span><span></span><span>Target Field</span><span>Match Type</span><span>Conf.</span><span></span>
 </div>
 {fmMappings.map((fm, i) => (
 <div key={fm.id || i} className="grid grid-cols-[40px_1fr_24px_1fr_80px_60px_32px] gap-2 items-center p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption font-bold text-accent">#{fm.source_index}</span>
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
   className="bg-transparent border border-[var(--border-card)] rounded px-1 py-1 text-caption t-primary"
   value={fm.match_type}
   onChange={e => setFmMappings(prev => prev.map((m, j) => j === i ? { ...m, match_type: e.target.value as FieldMapping['match_type'] } : m))}
 >
   <option value="exact">Exact</option>
   <option value="fuzzy">Fuzzy</option>
   <option value="contains">Contains</option>
   <option value="numeric_tolerance">Numeric ±</option>
   <option value="date_range">Date Range</option>
 </select>
 <span className={`text-caption font-medium text-center ${fm.confidence >= 0.8 ? 'text-emerald-400' : fm.confidence >= 0.5 ? 'text-amber-400' : 'text-red-400'}`}>
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
 <p className="text-caption t-muted mt-1">Click &quot;Smart Suggest&quot; to auto-detect matching fields</p>
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

 {/* HITL Permission Assignment Modal */}
 {showHitlModal && (
 <Portal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={() => setShowHitlModal(false)}>
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-xl shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
 <div className="flex items-center justify-between mb-4">
 <div className="flex items-center gap-2">
 <Users className="w-5 h-5 text-accent" />
 <h3 className="text-lg font-semibold t-primary">
   {hitlEditSub ? `Assign Users \u2014 ${hitlEditSub}` : 'Cluster Default Permissions'}
 </h3>
 </div>
 <button onClick={() => setShowHitlModal(false)} className="text-gray-400 hover:text-gray-200"><X size={18} /></button>
 </div>

 {hitlEditSub && (
 <p className="text-xs t-muted mb-4">Override cluster-level defaults for this specific sub-catalyst.</p>
 )}

  <div className="space-y-4">
 <div>
 <label className="text-xs font-medium text-emerald-400 block mb-1.5">Validators (approve actions)</label>
 <div className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] max-h-[120px] overflow-y-auto p-1">
   {hitlUsers.length === 0 && <p className="text-xs t-muted p-2">No users available</p>}
   {hitlUsers.map(u => (
     <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-emerald-500/5 cursor-pointer">
       <input type="checkbox" className="rounded border-emerald-500/40 text-emerald-500" checked={hitlValidators.includes(u.id)} onChange={e => {
         if (e.target.checked) setHitlValidators(prev => [...prev, u.id]);
         else setHitlValidators(prev => prev.filter(id => id !== u.id));
       }} />
       <span className="text-xs t-primary">{u.name}</span>
       <span className="text-caption t-muted ml-auto">{u.email}</span>
     </label>
   ))}
 </div>
 </div>

 <div>
 <label className="text-xs font-medium text-amber-400 block mb-1.5">Exception Handlers</label>
 <div className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] max-h-[120px] overflow-y-auto p-1">
   {hitlUsers.length === 0 && <p className="text-xs t-muted p-2">No users available</p>}
   {hitlUsers.map(u => (
     <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-amber-500/5 cursor-pointer">
       <input type="checkbox" className="rounded border-amber-500/40 text-amber-500" checked={hitlExceptionHandlers.includes(u.id)} onChange={e => {
         if (e.target.checked) setHitlExceptionHandlers(prev => [...prev, u.id]);
         else setHitlExceptionHandlers(prev => prev.filter(id => id !== u.id));
       }} />
       <span className="text-xs t-primary">{u.name}</span>
       <span className="text-caption t-muted ml-auto">{u.email}</span>
     </label>
   ))}
 </div>
 </div>

 <div>
 <label className="text-xs font-medium text-red-400 block mb-1.5">Escalation Contacts</label>
 <div className="w-full rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] max-h-[120px] overflow-y-auto p-1">
   {hitlUsers.length === 0 && <p className="text-xs t-muted p-2">No users available</p>}
   {hitlUsers.map(u => (
     <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-red-500/5 cursor-pointer">
       <input type="checkbox" className="rounded border-red-500/40 text-red-500" checked={hitlEscalation.includes(u.id)} onChange={e => {
         if (e.target.checked) setHitlEscalation(prev => [...prev, u.id]);
         else setHitlEscalation(prev => prev.filter(id => id !== u.id));
       }} />
       <span className="text-xs t-primary">{u.name}</span>
       <span className="text-caption t-muted ml-auto">{u.email}</span>
     </label>
   ))}
 </div>
 </div>

 <div className="space-y-2 pt-2 border-t border-[var(--border-card)]">
 <p className="text-xs font-medium t-secondary">Email Notifications</p>
 <label className="flex items-center gap-2 text-xs t-secondary cursor-pointer">
   <input type="checkbox" checked={hitlNotifyCompletion} onChange={e => setHitlNotifyCompletion(e.target.checked)} className="rounded" /> Notify on run completion
 </label>
 <label className="flex items-center gap-2 text-xs t-secondary cursor-pointer">
   <input type="checkbox" checked={hitlNotifyException} onChange={e => setHitlNotifyException(e.target.checked)} className="rounded" /> Notify on exceptions
 </label>
 <label className="flex items-center gap-2 text-xs t-secondary cursor-pointer">
   <input type="checkbox" checked={hitlNotifyApproval} onChange={e => setHitlNotifyApproval(e.target.checked)} className="rounded" /> Notify when approval needed
 </label>
 </div>
 </div>

 {hitlError && (
 <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm flex items-center gap-2">
 <AlertTriangle size={14} /> {hitlError}
 </div>
 )}

 <div className="flex justify-end gap-3 pt-4">
 <Button variant="secondary" size="sm" onClick={() => setShowHitlModal(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveHitl} disabled={hitlSaving}>
   {hitlSaving ? <Loader2 size={14} className="animate-spin" /> : <Users size={14} />} Save Permissions
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
       <p className="text-caption t-muted">{opt.desc}</p>
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
 <div className={`p-4 ${execResult.status === 'failed' ? 'bg-red-500/15 border-red-500/40' : 'bg-red-500/10 border-red-500/20'} border rounded-lg text-red-400 text-sm mb-4`}>
 <div className="flex items-center gap-2 font-semibold mb-1">
 <AlertTriangle size={16} /> {execResult.status === 'failed' ? 'Execution Failed' : 'Warning'}
 </div>
 <p className="text-red-300/90 text-xs leading-relaxed">{execResult.error}</p>
 </div>
 )}

 {/* Summary Grid */}
 <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-4">
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption t-muted block">Source Records</span>
 <p className="text-lg font-bold t-primary">{execResult.summary.total_records_source}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <span className="text-caption t-muted block">Target Records</span>
 <p className="text-lg font-bold t-primary">{execResult.summary.total_records_target}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/20">
 <span className="text-caption text-emerald-400 block">Matched</span>
 <p className="text-lg font-bold text-emerald-400">{execResult.summary.matched}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
 <span className="text-caption text-amber-400 block">Unmatched (Src)</span>
 <p className="text-lg font-bold text-amber-400">{execResult.summary.unmatched_source}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
 <span className="text-caption text-amber-400 block">Unmatched (Tgt)</span>
 <p className="text-lg font-bold text-amber-400">{execResult.summary.unmatched_target}</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-red-500/5 border border-red-500/20">
 <span className="text-caption text-red-400 block">Discrepancies</span>
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
 {d.difference && <span className="text-red-400 text-caption">{d.difference}</span>}
 </div>
 <div className="flex gap-4 mt-1 text-caption">
   <span className="t-secondary">Source: <span className="t-primary">{typeof d.source_value === 'number' ? Number(d.source_value).toFixed(2) : String(d.source_value ?? 'null')}</span></span>
 <span className="t-secondary">Target: <span className="t-primary">{typeof d.target_value === 'number' ? Number(d.target_value).toFixed(2) : String(d.target_value ?? 'null')}</span></span>
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

 {/* Intelligence Tab */}
 {activeTab === 'intelligence' && (
  <TabPanel>
   {intellLoading && !intellOverview && (
    <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
   )}
   {!intellLoading && !intellOverview && (
    <Card className="flex items-center gap-3 py-6 px-4">
     <Brain className="w-5 h-5 t-muted opacity-40 flex-shrink-0" />
     <p className="text-sm t-muted">No intelligence data yet</p>
     <Button variant="primary" size="sm" className="ml-auto" onClick={loadIntelligence}>Load Intelligence</Button>
    </Card>
   )}
   {intellOverview && (
    <div className="space-y-4">
     {/* Summary Cards — reduced from 7 to 4 per UI cleanup */}
     <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
      <Card><div className="text-center"><p className="text-2xl font-bold text-amber-400">{intellOverview.summary.activePatterns}</p><p className="text-label">Active Patterns</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold text-red-400">{intellOverview.summary.criticalPatterns}</p><p className="text-label">Critical</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold t-primary">R{(intellOverview.summary.totalValueProcessed / 1000).toFixed(0)}k</p><p className="text-label">Value Processed</p></div></Card>
      <Card><div className="text-center"><p className="text-2xl font-bold text-purple-400">{intellOverview.summary.avgRoi > 0 ? '+' : ''}{Math.round(intellOverview.summary.avgRoi)}%</p><p className="text-label">Avg ROI</p></div></Card>
     </div>

     {/* ROI Card */}
     {roiData && (
      <Card className="border-emerald-500/20 bg-emerald-500/5">
       <div className="flex items-center gap-2 mb-3">
        <TrendingUp size={16} className="text-emerald-400" />
        <h3 className="text-sm font-semibold t-primary">ROI Summary</h3>
        <Badge variant="success" size="sm">{roiData.roiMultiple}x return</Badge>
       </div>
       <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="text-center p-2 rounded-lg bg-[var(--bg-secondary)]">
         <p className="text-lg font-bold text-emerald-400">R{(roiData.totalDiscrepancyValueRecovered / 1000).toFixed(0)}k</p>
         <p className="text-caption t-muted">Recovered</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-[var(--bg-secondary)]">
         <p className="text-lg font-bold text-blue-400">R{(roiData.totalPreventedLosses / 1000).toFixed(0)}k</p>
         <p className="text-caption t-muted">Prevented</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-[var(--bg-secondary)]">
         <p className="text-lg font-bold text-purple-400">{roiData.totalPersonHoursSaved}h</p>
         <p className="text-caption t-muted">Hours Saved</p>
        </div>
        <div className="text-center p-2 rounded-lg bg-[var(--bg-secondary)]">
         <p className="text-lg font-bold t-primary">R{(roiData.platformCost / 1000).toFixed(0)}k</p>
         <p className="text-caption t-muted">Platform Cost</p>
        </div>
       </div>

       {/* v60: per-ERP attribution — under shared-savings the customer
           must be able to see which ERP/subsystem drove which dollars.
           Hidden when there's only one bucket (no split to show). */}
       {roiData.breakdown?.byConnection && roiData.breakdown.byConnection.length > 1 && (
        <div className="mt-4">
         <p className="text-xs font-semibold t-muted mb-2">Recovered value attributed to each connected ERP / subsystem</p>
         <div className="space-y-1.5">
          {roiData.breakdown.byConnection.map((row) => (
           <div key={row.key} className="flex items-center gap-2">
            <div className="flex-1 min-w-0">
             <div className="flex items-center justify-between mb-0.5">
              <span className="text-xs font-medium t-primary truncate">{row.label}</span>
              <span className="text-xs t-muted">R{(row.recoveredValue / 1000).toFixed(0)}k · {Math.round(row.share * 100)}%</span>
             </div>
             <div className="h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.max(2, row.share * 100)}%` }} />
             </div>
            </div>
           </div>
          ))}
         </div>
         <p className="text-caption t-muted mt-2">
          Attribution split by input value share across canonical ERP records ({roiData.breakdown.byConnection.length} sources).
         </p>
        </div>
       )}

       {/* v63: read→action loop split — automated by Atheon vs in approval
           queue vs still open. Closes the loop on what the customer is
           seeing in the headline ROI numbers. */}
       {roiData.breakdown?.byActionState && (
        <div className="mt-4 pt-4 border-t border-[var(--border-card)]">
         <p className="text-xs font-semibold t-muted mb-2">Identified opportunity → realisation pipeline</p>
         <div className="grid grid-cols-3 gap-2">
          <div className="p-2 rounded bg-emerald-500/10 border border-emerald-500/20">
           <p className="text-caption t-muted">Automated by Atheon</p>
           <p className="text-base font-bold text-emerald-400">R{(roiData.breakdown.byActionState.automated_value_zar / 1000).toFixed(0)}k</p>
           <p className="text-caption t-muted">{roiData.breakdown.byActionState.automated_count} actions completed</p>
          </div>
          <div className="p-2 rounded bg-amber-500/10 border border-amber-500/20">
           <p className="text-caption t-muted">Pending approval</p>
           <p className="text-base font-bold text-amber-400">R{(roiData.breakdown.byActionState.pending_value_zar / 1000).toFixed(0)}k</p>
           <p className="text-caption t-muted">{roiData.breakdown.byActionState.pending_count} awaiting</p>
          </div>
          <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
           <p className="text-caption t-muted">Open opportunity</p>
           <p className="text-base font-bold t-primary">R{(roiData.breakdown.byActionState.open_value_zar / 1000).toFixed(0)}k</p>
           <p className="text-caption t-muted">no automation yet</p>
          </div>
         </div>
         <p className="text-caption t-muted mt-2">
          Of R{((roiData.totalDiscrepancyValueIdentified || 0) / 1000).toFixed(0)}k identified, the split shows where each rand sits in the realisation pipeline.
         </p>
        </div>
       )}
      </Card>
     )}

     {/* Prescription Queue */}
     {prescriptions.length > 0 && (
      <div>
       <h3 className="text-sm font-semibold t-primary mb-2">Prescription Queue</h3>
       <div className="space-y-2">
        {prescriptions.map(rx => (
         <Card key={rx.id} className={rx.priority === 'critical' ? 'border-red-500/20' : rx.priority === 'high' ? 'border-amber-500/20' : ''}>
          <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
            <Badge variant={rx.priority === 'critical' ? 'danger' : rx.priority === 'high' ? 'warning' : 'info'} size="sm">{rx.priority}</Badge>
            <span className="text-xs font-medium t-primary">{rx.title}</span>
            {rx.sapTransaction && <Badge variant="default" size="sm">SAP: {rx.sapTransaction}</Badge>}
           </div>
           <div className="flex items-center gap-2">
            <Badge variant={rx.status === 'completed' ? 'success' : rx.status === 'in_progress' ? 'info' : rx.status === 'rejected' ? 'danger' : 'warning'} size="sm">{rx.status}</Badge>
            <span className="text-caption t-muted">{rx.effort} effort</span>
           </div>
          </div>
          <p className="text-caption t-secondary mt-1">{rx.description}</p>
          {rx.expectedImpact && <p className="text-caption text-emerald-400 mt-1">Expected: {rx.expectedImpact}</p>}
         </Card>
        ))}
       </div>
      </div>
     )}

     {/* Actions Row */}
     <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" onClick={loadIntelligence}><RefreshCw size={12} /> Refresh</Button>
      <Button variant="primary" size="sm" onClick={handleDiscoverPatterns}><Brain size={12} /> Discover Patterns</Button>
      <Button variant="secondary" size="sm" onClick={handleDiscoverDependencies}><GitBranch size={12} /> Map Dependencies</Button>
     </div>

     {/* Patterns Section */}
     {intellOverview.patterns.length > 0 && (
      <div>
       <h3 className="text-sm font-semibold t-primary mb-2">Discovered Patterns</h3>
       <div className="space-y-2">
        {intellOverview.patterns.map(pattern => (
         <Card key={pattern.id} hover onClick={() => setExpandedPattern(expandedPattern === pattern.id ? null : pattern.id)}>
          <div className="flex items-center justify-between">
           <div className="flex items-center gap-2">
            <StatusPill status={pattern.severity} size="sm" />
            <span className="text-sm font-medium t-primary">{pattern.title}</span>
            <Badge variant="default" size="sm">{pattern.patternType.replace('_', ' ')}</Badge>
           </div>
           <div className="flex items-center gap-2 text-caption t-muted">
            <span>Freq: {pattern.frequency}x</span>
            <Badge variant={pattern.status === 'active' ? 'warning' : pattern.status === 'resolved' ? 'success' : 'info'} size="sm">{pattern.status}</Badge>
           </div>
          </div>
          {expandedPattern === pattern.id && (
           <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
            <p className="text-xs t-secondary mb-2">{pattern.description}</p>
            <div className="flex flex-wrap gap-2 text-caption t-muted mb-2">
             <span>First seen: {new Date(pattern.firstSeen).toLocaleDateString()}</span>
             <span>Last seen: {new Date(pattern.lastSeen).toLocaleDateString()}</span>
            </div>
            {pattern.affectedClusters.length > 0 && (
             <div className="flex flex-wrap gap-1 mb-2">
              {pattern.affectedClusters.map((c, i) => <Badge key={i} variant="info" size="sm">{c}</Badge>)}
             </div>
            )}
            {pattern.recommendedActions.length > 0 && (
             <div>
              <p className="text-caption font-medium t-primary mb-1">Recommended Actions</p>
              <ul className="space-y-0.5">
               {pattern.recommendedActions.map((a, i) => (
                <li key={i} className="text-caption t-muted flex items-start gap-1"><Target size={8} className="mt-0.5 text-accent flex-shrink-0" />{a}</li>
               ))}
              </ul>
             </div>
            )}
           </div>
          )}
         </Card>
        ))}
       </div>
      </div>
     )}

     {/* Effectiveness Section */}
     {intellOverview.effectiveness.length > 0 && (
      <div>
       <h3 className="text-sm font-semibold t-primary mb-2">Sub-Catalyst Effectiveness</h3>
       <div className="overflow-x-auto">
        <table className="w-full text-xs">
         <thead>
          <tr className="border-b border-[var(--border-card)]">
           <th className="text-left py-2 px-2 t-muted font-medium">Sub-Catalyst</th>
           <th className="text-right py-2 px-2 t-muted font-medium">Runs</th>
           <th className="text-right py-2 px-2 t-muted font-medium">Success Rate</th>
           <th className="text-right py-2 px-2 t-muted font-medium">Match Rate</th>
           <th className="text-right py-2 px-2 t-muted font-medium">Trend</th>
           <th className="text-right py-2 px-2 t-muted font-medium">ROI</th>
          </tr>
         </thead>
         <tbody>
          {intellOverview.effectiveness.map(eff => (
           <tr key={eff.id} className="border-b border-[var(--border-card)] hover:bg-[var(--bg-secondary)]">
            <td className="py-2 px-2 t-primary font-medium">{eff.subCatalystName}</td>
            <td className="text-right py-2 px-2 t-secondary">{eff.runsCount}</td>
            <td className="text-right py-2 px-2"><span className={eff.successRate >= 80 ? 'text-emerald-400' : eff.successRate >= 60 ? 'text-amber-400' : 'text-red-400'}>{Math.round(eff.successRate)}%</span></td>
            <td className="text-right py-2 px-2 t-secondary">{Math.round(eff.avgMatchRate)}%</td>
            <td className="text-right py-2 px-2">
             {eff.improvementTrend > 0 ? <TrendingUp size={12} className="text-emerald-400 inline" /> : eff.improvementTrend < 0 ? <TrendingDown size={12} className="text-red-400 inline" /> : <span className="text-gray-400">—</span>}
            </td>
            <td className="text-right py-2 px-2"><span className={eff.roiEstimate > 0 ? 'text-emerald-400' : 'text-red-400'}>{eff.roiEstimate > 0 ? '+' : ''}{Math.round(eff.roiEstimate)}%</span></td>
           </tr>
          ))}
         </tbody>
        </table>
       </div>
      </div>
     )}

     {/* Dependencies Section */}
     {intellOverview.dependencies.length > 0 && (
      <div>
       <h3 className="text-sm font-semibold t-primary mb-2">Dependency Map</h3>
       <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
        {intellOverview.dependencies.map(dep => (
         <Card key={dep.id}>
          <div className="flex items-center gap-2 text-xs">
           <span className="t-primary font-medium">{dep.sourceSubCatalyst}</span>
           <span className="text-accent">→</span>
           <span className="t-primary font-medium">{dep.targetSubCatalyst}</span>
          </div>
          <div className="flex items-center gap-2 mt-1">
           <Badge variant="info" size="sm">{dep.dependencyType.replace('_', ' ')}</Badge>
           <Progress value={dep.strength} color={dep.strength >= 70 ? 'emerald' : dep.strength >= 40 ? 'amber' : 'red'} className="flex-1 h-1.5" />
           <span className="text-caption t-muted">{Math.round(dep.strength)}%</span>
          </div>
          {dep.description && <p className="text-caption t-muted mt-1">{dep.description}</p>}
         </Card>
        ))}
       </div>
      </div>
     )}
    </div>
   )}
  </TabPanel>
 )}

 {/* §11.6 Success Stories / Peer Insights Tab */}
 {activeTab === 'success-stories' && (
  <TabPanel>
   {!successStories && !storiesLoading && (
    <Card className="text-center py-12">
     <Sparkles className="w-10 h-10 t-muted mx-auto mb-3 opacity-30" />
     <p className="text-sm font-medium t-primary">Peer Insights</p>
     <p className="text-xs t-muted mt-1">See anonymised resolution patterns from peers in your industry.</p>
     <Button variant="primary" size="sm" className="mt-4" onClick={loadSuccessStories}>Load Insights</Button>
    </Card>
   )}
   {storiesLoading && (
    <div className="flex items-center justify-center h-32"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
   )}
   {successStories && (
    <div className="space-y-4">
     <div className="flex items-center justify-between">
      <div>
       <h3 className="text-sm font-semibold t-primary">Industry: {successStories.industry}</h3>
       <p className="text-caption t-muted">{successStories.total} resolution pattern{successStories.total !== 1 ? 's' : ''} from peers</p>
      </div>
      <Button variant="secondary" size="sm" onClick={loadSuccessStories}><RefreshCw size={12} /> Refresh</Button>
     </div>
     {successStories.stories.length === 0 ? (
      <Card className="text-center py-8">
       <p className="text-xs t-muted">Not enough peer data yet (minimum 3 resolutions for anonymity).</p>
      </Card>
     ) : (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
       {successStories.stories.map((story, i) => (
        <SuccessStoryCard key={i} story={story} />
       ))}
      </div>
     )}
    </div>
   )}
  </TabPanel>
 )}

 {/* Sub-Catalyst Ops Panel */}
 {opsPanel && (
 <SubCatalystOpsPanel
 clusterId={opsPanel.clusterId}
 clusterName={opsPanel.clusterName}
 subCatalystName={opsPanel.subName}
 onClose={() => setOpsPanel(null)}
 />
 )}
 </div>
 );
}
