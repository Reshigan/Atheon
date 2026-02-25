import { useState, useEffect } from "react";
import { useAppStore } from "@/stores/appStore";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { api } from "@/lib/api";
import type { IAMPolicy, SSOConfig, IAMRole } from "@/lib/api";
import {
  Shield, Key, Users, UserCheck, Lock, Unlock, Plus,
  ShieldCheck, Globe, Loader2, X
} from "lucide-react";

export function IAMPage() {
  const { activeTab, setActiveTab } = useTabState('policies');
  const [policies, setPolicies] = useState<IAMPolicy[]>([]);
  const [ssoConfigs, setSsoConfigs] = useState<SSOConfig[]>([]);
  const [roles, setRoles] = useState<IAMRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNewPolicy, setShowNewPolicy] = useState(false);
  const [creatingPolicy, setCreatingPolicy] = useState(false);
  const [policyForm, setPolicyForm] = useState({ name: '', description: '', type: 'rbac' });

  const tenantId = useAppStore((s) => s.user?.tenantId) || 'vantax';

  const handleCreatePolicy = async () => {
    if (!policyForm.name.trim() || creatingPolicy) return;
    setCreatingPolicy(true);
    try {
      await api.iam.createPolicy({
        tenant_id: tenantId,
        name: policyForm.name.trim(),
        description: policyForm.description.trim(),
        type: policyForm.type,
        rules: [],
      });
      const p = await api.iam.policies(tenantId);
      setPolicies(p.policies);
      setPolicyForm({ name: '', description: '', type: 'rbac' });
      setShowNewPolicy(false);
    } catch {
      /* silent */
    }
    setCreatingPolicy(false);
  };

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [p, s, r] = await Promise.allSettled([
        api.iam.policies(tenantId), api.iam.sso(tenantId), api.iam.roles(tenantId),
      ]);
      if (p.status === 'fulfilled') setPolicies(p.value.policies);
      if (s.status === 'fulfilled') setSsoConfigs(s.value.configs);
      if (r.status === 'fulfilled') setRoles(r.value.roles);
      setLoading(false);
    }
    load();
  }, [tenantId]);

  const tabs = [
    { id: 'policies', label: 'Policies', icon: <Shield size={14} />, count: policies.length },
    { id: 'sso', label: 'SSO / Identity', icon: <Key size={14} /> },
    { id: 'roles', label: 'Roles & Permissions', icon: <Users size={14} /> },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <Loader2 className="w-8 h-8 text-amber-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="          w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center">
                      <ShieldCheck className="w-5 h-5 text-amber-400"/>
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Identity & Access Management</h1>
            <p className="text-sm t-muted">RBAC/ABAC policies, SSO federation, per-tenant isolation</p>
          </div>
        </div>
        <Button variant="primary" size="sm" onClick={() => setShowNewPolicy(true)}><Plus size={14} /> New Policy</Button>
      </div>

      {/* New Policy Modal */}
      {showNewPolicy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
          <div style={{ background: "rgba(18,18,42,0.95)", border: "1px solid rgba(255,255,255,0.1)" }} className="rounded-2xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold t-primary">Create New Policy</h3>
              <button onClick={() => setShowNewPolicy(false)} className="text-gray-400 hover:text-gray-400"><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div><label className="text-xs t-muted">Policy Name</label><input className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={policyForm.name} onChange={e => setPolicyForm(p => ({ ...p, name: e.target.value }))} placeholder="Read-only analysts" /></div>
              <div><label className="text-xs t-muted">Description</label><input className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={policyForm.description} onChange={e => setPolicyForm(p => ({ ...p, description: e.target.value }))} placeholder="Policy description" /></div>
              <div><label className="text-xs t-muted">Type</label><select className="w-full px-3 py-2 rounded-lg border border-white/[0.06] text-sm" value={policyForm.type} onChange={e => setPolicyForm(p => ({ ...p, type: e.target.value }))}><option value="rbac">RBAC (Role-Based)</option><option value="abac">ABAC (Attribute-Based)</option></select></div>
            </div>
            <p className="text-[10px] text-gray-400">Rules can be added after creating the policy.</p>
            <div className="flex gap-3 pt-2">
              <Button variant="secondary" size="sm" onClick={() => setShowNewPolicy(false)}>Cancel</Button>
              <Button variant="primary" size="sm" onClick={handleCreatePolicy} disabled={!policyForm.name.trim() || creatingPolicy}>
                {creatingPolicy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Policy
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <span className="text-xs t-secondary">Active Policies</span>
          <p className="text-2xl font-bold text-white mt-1">{policies.length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">SSO Providers</span>
          <p className="text-2xl font-bold text-white mt-1">{ssoConfigs.filter(s => s.enabled).length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">User Roles</span>
          <p className="text-2xl font-bold text-white mt-1">{roles.length}</p>
        </Card>
        <Card>
          <span className="text-xs t-secondary">Total Rules</span>
          <p className="text-2xl font-bold text-white mt-1">{policies.reduce((s, p) => s + (Array.isArray(p.rules) ? p.rules.length : 0), 0)}</p>
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
                      <h3 className="text-base font-semibold t-primary">{policy.name}</h3>
                      <Badge variant={policy.type === 'rbac' ? 'info' : 'warning'} size="sm">{policy.type.toUpperCase()}</Badge>
                    </div>
                    <p className="text-xs t-muted mt-1">{policy.description}</p>
                    <span className="text-[10px] text-gray-400">Tenant: {policy.tenantId}</span>
                  </div>
                  <Badge variant="outline">{Array.isArray(policy.rules) ? policy.rules.length : 0} rules</Badge>
                </div>

                <div className="mt-3 space-y-2">
                  {(Array.isArray(policy.rules) ? policy.rules : []).map((rule, idx) => {
                    const r = rule as Record<string, unknown>;
                    return (
                      <div key={idx} className="flex items-center gap-3                      p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                              {r.effect === 'allow' ? (
                          <Unlock size={14} className="text-emerald-400" />
                        ) : (
                          <Lock size={14} className="text-red-400" />
                        )}
                        <span className="text-xs font-mono text-gray-400">{String(r.resource || '')}</span>
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
                    <div className="                    w-10 h-10 rounded-lg bg-amber-500/10 flex items-center justify-center">
                                          <Globe className="w-5 h-5 text-amber-400"/>
                    </div>
                    <div>
                      <h3 className="text-base font-semibold t-primary">{sso.provider.replace('_', ' ').toUpperCase()}</h3>
                      <span className="text-xs t-muted">{sso.domainHint}</span>
                    </div>
                  </div>
                  <Badge variant={sso.enabled ? 'success' : 'default'}>{sso.enabled ? 'Active' : 'Disabled'}</Badge>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                  <div className="                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Client ID</span>
                    <p className="text-xs t-secondary font-mono truncate">{sso.clientId}</p>
                  </div>
                  <div className="                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Issuer URL</span>
                    <p className="text-xs t-secondary font-mono truncate">{sso.issuerUrl}</p>
                  </div>
                  <div className="                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Auto-Provision</span>
                    <p className="text-xs t-secondary">{sso.autoProvision ? 'Yes' : 'No'}</p>
                  </div>
                  <div className="                  p-2 rounded bg-white/[0.04] border border-white/[0.06] backdrop-blur-sm">
                                      <span className="text-[10px] text-gray-400">Default Role</span>
                    <p className="text-xs t-secondary">{sso.defaultRole}</p>
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
              const color = role.name.toLowerCase().includes('admin') ? 'text-red-400' : role.name.toLowerCase().includes('exec') ? 'text-amber-400' : role.name.toLowerCase().includes('manager') ? 'text-amber-400' : 'text-amber-400';
              return (
                <Card key={role.id}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-3">
                      <Icon className={`w-5 h-5 ${color}`} />
                      <h3 className="text-base font-semibold t-primary">{role.name}</h3>
                    </div>
                    <Badge variant="outline" size="sm">Level {role.level}</Badge>
                  </div>
                  <p className="text-xs t-muted">{role.description}</p>
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
