/**
 * U12/M4: Skeleton loading component for progressive loading states
 */
interface SkeletonProps {
  className?: string;
  width?: string | number;
  height?: string | number;
  rounded?: 'sm' | 'md' | 'lg' | 'xl' | 'full';
}

export function Skeleton({ className = '', width, height, rounded = 'md' }: SkeletonProps) {
  const roundedClass = {
    sm: 'rounded-sm',
    md: 'rounded-md',
    lg: 'rounded-lg',
    xl: 'rounded-xl',
    full: 'rounded-full',
  }[rounded];

  return (
    <div
      className={`animate-pulse bg-[var(--bg-secondary)] ${roundedClass} ${className}`}
      style={{ width, height }}
    />
  );
}

export function SkeletonCard({ className = '' }: { className?: string }) {
  return (
    <div
      className={`rounded-xl p-5 space-y-3 ${className}`}
      style={{ background: 'var(--bg-card-solid)', border: '1px solid var(--border-card)' }}
    >
      <Skeleton height={12} width="40%" />
      <Skeleton height={28} width="60%" />
      <Skeleton height={10} width="80%" />
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 4 }: { rows?: number; cols?: number }) {
  return (
    <div className="space-y-2">
      <div className="flex gap-4 pb-2 border-b border-[var(--border-card)]">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} height={12} className="flex-1" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-4 py-2">
          {Array.from({ length: cols }).map((_, c) => (
            <Skeleton key={c} height={10} className="flex-1" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Skeleton width={40} height={40} rounded="xl" />
          <div className="space-y-2">
            <Skeleton width={180} height={16} />
            <Skeleton width={120} height={10} />
          </div>
        </div>
        <div className="flex gap-2">
          <Skeleton width={200} height={36} rounded="lg" />
          <Skeleton width={32} height={32} rounded="lg" />
        </div>
      </div>
      {/* Cards Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <div className="lg:col-span-5 space-y-5">
          <SkeletonCard />
          <div className="grid grid-cols-2 gap-4">
            <SkeletonCard />
            <SkeletonCard />
          </div>
          <SkeletonCard className="h-48" />
        </div>
        <div className="lg:col-span-7 space-y-5">
          <SkeletonCard className="h-64" />
          <div className="grid grid-cols-2 gap-4">
            <SkeletonCard className="h-40" />
            <SkeletonCard className="h-40" />
          </div>
        </div>
      </div>
    </div>
  );
}
