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
            'focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-glow)]',
            'transition-[border-color,box-shadow] duration-150',
            '[transition-timing-function:var(--ease-out)]',
            'placeholder:text-[var(--placeholder)]',
            error && 'focus:ring-[rgba(255,107,107,.25)]',
            className
          )}
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: error ? '1px solid var(--critical)' : '1px solid var(--border-card)',
          }}
          {...props}
        />
        {error && <p className="text-caption text-red-500">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
