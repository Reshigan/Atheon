/**
 * Atheon SDK — main client.
 *
 * Wraps the public API surface with typed helpers. No external HTTP
 * dependencies — uses the platform `fetch` available in Node 20+, modern
 * browsers, Cloudflare Workers, Deno, and Bun.
 *
 * Usage:
 *
 *   import { AtheonClient } from '@vantax/atheon-sdk';
 *
 *   const client = new AtheonClient({
 *     baseUrl: 'https://atheon-api.vantax.co.za',
 *     token: process.env.ATHEON_TOKEN,
 *   });
 *
 *   const health = await client.apex.health();
 *   const risks  = await client.apex.risks();
 *   const root   = await client.provenance.root();
 *
 * Errors thrown by SDK calls are instances of AtheonApiError carrying the
 * HTTP status and the X-Request-ID header so support can correlate.
 */

import type {
  AuthUser, LoginResponse, HealthScore, Briefing, Risk, ScenarioItem,
  Metric, AnomalyItem, ProcessItem, ClusterItem, ActionItem,
  ProvenanceEntry, ProvenanceVerifyResult, BillingPlan, CheckoutSessionResponse,
  EvidencePack,
} from './types.js';

export class AtheonApiError extends Error {
  status: number;
  requestId: string | null;
  body: unknown;

  constructor(status: number, message: string, requestId: string | null, body?: unknown) {
    super(message);
    this.name = 'AtheonApiError';
    this.status = status;
    this.requestId = requestId;
    this.body = body;
  }
}

export interface AtheonClientOptions {
  /** Base URL of the Atheon API (e.g. https://atheon-api.vantax.co.za). No trailing slash. */
  baseUrl: string;
  /** Bearer token issued by /api/auth/login or /api/auth/sso/callback. */
  token?: string;
  /** Optional override for the global fetch implementation (testing). */
  fetchImpl?: typeof fetch;
  /** Optional default request timeout in ms (default: 30000). */
  timeoutMs?: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
}

export class AtheonClient {
  private readonly baseUrl: string;
  private token: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(opts: AtheonClientOptions) {
    if (!opts.baseUrl) throw new Error('AtheonClient: baseUrl is required');
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 30_000;
  }

  /** Set/replace the bearer token after construction (e.g. after refresh). */
  setToken(token: string | null): void {
    this.token = token ?? undefined;
  }

  // ── Generic request ────────────────────────────────────────────────

  private buildQueryString(query: RequestOptions['query']): string {
    if (!query) return '';
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const url = `${this.baseUrl}${path}${this.buildQueryString(options.query)}`;
    const headers: Record<string, string> = {
      'Accept': 'application/json',
    };
    if (options.body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchImpl(url, {
        method: options.method ?? (options.body ? 'POST' : 'GET'),
        headers,
        body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeoutId);
      if (err instanceof Error && err.name === 'AbortError') {
        throw new AtheonApiError(0, `Request timed out after ${this.timeoutMs}ms: ${path}`, null);
      }
      throw err;
    }
    clearTimeout(timeoutId);

    const requestId = res.headers.get('X-Request-ID');
    if (!res.ok) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = await res.text().catch(() => null);
      }
      const message = (body && typeof body === 'object' && 'error' in body
        && typeof (body as Record<string, unknown>).error === 'string')
        ? (body as Record<string, unknown>).error as string
        : `HTTP ${res.status} ${res.statusText}`;
      throw new AtheonApiError(res.status, message, requestId, body);
    }
    return res.json() as Promise<T>;
  }

  // ── Auth ────────────────────────────────────────────────────────────

  auth = {
    /** Log in with email + password (and optional tenant slug for multi-tenant). */
    login: (email: string, password: string, tenantSlug?: string): Promise<LoginResponse> => {
      return this.request<LoginResponse>('/api/auth/login', {
        method: 'POST',
        body: { email, password, tenant_slug: tenantSlug },
      });
    },
    /** Get the currently-authenticated user. Token must be set. */
    me: (): Promise<AuthUser> => this.request<AuthUser>('/api/auth/me'),
  };

  // ── Apex ────────────────────────────────────────────────────────────

  apex = {
    health: (): Promise<HealthScore> =>
      this.request<HealthScore>('/api/apex/health'),
    briefing: (): Promise<Briefing> =>
      this.request<Briefing>('/api/apex/briefing'),
    risks: (): Promise<{ risks: Risk[]; total: number }> =>
      this.request<{ risks: Risk[]; total: number }>('/api/apex/risks'),
    scenarios: (): Promise<{ scenarios: ScenarioItem[]; total: number }> =>
      this.request<{ scenarios: ScenarioItem[]; total: number }>('/api/apex/scenarios'),
    createScenario: (body: {
      title: string;
      description: string;
      input_query: string;
      variables: string[];
      model_type: 'what-if' | 'sensitivity' | 'monte-carlo' | 'stress-test';
      base_values?: Record<string, string>;
    }): Promise<{ id: string }> =>
      this.request<{ id: string }>('/api/apex/scenarios', { method: 'POST', body }),
  };

  // ── Pulse ───────────────────────────────────────────────────────────

  pulse = {
    metrics: (): Promise<{ metrics: Metric[]; total: number }> =>
      this.request<{ metrics: Metric[]; total: number }>('/api/pulse/metrics'),
    anomalies: (): Promise<{ anomalies: AnomalyItem[]; total: number }> =>
      this.request<{ anomalies: AnomalyItem[]; total: number }>('/api/pulse/anomalies'),
    processes: (): Promise<{ processes: ProcessItem[]; total: number }> =>
      this.request<{ processes: ProcessItem[]; total: number }>('/api/pulse/processes'),
  };

  // ── Catalysts ───────────────────────────────────────────────────────

  catalysts = {
    clusters: (): Promise<{ clusters: ClusterItem[]; total: number }> =>
      this.request<{ clusters: ClusterItem[]; total: number }>('/api/catalysts/clusters'),
    actions: (): Promise<{ actions: ActionItem[]; total: number }> =>
      this.request<{ actions: ActionItem[]; total: number }>('/api/catalysts/actions'),
    /** Pending HITL approvals for the current tenant. */
    pendingApprovals: (): Promise<{ approvals: ActionItem[]; total: number }> =>
      this.request<{ approvals: ActionItem[]; total: number }>('/api/catalysts/approvals'),
  };

  // ── Provenance ──────────────────────────────────────────────────────

  provenance = {
    list: (options?: { limit?: number; offset?: number }): Promise<{ entries: ProvenanceEntry[]; total: number }> =>
      this.request<{ entries: ProvenanceEntry[]; total: number }>('/api/audit/provenance', { query: options }),
    verify: (): Promise<ProvenanceVerifyResult> =>
      this.request<ProvenanceVerifyResult>('/api/audit/provenance/verify', { method: 'POST' }),
    root: (): Promise<{ root: string | null; seq: number; created_at: string | null }> =>
      this.request<{ root: string | null; seq: number; created_at: string | null }>('/api/audit/provenance/root'),
  };

  // ── Billing ─────────────────────────────────────────────────────────

  billing = {
    plans: (): Promise<{ plans: BillingPlan[] }> =>
      this.request<{ plans: BillingPlan[] }>('/api/billing/plans'),
    checkout: (body: {
      plan_id: string;
      billing_cycle: 'monthly' | 'annual';
      success_url?: string;
      cancel_url?: string;
    }): Promise<CheckoutSessionResponse> =>
      this.request<CheckoutSessionResponse>('/api/billing/checkout', { method: 'POST', body }),
  };

  // ── Compliance (SOC 2 evidence pack) ────────────────────────────────

  compliance = {
    evidencePack: (tenantId?: string): Promise<EvidencePack> =>
      this.request<EvidencePack>('/api/v1/compliance/evidence-pack', {
        query: { tenant_id: tenantId },
      }),
  };
}
