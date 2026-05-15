import { useState, useEffect } from "react";
import { Portal } from "@/components/ui/portal";
import { useAppStore } from "@/stores/appStore";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { LoadingState } from "@/components/ui/state";
import { HeroHeader } from "@/components/ui/hero-header";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";
import { api, ApiError } from "@/lib/api";
import type { IAMPolicy, SSOConfig, IAMRole, IAMUser } from "@/lib/api";
import { useToast } from "@/components/ui/toast";
import {
 Shield, Key, Users, UserCheck, Lock, Unlock, Plus, UserPlus,
 ShieldCheck, Globe, Loader2, X, Pencil, Trash2, Save, Mail,
 Ban, CheckCircle, RotateCcw, Eye, ChevronDown, ChevronUp
} from "lucide-react";

/** Per-role permission map */
const ROLE_PERMISSIONS: Record<string, { pages: string[]; actions: string[] }> = {
  superadmin: { pages: ['All pages', 'Tenant management', 'System config'], actions: ['Full CRUD', 'Create/delete tenants', 'Manage company admins', 'System configuration'] },
  support_admin: { pages: ['All pages except Tenant management'], actions: ['Full CRUD within tenants', 'Manage users/roles', 'Configure ERP connections', 'Run catalysts'] },
  admin: { pages: ['Dashboard', 'Catalysts', 'Pulse', 'Apex', 'IAM', 'Connectivity', 'Memory', 'Mind', 'Settings'], actions: ['Full CRUD within own tenant', 'Manage company users', 'Configure ERP', 'Run catalysts', 'Approve HITL'] },
  executive: { pages: ['Dashboard', 'Apex', 'Pulse', 'Catalysts (read)', 'Mind'], actions: ['Read dashboards', 'View briefings', 'Approve escalations', 'AI conversations'] },
  manager: { pages: ['Dashboard', 'Catalysts', 'Pulse', 'Mind', 'Memory'], actions: ['Read/write catalysts', 'Run sub-catalysts', 'View process metrics', 'AI conversations'] },
  analyst: { pages: ['Dashboard', 'Catalysts (read)', 'Pulse (read)', 'Mind'], actions: ['Read dashboards', 'View catalyst results', 'AI conversations'] },
  operator: { pages: ['Dashboard', 'Catalysts', 'Pulse (read)'], actions: ['Read dashboards', 'Execute catalyst tasks', 'View process monitoring'] },
  viewer: { pages: ['Dashboard (read-only)'], actions: ['View dashboard overview only'] },
};

/** Roles an admin-level user can assign to new users */
const ASSIGNABLE_ROLES: Record<string, string[]> = {
  superadmin: ['superadmin', 'support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator', 'viewer'],
  support_admin: ['support_admin', 'admin', 'executive', 'manager', 'analyst', 'operator', 'viewer'],
  admin: ['executive', 'manager', 'analyst', 'operator', 'viewer'],
};

export function IAMPage() {
 const toast = useToast();
 const { activeTab, setActiveTab } = useTabState('users');
 const [policies, setPolicies] = useState<IAMPolicy[]>([]);
 const [ssoConfigs, setSsoConfigs] = useState<SSOConfig[]>([]);
 const [roles, setRoles] = useState<IAMRole[]>([]);
 const [users, setUsers] = useState<IAMUser[]>([]);
 // ISO timestamp of last successful IAM load — fuels MetricSource freshness rows.
 const [iamLoadedAt, setIamLoadedAt] = useState<string | null>(null);
 const [loading, setLoading] = useState(true);
 const [showNewPolicy, setShowNewPolicy] = useState(false);
 const [showInviteUser, setShowInviteUser] = useState(false);
 const [editingUserId, setEditingUserId] = useState<string | null>(null);
 const [editRole, setEditRole] = useState('');
 const [editStatus, setEditStatus] = useState('');
 const [savingUser, setSavingUser] = useState(false);
 const [creatingPolicy, setCreatingPolicy] = useState(false);
 const [inviting, setInviting] = useState(false);
 const [inviteForm, setInviteForm] = useState({ name: '', email: '', role: 'analyst', sendWelcome: true });
 const [inviteResult, setInviteResult] = useState<{ email: string; tempPassword: string } | null>(null);
 const [policyForm, setPolicyForm] = useState({ name: '', description: '', type: 'rbac' });
 const [expandedRoleId, setExpandedRoleId] = useState<string | null>(null);
 const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

 const activeTenantId = useAppStore((s) => s.activeTenantId);
 const userTenantId = useAppStore((s) => s.user?.tenantId);
 const tenantId = activeTenantId || userTenantId || '';
 const currentUser = useAppStore((s) => s.user);
 const currentRole = currentUser?.role || 'viewer';
 const isSuperAdmin = currentRole === 'superadmin' || currentRole === 'support_admin';
 const isCompanyAdmin = currentRole === 'admin';
 const isAdmin = isSuperAdmin || isCompanyAdmin;
 const assignableRoles = ASSIGNABLE_ROLES[currentRole] || [];

 const showFeedback = (type: 'success' | 'error', message: string) => {
   setActionFeedback({ type, message });
   setTimeout(() => setActionFeedback(null), 4000);
 };

 /** Show an error — inline banner plus a toast with the backend request-ID for support traceability. */
 const showError = (title: string, err: unknown, fallbackMessage: string) => {
   const message = err instanceof Error ? err.message : fallbackMessage;
   setActionFeedback({ type: 'error', message });
   setTimeout(() => setActionFeedback(null), 4000);
   toast.error(title, {
     message,
     requestId: err instanceof ApiError ? err.requestId : null,
   });
 };

 /** Check if the current user can manage the target user */
 const canManageUser = (targetUser: IAMUser): boolean => {
   if (currentUser?.id === targetUser.id) return false;
   if (currentRole === 'superadmin') return true;
   if (currentRole === 'support_admin') {
     return targetUser.role !== 'superadmin';
   }
   if (isCompanyAdmin) {
     const nonManageable = ['superadmin', 'support_admin', 'admin'];
     return !nonManageable.includes(targetUser.role || '');
   }
   return false;
 };

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
     showFeedback('success', 'Policy created successfully');
   } catch (err) {
     console.error('Failed to create policy', err);
     showError('Failed to create policy', err, 'Failed to create policy');
   }
   setCreatingPolicy(false);
 };

 const handleInviteUser = async () => {
   if (!inviteForm.name.trim() || !inviteForm.email.trim() || inviting) return;
   setInviting(true);
   setInviteResult(null);
   try {
     const result = await api.iam.createUser({
       name: inviteForm.name.trim(),
       email: inviteForm.email.trim(),
       role: inviteForm.role,
       send_welcome_email: inviteForm.sendWelcome,
     }, tenantId) as { id: string; email?: string; tempPassword?: string };
     const u = await api.iam.users(tenantId);
     setUsers(u.users);
     if (result.tempPassword) {
       setInviteResult({ email: result.email || inviteForm.email, tempPassword: result.tempPassword });
     } else {
       setShowInviteUser(false);
       setInviteForm({ name: '', email: '', role: 'analyst', sendWelcome: true });
     }
     showFeedback('success', `User ${inviteForm.email} invited successfully`);
   } catch (err) {
     console.error('Failed to invite user', err);
     showError('Failed to invite user', err, 'Failed to invite user');
   }
   setInviting(false);
 };

 const handleUpdateUser = async (userId: string, updates: Record<string, unknown>) => {
   setSavingUser(true);
   try {
     await api.iam.updateUser(userId, updates, tenantId);
     const u = await api.iam.users(tenantId);
     setUsers(u.users);
     setEditingUserId(null);
     showFeedback('success', 'User updated successfully');
   } catch (err) {
     console.error('Failed to update user', err);
     showError('Failed to update user', err, 'Failed to update user');
   }
   setSavingUser(false);
 };

 const handleDeleteUser = async (user: IAMUser) => {
   if (!confirm(`Are you sure you want to delete ${user.name} (${user.email})? This cannot be undone.`)) return;
   try {
     await api.iam.deleteUser(user.id, tenantId);
     setUsers(prev => prev.filter(u => u.id !== user.id));
     showFeedback('success', `User ${user.email} deleted`);
   } catch (err) {
     console.error('Failed to delete user', err);
     showError('Failed to delete user', err, 'Failed to delete user');
   }
 };

 const handleResendWelcome = async (user: IAMUser) => {
   try {
     const result = await api.iam.resendWelcome(user.id, tenantId) as { success: boolean; tempPassword?: string };
     if (result.tempPassword) {
       setInviteResult({ email: user.email, tempPassword: result.tempPassword });
       setShowInviteUser(true);
     }
     showFeedback('success', `Welcome email resent to ${user.email}`);
   } catch (err) {
     console.error('Failed to resend welcome', err);
     showError('Failed to resend welcome', err, 'Failed to resend welcome email');
   }
 };

 const handleToggleStatus = async (user: IAMUser) => {
   const newStatus = user.status === 'active' ? 'suspended' : 'active';
   const label = newStatus === 'suspended' ? 'suspend' : 'reactivate';
   if (!confirm(`${label.charAt(0).toUpperCase() + label.slice(1)} user ${user.name}?`)) return;
   await handleUpdateUser(user.id, { status: newStatus });
 };

 useEffect(() => {
   async function load() {
     setLoading(true);
     const [p, s, r, u] = await Promise.allSettled([
       api.iam.policies(tenantId), api.iam.sso(tenantId), api.iam.roles(tenantId), api.iam.users(tenantId),
     ]);
     if (p.status === 'fulfilled') setPolicies(p.value.policies);
     if (s.status === 'fulfilled') setSsoConfigs(s.value.configs);
     if (r.status === 'fulfilled') setRoles(r.value.roles);
     if (u.status === 'fulfilled') setUsers(u.value.users);
     setIamLoadedAt(new Date().toISOString());
     // Surface load failures so users know something is missing instead of
     // just seeing a partial/empty page. Pick the first rejection's requestId
     // so support can trace.
     const rejections = [
       { key: 'policies', result: p },
       { key: 'SSO providers', result: s },
       { key: 'roles', result: r },
       { key: 'users', result: u },
     ].filter((x): x is { key: string; result: PromiseRejectedResult } => x.result.status === 'rejected');
     if (rejections.length > 0) {
       const first = rejections[0];
       const err = first.result.reason;
       toast.error(`Failed to load ${rejections.map(r => r.key).join(', ')}`, {
         message: err instanceof Error ? err.message : 'Some IAM data could not be loaded',
         requestId: err instanceof ApiError ? err.requestId : null,
       });
     }
     setLoading(false);
   }
   load();
   // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [tenantId]);

 const tabs = [
   { id: 'users', label: 'Users', icon: <Users size={14} />, count: users.length },
   { id: 'roles', label: 'Roles & Permissions', icon: <ShieldCheck size={14} />, count: roles.length },
   { id: 'policies', label: 'Policies', icon: <Shield size={14} />, count: policies.length },
   { id: 'sso', label: 'SSO / Identity', icon: <Key size={14} /> },
 ];

 if (loading) return <LoadingState variant="cards" count={4} />;

 return (
   <div className="space-y-6 animate-fadeIn">
     {/* Header */}
     <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
       <HeroHeader
         icon={ShieldCheck}
         title="Identity & Access"
         subtitle={
           isSuperAdmin ? 'Company admins, users, roles, policies' :
           isCompanyAdmin ? 'Your company users, roles, policies' :
           'Users, roles, policies'
         }
         accent="sage"
       />
       {isAdmin && (
         <div className="flex gap-2">
           <Button variant="primary" size="sm" onClick={() => { setInviteResult(null); setInviteForm({ name: '', email: '', role: assignableRoles[0] || 'analyst', sendWelcome: true }); setShowInviteUser(true); }} title="Invite a new user">
             <UserPlus size={14} /> {isSuperAdmin ? 'Add Admin' : 'Add User'}
           </Button>
           <Button variant="secondary" size="sm" onClick={() => setShowNewPolicy(true)} title="Create a new access policy">
             <Plus size={14} /> New Policy
           </Button>
         </div>
       )}
     </div>

     {/* Feedback banner */}
     {actionFeedback && (
       <div className={`px-4 py-2 rounded-lg text-sm flex items-center gap-2 ${actionFeedback.type === 'success' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
         {actionFeedback.type === 'success' ? <CheckCircle size={14} /> : <Ban size={14} />}
         {actionFeedback.message}
         <button onClick={() => setActionFeedback(null)} className="ml-auto"><X size={14} /></button>
       </div>
     )}

     {/* Invite User Modal */}
     {showInviteUser && (
       <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
           <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold t-primary">{inviteResult ? 'User Created' : isSuperAdmin ? 'Add Company Admin' : 'Add Company User'}</h3>
             <button onClick={() => { setShowInviteUser(false); setInviteResult(null); }} className="text-gray-400 hover:text-gray-300"><X size={18} /></button>
           </div>

           {inviteResult ? (
             <div className="space-y-4">
               <div className="p-4 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                 <p className="text-sm text-emerald-400 font-medium mb-2">User created successfully</p>
                 <div className="space-y-2">
                   <div>
                     <span className="text-xs text-gray-400">Email</span>
                     <p className="text-sm t-primary font-mono">{inviteResult.email}</p>
                   </div>
                   <div>
                     <span className="text-xs text-gray-400">Temporary Password</span>
                     <p className="text-sm t-primary font-mono bg-[var(--bg-secondary)] px-2 py-1 rounded select-all">{inviteResult.tempPassword}</p>
                   </div>
                 </div>
               </div>
               <p className="text-caption t-muted">Share these credentials securely. The user will be prompted to change their password on first login.</p>
               <Button variant="primary" size="sm" className="w-full" onClick={() => { setShowInviteUser(false); setInviteResult(null); setInviteForm({ name: '', email: '', role: assignableRoles[0] || 'analyst', sendWelcome: true }); }}>Done</Button>
             </div>
           ) : (
             <>
               <div className="space-y-3">
                 <div>
                   <label className="text-xs t-muted block mb-1">Full Name</label>
                   <input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={inviteForm.name} onChange={e => setInviteForm(p => ({ ...p, name: e.target.value }))} placeholder="John Smith" />
                 </div>
                 <div>
                   <label className="text-xs t-muted block mb-1">Email Address</label>
                   <input type="email" className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={inviteForm.email} onChange={e => setInviteForm(p => ({ ...p, email: e.target.value }))} placeholder="john@company.co.za" />
                 </div>
                 <div>
                   <label className="text-xs t-muted block mb-1">Role</label>
                   <select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={inviteForm.role} onChange={e => setInviteForm(p => ({ ...p, role: e.target.value }))}>
                     {roles.filter(r => assignableRoles.includes(r.id)).map(r => (
                       <option key={r.id} value={r.id}>{r.name}</option>
                     ))}
                   </select>
                   <p className="text-caption t-muted mt-1">
                     {ROLE_PERMISSIONS[inviteForm.role]?.actions.slice(0, 2).join(', ')}
                   </p>
                 </div>
                 <div className="flex items-center gap-2">
                   <input type="checkbox" id="sendWelcome" checked={inviteForm.sendWelcome} onChange={e => setInviteForm(p => ({ ...p, sendWelcome: e.target.checked }))} className="rounded" />
                   <label htmlFor="sendWelcome" className="text-xs t-muted">Send welcome email with login credentials</label>
                 </div>
               </div>
               <div className="flex gap-3 pt-2">
                 <Button variant="secondary" size="sm" onClick={() => setShowInviteUser(false)}>Cancel</Button>
                 <Button variant="primary" size="sm" onClick={handleInviteUser} disabled={!inviteForm.name.trim() || !inviteForm.email.trim() || inviting}>
                   {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} {isSuperAdmin ? 'Add Admin' : 'Add User'}
                 </Button>
               </div>
             </>
           )}
         </div>
       </div></Portal>
     )}

     {/* New Policy Modal */}
     {showNewPolicy && (
       <Portal><div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
         <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} className="rounded-xl shadow-2xl p-6 w-full max-w-md space-y-4 max-h-[90vh] overflow-y-auto">
           <div className="flex items-center justify-between">
             <h3 className="text-lg font-semibold t-primary">Create New Policy</h3>
             <button onClick={() => setShowNewPolicy(false)} className="text-gray-400 hover:text-gray-300"><X size={18} /></button>
           </div>
           <div className="space-y-3">
             <div><label className="text-xs t-muted block mb-1">Policy Name</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={policyForm.name} onChange={e => setPolicyForm(p => ({ ...p, name: e.target.value }))} placeholder="Read-only analysts" /></div>
             <div><label className="text-xs t-muted block mb-1">Description</label><input className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={policyForm.description} onChange={e => setPolicyForm(p => ({ ...p, description: e.target.value }))} placeholder="Policy description" /></div>
             <div><label className="text-xs t-muted block mb-1">Type</label><select className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] text-sm t-primary" value={policyForm.type} onChange={e => setPolicyForm(p => ({ ...p, type: e.target.value }))}><option value="rbac">RBAC (Role-Based)</option><option value="abac">ABAC (Attribute-Based)</option></select></div>
           </div>
           <p className="text-caption t-muted">Rules can be added after creating the policy.</p>
           <div className="flex gap-3 pt-2">
             <Button variant="secondary" size="sm" onClick={() => setShowNewPolicy(false)}>Cancel</Button>
             <Button variant="primary" size="sm" onClick={handleCreatePolicy} disabled={!policyForm.name.trim() || creatingPolicy}>
               {creatingPolicy ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Create Policy
             </Button>
           </div>
         </div>
       </div></Portal>
     )}

     {/* Summary Cards — each tile carries a MetricSource so a CISO can
         audit exactly which IAM table and predicate produced the number.
         CC6.1 / CC6.2 evidence-pack alignment matters here. */}
     {(() => {
       const activeUsers = users.filter(u => u.status === 'active').length;
       const suspendedUsers = users.filter(u => u.status === 'suspended').length;
       const rolesInUse = roles.filter(r => r.userCount > 0).length;
       const totalRules = policies.reduce((s, p) => s + (Array.isArray(p.rules) ? p.rules.length : 0), 0);
       const enabledSso = ssoConfigs.filter(s => s.enabled).length;
       const baseProvenance: Partial<MetricProvenance> = {
         endpoint: 'GET /api/iam/users + /roles + /policies + /sso',
         refreshedAt: iamLoadedAt,
         window: 'Snapshot at load',
       };
       return (
     <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
       <Card>
         <div className="flex items-center justify-between">
           <span className="text-xs t-secondary">Active Users</span>
           <MetricSource source={{
             ...baseProvenance,
             label: 'Active users',
             definition: 'Non-suspended user accounts for this tenant. SOC 2 CC6.1 access-review denominator.',
             table: 'users',
             query: "COUNT(*) FROM users WHERE tenant_id = ? AND status = 'active'",
             sample: activeUsers,
             notes: [{ label: 'Suspended', value: `${suspendedUsers} accounts` }],
           }} />
         </div>
         <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{activeUsers}</p>
         <span className="text-caption t-muted">{suspendedUsers} suspended</span>
       </Card>
       <Card>
         <div className="flex items-center justify-between">
           <span className="text-xs t-secondary">User Roles</span>
           <MetricSource source={{
             ...baseProvenance,
             label: 'Roles in use',
             definition: 'IAM roles with at least one user assignment. Roles with 0 users are defined but unused and a red flag for SOC 2 CC6.1 hygiene.',
             table: 'iam_roles × user_roles',
             query: 'COUNT(DISTINCT role_id) FROM user_roles WHERE tenant_id = ?',
             sample: rolesInUse,
             notes: [{ label: 'Total defined', value: roles.length }],
           }} />
         </div>
         <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{rolesInUse}</p>
         <span className="text-caption t-muted">{roles.length} total defined</span>
       </Card>
       <Card>
         <div className="flex items-center justify-between">
           <span className="text-xs t-secondary">Active Policies</span>
           <MetricSource source={{
             ...baseProvenance,
             label: 'Active access policies',
             definition: 'IAM access policies the engine evaluates on every request. Each policy carries N rules.',
             table: 'iam_policies',
             query: 'COUNT(*) FROM iam_policies WHERE tenant_id = ?',
             sample: policies.length,
             notes: [{ label: 'Total rules', value: totalRules }],
           }} />
         </div>
         <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{policies.length}</p>
         <span className="text-caption t-muted">{totalRules} rules</span>
       </Card>
       <Card>
         <div className="flex items-center justify-between">
           <span className="text-xs t-secondary">SSO Providers</span>
           <MetricSource source={{
             ...baseProvenance,
             label: 'SSO providers enabled',
             definition: 'Identity providers (SAML / OIDC) currently enforced for sign-in. Enterprise procurement gates: ≥ 1 SSO provider is the de-facto floor.',
             table: 'sso_configs',
             query: 'COUNT(*) FROM sso_configs WHERE tenant_id = ? AND enabled = 1',
             sample: enabledSso,
             notes: [{ label: 'Configured (incl. disabled)', value: ssoConfigs.length }],
           }} />
         </div>
         <p className="text-headline-lg font-bold t-primary tabular-nums font-mono mt-1">{enabledSso}</p>
         <span className="text-caption t-muted">{ssoConfigs.length} configured</span>
       </Card>
     </div>
       );
     })()}

     <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

     {/* Users Tab */}
     {activeTab === 'users' && (
       <TabPanel>
         <div className="space-y-3">
           {isAdmin && users.length > 0 && (
             <div className="flex items-center justify-between px-1">
               <span className="text-xs t-muted">{users.length} user{users.length !== 1 ? 's' : ''} in this tenant</span>
               <Button variant="primary" size="sm" onClick={() => { setInviteResult(null); setInviteForm({ name: '', email: '', role: assignableRoles[0] || 'analyst', sendWelcome: true }); setShowInviteUser(true); }}>
                 <UserPlus size={12} /> {isSuperAdmin ? 'Add Admin' : 'Add User'}
               </Button>
             </div>
           )}

           {users.length === 0 && (
             <div className="text-center py-12 text-gray-400">
               <Users className="w-8 h-8 mx-auto mb-3 text-gray-300" />
               <p className="text-sm">No users found for this tenant</p>
               {isAdmin && (
                 <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowInviteUser(true)}>
                   <UserPlus size={14} /> {isSuperAdmin ? 'Add First Admin' : 'Add First User'}
                 </Button>
               )}
             </div>
           )}

           {users.map((user) => {
             const isSelf = currentUser?.id === user.id;
             const isEditing = editingUserId === user.id;
             const manageable = canManageUser(user);

             return (
               <Card key={user.id}>
                 <div className="flex items-center justify-between flex-wrap gap-2">
                   <div className="flex items-center gap-3 min-w-0">
                     <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${user.status === 'active' ? 'bg-accent/10' : 'bg-red-500/10'}`}>
                       {user.status === 'active' ? (
                         <UserCheck className="w-4 h-4 text-accent" />
                       ) : (
                         <Ban className="w-4 h-4 text-red-400" />
                       )}
                     </div>
                     <div className="min-w-0">
                       <div className="flex items-center gap-2">
                         <p className="text-sm font-medium t-primary truncate">{user.name}</p>
                         {isSelf && <Badge variant="outline" size="sm">You</Badge>}
                       </div>
                       <p className="text-xs t-muted truncate">{user.email}</p>
                       <div className="flex items-center gap-2 mt-0.5">
                         {user.lastLogin ? (
                           <span className="text-caption t-muted">Last login: {new Date(user.lastLogin).toLocaleDateString()}</span>
                         ) : (
                           <span className="text-caption text-amber-400">Never logged in</span>
                         )}
                       </div>
                     </div>
                   </div>

                   <div className="flex items-center gap-2 flex-wrap">
                     {isEditing ? (
                       <>
                         <select
                           value={editRole}
                           onChange={(e) => setEditRole(e.target.value)}
                           className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
                         >
                           {roles.filter(r => assignableRoles.includes(r.id)).map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                         </select>
                         <select
                           value={editStatus}
                           onChange={(e) => setEditStatus(e.target.value)}
                           className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary"
                         >
                           <option value="active">Active</option>
                           <option value="suspended">Suspended</option>
                         </select>
                         <Button variant="primary" size="sm" disabled={savingUser} onClick={() => {
                           const updates: Record<string, unknown> = {};
                           if (editRole !== user.role) updates.role = editRole;
                           if (editStatus !== user.status) updates.status = editStatus;
                           if (Object.keys(updates).length > 0) {
                             handleUpdateUser(user.id, updates);
                           } else {
                             setEditingUserId(null);
                           }
                         }} title="Save changes">
                           {savingUser ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />}
                         </Button>
                         <Button variant="secondary" size="sm" onClick={() => setEditingUserId(null)} title="Cancel"><X size={12} /></Button>
                       </>
                     ) : (
                       <>
                         <Badge variant={user.status === 'active' ? 'success' : 'danger'} size="sm">
                           {user.status || 'active'}
                         </Badge>
                         <Badge variant={user.role?.includes('admin') ? 'danger' : user.role?.includes('exec') ? 'warning' : 'info'} size="sm">
                           {user.role || 'viewer'}
                         </Badge>

                         {manageable && (
                           <>
                             <Button variant="secondary" size="sm" onClick={() => { setEditingUserId(user.id); setEditRole(user.role || 'viewer'); setEditStatus(user.status || 'active'); }} title="Edit user">
                               <Pencil size={12} />
                             </Button>
                             <Button variant="secondary" size="sm" onClick={() => handleToggleStatus(user)} title={user.status === 'active' ? 'Suspend user' : 'Reactivate user'}>
                               {user.status === 'active' ? <Ban size={12} className="text-amber-400" /> : <RotateCcw size={12} className="text-emerald-400" />}
                             </Button>
                             {!user.lastLogin && (
                               <Button variant="secondary" size="sm" onClick={() => handleResendWelcome(user)} title="Resend welcome email">
                                 <Mail size={12} />
                               </Button>
                             )}
                             <Button variant="secondary" size="sm" onClick={() => handleDeleteUser(user)} title="Delete user">
                               <Trash2 size={12} className="text-red-400" />
                             </Button>
                           </>
                         )}

                         {!isAdmin && (
                           <Button variant="secondary" size="sm" title="View permissions" onClick={() => setExpandedRoleId(expandedRoleId === user.id ? null : user.id)}>
                             <Eye size={12} />
                           </Button>
                         )}
                       </>
                     )}
                   </div>
                 </div>

                 {expandedRoleId === user.id && ROLE_PERMISSIONS[user.role || 'viewer'] && (
                   <div className="mt-3 pt-3 border-t border-[var(--border-card)]">
                     <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                       <div>
                         <span className="text-label">Page Access</span>
                         <div className="flex flex-wrap gap-1 mt-1">
                           {ROLE_PERMISSIONS[user.role || 'viewer'].pages.map(p => (
                             <Badge key={p} variant="outline" size="sm">{p}</Badge>
                           ))}
                         </div>
                       </div>
                       <div>
                         <span className="text-label">Allowed Actions</span>
                         <div className="flex flex-wrap gap-1 mt-1">
                           {ROLE_PERMISSIONS[user.role || 'viewer'].actions.map(a => (
                             <Badge key={a} variant="info" size="sm">{a}</Badge>
                           ))}
                         </div>
                       </div>
                     </div>
                   </div>
                 )}
               </Card>
             );
           })}
         </div>
       </TabPanel>
     )}

     {/* Roles & Permissions Tab */}
     {activeTab === 'roles' && (
       <TabPanel>
         <div className="space-y-4">
           {roles.map((role) => {
             const Icon = role.name.toLowerCase().includes('admin') ? ShieldCheck : role.name.toLowerCase().includes('exec') ? Shield : role.name.toLowerCase().includes('manager') ? UserCheck : Users;
             const color = role.name.toLowerCase().includes('admin') ? 'text-red-400' : role.name.toLowerCase().includes('exec') ? 'text-amber-400' : role.name.toLowerCase().includes('manager') ? 'text-accent' : 'text-accent';
             const isExpanded = expandedRoleId === role.id;
             const perms = ROLE_PERMISSIONS[role.id];

             return (
               <Card key={role.id}>
                 <div className="flex items-center justify-between cursor-pointer" onClick={() => setExpandedRoleId(isExpanded ? null : role.id)}>
                   <div className="flex items-center gap-3">
                     <Icon className={`w-5 h-5 ${color}`} />
                     <div>
                       <h3 className="text-base font-semibold t-primary">{role.name}</h3>
                       <p className="text-xs t-muted">{role.description}</p>
                     </div>
                   </div>
                   <div className="flex items-center gap-3">
                     <Badge variant="outline" size="sm">Level {role.level}</Badge>
                     <Badge variant="info" size="sm">{role.userCount} user{role.userCount !== 1 ? 's' : ''}</Badge>
                     {isExpanded ? <ChevronUp size={16} className="text-gray-400" /> : <ChevronDown size={16} className="text-gray-400" />}
                   </div>
                 </div>

                 {isExpanded && perms && (
                   <div className="mt-4 pt-4 border-t border-[var(--border-card)] space-y-4">
                     <div>
                       <span className="text-label">Page Access</span>
                       <div className="flex flex-wrap gap-1.5 mt-2">
                         {perms.pages.map(p => (
                           <div key={p} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                             <Unlock size={10} className="text-emerald-400" />
                             <span className="text-xs t-secondary">{p}</span>
                           </div>
                         ))}
                       </div>
                     </div>
                     <div>
                       <span className="text-label">Allowed Actions</span>
                       <div className="flex flex-wrap gap-1.5 mt-2">
                         {perms.actions.map(a => (
                           <div key={a} className="flex items-center gap-1 px-2 py-1 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                             <CheckCircle size={10} className="text-accent" />
                             <span className="text-xs t-secondary">{a}</span>
                           </div>
                         ))}
                       </div>
                     </div>
                     {role.userCount > 0 && (
                       <div>
                         <span className="text-label">Users with this role</span>
                         <div className="flex flex-wrap gap-1.5 mt-2">
                           {users.filter(u => u.role === role.id).map(u => (
                             <Badge key={u.id} variant="outline" size="sm">{u.name}</Badge>
                           ))}
                         </div>
                       </div>
                     )}
                   </div>
                 )}
               </Card>
             );
           })}
         </div>
       </TabPanel>
     )}

     {/* Policies Tab */}
     {activeTab === 'policies' && (
       <TabPanel>
         <div className="space-y-4">
           {policies.length === 0 && (
             <div className="text-center py-12 text-gray-400">
               <Shield className="w-8 h-8 mx-auto mb-3 text-gray-300" />
               <p className="text-sm">No policies configured</p>
               {isAdmin && (
                 <Button variant="primary" size="sm" className="mt-4" onClick={() => setShowNewPolicy(true)}>
                   <Plus size={14} /> Create First Policy
                 </Button>
               )}
             </div>
           )}
           {policies.map((policy) => (
             <Card key={policy.id}>
               <div className="flex items-start justify-between">
                 <div>
                   <div className="flex items-center gap-2">
                     <h3 className="text-base font-semibold t-primary">{policy.name}</h3>
                     <Badge variant={policy.type === 'rbac' ? 'info' : 'warning'} size="sm">{policy.type.toUpperCase()}</Badge>
                   </div>
                   <p className="text-xs t-muted mt-1">{policy.description}</p>
                 </div>
                 <div className="flex items-center gap-2">
                   <Badge variant="outline">{Array.isArray(policy.rules) ? policy.rules.length : 0} rules</Badge>
                   {isAdmin && (
                     <Button variant="secondary" size="sm" onClick={async () => {
                       if (!confirm(`Delete policy "${policy.name}"?`)) return;
                       try {
                         await api.iam.deletePolicy(policy.id);
                         setPolicies(prev => prev.filter(p => p.id !== policy.id));
                         showFeedback('success', `Policy "${policy.name}" deleted`);
                       } catch (err) { console.error('Failed to delete policy', err); showError('Failed to delete policy', err, 'Failed to delete policy'); }
                     }} title="Delete policy"><Trash2 size={12} className="text-red-400" /></Button>
                   )}
                 </div>
               </div>

               <div className="mt-3 space-y-2">
                 {(Array.isArray(policy.rules) ? policy.rules : []).map((rule, idx) => {
                   const r = rule as Record<string, unknown>;
                   return (
                     <div key={idx} className="flex items-center gap-3 p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
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

     {/* SSO Tab */}
     {activeTab === 'sso' && (
       <TabPanel>
         <div className="space-y-4">
           {ssoConfigs.length === 0 && (
             <div className="text-center py-12 text-gray-400">
               <Globe className="w-8 h-8 mx-auto mb-3 text-gray-300" />
               <p className="text-sm">No SSO providers configured</p>
               <p className="text-xs text-gray-500 mt-1">Configure SAML/OIDC providers for single sign-on</p>
             </div>
           )}
           {ssoConfigs.map((sso, i) => (
             <Card key={i}>
               <div className="flex items-start justify-between">
                 <div className="flex items-center gap-3">
                   <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
                     <Globe className="w-5 h-5 text-accent" />
                   </div>
                   <div>
                     <h3 className="text-base font-semibold t-primary">{sso.provider.replace('_', ' ').toUpperCase()}</h3>
                     <span className="text-xs t-muted">{sso.domainHint}</span>
                   </div>
                 </div>
                 <Badge variant={sso.enabled ? 'success' : 'default'}>{sso.enabled ? 'Active' : 'Disabled'}</Badge>
               </div>
               <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
                 <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                   <span className="text-caption t-muted">Client ID</span>
                   <p className="text-xs t-secondary font-mono truncate">{sso.clientId}</p>
                 </div>
                 <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                   <span className="text-caption t-muted">Issuer URL</span>
                   <p className="text-xs t-secondary font-mono truncate">{sso.issuerUrl}</p>
                 </div>
                 <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                   <span className="text-caption t-muted">Auto-Provision</span>
                   <p className="text-xs t-secondary">{sso.autoProvision ? 'Yes' : 'No'}</p>
                 </div>
                 <div className="p-2 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                   <span className="text-caption t-muted">Default Role</span>
                   <p className="text-xs t-secondary">{sso.defaultRole}</p>
                 </div>
               </div>
             </Card>
           ))}
         </div>
       </TabPanel>
     )}
   </div>
 );
}
