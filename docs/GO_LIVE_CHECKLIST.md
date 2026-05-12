# Atheon Go-Live Checklist

Last updated: 2026-05-11 (DSAR encryption + audit-log retention + VantaX repeatable demo shipped)

This document tracks the gating items between the current production state and a clean go-live announcement. Items are grouped by tier: **Tier 1 (blockers)** must be resolved before the announcement; **Tier 2 (should-fix)** should be closed within the first week; **Tier 3 (deferred)** are known follow-ups tracked in the backlog.

## 2026-05-11 sweep — code-side blockers cleared

The 2026-05-10 feature-sweep ([docs/FEATURE_SWEEP_2026-05-10.md](FEATURE_SWEEP_2026-05-10.md)) flagged three remaining go-live items. All are now closed in code:

- [x] **DSAR access export encrypted (AES-256-GCM)** — `POST /api/v1/dsar/access` returns an `enc:v1:`-wrapped envelope; the plaintext is never on the wire. A new `POST /api/v1/dsar/access/:requestId/decrypt` returns the plaintext after a fresh auth check, so a stolen encrypted blob is useless without a current admin session. POPIA §3 exposure closed.
- [x] **DSAR notifications scope fixed + erasure coverage extended** — the access query now filters `WHERE tenant_id = ? AND user_id = ?` (was leaking the whole tenant's notifications). `notifications` added to the erasure pipeline.
- [x] **Audit log retention purge scheduled** — daily-debounced via a `__system__` marker row in `tenant_settings`; defaults to 365-day retention, override via `AUDIT_LOG_RETENTION_DAYS` env var (clamped to [30, 3650]). Batches of 5,000 per pass, capped at 20 passes/day to bound write-lock pressure.
- [x] **VantaX repeatable demo** — `POST /api/v1/seed-vantax/reset` wipes the tenant in dependency-safe multi-pass order; the existing `POST /api/v1/seed-vantax` now post-processes two RCAs into the billing-eligible state and calls `computeBillablePeriod` so the ROI dashboard shows live shared-savings revenue on day one. 7 smoke tests cover reset, materialise, and two full reset→reseed cycles.

**Tier-1 operational secrets below (`MS_GRAPH_TENANT_ID`, `JWT_SECRET`, `ENCRYPTION_KEY`) are still outstanding — they're ops tasks the platform team owns, not code changes.**

## Assessment engine — go-live ready

The assessment engine is the lead-magnet that drives revenue. As of this update:

- [x] **40 detectors** across product (32) + service (8) domains, each with `value_at_risk_zar` derived from the prospect's actual ERP rows — never a fixed percentage. PRs #272, #274.
- [x] **Multi-currency normalisation** (USD / EUR / GBP / ZAR) — native amounts preserved on `currency_breakdown`, headline value normalised to ZAR via configurable rate table. PR #272.
- [x] **Multi-company / multinational** per-entity findings via `detectAllFindingsByCompany()`. Concentration findings stay at the consolidated level so they don't fragment across entities. PR #273.
- [x] **Service vs product detection** classifies tenants as product / service / mixed / unknown. Service detectors no-op cleanly for product-only tenants. PR #274.
- [x] **Catalyst gap closure** — every entry in `FINDING_CATALYST_MAP` resolves to a real-implementation sub-catalyst in `CATALYST_CATALOG`. New "Service Operations Catalyst" cluster. Round-trip enforced by test. PR #275.
- [x] **Business PDF report** renders one card per finding with severity ribbon, narrative, value-at-risk callout, sample records, and a "CURE: catalyst → sub-catalyst" footer. Per-entity summary page for multinationals. PR #276.
- [x] **Pulse + Apex wire-up** — every finding becomes a `process_metric`; high+critical findings additionally become `risk_alerts` with the resolving catalyst in `recommended_actions`. Idempotent across re-runs. PR #277.
- [x] **Frontend Findings tab** in AssessmentsPage — interactive list with severity filters, search, category filter, per-entity tabs, sample-record drill-down, and a Deploy button on each finding's recommended catalyst. PR #278.
- [x] **Trial flow** runs `detectAllFindings` alongside the legacy value-assessment engine; trial `/results` exposes `findings` + `findingsSummary`. Migration v51-trial-findings. PR #279.
- [x] **VantaX demo seeder** — `POST /api/v1/seed-vantax/seed-findings-demo` lights up all 40 detectors with ~280 deterministic fixture records so any sales demo runs against a fully-populated Findings tab. PR #280.

## Tier 1 — Blockers

- [ ] **MS_GRAPH_TENANT_ID is real**
  The production secret was observed set to the placeholder `test`, which causes `/forgot-password` to hang for ~45s on every request. PR #255 bounds the fetch at 5s and moves sends to `waitUntil`, so UX is no longer blocked, but **email delivery is still broken until the secret is corrected**. See [runbook §11](runbook.md#11-email--ms-graph-diagnostics).

- [ ] **Rotate `JWT_SECRET` and `ENCRYPTION_KEY` after the 2026-04 credential paste**
  A GitHub PAT and Cloudflare Global API Key were pasted into chat. They have been flagged for rotation. Until `JWT_SECRET` and `ENCRYPTION_KEY` are rotated (per [runbook §15](runbook.md#15-secret-rotation-drill-after-credential-leak)), treat all sessions and all encrypted ERP credentials as potentially compromised.

- [ ] **Re-login drill rehearsed**
  After `JWT_SECRET` rotation, every user must re-authenticate. Confirm the login page, forgot-password, and MFA challenge paths are all healthy on production before rotating. Validate via `e2e/tests/traceability.spec.ts` run against production or the staging mirror.

## Tier 2 — Should-fix in week 1

- [x] **CI flake: `@cloudflare/vitest-pool-workers` isolated storage** — fixed in PR #263. Set `poolOptions.workers.singleWorker = true` in `workers/api/vitest.config.ts`. CI fully green for the first time this sprint (12 / 12 checks); 341 / 341 tests pass in ~50s.

- [ ] **119 catalyst stubs**
  Post-sprint, the catalyst catalog has ~70 real handlers across 14 domains. 119 remain as registered stubs that return structured "not implemented" payloads. Prioritize by domain based on the first week of tenant activity; signal comes from `catalyst_runs` grouped by `catalyst_key`.

- [x] **LLM narrative reasoning layer** — shipped in PR #259 (`GET /catalysts/runs/:runId/narrative`, budget-aware, PII-redacted, KV-cached 24h, migration v48-narrative).

- [x] **Support ticket system** — shipped in PR #261 (schema v49-support, API routes, user list + detail pages, admin triage page, 20 integration tests).

- [ ] **Observability: Logpush destination**
  `wrangler tail` is the current story. Configure a Logpush destination (R2 or a log aggregator) so incident response has retention past the live tail window.

- [x] **CatalystRunDetailPage re-render loop** — fixed in PR #258. Root cause: `useToast()` returned a new object each render, polluting the `useCallback` deps of the data loaders, which invalidated the callbacks on every render and re-fired the boot `useEffect`. Fix: read `toast` through a `useRef` that is refreshed each render, drop `toast` from the loader deps. E2E regression assertion added — network calls to the run endpoint are now bounded.

## Tier 3 — Deferred (tracked, not gating)

- Real billing MRR surface in the admin UI (stubbed; tenant plans are the source of truth).
- Docker GHCR push permission fix for the self-hosted image pipeline.
- Deeper permission matrix tests for `iam_custom_roles` (unit-tested; no E2E yet).
- Playwright coverage for MFA enrollment + recovery codes beyond LoginPage assertions added in PR #256.

## Deployment models — go-live ready

All three deployment models (saas, hybrid, on-premise) are implementation-complete. See [HYBRID_DEPLOY.md](HYBRID_DEPLOY.md) for the architecture, configuration matrix, and operating procedures.

- [x] **saas** — Atheon's Cloudflare Workers; default deployment.
- [x] **hybrid** — Customer hosts data plane in their VPC; Atheon cloud handles license + version + billing. Implemented via:
  - `DEPLOYMENT_ROLE=customer` env var distinguishes customer instances from cloud
  - `licenseEnforcement()` middleware ([workers/api/src/services/license-enforcement.ts](../workers/api/src/services/license-enforcement.ts)) phones home hourly to validate license, caches result in KV, fails-closed after 7 days of disconnect for safety
  - Cloud-side phone-home endpoint `GET /api/agent/license-check` (agent-routes.ts) returns valid/expired/revoked/unknown verdicts against `managed_deployments`
  - Customer-side admin endpoints `/api/v1/license-status` (read-only) and `/api/v1/license-status/refresh` (force re-validate)
  - 7 integration tests covering license-check verdicts + middleware no-op behaviour on cloud
  - docker-compose.yml wires the new env vars for customer deployments
- [x] **on-premise** — Same as hybrid; air-gapped customers can leave `LICENCE_KEY`/`ATHEON_LICENSE_CHECK_URL` unset and the middleware no-ops (intentional — fail-OPEN to avoid locking out a misconfigured deployment).

## Role model — verified

- [x] **superadmin** — full coverage; backend gating + frontend pages aligned. Cross-tenant access via `?tenant_id=` works on every admin route.
- [x] **support_admin** — backend `platformAdminRoutePrefixes` allows access to `/iam`, `/erp`, `/audit`, `/controlplane`, `/connectivity`. Frontend role gating aligned in PR #282 (Control Plane + Connectivity sidebar entries switched from SUPERADMIN_ROLES to PLATFORM_ADMIN_ROLES so support_admin can reach pages the backend already permits).
- [x] **admin / executive / manager / analyst / operator / viewer** — standard hierarchy, gating consistent end-to-end.

## Verifications completed during this sprint

- [x] **34+ PRs merged to `main`** — catalyst platform, multicompany ERP, security hardening, audit fixes, and ops docs.
- [x] **316 unit + integration tests passing** on `main`.
- [x] **Production Worker deployed** — `atheon-api.vantax.co.za` on the post-sprint build.
- [x] **Migration v47-platform applied** in production (`erp_companies`, `tenant_llm_usage`, `tenant_llm_budget`, `system_alert_rules`, `feature_flags`, `iam_custom_roles`, `support_tickets`).
- [x] **MFA enforcement with 14-day grace** — gated behind tenant flag, rollback-safe.
- [x] **Webhook HMAC signing + delivery log** — per-webhook secret, show-once, retries with backoff.
- [x] **LLM budget enforcement + PII redaction (7 rules)** — per-tenant daily caps in `tenant_llm_budget`.
- [x] **Request-ID middleware** — every response carries `X-Request-ID`; frontend propagates a correlated `fe-<16hex>` ID.
- [x] **ERP adapter timeouts** — `AbortSignal.timeout()` on every outbound ERP fetch; bounded retries.
- [x] **Catalyst DAG with cycle detection** — `MAX_CHAIN_DEPTH=5`, `wouldCreateCycle()` on dependency writes.
- [x] **Operator runbook** — [runbook.md](runbook.md) covers deploy, rollback, DB, KV, secret rotation, password-reset bypass, MS Graph diagnostics, LLM budget, webhook delivery.
- [x] **Feature audit + sprint record** — [FEATURE_AUDIT.md](FEATURE_AUDIT.md), [SPRINT_COMPLETE.md](SPRINT_COMPLETE.md).

## Day-of go-live steps

1. Confirm every Tier-1 box is checked.
2. Freeze merges to `main` 1 hour before the announcement.
3. Run the E2E suite against production: `npm run test:e2e -- --project=production`.
4. Tail the Worker during the first 30 minutes post-announcement:
   ```bash
   cd workers/api && npx wrangler tail --format pretty
   ```
5. Watch the `X-Request-ID` correlated error count; page oncall at >1% error rate over 5 minutes.
6. Capture a snapshot of `tenant_llm_usage`, `webhook_deliveries`, and `audit_log` at T+24h for post-launch review.
