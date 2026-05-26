/**
 * /compliance — SOC 2 control evidence pack.
 *
 * Renders one card per control category (access reviews, MFA posture,
 * configuration changes, incident response, deprovisioning, encryption,
 * audit retention). Aggregated read-only over existing tables — no new
 * schema. Procurement teams can copy numbers off the screen or click
 * "Download JSON" to attach a snapshot to their evidence packet.
 *
 * Admin+ for own tenant; support_admin / superadmin can read any tenant
 * via the existing tenant switcher.
 */
import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabPanel, useTabState } from "@/components/ui/tabs";
import { LoadingState, EmptyState } from "@/components/ui/state";
import { HeroHeader } from "@/components/ui/hero-header";
import {
  ShieldCheck, KeyRound, ClipboardList, AlertTriangle, UserMinus,
  Lock, FileArchive, Download, RefreshCw, FileText, Database,
  Share2, Link as LinkIcon, Copy, Check, X, Trash2,
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { useToast } from "@/components/ui/toast";
import { MetricSource, type MetricProvenance } from "@/components/ui/metric-source";
import { AuditPage } from "./AuditPage";
import { DataGovernancePage } from "./DataGovernancePage";

type EvidencePack = Awaited<ReturnType<typeof api.compliance.evidencePack>>;

function StatChip({ label, value, tone, source }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' | 'neutral'; source?: MetricProvenance }) {
  const colors: Record<string, string> = {
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-red-400',
    neutral: 't-primary',
  };
  return (
    <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
      <div className="flex items-center justify-between">
        <div className="text-label mb-1">{label}</div>
        {source && <MetricSource source={source} />}
      </div>
      <div className={`text-xl font-semibold ${colors[tone || 'neutral']}`}>{value}</div>
    </div>
  );
}

/**
 * /compliance — the canonical compliance + governance + audit surface.
 *
 * Three tabs (May 2026 merge — see UI_POLISH_PRINCIPLES §6.2):
 *   - Evidence:  SOC 2 evidence pack roll-up (this file's original content)
 *   - Audit Log: line-item audit_log table (was /audit, retired)
 *   - Governance: DSAR / retention / encryption controls (was /data-governance, retired)
 *
 * Each tab embeds its original page component verbatim. The pages keep
 * their own state + data-fetch lifecycle; we just unify the URL / sidebar
 * surface so operators have one entry point for "all things compliance".
 */
export function CompliancePage(): JSX.Element {
  const { activeTab, setActiveTab } = useTabState('evidence');

  const tabs = [
    { id: 'evidence', label: 'Evidence Pack', icon: <ShieldCheck size={14} /> },
    { id: 'audit', label: 'Audit Log', icon: <FileText size={14} /> },
    { id: 'governance', label: 'Governance', icon: <Database size={14} /> },
  ];

  return (
    <div data-testid="compliance-page">
      <Tabs tabs={tabs} activeTab={activeTab} onTabChange={setActiveTab} />
      <TabPanel id="evidence" activeTab={activeTab}>
        <ComplianceEvidence />
      </TabPanel>
      <TabPanel id="audit" activeTab={activeTab}>
        <AuditPage />
      </TabPanel>
      <TabPanel id="governance" activeTab={activeTab}>
        <DataGovernancePage />
      </TabPanel>
    </div>
  );
}

/**
 * Evidence pack roll-up — the original CompliancePage content. Extracted as
 * a sub-component so the parent CompliancePage can compose it with the
 * Audit Log and Governance tabs without rewriting state management here.
 */
function ComplianceEvidence(): JSX.Element {
  const toast = useToast();
  const activeTenantId = useAppStore(s => s.activeTenantId);
  const [pack, setPack] = useState<EvidencePack | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // ISO timestamp of last evidence-pack load, fuels freshness rows on each
  // StatChip's MetricSource popover.
  const [loadedAt, setLoadedAt] = useState<string | null>(null);

  async function load() {
    try {
      const p = await api.compliance.evidencePack(activeTenantId || undefined);
      setPack(p);
      setLoadedAt(new Date().toISOString());
    } catch (err) {
      toast.error('Failed to load evidence pack', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [activeTenantId]);

  function downloadJson() {
    if (!pack) return;
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atheon-compliance-evidence-${pack.tenantId}-${pack.generatedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (loading) return <LoadingState variant="cards" count={4} />;
  if (!pack) {
    return (
      <EmptyState
        icon={ShieldCheck}
        title="No evidence pack available"
        description="The compliance evidence pack will appear here once your tenant has activity."
      />
    );
  }

  // Tone helpers — green when posture is healthy, amber/red otherwise.
  const mfaTone = pack.mfa.mfaCoveragePct >= 90 ? 'good' : pack.mfa.mfaCoveragePct >= 70 ? 'warn' : 'bad';
  const expiredGraceTone = pack.mfa.adminsExpiredGrace > 0 ? 'bad' : 'good';
  const incidentTone = pack.incidentResponse.openCritical > 0 ? 'bad' : 'good';
  const privilegedDisabledTone = pack.deprovisioning.privilegedDisabled > 0 ? 'warn' : 'good';
  const plaintextTone = pack.encryption.erpPlaintext > 0 ? 'warn' : 'good';

  return (
    <div className="p-6 max-w-7xl mx-auto space-y-6" data-testid="compliance-page">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <HeroHeader
          icon={ShieldCheck}
          title="Compliance"
          subtitle={`SOC 2 Evidence Pack · Generated ${new Date(pack.generatedAt).toLocaleString()}`}
          accent="sage"
        />
        <div className="flex items-center gap-2">
          <Button onClick={() => { setRefreshing(true); load(); }} variant="ghost" size="sm" disabled={refreshing}>
            <RefreshCw size={14} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={() => setShareOpen(true)} variant="ghost" size="sm">
            <Share2 size={14} className="mr-2" />
            Share with auditor
          </Button>
          <Button onClick={downloadJson} variant="primary" size="sm">
            <Download size={14} className="mr-2" />
            Download JSON
          </Button>
        </div>
      </div>
      <ShareWithAuditorModal open={shareOpen} onClose={() => setShareOpen(false)} />

      {/* Access reviews */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Access reviews</h2>
          <Badge variant="info" size="sm">SOC 2 CC6.1, CC6.2</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatChip label="Active admins" value={pack.accessReviews.activeAdminCount} source={{
            label: 'Active admins', definition: 'Users with an admin role and an active session token / non-deleted account.',
            table: 'users × user_roles', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(DISTINCT user_id) FROM user_roles WHERE role LIKE '%admin%' AND user.status = 'active'",
            window: 'Snapshot at load', refreshedAt: loadedAt, sample: pack.accessReviews.activeAdminCount,
          }} />
          <StatChip label="Active users" value={pack.accessReviews.activeUserCount} source={{
            label: 'Active users', definition: 'Total non-deleted user accounts for this tenant.',
            table: 'users', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM users WHERE tenant_id = ? AND status = 'active'",
            window: 'Snapshot at load', refreshedAt: loadedAt, sample: pack.accessReviews.activeUserCount,
          }} />
          <StatChip label="Admins assigned (90d)" value={pack.accessReviews.adminsAssignedLast90d} source={{
            label: 'Admins assigned (last 90 days)', definition: 'Number of admin-role assignments in the audit log within the last 90 days. Drives SOC 2 CC6.1 access-review evidence.',
            table: 'audit_log', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM audit_log WHERE action LIKE 'iam.role.assigned%' AND created_at >= now() - 90d",
            window: 'Last 90 days', refreshedAt: loadedAt,
          }} />
          <StatChip label="Role changes (90d)" value={pack.accessReviews.roleChangesLast90d} source={{
            label: 'Role changes (last 90 days)', definition: 'Total IAM role mutations (assigns + revokes) in the last 90 days.',
            table: 'audit_log', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM audit_log WHERE action LIKE 'iam.role.%' AND created_at >= now() - 90d",
            window: 'Last 90 days', refreshedAt: loadedAt,
          }} />
          <StatChip label="MFA-enabled users" value={pack.accessReviews.mfaEnabledCount} source={{
            label: 'MFA-enabled users', definition: 'Users with at least one verified MFA factor enrolled.',
            table: 'user_mfa_factors', endpoint: 'GET /api/compliance/evidence-pack',
            query: 'COUNT(DISTINCT user_id) FROM user_mfa_factors WHERE verified_at IS NOT NULL',
            window: 'Snapshot at load', refreshedAt: loadedAt, sample: pack.accessReviews.mfaEnabledCount,
          }} />
        </div>
      </Card>

      {/* MFA posture */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <KeyRound className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">MFA enforcement</h2>
          <Badge variant="info" size="sm">CC6.1</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
          <StatChip label="Total active users" value={pack.mfa.totalUsers} source={{
            label: 'Total active users', definition: 'Denominator for MFA coverage — non-deleted users for this tenant.',
            table: 'users', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM users WHERE tenant_id = ? AND status = 'active'", refreshedAt: loadedAt,
          }} />
          <StatChip label="MFA enabled" value={pack.mfa.mfaEnabled} source={{
            label: 'MFA enabled', definition: 'Active users with at least one verified MFA factor.',
            table: 'users × user_mfa_factors', endpoint: 'GET /api/compliance/evidence-pack',
            query: 'COUNT(DISTINCT u.id) FROM users u JOIN user_mfa_factors f ON f.user_id = u.id WHERE f.verified_at IS NOT NULL',
            refreshedAt: loadedAt, sample: pack.mfa.mfaEnabled,
          }} />
          <StatChip label="Coverage %" value={`${pack.mfa.mfaCoveragePct}%`} tone={mfaTone} source={{
            label: 'MFA coverage %', definition: 'mfaEnabled / totalUsers. Compliance gates at 95% — anything below trips the SOC 2 CC6.1 control.',
            query: 'mfaEnabled / totalUsers * 100',
            endpoint: 'GET /api/compliance/evidence-pack', refreshedAt: loadedAt,
            notes: [{ label: 'Gate', value: '≥ 95% for CC6.1 pass' }],
          }} />
          <StatChip label="Admins in grace" value={pack.mfa.adminsInGracePeriod} tone={pack.mfa.adminsInGracePeriod > 0 ? 'warn' : 'good'} source={{
            label: 'Admins in MFA grace period', definition: 'Admin users who have not yet enrolled an MFA factor but are still within the configured grace window after account creation.',
            table: 'users', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM users WHERE is_admin AND mfa_enrolled_at IS NULL AND created_at >= now() - grace_days", refreshedAt: loadedAt,
          }} />
          <StatChip label="Admins expired grace" value={pack.mfa.adminsExpiredGrace} tone={expiredGraceTone} source={{
            label: 'Admins past MFA grace', definition: 'Admin users whose grace window has elapsed without MFA enrolment. Each one is a CC6.1 finding.',
            table: 'users', endpoint: 'GET /api/compliance/evidence-pack',
            query: "COUNT(*) FROM users WHERE is_admin AND mfa_enrolled_at IS NULL AND created_at < now() - grace_days", refreshedAt: loadedAt,
            notes: [{ label: 'Compliance impact', value: 'Each row is a CC6.1 exception' }],
          }} />
        </div>
        <Progress value={pack.mfa.mfaCoveragePct} color={mfaTone === 'good' ? 'emerald' : mfaTone === 'warn' ? 'amber' : 'red'} size="md" />
      </Card>

      {/* Configuration changes */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <ClipboardList className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Configuration changes</h2>
          <Badge variant="info" size="sm">CC8.1 — change management</Badge>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <StatChip label="Last 30 days" value={pack.configChanges.changesLast30d} />
          <StatChip label="Last 90 days" value={pack.configChanges.changesLast90d} />
        </div>
        <div className="text-xs t-muted mb-2">Top actions (90d)</div>
        {pack.configChanges.topActions.length === 0 ? (
          <div className="text-sm t-muted">No admin/IAM/SSO actions recorded in the window.</div>
        ) : (
          <div className="space-y-1.5">
            {pack.configChanges.topActions.map(a => (
              <div key={a.action} className="flex items-center justify-between text-xs px-3 py-1.5 rounded bg-[var(--bg-secondary)] border border-[var(--border-card)]">
                <span className="t-primary font-mono">{a.action}</span>
                <span className="t-muted">{a.count}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Incident response */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-amber-400" />
          <h2 className="text-sm font-semibold t-primary">Incident response (P0/P1)</h2>
          <Badge variant="info" size="sm">CC7.3, CC7.4</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <StatChip label="Total (90d)" value={pack.incidentResponse.totalCriticalLast90d} />
          <StatChip label="Resolved (90d)" value={pack.incidentResponse.resolvedCriticalLast90d} />
          <StatChip label="Open" value={pack.incidentResponse.openCritical} tone={incidentTone} />
          <StatChip
            label="Median resolution"
            value={pack.incidentResponse.medianResolutionHours === null ? '—' : `${pack.incidentResponse.medianResolutionHours}h`}
          />
        </div>
      </Card>

      {/* Deprovisioning */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <UserMinus className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">User deprovisioning</h2>
          <Badge variant="info" size="sm">CC6.2 — access removal</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatChip label="Deprovisioned (90d)" value={pack.deprovisioning.deprovisionedLast90d} />
          <StatChip label="Currently disabled" value={pack.deprovisioning.currentlyDisabled} />
          <StatChip label="Privileged disabled" value={pack.deprovisioning.privilegedDisabled} tone={privilegedDisabledTone} />
        </div>
      </Card>

      {/* Encryption */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <Lock className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Encryption at rest (ERP credentials)</h2>
          <Badge variant="info" size="sm">CC6.7</Badge>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <StatChip label="Total connections" value={pack.encryption.totalConnections} />
          <StatChip label="Encrypted" value={pack.encryption.erpEncrypted} tone="good" />
          <StatChip label="Plaintext (legacy)" value={pack.encryption.erpPlaintext} tone={plaintextTone} />
        </div>
      </Card>

      {/* Audit retention */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <FileArchive className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Audit log retention</h2>
          <Badge variant="info" size="sm">CC4.1</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          <StatChip label="Audit log rows" value={pack.auditRetention.totalRows.toLocaleString()} />
          <StatChip
            label="Oldest event"
            value={pack.auditRetention.oldestEventAt
              ? new Date(pack.auditRetention.oldestEventAt).toLocaleDateString()
              : '—'}
          />
          <StatChip label="Provenance chain length" value={pack.auditRetention.provenanceChainLength.toLocaleString()} />
        </div>
        <div className="text-caption t-muted mt-3">
          The provenance chain is a separate immutable record (Merkle + HMAC) of every AI decision —
          auditable independently of the audit log.
        </div>
      </Card>

      <div className="text-caption t-muted text-center pt-2">
        This report is read-only over existing tables. SOC 2 controls not surfaced here (change
        management, vulnerability management, DR) live in the runbook + GitHub Actions history.
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// "Share with auditor" — admin mints a 7-day read-only URL, copies it, and
// hands it to an external auditor. The auditor opens the link without a
// login. Every access is logged with IP + timestamp; admin can revoke from
// the same modal.
// ─────────────────────────────────────────────────────────────────────────────
interface ShareLink {
  id: string;
  label: string | null;
  expires_at: string;
  revoked_at: string | null;
  access_count: number;
  last_accessed_at: string | null;
  last_accessed_ip: string | null;
  created_at: string;
  created_by_user_id: string;
  status: 'active' | 'expired' | 'revoked';
}

function ShareWithAuditorModal({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element | null {
  const toast = useToast();
  const [label, setLabel] = useState('');
  const [creating, setCreating] = useState(false);
  const [freshToken, setFreshToken] = useState<{ token: string; expires_at: string; label: string | null } | null>(null);
  const [links, setLinks] = useState<ShareLink[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    api.compliance.listShareLinks()
      .then(r => setLinks(r.links as ShareLink[]))
      .catch(err => toast.error('Failed to load share links', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      }))
      .finally(() => setLoading(false));
  }, [open, toast]);

  async function createLink() {
    if (creating) return;
    setCreating(true);
    try {
      const r = await api.compliance.createShareLink(label.trim() || undefined);
      setFreshToken({ token: r.token, expires_at: r.expires_at, label: r.label });
      setLabel('');
      const refreshed = await api.compliance.listShareLinks();
      setLinks(refreshed.links as ShareLink[]);
      toast.success('Audit-share link created', { message: 'Valid for 7 days. Copy the URL now — it is shown only once.' });
    } catch (err) {
      toast.error('Failed to create share link', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    try {
      await api.compliance.revokeShareLink(id);
      const refreshed = await api.compliance.listShareLinks();
      setLinks(refreshed.links as ShareLink[]);
      toast.success('Share link revoked');
    } catch (err) {
      toast.error('Failed to revoke', {
        message: err instanceof Error ? err.message : undefined,
        requestId: err instanceof ApiError ? err.requestId : null,
      });
    }
  }

  const shareUrl = freshToken
    ? `${window.location.origin}/audit-share/${freshToken.token}`
    : null;

  async function copy() {
    if (!shareUrl) return;
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast.error('Copy failed — select the URL manually');
    }
  }

  function close() {
    setFreshToken(null);
    setLabel('');
    setCopied(false);
    onClose();
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center p-4"
      style={{ background: 'rgba(15, 23, 31, 0.55)', backdropFilter: 'blur(8px)' }}
      onClick={close}
      role="dialog"
      aria-modal="true"
      aria-label="Share with auditor"
    >
      <div
        className="w-full max-w-2xl rounded-xl border bg-[var(--bg-primary)] border-[var(--border-card)] shadow-2xl overflow-hidden"
        style={{ animation: 'auditShareEnter 220ms cubic-bezier(0.23, 1, 0.32, 1) forwards' }}
        onClick={(e) => e.stopPropagation()}
      >
        <style>{`@keyframes auditShareEnter { from { transform: scale(0.96); opacity: 0 } to { transform: scale(1); opacity: 1 } }`}</style>

        <div className="flex items-center justify-between p-5 border-b border-[var(--border-card)]">
          <div className="flex items-center gap-2">
            <Share2 className="w-4 h-4 text-accent" />
            <h2 className="text-sm font-semibold t-primary">Share evidence pack with an auditor</h2>
          </div>
          <button
            onClick={close}
            className="t-muted hover:t-primary transition-colors active:scale-[0.96]"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {freshToken && shareUrl ? (
            <div className="space-y-3">
              <div className="text-caption t-muted">
                Send this URL to your auditor. <span className="t-primary font-medium">It is shown only once.</span>
                {freshToken.label ? ` Label: ${freshToken.label}.` : ''}
                {' '}Expires {new Date(freshToken.expires_at).toLocaleString()}.
              </div>
              <div className="flex items-stretch gap-2">
                <div className="flex-1 px-3 py-2 rounded-lg border bg-[var(--bg-secondary)] border-[var(--border-card)] font-mono text-xs t-primary break-all">
                  {shareUrl}
                </div>
                <Button onClick={copy} variant={copied ? 'ghost' : 'primary'} size="sm">
                  {copied ? <Check size={14} className="mr-2" /> : <Copy size={14} className="mr-2" />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <div className="text-caption t-muted">
                The auditor opens the link in a browser — no login required. We log every access (IP + timestamp).
                You can revoke from the list below at any time.
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <label className="block">
                <span className="text-label">Label (optional)</span>
                <input
                  type="text"
                  value={label}
                  onChange={(e) => setLabel(e.target.value.slice(0, 120))}
                  placeholder="e.g. PwC Q2 review, Deloitte SOC 2 evidence"
                  className="mt-1 w-full px-3 py-2 rounded-lg border bg-[var(--bg-secondary)] border-[var(--border-card)] t-primary text-sm focus:outline-none focus:border-accent transition-colors"
                />
              </label>
              <Button onClick={createLink} variant="primary" size="sm" disabled={creating}>
                <LinkIcon size={14} className="mr-2" />
                {creating ? 'Generating…' : 'Generate 7-day link'}
              </Button>
            </div>
          )}

          <div className="pt-2">
            <div className="text-label mb-2">Recent links</div>
            {loading && <div className="text-caption t-muted">Loading…</div>}
            {!loading && links && links.length === 0 && (
              <div className="text-caption t-muted">No links yet.</div>
            )}
            {!loading && links && links.length > 0 && (
              <div className="space-y-2 max-h-64 overflow-y-auto">
                {links.map((lk) => {
                  const expires = new Date(lk.expires_at);
                  const accessedLabel = lk.last_accessed_at
                    ? `Accessed ${lk.access_count}× · last ${new Date(lk.last_accessed_at).toLocaleString()}`
                    : 'Not yet accessed';
                  return (
                    <div
                      key={lk.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg border bg-[var(--bg-secondary)] border-[var(--border-card)]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm t-primary truncate">
                            {lk.label || <span className="t-muted italic">Unlabeled</span>}
                          </span>
                          <Badge
                            variant={lk.status === 'active' ? 'success' : lk.status === 'expired' ? 'warning' : 'info'}
                            size="sm"
                          >
                            {lk.status}
                          </Badge>
                        </div>
                        <div className="text-caption t-muted truncate">
                          Expires {expires.toLocaleDateString()} · {accessedLabel}
                        </div>
                      </div>
                      {lk.status === 'active' && (
                        <button
                          onClick={() => revoke(lk.id)}
                          className="px-2 py-1 rounded-md text-xs t-muted hover:t-primary hover:bg-[var(--bg-tertiary)] transition-colors active:scale-[0.96]"
                          aria-label="Revoke link"
                        >
                          <Trash2 size={12} className="inline mr-1" />
                          Revoke
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="px-5 py-3 border-t border-[var(--border-card)] flex justify-end">
          <Button onClick={close} variant="ghost" size="sm">Close</Button>
        </div>
      </div>
    </div>
  );
}

export default CompliancePage;
