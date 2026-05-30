/**
 * UsageBar — compact progress-bar renderer for LLM token budget usage.
 *
 * Colour bands (per spec): green <70%, amber 70-90%, red >90%.
 * When `budget` is null the tenant is unlimited and we render a text badge
 * instead of a bar.
 */
import { cn } from "@/lib/utils";

interface UsageBarProps {
  used: number;
  /** null = unlimited */
  budget: number | null;
  /** Show the "used / budget" fraction label above the bar */
  showLabel?: boolean;
  /** Height of the bar */
  size?: 'sm' | 'md';
  className?: string;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return n.toLocaleString();
}

// eslint-disable-next-line react-refresh/only-export-components
export function usageColor(pct: number): 'emerald' | 'amber' | 'red' {
  if (pct >= 90) return 'red';
  if (pct >= 70) return 'amber';
  return 'emerald';
}

const barColorClass: Record<'emerald' | 'amber' | 'red', string> = {
  emerald: 'bg-accent',
  amber: 'bg-[var(--warning)]',
  red: 'bg-neg',
};

const textColorClass: Record<'emerald' | 'amber' | 'red', string> = {
  emerald: 'text-accent',
  amber: 'text-[var(--warning)]',
  red: 'text-neg',
};

const sizeClass: Record<'sm' | 'md', string> = {
  sm: 'h-1',
  md: 'h-1.5',
};

export function UsageBar({ used, budget, showLabel = true, size = 'md', className }: UsageBarProps) {
  if (budget === null || budget === undefined) {
    return (
      <div className={cn('flex flex-col gap-0.5', className)}>
        {showLabel && (
          <div className="flex items-center justify-between gap-2 text-caption">
            <span className="t-muted">{formatTokens(used)} tokens</span>
            <span className="text-accent font-medium">Unlimited</span>
          </div>
        )}
        {!showLabel && (
          <span className="text-caption text-accent font-medium">Unlimited</span>
        )}
      </div>
    );
  }

  const pct = budget > 0 ? Math.min((used / budget) * 100, 100) : 0;
  const color = usageColor(pct);

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      {showLabel && (
        <div className="flex items-center justify-between gap-2 text-caption">
          <span className="t-muted">
            {formatTokens(used)} / {formatTokens(budget)}
          </span>
          <span className={cn('font-medium', textColorClass[color])}>
            {pct.toFixed(0)}%
          </span>
        </div>
      )}
      <div className={cn('w-full rounded-sm overflow-hidden bg-[var(--bg-secondary)]', sizeClass[size])}>
        <div
          className={cn('h-full rounded-sm transition-all duration-500 ease-out', barColorClass[color])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
