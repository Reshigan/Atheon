import { useState, useEffect, useCallback } from 'react';
import { api } from '@/lib/api';
import type {
  ManagedDeployment, CreateDeploymentRequest, CreateDeploymentResponse, AgentErrorLog
} from '@/lib/api';

type View = 'overview' | 'provision' | 'detail' | 'logs';

export function DeploymentsPage() {
  const [view, setView] = useState<View>('overview');
  const [deployments, setDeployments] = useState<ManagedDeployment[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedDeployment, setSelectedDeployment] = useState<ManagedDeployment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [installModal, setInstallModal] = useState<CreateDeploymentResponse | null>(null);

  const loadDeployments = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.deployments.list();
      setDeployments(data.deployments);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadDeployments(); }, [loadDeployments]);

  const loadDetail = useCallback(async (id: string) => {
    try {
      const data = await api.deployments.get(id);
      setSelectedDeployment(data);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  const openDetail = (id: string) => {
    setSelectedId(id);
    setView('detail');
    loadDetail(id);
  };

  const openLogs = (id: string) => {
    setSelectedId(id);
    setView('logs');
  };

  // ── Status badge ────────────────────────────────────────────────
  const statusColor = (s: string) => {
    switch (s) {
      case 'active': return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400';
      case 'degraded': return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400';
      case 'offline': case 'suspended': return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
      case 'pending': case 'provisioning': return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400';
      default: return 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400';
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>Deployments</h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>Hybrid & On-Premise deployment management</p>
        </div>
        <div className="flex gap-2">
          {view !== 'overview' && (
            <button
              onClick={() => { setView('overview'); setSelectedId(null); setSelectedDeployment(null); }}
              className="px-3 py-1.5 text-sm rounded-lg transition-colors"
              style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)', border: '1px solid var(--border-card)' }}
            >
              &larr; Back
            </button>
          )}
          <button
            onClick={() => setView('provision')}
            className="px-4 py-1.5 text-sm font-medium rounded-lg text-white transition-colors"
            style={{ background: 'var(--accent)' }}
          >
            + Provision New
          </button>
        </div>
      </div>

      {error && (
        <div className="p-3 rounded-lg text-sm bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">Dismiss</button>
        </div>
      )}

      {/* Install Config Modal */}
      {installModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="rounded-xl p-6 max-w-xl w-full mx-4 space-y-4" style={{ background: 'var(--bg-modal)', border: '1px solid var(--border-card)' }}>
            <h3 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Deployment Provisioned</h3>
            <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>Share the following with the customer&apos;s IT team:</p>
            <div className="space-y-2">
              <div className="p-3 rounded-lg text-xs font-mono" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                <p><strong>Licence Key:</strong> {installModal.licenceKey}</p>
                <p><strong>Deployment ID:</strong> {installModal.id}</p>
              </div>
              <div className="p-3 rounded-lg text-xs font-mono overflow-auto max-h-40" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                <p className="mb-1 font-semibold">Install Command:</p>
                <code>{installModal.installConfig?.installCommand || 'N/A'}</code>
              </div>
              <div className="p-3 rounded-lg text-xs font-mono overflow-auto max-h-40" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
                <p className="mb-1 font-semibold">.env file:</p>
                <pre>{installModal.installConfig?.envFile || 'N/A'}</pre>
              </div>
            </div>
            <button
              onClick={() => { setInstallModal(null); loadDeployments(); setView('overview'); }}
              className="w-full py-2 text-sm font-medium rounded-lg text-white" style={{ background: 'var(--accent)' }}
            >
              Done
            </button>
          </div>
        </div>
      )}

      {/* Views */}
      {view === 'overview' && <OverviewView deployments={deployments} loading={loading} statusColor={statusColor} openDetail={openDetail} openLogs={openLogs} />}
      {view === 'provision' && <ProvisionView onCreated={(resp) => setInstallModal(resp)} onError={setError} />}
      {view === 'detail' && selectedId && <DetailView deployment={selectedDeployment} id={selectedId} onRefresh={() => loadDetail(selectedId)} onError={setError} />}
      {view === 'logs' && selectedId && <LogsView id={selectedId} />}
    </div>
  );
}

// ── Overview View ─────────────────────────────────────────────────────────
function OverviewView({ deployments, loading, statusColor, openDetail, openLogs }: {
  deployments: ManagedDeployment[];
  loading: boolean;
  statusColor: (s: string) => string;
  openDetail: (id: string) => void;
  openLogs: (id: string) => void;
}) {
  if (loading) {
    return <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {[1,2,3].map(i => (
        <div key={i} className="h-48 rounded-xl animate-pulse" style={{ background: 'var(--bg-secondary)' }} />
      ))}
    </div>;
  }

  if (deployments.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-20 text-center">
        <div className="w-14 h-14 rounded-xl bg-[var(--bg-secondary)] flex items-center justify-center mb-4">
          <svg className="w-7 h-7 t-muted" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 12h14M5 12a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v4a2 2 0 01-2 2M5 12a2 2 0 00-2 2v4a2 2 0 002 2h14a2 2 0 002-2v-4a2 2 0 00-2-2m-2-4h.01M17 16h.01" /></svg>
        </div>
        <h3 className="text-base font-semibold t-primary mb-1">No On-Premise Deployments</h3>
        <p className="text-sm t-muted max-w-sm">Your organisation uses Atheon as a fully managed SaaS service. On-premise and hybrid deployments are available for enterprise customers with specific data residency or compliance requirements.</p>
        <p className="text-xs t-muted mt-3">Contact your account manager to discuss hybrid deployment options.</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {deployments.map((d) => {
        const ru = d.resourceUsage || {};
        const timeSince = d.lastHeartbeat ? getTimeSince(d.lastHeartbeat) : 'Never';

        return (
          <div
            key={d.id}
            className="rounded-xl p-4 cursor-pointer hover:shadow-lg transition-shadow"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}
            onClick={() => openDetail(d.id)}
          >
            <div className="flex items-start justify-between mb-3">
              <div>
                <h3 className="font-medium text-sm" style={{ color: 'var(--text-primary)' }}>{d.name}</h3>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>{d.tenantName}</p>
              </div>
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusColor(d.status)}`}>
                {d.status}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs">
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Health</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.healthScore}%</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Last Heartbeat</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{timeSince}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>CPU</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{(ru as Record<string, number>).cpuPct ?? '—'}%</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>RAM</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{(ru as Record<string, number>).memMb ?? '—'} MB</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Agent</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.agentVersion || '—'}</p>
              </div>
              <div>
                <span style={{ color: 'var(--text-muted)' }}>Type</span>
                <p className="font-medium" style={{ color: 'var(--text-primary)' }}>{d.deploymentType}</p>
              </div>
            </div>

            <div className="flex gap-2 mt-3 pt-3" style={{ borderTop: '1px solid var(--border-card)' }}>
              <button
                onClick={(e) => { e.stopPropagation(); openDetail(d.id); }}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--accent-subtle)', color: 'var(--accent)' }}
              >
                Details
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); openLogs(d.id); }}
                className="text-xs px-2 py-1 rounded"
                style={{ background: 'var(--bg-secondary)', color: 'var(--text-secondary)' }}
              >
                Logs
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Provision View ────────────────────────────────────────────────────────
function ProvisionView({ onCreated, onError }: {
  onCreated: (resp: CreateDeploymentResponse) => void;
  onError: (err: string) => void;
}) {
  const [tenants, setTenants] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState<CreateDeploymentRequest>({
    tenant_id: '',
    name: '',
    deployment_type: 'hybrid',
    region: 'af-south-1',
    config: { maxUsers: 50 },
  });
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api.tenants.list().then(d => setTenants(d.tenants.map((t: { id: string; name: string }) => ({ id: t.id, name: t.name })))).catch(() => {});
  }, []);

  const submit = async () => {
    if (!form.tenant_id || !form.name) {
      onError('Tenant and name are required');
      return;
    }
    try {
      setSubmitting(true);
      const resp = await api.deployments.create(form);
      onCreated(resp);
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' };

  return (
    <div className="max-w-lg mx-auto rounded-xl p-6 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Provision New Deployment</h2>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Tenant</label>
        <select
          value={form.tenant_id}
          onChange={e => setForm({ ...form, tenant_id: e.target.value })}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        >
          <option value="">Select tenant...</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Deployment Name</label>
        <input
          type="text"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
          placeholder="e.g. Protea Manufacturing — JHB DC"
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Type</label>
          <select
            value={form.deployment_type}
            onChange={e => setForm({ ...form, deployment_type: e.target.value as 'hybrid' | 'on-premise' })}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="hybrid">Hybrid</option>
            <option value="on-premise">On-Premise</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Region</label>
          <select
            value={form.region}
            onChange={e => setForm({ ...form, region: e.target.value })}
            className="w-full rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          >
            <option value="af-south-1">Africa South (JHB)</option>
            <option value="eu-west-1">Europe West (London)</option>
            <option value="ap-southeast-1">Asia Pacific (Sydney)</option>
            <option value="us-east-1">US East (Virginia)</option>
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Licence Expiry</label>
        <input
          type="date"
          value={form.licence_expires_at || ''}
          onChange={e => setForm({ ...form, licence_expires_at: e.target.value })}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <div>
        <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-secondary)' }}>Max Users</label>
        <input
          type="number"
          value={(form.config as Record<string, number>)?.maxUsers || 50}
          onChange={e => setForm({ ...form, config: { ...form.config, maxUsers: parseInt(e.target.value) || 50 } })}
          className="w-full rounded-lg px-3 py-2 text-sm"
          style={inputStyle}
        />
      </div>

      <button
        onClick={submit}
        disabled={submitting}
        className="w-full py-2.5 text-sm font-medium rounded-lg text-white transition-colors disabled:opacity-50"
        style={{ background: 'var(--accent)' }}
      >
        {submitting ? 'Provisioning...' : 'Provision Deployment'}
      </button>
    </div>
  );
}

// ── Detail View ───────────────────────────────────────────────────────────
function DetailView({ deployment, id, onRefresh, onError }: {
  deployment: ManagedDeployment | null;
  id: string;
  onRefresh: () => void;
  onError: (err: string) => void;
}) {
  const [configText, setConfigText] = useState('');
  const [updateVersion, setUpdateVersion] = useState('');
  const [revokeConfirm, setRevokeConfirm] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (deployment?.config) {
      setConfigText(JSON.stringify(deployment.config, null, 2));
    }
  }, [deployment]);

  if (!deployment) {
    return <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full mx-auto" /></div>;
  }

  const pushConfig = async () => {
    try {
      setSaving(true);
      const parsed = JSON.parse(configText);
      await api.deployments.pushConfig(id, parsed);
      onRefresh();
    } catch (err) {
      onError((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const pushUpdate = async () => {
    if (!updateVersion) return;
    try {
      await api.deployments.pushUpdate(id, updateVersion);
      setUpdateVersion('');
      onRefresh();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const revoke = async () => {
    if (revokeConfirm !== deployment.name) {
      onError('Type the deployment name to confirm revocation');
      return;
    }
    try {
      await api.deployments.revoke(id);
      onRefresh();
    } catch (err) {
      onError((err as Error).message);
    }
  };

  const ru = deployment.resourceUsage || {};
  const inputStyle = { background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' };

  return (
    <div className="space-y-6">
      {/* Status Header */}
      <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>{deployment.name}</h2>
            <p className="text-sm mt-0.5" style={{ color: 'var(--text-muted)' }}>
              {deployment.tenantName} &middot; {deployment.deploymentType} &middot; {deployment.region}
            </p>
          </div>
          <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${deployment.status === 'active' ? 'bg-emerald-100 text-emerald-700' : deployment.status === 'degraded' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
            {deployment.status}
          </span>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-4">
          {[
            { label: 'Health Score', value: `${deployment.healthScore}%` },
            { label: 'Agent Version', value: deployment.agentVersion || '—' },
            { label: 'CPU', value: `${(ru as Record<string, number>).cpuPct ?? '—'}%` },
            { label: 'RAM', value: `${(ru as Record<string, number>).memMb ?? '—'} MB` },
            { label: 'Last Heartbeat', value: deployment.lastHeartbeat ? getTimeSince(deployment.lastHeartbeat) : 'Never' },
            { label: 'Licence Key', value: deployment.licenceKey },
            { label: 'Licence Expires', value: deployment.licenceExpiresAt || 'Never' },
            { label: 'Created', value: new Date(deployment.createdAt).toLocaleDateString() },
          ].map((item) => (
            <div key={item.label}>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{item.label}</span>
              <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>{item.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Config Editor */}
      <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Configuration</h3>
        <textarea
          value={configText}
          onChange={e => setConfigText(e.target.value)}
          rows={10}
          className="w-full rounded-lg px-3 py-2 text-xs font-mono"
          style={inputStyle}
        />
        <button
          onClick={pushConfig}
          disabled={saving}
          className="mt-2 px-4 py-1.5 text-sm font-medium rounded-lg text-white disabled:opacity-50"
          style={{ background: 'var(--accent)' }}
        >
          {saving ? 'Pushing...' : 'Push Config'}
        </button>
      </div>

      {/* Push Update */}
      <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
        <h3 className="font-medium mb-3" style={{ color: 'var(--text-primary)' }}>Push Docker Update</h3>
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="e.g. gonxt/atheon-api:v2.1.0"
            value={updateVersion}
            onChange={e => setUpdateVersion(e.target.value)}
            className="flex-1 rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={pushUpdate}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white"
            style={{ background: 'var(--accent)' }}
          >
            Push Update
          </button>
        </div>
      </div>

      {/* Revoke Licence */}
      <div className="rounded-xl p-5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-danger, #dc2626)' }}>
        <h3 className="font-medium mb-3 text-red-600">Revoke Licence</h3>
        <p className="text-xs mb-3" style={{ color: 'var(--text-muted)' }}>
          This will suspend the deployment. The agent will be refused on next heartbeat.
          Type &quot;<strong>{deployment.name}</strong>&quot; to confirm.
        </p>
        <div className="flex gap-2">
          <input
            type="text"
            value={revokeConfirm}
            onChange={e => setRevokeConfirm(e.target.value)}
            placeholder="Type deployment name to confirm"
            className="flex-1 rounded-lg px-3 py-2 text-sm"
            style={inputStyle}
          />
          <button
            onClick={revoke}
            disabled={revokeConfirm !== deployment.name}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white bg-red-600 disabled:opacity-30"
          >
            Revoke
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Logs View ─────────────────────────────────────────────────────────────
function LogsView({ id }: { id: string }) {
  const [logs, setLogs] = useState<AgentErrorLog[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.deployments.getLogs(id)
      .then(d => setLogs(d.logs))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const severityColor = (sev: string) => {
    switch (sev) {
      case 'critical': return 'text-red-600 bg-red-50 dark:bg-red-900/20';
      case 'error': return 'text-orange-600 bg-orange-50 dark:bg-orange-900/20';
      case 'warning': return 'text-amber-600 bg-amber-50 dark:bg-amber-900/20';
      default: return 'text-blue-600 bg-blue-50 dark:bg-blue-900/20';
    }
  };

  if (loading) return <div className="text-center py-10"><div className="animate-spin w-8 h-8 border-2 border-current border-t-transparent rounded-full mx-auto" /></div>;

  if (logs.length === 0) {
    return (
      <div className="text-center py-20">
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>No error logs recorded.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: 'var(--bg-card)', border: '1px solid var(--border-card)' }}>
      <div className="max-h-[600px] overflow-y-auto divide-y" style={{ borderColor: 'var(--border-card)' }}>
        {logs.map((log, i) => (
          <div key={i} className="px-4 py-3 flex items-start gap-3">
            <span className={`text-[10px] font-medium uppercase px-1.5 py-0.5 rounded ${severityColor(log.severity)}`}>
              {log.severity}
            </span>
            <div className="flex-1 min-w-0">
              <p className="text-sm" style={{ color: 'var(--text-primary)' }}>{log.message}</p>
              {log.code && <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>Code: {log.code}</p>}
            </div>
            <span className="text-xs whitespace-nowrap" style={{ color: 'var(--text-muted)' }}>
              {new Date(log.ts).toLocaleString()}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Utility ───────────────────────────────────────────────────────────────
function getTimeSince(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}
