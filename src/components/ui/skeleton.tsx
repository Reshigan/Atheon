// TASK-012: Skeleton loading states for all data-driven pages
import { type HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: 'text' | 'circular' | 'rectangular' | 'card';
  width?: string | number;
  height?: string | number;
  lines?: number;
}

export function Skeleton({ variant = 'text', width, height, lines = 1, className = '', ...props }: SkeletonProps) {
  const baseClass = 'animate-pulse bg-[var(--bg-secondary)] rounded';
  
  if (variant === 'circular') {
    return (
      <div
        className={`${baseClass} rounded-full ${className}`}
        style={{ width: width || 40, height: height || 40 }}
        role="status"
        aria-label="Loading"
        {...props}
      />
    );
  }

  if (variant === 'card') {
    return (
      <div className={`${baseClass} rounded-md ${className}`} style={{ width: width || '100%', height: height || 120 }} role="status" aria-label="Loading" {...props} />
    );
  }

  if (variant === 'rectangular') {
    return (
      <div className={`${baseClass} ${className}`} style={{ width: width || '100%', height: height || 40 }} role="status" aria-label="Loading" {...props} />
    );
  }

  // Text variant
  if (lines > 1) {
    return (
      <div className={`space-y-2 ${className}`} role="status" aria-label="Loading">
        {Array.from({ length: lines }).map((_, i) => (
          <div
            key={i}
            className={baseClass}
            style={{
              width: i === lines - 1 ? '75%' : width || '100%',
              height: height || 16,
            }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className={`${baseClass} ${className}`} style={{ width: width || '100%', height: height || 16 }} role="status" aria-label="Loading" {...props} />
  );
}

// Dashboard skeleton
export function DashboardSkeleton() {
  return (
    <div className="space-y-6 p-6" role="status" aria-label="Loading dashboard">
      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="p-4 rounded-md bg-[var(--bg-card)] border border-[var(--border-card)]">
            <Skeleton width="60%" height={14} className="mb-2" />
            <Skeleton width="40%" height={28} className="mb-3" />
            <Skeleton width="80%" height={12} />
          </div>
        ))}
      </div>
      {/* Chart area */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Skeleton variant="card" height={280} />
        <Skeleton variant="card" height={280} />
      </div>
      {/* Table */}
      <Skeleton variant="card" height={320} />
    </div>
  );
}

// Table skeleton
export function TableSkeleton({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <div className="space-y-3" role="status" aria-label="Loading table">
      {/* Header */}
      <div className="flex gap-4 p-3">
        {Array.from({ length: columns }).map((_, i) => (
          <Skeleton key={i} width={`${100 / columns}%`} height={14} />
        ))}
      </div>
      {/* Rows */}
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-4 p-3 rounded bg-[var(--bg-card)]">
          {Array.from({ length: columns }).map((_, j) => (
            <Skeleton key={j} width={`${100 / columns}%`} height={16} />
          ))}
        </div>
      ))}
    </div>
  );
}

// Card list skeleton
export function CardListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-4" role="status" aria-label="Loading">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="p-4 rounded-md bg-[var(--bg-card)] border border-[var(--border-card)]">
          <div className="flex items-center gap-3 mb-3">
            <Skeleton variant="circular" width={36} height={36} />
            <div className="flex-1">
              <Skeleton width="50%" height={16} className="mb-1" />
              <Skeleton width="30%" height={12} />
            </div>
          </div>
          <Skeleton lines={2} />
        </div>
      ))}
    </div>
  );
}
