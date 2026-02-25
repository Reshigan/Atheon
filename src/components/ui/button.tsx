import { cn } from "@/lib/utils";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

const variants: Record<string, string> = {
  primary: 'text-white shadow-lg',
  secondary: 'bg-[var(--bg-input)] hover:bg-[var(--bg-input-focus)] t-secondary border border-[var(--border-card)] backdrop-blur-sm',
  ghost: 'bg-transparent hover:bg-[var(--accent-subtle)] t-muted hover:t-primary',
  danger: 'bg-red-500/10 hover:bg-red-500/15 text-red-400 border border-red-500/20 backdrop-blur-sm',
  success: 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 backdrop-blur-sm',
};

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({ children, variant = 'primary', size = 'md', className, style, ...props }: ButtonProps) {
  const mergedStyle = variant === 'primary'
    ? { background: 'var(--accent)', boxShadow: '0 4px 14px var(--accent-glow)', ...style }
    : style;
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90',
        variants[variant],
        sizes[size],
        className
      )}
      style={mergedStyle}
      {...props}
    >
      {children}
    </button>
  );
}
