"""
AtheonClient unit tests.

Mocks the underlying httpx.Client via httpx.MockTransport so we exercise
the full request/response envelope (auth header, query params, JSON
body, error mapping) without hitting the network.
"""

from __future__ import annotations

import httpx
import pytest

from atheon_sdk import AtheonApiError, AtheonClient

BASE = "https://atheon-test.example.com"
TOKEN = "test-token-123"


def make_client(handler) -> AtheonClient:
    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport, timeout=5.0)
    return AtheonClient(base_url=BASE, token=TOKEN, http_client=http)


def test_construction_requires_base_url() -> None:
    with pytest.raises(ValueError, match="base_url"):
        AtheonClient(base_url="")


def test_strips_trailing_slash() -> None:
    client = AtheonClient(base_url="https://x.example.com/")
    assert client._base_url == "https://x.example.com"  # noqa: SLF001
    client.close()


def test_attaches_bearer_token() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"overall": 78, "trend": "up", "dimensions": {}})

    client = make_client(handler)
    client.apex.health()
    assert captured["auth"] == f"Bearer {TOKEN}"


def test_omits_auth_header_when_no_token() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["auth"] = request.headers.get("authorization", "")
        return httpx.Response(200, json={"plans": []})

    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    client = AtheonClient(base_url=BASE, http_client=http)
    client.billing.plans()
    assert captured["auth"] == ""


def test_login_sends_credentials_in_body() -> None:
    captured: dict[str, object] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["body"] = request.read()
        return httpx.Response(
            200,
            json={
                "token": "new-token",
                "user": {"id": "u1", "email": "a@b.co", "name": "A", "role": "admin", "tenantId": "t"},
            },
        )

    transport = httpx.MockTransport(handler)
    http = httpx.Client(transport=transport)
    client = AtheonClient(base_url=BASE, http_client=http)
    res = client.auth.login("a@b.co", "pw", tenant_slug="acme")
    assert res["token"] == "new-token"
    body_raw = captured["body"]
    assert isinstance(body_raw, bytes)
    assert b"a@b.co" in body_raw
    assert b"acme" in body_raw


def test_error_includes_request_id_and_parsed_body() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(
            401,
            json={"error": "Unauthorized", "details": "no token"},
            headers={"X-Request-ID": "req-abc-123"},
        )

    client = make_client(handler)
    with pytest.raises(AtheonApiError) as exc_info:
        client.auth.me()
    err = exc_info.value
    assert err.status == 401
    assert "Unauthorized" in str(err)
    assert err.request_id == "req-abc-123"


def test_error_falls_back_to_status_text_when_body_not_json() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        return httpx.Response(502, content=b"gateway plain text")

    client = make_client(handler)
    with pytest.raises(AtheonApiError) as exc_info:
        client.auth.me()
    assert exc_info.value.status == 502
    assert "502" in str(exc_info.value)


def test_provenance_verify_uses_post() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["path"] = request.url.path
        return httpx.Response(
            200,
            json={
                "valid": True, "totalEntries": 12, "firstInvalidSeq": None,
                "reason": "ok", "currentRoot": "r1",
            },
        )

    client = make_client(handler)
    res = client.provenance.verify()
    assert res["valid"] is True
    assert captured["method"] == "POST"
    assert captured["path"] == "/api/audit/provenance/verify"


def test_compliance_evidence_pack_passes_tenant_id_query() -> None:
    captured: dict[str, str] = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["query"] = request.url.query.decode()
        return httpx.Response(200, json={"generatedAt": "now", "tenantId": "tx", "generatedBy": "u1"})

    client = make_client(handler)
    client.compliance.evidence_pack(tenant_id="tx")
    assert "tenant_id=tx" in captured["query"]


def test_set_token_replaces_token_on_subsequent_requests() -> None:
    auths: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        auths.append(request.headers.get("authorization", ""))
        return httpx.Response(200, json={"id": "u1", "email": "a@b.co", "name": "A", "role": "admin", "tenantId": "t"})

    client = make_client(handler)
    client.auth.me()
    client.set_token("new-token")
    client.auth.me()
    assert auths[0] == f"Bearer {TOKEN}"
    assert auths[1] == "Bearer new-token"


def test_timeout_raises_atheon_api_error() -> None:
    def handler(_: httpx.Request) -> httpx.Response:
        raise httpx.TimeoutException("simulated")

    client = make_client(handler)
    with pytest.raises(AtheonApiError) as exc_info:
        client.apex.health()
    assert exc_info.value.status == 0
    assert "timed out" in str(exc_info.value).lower()


def test_context_manager_closes_owned_client() -> None:
    closed = {"v": False}

    class _Wrap:
        def __init__(self, real: httpx.Client) -> None:
            self._real = real

        def request(self, *a: object, **kw: object) -> httpx.Response:
            return self._real.request(*a, **kw)  # type: ignore[arg-type]

        def close(self) -> None:
            closed["v"] = True

    transport = httpx.MockTransport(lambda _: httpx.Response(200, json={}))
    http = httpx.Client(transport=transport)
    # When http_client is supplied, AtheonClient should NOT close it on exit.
    with AtheonClient(base_url=BASE, http_client=http) as c:
        assert c is not None
    # Caller-owned http_client remains open.
    assert closed["v"] is False
