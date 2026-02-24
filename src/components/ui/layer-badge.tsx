import { cn } from "@/lib/utils";
import type { AtheonLayer } from "@/types";

const layerConfig: Record<AtheonLayer, { label: string; color: string; bg: string }> = {
  apex: { label: 'Apex', color: 'text-amber-700', bg: 'bg-amber-50 border-amber-200' },
  pulse: { label: 'Pulse', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  catalysts: { label: 'Catalysts', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  mind: { label: 'Mind', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  memory: { label: 'Memory', color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200' },
};

interface LayerBadgeProps {
  layer: AtheonLayer;
  className?: string;
}

export function LayerBadge({ layer, className }: LayerBadgeProps) {
  const config = layerConfig[layer];
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border',
      config.bg, config.color,
      className
    )}>
      <span className={cn('w-1.5 h-1.5 rounded-full', config.color.replace('text-', 'bg-'))} />
      {config.label}
    </span>
  );
}
