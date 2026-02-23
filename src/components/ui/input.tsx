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
          <label className="block text-sm font-medium text-neutral-300">{label}</label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg bg-neutral-800/60 border border-neutral-700 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500',
            'focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/50',
            'transition-all duration-200',
            error && 'border-red-500/50 focus:ring-red-500/40',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>
    );
  }
);

Input.displayName = 'Input';
