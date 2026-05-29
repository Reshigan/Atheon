import { cn } from "@/lib/utils";
import type { AtheonLayer } from "@/types";

/**
 * Swiss restraint: the platform layers (Apex, Pulse, Catalysts, …) are NOT
 * a rainbow. They read as a single ink-on-paper tag, differentiated by the
 * label, not by hue — the brand accent stays reserved for emphasis. The map
 * below is purely a label lookup; styling is uniform across all layers.
 */
const LAYER_LABELS: Record<string, string> = {
  apex: 'Apex',
  pulse: 'Pulse',
  catalysts: 'Catalysts',
  mind: 'Mind',
  memory: 'Memory',
  'control-plane': 'Control Plane',
  erp: 'ERP',
  iam: 'IAM',
  connectivity: 'Connectivity',
  audit: 'Audit',
  system: 'System',
};

interface LayerBadgeProps {
  layer: AtheonLayer | string;
  className?: string;
}

export function LayerBadge({ layer, className }: LayerBadgeProps) {
  const label = LAYER_LABELS[layer] || layer;
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-sm text-caption font-medium font-mono border',
      'bg-[var(--bg-secondary)] t-secondary border-[var(--border-card)]',
      className
    )}>
      <span className="w-1 h-1 rounded-full" style={{ background: 'var(--text-muted)' }} />
      {label}
    </span>
  );
}
