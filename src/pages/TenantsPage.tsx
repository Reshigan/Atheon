import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Tenant, IAMUser } from "@/lib/api";
import {
 Building2, Cloud, Server, GitBranch, Users, Bot, Shield,
 ChevronDown, ChevronUp, CheckCircle, XCircle, Plus, Layers, Loader2, X
} from "lucide-react";

const deploymentIcon = (model: string) => {
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

 // Deploy Catalyst handler
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
 // Refresh tenants to reflect new cluster
 const res = await api.tenants.list();
 setTenants(res.tenants);
 } catch { /* silent */ }
 setDeployingCatalyst(false);
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
 <Button variant="primary" size="sm" onClick={() => setShowOnboard(true)}><Plus size={14} /> Onboard Tenant</Button>
 </div>

 {/* Onboard Modal */}
 {showOnboard && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Onboard New Tenant</h3>
 <button onClick={() => setShowOnboard(false)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
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
 <Button variant="secondary" size="sm" onClick={() => setShowOnboard(false)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleOnboard} disabled={onboarding || !onboardForm.name.trim() || !onboardForm.slug.trim()}>
 {onboarding ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Onboard
 </Button>
 </div>
 </div>
 </div>
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
 {tenant.entitlements.ssoEnabled ? '✓' : '✗'} SSO
 </span>
 <span className={tenant.entitlements.apiAccess ? 'text-emerald-400' : 'text-gray-400'}>
 {tenant.entitlements.apiAccess ? '✓' : '✗'} API
 </span>
 <span className={tenant.entitlements.customBranding ? 'text-emerald-400' : 'text-gray-400'}>
 {tenant.entitlements.customBranding ? '✓' : '✗'} Branding
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
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openManageUsers(tenant.id); }}><Users size={12} /> Manage Users</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); setShowDeployCatalyst(tenant.id); }}><Bot size={12} /> Deploy Catalyst</Button>
 <Button variant="secondary" size="sm" onClick={(e) => { e.stopPropagation(); openEditEntitlements(tenant); }}><Layers size={12} /> Edit Entitlements</Button>
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
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
 </div>
 )}

 {/* Deploy Catalyst Modal */}
 {showDeployCatalyst && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
 <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
 <div className="flex items-center justify-between">
 <h3 className="text-lg font-semibold t-primary">Deploy Catalyst Cluster</h3>
 <button onClick={() => setShowDeployCatalyst(null)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
 </div>
 <div className="space-y-3">
 <div><label className="text-xs t-muted">Cluster Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.name} onChange={e => setCatalystForm(p => ({ ...p, name: e.target.value }))} placeholder="finance-catalyst-01" /></div>
 <div><label className="text-xs t-muted">Domain</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.domain} onChange={e => setCatalystForm(p => ({ ...p, domain: e.target.value }))}><option value="finance">Finance</option><option value="procurement">Procurement</option><option value="supply-chain">Supply Chain</option><option value="hr">Human Resources</option><option value="sales">Sales</option><option value="operations">Operations</option></select></div>
 <div><label className="text-xs t-muted">Autonomy Tier</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm" value={catalystForm.autonomy_tier} onChange={e => setCatalystForm(p => ({ ...p, autonomy_tier: e.target.value }))}><option value="read-only">Read-Only (Monitor)</option><option value="assisted">Assisted (Suggest)</option><option value="supervised">Supervised (Act with approval)</option><option value="autonomous">Autonomous (Full execution)</option></select></div>
 </div>
 <p className="text-[10px] text-gray-400">The Catalyst cluster will be provisioned and deployed according to the tenant&apos;s deployment model.</p>
 <div className="flex gap-3 pt-2">
 <Button variant="secondary" size="sm" onClick={() => setShowDeployCatalyst(null)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleDeployCatalyst} disabled={!catalystForm.name.trim() || deployingCatalyst}>
 {deployingCatalyst ? <Loader2 size={14} className="animate-spin" /> : <Bot size={14} />} Deploy
 </Button>
 </div>
 </div>
 </div>
 )}

 {/* Edit Entitlements Modal */}
 {showEditEntitlements && (
 <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
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
 <Button variant="secondary" size="sm" onClick={() => setShowEditEntitlements(null)}>Cancel</Button>
 <Button variant="primary" size="sm" onClick={handleSaveEntitlements} disabled={savingEntitlements}>
 {savingEntitlements ? <Loader2 size={14} className="animate-spin" /> : <Shield size={14} />} Save Entitlements
 </Button>
 </div>
 </div>
 </div>
 )}
 </div>
 );
}
