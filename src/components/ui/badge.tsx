import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: 'bg-[var(--bg-secondary)] t-secondary border-[var(--border-card)]',
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  warning: 'bg-amber-50 text-amber-700 border-amber-200',
  danger: 'bg-red-50 text-red-700 border-red-200',
  info: 'bg-[var(--accent-subtle)] text-[var(--accent)] border-[var(--accent-glow)]',
  outline: 'bg-transparent border-[var(--border-card)] t-muted',
};

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-md border font-medium',
      size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2 py-0.5 text-xs',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}
