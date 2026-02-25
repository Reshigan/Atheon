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
  indigo: 'bg-[#2a7c8c]',
  emerald: 'bg-emerald-500',
  amber: 'bg-[#2a7c8c]',
  red: 'bg-red-500',
  blue: 'bg-[#2a7c8c]',
  cyan: 'bg-[#2a7c8c]',
};

const sizeClasses: Record<string, string> = {
  sm: 'h-1',
  md: 'h-2',
  lg: 'h-3',
};

export function Progress({ value, max = 100, color = 'blue', size = 'md', showLabel, className }: ProgressProps) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className={cn('w-full', className)}>
      {showLabel && (
        <div className="flex justify-between text-xs t-secondary mb-1">
          <span>{value}</span>
          <span>{max}</span>
        </div>
      )}
      <div className={cn('w-full rounded-full overflow-hidden', sizeClasses[size])}>
        <div
          className={cn('h-full rounded-full transition-all duration-500 ease-out', colorClasses[color])}
          style={{ width: `${percentage}%` }}
        />
      </div>
    </div>
  );
}
