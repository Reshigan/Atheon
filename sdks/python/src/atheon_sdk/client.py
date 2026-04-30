"""
AtheonClient — synchronous Python client for the Atheon API.

Modelled on the TypeScript SDK (sdks/typescript/src/client.ts) so that
partner integrations have a consistent contract across the two main
enterprise data ecosystems.

Built on httpx for HTTP. No async surface yet — most ERP-side
integrations are batch jobs; we'll add an async sibling once a partner
asks for one.
"""

from __future__ import annotations

from typing import Any, Literal, cast

import httpx

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
)


class AtheonApiError(Exception):
    """Raised on any non-2xx HTTP response from the Atheon API.

    Carries the HTTP status, the X-Request-ID header (for support
    correlation), and the parsed JSON body when available.
    """

    def __init__(
        self,
        status: int,
        message: str,
        request_id: str | None = None,
        body: object | None = None,
    ) -> None:
        super().__init__(message)
        self.status = status
        self.request_id = request_id
        self.body = body

    def __repr__(self) -> str:  # pragma: no cover — debugging aid
        return (
            f"AtheonApiError(status={self.status!r}, "
            f"message={self.args[0]!r}, request_id={self.request_id!r})"
        )


class _Namespace:
    """Internal base class — all client.<namespace> live attached to the client."""

    def __init__(self, client: AtheonClient) -> None:
        self._client = client


class _AuthNamespace(_Namespace):
    def login(
        self,
        email: str,
        password: str,
        tenant_slug: str | None = None,
    ) -> LoginResponse:
        body: dict[str, Any] = {"email": email, "password": password}
        if tenant_slug:
            body["tenant_slug"] = tenant_slug
        return cast(LoginResponse, self._client._request("POST", "/api/auth/login", json_body=body))

    def me(self) -> AuthUser:
        return cast(AuthUser, self._client._request("GET", "/api/auth/me"))


class _ApexNamespace(_Namespace):
    def health(self) -> HealthScore:
        return cast(HealthScore, self._client._request("GET", "/api/apex/health"))

    def briefing(self) -> Briefing:
        return cast(Briefing, self._client._request("GET", "/api/apex/briefing"))

    def risks(self) -> dict[str, Any]:
        return cast(dict[str, Any], self._client._request("GET", "/api/apex/risks"))

    def scenarios(self) -> dict[str, Any]:
        return cast(dict[str, Any], self._client._request("GET", "/api/apex/scenarios"))

    def create_scenario(
        self,
        title: str,
        description: str,
        input_query: str,
        variables: list[str],
        model_type: Literal["what-if", "sensitivity", "monte-carlo", "stress-test"],
        base_values: dict[str, str] | None = None,
    ) -> dict[str, Any]:
        body = {
            "title": title,
            "description": description,
            "input_query": input_query,
            "variables": variables,
            "model_type": model_type,
            "base_values": base_values or {},
        }
        return cast(dict[str, Any], self._client._request("POST", "/api/apex/scenarios", json_body=body))


class _PulseNamespace(_Namespace):
    def metrics(self) -> dict[str, list[Metric] | int]:
        return cast(
            dict[str, list[Metric] | int],
            self._client._request("GET", "/api/pulse/metrics"),
        )

    def anomalies(self) -> dict[str, list[AnomalyItem] | int]:
        return cast(
            dict[str, list[AnomalyItem] | int],
            self._client._request("GET", "/api/pulse/anomalies"),
        )

    def processes(self) -> dict[str, list[ProcessItem] | int]:
        return cast(
            dict[str, list[ProcessItem] | int],
            self._client._request("GET", "/api/pulse/processes"),
        )


class _CatalystsNamespace(_Namespace):
    def clusters(self) -> dict[str, list[ClusterItem] | int]:
        return cast(
            dict[str, list[ClusterItem] | int],
            self._client._request("GET", "/api/catalysts/clusters"),
        )

    def actions(self) -> dict[str, list[ActionItem] | int]:
        return cast(
            dict[str, list[ActionItem] | int],
            self._client._request("GET", "/api/catalysts/actions"),
        )

    def pending_approvals(self) -> dict[str, list[ActionItem] | int]:
        return cast(
            dict[str, list[ActionItem] | int],
            self._client._request("GET", "/api/catalysts/approvals"),
        )


class _ProvenanceNamespace(_Namespace):
    def list(
        self,
        limit: int | None = None,
        offset: int | None = None,
    ) -> dict[str, list[ProvenanceEntry] | int]:
        params: dict[str, str] = {}
        if limit is not None:
            params["limit"] = str(limit)
        if offset is not None:
            params["offset"] = str(offset)
        return cast(
            dict[str, list[ProvenanceEntry] | int],
            self._client._request("GET", "/api/audit/provenance", params=params),
        )

    def verify(self) -> ProvenanceVerifyResult:
        return cast(
            ProvenanceVerifyResult,
            self._client._request("POST", "/api/audit/provenance/verify"),
        )

    def root(self) -> dict[str, Any]:
        return cast(dict[str, Any], self._client._request("GET", "/api/audit/provenance/root"))


class _BillingNamespace(_Namespace):
    def plans(self) -> dict[str, list[BillingPlan]]:
        return cast(dict[str, list[BillingPlan]], self._client._request("GET", "/api/billing/plans"))

    def checkout(
        self,
        plan_id: str,
        billing_cycle: Literal["monthly", "annual"],
        success_url: str | None = None,
        cancel_url: str | None = None,
    ) -> CheckoutSessionResponse:
        body: dict[str, Any] = {"plan_id": plan_id, "billing_cycle": billing_cycle}
        if success_url:
            body["success_url"] = success_url
        if cancel_url:
            body["cancel_url"] = cancel_url
        return cast(
            CheckoutSessionResponse,
            self._client._request("POST", "/api/billing/checkout", json_body=body),
        )


class _ComplianceNamespace(_Namespace):
    def evidence_pack(self, tenant_id: str | None = None) -> EvidencePack:
        params = {"tenant_id": tenant_id} if tenant_id else {}
        return cast(
            EvidencePack,
            self._client._request("GET", "/api/v1/compliance/evidence-pack", params=params),
        )


class AtheonClient:
    """Synchronous client for the Atheon API.

    Args:
        base_url: API base URL (e.g. ``https://atheon-api.vantax.co.za``).
            Trailing slashes are stripped.
        token: Optional bearer token issued by ``auth.login`` or via SSO.
        timeout: Per-request timeout in seconds (default 30).
        http_client: Optional ``httpx.Client`` to inject for testing.

    Example::

        from atheon_sdk import AtheonClient

        client = AtheonClient(base_url="https://atheon-api.vantax.co.za")
        login = client.auth.login("you@example.com", "password", "your-tenant")
        client.set_token(login["token"])
        briefing = client.apex.briefing()
        verify = client.provenance.verify()
        if not verify["valid"]:
            raise SystemExit(f"Provenance broken at seq {verify['firstInvalidSeq']}")
    """

    def __init__(
        self,
        base_url: str,
        token: str | None = None,
        timeout: float = 30.0,
        http_client: httpx.Client | None = None,
    ) -> None:
        if not base_url:
            raise ValueError("AtheonClient: base_url is required")
        self._base_url = base_url.rstrip("/")
        self._token = token
        self._timeout = timeout
        # Caller-supplied http_client lets tests inject a respx-mocked one
        # without us needing a respx dependency.
        self._http = http_client or httpx.Client(timeout=timeout)
        self._owns_http = http_client is None

        self.auth = _AuthNamespace(self)
        self.apex = _ApexNamespace(self)
        self.pulse = _PulseNamespace(self)
        self.catalysts = _CatalystsNamespace(self)
        self.provenance = _ProvenanceNamespace(self)
        self.billing = _BillingNamespace(self)
        self.compliance = _ComplianceNamespace(self)

    def set_token(self, token: str | None) -> None:
        """Replace the bearer token used on subsequent requests."""
        self._token = token

    def close(self) -> None:
        """Close the underlying HTTP session if we own it."""
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> AtheonClient:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # ── Internal ────────────────────────────────────────────────────────

    def _request(
        self,
        method: str,
        path: str,
        json_body: object | None = None,
        params: dict[str, str] | None = None,
    ) -> object:
        headers: dict[str, str] = {"Accept": "application/json"}
        if self._token:
            headers["Authorization"] = f"Bearer {self._token}"
        url = f"{self._base_url}{path}"
        try:
            res = self._http.request(
                method,
                url,
                headers=headers,
                json=json_body,
                params=params,
            )
        except httpx.TimeoutException as e:
            raise AtheonApiError(0, f"Request timed out: {path}", None) from e
        except httpx.HTTPError as e:  # pragma: no cover — network plumbing
            raise AtheonApiError(0, f"Network error: {e!s}", None) from e

        request_id = res.headers.get("X-Request-ID")
        if res.is_success:
            try:
                return res.json()
            except ValueError as e:
                raise AtheonApiError(
                    res.status_code,
                    f"Response was not JSON: {e!s}",
                    request_id,
                ) from e

        body: object = None
        try:
            body = res.json()
        except ValueError:
            body = res.text or None
        message = (
            body["error"]
            if isinstance(body, dict) and isinstance(body.get("error"), str)
            else f"HTTP {res.status_code} {res.reason_phrase}"
        )
        raise AtheonApiError(res.status_code, message, request_id, body)
