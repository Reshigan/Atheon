# @vantax/atheon-sdk

Official TypeScript SDK for the **Atheon Enterprise Intelligence Platform**.

Wraps the public REST API (`https://atheon-api.vantax.co.za`) with typed helpers. Works in Node 20+, modern browsers, Cloudflare Workers, Deno, and Bun — anywhere `fetch` is available.

## Install

```bash
npm install @vantax/atheon-sdk
# or
pnpm add @vantax/atheon-sdk
yarn add @vantax/atheon-sdk
```

## Quick start

```ts
import { AtheonClient } from '@vantax/atheon-sdk';

const client = new AtheonClient({
  baseUrl: 'https://atheon-api.vantax.co.za',
});

// 1. Log in (or pass a pre-issued token via `token:` in the constructor)
const { token, user } = await client.auth.login('you@example.com', 'password', 'your-tenant');
client.setToken(token);

// 2. Pull the executive briefing
const briefing = await client.apex.briefing();
console.log(briefing.summary);

// 3. Verify the cryptographic provenance chain
const verify = await client.provenance.verify();
if (!verify.valid) {
  throw new Error(`Provenance broken at seq ${verify.firstInvalidSeq}`);
}
```

## Authentication

The SDK uses bearer tokens issued by:
- `POST /api/auth/login` — email/password
- `POST /api/auth/sso/callback` — OIDC / SSO redirect
- The Atheon admin console (long-lived service tokens for partners)

Pass it to the constructor or call `client.setToken()` after a refresh.

```ts
const client = new AtheonClient({
  baseUrl: 'https://atheon-api.vantax.co.za',
  token: process.env.ATHEON_TOKEN,
});
```

## Endpoints covered

| Namespace | Methods |
|---|---|
| `client.auth` | `login`, `me` |
| `client.apex` | `health`, `briefing`, `risks`, `scenarios`, `createScenario` |
| `client.pulse` | `metrics`, `anomalies`, `processes` |
| `client.catalysts` | `clusters`, `actions`, `pendingApprovals` |
| `client.provenance` | `list`, `verify`, `root` |
| `client.billing` | `plans`, `checkout` |
| `client.compliance` | `evidencePack` (admin+ only) |

The full API surface includes more — see [the OpenAPI spec](https://atheon-api.vantax.co.za/api/v1/openapi.json) or the rendered docs at [/api/v1/docs](https://atheon-api.vantax.co.za/api/v1/docs). PRs adding methods to this SDK are welcome.

## Error handling

All non-2xx responses throw `AtheonApiError`:

```ts
import { AtheonApiError } from '@vantax/atheon-sdk';

try {
  await client.apex.health();
} catch (err) {
  if (err instanceof AtheonApiError) {
    console.error(`HTTP ${err.status}: ${err.message}`);
    console.error(`Request ID for support: ${err.requestId}`);
  }
}
```

Network timeouts (default 30s, configurable via `timeoutMs:`) throw `AtheonApiError` with `status === 0`.

## Type-safe end to end

Every method returns a typed payload that matches the platform's wire types. No `any`, no opaque `unknown`s in the happy path. The `types.ts` module re-exports the surface types:

```ts
import type { Risk, HealthScore, EvidencePack } from '@vantax/atheon-sdk';
```

## Local development

```bash
npm install
npm run test       # vitest
npm run build      # outputs dist/ via tsc
npm run lint
```

## License

Apache-2.0 — see [LICENSE](./LICENSE).

## Support

- API status: [/healthz](https://atheon-api.vantax.co.za/healthz)
- Issues: <https://github.com/VantaX-Org/Atheon/issues>
- Email: `support@vantax.co.za`
