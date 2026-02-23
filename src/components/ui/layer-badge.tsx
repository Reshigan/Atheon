import { cn } from "@/lib/utils";
import type { AtheonLayer } from "@/types";

const layerConfig: Record<AtheonLayer, { label: string; color: string; bg: string }> = {
  apex: { label: 'Apex', color: 'text-amber-400', bg: 'bg-amber-500/15 border-amber-500/20' },
  pulse: { label: 'Pulse', color: 'text-emerald-400', bg: 'bg-emerald-500/15 border-emerald-500/20' },
  catalysts: { label: 'Catalysts', color: 'text-blue-400', bg: 'bg-blue-500/15 border-blue-500/20' },
  mind: { label: 'Mind', color: 'text-violet-400', bg: 'bg-violet-500/15 border-violet-500/20' },
  memory: { label: 'Memory', color: 'text-pink-400', bg: 'bg-pink-500/15 border-pink-500/20' },
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
