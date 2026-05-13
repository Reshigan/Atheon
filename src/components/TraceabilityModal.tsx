import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { Portal } from "@/components/ui/portal";
import { X, ChevronRight, Link2, AlertTriangle, BarChart3, TrendingUp, TrendingDown, Minus, FileText, ChevronDown, ChevronUp, Crown } from "lucide-react";
import type { HealthDimensionTraceResponse, RiskTraceResponse, MetricTraceResponse } from "@/lib/api";

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
          <span className="text-2xl font-bold t-primary">{d.score !== null ? `${d.score}/100` : 'N/A'}</span>
          {d.trend === 'improving' ? <TrendingUp size={16} className="text-emerald-400" /> :
           d.trend === 'declining' ? <TrendingDown size={16} className="text-red-400" /> :
           <Minus size={16} className="text-gray-400" />}
          <span className="text-xs t-muted">Δ {d.delta > 0 ? '+' : ''}{d.delta}</span>
        </div>
      );
    } else if (type === 'risk') {
      const r = data as RiskTraceResponse;
      const sevTint = r.riskAlert.severity === 'critical' ? 'text-red-400'
        : r.riskAlert.severity === 'high' ? 'text-amber-400'
        : 'text-blue-400';
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
          <BarChart3 size={16} className={`text-${statusColor === 'danger' ? 'red' : statusColor === 'warning' ? 'amber' : 'emerald'}-400`} />
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
            <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
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
            <div key={i} className="p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
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
            <div key={i} className="p-2 rounded-lg bg-[var(--bg-card-solid)] border border-[var(--border-card)]">
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
             className="rounded-xl shadow-2xl p-6 w-full max-w-2xl space-y-4 max-h-[90vh] overflow-y-auto">
          
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
            <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
              <X size={18} />
            </button>
          </div>

          {/* Score/Status */}
          {renderScoreOrStatus()}

          {/* Drill-down path */}
          {renderDrillDownPath()}

          {/* Expandable Sections */}
          <div className="space-y-2">
            {/* Source Attribution */}
            <div className="border border-[var(--border-card)] rounded-lg">
              <button 
                onClick={() => toggleSection('source')}
                className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
              >
                <span className="text-sm font-medium t-primary flex items-center gap-2">
                  <Link2 size={14} className="text-accent" /> Source Attribution
                </span>
                {expandedSection === 'source' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
              </button>
              {expandedSection === 'source' && (
                <div className="p-3 pt-0 border-t border-[var(--border-card)] space-y-2">
                  {type === 'dimension' ? (
                    <div className="space-y-1">
                      <p className="text-xs t-muted">Source Run: {(data as HealthDimensionTraceResponse).sourceRunId || 'N/A'}</p>
                      <p className="text-xs t-muted">Catalyst: {(data as HealthDimensionTraceResponse).catalystName || 'N/A'}</p>
                      <p className="text-xs t-muted">Contributors: {(data as HealthDimensionTraceResponse).contributors.join(', ') || 'None'}</p>
                    </div>
                  ) : type === 'risk' ? (
                    <div className="space-y-1">
                      <p className="text-xs t-muted">Source Run: {(data as RiskTraceResponse).sourceAttribution.sourceRunId || 'N/A'}</p>
                      <p className="text-xs t-muted">Cluster: {(data as RiskTraceResponse).sourceAttribution.clusterId || 'N/A'}</p>
                      <p className="text-xs t-muted">Sub-Catalyst: {(data as RiskTraceResponse).sourceAttribution.subCataulystName || 'N/A'}</p>
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-xs t-muted">Source Run: {(data as MetricTraceResponse).sourceAttribution.sourceRunId || 'N/A'}</p>
                      <p className="text-xs t-muted">Sub-Catalyst: {(data as MetricTraceResponse).sourceAttribution.subCataulystName || 'N/A'}</p>
                      <p className="text-xs t-muted">Cluster: {(data as MetricTraceResponse).sourceAttribution.clusterId || 'N/A'}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Contributors/Items */}
            <div className="border border-[var(--border-card)] rounded-lg">
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

            {/* Cluster Info (for risk/metric) */}
            {type !== 'dimension' && (
              <div className="border border-[var(--border-card)] rounded-lg">
                <button 
                  onClick={() => toggleSection('cluster')}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-[var(--bg-secondary)]"
                >
                  <span className="text-sm font-medium t-primary flex items-center gap-2">
                    <BarChart3 size={14} className="text-accent" /> Cluster Information
                  </span>
                  {expandedSection === 'cluster' ? <ChevronUp size={14} className="t-muted" /> : <ChevronDown size={14} className="t-muted" />}
                </button>
                {expandedSection === 'cluster' && (
                  <div className="p-3 pt-0 border-t border-[var(--border-card)] space-y-1">
                    {type === 'risk' ? (
                      <>
                        <p className="text-xs t-muted">Cluster: {(data as RiskTraceResponse).cluster?.clusterName || 'N/A'}</p>
                        <p className="text-xs t-muted">Domain: {(data as RiskTraceResponse).cluster?.domain || 'N/A'}</p>
                        <p className="text-xs t-muted">Autonomy Tier: {(data as RiskTraceResponse).cluster?.autonomyTier || 'N/A'}</p>
                      </>
                    ) : (
                      <>
                        <p className="text-xs t-muted">Cluster: {(data as MetricTraceResponse).cluster?.clusterName || 'N/A'}</p>
                        <p className="text-xs t-muted">Domain: {(data as MetricTraceResponse).cluster?.domain || 'N/A'}</p>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
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
