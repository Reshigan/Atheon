/**
 * Roadmap C2 — coverage uplift.
 *
 * retry.ts wraps fetch and arbitrary async fns with exponential backoff +
 * jitter and honours Retry-After. Bugs here are silent — the request
 * either retries too aggressively or not enough. Cover both happy paths
 * and the boundary conditions.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWithRetry, withRetry } from '../retry';

describe('fetchWithRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Pin jitter so delay math is deterministic
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately on a 2xx response', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const res = await fetchWithRetry('https://example.test/ok');
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not retry a non-retryable 4xx', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('nope', { status: 400 }));
    const res = await fetchWithRetry('https://example.test/bad');
    expect(res.status).toBe(400);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 503 then returns success', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const onRetry = vi.fn();
    const promise = fetchWithRetry('https://example.test/flaky', undefined, { baseDelayMs: 10, onRetry });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toBe(1);
  });

  it('honours Retry-After with a seconds value', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('slow', { status: 429, headers: { 'Retry-After': '2' } }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const promise = fetchWithRetry('https://example.test/throttled', undefined, { baseDelayMs: 10 });
    // After 1.9s the retry should not have fired yet; advance to 2.1s and it does
    await vi.advanceTimersByTimeAsync(1900);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(300);
    const res = await promise;
    expect(res.status).toBe(200);
  });

  it('returns the last response after exhausting retries', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('busy', { status: 503 }));
    const promise = fetchWithRetry('https://example.test/down', undefined, { maxRetries: 2, baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    const res = await promise;
    expect(res.status).toBe(503);
    // 1 initial + 2 retries = 3 calls
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors and eventually rethrows', async () => {
    const networkErr = new TypeError('Failed to fetch');
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(networkErr);
    const promise = fetchWithRetry('https://example.test/dns', undefined, { maxRetries: 2, baseDelayMs: 1 });
    // The promise will reject — pre-attach a catcher so unhandled rejections
    // don't surface while we run timers.
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect(err).toBe(networkErr);
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });
});

describe('withRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('returns immediately on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await withRetry(fn, { baseDelayMs: 1 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries until success', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('boom'))
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue('ok');
    const promise = withRetry(fn, { baseDelayMs: 1 });
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('stops retrying when shouldRetry returns false', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('not-retryable'));
    const promise = withRetry(fn, { baseDelayMs: 1, shouldRetry: () => false });
    // Pre-catch to suppress unhandled rejection during fake-timer drain
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect((err as Error).message).toBe('not-retryable');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('throws after exhausting maxRetries', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('always-fails'));
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 1 });
    const caught = promise.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await caught;
    expect((err as Error).message).toBe('always-fails');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});
