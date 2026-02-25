import { cn } from "@/lib/utils";

interface ProgressProps {
  value: number;
  max?: number;
  color?: 'indigo' | 'emerald' | 'amber' | 'red' | 'blue' | 'cyan';
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
  className?: string;
}

const colorClasses: Record<string, string> = {
  indigo: 'bg-[var(--accent)]',
  emerald: 'bg-emerald-500',
  amber: 'bg-amber-500',
  red: 'bg-red-500',
  blue: 'bg-[var(--accent)]',
  cyan: 'bg-[var(--accent)]',
};

const sizeClasses: Record<string, string> = {
  sm: 'h-1',
  md: 'h-1.5',
  lg: 'h-2',
};

export function Progress({ value, max = 100, color = 'blue', size = 'md', showLabel, className }: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);
  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="flex justify-between text-[10px] t-muted mb-1">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div className={cn('w-full rounded-full overflow-hidden bg-[var(--bg-secondary)]', sizeClasses[size])}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
