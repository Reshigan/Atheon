import { cn } from "@/lib/utils";
import type { AtheonLayer } from "@/types";

const layerConfig: Record<string, { label: string; color: string; bg: string }> = {
  apex: { label: 'Apex', color: 'text-indigo-700', bg: 'bg-indigo-50 border-indigo-200' },
  pulse: { label: 'Pulse', color: 'text-emerald-700', bg: 'bg-emerald-50 border-emerald-200' },
  catalysts: { label: 'Catalysts', color: 'text-violet-700', bg: 'bg-violet-50 border-violet-200' },
  mind: { label: 'Mind', color: 'text-purple-700', bg: 'bg-purple-50 border-purple-200' },
  memory: { label: 'Memory', color: 'text-pink-700', bg: 'bg-pink-50 border-pink-200' },
  'control-plane': { label: 'Control Plane', color: 'text-blue-700', bg: 'bg-blue-50 border-blue-200' },
  erp: { label: 'ERP', color: 'text-orange-700', bg: 'bg-orange-50 border-orange-200' },
  iam: { label: 'IAM', color: 'text-cyan-700', bg: 'bg-cyan-50 border-cyan-200' },
  connectivity: { label: 'Connectivity', color: 'text-teal-700', bg: 'bg-teal-50 border-teal-200' },
  audit: { label: 'Audit', color: 'text-slate-700', bg: 'bg-slate-50 border-slate-200' },
  system: { label: 'System', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' },
};

const defaultConfig = { label: 'Unknown', color: 'text-gray-700', bg: 'bg-gray-50 border-gray-200' };

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
