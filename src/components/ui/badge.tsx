import { cn } from "@/lib/utils";
import { type ReactNode } from "react";

interface BadgeProps {
  children: ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'outline';
  size?: 'sm' | 'md';
  className?: string;
}

const variantClasses: Record<string, string> = {
  default: 'pill-muted',
  success: 'pill-success',
  warning: 'pill-warning',
  danger: 'pill-danger',
  info: 'pill-accent',
  outline: 'bg-transparent border-[var(--border-card)] t-muted',
};

export function Badge({ children, variant = 'default', size = 'sm', className }: BadgeProps) {
  return (
    <span className={cn(
      'inline-flex items-center rounded-sm border font-medium font-mono',
      size === 'sm' ? 'px-1.5 py-0.5 text-caption' : 'px-2 py-0.5 text-xs',
      variantClasses[variant],
      className
    )}>
      {children}
    </span>
  );
}
