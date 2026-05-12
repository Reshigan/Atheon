/**
 * v46-platform: Custom Role Builder
 * Admin+ UI for composing custom roles from the platform's canonical permission
 * taxonomy (apex/pulse/catalysts/mind/memory/iam/admin × read/write).
 *
 * Custom roles may inherit from a built-in base role (analyst/operator/manager/
 * admin) — inherited permissions are shown pre-checked and read-only so the
 * user understands the cumulative set. A custom role with users assigned cannot
 * be deleted; the backend enforces this and returns 409.
 *
 * Route: /custom-roles | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { LoadingState, EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { useAppStore } from '@/stores/appStore';
import { api, ApiError } from '@/lib/api';
import type { CustomRole } from '@/lib/api';
import { Link } from 'react-router-dom';
import {
  Shield, Plus, Pencil, Trash2, CheckCircle, Loader2, AlertCircle, Users, ArrowLeft,
} from 'lucide-react';

type BaseRole = { id: string; name: string; permissions: string[] };

interface FormState {
  name: string;
  description: string;
  inheritsFrom: string;
  permissions: string[];
}

const EMPTY_FORM: FormState = { name: '', description: '', inheritsFrom: '', permissions: [] };

/** Group permission strings by their leading namespace (apex, pulse, …). */
function groupPermissions(perms: string[]): Record<string, string[]> {
  const groups: Record<string, string[]> = {};
  for (const p of perms) {
    const [ns] = p.split('.');
    if (!groups[ns]) groups[ns] = [];
    groups[ns].push(p);
  }
  return groups;
}

/** Human label for a permission string. `apex.read` → "read apex". */
function permLabel(p: string): string {
  const parts = p.split('.');
  if (parts.length < 2) return p;
  const action = parts.slice(1).join('.');
  return action;
}

export function CustomRoleBuilderPage() {
  const toast = useToast();
  const activeTenantId = useAppStore((s) => s.activeTenantId);
  const userTenantId = useAppStore((s) => s.user?.tenantId);
  const tenantId = activeTenantId || userTenantId || undefined;

  const [roles, setRoles] = useState<CustomRole[]>([]);
  const [allPermissions, setAllPermissions] = useState<string[]>([]);
  const [baseRoles, setBaseRoles] = useState<BaseRole[]>([]);
  const [loading, setLoading] = useState(true);

  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deletingId, setDeletingId] = useState<string | null>(null);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.iam.customRoles(tenantId);
      setRoles(res.roles);
    } catch (err) {
      showError('Failed to load custom roles', err, 'Network error');
    }
  }, [tenantId, showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [rolesRes, permsRes] = await Promise.all([
          api.iam.customRoles(tenantId),
          api.iam.permissions(),
        ]);
        if (!cancelled) {
          setRoles(rolesRes.roles);
          setAllPermissions(permsRes.permissions);
          setBaseRoles(permsRes.baseRoles);
        }
      } catch (err) {
        if (!cancelled) showError('Failed to load custom roles', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, showError]);

  /** Inherited permission set for the currently-selected base role. */
  const inheritedPerms = useMemo(() => {
    if (!form.inheritsFrom) return new Set<string>();
    const base = baseRoles.find(b => b.id === form.inheritsFrom);
    return new Set(base?.permissions || []);
  }, [form.inheritsFrom, baseRoles]);

  /** Permissions grouped by namespace for the matrix UI. */
  const permissionGroups = useMemo(() => groupPermissions(allPermissions), [allPermissions]);

  /** Is a permission currently granted (inherited OR explicit)? */
  const isGranted = (p: string): boolean => inheritedPerms.has(p) || form.permissions.includes(p);

  /** Inherited permissions cannot be unchecked — they come from the base role. */
  const isInherited = (p: string): boolean => inheritedPerms.has(p);

  const togglePermission = (p: string) => {
    if (isInherited(p)) return; // read-only
    setForm(prev => ({
      ...prev,
      permissions: prev.permissions.includes(p)
        ? prev.permissions.filter(x => x !== p)
        : [...prev.permissions, p],
    }));
  };

  /** Toggle an entire group — if any child is unchecked, check all; else uncheck all. */
  const toggleGroup = (groupPerms: string[]) => {
    const togglable = groupPerms.filter(p => !isInherited(p));
    const anyUnchecked = togglable.some(p => !form.permissions.includes(p));
    setForm(prev => {
      if (anyUnchecked) {
        // Add any missing togglable perms
        const next = new Set(prev.permissions);
        togglable.forEach(p => next.add(p));
        return { ...prev, permissions: [...next] };
      } else {
        // Remove all togglable perms
        return { ...prev, permissions: prev.permissions.filter(p => !togglable.includes(p)) };
      }
    });
  };

  const startCreate = () => {
    setEditingRole(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (role: CustomRole) => {
    setEditingRole(role);
    setForm({
      name: role.name,
      description: role.description,
      inheritsFrom: role.inheritsFrom || '',
      permissions: [...role.permissions],
    });
    setShowForm(true);
  };

  const saveRole = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingRole) {
        await api.iam.updateCustomRole(editingRole.id, {
          name: form.name,
          description: form.description,
          inherits_from: form.inheritsFrom || null,
          permissions: form.permissions,
        }, tenantId);
        toast.success('Role updated', { message: form.name });
      } else {
        await api.iam.createCustomRole({
          name: form.name,
          description: form.description,
          inherits_from: form.inheritsFrom || undefined,
          permissions: form.permissions,
        }, tenantId);
        toast.success('Role created', { message: form.name });
      }
      setShowForm(false);
      setEditingRole(null);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      showError(editingRole ? 'Failed to update role' : 'Failed to create role', err, 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (role: CustomRole) => {
    if (role.userCount > 0) {
      toast.error('Cannot delete', { message: `${role.userCount} user(s) are still assigned to "${role.name}".` });
      return;
    }
    if (!window.confirm(`Delete custom role "${role.name}"? This cannot be undone.`)) return;
    setDeletingId(role.id);
    try {
      await api.iam.deleteCustomRole(role.id, tenantId);
      setRoles(prev => prev.filter(r => r.id !== role.id));
      toast.success('Role deleted', { message: role.name });
    } catch (err) {
      showError('Delete failed', err, 'Could not delete role');
    } finally {
      setDeletingId(null);
    }
  };

  // Summary for preview: "A user with this role can: <readable list>"
  const previewSummary = useMemo(() => {
    const all = new Set<string>([...form.permissions, ...inheritedPerms]);
    if (all.size === 0) return 'Nothing — this role has no permissions.';
    const byNs = groupPermissions([...all]);
    return Object.entries(byNs)
      .map(([ns, perms]) => `${perms.map(permLabel).join('/')} ${ns}`)
      .join('; ');
  }, [form.permissions, inheritedPerms]);

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Breadcrumb back to IAM — Custom Role Builder is reached from
          IAM's Roles tab; the back-link keeps that trail explicit. */}
      <Link
        to="/iam"
        className="inline-flex items-center gap-1 text-xs t-muted hover:t-primary"
      >
        <ArrowLeft size={12} /> Back to IAM — Roles &amp; Permissions
      </Link>
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Shield className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">Custom Role Builder</h1>
            <p className="text-xs t-muted">Compose custom roles from the permission taxonomy</p>
          </div>
        </div>
        <Button size="sm" onClick={startCreate}>
          <Plus size={14} className="mr-1" /> New Role
        </Button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-label">Custom Roles</p>
          <p className="text-xl font-bold t-primary">{roles.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Assigned Users</p>
          <p className="text-xl font-bold t-primary">{roles.reduce((sum, r) => sum + r.userCount, 0)}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Permission Surface</p>
          <p className="text-xl font-bold t-primary">{allPermissions.length}</p>
        </Card>
      </div>

      {/* Roles list */}
      {loading ? (
        <LoadingState variant="list" count={3} />
      ) : roles.length === 0 ? (
        <EmptyState
          icon={Shield}
          title="No custom roles yet"
          description="Create a role to grant a tailored permission surface to users."
        />
      ) : (
        <div className="space-y-2">
          {roles.map((role) => (
            <Card key={role.id} className="p-4">
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3 flex-1">
                  <div className="w-8 h-8 rounded-lg bg-accent/10 flex items-center justify-center mt-0.5">
                    <Shield size={14} className="text-accent" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium t-primary">{role.name}</p>
                      {role.inheritsFrom && (
                        <Badge variant="info" className="text-caption">inherits {role.inheritsFrom}</Badge>
                      )}
                      <Badge variant="default" className="text-caption">
                        {role.permissions.length + role.inheritedPermissions.length} perms
                      </Badge>
                    </div>
                    {role.description && <p className="text-xs t-muted mt-0.5">{role.description}</p>}
                    <div className="flex flex-wrap gap-1 mt-2">
                      {role.inheritedPermissions.slice(0, 3).map(p => (
                        <Badge key={`inh-${p}`} variant="info" className="text-caption">{p}</Badge>
                      ))}
                      {role.permissions.slice(0, 5).map(p => (
                        <Badge key={p} variant="default" className="text-caption">{p}</Badge>
                      ))}
                      {(role.permissions.length + role.inheritedPermissions.length) > 8 && (
                        <Badge variant="default" className="text-caption">
                          +{(role.permissions.length + role.inheritedPermissions.length) - 8} more
                        </Badge>
                      )}
                    </div>
                    <p className="text-caption t-muted mt-2 flex items-center gap-3">
                      <span className="flex items-center gap-1"><Users size={10} /> {role.userCount} user{role.userCount === 1 ? '' : 's'}</span>
                      <span>Created {new Date(role.createdAt).toLocaleDateString()}</span>
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-2">
                  <button
                    onClick={() => startEdit(role)}
                    className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] t-muted hover:t-primary transition-colors"
                    title="Edit"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => handleDelete(role)}
                    disabled={deletingId === role.id || role.userCount > 0}
                    className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    title={role.userCount > 0 ? `${role.userCount} user(s) assigned — cannot delete` : 'Delete'}
                  >
                    {deletingId === role.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-3xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-4">
              {editingRole ? `Edit Role — ${editingRole.name}` : 'Create Custom Role'}
            </h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Role Name</label>
                  <input
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                    value={form.name}
                    onChange={(e) => setForm(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g., Department Lead"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Inherits from</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                    value={form.inheritsFrom}
                    onChange={(e) => setForm(p => ({ ...p, inheritsFrom: e.target.value }))}
                  >
                    <option value="">(none)</option>
                    {baseRoles.map(b => (
                      <option key={b.id} value={b.id}>{b.name} — {b.permissions.length} perms</option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="Describe what this role can do..."
                />
              </div>

              {/* Permission matrix */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-xs font-medium t-primary">Permissions</label>
                  <span className="text-caption t-muted">
                    {form.permissions.length + inheritedPerms.size} selected
                    {inheritedPerms.size > 0 && <span> (incl. {inheritedPerms.size} inherited)</span>}
                  </span>
                </div>
                <div className="border border-[var(--border-card)] rounded-lg bg-[var(--bg-secondary)] p-3 space-y-3">
                  {Object.entries(permissionGroups).map(([ns, perms]) => {
                    const togglable = perms.filter(p => !isInherited(p));
                    const allChecked = togglable.length > 0 && togglable.every(p => form.permissions.includes(p));
                    return (
                      <div key={ns}>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-xs font-semibold t-primary uppercase tracking-wide">{ns}</p>
                          {togglable.length > 0 && (
                            <button
                              type="button"
                              className="text-caption text-accent hover:underline"
                              onClick={() => toggleGroup(perms)}
                            >
                              {allChecked ? 'deselect all' : 'select all'}
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                          {perms.map(p => {
                            const granted = isGranted(p);
                            const inherited = isInherited(p);
                            return (
                              <label
                                key={p}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors ${
                                  inherited
                                    ? 'bg-[var(--accent-subtle)] cursor-not-allowed opacity-90'
                                    : 'hover:bg-[var(--bg-modal)] cursor-pointer'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={granted}
                                  disabled={inherited}
                                  onChange={() => togglePermission(p)}
                                  className="rounded"
                                />
                                <span className={`font-mono ${inherited ? 'text-accent' : 't-primary'}`}>{p}</span>
                                {inherited && <span className="text-caption t-muted">(inherited)</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Preview */}
              <div className="rounded-lg border border-[var(--border-card)] bg-[var(--bg-secondary)] p-3">
                <div className="flex items-center gap-2 mb-1">
                  <CheckCircle size={12} className="text-emerald-400" />
                  <p className="text-xs font-medium t-primary">A user with this role can:</p>
                </div>
                <p className="text-xs t-muted break-words">{previewSummary}</p>
              </div>

              {editingRole && editingRole.userCount > 0 && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 p-3">
                  <AlertCircle size={14} className="text-amber-400 mt-0.5 flex-shrink-0" />
                  <p className="text-xs t-primary">
                    {editingRole.userCount} user(s) currently have this role. Changes will apply to them immediately.
                  </p>
                </div>
              )}
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving}>Cancel</Button>
              <Button
                onClick={saveRole}
                disabled={saving || !form.name.trim() || (form.permissions.length + inheritedPerms.size === 0)}
              >
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : <CheckCircle size={14} className="mr-1" />}
                {editingRole ? 'Save Changes' : 'Create Role'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
