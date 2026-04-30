"""
Atheon SDK — typed payload shapes.

These TypedDicts mirror the platform's wire types so that integrators
get IDE completion and mypy strictness without coupling to a specific
JSON library. Subset of workers/api/src/types.ts — only the fields an
external integrator actually needs.
"""

from __future__ import annotations

from typing import Literal, TypedDict

# ── Auth ────────────────────────────────────────────────────────────────


class TenantBrand(TypedDict, total=False):
    logoUrl: str | None
    primaryColor: str | None
    nameOverride: str | None


class AuthUser(TypedDict, total=False):
    id: str
    email: str
    name: str
    role: Literal[
        "superadmin",
        "support_admin",
        "admin",
        "executive",
        "manager",
        "analyst",
        "operator",
        "viewer",
    ]
    tenantId: str
    tenantName: str
    tenantSlug: str
    permissions: list[str]
    brand: TenantBrand


class LoginResponse(TypedDict):
    token: str
    user: AuthUser


# ── Apex ────────────────────────────────────────────────────────────────


class HealthDimensionDetail(TypedDict, total=False):
    score: float
    trend: str
    delta: float | None


class HealthScore(TypedDict, total=False):
    overall: float
    trend: str
    dimensions: dict[str, HealthDimensionDetail]
    updatedAt: str


class KpiMovement(TypedDict, total=False):
    kpi: str
    movement: str
    period: str


class Briefing(TypedDict, total=False):
    summary: str
    healthDelta: float | None
    redMetricCount: int | None
    anomalyCount: int | None
    activeRiskCount: int | None
    kpiMovements: list[KpiMovement]
    risks: list[str]
    opportunities: list[str]


class Risk(TypedDict, total=False):
    id: str
    title: str
    description: str
    severity: Literal["critical", "high", "medium", "low"]
    category: str
    probability: float
    impactValue: float
    impactUnit: str
    detectedAt: str


class ScenarioItem(TypedDict, total=False):
    id: str
    title: str
    description: str
    status: str
    variables: list[str]
    results: dict[str, object] | None
    createdAt: str | None


# ── Pulse ───────────────────────────────────────────────────────────────


class MetricThresholds(TypedDict, total=False):
    green: float | None
    amber: float | None
    red: float | None


class Metric(TypedDict, total=False):
    id: str
    name: str
    value: float
    unit: str
    status: str
    thresholds: MetricThresholds
    trend: list[float]
    sourceSystem: str | None
    measuredAt: str
    subCatalystName: str | None
    sourceRunId: str | None
    clusterId: str | None


class AnomalyItem(TypedDict, total=False):
    id: str
    metric: str
    severity: Literal["critical", "high", "medium", "low"]
    expectedValue: float
    actualValue: float
    deviation: float
    hypothesis: str
    status: str
    detectedAt: str


class ProcessItem(TypedDict, total=False):
    id: str
    name: str
    category: str
    conformanceRate: float
    bottlenecks: list[str]
    averageDurationMs: int


# ── Catalysts ───────────────────────────────────────────────────────────


class SubCatalyst(TypedDict, total=False):
    name: str
    enabled: bool
    description: str


class ClusterItem(TypedDict, total=False):
    id: str
    name: str
    domain: str
    description: str
    autonomyTier: str
    trustScore: float
    subCatalysts: list[SubCatalyst]


class ActionItem(TypedDict, total=False):
    id: str
    clusterId: str
    catalystName: str
    action: str
    status: str
    confidence: float
    reasoning: str
    inputData: dict[str, object]
    outputData: dict[str, object]
    createdAt: str


# ── Provenance ─────────────────────────────────────────────────────────


class ProvenanceEntry(TypedDict, total=False):
    id: str
    tenantId: str
    seq: int
    parentId: str | None
    payloadType: str
    payloadHash: str
    payloadJson: str
    signedByUserId: str | None
    signature: str | None
    merkleRootAfter: str
    createdAt: str


class ProvenanceVerifyResult(TypedDict, total=False):
    valid: bool
    totalEntries: int
    firstInvalidSeq: int | None
    reason: str
    currentRoot: str | None


# ── Billing ────────────────────────────────────────────────────────────


class BillingPrice(TypedDict):
    monthly: float
    annual: float


class BillingLimits(TypedDict):
    users: int
    erpConnections: int
    catalystClusters: int
    storageGb: int


class BillingPlan(TypedDict, total=False):
    id: str
    name: str
    description: str
    price: BillingPrice
    currency: str
    features: list[str]
    limits: BillingLimits


class CheckoutSessionResponse(TypedDict, total=False):
    sessionId: str
    url: str
    planId: str
    billingCycle: str


# ── Compliance ─────────────────────────────────────────────────────────


class _AccessReviews(TypedDict, total=False):
    activeAdminCount: int
    adminsAssignedLast90d: int
    roleChangesLast90d: int
    mfaEnabledCount: int
    activeUserCount: int


class _MfaPosture(TypedDict, total=False):
    totalUsers: int
    mfaEnabled: int
    mfaCoveragePct: float
    adminsInGracePeriod: int
    adminsExpiredGrace: int


class _ConfigChanges(TypedDict, total=False):
    changesLast30d: int
    changesLast90d: int
    topActions: list[dict[str, object]]


class _IncidentResponse(TypedDict, total=False):
    totalCriticalLast90d: int
    resolvedCriticalLast90d: int
    openCritical: int
    medianResolutionHours: float | None


class _Deprovisioning(TypedDict, total=False):
    deprovisionedLast90d: int
    currentlyDisabled: int
    privilegedDisabled: int


class _Encryption(TypedDict, total=False):
    erpEncrypted: int
    erpPlaintext: int
    totalConnections: int


class _AuditRetention(TypedDict, total=False):
    totalRows: int
    oldestEventAt: str | None
    oneYearAgo: str
    provenanceChainLength: int


class EvidencePack(TypedDict, total=False):
    generatedAt: str
    tenantId: str
    generatedBy: str
    accessReviews: _AccessReviews
    mfa: _MfaPosture
    configChanges: _ConfigChanges
    incidentResponse: _IncidentResponse
    deprovisioning: _Deprovisioning
    encryption: _Encryption
    auditRetention: _AuditRetention
