/**
 * Atheon SDK — TypeScript types.
 *
 * Subset of the platform's wire types that the SDK surfaces. The full
 * type surface lives in workers/api/src/types.ts and is more extensive;
 * here we expose only what an external integrator needs.
 */

// ── Auth ────────────────────────────────────────────────────────────────

export interface TenantBrand {
  logoUrl: string | null;
  primaryColor: string | null;
  nameOverride: string | null;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: 'superadmin' | 'support_admin' | 'admin' | 'executive' | 'manager' | 'analyst' | 'operator' | 'viewer';
  tenantId: string;
  tenantName?: string;
  tenantSlug?: string;
  permissions: string[];
  brand?: TenantBrand;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}

// ── Apex (executive intelligence) ──────────────────────────────────────

export interface HealthDimensionDetail {
  score: number;
  trend: 'up' | 'down' | 'stable' | 'improving' | 'declining';
  delta: number | null;
}

export interface HealthScore {
  overall: number;
  trend: string;
  dimensions: Record<string, HealthDimensionDetail>;
  updatedAt: string;
}

export interface Briefing {
  summary: string;
  healthDelta: number | null;
  redMetricCount: number | null;
  anomalyCount: number | null;
  activeRiskCount: number | null;
  kpiMovements: Array<{ kpi: string; movement: string; period: string }>;
  risks: string[];
  opportunities: string[];
}

export interface Risk {
  id: string;
  title: string;
  description: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  probability: number;
  impactValue: number;
  impactUnit: string;
  detectedAt: string;
}

export interface ScenarioItem {
  id: string;
  title: string;
  description: string;
  status: string;
  variables: string[];
  results: Record<string, unknown> | null;
  createdAt: string | null;
}

// ── Pulse (process intelligence) ───────────────────────────────────────

export interface Metric {
  id: string;
  name: string;
  value: number;
  unit: string;
  status: 'green' | 'amber' | 'red' | string;
  thresholds: { green: number | null; amber: number | null; red: number | null };
  trend: number[];
  sourceSystem: string | null;
  measuredAt: string;
  subCatalystName: string | null;
  sourceRunId: string | null;
  clusterId: string | null;
}

export interface AnomalyItem {
  id: string;
  metric: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
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
  category: string;
  conformanceRate: number;
  bottlenecks: string[];
  averageDurationMs: number;
}

// ── Catalysts ──────────────────────────────────────────────────────────

export interface SubCatalyst {
  name: string;
  enabled: boolean;
  description: string;
}

export interface ClusterItem {
  id: string;
  name: string;
  domain: string;
  description: string;
  autonomyTier: string;
  trustScore: number;
  subCatalysts?: SubCatalyst[];
}

export interface ActionItem {
  id: string;
  clusterId: string;
  catalystName: string;
  action: string;
  status: string;
  confidence: number;
  reasoning?: string;
  inputData?: Record<string, unknown>;
  outputData?: Record<string, unknown>;
  createdAt: string;
}

// ── Provenance ─────────────────────────────────────────────────────────

export interface ProvenanceEntry {
  id: string;
  tenantId: string;
  seq: number;
  parentId: string | null;
  payloadType: string;
  payloadHash: string;
  payloadJson: string;
  signedByUserId: string | null;
  signature: string | null;
  merkleRootAfter: string;
  createdAt: string;
}

export interface ProvenanceVerifyResult {
  valid: boolean;
  totalEntries: number;
  firstInvalidSeq: number | null;
  reason: string;
  currentRoot: string | null;
}

// ── Billing ────────────────────────────────────────────────────────────

export interface BillingPlan {
  id: string;
  name: string;
  description: string;
  price: { monthly: number; annual: number };
  currency: string;
  features: string[];
  limits: { users: number; erpConnections: number; catalystClusters: number; storageGb: number };
}

export interface CheckoutSessionResponse {
  sessionId: string;
  url: string;
  planId: string;
  billingCycle: string;
}

// ── Compliance ─────────────────────────────────────────────────────────

export interface EvidencePack {
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
}
