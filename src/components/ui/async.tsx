/**
 * <AsyncPageContent> — single render-state wrapper for data-driven panels.
 *
 * Replaces the ~25-page hand-rolled pattern:
 *
 *   if (loading) return <LoadingState variant="cards" count={4} />;
 *   if (error && !data) return <ErrorState error={error} onRetry={load} />;
 *   if (!data || data.length === 0) return <EmptyState title="…" />;
 *   return <RealContent />;
 *
 * with a single declarative prop surface that composes the existing
 * LoadingState / ErrorState / EmptyState primitives.
 *
 * Usage:
 *
 *   const status: AsyncStatus =
 *     loading ? 'loading'
 *     : error  ? 'error'
 *     : !rows.length ? 'empty'
 *     : 'success';
 *
 *   <AsyncPageContent
 *     status={status}
 *     error={error}
 *     onRetry={load}
 *     loadingVariant="cards"
 *     loadingCount={6}
 *     emptyState={{ title: 'No runs yet', description: '…', icon: Inbox }}
 *   >
 *     <RealContent rows={rows} />
 *   </AsyncPageContent>
 *
 * Notes:
 *   - When `error` is non-null AND no data is yet rendered (status==='error'),
 *     we surface inline ErrorState. Pages that prefer toast errors should
 *     leave status on 'success' or 'empty' once stale data exists — this
 *     wrapper deliberately does not steal toast errors.
 *   - 'idle' renders the same skeleton as 'loading' so pages that mount
 *     pre-fetch can still reserve space.
 *   - `loadingCount` and `loadingVariant` are forwarded to <LoadingState>.
 */
import type { ReactNode } from "react";
import {
  LoadingState,
  ErrorState,
  EmptyState,
  type LoadingVariant,
  type EmptyStateProps,
} from "./state";

export type AsyncStatus = 'idle' | 'loading' | 'success' | 'error' | 'empty';

export interface AsyncPageContentProps {
  status: AsyncStatus;
  error?: Error | string | null;
  onRetry?: () => void;
  loadingVariant?: LoadingVariant;
  loadingCount?: number;
  /** Forwarded to <LoadingState variant="table" />. */
  loadingColumns?: number;
  /** Forwarded to <LoadingState variant="inline" />. */
  loadingLabel?: string;
  /** When status==='error', overrides ErrorState's default "Couldn't load". */
  errorTitle?: string;
  /** When status==='empty', the EmptyState payload. Omit to render nothing. */
  emptyState?: Omit<EmptyStateProps, 'className'>;
  /** Rendered on status==='success'. */
  children: ReactNode;
  className?: string;
}

export function AsyncPageContent({
  status,
  error,
  onRetry,
  loadingVariant = 'cards',
  loadingCount = 4,
  loadingColumns = 4,
  loadingLabel,
  errorTitle,
  emptyState,
  children,
  className = '',
}: AsyncPageContentProps) {
  if (status === 'idle' || status === 'loading') {
    return (
      <LoadingState
        variant={loadingVariant}
        count={loadingCount}
        columns={loadingColumns}
        label={loadingLabel}
        className={className}
      />
    );
  }

  if (status === 'error') {
    return (
      <ErrorState
        error={error}
        onRetry={onRetry}
        title={errorTitle}
        className={className}
      />
    );
  }

  if (status === 'empty') {
    if (!emptyState) return null;
    return <EmptyState {...emptyState} className={className} />;
  }

  return <>{children}</>;
}

/**
 * Helper that derives an `AsyncStatus` from the three booleans every
 * data-fetch hook already exposes. Saves the verbose ternary at every
 * call site.
 */
export function statusFrom({
  loading,
  error,
  isEmpty,
}: {
  loading: boolean;
  error: unknown;
  isEmpty: boolean;
}): AsyncStatus {
  if (loading) return 'loading';
  if (error) return 'error';
  if (isEmpty) return 'empty';
  return 'success';
}
