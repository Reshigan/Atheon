/**
 * State primitives — LoadingState / ErrorState / EmptyState.
 *
 * One canonical way to render the three render states every data-driven
 * page has. Replaces ~80 ad-hoc `{loading ? <Loader2/> : null}` patterns,
 * inline error divs, and silent empty states scattered across pages.
 *
 * Usage:
 *
 *   if (loading) return <LoadingState variant="cards" count={4} />;
 *   if (error && !data) return <ErrorState error={error} onRetry={load} />;
 *   if (!data || data.length === 0) return <EmptyState title="No runs yet" />;
 *   return <RealContent data={data} />;
 *
 * Variants:
 *   LoadingState — `inline` (spinner + label), `cards` (skeleton grid),
 *                  `table` (skeleton rows), `list` (skeleton card stack),
 *                  `page` (the big DashboardSkeleton layout)
 *
 *   ErrorState   — icon + message + optional Retry. Always quiet (no
 *                  decorative borders) so it doesn't compete with the
 *                  real content.
 *
 *   EmptyState   — icon + title + optional description + optional CTA.
 *                  Quiet by default; use `variant="hero"` for
 *                  first-time-experience screens.
 */
import { Loader2, AlertCircle, Inbox, RefreshCw } from "lucide-react";
import {
  Skeleton,
  DashboardSkeleton,
  TableSkeleton,
  CardListSkeleton,
} from "./skeleton";

// ─── LoadingState ────────────────────────────────────────────

export type LoadingVariant = 'inline' | 'cards' | 'table' | 'list' | 'page';

export interface LoadingStateProps {
  variant?: LoadingVariant;
  /** For `cards` and `list`: how many placeholder tiles to render. */
  count?: number;
  /** For `table`: column count. */
  columns?: number;
  /** For `inline`: optional label next to the spinner. */
  label?: string;
  className?: string;
}

export function LoadingState({
  variant = 'inline',
  count = 4,
  columns = 4,
  label,
  className = '',
}: LoadingStateProps) {
  if (variant === 'page') return <DashboardSkeleton />;
  if (variant === 'table') return <TableSkeleton rows={count} columns={columns} />;
  if (variant === 'list')  return <CardListSkeleton count={count} />;

  if (variant === 'cards') {
    return (
      <div
        className={`bento ${className}`}
        role="status"
        aria-label="Loading"
      >
        {Array.from({ length: count }).map((_, i) => (
          <div
            key={i}
            className="rounded-2xl border border-[var(--border-card)] bg-[var(--bg-card)] p-5"
          >
            <Skeleton width="60%" height={12} className="mb-2" />
            <Skeleton width="40%" height={28} className="mb-3" />
            <Skeleton width="80%" height={12} />
          </div>
        ))}
      </div>
    );
  }

  // inline — spinner + optional label
  return (
    <div
      className={`flex items-center gap-2 t-muted text-body-sm ${className}`}
      role="status"
      aria-label={label || 'Loading'}
    >
      <Loader2 size={14} className="animate-spin" />
      {label && <span>{label}</span>}
    </div>
  );
}

// ─── ErrorState ──────────────────────────────────────────────

export interface ErrorStateProps {
  /** The error to surface. Accepts an Error, string, or null (null = no message). */
  error?: Error | string | null;
  /** Optional retry callback — renders a button when provided. */
  onRetry?: () => void;
  /** Short title shown above the error message. Defaults to "Couldn't load". */
  title?: string;
  /** Make compact for inline use; default is a quiet page-level state. */
  compact?: boolean;
  className?: string;
}

export function ErrorState({
  error, onRetry, title = "Couldn't load",
  compact = false, className = '',
}: ErrorStateProps) {
  const message = error instanceof Error ? error.message : error;
  if (compact) {
    return (
      <div
        className={`flex items-center gap-2 px-3 py-2 rounded-md text-body-sm pill-danger ${className}`}
        role="alert"
      >
        <AlertCircle size={14} />
        <span className="font-medium">{title}</span>
        {message && <span className="opacity-80">— {message}</span>}
        {onRetry && (
          <button
            onClick={onRetry}
            className="ml-auto link-accent inline-flex items-center gap-1"
          >
            <RefreshCw size={12} /> Retry
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className={`flex flex-col items-center justify-center py-10 text-center ${className}`}
      role="alert"
    >
      <AlertCircle className="w-8 h-8 t-muted mb-3 opacity-50" />
      <p className="text-h2 t-primary mb-1">{title}</p>
      {message && <p className="text-body-sm t-muted max-w-md mb-4">{message}</p>}
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-sm font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
        >
          <RefreshCw size={14} /> Try again
        </button>
      )}
    </div>
  );
}

// ─── FormError ───────────────────────────────────────────────

export interface FormErrorProps {
  /** Error to surface. Falsy values render nothing — so forms can keep
   *  `<FormError error={error} />` outside conditional blocks. */
  error?: Error | string | null | false;
  className?: string;
}

/**
 * Inline form-submit error banner. Replaces the duplicated
 * `bg-red-500/10 text-red-400 border border-red-500/20` divs that grew
 * across ~20 forms. Pairs naturally with the `<input>` + `<Button>` flow
 * — drop one above the submit button.
 */
export function FormError({ error, className = '' }: FormErrorProps): JSX.Element | null {
  if (!error) return null;
  const message = error instanceof Error ? error.message : error;
  return (
    <div
      className={`flex items-start gap-2 px-3 py-2 rounded-md text-body-sm pill-danger ${className}`}
      role="alert"
    >
      <AlertCircle size={14} className="flex-shrink-0 mt-0.5" />
      <span>{message}</span>
    </div>
  );
}

// ─── EmptyState ──────────────────────────────────────────────

export interface EmptyStateProps {
  title: string;
  description?: string;
  /** Lucide icon component (size handled internally). Typed loosely
   *  because LucideIcon widens `size` to `string | number` and that
   *  doesn't unify cleanly with a narrower local prop. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  icon?: React.ComponentType<any>;
  /** Optional CTA — title + onClick. Renders a button. */
  action?: { label: string; onClick?: () => void; href?: string };
  /** `default` is quiet; `hero` is a larger first-time-experience state. */
  variant?: 'default' | 'hero';
  className?: string;
}

export function EmptyState({
  title, description, icon: Icon = Inbox,
  action, variant = 'default', className = '',
}: EmptyStateProps) {
  const padding = variant === 'hero' ? 'py-16' : 'py-10';
  const iconSize = variant === 'hero' ? 'w-12 h-12' : 'w-8 h-8';
  return (
    <div
      className={`flex flex-col items-center justify-center ${padding} text-center ${className}`}
      role="status"
    >
      <Icon className={`${iconSize} t-muted mb-3 opacity-40`} />
      <p className="text-h2 t-primary mb-1">{title}</p>
      {description && <p className="text-body-sm t-muted max-w-md">{description}</p>}
      {action && (
        action.href ? (
          <a
            href={action.href}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-sm font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
          >
            {action.label}
          </a>
        ) : (
          <button
            onClick={action.onClick}
            className="mt-4 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-body-sm font-medium bg-accent/10 text-accent border border-accent/20 hover:bg-accent/20 transition-[background-color,color,box-shadow,transform] duration-[var(--dur-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.97]"
          >
            {action.label}
          </button>
        )
      )}
    </div>
  );
}
