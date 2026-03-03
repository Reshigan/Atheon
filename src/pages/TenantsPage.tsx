import { useState, useEffect, useCallback } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Tenant, IAMUser, CatalystIndustryTemplate, CatalystClusterTemplate, ClusterItem, SubCatalyst } from "@/lib/api";
import {
 Building2, Cloud, Server, GitBranch, Users, Bot, Shield,
 ChevronDown, ChevronUp, CheckCircle, XCircle, Plus, Layers, Loader2, X,
 Zap, ToggleLeft, ToggleRight, Database, Mail, HardDrive, Upload, Settings, Trash2, ArrowLeft
} from "lucide-react";
import { IconCheck, IconCross } from "@/components/icons/AtheonIcons";

const deploymentIcon= (model: string) => {
 if (model === 'saas') return <Cloud size={14} className="text-accent" />;
 if (model === 'on-premise') return <Server size={14} className="text-accent" />;
 return <GitBranch size={14} className="text-accent" />;
};

const deploymentColor = (model: string) => {
 if (model === 'saas') return 'info';
 if (model === 'on-premise') return 'warning';
 return 'default';
};

const statusBadge = (status: string) => {
 if (status === 'active') return <Badge variant="success">{status}</Badge>;
 if (status === 'provisioning') return <Badge variant="warning">{status}</Badge>;
 if (status === 'suspended') return <Badge variant="danger">{status}</Badge>;
 return <Badge variant="default">{status}</Badge>;
};

export function TenantsPage() {
 const { activeTab, setActiveTab } = useTabState('overview');
 const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
 const [tenants, setTenants] = useState<Tenant[]>([]);
 const [loading, setLoading] = useState(true);
 const [showOnboard, setShowOnboard] = useState(false);
 const [onboardForm, setOnboardForm] = useState({ name: '', slug: '', industry: 'general', plan: 'starter', deploymentModel: 'saas', region: 'af-south-1' });
 const [onboarding, setOnboarding] = useState(false);

 // Manage Users modal state
 const [showManageUsers, setShowManageUsers] = useState<string | null>(null);
 const [tenantUsers, setTenantUsers] = useState<IAMUser[]>([]);
 const [loadingUsers, setLoadingUsers] = useState(false);
 const [showAddUser, setShowAddUser] = useState(false);
 const [addUserForm, setAddUserForm] = useState({ email: '', name: '', role: 'analyst' });
 const [addingUser, setAddingUser] = useState(false);

 // Deploy Catalyst modal state
 const [showDeployCatalyst, setShowDeployCatalyst] = useState<string | null>(null);
 const [catalystForm, setCatalystForm] = useState({ name: '', domain: 'finance', autonomy_tier: 'assisted' });
 const [deployingCatalyst, setDeployingCatalyst] = useState(false);

 // Industry template state
 const [templates, setTemplates] = useState<CatalystIndustryTemplate[]>([]);
 const [loadingTemplates, setLoadingTemplates] = useState(false);
 const [selectedIndustry, setSelectedIndustry] = useState<string | null>(null);
 const [templateClusters, setTemplateClusters] = useState<Array<CatalystClusterTemplate & { selected: boolean }>>([]);
 const [deployStep, setDeployStep] = useState<'choose' | 'customize' | 'deploying' | 'done' | 'manage'>('choose');
 const [deployResult, setDeployResult] = useState<{ clustersCreated: number; existingClusters: number } | null>(null);

 // Manage catalysts state (post-deploy sub-catalyst toggle & config)
 const [tenantClusters, setTenantClusters] = useState<ClusterItem[]>([]);
 const [loadingClusters, setLoadingClusters] = useState(false);
 const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
 const [togglingSubCatalyst, setTogglingSubCatalyst] = useState<string | null>(null);
 const [configuringSub, setConfiguringSub] = useState<{ clusterId: string; subName: string } | null>(null);
 const [dataSourceForm, setDataSourceForm] = useState<{ type: string; config: Record<string, string> }>({ type: 'erp', config: {} });
 const [savingDataSource, setSavingDataSource] = useState(false);

 // Company Reset modal state
 const [showResetConfirm, setShowResetConfirm] = useState<string | null>(null);
 const [resetting, setResetting] = useState(false);
 const [resetResult, setResetResult] = useState<{ deletedRows: number; tablesCleared: number } | null>(null);
 const [resetConfirmText, setResetConfirmText] = useState('');

 // Edit Entitlements modal state
 const [showEditEntitlements, setShowEditEntitlements] = useState<string | null>(null);
 const [entitlementForm, setEntitlementForm] = useState({
 maxUsers: 10, maxAgents: 5, ssoEnabled: false, apiAccess: false, customBranding: false,
 dataRetentionDays: 90, autonomyTiers: ['read-only'] as string[], llmTiers: ['tier-1'] as string[],
 features: [] as string[]});
 const [savingEntitlements, setSavingEntitlements] = useState(false);

 const handleOnboard = async () => {
 if (!onboardForm.name.trim() || !onboardForm.slug.trim()) return;
 setOnboarding(true);
 try {
 await api.tenants.create(onboardForm);
 const res = await api.tenants.list();
 setTenants(res.tenants);
 setShowOnboard(false);
 setOnboardForm({ name: '', slug: '', industry: 'general', plan: 'starter', deploymentModel: 'saas', region: 'af-south-1' });
 } catch { /* silent */ }
 setOnboarding(false);
 };

 // Manage Users handlers
 const openManageUsers = async (tenantId: string) => {
 setShowManageUsers(tenantId);
 setLoadingUsers(true);
 try {
 const res = await api.iam.users(tenantId);
 setTenantUsers(res.users);
 } catch { setTenantUsers([]); }
 setLoadingUsers(false);
 };

 const handleAddUser = async () => {
 if (!addUserForm.email.trim() || !addUserForm.name.trim() || addingUser || !showManageUsers) return;
 setAddingUser(true);
 try {
 await api.iam.createUser({
 tenant_id: showManageUsers,
 email: addUserForm.email.trim(),
 name: addUserForm.name.trim(),
 role: addUserForm.role});
 const res = await api.iam.users(showManageUsers);
 setTenantUsers(res.users);
 setAddUserForm({ email: '', name: '', role: 'analyst' });
 setShowAddUser(false);
 } catch { /* silent */ }
 setAddingUser(false);
 };

 // Deploy Catalyst handler (single cluster - kept for backward compat)
 const handleDeployCatalyst = async () => {
 if (!catalystForm.name.trim() || deployingCatalyst || !showDeployCatalyst) return;
 setDeployingCatalyst(true);
 try {
 await api.catalysts.createCluster({
 tenant_id: showDeployCatalyst,
 name: catalystForm.name.trim(),
 domain: catalystForm.domain,
 autonomy_tier: catalystForm.autonomy_tier});
 setShowDeployCatalyst(null);
 setCatalystForm({ name: '', domain: 'finance', autonomy_tier: 'assisted' });
 const res = await api.tenants.list();
 setTenants(res.tenants);
 } catch { /* silent */ }
 setDeployingCatalyst(false);
 };

 // Load industry templates
 const loadTemplates = useCallback(async () => {
 if (templates.length > 0) return;
 setLoadingTemplates(true);
 try {
 const res = await api.catalysts.templates();
 setTemplates(res.templates);
 } catch { /* silent */ }
 setLoadingTemplates(false);
 }, [templates.length]);

 // Open deploy catalyst modal
 const openDeployCatalyst = useCallback(async (tenantId: string) => {
 setShowDeployCatalyst(tenantId);
 setDeployStep('choose');
 setSelectedIndustry(null);
 setTemplateClusters([]);
 setDeployResult(null);
 setTenantClusters([]);
 await loadTemplates();
 }, [loadTemplates]);

 // Select an industry template
 const selectIndustryTemplate = useCallback((industry: string) => {
 setSelectedIndustry(industry);
 const tmpl = templates.find(t => t.industry === industry);
 if (tmpl) {
 setTemplateClusters(tmpl.clusters.map(c => ({ ...c, selected: true })));
 setDeployStep('customize');
 }
 }, [templates]);

 // Deploy the selected template
 const handleDeployTemplate = async () => {
 if (!showDeployCatalyst || !selectedIndustry) return;
 setDeployStep('deploying');
 try {
 const selectedClusters = templateClusters.filter(c => c.selected);
 const res = await api.catalysts.deployTemplate({
 tenant_id: showDeployCatalyst,
 industry: selectedIndustry,
 clusters: selectedClusters.map(c => ({
 name: c.name,
 domain: c.domain,
 description: c.description,
 autonomy_tier: c.autonomy_tier,
 sub_catalysts: c.sub_catalysts,
 })),
 });
 setDeployResult({ clustersCreated: res.clustersCreated, existingClusters: res.existingClusters });
 setDeployStep('done');
 // Refresh tenants
 const tenRes = await api.tenants.list();
 setTenants(tenRes.tenants);
 } catch {
 setDeployStep('customize');
 }
 };

 // Load tenant's existing clusters for management
 const loadTenantClusters = async (tenantId: string) => {
 setLoadingClusters(true);
 try {
 const res = await api.catalysts.clusters(tenantId);
 setTenantClusters(res.clusters);
 } catch { setTenantClusters([]); }
 setLoadingClusters(false);
 };

 // Open manage mode (view existing clusters, toggle sub-catalysts, configure)
 const openManageCatalysts = async (tenantId: string) => {
 setShowDeployCatalyst(tenantId);
 setDeployStep('manage');
 setExpandedCluster(null);
 await loadTenantClusters(tenantId);
 };

 // Toggle sub-catalyst enabled/disabled
 const handleToggleSubCatalyst = async (clusterId: string, subName: string) => {
 setTogglingSubCatalyst(`${clusterId}-${subName}`);
 try {
 await api.catalysts.toggleSubCatalyst(clusterId, subName, showDeployCatalyst || undefined);
 if (showDeployCatalyst) await loadTenantClusters(showDeployCatalyst);
 } catch { /* silent */ }
 setTogglingSubCatalyst(null);
 };

 // Save data source configuration
 const handleSaveDataSource = async () => {
 if (!configuringSub || savingDataSource) return;
 setSavingDataSource(true);
 try {
 await api.catalysts.setDataSource(configuringSub.clusterId, configuringSub.subName, {
 type: dataSourceForm.type,
 config: dataSourceForm.config,
 }, showDeployCatalyst || undefined);
 setConfiguringSub(null);
 if (showDeployCatalyst) await loadTenantClusters(showDeployCatalyst);
 } catch { /* silent */ }
 setSavingDataSource(false);
 };

 // Remove data source
 const handleRemoveDataSource = async (clusterId: string, subName: string) => {
 try {
 await api.catalysts.removeDataSource(clusterId, subName, showDeployCatalyst || undefined);
 if (showDeployCatalyst) await loadTenantClusters(showDeployCatalyst);
 } catch { /* silent */ }
 };

 // Delete a cluster
 const handleDeleteCluster = async (clusterId: string) => {
 if (!showDeployCatalyst) return;
 try {
 await api.catalysts.deleteCluster(clusterId, showDeployCatalyst);
 await loadTenantClusters(showDeployCatalyst);
 } catch { /* silent */ }
 };

 // Company Reset handler
 const handleResetCompany = async () => {
  if (!showResetConfirm || resetting) return;
  const tenant = tenants.find(t => t.id === showResetConfirm);
  if (!tenant || resetConfirmText !== tenant.name) return;
  setResetting(true);
  try {
   const res = await api.tenants.reset(showResetConfirm);
   setResetResult({ deletedRows: res.deletedRows, tablesCleared: res.tablesCleared });
  } catch { /* silent */ }
  setResetting(false);
 };

 // Edit Entitlements handler
 const openEditEntitlements = (tenant: Tenant) => {
 setShowEditEntitlements(tenant.id);
 setEntitlementForm({
 maxUsers: tenant.entitlements.maxUsers,
 maxAgents: tenant.entitlements.maxAgents,
 ssoEnabled: tenant.entitlements.ssoEnabled,
 apiAccess: tenant.entitlements.apiAccess,
 customBranding: tenant.entitlements.customBranding,
 dataRetentionDays: tenant.entitlements.dataRetentionDays,
 autonomyTiers: [...tenant.entitlements.autonomyTiers],
 llmTiers: [...tenant.entitlements.llmTiers],
 features: [...tenant.entitlements.features]});
 };

 const handleSaveEntitlements = async () => {
 if (savingEntitlements || !showEditEntitlements) return;
 setSavingEntitlements(true);
 try {
 await api.tenants.updateEntitlements(showEditEntitlements, entitlementForm);
 const res = await api.tenants.list();
 setTenants(res.tenants);
 setShowEditEntitlements(null);
 } catch { /* silent */ }
 setSavingEntitlements(false);
 };

 useEffect(() => {
 async function load() {
 setLoading(true);
 try {
 const res = await api.tenants.list();
 setTenants(res.tenants);
 } catch { /* silent */ }
 setLoading(false);
 }
 load();
 }, []);

 const tabs = [
 { id: 'overview', label: 'All Tenants', icon: <Building2 size={14} />, count: tenants.length },
 { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
 { id: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} /> },
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
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <div className="flex items-center gap-3">
 <div className=" w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
 <Building2 className="w-5 h-5 text-accent"/>
 </div>
 <div>
 <h1 className="text-2xl font-bold t-primary">Client Access Layer</h1>
 <p className="text-sm t-muted">Multi-tenant management — SaaS, On-Premise, Hybrid</p>
 </div>
 </div>
 <Button variant="primary" size="sm" onClick={() => setShowOnboard(true)} title="Create a new tenant (client) and initial configuration"><Plus size={14} /> Onboard Tenant</Button>
 </div>

 {/* Onboard Modal */}
 {showOnboard && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Onboard New Tenant</h3>
 <button onClick={() => setShowOnboard(false)} className="text-gray-400 hover:text-gray-400" title="Close onboarding"> <X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div><label className="text-xs t-muted">Company Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.name} onChange={e => setOnboardForm(p => ({ ...p, name: e.target.value }))} placeholder="Acme Corp" /></div>
 <div><label className="text-xs t-muted">Slug (URL-safe ID)</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm font-mono" value={onboardForm.slug} onChange={e => setOnboardForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="acme-corp" /></div>
 <div><label className="text-xs t-muted">Industry</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.industry} onChange={e => setOnboardForm(p => ({ ...p, industry: e.target.value }))}><option value="general">General</option><option value="fmcg">FMCG</option><option value="healthcare">Healthcare</option><option value="mining">Mining</option><option value="manufacturing">Manufacturing</option><option value="financial_services">Financial Services</option></select></div>
 <div><label className="text-xs t-muted">Plan</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.plan} onChange={e => setOnboardForm(p => ({ ...p, plan: e.target.value }))}><option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div>
 <div><label className="text-xs t-muted">Deployment Model</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.deploymentModel} onChange={e => setOnboardForm(p => ({ ...p, deploymentModel: e.target.value }))}><option value="saas">SaaS (Cloud)</option><option value="on-premise">On-Premise</option><option value="hybrid">Hybrid</option></select></div>
 <div><label className="text-xs t-muted">Region</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.region} onChange={e => setOnboardForm(p => ({ ...p, region: e.target.value }))} placeholder="af-south-1" /></div>
 </div>
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowOnboard(false)} title="Cancel onboarding">Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleOnboard} disabled={onboarding || !onboardForm.name.trim() || !onboardForm.slug.trim()} title="Create the tenant and seed basic setup">
 {onboarding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Onboard
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Summary Cards */}
 <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
 <Card>
 <span className="text-xs t-secondary">Total Tenants</span>
 <p className="text-2xl font-bold t-primary mt-1">{tenants.length}</p>
 <span className="text-xs text-emerald-400">{tenants.filter(t => t.status === 'active').length} active</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">SaaS</span>
 <p className="text-2xl font-bold text-accent mt-1">{tenants.filter(t => t.deploymentModel === 'saas').length}</p>
 <span className="text-xs t-secondary">cloud-hosted</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">On-Premise</span>
 <p className="text-2xl font-bold text-accent mt-1">{tenants.filter(t => t.deploymentModel === 'on-premise').length}</p>
 <span className="text-xs t-secondary">self-hosted</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Hybrid</span>
 <p className="text-2xl font-bold text-accent mt-1">{tenants.filter(t => t.deploymentModel === 'hybrid').length}</p>
 <span className="text-xs t-secondary">mixed deployment</span>
 </Card>
 </div>

 <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

 {activeTab === 'overview' && (
 <TabPanel>
 <div className="space-y-4">
 {tenants.map((tenant) => (
 <Card
 key={tenant.id}
 hover
 onClick={() => setExpandedTenant(expandedTenant === tenant.id ? null : tenant.id)}
 >
 <div className="flex items-start justify-between">
 <div className="flex items-start gap-4">
 <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-accent/20 to-accent/10 flex items-center justify-center text-lg font-bold text-accent">
 {tenant.name.charAt(0)}
 </div>
 <div>
 <h3 className="text-base font-semibold t-primary">{tenant.name}</h3>
 <div className="flex flex-wrap items-center gap-2 mt-1">
 {deploymentIcon(tenant.deploymentModel)}
 <Badge variant={deploymentColor(tenant.deploymentModel) as 'info' | 'warning' | 'default'} size="sm">
 {tenant.deploymentModel}
 </Badge>
 <Badge variant="outline" size="sm">{tenant.plan}</Badge>
 <Badge variant="outline" size="sm">{tenant.industry}</Badge>
 <span className="text-xs t-secondary">{tenant.region}</span>
 </div>
 </div>
 </div>
 <div className="flex items-center gap-3">
 {statusBadge(tenant.status)}
 {expandedTenant === tenant.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
 </div>
 </div>

 {/* Quick Stats */}
 <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3 mt-4">
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Layers</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.layers.length}/5</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Catalysts</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.catalystClusters.length}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Max Agents</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.maxAgents}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Max Users</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.maxUsers}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Region</span>
 <p className="text-sm font-bold t-primary">{tenant.region}</p>
 </div>
 </div>

 {/* Expanded Details */}
 {expandedTenant === tenant.id && (
 <div className="mt-4 space-y-4 animate-fadeIn">
 {/* Entitlements */}
 <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
 <Shield size={14} className="text-accent" /> Feature Entitlements
 </h4>
 <div className="flex flex-wrap gap-1.5">
 {tenant.entitlements.features.map((f) => (
 <Badge key={f} variant="outline" size="sm">{f}</Badge>
 ))}
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-3">
 <div>
 <span className="text-[10px] text-gray-400">Autonomy Tiers</span>
 <div className="flex gap-1 mt-1">
 {tenant.entitlements.autonomyTiers.map(t => (
 <Badge key={t} variant="info" size="sm">{t}</Badge>
 ))}
 </div>
 </div>
 <div>
 <span className="text-[10px] text-gray-400">LLM Tiers</span>
 <div className="flex gap-1 mt-1">
 {tenant.entitlements.llmTiers.map(t => (
 <Badge key={t} variant="info" size="sm">{t}</Badge>
 ))}
 </div>
 </div>
 <div>
 <span className="text-[10px] text-gray-400">Flags</span>
 <div className="flex gap-2 mt-1 text-xs">
 <span className={tenant.entitlements.ssoEnabled ? 'text-emerald-400' : 'text-gray-400'}>
 {tenant.entitlements.ssoEnabled ? <IconCheck size={10} /> : <IconCross size={10} />} SSO
 </span>
 <span className={tenant.entitlements.apiAccess ? 'text-emerald-400' : 'text-gray-400'}>
 {tenant.entitlements.apiAccess ? <IconCheck size={10} /> : <IconCross size={10} />} API
 </span>
 <span className={tenant.entitlements.customBranding ? 'text-emerald-400' : 'text-gray-400'}>
 {tenant.entitlements.customBranding ? <IconCheck size={10} /> : <IconCross size={10} />} Branding
 </span>
 </div>
 </div>
 </div>
 </div>

 {/* Infrastructure */}
 <div className="p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-sm font-semibold t-primary mb-3 flex items-center gap-2">
 <Server size={14} className="text-accent" /> Infrastructure
 </h4>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
 <div className="p-3 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Deployment</span>
 <p className="text-sm font-medium t-primary">{tenant.deploymentModel}</p>
 </div>
 <div className="p-3 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Plan</span>
 <p className="text-sm font-medium t-primary">{tenant.plan}</p>
 </div>
 <div className="p-3 rounded bg-[var(--bg-secondary)]">
 <span className="text-[10px] text-gray-400">Region</span>
 <p className="text-sm font-medium t-primary">{tenant.region}</p>
 </div>
 </div>
 </div>

 <div className="flex gap-2">
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openManageUsers(tenant.id); }} title="View and manage users for this tenant"><Users size={12} /> Manage Users</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openDeployCatalyst(tenant.id); }} title="Deploy catalyst clusters for this tenant"><Bot size={12} /> Deploy Catalysts</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openManageCatalysts(tenant.id); }} title="Configure clusters, sub-catalysts, and data sources"><Settings size={12} /> Manage Catalysts</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openEditEntitlements(tenant); }} title="Edit plan entitlements and feature access"><Layers size={12} /> Edit Entitlements</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowResetConfirm(tenant.id); setResetResult(null); setResetConfirmText(''); }} title="Reset company — delete all insights and start fresh" className="!text-red-500 !border-red-500/30 hover:!bg-red-500/10"><Trash2 size={12} /> Reset Company</Button>
 </div>
 </div>
 )}
 </Card>
 ))}
 </div>
 </TabPanel>
 )}

 {activeTab === 'entitlements' && (
 <TabPanel>
 <Card>
 <h3 className="text-lg font-semibold t-primary mb-4">Plan Comparison</h3>
 <div className="overflow-x-auto">
 <table className="w-full text-sm">
 <thead>
 <tr className="border-b border-[var(--border-card)]">
 <th className="text-left py-3 text-gray-400 font-medium">Feature</th>
 <th className="text-center py-3 text-gray-400 font-medium">Starter</th>
 <th className="text-center py-3 text-gray-400 font-medium">Professional</th>
 <th className="text-center py-3 text-gray-400 font-medium">Enterprise</th>
 </tr>
 </thead>
 <tbody className="text-gray-400">
 {[
 { feature: 'Atheon Layers', starter: '2', pro: '4', enterprise: '5 (all)' },
 { feature: 'Catalyst Clusters', starter: '1', pro: '5', enterprise: 'Unlimited' },
 { feature: 'Max Agents', starter: '5', pro: '25', enterprise: '50+' },
 { feature: 'Max Users', starter: '10', pro: '100', enterprise: '200+' },
 { feature: 'Deployment Model', starter: 'SaaS only', pro: 'SaaS', enterprise: 'SaaS / On-Prem / Hybrid' },
 { feature: 'Autonomy Tiers', starter: 'Read-only', pro: 'Read + Assisted', enterprise: 'All tiers' },
 { feature: 'LLM Tiers', starter: 'Tier 1', pro: 'Tier 1-2', enterprise: 'All tiers + Custom LoRA' },
 { feature: 'SSO', starter: '—', pro: 'Yes', enterprise: 'Yes' },
 { feature: 'API Access', starter: '—', pro: 'Yes', enterprise: 'Yes' },
 { feature: 'Custom Branding', starter: '—', pro: '—', enterprise: 'Yes' },
 { feature: 'Data Retention', starter: '90 days', pro: '180 days', enterprise: 'Custom' },
 { feature: 'Scenario Modelling', starter: '—', pro: '—', enterprise: 'Yes' },
 { feature: 'Process Mining', starter: '—', pro: 'Yes', enterprise: 'Yes' },
 { feature: 'GraphRAG Memory', starter: '—', pro: 'Yes', enterprise: 'Yes + Templates' },
 ].map((row) => (
 <tr key={row.feature} className="border-b border-[var(--border-card)]">
 <td className="py-2.5 font-medium">{row.feature}</td>
 <td className="py-2.5 text-center">{row.starter === '—' ? <XCircle size={14} className="text-gray-500 mx-auto" /> : row.starter}</td>
 <td className="py-2.5 text-center">{row.pro === '—' ? <XCircle size={14} className="text-gray-500 mx-auto" /> : row.pro}</td>
 <td className="py-2.5 text-center text-accent">{row.enterprise}</td>
 </tr>
 ))}
 </tbody>
 </table>
 </div>
 </Card>
 </TabPanel>
 )}

 {activeTab === 'infrastructure' && (
 <TabPanel>
 <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
 {[
 { model: 'SaaS (Cloud)', icon: Cloud, color: 'blue', desc: 'Fully managed on Cloudflare edge. Zero infrastructure management. Automatic scaling and updates.', features: ['Cloudflare Workers', 'D1 Database', 'Vectorize', 'Auto-scaling', 'Global CDN'] },
 { model: 'On-Premise', icon: Server, color: 'amber', desc: 'Deploy within your own infrastructure. Full data sovereignty. Customer manages compute and storage.', features: ['Kubernetes / VM', 'PostgreSQL / SQL Server', 'Weaviate / Local Vector DB', 'Customer-managed', 'Air-gapped option'] },
 { model: 'Hybrid', icon: GitBranch, color: 'sky', desc: 'Sensitive data on-premise, compute at the edge. Best of both worlds for regulated industries.', features: ['Edge compute + Local DB', 'Split data plane', 'Pinecone / Weaviate', 'Compliance-ready', 'Selective sync'] },
 ].map((infra) => {
 const Icon = infra.icon;
 const colorMap: Record<string, { bg: string; text: string }> = {
 blue: { bg: 'bg-blue-500/10', text: 'text-blue-400' },
 amber: { bg: 'bg-accent/10', text: 'text-accent' },
 sky: { bg: 'bg-sky-50', text: 'text-sky-600' }};
 const colors = colorMap[infra.color] || colorMap.blue;
 return (
 <Card key={infra.model}>
 <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center mb-3`}>
 <Icon className={`w-5 h-5 ${colors.text}`} />
 </div>
 <h3 className="text-base font-semibold t-primary">{infra.model}</h3>
 <p className="text-xs t-muted mt-1">{infra.desc}</p>
 <div className="mt-3 space-y-1.5">
 {infra.features.map((f) => (
 <div key={f} className="flex items-center gap-2 text-xs text-gray-400">
 <CheckCircle size={12} className="text-emerald-400" />
 {f}
 </div>
 ))}
 </div>
 </Card>
 );
 })}
 </div>
 </TabPanel>
 )}

 {/* Manage Users Modal */}
 {showManageUsers && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Manage Users</h3>
 <button onClick={() => { setShowManageUsers(null); setShowAddUser(false); }} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
 </div>

 {loadingUsers ? (
 <div className="flex items-center justify-center py-8"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
 ) : (
 <>
 <div className="space-y-2">
 {tenantUsers.length === 0 && <p className="text-sm t-secondary py-4 text-center">No users found for this tenant.</p>}
 {tenantUsers.map((u) => (
 <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <div>
 <p className="text-sm font-medium t-primary">{u.name}</p>
 <p className="text-xs t-muted">{u.email}</p>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant={u.status === 'active' ? 'success' : 'default'} size="sm">{u.status}</Badge>
 <Badge variant="outline" size="sm">{u.role}</Badge>
 </div>
 </div>
 ))}
 </div>

 {showAddUser ? (
 <div className="space-y-3 p-4 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)]">
 <h4 className="text-sm font-semibold t-primary">Add New User</h4>
 <div><label className="text-xs t-muted">Email</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={addUserForm.email} onChange={e => setAddUserForm(p => ({ ...p, email: e.target.value }))} placeholder="user@company.com" /></div>
 <div><label className="text-xs t-muted">Full Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={addUserForm.name} onChange={e => setAddUserForm(p => ({ ...p, name: e.target.value }))} placeholder="John Smith" /></div>
 <div><label className="text-xs t-muted">Role</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={addUserForm.role} onChange={e => setAddUserForm(p => ({ ...p, role: e.target.value }))}><option value="admin">Admin</option><option value="executive">Executive</option><option value="manager">Manager</option><option value="analyst">Analyst</option><option value="operator">Operator</option></select></div>
 <div className="flex gap-3">
 <Button variant="secondary" size="sm" onClick={() => setShowAddUser(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleAddUser} disabled={!addUserForm.email.trim() || !addUserForm.name.trim() || addingUser}>
 {addingUser ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Add User
 </Button>
 </div>
 </div>
 ) : (
 <Button variant="primary" size="sm" onClick={() => setShowAddUser(true)}><Plus size={14} /> Add User</Button>
 )}
 </>
 )}
 </div>
 </div></Portal>
 )}

 {/* Deploy Catalyst Modal— Enhanced with Industry Templates */}
 {showDeployCatalyst && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-3xl space-y-4 max-h-[90vh] overflow-y-auto">

 {/* Header */}
 <div className="flex items-center justify-between">
 <div className="flex items-center gap-3">
 {(deployStep === 'customize' || deployStep === 'manage') && deployStep !== 'manage' && (
 <button onClick={() => { setDeployStep('choose'); setSelectedIndustry(null); }} className="text-gray-400 hover:text-accent"><ArrowLeft size={18} /></button>
 )}
 <h3 className="text-lg font-semibold t-primary">
 {deployStep === 'choose' && 'Deploy Catalyst Clusters'}
 {deployStep === 'customize' && `Customize ${templates.find(t => t.industry === selectedIndustry)?.label || ''} Template`}
 {deployStep === 'deploying' && 'Deploying Catalysts...'}
 {deployStep === 'done' && 'Deployment Complete'}
 {deployStep === 'manage' && 'Manage Catalyst Clusters'}
 </h3>
 </div>
 <button onClick={() => setShowDeployCatalyst(null)} className="text-gray-400 hover:text-accent"><X size={18} /></button>
 </div>

 {/* Step 1: Choose Industry Template */}
 {deployStep === 'choose' && (
 <div className="space-y-4">
 <p className="text-sm t-muted">Select an industry template to deploy pre-configured catalyst clusters with sub-catalysts.</p>
 {loadingTemplates ? (
 <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
 ) : (
 <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
 {templates.map(tmpl => (
 <button
 key={tmpl.industry}
 onClick={() => selectIndustryTemplate(tmpl.industry)}
 className="text-left p-4 rounded-xl border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:border-accent hover:bg-accent/5 transition-all group"
 >
 <div className="flex items-center gap-2 mb-2">
 <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
 <Zap size={16} className="text-accent" />
 </div>
 <h4 className="text-sm font-semibold t-primary group-hover:text-accent">{tmpl.label}</h4>
 </div>
 <p className="text-xs t-muted line-clamp-2">{tmpl.description}</p>
 <div className="flex items-center gap-2 mt-3">
 <Badge variant="info" size="sm">{tmpl.clusterCount} clusters</Badge>
 <Badge variant="outline" size="sm">{tmpl.clusters.reduce((a, c) => a + c.subCatalystCount, 0)} sub-catalysts</Badge>
 </div>
 </button>
 ))}
 </div>
 )}

 {/* Or deploy single cluster manually */}
 <div className="border-t border-[var(--border-card)] pt-4">
 <p className="text-xs t-muted mb-3">Or deploy a single custom catalyst cluster:</p>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 <div><label className="text-xs t-muted">Cluster Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.name} onChange={e => setCatalystForm(p => ({ ...p, name: e.target.value }))} placeholder="finance-catalyst-01" /></div>
 <div><label className="text-xs t-muted">Domain</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.domain} onChange={e => setCatalystForm(p => ({ ...p, domain: e.target.value }))}><option value="finance">Finance</option><option value="procurement">Procurement</option><option value="supply-chain">Supply Chain</option><option value="hr">Human Resources</option><option value="sales">Sales</option><option value="operations">Operations</option></select></div>
 <div><label className="text-xs t-muted">Autonomy Tier</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.autonomy_tier} onChange={e => setCatalystForm(p => ({ ...p, autonomy_tier: e.target.value }))}><option value="read-only">Read-Only</option><option value="assisted">Assisted</option><option value="supervised">Supervised</option><option value="autonomous">Autonomous</option></select></div>
 </div>
 <div className="flex gap-3 mt-3">
 <Button variant="primary" size="sm" onClick={handleDeployCatalyst} disabled={!catalystForm.name.trim() || deployingCatalyst} title="Deploy a single custom catalyst cluster">
 {deployingCatalyst ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />} Deploy Single Cluster
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Step 2: Customize Template Clusters */}
 {deployStep === 'customize' && (
 <div className="space-y-4">
 <p className="text-sm t-muted">Review and customize which clusters to deploy. Toggle individual sub-catalysts on/off before deploying.</p>
 <div className="space-y-3">
 {templateClusters.map((cluster, idx) => (
 <div key={cluster.domain + idx} className={`rounded-xl border transition-all ${
 cluster.selected ? 'border-accent/40 bg-accent/5' : 'border-[var(--border-card)] bg-[var(--bg-secondary)] opacity-60'
 }`}>
 <div className="flex items-center justify-between p-4">
 <div className="flex items-center gap-3">
 <button
 onClick={() => setTemplateClusters(prev => prev.map((c, i) => i === idx ? { ...c, selected: !c.selected } : c))}
 className="flex-shrink-0"
 >
 {cluster.selected ? (
 <ToggleRight size={24} className="text-accent" />
 ) : (
 <ToggleLeft size={24} className="text-gray-400" />
 )}
 </button>
 <div>
 <h4 className="text-sm font-semibold t-primary">{cluster.name}</h4>
 <p className="text-xs t-muted">{cluster.description}</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" size="sm">{cluster.domain}</Badge>
 <Badge variant="info" size="sm">{cluster.autonomy_tier}</Badge>
 </div>
 </div>

 {cluster.selected && (
 <div className="px-4 pb-4">
 <div className="text-xs t-muted mb-2">Sub-Catalysts ({cluster.sub_catalysts.length})</div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
 {cluster.sub_catalysts.map((sub, subIdx) => (
 <div key={sub.name} className="flex items-start gap-2 p-2 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-card)]">
 <button
 onClick={() => {
 setTemplateClusters(prev => prev.map((c, i) => {
 if (i !== idx) return c;
 const newSubs = [...c.sub_catalysts];
 newSubs[subIdx] = { ...newSubs[subIdx], enabled: !newSubs[subIdx].enabled };
 return { ...c, sub_catalysts: newSubs };
 }));
 }}
 className="flex-shrink-0 mt-0.5"
 >
 {sub.enabled ? (
 <CheckCircle size={14} className="text-emerald-500" />
 ) : (
 <XCircle size={14} className="text-gray-400" />
 )}
 </button>
 <div className="min-w-0">
 <span className={`text-xs font-medium ${sub.enabled ? 't-primary' : 'text-gray-400'}`}>{sub.name}</span>
 <p className="text-[10px] t-muted truncate">{sub.description}</p>
 </div>
 </div>
 ))}
 </div>
 </div>
 )}
 </div>
 ))}
 </div>

 <div className="flex items-center justify-between pt-2">
 <span className="text-xs t-muted">
 {templateClusters.filter(c => c.selected).length} of {templateClusters.length} clusters selected
 </span>
 <div className="flex gap-3">
 <Button variant="secondary" size="sm" onClick={() => { setDeployStep('choose'); setSelectedIndustry(null); }} title="Back to industry template selection">Back</Button>
 <Button variant="primary" size="sm" onClick={handleDeployTemplate} disabled={templateClusters.filter(c => c.selected).length === 0} title="Deploy selected clusters and sub-catalysts into this tenant">
 <Zap size={14} /> Deploy {templateClusters.filter(c => c.selected).length} Clusters
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Step 3: Deploying animation */}
 {deployStep === 'deploying' && (
 <div className="flex flex-col items-center justify-center py-12 space-y-4">
 <div className="w-16 h-16 rounded-2xl bg-accent/10 flex items-center justify-center">
 <Loader2 className="w-8 h-8 text-accent animate-spin" />
 </div>
 <p className="text-sm t-primary font-medium">Deploying catalyst clusters...</p>
 <p className="text-xs t-muted">Creating clusters and sub-catalysts for {templates.find(t => t.industry === selectedIndustry)?.label}</p>
 </div>
 )}

 {/* Step 4: Done */}
 {deployStep === 'done' && deployResult && (
 <div className="flex flex-col items-center justify-center py-8 space-y-4">
 <div className="w-16 h-16 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
 <CheckCircle className="w-8 h-8 text-emerald-500" />
 </div>
 <div className="text-center">
 <p className="text-lg font-semibold t-primary">{deployResult.clustersCreated} Catalyst Clusters Deployed</p>
 <p className="text-sm t-muted mt-1">Industry: {templates.find(t => t.industry === selectedIndustry)?.label}</p>
 {deployResult.existingClusters > 0 && (
 <p className="text-xs text-amber-500 mt-1">Note: This tenant already had {deployResult.existingClusters} existing cluster(s)</p>
 )}
 </div>
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowDeployCatalyst(null)} title="Close deployment wizard">Close</Button>
 <Button variant="primary" size="sm" onClick={() => { if (showDeployCatalyst) openManageCatalysts(showDeployCatalyst); }} title="Go to cluster management for this tenant">
 <Settings size={14} /> Manage Clusters
 </Button>
 </div>
 </div>
 )}

 {/* Manage Mode: View existing clusters, toggle sub-catalysts, configure data sources */}
 {deployStep === 'manage' && (
 <div className="space-y-4">
 {loadingClusters ? (
 <div className="flex items-center justify-center py-12"><Loader2 className="w-6 h-6 text-accent animate-spin" /></div>
 ) : tenantClusters.length === 0 ? (
 <div className="text-center py-8">
 <p className="text-sm t-muted">No catalyst clusters deployed for this tenant.</p>
 <Button variant="primary" size="sm" className="mt-3" onClick={() => { setDeployStep('choose'); loadTemplates(); }} title="Start deploying catalyst templates for this tenant">
 <Zap size={14} /> Deploy Catalysts
 </Button>
 </div>
 ) : (
 <>
 <div className="flex items-center justify-between">
 <p className="text-sm t-muted">{tenantClusters.length} cluster(s) deployed</p>
 <Button variant="secondary" size="sm" onClick={() => { setDeployStep('choose'); loadTemplates(); }} title="Add more catalyst templates to this tenant">
 <Plus size={14} /> Add More
 </Button>
 </div>
 <div className="space-y-3">
 {tenantClusters.map(cluster => (
 <div key={cluster.id} className="rounded-xl border border-[var(--border-card)] bg-[var(--bg-secondary)]">
 <button
 className="w-full flex items-center justify-between p-4 text-left"
 onClick={() => setExpandedCluster(expandedCluster === cluster.id ? null : cluster.id)}
 >
 <div className="flex items-center gap-3">
 <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
 <Bot size={16} className="text-accent" />
 </div>
 <div>
 <h4 className="text-sm font-semibold t-primary">{cluster.name}</h4>
 <p className="text-xs t-muted">{cluster.description}</p>
 </div>
 </div>
 <div className="flex items-center gap-2">
 <Badge variant="outline" size="sm">{cluster.domain}</Badge>
 <Badge variant={cluster.status === 'active' ? 'success' : 'default'} size="sm">{cluster.status}</Badge>
 <Badge variant="info" size="sm">{cluster.autonomyTier}</Badge>
 {expandedCluster === cluster.id ? <ChevronUp size={14} className="text-gray-400" /> : <ChevronDown size={14} className="text-gray-400" />}
 </div>
 </button>

 {expandedCluster === cluster.id && (
 <div className="px-4 pb-4 space-y-3">
 {/* Sub-catalysts list */}
 <div className="text-xs font-medium t-primary">Sub-Catalysts ({(cluster.subCatalysts || []).length})</div>
 {(cluster.subCatalysts || []).map((sub: SubCatalyst) => (
 <div key={sub.name} className="flex items-center justify-between p-3 rounded-lg bg-[var(--bg-primary)] border border-[var(--border-card)]">
 <div className="flex items-center gap-3">
 <button
 onClick={() => handleToggleSubCatalyst(cluster.id, sub.name)}
 disabled={togglingSubCatalyst === `${cluster.id}-${sub.name}`}
 className="flex-shrink-0"
 >
 {togglingSubCatalyst === `${cluster.id}-${sub.name}` ? (
 <Loader2 size={18} className="text-accent animate-spin" />
 ) : sub.enabled ? (
 <ToggleRight size={22} className="text-emerald-500" />
 ) : (
 <ToggleLeft size={22} className="text-gray-400" />
 )}
 </button>
 <div>
 <span className={`text-xs font-medium ${sub.enabled ? 't-primary' : 'text-gray-400 line-through'}`}>{sub.name}</span>
 <p className="text-[10px] t-muted">{sub.description}</p>
 {sub.data_source && (
 <div className="flex items-center gap-1 mt-1">
 <Badge variant="info" size="sm">
 {sub.data_source.type === 'erp' && <><Database size={10} /> ERP</>}
 {sub.data_source.type === 'email' && <><Mail size={10} /> Email</>}
 {sub.data_source.type === 'cloud_storage' && <><HardDrive size={10} /> Cloud</>}
 {sub.data_source.type === 'upload' && <><Upload size={10} /> Upload</>}
 </Badge>
 </div>
 )}
 </div>
 </div>
 <div className="flex items-center gap-1">
 <button
 onClick={() => {
 setConfiguringSub({ clusterId: cluster.id, subName: sub.name });
 setDataSourceForm(
 sub.data_source
 ? { type: sub.data_source.type, config: sub.data_source.config as Record<string, string> }
 : { type: 'erp', config: {} }
 );
 }}
 className="p-1.5 rounded-lg hover:bg-accent/10 text-gray-400 hover:text-accent transition-colors"
 title="Configure data source"
 >
 <Database size={14} />
 </button>
 {sub.data_source && (
 <button
 onClick={() => handleRemoveDataSource(cluster.id, sub.name)}
 className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors"
 title="Remove data source"
 >
 <Trash2 size={14} />
 </button>
 )}
 </div>
 </div>
 ))}

 {/* Delete cluster */}
 <div className="flex justify-end pt-2 border-t border-[var(--border-card)]">
 <Button
 variant="secondary"
 size="sm"
 onClick={() => { if (confirm('Delete this catalyst cluster?')) handleDeleteCluster(cluster.id); }}
 >
 <Trash2 size={12} /> Remove Cluster
 </Button>
 </div>
 </div>
 )}
 </div>
 ))}
 </div>
 </>
 )}
 </div>
 )}

 </div>
 </div></Portal>
 )}

 {/* Configure Data Source Modal */}
 {configuringSub && (
 <Portal><div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Configure Data Source</h3>
 <button onClick={() => setConfiguringSub(null)} className="text-gray-400 hover:text-accent"><X size={18} /></button>
 </div>
 <p className="text-xs t-muted">Configure the data source for <span className="font-medium t-primary">{configuringSub.subName}</span></p>

 <div className="space-y-3">
 <div>
 <label className="text-xs t-muted">Source Type</label>
 <select
 className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm"
 value={dataSourceForm.type}
 onChange={e => setDataSourceForm({ type: e.target.value, config: {} })}
 >
 <option value="erp">ERP System</option>
 <option value="email">Email / Mailbox</option>
 <option value="cloud_storage">Cloud Storage</option>
 <option value="upload">File Upload</option>
 </select>
 </div>

 {dataSourceForm.type === 'erp' && (
 <>
 <div>
 <label className="text-xs t-muted">ERP Type</label>
 <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.erp_type || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, erp_type: e.target.value } }))}>
 <option value="">Select ERP...</option>
 <option value="xero">Xero</option>
 <option value="sage">Sage</option>
 <option value="sage-pastel">Sage Pastel</option>
 <option value="oracle">Oracle</option>
 <option value="sap">SAP</option>
 <option value="quickbooks">QuickBooks</option>
 </select>
 </div>
 <div>
 <label className="text-xs t-muted">Module / Feed</label>
 <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.module || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, module: e.target.value } }))} placeholder="e.g. invoices, payments, contacts" />
 </div>
 </>
 )}

 {dataSourceForm.type === 'email' && (
 <>
 <div>
 <label className="text-xs t-muted">Mailbox Address</label>
 <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.mailbox || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, mailbox: e.target.value } }))} placeholder="reports@company.com" />
 </div>
 <div>
 <label className="text-xs t-muted">Folder Filter</label>
 <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.folder || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, folder: e.target.value } }))} placeholder="Inbox/Reports" />
 </div>
 </>
 )}

 {dataSourceForm.type === 'cloud_storage' && (
 <>
 <div>
 <label className="text-xs t-muted">Provider</label>
 <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.provider || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, provider: e.target.value } }))}>
 <option value="">Select provider...</option>
 <option value="azure_blob">Azure Blob Storage</option>
 <option value="aws_s3">AWS S3</option>
 <option value="gcs">Google Cloud Storage</option>
 <option value="sharepoint">SharePoint</option>
 <option value="onedrive">OneDrive</option>
 </select>
 </div>
 <div>
 <label className="text-xs t-muted">Path / Container</label>
 <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.path || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, path: e.target.value } }))} placeholder="/data/reports/" />
 </div>
 </>
 )}

 {dataSourceForm.type === 'upload' && (
 <div>
 <label className="text-xs t-muted">Upload Label</label>
 <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={dataSourceForm.config.label || ''} onChange={e => setDataSourceForm(p => ({ ...p, config: { ...p.config, label: e.target.value } }))} placeholder="Monthly financial reports" />
 </div>
 )}
 </div>

 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setConfiguringSub(null)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveDataSource} disabled={savingDataSource}>
 {savingDataSource ? <Loader2 size={14} className="animate-spin" /> : <Database size={14} />} Save Data Source
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Edit Entitlements Modal */}
 {showEditEntitlements && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-lg space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Edit Entitlements</h3>
 <button onClick={() => setShowEditEntitlements(null)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
 </div>
 <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
 <div><label className="text-xs t-muted">Max Users</label><input type="number" min={1} className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={String(entitlementForm.maxUsers)} onChange={e => setEntitlementForm(p => ({ ...p, maxUsers: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }))} /></div>
 <div><label className="text-xs t-muted">Max Agents</label><input type="number" min={1} className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={String(entitlementForm.maxAgents)} onChange={e => setEntitlementForm(p => ({ ...p, maxAgents: Math.max(1, parseInt(e.target.value || '1', 10) || 1) }))} /></div>
 <div><label className="text-xs t-muted">Data Retention (days)</label><input type="number" min={30} className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={String(entitlementForm.dataRetentionDays)} onChange={e => setEntitlementForm(p => ({ ...p, dataRetentionDays: Math.max(30, parseInt(e.target.value || '90', 10) || 90) }))} /></div>
 </div>

 <div className="space-y-3">
 <h4 className="text-sm font-medium t-primary">Feature Flags</h4>
 <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
 {[
 { key: 'ssoEnabled' as const, label: 'SSO Enabled' },
 { key: 'apiAccess' as const, label: 'API Access' },
 { key: 'customBranding' as const, label: 'Custom Branding' },
 ].map(({ key, label }) => (
 <label key={key} className="flex items-center gap-2 p-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] cursor-pointer">
 <input type="checkbox" checked={entitlementForm[key]} onChange={() => setEntitlementForm(p => ({ ...p, [key]: !p[key] }))} className="rounded border-[var(--border-card)]" />
 <span className="text-xs t-primary">{label}</span>
 </label>
 ))}
 </div>
 </div>

 <div className="space-y-2">
 <h4 className="text-sm font-medium t-primary">Autonomy Tiers</h4>
 <div className="flex flex-wrap gap-2">
 {['read-only', 'assisted', 'supervised', 'autonomous'].map(tier => (
 <button
 key={tier}
 onClick={() => setEntitlementForm(p => ({
 ...p,
 autonomyTiers: p.autonomyTiers.includes(tier)
 ? p.autonomyTiers.filter(t => t !== tier)
 : [...p.autonomyTiers, tier]}))}
 className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${entitlementForm.autonomyTiers.includes(tier) ? 'bg-accent/10 border-accent text-accent' : 'bg-[var(--bg-secondary)] border-[var(--border-card)] text-gray-500'}`}
 >
 {tier}
 </button>
 ))}
 </div>
 </div>

 <div className="space-y-2">
 <h4 className="text-sm font-medium t-primary">LLM Tiers</h4>
 <div className="flex flex-wrap gap-2">
 {['tier-1', 'tier-2', 'tier-3', 'custom-lora'].map(tier => (
 <button
 key={tier}
 onClick={() => setEntitlementForm(p => ({
 ...p,
 llmTiers: p.llmTiers.includes(tier)
 ? p.llmTiers.filter(t => t !== tier)
 : [...p.llmTiers, tier]}))}
 className={`px-3 py-1.5 rounded-lg text-xs border transition-all ${entitlementForm.llmTiers.includes(tier) ? 'bg-accent/10 border-accent text-accent' : 'bg-[var(--bg-secondary)] border-[var(--border-card)] text-gray-500'}`}
 >
 {tier}
 </button>
 ))}
 </div>
 </div>

 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowEditEntitlements(null)} title="Discard entitlement changes">Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveEntitlements} disabled={savingEntitlements} title="Save entitlements and feature access for this tenant">
 {savingEntitlements ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} Save Entitlements
 </Button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Reset Company Confirmation Modal */}
 {showResetConfirm && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
 {resetResult ? (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
 <CheckCircle size={20} className="text-emerald-500" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Company Reset Complete</h3>
 <p className="text-sm t-muted">{resetResult.deletedRows} rows deleted across {resetResult.tablesCleared} tables</p>
 </div>
 </div>
 <p className="text-xs t-muted">All Apex and Pulse insights have been cleared. The company now starts fresh — run catalysts to regenerate insights.</p>
 <Button variant="primary" size="sm" onClick={() => { setShowResetConfirm(null); setResetResult(null); }} title="Close reset confirmation">Done</Button>
 </>
 ) : (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
 <Trash2 size={20} className="text-red-500" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Reset Company</h3>
 <p className="text-sm t-muted">This action cannot be undone</p>
 </div>
 </div>
 <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
 <p className="text-sm t-primary">This will permanently delete all:</p>
 <ul className="text-xs t-muted mt-2 space-y-1 list-disc list-inside">
 <li>Health scores and risk alerts</li>
 <li>Executive briefings and scenarios</li>
 <li>Process metrics and anomalies</li>
 <li>Process flows and correlations</li>
 </ul>
 <p className="text-xs t-muted mt-2">The company will start fresh with empty Apex and Pulse pages.</p>
 </div>
 <div>
 <label className="text-xs t-muted block mb-1">Type the company name to confirm: <strong className="t-primary">{tenants.find(t => t.id === showResetConfirm)?.name}</strong></label>
 <input
 className="w-full px-3 py-2 rounded-lg border text-sm"
 style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)', color: 'var(--text-primary)' }}
 value={resetConfirmText}
 onChange={e => setResetConfirmText(e.target.value)}
 placeholder="Company name..."
 />
 </div>
 <div className="flex gap-3 pt-1">
 <Button variant="secondary" size="sm" onClick={() => setShowResetConfirm(null)} title="Cancel company reset">Cancel</Button>
 <button
 onClick={handleResetCompany}
 disabled={resetting || resetConfirmText !== (tenants.find(t => t.id === showResetConfirm)?.name || '')}
 className="px-4 py-2 rounded-lg text-sm font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-500 text-white hover:bg-red-600"
 title="Confirm and delete all insights for this company"
 >
 {resetting ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Trash2 size={14} className="inline mr-1" />}
 Reset Company
 </button>
 </div>
 </>
 )}
 </div>
 </div></Portal>
 )}
 </div>
 );
}
