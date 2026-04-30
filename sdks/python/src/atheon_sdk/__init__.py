"""
atheon-sdk — Official Python SDK for the Atheon Enterprise Intelligence
Platform.

Quick start:

    from atheon_sdk import AtheonClient

    client = AtheonClient(
        base_url="https://atheon-api.vantax.co.za",
        token="...",
    )
    health = client.apex.health()
    risks = client.apex.risks()
"""

from atheon_sdk.client import AtheonApiError, AtheonClient
from atheon_sdk.types import (
    ActionItem,
    AnomalyItem,
    AuthUser,
    BillingPlan,
    Briefing,
    CheckoutSessionResponse,
    ClusterItem,
    EvidencePack,
    HealthScore,
    LoginResponse,
    Metric,
    ProcessItem,
    ProvenanceEntry,
    ProvenanceVerifyResult,
    Risk,
    ScenarioItem,
    SubCatalyst,
    TenantBrand,
)

__version__ = "0.1.0"

__all__ = [
    "AtheonClient",
    "AtheonApiError",
    "AuthUser",
    "TenantBrand",
    "LoginResponse",
    "HealthScore",
    "Briefing",
    "Risk",
    "ScenarioItem",
    "Metric",
    "AnomalyItem",
    "ProcessItem",
    "ClusterItem",
    "ActionItem",
    "SubCatalyst",
    "ProvenanceEntry",
    "ProvenanceVerifyResult",
    "BillingPlan",
    "CheckoutSessionResponse",
    "EvidencePack",
]
