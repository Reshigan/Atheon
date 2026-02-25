import { cn } from "@/lib/utils";
import type { AtheonLayer } from "@/types";

const layerConfig: Record<string, { label: string; color: string; bg: string }> = {
  apex: { label: 'Apex', color: 'text-indigo-500', bg: 'bg-indigo-500/10 border-indigo-500/20' },
  pulse: { label: 'Pulse', color: 'text-emerald-500', bg: 'bg-emerald-500/10 border-emerald-500/20' },
  catalysts: { label: 'Catalysts', color: 'text-violet-500', bg: 'bg-violet-500/10 border-violet-500/20' },
  mind: { label: 'Mind', color: 'text-purple-500', bg: 'bg-purple-500/10 border-purple-500/20' },
  memory: { label: 'Memory', color: 'text-pink-500', bg: 'bg-pink-500/10 border-pink-500/20' },
  'control-plane': { label: 'Control Plane', color: 'text-blue-500', bg: 'bg-blue-500/10 border-blue-500/20' },
  erp: { label: 'ERP', color: 'text-orange-500', bg: 'bg-orange-500/10 border-orange-500/20' },
  iam: { label: 'IAM', color: 'text-cyan-500', bg: 'bg-cyan-500/10 border-cyan-500/20' },
  connectivity: { label: 'Connectivity', color: 'text-teal-500', bg: 'bg-teal-500/10 border-teal-500/20' },
  audit: { label: 'Audit', color: 'text-slate-500', bg: 'bg-slate-500/10 border-slate-500/20' },
  system: { label: 'System', color: 'text-zinc-500', bg: 'bg-zinc-500/10 border-zinc-500/20' },
};

const defaultConfig = { label: 'Unknown', color: 'text-zinc-500', bg: 'bg-zinc-500/10 border-zinc-500/20' };

interface LayerBadgeProps {
  layer: AtheonLayer | string;
  className?: string;
}

export function LayerBadge({ layer, className }: LayerBadgeProps) {
  const config = layerConfig[layer] || { ...defaultConfig, label: layer };
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border',
      config.bg, config.color,
      className
    )}>
      <span className={cn('w-1 h-1 rounded-full', config.color.replace('text-', 'bg-'))} />
      {config.label}
    </span>
  );
}
