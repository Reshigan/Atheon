# atheon-sdk

Official Python SDK for the **Atheon Enterprise Intelligence Platform**.

Mirror of the [TypeScript SDK](../typescript/) so partner integrations get a consistent contract across the two main enterprise data ecosystems.

## Install

```bash
pip install atheon-sdk
# or
uv add atheon-sdk
```

Requires Python 3.10+.

## Quick start

```python
from atheon_sdk import AtheonClient

with AtheonClient(base_url="https://atheon-api.vantax.co.za") as client:
    # 1. Log in (or pass a pre-issued token to AtheonClient(token=...))
    login = client.auth.login("you@example.com", "password", tenant_slug="your-tenant")
    client.set_token(login["token"])

    # 2. Pull the executive briefing
    briefing = client.apex.briefing()
    print(briefing["summary"])

    # 3. Verify the cryptographic provenance chain
    verify = client.provenance.verify()
    if not verify["valid"]:
        raise SystemExit(f"Provenance broken at seq {verify['firstInvalidSeq']}")
```

## Endpoints covered

| Namespace | Methods |
|---|---|
| `client.auth` | `login`, `me` |
| `client.apex` | `health`, `briefing`, `risks`, `scenarios`, `create_scenario` |
| `client.pulse` | `metrics`, `anomalies`, `processes` |
| `client.catalysts` | `clusters`, `actions`, `pending_approvals` |
| `client.provenance` | `list`, `verify`, `root` |
| `client.billing` | `plans`, `checkout` |
| `client.compliance` | `evidence_pack` (admin+ only) |

The full API surface is wider — see [the OpenAPI spec](https://atheon-api.vantax.co.za/api/v1/openapi.json) or the rendered docs at [/api/v1/docs](https://atheon-api.vantax.co.za/api/v1/docs).

## Error handling

All non-2xx responses raise `AtheonApiError`:

```python
from atheon_sdk import AtheonApiError

try:
    client.apex.health()
except AtheonApiError as err:
    print(f"HTTP {err.status}: {err}")
    print(f"Request ID for support: {err.request_id}")
```

Network timeouts (default 30s, configurable via `timeout=` constructor arg) raise `AtheonApiError` with `status == 0`.

## Type-safe end to end

The SDK ships with a `py.typed` marker; mypy will type-check your code against the wire types declared in `atheon_sdk.types` (TypedDicts).

```python
from atheon_sdk import HealthScore, Risk, EvidencePack
```

## Local development

```bash
pip install -e '.[dev]'
pytest        # 11 tests
ruff check src tests
mypy src
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Support

- API status: <https://atheon-api.vantax.co.za/healthz>
- Issues: <https://github.com/VantaX-Org/Atheon/issues>
- Email: `support@vantax.co.za`
