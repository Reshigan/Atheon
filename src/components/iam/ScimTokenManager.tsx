/**
 * ScimTokenManager — admin UI for the Phase AX SCIM 2.0 provisioning surface.
 *
 * Lets a tenant admin:
 *   - See every SCIM bearer token issued for the tenant (name + 14-char
 *     prefix + created + last-used + revoked status)
 *   - Issue a new token, naming the integration (e.g. "Okta production")
 *   - Copy the clear token value ONCE in a one-shot reveal — closing the
 *     reveal panel destroys it from memory; copy-to-clipboard is the only
 *     path off the screen
 *   - Revoke a token (soft-delete: revoked_at stamped, audit row written)
 *
 * Why one-shot reveal: SCIM tokens are long-lived secrets. Once shown they
 * cannot be retrieved again. The UX must make this obvious BEFORE the
 * token is generated, then enforce it after.
 *
 * The backend hashes tokens with SHA-256 and never logs the clear value,
 * so this component is the only surface that ever sees the secret.
 */
import { useCallback, useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import {
  UploadCloud, Plus, Trash2, Copy, AlertTriangle, CheckCircle2, Loader2, X,
} from 'lucide-react';

type Token = {
  id: string; name: string; key_prefix: string;
  created_by: string | null; created_at: string;
  last_used_at: string | null; revoked_at: string | null;
};

export function ScimTokenManager(): JSX.Element {
  const toast = useToast();
  const [tokens, setTokens] = useState<Token[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  // One-shot reveal of the clear token after creation.
  const [revealed, setRevealed] = useState<{ id: string; name: string; token: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.iam.scimTokens();
      setTokens(res.tokens);
    } catch (err) {
      toast.error('Failed to load SCIM tokens', {
        message: err instanceof ApiError ? err.message : 'Unknown error',
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void load(); }, [load]);

  const create = async () => {
    const name = newTokenName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await api.iam.createScimToken(name);
      setRevealed({ id: res.id, name: res.name, token: res.token });
      setNewTokenName('');
      setShowCreate(false);
      await load();
    } catch (err) {
      toast.error('Failed to create token', {
        message: err instanceof ApiError ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setCreating(false);
    }
  };

  const revoke = async (t: Token) => {
    if (!window.confirm(`Revoke "${t.name}"? The IdP using this token will stop being able to provision users immediately.`)) return;
    try {
      await api.iam.revokeScimToken(t.id);
      toast.success(`Revoked ${t.name}`);
      await load();
    } catch (err) {
      toast.error('Revoke failed', {
        message: err instanceof ApiError ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
  };

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast.success('Copied to clipboard');
    } catch {
      toast.error('Copy failed', 'Use a desktop browser with clipboard access');
    }
  };

  return (
    <div className="space-y-4">
      {/* Educational lede so admins know what SCIM is for + how to wire it. */}
      <Card className="p-5">
        <div className="flex items-start gap-3">
          <UploadCloud size={18} className="text-accent mt-0.5 flex-shrink-0" />
          <div className="space-y-2 text-body-sm">
            <p className="t-primary font-medium">Automatic user provisioning via SCIM 2.0</p>
            <p className="t-secondary">
              Enterprise IdPs (Okta, Azure AD / Entra ID, Google Workspace, OneLogin, JumpCloud) call our
              SCIM endpoints to create, update, and deactivate users automatically — no manual offboarding
              required. Each integration uses one bearer token issued below.
            </p>
            <div className="t-muted text-caption pt-1">
              SCIM Base URL: <code className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>https://atheon-api.vantax.co.za/scim/v2</code>
              {' · '}
              Discovery: <code className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>/ServiceProviderConfig</code>
            </div>
          </div>
        </div>
      </Card>

      <div className="flex items-center justify-between gap-3">
        <h3 className="text-body font-semibold t-primary">Issued tokens</h3>
        {!showCreate && (
          <Button variant="primary" size="sm" onClick={() => setShowCreate(true)}>
            <Plus size={14} /> New token
          </Button>
        )}
      </div>

      {showCreate && (
        <Card className="p-4">
          <div className="space-y-3">
            <label className="block">
              <span className="text-caption uppercase tracking-wider t-muted block mb-1">Integration name</span>
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="e.g. Okta production, Azure AD"
                className="w-full px-3 py-2 rounded-md text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
                maxLength={80}
                autoFocus
              />
              <p className="text-caption t-muted mt-1">Used to identify this integration when revoking. Will appear in the audit log on every provisioning event.</p>
            </label>
            <div className="flex items-center justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => { setShowCreate(false); setNewTokenName(''); }} disabled={creating}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={() => void create()} disabled={creating || !newTokenName.trim()}>
                {creating ? <><Loader2 size={12} className="animate-spin" /> Creating…</> : <><Plus size={12} /> Generate token</>}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {/* One-shot reveal — the only place the clear token ever exists in the UI. */}
      {revealed && (
        <Card className="p-5" style={{ background: 'rgb(var(--warning-rgb) / 0.08)', borderColor: 'rgb(var(--warning-rgb) / 0.35)' }}>
          <div className="flex items-start gap-3 mb-3">
            <AlertTriangle size={18} className="mt-0.5 flex-shrink-0" style={{ color: 'var(--warning)' }} />
            <div className="flex-1 min-w-0">
              <p className="text-body-sm font-semibold t-primary">Copy this token now — it will never be shown again</p>
              <p className="text-caption t-muted mt-0.5">Once you close this panel, Atheon cannot recover the secret. Anyone with this value can provision users on your tenant.</p>
            </div>
            <button onClick={() => setRevealed(null)} className="t-muted hover:t-primary p-1 rounded" aria-label="Close reveal">
              <X size={14} />
            </button>
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-caption px-3 py-2 rounded flex-1 min-w-0 break-all" style={{ background: 'var(--bg-secondary)', color: 'var(--text-primary)' }}>
              {revealed.token}
            </code>
            <Button variant="primary" size="sm" onClick={() => void copy(revealed.token)}>
              <Copy size={12} /> Copy
            </Button>
          </div>
          <div className="mt-3 text-caption t-muted">
            Paste this in your IdP's SCIM integration as the Bearer token. The integration name on this token is <strong className="t-primary">{revealed.name}</strong>.
          </div>
        </Card>
      )}

      {loading ? (
        <div className="text-caption t-muted py-8 text-center">Loading tokens…</div>
      ) : tokens.length === 0 ? (
        <Card className="p-8 text-center">
          <UploadCloud size={32} className="t-muted opacity-40 mx-auto mb-3" />
          <p className="text-body-sm font-medium t-primary">No SCIM tokens issued yet</p>
          <p className="text-caption t-muted mt-1">Issue a token to wire up Okta, Azure AD, or another IdP.</p>
        </Card>
      ) : (
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="text-caption uppercase tracking-wider t-muted">
                <tr className="border-b border-[var(--border-card)]">
                  <th className="text-left px-4 py-3 font-medium">Name</th>
                  <th className="text-left px-4 py-3 font-medium">Token prefix</th>
                  <th className="text-left px-4 py-3 font-medium">Created</th>
                  <th className="text-left px-4 py-3 font-medium">Last used</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-right px-4 py-3 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {tokens.map((t) => {
                  const revoked = !!t.revoked_at;
                  return (
                    <tr key={t.id} className="border-b border-[var(--border-card)] last:border-0">
                      <td className="px-4 py-3 t-primary font-medium">{t.name}</td>
                      <td className="px-4 py-3 font-mono t-secondary">{t.key_prefix}…</td>
                      <td className="px-4 py-3 t-muted">{new Date(t.created_at).toLocaleString()}</td>
                      <td className="px-4 py-3 t-muted">{t.last_used_at ? new Date(t.last_used_at).toLocaleString() : '—'}</td>
                      <td className="px-4 py-3">
                        {revoked ? (
                          <span className="inline-flex items-center gap-1 text-caption text-neg"><X size={11} /> Revoked</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-caption text-accent"><CheckCircle2 size={11} /> Active</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!revoked && (
                          <Button variant="ghost" size="sm" onClick={() => void revoke(t)} title="Revoke">
                            <Trash2 size={12} />
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

export default ScimTokenManager;
