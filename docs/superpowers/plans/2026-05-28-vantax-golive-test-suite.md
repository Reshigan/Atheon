# VantaX Go-Live Test & Verification Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a comprehensive, deploy-blocking verification suite (accuracy, traceability, E2E, tenant isolation, RBAC, load, disaster-recovery) plus a human go-live runbook that proves the Atheon platform is correct on the seeded `vantax` dataset before VantaX go-live.

**Architecture:** A new top-level `verification/` directory holds integration suites that authenticate against the **deployed** API (`https://atheon-api.vantax.co.za`), reseed the disposable `vantax` tenant to a known state, and assert results against a single canonical oracle constant (`VANTAX_ORACLE`). Per-row billing traceability is read directly from D1 via `wrangler d1 execute --remote --json`. The suites run as a node-environment vitest project; the existing Playwright E2E is repaired and re-pointed at `vantax`; load and DR run as scripts. All suites compose into one GitHub Actions **go-live gate** that gates the production promotion, and a `docs/runbooks/go-live.md` runbook wraps the same suites for a human sign-off.

**Tech Stack:** TypeScript, vitest 4 (node env, new `verification/` project), Node 20 global `fetch`, `tsx`, `wrangler` (D1 remote query + export), Playwright (existing E2E), GitHub Actions, Cloudflare Workers/Pages/D1/R2, Hono.

---

## Decisions locked by the spec (and plan-author resolutions)

These resolve ambiguities discovered while grounding the plan in the codebase. They are binding for every task below.

1. **Credentials are env-driven, never hardcoded.** The seeder does **not** `INSERT` vantax users — it `SELECT`s existing ones (`seed-vantax.ts:3192`). `load-test.ts` uses `admin@vantax.co.za` / `Admin123`; `helpers.ts` uses `Admin123!`. Because the real deployed password is not knowable from source, all suites read credentials from environment variables (mirroring the existing E2E convention `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD`). Canonical names: `VERIFY_API_URL`, `VERIFY_APP_URL`, `VERIFY_ADMIN_EMAIL`, `VERIFY_ADMIN_PASSWORD`, `VERIFY_TENANT_SLUG` (default `vantax`), `VERIFY_SUPERADMIN_EMAIL`/`VERIFY_SUPERADMIN_PASSWORD` (optional, for second-tenant isolation), `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` (for D1 reads). A missing required env var fails the run loudly.
2. **Login returns a token directly.** `POST /api/v1/auth/login` success body is `{ token, refreshToken, expiresIn, user: { id, email, role, tenantId, tenantSlug, ... }, mfaEnforcementWarning? }` (auth.ts:214). `mfaEnforcementWarning` is informational, not a block. The seeded admin logs in without a TOTP challenge. (If a future account enforces MFA, the client throws a clear error — TOTP step-up is out of scope.)
3. **`clusterId` is resolved at runtime.** Cluster IDs are random UUIDs per seed. The harness calls `GET /api/v1/catalysts/clusters` (catalysts.ts:722, returns `{ ..., subCatalysts: [{name, enabled, ...}] }` per cluster) and finds the cluster whose `subCatalysts` contains the target sub-catalyst `name`. `subName` is the **display name** (e.g. `"GR/IR Reconciliation"`), URL-encoded in the path.
4. **Run item counts** come from `GET /api/v1/catalysts/runs/:runId/items` → `totals: { matched, discrepancies, unmatched, exceptions, ... }` (catalysts.ts:4888). `discrepancies` = variance items; `unmatched` = unmatched_source + unmatched_target.
5. **`requireRole` is membership-based** (tenant.ts:95): denial → HTTP **403** `{ error: 'Forbidden', message: 'Requires one of: ...' }`; missing auth → **401**. The per-sub-catalyst execute endpoint (catalysts.ts:1618) allows only admin-class roles + `executive`; everyone else gets 403.
6. **Tenant isolation:** a non-superadmin passing `?tenant_id=<other>` → **403** `{ error:'Forbidden', message:'You can only access data for your own tenant' }` (tenant.ts:55). A resource ID not in the caller's tenant → **404** (route handlers filter `WHERE tenant_id = ?`, e.g. apex.ts:48). `CROSS_TENANT_ROLES = {superadmin, support_admin}` bypass this.
7. **Billing traceability is read from D1**, not an API endpoint (no endpoint exposes raw `billable_line_items`). Use `wrangler d1 execute atheon-db --remote --json --command "<SELECT>"` from `workers/api/`, parse the JSON, assert per-row invariants.
8. **The go-live gate uses a staging-promote model** to resolve the deploy/verify chicken-and-egg: push-to-main deploys to **staging**, the gate runs the full verification suite against staging, and **production promotion is gated on a green gate**. This is the concrete realization of the spec's "a deploy that refuses to proceed on red E2E." The riskiest CI change (re-pointing production deploy to `needs: go-live-gate`) is isolated in the final task for explicit review.
9. **`tsx` is not installed** anywhere; it is added to root `devDependencies`. The integration matrices run under vitest; the load gate and DR drill run as `tsx`/wrangler scripts.

---

## File Structure

**New files**

- `verification/config.ts` — env loader; exports a frozen `CONFIG` object and a `requireEnv()` helper.
- `verification/lib/client.ts` — `ApiClient` class: `login()`, `authedFetch()`, `reseed()`, `listClusters()`, `resolveCluster(subName)`, `executeSubCatalyst(subName)`, `getRunItemTotals(runId)`, `getAssessment(id)`, `getBusinessReport(id)`.
- `verification/lib/d1.ts` — `queryD1<T>(sql): Promise<T[]>` via `wrangler d1 execute --remote --json`.
- `verification/accuracy/reconciliation.test.ts` — Component 2: per-catalyst count assertions vs `VANTAX_ORACLE`.
- `verification/accuracy/traceability-invariant.test.ts` — Component 2: exhaustive `billable_line_items` per-row invariant + period reconciliation.
- `verification/accuracy/report.test.ts` — Component 2: `business_report_key` populated + `/report/business` serves `%PDF`.
- `verification/accuracy/negative-control.test.ts` — Component 2: proves the harness fails when ground truth is perturbed.
- `verification/isolation/cross-tenant.test.ts` — Component 4.
- `verification/rbac/roles.test.ts` — Component 5.
- `verification/load/load-gate.ts` — Component 6: invokes the load test and asserts strict thresholds.
- `verification/dr/restore-drill.ts` — Component 7: export remote D1 → import into local D1 → assert counts.
- `vitest.verification.config.ts` (repo root) — node-env vitest project scoped to `verification/**/*.test.ts`.
- `.github/workflows/go-live-gate.yml` — composes all suites into the deploy-blocking gate.
- `docs/runbooks/go-live.md` — human runbook.

**Modified files**

- `workers/api/src/services/vantax-demo.ts` — add `VANTAX_ORACLE` + `formatDataQuality()`.
- `workers/api/src/routes/seed-vantax.ts:3378-3389` — derive `dataQuality` from `formatDataQuality(VANTAX_ORACLE)`.
- `workers/api/src/__tests__/vantax-oracle.test.ts` (new test) — Component 1 invariance unit test.
- `e2e/tests/traceability.spec.ts` — re-point at `vantax` (env creds), remove `if (isVisible())` no-op guards.
- `e2e/tests/admin-tenant-llm-budget.spec.ts` (and any other red specs) — selector-drift repair.
- `e2e/load-test.ts` — accept threshold env vars; keep default behavior.
- `package.json` (root) — add `tsx` devDep + `verify:*` scripts.
- `.github/workflows/deploy-api.yml`, `.github/workflows/deploy-frontend.yml` — gate production promotion on `go-live-gate`.

---

## Task 0: Bootstrap the verification harness scaffold

**Files:**
- Create: `verification/config.ts`
- Create: `vitest.verification.config.ts`
- Create: `verification/_smoke.test.ts` (temporary, deleted in last step)
- Modify: `package.json` (root)

- [ ] **Step 1: Add tsx + verify scripts to root package.json**

In `package.json`, add to `"scripts"` (after `"size:check"`):

```json
    "size:check": "node scripts/check-bundle-size.mjs",
    "verify:accuracy": "vitest run --config vitest.verification.config.ts verification/accuracy",
    "verify:isolation": "vitest run --config vitest.verification.config.ts verification/isolation",
    "verify:rbac": "vitest run --config vitest.verification.config.ts verification/rbac",
    "verify:matrices": "vitest run --config vitest.verification.config.ts",
    "verify:load": "tsx verification/load/load-gate.ts",
    "verify:dr": "tsx verification/dr/restore-drill.ts"
```

Add to `"devDependencies"` (keep alphabetical near `typescript`):

```json
    "tsx": "^4.19.2",
```

- [ ] **Step 2: Install tsx**

Run: `npm install`
Expected: lockfile updates, `tsx` resolves; `npx tsx --version` prints a version (no download prompt).

- [ ] **Step 3: Write the verification vitest config**

Create `vitest.verification.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

// Integration suites that hit the DEPLOYED API + remote D1. Node environment
// (real fetch, child_process), serial, generous timeouts because reseed is slow.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['verification/**/*.test.ts'],
    // Reseed is destructive against the shared vantax tenant — never parallelise
    // files that reseed. One worker, serial files.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 0,
  },
});
```

- [ ] **Step 4: Write the config loader**

Create `verification/config.ts`:

```ts
/**
 * Env-driven config for the deployed-API verification suites.
 * Credentials are NEVER hardcoded — the seeded vantax users are provisioned
 * out-of-band, so real creds come from CI secrets / the runbook operator.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(
      `Missing required env var ${name}. Set it before running the verification suite ` +
      `(see docs/runbooks/go-live.md).`,
    );
  }
  return v.trim();
}

function optionalEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : fallback;
}

export const CONFIG = {
  apiUrl: optionalEnv('VERIFY_API_URL', 'https://atheon-api.vantax.co.za'),
  appUrl: optionalEnv('VERIFY_APP_URL', 'https://atheon.vantax.co.za'),
  tenantSlug: optionalEnv('VERIFY_TENANT_SLUG', 'vantax'),
  get adminEmail() { return requireEnv('VERIFY_ADMIN_EMAIL'); },
  get adminPassword() { return requireEnv('VERIFY_ADMIN_PASSWORD'); },
  // Optional — only needed by the second-tenant isolation enhancement.
  superadminEmail: process.env.VERIFY_SUPERADMIN_EMAIL?.trim() || '',
  superadminPassword: process.env.VERIFY_SUPERADMIN_PASSWORD?.trim() || '',
  d1DatabaseName: optionalEnv('VERIFY_D1_DB', 'atheon-db'),
} as const;
```

- [ ] **Step 5: Write a smoke test to prove the config + runner wire up**

Create `verification/_smoke.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CONFIG } from './config';

describe('verification harness bootstrap', () => {
  it('exposes a default API url', () => {
    expect(CONFIG.apiUrl).toMatch(/^https?:\/\//);
  });
  it('throws a clear error for a missing required credential', () => {
    const saved = process.env.VERIFY_ADMIN_EMAIL;
    delete process.env.VERIFY_ADMIN_EMAIL;
    expect(() => CONFIG.adminEmail).toThrow(/VERIFY_ADMIN_EMAIL/);
    if (saved) process.env.VERIFY_ADMIN_EMAIL = saved;
  });
});
```

- [ ] **Step 6: Run the smoke test**

Run: `npm run verify:matrices`
Expected: PASS (2 tests). This proves the node-env vitest project and config loader work end-to-end without needing network.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json vitest.verification.config.ts verification/config.ts verification/_smoke.test.ts
git commit -m "$(cat <<'EOF'
chore(verify): scaffold deployed-API verification harness (config + vitest project)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 1: Component 1 — Canonical oracle (single source of truth)

**Files:**
- Modify: `workers/api/src/services/vantax-demo.ts`
- Modify: `workers/api/src/routes/seed-vantax.ts:3378-3389`
- Test: `workers/api/src/__tests__/vantax-oracle.test.ts`

**Note on the one intended display change:** today's hardcoded inventory string shows `55.6%`. The derivation `(10/18)*100` rounds (2 dp, trailing-zeros stripped) to `55.56%`. The reconciliation *counts* (10/18/4/4 etc.) are unchanged; only this single display percentage moves `55.6% → 55.56%`. All other percentages reproduce byte-for-byte. The unit test pins both the counts (to `VANTAX_ORACLE`) and the derived strings.

- [ ] **Step 1: Write the failing unit test**

Create `workers/api/src/__tests__/vantax-oracle.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { VANTAX_ORACLE, formatDataQuality } from '../services/vantax-demo';

describe('VANTAX_ORACLE — canonical reconciliation ground truth', () => {
  it('encodes the known-good seeded counts', () => {
    expect(VANTAX_ORACLE.grir).toEqual({ total: 80, matched: 65, priceVariances: 7, unmatched: 8 });
    expect(VANTAX_ORACLE.bank).toEqual({ total: 80, reconciled: 55, fees: 10, unmatchedEft: 15 });
    expect(VANTAX_ORACLE.inventory).toEqual({ total: 18, matched: 10, shortage: 4, surplus: 4 });
    expect(VANTAX_ORACLE.salesOrder).toEqual({ total: 80, matched: 55, amountVariances: 10, statusMismatch: 7, unmatched: 8 });
  });

  it('every catalyst category sums to its total', () => {
    const g = VANTAX_ORACLE.grir;
    expect(g.matched + g.priceVariances + g.unmatched).toBe(g.total);
    const s = VANTAX_ORACLE.salesOrder;
    expect(s.matched + s.amountVariances + s.statusMismatch + s.unmatched).toBe(s.total);
  });

  it('derives the seed dataQuality summary from the oracle', () => {
    const dq = formatDataQuality(VANTAX_ORACLE);
    expect(dq.grir).toBe('65 of 80 POs match invoices exactly (81.25%), 7 price variances (8.75%), 8 unmatched (10%)');
    expect(dq.bank).toBe('55 of 80 bank transactions reconciled (68.75%), 10 bank fees, 15 unmatched EFTs');
    expect(dq.inventory).toBe('10 of 18 products match exactly (55.56%), 4 shortage (shrinkage), 4 surplus (receiving errors)');
    expect(dq.salesOrder).toBe('55 of 80 SD invoices match AR postings exactly (68.75%), 10 amount variances, 7 status mismatches, 8 unmatched');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd workers/api && npx vitest run src/__tests__/vantax-oracle.test.ts`
Expected: FAIL — `VANTAX_ORACLE`/`formatDataQuality` are not exported from `vantax-demo`.

- [ ] **Step 3: Add the oracle + formatter to vantax-demo.ts**

In `workers/api/src/services/vantax-demo.ts`, insert immediately after the imports (after `import { computeBillablePeriod } from './billing-engine';`):

```ts
/**
 * VANTAX_ORACLE — the single source of truth for the seeded vantax tenant's
 * known-good reconciliation outcomes. The seeder GENERATES data to these shapes
 * and the seed summary DERIVES its dataQuality strings from them; the accuracy
 * harness asserts the live run's item counts against this same constant. One
 * source — generation, summary, and verification cannot drift apart.
 */
export const VANTAX_ORACLE = {
  grir:       { total: 80, matched: 65, priceVariances: 7,  unmatched: 8 },
  bank:       { total: 80, reconciled: 55, fees: 10, unmatchedEft: 15 },
  inventory:  { total: 18, matched: 10, shortage: 4, surplus: 4 },
  salesOrder: { total: 80, matched: 55, amountVariances: 10, statusMismatch: 7, unmatched: 8 },
} as const;

export type VantaxOracle = typeof VANTAX_ORACLE;

/** Percentage of `n` out of `total`, to 2 dp with trailing zeros stripped ("10", "81.25"). */
function pct(n: number, total: number): string {
  return Number(((n / total) * 100).toFixed(2)).toString();
}

/**
 * Render the human-readable dataQuality summary block from the oracle. Used by
 * the seeder so the summary can never disagree with the generated data.
 */
export function formatDataQuality(o: VantaxOracle): {
  grir: string; bank: string; inventory: string; salesOrder: string;
} {
  return {
    grir: `${o.grir.matched} of ${o.grir.total} POs match invoices exactly (${pct(o.grir.matched, o.grir.total)}%), `
      + `${o.grir.priceVariances} price variances (${pct(o.grir.priceVariances, o.grir.total)}%), `
      + `${o.grir.unmatched} unmatched (${pct(o.grir.unmatched, o.grir.total)}%)`,
    bank: `${o.bank.reconciled} of ${o.bank.total} bank transactions reconciled (${pct(o.bank.reconciled, o.bank.total)}%), `
      + `${o.bank.fees} bank fees, ${o.bank.unmatchedEft} unmatched EFTs`,
    inventory: `${o.inventory.matched} of ${o.inventory.total} products match exactly (${pct(o.inventory.matched, o.inventory.total)}%), `
      + `${o.inventory.shortage} shortage (shrinkage), ${o.inventory.surplus} surplus (receiving errors)`,
    salesOrder: `${o.salesOrder.matched} of ${o.salesOrder.total} SD invoices match AR postings exactly (${pct(o.salesOrder.matched, o.salesOrder.total)}%), `
      + `${o.salesOrder.amountVariances} amount variances, ${o.salesOrder.statusMismatch} status mismatches, ${o.salesOrder.unmatched} unmatched`,
  };
}
```

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `cd workers/api && npx vitest run src/__tests__/vantax-oracle.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Wire the seeder's dataQuality block to the formatter**

In `workers/api/src/routes/seed-vantax.ts`, add to the existing import of `vantax-demo` (find the line importing from `'../services/vantax-demo'`; if absent, add a new import near the other service imports):

```ts
import { VANTAX_ORACLE, formatDataQuality } from '../services/vantax-demo';
```

Then replace the hardcoded block at lines 3378-3383:

```ts
        dataQuality: {
          grir: '65 of 80 POs match invoices exactly (81.25%), 7 price variances (8.75%), 8 unmatched (10%)',
          bank: '55 of 80 bank transactions reconciled (68.75%), 10 bank fees, 15 unmatched EFTs',
          inventory: '10 of 18 products match exactly (55.6%), 4 shortage (shrinkage), 4 surplus (receiving errors)',
          salesOrder: '55 of 80 SD invoices match AR postings exactly (68.75%), 10 amount variances, 7 status mismatches, 8 unmatched',
        },
```

with:

```ts
        dataQuality: formatDataQuality(VANTAX_ORACLE),
```

- [ ] **Step 6: Verify the seeder still typechecks and the whole backend suite passes**

Run: `cd workers/api && npx tsc --noEmit && npx vitest run`
Expected: typecheck clean; all backend tests pass (including the new `vantax-oracle.test.ts`).

- [ ] **Step 7: Commit**

```bash
git add workers/api/src/services/vantax-demo.ts workers/api/src/routes/seed-vantax.ts workers/api/src/__tests__/vantax-oracle.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): extract VANTAX_ORACLE as canonical reconciliation ground truth

Seed dataQuality summary now derives from the oracle (single source); the
accuracy harness asserts against the same constant. Inventory display pct
moves 55.6% -> 55.56% (counts unchanged).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: Component 2 — Accuracy & traceability harness

### Task 2a: API client library

**Files:**
- Create: `verification/lib/client.ts`
- Test: `verification/accuracy/_connectivity.test.ts` (temporary — delete in Task 2f Step)

- [ ] **Step 1: Write the failing connectivity test**

Create `verification/accuracy/_connectivity.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

describe('deployed API connectivity', () => {
  const client = new ApiClient();

  beforeAll(async () => {
    await client.login();
  });

  it('logs in and obtains a token scoped to the configured tenant', () => {
    expect(client.token).toBeTruthy();
    expect(client.user?.tenantSlug).toBe('vantax');
  });

  it('lists catalyst clusters for the tenant', async () => {
    const clusters = await client.listClusters();
    expect(clusters.length).toBeGreaterThan(0);
    expect(clusters.some(c => (c.subCatalysts ?? []).length > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... npm run verify:accuracy`
Expected: FAIL — `../lib/client` does not exist.

- [ ] **Step 3: Implement the client**

Create `verification/lib/client.ts`:

```ts
import { CONFIG } from '../config';

export interface AuthedUser {
  id: string;
  email: string;
  role: string;
  tenantId: string;
  tenantSlug: string;
}

export interface Cluster {
  id: string;
  name: string;
  domain?: string;
  subCatalysts?: Array<{ name: string; enabled?: boolean }>;
}

export interface RunItemTotals {
  items_total: number;
  matched: number;
  discrepancies: number;
  unmatched: number;
  exceptions: number;
  total_source_value?: number;
  total_matched_value?: number;
}

/** Thin client over the deployed Atheon API for verification suites. */
export class ApiClient {
  token: string | null = null;
  user: AuthedUser | null = null;

  constructor(
    private readonly email = CONFIG.adminEmail,
    private readonly password = CONFIG.adminPassword,
    private readonly baseUrl = CONFIG.apiUrl,
  ) {}

  async login(): Promise<void> {
    const resp = await fetch(`${this.baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: this.email, password: this.password, tenant_slug: CONFIG.tenantSlug }),
    });
    if (!resp.ok) {
      throw new Error(`Login failed (${resp.status}) for ${this.email}: ${await resp.text()}`);
    }
    const data = await resp.json() as { token?: string; user?: AuthedUser };
    if (!data.token) throw new Error(`Login returned no token (MFA may be enforced for ${this.email})`);
    this.token = data.token;
    this.user = data.user ?? null;
  }

  async authedFetch(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.token) throw new Error('authedFetch called before login()');
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${this.token}`);
    return fetch(`${this.baseUrl}${path}`, { ...init, headers });
  }

  async reseed(): Promise<unknown> {
    // Doubled prefix: router mounts /api/v1/seed-vantax, handler path is /seed-vantax.
    const resp = await this.authedFetch('/api/v1/seed-vantax/seed-vantax', { method: 'POST' });
    if (!resp.ok) {
      throw new Error(`Reseed failed (${resp.status}): ${await resp.text()}`);
    }
    return resp.json();
  }

  async listClusters(): Promise<Cluster[]> {
    const resp = await this.authedFetch('/api/v1/catalysts/clusters');
    if (!resp.ok) throw new Error(`listClusters failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { clusters?: Cluster[] } | Cluster[];
    return Array.isArray(data) ? data : (data.clusters ?? []);
  }

  /** Find the cluster that owns a sub-catalyst by its display name. */
  async resolveCluster(subName: string): Promise<Cluster> {
    const clusters = await this.listClusters();
    const match = clusters.find(c => (c.subCatalysts ?? []).some(s => s.name === subName));
    if (!match) {
      const names = clusters.flatMap(c => (c.subCatalysts ?? []).map(s => s.name));
      throw new Error(`No cluster owns sub-catalyst "${subName}". Available: ${names.join(', ')}`);
    }
    return match;
  }

  /** Execute a reconciliation sub-catalyst by display name; returns its run id. */
  async executeSubCatalyst(subName: string): Promise<{ runId: string; status: string }> {
    const cluster = await this.resolveCluster(subName);
    const enc = encodeURIComponent(subName);
    const resp = await this.authedFetch(
      `/api/v1/catalysts/clusters/${cluster.id}/sub-catalysts/${enc}/execute`,
      { method: 'POST' },
    );
    if (!resp.ok) throw new Error(`execute "${subName}" failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { run_id?: string; id?: string; status?: string };
    const runId = data.run_id ?? data.id;
    if (!runId) throw new Error(`execute "${subName}" returned no run id: ${JSON.stringify(data)}`);
    return { runId, status: data.status ?? 'unknown' };
  }

  async getRunItemTotals(runId: string): Promise<RunItemTotals> {
    const resp = await this.authedFetch(`/api/v1/catalysts/runs/${runId}/items?limit=1`);
    if (!resp.ok) throw new Error(`getRunItems failed (${resp.status}): ${await resp.text()}`);
    const data = await resp.json() as { totals?: RunItemTotals };
    if (!data.totals) throw new Error(`run ${runId} returned no totals`);
    return data.totals;
  }

  async getAssessment(id: string): Promise<{ businessReportKey: string | null }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}`);
    if (!resp.ok) throw new Error(`getAssessment(${id}) failed (${resp.status}): ${await resp.text()}`);
    return resp.json() as Promise<{ businessReportKey: string | null }>;
  }

  async getBusinessReport(id: string): Promise<{ status: number; contentType: string; head: string }> {
    const resp = await this.authedFetch(`/api/v1/assessments/${id}/report/business`);
    const buf = resp.ok ? Buffer.from(await resp.arrayBuffer()) : Buffer.alloc(0);
    return {
      status: resp.status,
      contentType: resp.headers.get('content-type') ?? '',
      head: buf.subarray(0, 5).toString('latin1'),
    };
  }
}

/** Reconciliation sub-catalyst display names (must match seeded `name` fields). */
export const RECON_SUBCATALYSTS = {
  grir: 'GR/IR Reconciliation',
  bank: 'Bank Reconciliation',
  inventory: 'Inventory Reconciliation',
  salesOrder: 'Sales Order Matching',
} as const;
```

- [ ] **Step 4: Run the connectivity test against the deployed API**

Run: `VERIFY_ADMIN_EMAIL=<seeded-admin> VERIFY_ADMIN_PASSWORD=<pw> npm run verify:accuracy`
Expected: PASS (2 tests). If login 401s, the credentials are wrong — fix the env values, do not weaken the test. If `subCatalysts` is empty, reseed first (next task handles seeding).

- [ ] **Step 5: Commit**

```bash
git add verification/lib/client.ts verification/accuracy/_connectivity.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): deployed-API client (login, reseed, cluster/run resolution)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2b: D1 remote query helper

**Files:**
- Create: `verification/lib/d1.ts`
- Test: `verification/accuracy/_d1.test.ts` (temporary — delete in Task 2f Step)

- [ ] **Step 1: Write the failing test**

Create `verification/accuracy/_d1.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { queryD1 } from '../lib/d1';

describe('remote D1 query helper', () => {
  it('reads a scalar from the deployed DB', async () => {
    const rows = await queryD1<{ n: number }>('SELECT COUNT(*) AS n FROM tenants');
    expect(rows.length).toBe(1);
    expect(rows[0].n).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run verify:accuracy -- verification/accuracy/_d1.test.ts`
Expected: FAIL — `../lib/d1` does not exist.

- [ ] **Step 3: Implement the helper**

Create `verification/lib/d1.ts`:

```ts
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';

const execFileAsync = promisify(execFile);

/**
 * Run a read-only SQL statement against the REMOTE D1 via wrangler and return
 * the result rows. Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID in env
 * and is invoked from workers/api (where wrangler.toml binds atheon-db).
 */
export async function queryD1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    throw new Error('queryD1 requires CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in env');
  }
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', CONFIG.d1DatabaseName, '--remote', '--json', '--command', sql],
    { cwd: 'workers/api', maxBuffer: 64 * 1024 * 1024, env: process.env },
  );
  // wrangler --json prints `[{ results: [...], success: true, meta: {...} }]`.
  const parsed = JSON.parse(stdout) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run verify:accuracy -- verification/accuracy/_d1.test.ts`
Expected: PASS (1 test). If wrangler errors with auth, the token/account env vars are wrong.

- [ ] **Step 5: Commit**

```bash
git add verification/lib/d1.ts verification/accuracy/_d1.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): remote D1 query helper via wrangler --json

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2c: Reconciliation count assertions

**Files:**
- Create: `verification/accuracy/reconciliation.test.ts`

- [ ] **Step 1: Write the test**

Create `verification/accuracy/reconciliation.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient, RECON_SUBCATALYSTS } from '../lib/client';
import { VANTAX_ORACLE } from '../../workers/api/src/services/vantax-demo';

// Reseed once, execute each reconciliation sub-catalyst, assert item-count
// breakdown equals the canonical oracle. Serial by config (destructive reseed).
describe('reconciliation accuracy vs VANTAX_ORACLE', () => {
  const client = new ApiClient();

  beforeAll(async () => {
    await client.login();
    await client.reseed();
  }, 180_000);

  it('GR/IR: matched + price-variance + unmatched counts match the oracle', async () => {
    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.grir);
    const t = await client.getRunItemTotals(runId);
    expect(t.matched).toBe(VANTAX_ORACLE.grir.matched);
    expect(t.discrepancies).toBe(VANTAX_ORACLE.grir.priceVariances);
    expect(t.unmatched).toBe(VANTAX_ORACLE.grir.unmatched);
    expect(t.items_total).toBe(VANTAX_ORACLE.grir.total);
  });

  it('Bank: reconciled + fees + unmatched-EFT counts match the oracle', async () => {
    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.bank);
    const t = await client.getRunItemTotals(runId);
    expect(t.matched).toBe(VANTAX_ORACLE.bank.reconciled);
    // fees surface as exceptions; unmatched EFTs as unmatched items.
    expect(t.exceptions).toBe(VANTAX_ORACLE.bank.fees);
    expect(t.unmatched).toBe(VANTAX_ORACLE.bank.unmatchedEft);
    expect(t.items_total).toBe(VANTAX_ORACLE.bank.total);
  });

  it('Inventory: matched + shortage + surplus counts match the oracle', async () => {
    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.inventory);
    const t = await client.getRunItemTotals(runId);
    expect(t.matched).toBe(VANTAX_ORACLE.inventory.matched);
    expect(t.discrepancies).toBe(VANTAX_ORACLE.inventory.shortage + VANTAX_ORACLE.inventory.surplus);
    expect(t.items_total).toBe(VANTAX_ORACLE.inventory.total);
  });

  it('Sales Order: matched + variance + status-mismatch + unmatched counts match the oracle', async () => {
    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.salesOrder);
    const t = await client.getRunItemTotals(runId);
    const o = VANTAX_ORACLE.salesOrder;
    expect(t.matched).toBe(o.matched);
    expect(t.discrepancies).toBe(o.amountVariances + o.statusMismatch);
    expect(t.unmatched).toBe(o.unmatched);
    expect(t.items_total).toBe(o.total);
  });
});
```

- [ ] **Step 2: Run against the deployed API and reconcile reality with the oracle**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... npm run verify:accuracy -- verification/accuracy/reconciliation.test.ts`
Expected: PASS (4 tests).

**Critical triage rule:** if a count is off, do NOT loosen the assertion. The mapping of seeded categories to the `totals` fields (e.g. whether bank *fees* land in `exceptions` vs `discrepancies`, whether *status mismatches* land in `discrepancies`) reflects how the catalyst engine classifies items. Inspect one failing run's items (`GET /api/v1/catalysts/runs/:runId/items?limit=80`) to see the actual `item_status`/`exception_type` distribution, then correct the assertion's field mapping to match the engine's real classification — this is the harness learning the true contract, not weakening it. If counts genuinely disagree with `VANTAX_ORACLE`, that is a real accuracy bug to escalate.

- [ ] **Step 3: Commit**

```bash
git add verification/accuracy/reconciliation.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): reconciliation accuracy harness asserts live counts vs oracle

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2d: Exhaustive billing traceability invariant

**Files:**
- Create: `verification/accuracy/traceability-invariant.test.ts`

- [ ] **Step 1: Write the test**

Create `verification/accuracy/traceability-invariant.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';
import { queryD1 } from '../lib/d1';

interface LineItem {
  id: string;
  period_id: string;
  tenant_id: string;
  rca_id: string | null;
  attributed_savings: number | null;
  confidence: number | null;
  evidence: string | null;
}
interface Period { id: string; total_realised_savings: number | null; }

// Every claimed Rand must trace to an ERP record + mapping + confidence.
describe('billable_line_items traceability invariant (exhaustive)', () => {
  const client = new ApiClient();
  let tenantId = '';
  let items: LineItem[] = [];
  let periods: Period[] = [];

  beforeAll(async () => {
    await client.login();
    await client.reseed();
    tenantId = client.user!.tenantId;
    items = await queryD1<LineItem>(
      `SELECT id, period_id, tenant_id, rca_id, attributed_savings, confidence, evidence
         FROM billable_line_items WHERE tenant_id = '${tenantId}'`,
    );
    periods = await queryD1<Period>(
      `SELECT id, total_realised_savings FROM billable_periods WHERE tenant_id = '${tenantId}'`,
    );
  }, 180_000);

  it('produced at least one billable line item', () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it('every line item carries savings >= 0, confidence, evidence and a resolvable rca_id', async () => {
    const offenders: string[] = [];
    for (const li of items) {
      if (li.attributed_savings === null || li.attributed_savings < 0) offenders.push(`${li.id}: savings=${li.attributed_savings}`);
      if (li.confidence === null) offenders.push(`${li.id}: null confidence`);
      if (!li.evidence || li.evidence.trim() === '') offenders.push(`${li.id}: empty evidence`);
      if (!li.rca_id) offenders.push(`${li.id}: null rca_id`);
    }
    expect(offenders, offenders.join('\n')).toHaveLength(0);

    // rca_id must resolve to a real RCA row for this tenant.
    const rcaIds = [...new Set(items.map(i => i.rca_id).filter(Boolean))] as string[];
    const inList = rcaIds.map(id => `'${id}'`).join(',');
    const found = await queryD1<{ id: string }>(
      `SELECT id FROM root_cause_analyses WHERE tenant_id = '${tenantId}' AND id IN (${inList})`,
    );
    expect(found.length).toBe(rcaIds.length);
  });

  it('SUM(attributed_savings) reconciles to billable_periods.total_realised_savings', () => {
    for (const p of periods) {
      const sum = items
        .filter(i => i.period_id === p.id)
        .reduce((acc, i) => acc + (i.attributed_savings ?? 0), 0);
      const recorded = p.total_realised_savings ?? 0;
      // Rounding tolerance: 1 currency unit.
      expect(Math.abs(sum - recorded)).toBeLessThanOrEqual(1);
    }
  });
});
```

- [ ] **Step 2: Run it**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run verify:accuracy -- verification/accuracy/traceability-invariant.test.ts`
Expected: PASS (3 tests). A failure here is a genuine billing-traceability defect — escalate, do not relax the invariant.

- [ ] **Step 3: Commit**

```bash
git add verification/accuracy/traceability-invariant.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): exhaustive billable_line_items traceability invariant

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2e: Report availability check

**Files:**
- Create: `verification/accuracy/report.test.ts`

- [ ] **Step 1: Write the test**

Create `verification/accuracy/report.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';

const ASSESSMENT_ID = 'va-demo-vantax';

describe('value-assessment report availability', () => {
  const client = new ApiClient();

  beforeAll(async () => {
    await client.login();
    await client.reseed();
  }, 180_000);

  it('business_report_key is populated after seed', async () => {
    const a = await client.getAssessment(ASSESSMENT_ID);
    expect(a.businessReportKey).toBeTruthy();
  });

  it('GET /report/business serves a PDF (HTTP 200, %PDF body)', async () => {
    const r = await client.getBusinessReport(ASSESSMENT_ID);
    expect(r.status).toBe(200);
    expect(r.head).toBe('%PDF');
    expect(r.contentType).toContain('application/pdf');
  });
});
```

- [ ] **Step 2: Run it**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... npm run verify:accuracy -- verification/accuracy/report.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add verification/accuracy/report.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): automate report availability check (business_report_key + %PDF)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 2f: Negative control (prove the harness can fail) + cleanup temp tests

**Files:**
- Create: `verification/accuracy/negative-control.test.ts`
- Delete: `verification/accuracy/_connectivity.test.ts`, `verification/accuracy/_d1.test.ts`, `verification/_smoke.test.ts`

- [ ] **Step 1: Write the negative-control test**

Create `verification/accuracy/negative-control.test.ts`. This perturbs one seeded record, asserts the live count now *diverges* from the oracle, then restores via reseed — proving the accuracy harness is not a no-op:

```ts
import { describe, it, expect, afterAll } from 'vitest';
import { ApiClient, RECON_SUBCATALYSTS } from '../lib/client';
import { queryD1 } from '../lib/d1';
import { VANTAX_ORACLE } from '../../workers/api/src/services/vantax-demo';

// Self-test: deliberately break ground truth and confirm the harness notices.
describe('negative control — the accuracy harness can fail', () => {
  const client = new ApiClient();

  afterAll(async () => {
    // Always restore the tenant to a clean, correct state for downstream runs.
    if (client.token) await client.reseed();
  }, 180_000);

  it('detects a perturbed inventory record (count diverges from oracle)', async () => {
    await client.login();
    await client.reseed();
    const tenantId = client.user!.tenantId;

    // Flip one matched physical-count row into a shortage by halving its quantity.
    await queryD1(
      `UPDATE erp_products SET physical_stock = CAST(physical_stock / 2 AS INTEGER)
         WHERE tenant_id = '${tenantId}'
           AND id = (SELECT id FROM erp_products WHERE tenant_id = '${tenantId}'
                     AND source_system = 'PHYSICAL_COUNT' ORDER BY external_id LIMIT 1)`,
    );

    const { runId } = await client.executeSubCatalyst(RECON_SUBCATALYSTS.inventory);
    const t = await client.getRunItemTotals(runId);
    expect(t.matched).not.toBe(VANTAX_ORACLE.inventory.matched);
  });
});
```

> If `erp_products` lacks a `physical_stock`/`source_system` column on the deployed schema, adjust the `UPDATE` to perturb whichever column the inventory catalyst reads (confirm via `PRAGMA table_info(erp_products)` through `queryD1`). The invariant being proven — "perturb truth → harness diverges" — must hold regardless of which column is poked.

- [ ] **Step 2: Run it**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run verify:accuracy -- verification/accuracy/negative-control.test.ts`
Expected: PASS (1 test) — the perturbation is detected; `afterAll` reseeds back to clean.

- [ ] **Step 3: Delete the temporary scaffolding tests**

Run: `git rm verification/accuracy/_connectivity.test.ts verification/accuracy/_d1.test.ts verification/_smoke.test.ts`

- [ ] **Step 4: Run the full accuracy suite**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run verify:accuracy`
Expected: PASS — reconciliation (4) + traceability (3) + report (2) + negative-control (1).

- [ ] **Step 5: Commit**

```bash
git add verification/accuracy/negative-control.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): negative-control proves accuracy harness fails on perturbed truth

Removes temporary connectivity/D1/smoke scaffolding tests.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Component 3 — E2E repair + traceability hardening

### Task 3a: Triage and repair red E2E specs

**Files:**
- Modify: `e2e/tests/admin-tenant-llm-budget.spec.ts` (and any other failing spec found)

- [ ] **Step 1: Run the E2E suite against production to capture current failures**

Run:
```bash
cd e2e && npm ci && npx playwright install --with-deps chromium \
  && E2E_BASE_URL=https://atheon.vantax.co.za \
     E2E_LOGIN_EMAIL=<vantax-user> E2E_LOGIN_PASSWORD=<pw> \
     npx playwright test --project=chromium-desktop --reporter=list
```
Expected: a list of pass/fail per spec. Record every failure.

- [ ] **Step 2: Triage each failure into "selector drift" vs "real regression"**

For each failing assertion, open the spec and the corresponding page component. If the page renders the feature but the locator no longer matches (e.g. the Quiet Capital overhaul renamed a heading), it is selector drift → fix the locator. If the feature is gone/broken, it is a regression → file it (do not paper over it).

- [ ] **Step 3: Fix the known llm-budget selector drift**

`e2e/tests/admin-tenant-llm-budget.spec.ts:28` asserts `getByRole('heading', { name: /llm budget/i })`. Open the LLM-budget admin page component, find the current heading text, and update the locator to match it. Example shape of the fix (confirm the real text first):

```ts
// before
await expect(page.getByRole('heading', { name: /llm budget/i })).toBeVisible();
// after — match the heading the Quiet Capital page actually renders
await expect(page.getByRole('heading', { name: /<actual heading text>/i })).toBeVisible();
```

- [ ] **Step 4: Re-run until the suite is green (or only genuine regressions remain)**

Run: `cd e2e && E2E_BASE_URL=https://atheon.vantax.co.za E2E_LOGIN_EMAIL=... E2E_LOGIN_PASSWORD=... npx playwright test --project=chromium-desktop --reporter=list`
Expected: all selector-drift failures resolved. Any remaining red is a filed regression with an issue reference.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/admin-tenant-llm-budget.spec.ts
git commit -m "$(cat <<'EOF'
fix(e2e): repair selector drift from Quiet Capital UI overhaul

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

### Task 3b: Harden traceability.spec.ts

**Files:**
- Modify: `e2e/tests/traceability.spec.ts`

- [ ] **Step 1: Re-point at the seeded tenant and make drill-downs unconditional**

Rewrite `e2e/tests/traceability.spec.ts` so it (a) logs in with the env-provided vantax credentials instead of the hardcoded `admin@example.com`/`password123`, and (b) removes every `if (await ...isVisible())` guard so the drill-down assertions actually run. Because the `vantax` tenant is always seeded with Apex dimensions, Pulse metrics, and catalyst runs, the elements are guaranteed present — a missing element is now a real failure. Replace the file contents with:

```ts
import { test, expect } from '@playwright/test';

const EMAIL = process.env.E2E_LOGIN_EMAIL || 'admin@vantax.co.za';
const PASSWORD = process.env.E2E_LOGIN_PASSWORD || '';

test.describe('Traceability Chain (seeded vantax tenant)', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('[data-testid="email"]', EMAIL);
    await page.fill('[data-testid="password"]', PASSWORD);
    await page.click('[data-testid="login-button"]');
    await page.waitForURL(/\/dashboard/);
  });

  test('Apex health dashboard shows all dimensions', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 15000 });
    for (const d of ['Financial', 'Operational', 'Compliance', 'Strategic', 'Technology']) {
      await expect(page.locator(`text=${d}`).first()).toBeVisible();
    }
  });

  test('drill down from Apex dimension into the traceability modal', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="dimension-operational"]').click();
    await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
    await expect(page.locator('text=Source Attribution')).toBeVisible();
    await expect(page.locator('text=Drill-down Path')).toBeVisible();
    await page.click('[data-testid="close-modal"]');
    await expect(page.locator('[data-testid="traceability-modal"]')).not.toBeVisible();
  });

  test('trace a risk alert to its source run', async ({ page }) => {
    await page.goto('/apex');
    await page.click('[data-testid="tab-risks"]');
    await expect(page.locator('[data-testid="risks-list"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="trace-risk"]').first().click();
    await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
    await expect(page.locator('text=Source Run')).toBeVisible();
    await expect(page.locator('text=Flagged Items')).toBeVisible();
    await expect(page.locator('text=View Run')).toBeVisible();
  });

  test('trace a Pulse metric to its source sub-catalyst run, then open the run', async ({ page }) => {
    await page.goto('/pulse');
    await expect(page.locator('[data-testid="metrics-list"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="trace-metric"]').first().click();
    await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
    await expect(page.locator('text=Source Attribution')).toBeVisible();
    await expect(page.locator('text=Contributing KPIs')).toBeVisible();
    await page.locator('[data-testid="view-run"]').click();
    await page.waitForURL(/\/catalysts\/runs\/.+/);
    await expect(page.locator('[data-testid="run-detail"]')).toBeVisible();
  });

  test('catalyst run detail shows KPIs and Items', async ({ page }) => {
    await page.goto('/catalysts');
    await expect(page.locator('[data-testid="runs-list"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="run-item"]').first().click();
    await page.waitForURL(/\/catalysts\/runs\/.+/);
    await expect(page.locator('[data-testid="run-detail"]')).toBeVisible();
    await expect(page.locator('text=KPIs')).toBeVisible();
    await expect(page.locator('text=Items')).toBeVisible();
  });

  test('traceability modal shows the complete drill-down path', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.locator('[data-testid="health-score"]')).toBeVisible({ timeout: 15000 });
    await page.locator('[data-testid="dimension-operational"]').click();
    await expect(page.locator('[data-testid="traceability-modal"]')).toBeVisible();
    for (const seg of ['dimension', 'clusters', 'runs', 'items']) {
      await expect(page.locator(`[data-testid="drill-path-${seg}"]`)).toBeVisible();
    }
  });
});
```

- [ ] **Step 2: Run the hardened spec**

Run: `cd e2e && E2E_BASE_URL=https://atheon.vantax.co.za E2E_LOGIN_EMAIL=... E2E_LOGIN_PASSWORD=... npx playwright test traceability.spec.ts --project=chromium-desktop --reporter=list`
Expected: PASS. If a `data-testid` no longer exists (Quiet Capital removed/renamed it), update the locator to the current attribute — do NOT restore the `isVisible()` guard.

- [ ] **Step 3: Commit**

```bash
git add e2e/tests/traceability.spec.ts
git commit -m "$(cat <<'EOF'
test(e2e): harden traceability spec — seeded vantax creds, unconditional drill-downs

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

> Deploy-gating wiring for E2E is implemented in **Task 9** (final CI composition), so the gate is wired once, after all suites exist.

---

## Task 4: Component 4 — Tenant isolation matrix

**Files:**
- Create: `verification/isolation/cross-tenant.test.ts`

**Approach:** the baseline (always runnable with just the vantax admin) proves isolation two ways for every protected prefix: (1) a cross-tenant `?tenant_id=<other>` override is rejected with 403; (2) a fabricated resource ID (a random UUID guaranteed not to belong to vantax) returns 404, never another tenant's row. An optional enhancement (when superadmin creds are provided) adds a real second tenant's resource IDs.

- [ ] **Step 1: Write the test**

Create `verification/isolation/cross-tenant.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';
import { randomUUID } from 'node:crypto';

// A representative GET endpoint per protected prefix that accepts a resource id
// and/or a tenant_id query param.
const PREFIX_PROBES: Array<{ prefix: string; idPath: (id: string) => string; listPath: string }> = [
  { prefix: 'apex',         idPath: id => `/api/v1/apex/risks/${id}`,           listPath: '/api/v1/apex/health' },
  { prefix: 'pulse',        idPath: id => `/api/v1/pulse/metrics/${id}`,        listPath: '/api/v1/pulse/metrics' },
  { prefix: 'catalysts',    idPath: id => `/api/v1/catalysts/clusters/${id}`,  listPath: '/api/v1/catalysts/clusters' },
  { prefix: 'assessments',  idPath: id => `/api/v1/assessments/${id}`,         listPath: '/api/v1/assessments' },
  { prefix: 'roi',          idPath: id => `/api/v1/roi/${id}`,                 listPath: '/api/v1/roi' },
  { prefix: 'billing',      idPath: id => `/api/v1/billing/periods/${id}`,     listPath: '/api/v1/billing/periods' },
  { prefix: 'audit',        idPath: id => `/api/v1/audit/log/${id}`,           listPath: '/api/v1/audit/log' },
];

describe('tenant isolation matrix', () => {
  const client = new ApiClient();
  const otherTenantId = randomUUID(); // guaranteed not vantax

  beforeAll(async () => { await client.login(); });

  it.each(PREFIX_PROBES)('[$prefix] rejects cross-tenant tenant_id override with 403', async ({ listPath }) => {
    const resp = await client.authedFetch(`${listPath}?tenant_id=${otherTenantId}`);
    expect(resp.status).toBe(403);
  });

  it.each(PREFIX_PROBES)('[$prefix] returns 404 (never another tenant row) for a foreign resource id', async ({ idPath }) => {
    const resp = await client.authedFetch(idPath(randomUUID()));
    // 404 = not found in MY tenant; 403 also acceptable (some routes guard first).
    expect([403, 404]).toContain(resp.status);
    expect(resp.status).not.toBe(200);
  });
});
```

- [ ] **Step 2: Run it**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... npm run verify:isolation`
Expected: PASS. If any probe path is wrong for a prefix (returns 404 for the *route* rather than the *resource*, or the endpoint shape differs), correct the probe to a real resource-scoped GET on that prefix. **Never** change an expectation to allow a 200 cross-tenant read — a 200 is a real isolation leak to escalate.

- [ ] **Step 3: Commit**

```bash
git add verification/isolation/cross-tenant.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): tenant isolation matrix — 403 on cross-tenant override, 404 on foreign id

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Component 5 — RBAC per-persona matrix

**Files:**
- Create: `verification/rbac/roles.test.ts`

**Approach:** as the vantax admin, mint a throwaway user per role via `POST /api/v1/iam/users` (admin level 100 can create board_member/manager/analyst/operator/auditor/viewer/executive). Log in as each and assert allow/deny against representative endpoints, including at least one expected-deny per persona so a permissive regression is caught.

- [ ] **Step 1: Write the test**

Create `verification/rbac/roles.test.ts`:

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { ApiClient } from '../lib/client';
import { CONFIG } from '../config';
import { randomUUID } from 'node:crypto';

// (method, path) probes. `min` = lowest role that should be ALLOWED.
const EXECUTE_PROBE = { method: 'POST', path: '/api/v1/catalysts/clusters/__none__/sub-catalysts/x/execute' };

const ROLES = ['executive', 'manager', 'analyst', 'operator', 'auditor', 'viewer'] as const;
type Role = typeof ROLES[number];

interface Persona { role: Role; client: ApiClient; }

async function mintUser(admin: ApiClient, role: Role): Promise<{ email: string; password: string }> {
  const email = `verify-${role}-${randomUUID().slice(0, 8)}@vantax.co.za`;
  const password = `Verify-${randomUUID().slice(0, 12)}!`;
  const resp = await admin.authedFetch('/api/v1/iam/users', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, name: `Verify ${role}`, role, password }),
  });
  if (!resp.ok) throw new Error(`mintUser(${role}) failed (${resp.status}): ${await resp.text()}`);
  return { email, password };
}

describe('RBAC per-persona matrix', () => {
  const admin = new ApiClient();
  const personas: Persona[] = [];

  beforeAll(async () => {
    await admin.login();
    for (const role of ROLES) {
      const { email, password } = await mintUser(admin, role);
      const c = new ApiClient(email, password);
      await c.login();
      personas.push({ role, client: c });
    }
  }, 120_000);

  it('every role can read a baseline tenant-scoped surface (apex health)', async () => {
    for (const p of personas) {
      const resp = await p.client.authedFetch('/api/v1/apex/health');
      expect(resp.status, `${p.role} should read apex/health`).toBe(200);
    }
  });

  it('catalyst execution is allowed for executive and denied (403) for everyone below', async () => {
    for (const p of personas) {
      const resp = await p.client.authedFetch(EXECUTE_PROBE.path, { method: 'POST' });
      if (p.role === 'executive') {
        // executive is allowed past the role gate; the bogus cluster yields 404, never 403.
        expect(resp.status, `executive must pass the role gate`).not.toBe(403);
      } else {
        expect(resp.status, `${p.role} must be denied execute`).toBe(403);
      }
    }
  });

  it('auditor gets read-only audit-log access', async () => {
    const auditor = personas.find(p => p.role === 'auditor')!;
    const resp = await auditor.client.authedFetch('/api/v1/audit/log');
    expect(resp.status).toBe(200);
  });

  it('viewer is denied an admin mutation (creating a user → 403)', async () => {
    const viewer = personas.find(p => p.role === 'viewer')!;
    const resp = await viewer.client.authedFetch('/api/v1/iam/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `x-${randomUUID().slice(0,6)}@vantax.co.za`, name: 'x', role: 'viewer', password: 'Nope-123456!' }),
    });
    expect(resp.status).toBe(403);
  });
});
```

> **Cleanup note:** minted users live in the `vantax` tenant and are swept by the next reseed (the cleanup helper deletes `user_sessions` and the seed re-provisions). No explicit teardown needed, but the runbook's final reseed clears them.

- [ ] **Step 2: Run it**

Run: `VERIFY_ADMIN_EMAIL=... VERIFY_ADMIN_PASSWORD=... npm run verify:rbac`
Expected: PASS (4 tests). If `mintUser` 403s for some role, confirm the admin's own role level ≥ the target (admin=100 covers all probes here). If an endpoint's real role contract differs from the probe (e.g. audit-log requires a higher role than `auditor`), correct the assertion to the **actual** `requireRole` contract in source — do not assert a weaker rule than the code enforces.

- [ ] **Step 3: Commit**

```bash
git add verification/rbac/roles.test.ts
git commit -m "$(cat <<'EOF'
feat(verify): RBAC per-persona matrix (allow + expected-deny per role)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: Component 6 — Load / performance gate

**Files:**
- Modify: `e2e/load-test.ts`
- Create: `verification/load/load-gate.ts`

- [ ] **Step 1: Parameterise load-test thresholds via env (keep current defaults)**

In `e2e/load-test.ts`, replace the hardcoded threshold block (lines 208-222) so the gate can tighten them without forking the script:

```ts
  // Pass/Fail criteria (overridable via env so the go-live gate can tighten them).
  const errorThreshold = parseFloat(process.env.LOAD_MAX_ERROR_RATE || '5');   // percent
  const p95Threshold = parseFloat(process.env.LOAD_MAX_P95_MS || '0');         // 0 = disabled
  const latencyThreshold = parseFloat(process.env.LOAD_MAX_P99_MS || '5000');  // ms
  const p99Max = Math.max(...summaryResults.map(r => r.p99LatencyMs));
  const p95Max = Math.max(...summaryResults.map(r => r.p95LatencyMs));

  if (parseFloat(errorRate) > errorThreshold) {
    console.log(`   FAIL: Error rate ${errorRate}% exceeds threshold ${errorThreshold}%`);
    process.exit(1);
  }
  if (p95Threshold > 0 && p95Max > p95Threshold) {
    console.log(`   FAIL: P95 latency ${p95Max}ms exceeds threshold ${p95Threshold}ms`);
    process.exit(1);
  }
  if (p99Max > latencyThreshold) {
    console.log(`   FAIL: P99 latency ${p99Max}ms exceeds threshold ${latencyThreshold}ms`);
    process.exit(1);
  }

  console.log(`   PASS: error ${errorRate}% / p95 ${p95Max}ms / p99 ${p99Max}ms within thresholds`);
```

- [ ] **Step 2: Verify the existing load script still typechecks**

Run: `npx tsx --check e2e/load-test.ts` (or `cd e2e && npx tsc --noEmit` if a tsconfig exists)
Expected: no type errors. (Do not run the live load test yet.)

- [ ] **Step 3: Write the go-live load gate that invokes it with strict thresholds**

Create `verification/load/load-gate.ts`:

```ts
/**
 * Go-live load gate: runs the shared load test against the deployed API with
 * the strict go-live thresholds (p95 < 800ms, p99 < 1500ms, error < 1%).
 * Exits non-zero on breach (the underlying script calls process.exit).
 */
import { spawnSync } from 'node:child_process';

const apiUrl = process.env.VERIFY_API_URL || 'https://atheon-api.vantax.co.za';
const concurrency = process.env.LOAD_CONCURRENCY || '10';
const duration = process.env.LOAD_DURATION_S || '30';

const result = spawnSync(
  'npx',
  ['tsx', 'e2e/load-test.ts', apiUrl, concurrency, duration],
  {
    stdio: 'inherit',
    env: {
      ...process.env,
      LOAD_MAX_ERROR_RATE: process.env.LOAD_MAX_ERROR_RATE || '1',
      LOAD_MAX_P95_MS: process.env.LOAD_MAX_P95_MS || '800',
      LOAD_MAX_P99_MS: process.env.LOAD_MAX_P99_MS || '1500',
    },
  },
);
process.exit(result.status ?? 1);
```

- [ ] **Step 4: Run the load gate against the deployed API**

Run: `npm run verify:load`
Expected: the load table prints and ends with `PASS: error .../ p95 .../ p99 ...` and exit code 0. If it fails on real latency, that is a genuine performance finding — capture it for the go-live decision (thresholds are revisitable per the spec, but only by explicit decision, not silently).

- [ ] **Step 5: Commit**

```bash
git add e2e/load-test.ts verification/load/load-gate.ts
git commit -m "$(cat <<'EOF'
feat(verify): load gate with strict go-live thresholds (p95<800/p99<1500/err<1%)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: Component 7 — D1 backup/restore drill

**Files:**
- Create: `verification/dr/restore-drill.ts`

**Approach:** export the remote D1, import the dump into a fresh **local** D1 (no prod risk), and assert table + key-row counts are non-zero. This proves the backup is *restorable*, not merely non-empty.

- [ ] **Step 1: Write the restore-drill script**

Create `verification/dr/restore-drill.ts`:

```ts
/**
 * Disaster-recovery drill: export the remote D1 -> import into a local D1 ->
 * assert the restore is internally consistent. Run from repo root; shells
 * wrangler in workers/api. Requires CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const DB = process.env.VERIFY_D1_DB || 'atheon-db';
const CWD = 'workers/api';

function wrangler(args: string[], opts: { json?: boolean } = {}): string {
  return execFileSync('npx', ['wrangler', ...args], {
    cwd: CWD, env: process.env, maxBuffer: 256 * 1024 * 1024, encoding: 'utf8',
  });
}

function localCount(table: string): number {
  const out = wrangler(['d1', 'execute', DB, '--local', '--json', '--command', `SELECT COUNT(*) AS n FROM ${table}`]);
  const parsed = JSON.parse(out) as Array<{ results?: Array<{ n: number }> }>;
  return parsed[0]?.results?.[0]?.n ?? 0;
}

function main(): void {
  if (!process.env.CLOUDFLARE_API_TOKEN || !process.env.CLOUDFLARE_ACCOUNT_ID) {
    console.error('FAIL: CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID required');
    process.exit(1);
  }
  const dir = mkdtempSync(join(tmpdir(), 'atheon-dr-'));
  const dump = join(dir, 'export.sql');
  try {
    console.log('1/3  Exporting remote D1...');
    wrangler(['d1', 'export', DB, '--remote', `--output=${dump}`]);

    console.log('2/3  Importing into a fresh local D1...');
    // Reset local DB by importing the dump; --local uses an isolated sqlite file.
    wrangler(['d1', 'execute', DB, '--local', `--file=${dump}`]);

    console.log('3/3  Asserting restore integrity...');
    const tenants = localCount('tenants');
    const periods = localCount('billable_periods');
    const lineItems = localCount('billable_line_items');
    console.log(`   tenants=${tenants} billable_periods=${periods} billable_line_items=${lineItems}`);

    const problems: string[] = [];
    if (tenants <= 0) problems.push('tenants is empty after restore');
    if (periods <= 0) problems.push('billable_periods is empty after restore');
    if (periods > 0 && lineItems <= 0) problems.push('periods exist but no line items restored');

    if (problems.length) {
      console.error('FAIL: ' + problems.join('; '));
      process.exit(1);
    }
    console.log('PASS: D1 export is restorable and internally consistent.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

main();
```

- [ ] **Step 2: Run the drill**

Run: `CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... npm run verify:dr`
Expected: prints the three phases and ends with `PASS: D1 export is restorable...` (exit 0). If the local import fails on a statement, that is a real restorability defect (the exact failure the spec wants surfaced) — capture the failing statement.

- [ ] **Step 3: Commit**

```bash
git add verification/dr/restore-drill.ts
git commit -m "$(cat <<'EOF'
feat(verify): D1 backup/restore drill proves export is restorable

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 8: The go-live runbook

**Files:**
- Create: `docs/runbooks/go-live.md`

- [ ] **Step 1: Write the runbook**

Create `docs/runbooks/go-live.md`:

```markdown
# VantaX Go-Live Runbook

One-time, human-executed sign-off that wraps the automated verification suites.
Run against the deployed environment under test (staging for promotion, or
production for a post-deploy confirmation).

## 0. Prerequisites (set in your shell)

| Var | Purpose |
| --- | --- |
| `VERIFY_API_URL` | API base, e.g. `https://atheon-api.vantax.co.za` |
| `VERIFY_APP_URL` | SPA base, e.g. `https://atheon.vantax.co.za` |
| `VERIFY_ADMIN_EMAIL` / `VERIFY_ADMIN_PASSWORD` | a vantax admin (can reseed + execute) |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | for D1 reads + DR drill |
| `E2E_LOGIN_EMAIL` / `E2E_LOGIN_PASSWORD` | a vantax UI user for Playwright |

## 1. Reseed the disposable tenant

`curl -sS -X POST "$VERIFY_API_URL/api/v1/seed-vantax/seed-vantax" -H "Authorization: Bearer $TOKEN"`
(or run any suite — each reseeds in `beforeAll`). Confirm the JSON `success: true`.

## 2. Run the full automated gate

```bash
npm run verify:matrices   # accuracy + isolation + rbac
npm run verify:load       # performance thresholds
npm run verify:dr         # restore drill
cd e2e && npx playwright test --project=chromium-desktop   # E2E
```
Confirm all green. Record the CI run URL if run in Actions.

## 3. Manual persona spot-check

Log in to `$VERIFY_APP_URL` as each persona and confirm the landing surface:

- [ ] CFO / executive — Apex hero + shared-savings strip render
- [ ] COO / manager — Pulse metrics populated
- [ ] auditor — audit log + compliance read-only; no operational actions
- [ ] board_member — quarterly digest only
- [ ] AR/AP clerk (operator) — catalyst task surfaces

## 4. Report check

Open `$VERIFY_API_URL/api/v1/assessments/va-demo-vantax/report/business` (with auth)
and confirm the branded PDF renders.

## 5. Evidence

Record pass/fail per step (1–4) with timestamps and the CI gate run URL.

## 6. Sign-off

| Field | Value |
| --- | --- |
| Name | |
| Date | |
| Gate run URL | |
| Decision | GO / NO-GO |
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/go-live.md
git commit -m "$(cat <<'EOF'
docs(verify): add go-live runbook wrapping the verification suites

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

---

## Task 9: Final CI composition — the deploy-blocking go-live gate

**Files:**
- Create: `.github/workflows/go-live-gate.yml`
- Modify: `.github/workflows/deploy-frontend.yml`
- Modify: `.github/workflows/deploy-api.yml`

**Gating model (staging-promote):** push-to-main deploys to staging, the gate runs the full suite against staging, and production promotion is gated on a green gate. This task wires that topology. Because it changes the live deploy pipeline, keep it in one reviewable commit and confirm CI behavior on a branch before merging.

- [ ] **Step 1: Add the required GitHub secrets/vars (manual prerequisite — document, do not script)**

In the repo's `staging` environment, add: `VERIFY_ADMIN_EMAIL`, `VERIFY_ADMIN_PASSWORD`, `E2E_STAGING_LOGIN_EMAIL`, `E2E_STAGING_LOGIN_PASSWORD` (reuse existing if present), and confirm `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` exist. Set repo var `STAGING_API_URL` / `STAGING_APP_URL`. Record this requirement in the PR description.

- [ ] **Step 2: Write the gate workflow**

Create `.github/workflows/go-live-gate.yml`:

```yaml
name: Go-Live Gate

on:
  workflow_dispatch:
    inputs:
      base_url:
        description: 'API base URL to verify'
        default: 'https://atheon-api.vantax.co.za'
  workflow_call:
    inputs:
      api_url:    { required: true, type: string }
      app_url:    { required: true, type: string }
    secrets:
      VERIFY_ADMIN_EMAIL:    { required: true }
      VERIFY_ADMIN_PASSWORD: { required: true }
      E2E_LOGIN_EMAIL:       { required: true }
      E2E_LOGIN_PASSWORD:    { required: true }
      CLOUDFLARE_API_TOKEN:  { required: true }
      CLOUDFLARE_ACCOUNT_ID: { required: true }

concurrency:
  group: go-live-gate-${{ github.ref }}
  cancel-in-progress: false

jobs:
  gate:
    runs-on: ubuntu-latest
    timeout-minutes: 30
    env:
      VERIFY_API_URL: ${{ inputs.api_url || inputs.base_url }}
      VERIFY_APP_URL: ${{ inputs.app_url || 'https://atheon.vantax.co.za' }}
      VERIFY_ADMIN_EMAIL: ${{ secrets.VERIFY_ADMIN_EMAIL }}
      VERIFY_ADMIN_PASSWORD: ${{ secrets.VERIFY_ADMIN_PASSWORD }}
      E2E_BASE_URL: ${{ inputs.app_url || 'https://atheon.vantax.co.za' }}
      E2E_LOGIN_EMAIL: ${{ secrets.E2E_LOGIN_EMAIL }}
      E2E_LOGIN_PASSWORD: ${{ secrets.E2E_LOGIN_PASSWORD }}
      CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
      CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
      CI: 'true'
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20', cache: 'npm' }
      - run: npm ci
      - run: npm ci --prefix workers/api
      - name: Accuracy + isolation + RBAC matrices
        run: npm run verify:matrices
      - name: Load gate
        run: npm run verify:load
      - name: DR restore drill
        run: npm run verify:dr
      - name: E2E (vantax)
        working-directory: e2e
        run: |
          npm ci
          npx playwright install --with-deps chromium
          npx playwright test --project=chromium-desktop
```

- [ ] **Step 3: Re-point deploy-api production promotion through the gate**

In `.github/workflows/deploy-api.yml`, change the `deploy-production` job so that on push-to-main it deploys to **staging** first (existing `--env staging` path) and the production deploy `needs:` the gate. Concretely: keep the existing `typecheck`/`test` jobs; add a `gate` job that calls the reusable gate against the staging URL after the staging deploy, and add `gate` to the `deploy-production` job's `needs:`. Example addition (adapt job names to the file's actual ones):

```yaml
  gate:
    needs: [deploy-staging]
    uses: ./.github/workflows/go-live-gate.yml
    with:
      api_url: ${{ vars.STAGING_API_URL }}
      app_url: ${{ vars.STAGING_APP_URL }}
    secrets: inherit

  deploy-production:
    needs: [typecheck, test, gate]   # was: [typecheck, test]
    # ...unchanged...
```

> If push-to-main currently deploys straight to production (no staging step on push), add a `deploy-staging` job gated on push so the promotion sequence is staging → gate → production. The implementer should read the current `deploy-api.yml` job graph and wire `needs:` so production never runs unless `gate` succeeded.

- [ ] **Step 4: Gate the frontend production deploy on the same gate**

In `.github/workflows/deploy-frontend.yml`, add `needs: [gate]` (or `needs:` the workflow_run conclusion of the gate) to the `deploy-production` job, mirroring Step 3, so the SPA is not promoted on a red gate.

- [ ] **Step 5: Validate the workflows parse**

Run: `for f in .github/workflows/go-live-gate.yml .github/workflows/deploy-api.yml .github/workflows/deploy-frontend.yml; do npx --yes @action-validator/cli "$f" || echo "check $f"; done`
Expected: no schema errors. (If `@action-validator/cli` is unavailable offline, at minimum run `python3 -c "import yaml,sys; [yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml` to confirm valid YAML.)

- [ ] **Step 6: Commit**

```bash
git add .github/workflows/go-live-gate.yml .github/workflows/deploy-api.yml .github/workflows/deploy-frontend.yml
git commit -m "$(cat <<'EOF'
ci(verify): compose go-live gate and block production promotion on a red gate

Staging-promote model: push deploys to staging, gate verifies staging, prod
promotion needs a green gate (accuracy, isolation, RBAC, load, DR, E2E).

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>
EOF
)"
```

- [ ] **Step 7: Confirm the gate runs end-to-end on a branch before relying on it**

Push the branch and trigger `Go-Live Gate` via `workflow_dispatch` against staging. Confirm every step runs and the job is green. Only after that should the `needs: gate` production gating be trusted on `main`.

---

## Definition of Done (maps to spec go-live success criteria)

- [ ] `VANTAX_ORACLE` is the single source for seed generation summary + harness assertions (Task 1).
- [ ] Accuracy harness: all reconciliation counts match the oracle; 100% of `billable_line_items` carry savings≥0 + confidence + evidence + resolvable `rca_id`; SUM reconciles to the period; report serves `%PDF` (Tasks 2c–2e).
- [ ] Negative control proves the harness fails on perturbed truth (Task 2f).
- [ ] E2E green against vantax; traceability spec asserts unconditionally (Tasks 3a–3b).
- [ ] Isolation matrix passes for every protected-prefix probe (no cross-tenant 200) (Task 4).
- [ ] RBAC matrix passes allow + expected-deny for every role (Task 5).
- [ ] Load thresholds met: p95<800ms, p99<1500ms, error<1% (Task 6).
- [ ] DR restore drill succeeds (Task 7).
- [ ] Runbook exists and is executable (Task 8).
- [ ] Go-live gate composes all suites and blocks production promotion on red (Task 9).
```