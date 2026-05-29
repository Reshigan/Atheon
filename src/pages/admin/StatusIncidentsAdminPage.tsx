/**
 * /admin/incidents — admin UI for the public /status page (Phase BC).
 *
 * Closes the Phase AZ gap: the backend ships incident CRUD endpoints
 * but no UI used them, so ops would have had to curl-POST every
 * incident. This panel lets superadmin / support_admin:
 *   - Declare a new incident (with an initial public message)
 *   - Append updates as the situation evolves (status + message)
 *   - Mark resolved (one-click; resolved_at stamps once)
 *   - See the audit-history-friendly incident timeline
 *
 * Public surface is /status; this is the operator side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { LoadingState, ErrorState } from '@/components/ui/state';
import { PageHeader } from '@/components/ui/page-header';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import {
  Plus, CheckCircle2, Clock, MessageSquare, ExternalLink, Loader2,
} from 'lucide-react';

type AdminIncident = Awaited<ReturnType<typeof api.iam.statusIncidents>>['incidents'][number];

interface ParsedUpdate { at: string; status: string; message: string }
function parseUpdates(s: string): ParsedUpdate[] {
  if (!s) return [];
  try { const v = JSON.parse(s); return Array.isArray(v) ? (v as ParsedUpdate[]) : []; } catch { return []; }
}

const SEVERITY_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'degraded', label: 'Degraded performance' },
  { value: 'partial_outage', label: 'Partial outage' },
  { value: 'major_outage', label: 'Major outage' },
  { value: 'operational', label: 'Informational / resolved' },
];
const STATUS_OPTIONS = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
];

export default function StatusIncidentsAdminPage(): JSX.Element {
  const toast = useToast();
  const [incidents, setIncidents] = useState<AdminIncident[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [showCreate, setShowCreate] = useState(false);
  const [title, setTitle] = useState('');
  const [severity, setSeverity] = useState('degraded');
  const [status, setStatus] = useState('investigating');
  const [impact, setImpact] = useState('');
  const [message, setMessage] = useState('');
  const [components, setComponents] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Per-incident update form state
  const [updateDraft, setUpdateDraft] = useState<Record<string, { status: string; message: string; busy: boolean }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.iam.statusIncidents();
      setIncidents(res.incidents);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load incidents');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    try {
      await api.iam.createStatusIncident({
        title: title.trim(),
        severity,
        status,
        impact: impact.trim() || undefined,
        message: message.trim() || undefined,
        components: components.split(',').map((s) => s.trim()).filter(Boolean),
      });
      toast.success(`Incident "${title.trim()}" declared`);
      setTitle(''); setImpact(''); setMessage(''); setComponents('');
      setSeverity('degraded'); setStatus('investigating');
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error('Create failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
    } finally {
      setSubmitting(false);
    }
  };

  const appendUpdate = async (incidentId: string) => {
    const draft = updateDraft[incidentId];
    if (!draft || !draft.message.trim()) return;
    setUpdateDraft((d) => ({ ...d, [incidentId]: { ...draft, busy: true } }));
    try {
      await api.iam.updateStatusIncident(incidentId, {
        status: draft.status,
        message: draft.message.trim(),
      });
      toast.success('Update posted');
      setUpdateDraft((d) => ({ ...d, [incidentId]: { status: 'investigating', message: '', busy: false } }));
      await load();
    } catch (err) {
      toast.error('Update failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
      setUpdateDraft((d) => ({ ...d, [incidentId]: { ...draft, busy: false } }));
    }
  };

  const resolve = async (incident: AdminIncident) => {
    if (!window.confirm(`Mark "${incident.title}" as resolved? This stamps resolved_at and surfaces a "Resolved" badge on the public status page.`)) return;
    try {
      await api.iam.updateStatusIncident(incident.id, {
        status: 'resolved',
        message: 'Incident resolved. Service has returned to normal operation.',
      });
      toast.success(`Resolved ${incident.title}`);
      await load();
    } catch (err) {
      toast.error('Resolve failed', { message: err instanceof ApiError ? err.message : undefined, requestId: err instanceof ApiError ? err.requestId : null });
    }
  };

  if (loading) return <div className="p-6"><LoadingState variant="cards" count={3} /></div>;
  if (error) return <div className="p-6"><ErrorState title="Couldn't load incidents" error={error} onRetry={() => void load()} /></div>;

  const open = incidents.filter((i) => !i.resolved_at);
  const closed = incidents.filter((i) => i.resolved_at);

  return (
    <div className="space-y-6 animate-fadeIn">
      <PageHeader
        eyebrow="Platform · Status & Incidents"
        title="Incident Manager"
        dek="Declare and resolve incidents shown on the public /status page"
        live
        actions={
          <>
            <Link to="/status" target="_blank" rel="noopener noreferrer" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
              Public status page <ExternalLink size={11} />
            </Link>
            {!showCreate && (
              <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
                <Plus size={12} /> Declare incident
              </Button>
            )}
          </>
        }
      />

      {/* Create form */}
      {showCreate && (
        <Card className="p-5">
          <h3 className="text-body font-semibold t-primary mb-3">Declare a new incident</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Title</span>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Elevated D1 query latency in af-south-1"
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={200}
                autoFocus
              />
            </label>
            <label className="block">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Severity</span>
              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              >
                {SEVERITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Investigation status</span>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              >
                {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Customer impact (optional)</span>
              <input
                type="text"
                value={impact}
                onChange={(e) => setImpact(e.target.value)}
                placeholder="e.g. Read requests may take 2-5s longer. No data at risk."
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={1000}
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Affected components (comma-separated)</span>
              <input
                type="text"
                value={components}
                onChange={(e) => setComponents(e.target.value)}
                placeholder="database, api"
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
              />
            </label>
            <label className="block md:col-span-2">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Initial public message</span>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What customers will see on /status as the first update."
                rows={3}
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={4000}
              />
            </label>
          </div>
          <div className="flex items-center justify-end gap-2 mt-4">
            <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); }} disabled={submitting}>Cancel</Button>
            <Button variant="primary" size="sm" onClick={() => void create()} disabled={submitting || !title.trim()}>
              {submitting ? <><Loader2 size={12} className="animate-spin" /> Declaring…</> : <><Plus size={12} /> Declare incident</>}
            </Button>
          </div>
        </Card>
      )}

      {/* Open incidents */}
      <section>
        <h3 className="text-body font-semibold t-primary mb-2">Open ({open.length})</h3>
        {open.length === 0 ? (
          <Card className="p-8 text-center">
            <CheckCircle2 size={28} className="text-accent mx-auto mb-2" style={{ opacity: 0.5 }} />
            <p className="text-body-sm font-medium t-primary">No open incidents</p>
            <p className="text-caption t-muted mt-1">Public status page shows all systems operational.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {open.map((i) => {
              const updates = parseUpdates(i.updates);
              const draft = updateDraft[i.id] ?? { status: 'investigating', message: '', busy: false };
              return (
                <Card key={i.id} className="p-5">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="text-body font-semibold t-primary">{i.title}</h4>
                        <Badge variant="warning" size="sm">{i.severity}</Badge>
                        <Badge variant="info" size="sm">{i.status}</Badge>
                      </div>
                      {i.impact && <p className="text-body-sm t-secondary mt-1">{i.impact}</p>}
                      <p className="text-caption t-muted mt-1 inline-flex items-center gap-1"><Clock size={11} /> Started <span className="font-mono tnum">{new Date(i.started_at).toLocaleString()}</span></p>
                    </div>
                    <Button variant="primary" size="sm" onClick={() => void resolve(i)}><CheckCircle2 size={12} /> Resolve</Button>
                  </div>

                  {/* Updates timeline */}
                  {updates.length > 0 && (
                    <div className="border-t pt-3 space-y-2" style={{ borderColor: 'var(--border-card)' }}>
                      <div className="text-caption uppercase tracking-wider t-muted font-medium">Public timeline</div>
                      {updates.slice().reverse().map((u, idx) => (
                        <div key={idx} className="text-caption">
                          <span className="t-muted font-mono tnum">{new Date(u.at).toLocaleString()}</span>
                          <span className="t-muted"> · </span>
                          <span className="font-medium t-primary uppercase tracking-wider">{u.status}</span>
                          <p className="t-secondary mt-0.5">{u.message}</p>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Append update form */}
                  <div className="border-t mt-3 pt-3" style={{ borderColor: 'var(--border-card)' }}>
                    <div className="flex items-end gap-2">
                      <label className="block flex-shrink-0">
                        <span className="text-caption uppercase tracking-wider t-muted block mb-1">Status</span>
                        <select
                          value={draft.status}
                          onChange={(e) => setUpdateDraft((d) => ({ ...d, [i.id]: { ...draft, status: e.target.value } }))}
                          className="px-2 py-1.5 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary"
                        >
                          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </label>
                      <label className="block flex-1">
                        <span className="text-caption uppercase tracking-wider t-muted block mb-1">Public update message</span>
                        <input
                          type="text"
                          value={draft.message}
                          onChange={(e) => setUpdateDraft((d) => ({ ...d, [i.id]: { ...draft, message: e.target.value } }))}
                          placeholder="e.g. Root cause identified — applying fix"
                          className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                          maxLength={4000}
                        />
                      </label>
                      <Button variant="primary" size="sm" onClick={() => void appendUpdate(i.id)} disabled={draft.busy || !draft.message.trim()}>
                        {draft.busy ? <><Loader2 size={12} className="animate-spin" /></> : <><MessageSquare size={12} /></>} Post
                      </Button>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      {/* Resolved history */}
      <section>
        <h3 className="text-body font-semibold t-primary mb-2">Resolved ({closed.length})</h3>
        {closed.length === 0 ? (
          <Card className="p-6 text-center">
            <p className="text-caption t-muted">No resolved incidents yet.</p>
          </Card>
        ) : (
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-body-sm">
              <thead className="text-caption uppercase tracking-wider t-muted">
                <tr className="border-b border-[var(--border-card)]">
                  <th className="text-left px-4 py-3 font-medium">Title</th>
                  <th className="text-left px-4 py-3 font-medium">Severity</th>
                  <th className="text-left px-4 py-3 font-medium">Started</th>
                  <th className="text-left px-4 py-3 font-medium">Resolved</th>
                  <th className="text-left px-4 py-3 font-medium">Duration</th>
                </tr>
              </thead>
              <tbody>
                {closed.map((i) => {
                  const startedMs = new Date(i.started_at).getTime();
                  const resolvedMs = i.resolved_at ? new Date(i.resolved_at).getTime() : Date.now();
                  const durMin = Math.max(0, Math.round((resolvedMs - startedMs) / 60000));
                  const durStr = durMin >= 60 ? `${Math.floor(durMin / 60)}h ${durMin % 60}m` : `${durMin}m`;
                  return (
                    <tr key={i.id} className="border-b border-[var(--border-card)] last:border-0">
                      <td className="px-4 py-3 t-primary">{i.title}</td>
                      <td className="px-4 py-3"><Badge variant="default" size="sm">{i.severity}</Badge></td>
                      <td className="px-4 py-3 t-muted font-mono tnum">{new Date(i.started_at).toLocaleString()}</td>
                      <td className="px-4 py-3 t-muted font-mono tnum">{i.resolved_at ? new Date(i.resolved_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3 t-secondary tabular-nums font-mono">{durStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
