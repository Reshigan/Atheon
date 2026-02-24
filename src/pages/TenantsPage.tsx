import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { Tenant } from "@/lib/api";
import {
  Building2, Cloud, Server, GitBranch, Users, Bot, Shield,
  ChevronDown, ChevronUp, CheckCircle, XCircle, Plus, Layers, Loader2, X
} from "lucide-react";

const deploymentIcon = (model: string) => {
  if (model === 'saas') return <Cloud size={14} className="text-blue-600" />;
  if (model === 'on-premise') return <Server size={14} className="text-amber-600" />;
  return <GitBranch size={14} className="text-violet-600" />;
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
        <Loader2 className="w-8 h-8 text-indigo-600 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Client Access Layer</h1>
            <p className="text-sm text-gray-500">Multi-tenant management — SaaS, On-Premise, Hybrid</p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowOnboard(true)}><Plus size={14} /> Onboard Tenant</Button>
      </div>

      {/* Onboard Modal */}
      {showOnboard && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md mx-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-gray-900">Onboard New Tenant</h3>
              <button onClick={() => setShowOnboard(false)} className="text-gray-400 hover:text-gray-600"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs text-gray-500">Company Name</label><input className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" value={onboardForm.name} onChange={e => setOnboardForm(p => ({ ...p, name: e.target.value }))} placeholder="Acme Corp" /></div>
              <div><label className="text-xs text-gray-500">Slug (URL-safe ID)</label><input className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono" value={onboardForm.slug} onChange={e => setOnboardForm(p => ({ ...p, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') }))} placeholder="acme-corp" /></div>
              <div><label className="text-xs text-gray-500">Industry</label><select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" value={onboardForm.industry} onChange={e => setOnboardForm(p => ({ ...p, industry: e.target.value }))}><option value="general">General</option><option value="fmcg">FMCG</option><option value="healthcare">Healthcare</option><option value="mining">Mining</option><option value="manufacturing">Manufacturing</option><option value="financial_services">Financial Services</option></select></div>
              <div><label className="text-xs text-gray-500">Plan</label><select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" value={onboardForm.plan} onChange={e => setOnboardForm(p => ({ ...p, plan: e.target.value }))}><option value="starter">Starter</option><option value="professional">Professional</option><option value="enterprise">Enterprise</option></select></div>
              <div><label className="text-xs text-gray-500">Deployment Model</label><select className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" value={onboardForm.deploymentModel} onChange={e => setOnboardForm(p => ({ ...p, deploymentModel: e.target.value }))}><option value="saas">SaaS (Cloud)</option><option value="on-premise">On-Premise</option><option value="hybrid">Hybrid</option></select></div>
              <div><label className="text-xs text-gray-500">Region</label><input className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm" value={onboardForm.region} onChange={e => setOnboardForm(p => ({ ...p, region: e.target.value }))} placeholder="af-south-1" /></div>
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
          <span className="text-xs text-gray-400">Total Tenants</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{tenants.length}</p>
          <span className="text-xs text-emerald-600">{tenants.filter(t => t.status === 'active').length} active</span>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">SaaS</span>
          <p className="text-2xl font-bold text-blue-600 mt-1">{tenants.filter(t => t.deploymentModel === 'saas').length}</p>
          <span className="text-xs text-gray-400">cloud-hosted</span>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">On-Premise</span>
          <p className="text-2xl font-bold text-amber-600 mt-1">{tenants.filter(t => t.deploymentModel === 'on-premise').length}</p>
          <span className="text-xs text-gray-400">self-hosted</span>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Hybrid</span>
          <p className="text-2xl font-bold text-violet-600 mt-1">{tenants.filter(t => t.deploymentModel === 'hybrid').length}</p>
          <span className="text-xs text-gray-400">mixed deployment</span>
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
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center text-lg font-bold text-indigo-500">
                      {tenant.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{tenant.name}</h3>
                      <div className="flex flex-wrap items-center gap-2 mt-1">
                        {deploymentIcon(tenant.deploymentModel)}
                        <Badge variant={deploymentColor(tenant.deploymentModel) as 'info' | 'warning' | 'default'} size="sm">
                          {tenant.deploymentModel}
                        </Badge>
                        <Badge variant="outline" size="sm">{tenant.plan}</Badge>
                        <Badge variant="outline" size="sm">{tenant.industry}</Badge>
                        <span className="text-xs text-gray-400">{tenant.region}</span>
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
                  <div className="text-center p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Layers</span>
                    <p className="text-sm font-bold text-gray-900">{tenant.entitlements.layers.length}/5</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Catalysts</span>
                    <p className="text-sm font-bold text-gray-900">{tenant.entitlements.catalystClusters.length}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Max Agents</span>
                    <p className="text-sm font-bold text-gray-900">{tenant.entitlements.maxAgents}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Max Users</span>
                    <p className="text-sm font-bold text-gray-900">{tenant.entitlements.maxUsers}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Region</span>
                    <p className="text-sm font-bold text-gray-900">{tenant.region}</p>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedTenant === tenant.id && (
                  <div className="mt-4 space-y-4 animate-fadeIn">
                    {/* Entitlements */}
                    <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Shield size={14} className="text-indigo-600" /> Feature Entitlements
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
                            <span className={tenant.entitlements.ssoEnabled ? 'text-emerald-600' : 'text-gray-400'}>
                              {tenant.entitlements.ssoEnabled ? '✓' : '✗'} SSO
                            </span>
                            <span className={tenant.entitlements.apiAccess ? 'text-emerald-600' : 'text-gray-400'}>
                              {tenant.entitlements.apiAccess ? '✓' : '✗'} API
                            </span>
                            <span className={tenant.entitlements.customBranding ? 'text-emerald-600' : 'text-gray-400'}>
                              {tenant.entitlements.customBranding ? '✓' : '✗'} Branding
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Infrastructure */}
                    <div className="p-4 rounded-lg bg-gray-50 border border-gray-200">
                      <h4 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
                        <Server size={14} className="text-amber-600" /> Infrastructure
                      </h4>
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div className="p-3 rounded bg-gray-100">
                          <span className="text-[10px] text-gray-400">Deployment</span>
                          <p className="text-sm font-medium text-gray-800">{tenant.deploymentModel}</p>
                        </div>
                        <div className="p-3 rounded bg-gray-100">
                          <span className="text-[10px] text-gray-400">Plan</span>
                          <p className="text-sm font-medium text-gray-800">{tenant.plan}</p>
                        </div>
                        <div className="p-3 rounded bg-gray-100">
                          <span className="text-[10px] text-gray-400">Region</span>
                          <p className="text-sm font-medium text-gray-800">{tenant.region}</p>
                        </div>
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <Button variant="secondary" size="sm"><Users size={12} /> Manage Users</Button>
                      <Button variant="secondary" size="sm"><Bot size={12} /> Deploy Catalyst</Button>
                      <Button variant="secondary" size="sm"><Layers size={12} /> Edit Entitlements</Button>
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
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Plan Comparison</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-gray-400 font-medium">Feature</th>
                    <th className="text-center py-3 text-gray-400 font-medium">Starter</th>
                    <th className="text-center py-3 text-gray-400 font-medium">Professional</th>
                    <th className="text-center py-3 text-gray-400 font-medium">Enterprise</th>
                  </tr>
                </thead>
                <tbody className="text-gray-600">
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
                    <tr key={row.feature} className="border-b border-gray-200">
                      <td className="py-2.5 font-medium">{row.feature}</td>
                      <td className="py-2.5 text-center">{row.starter === '—' ? <XCircle size={14} className="text-gray-500 mx-auto" /> : row.starter}</td>
                      <td className="py-2.5 text-center">{row.pro === '—' ? <XCircle size={14} className="text-gray-500 mx-auto" /> : row.pro}</td>
                      <td className="py-2.5 text-center text-indigo-500">{row.enterprise}</td>
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
              { model: 'Hybrid', icon: GitBranch, color: 'violet', desc: 'Sensitive data on-premise, compute at the edge. Best of both worlds for regulated industries.', features: ['Edge compute + Local DB', 'Split data plane', 'Pinecone / Weaviate', 'Compliance-ready', 'Selective sync'] },
            ].map((infra) => {
              const Icon = infra.icon;
              const colorMap: Record<string, { bg: string; text: string }> = {
                blue: { bg: 'bg-blue-50', text: 'text-blue-600' },
                amber: { bg: 'bg-amber-50', text: 'text-amber-600' },
                violet: { bg: 'bg-violet-50', text: 'text-violet-600' },
              };
              const colors = colorMap[infra.color] || colorMap.blue;
              return (
                <Card key={infra.model}>
                  <div className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center mb-3`}>
                    <Icon className={`w-5 h-5 ${colors.text}`} />
                  </div>
                  <h3 className="text-base font-semibold text-gray-900">{infra.model}</h3>
                  <p className="text-xs text-gray-500 mt-1">{infra.desc}</p>
                  <div className="mt-3 space-y-1.5">
                    {infra.features.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-xs text-gray-600">
                        <CheckCircle size={12} className="text-emerald-600" />
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
    </div>
  );
}
