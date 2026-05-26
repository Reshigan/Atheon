import { DashCard } from "./DashCard";
import { ScoreRing } from "@/components/ui/score-ring";
import { ChevronRight } from "lucide-react";

interface Dimension {
  key: string;
  name: string;
  score: number;
  trend: string;
  change: number;
}

interface HealthDimensionsProps {
  dimensions: Dimension[];
  onOpenTrace: (dim: string) => void;
}

export function HealthDimensions({ dimensions, onOpenTrace }: HealthDimensionsProps) {
  if (dimensions.length === 0) return null;

  return (
    <DashCard>
      <h3 className="text-sm font-semibold t-primary mb-4">Health Dimensions</h3>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
        {dimensions.map((dim) => (
          <button
            key={dim.key}
            onClick={() => onOpenTrace(dim.key)}
            className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-[var(--bg-secondary)] transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] group active:scale-[0.97]"
            aria-label={`View ${dim.name} traceability`}
          >
            <ScoreRing score={dim.score} size="sm" />
            <span className="text-xs font-medium t-primary">{dim.name}</span>
            <span className={`text-caption ${dim.change > 0 ? 'text-emerald-500' : dim.change < 0 ? 'text-red-500' : 't-muted'}`}>
              {dim.change > 0 ? '+' : ''}{dim.change.toFixed(1)}%
            </span>
            <ChevronRight size={12} className="t-muted opacity-0 group-hover:opacity-100 transition-opacity" />
          </button>
        ))}
      </div>
    </DashCard>
  );
}
