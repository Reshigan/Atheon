import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: 'bg-[var(--bg-input)] t-secondary border-[var(--border-card)]',
  success: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  warning: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  danger: 'bg-red-500/10 text-red-400 border-red-500/20',
  info: 'bg-[#2a7c8c]/10 text-[#2a7c8c] border-[#2a7c8c]/20',
  outline: 'bg-transparent border-[var(--border-subtle)] t-muted',
};

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-full border font-medium',
      size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}
