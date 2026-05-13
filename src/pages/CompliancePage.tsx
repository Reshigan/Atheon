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
} from "lucide-react";
import { api, ApiError } from "@/lib/api";
import { useAppStore } from "@/stores/appStore";
import { useToast } from "@/components/ui/toast";
import { AuditPage } from "./AuditPage";
import { DataGovernancePage } from "./DataGovernancePage";

type EvidencePack = Awaited<ReturnType<typeof api.compliance.evidencePack>>;

function StatChip({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' | 'neutral' }) {
  const colors: Record<string, string> = {
    good: 'text-emerald-400',
    warn: 'text-amber-400',
    bad: 'text-red-400',
    neutral: 't-primary',
  };
  return (
    <div className="p-3 rounded-md bg-[var(--bg-secondary)] border border-[var(--border-card)]">
      <div className="text-label mb-1">{label}</div>
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

  async function load() {
    try {
      const p = await api.compliance.evidencePack(activeTenantId || undefined);
      setPack(p);
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
          <Button onClick={downloadJson} variant="primary" size="sm">
            <Download size={14} className="mr-2" />
            Download JSON
          </Button>
        </div>
      </div>

      {/* Access reviews */}
      <Card className="p-5">
        <div className="flex items-center gap-2 mb-3">
          <ShieldCheck className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold t-primary">Access reviews</h2>
          <Badge variant="info" size="sm">SOC 2 CC6.1, CC6.2</Badge>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatChip label="Active admins" value={pack.accessReviews.activeAdminCount} />
          <StatChip label="Active users" value={pack.accessReviews.activeUserCount} />
          <StatChip label="Admins assigned (90d)" value={pack.accessReviews.adminsAssignedLast90d} />
          <StatChip label="Role changes (90d)" value={pack.accessReviews.roleChangesLast90d} />
          <StatChip label="MFA-enabled users" value={pack.accessReviews.mfaEnabledCount} />
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
          <StatChip label="Total active users" value={pack.mfa.totalUsers} />
          <StatChip label="MFA enabled" value={pack.mfa.mfaEnabled} />
          <StatChip label="Coverage %" value={`${pack.mfa.mfaCoveragePct}%`} tone={mfaTone} />
          <StatChip label="Admins in grace" value={pack.mfa.adminsInGracePeriod} tone={pack.mfa.adminsInGracePeriod > 0 ? 'warn' : 'good'} />
          <StatChip label="Admins expired grace" value={pack.mfa.adminsExpiredGrace} tone={expiredGraceTone} />
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

export default CompliancePage;
