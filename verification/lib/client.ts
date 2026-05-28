import { CONFIG } from '../config';

export interface AuthedUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
}

export interface Cluster {
  id: string;
  name: string;
  domain?: string;
  subCatalysts?: Array<{ name: string; enabled?: boolean }>;
}

export interface RunItemTotals {
  items_total: number;
  matched: number;
  discrepancies: number;
  unmatched: number;
  exceptions: number;
  total_source_value?: number;
  total_matched_value?: number;
}

/** One reconciliation run item — only the fields the harness inspects. */
export interface RunItem {
  id: string;
  item_status: string | null;
  exception_type: string | null;
  discrepancy_field: string | null;
  discrepancy_reason: string | null;
}

/** Thin client over the deployed Atheon API for verification suites. */
export class ApiClient {
  token: string | null = null;
  user: AuthedUser | null = null;

  constructor(
    private readonly email = CONFIG.adminEmail,
    private readonly password = CONFIG.adminPassword,
    private readonly baseUrl = CONFIG.apiUrl,
  ) {}

  async login(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password, tenant_slug: CONFIG.tenantSlug }),
    });
    if (!resp.ok) {
      throw new Error(`Login failed (${resp.status}) for ${this.email}: ${await resp.text()}`);
    }
    const data = await resp.json() as { token?: string; user?: AuthedUser };
    if (!data.token) throw new Error(`Login returned no token (MFA may be enforced for ${this.email})`);
    this.token = data.token;
    this.user = data.user ?? null;
  }

  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new Error('authedFetch called before login()');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  async reseed(): Promise<unknown> {
    // Doubled prefix: router mounts /api/v1/seed-vantax, handler path is /seed-vantax.
    const resp = await this.authedFetch('/api/v1/seed-vantax/seed-vantax', { method: 'POST' });
    if (!resp.ok) {
      throw new Error(`Reseed failed (${resp.status}): ${await resp.text()}`);
    }
    return resp.json();
  }

  async listClusters(): Promise<Cluster[]> {
    const resp = await this.authedFetch('/api/v1/catalysts/clusters');
    if (!resp.ok) throw new Error(`listClusters failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { clusters?: Cluster[] } | Cluster[];
    return Array.isArray(data) ? data : (data.clusters ?? []);
  }

  /** Find the cluster that owns a sub-catalyst by its display name. */
  async resolveCluster(subName: string): Promise<Cluster> {
    const clusters = await this.listClusters();
    const match = clusters.find(c => (c.subCatalysts ?? []).some(s => s.name === subName));
    if (!match) {
      const names = clusters.flatMap(c => (c.subCatalysts ?? []).map(s => s.name));
      throw new Error(`No cluster owns sub-catalyst "${subName}". Available: ${names.join(', ')}`);
    }
    return match;
  }

  /** Execute a reconciliation sub-catalyst by display name; returns its run id. */
  async executeSubCatalyst(subName: string): Promise<{ runId: string; status: string }> {
    const cluster = await this.resolveCluster(subName);
    const enc = encodeURIComponent(subName);
    const resp = await this.authedFetch(
      `/api/v1/catalysts/clusters/${cluster.id}/sub-catalysts/${enc}/execute`,
      { method: 'POST' },
    );
    if (!resp.ok) throw new Error(`execute "${subName}" failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { run_id?: string; id?: string; status?: string };
    const runId = data.run_id ?? data.id;
    if (!runId) throw new Error(`execute "${subName}" returned no run id: ${JSON.stringify(data)}`);
    return { runId, status: data.status ?? 'unknown' };
  }

  async getRunItemTotals(runId: string): Promise<RunItemTotals> {
    const resp = await this.authedFetch(`/api/v1/catalysts/runs/${runId}/items?limit=1`);
    if (!resp.ok) throw new Error(`getRunItems failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { totals?: RunItemTotals };
    if (!data.totals) throw new Error(`run ${runId} returned no totals`);
    return data.totals;
  }

  /**
   * Fetch run items plus totals in one call. `totals.unmatched` conflates both
   * sides of a two-sided reconciliation (e.g. bank: unmatched bank lines AND
   * unmatched book entries), so the per-item `item_status` breakdown is the only
   * way to recover the source-side count the oracle models.
   */
  async getRun(runId: string, limit = 300): Promise<{ totals: RunItemTotals; items: RunItem[] }> {
    const resp = await this.authedFetch(`/api/v1/catalysts/runs/${runId}/items?limit=${limit}`);
    if (!resp.ok) throw new Error(`getRun failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { totals?: RunItemTotals; items?: RunItem[] };
    if (!data.totals) throw new Error(`run ${runId} returned no totals`);
    return { totals: data.totals, items: data.items ?? [] };
  }

  async getAssessment(id: string): Promise<{ businessReportKey: string | null }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}`);
    if (!resp.ok) throw new Error(`getAssessment(${id}) failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<{ businessReportKey: string | null }>;
  }

  async getBusinessReport(id: string): Promise<{ status: number; contentType: string; head: string }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}/report/business`);
    const buf = resp.ok ? Buffer.from(await resp.arrayBuffer()) : Buffer.alloc(0);
    return {
      status: resp.status,
      contentType: resp.headers.get('content-type') ?? '',
      head: buf.subarray(0, 5).toString('latin1'),
    };
  }
}

/** Reconciliation sub-catalyst display names (must match seeded `name` fields). */
export const RECON_SUBCATALYSTS = {
  grir: 'GR/IR Reconciliation',
  bank: 'Bank Reconciliation',
  inventory: 'Inventory Reconciliation',
  salesOrder: 'Sales Order Matching',
} as const;
