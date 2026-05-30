/**
 * /legal/connectors — public connector conformance matrix (Phase BB).
 *
 * Procurement-direct artifact: CIOs ask "do you support SAP S/4HANA?
 * Workday? Coupa?" — having one URL to send is a measurable cycle
 * shortener. This page lists every connector we ship, what level of
 * conformance it has reached, and a short rationale so a vendor-risk
 * team can pattern-match against their own roadmap honestly.
 *
 * Conformance levels (carried over from the internal phase-gate model):
 *   - GA    — production-grade, multiple live tenants, OAuth2/token
 *             refresh tested, write-back error paths exercised
 *   - Beta  — real REST/SOAP integration implemented; awaiting a live
 *             customer tenant for full conformance certification
 *   - Preview — stub-only or read-only today; production write-back
 *             ships as a fast-follow once the integration is engaged
 *   - On request — not yet built; engineering scoped at engagement
 *
 * Honesty first: nothing on this page is overclaimed. Procurement
 * notices and remembers when a vendor says "supported" and means
 * "we have a stub file."
 */
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { PageHeader } from '@/components/ui/page-header';
import {
  Plug, ArrowLeft, Mail, ExternalLink, CheckCircle2, Circle,
} from 'lucide-react';

type ConformanceLevel = 'GA' | 'Beta' | 'Preview' | 'On request';

interface Connector {
  vendor: string;
  product: string;
  category: 'ERP' | 'HCM' | 'CRM' | 'Accounting' | 'Procurement' | 'Custom';
  protocol: string;
  read: boolean;
  writeBack: boolean;
  level: ConformanceLevel;
  notes: string;
}

const CONNECTORS: Connector[] = [
  // Enterprise ERPs
  { vendor: 'SAP', product: 'S/4HANA (Cloud + On-prem)', category: 'ERP', protocol: 'OData v4 + CSRF', read: true, writeBack: true, level: 'Beta', notes: 'OAuth2 + CSRF token-fetch implemented. AR / AP / GL write-back live.' },
  { vendor: 'Oracle', product: 'Fusion Cloud ERP', category: 'ERP', protocol: 'REST + Basic Auth', read: true, writeBack: true, level: 'Beta', notes: 'Journal, AR, AP write-back via Fusion REST. Multi-org supported.' },
  { vendor: 'Microsoft', product: 'Dynamics 365 Finance', category: 'ERP', protocol: 'OData v4 + Azure AD', read: true, writeBack: true, level: 'Beta', notes: 'Azure AD OAuth2; standard D365 entity model.' },
  { vendor: 'Oracle', product: 'NetSuite (SuiteTalk REST)', category: 'ERP', protocol: 'REST + TBA', read: true, writeBack: true, level: 'Beta', notes: 'Token-Based Authentication; transactions + saved searches.' },
  { vendor: 'Workday', product: 'Financial Management', category: 'HCM', protocol: 'REST + OAuth2 ISU', read: true, writeBack: true, level: 'Beta', notes: 'HCM-first; financial actions limited to journal post, AP, customer credit.' },
  { vendor: 'Sage', product: 'Intacct (XML + REST)', category: 'Accounting', protocol: 'REST + Session Key', read: true, writeBack: true, level: 'Beta', notes: 'Session-key auth + Intacct API v3.' },
  { vendor: 'Sage', product: 'X3 / 200 Evolution', category: 'ERP', protocol: 'REST + API Key', read: true, writeBack: true, level: 'Beta', notes: 'Sage X3 entities + Sage Evolution feed.' },
  { vendor: 'Odoo', product: '15 / 16 / 17 Community + Enterprise', category: 'ERP', protocol: 'JSON-RPC', read: true, writeBack: true, level: 'Beta', notes: 'Native JSON-RPC; account.move + account.payment models.' },

  // GA SMB stack — most tested
  { vendor: 'Xero', product: 'Accounting', category: 'Accounting', protocol: 'OAuth2 + REST', read: true, writeBack: true, level: 'GA', notes: 'Live across multiple tenants. Invoices, bills, payments, contacts.' },
  { vendor: 'Intuit', product: 'QuickBooks Online', category: 'Accounting', protocol: 'OAuth2 + REST', read: true, writeBack: true, level: 'GA', notes: 'Live across multiple tenants. AR/AP + journal entries.' },

  // CRM (CRM-side ERP signal; not full ERP)
  { vendor: 'Salesforce', product: 'Sales Cloud / Service Cloud', category: 'CRM', protocol: 'REST + SOQL', read: true, writeBack: true, level: 'Beta', notes: 'Used as CRM-side signal source; full revenue-recognition write-back is on roadmap.' },

  // Preview / stub
  { vendor: 'Sage', product: '50cloud / Pastel', category: 'Accounting', protocol: 'CSV + SOAP', read: true, writeBack: false, level: 'Preview', notes: 'Read-only via export pipeline today; write-back via API on request.' },

  // Custom path
  { vendor: 'Atheon', product: 'Generic Webhook + CSV', category: 'Custom', protocol: 'Webhook / CSV / SFTP', read: true, writeBack: false, level: 'Preview', notes: 'Catch-all for legacy systems without modern APIs.' },

  // Procurement (commonly asked, honest "not yet")
  { vendor: 'Coupa', product: 'Spend Management', category: 'Procurement', protocol: 'REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement — typical 4–6 weeks to GA.' },
  { vendor: 'SAP', product: 'Ariba Procurement', category: 'Procurement', protocol: 'cXML + REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement — typical 6–10 weeks given cXML envelope work.' },
  { vendor: 'Jaggaer', product: 'Sourcing & Procurement', category: 'Procurement', protocol: 'REST', read: false, writeBack: false, level: 'On request', notes: 'Scoped at engagement.' },
];

// Conformance level visual tokens — Swiss two-tier palette only
const LEVEL_TONE: Record<ConformanceLevel, { bg: string; border: string; textStyle: React.CSSProperties }> = {
  GA:           { bg: 'rgb(var(--accent-rgb) / 0.12)',  border: 'rgb(var(--accent-rgb) / 0.40)',  textStyle: { color: 'var(--accent)' } },
  Beta:         { bg: 'rgb(var(--info-rgb, 100 140 180) / 0.12)', border: 'rgb(var(--info-rgb, 100 140 180) / 0.40)', textStyle: { color: 'var(--info)' } },
  Preview:      { bg: 'rgb(var(--warning-rgb, 180 130 60) / 0.12)',  border: 'rgb(var(--warning-rgb, 180 130 60) / 0.40)',  textStyle: { color: 'var(--warning)' } },
  'On request': { bg: 'rgba(160, 160, 180, 0.10)', border: 'rgba(160, 160, 180, 0.30)', textStyle: {} },
};

function LevelBadge({ level }: { level: ConformanceLevel }) {
  const tone = LEVEL_TONE[level];
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-full text-caption font-medium${level === 'On request' ? ' t-muted' : ''}`}
      style={{ background: tone.bg, border: `1px solid ${tone.border}`, ...tone.textStyle }}
    >
      {level}
    </span>
  );
}

export default function ConnectorsPage(): JSX.Element {
  const counts = CONNECTORS.reduce<Record<ConformanceLevel, number>>((acc, c) => {
    acc[c.level] = (acc[c.level] ?? 0) + 1;
    return acc;
  }, { GA: 0, Beta: 0, Preview: 0, 'On request': 0 });

  return (
    <div className="min-h-screen" style={{ background: 'var(--bg-primary)' }}>
      <div className="p-6 max-w-6xl mx-auto space-y-6">
        <div className="flex items-center gap-3 flex-wrap">
          <Link to="/" className="t-muted hover:t-primary text-caption inline-flex items-center gap-1"><ArrowLeft size={12} /> Home</Link>
          <span className="t-muted text-caption">·</span>
          <Link to="/legal/security" className="t-muted hover:t-primary text-caption">Security &amp; Privacy</Link>
          <span className="t-muted text-caption">·</span>
        </div>

        <PageHeader
          eyebrow="Connectors · Catalog"
          title="Connector Matrix"
          dek="Honest conformance levels for every ERP / HCM / Accounting / CRM / Procurement connector Atheon ships."
        />

        <Card className="p-5" style={{ background: 'rgba(163, 177, 138, 0.06)', borderColor: 'rgba(163, 177, 138, 0.30)' }}>
          <div className="flex items-start gap-3">
            <Plug className="text-accent flex-shrink-0 mt-0.5" size={20} />
            <div>
              <h2 className="text-headline-md font-bold t-primary mb-1">Where Atheon plugs in</h2>
              <p className="text-body-sm t-secondary">
                Procurement teams: this is the page to bookmark when
                your CIO asks "does Atheon support [system]?".
              </p>
              <div className="flex items-center gap-3 mt-3 flex-wrap text-caption">
                <span className="t-muted">Inventory:</span>
                <span><strong className="tabular-nums font-mono" style={{ color: 'var(--accent)' }}>{counts.GA}</strong> GA</span>
                <span className="t-muted">·</span>
                <span><strong className="tabular-nums font-mono" style={{ color: 'var(--info)' }}>{counts.Beta}</strong> Beta</span>
                <span className="t-muted">·</span>
                <span><strong className="tabular-nums font-mono" style={{ color: 'var(--warning)' }}>{counts.Preview}</strong> Preview</span>
                <span className="t-muted">·</span>
                <span><strong className="t-muted tabular-nums font-mono">{counts['On request']}</strong> On request</span>
              </div>
            </div>
          </div>
        </Card>

        {/* Conformance-level legend */}
        <Card className="p-4">
          <h3 className="text-caption uppercase tracking-wider t-muted font-medium mb-2">Conformance levels</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-body-sm">
            <div className="flex items-start gap-2">
              <LevelBadge level="GA" />
              <span className="t-secondary">Production-grade, multiple live tenants, OAuth2/token refresh tested, write-back error paths exercised.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="Beta" />
              <span className="t-secondary">Real REST/SOAP integration implemented; awaiting a live customer tenant for full certification.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="Preview" />
              <span className="t-secondary">Stub-only or read-only today; production write-back ships as a fast-follow.</span>
            </div>
            <div className="flex items-start gap-2">
              <LevelBadge level="On request" />
              <span className="t-secondary">Not yet built; engineering scoped at engagement with a typical timeline noted in the row.</span>
            </div>
          </div>
        </Card>

        {/* Matrix */}
        <Card className="p-0 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="text-caption uppercase tracking-wider t-muted">
                <tr className="border-b border-[var(--border-card)]">
                  <th className="text-left px-4 py-3 font-medium">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium">Product</th>
                  <th className="text-left px-4 py-3 font-medium">Category</th>
                  <th className="text-left px-4 py-3 font-medium">Protocol</th>
                  <th className="text-center px-4 py-3 font-medium">Read</th>
                  <th className="text-center px-4 py-3 font-medium">Write-back</th>
                  <th className="text-left px-4 py-3 font-medium">Level</th>
                  <th className="text-left px-4 py-3 font-medium">Notes</th>
                </tr>
              </thead>
              <tbody>
                {CONNECTORS.map((c, i) => (
                  <tr key={i} className="border-b border-[var(--border-card)] last:border-0">
                    <td className="px-4 py-3 t-primary font-medium">{c.vendor}</td>
                    <td className="px-4 py-3 t-primary">{c.product}</td>
                    <td className="px-4 py-3 t-muted">
                      <Badge variant="default" size="sm">{c.category}</Badge>
                    </td>
                    <td className="px-4 py-3 t-secondary font-mono text-caption">{c.protocol}</td>
                    <td className="px-4 py-3 text-center">
                      {c.read ? <CheckCircle2 size={14} className="inline" style={{ color: 'var(--accent)' }} /> : <Circle size={14} className="inline t-muted opacity-30" />}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {c.writeBack ? <CheckCircle2 size={14} className="inline" style={{ color: 'var(--accent)' }} /> : <Circle size={14} className="inline t-muted opacity-30" />}
                    </td>
                    <td className="px-4 py-3"><LevelBadge level={c.level} /></td>
                    <td className="px-4 py-3 t-secondary text-caption max-w-md">{c.notes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {/* Engagement path */}
        <Card className="p-5">
          <h3 className="text-body font-semibold t-primary mb-2">Not on the list?</h3>
          <p className="text-body-sm t-secondary mb-3">
            New connectors go through a standard build-out:{' '}
            <strong className="t-primary">discover</strong> (2–3 days API-doc review) →{' '}
            <strong className="t-primary">read-side adapter</strong> (1 week) →{' '}
            <strong className="t-primary">write-back adapter</strong> (1–2 weeks) →{' '}
            <strong className="t-primary">live-tenant certification</strong> (1 week). The
            shared-savings model means you only pay once a connector starts recovering Rand —
            engineering risk sits with us, not you.
          </p>
          <div className="flex items-center gap-3 flex-wrap text-body-sm">
            <a href="mailto:partnerships@vantax.co.za" className="text-accent hover:underline inline-flex items-center gap-1">
              <Mail size={12} /> Scope a new connector
            </a>
            <span className="t-muted">·</span>
            <a href="https://atheon-api.vantax.co.za/api/v1/openapi.json" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline inline-flex items-center gap-1">
              OpenAPI spec <ExternalLink size={12} />
            </a>
          </div>
        </Card>

        <div className="text-caption t-muted text-center pt-2">
          Updated alongside the Atheon platform release notes. Material additions are documented
          in the changelog and announced 30 days before any deprecation.
        </div>
      </div>
    </div>
  );
}
