const API_URL = import.meta.env.VITE_API_URL || 'https://atheon-api.reshigan-085.workers.dev';

let authToken: string | null = localStorage.getItem('atheon_token');

export function setToken(token: string | null) {
  authToken = token;
  if (token) {
    localStorage.setItem('atheon_token', token);
  } else {
    localStorage.removeItem('atheon_token');
  }
}

export function getToken(): string | null {
  return authToken;
}

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string> || {}),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

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
    demoLogin: (tenantSlug?: string, role?: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/demo-login', {
        method: 'POST',
        body: JSON.stringify({ tenant_slug: tenantSlug || 'vantax', role: role || 'admin' }),
      }),
    me: () => request<AuthUser>('/api/auth/me'),
    ssoLogin: (provider: string) =>
      request<{ token: string; user: AuthUser }>('/api/auth/sso', {
        method: 'POST',
        body: JSON.stringify({ provider }),
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
  },

  iam: {
    policies: (tenantId?: string) =>
      request<{ policies: IAMPolicy[]; total: number }>(`/api/iam/policies?tenant_id=${tenantId || 'vantax'}`),
    roles: (tenantId?: string) =>
      request<{ roles: IAMRole[] }>(`/api/iam/roles?tenant_id=${tenantId || 'vantax'}`),
    users: (tenantId?: string) =>
      request<{ users: IAMUser[]; total: number }>(`/api/iam/users?tenant_id=${tenantId || 'vantax'}`),
    sso: (tenantId?: string) =>
      request<{ configs: SSOConfig[] }>(`/api/iam/sso?tenant_id=${tenantId || 'vantax'}`),
    createUser: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/iam/users', { method: 'POST', body: JSON.stringify(data) }),
  },

  apex: {
    health: (tenantId?: string) =>
      request<HealthScore>(`/api/apex/health?tenant_id=${tenantId || 'vantax'}`),
    briefing: (tenantId?: string) =>
      request<Briefing>(`/api/apex/briefing?tenant_id=${tenantId || 'vantax'}`),
    risks: (tenantId?: string) =>
      request<{ risks: Risk[]; total: number }>(`/api/apex/risks?tenant_id=${tenantId || 'vantax'}`),
    scenarios: (tenantId?: string) =>
      request<{ scenarios: ScenarioItem[]; total: number }>(`/api/apex/scenarios?tenant_id=${tenantId || 'vantax'}`),
    createScenario: (data: Record<string, unknown>) =>
      request<{ id: string; results: Record<string, unknown> }>('/api/apex/scenarios', { method: 'POST', body: JSON.stringify(data) }),
  },

  pulse: {
    metrics: (tenantId?: string) =>
      request<{ metrics: Metric[]; total: number }>(`/api/pulse/metrics?tenant_id=${tenantId || 'vantax'}`),
    anomalies: (tenantId?: string) =>
      request<{ anomalies: AnomalyItem[]; total: number }>(`/api/pulse/anomalies?tenant_id=${tenantId || 'vantax'}`),
    processes: (tenantId?: string) =>
      request<{ processes: ProcessItem[]; total: number }>(`/api/pulse/processes?tenant_id=${tenantId || 'vantax'}`),
    correlations: (tenantId?: string) =>
      request<{ correlations: CorrelationItem[]; total: number }>(`/api/pulse/correlations?tenant_id=${tenantId || 'vantax'}`),
    summary: (tenantId?: string) =>
      request<PulseSummary>(`/api/pulse/summary?tenant_id=${tenantId || 'vantax'}`),
  },

  catalysts: {
    clusters: (tenantId?: string) =>
      request<{ clusters: ClusterItem[]; total: number }>(`/api/catalysts/clusters?tenant_id=${tenantId || 'vantax'}`),
    cluster: (id: string) => request<ClusterDetail>(`/api/catalysts/clusters/${id}`),
    actions: (tenantId?: string, clusterId?: string) => {
      let url = `/api/catalysts/actions?tenant_id=${tenantId || 'vantax'}`;
      if (clusterId) url += `&cluster_id=${clusterId}`;
      return request<{ actions: ActionItem[]; total: number }>(url);
    },
    createAction: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/catalysts/actions', { method: 'POST', body: JSON.stringify(data) }),
    approveAction: (id: string) =>
      request<{ success: boolean }>(`/api/catalysts/actions/${id}/approve`, { method: 'PUT', body: JSON.stringify({}) }),
    governance: (tenantId?: string) =>
      request<GovernanceData>(`/api/catalysts/governance?tenant_id=${tenantId || 'vantax'}`),
  },

  memory: {
    entities: (tenantId?: string, type?: string) => {
      let url = `/api/memory/entities?tenant_id=${tenantId || 'vantax'}`;
      if (type) url += `&type=${type}`;
      return request<{ entities: GraphEntity[]; total: number }>(url);
    },
    entity: (id: string) => request<GraphEntityDetail>(`/api/memory/entities/${id}`),
    relationships: (tenantId?: string) =>
      request<{ relationships: GraphRelationship[]; total: number }>(`/api/memory/relationships?tenant_id=${tenantId || 'vantax'}`),
    graph: (tenantId?: string) =>
      request<GraphData>(`/api/memory/graph?tenant_id=${tenantId || 'vantax'}`),
    query: (queryText: string, tenantId?: string) =>
      request<GraphQueryResult>('/api/memory/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tenant_id: tenantId || 'vantax' }),
      }),
    stats: (tenantId?: string) =>
      request<GraphStats>(`/api/memory/stats?tenant_id=${tenantId || 'vantax'}`),
  },

  mind: {
    query: (queryText: string, tier?: string, tenantId?: string) =>
      request<MindQueryResult>('/api/mind/query', {
        method: 'POST',
        body: JSON.stringify({ query: queryText, tier: tier || 'tier-1', tenant_id: tenantId || 'vantax' }),
      }),
    models: () => request<MindModels>('/api/mind/models'),
    history: (tenantId?: string) =>
      request<{ queries: MindHistoryItem[]; total: number }>(`/api/mind/history?tenant_id=${tenantId || 'vantax'}`),
    stats: (tenantId?: string) =>
      request<MindStats>(`/api/mind/stats?tenant_id=${tenantId || 'vantax'}`),
  },

  erp: {
    adapters: () => request<{ adapters: ERPAdapter[]; total: number }>('/api/erp/adapters'),
    adapter: (id: string) => request<ERPAdapterDetail>(`/api/erp/adapters/${id}`),
    connections: (tenantId?: string) =>
      request<{ connections: ERPConnection[]; total: number }>(`/api/erp/connections?tenant_id=${tenantId || 'vantax'}`),
    canonical: (domain?: string) => {
      let url = '/api/erp/canonical';
      if (domain) url += `?domain=${domain}`;
      return request<{ endpoints: CanonicalEndpoint[]; total: number }>(url);
    },
    sync: (connectionId: string) =>
      request<{ recordsSynced: number; syncedAt: string }>(`/api/erp/sync/${connectionId}`, { method: 'POST' }),
  },

  controlplane: {
    deployments: (tenantId?: string) => {
      let url = '/api/controlplane/deployments';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      return request<{ deployments: DeploymentItem[]; total: number }>(url);
    },
    deployment: (id: string) => request<DeploymentItem>(`/api/controlplane/deployments/${id}`),
    createDeployment: (data: Record<string, unknown>) =>
      request<{ id: string }>('/api/controlplane/deployments', { method: 'POST', body: JSON.stringify(data) }),
    health: (tenantId?: string) => {
      let url = '/api/controlplane/health';
      if (tenantId) url += `?tenant_id=${tenantId}`;
      return request<ControlPlaneHealth>(url);
    },
  },

  audit: {
    log: (tenantId?: string, layer?: string) => {
      let url = `/api/audit/log?tenant_id=${tenantId || 'vantax'}`;
      if (layer) url += `&layer=${layer}`;
      return request<{ entries: AuditEntry[]; total: number }>(url);
    },
    stats: (tenantId?: string) =>
      request<AuditStats>(`/api/audit/stats?tenant_id=${tenantId || 'vantax'}`),
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
  dimensions: Record<string, { score: number; trend: string; delta: number }>;
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
  tiers: { id: string; name: string; model: string; maxTokens: number; avgLatency: number; description: string }[];
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
