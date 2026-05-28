# VantaX Go-Live Test & Verification Suite — Design

**Status:** Approved (design phase)
**Date:** 2026-05-28
**Author:** brainstorming session
**Next:** writing-plans → subagent-driven-development

## Goal

Establish a comprehensive, deploy-blocking test suite plus a human go-live runbook that
proves the Atheon platform is correct and production-ready for VantaX go-live on the
synthetic seeded dataset. "Correct" for a shared-savings product means **every claimed
Rand traces to an ERP record + field mapping + confidence** — accuracy is the product,
not an afterthought.

## Scope & Decisions

Locked decisions from brainstorming:

1. **Data source — synthetic seeded.** Go-live runs on the seeded `vantax` dataset. The
   seeder's known-good counts are the full accuracy oracle. Live SAP/ERP integration
   testing is **out of scope**.
2. **Deliverable — both gate + runbook.** An automated CI gate that blocks production
   deploys, AND a human-executed go-live runbook that wraps the same suites.
3. **Test target — `vantax` is a disposable demo tenant.** Automation may reseed it
   freely (the reseed is destructive — it wipes ~2,800 records). No separate test-tenant
   plumbing is required.
4. **Coverage — comprehensive (Approach B).** Load and disaster-recovery are automated
   gates, not just runbook steps. Traceability verification is exhaustive (per-row), not
   sampled.

Out of scope: live ERP connector validation, multi-region failover, penetration testing,
and any change to the shared-savings billing math itself (we *verify* it, we don't alter
it).

## Background — current state (why this is needed)

- **Unit coverage is healthy:** 80 API test files + 97 frontend vitest tests pass.
  [ci.yml](../../../.github/workflows/ci.yml) runs lint → typecheck → vitest
  (frontend + backend) on every push/PR.
- **E2E is red and ungated.** Production E2E and Staging E2E suites currently fail.
  At least one failure is selector drift from the Quiet Capital UI overhaul (the
  `/llm budget/i` heading at
  [admin-tenant-llm-budget.spec.ts:28](../../../e2e/tests/admin-tenant-llm-budget.spec.ts)).
  E2E runs only on a *schedule* / `workflow_run` and **never blocks a deploy** — so code
  can (and does) ship with red E2E.
- **The "accuracy" test is a weak UI smoke test.**
  [traceability.spec.ts](../../../e2e/tests/traceability.spec.ts) logs in as a generic
  `admin@example.com` (not the seeded `vantax` tenant) and wraps assertions in
  `if (await …isVisible())`, so they silently no-op when the element is absent. It never
  asserts a number equals ground truth or resolves to a real ERP row. **No accuracy layer
  exists yet.**
- **Ground truth is duplicated, not canonical.** The expected reconciliation outcomes are
  hardcoded English strings at
  [seed-vantax.ts:3378-3389](../../../workers/api/src/routes/seed-vantax.ts) while the data
  is *generated* by separate logic (`i < 8`, etc.). Two sources that can drift.
- **DR is unproven.** The Nightly D1 Backup workflow is also red. Backup uses
  `wrangler d1 export atheon-db --remote`; restorability is never tested.

## Architecture

A new top-level **`verification/`** suite, plus CI wiring and one runbook. Seven
independently-testable components feed a single **go-live gate** (a GitHub Actions job
that must be green before a production deploy proceeds) and one **runbook**
(`docs/runbooks/go-live.md`) that a human executes once, referencing the same suites.

Data flow — the disposable `vantax` tenant is the fixture. Every automated accuracy /
E2E / isolation run begins by reseeding it to a known state, then asserts against
canonical constants:

```
reseed vantax → run catalysts → read runs/items + billable_line_items
     │                                      │
     ▼                                      ▼
canonical oracle constants  ◄── assert ──►  counts + traceability invariant
```

CI composition:

```
lint+typecheck ─► vitest (frontend+backend) ─► accuracy harness ─┐
                                              ├─ isolation matrix ─┤
                                              ├─ RBAC matrix ──────┼─► GO-LIVE GATE ─► deploy
                                              ├─ E2E (vantax) ─────┤      (all green)
                                              ├─ load gate ────────┤
                                              └─ DR restore drill ─┘
```

## Key endpoints, tables, and tooling (the assertion surfaces)

- **Auth:** `POST /api/auth/login` returns `{ token, user: { role, tenant_id } }`. The
  seed/reset endpoints require role in `['superadmin','support_admin','admin','executive']`
  on the `vantax` tenant.
- **Reseed:** `POST /api/v1/seed-vantax/seed-vantax` (note the doubled path prefix — the
  router mounts `/api/v1/seed-vantax` and the handler path is `/seed-vantax`). Returns a
  rich JSON summary including a `seeded` object and a `dataQuality` block.
- **Reset only:** `POST /api/v1/seed-vantax/reset`.
- **Catalyst execution:**
  `POST /api/v1/catalysts/clusters/:clusterId/sub-catalysts/:subName/execute`.
- **Run results:** `GET /api/v1/catalysts/clusters/:clusterId/sub-catalysts/:subName/runs`
  and `…/runs/:runId`; matched/unmatched items at
  `GET /api/v1/catalysts/runs/:runId/items`.
- **Savings traceability (the invariant target):** table `billable_line_items`
  (`id, period_id, tenant_id, rca_id, metric_name, attributed_savings, confidence,
  evidence, created_at`) and table `billable_periods`
  (`total_realised_savings, atheon_share_pct, atheon_revenue, currency, status`). Written
  by [billing-engine.ts](../../../workers/api/src/services/billing-engine.ts), read by
  [audit-pack.ts](../../../workers/api/src/services/audit-pack.ts).
- **Assessment / report:** `GET /api/v1/assessments/:id` (field `businessReportKey`) and
  `GET /api/v1/assessments/:id/report/business` (serves the branded PDF;
  `content-type: application/pdf`, body starts `%PDF`). The seeded assessment id is
  `va-demo-vantax`.
- **Protected prefixes (isolation matrix targets):** the ~40 prefixes listed at
  [index.ts:452](../../../workers/api/src/index.ts) — `tenants, iam, apex, dashboard,
  pulse, catalysts, memory, mind, erp, controlplane, audit, connectivity, notifications,
  storage, realtime, assessments, deployments, ai-costs, radar, diagnostics,
  catalyst-intelligence, roi, board-report, onboarding, freshness, atheon-score, baseline,
  targets, executive-summary, webhooks, system-alerts, support, inferences, billing, dsar,
  orchestration, insights-stats`.
- **RBAC source:** role levels in [iam.ts:12](../../../workers/api/src/routes/iam.ts)
  (`board_member: 80, manager: 70, analyst: 50, operator: 40, auditor: 30, viewer: 10`);
  enforcement via `requireRole(...)` in
  [tenant.ts:95](../../../workers/api/src/middleware/tenant.ts).
- **Load tool:** [e2e/load-test.ts](../../../e2e/load-test.ts) —
  `npx tsx e2e/load-test.ts <baseUrl> <concurrency> <duration>`; emits per-endpoint
  `avgLatencyMs / p95LatencyMs / p99LatencyMs / errorCount`.
- **Backup tool:** `wrangler d1 export atheon-db --remote --output=<file>` →
  R2 (`atheon-backups/…`), per
  [backup-d1.yml](../../../.github/workflows/backup-d1.yml).

## Components

### Component 1 — Canonical oracle (single source of truth)

Extract the expected reconciliation outcomes into typed constants in
[vantax-demo.ts](../../../workers/api/src/services/vantax-demo.ts) (the module already
extracted so tests can import it):

```ts
export const VANTAX_ORACLE = {
  grir:      { total: 80, matched: 65, priceVariances: 7,  unmatched: 8 },
  bank:      { total: 80, reconciled: 55, fees: 10, unmatchedEft: 15 },
  inventory: { total: 18, matched: 10, shortage: 4, surplus: 4 },
  salesOrder:{ total: 80, matched: 55, amountVariances: 10, statusMismatch: 7, unmatched: 8 },
} as const;
```

Refactor both the seeder's data-generation logic and the `dataQuality` summary string at
[seed-vantax.ts:3378-3389](../../../workers/api/src/routes/seed-vantax.ts) to derive from
`VANTAX_ORACLE`. One source; the harness asserts against the same constant. This component
is pure refactor + constant extraction — existing seed behaviour must not change (verified
by re-running the seeder and diffing the summary numbers).

**Interface:** `VANTAX_ORACLE` (read-only constant). **Depends on:** nothing.

### Component 2 — Accuracy & traceability harness (centerpiece)

A test module that, for each reconciliation-ready sub-catalyst:

1. Reseeds `vantax`, then `POST …/sub-catalysts/:subName/execute`.
2. Reads `…/runs/:runId/items` and asserts matched / variance / unmatched **counts equal
   `VANTAX_ORACLE`** for that catalyst.
3. **Traceability invariant (exhaustive):** queries every `billable_line_items` row for
   the tenant and asserts each has `attributed_savings ≥ 0`, non-null `confidence`,
   non-empty `evidence`, and a resolvable `rca_id`. Asserts `SUM(attributed_savings)`
   reconciles to `billable_periods.total_realised_savings` (within rounding tolerance).
4. Asserts `business_report_key` is populated on `va-demo-vantax` after seed and that
   `GET /api/v1/assessments/va-demo-vantax/report/business` returns HTTP 200 with a
   `%PDF` body (the manual check from go-live day, now automated).

**Interface:** a CI-runnable test target that exits non-zero on any mismatch.
**Depends on:** Component 1, a deployed/seedable `vantax` tenant, an admin token.

### Component 3 — E2E repair + blocking deploy gate

1. **Repair red specs.** Triage each failure in [e2e/tests/](../../../e2e/tests/) into
   "selector drifted from the Quiet Capital overhaul" vs. "feature regressed." Fix
   selectors; file genuine regressions as bugs.
2. **Harden [traceability.spec.ts](../../../e2e/tests/traceability.spec.ts).** Re-point it
   at the seeded `vantax` tenant and make the drill-down assertions unconditional (remove
   the `if (await …isVisible())` no-op guards).
3. **Gate deploys on E2E.** Add E2E as a required upstream job for
   [deploy-frontend.yml](../../../.github/workflows/deploy-frontend.yml) and
   [deploy-api.yml](../../../.github/workflows/deploy-api.yml) so a red suite stops the
   deploy. (Today they trigger independently on push.)

**Interface:** green Playwright run against the deployed app + a deploy that refuses to
proceed on red E2E. **Depends on:** seeded `vantax` tenant.

### Component 4 — Tenant isolation matrix

`verification/isolation/cross-tenant.test.ts`: seed `vantax` plus a second tenant,
authenticate as a `vantax` user, and assert — parameterized per protected prefix (list
above) — that every endpoint returns only `vantax` rows and yields 403/404 on the other
tenant's resource IDs.

**Interface:** one parameterized test per prefix; non-zero exit on any leak.
**Depends on:** two seeded tenants, tokens for each.

### Component 5 — RBAC per-persona matrix

`verification/rbac/roles.test.ts`: for each role in
[iam.ts:12](../../../workers/api/src/routes/iam.ts), assert the allow/deny set against the
`requireRole` contract. Concretely: `board_member` reaches `/board-digest` data endpoints
and is denied operational mutations; `auditor` gets read-only compliance/audit-log access
and 403 on catalyst execution; `viewer` is read-only everywhere.

**Interface:** per-role allow/deny assertions; non-zero exit on any violation.
**Depends on:** ability to mint/seed users at each role on `vantax`.

### Component 6 — Load / performance gate

Wrap [e2e/load-test.ts](../../../e2e/load-test.ts) in a CI job with explicit pass
thresholds — **p95 < 800 ms, p99 < 1500 ms, error-rate < 1%** at the agreed concurrency
(default 10 concurrent users, 30 s; revisit before go-live). The script already emits the
metrics; the gate adds threshold assertions and a non-zero exit on breach. Runs against
the deployed API.

**Interface:** pass/fail on latency + error-rate thresholds.
**Depends on:** a deployed API URL.

### Component 7 — D1 backup/restore drill

`verification/dr/restore-drill` CI job: `wrangler d1 export atheon-db --remote` → import
the dump into a scratch/preview D1 → assert table count and key row counts (`tenants`,
`billable_periods`) are non-zero and internally consistent. This also fixes the red
Nightly D1 Backup by proving the export is *restorable*, not merely non-empty.

**Interface:** pass/fail on a successful restore + integrity assertions.
**Depends on:** wrangler auth, a scratch D1 binding.

## The runbook (`docs/runbooks/go-live.md`)

A human-executed sequence for the one-time go-live sign-off, wrapping the same suites:

1. Reseed `vantax` (`POST /api/v1/seed-vantax/seed-vantax`).
2. Run the full gate suite locally / in CI; confirm green.
3. Manually log in as each persona and spot-check the landing surface (CFO/executive,
   COO, auditor, board_member, AR/AP clerk, …).
4. Open `GET …/assessments/va-demo-vantax/report/business`; confirm the branded PDF
   renders.
5. Record pass/fail evidence per step.
6. Sign-off line (name, date, gate run URL).

## Testing the tests

- The accuracy harness is itself validated by a **negative control**: temporarily perturb
  one seeded record and confirm the harness fails (proves it isn't a no-op like the
  current `traceability.spec.ts`).
- Isolation/RBAC matrices include at least one **expected-deny** assertion per axis so a
  permissive regression is caught (not just happy-path allows).
- Component 1's refactor is covered by an **invariance check**: seed before/after the
  refactor and diff the `dataQuality` summary — numbers must be identical.

## Error handling

- All suites authenticate fresh per run (tokens expire); a 401 fails the run loudly rather
  than skipping.
- Reseed is destructive and slow — suites that reseed run **serially** against `vantax`
  (no parallel reseed races). Isolation/RBAC reads can parallelize after a single seed.
- A failed reseed (non-2xx) aborts the dependent suite with a clear message rather than
  asserting against stale data.

## Build sequence (for the plan)

Highest value + unblocks the gate first:

1. **Component 1** (oracle) — pure refactor, no behaviour change.
2. **Component 2** (accuracy harness) — the product-correctness proof.
3. **Component 3** (E2E repair + blocking gate) — clears the current blocker.
4. **Components 4 & 5** (isolation, RBAC) — security/correctness boundaries.
5. **Components 6 & 7** (load, DR drill) — ops gates.
6. **Runbook** + final CI composition wiring the go-live gate.

## Go-live success criteria (definition of done)

Go-live is authorized when **all** hold:

- The full gate is green on `main`.
- Accuracy harness: 100% of `billable_line_items` carry confidence + evidence + resolvable
  `rca_id`, and all reconciliation counts match `VANTAX_ORACLE`.
- Isolation matrix passes for every protected prefix (no cross-tenant leak).
- RBAC matrix passes for every role (allow and deny).
- Load thresholds met (p95 < 800 ms, p99 < 1500 ms, error-rate < 1%).
- A restore drill succeeded in the latest run.
- The runbook is executed and signed off.
