/**
 * Webhook Signing Secrets — Phase 10-37 UI.
 *
 * List / provision / rotate / revoke HMAC secrets that gate the
 * /api/v1/ingest/* surface. Each secret is shown EXACTLY ONCE at
 * provision/rotate time — the page enforces that with a one-shot
 * modal that operators can copy from before it disappears.
 *
 * Route: /webhook-secrets   |   Roles: PLATFORM_ADMIN_ROLES
 */
import { useState, useEffect, useCallback } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { WebhookSecretRow, WebhookSecretProvisionResponse } from '@/lib/api';
import { Loader2, RefreshCw, KeyRound, Plus, RotateCw, Trash2, Copy, Check, XCircle, AlertTriangle } from 'lucide-react';

const STATUS_BADGE: Record<WebhookSecretRow['status'], { variant: 'default' | 'secondary' | 'destructive' | 'outline'; label: string }> = {
  active:   { variant: 'default',     label: 'Active' },
  rotated:  { variant: 'secondary',   label: 'Rotated' },
  revoked:  { variant: 'destructive', label: 'Revoked' },
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function formatRelative(iso: string | null): string {
  if (!iso) return 'never';
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

export function WebhookSecretsPage() {
  const toast = useToast();
  const [secrets, setSecrets] = useState<WebhookSecretRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showProvision, setShowProvision] = useState(false);
  const [revealed, setRevealed] = useState<WebhookSecretProvisionResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.webhookSecrets.list();
      setSecrets(res.secrets);
    } catch (err) {
      toast.error('Failed to load webhook secrets', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleProvision = useCallback(async (sourceId: string, label: string) => {
    setBusy('provisioning');
    try {
      const res = await api.webhookSecrets.provision({
        source_id: sourceId.trim(),
        label: label.trim() || sourceId.trim(),
      });
      setRevealed(res);
      setShowProvision(false);
      load();
    } catch (err) {
      toast.error('Provision failed', {
        message: err instanceof Error ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setBusy(null);
    }
  }, [toast, load]);

  const handleRotate = useCallback(async (row: WebhookSecretRow) => {
    if (!window.confirm(`Rotate the secret for ${row.source_id}?\n\nThe current secret stops accepting signatures immediately and the new one must be deployed to the caller before its next request.`)) {
      return;
    }
    setBusy(row.id);
    try {
      const res = await api.webhookSecrets.rotate(row.id);
      setRevealed(res);
      load();
    } catch (err) {
      toast.error('Rotate failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }, [toast, load]);

  const handleRevoke = useCallback(async (row: WebhookSecretRow) => {
    const reason = window.prompt(`Revoke secret for ${row.source_id}?\n\nReason (will be stored in audit log):`);
    if (reason === null) return;
    setBusy(row.id);
    try {
      await api.webhookSecrets.revoke(row.id, reason || `Revoked by operator`);
      toast.success('Revoked', { message: `Secret ${row.secret_prefix} revoked` });
      load();
    } catch (err) {
      toast.error('Revoke failed', { message: err instanceof Error ? err.message : 'Unknown error' });
    } finally {
      setBusy(null);
    }
  }, [toast, load]);

  const activeCount = secrets.filter((s) => s.status === 'active').length;
  const stale = secrets.filter((s) => s.status === 'active' && (!s.last_used_at || (Date.now() - new Date(s.last_used_at).getTime()) > 30 * 24 * 60 * 60 * 1000));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <KeyRound className="h-6 w-6 text-muted-foreground" /> Webhook Signing Secrets
          </h1>
          <p className="text-sm text-muted-foreground">
            HMAC secrets gate <code>/api/v1/ingest/*</code>. Stripe-style scheme: callers send <code>X-Atheon-Signature: t=&lt;ts&gt;,v1=&lt;hex&gt;</code> + <code>X-Atheon-Source: &lt;source-id&gt;</code>.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowProvision(true)}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" /> Provision
          </button>
          <button onClick={load} className="flex items-center gap-1 rounded border px-3 py-1 text-sm hover:bg-muted">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
      </div>

      {/* Headline */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Total secrets</div>
          <div className="text-2xl font-semibold">{secrets.length}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Active</div>
          <div className="text-2xl font-semibold text-green-600">{activeCount}</div>
        </Card>
        <Card className="p-3">
          <div className="text-xs text-muted-foreground">Stale (no use in 30d)</div>
          <div className={`text-2xl font-semibold ${stale.length > 0 ? 'text-amber-600' : ''}`}>{stale.length}</div>
        </Card>
      </div>

      {/* Secrets table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center p-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
        ) : secrets.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-2 p-12 text-muted-foreground">
            <KeyRound className="h-8 w-8" />
            <div className="text-sm">No webhook secrets yet.</div>
            <button
              onClick={() => setShowProvision(true)}
              className="mt-2 flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" /> Provision first secret
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b bg-muted/40">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Source ID</th>
                  <th className="px-3 py-2 text-left font-medium">Label</th>
                  <th className="px-3 py-2 text-left font-medium">Prefix</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                  <th className="px-3 py-2 text-left font-medium">Created</th>
                  <th className="px-3 py-2 text-left font-medium">Last used</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {secrets.map((s) => {
                  const badge = STATUS_BADGE[s.status];
                  const isActive = s.status === 'active';
                  return (
                    <tr key={s.id} className="border-b hover:bg-muted/30">
                      <td className="px-3 py-2 font-mono text-xs">{s.source_id}</td>
                      <td className="px-3 py-2 text-xs">{s.label}</td>
                      <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{s.secret_prefix}</td>
                      <td className="px-3 py-2"><Badge variant={badge.variant}>{badge.label}</Badge></td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatDate(s.created_at)}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{formatRelative(s.last_used_at)}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center justify-end gap-1">
                          {isActive && (
                            <>
                              <button
                                onClick={() => handleRotate(s)}
                                disabled={busy === s.id}
                                className="flex items-center gap-1 rounded border px-2 py-1 text-xs hover:bg-muted disabled:opacity-50"
                                title="Issue a new secret; old one stops accepting signatures immediately"
                              >
                                {busy === s.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                                Rotate
                              </button>
                              <button
                                onClick={() => handleRevoke(s)}
                                disabled={busy === s.id}
                                className="flex items-center gap-1 rounded border border-destructive/30 px-2 py-1 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-50"
                                title="Revoke immediately (audit-logged)"
                              >
                                <Trash2 className="h-3 w-3" /> Revoke
                              </button>
                            </>
                          )}
                          {!isActive && s.revoked_reason && (
                            <span className="text-xs text-muted-foreground" title={s.revoked_reason}>
                              {s.revoked_reason.slice(0, 30)}{s.revoked_reason.length > 30 ? '…' : ''}
                            </span>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Wire-protocol cheat sheet */}
      <Card className="p-4 text-sm">
        <h2 className="mb-2 text-sm font-semibold">Caller wire protocol</h2>
        <pre className="overflow-x-auto rounded bg-muted/40 p-3 text-xs">{`POST /api/v1/ingest/<resource>
X-Atheon-Source: <source-id>
X-Atheon-Signature: t=<unix-ts>,v1=<hmac-sha256(secret, "<ts>.<body>") in lowercase hex>
Content-Type: application/json

<json body>`}</pre>
        <p className="mt-3 text-xs text-muted-foreground">
          Timestamp must be within ±5 minutes of server clock (replay window). Rotated/revoked secrets reject immediately.
        </p>
      </Card>

      {/* Provision modal */}
      {showProvision && (
        <ProvisionModal
          busy={busy === 'provisioning'}
          onCancel={() => setShowProvision(false)}
          onProvision={handleProvision}
        />
      )}

      {/* Reveal modal — shows the raw secret EXACTLY ONCE */}
      {revealed && (
        <RevealModal
          response={revealed}
          onClose={() => setRevealed(null)}
        />
      )}
    </div>
  );
}

function ProvisionModal({ busy, onCancel, onProvision }: {
  busy: boolean; onCancel: () => void; onProvision: (sourceId: string, label: string) => void;
}) {
  const [sourceId, setSourceId] = useState('');
  const [label, setLabel] = useState('');
  const valid = /^[a-zA-Z0-9_.\-:]{1,64}$/.test(sourceId);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4" onClick={onCancel}>
      <Card className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b p-3">
          <h2 className="text-lg font-semibold flex items-center gap-2"><Plus className="h-5 w-5" /> Provision webhook secret</h2>
          <button onClick={onCancel} className="rounded p-1 hover:bg-muted"><XCircle className="h-5 w-5" /></button>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <label className="text-xs text-muted-foreground">Source ID</label>
            <input
              autoFocus
              value={sourceId}
              onChange={(e) => setSourceId(e.target.value)}
              placeholder="e.g. stripe-prod, sage-payroll, vendor-portal-acme"
              className="mt-1 w-full rounded border bg-background px-2 py-1 font-mono text-sm"
              maxLength={64}
            />
            <div className="mt-1 text-[11px] text-muted-foreground">
              Identifier the caller sends in <code>X-Atheon-Source</code>. 1-64 chars, [a-zA-Z0-9_.-:]
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Label (optional)</label>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="Human-readable name (defaults to source ID)"
              className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm"
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t p-3">
          <button onClick={onCancel} className="rounded border px-3 py-1.5 text-sm hover:bg-muted">Cancel</button>
          <button
            onClick={() => onProvision(sourceId, label)}
            disabled={!valid || busy}
            className="flex items-center gap-1 rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Generate
          </button>
        </div>
      </Card>
    </div>
  );
}

function RevealModal({ response, onClose }: {
  response: WebhookSecretProvisionResponse; onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = useCallback(() => {
    navigator.clipboard.writeText(response.secret).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [response.secret]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4">
      <Card className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="border-b p-3">
          <div className="flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-amber-500" />
            <h2 className="text-lg font-semibold">Save this secret now</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Source: <code className="font-mono">{response.secret_row.source_id}</code> · Label: {response.secret_row.label}
          </p>
        </div>
        <div className="space-y-3 p-4">
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <div>
              <strong>Atheon does not store this value.</strong> Copy it into your caller's secret store now —
              after you close this dialog you'll only see the prefix in this UI.
            </div>
          </div>
          <div>
            <label className="text-xs text-muted-foreground">Secret value</label>
            <div className="mt-1 flex items-stretch gap-2">
              <input
                readOnly
                value={response.secret}
                className="flex-1 rounded border bg-muted/40 px-2 py-2 font-mono text-xs"
                onFocus={(e) => e.target.select()}
              />
              <button
                onClick={copy}
                className="flex items-center gap-1 rounded border bg-background px-3 py-2 text-xs hover:bg-muted"
              >
                {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
          </div>
          <div className="text-xs text-muted-foreground">{response.note}</div>
        </div>
        <div className="flex justify-end border-t p-3">
          <button
            onClick={onClose}
            className="rounded bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            I've saved it
          </button>
        </div>
      </Card>
    </div>
  );
}

export default WebhookSecretsPage;
