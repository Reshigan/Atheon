import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { iamPolicies, ssoConfigs, tenants } from "@/data/tenantData";
import {
  Shield, Key, Users, UserCheck, Lock, Unlock, Plus,
  ShieldCheck, Globe
} from "lucide-react";

export function IAMPage() {
  const { activeTab, setActiveTab } = useTabState('policies');

  const tabs = [
    { id: 'policies', label: 'Policies', icon: <Shield size={14} />, count: iamPolicies.length },
    { id: 'sso', label: 'SSO / Identity', icon: <Key size={14} /> },
    { id: 'roles', label: 'Roles & Permissions', icon: <Users size={14} /> },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white">Identity & Access Management</h1>
            <p className="text-sm text-neutral-400">RBAC/ABAC policies, SSO federation, per-tenant isolation</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> New Policy</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-neutral-500">Active Policies</span>
          <p className="text-2xl font-bold text-white mt-1">{iamPolicies.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">SSO Providers</span>
          <p className="text-2xl font-bold text-white mt-1">{ssoConfigs.filter(s => s.enabled).length}</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">User Roles</span>
          <p className="text-2xl font-bold text-white mt-1">5</p>
        </Card>
        <Card>
          <span className="text-xs text-neutral-500">Total Rules</span>
          <p className="text-2xl font-bold text-white mt-1">{iamPolicies.reduce((s, p) => s + p.rules.length, 0)}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'policies' && (
        <TabPanel>
          <div className="space-y-4">
            {iamPolicies.map((policy) => (
              <Card key={policy.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-white">{policy.name}</h3>
                      <Badge variant={policy.type === 'rbac' ? 'info' : 'warning'} size="sm">{policy.type.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs text-neutral-400 mt-1">{policy.description}</p>
                    <span className="text-[10px] text-neutral-600">Tenant: {tenants.find(t => t.id === policy.tenantId)?.name || policy.tenantId}</span>
                  </div>
                  <Badge variant="outline">{policy.rules.length} rules</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {policy.rules.map((rule) => (
                    <div key={rule.id} className="flex items-center gap-3 p-2 rounded bg-neutral-800/40">
                      {rule.effect === 'allow' ? (
                        <Unlock size={14} className="text-emerald-400" />
                      ) : (
                        <Lock size={14} className="text-red-400" />
                      )}
                      <span className="text-xs font-mono text-neutral-300">{rule.resource}</span>
                      <div className="flex gap-1">
                        {rule.actions.map((a) => (
                          <Badge key={a} variant={rule.effect === 'allow' ? 'success' : 'danger'} size="sm">{a}</Badge>
                        ))}
                      </div>
                      {rule.conditions && rule.conditions.length > 0 && (
                        <span className="text-[10px] text-neutral-500 ml-auto">
                          when {rule.conditions.map(c => `${c.attribute} ${c.operator} ${JSON.stringify(c.value)}`).join(', ')}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'sso' && (
        <TabPanel>
          <div className="space-y-4">
            {ssoConfigs.map((sso, i) => {
              const tenant = tenants.find(t => t.id === sso.tenantId);
              return (
                <Card key={i}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-lg bg-indigo-500/15 flex items-center justify-center">
                        <Globe className="w-5 h-5 text-indigo-400" />
                      </div>
                      <div>
                        <h3 className="text-base font-semibold text-white">{sso.provider.replace('_', ' ').toUpperCase()}</h3>
                        <span className="text-xs text-neutral-400">{tenant?.name || sso.tenantId}</span>
                      </div>
                    </div>
                    <Badge variant={sso.enabled ? 'success' : 'default'}>{sso.enabled ? 'Active' : 'Disabled'}</Badge>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                    <div className="p-2 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Client ID</span>
                      <p className="text-xs text-neutral-300 font-mono truncate">{sso.clientId}</p>
                    </div>
                    <div className="p-2 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Issuer URL</span>
                      <p className="text-xs text-neutral-300 font-mono truncate">{sso.issuerUrl}</p>
                    </div>
                    <div className="p-2 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Auto-Provision</span>
                      <p className="text-xs text-neutral-300">{sso.autoProvision ? 'Yes' : 'No'}</p>
                    </div>
                    <div className="p-2 rounded bg-neutral-800/40">
                      <span className="text-[10px] text-neutral-600">Default Role</span>
                      <p className="text-xs text-neutral-300">{sso.defaultRole}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </TabPanel>
      )}

      {activeTab === 'roles' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              { role: 'Admin', icon: ShieldCheck, color: 'text-red-400', desc: 'Full platform access. Tenant management, user provisioning, all features.', perms: ['*.admin', '*.read', '*.write', '*.execute', '*.approve'] },
              { role: 'Executive', icon: Shield, color: 'text-amber-400', desc: 'C-Suite view. Apex briefings, risk alerts, scenarios. Approval authority.', perms: ['apex.*', 'pulse.read', 'catalysts.approve', 'chat.*'] },
              { role: 'Manager', icon: UserCheck, color: 'text-blue-400', desc: 'Department-level access. Manage Catalysts in assigned clusters. View Pulse.', perms: ['pulse.*', 'catalysts.read/write', 'memory.read', 'chat.*'] },
              { role: 'Analyst', icon: Users, color: 'text-violet-400', desc: 'Read-only analytics. Pulse monitoring, Memory graph, Chat queries.', perms: ['pulse.read', 'memory.read', 'chat.read/write'] },
              { role: 'Operator', icon: Key, color: 'text-emerald-400', desc: 'Catalyst task execution. Can execute read-only and assisted actions.', perms: ['catalysts.read/execute', 'pulse.read', 'chat.read'] },
            ].map((r) => {
              const Icon = r.icon;
              return (
                <Card key={r.role}>
                  <div className="flex items-center gap-3 mb-3">
                    <Icon className={`w-5 h-5 ${r.color}`} />
                    <h3 className="text-base font-semibold text-white">{r.role}</h3>
                  </div>
                  <p className="text-xs text-neutral-400">{r.desc}</p>
                  <div className="flex flex-wrap gap-1 mt-3">
                    {r.perms.map((p) => (
                      <Badge key={p} variant="outline" size="sm">{p}</Badge>
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
