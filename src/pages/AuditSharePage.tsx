/**
 * /audit-share/:token — public, read-only SOC 2 evidence pack.
 *
 * No login. The token in the URL is the credential. Mounted outside the
 * AppLayout so it has its own header / footer and looks like a clean
 * auditor-facing report rather than a leaked operational page.
 *
 * Backed by GET /api/v1/audit-share/:token. The backend logs every access
 * (IP + timestamp + count) so the issuing admin can see who opened the
 * link, and revoke it from /compliance at any time.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '@/lib/api';
import {
  ShieldCheck, KeyRound, ClipboardList, AlertTriangle,
  UserMinus, Lock, FileArchive, Clock,
} from 'lucide-react';

type EvidencePack = Awaited<ReturnType<typeof api.compliance.evidencePack>>;
interface SharePayload {
  label: string | null;
  expires_at: string;
  pack: EvidencePack;
}

function StatCell({ label, value, tone }: { label: string; value: string | number; tone?: 'good' | 'warn' | 'bad' }) {
  const colorMap: Record<string, string> = {
    good: '#10b981',
    warn: '#f59e0b',
    bad: '#ef4444',
  };
  const color = tone ? colorMap[tone] : '#0f172a';
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 10,
      border: '1px solid #e5e7eb',
      background: '#ffffff',
    }}>
      <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.6, color: '#64748b' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 600, color, fontVariantNumeric: 'tabular-nums', marginTop: 4 }}>{value}</div>
    </div>
  );
}

function Section({ icon: Icon, title, code, children }: {
  icon: typeof ShieldCheck;
  title: string;
  code: string;
  children: React.ReactNode;
}) {
  return (
    <section style={{
      padding: 24,
      borderRadius: 14,
      border: '1px solid #e5e7eb',
      background: '#ffffff',
      boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
        <Icon width={16} height={16} color="#0f4d3a" />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#0f172a' }}>{title}</h2>
        <span style={{
          marginLeft: 'auto',
          fontSize: 10,
          color: '#475569',
          padding: '3px 8px',
          background: '#f1f5f9',
          borderRadius: 999,
          letterSpacing: 0.4,
        }}>{code}</span>
      </div>
      {children}
    </section>
  );
}

export default function AuditSharePage(): JSX.Element {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<SharePayload | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);

  useEffect(() => {
    if (!token) {
      setError({ status: 404, message: 'No token in URL' });
      return;
    }
    api.auditShare.fetchPack(token)
      .then((r) => setData(r as SharePayload))
      .catch((err) => {
        const status = err instanceof ApiError ? err.status : 500;
        const message = err instanceof Error ? err.message : 'Unknown error';
        setError({ status, message });
      });
  }, [token]);

  const bgStyle: React.CSSProperties = {
    minHeight: '100vh',
    background: 'radial-gradient(1100px 700px at 25% -10%, rgba(15, 77, 58, 0.06), transparent 60%), #f8fafc',
    fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    color: '#0f172a',
  };

  if (error) {
    return (
      <div style={bgStyle}>
        <div style={{ maxWidth: 560, margin: '120px auto', padding: 32, textAlign: 'center' }}>
          <div style={{ fontSize: 56, marginBottom: 8 }}>🔒</div>
          <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
            {error.status === 410 ? 'This link is no longer valid.' :
             error.status === 404 ? 'Link not found.' :
             'Something went wrong.'}
          </h1>
          <p style={{ color: '#475569', fontSize: 14, marginTop: 10 }}>
            {error.status === 410
              ? 'It may have been revoked or have expired. Ask the issuer for a new one.'
              : error.status === 404
                ? 'The URL is incomplete or has been mistyped. Check that the token in the URL exactly matches the one you were sent.'
                : 'We could not load the evidence pack. The server reported: ' + error.message}
          </p>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div style={bgStyle}>
        <div style={{ maxWidth: 560, margin: '160px auto', textAlign: 'center', color: '#64748b' }}>
          <div style={{
            width: 18, height: 18, border: '2px solid #cbd5e1', borderTopColor: '#0f4d3a',
            borderRadius: '50%', margin: '0 auto 12px', animation: 'aspin 800ms linear infinite',
          }} />
          <style>{`@keyframes aspin { to { transform: rotate(360deg) } }`}</style>
          Loading evidence pack…
        </div>
      </div>
    );
  }

  const { pack, label, expires_at } = data;
  const mfaTone = pack.mfa.mfaCoveragePct >= 90 ? 'good' : pack.mfa.mfaCoveragePct >= 70 ? 'warn' : 'bad';
  const incidentTone = pack.incidentResponse.openCritical > 0 ? 'bad' : 'good';
  const plaintextTone = pack.encryption.erpPlaintext > 0 ? 'warn' : 'good';
  const expiresIn = Math.max(0, Math.round((new Date(expires_at).getTime() - Date.now()) / 86400000));

  function downloadJson() {
    const blob = new Blob([JSON.stringify(pack, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atheon-soc2-evidence-${pack.generatedAt.slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <div style={bgStyle}>
      <div style={{ maxWidth: 960, margin: '0 auto', padding: '48px 24px 64px' }}>
        {/* Brand strip + label */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 8,
              background: 'linear-gradient(135deg, #0f4d3a, #1a7556)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#fff', fontWeight: 700, fontSize: 16,
            }}>A</div>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#0f172a' }}>Atheon</div>
              <div style={{ fontSize: 11, color: '#64748b' }}>SOC 2 Evidence — Auditor View</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#64748b' }}>
            <Clock size={12} />
            Expires in {expiresIn} day{expiresIn === 1 ? '' : 's'}
          </div>
        </div>

        {/* Hero */}
        <div style={{ marginBottom: 24 }}>
          <h1 style={{
            fontSize: 32, fontWeight: 700, color: '#0f172a', margin: 0,
            letterSpacing: -0.5,
          }}>
            Evidence Pack
          </h1>
          {label && (
            <div style={{ marginTop: 6, fontSize: 13, color: '#64748b' }}>
              Shared as <strong style={{ color: '#0f172a' }}>{label}</strong>
            </div>
          )}
          <div style={{ marginTop: 6, fontSize: 12, color: '#94a3b8' }}>
            Generated {new Date(pack.generatedAt).toLocaleString()} · Read-only · Aggregated over existing tables
          </div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 18 }}>
          <Section icon={ShieldCheck} title="Access reviews" code="SOC 2 CC6.1, CC6.2">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="Active admins" value={pack.accessReviews.activeAdminCount} />
              <StatCell label="Active users" value={pack.accessReviews.activeUserCount} />
              <StatCell label="Admins assigned (90d)" value={pack.accessReviews.adminsAssignedLast90d} />
              <StatCell label="Role changes (90d)" value={pack.accessReviews.roleChangesLast90d} />
            </div>
          </Section>

          <Section icon={KeyRound} title="MFA posture" code="SOC 2 CC6.6">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="MFA coverage" value={`${pack.mfa.mfaCoveragePct}%`} tone={mfaTone} />
              <StatCell label="MFA enabled" value={pack.mfa.mfaEnabled} />
              <StatCell label="Total users" value={pack.mfa.totalUsers} />
              <StatCell label="Admins in grace" value={pack.mfa.adminsInGracePeriod} />
              <StatCell label="Expired grace" value={pack.mfa.adminsExpiredGrace} tone={pack.mfa.adminsExpiredGrace > 0 ? 'bad' : 'good'} />
            </div>
          </Section>

          <Section icon={ClipboardList} title="Configuration changes" code="SOC 2 CC8.1">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="Changes (30d)" value={pack.configChanges.changesLast30d} />
              <StatCell label="Changes (90d)" value={pack.configChanges.changesLast90d} />
            </div>
            {pack.configChanges.topActions.length > 0 && (
              <div style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>
                Top actions: {pack.configChanges.topActions.slice(0, 5).map(a => `${a.action} (${a.count})`).join(' · ')}
              </div>
            )}
          </Section>

          <Section icon={AlertTriangle} title="Incident response" code="SOC 2 CC7.3, CC7.4">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="Total critical (90d)" value={pack.incidentResponse.totalCriticalLast90d} />
              <StatCell label="Resolved critical (90d)" value={pack.incidentResponse.resolvedCriticalLast90d} />
              <StatCell label="Open critical" value={pack.incidentResponse.openCritical} tone={incidentTone} />
              <StatCell
                label="Median resolution"
                value={pack.incidentResponse.medianResolutionHours != null
                  ? `${pack.incidentResponse.medianResolutionHours}h`
                  : '—'}
              />
            </div>
          </Section>

          <Section icon={UserMinus} title="Deprovisioning" code="SOC 2 CC6.2">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="Deprovisioned (90d)" value={pack.deprovisioning.deprovisionedLast90d} />
              <StatCell label="Currently disabled" value={pack.deprovisioning.currentlyDisabled} />
              <StatCell label="Privileged disabled" value={pack.deprovisioning.privilegedDisabled} tone={pack.deprovisioning.privilegedDisabled > 0 ? 'warn' : 'good'} />
            </div>
          </Section>

          <Section icon={Lock} title="Encryption at rest" code="SOC 2 CC6.7">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="ERP encrypted" value={pack.encryption.erpEncrypted} tone="good" />
              <StatCell label="ERP plaintext" value={pack.encryption.erpPlaintext} tone={plaintextTone} />
              <StatCell label="Total connections" value={pack.encryption.totalConnections} />
            </div>
          </Section>

          <Section icon={FileArchive} title="Audit retention" code="SOC 2 CC4.1">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
              <StatCell label="Audit log rows" value={pack.auditRetention.totalRows.toLocaleString()} />
              <StatCell
                label="Oldest event"
                value={pack.auditRetention.oldestEventAt
                  ? new Date(pack.auditRetention.oldestEventAt).toLocaleDateString()
                  : '—'}
              />
              <StatCell label="Provenance chain" value={pack.auditRetention.provenanceChainLength.toLocaleString()} />
            </div>
            <div style={{ marginTop: 12, fontSize: 12, color: '#475569' }}>
              The provenance chain is a separate immutable record (Merkle + HMAC) of every AI
              decision — auditable independently of the audit log.
            </div>
          </Section>
        </div>

        <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <button
            onClick={downloadJson}
            style={{
              padding: '10px 16px',
              borderRadius: 10,
              background: '#0f4d3a',
              color: '#fff',
              border: 'none',
              cursor: 'pointer',
              fontSize: 13,
              fontWeight: 500,
              transition: 'transform 160ms cubic-bezier(0.23, 1, 0.32, 1)',
            }}
            onMouseDown={(e) => e.currentTarget.style.transform = 'scale(0.97)'}
            onMouseUp={(e) => e.currentTarget.style.transform = 'scale(1)'}
            onMouseLeave={(e) => e.currentTarget.style.transform = 'scale(1)'}
          >
            Download JSON snapshot
          </button>
          <div style={{ fontSize: 11, color: '#94a3b8' }}>
            Access logged. This link auto-expires {new Date(expires_at).toLocaleDateString()} and may be revoked at any time.
          </div>
        </div>
      </div>
    </div>
  );
}
