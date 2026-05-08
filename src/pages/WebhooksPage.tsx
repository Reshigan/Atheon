/**
 * WebhooksPage — tenant-scoped webhook management.
 *
 * Routes:
 *   /webhooks              list + create wizard (modal)
 *   /webhooks/:webhookId   list with the detail drawer pre-opened for :webhookId
 *
 * Backend endpoints (PR #225):
 *   GET    /api/v1/webhooks
 *   POST   /api/v1/webhooks                    (only response containing the raw secret)
 *   GET    /api/v1/webhooks/:id
 *   DELETE /api/v1/webhooks/:id
 *   POST   /api/v1/webhooks/:id/test
 *   GET    /api/v1/webhooks/:id/deliveries
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Webhook as WebhookIcon, Plus, Trash2, Send, Loader2, X, ChevronDown, ChevronUp,
  CheckCircle, Clock, AlertTriangle, ShieldCheck, Code, Copy, CheckCircle2, Pencil,
} from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { useToast } from "@/components/ui/toast";
import { api } from "@/lib/api";
import type { Webhook } from "@/lib/api";
import { WebhookCreateWizard } from "@/components/WebhookCreateWizard";
import { WebhookDeliveriesTable } from "@/components/WebhookDeliveriesTable";

/** Map a webhook's recent health to a status tone for the list badge. */
function healthBadge(w: Webhook): { variant: 'success' | 'warning' | 'danger' | 'info'; label: string; icon: typeof CheckCircle } {
  if (w.disabled) return { variant: 'danger', label: 'Disabled', icon: AlertTriangle };
  if (w.last_delivery_status === 'dead_letter' || w.last_delivery_status === 'failed') {
    return { variant: 'danger', label: 'Failing', icon: AlertTriangle };
  }
  if (w.last_delivery_status === 'pending') {
    return { variant: 'warning', label: 'Pending', icon: Clock };
  }
  if (w.last_delivery_status === 'delivered') {
    const rate = w.success_rate ?? 1;
    if (rate >= 0.9) return { variant: 'success', label: 'Healthy', icon: CheckCircle };
    if (rate >= 0.5) return { variant: 'warning', label: 'Degraded', icon: AlertTriangle };
    return { variant: 'danger', label: 'Unhealthy', icon: AlertTriangle };
  }
  return { variant: 'info', label: 'No deliveries', icon: Clock };
}

export function WebhooksPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const { webhookId: routeWebhookId } = useParams<{ webhookId?: string }>();
  const [webhooks, setWebhooks] = useState<Webhook[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(routeWebhookId || null);

  const load = useCallback(async () => {
    try {
      const res = await api.webhooks.list();
      setWebhooks(res.webhooks || []);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load webhooks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Keep URL and drawer state in sync when the user deep-links to /webhooks/:id.
  useEffect(() => {
    if (routeWebhookId && routeWebhookId !== detailId) setDetailId(routeWebhookId);
  }, [routeWebhookId, detailId]);

  const openDetail = (id: string) => {
    setDetailId(id);
    navigate(`/webhooks/${id}`);
  };

  const closeDetail = () => {
    setDetailId(null);
    navigate('/webhooks');
  };

  const handleCreated = async (_newId: string) => {
    // newId is currently unused — the user may deep-link via the list after dismiss.
    void _newId;
    setShowCreate(false);
    await load();
    toast.success('Webhook created', 'The signing secret is only shown once — make sure you saved it.');
  };

  const handleRevoke = async (id: string) => {
    if (!window.confirm('Revoke this webhook? Deliveries will stop immediately and this cannot be undone.')) return;
    try {
      await api.webhooks.delete(id);
      toast.success('Webhook revoked');
      if (detailId === id) closeDetail();
      await load();
    } catch (err) {
      toast.error('Failed to revoke webhook', err instanceof Error ? err.message : undefined);
    }
  };

  const activeWebhook = useMemo(
    () => (detailId ? webhooks.find((w) => w.id === detailId) || null : null),
    [detailId, webhooks]
  );

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--accent-subtle)' }}
          >
            <WebhookIcon className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h1 className="text-2xl font-bold t-primary">Webhooks</h1>
            <p className="text-sm t-muted">
              Subscribe external systems to Atheon events with HMAC-signed delivery.
            </p>
          </div>
        </div>
        <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
          <Plus size={14} /> New webhook
        </Button>
      </div>

      {error && (
        <Card variant="outline" className="border-red-500/30">
          <p className="text-sm text-red-400">{error}</p>
        </Card>
      )}

      {loading ? (
        <Card>
          <div className="flex items-center justify-center py-10 t-muted">
            <Loader2 size={16} className="animate-spin mr-2" /> Loading webhooks…
          </div>
        </Card>
      ) : webhooks.length === 0 ? (
        <Card>
          <div className="text-center py-10 space-y-3">
            <WebhookIcon className="w-10 h-10 t-muted mx-auto" />
            <h3 className="text-sm font-semibold t-primary">No webhooks yet</h3>
            <p className="text-xs t-muted max-w-sm mx-auto">
              Create a webhook to receive signed event callbacks from Atheon. You'll see
              the signing secret only once after creation — have your secret manager ready.
            </p>
            <Button variant="primary" size="md" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> Create your first webhook
            </Button>
          </div>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3">
          {webhooks.map((w) => {
            const h = healthBadge(w);
            const HIcon = h.icon;
            return (
              <Card key={w.id} hover className="cursor-pointer" onClick={() => openDetail(w.id)}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <code className="text-sm font-mono t-primary truncate">{w.url}</code>
                      <Badge variant={h.variant}>
                        <HIcon size={10} className="mr-1" /> {h.label}
                      </Badge>
                    </div>
                    {w.description && (
                      <p className="text-xs t-secondary">{w.description}</p>
                    )}
                    <div className="flex flex-wrap gap-1">
                      {w.event_types.slice(0, 6).map((ev) => (
                        <Badge key={ev} variant="outline" size="sm">
                          <code className="font-mono">{ev}</code>
                        </Badge>
                      ))}
                      {w.event_types.length > 6 && (
                        <Badge variant="outline" size="sm">+{w.event_types.length - 6} more</Badge>
                      )}
                    </div>
                    <p className="text-[10px] t-muted">
                      Created {new Date(w.created_at).toLocaleDateString()}
                      {w.last_delivery_at ? ` · Last delivery ${new Date(w.last_delivery_at).toLocaleString()}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-2 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <Button variant="outline" size="sm" onClick={() => openDetail(w.id)}>
                      View
                    </Button>
                    <Button variant="danger" size="sm" onClick={() => handleRevoke(w.id)}>
                      <Trash2 size={12} /> Revoke
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ReceiverDocsSection />

      {/* Create wizard modal */}
      {showCreate && (
        <Modal title="Create webhook" onClose={() => setShowCreate(false)}>
          <WebhookCreateWizard
            onCompleted={handleCreated}
            onCancel={() => setShowCreate(false)}
          />
        </Modal>
      )}

      {/* Detail modal */}
      {detailId && (
        <Modal
          title="Webhook detail"
          onClose={closeDetail}
          wide
        >
          <WebhookDetail
            webhookId={detailId}
            initialData={activeWebhook}
            onRevoke={() => handleRevoke(detailId)}
          />
        </Modal>
      )}
    </div>
  );
}

// ─── Modal ─────────────────────────────────────────────────────────────
function Modal({ children, title, onClose, wide }: { children: React.ReactNode; title: string; onClose: () => void; wide?: boolean }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <Portal>
      <div
        className="fixed inset-0 z-[9000] flex items-start justify-center p-4 overflow-y-auto"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      >
        <div
          className="relative rounded-2xl border shadow-2xl w-full my-8"
          style={{
            background: 'var(--bg-card-solid)',
            borderColor: 'var(--border-card)',
            maxWidth: wide ? 860 : 560,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border-card)' }}>
            <h2 className="text-base font-semibold t-primary">{title}</h2>
            <button
              onClick={onClose}
              className="p-1 rounded hover:bg-[var(--bg-secondary)] t-muted hover:t-primary"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
          <div className="p-5">{children}</div>
        </div>
      </div>
    </Portal>
  );
}

// ─── Webhook Detail ────────────────────────────────────────────────────
interface WebhookDetailProps {
  webhookId: string;
  initialData: Webhook | null;
  onRevoke: () => void;
}

function WebhookDetail({ webhookId, initialData, onRevoke }: WebhookDetailProps) {
  const toast = useToast();
  const [webhook, setWebhook] = useState<Webhook | null>(initialData);
  const [loading, setLoading] = useState(!initialData);
  const [testing, setTesting] = useState(false);
  // Wave-1 polish (UX audit §4.4): inline edit instead of delete-and-recreate
  const [editing, setEditing] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [editUrl, setEditUrl] = useState('');
  const [editEvents, setEditEvents] = useState('');
  const [editActive, setEditActive] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(!initialData);
    api.webhooks.get(webhookId).then((w) => {
      if (cancelled) return;
      setWebhook(w);
    }).catch(() => {
      if (!cancelled && !initialData) {
        toast.error('Failed to load webhook');
      }
    }).finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
    // toast intentionally omitted from deps — it's a stable context ref but ref isn't guaranteed;
    // we only want to re-fetch when webhookId changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webhookId, initialData]);

  const handleTest = async () => {
    setTesting(true);
    try {
      await api.webhooks.test(webhookId);
      toast.success('Test delivery queued', 'Refresh the deliveries table to see the outcome.');
    } catch (err) {
      toast.error('Failed to queue test delivery', err instanceof Error ? err.message : undefined);
    }
    setTesting(false);
  };

  const startEdit = () => {
    if (!webhook) return;
    setEditUrl(webhook.url);
    setEditEvents(webhook.event_types.join(', '));
    setEditActive(!webhook.disabled);
    setEditing(true);
  };

  const cancelEdit = () => setEditing(false);

  const saveEdit = async () => {
    if (!webhook) return;
    const url = editUrl.trim();
    const events = editEvents.split(',').map((s) => s.trim()).filter(Boolean);
    if (!url) {
      toast.error('URL is required');
      return;
    }
    if (events.length === 0) {
      toast.error('At least one event type is required');
      return;
    }
    setSavingEdit(true);
    try {
      await api.webhooks.update(webhookId, { url, events, active: editActive });
      const fresh = await api.webhooks.get(webhookId);
      setWebhook(fresh);
      setEditing(false);
      toast.success('Webhook updated');
    } catch (err) {
      toast.error('Failed to update webhook', err instanceof Error ? err.message : undefined);
    } finally {
      setSavingEdit(false);
    }
  };

  if (loading || !webhook) {
    return (
      <div className="flex items-center justify-center py-10 t-muted">
        <Loader2 size={16} className="animate-spin mr-2" /> Loading…
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Overview */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold t-primary flex items-center gap-2">
          <ShieldCheck size={14} className="text-accent" /> Overview
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <OverviewField label="URL" value={webhook.url} mono />
          <OverviewField label="Webhook ID" value={webhook.id} mono />
          <OverviewField label="Created" value={new Date(webhook.created_at).toLocaleString()} />
          <OverviewField label="Status" value={webhook.disabled ? 'Disabled' : 'Active'} />
        </div>
        {webhook.description && (
          <OverviewField label="Description" value={webhook.description} />
        )}
        <div>
          <label className="text-[10px] font-medium t-muted">Signing secret</label>
          <div
            className="mt-1 p-2 rounded-lg text-xs font-mono flex items-center justify-between gap-2"
            style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}
          >
            <span className="t-muted tracking-widest">{webhook.secret || '***'}</span>
            <span className="text-[10px] t-muted italic">shown once at creation · rotate by revoking + recreating</span>
          </div>
        </div>
        <div>
          <label className="text-[10px] font-medium t-muted">Event types</label>
          <div className="flex flex-wrap gap-1 mt-1">
            {webhook.event_types.map((ev) => (
              <Badge key={ev} variant="info" size="sm">
                <code className="font-mono">{ev}</code>
              </Badge>
            ))}
          </div>
        </div>
      </section>

      {/* Edit form (inline; replaces actions while open) */}
      {editing ? (
        <section className="space-y-3 p-3 rounded-lg" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
          <h3 className="text-xs font-semibold t-primary flex items-center gap-2">
            <Pencil size={12} className="text-accent" /> Edit webhook
          </h3>
          <div className="space-y-2">
            <label className="text-[10px] font-medium t-muted">Receiver URL</label>
            <input
              type="url"
              value={editUrl}
              onChange={(e) => setEditUrl(e.target.value)}
              placeholder="https://your-receiver.example.com/webhooks/atheon"
              className="w-full px-2 py-1.5 rounded-md text-xs font-mono"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-medium t-muted">Event types (comma-separated)</label>
            <input
              type="text"
              value={editEvents}
              onChange={(e) => setEditEvents(e.target.value)}
              placeholder="catalyst.completed, anomaly.detected"
              className="w-full px-2 py-1.5 rounded-md text-xs font-mono"
              style={{ background: 'var(--bg-input)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
            />
            <p className="text-[10px] t-muted">Use <code className="font-mono">*</code> as a wildcard or list specific events.</p>
          </div>
          <label className="flex items-center gap-2 text-xs t-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={editActive}
              onChange={(e) => setEditActive(e.target.checked)}
              className="accent-current"
            />
            Active (uncheck to pause delivery without revoking)
          </label>
          <p className="text-[10px] t-muted">
            The signing secret is <em>not</em> editable — rotate by revoking this webhook + creating a new one.
          </p>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" size="sm" onClick={cancelEdit} disabled={savingEdit}>
              Cancel
            </Button>
            <Button variant="primary" size="sm" onClick={saveEdit} disabled={savingEdit}>
              {savingEdit && <Loader2 size={12} className="animate-spin mr-1" />}
              Save
            </Button>
          </div>
        </section>
      ) : (
        <section className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={handleTest} disabled={testing}>
            {testing ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />}
            Send test payload
          </Button>
          <Button variant="outline" size="sm" onClick={startEdit}>
            <Pencil size={12} /> Edit
          </Button>
          <Button variant="danger" size="sm" onClick={onRevoke}>
            <Trash2 size={12} /> Revoke webhook
          </Button>
        </section>
      )}

      {/* Deliveries */}
      <section>
        <WebhookDeliveriesTable webhookId={webhookId} />
      </section>
    </div>
  );
}

function OverviewField({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-[10px] font-medium t-muted">{label}</label>
      <div className={`text-xs t-primary break-all ${mono ? 'font-mono' : ''}`}>{value}</div>
    </div>
  );
}

// ─── Receiver Docs (collapsible) ───────────────────────────────────────
const NODE_SNIPPET = `// Node.js verification
import crypto from 'crypto';

function verifyAtheonSignature(req, secret) {
  const timestamp = req.headers['x-atheon-timestamp'];
  const received = req.headers['x-atheon-signature']; // e.g. "sha256=ab12…"
  const body = req.rawBody; // keep the RAW string — do not re-serialise

  const expected = 'sha256=' + crypto
    .createHmac('sha256', secret)
    .update(timestamp + '.' + body)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}`;

const PYTHON_SNIPPET = `# Python verification
import hmac, hashlib

def verify_atheon_signature(headers, raw_body, secret):
    timestamp = headers['X-Atheon-Timestamp']
    received = headers['X-Atheon-Signature']  # "sha256=…"
    expected = 'sha256=' + hmac.new(
        secret.encode(),
        (timestamp + '.' + raw_body).encode(),
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, received)`;

function ReceiverDocsSection() {
  const [open, setOpen] = useState(false);
  return (
    <Card variant="outline">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between text-left"
        aria-expanded={open}
      >
        <div className="flex items-center gap-2">
          <Code size={14} className="text-accent" />
          <div>
            <h3 className="text-sm font-semibold t-primary">Receiver-side verification docs</h3>
            <p className="text-[10px] t-muted">How to validate `X-Atheon-Signature` on your server</p>
          </div>
        </div>
        {open ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="text-xs t-secondary space-y-2">
            <p>
              Every delivery includes these headers:
            </p>
            <ul className="list-disc list-inside space-y-0.5 t-muted">
              <li><code className="font-mono">X-Atheon-Signature: sha256=&lt;hex&gt;</code></li>
              <li><code className="font-mono">X-Atheon-Timestamp: &lt;unix_seconds&gt;</code></li>
              <li><code className="font-mono">X-Atheon-Event: &lt;event_type&gt;</code></li>
              <li><code className="font-mono">X-Atheon-Webhook-Id: &lt;webhook_id&gt;</code></li>
            </ul>
            <p>
              Compute <code className="font-mono">HMAC-SHA256(secret, timestamp + "." + raw_body)</code>,
              compare to the signature in constant time, and reject if the timestamp is more than ~5 minutes old
              to avoid replay attacks.
            </p>
          </div>

          <CodeBlock title="Node.js" snippet={NODE_SNIPPET} />
          <CodeBlock title="Python" snippet={PYTHON_SNIPPET} />
        </div>
      )}
    </Card>
  );
}

function CodeBlock({ title, snippet }: { title: string; snippet: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* ignore */ }
  };
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-medium t-secondary uppercase tracking-wide">{title}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="text-[10px] t-muted hover:t-primary inline-flex items-center gap-1"
          aria-label={`Copy ${title} snippet`}
        >
          {copied ? <CheckCircle2 size={10} className="text-emerald-500" /> : <Copy size={10} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre
        className="p-3 rounded-lg text-[11px] overflow-x-auto font-mono"
        style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)', color: 'var(--text-primary)' }}
      >
        <code>{snippet}</code>
      </pre>
    </div>
  );
}
