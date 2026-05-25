/**
 * AssessmentFindingsPanel — interactive findings view for AssessmentsPage.
 *
 * The PDF report (assessment-engine.ts::generateBusinessReportPDF) renders
 * the same set of findings in a static layout for executive-level review.
 * This component is the same data, but live in the app: a sales rep
 * walking a prospect through their own findings can sort, filter, expand
 * sample records, and click "Deploy" on any finding's recommended
 * catalyst — none of which is possible in a PDF.
 *
 * Inputs:
 *   - findings: AssessmentFinding[]   — already sorted by severity + value
 *   - findingsByCompany: per-entity breakdown for multinational engagements
 *   - summary: top-line counts + value-at-risk for the cover banner
 *   - companyProfile: drives the "Service Operations" empty-state copy
 *
 * No state in here other than expand/collapse + filter UI — the data is
 * computed server-side, so the component stays a pure renderer.
 */
import { useMemo, useState } from 'react';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import {
  AlertCircle, AlertTriangle, ChevronDown, ChevronRight,
  TrendingUp, Building2, FileText, Search,
} from 'lucide-react';
import { PeerInsightsBadge } from '@/components/PeerInsightsBadge';
import type {
  AssessmentFinding,
  AssessmentFindingSeverity,
  AssessmentFindingsSummary,
  AssessmentCompany,
} from '@/lib/api';

interface Props {
  findings: AssessmentFinding[];
  summary?: AssessmentFindingsSummary;
  findingsByCompany?: Array<{
    company: AssessmentCompany;
    findings: AssessmentFinding[];
    summary: AssessmentFindingsSummary;
  }>;
  companyProfile?: {
    profile: 'product' | 'service' | 'mixed' | 'unknown';
    product_count: number;
    project_count: number;
    time_entry_count: number;
  };
  /** Optional callback when a user clicks "Deploy" on a finding's catalyst. */
  onDeployCatalyst?: (catalyst: string, subCatalyst: string) => void;
}

const SEVERITY_LABEL: Record<AssessmentFindingSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

const SEVERITY_BAR_COLOR: Record<AssessmentFindingSeverity, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-amber-400',
  low: 'bg-teal-500',
};

const SEVERITY_RANK: Record<AssessmentFindingSeverity, number> = {
  critical: 4, high: 3, medium: 2, low: 1,
};

function formatZAR(amount: number): string {
  if (!Number.isFinite(amount)) return 'R 0';
  return `R ${Math.round(amount).toLocaleString('en-ZA')}`;
}

export function AssessmentFindingsPanel({
  findings, summary, findingsByCompany, companyProfile, onDeployCatalyst,
}: Props): JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [severityFilter, setSeverityFilter] = useState<Set<AssessmentFindingSeverity>>(
    new Set(['critical', 'high', 'medium', 'low']),
  );
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [companyFilter, setCompanyFilter] = useState<string | null>(null);

  const sourceFindings = useMemo(() => {
    if (!companyFilter) return findings;
    const entry = findingsByCompany?.find(e => e.company.id === companyFilter);
    return entry?.findings || [];
  }, [findings, findingsByCompany, companyFilter]);

  const visibleFindings = useMemo(() => {
    return sourceFindings
      .filter(f => severityFilter.has(f.severity))
      .filter(f => !categoryFilter || f.category === categoryFilter)
      .filter(f => {
        if (!search.trim()) return true;
        const q = search.toLowerCase();
        return (
          f.title.toLowerCase().includes(q) ||
          f.narrative.toLowerCase().includes(q) ||
          f.code.toLowerCase().includes(q) ||
          f.recommended_catalyst.catalyst.toLowerCase().includes(q) ||
          f.recommended_catalyst.sub_catalyst.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const s = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
        if (s !== 0) return s;
        return b.value_at_risk_zar - a.value_at_risk_zar;
      });
  }, [sourceFindings, severityFilter, categoryFilter, search]);

  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSeverity = (s: AssessmentFindingSeverity) => {
    setSeverityFilter(prev => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s); else next.add(s);
      return next;
    });
  };

  if (!findings || findings.length === 0) {
    return (
      <Card className="p-8 text-center">
        <AlertCircle size={32} className="mx-auto t-muted mb-3" />
        <h3 className="text-lg font-semibold t-primary mb-2">No findings detected</h3>
        <p className="text-sm t-muted max-w-md mx-auto">
          The assessment didn't produce any actionable findings on this dataset.
          {companyProfile?.profile === 'unknown'
            ? ' This may be a tenant with no ERP data connected — link an ERP system to enable detection.'
            : ' All checked categories are within healthy thresholds.'}
        </p>
      </Card>
    );
  }

  const totalValue = summary?.total_value_at_risk_zar ?? findings.reduce((s, f) => s + f.value_at_risk_zar, 0);

  return (
    <div className="space-y-4">
      {/* Cover banner — total findings + headline value */}
      <Card className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <FileText className="w-5 h-5 text-accent" />
              <h3 className="text-lg font-semibold t-primary">Findings</h3>
              {companyProfile && companyProfile.profile !== 'unknown' && (
                <Badge variant="info" className="text-xs">
                  {companyProfile.profile} company
                </Badge>
              )}
            </div>
            <p className="text-sm t-muted max-w-2xl">
              Each finding is derived from your ERP records. The numbers are quoted from your own data —
              click a row to see the sample records, methodology, and the catalyst that resolves it.
            </p>
          </div>
          <div className="flex items-center gap-6">
            <div className="text-right">
              <div className="text-label">Findings</div>
              <div className="text-2xl font-semibold t-primary">{findings.length}</div>
            </div>
            <div className="text-right">
              <div className="text-label">Value at risk</div>
              <div className="text-2xl font-semibold text-accent" data-testid="findings-total-value">
                {formatZAR(totalValue)}
              </div>
            </div>
          </div>
        </div>

        {/* Severity counts */}
        {summary && (
          <div className="flex items-center gap-3 mt-4 pt-4 border-t border-[var(--border-card)]">
            {(['critical', 'high', 'medium', 'low'] as AssessmentFindingSeverity[]).map(sev => (
              <button
                key={sev}
                type="button"
                onClick={() => toggleSeverity(sev)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-opacity ${severityFilter.has(sev) ? '' : 'opacity-40'}`}
                style={{
                  background: severityFilter.has(sev) ? 'var(--bg-secondary)' : 'transparent',
                  border: '1px solid var(--border-card)',
                }}
                data-testid={`severity-filter-${sev}`}
              >
                <span className={`w-2 h-2 rounded-full ${SEVERITY_BAR_COLOR[sev]}`} />
                <span className="t-primary">{SEVERITY_LABEL[sev]}</span>
                <span className="t-muted">{summary.by_severity[sev] ?? 0}</span>
              </button>
            ))}
            <span className="t-muted text-xs ml-auto">Click a severity to toggle filter</span>
          </div>
        )}
      </Card>

      {/* Per-company tabs (only for multinationals) */}
      {findingsByCompany && findingsByCompany.length >= 2 && (
        <Card className="p-3">
          <div className="flex items-center gap-2 flex-wrap">
            <Building2 size={14} className="t-muted ml-2" />
            <span className="text-xs t-muted mr-2">View entity:</span>
            <button
              type="button"
              onClick={() => setCompanyFilter(null)}
              className={`px-3 py-1 rounded-md text-xs ${!companyFilter ? 'bg-accent text-white' : 'border border-[var(--border-card)] t-primary'}`}
              data-testid="entity-tab-all"
            >
              All ({findings.length})
            </button>
            {findingsByCompany.map(entry => (
              <button
                key={entry.company.id}
                type="button"
                onClick={() => setCompanyFilter(entry.company.id)}
                className={`px-3 py-1 rounded-md text-xs ${companyFilter === entry.company.id ? 'bg-accent text-white' : 'border border-[var(--border-card)] t-primary'}`}
                data-testid={`entity-tab-${entry.company.id}`}
              >
                {entry.company.name} ({entry.findings.length})
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* Search + category filter */}
      <Card className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 t-muted" />
            <input
              type="text"
              aria-label="Search findings, sub-catalysts, codes"
              placeholder="Search findings, sub-catalysts, codes..."
              className="w-full pl-9 pr-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary focus:outline-none focus:border-accent/40"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              data-testid="findings-search"
            />
          </div>
          {summary && (
            <select
              className="px-3 py-2 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border-card)] text-sm t-primary"
              value={categoryFilter || ''}
              onChange={(e) => setCategoryFilter(e.target.value || null)}
              data-testid="findings-category-filter"
            >
              <option value="">All categories</option>
              {Object.entries(summary.by_category)
                .filter(([, v]) => v.count > 0)
                .map(([cat, v]) => (
                  <option key={cat} value={cat}>
                    {cat.replace(/_/g, ' ')} ({v.count})
                  </option>
                ))}
            </select>
          )}
        </div>
      </Card>

      {/* Findings list */}
      {visibleFindings.length === 0 ? (
        <Card className="p-8 text-center">
          <p className="text-sm t-muted">No findings match the current filters.</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {visibleFindings.map(f => {
            const isOpen = expanded.has(f.id);
            return (
              <Card
                key={f.id}
                className="overflow-hidden"
                data-testid={`finding-${f.code}`}
              >
                {/* Header row — always visible, click to expand */}
                <button
                  type="button"
                  className="w-full text-left p-4 flex items-start gap-3 hover:bg-[var(--bg-hover)] transition-colors"
                  onClick={() => toggleExpand(f.id)}
                >
                  {/* Severity ribbon */}
                  <div className={`w-1 self-stretch rounded-full ${SEVERITY_BAR_COLOR[f.severity]}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <StatusPill status={f.severity} size="sm" />
                      <Badge variant="outline" className="text-caption t-muted">
                        {f.category.replace(/_/g, ' ')}
                      </Badge>
                      {f.company_name && (
                        <Badge variant="outline" className="text-caption">
                          <Building2 size={10} className="inline mr-1" />
                          {f.company_name}
                        </Badge>
                      )}
                      <span className="text-caption t-muted ml-auto">{f.code}</span>
                    </div>
                    <div className="font-medium t-primary text-sm">{f.title}</div>
                  </div>
                  <div className="text-right whitespace-nowrap">
                    {f.value_at_risk_zar > 0 ? (
                      <>
                        <div className="text-label">Value at risk</div>
                        <div className="text-base font-semibold text-accent">
                          {formatZAR(f.value_at_risk_zar)}
                        </div>
                      </>
                    ) : (
                      <div className="text-xs t-muted">Informational</div>
                    )}
                  </div>
                  {isOpen ? <ChevronDown size={16} className="t-muted mt-1" /> : <ChevronRight size={16} className="t-muted mt-1" />}
                </button>

                {/* Expanded body */}
                {isOpen && (
                  <div className="px-4 pb-4 pt-1 border-t border-[var(--border-card)] space-y-4">
                    <p className="text-sm t-secondary leading-relaxed">{f.narrative}</p>

                    {/* Methodology */}
                    {f.value_components.length > 0 && (
                      <div>
                        <div className="text-label mb-2">Methodology</div>
                        <div className="space-y-1">
                          {f.value_components.map((c, i) => (
                            <div key={i} className="flex items-start gap-3 text-xs">
                              <span className="t-secondary flex-1">
                                <strong className="t-primary">{c.label}:</strong>{' '}
                                <span className="t-muted">{c.methodology}</span>
                              </span>
                              <span className="t-primary font-medium whitespace-nowrap">
                                {formatZAR(c.amount_zar)}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Sample records */}
                    {f.sample_records.length > 0 && (
                      <div>
                        <div className="text-label mb-2">
                          Sample records ({f.sample_records.length} of {f.affected_count.toLocaleString()})
                        </div>
                        <div className="rounded-md border border-[var(--border-card)] overflow-hidden">
                          <table className="w-full text-xs">
                            <thead className="bg-[var(--bg-secondary)]">
                              <tr>
                                <th className="text-left px-3 py-2 t-muted font-medium">Reference</th>
                                <th className="text-left px-3 py-2 t-muted font-medium">Description</th>
                                <th className="text-right px-3 py-2 t-muted font-medium">Amount</th>
                                <th className="text-left px-3 py-2 t-muted font-medium">Date</th>
                              </tr>
                            </thead>
                            <tbody>
                              {f.sample_records.map((r, i) => (
                                <tr key={i} className="border-t border-[var(--border-card)]">
                                  <td className="px-3 py-2 t-primary font-mono">{r.ref}</td>
                                  <td className="px-3 py-2 t-secondary">{r.description}</td>
                                  <td className="px-3 py-2 text-right t-primary whitespace-nowrap">
                                    {r.amount_native !== undefined && r.currency
                                      ? `${r.currency} ${r.amount_native.toLocaleString()}`
                                      : r.amount_zar !== undefined
                                        ? formatZAR(r.amount_zar)
                                        : '—'}
                                  </td>
                                  <td className="px-3 py-2 t-muted whitespace-nowrap">{r.date || '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* Currency breakdown if multi-currency */}
                    {Object.keys(f.currency_breakdown).length > 1 && (
                      <div>
                        <div className="text-label mb-2">Currency exposure</div>
                        <div className="flex flex-wrap gap-2">
                          {Object.entries(f.currency_breakdown).map(([cur, amt]) => (
                            <Badge key={cur} variant="outline" className="text-xs">
                              {cur} {amt.toLocaleString()}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Federated peer insights — only renders when DP-noised
                        aggregate exists for (industry, finding_code). Below
                        k-anonymity floor (n < 5) → renders nothing. */}
                    <PeerInsightsBadge findingCode={f.code} />

                    {/* Catalyst recommendation footer */}
                    <div className="flex items-center justify-between gap-3 pt-3 border-t border-[var(--border-card)]">
                      <div className="flex items-center gap-2 text-xs">
                        <TrendingUp size={14} className="text-accent" />
                        <span className="t-muted">Resolved by:</span>
                        <span className="t-primary font-medium">
                          {f.recommended_catalyst.catalyst}
                        </span>
                        <span className="t-muted">→</span>
                        <span className="t-primary font-medium">
                          {f.recommended_catalyst.sub_catalyst}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-caption t-muted">
                          Evidence: <strong className="t-primary">{f.evidence_quality}</strong>
                        </span>
                        {onDeployCatalyst && (
                          <Button
                            variant="primary"
                            size="sm"
                            onClick={(e) => { e.stopPropagation(); onDeployCatalyst(f.recommended_catalyst.catalyst, f.recommended_catalyst.sub_catalyst); }}
                            data-testid={`deploy-catalyst-${f.code}`}
                          >
                            Deploy
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Footer note for hidden findings */}
      {visibleFindings.length < sourceFindings.length && (
        <div className="text-center py-2">
          <p className="text-xs t-muted">
            <AlertTriangle size={12} className="inline mr-1" />
            {sourceFindings.length - visibleFindings.length} findings hidden by current filters
          </p>
        </div>
      )}
    </div>
  );
}
