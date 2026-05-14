import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary — catches render errors and shows a fallback UI
 * instead of crashing the entire application.
 *
 * Stitch-styled fallback: centred card on the body radial-gradient, sage
 * bordered icon tile, headline-xl title, body copy, two CTAs ("Try Again"
 * to clear the error state in-place, "Reload Page" to fetch a fresh
 * bundle — useful when the cause was a stale-cache chunk-load failure
 * that the lazyWithRetry guard already burned its one reload on).
 *
 * Special-cases chunk-load errors: we surface the dedicated "we just
 * shipped an update" copy so the user understands why and what to do.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      const msg = this.state.error?.message ?? '';
      const isChunkError =
        msg.includes('Failed to fetch dynamically imported module') ||
        msg.includes('Importing a module script failed') ||
        msg.includes('Loading chunk') ||
        /ChunkLoadError/i.test(msg);

      const title = isChunkError ? 'A fresh build is available' : 'Something went wrong';
      const body = isChunkError
        ? "We just shipped an update and your browser is still holding the previous version. Reload to fetch the latest assets."
        : (this.state.error?.message || 'An unexpected error occurred while rendering this section.');

      return (
        <div
          className="min-h-[60vh] flex items-center justify-center px-4 sm:px-6 py-10"
          style={{
            background: 'var(--bg-primary)',
            backgroundImage: 'radial-gradient(circle at 50% 0%, rgba(163, 177, 138, 0.06) 0%, transparent 70%)',
          }}
        >
          <div
            className="w-full max-w-md rounded-2xl p-7 sm:p-8 text-center"
            style={{
              background: 'var(--bg-card-solid)',
              border: '1px solid var(--border-card)',
              boxShadow: 'var(--shadow-card)',
            }}
            role="alert"
          >
            <div className="flex flex-col items-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 border"
                style={{
                  background: isChunkError ? 'rgba(163, 177, 138, 0.10)' : 'rgba(251, 191, 36, 0.10)',
                  borderColor: isChunkError ? 'rgba(163, 177, 138, 0.25)' : 'rgba(251, 191, 36, 0.30)',
                }}
                aria-hidden="true"
              >
                <span
                  className="material-symbols-outlined"
                  style={{
                    fontVariationSettings: "'FILL' 0, 'wght' 500, 'GRAD' 0, 'opsz' 24",
                    fontSize: 28,
                    color: isChunkError ? 'var(--accent)' : '#FBBF24',
                    lineHeight: 1,
                  }}
                >
                  {isChunkError ? 'cloud_download' : 'report'}
                </span>
              </div>

              <h2 className="text-headline-xl font-bold t-primary tracking-tight leading-tight mb-3">{title}</h2>
              <p className="text-body-sm t-muted max-w-sm leading-relaxed">{body}</p>

              <div className="mt-6 w-full flex flex-col sm:flex-row gap-2 sm:justify-center">
                <button
                  type="button"
                  onClick={() => {
                    // Drop the chunk-reload guard so the next stale-cache
                    // event can self-heal again, then hard-reload.
                    if (typeof window !== 'undefined') {
                      window.sessionStorage.removeItem('atheon:chunk-reloaded');
                      window.location.reload();
                    }
                  }}
                  className="px-4 py-2 rounded-lg text-body-sm font-medium text-white transition-colors hover:opacity-90"
                  style={{ background: 'var(--accent)' }}
                >
                  {isChunkError ? 'Reload now' : 'Reload page'}
                </button>
                {!isChunkError && (
                  <button
                    type="button"
                    onClick={() => this.setState({ hasError: false, error: null })}
                    className="px-4 py-2 rounded-lg text-body-sm font-medium t-secondary transition-colors hover:t-primary hover:bg-[var(--bg-secondary)] border border-[var(--border-card)]"
                  >
                    Try again
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
