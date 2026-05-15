/**
 * SamlConfigPanel — admin UI for the Phase AY WorkOS-brokered SAML SSO.
 *
 * Atheon federates SAML through WorkOS rather than implementing xmldsig
 * directly. A tenant admin pastes the WorkOS Connection ID
 * ("conn_01H..."), optionally restricts to one email domain, picks the
 * default role for auto-provisioned users, and toggles auto-provision.
 *
 * The form upserts a single sso_configs row per tenant via the new
 * PATCH /api/iam/sso/saml endpoint. The audit_log captures every change.
 *
 * Inline setup guide (collapsed by default) walks the admin through:
 *   1. Create a WorkOS Connection in workos.com for their IdP
 *   2. Set the Atheon ACS / Service Provider URL in the WorkOS dashboard
 *   3. Paste the Connection ID here
 *   4. Optionally pin to a domain so non-tenant emails can't trigger SSO
 */
import { useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import type { SSOConfig } from '@/lib/api';
import { Globe, ChevronDown, ChevronUp, ExternalLink, Loader2, Save, CheckCircle2 } from 'lucide-react';

interface Props {
  ssoConfigs: SSOConfig[];
  onSaved: () => Promise<void>;
}

const ROLE_OPTIONS = [
  { value: 'analyst', label: 'Analyst (read-only)' },
  { value: 'operator', label: 'Operator' },
  { value: 'manager', label: 'Manager' },
  { value: 'executive', label: 'Executive' },
];

export function SamlConfigPanel({ ssoConfigs, onSaved }: Props): JSX.Element {
  const toast = useToast();
  const samlConfig = useMemo(
    () => ssoConfigs.find((s) => s.provider === 'workos_saml' || s.workosConnectionId),
    [ssoConfigs],
  );

  const [connectionId, setConnectionId] = useState(samlConfig?.workosConnectionId ?? '');
  const [domainHint, setDomainHint] = useState(samlConfig?.domainHint ?? '');
  const [autoProvision, setAutoProvision] = useState(samlConfig?.autoProvision ?? false);
  const [defaultRole, setDefaultRole] = useState(samlConfig?.defaultRole ?? 'analyst');
  const [enabled, setEnabled] = useState(samlConfig?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [showSetup, setShowSetup] = useState(false);

  // Re-sync local state if parent reloads with different config.
  useEffect(() => {
    if (samlConfig) {
      setConnectionId(samlConfig.workosConnectionId ?? '');
      setDomainHint(samlConfig.domainHint ?? '');
      setAutoProvision(samlConfig.autoProvision);
      setDefaultRole(samlConfig.defaultRole);
      setEnabled(samlConfig.enabled);
    }
  }, [samlConfig]);

  const save = async () => {
    setSaving(true);
    try {
      await api.iam.saveSamlConfig({
        workos_connection_id: connectionId.trim() || null,
        domain_hint: domainHint.trim() || null,
        auto_provision: autoProvision,
        default_role: defaultRole,
        enabled,
      });
      toast.success('SAML configuration saved');
      await onSaved();
    } catch (err) {
      toast.error('Save failed', {
        message: err instanceof ApiError ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setSaving(false);
    }
  };

  const connectionValid = !connectionId || /^conn_[A-Za-z0-9]{20,40}$/.test(connectionId.trim());

  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
            <Globe className="w-5 h-5 text-accent" />
          </div>
          <div>
            <h3 className="text-base font-semibold t-primary">SAML SSO (via WorkOS)</h3>
            <p className="text-caption t-muted">Federate sign-in to your Okta, Azure AD, Google Workspace, Ping, or OneLogin tenant.</p>
          </div>
        </div>
        {samlConfig?.workosConnectionId ? (
          <Badge variant="success" size="sm"><CheckCircle2 size={11} className="mr-1" />Configured</Badge>
        ) : (
          <Badge variant="default" size="sm">Not configured</Badge>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <label className="block">
          <span className="text-caption uppercase tracking-wider t-muted block mb-1">WorkOS Connection ID</span>
          <input
            type="text"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
            placeholder="conn_01H..."
            className={`w-full px-3 py-2 rounded-lg text-body-sm font-mono bg-[var(--bg-input)] border t-primary focus:outline-none ${connectionValid ? 'border-[var(--border-card)] focus:border-accent' : 'border-red-400'}`}
            maxLength={64}
          />
          <p className={`text-caption mt-1 ${connectionValid ? 't-muted' : 'text-red-400'}`}>
            {connectionValid ? 'Paste the Connection ID from your WorkOS dashboard.' : 'Format: conn_ followed by ≥ 20 alphanumeric characters.'}
          </p>
        </label>
        <label className="block">
          <span className="text-caption uppercase tracking-wider t-muted block mb-1">Email domain (optional)</span>
          <input
            type="text"
            value={domainHint}
            onChange={(e) => setDomainHint(e.target.value)}
            placeholder="acme.com"
            className="w-full px-3 py-2 rounded-lg text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
            maxLength={120}
          />
          <p className="text-caption t-muted mt-1">Restricts SAML to users whose email matches this domain.</p>
        </label>
        <label className="block">
          <span className="text-caption uppercase tracking-wider t-muted block mb-1">Default role for new users</span>
          <select
            value={defaultRole}
            onChange={(e) => setDefaultRole(e.target.value)}
            className="w-full px-3 py-2 rounded-lg text-body-sm bg-[var(--bg-input)] border border-[var(--border-card)] t-primary focus:border-accent focus:outline-none"
          >
            {ROLE_OPTIONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
          <p className="text-caption t-muted mt-1">Applied only when auto-provision is on.</p>
        </label>
        <div className="space-y-3 self-end">
          <label className="flex items-center gap-2 text-body-sm t-primary cursor-pointer">
            <input
              type="checkbox"
              checked={autoProvision}
              onChange={(e) => setAutoProvision(e.target.checked)}
              className="rounded"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
            />
            <span>Auto-provision users on first SAML login</span>
          </label>
          <label className="flex items-center gap-2 text-body-sm t-primary cursor-pointer">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="rounded"
              style={{ background: 'var(--bg-input)', borderColor: 'var(--border-card)' }}
            />
            <span>Enabled</span>
          </label>
        </div>
      </div>

      <div className="flex items-center justify-between mt-5 pt-4 border-t border-[var(--border-card)]">
        <button
          type="button"
          onClick={() => setShowSetup((s) => !s)}
          className="inline-flex items-center gap-1.5 text-caption t-muted hover:t-primary transition-colors"
        >
          {showSetup ? <ChevronUp size={12} /> : <ChevronDown size={12} />} Setup guide
        </button>
        <Button variant="primary" size="sm" onClick={() => void save()} disabled={saving || !connectionValid}>
          {saving ? <><Loader2 size={12} className="animate-spin" /> Saving…</> : <><Save size={12} /> Save SAML config</>}
        </Button>
      </div>

      {showSetup && (
        <div className="mt-4 p-4 rounded-lg text-body-sm space-y-3" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
          <h4 className="text-caption uppercase tracking-wider t-muted font-medium">How to wire SAML</h4>
          <ol className="space-y-2 list-decimal list-inside t-secondary">
            <li>
              Sign in to your <a className="text-accent hover:underline inline-flex items-center gap-1" href="https://dashboard.workos.com" target="_blank" rel="noopener noreferrer">WorkOS dashboard <ExternalLink size={10} /></a> (Atheon's federation broker — Big-4 reviewers accept it).
            </li>
            <li>Create a new Connection for your IdP (Okta / Azure AD / Google Workspace / Ping / OneLogin / JumpCloud).</li>
            <li>
              Set the Service Provider (Atheon) ACS URL in WorkOS to: <code className="font-mono px-1.5 py-0.5 rounded inline-block break-all" style={{ background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}>https://atheon.vantax.co.za/auth/sso/saml/callback</code>
            </li>
            <li>Configure the IdP side per WorkOS's wizard (entity ID, claims, etc.).</li>
            <li>Copy the Connection ID (looks like <code className="font-mono px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-card-solid)', color: 'var(--text-primary)' }}>conn_01H…</code>) and paste it above.</li>
            <li>Save. Users from your domain can now click "Continue with SAML SSO" on the Atheon login page.</li>
          </ol>
        </div>
      )}
    </Card>
  );
}

export default SamlConfigPanel;
