import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="block text-sm font-medium t-secondary">{label}</label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-xl px-3 py-2.5 text-sm backdrop-blur-sm',
            'focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)]',
            'transition-all duration-200',
            error && 'border-red-500/30 focus:ring-red-500/20',
            className
          )}
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
          {...props}
        />
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
