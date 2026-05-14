/**
 * `lazyWithRetry` — drop-in replacement for `React.lazy` that recovers from
 * stale-bundle chunk-load failures.
 *
 * The problem: when you deploy a new build, Vite content-hashes every chunk
 * (`ApexPage-OLDHASH.js` → `ApexPage-NEWHASH.js`). A user who has the OLD
 * `index-*.js` cached in their browser still has the OLD hashes baked into
 * their JS — so when they navigate to a lazy-loaded route, the browser
 * tries to fetch `ApexPage-OLDHASH.js`, gets a 404, and React surfaces
 * "Failed to fetch dynamically imported module" / "Importing a module
 * script failed". The user sees the ErrorBoundary fallback.
 *
 * The fix: on dynamic-import failure, set a sessionStorage flag and force
 * `window.location.reload()` once. The reload fetches a fresh `index.html`,
 * which references the NEW chunk hashes, and the user lands on the page
 * they were trying to reach.
 *
 * The sessionStorage flag prevents an infinite reload loop in the (rare)
 * case where the chunk really is broken in production.
 */
import { lazy } from 'react';
import type { ComponentType } from 'react';

const RELOAD_FLAG = 'atheon:chunk-reloaded';

function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  if (typeof message !== 'string') return false;
  return (
    message.includes('Failed to fetch dynamically imported module') ||
    message.includes('Importing a module script failed') ||
    message.includes('Loading chunk') ||
    message.includes('Loading CSS chunk') ||
    /ChunkLoadError/i.test(message)
  );
}

export function lazyWithRetry<T extends ComponentType<any>>(  // eslint-disable-line @typescript-eslint/no-explicit-any
  factory: () => Promise<{ default: T }>,
): ReturnType<typeof lazy<T>> {
  return lazy(async () => {
    try {
      return await factory();
    } catch (err) {
      if (isChunkLoadError(err)) {
        // First failure → force one fresh fetch of index.html.
        if (typeof window !== 'undefined' && !window.sessionStorage.getItem(RELOAD_FLAG)) {
          window.sessionStorage.setItem(RELOAD_FLAG, '1');
          window.location.reload();
          // Hang the promise — the reload navigates away before this resolves.
          return new Promise<never>(() => { /* never resolves */ });
        }
      }
      // Genuine failure (or we already retried) — bubble to ErrorBoundary.
      throw err;
    }
  });
}

/** Clear the reload guard once a chunk has successfully loaded. Call from
 *  the AppLayout after the first render so subsequent stale-cache scenarios
 *  (e.g. a second deploy mid-session) can self-heal too. */
export function clearChunkReloadGuard(): void {
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(RELOAD_FLAG);
  }
}
