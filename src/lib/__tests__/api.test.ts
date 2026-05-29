/**
 * Tests for the API client's request-ID capture and typed error handling
 * (backend PR #222 — X-Request-ID middleware correlation).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ApiError, api, getLastRequestId } from '../api';
import { FRONTEND_REQUEST_ID_RE } from '../request-id';

describe('ApiError', () => {
  it('carries status, message, requestId, and optional body', () => {
    const err = new ApiError(418, 'I am a teapot', 'req-abc-123', { error: 'I am a teapot' });
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.name).toBe('ApiError');
    expect(err.status).toBe(418);
    expect(err.message).toBe('I am a teapot');
    expect(err.requestId).toBe('req-abc-123');
    expect(err.body).toEqual({ error: 'I am a teapot' });
  });

  it('accepts a null requestId (server may omit the header)', () => {
    const err = new ApiError(500, 'Server error', null);
    expect(err.requestId).toBeNull();
  });

  it('is catchable as a plain Error (backwards compat)', () => {
    let caught: Error | null = null;
    try {
      throw new ApiError(400, 'bad', 'req-1');
    } catch (e) {
      caught = e as Error;
    }
    expect(caught).not.toBeNull();
    expect(caught?.message).toBe('bad');
  });
});

describe('api fetch wrapper — request-ID capture', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    // Reset fetch mock between tests
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('sends a client-generated X-Request-ID header on outbound requests', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'srv-999' },
      }),
    );

    await api.get('/api/test');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    const headers = init.headers as Record<string, string>;
    expect(headers['X-Request-ID']).toBeDefined();
    // Client-generated id should match the fe- shape
    expect(headers['X-Request-ID']).toMatch(FRONTEND_REQUEST_ID_RE);
  });

  it('captures X-Request-ID from a successful response into getLastRequestId()', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'srv-success-456' },
      }),
    );

    await api.get('/api/test-success');
    expect(getLastRequestId()).toBe('srv-success-456');
  });

  it('throws ApiError with requestId from response when response is non-2xx', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', 'X-Request-ID': 'srv-err-789' },
      }),
    );

    let caught: unknown = null;
    try {
      await api.get('/api/missing');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(404);
    expect(err.requestId).toBe('srv-err-789');
    expect(err.message).toBe('Not found');
    // Body is preserved for debugging
    expect(err.body).toEqual({ error: 'Not found' });
  });

  it('throws ApiError with null requestId when server omits the header', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    // GETs retry transient 5xx, so the failure must persist across attempts.
    mockFetch.mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ error: 'Server blew up' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' }, // no X-Request-ID
      }),
    ));

    let caught: unknown = null;
    try {
      await api.get('/api/kaboom');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).requestId).toBeNull();
    expect((caught as ApiError).status).toBe(500);
  });

  it('falls back to res.statusText when error body is not JSON', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    // 504 is transient — a GET retries it; return it on every attempt.
    mockFetch.mockImplementation(() => Promise.resolve(
      new Response('<html>Gateway Timeout</html>', {
        status: 504,
        statusText: 'Gateway Timeout',
        headers: { 'Content-Type': 'text/html', 'X-Request-ID': 'srv-504' },
      }),
    ));

    let caught: unknown = null;
    try {
      await api.get('/api/slow');
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    const err = caught as ApiError;
    expect(err.status).toBe(504);
    expect(err.requestId).toBe('srv-504');
    // Message falls back to statusText
    expect(err.message).toBe('Gateway Timeout');
  });
});

describe('api fetch wrapper — transient cold-start retry', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('retries a transient 5xx on a GET, then resolves once the isolate is warm', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: 'cold isolate' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      );

    const result = await api.get<{ ok: boolean }>('/api/warming-up');

    expect(result).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry a mutating POST on 5xx (avoids double-submit)', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>;
    mockFetch.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: 'Server blew up' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    let caught: unknown = null;
    try {
      await api.post('/api/catalysts/actions', { foo: 'bar' });
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(ApiError);
    expect((caught as ApiError).status).toBe(500);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
