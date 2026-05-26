import { useState, useEffect, useCallback, useMemo } from "react";
import { Portal } from "@/components/ui/portal";
import { Card } from "@/components/ui/card";
import { HeroHeader } from "@/components/ui/hero-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { LoadingState } from "@/components/ui/state";
import { MaturityBadge } from "@/components/MaturityBadge";
import { ImplementationDot } from "@/components/ImplementationDot";
import { api } from "@/lib/api";
import type { Tenant, IAMUser, CatalystIndustryTemplate, CatalystClusterTemplate, ClusterItem, SubCatalyst, Maturity } from "@/lib/api";
import {
 Building2, Cloud, Server, GitBranch, Users, Bot, Shield,
 ChevronDown, ChevronUp, CheckCircle, XCircle, Plus, Layers, Loader2, X,
 Zap, ToggleLeft, ToggleRight, Database, Mail, HardDrive, Upload, Settings, Trash2, ArrowLeft, AlertCircle, Archive, ArchiveRestore, RefreshCw
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
 if (status === 'archived') return <Badge variant="default">archived</Badge>;
 return <Badge variant="default">{status}</Badge>;
};

// Sort order for cluster maturity: production-ready first, planned last.
const MATURITY_RANK: Record<Maturity, number> = { production: 0, partial: 1, planned: 2 };

// When a template cluster is missing `implementationSummary` (e.g. backend
// hasn't shipped yet) we default to 'production' so sort/filter behaviour
// stays unchanged — the cluster will still render without a badge.
function clusterMaturity(c: CatalystClusterTemplate): Maturity {
 return c.implementationSummary?.maturity ?? 'production';
}

export function TenantsPage() {
 const { activeTab, setActiveTab } = useTabState('overview');
 const [expandedTenant, setExpandedTenant] = useState<string | null>(null);
 const [tenants, setTenants] = useState<Tenant[]>([]);
 const [loading, setLoading] = useState(true);
 const [showOnboard, setShowOnboard] = useState(false);
 const [onboardForm, setOnboardForm] = useState({ name: '', slug: '', industry: 'general', plan: 'starter', deploymentModel: 'saas', region: 'af-south-1' });
 const [onboarding, setOnboarding] = useState(false);
 const [actionError, setActionError] = useState<string | null>(null);

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
 // Implementation-maturity filter for the customize step. All tiers are
 // shown by default; state is not persisted — resets on each page load /
 // modal open (users who care will re-toggle).
 const [maturityFilter, setMaturityFilter] = useState<Record<Maturity, boolean>>({
 production: true, partial: true, planned: true});

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

 // Delete Company modal state
 const [showDeleteConfirm, setShowDeleteConfirm] = useState<string | null>(null);
 const [deleting, setDeleting] = useState(false);
 const [deleteResult, setDeleteResult] = useState<{ deletedRows: number; tablesCleared: number } | null>(null);
 const [deleteConfirmText, setDeleteConfirmText] = useState('');

 // Archive Company modal state
 const [showArchiveConfirm, setShowArchiveConfirm] = useState<string | null>(null);
 const [archiving, setArchiving] = useState(false);

 // Re-seed VantaX demo state
 const [showReseedConfirm, setShowReseedConfirm] = useState(false);
 const [reseeding, setReseeding] = useState(false);
 const [reseedResult, setReseedResult] = useState<{ clusters: number; subCatalysts: number; positiveRuns: { count: number; totalItems: number; matchRate: number }; negativeRuns: { count: number; totalItems: number; matchRate: number }; metrics: number; risks: number; healthScore: number } | null>(null);

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
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to create tenant'); }
 setOnboarding(false);
 };

 // Manage Users handlers
 const openManageUsers = async (tenantId: string) => {
 setShowManageUsers(tenantId);
 setLoadingUsers(true);
 try {
 const res = await api.iam.users(tenantId);
 setTenantUsers(res.users);
  } catch (err) { console.error('Failed to load tenant users', err); setTenantUsers([]); }
  setLoadingUsers(false);
 };

 const handleAddUser = async () => {
 if (!addUserForm.email.trim() || !addUserForm.name.trim() || addingUser || !showManageUsers) return;
 setAddingUser(true);
 try {
 await api.iam.createUser({
 email: addUserForm.email.trim(),
 name: addUserForm.name.trim(),
 role: addUserForm.role}, showManageUsers);
 const res = await api.iam.users(showManageUsers);
 setTenantUsers(res.users);
 setAddUserForm({ email: '', name: '', role: 'analyst' });
 setShowAddUser(false);
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to add user'); }
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
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to deploy catalyst'); }
 setDeployingCatalyst(false);
 };

 // Load industry templates
 const loadTemplates = useCallback(async () => {
 if (templates.length > 0) return;
 setLoadingTemplates(true);
 try {
 const res = await api.catalysts.templates();
 setTemplates(res.templates);
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to load templates'); }
 setLoadingTemplates(false);
 }, [templates.length]);

 // Select an industry template
 const selectIndustryTemplate = useCallback((industry: string) => {
 setSelectedIndustry(industry);
 const tmpl = templates.find(t => t.industry === industry);
 if (tmpl) {
 // Default sort: production clusters first, then partial, then planned.
 const sorted = [...tmpl.clusters].sort(
 (a, b) => MATURITY_RANK[clusterMaturity(a)] - MATURITY_RANK[clusterMaturity(b)]
 );
 setTemplateClusters(sorted.map(c => ({ ...c, selected: true })));
 // Reset maturity filter to "all on" whenever a template is chosen.
 setMaturityFilter({ production: true, partial: true, planned: true });
 setDeployStep('customize');
 }
 }, [templates]);

 // Visible cluster list = filtered by active maturity tiers. Preserves the
 // original sorted order (production -> partial -> planned).
 const visibleTemplateClusters = useMemo(
 () => templateClusters
 .map((c, originalIndex) => ({ c, originalIndex }))
 .filter(({ c }) => maturityFilter[clusterMaturity(c)]),
 [templateClusters, maturityFilter]
 );

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
 } catch (err) {
 setActionError(err instanceof Error ? err.message : 'Failed to deploy template');
 setDeployStep('customize');
 }
 };

 // Load tenant's existing clusters for management
 const loadTenantClusters = async (tenantId: string) => {
 setLoadingClusters(true);
 try {
 const res = await api.catalysts.clusters(tenantId);
 setTenantClusters(res.clusters);
  } catch (err) { console.error('Failed to load tenant clusters', err); setTenantClusters([]); }
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
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to toggle sub-catalyst'); }
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
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to save data source'); }
 setSavingDataSource(false);
 };

 // Remove data source
 const handleRemoveDataSource = async (clusterId: string, subName: string) => {
 try {
 await api.catalysts.removeDataSource(clusterId, subName, showDeployCatalyst || undefined);
 if (showDeployCatalyst) await loadTenantClusters(showDeployCatalyst);
  } catch (err) { console.error('Failed to remove data source', err); }
  };

  // Delete a cluster
  const handleDeleteCluster = async (clusterId: string) => {
 if (!showDeployCatalyst) return;
 try {
 await api.catalysts.deleteCluster(clusterId, showDeployCatalyst);
 await loadTenantClusters(showDeployCatalyst);
  } catch (err) { console.error('Failed to delete cluster', err); }
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
   } catch (err) { console.error('Failed to reset company', err); }
   setResetting(false);
 };

 // Delete Company handler
 const handleDeleteCompany = async () => {
  if (!showDeleteConfirm || deleting) return;
  const tenant = tenants.find(t => t.id === showDeleteConfirm);
  if (!tenant || deleteConfirmText !== tenant.name) return;
  setDeleting(true);
  try {
   const res = await api.tenants.delete(showDeleteConfirm);
   setDeleteResult({ deletedRows: res.deletedRows, tablesCleared: res.tablesCleared });
   // Remove from local list
   setTenants(prev => prev.filter(t => t.id !== showDeleteConfirm));
  } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to delete company'); }
  setDeleting(false);
 };

 // Archive Company handler
 const handleArchiveCompany = async () => {
  if (!showArchiveConfirm || archiving) return;
  setArchiving(true);
  try {
   await api.tenants.archive(showArchiveConfirm);
   const res = await api.tenants.list();
   setTenants(res.tenants);
   setShowArchiveConfirm(null);
  } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to archive company'); }
  setArchiving(false);
 };

 // Unarchive Company handler
 const handleUnarchiveCompany = async (tenantId: string) => {
  try {
   await api.tenants.unarchive(tenantId);
   const res = await api.tenants.list();
   setTenants(res.tenants);
  } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to restore company'); }
 };

 // Re-seed VantaX handler
 const handleReseedVantax = async () => {
  if (reseeding) return;
  setReseeding(true);
  setReseedResult(null);
  try {
   const res = await api.tenants.seedVantax();
   setReseedResult(res.seeded);
  } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to re-seed VantaX'); }
  setReseeding(false);
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
 } catch (err) { setActionError(err instanceof Error ? err.message : 'Failed to save entitlements'); }
 setSavingEntitlements(false);
 };

 useEffect(() => {
 async function load() {
 setLoading(true);
 try {
 const res = await api.tenants.list();
 setTenants(res.tenants);
  } catch (err) { console.error('Failed to load tenants', err); }
  setLoading(false);
  }
  load();
  }, []);

 const tabs = [
 { id: 'overview', label: 'All Tenants', icon: <Building2 size={14} />, count: tenants.length },
 { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
 { id: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} /> },
 ];

 if (loading) return <LoadingState variant="cards" count={4} />;

 return (
 <div className="space-y-6 animate-fadeIn">
 <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
 <HeroHeader
  icon={Building2}
  title="Tenants"
  subtitle="Multi-tenant management — SaaS, On-Premise, Hybrid"
  accent="sage"
 />
 <Button variant="primary" size="sm" onClick={() => setShowOnboard(true)} title="Create a new tenant (client) and initial configuration"><Plus size={14} /> Onboard Tenant</Button>
 </div>

 {actionError && (
 <div className="flex items-center gap-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
 <AlertCircle size={16} className="text-red-400 flex-shrink-0" />
 <p className="text-sm text-red-400 flex-1">{actionError}</p>
 <button onClick={() => setActionError(null)} className="text-red-400 hover:text-red-300"><X size={14} /></button>
 </div>
 )}

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
 <div><label className="text-xs t-muted">Industry</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={onboardForm.industry} onChange={e => setOnboardForm(p => ({ ...p, industry: e.target.value }))}><option value="general">General</option><option value="fmcg">FMCG</option><option value="healthcare">Healthcare</option><option value="mining">Mining</option><option value="manufacturing">Manufacturing</option><option value="retail">Retail</option><option value="financial_services">Financial Services</option></select></div>
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
 <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{tenants.length}</p>
 <span className="text-xs text-emerald-400">{tenants.filter(t => t.status === 'active').length} active</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">SaaS</span>
 <p className="text-headline-lg font-bold text-accent tabular-nums font-mono mt-1">{tenants.filter(t => t.deploymentModel === 'saas').length}</p>
 <span className="text-xs t-secondary">cloud-hosted</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">On-Premise</span>
 <p className="text-headline-lg font-bold text-accent tabular-nums font-mono mt-1">{tenants.filter(t => t.deploymentModel === 'on-premise').length}</p>
 <span className="text-xs t-secondary">self-hosted</span>
 </Card>
 <Card>
 <span className="text-xs t-secondary">Hybrid</span>
 <p className="text-headline-lg font-bold text-accent tabular-nums font-mono mt-1">{tenants.filter(t => t.deploymentModel === 'hybrid').length}</p>
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
 <span className="text-caption t-muted">Layers</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.layers.length}/5</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Catalysts</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.catalystClusters.length}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Max Agents</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.maxAgents}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Max Users</span>
 <p className="text-sm font-bold t-primary">{tenant.entitlements.maxUsers}</p>
 </div>
 <div className="text-center p-2 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Region</span>
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
 <span className="text-caption t-muted">Autonomy Tiers</span>
 <div className="flex gap-1 mt-1">
 {tenant.entitlements.autonomyTiers.map(t => (
 <Badge key={t} variant="info" size="sm">{t}</Badge>
 ))}
 </div>
 </div>
 <div>
 <span className="text-caption t-muted">LLM Tiers</span>
 <div className="flex gap-1 mt-1">
 {tenant.entitlements.llmTiers.map(t => (
 <Badge key={t} variant="info" size="sm">{t}</Badge>
 ))}
 </div>
 </div>
 <div>
 <span className="text-caption t-muted">Flags</span>
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
 <span className="text-caption t-muted">Deployment</span>
 <p className="text-sm font-medium t-primary">{tenant.deploymentModel}</p>
 </div>
 <div className="p-3 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Plan</span>
 <p className="text-sm font-medium t-primary">{tenant.plan}</p>
 </div>
 <div className="p-3 rounded bg-[var(--bg-secondary)]">
 <span className="text-caption t-muted">Region</span>
 <p className="text-sm font-medium t-primary">{tenant.region}</p>
 </div>
 </div>
 </div>

 <div className="flex gap-2">
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openManageUsers(tenant.id); }} title="View and manage users for this tenant"><Users size={12} /> Manage Users</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openManageCatalysts(tenant.id); }} title="Manage catalyst clusters, deploy new ones, and configure data sources"><Bot size={12} /> Manage Catalysts</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openEditEntitlements(tenant); }} title="Edit plan entitlements and feature access"><Layers size={12} /> Edit Entitlements</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowResetConfirm(tenant.id); setResetResult(null); setResetConfirmText(''); }} title="Reset company — delete all insights and start fresh" className="!text-red-500 !border-red-500/30 hover:!bg-red-500/10"><Trash2 size={12} /> Reset Company</Button>
 {tenant.status === 'archived' ? (
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); handleUnarchiveCompany(tenant.id); }} title="Restore this archived company to active status" className="!text-emerald-500 !border-emerald-500/30 hover:!bg-emerald-500/10"><ArchiveRestore size={12} /> Restore</Button>
 ) : (
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowArchiveConfirm(tenant.id); }} title="Archive company — keep data but mark inactive" className="!text-amber-500 !border-amber-500/30 hover:!bg-amber-500/10"><Archive size={12} /> Archive</Button>
 )}
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowDeleteConfirm(tenant.id); setDeleteResult(null); setDeleteConfirmText(''); }} title="Permanently delete company and ALL data" className="!text-red-600 !border-red-600/30 hover:!bg-red-600/10"><Trash2 size={12} /> Delete Company</Button>
 {tenant.slug === 'vantax' && (
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowReseedConfirm(true); setReseedResult(null); }} title="Reset and re-seed VantaX with fresh demo data" className="!text-accent !border-accent/30 hover:!bg-accent/10"><RefreshCw size={12} /> Re-seed Demo</Button>
 )}
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
 {u.lastLogin && <p className="text-caption t-muted mt-0.5">Last login: {new Date(u.lastLogin).toLocaleDateString()}</p>}
 </div>
 <div className="flex items-center gap-2">
 <Badge variant={u.status === 'active' ? 'success' : 'default'} size="sm">{u.status}</Badge>
 <select
 className="px-2 py-1 text-xs rounded border border-[var(--border-card)] bg-[var(--bg-secondary)] t-primary"
 value={u.role}
 onChange={async (e) => {
 try {
 await api.iam.updateUser(u.id, { role: e.target.value }, showManageUsers || undefined);
 const res = await api.iam.users(showManageUsers!);
 setTenantUsers(res.users);
  } catch (err) { console.error('Failed to update user role', err); }
  }}
  title="Change user role"
 >
 <option value="admin">Admin</option>
 <option value="executive">Executive</option>
 <option value="manager">Manager</option>
 <option value="analyst">Analyst</option>
 <option value="operator">Operator</option>
 </select>
 <Button variant="secondary" size="sm" onClick={async () => {
 try {
 await api.iam.resendWelcome(u.id, showManageUsers || undefined);
 setActionError(null);
 } catch (err) { console.error('Failed to send password reset', err); setActionError('Failed to send password reset'); }
 }} title="Send password reset email to this user" className="!px-2 !py-1 text-caption">Reset Pwd</Button>
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
 <Button variant="secondary" size="sm" onClick={() => setShowAddUser(false)} title="Cancel add user">Cancel</Button>
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
 {templates.map(tmpl => {
 // Aggregate cluster counts per maturity tier for the card summary.
 const tierCounts = tmpl.clusters.reduce<Record<Maturity, number>>((acc, c) => {
 const m = clusterMaturity(c);
 acc[m] = (acc[m] ?? 0) + 1;
 return acc;
 }, { production: 0, partial: 0, planned: 0 });
 return (
 <button
 key={tmpl.industry}
 onClick={() => selectIndustryTemplate(tmpl.industry)}
 className="text-left p-4 rounded-xl border border-[var(--border-card)] bg-[var(--bg-secondary)] hover:border-accent hover:bg-accent/5 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] group active:scale-[0.97]"
 >
 <div className="flex items-center gap-2 mb-2">
 <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center">
 <Zap size={16} className="text-accent" />
 </div>
 <h4 className="text-sm font-semibold t-primary group-hover:text-accent">{tmpl.label}</h4>
 </div>
 <p className="text-xs t-muted line-clamp-2">{tmpl.description}</p>
 <div className="flex flex-wrap items-center gap-2 mt-3">
 <Badge variant="info" size="sm">{tmpl.clusterCount} clusters</Badge>
 <Badge variant="outline" size="sm">{tmpl.clusters.reduce((a, c) => a + c.subCatalystCount, 0)} sub-catalysts</Badge>
 {tierCounts.production > 0 && (
 <MaturityBadge maturity="production" />
 )}
 {tierCounts.production === 0 && tierCounts.partial > 0 && (
 <MaturityBadge maturity="partial" />
 )}
 {tierCounts.production === 0 && tierCounts.partial === 0 && tierCounts.planned > 0 && (
 <MaturityBadge maturity="planned" />
 )}
 </div>
 </button>
 );
 })}
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
 <p className="text-sm t-muted">Review and customize which clusters to deploy. Toggle individual sub-catalysts on/off before deploying. Clusters are sorted production-ready first.</p>

 {/* Maturity filter — show only clusters whose implementation tier is toggled on. */}
 <div className="flex flex-wrap items-center gap-2 text-xs">
 <span className="t-muted">Show:</span>
 {(['production', 'partial', 'planned'] as Maturity[]).map(tier => {
 const active = maturityFilter[tier];
 const label = tier.charAt(0).toUpperCase() + tier.slice(1);
 const count = templateClusters.filter(c => clusterMaturity(c) === tier).length;
 return (
 <button
 key={tier}
 type="button"
 onClick={() => setMaturityFilter(prev => ({ ...prev, [tier]: !prev[tier] }))}
 className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-md border text-caption font-medium transition-colors ${
 active
 ? 'border-accent/40 bg-accent/10 text-accent'
 : 'border-[var(--border-card)] t-muted hover:border-accent/30'
 }`}
 title={`Toggle ${label} clusters`}
 aria-pressed={active}
 >
 <span className={`inline-block w-2 h-2 rounded-full ${
 tier === 'production' ? 'bg-emerald-500' : tier === 'partial' ? 'bg-amber-500' : 'bg-gray-500'
 }`} />
 {label}
 <span className="t-muted">({count})</span>
 </button>
 );
 })}
 </div>

 <div className="space-y-3">
 {visibleTemplateClusters.length === 0 ? (
 <div className="text-center py-8 text-xs t-muted">
 No clusters match the selected maturity filters.
 </div>
 ) : visibleTemplateClusters.map(({ c: cluster, originalIndex: idx }) => (
 <div key={cluster.domain + idx} className={`rounded-xl border transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${
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
 {cluster.implementationSummary && (
 <MaturityBadge
 maturity={cluster.implementationSummary.maturity}
 summary={cluster.implementationSummary}
 />
 )}
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
 <div className="min-w-0 flex-1">
 <div className="flex items-center gap-1.5">
 {sub.implementation && <ImplementationDot implementation={sub.implementation} />}
 <span className={`text-xs font-medium ${sub.enabled ? 't-primary' : 'text-gray-400'}`}>{sub.name}</span>
 </div>
 <p className="text-caption t-muted truncate">{sub.description}</p>
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
 <p className="text-caption t-muted">{sub.description}</p>
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
 className="p-1.5 rounded-lg hover:bg-accent/10 text-gray-400 hover:text-accent transition-colors active:scale-[0.97]"
 title="Configure data source"
 >
 <Database size={14} />
 </button>
 {sub.data_source && (
 <button
 onClick={() => handleRemoveDataSource(cluster.id, sub.name)}
 className="p-1.5 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-500 transition-colors active:scale-[0.97]"
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
 <option value="odoo">Odoo</option>
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
 <Button variant="secondary" size="sm" onClick={() => setConfiguringSub(null)} title="Cancel data source configuration">Cancel</Button>
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
 className={`px-3 py-1.5 rounded-lg text-xs border transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${entitlementForm.autonomyTiers.includes(tier) ? 'bg-accent/10 border-accent text-accent' : 'bg-[var(--bg-secondary)] border-[var(--border-card)] text-gray-500'}`}
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
 className={`px-3 py-1.5 rounded-lg text-xs border transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] ${entitlementForm.llmTiers.includes(tier) ? 'bg-accent/10 border-accent text-accent' : 'bg-[var(--bg-secondary)] border-[var(--border-card)] text-gray-500'}`}
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
 className="px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] disabled:opacity-40 disabled:cursor-not-allowed bg-red-500 text-white hover:bg-red-600 active:scale-[0.97]"
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

 {/* Archive Company Confirmation Modal */}
 {showArchiveConfirm && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center">
 <Archive size={20} className="text-amber-500" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Archive Company</h3>
 <p className="text-sm t-muted">Data will be preserved but company will be inactive</p>
 </div>
 </div>
 <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20">
 <p className="text-sm t-primary">This will:</p>
 <ul className="text-xs t-muted mt-2 space-y-1 list-disc list-inside">
 <li>Set the company status to <strong>archived</strong></li>
 <li>Deactivate all catalyst clusters</li>
 <li>Suspend all running agent deployments</li>
 </ul>
 <p className="text-xs t-muted mt-2">All data is preserved and the company can be restored later.</p>
 </div>
 <div className="flex gap-3 pt-1">
 <Button variant="secondary" size="sm" onClick={() => setShowArchiveConfirm(null)} title="Cancel archive">Cancel</Button>
 <button
 onClick={handleArchiveCompany}
 disabled={archiving}
 className="px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] disabled:opacity-40 disabled:cursor-not-allowed bg-amber-500 text-white hover:bg-amber-600 active:scale-[0.97]"
 title="Archive this company"
 >
 {archiving ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Archive size={14} className="inline mr-1" />}
 Archive Company
 </button>
 </div>
 </div>
 </div></Portal>
 )}

 {/* Delete Company Confirmation Modal */}
 {showDeleteConfirm && (
 <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4">
 {deleteResult ? (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
 <CheckCircle size={20} className="text-emerald-500" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Company Deleted</h3>
 <p className="text-sm t-muted">{deleteResult.deletedRows} rows deleted across {deleteResult.tablesCleared} tables</p>
 </div>
 </div>
 <p className="text-xs t-muted">The company and all associated data have been permanently removed.</p>
 <Button variant="primary" size="sm" onClick={() => { setShowDeleteConfirm(null); setDeleteResult(null); }} title="Close delete confirmation">Done</Button>
 </>
 ) : (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-red-500/10 flex items-center justify-center">
 <Trash2 size={20} className="text-red-600" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Delete Company</h3>
 <p className="text-sm t-muted">This action is permanent and cannot be undone</p>
 </div>
 </div>
 <div className="p-3 rounded-lg bg-red-500/5 border border-red-500/20">
 <p className="text-sm t-primary">This will permanently delete:</p>
 <ul className="text-xs t-muted mt-2 space-y-1 list-disc list-inside">
 <li>The company record and entitlements</li>
 <li>All users and their access</li>
 <li>All catalyst clusters and agent deployments</li>
 <li>All health scores, briefings, scenarios, and risks</li>
 <li>All process metrics, anomalies, and correlations</li>
 <li>All ERP connections and sync data</li>
 <li>All audit logs and governance data</li>
 </ul>
 <p className="text-xs text-red-400 mt-2 font-medium">This cannot be reversed. Consider archiving instead if you want to preserve data.</p>
 </div>
 <div>
 <label className="text-xs t-muted block mb-1">Type the company name to confirm: <strong className="t-primary">{tenants.find(t => t.id === showDeleteConfirm)?.name}</strong></label>
 <input
 className="w-full px-3 py-2 rounded-lg border text-sm"
 style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)', color: 'var(--text-primary)' }}
 value={deleteConfirmText}
 onChange={e => setDeleteConfirmText(e.target.value)}
 placeholder="Company name..."
 />
 </div>
 <div className="flex gap-3 pt-1">
 <Button variant="secondary" size="sm" onClick={() => setShowDeleteConfirm(null)} title="Cancel delete">Cancel</Button>
 <button
 onClick={handleDeleteCompany}
 disabled={deleting || deleteConfirmText !== (tenants.find(t => t.id === showDeleteConfirm)?.name || '')}
 className="px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] disabled:opacity-40 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700 active:scale-[0.97]"
 title="Permanently delete this company and all data"
 >
 {deleting ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <Trash2 size={14} className="inline mr-1" />}
 Delete Permanently
 </button>
 </div>
 </>
 )}
 </div>
 </div></Portal>
 )}

 {/* Re-seed VantaX Confirmation Modal */}
 {showReseedConfirm && (
 <Portal><div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => !reseeding && setShowReseedConfirm(false)}>
 <div className="bg-[var(--bg-card)] border border-[var(--border-card)] rounded-2xl p-6 max-w-md w-full space-y-4" onClick={e => e.stopPropagation()}>
 {reseedResult ? (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-emerald-500/10 flex items-center justify-center">
 <CheckCircle size={20} className="text-emerald-400" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Demo Data Re-seeded</h3>
 <p className="text-sm t-muted">VantaX demo environment is ready</p>
 </div>
 </div>
 <div className="grid grid-cols-3 gap-3">
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)]">
 <p className="text-lg font-bold text-accent">{reseedResult.clusters}</p>
 <p className="text-caption t-muted">Clusters</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)]">
 <p className="text-lg font-bold text-accent">{reseedResult.subCatalysts}</p>
 <p className="text-caption t-muted">Sub-Catalysts</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)]">
 <p className="text-lg font-bold text-accent">{reseedResult.positiveRuns.count + reseedResult.negativeRuns.count}</p>
 <p className="text-caption t-muted">Runs</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)]">
 <p className="text-lg font-bold text-accent">{reseedResult.metrics + reseedResult.risks}</p>
 <p className="text-caption t-muted">Metrics & Risks</p>
 </div>
 <div className="text-center p-3 rounded-lg bg-[var(--bg-secondary)]">
 <p className="text-lg font-bold text-accent">{reseedResult.healthScore}</p>
 <p className="text-caption t-muted">Health Score</p>
 </div>
 </div>
 <Button variant="primary" size="sm" onClick={() => setShowReseedConfirm(false)} title="Close">Done</Button>
 </>
 ) : (
 <>
 <div className="flex items-center gap-3">
 <div className="w-10 h-10 rounded-full bg-accent/10 flex items-center justify-center">
 <RefreshCw size={20} className="text-accent" />
 </div>
 <div>
 <h3 className="text-lg font-semibold t-primary">Re-seed Demo Data</h3>
 <p className="text-sm t-muted">Reset VantaX with fresh demo data</p>
 </div>
 </div>
 <div className="p-3 rounded-lg bg-accent/5 border border-accent/20">
 <p className="text-sm t-primary">This will:</p>
 <ul className="text-xs t-muted mt-2 space-y-1 list-disc list-inside">
 <li>Delete all existing VantaX catalyst data</li>
 <li>Create fresh clusters, sub-catalysts, and runs</li>
 <li>Generate KPI definitions, insights, and analytics</li>
 <li>Seed health scores, risk alerts, and executive briefings</li>
 <li>Populate Pulse and Apex dashboards with demo data</li>
 </ul>
 </div>
 <div className="flex gap-3 pt-1">
 <Button variant="secondary" size="sm" onClick={() => setShowReseedConfirm(false)} title="Cancel re-seed">Cancel</Button>
  <button
 onClick={handleReseedVantax}
 disabled={reseeding}
 className="px-4 py-2 rounded-lg text-sm font-medium transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] disabled:opacity-40 disabled:cursor-not-allowed text-white hover:opacity-90 active:scale-[0.97]"
 style={{ backgroundColor: 'var(--accent)' }}
 title="Reset and re-seed VantaX demo data"
 >
 {reseeding ? <Loader2 size={14} className="animate-spin inline mr-1" /> : <RefreshCw size={14} className="inline mr-1" />}
 {reseeding ? 'Re-seeding...' : 'Re-seed Demo Data'}
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
