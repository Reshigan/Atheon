/**
 * /legal/security — public security overview + sub-processor list + DPA.
 *
 * Phase BA procurement gate: every 3000+ headcount enterprise's security
 * questionnaire (CAIQ, SIG-Lite, etc.) has these checkboxes — sub-processor
 * disclosure, DPA availability, encryption posture, data-residency map.
 * Surfacing this PUBLICLY shortens the procurement cycle materially because
 * the vendor-risk team can answer 60% of their checklist without a meeting.
 *
 * What's on this page:
 *   1. Security overview — high-level posture (encryption, MFA, RBAC, etc.)
 *   2. Sub-processor list — every third party that touches customer data
 *   3. Data residency map — where physically data is stored at rest
 *   4. Compliance frameworks claimed + evidence-pack pointer
 *   5. DPA / DPIA contact — how to get the legal docs for signing
 *   6. Incident disclosure SLA — when affected customers will be notified
 *
 * Public — no auth, no role gating. Intentionally crawler-friendly so a
 * procurement team can search-engine for it.
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { PageHeader } from '@/components/ui/page-header';
import {
  Shield, Lock, KeyRound, MapPin, FileText, Mail, Activity,
  CheckCircle2, ArrowLeft, ExternalLink,
} from 'lucide-react';

const SUBPROCESSORS = [
  { name: 'Cloudflare, Inc.', purpose: 'Compute (Workers), durable storage (D1, R2, KV), edge networking', region: 'Global edge + af-south-1 (JNB) origin', dpUrl: 'https://www.cloudflare.com/cloudflare-customer-dpa/' },
  { name: 'Anthropic PBC', purpose: 'LLM inference for Mind / chat / catalyst reasoning (configurable, can be disabled per tenant)', region: 'US-East', dpUrl: 'https://www.anthropic.com/legal/dpa' },
  { name: 'Microsoft Corporation', purpose: 'Optional Azure AD SSO + Microsoft Graph email (only if tenant enables)', region: 'EU / customer-selected', dpUrl: 'https://www.microsoft.com/licensing/docs/view/Microsoft-Products-and-Services-Data-Protection-Addendum-DPA' },
  { name: 'WorkOS, Inc.', purpose: 'SAML federation broker for enterprise SSO (only if tenant enables)', region: 'US', dpUrl: 'https://workos.com/legal/dpa' },
  { name: 'Stripe, Inc.', purpose: 'Payments processing (subscription billing only — no payment data persisted by Atheon)', region: 'Global', dpUrl: 'https://stripe.com/legal/dpa' },
];

const POSTURE = [
  { icon: Lock, title: 'Encryption in transit', detail: 'TLS 1.2+ on every endpoint. HSTS enforced. Inter-service traffic in private Cloudflare backbone.' },
  { icon: Lock, title: 'Encryption at rest', detail: 'D1 storage encrypted by Cloudflare. R2 objects encrypted server-side. Customer-managed keys (BYOK) available on the Enterprise plan.' },
  { icon: KeyRound, title: 'Identity', detail: 'SAML 2.0 (via WorkOS) + OIDC (Azure AD). SCIM 2.0 provisioning. MFA enforced for admin roles with grace-period tracking.' },
  { icon: Shield, title: 'Access control', detail: '10 built-in roles incl. scoped auditor + board_member. Custom roles. Tenant isolation enforced at the query layer; every D1 query is tenant-id-bound.' },
  { icon: FileText, title: 'Audit trail', detail: 'Cryptographically-chained provenance ledger (SHA-256 root hash, hourly anchor). Append-only audit_log. Verifiable via /api/audit/provenance/verify.' },
  { icon: Activity, title: 'Monitoring', detail: 'Public /status page with 30-second polling. Hourly D1 snapshots, 30-day retention. RTO ≤ 4h, RPO ≤ 1h.' },
];

const FRAMEWORKS = [
  { name: 'SOC 2 Type II', status: 'Controls implemented · evidence pack live on /compliance for Auditor role', certified: true },
  { name: 'POPIA (South Africa)', status: 'DSAR endpoints live · 30-day response SLA', certified: true },
  { name: 'GDPR (EU)', status: 'DSAR + erasure endpoints · Art. 28 DPA available on request', certified: true },
  { name: 'ISO 27001', status: 'Gap assessment in progress — Q3 2026 target', certified: false },
];

export default function SecurityPage(): JSX.Element {
  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 max-w-5xl mx-auto space-y-6">
        <div className="flex items-center gap-3 flex-wrap mb-2">
          <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
        </div>

        <PageHeader
          eyebrow="Platform · Security"
          title="Security &amp; Privacy"
          dek="Enterprise procurement summary — posture, sub-processors, compliance claims, and DPA contact."
        />

        <Card className="p-6" style={{ background: 'rgb(var(--accent-rgb) / 0.06)', borderColor: 'rgb(var(--accent-rgb) / 0.25)' }}>
          <div className="flex items-start gap-3">
            <Shield className="text-accent flex-shrink-0 mt-0.5" size={22} />
            <div>
              <h2 className="text-headline-md font-bold t-primary mb-2">Built for enterprise procurement</h2>
              <p className="text-body-sm t-secondary">
                Atheon processes ERP-grade financial data, so security is the floor — not a feature.
                This page is the public-facing summary of our posture, sub-processors, and compliance
                claims. For the full evidence pack, a Data Processing Agreement, or a security
                questionnaire response (CAIQ / SIG / vendor-specific), contact{' '}
                <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a>.
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <Link to="/status" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                  Platform status <ExternalLink size={11} />
                </Link>
                <span className="t-muted text-caption">·</span>
                <Link to="/legal/connectors" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                  Connector matrix <ExternalLink size={11} />
                </Link>
                <span className="t-muted text-caption">·</span>
                <Link to="/legal/performance" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                  Performance <ExternalLink size={11} />
                </Link>
                <span className="t-muted text-caption">·</span>
                <a href="mailto:dpa@vantax.co.za" className="text-caption text-accent hover:underline inline-flex items-center gap-1">
                  Request DPA template <Mail size={11} />
                </a>
              </div>
            </div>
          </div>
        </Card>

        {/* Security posture grid */}
        <section>
          <h3 className="text-body font-semibold t-primary mb-3">Security posture</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {POSTURE.map((p) => {
              const Icon = p.icon;
              return (
                <Card key={p.title} className="p-4">
                  <div className="flex items-start gap-3">
                    <Icon size={16} className="text-accent flex-shrink-0 mt-0.5" />
                    <div>
                      <h4 className="text-body-sm font-medium t-primary">{p.title}</h4>
                      <p className="text-caption t-secondary mt-1">{p.detail}</p>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </section>

        {/* Compliance frameworks */}
        <section>
          <h3 className="text-body font-semibold t-primary mb-3">Compliance &amp; certifications</h3>
          <Card className="p-0 overflow-hidden">
            <table className="w-full text-body-sm">
              <thead className="text-caption uppercase tracking-wider t-muted">
                <tr className="border-b border-[var(--border-card)]">
                  <th className="text-left px-4 py-3 font-medium">Framework</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {FRAMEWORKS.map((f) => (
                  <tr key={f.name} className="border-b border-[var(--border-card)] last:border-0">
                    <td className="px-4 py-3 t-primary font-medium">{f.name}</td>
                    <td className="px-4 py-3 t-secondary">
                      <span className="inline-flex items-center gap-2">
                        <span className={f.certified ? 'text-accent' : 't-muted'}>{f.certified ? '✓' : '◐'}</span>
                        {f.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>

        {/* Sub-processor list — required for GDPR Art. 28 + most enterprise procurement */}
        <section>
          <h3 className="text-body font-semibold t-primary mb-1">Sub-processors</h3>
          <p className="text-caption t-muted mb-3">
            Third parties that may process customer data. Optional sub-processors only apply when the
            relevant tenant feature is enabled. Material changes are disclosed 30 days in advance.
          </p>
          <Card className="p-0 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead className="text-caption uppercase tracking-wider t-muted">
                  <tr className="border-b border-[var(--border-card)]">
                    <th className="text-left px-4 py-3 font-medium">Sub-processor</th>
                    <th className="text-left px-4 py-3 font-medium">Purpose</th>
                    <th className="text-left px-4 py-3 font-medium">Region</th>
                    <th className="text-left px-4 py-3 font-medium">DPA</th>
                  </tr>
                </thead>
                <tbody>
                  {SUBPROCESSORS.map((s) => (
                    <tr key={s.name} className="border-b border-[var(--border-card)] last:border-0">
                      <td className="px-4 py-3 t-primary font-medium">{s.name}</td>
                      <td className="px-4 py-3 t-secondary">{s.purpose}</td>
                      <td className="px-4 py-3 t-muted">{s.region}</td>
                      <td className="px-4 py-3">
                        <a href={s.dpUrl} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1 text-caption">
                          View <ExternalLink size={10} />
                        </a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>

        {/* Data residency */}
        <section>
          <h3 className="text-body font-semibold t-primary mb-3">Data residency</h3>
          <Card className="p-5">
            <div className="flex items-start gap-3 mb-3">
              <MapPin size={16} className="text-accent flex-shrink-0 mt-0.5" />
              <p className="text-body-sm t-secondary">
                Customer durable state (D1 database, R2 object storage) is pinned to{' '}
                <strong className="t-primary">af-south-1 (Johannesburg)</strong> by default.
                Cloudflare Workers compute runs at the closest global edge for the requesting user.
                Inference traffic to Anthropic (when enabled) routes via US-East.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-body-sm">
              <div className="p-3 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-caption uppercase tracking-wider t-muted mb-1">Primary region</div>
                <div className="t-primary font-medium">af-south-1 (Johannesburg)</div>
              </div>
              <div className="p-3 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-caption uppercase tracking-wider t-muted mb-1">Compute</div>
                <div className="t-primary font-medium">Cloudflare global edge</div>
              </div>
              <div className="p-3 rounded-md" style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border-card)' }}>
                <div className="text-caption uppercase tracking-wider t-muted mb-1">Backups</div>
                <div className="t-primary font-medium">Hourly · 30-day retention</div>
              </div>
            </div>
            <p className="text-caption t-muted mt-3">
              EU / US / APAC residency available on the Enterprise plan via dedicated D1 instances.
              Contact <a href="mailto:enterprise@vantax.co.za" className="text-accent hover:underline">enterprise@vantax.co.za</a> for regional placement.
            </p>
          </Card>
        </section>

        {/* Incident-disclosure SLA */}
        <section>
          <h3 className="text-body font-semibold t-primary mb-3">Incident disclosure</h3>
          <Card className="p-5">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-body-sm">
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-caption uppercase tracking-wider t-muted">Confirmed breach</div>
                  <div className="t-primary font-medium">Notify affected customers within <strong>24 hours</strong></div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-caption uppercase tracking-wider t-muted">Service outage</div>
                  <div className="t-primary font-medium">Public banner on <Link to="/status" className="text-accent hover:underline">/status</Link> within <strong>15 minutes</strong></div>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <CheckCircle2 size={14} className="text-accent flex-shrink-0 mt-0.5" />
                <div>
                  <div className="text-caption uppercase tracking-wider t-muted">Post-incident review</div>
                  <div className="t-primary font-medium">RCA published within <strong>5 business days</strong></div>
                </div>
              </div>
            </div>
          </Card>
        </section>

        {/* Contact */}
        <Card className="p-5">
          <h3 className="text-body font-semibold t-primary mb-2">Contact</h3>
          <div className="space-y-1 text-body-sm">
            <div><Mail size={12} className="inline mr-1.5 t-muted" /> Security questions / vendor-risk: <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a></div>
            <div><Mail size={12} className="inline mr-1.5 t-muted" /> DPA / privacy: <a href="mailto:dpa@vantax.co.za" className="text-accent hover:underline">dpa@vantax.co.za</a></div>
            <div><Mail size={12} className="inline mr-1.5 t-muted" /> Vulnerability disclosure: <a href="mailto:security@vantax.co.za" className="text-accent hover:underline">security@vantax.co.za</a> (responsible disclosure honoured; no bug-bounty programme yet)</div>
          </div>
        </Card>

        <div className="text-caption t-muted text-center pt-2">
          This page is informational and does not constitute a contract. Material terms are in the
          Master Service Agreement and Data Processing Agreement provided at the start of each engagement.
        </div>
      </div>
    </div>
  );
}
