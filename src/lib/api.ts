// M5 fix: Use env variable with production fallback (not personal Workers subdomain)
import { generateRequestId } from './request-id';

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

/**
 * Request-ID correlation (backend PR #222).
 *
 * Every request carries a self-generated `X-Request-ID`. Every response's
 * `X-Request-ID` is captured into lastRequestId so UI surfaces (e.g. error
 * toasts) can quote it back to support even when the caller only catches
 * a plain Error from legacy code paths.
 */
let lastRequestId: string | null = null;
export function getLastRequestId(): string | null { return lastRequestId; }

/**
 * Typed API error carrying the HTTP status, backend-reported request-ID, and
 * raw body (if JSON). Callers that want to surface a support-quotable ID can
 * `if (err instanceof ApiError) err.requestId`.
 *
 * Subclasses `Error`, so existing `catch (err) { err.message }` call-sites
 * continue to work unchanged.
 */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly requestId: string | null,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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

/**
 * Capture X-Request-ID (PR #222) from any response and mirror it into the
 * module-level lastRequestId. Returns the header value (or null) so callers
 * can attach it to thrown errors.
 */
function captureRequestId(res: Response): string | null {
  const id = res.headers.get('X-Request-ID');
  if (id) lastRequestId = id;
  return id;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  // Client-generated request-id correlates browser-side logs with the server's
  // X-Request-ID middleware. The server echoes a valid inbound id, so this
  // value should round-trip in the response header.
  const requestId = generateRequestId();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Request-ID': requestId,
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

  // Capture response request-id (server may echo ours or generate its own)
  const responseRequestId = captureRequestId(res);

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
      // Retry the original request with a fresh id + new token
      const retryRequestId = generateRequestId();
      headers['Authorization'] = `Bearer ${authToken}`;
      headers['X-Request-ID'] = retryRequestId;
      const retryRes = await fetch(`${API_URL}${finalPath}`, { ...options, headers });
      const retryResponseId = captureRequestId(retryRes);
      if (!retryRes.ok) {
        const err = await retryRes.json().catch(() => ({ error: retryRes.statusText }));
        const body = err as Record<string, string>;
        throw new ApiError(retryRes.status, body.error || retryRes.statusText, retryResponseId, body);
      }
      return retryRes.json() as Promise<T>;
    } else {
      // Refresh failed — clear tokens and redirect to login
      setToken(null, null);
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login?session_expired=1';
      }
      throw new ApiError(401, 'Session expired. Please log in again.', responseRequestId);
    }
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const body = err as Record<string, string>;
    throw new ApiError(res.status, body.error || res.statusText, responseRequestId, body);
  }

  return res.json() as Promise<T>;
}

// Auth
export const api = {
  auth: {
    login: (email: string, password: string, tenantSlug?: string) =>
      request<{
        token: string;
        refreshToken?: string;
        user: AuthUser;
        tenantSelectionRequired?: boolean;
        tenants?: { slug: string; name: string }[];
        // Backend PR #221: MFA challenge required before session is established.
        mfaRequired?: boolean;
        mfa_required?: boolean;
        challengeToken?: string;
        challenge_token?: string;
        // Grace-period warning for admin roles that haven't enrolled MFA yet.
        mfaEnforcementWarning?: { daysRemaining: number; reason?: string; mfaSetupUrl?: string };
      }>('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password, ...(tenantSlug ? { tenant_slug: tenantSlug } : {}) }),
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
    // Phase 4.4: MFA endpoints
    // Backend PR #221 shape: { secret, qr_uri, provisioning_uri } — legacy key `otpauthUri` kept as optional fallback.
    mfaSetup: () =>
      request<{ secret: string; qr_uri?: string; provisioning_uri?: string; otpauthUri?: string }>('/api/auth/mfa/setup', { method: 'POST' }),
    // Returns { success, backupCodes } — backup codes are shown ONCE at enrollment.
    mfaVerify: (code: string) =>
      request<{ success: boolean; backupCodes?: string[]; backup_codes?: string[] }>('/api/auth/mfa/verify', { method: 'POST', body: JSON.stringify({ code }) }),
    // Disable MFA — requires a fresh valid TOTP code.
    mfaDisable: (code: string) =>
      request<{ success: boolean }>('/api/auth/mfa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
    // Login MFA challenge — accepts TOTP (6 digits) or backup code (xxxx-xxxx).
    mfaValidate: (code: string, challengeToken?: string) =>
      request<{ token: string; refreshToken?: string; user: AuthUser; backupCodesRemaining?: number }>('/api/auth/mfa/validate', {
        method: 'POST',
        body: JSON.stringify({ code, ...(challengeToken ? { challenge_token: challengeToken } : {}) }),
      }),
    // Regenerate backup codes — requires JWT + fresh valid TOTP. Returns 8 new codes (shown once).
    mfaRegenerateBackupCodes: (code: string) =>
      request<{ backupCodes?: string[]; backup_codes?: string[] }>('/api/auth/mfa/regenerate-backup-codes', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    // MFA status — best-effort; server may embed status on /me instead.
    mfaStatus: () =>
      request<{ enabled: boolean; backupCodesRemaining?: number }>('/api/auth/mfa/status'),
    // API key management
    listApiKeys: () =>
      request<{ keys: { id: string; name: string; prefix: string; createdAt: string; lastUsed: string | null }[] }>('/api/auth/api-keys'),
    generateApiKey: (name?: string) =>
      request<{ id: string; name: string; key: string; prefix: string; message: string }>('/api/auth/api-keys', { method: 'POST', body: JSON.stringify({ name }) }),
    revokeApiKey: (id: string) =>
      request<{ success: boolean }>(`/api/auth/api-keys/${id}`, { method: 'DELETE' }),
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
    delete: (id: string) =>
      request<{ success: boolean; deletedRows: number; tablesCleared: number }>(`/api/tenants/${id}`, { method: 'DELETE' }),
    archive: (id: string) =>
      request<{ success: boolean; clustersDeactivated: number; agentsDeactivated: number }>(`/api/tenants/${id}/archive`, { method: 'POST' }),
    unarchive: (id: string) =>
      request<{ success: boolean }>(`/api/tenants/${id}/unarchive`, { method: 'POST' }),
    seedVantax: () =>
      request<{ success: boolean; message: string; seeded: { clusters: number; subCatalysts: number; positiveRuns: { count: number; totalItems: number; matchRate: number }; negativeRuns: { count: number; totalItems: number; matchRate: number }; metrics: number; risks: number; healthScore: number } }>('/api/v1/seed-vantax/seed-vantax', { method: 'POST' }),
    // Spec 7 POPIA: Data export and erasure
    dataExport: () =>
      request<{ success: boolean; exportedAt: string; tableCount: number; totalRecords: number; data: Record<string, unknown[]> }>('/api/tenants/data-export'),
    dataErasure: () =>
      request<{ success: boolean; erasedAt: string; erasureLog: { table: string; action: string; affected: number }[]; preservedTables: string[] }>('/api/tenants/data-export', { method: 'DELETE' }),
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
    createUser: (data: Record<string, unknown>, tenantId?: string) =>
      request<{ id: string }>(`/api/iam/users${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify(data) }),
    createPolicy: (data: Record<string, unknown>) =>
      request<{ id: string; name: string }>('/api/iam/policies', { method: 'POST', body: JSON.stringify(data) }),
    deletePolicy: (id: string) =>
      request<{ success: boolean }>(`/api/iam/policies/${id}`, { method: 'DELETE' }),
    // Phase 4.5: User management
    updateUser: (id: string, data: Record<string, unknown>, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteUser: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    resendWelcome: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/users/${id}/resend-welcome${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    // v46-platform: Custom role builder
    permissions: () =>
      request<{ permissions: string[]; baseRoles: { id: string; name: string; permissions: string[] }[] }>(`/api/iam/permissions`),
    customRoles: (tenantId?: string) =>
      request<{ roles: CustomRole[]; total: number }>(`/api/iam/custom-roles${qs({ tenant_id: tenantId })}`),
    createCustomRole: (data: { name: string; description?: string; permissions: string[]; inherits_from?: string | null }, tenantId?: string) =>
      request<{ role: CustomRole }>(`/api/iam/custom-roles${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify(data) }),
    updateCustomRole: (id: string, data: { name?: string; description?: string; permissions?: string[]; inherits_from?: string | null }, tenantId?: string) =>
      request<{ role: CustomRole }>(`/api/iam/custom-roles/${id}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCustomRole: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/iam/custom-roles/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
  },

  // v46-platform: Feature Flags (superadmin CRUD, authenticated /evaluate)
  featureFlags: {
    list: () =>
      request<{ flags: FeatureFlag[]; total: number }>(`/api/v1/admin/feature-flags`),
    create: (data: { name: string; description?: string; type?: FeatureFlagType; default_enabled?: boolean; rollout_percent?: number; tenant_allowlist?: string[] }) =>
      request<{ flag: FeatureFlag }>(`/api/v1/admin/feature-flags`, { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: { description?: string; type?: FeatureFlagType; default_enabled?: boolean; rollout_percent?: number; tenant_allowlist?: string[] }) =>
      request<{ flag: FeatureFlag }>(`/api/v1/admin/feature-flags/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/v1/admin/feature-flags/${id}`, { method: 'DELETE' }),
    toggle: (id: string) =>
      request<{ flag: FeatureFlag }>(`/api/v1/admin/feature-flags/${id}/toggle`, { method: 'POST' }),
    evaluate: (tenantId?: string) =>
      request<{ flags: Record<string, boolean>; tenantId: string }>(`/api/v1/feature-flags/evaluate${qs({ tenant_id: tenantId })}`),
  },

  // PR #219/#220/#232 multi-company: list ERP companies for the tenant so the
  // frontend switcher can scope catalyst/apex/pulse calls via ?company_id=.
  companies: {
    list: () => request<{ companies: ERPCompany[]; total: number }>('/api/erp/companies'),
  },

  apex: {
    health: (tenantId?: string, industry?: string, companyId?: string) =>
      request<HealthScore>(`/api/apex/health${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    briefing: (tenantId?: string, industry?: string, companyId?: string) =>
      request<Briefing>(`/api/apex/briefing${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    risks: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ risks: Risk[]; total: number }>(`/api/apex/risks${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    scenarios: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ scenarios: ScenarioItem[]; total: number }>(`/api/apex/scenarios${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    createScenario: (data: Record<string, unknown>) =>
      request<{ id: string; results: Record<string, unknown>; context?: Record<string, unknown> }>('/api/apex/scenarios', { method: 'POST', body: JSON.stringify(data) }),
    // A1-3: Health score history
    healthHistory: (tenantId?: string, limit?: number, companyId?: string) =>
      request<HealthHistoryResponse>(`/api/apex/health/history${qs({ tenant_id: tenantId, limit: limit?.toString(), company_id: companyId })}`),
    // A1-4: Health dimension traceability
    healthDimension: (dimension: string, tenantId?: string, companyId?: string) =>
      request<HealthDimensionTraceResponse>(`/api/apex/health/dimensions/${encodeURIComponent(dimension)}${qs({ tenant_id: tenantId, company_id: companyId })}`),
    // A4-4: Risk traceability
    riskTrace: (riskId: string, tenantId?: string, companyId?: string) =>
      request<RiskTraceResponse>(`/api/apex/risks/${riskId}/trace${qs({ tenant_id: tenantId, company_id: companyId })}`),
    riskSuggestCauses: (riskId: string, tenantId?: string, companyId?: string) =>
      request<{ success: boolean; riskId: string; analysis: { rootCauses: Array<{ description: string; confidence: number; immediateAction: string; longTermFix: string; affectedSystems: string[] }>; generatedAt: string; model: string } }>(`/api/apex/risks/${riskId}/suggest-causes${qs({ tenant_id: tenantId, company_id: companyId })}`),
    riskExport: (riskId: string, tenantId?: string, companyId?: string) =>
      fetch(`/api/apex/risks/${riskId}/export${qs({ tenant_id: tenantId, company_id: companyId })}`, { headers: { 'Content-Type': 'text/csv' } }).then(r => r.blob()),
    // Insights engine: AI-powered executive insights
    insights: (tenantId?: string, companyId?: string) =>
      request<ApexInsightsResponse>(`/api/apex/insights${qs({ tenant_id: tenantId, company_id: companyId })}`),
    // Dashboard intelligence: unified summary
    dashboardIntelligence: (tenantId?: string, companyId?: string) =>
      request<DashboardIntelligenceResponse>(`/api/apex/dashboard-intelligence${qs({ tenant_id: tenantId, company_id: companyId })}`),
  },

  pulse: {
    metrics: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ metrics: Metric[]; total: number }>(`/api/pulse/metrics${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    anomalies: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ anomalies: AnomalyItem[]; total: number }>(`/api/pulse/anomalies${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    detectAnomalies: (metricId?: string, sensitivity?: 'low' | 'medium' | 'high', tenantId?: string, companyId?: string) =>
      request<{ success: boolean; statistics: { mean: number; stdDev: number; dataPoints: number; period: string }; detected: unknown[]; count: number }>(`/api/pulse/anomalies/detect${qs({ tenant_id: tenantId, company_id: companyId })}`, { method: 'POST', body: JSON.stringify({ metric_id: metricId, sensitivity }) }),
    processes: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ processes: ProcessItem[]; total: number }>(`/api/pulse/processes${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    correlations: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ correlations: CorrelationItem[]; total: number }>(`/api/pulse/correlations${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    summary: (tenantId?: string, industry?: string, companyId?: string) =>
      request<PulseSummary>(`/api/pulse/summary${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    refresh: (tenantId?: string, companyId?: string) =>
      request<{ refreshed: boolean; processFlows?: number; metricsGenerated?: number; catalystActions?: number; message?: string }>(`/api/pulse/refresh${qs({ tenant_id: tenantId, company_id: companyId })}`, { method: 'POST' }),
    catalystRuns: (tenantId?: string, catalyst?: string, companyId?: string) =>
      request<{ runs: CatalystRunItem[]; summary: CatalystRunSummary[]; total: number }>(`/api/pulse/catalyst-runs${qs({ tenant_id: tenantId, catalyst, company_id: companyId })}`),
    // P1-4: Metric traceability
    metricTrace: (metricId: string, tenantId?: string, companyId?: string) =>
      request<MetricTraceResponse>(`/api/pulse/metrics/${metricId}/trace${qs({ tenant_id: tenantId, company_id: companyId })}`),
    // Insights engine: AI-powered operational insights
    insights: (domain?: string, tenantId?: string, companyId?: string) =>
      request<PulseInsightsResponse>(`/api/pulse/insights${qs({ tenant_id: tenantId, domain, company_id: companyId })}`),
    // Department domains available for filtering
    domains: (tenantId?: string, companyId?: string) =>
      request<{ domains: string[] }>(`/api/pulse/domains${qs({ tenant_id: tenantId, company_id: companyId })}`),
  },

  catalysts: {
    clusters: (tenantId?: string, industry?: string, companyId?: string) =>
      request<{ clusters: ClusterItem[]; total: number }>(`/api/catalysts/clusters${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    toggleSubCatalyst: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/toggle${qs({ tenant_id: tenantId })}`, { method: 'PUT' }),
    setDataSource: (clusterId: string, subName: string, dataSource: { type: string; config: Record<string, unknown> }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(dataSource) }),
    removeDataSource: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-source${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    setDataSources: (clusterId: string, subName: string, dataSources: DataSourceConfig[], tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-sources${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify({ data_sources: dataSources }) }),
    removeDataSourceByIndex: (clusterId: string, subName: string, index: number, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/data-sources/${index}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    setFieldMappings: (clusterId: string, subName: string, mappings: FieldMapping[], tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/field-mappings${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify({ field_mappings: mappings }) }),
    suggestFieldMappings: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ suggestions: FieldMapping[] }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/field-mappings/suggest${qs({ tenant_id: tenantId })}`),
    setExecutionConfig: (clusterId: string, subName: string, config: ExecutionConfig, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/execution-config${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(config) }),
    executeSubCatalyst: (clusterId: string, subName: string, tenantId?: string, companyId?: string) =>
      request<ExecutionResult>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/execute${qs({ tenant_id: tenantId, company_id: companyId })}`, { method: 'POST' }),
    getExecutionHistory: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ executions: ExecutionResult[]; total: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/executions${qs({ tenant_id: tenantId })}`),
    setSchedule:(clusterId: string, subName: string, schedule: { frequency: string; day_of_week?: number; day_of_month?: number; time_of_day?: string }, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(schedule) }),
    removeSchedule: (clusterId: string, subName: string, tenantId?: string) =>
      request<{ success: boolean; subCatalyst: SubCatalyst }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/schedule${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    cluster: (id: string) => request<ClusterDetail>(`/api/catalysts/clusters/${id}`),
    actions: (tenantId?: string, clusterId?: string, industry?: string, companyId?: string) =>
      request<{ actions: ActionItem[]; total: number }>(`/api/catalysts/actions${qs({ tenant_id: tenantId, cluster_id: clusterId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    createAction: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/catalysts/actions', { method: 'POST', body: JSON.stringify(data) }),
    approveAction: (id: string, approvedBy?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/approve`, { method: 'PUT', body: JSON.stringify({ approved_by: approvedBy || 'ui' }) }),
    rejectAction: (id: string, rejectedBy?: string, reason?: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/reject`, { method: 'PUT', body: JSON.stringify({ approved_by: rejectedBy || 'ui', reason: reason || '' }) }),
    governance: (tenantId?: string, industry?: string, companyId?: string) =>
      request<GovernanceData>(`/api/catalysts/governance${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined, company_id: companyId })}`),
    createCluster: (data: Record<string, unknown>) =>
      request<{ id: string; name: string; domain: string }>('/api/catalysts/clusters', { method: 'POST', body: JSON.stringify(data) }),
    deleteCluster: (id: string, tenantId?: string) =>
      request<{ success: boolean }>(`/api/catalysts/clusters/${id}${qs({ tenant_id: tenantId })}`, { method: 'DELETE' }),
    templates: () =>
      request<{ templates: CatalystIndustryTemplate[] }>('/api/catalysts/templates'),
    deployTemplate: (data: { tenant_id: string; industry: string; clusters?: Array<{ name: string; domain: string; description: string; autonomy_tier: string; sub_catalysts: Array<{ name: string; enabled: boolean; description: string }> }> }) =>
      request<{ success: boolean; industry: string; clustersCreated: number; clusterIds: string[]; existingClusters: number }>('/api/catalysts/deploy-template', { method: 'POST', body: JSON.stringify(data) }),
    manualExecute: async (data: FormData): Promise<ManualExecuteResult> => {
      const requestId = generateRequestId();
      const headers: Record<string, string> = { 'X-Request-ID': requestId };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      // Include tenant override for cross-tenant manual execution
      let url = `${API_URL}/api/catalysts/manual-execute`;
      if (tenantOverrideId) {
        url += `?tenant_id=${encodeURIComponent(tenantOverrideId)}`;
      }
      const res = await fetch(url, {
        method: 'POST', headers, body: data,
      });
      const responseRequestId = captureRequestId(res);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: res.statusText }));
        const body = err as Record<string, string>;
        throw new ApiError(res.status, body.error || res.statusText, responseRequestId, body);
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
    assignAction: (actionId: string, assignedTo: string) =>
      request<{ success: boolean; assignedTo: string; userName: string; userEmail: string }>(`/api/catalysts/actions/${actionId}/assign`, {
        method: 'PUT', body: JSON.stringify({ assigned_to: assignedTo }),
      }),
    hitlConfig: (clusterId?: string, tenantId?: string, subCatalystName?: string) =>
      request<{ config?: HitlConfig | null; configs?: HitlConfigListItem[]; subConfigs?: HitlConfigListItem[]; users?: Record<string, { email: string; name: string }> }>(`/api/catalysts/hitl-config${qs({ cluster_id: clusterId, tenant_id: tenantId, sub_catalyst_name: subCatalystName })}`),
    /**
     * Pending HITL approvals for the current tenant. Drives the Action
     * Queue widget in the header — these are the catalyst actions waiting
     * on a human decision (status: pending_approval | escalated).
     */
    pendingApprovals: () =>
      request<{
        approvals: Array<{
          id: string; clusterId: string; clusterName: string; domain: string;
          catalystName: string; action: string; status: string;
          confidence: number; reasoning: string;
          inputData: Record<string, unknown>; createdAt: string;
        }>;
        total: number;
      }>(`/api/catalysts/approvals`),
    saveHitlConfig: (data: { cluster_id: string; sub_catalyst_name?: string; domain?: string; validator_user_ids?: string[]; exception_handler_user_ids?: string[]; escalation_user_ids?: string[]; notify_on_completion?: boolean; notify_on_exception?: boolean; notify_on_approval_needed?: boolean }) =>
      request<{ id: string; created?: boolean; updated?: boolean }>('/api/catalysts/hitl-config', { method: 'PUT', body: JSON.stringify(data) }),
    deleteHitlConfig: (clusterId: string, subCatalystName?: string) =>
      request<{ success: boolean }>(`/api/catalysts/hitl-config/${clusterId}${qs({ sub_catalyst_name: subCatalystName })}`, { method: 'DELETE' }),
    sendRunReport: (clusterId: string, catalystName?: string) =>
      request<{ success: boolean; actionCount: number; message: string }>('/api/catalysts/send-run-report', { method: 'POST', body: JSON.stringify({ cluster_id: clusterId, catalyst_name: catalystName }) }),
    runAnalytics: (clusterId?: string, subCatalystName?: string, limit?: number) =>
      request<{ runs: RunAnalytics[]; aggregate: RunAnalyticsAggregate }>(`/api/catalysts/run-analytics${qs({ cluster_id: clusterId, sub_catalyst_name: subCatalystName, limit: limit?.toString() })}`),
    runAnalyticsDetail: (runId: string) =>
      request<{ analytics: RunAnalytics; actions: Array<{ id: string; action: string; status: string; confidence: number; assignedTo?: string; processingTimeMs?: number; createdAt: string }> }>(`/api/catalysts/run-analytics/${runId}`),
    recordRunAnalytics: (data: { cluster_id: string; sub_catalyst_name?: string; run_id?: string; actions: Array<{ action: string; status: string; confidence: number; processing_time_ms?: number }> }) =>
      request<{ id: string; runId: string; status: string; summary: { total: number; completed: number; exceptions: number; escalated: number; pending: number; autoApproved: number }; confidence: { avg: number; min: number; max: number; distribution: Record<string, number> }; insights: string[]; durationMs: number }>('/api/catalysts/run-analytics', { method: 'POST', body: JSON.stringify(data) }),

    // ── Sub-Catalyst Ops ──
    getSubCatalystRuns: (clusterId: string, subName: string, opts?: { limit?: number; offset?: number; status?: string; from?: string; to?: string; triggered_by?: string }) =>
      request<{ runs: SubCatalystRun[]; total: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/runs${qs({ limit: opts?.limit?.toString(), offset: opts?.offset?.toString(), status: opts?.status, from: opts?.from, to: opts?.to, triggered_by: opts?.triggered_by })}`),
    getSubCatalystRunDetail: (clusterId: string, subName: string, runId: string) =>
      request<SubCatalystRunDetail>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/runs/${runId}`),
    runDetail: (runId: string) =>
      request<{
        id: string; clusterId?: string; subCatalystName: string; clusterName: string; clusterDomain: string;
        status: string; matched: number; discrepancies: number; exceptions: number;
        totalValue: number; startedAt: string; completedAt: string;
        kpis: Array<{ name: string; value: number; status: string; unit: string; target: number }>;
        metrics: Array<{ id: string; name: string; value: number; unit: string; status: string }>;
        sourceData: Array<{ id: string; sourceSystem: string; recordType: string; value: number; status: string }>;
      }>(`/api/catalysts/runs/${runId}/detail`),
    getSubCatalystKpis: (clusterId: string, subName: string) =>
      request<{ kpis: KpisResponse | null }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpis`),
    getKpiDefinitions: (clusterId: string, subName: string) =>
      request<{ definitions: KpiDefinitionRow[] }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions`),
    updateKpiDefinition: (clusterId: string, subName: string, defId: string, data: { threshold_green?: number; threshold_amber?: number; threshold_red?: number; enabled?: boolean }) =>
      request<{ success: boolean }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions/${defId}`, { method: 'PUT', body: JSON.stringify(data) }),
    resetKpiDefinitions: (clusterId: string, subName: string) =>
      request<{ success: boolean; definitions_count: number }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpi-definitions/reset`, { method: 'PUT' }),
    updateSubCatalystThresholds: (clusterId: string, subName: string, thresholds: Record<string, number>) =>
      request<{ success: boolean; kpis: SubCatalystKpis }>(`/api/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/kpis/thresholds`, { method: 'PUT', body: JSON.stringify(thresholds) }),
    getRunItems: (runId: string, opts?: { limit?: number; offset?: number; status?: string; severity?: string; review_status?: string }) =>
      request<SubCatalystRunItemsResponse>(`/api/catalysts/runs/${runId}/items${qs({ limit: opts?.limit?.toString(), offset: opts?.offset?.toString(), status: opts?.status, severity: opts?.severity, review_status: opts?.review_status })}`),
    reviewRunItem: (runId: string, itemId: string, data: { review_status: string; review_notes?: string; reclassified_to?: string }) =>
      request<{ success: boolean; review_status: string; review_complete: boolean }>(`/api/catalysts/runs/${runId}/items/${itemId}/review`, { method: 'PUT', body: JSON.stringify(data) }),
    bulkReviewRunItems: (runId: string, data: { item_ids: string[]; review_status: string; review_notes?: string }) =>
      request<{ success: boolean; updated: number; review_complete: boolean }>(`/api/catalysts/runs/${runId}/items/bulk-review`, { method: 'PUT', body: JSON.stringify(data) }),
    exportRunItems: (runId: string) => `${API_URL}/api/catalysts/runs/${runId}/export`,
    retryRun: (runId: string) =>
      request<{ redirect: boolean; cluster_id: string; sub_catalyst_name: string; parent_run_id: string }>(`/api/catalysts/runs/${runId}/retry`, { method: 'POST' }),
    compareRuns: (runA: string, runB: string) =>
      request<SubCatalystRunComparison>(`/api/catalysts/runs/compare${qs({ run_a: runA, run_b: runB })}`),
    signOffRun: (runId: string, data: { status: string; notes?: string }) =>
      request<{ success: boolean; sign_off_status: string }>(`/api/catalysts/runs/${runId}/sign-off`, { method: 'PUT', body: JSON.stringify(data) }),
    getRunComments: (runId: string) =>
      request<{ comments: RunComment[] }>(`/api/catalysts/runs/${runId}/comments`),
    addRunComment: (runId: string, data: { comment: string; item_id?: string; comment_type?: string }) =>
      request<{ id: string; success: boolean }>(`/api/catalysts/runs/${runId}/comments`, { method: 'POST', body: JSON.stringify(data) }),
    deleteRunComment: (runId: string, commentId: string) =>
      request<{ success: boolean }>(`/api/catalysts/runs/${runId}/comments/${commentId}`, { method: 'DELETE' }),
    // ── Catalyst Simulator (PR N — closed-loop calibration) ───────────
    simulate: (clusterId: string, subName: string) =>
      request<CatalystSimulationResult>(`/api/v1/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/simulate`, { method: 'POST' }),
    recordSimulationOutcome: (simulationId: string, data: { run_id: string; actual_value_zar: number }) =>
      request<{ residual: number; calibration: CatalystCalibrationStats }>(`/api/v1/catalysts/simulations/${simulationId}/record-outcome`, { method: 'POST', body: JSON.stringify(data) }),
    getCalibration: (clusterId: string, subName: string) =>
      request<{ stats: CatalystCalibrationStats; history: CatalystSimulationHistoryRow[] }>(`/api/v1/catalysts/clusters/${clusterId}/sub-catalysts/${encodeURIComponent(subName)}/calibration`),
    /**
     * Tenant-wide calibration summary for the Trust & Performance buyer
     * dashboard. Aggregates accuracy across every observed simulation and
     * lists per-(cluster, sub) calibration rows.
     */
    getCalibrationSummary: () =>
      request<{
        accuracyPct: number;
        totalSimulations: number;
        simulationsWithOutcomes: number;
        totalPredictedValueZar: number;
        totalObservations: number;
        calibratedSubCatalysts: number;
        perSubCatalystCount: number;
        calibrations: Array<{
          cluster_id: string | null;
          sub_catalyst_name: string;
          n_observations: number;
          calibration_factor: number;
          std_residual: number;
          mae: number;
          last_observation_at: string | null;
        }>;
      }>(`/api/v1/catalysts/calibrations/summary`),
  },

  // ── Provenance ledger (PR O — Merkle-chained AI decision log) ─────
  provenance: {
    list: (options?: { limit?: number; offset?: number; order?: 'asc' | 'desc'; type?: string }) =>
      request<{ entries: ProvenanceEntry[]; total: number }>(`/api/audit/provenance${qs({ limit: options?.limit?.toString(), offset: options?.offset?.toString(), order: options?.order, type: options?.type })}`),
    verify: () => request<ProvenanceVerifyResult>('/api/audit/provenance/verify', { method: 'POST' }),
    root: () => request<{ root: string | null; seq: number; created_at: string | null }>('/api/audit/provenance/root'),
  },

  // ── Federated peer patterns (PR P — DP cross-tenant intelligence) ─
  peerPatterns: {
    list: (industry: string) =>
      request<{ industry_bucket: string; patterns: FederatedPattern[]; total: number }>(`/api/radar/peer-patterns${qs({ industry })}`),
    get: (findingCode: string, industry?: string) =>
      request<{ pattern: FederatedPattern | null; reason?: string }>(`/api/radar/peer-patterns/${encodeURIComponent(findingCode)}${qs({ industry })}`),
    refresh: () => request<{ buckets_refreshed: number; buckets_purged: number }>('/api/radar/peer-patterns/refresh', { method: 'POST' }),
  },

  memory: {
    entities: (tenantId?: string, type?: string, industry?: string) =>
      request<{ entities: GraphEntity[]; total: number }>(`/api/memory/entities${qs({ tenant_id: tenantId, type, industry: industry && industry !== 'general' ? industry : undefined })}`),
    entity: (id: string) => request<GraphEntityDetail>(`/api/memory/entities/${id}`),
    /** Create a new graph entity. Backend expects: type, name, properties?, source?. */
    createEntity: (body: { type: string; name: string; properties?: Record<string, unknown>; source?: string }) =>
      request<{ id: string; type: string; name: string }>('/api/memory/entities', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    relationships: (tenantId?: string, industry?: string) =>
      request<{ relationships: GraphRelationship[]; total: number }>(`/api/memory/relationships${qs({ tenant_id: tenantId, industry: industry && industry !== 'general' ? industry : undefined })}`),
    /** Create a new graph relationship. Backend expects: source_id, target_id, type, properties?. */
    createRelationship: (body: { source_id: string; target_id: string; type: string; properties?: Record<string, unknown> }) =>
      request<{ id: string }>('/api/memory/relationships', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
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
    updateConnection: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/erp/connections/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteConnection: (id: string) =>
      request<{ success: boolean }>(`/api/erp/connections/${id}`, { method: 'DELETE' }),
    testConnection: (id: string) =>
      request<{ connected: boolean; message?: string }>(`/api/erp/connections/${id}/test`, { method: 'POST' }),
    canonical: (domain?: string) => {
      let url = '/api/erp/canonical';
      if (domain) url += `?domain=${domain}`;
      return request<{ endpoints: CanonicalEndpoint[]; total: number }>(url);
    },
    sync: (connectionId: string) =>
      request<{ recordsSynced: number; syncedAt: string }>(`/api/erp/sync/${connectionId}`, { method: 'POST' }),
    // Spec 7 CIRCUIT-3: circuit breaker state for a connection (CLOSED/OPEN/HALF_OPEN)
    circuitState: (connectionId: string) =>
      request<CircuitBreakerState>(`/api/erp/connections/${connectionId}/circuit`),
    // Aggregation view: per-connection sync health (last sync, error counts, freshness).
    connectionsHealth: () =>
      request<IntegrationHealthResponse>('/api/v1/erp/connections/health'),
    // v57: discovered field schemas for a connection. Returned as a map keyed
    // by entity_type so the UI can render a section per entity. Each row gives
    // the source field name (with custom Z-fields, Odoo modules, etc. visible
    // verbatim), inferred type, sample values, null rate, and occurrence count.
    discoveredSchemas: (connectionId: string, entity?: string) =>
      request<{
        connectionId: string;
        entityCount: number;
        fieldCount: number;
        schemas: Record<string, Array<{
          entity_type: string;
          source_field: string;
          inferred_type: string;
          sample_values: string[];
          null_rate: number;
          occurrences: number;
          sample_size: number;
          source_system: string;
          first_seen_at: string;
          last_seen_at: string;
        }>>;
      }>(`/api/erp/connections/${connectionId}/schemas${qs({ entity })}`),
    // v58/v59: persisted field mappings — auto-mapper output. Customer
    // confirms or rejects each row to lock the mapping in for billing.
    mappings: (connectionId: string, opts?: { entity?: string; status?: 'active' | 'suggested' | 'all' }) =>
      request<{
        connectionId: string;
        activeCount: number;
        suggestedCount: number;
        fieldCount: number;
        mappings: Record<string, Array<{
          entity_type: string;
          canonical_field: string;
          source_field: string;
          confidence: number;
          learned_from: string;
          rationale: string | null;
          status: string;
        }>>;
      }>(`/api/erp/connections/${connectionId}/mappings${qs({ entity: opts?.entity, status: opts?.status })}`),
    refreshMappings: (connectionId: string, entityType?: string) =>
      request<{ entitiesProcessed: number; autoApplied: number; suggested: number }>(
        `/api/erp/connections/${connectionId}/mappings/refresh`,
        { method: 'POST', body: JSON.stringify(entityType ? { entity_type: entityType } : {}) },
      ),
    confirmMapping: (connectionId: string, entityType: string, canonicalField: string, sourceField: string) =>
      request<{ ok: boolean }>(
        `/api/erp/connections/${connectionId}/mappings/confirm`,
        { method: 'POST', body: JSON.stringify({ entity_type: entityType, canonical_field: canonicalField, source_field: sourceField }) },
      ),
    rejectMapping: (connectionId: string, entityType: string, canonicalField: string, sourceField: string) =>
      request<{ ok: boolean }>(
        `/api/erp/connections/${connectionId}/mappings/reject`,
        { method: 'POST', body: JSON.stringify({ entity_type: entityType, canonical_field: canonicalField, source_field: sourceField }) },
      ),
    // Phase 10-45: partner-ID mapping table — Atheon canonical partner_ref
    // ↔ ERP-native external ID. Required for write-back: subcatalysts stage
    // payloads with the canonical ref (e.g. 'vendor-acme-001'), and the
    // adapter dispatchers look up the ERP-native ID at dispatch time.
    partnerMappings: (connectionId: string, partnerType?: 'vendor' | 'customer') =>
      request<{
        mappings: Array<{
          id: string;
          tenant_id: string;
          erp_connection_id: string;
          partner_type: 'vendor' | 'customer';
          atheon_partner_ref: string;
          external_partner_id: string;
          external_partner_name: string | null;
          metadata: string;
          created_at: string;
          updated_at: string;
        }>;
        total: number;
      }>(`/api/erp/connections/${connectionId}/partner-mappings${qs({ partner_type: partnerType })}`),
    upsertPartnerMapping: (
      connectionId: string,
      body: {
        partner_type: 'vendor' | 'customer';
        atheon_partner_ref: string;
        external_partner_id: string;
        external_partner_name?: string;
        metadata?: Record<string, unknown>;
      },
    ) =>
      request<{ id: string; created: boolean; partner_type: string; atheon_partner_ref: string }>(
        `/api/erp/connections/${connectionId}/partner-mappings`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    deletePartnerMapping: (connectionId: string, partnerType: 'vendor' | 'customer', atheonRef: string) =>
      request<{ deleted: boolean }>(
        `/api/erp/connections/${connectionId}/partner-mappings/${partnerType}/${encodeURIComponent(atheonRef)}`,
        { method: 'DELETE' },
      ),
    /** Phase 10-47: bootstrap proposals from the ERP's partner list. */
    partnerMappingProposals: (connectionId: string, partnerType: 'vendor' | 'customer') =>
      request<{
        system: string;
        canonical_count: number;
        erp_partner_count: number;
        proposals: Array<{
          atheon_partner_ref: string;
          atheon_partner_name: string;
          external_partner_id: string;
          external_partner_name: string;
          confidence: number;
          reason: string;
        }>;
        total: number;
      }>(`/api/erp/connections/${connectionId}/partner-mappings/proposals${qs({ partner_type: partnerType })}`),
    bulkUpsertPartnerMappings: (
      connectionId: string,
      partnerType: 'vendor' | 'customer',
      mappings: Array<{ atheon_partner_ref: string; external_partner_id: string; external_partner_name?: string }>,
    ) =>
      request<{ created: number; updated: number; skipped: number; errors: Array<{ atheon_partner_ref: string; reason: string }> }>(
        `/api/erp/connections/${connectionId}/partner-mappings/bulk`,
        { method: 'POST', body: JSON.stringify({ partner_type: partnerType, mappings }) },
      ),
    /** Phase 10-30 / 10-48 — action-layer queue admin */
    transactionalActions: (opts?: { status?: string; sub_catalyst?: string; limit?: number }) =>
      request<{
        actions: Array<{
          id: string;
          tenant_id: string;
          erp_connection_id: string | null;
          sub_catalyst_name: string;
          action_type: string;
          target_entity: string;
          source_record_ref: string | null;
          idempotency_key: string;
          status: 'pending' | 'approved' | 'posted' | 'failed' | 'dead_letter' | 'skipped';
          external_doc_id: string | null;
          posted_at: string | null;
          error: string | null;
          retry_count: number;
          next_retry_at: string | null;
          dead_letter_at: string | null;
          posted_value: number | null;
          currency: string;
          reasoning: string | null;
          created_at: string;
          updated_at: string;
        }>;
        total: number;
      }>(`/api/erp/transactional-actions${qs({ status: opts?.status, sub_catalyst: opts?.sub_catalyst, limit: opts?.limit !== undefined ? String(opts.limit) : undefined })}`),
    transactionalActionsSummary: () =>
      request<{
        summary: Record<
          'pending' | 'approved' | 'posted' | 'failed' | 'dead_letter' | 'skipped',
          { count: number; total_value: number }
        >;
      }>('/api/erp/transactional-actions/summary'),
    reviveTransactionalAction: (actionId: string) =>
      request<{ id: string; status: string; revived: boolean }>(
        `/api/erp/transactional-actions/${actionId}/revive`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    approveTransactionalAction: (actionId: string) =>
      request<{ id: string; status: string }>(
        `/api/erp/transactional-actions/${actionId}/approve`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    skipTransactionalAction: (actionId: string, reason?: string) =>
      request<{ id: string; status: string }>(
        `/api/erp/transactional-actions/${actionId}/skip`,
        { method: 'POST', body: JSON.stringify({ reason: reason ?? 'Skipped via admin UI' }) },
      ),
    // v61: process profile — structured business rules per connection
    // (3-way-match, AP tolerance %, payment terms days, fiscal year start,
    // approval thresholds, dunning days). Catalysts read this to operate
    // within the customer's actual rules, not assumed defaults.
    processProfile: (connectionId: string) =>
      request<{
        connectionId: string;
        profile: {
          matching_mode: '2way' | '3way' | 'none' | 'unknown';
          tolerance_pct: number;
          payment_terms_days: number;
          fiscal_year_start_month: number;
          default_currency: string;
          approval_thresholds: Array<{ amount: number; role: string }>;
          dunning_days: number[];
          refreshed_at?: string;
        };
        evidence: Record<string, { source: 'inferred' | 'human' | 'default' | 'low-confidence'; basis?: string; confidence?: number }>;
        updatedAt?: string;
      }>(`/api/erp/connections/${connectionId}/process-profile`),
    refreshProcessProfile: (connectionId: string) =>
      request<{ profile: unknown; evidence: unknown }>(
        `/api/erp/connections/${connectionId}/process-profile/refresh`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    updateProcessProfile: (connectionId: string, overrides: Record<string, unknown>) =>
      request<{ profile: unknown; evidence: unknown }>(
        `/api/erp/connections/${connectionId}/process-profile`,
        { method: 'PUT', body: JSON.stringify(overrides) },
      ),
    // v63: write-back actions — dispatch, list, approve, reject. Tenant-wide
    // summary powers the Dashboard pending-count and Apex briefing.
    dispatchAction: (connectionId: string, body: Record<string, unknown>) =>
      request<{ action_id: string; status: string; result?: { ok: boolean; status: string; summary: string; details?: Record<string, unknown>; error?: string }; pending_approval?: { reason: string } }>(
        `/api/erp/connections/${connectionId}/actions`,
        { method: 'POST', body: JSON.stringify(body) },
      ),
    listConnectionActions: (connectionId: string, opts?: { status?: string; limit?: number }) =>
      request<{ connectionId: string; total: number; actions: Array<{
        id: string; catalyst_name: string; action_type: string; status: string;
        value_zar: number; idempotency_key?: string; payload?: Record<string, unknown>;
        reasoning?: string | null; output?: unknown;
        approved_by?: string | null; created_at: string; completed_at?: string | null;
      }> }>(`/api/erp/connections/${connectionId}/actions${qs({ status: opts?.status, limit: opts?.limit !== undefined ? String(opts.limit) : undefined })}`),
    approveAction: (connectionId: string, actionId: string) =>
      request<{ action_id: string; status: string; result?: { ok: boolean; summary: string } }>(
        `/api/erp/connections/${connectionId}/actions/${actionId}/approve`,
        { method: 'POST', body: JSON.stringify({}) },
      ),
    rejectAction: (connectionId: string, actionId: string, reason?: string) =>
      request<{ ok: boolean; status: string }>(
        `/api/erp/connections/${connectionId}/actions/${actionId}/reject`,
        { method: 'POST', body: JSON.stringify({ reason }) },
      ),
    listAllActions: (opts?: { status?: string; limit?: number }) =>
      request<{ tenantId: string; total: number; actions: Array<{
        id: string; catalyst_name: string; action_type: string; status: string;
        value_zar: number; source_finding_id?: string | null; connection_id?: string | null;
        idempotency_key?: string | null; output?: unknown; reasoning?: string | null;
        approved_by?: string | null; created_at: string; completed_at?: string | null;
      }> }>(`/api/erp/actions${qs({ status: opts?.status, limit: opts?.limit !== undefined ? String(opts.limit) : undefined })}`),
    actionsSummary: () =>
      request<{ tenantId: string; summary: {
        pending_approval_count: number; pending_approval_value_zar: number;
        completed_count: number; completed_value_zar: number;
        rejected_count: number; rejected_value_zar: number;
        failed_count: number; failed_value_zar: number;
        previewed_count: number; previewed_value_zar: number;
        total_count: number; total_value_zar: number;
      } }>(`/api/erp/actions/summary`),
    // v64: onboarding-status — checklist of what the customer still needs
    // to do per connection to get full value (sync, review mappings, set
    // profile rules, choose autonomy, dispatch first action).
    onboardingStatus: (connectionId: string) =>
      request<{
        connectionId: string;
        vendor: string;
        steps: Array<{
          key: 'sync' | 'mappings' | 'profile' | 'autonomy' | 'actions';
          title: string;
          description: string;
          complete: boolean;
          action_path: string;
        }>;
        complete_count: number;
        total_count: number;
      }>(`/api/erp/connections/${connectionId}/onboarding-status`),
    // v62: vendor baseline comparison — diffs the customer's profile +
    // discovered schema against the vanilla vendor baseline (SAP/Odoo/Xero).
    baselineComparison: (connectionId: string) =>
      request<{
        connectionId: string;
        vendor: string | null;
        product?: string;
        reason?: string;
        profile_deviations?: Array<{
          field: string;
          customer_value: unknown;
          recommended_value: unknown;
          severity: 'info' | 'warning' | 'critical';
          rationale: string;
          source: string;
          action: string;
        }>;
        schema_deviations?: Array<{
          entity_type: string;
          missing_fields: string[];
          custom_fields: string[];
        }>;
        flows?: Array<{
          name: string;
          description: string;
          steps: Array<{ step: string; required: boolean; description: string }>;
        }>;
        alignment_score?: number;
      }>(`/api/erp/connections/${connectionId}/baseline-comparison`),
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
    downloadBusiness: async (id: string, assessment?: Assessment) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = { 'X-Request-ID': generateRequestId() };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/business`, { headers });
        captureRequestId(res);
        if (res.ok) {
          const contentType = res.headers.get('content-type') || '';
          if (contentType.includes('application/pdf')) {
            const blob = await res.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = `business-case-${id}.pdf`; a.click();
            URL.revokeObjectURL(url);
            return;
          }
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side PDF generation — prefer Value Assessment PDF if findings exist
      if (assessment) {
        try {
          const [fRes, dqRes, ptRes, vsRes] = await Promise.all([
            api.assessments.findings(id),
            api.assessments.dataQuality(id),
            api.assessments.processTiming(id),
            api.assessments.valueSummary(id).catch(() => null),
          ]);
          if (fRes.findings && fRes.findings.length > 0) {
            const { generateValueAssessmentPDF } = await import('./report-generators');
            await generateValueAssessmentPDF(assessment, fRes.findings, dqRes.dataQuality ?? [], ptRes.processTiming ?? [], vsRes);
            return;
          }
        } catch { /* no value assessment data, try legacy */ }
        const results = assessment.results as AssessmentResults | null;
        if (results?.catalyst_scores?.length) {
          const { generateBusinessPDF } = await import('./report-generators');
          await generateBusinessPDF(assessment);
        }
      }
    },
    downloadTechnical: async (id: string, assessment?: Assessment) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = { 'X-Request-ID': generateRequestId() };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/technical`, { headers });
        captureRequestId(res);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `technical-sizing-${id}.pdf`; a.click();
          URL.revokeObjectURL(url);
          return;
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side PDF generation
      if (assessment) {
        const { generateTechnicalPDF } = await import('./report-generators');
        await generateTechnicalPDF(assessment);
      }
    },
    downloadExcel: async (id: string, assessment?: Assessment) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = { 'X-Request-ID': generateRequestId() };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/excel`, { headers });
        captureRequestId(res);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a'); a.href = url; a.download = `financial-model-${id}.xlsx`; a.click();
          URL.revokeObjectURL(url);
          return;
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side Excel generation
      if (assessment) {
        const { generateExcelReport } = await import('./report-generators');
        await generateExcelReport(assessment);
      }
    },
    // ── Value Assessment Engine endpoints ──
    runValueAssessment: (id: string, mode: 'full' | 'quick' = 'full', outcomeFeePercent?: number) =>
      request<{ id: string; status: string; mode: string }>(`/api/assessments/${id}/run-value-assessment`, {
        method: 'POST', body: JSON.stringify({ mode, outcomeFeePercent }),
      }),
    findings: (id: string, filters?: { category?: string; severity?: string; domain?: string }) =>
      request<{ findings: ValueAssessmentFinding[]; total: number }>(`/api/assessments/${id}/findings${qs({ category: filters?.category, severity: filters?.severity, domain: filters?.domain })}`),
    dataQuality: (id: string) =>
      request<{ dataQuality: DataQualityRecord[]; total: number }>(`/api/assessments/${id}/data-quality`),
    processTiming: (id: string) =>
      request<{ processTiming: ProcessTimingRecord[]; total: number }>(`/api/assessments/${id}/process-timing`),
    valueSummary: (id: string) =>
      request<ValueSummaryRecord>(`/api/assessments/${id}/value-summary`),
    downloadValueReport: async (id: string, assessment?: Assessment, findings?: ValueAssessmentFinding[], dataQuality?: DataQualityRecord[], processTiming?: ProcessTimingRecord[], valueSummary?: ValueSummaryRecord | null) => {
      // Try backend first; fall back to client-side generation
      try {
        const headers: Record<string, string> = { 'X-Request-ID': generateRequestId() };
        if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
        const res = await fetch(`${API_URL}/api/assessments/${id}/report/value`, { headers });
        captureRequestId(res);
        if (res.ok) {
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          window.open(url, '_blank');
          setTimeout(() => URL.revokeObjectURL(url), 60000);
          return;
        }
      } catch { /* backend unavailable, fall through */ }
      // Client-side PDF generation
      if (assessment && findings) {
        const { generateValueAssessmentPDF } = await import('./report-generators');
        await generateValueAssessmentPDF(assessment, findings, dataQuality ?? [], processTiming ?? [], valueSummary ?? null);
      }
    },
    evidence: (id: string, findingId: string) =>
      request<ValueAssessmentFinding>(`/api/assessments/${id}/evidence/${findingId}`),
  },

  // ── Admin (Superadmin only) ────────────────────────────────────────
  admin: {
    getLlmConfig: () =>
      request<LlmConfigResponse>('/api/admin/llm-config'),
    saveLlmConfig: (data: { provider: string; model?: string; apiKey?: string; baseUrl?: string; temperature?: number; maxTokens?: number }) =>
      request<{ success: boolean; message: string; provider: string }>('/api/admin/llm-config', { method: 'POST', body: JSON.stringify(data) }),
    /**
     * Per-tenant LLM token budget + PII redaction state (backend PR #226).
     * `monthlyTokenBudget: null` means unlimited.
     */
    getLlmBudget: (tenantId: string) =>
      request<LlmBudgetResponse>(`/api/v1/admin/tenants/${tenantId}/llm-budget`),
    setLlmBudget: (tenantId: string, body: { monthlyTokenBudget?: number | null; llmRedactionEnabled?: boolean }) =>
      request<LlmBudgetResponse>(`/api/v1/admin/tenants/${tenantId}/llm-budget`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    /**
     * Per-tenant whitelabel branding. Superadmin-only — sets the logo URL,
     * primary color (hex without #), and a display-name override that wins
     * over `tenants.name` in the UI.
     */
    setTenantBrand: (tenantId: string, body: {
      logoUrl?: string | null;
      primaryColor?: string | null;
      nameOverride?: string | null;
    }) =>
      request<{
        success: boolean;
        tenantId: string;
        brand: TenantBrand;
      }>(`/api/v1/admin/tenants/${tenantId}/brand`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
  },

  // ── Apex Radar (Spec §2.1 — 11 endpoints) ───────────────────────────
  radar: {
    // Spec §4.5: signals, signalImpact, createSignal, competitors, benchmarks, regulatory, context, scan
    signals: (category?: string, limit?: number) =>
      request<{ signals: ExternalSignal[]; total: number }>(`/api/radar/signals${qs({ category, limit: limit?.toString() })}`),
    signalImpact: (id: string) =>
      request<{ signal: ExternalSignal; impacts: SignalImpact[] }>(`/api/radar/signals/${id}/impact`),
    createSignal: (data: Record<string, unknown>) =>
      request<{ id: string; message: string }>('/api/radar/signals', { method: 'POST', body: JSON.stringify(data) }),
    competitors: () =>
      request<{ competitors: Competitor[]; total: number }>('/api/radar/competitors'),
    createCompetitor: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/competitors', { method: 'POST', body: JSON.stringify(data) }),
    updateCompetitor: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/radar/competitors/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    deleteCompetitor: (id: string) =>
      request<{ success: boolean }>(`/api/radar/competitors/${id}`, { method: 'DELETE' }),
    benchmarks: () =>
      request<{ benchmarks: MarketBenchmark[]; total: number }>('/api/radar/benchmarks'),
    createBenchmark: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/benchmarks', { method: 'POST', body: JSON.stringify(data) }),
    regulatory: (status?: string) =>
      request<{ events: RegulatoryEvent[]; total: number }>(`/api/radar/regulatory${qs({ status })}`),
    createRegulatory: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/radar/regulatory', { method: 'POST', body: JSON.stringify(data) }),
    context: (tenantId?: string) =>
      request<StrategicContext>(`/api/radar/context${qs({ tenant_id: tenantId })}`),
    scan: () =>
      request<{ message: string }>('/api/radar/scan', { method: 'POST' }),
    // Legacy aliases for backwards compat with existing frontend
    getContext: (tenantId?: string) =>
      request<RadarContextResponse>(`/api/radar/context${qs({ tenant_id: tenantId })}`),
    rebuildContext: (tenantId?: string) =>
      request<{ context: RadarStrategicContext }>(`/api/radar/context/rebuild${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    getSignals: (tenantId?: string, options?: { status?: string; type?: string; limit?: number }) =>
      request<{ signals: RadarSignalItem[]; total: number }>(`/api/radar/signals${qs({ tenant_id: tenantId, status: options?.status, type: options?.type, limit: options?.limit?.toString() })}`),
    getSignal: (signalId: string, tenantId?: string) =>
      request<{ signal: RadarSignalItem; impacts: RadarSignalImpactItem[] }>(`/api/radar/signals/${signalId}${qs({ tenant_id: tenantId })}`),
    analyseSignal: (signalId: string, tenantId?: string) =>
      request<{ impacts: RadarSignalImpactItem[] }>(`/api/radar/signals/${signalId}/analyse${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    updateSignal: (signalId: string, data: { status?: string; severity?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/radar/signals/${signalId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getImpacts: (tenantId?: string, dimension?: string) =>
      request<{ impacts: RadarImpactWithSignal[]; total: number }>(`/api/radar/impacts${qs({ tenant_id: tenantId, dimension })}`),
  },

  // ── Pulse Diagnostics (Spec §2.2 — 7 endpoints) ───────────────────
  diagnostics: {
    // Spec §4.5: list, forMetric, analyse, chain, prescriptions, updatePrescription, summary
    list: (status?: string) =>
      request<{ analyses: RootCauseAnalysis[]; total: number }>(`/api/diagnostics${qs({ status })}`),
    forMetric: (metricId: string) =>
      request<{ analyses: RootCauseAnalysis[]; total: number } | { exists: false; canDiagnose: true }>(`/api/diagnostics/${metricId}`),
    analyse: (metricId: string) =>
      request<{ id: string }>(`/api/diagnostics/${metricId}/analyse`, { method: 'POST' }),
    chain: (rcaId: string) =>
      request<{ rca: Record<string, unknown>; factors: CausalFactor[] }>(`/api/diagnostics/rca/${rcaId}/chain`),
    prescriptions: (rcaId: string) =>
      request<{ prescriptions: DiagnosticPrescription[]; total: number }>(`/api/diagnostics/rca/${rcaId}/prescriptions`),
    updatePrescription: (id: string, status: string) =>
      request<{ success: boolean }>(`/api/diagnostics/prescriptions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    summary: () =>
      request<DiagnosticsSummary>('/api/diagnostics/summary'),
    // Legacy aliases for backwards compat with existing frontend
    getSummary: (tenantId?: string) =>
      request<DiagnosticSummaryResponse>(`/api/diagnostics/summary${qs({ tenant_id: tenantId })}`),
    getAnalyses: (tenantId?: string, options?: { status?: string; limit?: number }) =>
      request<{ analyses: DiagnosticAnalysisItem[]; total: number }>(`/api/diagnostics${qs({ tenant_id: tenantId, status: options?.status, limit: options?.limit?.toString() })}`),
    getAnalysis: (analysisId: string, tenantId?: string) =>
      request<DiagnosticAnalysisDetail>(`/api/diagnostics/analyses/${analysisId}${qs({ tenant_id: tenantId })}`),
    analyseMetric: (metricId: string, tenantId?: string) =>
      request<DiagnosticAnalysisDetail>(`/api/diagnostics/${metricId}/analyse${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    createFix: (data: { chain_id: string; analysis_id: string; assigned_to?: string; notes?: string }, tenantId?: string) =>
      request<{ id: string; status: string }>(`/api/diagnostics/fixes${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify(data) }),
    updateFix: (fixId: string, data: { status?: string; assigned_to?: string; outcome?: string; notes?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/diagnostics/fixes/${fixId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getFixes: (tenantId?: string, status?: string) =>
      request<{ fixes: DiagnosticFixItem[]; total: number }>(`/api/diagnostics/fixes${qs({ tenant_id: tenantId, status })}`),
  },

  // ── Catalyst Intelligence (Spec §2.3 — 7 endpoints) ────────────────
  catalystIntelligence: {
    // Spec §4.5: patterns, patternDetail, analyse, effectiveness, dependencies, prescriptions, updatePrescription
    patterns: (clusterId?: string, type?: string) =>
      request<{ patterns: CatalystPattern[]; total: number }>(`/api/catalyst-intelligence/patterns${qs({ cluster_id: clusterId, type })}`),
    patternDetail: (id: string) =>
      request<{ pattern: CatalystPattern; prescription: CatalystPrescriptionItem | null }>(`/api/catalyst-intelligence/patterns/${id}`),
    analyse: (clusterId?: string, subName?: string) =>
      request<{ message: string }>('/api/catalyst-intelligence/analyse', { method: 'POST', body: JSON.stringify({ cluster_id: clusterId, sub_catalyst_name: subName }) }),
    effectiveness: (clusterId?: string, period?: string) =>
      request<{ effectiveness: CatalystEffectivenessData[]; total: number }>(`/api/catalyst-intelligence/effectiveness${qs({ cluster_id: clusterId, period })}`),
    dependencies: () =>
      request<{ dependencies: CatalystDependency[]; total: number }>('/api/catalyst-intelligence/dependencies'),
    prescriptions: (status?: string, clusterId?: string) =>
      request<{ prescriptions: CatalystPrescriptionItem[]; total: number }>(`/api/catalyst-intelligence/prescriptions${qs({ status, cluster_id: clusterId })}`),
    updatePrescription: (id: string, status: string) =>
      request<{ success: boolean }>(`/api/catalyst-intelligence/prescriptions/${id}/status`, { method: 'PUT', body: JSON.stringify({ status }) }),
    // Legacy aliases for backwards compat with existing frontend
    getPatterns: (tenantId?: string, options?: { status?: string; type?: string; limit?: number }) =>
      request<{ patterns: CatalystPatternItem[]; total: number }>(`/api/catalyst-intelligence/patterns${qs({ tenant_id: tenantId, status: options?.status, type: options?.type, limit: options?.limit?.toString() })}`),
    updatePattern: (patternId: string, data: { status?: string; severity?: string }, tenantId?: string) =>
      request<{ success: boolean }>(`/api/catalyst-intelligence/patterns/${patternId}${qs({ tenant_id: tenantId })}`, { method: 'PUT', body: JSON.stringify(data) }),
    getEffectiveness: (tenantId?: string, clusterId?: string) =>
      request<{ effectiveness: CatalystEffectivenessItem[]; total: number }>(`/api/catalyst-intelligence/effectiveness${qs({ tenant_id: tenantId, cluster_id: clusterId })}`),
    calculateEffectiveness: (tenantId?: string, periodDays?: number) =>
      request<{ effectiveness: CatalystEffectivenessItem[]; total: number; periodDays: number }>(`/api/catalyst-intelligence/effectiveness/calculate${qs({ tenant_id: tenantId })}`, { method: 'POST', body: JSON.stringify({ period_days: periodDays || 30 }) }),
    getDependencies: (tenantId?: string, clusterId?: string) =>
      request<{ dependencies: CatalystDependencyItem[]; total: number }>(`/api/catalyst-intelligence/dependencies${qs({ tenant_id: tenantId, cluster_id: clusterId })}`),
    discoverDependencies: (tenantId?: string) =>
      request<{ dependencies: CatalystDependencyItem[]; discovered: number }>(`/api/catalyst-intelligence/dependencies/discover${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    getOverview: (tenantId?: string) =>
      request<CatalystIntelligenceOverview>(`/api/catalyst-intelligence/overview${qs({ tenant_id: tenantId })}`),
    getPrescriptions: (tenantId?: string, status?: string) =>
      request<{ prescriptions: CatalystPrescriptionItem[]; total: number }>(`/api/catalyst-intelligence/prescriptions${qs({ tenant_id: tenantId, status })}`),
  },

  // ── ROI Tracking (Spec §2.4 — 3 endpoints) ─────────────────────────
  roi: {
    summary: () =>
      request<ROISummary>('/api/roi'),
    history: (limit?: number) =>
      request<{ history: ROISummary[]; total: number }>(`/api/roi/history${qs({ limit: limit?.toString() })}`),
    exportPdf: async () => {
      const requestId = generateRequestId();
      const headers: Record<string, string> = { 'X-Request-ID': requestId };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/roi/export`, { headers });
      const responseRequestId = captureRequestId(res);
      if (!res.ok) throw new ApiError(res.status, 'Failed to export ROI PDF', responseRequestId);
      return res.blob();
    },
    // Legacy aliases for backwards compat
    get: (tenantId?: string) =>
      request<ROITrackingResponse>(`/api/roi${qs({ tenant_id: tenantId })}`),
    exportCsv: (tenantId?: string) =>
      request<{ export: Record<string, unknown>[]; total: number; currency: string }>(`/api/roi/export${qs({ tenant_id: tenantId })}`),
  },

  // ── Board Report (Spec §2.5 — 3 endpoints) ─────────────────────────
  boardReport: {
    generate: (tenantId?: string) =>
      request<BoardReportItem>(`/api/board-report/generate${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    list: (tenantId?: string) =>
      request<{ reports: BoardReportItem[]; total: number }>(`/api/board-report${qs({ tenant_id: tenantId })}`),
    get: (id: string, tenantId?: string) =>
      request<BoardReportItem>(`/api/board-report/${id}${qs({ tenant_id: tenantId })}`),
    /** @deprecated Use generate/list/get instead */
    generateV2: (tenantId?: string) =>
      request<BoardReport>(`/api/board-report/generate${qs({ tenant_id: tenantId })}`, { method: 'POST' }),
    listV2: (tenantId?: string) =>
      request<{ reports: BoardReport[]; total: number }>(`/api/board-report${qs({ tenant_id: tenantId })}`),
    getV2: (id: string, tenantId?: string) =>
      request<BoardReport>(`/api/board-report/${id}${qs({ tenant_id: tenantId })}`),
    downloadPdf: async (id: string, title?: string) => {
      const requestId = generateRequestId();
      const headers: Record<string, string> = { 'X-Request-ID': requestId };
      if (authToken) headers['Authorization'] = `Bearer ${authToken}`;
      const res = await fetch(`${API_URL}/api/board-report/${id}/pdf`, { headers });
      const responseRequestId = captureRequestId(res);
      if (!res.ok) throw new ApiError(res.status, 'Failed to download board report PDF', responseRequestId);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeName = (title || 'board-report').replace(/["\r\n\\/:*?<>|]/g, '_').slice(0, 100);
      const a = document.createElement('a'); a.href = url; a.download = `${safeName}.pdf`; a.click();
      URL.revokeObjectURL(url);
    },
  },

  // ── Onboarding (Spec §9.2) ─────────────────────────────────
  onboarding: {
    progress: () =>
      request<OnboardingProgressResponse>('/api/onboarding/progress'),
    completeStep: (stepId: string) =>
      request<{ success: boolean; stepId: string }>(`/api/onboarding/complete/${stepId}`, { method: 'PUT' }),
    dismiss: () =>
      request<{ success: boolean; message: string }>('/api/onboarding/dismiss', { method: 'PUT' }),
  },

  // ── Freshness (Spec §9.3) ──────────────────────────────────
  freshness: {
    get: () =>
      request<FreshnessResponse>('/api/freshness'),
  },

  // ── §11.7 Atheon Score ─────────────────────────────────────
  atheonScore: {
    get: () =>
      request<AtheonScoreResponse>('/api/atheon-score'),
  },

  // ── §11.1 Trial Assessment (public — no auth) ─────────────
  trial: {
    start: (data: { company_name: string; industry: string; contact_name: string; contact_email: string }) =>
      request<{ id: string; tenantId: string; status: string }>('/api/trial/start', { method: 'POST', body: JSON.stringify(data) }),
    upload: (id: string, data: { filename: string; row_count: number; columns: string[] }) =>
      request<{ received: boolean }>(`/api/trial/${id}/upload`, { method: 'POST', body: JSON.stringify(data) }),
    run: (id: string) =>
      request<{ status: string }>(`/api/trial/${id}/run`, { method: 'POST' }),
    status: (id: string) =>
      request<{ id: string; status: string; progress: number; currentStep: string | null }>(`/api/trial/${id}/status`),
    results: (id: string) =>
      request<TrialResultsResponse>(`/api/trial/${id}/results`),
    report: (id: string) =>
      request<TrialReportResponse>(`/api/trial/${id}/report`),
  },

  // ── §11.2 Baseline Snapshots ──────────────────────────────
  baseline: {
    capture: (snapshotType?: string) =>
      request<{ id: string; snapshotType: string; healthScore: number }>('/api/baseline/capture', { method: 'POST', body: JSON.stringify({ snapshot_type: snapshotType || 'manual' }) }),
    list: () =>
      request<{ snapshots: BaselineSnapshot[]; total: number }>('/api/baseline'),
    comparison: () =>
      request<BaselineComparisonResponse>('/api/baseline/comparison'),
  },

  // ── §11.3 Goal Setting & Target Tracking ──────────────────
  targets: {
    list: () =>
      request<{ targets: HealthTarget[]; total: number }>('/api/targets'),
    create: (data: { target_type: string; target_name: string; target_value: number; target_deadline?: string }) =>
      request<{ id: string }>('/api/targets', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: Record<string, unknown>) =>
      request<{ success: boolean }>(`/api/targets/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/targets/${id}`, { method: 'DELETE' }),
  },

  // ── §11.4 Peer Benchmarks ─────────────────────────────────
  peerBenchmarks: {
    get: () =>
      request<PeerBenchmarksResponse>('/api/radar/peer-benchmarks'),
  },

  // ── §11.5 Cost of Inaction ────────────────────────────────
  costOfInaction: {
    get: () =>
      request<CostOfInactionResponse>('/api/diagnostics/cost-of-inaction'),
  },

  // ── §11.6 Success Stories ─────────────────────────────────
  successStories: {
    get: () =>
      request<SuccessStoriesResponse>('/api/radar/success-stories'),
  },

  // ── §11.8 Executive Summary ───────────────────────────────
  executiveSummary: {
    get: () =>
      request<ExecutiveSummaryResponse>('/api/executive-summary'),
  },

  // ── Admin Tooling (ADMIN-001 to ADMIN-012) ─────────────────
  adminTooling: {
    // ADMIN-001: Platform Health
    platformHealth: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/platform-health'),
    // ADMIN-002: Support Console
    supportTenants: (q?: string) =>
      request<{ tenants: Record<string, unknown>[] }>(`/api/v1/admin-tooling/support/tenants${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    supportTenantDetail: (id: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/support/tenant/${id}`),
    // ADMIN-003: Company Health
    companyHealth: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/company-health'),
    // ADMIN-004: Impersonation
    impersonateSearch: (q?: string) =>
      request<{ users: Record<string, unknown>[] }>(`/api/v1/admin-tooling/impersonate/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
    impersonateStart: (userId: string) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/impersonate/start', { method: 'POST', body: JSON.stringify({ userId }) }),
    impersonateEnd: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/impersonate/end', { method: 'POST' }),
    // ADMIN-005: Bulk Users
    bulkUsersExport: (tenantId?: string) =>
      request<{ users: Record<string, unknown>[]; count: number }>(`/api/v1/admin-tooling/bulk-users/export${tenantId ? `?tenantId=${tenantId}` : ''}`),
    bulkUsersImport: (users: Array<{ name: string; email: string; role: string; department?: string }>) =>
      request<{ imported: number; skipped: number }>('/api/v1/admin-tooling/bulk-users/import', { method: 'POST', body: JSON.stringify({ users }) }),
    bulkUsersAction: (userIds: string[], action: string, value?: string) =>
      request<{ affected: number }>('/api/v1/admin-tooling/bulk-users/action', { method: 'POST', body: JSON.stringify({ userIds, action, value }) }),
    // ADMIN-006: Custom Roles
    customRolesList: () =>
      request<{ roles: Record<string, unknown>[]; count: number }>('/api/v1/admin-tooling/custom-roles'),
    customRolesCreate: (data: { name: string; description: string; permissions: string[] }) =>
      request<{ id: string }>('/api/v1/admin-tooling/custom-roles', { method: 'POST', body: JSON.stringify(data) }),
    customRolesDelete: (id: string) =>
      request<{ success: boolean }>(`/api/v1/admin-tooling/custom-roles/${id}`, { method: 'DELETE' }),
    // ADMIN-007: Revenue
    revenue: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/revenue'),
    // ADMIN-008: Feature Flags
    featureFlags: () =>
      request<{ flags: Record<string, unknown>[] }>('/api/v1/admin-tooling/feature-flags'),
    featureFlagCreate: (flag: { key: string; name: string; type: string; enabled: boolean; value?: unknown }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/feature-flags', { method: 'POST', body: JSON.stringify(flag) }),
    featureFlagUpdate: (key: string, update: { enabled?: boolean; value?: unknown }) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/feature-flags/${key}`, { method: 'PUT', body: JSON.stringify(update) }),
    featureFlagDelete: (key: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/feature-flags/${key}`, { method: 'DELETE' }),
    // ADMIN-009: Data Governance
    dataGovernance: () =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/data-governance'),
    dsarCreate: (data: { type: string; subjectEmail: string; notes?: string }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/data-governance/dsar', { method: 'POST', body: JSON.stringify(data) }),
    // ADMIN-010: Integration Health
    integrationHealth: () =>
      request<{ connections: Record<string, unknown>[] }>('/api/v1/admin-tooling/integration-health'),
    // ADMIN-011: Tenant Read Access
    tenantsRead: () =>
      request<{ tenants: Record<string, unknown>[]; count: number }>('/api/v1/admin-tooling/tenants-read'),
    tenantReadDetail: (id: string) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/tenants-read/${id}`),
    // ADMIN-012: System Alerts
    systemAlerts: () =>
      request<{ alerts: Record<string, unknown>[] }>('/api/v1/admin-tooling/system-alerts'),
    alertRules: () =>
      request<{ rules: Record<string, unknown>[] }>('/api/v1/admin-tooling/system-alerts/rules'),
    alertRuleCreate: (rule: { name: string; condition: string; severity: string; channels: string[] }) =>
      request<Record<string, unknown>>('/api/v1/admin-tooling/system-alerts/rules', { method: 'POST', body: JSON.stringify(rule) }),
    alertRuleUpdate: (id: string, update: Record<string, unknown>) =>
      request<Record<string, unknown>>(`/api/v1/admin-tooling/system-alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(update) }),

    // ── Aggregation views (read-only, over existing tables) ────────────
    // Per-tenant company health roll-up (admin+).
    companyHealthDetail: (tenantId: string) =>
      request<CompanyHealthDetail>(`/api/v1/admin-tooling/company-health/${tenantId}`),
  },

  // ── Admin aggregation views (superadmin) ─────────────────────────────
  adminAggregation: {
    // Revenue & usage roll-up (superadmin only). MRR is estimated from plan tier.
    revenueUsage: () =>
      request<RevenueUsageResponse>('/api/v1/admin/revenue-usage'),
  },

  // ── Data governance roll-up (admin+ for own tenant; superadmin any) ──
  governance: {
    get: (tenantId: string) =>
      request<GovernanceResponse>(`/api/v1/governance/${tenantId}`),
  },

  // ── v45: Bulk User Management (iam.ts) ─────────────────────────────
  bulkUsers: {
    import: (csv: string, dryRun = false) =>
      request<{
        importId: string;
        total: number;
        created: number;
        createdUsers: Array<{ row: number; id: string; email: string; name: string; role: string; tempPassword: string }>;
        skipped: Array<{ row: number; email: string; reason: string }>;
        errors: Array<{ row: number; email?: string; reason: string }>;
        dryRun: boolean;
      }>('/api/v1/iam/users/bulk-import', { method: 'POST', body: JSON.stringify({ csv, dryRun }) }),
    action: (user_ids: string[], action: 'suspend' | 'activate' | 'change_role', role?: string) =>
      request<{ applied: number; failed: Array<{ user_id: string; reason: string }>; appliedUsers: Array<{ user_id: string; email?: string }> }>(
        '/api/v1/iam/users/bulk-action',
        { method: 'POST', body: JSON.stringify({ user_ids, action, role }) },
      ),
    history: () =>
      request<{ imports: Array<{ id: string; imported_by: string | null; row_count: number; created_count: number; skipped_count: number; error_count: number; outcome: string; created_at: string }> }>(
        '/api/v1/iam/users/import-history',
      ),
  },

  // ── v45: System Alert Rules (system-alerts.ts) ─────────────────────
  systemAlertRules: {
    list: () =>
      request<{ rules: Array<Record<string, unknown>> }>('/api/v1/system-alerts/rules'),
    create: (rule: {
      name: string;
      description?: string;
      event_type: string;
      condition: { field: string; op: string; value: unknown };
      severity?: string;
      channels?: string[];
      recipients?: string[];
      enabled?: boolean;
    }) =>
      request<{ rule: Record<string, unknown> }>('/api/v1/system-alerts/rules', { method: 'POST', body: JSON.stringify(rule) }),
    update: (id: string, update: Record<string, unknown>) =>
      request<{ rule: Record<string, unknown> }>(`/api/v1/system-alerts/rules/${id}`, { method: 'PUT', body: JSON.stringify(update) }),
    remove: (id: string) =>
      request<{ success: boolean }>(`/api/v1/system-alerts/rules/${id}`, { method: 'DELETE' }),
    silence: (id: string, until: string | null) =>
      request<{ success: boolean; silenced_until: string | null }>(
        `/api/v1/system-alerts/rules/${id}/silence`,
        { method: 'POST', body: JSON.stringify({ until }) },
      ),
    test: (id: string, payload: Record<string, unknown> = {}) =>
      request<{
        rule_id: string;
        event_type: string;
        would_fire: boolean;
        matched: boolean;
        enabled: boolean;
        silenced: boolean;
        reason: string;
        channels: string[];
        recipients: string[];
        severity: string;
      }>(`/api/v1/system-alerts/rules/${id}/test`, { method: 'POST', body: JSON.stringify({ payload }) }),
  },

  // ── v48: Support tickets (support.ts) ───────────────────────────────
  support: {
    list: (params: { limit?: number; cursor?: string; status?: string } = {}) => {
      const query = qs({
        limit: params.limit !== undefined ? String(params.limit) : undefined,
        cursor: params.cursor,
        status: params.status,
      });
      return request<{ tickets: SupportTicket[]; next_cursor: string | null }>(`/api/v1/support/tickets${query}`);
    },
    create: (data: {
      subject: string;
      body: string;
      category?: string;
      priority?: string;
    }) =>
      request<{ ticket: SupportTicket }>('/api/v1/support/tickets', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    get: (id: string) =>
      request<{ ticket: SupportTicket; replies: SupportTicketReply[] }>(`/api/v1/support/tickets/${id}`),
    addReply: (id: string, body: string) =>
      request<{ reply: SupportTicketReply }>(`/api/v1/support/tickets/${id}/replies`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      }),
    update: (id: string, patch: {
      status?: string;
      priority?: string;
      assignee_user_id?: string | null;
    }) =>
      request<{ ticket: SupportTicket }>(`/api/v1/support/tickets/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
  },

  // ── Webhooks (PR #225): HMAC-signed outbound event delivery ─────────
  webhooks: {
    list: () =>
      request<{ webhooks: Webhook[]; total: number }>('/api/v1/webhooks'),
    get: (id: string) =>
      request<Webhook>(`/api/v1/webhooks/${id}`),
    create: (data: { url: string; event_types: string[]; description?: string }) =>
      request<WebhookCreateResponse>('/api/v1/webhooks', { method: 'POST', body: JSON.stringify(data) }),
    delete: (id: string) =>
      request<{ success: boolean }>(`/api/v1/webhooks/${id}`, { method: 'DELETE' }),
    test: (id: string) =>
      request<{ success: boolean; delivery_id?: string; message?: string }>(`/api/v1/webhooks/${id}/test`, { method: 'POST' }),
    deliveries: (id: string, limit = 25) =>
      request<{ deliveries: WebhookDelivery[]; total: number }>(`/api/v1/webhooks/${id}/deliveries${qs({ limit: String(limit) })}`),
    eventTypes: () =>
      request<{ event_types: string[] }>('/api/v1/webhooks/event-types').catch(() => ({ event_types: [] as string[] })),
  },

  // ── Compliance (SOC 2 evidence pack) ─────────────────────────────
  compliance: {
    /**
     * Aggregated SOC 2 control evidence for the current tenant. Admin+ for
     * own tenant; support_admin / superadmin can pass `tenantId` to read
     * any tenant's pack. Audit-logged on the backend.
     */
    evidencePack: (tenantId?: string) =>
      request<{
        generatedAt: string;
        tenantId: string;
        generatedBy: string;
        accessReviews: {
          activeAdminCount: number;
          adminsAssignedLast90d: number;
          roleChangesLast90d: number;
          mfaEnabledCount: number;
          activeUserCount: number;
        };
        mfa: {
          totalUsers: number;
          mfaEnabled: number;
          mfaCoveragePct: number;
          adminsInGracePeriod: number;
          adminsExpiredGrace: number;
        };
        configChanges: {
          changesLast30d: number;
          changesLast90d: number;
          topActions: Array<{ action: string; count: number }>;
        };
        incidentResponse: {
          totalCriticalLast90d: number;
          resolvedCriticalLast90d: number;
          openCritical: number;
          medianResolutionHours: number | null;
        };
        deprovisioning: {
          deprovisionedLast90d: number;
          currentlyDisabled: number;
          privilegedDisabled: number;
        };
        encryption: { erpEncrypted: number; erpPlaintext: number; totalConnections: number };
        auditRetention: {
          totalRows: number;
          oldestEventAt: string | null;
          oneYearAgo: string;
          provenanceChainLength: number;
        };
      }>(`/api/v1/compliance/evidence-pack${qs({ tenant_id: tenantId })}`),
  },

  // ── Billing (self-service trial → paid Stripe Checkout) ───────────
  billing: {
    /** Public — list available plans + prices. Used by /pricing. */
    plans: () =>
      request<{ plans: Array<{
        id: string; name: string; description: string;
        price: { monthly: number; annual: number };
        currency: string; features: string[];
        limits: { users: number; erpConnections: number; catalystClusters: number; storageGb: number };
      }> }>('/api/billing/plans'),
    /** Authenticated — current tenant's active subscription, if any. */
    subscription: () =>
      request<{ subscription: {
        planId: string; status: string;
        currentPeriodStart: string; currentPeriodEnd: string;
        stripeSubscriptionId?: string; stripeCustomerId?: string;
      } | null }>('/api/billing/subscription'),
    /** Create a Stripe Checkout Session for the current tenant. */
    checkout: (body: { plan_id: string; billing_cycle: 'monthly' | 'annual'; success_url?: string; cancel_url?: string }) =>
      request<{ sessionId: string; url: string; planId: string; billingCycle: string }>(
        '/api/billing/checkout',
        { method: 'POST', body: JSON.stringify(body) },
      ),
  },

  // Generic HTTP helpers for pages that call arbitrary endpoints
  get: <T = Record<string, unknown>>(path: string) => request<T>(path),
  post: <T = Record<string, unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  put: <T = Record<string, unknown>>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }),
  delete: <T = Record<string, unknown>>(path: string) => request<T>(path, { method: 'DELETE' }),
};

// Types for API responses
export interface TenantBrand {
  /** HTTPS URL or data:image/ URI. Null = no logo override. */
  logoUrl: string | null;
  /** Hex without leading # (e.g. "4A6B5A"). Null = use platform default. */
  primaryColor: string | null;
  /** Short tenant-side display name. Null = fall back to tenants.name. */
  nameOverride: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  permissions: string[];
  /** Per-tenant whitelabel — populated by /api/auth/me. */
  brand?: TenantBrand;
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

// ── v46-platform: Feature Flags + Custom Roles ─────────────────────────

export type FeatureFlagType = 'boolean' | 'percent' | 'tenant_allowlist';

export interface FeatureFlag {
  id: string;
  name: string;
  description: string;
  type: FeatureFlagType;
  defaultEnabled: boolean;
  rolloutPercent: number;
  tenantAllowlist: string[];
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomRole {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  permissions: string[];
  inheritsFrom: string | null;
  inheritedPermissions: string[];
  userCount: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
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
  // A2: Data-driven briefing fields
  healthDelta: number | null;
  redMetricCount: number | null;
  anomalyCount: number | null;
  activeRiskCount: number | null;
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
  // A4-3: Source attribution for drill-through
  sourceRunId: string | null;
  clusterId: string | null;
  subCatalystName: string | null;
}

export interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  inputQuery: string;
  variables: string[];
  results: Record<string, unknown>;
  context?: Record<string, unknown>;
  status: string;
  createdAt: string;
}

// A1-4: Health dimension traceability response
export interface HealthDimensionTraceResponse {
  dimension: string;
  score: number | null;
  trend: string;
  delta: number;
  contributors: string[];
  sourceRunId: string | null;
  catalystName: string | null;
  kpiContributors: Array<{ name: string; value: number; status: string }>;
  lastUpdated: string;
  calculatedAt: string;
  traceability: {
    contributingClusters: Array<{ clusterId: string; clusterName: string; domain: string; subCataulysts: Array<{ name?: string }> }>;
    recentRuns: Array<{ runId: string; clusterId: string; subCataulystName: string; status: string; matched: number; discrepancies: number; exceptions: number; totalValue: number; startedAt: string }>;
    relevantKpis: Array<{ kpiId: string; kpiName: string; category: string; value: number; status: string; unit: string; measuredAt: string; subCataulystName: string; runId: string }>;
  };
  drillDownPath: {
    dimension: string;
    clusters: string[];
    subCataulysts: string[];
    runs: string[];
    items: string;
  };
}

// A4-4: Risk alert traceability response
export interface RiskTraceResponse {
  riskAlert: {
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
    resolvedAt: string | null;
  };
  sourceAttribution: {
    sourceRunId: string | null;
    clusterId: string | null;
    subCataulystName: string | null;
  };
  sourceRun: {
    runId: string;
    clusterId: string;
    subCataulystName: string;
    catalystName: string;
    status: string;
    matched: number;
    discrepancies: number;
    exceptions: number;
    totalValue: number;
    startedAt: string;
    completedAt: string;
    reasoning: string | null;
  } | null;
  cluster: {
    clusterId: string;
    clusterName: string;
    domain: string;
    autonomyTier: string;
    subCataulysts: Array<{ name?: string }>;
  } | null;
  contributingKpis: Array<{ kpiName: string; category: string; unit: string; value: number; status: string; measuredAt: string }>;
  flaggedItems: Array<{ itemNumber: number; status: string; type: string | null; severity: string | null; sourceRef: string | null; targetRef: string | null; field: string | null; sourceValue: unknown; targetValue: unknown; difference: string | null }>;
  relatedAnomalies: Array<{ anomalyId: string; metric: string; severity: string; expectedValue: number; actualValue: number; deviation: number; detectedAt: string }>;
  drillDownPath: {
    risk: string;
    run: string | null;
    items: string;
    cluster: string | null;
    kpis: string;
  };
}

// P1-4: Metric traceability response
export interface MetricTraceResponse {
  metric: {
    id: string;
    name: string;
    value: number;
    status: string;
    unit: string;
    measuredAt: string;
    trend: number[];
  };
  sourceAttribution: {
    subCataulystName: string | null;
    sourceRunId: string | null;
    clusterId: string | null;
    sourceSystem: string | null;
  };
  sourceRun: {
    runId: string;
    subCataulystName: string;
    status: string;
    matched: number;
    discrepancies: number;
    exceptions: number;
    totalValue: number;
    startedAt: string;
    completedAt: string;
  } | null;
  cluster: {
    clusterId: string;
    clusterName: string;
    domain: string;
    subCataulysts: Array<{ name?: string }>;
  } | null;
  contributingKpis: Array<{ kpiName: string; category: string; value: number; status: string; measuredAt: string }>;
  relatedAnomalies: Array<{ anomalyId: string; severity: string; expectedValue: number; actualValue: number; deviation: number; detectedAt: string }>;
  drillDownPath: {
    metric: string;
    run: string | null;
    items: string;
    kpis: string;
  };
}

// A1-3: Health score history
export interface HealthHistoryItem {
  id: string;
  overallScore: number;
  dimensions: Record<string, unknown>;
  sourceRunId: string | null;
  catalystName: string | null;
  recordedAt: string;
}
export interface HealthHistoryResponse {
  history: HealthHistoryItem[];
  delta: number;
  deltaLabel: string;
  total: number;
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
  // P1-3: Source attribution
  subCatalystName: string | null;
  sourceRunId: string | null;
  clusterId: string | null;
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
  metricA: string;
  metricB: string;
  sourceSystem: string;
  sourceEvent: string;
  targetSystem: string;
  targetImpact: string;
  correlationType: string;
  confidence: number;
  lagHours: number;
  lagDays: number;
  description: string;
  detectedAt: string;
  sourceRunId: string | null;
  clusterId: string | null;
}

export interface PulseSummary {
  totalMetrics: number;
  statusBreakdown: { green: number; amber: number; red: number };
  openAnomalies: number;
}

export interface CatalystRunItem {
  id: string;
  clusterId: string;
  catalystName: string;
  action: string;
  status: string;
  confidence: number;
  inputData: Record<string, unknown> | null;
  outputData: Record<string, unknown> | null;
  reasoning: string | null;
  approvedBy: string | null;
  assignedTo?: { validators?: string[]; exceptionHandlers?: string[]; escalation?: string[] } | null;
  createdAt: string;
  completedAt: string | null;
  needsHumanReview: boolean;
}

export interface CatalystRunSummary {
  catalystName: string;
  totalRuns: number;
  completed: number;
  exceptions: number;
  pending: number;
  avgConfidence: number;
  successRate: number;
}

export type DataSourceType = 'erp' | 'email' | 'cloud_storage' | 'upload' | 'custom_system';

export interface DataSourceConfig {
  type: DataSourceType;
  config: Record<string, unknown>;
}

/**
 * Implementation tier for a sub-catalyst, reported by the catalog:
 *   - 'real'    : backed by a dedicated domain handler
 *   - 'generic' : falls through to the default dispatcher (generic shape)
 *   - 'stub'    : named-only in the catalog, disabled at runtime
 */
export type Implementation = 'real' | 'generic' | 'stub';

/**
 * Maturity label for a cluster derived from its sub-catalyst mix:
 *   - 'production' : >= 50% of sub-catalysts are 'real'
 *   - 'partial'    : any 'real' sub-catalysts, but below 50%
 *   - 'planned'    : no 'real' sub-catalysts
 */
export type Maturity = 'production' | 'partial' | 'planned';

/**
 * Per-cluster implementation summary returned by `/api/catalysts/templates`.
 * Counts sub-catalysts by implementation tier plus a derived `maturity`.
 */
export interface ImplementationSummary {
  real: number;
  generic: number;
  stub: number;
  total: number;
  maturity: Maturity;
}

export interface CatalystSubCatalystTemplate {
  name: string;
  enabled: boolean;
  description: string;
  schedule?: SubCatalystSchedule;
  /** Implementation tier for this sub-catalyst (optional for backwards compat). */
  implementation?: Implementation;
}

export interface CatalystClusterTemplate {
  name: string;
  domain: string;
  description: string;
  autonomy_tier: string;
  subCatalystCount: number;
  sub_catalysts: CatalystSubCatalystTemplate[];
  /** Aggregated implementation stats for the cluster (optional for backwards compat). */
  implementationSummary?: ImplementationSummary;
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

export interface FieldMapping {
  id: string;
  source_index: number;       // index into data_sources array
  target_index: number;       // index into data_sources array
  source_field: string;       // field name in source system
  target_field: string;       // field name in target system
  match_type: 'exact' | 'fuzzy' | 'contains' | 'numeric_tolerance' | 'date_range';
  tolerance?: number;         // for numeric_tolerance (e.g. 0.01 = 1 cent)
  confidence: number;         // 0-1 confidence that this mapping is correct
  auto_suggested: boolean;    // was this suggested by the smart matcher?
}

export interface ExecutionConfig {
  mode: 'reconciliation' | 'validation' | 'sync' | 'extract' | 'compare';
  parameters?: Record<string, unknown>;
}

export interface ExecutionResult {
  id: string;
  sub_catalyst: string;
  cluster_id: string;
  executed_at: string;
  duration_ms: number;
  status: 'completed' | 'failed' | 'partial';
  mode: string;
  summary: {
    total_records_source: number;
    total_records_target: number;
    matched: number;
    unmatched_source: number;
    unmatched_target: number;
    discrepancies: number;
  };
  discrepancies?: Array<{
    source_record: Record<string, unknown>;
    target_record: Record<string, unknown> | null;
    field: string;
    source_value: unknown;
    target_value: unknown;
    difference?: string;
  }>;
  error?: string;
}

export interface SubCatalyst {
  name: string;
  enabled: boolean;
  description?: string;
  data_source?: DataSourceConfig;
  data_sources?: DataSourceConfig[];
  field_mappings?: FieldMapping[];
  execution_config?: ExecutionConfig;
  last_execution?: ExecutionResult;
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

export interface HitlConfig {
  id: string;
  tenantId: string;
  clusterId: string;
  subCatalystName?: string | null;
  domain: string;
  validatorUserIds: string[];
  exceptionHandlerUserIds: string[];
  escalationUserIds: string[];
  notifyOnCompletion: boolean;
  notifyOnException: boolean;
  notifyOnApprovalNeeded: boolean;
  createdAt: string;
  updatedAt: string;
  users: Record<string, { email: string; name: string }>;
}

export interface HitlConfigListItem {
  id: string;
  tenantId: string;
  clusterId: string;
  subCatalystName?: string | null;
  clusterName: string;
  domain: string;
  validatorUserIds: string[];
  exceptionHandlerUserIds: string[];
  escalationUserIds: string[];
  notifyOnCompletion: boolean;
  notifyOnException: boolean;
  notifyOnApprovalNeeded: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RunAnalytics {
  id: string;
  runId: string;
  clusterId: string;
  clusterName?: string;
  subCatalystName?: string | null;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  status: string;
  summary: {
    total: number;
    completed: number;
    exceptions: number;
    escalated: number;
    pending: number;
    autoApproved: number;
  };
  confidence: {
    avg: number;
    min: number;
    max: number;
    distribution: Record<string, number>;
  };
  insights: string[];
}

export interface RunAnalyticsAggregate {
  totalRuns: number;
  totalItems: number;
  totalCompleted: number;
  totalExceptions: number;
  totalEscalated: number;
  avgConfidence: number;
  automationRate: number;
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

export interface ERPCompany {
  id: string;
  external_id: string | null;
  source_system: string;
  code: string | null;
  name: string;
  legal_name: string | null;
  currency: string | null;
  country: string | null;
  is_primary: number;
  status: string;
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

// Spec 7 CIRCUIT-3: returned by GET /api/erp/connections/:id/circuit
export interface CircuitBreakerState {
  state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  failures: number;
  openedAt: number | null;
  lastAttempt: number | null;
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
  /**
   * Detailed business findings — stale stock, AR aging, GR/IR mismatches,
   * etc. — produced by the assessment-findings engine. Each maps to a
   * specific catalyst/sub-catalyst that resolves it.
   */
  findings?: AssessmentFinding[];
  findings_summary?: AssessmentFindingsSummary;
  /** Per-entity findings for multinational engagements. Empty for single-entity tenants. */
  findings_by_company?: Array<{
    company: AssessmentCompany;
    findings: AssessmentFinding[];
    summary: AssessmentFindingsSummary;
  }>;
  company_profile?: {
    profile: 'product' | 'service' | 'mixed' | 'unknown';
    product_count: number;
    project_count: number;
    time_entry_count: number;
  };
  total_estimated_annual_saving_zar?: number;
  payback_months?: number;
}

export type AssessmentFindingSeverity = 'critical' | 'high' | 'medium' | 'low';

export type AssessmentFindingCategory =
  | 'finance' | 'procurement' | 'supply_chain' | 'sales'
  | 'workforce' | 'compliance' | 'cross_cutting' | 'service_delivery';

export interface AssessmentFinding {
  id: string;
  code: string;
  category: AssessmentFindingCategory;
  severity: AssessmentFindingSeverity;
  title: string;
  narrative: string;
  affected_count: number;
  value_at_risk_zar: number;
  value_components: { label: string; amount_zar: number; methodology: string }[];
  currency_breakdown: Record<string, number>;
  sample_records: Array<{
    ref: string;
    description: string;
    amount_native?: number;
    currency?: string;
    amount_zar?: number;
    date?: string;
    metadata?: Record<string, string | number>;
  }>;
  recommended_catalyst: { catalyst: string; sub_catalyst: string };
  metric_signature: string;
  evidence_quality: 'high' | 'medium' | 'low';
  detected_at: string;
  company_id?: string;
  company_name?: string;
}

export interface AssessmentFindingsSummary {
  total_count: number;
  total_value_at_risk_zar: number;
  by_severity: Record<AssessmentFindingSeverity, number>;
  by_category: Record<AssessmentFindingCategory, { count: number; value_at_risk_zar: number }>;
  recommended_catalysts: string[];
}

export interface AssessmentCompany {
  id: string;
  name: string;
  currency: string;
  country: string;
  is_primary: number;
}

// ── Catalyst Simulator types (PR N) ───────────────────────────────────────
export interface CatalystSimulationResult {
  id: string;
  cluster_id: string | null;
  sub_catalyst_name: string;
  predicted_value_zar: number;
  lower_bound_zar: number;
  upper_bound_zar: number;
  confidence_pct: number;
  calibration_factor: number;
  n_priors: number;
  methodology: {
    raw_prediction_zar: number;
    contributing_finding_codes: string[];
    contributing_finding_count: number;
    notes: string;
  };
  simulated_at: string;
}

export interface CatalystCalibrationStats {
  cluster_id: string | null;
  sub_catalyst_name: string;
  n_observations: number;
  calibration_factor: number;
  std_residual: number;
  mae_zar: number;
  last_observation_at: string | null;
}

export interface CatalystSimulationHistoryRow {
  id: string;
  sub_catalyst_name: string;
  cluster_id: string | null;
  predicted_value_zar: number;
  lower_bound_zar: number;
  upper_bound_zar: number;
  actual_value_zar: number | null;
  residual: number | null;
  calibration_factor: number;
  n_priors: number;
  simulated_at: string;
  recorded_at: string | null;
}

// ── Provenance ledger types (PR O) ────────────────────────────────────────
export interface ProvenanceEntry {
  id: string;
  tenant_id: string;
  seq: number;
  parent_id: string | null;
  payload_type: string;
  payload_hash: string;
  payload_json: string;
  signed_by_user_id: string | null;
  signature: string | null;
  merkle_root_after: string;
  created_at: string;
}

export interface ProvenanceVerifyResult {
  valid: boolean;
  total_entries: number;
  first_invalid_seq: number | null;
  reason: string;
  current_root: string | null;
}

// ── Federated peer patterns types (PR P) ──────────────────────────────────
export interface FederatedPattern {
  industry_bucket: string;
  finding_code: string;
  n_contributors: number;
  avg_resolved_days: number;
  avg_recovery_pct: number;
  p25_recovery_pct: number;
  p75_recovery_pct: number;
  epsilon: number;
  last_refreshed_at: string;
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

// ── Sub-Catalyst Ops Types ──

export interface SubCatalystRun {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  run_number: number;
  triggered_by: string;
  trigger_context?: string;
  started_at: string;
  completed_at?: string;
  duration_ms?: number;
  status: string;
  mode: string;
  matched: number;
  unmatched_source: number;
  unmatched_target: number;
  discrepancies: number;
  exceptions_raised: number;
  avg_confidence: number;
  total_source_value: number;
  total_matched_value: number;
  total_discrepancy_value: number;
  total_exception_value: number;
  total_unmatched_value: number;
  currency: string;
  items_total: number;
  items_reviewed: number;
  items_approved: number;
  items_rejected: number;
  items_deferred: number;
  review_complete: boolean;
  sign_off_status: string;
  signed_off_by?: string;
  signed_off_at?: string;
  sign_off_notes?: string;
  reasoning?: string;
  recommendations?: string;
  source_record_count: number;
  target_record_count: number;
  parent_run_id?: string;
}

export interface SubCatalystRunDetail {
  run: SubCatalystRun;
  steps: Array<{ step: number; name: string; status: string; duration_ms: number; detail: string }>;
  linkedOutputs: { metrics: string[]; anomalies: string[]; risk_alerts: string[]; actions: string[] };
}

export interface SubCatalystKpis {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  total_runs: number;
  successful_runs: number;
  failed_runs: number;
  success_rate: number;
  avg_duration_ms: number;
  avg_records_processed: number;
  avg_match_rate: number;
  avg_discrepancy_rate: number;
  avg_confidence: number;
  total_exceptions: number;
  exception_rate: number;
  success_trend: string;
  duration_trend: string;
  discrepancy_trend: string;
  confidence_trend: string;
  status: string;
  last_run_at?: string;
  threshold_success_green: number;
  threshold_success_amber: number;
  threshold_success_red: number;
  threshold_duration_green: number;
  threshold_duration_amber: number;
  threshold_duration_red: number;
  threshold_discrepancy_green: number;
  threshold_discrepancy_amber: number;
  threshold_discrepancy_red: number;
}

export interface KpiDefinitionItem {
  id: string;
  name: string;
  category: string;
  unit: string;
  direction: string;
  value: number | null;
  status: string;
  thresholds: { green: number | null; amber: number | null; red: number | null };
  trend: number[];
  is_universal: boolean;
  enabled: boolean;
  sort_order: number;
  calculation: string;
  data_source: string;
}

export interface KpiDefinitionRow {
  id: string;
  tenant_id: string;
  cluster_id: string;
  sub_catalyst_name: string;
  kpi_name: string;
  unit: string;
  direction: string;
  threshold_green: number | null;
  threshold_amber: number | null;
  threshold_red: number | null;
  calculation: string;
  data_source: string;
  category: string;
  is_universal: number;
  sort_order: number;
  enabled: number;
}

export interface KpisResponse {
  overall_status: string;
  aggregate: SubCatalystKpis | null;
  definitions: KpiDefinitionItem[];
}

export interface SubCatalystRunItem {
  id: string;
  run_id: string;
  item_number: number;
  item_status: string;
  category?: string;
  source_ref?: string;
  source_date?: string;
  source_entity?: string;
  source_amount?: number;
  source_currency?: string;
  target_ref?: string;
  target_date?: string;
  target_entity?: string;
  target_amount?: number;
  target_currency?: string;
  match_confidence?: number;
  match_method?: string;
  discrepancy_field?: string;
  discrepancy_source_value?: string;
  discrepancy_target_value?: string;
  discrepancy_amount?: number;
  discrepancy_pct?: number;
  discrepancy_reason?: string;
  exception_type?: string;
  exception_severity?: string;
  exception_detail?: string;
  review_status: string;
  reviewed_by?: string;
  reviewed_at?: string;
  review_notes?: string;
  reclassified_to?: string;
}

export interface SubCatalystRunItemsResponse {
  items: SubCatalystRunItem[];
  totals: {
    items_total: number;
    matched: number;
    discrepancies: number;
    unmatched: number;
    exceptions: number;
    total_source_value: number;
    total_matched_value: number;
    total_discrepancy_value: number;
    total_exception_value: number;
  };
  review_progress: {
    reviewed: number;
    approved: number;
    rejected: number;
    deferred: number;
    pending: number;
  };
  total: number;
}

export interface SubCatalystRunComparison {
  run_a: SubCatalystRun | null;
  run_b: SubCatalystRun | null;
  delta: Record<string, number>;
  new_discrepancies: Record<string, unknown>[];
  resolved_discrepancies: Record<string, unknown>[];
  persistent_discrepancies: Record<string, unknown>[];
}

export interface RunComment {
  id: string;
  tenant_id: string;
  run_id: string;
  item_id?: string;
  user_id: string;
  user_name: string;
  comment: string;
  comment_type: string;
  created_at: string;
}

// Insights Engine response types
export interface InsightDriver {
  type: string;
  source: string;
  metric?: string;
  value?: number;
  runId?: string;
  subCatalyst?: string;
  domain?: string;
  description?: string;
}

export interface PulseInsightsResponse {
  insights: string;
  recommendations: string[];
  drivers: InsightDriver[];
  domain: string;
  generatedAt: string;
  poweredBy: string;
}

export interface ApexInsightsResponse {
  executiveSummary: string;
  performanceDrivers: Array<{ dimension: string; driver: string; impact: string; trend: string }>;
  issues: Array<{ title: string; severity: string; description: string; affectedDomain: string; traceability?: Record<string, unknown> }>;
  crossDepartmentCorrelations: string[];
  strategicImplications: string[];
  generatedAt: string;
  poweredBy: string;
}

export interface DashboardIntelligenceResponse {
  summary: string;
  keyMetrics: Array<{ name: string; value: number; trend: string; status: string; impact?: string }>;
  topRisks: Array<{ title: string; severity: string; traceability?: Record<string, unknown> }>;
  recommendedActions: string[];
  generatedAt: string;
  poweredBy: string;
}

export interface LlmConfigResponse {
  provider: string;
  model: string;
  apiKeySet: boolean;
  apiKeyMasked: string | null;
  baseUrl: string | null;
  temperature: number;
  maxTokens: number;
}

/**
 * Per-tenant LLM token budget + PII redaction state (backend PR #226).
 * `monthlyTokenBudget: null` means the tenant has unlimited tokens.
 * `exists === false` when no budget row has been created yet (defaults apply).
 */
export interface LlmBudgetResponse {
  tenantId: string;
  monthlyTokenBudget: number | null;
  tokensUsedThisMonth: number;
  tokensResetAt: string | null;
  llmRedactionEnabled: boolean;
  updatedAt: string | null;
  exists: boolean;
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

// ── Apex Radar Types ──────────────────────────────────────────────────

export interface RadarSignalItem {
  id: string;
  source: string;
  signalType: 'regulatory' | 'market' | 'competitor' | 'economic' | 'technology' | 'geopolitical';
  title: string;
  description: string;
  url?: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  relevanceScore: number;
  status: 'new' | 'analysed' | 'dismissed' | 'expired';
  detectedAt: string;
  expiresAt?: string;
  createdAt: string;
}

export interface RadarSignalCreate {
  source: string;
  signal_type: string;
  title: string;
  description: string;
  url?: string;
  severity?: string;
  raw_data?: Record<string, unknown>;
}

export interface RadarSignalImpactItem {
  id: string;
  dimension: string;
  impactDirection: 'positive' | 'negative' | 'neutral';
  impactMagnitude: number;
  affectedMetrics: string[];
  recommendedActions: string[];
  llmReasoning?: string;
  createdAt: string;
}

export interface RadarImpactWithSignal extends RadarSignalImpactItem {
  signalId: string;
  signalTitle: string;
  signalType: string;
  signalSeverity: string;
}

export interface RadarStrategicContext {
  id: string;
  contextType: 'macro' | 'industry' | 'competitive' | 'regulatory';
  title: string;
  summary: string;
  factors: Array<{ name: string; direction: string; magnitude: number }>;
  sentiment: 'positive' | 'negative' | 'neutral' | 'mixed';
  confidence: number;
  sourceSignalIds: string[];
  validFrom: string;
  validTo?: string;
  createdAt: string;
}

export interface RadarContextResponse {
  context: RadarStrategicContext | null;
  signals: RadarSignalItem[];
  impacts: RadarSignalImpactItem[];
  summary: {
    totalSignals: number;
    activeSignals: number;
    criticalImpacts: number;
    overallSentiment: string;
  };
}

// ── Pulse Diagnostics Types ───────────────────────────────────────────

export interface DiagnosticAnalysisItem {
  id: string;
  metricId: string;
  metricName: string;
  metricValue: number;
  metricStatus: string;
  triggerType: 'manual' | 'auto' | 'scheduled';
  status: 'pending' | 'running' | 'completed' | 'failed';
  createdAt: string;
  completedAt?: string;
}

export interface DiagnosticCausalChainLink {
  id: string;
  level: number;
  causeType: 'direct' | 'contributing' | 'systemic' | 'environmental' | 'root';
  title: string;
  description: string;
  confidence: number;
  evidence: string[];
  relatedMetrics: string[];
  recommendedFix?: string;
  fixPriority: 'critical' | 'high' | 'medium' | 'low';
  fixEffort: 'low' | 'medium' | 'high';
  createdAt: string;
}

export interface DiagnosticFixItem {
  id: string;
  chainId: string;
  analysisId: string;
  chainTitle: string;
  fixPriority: string;
  fixEffort: string;
  metricName: string;
  status: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assignedTo?: string;
  startedAt?: string;
  completedAt?: string;
  outcome?: string;
  notes?: string;
  createdAt: string;
}

export interface DiagnosticSummaryResponse {
  totalAnalyses: number;
  pendingAnalyses: number;
  completedAnalyses: number;
  undiagnosedMetrics: number;
  criticalFindings: number;
  activeFixes: number;
}

export interface DiagnosticAnalysisDetail {
  analysis: DiagnosticAnalysisItem;
  causalChain: DiagnosticCausalChainLink[];
  fixes: DiagnosticFixItem[];
}

// ── Catalyst Intelligence Types ───────────────────────────────────────

export interface CatalystPatternItem {
  id: string;
  patternType: 'recurring_issue' | 'seasonal_trend' | 'cascade_failure' | 'improvement_opportunity' | 'anomaly';
  title: string;
  description: string;
  frequency: number;
  firstSeen: string;
  lastSeen: string;
  affectedClusters: string[];
  affectedSubCatalysts: string[];
  severity: 'critical' | 'high' | 'medium' | 'low';
  status: 'active' | 'resolved' | 'monitoring';
  recommendedActions: string[];
  createdAt: string;
}

export interface CatalystEffectivenessItem {
  id: string;
  clusterId: string;
  subCatalystName: string;
  periodStart: string;
  periodEnd: string;
  runsCount: number;
  successRate: number;
  avgMatchRate: number;
  avgDurationMs: number;
  totalValueProcessed: number;
  totalExceptions: number;
  improvementTrend: number;
  roiEstimate: number;
  createdAt: string;
}

export interface CatalystDependencyItem {
  id: string;
  sourceClusterId: string;
  sourceSubCatalyst: string;
  targetClusterId: string;
  targetSubCatalyst: string;
  dependencyType: 'data_flow' | 'temporal' | 'causal' | 'resource';
  strength: number;
  description?: string;
  discoveredAt: string;
}

export interface CatalystIntelligenceOverview {
  summary: {
    activePatterns: number;
    criticalPatterns: number;
    totalSubCatalysts: number;
    avgSuccessRate: number;
    totalValueProcessed: number;
    avgRoi: number;
    totalDependencies: number;
  };
  patterns: CatalystPatternItem[];
  effectiveness: CatalystEffectivenessItem[];
  dependencies: CatalystDependencyItem[];
}

export interface CatalystPrescriptionItem {
  id: string;
  patternId: string;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  effort: 'low' | 'medium' | 'high';
  expectedImpact: string;
  sapTransaction?: string;
  status: 'proposed' | 'accepted' | 'in_progress' | 'completed' | 'rejected';
  assignedTo?: string;
  createdAt: string;
}

// ── ROI Tracking Types ────────────────────────────────────────────────

export interface ROITrackingItem {
  id: string;
  totalDiscrepancyValueIdentified: number;
  totalDiscrepancyValueRecovered: number;
  totalPreventedLosses: number;
  totalPersonHoursSaved: number;
  roiMultiple: number;
  platformCost: number;
  calculatedAt: string;
}

export interface ROITrackingResponse extends ROITrackingItem {
  breakdown: {
    byCluster: Array<{ clusterId: string; clusterName: string; recovered: number; prevented: number; hoursSaved: number }>;
    // v60: per-ERP-connection (or per-source-system fallback) attribution.
    // Under shared-savings, the customer needs a defensible split of which
    // ERP/subsystem contributed which portion of the recovered value.
    byConnection?: Array<{
      key: string;
      label: string;
      kind: 'connection' | 'source_system';
      inputRecords: number;
      inputValue: number;
      share: number;
      recoveredValue: number;
    }>;
    // v63: split identified opportunity by action state — automated by
    // Atheon write-backs vs in the approval queue vs still open. Closes
    // the read→action loop in the headline ROI card.
    byActionState?: {
      automated_count: number;
      automated_value_zar: number;
      pending_count: number;
      pending_value_zar: number;
      rejected_count: number;
      rejected_value_zar: number;
      open_value_zar: number;
    };
  };
}

// ── Board Report Types ────────────────────────────────────────────────

export interface BoardReportItem {
  id: string;
  title: string;
  generatedAt: string;
  reportMonth: string;
  status: 'generating' | 'completed' | 'failed';
  contentMarkdown?: string;
  pdfUrl?: string;
  sections: string[];
}

// ══════════════════════════════════════════════════════════════════════════════
// V2 Spec §4 — Canonical type interfaces matching the Build Spec exactly
// ══════════════════════════════════════════════════════════════════════════════

// §4.1 Radar Types
export interface ExternalSignal {
  id: string;
  category: string;
  title: string;
  summary: string;
  sourceUrl: string | null;
  sourceName: string | null;
  reliabilityScore: number;
  relevanceScore: number;
  sentiment: string;
  rawData: Record<string, unknown>;
  detectedAt: string;
  expiresAt: string | null;
}

export interface SignalImpact {
  id: string;
  signalId: string;
  healthDimension: string;
  impactMagnitude: number;
  impactDirection: 'headwind' | 'tailwind';
  impactTimeline: 'immediate' | 'near-term' | 'strategic';
  confidence: number;
  recommendedResponse: string | null;
  analysis: Record<string, unknown>;
  computedAt: string;
}

export interface Competitor {
  id: string;
  name: string;
  industry: string | null;
  estimatedRevenue: string | null;
  marketShare: number | null;
  strengths: string[];
  weaknesses: string[];
  lastUpdated: string;
  signalsCount: number;
}

export interface MarketBenchmark {
  id: string;
  industry: string;
  metricName: string;
  benchmarkValue: number;
  benchmarkUnit: string | null;
  percentile25: number | null;
  percentile50: number | null;
  percentile75: number | null;
  source: string | null;
  measuredAt: string;
}

export interface RegulatoryEvent {
  id: string;
  title: string;
  description: string;
  jurisdiction: string | null;
  affectedDimensions: string[];
  effectiveDate: string | null;
  complianceDeadline: string | null;
  readinessScore: number;
  status: string;
  sourceUrl: string | null;
}

export interface StrategicContext {
  healthScore: number;
  industryBenchmark: number | null;
  headwinds: SignalImpact[];
  tailwinds: SignalImpact[];
  competitorCount: number;
  regulatoryDeadlines: number;
  topSignals: ExternalSignal[];
  contextNarrative: string;
}

// §4.2 Diagnostics Types
export interface RootCauseAnalysis {
  id: string;
  metricId: string;
  metricName: string;
  triggerStatus: string;
  causalChain: CausalFactor[];
  confidence: number;
  impactSummary: string | null;
  prescription: Record<string, unknown>;
  status: string;
  sourceDataRefs: Record<string, unknown>;
  generatedAt: string;
  resolvedAt: string | null;
}

export interface CausalFactor {
  id: string;
  layer: string;
  factorType: string;
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  impactValue: number | null;
  impactUnit: string;
  confidence: number;
  sourceRunIds: string[];
  sourceMetricIds: string[];
  createdAt: string;
}

export interface DiagnosticPrescription {
  id: string;
  rcaId: string;
  priority: 'immediate' | 'short-term' | 'strategic';
  title: string;
  description: string;
  expectedImpact: string | null;
  effortLevel: 'low' | 'medium' | 'high';
  responsibleDomain: string | null;
  deadlineSuggested: string | null;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface DiagnosticsSummary {
  totalActive: number;
  bySeverity: Record<string, number>;
  prescriptionsPending: number;
  prescriptionsCompleted: number;
  totalImpactValue: number;
  undiagnosedMetrics: number;
  // Legacy aliases
  totalAnalyses?: number;
  pendingAnalyses?: number;
  completedAnalyses?: number;
  criticalFindings?: number;
  activeFixes?: number;
}

// §4.3 Catalyst Intelligence Types
export interface CatalystPattern {
  id: string;
  clusterId: string;
  subCatalystName: string;
  patternType: 'discrepancy_clustering' | 'exception_recurrence' | 'temporal_pattern' | 'field_hotspot';
  title: string;
  description: string;
  evidence: Record<string, unknown>;
  affectedRecordsPct: number;
  confidence: number;
  firstDetected: string;
  lastConfirmed: string;
  runCount: number;
  severity: string;
  status: string;
  prescriptionId: string | null;
}

export interface CatalystEffectivenessData {
  id: string;
  clusterId: string;
  subCatalystName: string;
  period: string;
  runsCount: number;
  totalItemsProcessed: number;
  totalDiscrepancyValueFound: number;
  totalDiscrepancyValueResolved: number;
  recoveryRate: number;
  avgMatchRate: number;
  avgMatchRateTrend: number[];
  avgConfidenceTrend: number[];
  avgDurationTrend: number[];
  interventionImpacts: Array<{ date: string; type: string; effect: number }>;
}

export interface CatalystDependency {
  id: string;
  upstreamClusterId: string;
  upstreamSubName: string;
  downstreamClusterId: string;
  downstreamSubName: string;
  dependencyType: string;
  lagHours: number;
  correlationStrength: number;
  cascadeRiskScore: number;
  evidence: Record<string, unknown>;
  lastConfirmed: string | null;
}

// §4.4 ROI & Board Report Types
export interface ROISummary {
  identified: number;
  recovered: number;
  lossesAverted: number;
  personHoursSaved: number;
  roiMultiple: number;
  totalCatalystRuns: number;
  licenceCostAnnual: number;
  period: string;
  calculatedAt: string;
  // Aliases for compat with existing ROITrackingResponse
  totalDiscrepancyValueIdentified?: number;
  totalDiscrepancyValueRecovered?: number;
  totalPreventedLosses?: number;
  totalPersonHoursSaved?: number;
}

export interface BoardReport {
  id: string;
  title: string;
  reportType: string;
  content: Record<string, unknown> | string;
  r2Key: string | null;
  pdfUrl: string | null;
  generatedBy: string | null;
  generatedAt: string;
}

// §9.2 Onboarding
export interface OnboardingStep {
  id: string;
  label: string;
  description: string;
  completed: boolean;
  completedAt: string | null;
}
export interface OnboardingProgressResponse {
  steps: OnboardingStep[];
  completedCount: number;
  totalSteps: number;
  progressPct: number;
  allComplete: boolean;
}

// §9.3 Freshness
export interface FreshnessSection {
  section: string;
  lastUpdated: string | null;
  ageMinutes: number | null;
  status: 'fresh' | 'stale' | 'unknown';
}
export interface FreshnessResponse {
  globalStatus: 'fresh' | 'stale' | 'unknown';
  oldestAgeMinutes: number | null;
  sections: FreshnessSection[];
  checkedAt: string;
}

// §11.7 Atheon Score
export interface AtheonScoreComponent {
  name: string;
  weight: number;
  score: number;
  weighted: number;
}
export interface AtheonScoreResponse {
  score: number;
  components: AtheonScoreComponent[];
  trend: { score: number; date: string }[];
  industryAvg: number | null;
}

// §11.1 Trial Assessment
export interface TrialResultsResponse {
  id: string;
  companyName: string;
  industry: string;
  status: string;
  healthScore: number | null;
  issuesFound: number | null;
  estimatedExposure: number | null;
  topRisks: { title: string; description: string; impact: number }[];
  topOpportunities: { title: string; description: string; value: number }[];
  projectedRoi: number | null;
  completedAt: string | null;
}
export interface TrialReportResponse {
  companyName: string;
  industry: string;
  healthScore: number | null;
  issuesFound: number | null;
  estimatedExposure: number | null;
  topRisks: { title: string; description: string; impact: number }[];
  topOpportunities: { title: string; description: string; value: number }[];
  projectedRoi: number | null;
  generatedAt: string;
}

// §11.2 Baseline Snapshots
export interface BaselineSnapshot {
  id: string;
  snapshotType: string;
  healthScore: number;
  dimensions: Record<string, unknown>;
  metricCountGreen: number;
  metricCountAmber: number;
  metricCountRed: number;
  totalDiscrepancyValue: number;
  totalProcessConformance: number;
  avgCatalystSuccessRate: number;
  roiAtSnapshot: number;
  capturedAt: string;
}
export interface BaselineComparisonResponse {
  dayZero: BaselineSnapshot | null;
  current: BaselineSnapshot | null;
  improvement: {
    healthScore: number;
    metricCountGreen: number;
    discrepancyValue: number;
    processConformance: number;
    catalystSuccessRate: number;
    roi: number;
  } | null;
  narrative: string;
}

// §11.3 Goal Setting
export interface HealthTarget {
  id: string;
  targetType: string;
  targetName: string;
  targetValue: number;
  targetDeadline: string | null;
  currentValue: number;
  status: string;
  gap: number;
  projectedAchieveDate: string | null;
  createdAt: string;
  achievedAt: string | null;
}

// §11.4 Peer Benchmarks
export interface PeerBenchmarkItem {
  dimension: string;
  period: string;
  tenantCount: number;
  avgScore: number;
  p25Score: number;
  p50Score: number;
  p75Score: number;
  minScore: number;
  maxScore: number;
  ownScore: number | null;
  percentileRank: string | null;
  calculatedAt: string;
}
export interface PeerBenchmarksResponse {
  industry: string;
  benchmarks: PeerBenchmarkItem[];
  total: number;
}

// §11.5 Cost of Inaction
export interface CostOfInactionRca {
  rcaId: string;
  metricName: string;
  severity: string;
  daysOpen: number;
  pendingPrescriptions: number;
}
export interface CostOfInactionResponse {
  totalExposure: number;
  dailyCost: number;
  accruedCost: number;
  projectedMonthlyCost: number;
  activeRcaCount: number;
  avgDaysOpen: number;
  rcaBreakdown: CostOfInactionRca[];
}

// §11.6 Success Stories
export interface SuccessStory {
  patternSignature: string;
  resolutionCount: number;
  avgResolutionDays: number;
  avgValueRecovered: number;
  commonFixTypes: string[];
  lastUpdated: string;
}
export interface SuccessStoriesResponse {
  industry: string;
  stories: SuccessStory[];
  total: number;
}

// ── Value Assessment Engine Types ──
export interface ValueAssessmentFinding {
  id: string;
  assessment_id: string;
  run_id: string;
  tenant_id: string;
  finding_type: 'discrepancy' | 'exception' | 'data_quality' | 'process_delay' | 'risk';
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  description: string;
  affected_records: number;
  financial_impact: number;
  evidence: {
    sample_records?: Array<{ ref: string; source_value: string | number; target_value: string | number; difference: number }>;
    pattern?: string;
    first_occurrence?: string;
    frequency?: string;
  };
  root_cause: string | null;
  prescription: string | null;
  category: string;
  immediate_value: number;
  ongoing_monthly_value: number;
  domain: string;
  created_at: string;
}

export interface DataQualityRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  table_name: string;
  total_records: number;
  complete_records: number;
  completeness_pct: number;
  field_scores: Record<string, number>;
  referential_issues: number;
  duplicate_records: number;
  orphan_records: number;
  stale_records: number;
  overall_quality_score: number;
  issues: Array<{ field: string; issue: string; count: number; severity: string; financialImpact: number }>;
  created_at: string;
}

export interface ProcessTimingRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  process_name: string;
  avg_cycle_time_days: number;
  median_cycle_time_days: number;
  p90_cycle_time_days: number;
  benchmark_cycle_time_days: number;
  bottleneck_step: string | null;
  bottleneck_avg_days: number;
  records_analysed: number;
  records_exceeding_benchmark: number;
  financial_impact_of_delay: number;
  evidence: Record<string, unknown>;
  created_at: string;
}

export interface ValueSummaryRecord {
  id: string;
  assessment_id: string;
  tenant_id: string;
  total_immediate_value: number;
  total_ongoing_monthly_value: number;
  total_ongoing_annual_value: number;
  total_data_quality_issues: number;
  total_process_delays: number;
  total_findings: number;
  total_critical_findings: number;
  outcome_based_monthly_fee: number;
  outcome_based_fee_pct: number;
  payback_days: number;
  value_by_domain: Record<string, { immediate: number; ongoing: number; findings: number }>;
  value_by_category: Record<string, { immediate: number; ongoing: number; findings: number }>;
  executive_narrative: string;
  created_at: string;
}

// §11.8 Executive Summary
export interface ExecutiveSummaryResponse {
  atheonScore: number;
  healthScore: number;
  dimensions: Record<string, { score: number; trend?: string }>;
  roi: { recovered: number; multiple: number; cost: number };
  diagnostics: { activeRcas: number; pendingPrescriptions: number };
  signals: { newThisWeek: number };
  topRisks: { title: string; severity: string; impactValue: number }[];
  targets: { targetType: string; targetName: string; targetValue: number; currentValue: number; status: string }[];
  trend: { score: number; date: string }[];
  journey: { baselineHealthScore: number | null; baselineDate: string | null; improvement: number | null };
}

// ── Webhooks (backend PR #225) ────────────────────────────────────────
export type WebhookDeliveryStatus = 'delivered' | 'pending' | 'failed' | 'dead_letter';

export interface Webhook {
  id: string;
  tenant_id?: string;
  url: string;
  description?: string | null;
  event_types: string[];
  /** Redacted as "***" on list/detail; only the create response returns the real secret. */
  secret: string;
  created_at: string;
  updated_at?: string;
  /** Optional aggregate health surfaced by the backend when available. */
  success_rate?: number | null;
  last_delivery_at?: string | null;
  last_delivery_status?: WebhookDeliveryStatus | null;
  disabled?: boolean;
}

export interface WebhookCreateResponse {
  id: string;
  url: string;
  event_types: string[];
  description?: string | null;
  /** Shown ONCE — never returned again by any other endpoint. */
  secret: string;
  created_at?: string;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  event_type: string;
  status: WebhookDeliveryStatus;
  attempts: number;
  http_status?: number | null;
  last_error?: string | null;
  created_at: string;
  delivered_at?: string | null;
  next_retry_at?: string | null;
}

// ── Aggregation view response types ───────────────────────────────────

export interface CompanyHealthDetail {
  success: boolean;
  tenant: {
    id: string;
    name: string;
    slug: string;
    plan: string;
    status: string;
    region?: string | null;
    created_at: string;
  };
  users: {
    total: number;
    active: number;
    byRole: Record<string, number>;
    lastLoginAt: string | null;
  };
  catalysts: {
    clusters: number;
    actionsLast30d: number;
  };
  llm: {
    tokens30d: number;
    estCostUsd: number;
    costIsEstimate: boolean;
    costNote: string;
  };
  erp: {
    connections: number;
    connectedCount: number;
  };
  entitlements: {
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
  } | null;
  timestamp: string;
}

export interface RevenueUsageResponse {
  success: boolean;
  summary: {
    totalTenants: number;
    totalUsers: number;
    estMrrUsd: number;
    estArrUsd: number;
    pricingIsEstimate: boolean;
    pricingNote: string;
  };
  byPlan: Array<{ plan: string; count: number; estMrrUsd: number }>;
  growth: { newTenantsByMonth: Array<{ month: string; count: number }> };
  llm: {
    totalTokens30d: number;
    callCount30d: number;
    topTenants: Array<{ tenantId: string; name: string; plan: string; tokens30d: number }>;
  };
  timestamp: string;
}

export interface IntegrationHealthConnection {
  id: string;
  name: string;
  adapter_name: string | null;
  adapter_system: string | null;
  status: string;
  lastSync: string | null;
  recordsSynced: number;
  circuitState: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
  circuitFailures: number;
  errorsLast30d: number;
  hoursSinceSync: number | null;
  freshness: 'fresh' | 'stale' | 'cold';
  connectedAt: string | null;
}

export interface IntegrationHealthResponse {
  connections: IntegrationHealthConnection[];
  timestamp: string;
}

export interface GovernanceResponse {
  success: boolean;
  tenantId: string;
  dsar: {
    exports30d: number;
    erasures30d: number;
    lastExportAt: string | null;
  };
  retention: {
    retentionDays: number | null;
    policy: string;
  };
  auditVolume30d: number;
  encryption: {
    erpEncrypted: number;
    erpPlaintext: number;
  };
  timestamp: string;
}

// ── Support tickets (backend v48) ─────────────────────────────────────
export type SupportTicketStatus = 'open' | 'in_progress' | 'waiting_customer' | 'resolved' | 'closed';
export type SupportTicketPriority = 'low' | 'normal' | 'high' | 'urgent';
export type SupportTicketCategory = 'general' | 'bug' | 'billing' | 'feature_request' | 'access' | 'other';

export interface SupportTicket {
  id: string;
  tenant_id: string;
  user_id: string;
  assignee_user_id: string | null;
  subject: string;
  body: string;
  category: SupportTicketCategory | string;
  priority: SupportTicketPriority | string;
  status: SupportTicketStatus | string;
  created_at: string;
  updated_at: string;
}

export interface SupportTicketReply {
  id: string;
  ticket_id: string;
  user_id: string;
  body: string;
  created_at: string;
}
