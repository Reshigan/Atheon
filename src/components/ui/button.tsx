import { cn } from "@/lib/utils";
import { type ReactNode, type ButtonHTMLAttributes } from "react";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'success';
  size?: 'sm' | 'md' | 'lg';
}

const variants: Record<string, string> = {
  primary: 'bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 text-white shadow-lg shadow-cyan-500/15',
  secondary: 'bg-white/[0.06] hover:bg-white/[0.1] text-gray-300 border border-white/[0.08] backdrop-blur-sm',
  ghost: 'bg-transparent hover:bg-white/[0.06] text-gray-400 hover:text-gray-200',
  danger: 'bg-red-500/10 hover:bg-red-500/15 text-red-400 border border-red-500/20 backdrop-blur-sm',
  success: 'bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 backdrop-blur-sm',
};

const sizes: Record<string, string> = {
  sm: 'px-3 py-1.5 text-xs',
  md: 'px-4 py-2 text-sm',
  lg: 'px-6 py-3 text-base',
};

export function Button({ children, variant = 'primary', size = 'md', className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500/40 disabled:opacity-50 disabled:cursor-not-allowed',
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}
