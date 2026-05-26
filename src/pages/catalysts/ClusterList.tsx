import { Badge } from "@/components/ui/badge";
import { Folder, ChevronRight, Plus } from "lucide-react";
import type { ClusterItem } from "@/lib/api";

interface ClusterListProps {
  clusters: ClusterItem[];
  selectedCluster: string | null;
  onSelect: (id: string) => void;
  onCreate: () => void;
}

export function ClusterList({ clusters, selectedCluster, onSelect, onCreate }: ClusterListProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold t-primary">Clusters</h3>
        <button
          onClick={onCreate}
          className="flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium bg-accent/10 text-accent hover:bg-accent/20 active:scale-[0.96] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)]"
        >
          <Plus size={12} /> New
        </button>
      </div>
      {clusters.length === 0 ? (
        <p className="text-sm t-muted text-center py-8">No clusters yet. Create one to get started.</p>
      ) : (
        clusters.map((cluster) => (
          <button
            key={cluster.id}
            onClick={() => onSelect(cluster.id)}
            className={`w-full flex items-center gap-3 p-3 rounded-xl active:scale-[0.98] transition-[background-color,color,box-shadow,transform,border-color] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] text-left ${
              selectedCluster === cluster.id
                ? 'bg-accent/10 border border-accent/20'
                : 'hover:bg-[var(--bg-secondary)] border border-transparent'
            }`}
          >
            <Folder size={16} className="text-accent flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium t-primary truncate">{cluster.name}</p>
              <p className="text-caption t-muted">{cluster.subCatalysts?.length || 0} sub-catalysts</p>
            </div>
            <Badge variant={cluster.status === 'active' ? 'success' : 'default'} size="sm">{cluster.status}</Badge>
            <ChevronRight size={14} className="t-muted" />
          </button>
        ))
      )}
    </div>
  );
}
