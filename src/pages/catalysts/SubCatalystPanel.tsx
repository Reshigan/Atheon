import { Badge } from "@/components/ui/badge";
import { Play, Clock, BarChart3, Settings } from "lucide-react";

interface SubCatalyst {
  name: string;
  status: string;
  autonomy_tier: string;
  last_run?: string;
  next_run?: string;
}

interface SubCatalystPanelProps {
  subCatalysts: SubCatalyst[];
  onRun: (name: string) => void;
  onConfigure: (name: string) => void;
  onViewAnalytics: (name: string) => void;
}

export function SubCatalystPanel({ subCatalysts, onRun, onConfigure, onViewAnalytics }: SubCatalystPanelProps) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold t-primary">Sub-Catalysts</h3>
      {subCatalysts.length === 0 ? (
        <p className="text-sm t-muted text-center py-6">No sub-catalysts configured.</p>
      ) : (
        subCatalysts.map((sc) => (
          <div key={sc.name} className="p-3 rounded-md bg-[var(--bg-card)] border border-[var(--border-card)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium t-primary">{sc.name.replace(/[-_]/g, ' ').replace(/\b\w/g, c => c.toUpperCase())}</span>
                <Badge variant={sc.status === 'active' ? 'success' : 'default'} size="sm">{sc.status}</Badge>
              </div>
              <Badge variant="default" size="sm">{sc.autonomy_tier}</Badge>
            </div>
            <div className="flex items-center gap-2 text-caption t-muted mb-2">
              {sc.last_run && <span className="flex items-center gap-1"><Clock size={10} /> Last: {new Date(sc.last_run).toLocaleDateString()}</span>}
              {sc.next_run && <span className="flex items-center gap-1"><Clock size={10} /> Next: {new Date(sc.next_run).toLocaleDateString()}</span>}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => onRun(sc.name)} className="flex items-center gap-1 px-2 py-1 rounded-md text-caption font-medium bg-accent/10 text-accent hover:bg-accent/20 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]">
                <Play size={10} /> Run
              </button>
              <button onClick={() => onViewAnalytics(sc.name)} className="flex items-center gap-1 px-2 py-1 rounded-md text-caption font-medium bg-[var(--bg-secondary)] t-muted hover:t-primary transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]">
                <BarChart3 size={10} /> Analytics
              </button>
              <button onClick={() => onConfigure(sc.name)} className="flex items-center gap-1 px-2 py-1 rounded-md text-caption font-medium bg-[var(--bg-secondary)] t-muted hover:t-primary transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]">
                <Settings size={10} /> Configure
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
