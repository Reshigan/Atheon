/**
 * <Button> — the canonical pressable in Atheon.
 *
 * Design notes:
 *  - Transitions only `transform`, `background`, `color`, `box-shadow`, `opacity`
 *    so animations stay on the compositor. `transition: all` was the prior
 *    sin — it animates layout properties and tanks scroll perf.
 *  - `:active` scales to 0.97 with the press duration (120ms ease-out) so
 *    the UI feels like it's listening. Subtle enough to not distract,
 *    sharp enough to feel responsive.
 *  - Disabled state removes the press feedback and the hover so the
 *    button visibly does nothing — the worst pattern is a disabled button
 *    that still depresses.
 *  - `loading` collapses content into a spinner without changing button
 *    width (we measure with a hidden content layer at opacity 0). Stops
 *    the layout jolt that plagues async forms.
 */
import { cn } from "@/lib/utils";
import { type ReactNode, type ButtonHTMLAttributes, forwardRef } from "react";
import { Loader2 } from "lucide-react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode;
  variant?: 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'success' | 'outline';
  size?: 'sm' | 'md' | 'lg';
  /** Show a spinner instead of children, but preserve width. */
  loading?: boolean;
  /** Leading icon — sized + spaced to match the chosen size. */
  leading?: ReactNode;
  /** Trailing icon — sized + spaced to match the chosen size. */
  trailing?: ReactNode;
}

// Swiss: the default primary action is ink-filled — the accent is reserved
// for brand/positive emphasis (`accent` variant) so green stays meaningful.
const variants: Record<string, string> = {
  primary:   'text-[var(--bg-primary)] hover:opacity-90',
  accent:    'text-[var(--text-on-accent)] hover:opacity-90',
  secondary: 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-input-focus)] t-primary border border-[var(--border-card)]',
  ghost:     'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary hover:t-primary',
  danger:    'bg-[rgb(var(--neg-rgb)/0.10)] hover:bg-[rgb(var(--neg-rgb)/0.16)] text-[var(--neg)] border border-[rgb(var(--neg-rgb)/0.30)]',
  success:   'bg-[rgb(var(--accent-rgb)/0.10)] hover:bg-[rgb(var(--accent-rgb)/0.16)] text-[var(--accent)] border border-[rgb(var(--accent-rgb)/0.30)]',
  outline:   'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary border border-[var(--border-card)]',
};

const sizes: Record<string, string> = {
  sm: 'px-2.5 py-1.5 text-xs gap-1',
  md: 'px-3.5 py-2 text-sm gap-1.5',
  lg: 'px-5 py-2.5 text-sm gap-2',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { children, variant = 'primary', size = 'md', loading, leading, trailing, className, style, disabled, ...props },
  ref,
) {
  const mergedStyle: React.CSSProperties =
    variant === 'primary' ? { background: 'var(--text-primary)', ...style }
    : variant === 'accent' ? { background: 'var(--accent)', ...style }
    : (style ?? {});

  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      disabled={isDisabled}
      className={cn(
        'relative inline-flex items-center justify-center rounded font-medium',
        'focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-primary)]',
        'disabled:cursor-not-allowed disabled:opacity-50',
        // Motion: only compositor-friendly properties; press feedback on :active
        'transition-[transform,background-color,color,box-shadow,opacity] duration-150',
        '[transition-timing-function:var(--ease-out)]',
        !isDisabled && 'active:scale-[0.97]',
        variants[variant],
        sizes[size],
        className
      )}
      style={mergedStyle}
      {...props}
    >
      {loading ? (
        <>
          <span aria-hidden="true" className="invisible inline-flex items-center gap-[inherit]">
            {leading}
            {children}
            {trailing}
          </span>
          <span className="absolute inset-0 inline-flex items-center justify-center">
            <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
          </span>
        </>
      ) : (
        <>
          {leading}
          {children}
          {trailing}
        </>
      )}
    </button>
  );
});
