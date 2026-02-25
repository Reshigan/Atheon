import { cn } from "@/lib/utils";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

const variants: Record<string, string> = {
  primary: 'text-white',
  secondary: 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-input-focus)] t-primary border border-[var(--border-card)]',
  ghost: 'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary hover:t-primary',
  danger: 'bg-red-50 hover:bg-red-100 text-red-700 border border-red-200',
  success: 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200',
};

const sizes: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-xs',
  md: 'px-3.5 py-2 text-sm',
  lg: 'px-5 py-2.5 text-sm',
};

export function Button({ children, variant = 'primary', size = 'md', className, style, ...props }: ButtonProps) {
  const mergedStyle = variant === 'primary'
    ? { background: 'var(--accent)', ...style }
    : style;
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] focus:ring-offset-1 disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'hover:opacity-90 shadow-sm',
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
