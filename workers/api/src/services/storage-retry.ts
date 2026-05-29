/**
 * Retry a transient storage failure (D1 / KV) a couple of times before giving up.
 *
 * A cold or freshly-deployed worker isolate intermittently throws on its first
 * D1/KV binding access under a burst of concurrent requests — the call recovers
 * a few hundred ms later once the isolate is warm. Without this, that single
 * flake bubbles to the global error handler as a 500, which the user sees as
 * "lots of errors, then it works on retry" right after a deploy.
 *
 * ONLY wrap idempotent operations (reads, or writes that are safe to repeat).
 * A retried INSERT/UPDATE can double-apply if the first attempt actually
 * committed before the connection dropped, so mutating calls must NOT use this.
 */
const DEFAULT_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function withStorageRetry<T>(
  op: () => Promise<T>,
  attempts: number = DEFAULT_ATTEMPTS,
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await op();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts) await sleep(attempt * 100);
    }
  }
  throw lastErr;
}
