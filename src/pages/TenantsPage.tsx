import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { tenants } from "@/data/tenantData";
import type { DeploymentModel } from "@/types";
import {
  Building2, Cloud, Server, GitBranch, Users, Bot, Shield,
  ChevronDown, ChevronUp, CheckCircle, XCircle, Plus, Layers
} from "lucide-react";

const deploymentIcon = (model: DeploymentModel) => {
  if (model === 'saas') return <Cloud size={14} className="text-blue-400" />;
  if (model === 'on-premise') return <Server size={14} className="text-amber-400" />;
  return <GitBranch size={14} className="text-violet-400" />;
};

const deploymentColor = (model: DeploymentModel) => {
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

  const tabs = [
    { id: 'overview', label: 'All Tenants', icon: <Building2 size={14} />, count: tenants.length },
    { id: 'entitlements', label: 'Entitlements', icon: <Shield size={14} /> },
    { id: 'infrastructure', label: 'Infrastructure', icon: <Server size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-500/15 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Client Access Layer</h1>
            <p className="text-sm text-neutral-400">Multi-tenant management — SaaS, On-Premise, Hybrid</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> Onboard Tenant</Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Total Tenants</span>
          <p className="text-2xl font-bold text-white mt-1">{tenants.length}</p>
          <span className="text-xs text-emerald-400">{tenants.filter(t => t.status === 'active').length} active</span>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">SaaS</span>
          <p className="text-2xl font-bold text-blue-400 mt-1">{tenants.filter(t => t.deploymentModel === 'saas').length}</p>
          <span className="text-xs text-neutral-500">cloud-hosted</span>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">On-Premise</span>
          <p className="text-2xl font-bold text-amber-400 mt-1">{tenants.filter(t => t.deploymentModel === 'on-premise').length}</p>
          <span className="text-xs text-neutral-500">self-hosted</span>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Hybrid</span>
          <p className="text-2xl font-bold text-violet-400 mt-1">{tenants.filter(t => t.deploymentModel === 'hybrid').length}</p>
          <span className="text-xs text-neutral-500">mixed deployment</span>
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
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-violet-500/20 flex items-center justify-center text-lg font-bold text-indigo-300">
                      {tenant.name.charAt(0)}
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-white">{tenant.name}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        {deploymentIcon(tenant.deploymentModel)}
                        <Badge variant={deploymentColor(tenant.deploymentModel) as 'info' | 'warning' | 'default'} size="sm">
                          {tenant.deploymentModel}
                        </Badge>
                        <Badge variant="outline" size="sm">{tenant.plan}</Badge>
                        <Badge variant="outline" size="sm">{tenant.industry}</Badge>
                        <span className="text-xs text-neutral-600">{tenant.region}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {statusBadge(tenant.status)}
                    {expandedTenant === tenant.id ? <ChevronUp size={14} className="text-neutral-500" /> : <ChevronDown size={14} className="text-neutral-500" />}
                  </div>
                </div>

                {/* Quick Stats */}
                <div className="grid grid-cols-5 gap-3 mt-4">
                  <div className="text-center p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Layers</span>
                    <p className="text-sm font-bold text-white">{tenant.entitlements.layers.length}/5</p>
                  </div>
                  <div className="text-center p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Catalysts</span>
                    <p className="text-sm font-bold text-white">{tenant.entitlements.catalystClusters.length}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Max Agents</span>
                    <p className="text-sm font-bold text-white">{tenant.entitlements.maxAgents}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Max Users</span>
                    <p className="text-sm font-bold text-white">{tenant.entitlements.maxUsers}</p>
                  </div>
                  <div className="text-center p-2 rounded bg-neutral-800/40">
                    <span className="text-[10px] text-neutral-600">Storage</span>
                    <p className="text-sm font-bold text-white">{tenant.infrastructure.storage.usedGb}/{tenant.infrastructure.storage.sizeGb}GB</p>
                  </div>
                </div>

                {/* Expanded Details */}
                {expandedTenant === tenant.id && (
                  <div className="mt-4 space-y-4 animate-fadeIn">
                    {/* Entitlements */}
                    <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-800/50">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Shield size={14} className="text-indigo-400" /> Feature Entitlements
                      </h4>
                      <div className="flex flex-wrap gap-1.5">
                        {tenant.entitlements.features.map((f) => (
                          <Badge key={f} variant="outline" size="sm">{f}</Badge>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-4 mt-3">
                        <div>
                          <span className="text-[10px] text-neutral-600">Autonomy Tiers</span>
                          <div className="flex gap-1 mt-1">
                            {tenant.entitlements.autonomyTiers.map(t => (
                              <Badge key={t} variant="info" size="sm">{t}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-600">LLM Tiers</span>
                          <div className="flex gap-1 mt-1">
                            {tenant.entitlements.llmTiers.map(t => (
                              <Badge key={t} variant="info" size="sm">{t}</Badge>
                            ))}
                          </div>
                        </div>
                        <div>
                          <span className="text-[10px] text-neutral-600">Flags</span>
                          <div className="flex gap-2 mt-1 text-xs">
                            <span className={tenant.entitlements.ssoEnabled ? 'text-emerald-400' : 'text-neutral-600'}>
                              {tenant.entitlements.ssoEnabled ? '✓' : '✗'} SSO
                            </span>
                            <span className={tenant.entitlements.apiAccess ? 'text-emerald-400' : 'text-neutral-600'}>
                              {tenant.entitlements.apiAccess ? '✓' : '✗'} API
                            </span>
                            <span className={tenant.entitlements.customBranding ? 'text-emerald-400' : 'text-neutral-600'}>
                              {tenant.entitlements.customBranding ? '✓' : '✗'} Branding
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Infrastructure */}
                    <div className="p-4 rounded-lg bg-neutral-800/30 border border-neutral-800/50">
                      <h4 className="text-sm font-semibold text-white mb-3 flex items-center gap-2">
                        <Server size={14} className="text-amber-400" /> Infrastructure
                      </h4>
                      <div className="grid grid-cols-3 gap-4">
                        <div className="p-3 rounded bg-neutral-800/40">
                          <span className="text-[10px] text-neutral-600">Compute</span>
                          <p className="text-sm font-medium text-neutral-200">{tenant.infrastructure.compute.type}</p>
                          <Badge variant={tenant.infrastructure.compute.status === 'running' ? 'success' : 'warning'} size="sm" className="mt-1">
                            {tenant.infrastructure.compute.status}
                          </Badge>
                        </div>
                        <div className="p-3 rounded bg-neutral-800/40">
                          <span className="text-[10px] text-neutral-600">Database</span>
                          <p className="text-sm font-medium text-neutral-200">{tenant.infrastructure.storage.type}</p>
                          <Progress value={tenant.infrastructure.storage.usedGb} max={tenant.infrastructure.storage.sizeGb} color="indigo" size="sm" className="mt-2" />
                        </div>
                        <div className="p-3 rounded bg-neutral-800/40">
                          <span className="text-[10px] text-neutral-600">Vector DB</span>
                          <p className="text-sm font-medium text-neutral-200">{tenant.infrastructure.vectorDb.type}</p>
                          <span className="text-[10px] text-neutral-500">{tenant.infrastructure.vectorDb.indexCount.toLocaleString()} vectors</span>
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
            <h3 className="text-lg font-semibold text-white mb-4">Plan Comparison</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-800">
                    <th className="text-left py-3 text-neutral-500 font-medium">Feature</th>
                    <th className="text-center py-3 text-neutral-500 font-medium">Starter</th>
                    <th className="text-center py-3 text-neutral-500 font-medium">Professional</th>
                    <th className="text-center py-3 text-neutral-500 font-medium">Enterprise</th>
                  </tr>
                </thead>
                <tbody className="text-neutral-300">
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
                    <tr key={row.feature} className="border-b border-neutral-800/50">
                      <td className="py-2.5 font-medium">{row.feature}</td>
                      <td className="py-2.5 text-center">{row.starter === '—' ? <XCircle size={14} className="text-neutral-700 mx-auto" /> : row.starter}</td>
                      <td className="py-2.5 text-center">{row.pro === '—' ? <XCircle size={14} className="text-neutral-700 mx-auto" /> : row.pro}</td>
                      <td className="py-2.5 text-center text-indigo-300">{row.enterprise}</td>
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
              return (
                <Card key={infra.model}>
                  <div className={`w-10 h-10 rounded-lg bg-${infra.color}-500/15 flex items-center justify-center mb-3`}>
                    <Icon className={`w-5 h-5 text-${infra.color}-400`} />
                  </div>
                  <h3 className="text-base font-semibold text-white">{infra.model}</h3>
                  <p className="text-xs text-neutral-400 mt-1">{infra.desc}</p>
                  <div className="mt-3 space-y-1.5">
                    {infra.features.map((f) => (
                      <div key={f} className="flex items-center gap-2 text-xs text-neutral-300">
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
    </div>
  );
}
