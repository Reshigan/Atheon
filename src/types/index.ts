// ============================================================================
// Atheon™ Enterprise Intelligence Platform — Core Types
// ============================================================================

// --- Platform Identity ---
export type AtheonLayer = 'apex' | 'pulse' | 'catalysts' | 'mind' | 'memory';
export type IndustryVertical = 'fmcg' | 'healthcare' | 'mining' | 'general' | 'agriculture' | 'logistics' | 'technology' | 'manufacturing';

// --- Auth & Tenancy ---
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  tenantId: string;
  tenantName?: string;
  avatarUrl?: string;
  permissions: string[];
}

export type UserRole = 'admin' | 'executive' | 'manager' | 'analyst' | 'operator';

export interface Tenant {
  id: string;
  name: string;
  industry: IndustryVertical;
  plan: 'starter' | 'professional' | 'enterprise';
  logo?: string;
}

// --- Apex: Executive Intelligence ---
export interface BusinessHealthScore {
  overall: number;
  trend: 'up' | 'down' | 'stable';
  dimensions: HealthDimension[];
  updatedAt: string;
}

export interface HealthDimension {
  name: string;
  key: 'finance' | 'operations' | 'risk' | 'people' | 'market' | 'safety' | 'quality' | 'environment';
  score: number;
  weight: number;
  trend: 'up' | 'down' | 'stable';
  change: number;
  sparkline: number[];
}

export interface ExecutiveBriefing {
  id: string;
  date: string;
  topRisks: BriefingItem[];
  topOpportunities: BriefingItem[];
  anomalies: BriefingItem[];
  kpiMovements: KPIMovement[];
  requiredDecisions: Decision[];
  narrative: string;
}

export interface BriefingItem {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  source: AtheonLayer;
  confidence: number;
}

export interface KPIMovement {
  kpi: string;
  value: number;
  previousValue: number;
  change: number;
  unit: string;
  trend: 'up' | 'down' | 'stable';
}

export interface Decision {
  id: string;
  title: string;
  description: string;
  deadline: string;
  options: DecisionOption[];
  recommendedOption?: string;
}

export interface DecisionOption {
  id: string;
  label: string;
  impact: string;
  confidence: number;
}

export interface RiskAlert {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  probability: number;
  impact: number;
  detectedAt: string;
  predictedDate: string;
  category: string;
  recommendedActions: string[];
  status: 'active' | 'mitigated' | 'resolved' | 'escalated';
  confidence: number;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  variables: ScenarioVariable[];
  results?: ScenarioResult;
  createdAt: string;
  status: 'draft' | 'running' | 'completed';
}

export interface ScenarioVariable {
  name: string;
  baseValue: number;
  adjustedValue: number;
  unit: string;
}

export interface ScenarioResult {
  revenue: number;
  cost: number;
  profit: number;
  risk: number;
  probability: number;
  timeline: { month: string; value: number }[];
}

// --- Pulse: Process Intelligence ---
export interface ProcessMetric {
  id: string;
  name: string;
  value: number;
  unit: string;
  threshold: { green: number; amber: number; red: number };
  trend: number[];
  status: 'green' | 'amber' | 'red';
  lastUpdated: string;
}

export interface Anomaly {
  id: string;
  metric: string;
  expectedValue: number;
  actualValue: number;
  deviation: number;
  severity: 'critical' | 'high' | 'medium' | 'low';
  detectedAt: string;
  hypothesis: string;
  confirmed?: boolean;
}

export interface ProcessFlow {
  id: string;
  name: string;
  steps: ProcessStep[];
  variants: number;
  conformanceRate: number;
  avgDuration: number;
  bottlenecks: string[];
}

export interface ProcessStep {
  id: string;
  name: string;
  avgDuration: number;
  throughput: number;
  status: 'healthy' | 'degraded' | 'bottleneck';
}

export interface CorrelationEvent {
  id: string;
  sourceSystem: string;
  targetSystem: string;
  sourceEvent: string;
  targetImpact: string;
  lag: number;
  confidence: number;
  detectedAt: string;
}

// --- Catalysts: Autonomous Execution ---
export type CatalystClusterType =
  | 'finance' | 'procurement' | 'supply-chain' | 'hr' | 'sales'
  // FMCG
  | 'fmcg-trade' | 'fmcg-distributor' | 'fmcg-launch' | 'fmcg-shelf'
  // Healthcare
  | 'health-patient' | 'health-supply' | 'health-staffing' | 'health-compliance' | 'health-experience'
  // Mining
  | 'mining-equipment' | 'mining-ore' | 'mining-safety' | 'mining-environment'
  // Agriculture
  | 'agri-crop' | 'agri-irrigation' | 'agri-quality' | 'agri-market'
  // Logistics
  | 'logistics-fleet' | 'logistics-route' | 'logistics-warehouse' | 'logistics-compliance'
  // Technology
  | 'tech-devops' | 'tech-security' | 'tech-product' | 'tech-customer-success'
  // Manufacturing
  | 'mfg-production' | 'mfg-quality' | 'mfg-maintenance' | 'mfg-energy';

export type AutonomyTier = 'read-only' | 'assisted' | 'transactional';

export interface CatalystCluster {
  id: string;
  name: string;
  type: CatalystClusterType;
  description: string;
  autonomyTier: AutonomyTier;
  trustScore: number;
  activeAgents: number;
  tasksCompleted: number;
  tasksInProgress: number;
  accuracy: number;
  status: 'active' | 'paused' | 'error';
  industry?: IndustryVertical;
}

export interface CatalystAction {
  id: string;
  clusterId: string;
  clusterName: string;
  action: string;
  description: string;
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'rejected' | 'failed';
  confidence: number;
  autonomyTier: AutonomyTier;
  requestedAt: string;
  completedAt?: string;
  approvedBy?: string;
  reasoning: string;
  dataSources: string[];
  lobCalls: string[];
}

export interface TrustScore {
  overall: number;
  accuracyRate: number;
  falsePositiveRate: number;
  overrideFrequency: number;
  executionConsistency: number;
  trend: number[];
}

// --- Memory: GraphRAG ---
export interface KnowledgeEntity {
  id: string;
  type: 'organisation' | 'department' | 'person' | 'role' | 'process' | 'system' | 'kpi' | 'document' | 'decision' | 'risk' | 'asset';
  name: string;
  properties: Record<string, string | number | boolean>;
  confidence: number;
  validFrom: string;
  validTo?: string;
}

export interface KnowledgeRelationship {
  id: string;
  sourceId: string;
  targetId: string;
  type: 'owns' | 'manages' | 'executes' | 'depends-on' | 'produces' | 'consumes' | 'escalates-to' | 'contradicts' | 'supersedes';
  properties: Record<string, string | number | boolean>;
  confidence: number;
  validFrom: string;
}

export interface GraphSearchResult {
  entities: KnowledgeEntity[];
  relationships: KnowledgeRelationship[];
  citations: Citation[];
}

export interface Citation {
  id: string;
  source: string;
  text: string;
  confidence: number;
  retrievedAt: string;
}

// --- Chat / Conversational Interface ---
export interface ChatThread {
  id: string;
  title: string;
  messages: ChatMessage[];
  layer?: AtheonLayer;
  createdAt: string;
  updatedAt: string;
  bookmarked: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  layer?: AtheonLayer;
  citations?: Citation[];
  visualizations?: Visualization[];
  approvalRequest?: ApprovalRequest;
  timestamp: string;
}

export interface Visualization {
  type: 'chart' | 'table' | 'kpi-card' | 'mermaid' | 'sparkline';
  title: string;
  data: Record<string, unknown>;
}

export interface ApprovalRequest {
  id: string;
  catalystId: string;
  action: string;
  description: string;
  status: 'pending' | 'approved' | 'rejected';
  confidence: number;
}

// --- MCP & A2A ---
export interface MCPServer {
  id: string;
  name: string;
  system: string;
  status: 'connected' | 'disconnected' | 'error';
  tools: MCPTool[];
  lastHeartbeat: string;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  permissions: string[];
}

export interface AgentCard {
  id: string;
  name: string;
  description: string;
  skills: string[];
  cluster: CatalystClusterType;
  status: 'available' | 'busy' | 'offline';
}

// --- Audit ---
export interface AuditEntry {
  id: string;
  timestamp: string;
  userId: string;
  action: string;
  layer: AtheonLayer;
  details: Record<string, unknown>;
  outcome: 'success' | 'failure' | 'pending';
}

// --- Multi-Tenant SaaS / On-Premise / Hybrid ---
export type DeploymentModel = 'saas' | 'on-premise' | 'hybrid';

export interface TenantConfig {
  id: string;
  name: string;
  industry: IndustryVertical;
  plan: 'starter' | 'professional' | 'enterprise';
  deploymentModel: DeploymentModel;
  logo?: string;
  domain?: string;
  region: string;
  status: 'active' | 'provisioning' | 'suspended' | 'decommissioned';
  createdAt: string;
  // Feature entitlements — what this tenant can access
  entitlements: TenantEntitlements;
  // ERP connections configured
  erpConnections: ERPConnection[];
  // Deployment infrastructure
  infrastructure: TenantInfrastructure;
}

export interface TenantEntitlements {
  layers: AtheonLayer[];
  catalystClusters: CatalystClusterType[];
  maxAgents: number;
  maxUsers: number;
  features: FeatureFlag[];
  autonomyTiers: AutonomyTier[];
  llmTiers: LLMTier[];
  customBranding: boolean;
  ssoEnabled: boolean;
  apiAccess: boolean;
  dataRetentionDays: number;
}

export type FeatureFlag =
  | 'apex.health_score' | 'apex.briefings' | 'apex.risk_alerts' | 'apex.scenarios'
  | 'pulse.monitoring' | 'pulse.anomalies' | 'pulse.process_mining' | 'pulse.correlations'
  | 'catalysts.deploy' | 'catalysts.governance' | 'catalysts.custom_agents'
  | 'mind.tier1' | 'mind.tier2' | 'mind.tier3' | 'mind.custom_lora'
  | 'memory.graph' | 'memory.vector_search' | 'memory.industry_templates'
  | 'chat.conversational' | 'chat.approvals' | 'chat.visualizations'
  | 'connectivity.mcp' | 'connectivity.a2a'
  | 'admin.audit_log' | 'admin.tenant_management';

export type LLMTier = 'tier1-edge' | 'tier2-standard' | 'tier3-reasoning';

// --- Identity Access Management ---
export interface IAMPolicy {
  id: string;
  name: string;
  description: string;
  type: 'rbac' | 'abac';
  rules: IAMRule[];
  tenantId: string;
  createdAt: string;
}

export interface IAMRule {
  id: string;
  resource: string;
  actions: ('read' | 'write' | 'execute' | 'approve' | 'admin')[];
  conditions?: IAMCondition[];
  effect: 'allow' | 'deny';
}

export interface IAMCondition {
  attribute: string;
  operator: 'equals' | 'not_equals' | 'in' | 'not_in' | 'greater_than' | 'less_than';
  value: string | string[] | number;
}

export interface SSOConfig {
  provider: 'azure_ad' | 'okta' | 'google' | 'saml' | 'oidc';
  tenantId: string;
  clientId: string;
  issuerUrl: string;
  enabled: boolean;
  autoProvision: boolean;
  defaultRole: UserRole;
}

// --- Agent Control Plane ---
export interface AgentDeployment {
  id: string;
  tenantId: string;
  clusterId: string;
  clusterName: string;
  clusterType: CatalystClusterType;
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'error';
  deploymentModel: DeploymentModel;
  autonomyTier: AutonomyTier;
  config: AgentDeploymentConfig;
  createdAt: string;
  deployedAt?: string;
  deployedBy: string;
  healthCheck: AgentHealthCheck;
}

export interface AgentDeploymentConfig {
  replicas: number;
  maxConcurrentTasks: number;
  confidenceThreshold: number;
  escalationPolicy: 'auto' | 'manual' | 'hybrid';
  allowedActions: string[];
  blockedActions: string[];
  schedule?: string; // cron
  resourceLimits: {
    cpuMillicores: number;
    memoryMb: number;
  };
}

export interface AgentHealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
  uptime: number;
  latencyP95: number;
  errorRate: number;
  tasksPerMinute: number;
}

// --- Canonical API ---
export interface CanonicalEndpoint {
  id: string;
  name: string;
  path: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  domain: 'finance' | 'procurement' | 'supply-chain' | 'hr' | 'sales' | 'inventory' | 'crm';
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  supportedERPs: string[];
  version: string;
  status: 'active' | 'deprecated' | 'beta';
}

export interface CanonicalEntity {
  name: string;
  domain: string;
  fields: CanonicalField[];
  description: string;
}

export interface CanonicalField {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'date' | 'object' | 'array';
  required: boolean;
  description: string;
  mappedFrom?: Record<string, string>; // ERP -> field path
}

// --- ERP Adapter Layer ---
export type ERPSystem = 'sap_s4hana' | 'sap_ecc' | 'oracle_fusion' | 'dynamics_365' | 'salesforce' | 'workday' | 'netsuite' | 'sage' | 'custom';

export interface ERPAdapter {
  id: string;
  system: ERPSystem;
  displayName: string;
  version: string;
  status: 'available' | 'connected' | 'error' | 'maintenance';
  capabilities: ERPCapability[];
  authType: 'oauth2' | 'api_key' | 'basic' | 'certificate' | 'saml';
  icon: string;
}

export interface ERPCapability {
  domain: string;
  operations: ('read' | 'write' | 'subscribe')[];
  entities: string[];
}

export interface ERPConnection {
  id: string;
  adapterId: string;
  system: ERPSystem;
  displayName: string;
  tenantId: string;
  status: 'connected' | 'disconnected' | 'error' | 'syncing';
  config: {
    baseUrl: string;
    environment: 'production' | 'staging' | 'sandbox';
  };
  lastSync: string;
  syncStatus: {
    entitiesSynced: number;
    lastError?: string;
    throughput: number;
  };
}

// --- Tenant Infrastructure ---
export interface TenantInfrastructure {
  deploymentModel: DeploymentModel;
  region: string;
  compute: {
    type: 'cloudflare-workers' | 'kubernetes' | 'vm' | 'hybrid';
    nodes?: number;
    status: 'running' | 'scaling' | 'maintenance';
  };
  storage: {
    type: 'd1' | 'postgres' | 'sql-server' | 'hybrid';
    sizeGb: number;
    usedGb: number;
  };
  vectorDb: {
    type: 'vectorize' | 'pinecone' | 'weaviate' | 'on-premise';
    dimensions: number;
    indexCount: number;
  };
}
