import { StatusPill } from "@/components/ui/status-pill";
import { AlertTriangle, Shield } from "lucide-react";
import type { Risk } from "@/lib/api";

interface RiskMatrixProps {
  risks: Risk[];
}

export function RiskMatrix({ risks }: RiskMatrixProps) {
  const grouped = {
    critical: risks.filter(r => r.severity === 'critical' || r.severity === 'high'),
    medium: risks.filter(r => r.severity === 'medium'),
    low: risks.filter(r => r.severity === 'low'),
  };

  if (risks.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-8">
        <Shield size={32} className="text-emerald-500" />
        <p className="text-sm t-muted">No active risks detected.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {grouped.critical.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-red-400 uppercase tracking-wider mb-2">Critical / High</h4>
          <div className="space-y-2">
            {grouped.critical.map((r, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-red-500/5 border border-red-500/10">
                <AlertTriangle size={14} className="text-red-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">{r.title}</p>
                  <p className="text-xs t-secondary mt-0.5">{r.description}</p>
                </div>
                <StatusPill status={r.severity} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}
      {grouped.medium.length > 0 && (
        <div>
          <h4 className="text-xs font-medium text-amber-400 uppercase tracking-wider mb-2">Medium</h4>
          <div className="space-y-2">
            {grouped.medium.map((r, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-amber-500/5 border border-amber-500/10">
                <AlertTriangle size={14} className="text-amber-400 mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">{r.title}</p>
                  <p className="text-xs t-secondary mt-0.5">{r.description}</p>
                </div>
                <StatusPill status={r.severity} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}
      {grouped.low.length > 0 && (
        <div>
          <h4 className="text-xs font-medium t-muted uppercase tracking-wider mb-2">Low</h4>
          <div className="space-y-2">
            {grouped.low.map((r, i) => (
              <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-secondary)]">
                <AlertTriangle size={14} className="t-muted mt-0.5" />
                <div className="flex-1">
                  <p className="text-sm font-medium t-primary">{r.title}</p>
                  <p className="text-xs t-secondary mt-0.5">{r.description}</p>
                </div>
                <StatusPill status={r.severity} size="sm" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
