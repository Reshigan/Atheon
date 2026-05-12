import { Badge } from "@/components/ui/badge";
import { Clock, CheckCircle2, XCircle, Loader2 } from "lucide-react";

interface RunItem {
  id: string;
  sub_catalyst_name: string;
  status: string;
  started_at: string;
  completed_at?: string;
  source_record_count?: number;
  matched?: number;
  discrepancies?: number;
}

interface ExecutionHistoryProps {
  runs: RunItem[];
  onViewDetail: (runId: string) => void;
}

export function ExecutionHistory({ runs, onViewDetail }: ExecutionHistoryProps) {
  const statusIcon = (status: string) => {
    if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-500" />;
    if (status === 'failed') return <XCircle size={14} className="text-red-500" />;
    if (status === 'running') return <Loader2 size={14} className="text-blue-400 animate-spin" />;
    return <Clock size={14} className="t-muted" />;
  };

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold t-primary">Recent Runs</h3>
      {runs.length === 0 ? (
        <p className="text-sm t-muted text-center py-6">No execution history yet.</p>
      ) : (
        <div className="space-y-2">
          {runs.slice(0, 10).map((run) => (
            <button
              key={run.id}
              onClick={() => onViewDetail(run.id)}
              className="w-full flex items-center gap-3 p-3 rounded-xl hover:bg-[var(--bg-secondary)] transition-all text-left"
            >
              {statusIcon(run.status)}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium t-primary truncate">{run.sub_catalyst_name}</p>
                <p className="text-caption t-muted">{new Date(run.started_at).toLocaleString()}</p>
              </div>
              {run.source_record_count !== undefined && (
                <div className="text-right">
                  <p className="text-xs t-primary">{run.matched || 0}/{run.source_record_count} matched</p>
                  {(run.discrepancies || 0) > 0 && (
                    <p className="text-caption text-amber-400">{run.discrepancies} issues</p>
                  )}
                </div>
              )}
              <Badge variant={run.status === 'completed' ? 'success' : run.status === 'failed' ? 'danger' : 'default'} size="sm">
                {run.status}
              </Badge>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
