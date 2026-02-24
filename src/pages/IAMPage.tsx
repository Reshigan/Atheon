import { useState, useEffect } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { IAMPolicy, SSOConfig, IAMRole } from "@/lib/api";
import {
  Shield, Key, Users, UserCheck, Lock, Unlock, Plus,
  ShieldCheck, Globe, Loader2
} from "lucide-react";

export function IAMPage() {
  const { activeTab, setActiveTab } = useTabState('policies');
  const [policies, setPolicies] = useState<IAMPolicy[]>([]);
  const [ssoConfigs, setSsoConfigs] = useState<SSOConfig[]>([]);
  const [roles, setRoles] = useState<IAMRole[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, s, r] = await Promise.allSettled([
        api.iam.policies(), api.iam.sso(), api.iam.roles(),
      ]);
      if (p.status === 'fulfilled') setPolicies(p.value.policies);
      if (s.status === 'fulfilled') setSsoConfigs(s.value.configs);
      if (r.status === 'fulfilled') setRoles(r.value.roles);
      setLoading(false);
    }
    load();
  }, []);

  const tabs = [
    { id: 'policies', label: 'Policies', icon: <Shield size={14} />, count: policies.length },
    { id: 'sso', label: 'SSO / Identity', icon: <Key size={14} /> },
    { id: 'roles', label: 'Roles & Permissions', icon: <Users size={14} /> },
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
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-600" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Identity & Access Management</h1>
            <p className="text-sm text-gray-500">RBAC/ABAC policies, SSO federation, per-tenant isolation</p>
          </div>
        </div>
        <Button variant="primary" size="sm"><Plus size={14} /> New Policy</Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs text-gray-400">Active Policies</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{policies.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">SSO Providers</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{ssoConfigs.filter(s => s.enabled).length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">User Roles</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{roles.length}</p>
        </Card>
        <Card>
          <span className="text-xs text-gray-400">Total Rules</span>
          <p className="text-2xl font-bold text-gray-900 mt-1">{policies.reduce((s, p) => s + (Array.isArray(p.rules) ? p.rules.length : 0), 0)}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'policies' && (
        <TabPanel>
          <div className="space-y-4">
            {policies.map((policy) => (
              <Card key={policy.id}>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-semibold text-gray-900">{policy.name}</h3>
                      <Badge variant={policy.type === 'rbac' ? 'info' : 'warning'} size="sm">{policy.type.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs text-gray-500 mt-1">{policy.description}</p>
                    <span className="text-[10px] text-gray-400">Tenant: {policy.tenantId}</span>
                  </div>
                  <Badge variant="outline">{Array.isArray(policy.rules) ? policy.rules.length : 0} rules</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {(Array.isArray(policy.rules) ? policy.rules : []).map((rule, idx) => {
                    const r = rule as Record<string, unknown>;
                    return (
                      <div key={idx} className="flex items-center gap-3 p-2 rounded bg-gray-100">
                        {r.effect === 'allow' ? (
                          <Unlock size={14} className="text-emerald-600" />
                        ) : (
                          <Lock size={14} className="text-red-600" />
                        )}
                        <span className="text-xs font-mono text-gray-600">{String(r.resource || '')}</span>
                        <div className="flex gap-1">
                          {(Array.isArray(r.actions) ? r.actions : []).map((a: unknown) => (
                            <Badge key={String(a)} variant={r.effect === 'allow' ? 'success' : 'danger'} size="sm">{String(a)}</Badge>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'sso' && (
        <TabPanel>
          <div className="space-y-4">
            {ssoConfigs.map((sso, i) => (
              <Card key={i}>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-indigo-50 flex items-center justify-center">
                      <Globe className="w-5 h-5 text-indigo-600" />
                    </div>
                    <div>
                      <h3 className="text-base font-semibold text-gray-900">{sso.provider.replace('_', ' ').toUpperCase()}</h3>
                      <span className="text-xs text-gray-500">{sso.domainHint}</span>
                    </div>
                  </div>
                  <Badge variant={sso.enabled ? 'success' : 'default'}>{sso.enabled ? 'Active' : 'Disabled'}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Client ID</span>
                    <p className="text-xs text-gray-600 font-mono truncate">{sso.clientId}</p>
                  </div>
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Issuer URL</span>
                    <p className="text-xs text-gray-600 font-mono truncate">{sso.issuerUrl}</p>
                  </div>
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Auto-Provision</span>
                    <p className="text-xs text-gray-600">{sso.autoProvision ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="p-2 rounded bg-gray-100">
                    <span className="text-[10px] text-gray-400">Default Role</span>
                    <p className="text-xs text-gray-600">{sso.defaultRole}</p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        </TabPanel>
      )}

      {activeTab === 'roles' && (
        <TabPanel>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {roles.map((role) => {
              const Icon = role.name.toLowerCase().includes('admin') ? ShieldCheck : role.name.toLowerCase().includes('exec') ? Shield : role.name.toLowerCase().includes('manager') ? UserCheck : Users;
              const color = role.name.toLowerCase().includes('admin') ? 'text-red-600' : role.name.toLowerCase().includes('exec') ? 'text-amber-600' : role.name.toLowerCase().includes('manager') ? 'text-blue-600' : 'text-violet-600';
              return (
                <Card key={role.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${color}`} />
                      <h3 className="text-base font-semibold text-gray-900">{role.name}</h3>
                    </div>
                    <Badge variant="outline" size="sm">Level {role.level}</Badge>
                  </div>
                  <p className="text-xs text-gray-500">{role.description}</p>
                  <div className="mt-3 flex items-center justify-between">
                    <span className="text-[10px] text-gray-400">Users</span>
                    <Badge variant="info" size="sm">{role.userCount}</Badge>
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
