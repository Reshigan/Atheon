/**
 * v46-platform: Feature Flags
 * Superadmin UI for managing flag rollouts. Three flag types:
 *  - boolean        — default_enabled toggle for everyone
 *  - percent        — deterministic % rollout per (tenant, flag)
 *  - tenant_allowlist — explicit opt-in for specific tenants
 *
 * The "Evaluate as tenant" dev tool lets a superadmin see exactly which flags
 * resolve true/false for any tenant, which is the only reliable way to verify
 * a rollout without impersonation.
 *
 * Route: /feature-flags | Role: superadmin only
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageHeader } from '@/components/ui/page-header';
import { LoadingState, EmptyState } from '@/components/ui/state';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { FeatureFlag, FeatureFlagType, Tenant } from '@/lib/api';
import {
  Flag, Plus, Trash2, ToggleLeft, ToggleRight,
  Search, Percent, List, Loader2, Pencil, FlaskConical,
} from 'lucide-react';

interface FormState {
  name: string;
  description: string;
  type: FeatureFlagType;
  defaultEnabled: boolean;
  rolloutPercent: number;
  tenantAllowlist: string[];
}

const EMPTY_FORM: FormState = {
  name: '',
  description: '',
  type: 'boolean',
  defaultEnabled: false,
  rolloutPercent: 0,
  tenantAllowlist: [],
};

export function FeatureFlagsPage() {
  const toast = useToast();
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  const [showForm, setShowForm] = useState(false);
  const [editingFlag, setEditingFlag] = useState<FeatureFlag | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const [showEvaluator, setShowEvaluator] = useState(false);
  const [evalTenantId, setEvalTenantId] = useState('');
  const [evalResult, setEvalResult] = useState<Record<string, boolean> | null>(null);
  const [evaluating, setEvaluating] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, {
      message,
      requestId: err instanceof ApiError ? err.requestId : null,
    });
  }, [toast]);

  const reload = useCallback(async () => {
    try {
      const res = await api.featureFlags.list();
      setFlags(res.flags);
    } catch (err) {
      showError('Failed to load feature flags', err, 'Network error');
    }
  }, [showError]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const [flagRes, tenantRes] = await Promise.all([
          api.featureFlags.list(),
          api.tenants.list().catch(() => ({ tenants: [] as Tenant[], total: 0 })),
        ]);
        if (!cancelled) {
          setFlags(flagRes.flags);
          setTenants(tenantRes.tenants || []);
        }
      } catch (err) {
        if (!cancelled) showError('Failed to load feature flags', err, 'Network error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [showError]);

  const filteredFlags = useMemo(() => {
    if (!searchQuery) return flags;
    const q = searchQuery.toLowerCase();
    return flags.filter(f =>
      f.name.toLowerCase().includes(q) ||
      (f.description || '').toLowerCase().includes(q)
    );
  }, [flags, searchQuery]);

  const startCreate = () => {
    setEditingFlag(null);
    setForm(EMPTY_FORM);
    setShowForm(true);
  };

  const startEdit = (flag: FeatureFlag) => {
    setEditingFlag(flag);
    setForm({
      name: flag.name,
      description: flag.description,
      type: flag.type,
      defaultEnabled: flag.defaultEnabled,
      rolloutPercent: flag.rolloutPercent,
      tenantAllowlist: [...flag.tenantAllowlist],
    });
    setShowForm(true);
  };

  const saveFlag = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      if (editingFlag) {
        await api.featureFlags.update(editingFlag.id, {
          description: form.description,
          type: form.type,
          default_enabled: form.defaultEnabled,
          rollout_percent: form.rolloutPercent,
          tenant_allowlist: form.tenantAllowlist,
        });
        toast.success('Flag updated', { message: editingFlag.name });
      } else {
        await api.featureFlags.create({
          name: form.name,
          description: form.description,
          type: form.type,
          default_enabled: form.defaultEnabled,
          rollout_percent: form.rolloutPercent,
          tenant_allowlist: form.tenantAllowlist,
        });
        toast.success('Flag created', { message: form.name });
      }
      setShowForm(false);
      setEditingFlag(null);
      setForm(EMPTY_FORM);
      await reload();
    } catch (err) {
      showError(editingFlag ? 'Failed to update flag' : 'Failed to create flag', err, 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleToggle = async (flag: FeatureFlag) => {
    setTogglingId(flag.id);
    try {
      const res = await api.featureFlags.toggle(flag.id);
      setFlags(prev => prev.map(f => f.id === flag.id ? res.flag : f));
    } catch (err) {
      showError('Toggle failed', err, 'Could not toggle flag');
    } finally {
      setTogglingId(null);
    }
  };

  const handleDelete = async (flag: FeatureFlag) => {
    if (!window.confirm(`Delete feature flag "${flag.name}"? This cannot be undone.`)) return;
    setDeletingId(flag.id);
    try {
      await api.featureFlags.delete(flag.id);
      setFlags(prev => prev.filter(f => f.id !== flag.id));
      toast.success('Flag deleted', { message: flag.name });
    } catch (err) {
      showError('Delete failed', err, 'Could not delete flag');
    } finally {
      setDeletingId(null);
    }
  };

  const runEvaluate = async () => {
    if (!evalTenantId) return;
    setEvaluating(true);
    setEvalResult(null);
    try {
      const res = await api.featureFlags.evaluate(evalTenantId);
      setEvalResult(res.flags);
    } catch (err) {
      showError('Evaluation failed', err, 'Could not evaluate flags');
    } finally {
      setEvaluating(false);
    }
  };

  const typeIcon = (t: FeatureFlagType) => {
    if (t === 'boolean') return <ToggleLeft size={12} />;
    if (t === 'percent') return <Percent size={12} />;
    return <List size={12} />;
  };

  const enabledCount = flags.filter(f => f.type === 'boolean' ? f.defaultEnabled : (f.type === 'percent' ? f.rolloutPercent > 0 : f.tenantAllowlist.length > 0)).length;

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Platform · Feature Flags"
        title="Feature Flags"
        dek="Control feature rollout across tenants"
        live
        actions={
          <>
            <Button size="sm" variant="outline" onClick={() => setShowEvaluator(true)}>
              <FlaskConical size={14} className="mr-1" /> Evaluate as Tenant
            </Button>
            <Button size="sm" onClick={startCreate}>
              <Plus size={14} className="mr-1" /> New Flag
            </Button>
          </>
        }
      />

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <Card className="p-3">
          <p className="text-label">Total Flags</p>
          <p className="text-xl font-bold t-primary font-mono tnum">{flags.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Active</p>
          <p className="text-xl font-bold text-accent font-mono tnum">{enabledCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Inactive</p>
          <p className="text-xl font-bold t-muted font-mono tnum">{flags.length - enabledCount}</p>
        </Card>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
        <input
          className="w-full pl-9 pr-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
          placeholder="Search flags by name or description..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Flags list */}
      {loading ? (
        <LoadingState variant="list" count={4} />
      ) : filteredFlags.length === 0 ? (
        <EmptyState
          icon={Flag}
          title={searchQuery ? 'No flags match your search' : 'No feature flags yet'}
          description={searchQuery ? undefined : 'Create a flag to start rolling out features by tenant, percent, or boolean.'}
        />
      ) : (
        <div className="space-y-2">
          {filteredFlags.map((f) => {
            const isActive = f.type === 'boolean' ? f.defaultEnabled : f.type === 'percent' ? f.rolloutPercent > 0 : f.tenantAllowlist.length > 0;
            return (
              <Card key={f.id} className="p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1">
                    <button
                      onClick={() => handleToggle(f)}
                      disabled={togglingId === f.id}
                      className="mt-0.5 disabled:opacity-50"
                      title={f.type === 'boolean' ? 'Toggle on/off' : 'Toggle default_enabled (effective only for boolean flags)'}
                    >
                      {togglingId === f.id ? (
                        <Loader2 size={22} className="animate-spin t-muted" />
                      ) : f.defaultEnabled ? (
                        <ToggleRight size={22} className="text-accent" />
                      ) : (
                        <ToggleLeft size={22} className="t-muted" />
                      )}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium t-primary font-mono">{f.name}</p>
                        <Badge variant={isActive ? 'success' : 'default'} className="text-caption">
                          {isActive ? 'active' : 'inactive'}
                        </Badge>
                        <Badge variant="default" className="text-caption flex items-center gap-0.5">
                          {typeIcon(f.type)} {f.type}
                        </Badge>
                      </div>
                      {f.description && <p className="text-xs t-muted mt-1">{f.description}</p>}
                      {f.type === 'percent' && (
                        <div className="flex items-center gap-2 mt-2">
                          <div className="w-24 h-1.5 rounded-full bg-[var(--bg-secondary)] overflow-hidden">
                            <div className="h-full rounded-full bg-accent" style={{ width: `${f.rolloutPercent}%` }} />
                          </div>
                          <span className="text-caption t-muted">{f.rolloutPercent}% rollout</span>
                        </div>
                      )}
                      {f.type === 'tenant_allowlist' && (
                        <p className="text-caption t-muted mt-2">
                          Allowlist: <span className="t-primary">{f.tenantAllowlist.length}</span> tenant{f.tenantAllowlist.length === 1 ? '' : 's'}
                        </p>
                      )}
                      <p className="text-caption t-muted mt-2">Updated {new Date(f.updatedAt).toLocaleString()}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-2">
                    <button
                      onClick={() => startEdit(f)}
                      className="p-1.5 rounded-md hover:bg-[var(--bg-secondary)] t-muted hover:t-primary transition-colors active:scale-[0.97]"
                      title="Edit"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(f)}
                      disabled={deletingId === f.id}
                      className="p-1.5 rounded-md hover:bg-[rgb(var(--neg-rgb)/0.1)] t-muted hover:text-neg transition-colors disabled:opacity-50 active:scale-[0.97]"
                      title="Delete"
                    >
                      {deletingId === f.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit modal */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !saving && setShowForm(false)}>
          <div className="bg-[var(--bg-modal)] rounded-md border border-[var(--border-card)] p-6 max-w-md w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-4">
              {editingFlag ? `Edit Flag — ${editingFlag.name}` : 'Create Feature Flag'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Flag Name</label>
                <input
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary font-mono disabled:opacity-60"
                  value={form.name}
                  disabled={!!editingFlag}
                  onChange={(e) => setForm(p => ({ ...p, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') }))}
                  placeholder="e.g., new_dashboard_ui"
                />
                {editingFlag && <p className="text-caption t-muted mt-1">Name cannot be changed after creation.</p>}
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Description</label>
                <textarea
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  rows={2}
                  value={form.description}
                  onChange={(e) => setForm(p => ({ ...p, description: e.target.value }))}
                  placeholder="What does this flag control?"
                />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Type</label>
                <select
                  className="w-full px-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  value={form.type}
                  onChange={(e) => setForm(p => ({ ...p, type: e.target.value as FeatureFlagType }))}
                >
                  <option value="boolean">Boolean (on/off for everyone)</option>
                  <option value="percent">Percent rollout (hash-based)</option>
                  <option value="tenant_allowlist">Tenant allowlist (explicit opt-in)</option>
                </select>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="ff-default-enabled"
                  checked={form.defaultEnabled}
                  onChange={(e) => setForm(p => ({ ...p, defaultEnabled: e.target.checked }))}
                  className="rounded"
                />
                <label htmlFor="ff-default-enabled" className="text-xs t-primary">
                  Default enabled
                  <span className="t-muted"> (used for boolean; ignored for percent/allowlist)</span>
                </label>
              </div>

              {form.type === 'percent' && (
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Rollout %: <span className="t-muted">{form.rolloutPercent}%</span></label>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={form.rolloutPercent}
                    onChange={(e) => setForm(p => ({ ...p, rolloutPercent: parseInt(e.target.value, 10) }))}
                    className="w-full"
                  />
                </div>
              )}

              {form.type === 'tenant_allowlist' && (
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">
                    Allowlisted tenants <span className="t-muted">({form.tenantAllowlist.length})</span>
                  </label>
                  <div className="max-h-40 overflow-y-auto border border-[var(--border-card)] rounded-md bg-[var(--bg-secondary)] p-2 space-y-1">
                    {tenants.length === 0 ? (
                      <p className="text-xs t-muted text-center py-2">No tenants loaded</p>
                    ) : tenants.map(t => (
                      <label key={t.id} className="flex items-center gap-2 text-xs t-primary cursor-pointer hover:bg-[var(--bg-modal)] rounded px-2 py-1 active:scale-[0.97]">
                        <input
                          type="checkbox"
                          checked={form.tenantAllowlist.includes(t.id)}
                          onChange={(e) => {
                            setForm(p => ({
                              ...p,
                              tenantAllowlist: e.target.checked
                                ? [...p.tenantAllowlist, t.id]
                                : p.tenantAllowlist.filter(id => id !== t.id),
                            }));
                          }}
                          className="rounded"
                        />
                        <span className="font-mono text-caption t-muted">{t.id}</span>
                        <span className="t-primary truncate">{t.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <Button variant="outline" onClick={() => setShowForm(false)} disabled={saving} className="flex-1">Cancel</Button>
              <Button onClick={saveFlag} disabled={saving || !form.name.trim()} className="flex-1">
                {saving ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                {editingFlag ? 'Save Changes' : 'Create Flag'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Evaluate as tenant dev tool */}
      {showEvaluator && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowEvaluator(false)}>
          <div className="bg-[var(--bg-modal)] rounded-md border border-[var(--border-card)] p-6 max-w-lg w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 mb-4">
              <FlaskConical className="w-5 h-5 text-accent" />
              <h3 className="text-base font-semibold t-primary">Evaluate flags as tenant</h3>
            </div>
            <p className="text-xs t-muted mb-3">Pick a tenant to see which flags resolve true/false with percent + allowlist rules applied.</p>
            <div className="flex gap-2 mb-4">
              <select
                className="flex-1 px-3 py-2 rounded-md border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                value={evalTenantId}
                onChange={(e) => setEvalTenantId(e.target.value)}
              >
                <option value="">Select a tenant...</option>
                {tenants.map(t => (
                  <option key={t.id} value={t.id}>{t.name} ({t.id})</option>
                ))}
              </select>
              <Button onClick={runEvaluate} disabled={!evalTenantId || evaluating}>
                {evaluating ? <Loader2 size={14} className="animate-spin mr-1" /> : null}
                Evaluate
              </Button>
            </div>
            {evalResult && (
              <div className="space-y-1 border border-[var(--border-card)] rounded-md bg-[var(--bg-secondary)] p-3 max-h-80 overflow-y-auto">
                {Object.keys(evalResult).length === 0 ? (
                  <p className="text-xs t-muted text-center py-3">No flags defined.</p>
                ) : Object.entries(evalResult).map(([name, val]) => (
                  <div key={name} className="flex items-center justify-between text-xs">
                    <span className="font-mono t-primary">{name}</span>
                    <Badge variant={val ? 'success' : 'default'} className="text-caption">
                      {val ? 'true' : 'false'}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
            <div className="flex justify-end mt-4">
              <Button variant="outline" onClick={() => setShowEvaluator(false)}>Close</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
