// M5 fix: Use env variable with production fallback (not personal Workers subdomain)
export const API_URL = import.meta.env.VITE_API_URL || 'https://atheon-api.vantax.co.za';

let authToken: string | null = localStorage.getItem('atheon_token');
let refreshToken: string | null = localStorage.getItem('atheon_refresh_token');
let tenantOverrideId: string | null = localStorage.getItem('atheon_tenant_override');
let isRefreshing = false;
let refreshPromise: Promise<boolean> | null = null;

// M6: Rate limit state exposed to UI
export interface RateLimitInfo {
  limit: number | null;
  remaining: number | null;
  resetAt: number | null;
}
let lastRateLimitInfo: RateLimitInfo = { limit: null, remaining: null, resetAt: null };
export function getRateLimitInfo(): RateLimitInfo { return lastRateLimitInfo; }

export function setToken(token: string | null, refresh?: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('atheon_token', token);
  } else {
    localStorage.removeItem('atheon_token');
  }
  if (refresh !== undefined) {
    refreshToken = refresh;
    if (refresh) {
      localStorage.setItem('atheon_refresh_token', refresh);
    } else {
      localStorage.removeItem('atheon_refresh_token');
    }
  }
}

export function getToken(): string | null {
  return authToken;
}

/** Set a global tenant override for cross-tenant access (superadmin/support_admin) */
export function setTenantOverride(tenantId: string | null) {
  tenantOverrideId = tenantId;
  if (tenantId) {
    localStorage.setItem('atheon_tenant_override', tenantId);
  } else {
    localStorage.removeItem('atheon_tenant_override');
  }
}

export function getTenantOverride(): string | null {
  return tenantOverrideId;
}

/** Build query string from params, omitting undefined/null values */
function qs(params: Record<string, string | undefined>): string {
  const entries = Object.entries(params).filter(([, v]) => v !== undefined && v !== null) as [string, string][];
  return entries.length ? '?' + entries.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') : '';
}

// H4: Attempt to refresh the access token using the stored refresh token
async function attemptTokenRefresh(): Promise<boolean> {
  if (!refreshToken) return false;
  try {
    const res = await fetch(`${API_URL}/api/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
    if (!res.ok) return false;
    const data = await res.json() as { token: string; refreshToken?: string };
    setToken(data.token, data.refreshToken || refreshToken);
    return true;
  } catch {
    return false;
  }
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Inject global tenant override into URL if set and not already present
  let finalPath = path;
  if (tenantOverrideId && !path.includes('tenant_id=') && !path.startsWith('/api/auth') && !path.startsWith('/api/tenants')) {
    const sep = path.includes('?') ? '&' : '?';
    finalPath = `${path}${sep}tenant_id=${encodeURIComponent(tenantOverrideId)}`;
  }

  const res = await fetch(`${API_URL}${finalPath}`, {
    ...options,
    headers,
  });

  // M6: Read rate limit headers from response
  const rlLimit = res.headers.get('X-RateLimit-Limit');
  const rlRemaining = res.headers.get('X-RateLimit-Remaining');
  if (rlLimit || rlRemaining) {
    lastRateLimitInfo = {
      limit: rlLimit ? parseInt(rlLimit, 10) : lastRateLimitInfo.limit,
      remaining: rlRemaining ? parseInt(rlRemaining, 10) : lastRateLimitInfo.remaining,
      resetAt: null,
    };
  }

  // H4: 401 interceptor — attempt token refresh and retry once
  if (res.status === 401 && authToken && !path.startsWith('/api/auth/')) {
    if (!isRefreshing) {
      isRefreshing = true;
      refreshPromise = attemptTokenRefresh().finally(() => {
        isRefreshing = false;
        refreshPromise = null;
      });
    }
    const refreshed = await refreshPromise;

    if (refreshed) {
      // Retry the original request with the new token
      headers['Authorization'] = `Bearer ${authToken}`;
      const retryRes = await fetch(`${API_URL}${finalPath}`, { ...options, headers });
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
        throw new Error((err as Record<string, string>).error || retryRes.statusText);
      }
      return retryRes.json() as Promise<T>;
    } else {
      // Refresh failed — clear tokens and redirect to login
      setToken(null, null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?session_expired=1';
      }
      throw new Error('Session expired. Please log in again.');
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as Record<string, string>).error || res.statusText);
  }

  return res.json() as Promise<T>;
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      }),
    register: (email: string, password: string, name: string, tenantSlug?: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, name, tenant_slug: tenantSlug || 'vantax' }),
      }),
    changePassword: (newPassword: string, currentPassword?: string) =>
      request<{ success: boolean; message: string }>('/api/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ new_password: newPassword, current_password: currentPassword }),
      }),
    me: () => request<AuthUser>('/api/auth/me'),
    ssoLogin: (provider: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ provider }),
      }),
    ssoAuthorize: (provider: string, tenantSlug?: string) =>
      request<{ redirect_url: string }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ provider, tenant_slug: tenantSlug || 'vantax' }),
      }),
    ssoCallback: (code: string, state: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/sso/callback', {
        method: 'POST',
        body: JSON.stringify({ code, state }),
      }),
    logout: () =>
      request<{ success: boolean; message: string }>('/api/auth/logout', { method: 'POST' }),
    forgotPassword: (email: string) =>
      request<{ success: boolean; message: string }>('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      }),
    resetPassword: (token: string, newPassword: string) =>
      request<{ success: boolean; message: string }>('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, new_password: newPassword }),
      }),
  },

  tenants: {
    list: () => request<{ tenants: Tenant[]; total: number }>('/api/tenants'),
    get: (id: string) => request<TenantDetail>(`/api/tenants/${id}`),
    create: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/tenants', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    updateEntitlements: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/tenants/${id}/entitlements`, { method: 'PUT', body: JSON.stringify(data) }),
    reset: (id: string) =>
      request<{ success: boolean; deletedRows: number; tablesCleared: number }>(`/api/tenants/${id}/reset`, { method: 'POST' }),
  },

  iam: {
    policies: (tenantId?: string) =>
      request<{ policies: IAMPolicy[]; total: number }>(`/api/iam/policies${qs({ tenant_id: tenantId })}`),
    roles: (tenantId?: string) =>
      request<{ roles: IAMRole[] }>(`/api/iam/roles${qs({ tenant_id: tenantId })}`),
    users: (tenantId?: string) =>
      request<{ users: IAMUser[]; total: number }>(`/api/iam/users${qs({ tenant_id: tenantId })}`),
    sso: (tenantId?: string) =>
      request<{ configs: SSOConfig[] }>(`/api/iam/sso${qs({ tenant_id: tenantId })}`),
    createUser: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/iam/users', { method: 'POST', body: JSON.stringify(data) }),
    createPolicy: (data: Record<string, unknown>) =>
      request<{ id: string; name: string }>('/api/iam/policies', { method: 'POST', body: JSON.stringify(data) }),
    deletePolicy: (id: string) =>
      request<{ success: boolean }>(`/api/iam/policies/${id}`, { method: 'DELETE' }),
  },

  apex: {
    health: (tenantId?: string, industry?: string) =>
      request<HealthScore>(`/api/apex/health${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    briefing: (tenantId?: string, industry?: string) =>
      request<Briefing>(`/api/apex/briefing${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    risks: (tenantId?: string, industry?: string) =>
      request<{ risks: Risk[]; total: number }>(`/api/apex/risks${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    scenarios: (tenantId?: string, industry?: string) =>
      request<{ scenarios: ScenarioItem[]; total: number }>(`/api/apex/scenarios${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createScenario: (data: Record<string, unknown>) =>
      request<{ id: string; results: Record<string, unknown> }>('/api/apex/scenarios', { method: 'POST', body: JSON.stringify(data) }),
  },

  pulse: {
    metrics: (tenantId?: string, industry?: string) =>
      request<{ metrics: Metric[]; total: number }>(`/api/pulse/metrics${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    anomalies: (tenantId?: string, industry?: string) =>
      request<{ anomalies: AnomalyItem[]; total: number }>(`/api/pulse/anomalies${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    processes: (tenantId?: string, industry?: string) =>
      request<{ processes: ProcessItem[]; total: number }>(`/api/pulse/processes${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    correlations: (tenantId?: string, industry?: string) =>
      request<{ correlations: CorrelationItem[]; total: number }>(`/api/pulse/correlations${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    summary: (tenantId?: string, industry?: string) =>
      request<PulseSummary>(`/api/pulse/summary${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
  },

  catalysts: {
    clusters: (tenantId?: string, industry?: string) =>
      request<{ clusters: ClusterItem[]; total: number }>(`/api/catalysts/clusters${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    toggleSubCatalyst: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/toggle${qs({ tenant_id: tenantId })}`, { method: 'PUT' }),
    setDataSource: (clusterId: string, subName: string, dataSource: { type: string; config: Record<string, unknown> }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(dataSource) }),
    removeDataSource: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    setSchedule: (clusterId: string, subName: string, schedule: { frequency: string; day_of_week?: number; day_of_month?: number; time_of_day?: string }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(schedule) }),
    removeSchedule: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    cluster: (id: string) => request<ClusterDetail>(`/api/catalysts/clusters/${id}`),
    actions: (tenantId?: string, clusterId?: string, industry?: string) =>
      request<{ actions: ActionItem[]; total: number }>(`/api/catalysts/actions${qs({ tenant_id: tenantId, cluster_id: clusterId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createAction: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/catalysts/actions', { method: 'POST', body: JSON.stringify(data) }),
    approveAction: (id: string, approvedBy?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/approve`, { method: 'PUT', body: JSON.stringify({ approved_by: approvedBy || 'ui' }) }),
    rejectAction: (id: string, rejectedBy?: string, reason?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/reject`, { method: 'PUT', body: JSON.stringify({ approved_by: rejectedBy || 'ui', reason: reason || '' }) }),
    governance: (tenantId?: string, industry?: string) =>
      request<GovernanceData>(`/api/catalysts/governance${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    createCluster: (data: Record<string, unknown>) =>
      request<{ id: string; name: string; domain: string }>('/api/catalysts/clusters', { method: 'POST', body: JSON.stringify(data) }),
    deleteCluster: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/catalysts/clusters/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    templates: () =>
      request<{ templates: CatalystIndustryTemplate[] }>('/api/catalysts/templates'),
    deployTemplate: (data: { tenant_id: string; industry: string; clusters?: Array<{ name: string; domain: string; description: string; autonomy_tier: string; sub_catalysts: Array<{ name: string; enabled: boolean; description: string }> }> }) =>
      request<{ success: boolean; industry: string; clustersCreated: number; clusterIds: string[]; existingClusters: number }>('/api/catalysts/deploy-template', { method: 'POST', body: JSON.stringify(data) }),
    manualExecute: async (data: FormData): Promise<ManualExecuteResult> => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      // Include tenant override for cross-tenant manual execution
      let url = `${API_URL}/api/catalysts/manual-execute`;
      if (tenantOverrideId) {
        url += `?tenant_id=${encodeURIComponent(tenantOverrideId)}`;
      }
      const res = await fetch(url, {
        method: 'POST', headers, body: data,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error((err as Record<string, string>).error || res.statusText);
      }
      return res.json() as Promise<ManualExecuteResult>;
    },
    executionLogs: (actionId?: string) =>
      request<{ logs: ExecutionLogEntry[]; total: number }>(`/api/catalysts/execution-logs${qs({ action_id: actionId })}`) ,
    executionLogsForAction: (actionId: string) =>
      request<{ logs: ExecutionLogEntry[]; total: number }>(`/api/catalysts/execution-logs/${actionId}`),
    resolveException: (actionId: string, notes?: string) =>
      request<{ success: boolean; status: string }>(`/api/catalysts/actions/${actionId}/resolve`, {
        method: 'PUT', body: JSON.stringify({ resolution_notes: notes || 'Resolved by admin' }),
      }),
    escalateException: (actionId: string, notes?: string, escalateTo?: string) =>
      request<{ success: boolean; status: string; escalationLevel: string }>(`/api/catalysts/actions/${actionId}/escalate`, {
        method: 'PUT', body: JSON.stringify({ escalation_notes: notes, escalated_to: escalateTo }),
      }),
  },

  memory: {
    entities: (tenantId?: string, type?: string, industry?: string) =>
      request<{ entities: GraphEntity[]; total: number }>(`/api/memory/entities${qs({ tenant_id: tenantId, type, industry: industry && industry !== 'general' ? industry : undefined })}`),
    entity: (id: string) => request<GraphEntityDetail>(`/api/memory/entities/${id}`),
    relationships: (tenantId?: string, industry?: string) =>
      request<{ relationships: GraphRelationship[]; total: number }>(`/api/memory/relationships${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    graph: (tenantId?: string, industry?: string) =>
      request<GraphData>(`/api/memory/graph${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    query: (queryText: string, tenantId?: string) =>
      request<GraphQueryResult>('/api/memory/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tenant_id: tenantId }),
      }),
    stats: (tenantId?: string, industry?: string) =>
      request<GraphStats>(`/api/memory/stats${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
  },

  mind: {
    query: (queryText: string, tier?: string, tenantId?: string, industry?: string) =>
      request<MindQueryResult>('/api/mind/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tier: tier || 'tier-1', tenant_id: tenantId, industry: industry || undefined }),
      }),
    models: () => request<MindModels>('/api/mind/models'),
    history: (tenantId?: string, industry?: string) =>
      request<{ queries: MindHistoryItem[]; total: number }>(`/api/mind/history${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    stats: (tenantId?: string, industry?: string) =>
      request<MindStats>(`/api/mind/stats${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
  },

  erp: {
    adapters: () => request<{ adapters: ERPAdapter[]; total: number }>('/api/erp/adapters'),
    adapter: (id: string) => request<ERPAdapterDetail>(`/api/erp/adapters/${id}`),
    connections: (tenantId?: string) =>
      request<{ connections: ERPConnection[]; total: number }>(`/api/erp/connections${qs({ tenant_id: tenantId })}`),
    createConnection: (data: Record<string, unknown>) =>
      request<{ id: string; status: string }>('/api/erp/connections', { method: 'POST', body: JSON.stringify(data) }),
    testConnection: (id: string) =>
      request<{ connected: boolean; message?: string }>(`/api/erp/connections/${id}/test`, { method: 'POST' }),
    canonical: (domain?: string) => {
      let url = '/api/erp/canonical';
      if (domain) url += `?domain=${domain}`;
      return request<{ endpoints: CanonicalEndpoint[]; total: number }>(url);
    },
    sync: (connectionId: string) =>
      request<{ recordsSynced: number; syncedAt: string }>(`/api/erp/sync/${connectionId}`, { method: 'POST' }),
  },

  controlplane: {
    deployments: (tenantId?: string, industry?: string) => {
      let url = '/api/controlplane/deployments';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      if (industry && industry !== 'general') url += `${tenantId ? '&' : '?'}industry=${industry}`;
      return request<{ deployments: DeploymentItem[]; total: number }>(url);
    },
    deployment: (id: string) => request<DeploymentItem>(`/api/controlplane/deployments/${id}`),
    createDeployment: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/controlplane/deployments', { method: 'POST', body: JSON.stringify(data) }),
    updateDeployment: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean; deployment?: DeploymentItem }>(`/api/controlplane/deployments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteDeployment: (id: string) =>
      request<{ success: boolean }>(`/api/controlplane/deployments/${id}`, { method: 'DELETE' }),
    health: (tenantId?: string, industry?: string) => {
      let url = '/api/controlplane/health';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      if (industry && industry !== 'general') url += `${tenantId ? '&' : '?'}industry=${industry}`;
      return request<ControlPlaneHealth>(url);
    },
  },

  audit: {
    log: (tenantId?: string, layer?: string) =>
      request<{ entries: AuditEntry[]; total: number }>(`/api/audit/log${qs({ tenant_id: tenantId, layer })}`),
    stats: (tenantId?: string) =>
      request<AuditStats>(`/api/audit/stats${qs({ tenant_id: tenantId })}`),
  },

  notifications: {
    list: (opts?: { unread?: boolean; limit?: number }) => {
      let url = '/api/notifications?';
      if (opts?.unread) url += 'unread=true&';
      if (opts?.limit) url += `limit=${opts.limit}&`;
      return request<{ notifications: NotificationItem[]; total: number; unreadCount: number }>(url);
    },
    unreadCount: () =>
      request<{ unreadCount: number }>('/api/notifications/unread-count'),
    markRead: (ids: string[]) =>
      request<{ success: boolean; marked: number }>('/api/notifications/read', {
        method: 'PUT',
        body: JSON.stringify({ ids }),
      }),
  },

  // ── Hybrid Deployment Management ──────────────────────────────────────
  deployments: {
    list: () =>
      request<{ deployments: ManagedDeployment[]; total: number }>('/api/deployments'),
    get: (id: string) =>
      request<ManagedDeployment>(`/api/deployments/${id}`),
    create: (data: CreateDeploymentRequest) =>
      request<CreateDeploymentResponse>('/api/deployments', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/deployments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    pushConfig: (id: string, config: Record<string, unknown>) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}/push-config`, { method: 'POST', body: JSON.stringify(config) }),
    pushUpdate: (id: string, version: string) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}/push-update`, { method: 'POST', body: JSON.stringify({ version }) }),
    getLogs: (id: string) =>
      request<{ logs: AgentErrorLog[] }>(`/api/deployments/${id}/logs`),
    revoke: (id: string) =>
      request<{ success: boolean; message: string }>(`/api/deployments/${id}`, { method: 'DELETE' }),
  },

  // ── Pre-Assessment Tool ───────────────────────────────────────────────
  assessments: {
    list: () =>
      request<{ assessments: Assessment[]; total: number }>('/api/assessments'),
    get: (id: string) =>
      request<Assessment>(`/api/assessments/${id}`),
    create: (data: { prospect_name: string; prospect_industry: string; erp_connection_id?: string; config: Record<string, unknown> }) =>
      request<{ id: string; status: string }>('/api/assessments', { method: 'POST', body: JSON.stringify(data) }),
    status: (id: string) =>
      request<{ status: string; progress: string }>(`/api/assessments/${id}/status`),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/assessments/${id}`, { method: 'DELETE' }),
    getDefaultConfig: () =>
      request<Record<string, unknown>>('/api/assessments/config/defaults'),
    saveDefaultConfig: (config: Record<string, unknown>) =>
      request<{ success: boolean }>('/api/assessments/config/defaults', { method: 'PUT', body: JSON.stringify(config) }),
    downloadBusiness: async (id: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/assessments/${id}/report/business`, { headers });
      if (!res.ok) throw new Error('Failed to download business report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `business-case-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
    downloadTechnical: async (id: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/assessments/${id}/report/technical`, { headers });
      if (!res.ok) throw new Error('Failed to download technical report');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `technical-sizing-${id}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
    downloadExcel: async (id: string) => {
      const headers: Record<string, string> = {};
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/assessments/${id}/report/excel`, { headers });
      if (!res.ok) throw new Error('Failed to download Excel model');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href = url; a.download = `financial-model-${id}.xlsx`; a.click();
      URL.revokeObjectURL(url);
    },
  },
};

// Types for API responses
export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  permissions: string[];
}

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  industry: string;
  plan: string;
  status: string;
  deploymentModel: string;
  region: string;
  createdAt: string;
  entitlements: TenantEntitlements;
}

export interface TenantEntitlements {
  layers: string[];
  catalystClusters: string[];
  maxAgents: number;
  maxUsers: number;
  autonomyTiers: string[];
  llmTiers: string[];
  features: string[];
  ssoEnabled: boolean;
  apiAccess: boolean;
  customBranding: boolean;
  dataRetentionDays: number;
}

export interface TenantDetail extends Tenant {
  updatedAt: string;
  stats: { users: number; agents: number; clusters: number };
}

export interface IAMPolicy {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  type: string;
  rules: Record<string, unknown>[];
  createdAt: string;
}

export interface IAMRole {
  id: string;
  name: string;
  description: string;
  level: number;
  userCount: number;
}

export interface IAMUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  status: string;
  lastLogin: string | null;
  createdAt: string;
}

export interface SSOConfig {
  id: string;
  provider: string;
  clientId: string;
  issuerUrl: string;
  enabled: boolean;
  autoProvision: boolean;
  defaultRole: string;
  domainHint: string;
}

export interface HealthScore {
  id: string;
  overall: number;
  dimensions: Record<string, { score: number; trend: string; delta?: number }>;
  calculatedAt: string;
}

export interface Briefing {
  id: string;
  title: string;
  summary: string;
  risks: string[];
  opportunities: string[];
  kpiMovements: { kpi: string; movement: string; period: string }[];
  decisionsNeeded: string[];
  generatedAt: string;
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  severity: string;
  category: string;
  probability: number;
  impactValue: number;
  impactUnit: string;
  recommendedActions: string[];
  status: string;
  detectedAt: string;
}

export interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  inputQuery: string;
  variables: string[];
  results: Record<string, unknown>;
  status: string;
  createdAt: string;
}

export interface Metric {
  id: string;
  name: string;
  value: number;
  unit: string;
  status: string;
  thresholds: { green: number | null; amber: number | null; red: number | null };
  trend: number[];
  sourceSystem: string | null;
  measuredAt: string;
}

export interface AnomalyItem {
  id: string;
  metric: string;
  severity: string;
  expectedValue: number;
  actualValue: number;
  deviation: number;
  hypothesis: string;
  status: string;
  detectedAt: string;
}

export interface ProcessItem {
  id: string;
  name: string;
  steps: { id: string; name: string; avgDuration: number; throughput: number; status: string }[];
  variants: number;
  avgDuration: number;
  conformanceRate: number;
  bottlenecks: string[];
}

export interface CorrelationItem {
  id: string;
  sourceSystem: string;
  sourceEvent: string;
  targetSystem: string;
  targetImpact: string;
  confidence: number;
  lagDays: number;
  detectedAt: string;
}

export interface PulseSummary {
  totalMetrics: number;
  statusBreakdown: { green: number; amber: number; red: number };
  openAnomalies: number;
}

export interface DataSourceConfig {
  type: 'erp' | 'email' | 'cloud_storage' | 'upload';
  config: Record<string, unknown>;
}

export interface CatalystSubCatalystTemplate {
  name: string;
  enabled: boolean;
  description: string;
  schedule?: SubCatalystSchedule;
}

export interface CatalystClusterTemplate {
  name: string;
  domain: string;
  description: string;
  autonomy_tier: string;
  subCatalystCount: number;
  sub_catalysts: CatalystSubCatalystTemplate[];
}

export interface CatalystIndustryTemplate {
  industry: string;
  label: string;
  description: string;
  clusterCount: number;
  clusters: CatalystClusterTemplate[];
}

export interface SubCatalystSchedule {
  frequency: 'manual' | 'daily' | 'weekly' | 'monthly';
  day_of_week?: number;   // 0=Sun..6=Sat (for weekly)
  day_of_month?: number;  // 1-31 (for monthly)
  time_of_day?: string;   // HH:MM in UTC
  last_run?: string;      // ISO datetime of last scheduled run
  next_run?: string;      // ISO datetime of next scheduled run
}

export interface SubCatalyst {
  name: string;
  enabled: boolean;
  description?: string;
  data_source?: DataSourceConfig;
  schedule?: SubCatalystSchedule;
}

export interface ClusterItem {
  id: string;
  name: string;
  domain: string;
  description: string;
  status: string;
  agentCount: number;
  tasksCompleted: number;
  tasksInProgress: number;
  successRate: number;
  trustScore: number;
  autonomyTier: string;
  subCatalysts: SubCatalyst[];
  createdAt: string;
}

export interface ClusterDetail extends ClusterItem {
  recentActions: ActionItem[];
  deployments: DeploymentItem[];
}

export interface ActionItem {
  id: string;
  clusterId?: string;
  catalystName: string;
  action: string;
  status: string;
  confidence: number;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  reasoning: string | null;
  approvedBy?: string;
  createdAt: string;
  completedAt?: string;
}

export interface GovernanceData {
  totalActions: number;
  pendingApprovals: number;
  approved: number;
  rejected: number;
  clusterAutonomy: { domain: string; autonomyTier: string; trustScore: number }[];
}

export interface GraphEntity {
  id: string;
  type: string;
  name: string;
  properties: Record<string, unknown>;
  confidence: number;
  source: string;
  validFrom?: string;
  validTo?: string;
}

export interface GraphEntityDetail extends GraphEntity {
  relationships: {
    outgoing: { id: string; type: string; targetId: string; targetName: string; targetType: string; properties: Record<string, unknown>; confidence: number }[];
    incoming: { id: string; type: string; sourceId: string; sourceName: string; sourceType: string; properties: Record<string, unknown>; confidence: number }[];
  };
}

export interface GraphRelationship {
  id: string;
  type: string;
  sourceId: string;
  sourceName: string;
  sourceType: string;
  targetId: string;
  targetName: string;
  targetType: string;
  properties: Record<string, unknown>;
  confidence: number;
}

export interface GraphData {
  nodes: { id: string; type: string; name: string; properties: Record<string, unknown>; confidence: number }[];
  edges: { id: string; source: string; target: string; type: string; confidence: number }[];
}

export interface GraphQueryResult {
  query: string;
  directMatches: GraphEntity[];
  relatedEntities: GraphEntity[];
  context: string;
  answer: string;
}

export interface GraphStats {
  entities: number;
  relationships: number;
  entityTypes: { type: string; count: number }[];
  relationshipTypes: { type: string; count: number }[];
}

export interface MindQueryResult {
  id: string;
  response: string;
  tier: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  citations: string[];
  generatedAt: string;
}

export interface MindModels {
  tiers: { id: string; name: string; model: string; maxTokens: number; avgLatency?: number; description: string }[];
  industryAdapters: { id: string; name: string; metrics: string[]; status: string }[];
  trainingPipeline: {
    preTraining: { status: string; progress: number; dataset: string };
    domainFineTuning: { status: string; progress: number; currentEpoch: number; totalEpochs: number };
    rlhf: { status: string; progress: number };
    evaluation: { mmlu: number; humaneval: number; domainAccuracy: number; hallucination_rate: number };
  };
}

export interface MindHistoryItem {
  id: string;
  query: string;
  response: string;
  tier: string;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  citations: string[];
  createdAt: string;
}

export interface MindStats {
  totalQueries: number;
  avgLatencyMs: number;
  totalTokens: number;
  tierBreakdown: { tier: string; count: number; avg_latency: number }[];
}

export interface ERPAdapter {
  id: string;
  name: string;
  system: string;
  version: string;
  protocol: string;
  status: string;
  operations: string[];
  authMethods: string[];
}

export interface ERPAdapterDetail extends ERPAdapter {
  connections: { id: string; tenantId: string; tenantName: string; name: string; status: string; lastSync: string | null; recordsSynced: number }[];
}

export interface ERPConnection {
  id: string;
  adapterId: string;
  adapterName: string;
  adapterSystem: string;
  adapterProtocol: string;
  name: string;
  status: string;
  config: Record<string, unknown>;
  lastSync: string | null;
  syncFrequency: string;
  recordsSynced: number;
  connectedAt: string | null;
}

export interface CanonicalEndpoint {
  id: string;
  domain: string;
  path: string;
  method: string;
  description: string;
  rateLimit: number;
  version: string;
}

export interface DeploymentItem {
  id: string;
  tenantId: string;
  tenantName: string;
  clusterId: string | null;
  clusterName: string | null;
  clusterDomain: string | null;
  name: string;
  agentType: string;
  status: string;
  deploymentModel: string;
  version: string;
  healthScore: number;
  uptime: number;
  tasksExecuted: number;
  lastHeartbeat: string | null;
  config: Record<string, unknown>;
  createdAt: string;
}

export interface ControlPlaneHealth {
  overallHealth: number;
  overallUptime: number;
  deploymentStatus: Record<string, number>;
  lastChecked: string;
}

export interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string | null;
  action: string;
  layer: string;
  resource: string | null;
  details: Record<string, unknown> | null;
  outcome: string;
  ipAddress: string | null;
  createdAt: string;
}

export interface AuditStats {
  totalEntries: number;
  layerBreakdown: { layer: string; count: number }[];
  outcomeBreakdown: { outcome: string; count: number }[];
  recentActivity: { action: string; layer: string; outcome: string; created_at: string }[];
}

export interface ManualExecuteResult {
  actionId: string;
  status: string;
  message: string;
  startDatetime: string;
  endDatetime: string;
  fileName: string | null;
}

export interface ExecutionLogEntry {
  id: string;
  actionId: string;
  stepNumber: number;
  stepName: string;
  status: string;
  detail: string;
  durationMs: number | null;
  createdAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  severity: 'critical' | 'high' | 'medium' | 'low' | 'info';
  actionUrl: string | null;
  metadata: Record<string, unknown> | null;
  read: boolean;
  createdAt: string;
}

// ── Hybrid Deployment Types ─────────────────────────────────────────────
export interface ManagedDeployment {
  id: string;
  tenantId: string;
  tenantName: string;
  tenantSlug?: string;
  name: string;
  deploymentType: 'hybrid' | 'on-premise';
  status: 'pending' | 'provisioning' | 'active' | 'degraded' | 'offline' | 'suspended';
  licenceKey: string;
  licenceExpiresAt: string | null;
  agentVersion: string | null;
  apiVersion: string | null;
  customerApiUrl: string | null;
  region: string;
  lastHeartbeat: string | null;
  healthScore: number;
  config: Record<string, unknown>;
  resourceUsage: { cpuPct?: number; memMb?: number; diskGb?: number; activeUsers?: number };
  errorLog?: AgentErrorLog[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateDeploymentRequest {
  tenant_id: string;
  name: string;
  deployment_type?: 'hybrid' | 'on-premise';
  region?: string;
  licence_expires_at?: string;
  config?: Record<string, unknown>;
}

export interface CreateDeploymentResponse {
  id: string;
  licenceKey: string;
  status: string;
  installConfig: {
    deploymentId: string;
    licenceKey: string;
    controlPlaneUrl: string;
    heartbeatIntervalSeconds: number;
    agentImage: string;
    initialConfig: Record<string, unknown>;
    envFile: string;
    installCommand: string;
  };
  message: string;
}

export interface AgentErrorLog {
  ts: string;
  message: string;
  code?: string;
  severity: string;
}

// ── Assessment Types ────────────────────────────────────────────────────
export interface Assessment {
  id: string;
  tenantId: string;
  tenantName?: string;
  prospectName: string;
  prospectIndustry: string;
  erpConnectionId: string | null;
  status: 'pending' | 'running' | 'complete' | 'failed';
  config: Record<string, unknown>;
  dataSnapshot: Record<string, unknown>;
  results: AssessmentResults;
  businessReportKey: string | null;
  technicalReportKey: string | null;
  excelModelKey: string | null;
  createdBy: string;
  createdAt: string;
  completedAt: string | null;
}

export interface AssessmentResults {
  catalyst_scores?: CatalystScore[];
  technical_sizing?: TechnicalSizing;
  volume_snapshot?: Record<string, unknown>;
  narrative?: string;
  error?: string;
}

export interface CatalystScore {
  catalyst_name: string;
  domain: string;
  priority: number;
  deploy_order: number;
  estimated_annual_saving_zar: number;
  saving_components: { label: string; amount_zar: number; methodology: string }[];
  data_insights: string[];
  confidence: 'high' | 'medium' | 'low';
  sub_catalysts: SubCatalystScore[];
  estimated_monthly_api_calls: number;
  estimated_monthly_vector_queries: number;
  estimated_monthly_llm_tokens: number;
  estimated_db_size_mb: number;
}

export interface SubCatalystScore {
  name: string;
  recommended: boolean;
  priority_within_cluster: number;
  estimated_monthly_volume: number;
  volume_unit: string;
  estimated_monthly_api_calls: number;
  estimated_monthly_llm_tokens: number;
  estimated_annual_saving_zar: number;
  deploy_prerequisite?: string;
}

export interface TechnicalSizing {
  total_monthly_api_calls: number;
  total_monthly_vector_queries: number;
  total_monthly_llm_tokens: number;
  total_db_size_gb: number;
  total_storage_gb: number;
  total_kv_reads_monthly: number;
  cost_cf_workers: number;
  cost_cf_d1: number;
  cost_cf_vectorize: number;
  cost_cf_workers_ai: number;
  cost_cf_r2: number;
  cost_cf_kv: number;
  total_infra_cost_pm_saas: number;
  total_infra_cost_pm_onprem: number;
  monthly_licence_revenue: number;
  annual_licence_revenue: number;
  gross_margin_pm_saas: number;
  gross_margin_pct_saas: number;
  gross_margin_pm_onprem: number;
  gross_margin_pct_onprem: number;
  catalyst_sizing: Array<{
    catalyst_name: string;
    sub_catalysts: Array<{
      name: string;
      monthly_api_calls: number;
      monthly_llm_tokens: number;
      monthly_vector_queries: number;
      cost_pm_zar: number;
    }>;
    total_cost_pm_zar: number;
  }>;
}
