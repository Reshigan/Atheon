/**
 * ADMIN-012: System Alerts & Notification Rules (v45)
 * CRUD + silence + test for alert rules backed by the system_alert_rules table.
 * Route: /system-alerts | Role: admin, support_admin, superadmin
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabPanel, useTabState } from '@/components/ui/tabs';
import { LoadingState, EmptyState } from '@/components/ui/state';
import { api, ApiError } from '@/lib/api';
import { useToast } from '@/components/ui/toast';
import {
  Bell, Plus, Trash2, CheckCircle, XCircle, AlertTriangle, Clock, Mail,
  Webhook, MessageSquare, ToggleLeft, ToggleRight, Filter, Loader2, Play,
  VolumeX, Pencil, X as XIcon,
} from 'lucide-react';

type AlertRule = {
  id: string;
  name: string;
  description: string | null;
  event_type: string;
  condition: { field?: string; op?: string; operator?: string; value?: unknown };
  severity: 'info' | 'low' | 'medium' | 'high' | 'critical' | string;
  channels: string[];
  recipients: string[];
  enabled: boolean;
  silenced: boolean;
  silenced_until: string | null;
  triggered_count: number;
  last_triggered_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const EVENT_TYPES = [
  'erp.sync.failed',
  'erp.sync.succeeded',
  'catalyst.action.escalated',
  'catalyst.action.failed',
  'catalyst.run.completed',
  'health.score.dropped',
  'risk.alert.created',
  'anomaly.detected',
  'user.login.failed',
  'webhook.delivery.failed',
  'storage.quota.exceeded',
];

const SEVERITIES = ['info', 'low', 'medium', 'high', 'critical'] as const;
const CHANNELS = [
  { value: 'email', label: 'Email', icon: Mail },
  { value: 'webhook', label: 'Webhook', icon: Webhook },
  { value: 'slack', label: 'Slack', icon: MessageSquare },
  { value: 'in_app', label: 'In-App', icon: Bell },
];
const OPERATORS = ['==', '!=', '>', '>=', '<', '<=', 'contains', 'in'];

const SILENCE_PRESETS: Array<{ label: string; hours: number | null }> = [
  { label: '1 hour', hours: 1 },
  { label: '4 hours', hours: 4 },
  { label: '1 day', hours: 24 },
  { label: '1 week', hours: 24 * 7 },
  { label: 'Custom…', hours: null },
];

type RuleFormState = {
  id?: string;
  name: string;
  description: string;
  event_type: string;
  field: string;
  op: string;
  value: string;
  severity: string;
  channels: string[];
  recipients: string;
  enabled: boolean;
};

const EMPTY_FORM: RuleFormState = {
  name: '',
  description: '',
  event_type: EVENT_TYPES[0],
  field: 'severity',
  op: '>=',
  value: 'high',
  severity: 'medium',
  channels: ['email'],
  recipients: '',
  enabled: true,
};

export function SystemAlertsPage() {
  const toast = useToast();
  const { activeTab, setActiveTab } = useTabState('rules');

  const [rules, setRules] = useState<AlertRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);

  // Rule modal
  const [showRuleModal, setShowRuleModal] = useState(false);
  const [form, setForm] = useState<RuleFormState>(EMPTY_FORM);
  const [savingRule, setSavingRule] = useState(false);

  // Silence dialog
  const [silencingRule, setSilencingRule] = useState<AlertRule | null>(null);
  const [customSilenceUntil, setCustomSilenceUntil] = useState('');

  // Test dialog
  const [testingRule, setTestingRule] = useState<AlertRule | null>(null);
  const [testPayload, setTestPayload] = useState('{}');
  const [testResult, setTestResult] = useState<{ would_fire: boolean; matched: boolean; reason: string; enabled: boolean; silenced: boolean } | null>(null);
  const [runningTest, setRunningTest] = useState(false);

  const showError = useCallback((title: string, err: unknown, fallback: string) => {
    const message = err instanceof Error ? err.message : fallback;
    toast.error(title, { message, requestId: err instanceof ApiError ? err.requestId : null });
  }, [toast]);

  const loadRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.systemAlertRules.list();
      setRules((res.rules || []) as unknown as AlertRule[]);
    } catch (err) {
      showError('Failed to load alert rules', err, 'Could not load rules');
    } finally {
      setLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  const resetForm = () => setForm(EMPTY_FORM);

  const openCreateModal = () => {
    resetForm();
    setShowRuleModal(true);
  };

  const openEditModal = (r: AlertRule) => {
    setForm({
      id: r.id,
      name: r.name,
      description: r.description || '',
      event_type: r.event_type,
      field: String(r.condition?.field || 'severity'),
      op: String(r.condition?.op || r.condition?.operator || '=='),
      value: String(r.condition?.value ?? ''),
      severity: r.severity,
      channels: r.channels || [],
      recipients: (r.recipients || []).join(', '),
      enabled: r.enabled,
    });
    setShowRuleModal(true);
  };

  const submitRule = async () => {
    if (!form.name.trim()) { toast.warning('Name is required'); return; }
    if (!form.field.trim()) { toast.warning('Condition field is required'); return; }
    let parsedValue: unknown = form.value;
    // try JSON parse for numbers/bool/arrays, fall back to string
    try { parsedValue = JSON.parse(form.value); } catch { /* keep as string */ }
    const recipients = form.recipients.split(',').map(s => s.trim()).filter(Boolean);
    const payload = {
      name: form.name.trim(),
      description: form.description.trim(),
      event_type: form.event_type,
      condition: { field: form.field.trim(), op: form.op, value: parsedValue },
      severity: form.severity,
      channels: form.channels,
      recipients,
      enabled: form.enabled,
    };
    setSavingRule(true);
    try {
      if (form.id) {
        await api.systemAlertRules.update(form.id, payload);
        toast.success('Rule updated');
      } else {
        await api.systemAlertRules.create(payload);
        toast.success('Rule created');
      }
      setShowRuleModal(false);
      resetForm();
      await loadRules();
    } catch (err) {
      showError('Failed to save rule', err, 'Could not save rule');
    } finally {
      setSavingRule(false);
    }
  };

  const toggleRuleEnabled = async (r: AlertRule) => {
    setSavingId(r.id);
    try {
      await api.systemAlertRules.update(r.id, { enabled: !r.enabled });
      await loadRules();
    } catch (err) {
      showError('Failed to toggle rule', err, 'Could not update rule');
    } finally {
      setSavingId(null);
    }
  };

  const deleteRule = async (r: AlertRule) => {
    if (!confirm(`Delete rule "${r.name}"?`)) return;
    setSavingId(r.id);
    try {
      await api.systemAlertRules.remove(r.id);
      toast.success('Rule deleted');
      await loadRules();
    } catch (err) {
      showError('Failed to delete rule', err, 'Could not delete rule');
    } finally {
      setSavingId(null);
    }
  };

  const applySilence = async (preset: { label: string; hours: number | null }) => {
    if (!silencingRule) return;
    let until: string | null;
    if (preset.hours === null) {
      if (!customSilenceUntil) { toast.warning('Pick a date/time'); return; }
      const d = new Date(customSilenceUntil);
      if (Number.isNaN(d.getTime())) { toast.warning('Invalid date'); return; }
      until = d.toISOString();
    } else {
      until = new Date(Date.now() + preset.hours * 3600_000).toISOString();
    }
    try {
      await api.systemAlertRules.silence(silencingRule.id, until);
      toast.success(`Silenced until ${new Date(until).toLocaleString()}`);
      setSilencingRule(null);
      setCustomSilenceUntil('');
      await loadRules();
    } catch (err) {
      showError('Failed to silence rule', err, 'Could not silence rule');
    }
  };

  const clearSilence = async (r: AlertRule) => {
    try {
      await api.systemAlertRules.silence(r.id, null);
      toast.success('Silence cleared');
      await loadRules();
    } catch (err) {
      showError('Failed to clear silence', err, 'Could not clear silence');
    }
  };

  const runTest = async () => {
    if (!testingRule) return;
    let payload: Record<string, unknown> = {};
    try { payload = JSON.parse(testPayload || '{}'); }
    catch { toast.warning('Payload must be valid JSON'); return; }
    setRunningTest(true);
    try {
      const res = await api.systemAlertRules.test(testingRule.id, payload);
      setTestResult({
        would_fire: res.would_fire,
        matched: res.matched,
        reason: res.reason,
        enabled: res.enabled,
        silenced: res.silenced,
      });
    } catch (err) {
      showError('Test failed', err, 'Could not run test');
    } finally {
      setRunningTest(false);
    }
  };

  // ── UI helpers ────────────────────────────────────────────────
  const severityColor = (s: string): 'danger' | 'warning' | 'info' | 'default' => {
    if (s === 'critical' || s === 'high') return 'danger';
    if (s === 'medium') return 'warning';
    if (s === 'info' || s === 'low') return 'info';
    return 'default';
  };
  const channelIcon = (ch: string) => {
    const found = CHANNELS.find(c => c.value === ch);
    if (!found) return <Bell size={12} />;
    const I = found.icon;
    return <I size={12} />;
  };

  const firingRules = useMemo(() => rules.filter(r => r.enabled && !r.silenced && r.last_triggered_at), [rules]);
  const silencedCount = rules.filter(r => r.silenced).length;
  const enabledCount = rules.filter(r => r.enabled).length;

  const tabs = [
    { id: 'rules', label: 'Alert Rules', icon: <Filter size={14} />, count: rules.length },
    { id: 'active', label: 'Recently Triggered', icon: <AlertTriangle size={14} />, count: firingRules.length },
  ];

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-accent/10 flex items-center justify-center">
            <Bell className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-lg font-semibold t-primary">System Alerts</h1>
            <p className="text-xs t-muted">Alert rules, channels, silence, and synthetic tests</p>
          </div>
        </div>
        <Button size="sm" onClick={openCreateModal}>
          <Plus size={14} className="mr-1" /> New Rule
        </Button>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Card className="p-3">
          <p className="text-label">Total Rules</p>
          <p className="text-xl font-bold t-primary">{rules.length}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Enabled</p>
          <p className="text-xl font-bold text-emerald-400">{enabledCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Silenced</p>
          <p className="text-xl font-bold text-amber-400">{silencedCount}</p>
        </Card>
        <Card className="p-3">
          <p className="text-label">Triggered</p>
          <p className="text-xl font-bold text-red-400">{firingRules.length}</p>
        </Card>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />

      <TabPanel id="rules" activeTab={activeTab}>
        {loading ? (
          <LoadingState variant="list" count={3} />
        ) : rules.length === 0 ? (
          <EmptyState
            icon={Bell}
            title="No alert rules yet"
            description="Get notified when KPIs slip below threshold."
            action={{ label: 'Create your first rule', onClick: openCreateModal }}
          />
        ) : (
          <div className="space-y-2">
            {rules.map(r => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <button onClick={() => toggleRuleEnabled(r)} className="mt-0.5" disabled={savingId === r.id} title={r.enabled ? 'Disable rule' : 'Enable rule'}>
                      {savingId === r.id ? <Loader2 size={20} className="animate-spin t-muted" /> :
                        r.enabled ? <ToggleRight size={20} className="text-emerald-400" /> : <ToggleLeft size={20} className="t-muted" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium t-primary">{r.name}</p>
                        <Badge variant={severityColor(r.severity)} className="text-caption">{r.severity}</Badge>
                        {r.silenced && <Badge variant="warning" className="text-caption">silenced</Badge>}
                        {!r.enabled && <Badge variant="default" className="text-caption">disabled</Badge>}
                      </div>
                      {r.description && <p className="text-xs t-muted mt-0.5">{r.description}</p>}
                      <p className="text-caption font-mono t-muted mt-1 p-1 rounded bg-[var(--bg-secondary)] inline-block">
                        on <span className="text-accent">{r.event_type}</span> when {r.condition?.field} {r.condition?.op || r.condition?.operator} {JSON.stringify(r.condition?.value)}
                      </p>
                      <div className="flex items-center gap-3 mt-2 flex-wrap">
                        <span className="text-caption t-muted flex items-center gap-1">Channels:</span>
                        {r.channels.length === 0 ? (
                          <span className="text-caption t-muted">none</span>
                        ) : r.channels.map(ch => (
                          <span key={ch} className="text-caption t-muted flex items-center gap-0.5">{channelIcon(ch)} {ch}</span>
                        ))}
                        <span className="text-caption t-muted">· Triggered {r.triggered_count}x</span>
                        {r.silenced && r.silenced_until && (
                          <span className="text-caption t-amber-400">· Silenced until {new Date(r.silenced_until).toLocaleString()}</span>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { setTestingRule(r); setTestResult(null); setTestPayload(JSON.stringify({ [r.condition?.field || 'severity']: r.condition?.value ?? 'high' }, null, 2)); }}
                      className="p-1.5 rounded-md hover:bg-accent/10 t-muted hover:text-accent transition-colors"
                      title="Test rule"
                    >
                      <Play size={14} />
                    </button>
                    {r.silenced ? (
                      <button onClick={() => clearSilence(r)} className="p-1.5 rounded-md hover:bg-emerald-500/10 t-muted hover:text-emerald-400 transition-colors" title="Clear silence">
                        <VolumeX size={14} />
                      </button>
                    ) : (
                      <button onClick={() => setSilencingRule(r)} className="p-1.5 rounded-md hover:bg-amber-500/10 t-muted hover:text-amber-400 transition-colors" title="Silence">
                        <VolumeX size={14} />
                      </button>
                    )}
                    <button onClick={() => openEditModal(r)} className="p-1.5 rounded-md hover:bg-accent/10 t-muted hover:text-accent transition-colors" title="Edit">
                      <Pencil size={14} />
                    </button>
                    <button onClick={() => deleteRule(r)} className="p-1.5 rounded-md hover:bg-red-500/10 t-muted hover:text-red-400 transition-colors" title="Delete">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>

      <TabPanel id="active" activeTab={activeTab}>
        {firingRules.length === 0 ? (
          <Card className="p-8 text-center">
            <CheckCircle size={24} className="mx-auto text-emerald-400 mb-2" />
            <p className="text-sm t-muted">No recently triggered rules</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {firingRules.map(r => (
              <Card key={r.id} className="p-4">
                <div className="flex items-start gap-3">
                  <XCircle size={14} className="text-red-400 mt-1" />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium t-primary">{r.name}</p>
                      <Badge variant={severityColor(r.severity)} className="text-caption">{r.severity}</Badge>
                    </div>
                    <p className="text-xs t-muted mt-0.5">
                      {r.description || `Triggered on ${r.event_type}`}
                    </p>
                    <p className="text-caption t-muted mt-1">
                      Last triggered: {r.last_triggered_at ? new Date(r.last_triggered_at).toLocaleString() : '—'} · {r.triggered_count} total fires
                    </p>
                  </div>
                </div>
              </Card>
            ))}
          </div>
        )}
      </TabPanel>

      {/* CREATE/EDIT RULE MODAL */}
      {showRuleModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto" onClick={() => !savingRule && setShowRuleModal(false)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-lg w-full my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold t-primary">{form.id ? 'Edit Rule' : 'Create Alert Rule'}</h3>
              <button onClick={() => !savingRule && setShowRuleModal(false)} className="p-1 rounded hover:bg-[var(--bg-secondary)]">
                <XIcon size={16} className="t-muted" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Rule Name</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  placeholder="e.g., ERP Sync Failure"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Description</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  placeholder="Optional description"
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-xs font-medium t-primary mb-1">Event Type</label>
                <select
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  value={form.event_type}
                  onChange={(e) => setForm({ ...form, event_type: e.target.value })}
                >
                  {EVENT_TYPES.map(e => <option key={e} value={e}>{e}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium t-primary mb-1">Condition</label>
                <div className="grid grid-cols-3 gap-2">
                  <input
                    className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary font-mono"
                    placeholder="field"
                    value={form.field}
                    onChange={(e) => setForm({ ...form, field: e.target.value })}
                  />
                  <select
                    className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary font-mono"
                    value={form.op}
                    onChange={(e) => setForm({ ...form, op: e.target.value })}
                  >
                    {OPERATORS.map(o => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <input
                    className="px-2 py-1 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary font-mono"
                    placeholder="value"
                    value={form.value}
                    onChange={(e) => setForm({ ...form, value: e.target.value })}
                  />
                </div>
                <p className="text-caption t-muted mt-1">Numbers/bools/arrays auto-parsed; strings used as-is.</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Severity</label>
                  <select
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value })}
                  >
                    {SEVERITIES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium t-primary mb-1">Enabled</label>
                  <button
                    type="button"
                    onClick={() => setForm({ ...form, enabled: !form.enabled })}
                    className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary flex items-center justify-center gap-2"
                  >
                    {form.enabled ? <ToggleRight size={16} className="text-emerald-400" /> : <ToggleLeft size={16} className="t-muted" />}
                    {form.enabled ? 'Yes' : 'No'}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium t-primary mb-1">Channels</label>
                <div className="flex flex-wrap gap-2">
                  {CHANNELS.map(ch => {
                    const active = form.channels.includes(ch.value);
                    const I = ch.icon;
                    return (
                      <button
                        key={ch.value}
                        type="button"
                        onClick={() => {
                          setForm(prev => ({
                            ...prev,
                            channels: active ? prev.channels.filter(c => c !== ch.value) : [...prev.channels, ch.value],
                          }));
                        }}
                        className={`px-3 py-1.5 rounded-lg border text-xs flex items-center gap-1 ${active ? 'border-accent bg-accent/10 text-accent' : 'border-[var(--border-card)] t-muted hover:t-primary'}`}
                      >
                        <I size={12} /> {ch.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium t-primary mb-1">Recipients (comma-separated)</label>
                <input
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  placeholder="admin@company.com, ops@company.com"
                  value={form.recipients}
                  onChange={(e) => setForm({ ...form, recipients: e.target.value })}
                />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <Button variant="outline" onClick={() => setShowRuleModal(false)} className="flex-1" disabled={savingRule}>Cancel</Button>
              <Button onClick={submitRule} className="flex-1" disabled={savingRule}>
                {savingRule ? <Loader2 size={14} className="animate-spin mr-1" /> : (form.id ? <Pencil size={14} className="mr-1" /> : <Plus size={14} className="mr-1" />)}
                {form.id ? 'Save' : 'Create'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* SILENCE DIALOG */}
      {silencingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setSilencingRule(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-sm w-full" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-base font-semibold t-primary mb-1">Silence Rule</h3>
            <p className="text-xs t-muted mb-4">{silencingRule.name}</p>
            <div className="space-y-2">
              {SILENCE_PRESETS.slice(0, 4).map(p => (
                <Button key={p.label} variant="outline" size="sm" className="w-full justify-start" onClick={() => applySilence(p)}>
                  <Clock size={12} className="mr-2" /> {p.label}
                </Button>
              ))}
              <div className="pt-2 border-t border-[var(--border-card)]">
                <label className="block text-xs font-medium t-primary mb-1">Custom until</label>
                <input
                  type="datetime-local"
                  className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-sm bg-[var(--bg-secondary)] t-primary"
                  value={customSilenceUntil}
                  onChange={(e) => setCustomSilenceUntil(e.target.value)}
                />
                <Button size="sm" className="w-full mt-2" onClick={() => applySilence({ label: 'Custom', hours: null })}>Silence until custom</Button>
              </div>
            </div>
            <Button variant="outline" size="sm" className="w-full mt-3" onClick={() => setSilencingRule(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {/* TEST DIALOG */}
      {testingRule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setTestingRule(null)}>
          <div className="bg-[var(--bg-modal)] rounded-xl border border-[var(--border-card)] p-6 max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-base font-semibold t-primary">Test Rule</h3>
              <button onClick={() => setTestingRule(null)} className="p-1 rounded hover:bg-[var(--bg-secondary)]"><XIcon size={16} className="t-muted" /></button>
            </div>
            <p className="text-xs t-muted mb-3">{testingRule.name}</p>

            <label className="block text-xs font-medium t-primary mb-1">Test payload (JSON)</label>
            <textarea
              className="w-full px-3 py-2 rounded-lg border border-[var(--border-card)] text-xs bg-[var(--bg-secondary)] t-primary font-mono h-32"
              value={testPayload}
              onChange={(e) => setTestPayload(e.target.value)}
            />
            <Button size="sm" className="w-full mt-2" onClick={runTest} disabled={runningTest}>
              {runningTest ? <Loader2 size={12} className="animate-spin mr-1" /> : <Play size={12} className="mr-1" />}
              Run synthetic trigger
            </Button>

            {testResult && (
              <Card className="p-3 mt-3">
                <div className="flex items-center gap-2 mb-2">
                  {testResult.would_fire ? (
                    <><XCircle size={16} className="text-red-400" /><span className="text-sm font-medium t-primary">Would fire</span></>
                  ) : (
                    <><CheckCircle size={16} className="text-emerald-400" /><span className="text-sm font-medium t-primary">Would not fire</span></>
                  )}
                </div>
                <p className="text-xs t-muted">{testResult.reason}</p>
                <div className="flex gap-2 mt-2">
                  <Badge variant={testResult.matched ? 'success' : 'default'} className="text-caption">matched: {String(testResult.matched)}</Badge>
                  <Badge variant={testResult.enabled ? 'success' : 'default'} className="text-caption">enabled: {String(testResult.enabled)}</Badge>
                  <Badge variant={testResult.silenced ? 'warning' : 'default'} className="text-caption">silenced: {String(testResult.silenced)}</Badge>
                </div>
              </Card>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
