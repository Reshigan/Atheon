/**
 * AtheonClient unit tests — exercise the public surface against a mock
 * fetch implementation. No live API calls.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { AtheonClient, AtheonApiError } from './client.js';

const BASE = 'https://atheon-test.example.com';
const TOKEN = 'test-token-123';

interface MockCall {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

function makeMockFetch(responses: Array<{ status: number; body: unknown; headers?: Record<string, string> }>) {
  const calls: MockCall[] = [];
  let i = 0;
  const fn: typeof fetch = async (input, init) => {
    const r = responses[i++];
    if (!r) throw new Error(`Mock fetch ran out of responses (call ${i})`);
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({
      url,
      method: init?.method ?? 'GET',
      body: init?.body as string | undefined,
      headers: Object.fromEntries(Object.entries(init?.headers ?? {})) as Record<string, string>,
    });
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { 'Content-Type': 'application/json', ...(r.headers ?? {}) },
    });
  };
  return { fn, calls };
}

describe('AtheonClient construction', () => {
  it('throws when baseUrl is missing', () => {
    expect(() => new AtheonClient({ baseUrl: '' })).toThrow(/baseUrl/);
  });

  it('strips trailing slash from baseUrl', () => {
    const client = new AtheonClient({ baseUrl: 'https://x.example.com/' });
    expect((client as unknown as { baseUrl: string }).baseUrl).toBe('https://x.example.com');
  });
});

describe('AtheonClient request envelope', () => {
  let client: AtheonClient;
  let mock: ReturnType<typeof makeMockFetch>;

  beforeEach(() => {
    mock = makeMockFetch([
      { status: 200, body: { overall: 78, trend: 'up', dimensions: {}, updatedAt: '2026-04-30T00:00:00Z' } },
    ]);
    client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: mock.fn });
  });

  it('attaches the bearer token to every request', async () => {
    await client.apex.health();
    expect(mock.calls[0]?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });

  it('uses the configured baseUrl', async () => {
    await client.apex.health();
    expect(mock.calls[0]?.url.startsWith(`${BASE}/api/apex/health`)).toBe(true);
  });

  it('does not send a body on GET requests', async () => {
    await client.apex.health();
    expect(mock.calls[0]?.body).toBeUndefined();
  });
});

describe('AtheonClient error mapping', () => {
  it('throws AtheonApiError on non-2xx with the parsed body and request id', async () => {
    const mock = makeMockFetch([
      {
        status: 401,
        body: { error: 'Unauthorized' },
        headers: { 'X-Request-ID': 'req-abc-123' },
      },
    ]);
    const client = new AtheonClient({ baseUrl: BASE, fetchImpl: mock.fn });
    try {
      await client.auth.me();
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(AtheonApiError);
      const apiErr = err as AtheonApiError;
      expect(apiErr.status).toBe(401);
      expect(apiErr.message).toBe('Unauthorized');
      expect(apiErr.requestId).toBe('req-abc-123');
    }
  });

  it('falls back to status text when body is non-JSON', async () => {
    const mock = makeMockFetch([{ status: 502, body: 'gateway plain text' }]);
    const client = new AtheonClient({ baseUrl: BASE, fetchImpl: mock.fn });
    try {
      await client.auth.me();
    } catch (err) {
      const apiErr = err as AtheonApiError;
      expect(apiErr.status).toBe(502);
      expect(apiErr.message).toMatch(/HTTP 502/);
    }
  });
});

describe('AtheonClient endpoint surface', () => {
  it('apex.createScenario sends a POST with a JSON body', async () => {
    const mock = makeMockFetch([{ status: 201, body: { id: 's-1' } }]);
    const client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: mock.fn });
    const res = await client.apex.createScenario({
      title: 'Top-3 churn',
      description: 'What if the top 3 customers churn',
      input_query: '...',
      variables: ['x'],
      model_type: 'what-if',
    });
    expect(res.id).toBe('s-1');
    expect(mock.calls[0]?.method).toBe('POST');
    expect(JSON.parse(mock.calls[0]!.body!).title).toBe('Top-3 churn');
  });

  it('billing.checkout returns the Stripe session url', async () => {
    const mock = makeMockFetch([{
      status: 201,
      body: { sessionId: 'cs_1', url: 'https://stripe/checkout/cs_1', planId: 'starter', billingCycle: 'monthly' },
    }]);
    const client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: mock.fn });
    const res = await client.billing.checkout({ plan_id: 'starter', billing_cycle: 'monthly' });
    expect(res.url).toMatch(/stripe/);
  });

  it('provenance.verify hits the verify endpoint via POST', async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: { valid: true, totalEntries: 12, firstInvalidSeq: null, reason: 'ok', currentRoot: 'r' },
    }]);
    const client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: mock.fn });
    const res = await client.provenance.verify();
    expect(res.valid).toBe(true);
    expect(mock.calls[0]?.method).toBe('POST');
    expect(mock.calls[0]?.url).toContain('/api/audit/provenance/verify');
  });

  it('compliance.evidencePack passes tenant_id as a query param', async () => {
    const mock = makeMockFetch([{
      status: 200,
      body: {
        generatedAt: 'now', tenantId: 'tenant-x', generatedBy: 'u1',
        accessReviews: { activeAdminCount: 2, adminsAssignedLast90d: 0, roleChangesLast90d: 0, mfaEnabledCount: 2, activeUserCount: 5 },
        mfa: { totalUsers: 5, mfaEnabled: 2, mfaCoveragePct: 40, adminsInGracePeriod: 0, adminsExpiredGrace: 0 },
        configChanges: { changesLast30d: 0, changesLast90d: 0, topActions: [] },
        incidentResponse: { totalCriticalLast90d: 0, resolvedCriticalLast90d: 0, openCritical: 0, medianResolutionHours: null },
        deprovisioning: { deprovisionedLast90d: 0, currentlyDisabled: 0, privilegedDisabled: 0 },
        encryption: { erpEncrypted: 0, erpPlaintext: 0, totalConnections: 0 },
        auditRetention: { totalRows: 0, oldestEventAt: null, oneYearAgo: 'now-365', provenanceChainLength: 0 },
      },
    }]);
    const client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: mock.fn });
    await client.compliance.evidencePack('tenant-x');
    expect(mock.calls[0]?.url).toContain('tenant_id=tenant-x');
  });
});

describe('AtheonClient timeout', () => {
  it('aborts requests that exceed timeoutMs and throws AtheonApiError(0)', async () => {
    const slowFetch: typeof fetch = (_input, init) => {
      return new Promise((_resolve, reject) => {
        const signal = (init?.signal as AbortSignal | undefined);
        if (signal) {
          signal.addEventListener('abort', () => {
            const err = new Error('aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
        // Never resolve — simulate a hung backend.
      });
    };
    const client = new AtheonClient({ baseUrl: BASE, token: TOKEN, fetchImpl: slowFetch, timeoutMs: 50 });
    try {
      await client.apex.health();
      throw new Error('should have timed out');
    } catch (err) {
      expect(err).toBeInstanceOf(AtheonApiError);
      expect((err as AtheonApiError).status).toBe(0);
      expect((err as AtheonApiError).message).toMatch(/timed out/);
    }
  });
});

describe('AtheonClient setToken', () => {
  it('replaces the token used on subsequent requests', async () => {
    const mock = makeMockFetch([
      { status: 200, body: { id: '1', email: 'a@b.co', name: 'A', role: 'admin', tenantId: 't', permissions: [] } },
      { status: 200, body: { id: '1', email: 'a@b.co', name: 'A', role: 'admin', tenantId: 't', permissions: [] } },
    ]);
    const client = new AtheonClient({ baseUrl: BASE, token: 'old', fetchImpl: mock.fn });
    await client.auth.me();
    client.setToken('new');
    await client.auth.me();
    expect(mock.calls[0]?.headers.Authorization).toBe('Bearer old');
    expect(mock.calls[1]?.headers.Authorization).toBe('Bearer new');
  });
});
