import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { X, ChevronRight, Link2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, Minus, FileText, ChevronDown, ChevronUp, Crown, Database } from "lucide-react";
import type { HealthDimensionTraceResponse, RiskTraceResponse, MetricTraceResponse } from "@/lib/api";

function formatZAR(n: number): string {
  return new Intl.NumberFormat('en-ZA', { style: 'currency', currency: 'ZAR', maximumFractionDigits: 0 }).format(n);
}
function formatRunStarted(iso: string): string {
  try { return new Date(iso).toLocaleString('en-ZA', { dateStyle: 'medium', timeStyle: 'short' }); } catch { return iso; }
}

interface TraceabilityModalProps {
  data: HealthDimensionTraceResponse | RiskTraceResponse | MetricTraceResponse;
  type: 'dimension' | 'risk' | 'metric';
  onClose: () => void;
}

export function TraceabilityModal({ data, type, onClose }: TraceabilityModalProps) {
  const navigate = useNavigate();
  const navigateToRun = (runId?: string) => {
    if (runId) navigate(`/catalysts/runs/${runId}`);
  };
  const [expandedSection, setExpandedSection] = useState<string | null>('source');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const renderDrillDownPath = () => {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <Badge variant="outline" className="text-xs">{type === 'dimension' ? 'Dimension' : type === 'risk' ? 'Risk' : 'Metric'}</Badge>
        <ChevronRight size={12} className="t-muted" />
        {type === 'dimension' ? (
          <>
            <Badge variant="outline" className="text-xs">Clusters ({(data as HealthDimensionTraceResponse).drillDownPath.clusters?.length || 0})</Badge>
            <ChevronRight size={12} className="t-muted" />
            <Badge variant="outline" className="text-xs">Sub-Catalysts ({(data as HealthDimensionTraceResponse).drillDownPath.subCataulysts?.length || 0})</Badge>
            <ChevronRight size={12} className="t-muted" />
            <Badge variant="outline" className="text-xs">Runs ({(data as HealthDimensionTraceResponse).drillDownPath.runs?.length || 0})</Badge>
            <ChevronRight size={12} className="t-muted" />
          </>
        ) : type === 'risk' ? (
          <>
            <Badge variant="outline" className="text-xs">Run ({(data as RiskTraceResponse).drillDownPath.run || 'N/A'})</Badge>
            <ChevronRight size={12} className="t-muted" />
            <Badge variant="outline" className="text-xs">Items ({(data as RiskTraceResponse).drillDownPath.items || '0'})</Badge>
            <ChevronRight size={12} className="t-muted" />
          </>
        ) : (
          <>
            <Badge variant="outline" className="text-xs">Run ({(data as MetricTraceResponse).drillDownPath.run || 'N/A'})</Badge>
            <ChevronRight size={12} className="t-muted" />
            <Badge variant="outline" className="text-xs">Items ({(data as MetricTraceResponse).drillDownPath.items || '0'})</Badge>
            <ChevronRight size={12} className="t-muted" />
          </>
        )}
        <Badge variant="info" className="text-xs">Items</Badge>
      </div>
    );
  };

  const renderScoreOrStatus = () => {
    if (type === 'dimension') {
      const d = data as HealthDimensionTraceResponse;
      return (
        <div className="flex items-center gap-3">
          <span className="text-headline-lg font-bold t-primary tabular-nums font-mono">{d.score !== null ? `${d.score}/100` : 'N/A'}</span>
          {d.trend === 'improving' ? <TrendingUp size={16} className="text-accent" /> :
           d.trend === 'declining' ? <TrendingDown size={16} className="text-neg" /> :
           <Minus size={16} className="t-muted" />}
          <span className="text-xs t-muted">Δ {d.delta > 0 ? '+' : ''}{d.delta}</span>
        </div>
      );
    } else if (type === 'risk') {
      const r = data as RiskTraceResponse;
      const sevTint = r.riskAlert.severity === 'critical' ? 'text-neg'
        : r.riskAlert.severity === 'high' ? 'text-neg'
        : 'text-[var(--info)]';
      return (
        <div className="flex items-center gap-2">
          <AlertTriangle size={16} className={sevTint} />
          <StatusPill status={r.riskAlert.severity} size="sm" />
          <span className="text-xs t-muted">{r.riskAlert.category}</span>
        </div>
      );
    } else {
      const m = data as MetricTraceResponse;
      const statusColor = m.metric.status === 'red' ? 'danger' : m.metric.status === 'amber' ? 'warning' : 'success';
      return (
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className={statusColor === 'danger' ? 'text-neg' : statusColor === 'warning' ? 'text-[var(--warning)]' : 'text-accent'} />
          <Badge variant={statusColor} className="text-xs">{m.metric.status}</Badge>
          <span className="text-sm t-primary">{m.metric.value} {m.metric.unit}</span>
        </div>
      );
    }
  };

  const renderContributors = () => {
    if (type === 'dimension') {
      const d = data as HealthDimensionTraceResponse;
      return (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold t-primary uppercase tracking-wider">KPI Contributors</h4>
          {d.kpiContributors.map((kpi, i) => (
            <div key={i} className="flex items-center justify-between p-2 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
              <span className="text-sm t-primary">{kpi.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs t-muted">{kpi.value}</span>
                <Badge variant={kpi.status === 'red' ? 'danger' : kpi.status === 'amber' ? 'warning' : 'success'} className="text-xs">
                  {kpi.status}
                </Badge>
              </div>
            </div>
          ))}
        </div>
      );
    } else if (type === 'risk') {
      const r = data as RiskTraceResponse;
      return (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold t-primary uppercase tracking-wider">Flagged Items ({r.flaggedItems.length})</h4>
          {r.flaggedItems.slice(0, 5).map((item, i) => (
            <div key={i} className="p-2 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
              <div className="flex items-center justify-between">
                <span className="text-xs t-primary font-medium">Item #{item.itemNumber}</span>
                <StatusPill status={item.status} size="sm" />
              </div>
              {item.field && (
                <p className="text-caption t-muted mt-1">Field: {item.field} | Diff: {item.difference || 'N/A'}</p>
              )}
            </div>
          ))}
          {r.flaggedItems.length > 5 && (
            <p className="text-xs t-muted text-center">+ {r.flaggedItems.length - 5} more items</p>
          )}
        </div>
      );
    } else {
      const m = data as MetricTraceResponse;
      return (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold t-primary uppercase tracking-wider">Related Anomalies ({m.relatedAnomalies.length})</h4>
          {m.relatedAnomalies.slice(0, 3).map((a, i) => (
            <div key={i} className="p-2 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
              <div className="flex items-center justify-between">
                <span className="text-xs t-primary font-medium">Anomaly #{i + 1}</span>
                <StatusPill status={a.severity} size="sm" />
              </div>
              <p className="text-caption t-muted mt-1">Deviation: {a.deviation.toFixed(1)}%</p>
            </div>
          ))}
        </div>
      );
    }
  };

  return (
    <Portal>
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
        <div style={{ background: "var(--bg-modal)", border: "1px solid var(--border-card)" }} 
             className="rounded-md p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {type === 'dimension' ? <Crown size={18} className="text-accent" /> :
               type === 'risk' ? <AlertTriangle size={18} className="text-accent" /> :
               <BarChart3 size={18} className="text-accent" />}
              <h3 className="text-lg font-semibold t-primary">
                {type === 'dimension' ? `Dimension: ${(data as HealthDimensionTraceResponse).dimension}` :
                 type === 'risk' ? `Risk: ${(data as RiskTraceResponse).riskAlert.title}` :
                 `Metric: ${(data as MetricTraceResponse).metric.name}`}
              </h3>
            </div>
            <button onClick={onClose} className="t-muted hover:t-secondary">
              <X size={18} />
            </button>
          </div>

          {/* Score/Status */}
          {renderScoreOrStatus()}

          {/* Drill-down path */}
          {renderDrillDownPath()}

          {/* Expandable Sections */}
          <div className="space-y-2">
            {/* Batch Runs — the actual sub-catalyst runs that fed this metric/dimension/risk */}
            {(() => {
              const runs: Array<{ runId: string; subCataulystName: string; status: string; matched: number; discrepancies: number; exceptions: number; totalValue: number; startedAt: string }> =
                type === 'dimension'
                  ? (data as HealthDimensionTraceResponse).traceability?.recentRuns ?? []
                  : type === 'risk' && (data as RiskTraceResponse).sourceRun
                    ? [(data as RiskTraceResponse).sourceRun!]
                    : type === 'metric' && (data as MetricTraceResponse).sourceRun
                      ? [(data as MetricTraceResponse).sourceRun!]
                      : [];
              if (runs.length === 0) return null;
              return (
                <div className="border border-[var(--border-card)] rounded-md">
                  <button
                    onClick={() => toggleSection('source')}
                    className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
                  >
                    <span className="text-sm font-medium t-primary flex items-center gap-2">
                      <Database size={14} className="text-accent" /> Batch Runs ({runs.length})
                    </span>
                    {expandedSection === 'source' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
                  </button>
                  {expandedSection === 'source' && (
                    <div className="p-3 pt-0 border-t border-[var(--border-card)]">
                      <div className="space-y-2">
                        {runs.slice(0, 8).map(r => {
                          const total = (r.matched || 0) + (r.discrepancies || 0);
                          return (
                            <button
                              key={r.runId}
                              onClick={() => navigateToRun(r.runId)}
                              className="w-full text-left p-3 rounded-md bg-[var(--bg-card-solid)] border border-[var(--border-card)] hover:border-[var(--accent)] hover:shadow-sm transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] group active:scale-[0.97]"
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <span className="text-sm font-medium t-primary truncate pr-2">{r.subCataulystName}</span>
                                <span className="flex items-center gap-1 text-caption t-muted shrink-0">
                                  {formatRunStarted(r.startedAt)}
                                  <ChevronRight size={12} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                                </span>
                              </div>
                              <div className="flex items-center gap-3 text-caption">
                                <span className="t-muted">Records: <span className="t-primary font-medium tabular-nums">{total}</span></span>
                                <span className="text-accent">Matched <span className="font-medium tabular-nums">{r.matched}</span></span>
                                <span style={{ color: 'var(--warning)' }}>Discrepancies <span className="font-medium tabular-nums">{r.discrepancies}</span></span>
                                {r.exceptions > 0 && <span className="text-neg">Exceptions <span className="font-medium tabular-nums">{r.exceptions}</span></span>}
                                {typeof r.totalValue === 'number' && r.totalValue > 0 && (
                                  <span className="ml-auto t-primary font-medium tabular-nums">{formatZAR(r.totalValue)}</span>
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                      <p className="text-caption t-muted mt-2 italic">Click a run to inspect every record that was processed.</p>
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Source Attribution — kept compact, only shown when there's a single source */}
            {(type === 'risk' || type === 'metric') && (
              <div className="border border-[var(--border-card)] rounded-md">
                <button
                  onClick={() => toggleSection('attribution')}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
                >
                  <span className="text-sm font-medium t-primary flex items-center gap-2">
                    <Link2 size={14} className="text-accent" /> Source Attribution
                  </span>
                  {expandedSection === 'attribution' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
                </button>
                {expandedSection === 'attribution' && (
                  <div className="p-3 pt-0 border-t border-[var(--border-card)] space-y-1">
                    {type === 'risk' ? (
                      <>
                        <p className="text-xs t-muted">Sub-Catalyst: <span className="t-primary">{(data as RiskTraceResponse).sourceAttribution.subCataulystName || '—'}</span></p>
                        <p className="text-xs t-muted">Cluster: <span className="t-primary">{(data as RiskTraceResponse).cluster?.clusterName || (data as RiskTraceResponse).sourceAttribution.clusterId || '—'}</span></p>
                        <p className="text-xs t-muted">Source Run: <span className="t-primary font-mono">{(data as RiskTraceResponse).sourceAttribution.sourceRunId || '—'}</span></p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs t-muted">Sub-Catalyst: <span className="t-primary">{(data as MetricTraceResponse).sourceAttribution.subCataulystName || '—'}</span></p>
                        <p className="text-xs t-muted">Cluster: <span className="t-primary">{(data as MetricTraceResponse).cluster?.clusterName || (data as MetricTraceResponse).sourceAttribution.clusterId || '—'}</span></p>
                        <p className="text-xs t-muted">Source Run: <span className="t-primary font-mono">{(data as MetricTraceResponse).sourceAttribution.sourceRunId || '—'}</span></p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {type === 'dimension' && (data as HealthDimensionTraceResponse).traceability?.contributingClusters?.length > 0 && (
              <div className="border border-[var(--border-card)] rounded-md">
                <button
                  onClick={() => toggleSection('clusters')}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
                >
                  <span className="text-sm font-medium t-primary flex items-center gap-2">
                    <BarChart3 size={14} className="text-accent" /> Contributing Clusters ({(data as HealthDimensionTraceResponse).traceability.contributingClusters.length})
                  </span>
                  {expandedSection === 'clusters' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
                </button>
                {expandedSection === 'clusters' && (
                  <div className="p-3 pt-0 border-t border-[var(--border-card)] space-y-1.5">
                    {(data as HealthDimensionTraceResponse).traceability.contributingClusters.map((cl) => (
                      <div key={cl.clusterId} className="flex items-center justify-between p-2 rounded bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
                        <div>
                          <p className="text-sm t-primary font-medium">{cl.clusterName}</p>
                          <p className="text-caption t-muted">{cl.domain} · {cl.subCataulysts.length} sub-catalysts</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Contributors/Items */}
            <div className="border border-[var(--border-card)] rounded-md">
              <button 
                onClick={() => toggleSection('contributors')}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
              >
                <span className="text-sm font-medium t-primary flex items-center gap-2">
                  <FileText size={14} className="text-accent" /> {type === 'dimension' ? 'KPI Contributors' : type === 'risk' ? 'Flagged Items' : 'Related Anomalies'}
                </span>
                {expandedSection === 'contributors' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
              </button>
              {expandedSection === 'contributors' && (
                <div className="p-3 pt-0 border-t border-[var(--border-card)]">
                  {renderContributors()}
                </div>
              )}
            </div>

          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-2">
            <Button variant="secondary" size="sm" onClick={onClose}>Close</Button>
            {type === 'risk' && (data as RiskTraceResponse).sourceRun && (
              <Button variant="primary" size="sm" onClick={() => navigateToRun((data as RiskTraceResponse).sourceRun?.runId)}>
                View Run <ChevronRight size={14} />
              </Button>
            )}
            {type === 'metric' && (data as MetricTraceResponse).sourceRun && (
              <Button variant="primary" size="sm" onClick={() => navigateToRun((data as MetricTraceResponse).sourceRun?.runId)}>
                View Run <ChevronRight size={14} />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
