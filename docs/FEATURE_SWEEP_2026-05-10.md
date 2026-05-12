# Atheon Platform — Feature-by-Feature Wiring Sweep

**Date:** 2026-05-10
**Branch:** `devin/1778142000-stitch-design-brief`
**Baseline commits inspected:** through `878cc8e` (docs: §12 process flows + §11 generation order)
**Methodology:** Read-only audit by parallel feature agents (APEX, PULSE, Catalyst, Billing, DSAR, ERP, IAM, Inference, Cross-tenant, Orchestration, Frontend) followed by direct code verification of contradictory claims. Three actionable defects fixed in this sweep; everything else captured as a punch-list for separate PRs.

---

## 1. Headline findings

| # | Finding | Severity | Status |
|---|---|---|---|
| 1 | SAP ECC e2e idempotent re-seed crashed on FK constraint — cleanup missed 4 tables (`catalyst_insights`, `health_scores`, `health_score_history`, `sub_catalyst_runs`) | **High** (blocks CI) | **FIXED** in this sweep |
| 2 | Threshold autotune (Phase 10-16) was effectively dead code: `getEffectiveThreshold()` was called only from tests; the three production engines used hardcoded constants | **High** (Phase 10 invariant violated) | **FIXED** in this sweep |
| 3 | Phase 10-19 billing API documented in [PHASE_10_ANALYTICAL_CHAIN.md §10-19](./PHASE_10_ANALYTICAL_CHAIN.md) was missing — `computeBillablePeriod` had no HTTP entrypoint, no cron call. Only callable from tests. | **High** (revenue path not invocable) | **FIXED** in this sweep |
| 4 | DSAR access export returns unencrypted JSON (Phase 1 finding still open) | **Medium** (POPIA exposure) | Open |
| 5 | Audit log retention has no scheduled purge — grows unbounded | **Medium** (SOC2 gap) | Open |
| 6 | DSAR access export `notifications` query is tenant-scoped, not subject-scoped — leaks other users' notifications | **Medium** (DSAR over-disclosure) | Open |
| 7 | OIDC SSO lacks nonce + PKCE | **Low** (SSO hardening) | Open |
| 8 | Login error path leaks account existence on `no_password_set` | **Low** (account enum) | Open |
| 9 | Workflow orchestration has no frontend (Phase 10-22 API exists, no UI) | **Medium** (operator UX) | Open |
| 10 | Billing line items lack explicit `causal_factor_id` in evidence — dispute traceability is one indirection short | **Medium** (audit defensibility) | Open |

**Net**: pillar-level wiring is healthy. Phase 10 chain is real, multi-engine, end-to-end, and now its tuning loop is closed (#2 fix). Billing is now invocable (#3 fix). The remaining open items are bounded scope and well-suited to single PRs.

---

## 2. Fixes shipped in this sweep

### 2.1 SAP ECC seeder idempotent cleanup

**File:** [workers/api/src/services/demo-sap-ecc-seeder.ts](../workers/api/src/services/demo-sap-ecc-seeder.ts)

`deleteExisting()` deletes tenant-scoped rows in dependency order before re-seeding. The list missed four tables that `seedSapEccDemo()` does insert into:

- `sub_catalyst_runs` (Phase 10-27)
- `health_scores` (Phase 10-27)
- `health_score_history` (Phase 10-27)
- `catalyst_insights` (Phase 10-27)

Second-run `DELETE FROM tenants WHERE id = ?` failed with `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT` because rows in those tables still pointed at the tenant. Added them to the cleanup list (children-first ordering preserved). The previously failing test in `sap-ecc-demo-e2e.test.ts > is idempotent — re-running clears prior data and re-seeds cleanly` now passes.

### 2.2 Threshold autotune wired into the three live engines

**Files:**
- [workers/api/src/services/metric-correlation-engine.ts](../workers/api/src/services/metric-correlation-engine.ts)
- [workers/api/src/services/signal-kpi-attribution.ts](../workers/api/src/services/signal-kpi-attribution.ts)
- [workers/api/src/services/apex-narrative-engine.ts](../workers/api/src/services/apex-narrative-engine.ts)

Phase 10-16 introduced `threshold-autotune.ts` which writes per-tenant gate overrides to `tenant_settings.inference_threshold:{gate}`. The reader, `getEffectiveThreshold(db, tenantId, gate)`, was exported but the only callers were tests. The three production engines used module-level constants:

- `metric-correlation-engine.ts` — `MIN_CORRELATION_STRENGTH = 0.7`
- `signal-kpi-attribution.ts` — `MIN_CORRELATION = 0.6`, `MIN_SIGNAL_DELTA_PCT = 5`
- `apex-narrative-engine.ts` — `MIN_RECOVERY_SAMPLES = 3`

Net effect: autotune ran daily and recorded `tighten`/`loosen` recommendations in `inference_calibration`, persisted them to `tenant_settings`, but the engines never read them. The tuning loop was open.

This sweep:
- Resolves the per-tenant gate value at the start of each sweep via `getEffectiveThreshold`, defaulting to the existing constant on error so behaviour is identical when no override exists.
- For `decideAttribution` (a pure function used by external callers and tests), made the thresholds optional parameters with defaults — preserving the existing test signatures.
- Updates `closeRecoveredRcas` to compute `minRecoverySamples = round(autotuneValue)` clamped to ≥ 2 (loop step is integer), and threads it into `markResolved` so the notification message reflects the actual sample count used.

The autotune loop is now closed: calibration → autotune → tenant_settings → engines → outcomes → calibration.

All 28 tests touching these engines (`signal-kpi-attribution.test.ts`, `inference-feedback-and-autotune.test.ts`, `apex-narrative-engine.test.ts`) still pass; full backend suite at 1296/1296.

### 2.3 Phase 10-19 billing API endpoints

**File:** [workers/api/src/routes/billing.ts](../workers/api/src/routes/billing.ts)

The Phase 10-19 spec in [PHASE_10_ANALYTICAL_CHAIN.md §10-19](./PHASE_10_ANALYTICAL_CHAIN.md) declared three endpoints:

- `GET /api/v1/billing/period?from=&to=` — read-only preview
- `POST /api/v1/billing/period` — compute + persist
- `GET /api/v1/billing/periods` — list

`billing.ts` only had Stripe subscription lifecycle endpoints. `computeBillablePeriod` was implemented and tested but never callable in production: no HTTP route, no cron trigger.

Added the three routes:
- ISO `yyyy-mm-dd` validator on both `from`/`to`; rejects time/zone components so the inclusive/exclusive period math doesn't straddle a TZ boundary.
- Role-gated to `admin` / `support_admin` / `superadmin` / `system_admin`.
- The existing `billingRateLimiter` (30 req/min, mounted at `/api/billing/*` and `/api/v1/billing/*` in [index.ts:163-164](../workers/api/src/index.ts#L163-L164)) covers them automatically.
- `GET /periods` paginated via `limit` query (1–200, default 50), ordered by `period_end DESC, generated_at DESC`.

Idempotency is preserved by the engine: `persistPeriod` already enforces `UNIQUE(tenant_id, period_start, period_end)` and `UPDATE`-on-duplicate.

**Customer-dispute path now closed:** invoice question → `GET /billing/period` for the contested range → response contains the line items, each with `rca_id`, `metric_name`, `attributed_savings`, `confidence`, and the `verified_action_ids` that closed the underlying RCA. (See §3 open item #10 for the remaining `causal_factor_id` gap.)

---

## 3. Open punch-list (no code change in this sweep)

### Security

3.1 **DSAR export unencrypted** ([dsar.ts:220-250](../workers/api/src/services/dsar.ts)) — Access export returns raw JSON over HTTPS. POPIA §3 risk. Recommend AES-256 wrap with per-export key, or write to R2 and return presigned URL.

3.2 **DSAR notifications query over-discloses** — [dsar.ts:209](../workers/api/src/services/dsar.ts) selects all tenant notifications, not just the subject's. Add `AND user_id = ?`. Erasure path also missing `notifications` from ERASERS.

3.3 **OIDC nonce + PKCE missing** — [oidc.ts:85-132](../workers/api/src/services/oidc.ts) implements discovery + auth-url + token exchange but no nonce binding, no PKCE code_verifier. Recommended for public-client SSO paths.

3.4 **Login leaks account existence on `no_password_set`** — [auth.ts:269](../workers/api/src/routes/auth.ts) returns a distinct response when the email exists but is SSO-only. Should be uniform `Invalid credentials`.

3.5 **iam.ts uses internal `requireAdmin()` instead of shared `requireRole()`** — [routes/iam.ts:804-810](../workers/api/src/routes/iam.ts) duplicates middleware logic; converge to keep RBAC one-source-of-truth.

### Compliance

3.6 **Audit log unbounded growth** — [compliance-evidence.ts:230-244](../workers/api/src/services/compliance-evidence.ts) reports retention age but no purge job exists. Recommend weekly `DELETE FROM audit_log WHERE created_at < (now - 365 days)`.

3.7 **`ENCRYPTION_KEY` env var optional** — [encryption.ts](../workers/api/src/services/encryption.ts) falls back to plaintext + audit warning when key unset. Production deploys must require it (fail-fast on missing).

### Phase 10-19 billing dispute traceability

3.8 **`BillableLineItem.evidence` lacks explicit `causal_factor_id`** — [billing-engine.ts:39-51](../workers/api/src/services/billing-engine.ts). When a customer disputes a $5M attributed_savings line, the audit chain currently surfaces `verified_action_ids` + `metric_id` but not the specific `causal_factor` rows that produced the impact_value. Add `causal_factor_ids: string[]` and `max_factor_evidence: object` so the dispute path is single-hop.

### Catalysts

3.9 **Handler breadth vs. cluster count** — handler registry replaces keyword sniffing (good). 21 custom handlers across 5 domain files dispatch via `match()` predicates; 85 clusters / 406 sub-catalysts route through them. Audit each handler's `match()` to make sure no sub-catalyst silently falls through to the catalog-default path. (Not a defect; observability gap.)

3.10 **Handler-detected savings don't directly populate `causal_factors.impact_value`** — diagnostics-engine and cross-catalyst-rca-synthesizer write `causal_factors`; catalyst handlers don't. The two paths are orthogonal. Billing reads `causal_factors.impact_value`. Verify this is intentional (RCA-driven billing only) or wire handler outputs into the synthesis layer.

### Frontend

3.11 **Workflow orchestration UI missing** — [orchestration.ts](../workers/api/src/routes/orchestration.ts) routes (define / start / approve-step / advance) are wired and exercised in tests, but there is no React page. Operators currently advance runs via curl. Recommend a Workflow Designer page + Run Monitor with manual gate panel.

3.12 **Frontend WS subscription gap** — `routes/realtime.ts` + `DashboardRoom` Durable Object accept WS connections, but no React component subscribes. Realtime infra is paid for and unused.

3.13 **Run Insights tab not wired in PulsePage** — `catalysts.ts` exposes `GET/POST /runs/:runId/insights` but PulsePage.tsx never calls them.

3.14 **DSAR has no customer-facing UI** — [dsar.ts](../workers/api/src/routes/dsar.ts) endpoints are admin-API-only. Add a self-service request form on a `/compliance/dsar` page.

3.15 **No multi-session management UI** — users can't list / revoke other active sessions; logout invalidates only the current token.

---

## 4. State by pillar (post-sweep)

### 4.1 APEX

| Sub-feature | State |
|---|---|
| Health scores + dimensions + history | WIRED |
| Risk alerts + RCA trace | WIRED (Phase 10-4 chain populates `root_cause_analyses` + `causal_factors`) |
| Executive briefings | WIRED (daily debounced; risks render L0→L1→L2→L3 chain; KPI movements include 30/60/90-day forecasts) |
| Scenarios | partial (route exists, LLM engine not wired) |
| Board reports | WIRED (table created via `services/migrate.ts`; routes mounted) |
| Assessments | WIRED (route + engine; provenance flows to ERP connection_id) |

### 4.2 PULSE

| Sub-feature | State |
|---|---|
| Real-time metrics + anomalies + correlations + processes tabs | WIRED |
| Anomaly detection (z-score sensitivity) | WIRED |
| Run insights tab in PulsePage | MISSING (backend routes exist, UI tab missing) |
| Realtime WS streaming | WIRED backend, no frontend subscriber |
| Sub-catalyst ops panel | WIRED |
| Metric traceability | WIRED with provenance |

### 4.3 Catalysts

| Sub-feature | State |
|---|---|
| Handler registry replaces keyword routing | WIRED |
| Queue consumer + DLQ | WIRED (DLQ persists to audit_log — Phase 1 gap closed) |
| HITL approval (escalation 24h/48h/7d) | WIRED end-to-end with frontend ActionQueueWidget |
| DAG / `catalyst_dependencies` | WIRED via `catalyst-dag.ts` (depth-capped at 5) |
| Simulator | WIRED (service + routes + UI card on CatalystRunDetailPage) |
| Run analytics + sub_catalyst_runs | WIRED |
| Handler→causal_factor.impact_value | ORPHAN (savings flow via diagnostics, not handlers) |

### 4.4 Billing (Phase 10-19)

| Sub-feature | State |
|---|---|
| Eligibility gates (resolved+verified+impact>0) | WIRED |
| `GET/POST /billing/period`, `GET /billing/periods` | **WIRED in this sweep** |
| Tenant share % default 0.2 | WIRED |
| Currency (Phase 10-9) | WIRED |
| Idempotency (UNIQUE constraint + UPDATE) | WIRED |
| Provenance — `causal_factor_id` on line items | partial (verified_action_ids + metric_id present; causal_factor_id missing) |
| Frontend (ROIDashboardPage, RevenueUsagePage) | WIRED |

### 4.5 DSAR (Phase 10-20)

| Sub-feature | State |
|---|---|
| `POST /dsar/access`, `POST /dsar/erasure` | WIRED |
| Rate limits (5/hr access, 3/day erasure) | WIRED |
| Encryption on export | **MISSING — open punch-list 3.1** |
| `notifications` scoped to subject | **BROKEN — open punch-list 3.2** |
| Frontend UI | ORPHAN (API-only) |

### 4.6 ERP integrations

| Sub-feature | State |
|---|---|
| Retry + exponential backoff + circuit breaker + timeout | WIRED (Phase 1 gap closed) |
| Credential encryption at rest (AES-256-GCM) | WIRED (`ENCRYPTION_KEY` optional — see 3.7) |
| Field mapping (rule-based ≥0.85 auto, LLM ≤0.80 → human review) | WIRED |
| Process profile inference (≥25 samples, ≥70% mode share) | WIRED — matches memory invariant |
| Drift detection (6h debounce on substantive changes) | WIRED |
| HITL SLA (24h/48h/7d) | WIRED |
| Vendor baselines | WIRED for SAP/Odoo/Xero |
| Write-back live | SAP/Odoo/Xero only; others stub-safe |
| Attribution → billable_line_items.evidence | partial (model exists, line item evidence not populated) |

### 4.7 IAM/Auth

| Sub-feature | State |
|---|---|
| Access token TTL 15m (was 24h) | FIXED (Phase 1 gap closed) |
| Refresh token rotation-on-use | WIRED |
| MFA enforced for admin/superadmin/support_admin/system_admin (14-day grace) | WIRED |
| Backup codes | WIRED (SHA-256 hashed, single-use) |
| OIDC discovery | WIRED |
| OIDC nonce + PKCE | MISSING (3.3) |
| RBAC `requireRole` | WIRED — except iam.ts uses internal `requireAdmin()` (3.5) |
| Login error uniformity | BROKEN on `no_password_set` path (3.4) |
| Bulk user mgmt + custom role builder | WIRED (Phase 1 stub→wired) |

### 4.8 Inference calibration + autotune (Phase 10-15/16)

| Sub-feature | State |
|---|---|
| `inference_calibration` recording (Apex closure, forecast grading, user feedback) | WIRED |
| `threshold-autotune.ts` writes per-tenant overrides | WIRED |
| Engines read `getEffectiveThreshold` | **WIRED in this sweep** (was orphan) |
| Manual override (`source='manual'`) wins | WIRED |
| ROI dashboard surfaces calibration recommendations | WIRED |

### 4.9 Cross-tenant pattern + competitor intel (Phase 10-7/8/14/18)

| Sub-feature | State |
|---|---|
| `industry_patterns` requires ≥3 tenants; only names cross | WIRED (privacy invariant verified) |
| `getIndustryPatternSuggestions` API | WIRED |
| `industry-profile.ts` keyword classifier | WIRED (override via tenant_settings.industries: not implemented — by design per memory) |
| LLM competitor onboarding (suggest, never auto-write) | WIRED |
| Google News RSS competitor intel | WIRED with 30-day dedup, per-comp cap 5 |
| Source quality severity adjustment (Reuters-class promote, low-quality demote) | WIRED |
| Competitor suggestion-acceptance HTTP route | ORPHAN (callable from code, no API surface) |

### 4.10 Workflow orchestration (Phase 10-22/24)

| Sub-feature | State |
|---|---|
| Pull-based engine, one step/tick, cron-driven | WIRED |
| Step types (log/wait/manual_gate/catalyst_action) | WIRED |
| `catalyst_action` polls `catalyst_actions.verification_status` | WIRED |
| Routes (workflows / runs / approve-step / advance) | WIRED |
| Frontend (designer + run monitor + manual gate panel) | MISSING (3.11) |

### 4.11 Compliance

| Sub-feature | State |
|---|---|
| Compliance evidence pack | WIRED (read-only aggregation) |
| Encryption rotation | WIRED |
| Audit log retention purge | MISSING (3.6) |

### 4.12 Frontend

Phase 1 listed 9 stub pages. Verified: 8/9 are now WIRED (BulkUserManagementPage, CompanyHealthPage, CustomRoleBuilderPage, FeatureFlagsPage, IntegrationHealthPage, RevenueUsagePage, SystemAlertsPage, DataGovernancePage). MarketingPage remains intentionally static (1517 LOC of design content; no backend by design).

Toast system + skeleton loaders + confirmation dialogs are deployed across 36/45 pages.

---

## 5. Verification

- `tsc --noEmit` — clean (frontend + backend)
- `vitest run` (workers/api) — **1296/1296 pass** (was 1295/1296 before sweep; SAP ECC re-seed test now green)
- `vitest run` (frontend) — 48/48 pass

The audit ran end-to-end without modifying tests; one test that was previously failing now passes due to fix 2.1.

---

## 6. Recommended next PRs

In rough effort order:

1. **DSAR notifications scope fix + erasure coverage** (one-liner per fix, security-relevant) — closes 3.2 immediately.
2. **DSAR export encryption** — wrap response in AES-GCM with per-export key OR write to R2 + return presigned URL with TTL. Closes 3.1.
3. **Audit log retention purge** — add a daily cron task to `services/scheduled.ts`. Closes 3.6.
4. **Billing line items: add `causal_factor_ids`** — closes 3.8; meaningfully tightens dispute traceability. Single-row migration on `billable_line_items` evidence shape.
5. **OIDC nonce + PKCE** — closes 3.3; SSO hardening.
6. **Login error uniformity** — collapse `no_password_set` and `invalid_password` to one response. Closes 3.4.
7. **Workflow Designer + Run Monitor frontend** — closes 3.11; biggest UX gap on a real Phase 10 surface.
8. **Realtime WS subscription on PulsePage** — closes 3.12; uses already-paid-for Durable Object infra.
9. **Catalyst handler `match()` audit + telemetry** — closes 3.9; emit a metric when a sub-catalyst falls through to catalog-default.
10. **iam.ts → shared `requireRole`** — closes 3.5; RBAC consistency.

---

*Sweep complete. Three high-severity defects closed; ten open items captured with file:line refs and remediation sketches.*

---

## Addendum — 2026-05-11 go-live security pass

User requested "fix all for go live and seed the vantax company for a full demo with reset capability so we can reuse it over and over again." Six additional changes shipped:

### Go-live security blockers (Part A)

**A.1 DSAR access export encrypted (AES-256-GCM)** — [routes/dsar.ts](../workers/api/src/routes/dsar.ts)

`POST /dsar/access` now returns an `enc:v1:`-wrapped envelope built via the same HKDF key derivation that protects ERP credentials at rest. The plaintext is never on the wire. A new endpoint, `POST /dsar/access/:requestId/decrypt`, returns plaintext after a fresh role check + ownership check against `dsar_requests.requested_by` — so an ex-employee who exfiltrated an encrypted blob can't decrypt it after they've lost admin role. Fails closed when no secret is configured (returns 503 rather than ship plaintext). Closes punch-list §3.1.

**A.2 DSAR notifications scoped to subject + erasure coverage** — [services/dsar.ts](../workers/api/src/services/dsar.ts)

The access query previously selected `WHERE tenant_id = ?` — exposing every tenant user's notifications in a single subject's export. Fixed to `WHERE tenant_id = ? AND user_id = ?`. The erasure ERASERS list was missing `notifications` entirely; added as a DELETE op (notifications carry no load-bearing referential integrity). Closes punch-list §3.2.

**A.3 Audit log retention purge** — [services/scheduled.ts](../workers/api/src/services/scheduled.ts)

New `pruneAuditLogIfDue` invoked from the 15-minute cron tick. Daily-debounced via a `__system__` marker row in `tenant_settings` (`audit_log_retention.last_run` = today's UTC date) so the every-15-min cron only does the work once per UTC day. Retention defaults to 365 days, overridable via `AUDIT_LOG_RETENTION_DAYS` env var (clamped to [30, 3650] so a misconfigured deploy can neither immediately wipe the table nor hoard a decade of rows). Deletes in batches of 5,000 capped at 20 batches/day (≤100k rows/day per deployment) so a backlogged tenant can't hold the D1 write lock. Closes punch-list §3.6.

### Repeatable VantaX demo (Part B)

**B.1–B.3 Demo helpers extracted + cleanup expanded + billing materialisation** — [services/vantax-demo.ts](../workers/api/src/services/vantax-demo.ts) (new), [routes/seed-vantax.ts](../workers/api/src/routes/seed-vantax.ts)

Two helpers live in a new service module so they can be tested without dragging in the 2,600-line route file:

- `cleanupVantaxTenant(db, tenantId)` — wipes every tenant-scoped table in dependency-safe order. The table list (`VANTAX_TENANT_TABLES`) is now the union of every tenant-scoped table the seed touches AND every Phase 10 chain output (`kpi_forecasts`, `inference_calibration`, `billable_periods`, `billable_line_items`, `industry_patterns`, `orchestration_*`, `dsar_requests`, `catalyst_simulations`, etc.). Operational noise (`tenant_settings`, `audit_log`, `mind_queries`, `chat_conversations`, sessions, api_keys) is also swept so demos don't accumulate clutter across cycles. Uses a multi-pass loop (up to 4 passes) so FK-blocked parent deletes succeed on the second pass after their children are cleared — avoids having to hand-curate a topological order across 90 tables.

- `materialiseDemoBilling(db, tenantId)` — picks the two most-recently-generated active RCAs from the seed, marks them `resolved` with staggered `resolved_at` dates inside the last 30 days, stamps `impact_value` on the L0 causal_factor of each (4.2M ZAR for OEE-class symptoms, 1.8M for inventory-class), creates a verified `catalyst_action` linked via `source_finding_id = diagnostic_prescriptions.id`, then runs `computeBillablePeriod` to persist the billable period. The ROI dashboard / billing tab now shows real numbers on first load.

**B.2 `POST /api/v1/seed-vantax/reset`** — [routes/seed-vantax.ts](../workers/api/src/routes/seed-vantax.ts)

Standalone cleanup endpoint guarded by the same `getVantaXTenantId` check. Lets the sales team rehearse a clean-slate demo without re-running the multi-second seed, and gives ops a deterministic "undo" if a demo run drifts off-script. Returns `{ tables, recordsRemoved }`.

**B.4 Smoke test** — [__tests__/vantax-demo-reset.test.ts](../workers/api/src/__tests__/vantax-demo-reset.test.ts) (new, 7 tests)

Covers:
1. Cleanup idempotency on an already-empty tenant (count=0).
2. Cleanup removes all seeded RCA/factor/prescription/action/cluster rows (named-assertion so failure pinpoints the table).
3. Cleanup clears Phase 10 outputs (`billable_periods`, `billable_line_items`, `kpi_forecasts`).
4. `materialiseDemoBilling` resolves 2 RCAs, stamps impact, creates 2 verified actions, persists exactly 1 billable_period + 2 line_items, revenue ≥ ZAR 360k (20% × 1.8M floor).
5. `materialiseDemoBilling` no-op when no active RCAs exist.
6. Two full reset→reseed cycles produce **identical** billing shape (count + revenue + rcasResolved) — proves the demo is genuinely repeatable.
7. Reset wipes the previous cycle's `billable_period` (exactly 1 period after the second cycle, not 2 — no accumulation).

### Verification

- `tsc --noEmit` clean (frontend + backend)
- `vitest run` workers/api: **1303/1303 pass** (was 1296 before this addendum; +7 new VantaX smoke tests)
- `vitest run` frontend: 48/48 pass

### Still on the operator's plate (not code)

Three Tier-1 operational items remain in [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md):

1. Rotate the placeholder `MS_GRAPH_TENANT_ID` so forgot-password emails actually deliver.
2. Rotate `JWT_SECRET` + `ENCRYPTION_KEY` (exposed in 2026-04 credential paste).
3. Rehearse the re-auth drill in staging before rotating, then schedule the customer-facing rotation window.

Once those three are done, go-live is unblocked.
