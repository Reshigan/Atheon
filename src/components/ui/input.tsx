import { cn } from "@/lib/utils";
import { type InputHTMLAttributes, forwardRef } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, className, ...props }, ref) => {
    return (
      <div className="space-y-1">
        {label && (
          <label className="block text-xs font-medium t-secondary">{label}</label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-[var(--ring-focus)] focus:ring-offset-1',
            'transition-all duration-150',
            'placeholder:text-[var(--placeholder)]',
            error && 'border-red-300 focus:ring-red-200',
            className
          )}
          style={{ background: 'var(--bg-input)', color: 'var(--text-primary)', border: '1px solid var(--border-card)' }}
          {...props}
        />
        {error && <p className="text-[10px] text-red-600">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
