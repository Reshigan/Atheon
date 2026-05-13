import { StatusPill } from "@/components/ui/status-pill";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Zap } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type { AnomalyItem } from "@/lib/api";
import { recommendForAnomaly, catalystDeployUrl } from "@/lib/catalyst-recommendation";

interface AnomalyListProps {
  anomalies: AnomalyItem[];
}

/**
 * Compact anomaly list for the Pulse Overview tab.
 *
 * Each row shows the anomaly + a Resolve button when the metric maps to a
 * known catalyst (via recommendForAnomaly). Click navigates to /catalysts
 * with ?cluster=…&sub=… so CatalystsPage opens the SubCatalystOpsPanel
 * directly — observation → action with no nav hunting.
 */
export function AnomalyList({ anomalies }: AnomalyListProps) {
  const navigate = useNavigate();
  if (anomalies.length === 0) {
    return <p className="text-sm t-muted text-center py-6">No anomalies detected.</p>;
  }

  return (
    <div className="space-y-2">
      {anomalies.map((a, i) => {
        const rec = recommendForAnomaly(a.metric);
        return (
          <div key={i} className="flex items-start gap-3 p-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border-card)]">
            <AlertTriangle size={16} className={a.severity === 'high' ? 'text-red-400' : a.severity === 'medium' ? 'text-amber-400' : 'text-gray-400'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium t-primary">{a.metric}</p>
              <p className="text-xs t-secondary mt-0.5">{a.hypothesis || `Anomaly detected in ${a.metric}`}</p>
            </div>
            <StatusPill status={a.severity} size="sm" />
            {rec && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate(catalystDeployUrl(rec))}
                title={`Open ${rec.catalyst} → ${rec.subCatalyst}`}
                data-testid={`resolve-anomaly-${i}`}
              >
                <Zap size={12} className="mr-1" /> Resolve
              </Button>
            )}
          </div>
        );
      })}
    </div>
  );
}
