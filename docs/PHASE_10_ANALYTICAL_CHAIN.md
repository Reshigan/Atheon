# Phase 10 — Analytical Chain Reference

This document explains how Atheon's analytical chain takes raw ERP data
and produces the Apex executive narrative + the shared-savings billing
that follows. It's written for two audiences:

1. **Customer success / sales** — explaining what the platform does end-to-end
2. **Operators** — when something on a screen looks wrong, this is the map of which sweep produced it

---

## The chain at a glance

```
process_metric_history (your ERP KPIs over time)
        +
external_signals.history (FX, Brent, weather, competitor news, regulatory)
        ↓
[10-1] correlation_events           ← internal KPI ↔ KPI co-movement
[10-3] signal_impacts               ← external signal → KPI attribution (lag-sweep)
        ↓
[10-4] root_cause_analyses + causal_factors  ← deterministic L0–L3 chain
        ↓
[10-5] closeRecoveredRcas + generateApexNarrative
        ↓
executive_briefings (risks, kpi_movements with forecasts, opportunities)
        ↓
[10-19] billable_periods + billable_line_items  ← shared-savings invoice
```

Each layer is wired in `services/scheduled.ts` per-tenant block, runs
daily, and is best-effort (one failure doesn't abort the rest).

---

## Layer-by-layer

### 10-1 — Metric correlation (`metric-correlation-engine.ts`)

For each tenant, walks every pair of `process_metrics` and computes
Pearson r over their `process_metric_history`. Persists pairs with
**|r| ≥ 0.7** over **≥ 14 daily buckets** to `correlation_events`.

Substrate for cross-catalyst RCA synthesis (10-4).

### 10-2 — External signal ingestion (`external-signals-feed.ts`)

Pulls from public APIs:

| Source | Coverage | Auth |
|---|---|---|
| `frankfurter.fx` | USD/EUR/GBP → ZAR | keyless |
| `eia.brent` | Brent crude spot | requires `EIA_API_KEY` (no-op when missing) |
| `open-meteo.weather` | JHB + Cape Town daily | keyless |

Industry-aware (Phase 10-7): each tenant only persists signals their
inferred industry profile cares about. Stored in
`external_signals.raw_data.history` as a 30-day rolling window.

### 10-3 — Signal → KPI attribution (`signal-kpi-attribution.ts`)

Joins each tenant's external_signals to process_metric_history with a
**0–7 day lag sweep**, computes Pearson r per shifted alignment, picks
the strongest. Persists significant joins to `signal_impacts`.

**Strong-inference gates:**
- ≥ 10 paired observations after lag alignment
- |r| ≥ 0.6 (auto-tunable per Phase 10-16)
- |signal_delta_pct| ≥ 5%
- 7-day per-pair debounce

The KPI's direction (`higher_better` | `lower_better`) is resolved per
Phase 10-6 cascade: customer declaration on `sub_catalyst_kpi_definitions`
→ threshold-ordering inference → canonical-dimension hint → default.

### 10-4 — Cross-catalyst RCA synthesizer (`cross-catalyst-rca-synthesizer.ts`)

For each red KPI, deterministically composes a causal chain:

| Layer | Source |
|---|---|
| **L0** symptom | the red metric itself |
| **L1** direct external drivers | `signal_impacts.analysis.metric_id == symptom.id` |
| **L2** cross-metric drivers | `correlation_events` where the metric is on either side |
| **L3** transitive external drivers | `signal_impacts` on each L2 peer |

Persists to `root_cause_analyses` + `causal_factors`. Each factor
carries a quantified financial impact (Phase 10-10) when the metric's
unit is monetary or the tenant has set `monthly_revenue_base`.

### 10-5 — RCA closure + Apex narrative (`apex-narrative-engine.ts`)

`closeRecoveredRcas` — when a red metric has held a non-red status
across the last **3 history points**, mark its RCA `resolved` +
notify. Direction inferred from threshold ordering (works for
defect-rate-style lower-better metrics too).

`generateApexNarrative` — once-per-day per tenant, distils active
RCAs into one `executive_briefings` row:
- **risks** = causal chains rendered as `"Symptom ← Driver1 ← Driver2"`
- **kpi_movements** = symptom values + 30/60/90-day forecasts (Phase 10-11)
- **opportunities** = recently-resolved RCAs (recovery wins)

### 10-6 — KPI-agnostic classification (`kpi-classification.ts`)

Reads `sub_catalyst_kpi_definitions.direction` first; falls back to
threshold inference; canonicalises domain → dimension. Means the
chain works for arbitrary customer KPIs in arbitrary domains, not
just the demo set (procurement / finance / etc.).

### 10-7 — Industry profile inference (`industry-profile.ts`)

Derives a tenant's industry mix from `process_metrics.domain`,
`sub_catalyst_kpi_definitions.category`, `catalyst_clusters.domain`.
Each external-signal source declares which industries it's relevant
to — the cron only persists matching readings per tenant.

### 10-8 — Competitor intelligence (`competitor-intel-source.ts`)

For each row in `competitors`, queries Google News RSS, runs the
`competitor-strategy-classifier` deterministic regex matcher, persists
to `radar_signals` with `signal_type='competitor'` + a strategy
category (pricing / product_launch / market_expansion / hiring /
funding_or_ma / partnership / trouble / general).

### 10-9 — Tenant currency (`tenant-currency.ts`)

Resolution chain:
1. `tenant_settings.currency` (customer-declared)
2. `tenants.region` → ISO mapping (af-* → ZAR, eu-* → EUR, etc.)
3. Default ZAR

Threaded through RCA `impact_unit`, billing currency, LLM prompts.

### 10-10 — Financial impact quantifier (`financial-impact-quantifier.ts`)

```
impact ≈ metric_base × |signal_delta_pct|/100 × |correlation|
```

Where `metric_base` = `metric.value` when monetary, else
`tenant_settings.monthly_revenue_base`, else null (we'd rather print
no number than a fabricated one). Substrate for Phase 10-19 billing.

### 10-11 — KPI forecasting (`kpi-forecasting.ts`)

Linear-trend projection at 30/60/90 days with confidence bands that
widen by `√(horizon / historyLength)`. R² < 0.2 → flagged
`low_confidence`. Embedded in every Apex briefing's `kpi_movements`.

### 10-12 — Regulatory feed (`regulatory-feed.ts`)

Industry-aware pull of SARS / SARB / FSCA / JSE / SAHPRA / DMRE / NRCS
/ ICASA via Google News RSS. Persists to existing `regulatory_events`
table.

### 10-13 — Prescription ranker (`prescription-ranker.ts`)

```
priority_score = impact × confidence / effort_weight
```

Pure read-time ranking of `diagnostic_prescriptions` rows. UI sorts
by `priority_score`; underlying rows untouched (re-tuning weights
needs no migration).

### 10-14 — Source quality + LLM competitor onboarding

Source-quality registry adjusts severity per outlet (Reuters-class
promotes 'info' → 'warning' on trouble; low-quality demotes
'critical' → 'warning').

LLM-assisted onboarding suggests competitors based on inferred
industry profile. Suggestions returned for explicit acceptance — Atheon
never auto-writes.

### 10-15 → 10-16 — Calibration loop + threshold autotune

`inference_calibration` records every gate outcome (true_positive on
RCA closure; false_positive on user feedback via
`POST /api/v1/inferences/feedback`). The autotune sweep adjusts
per-tenant overrides in `tenant_settings.inference_threshold:{gate}`
when FP rate > 30% or FN rate > 50% with sample ≥ 25.

Manual overrides (set via `setManualThreshold`) always win.

### 10-17 — Forecast accuracy tracking

Every forecast emitted by 10-11 is persisted to `kpi_forecasts` with
a `target_date`. On the next cron tick after target_date elapses,
graded against actual. `within_band` is the success criterion. Stats
exposed at `GET /api/v1/insights-stats/forecast-accuracy`.

### 10-18 — Cross-tenant pattern discovery

When ≥ 3 tenants in the same industry have the same external-driver →
KPI attribution, persisted to `industry_patterns`. New tenants in
that industry can be seeded with expected attributions on day 1
(API: `getIndustryPatternSuggestions`).

Privacy: only NAMES (signal_key, normalised metric, industry) cross
tenants — no per-tenant values. supporting_tenant_count bounded ≥ 3
so no single tenant can be deanonymised.

### 10-19 — Shared-savings billing engine

Eligibility (a resolved RCA contributes iff):
1. `status='resolved'` AND `resolved_at` within period
2. ≥ 1 verified `catalyst_action` linked via `diagnostic_prescriptions`
3. `impact_value > 0` on at least one `causal_factor`

Per-tenant share via `tenant_settings.billing_share_pct` (default 0.2 = 20%).

Routes:
- `GET /api/v1/billing/period?from=&to=` (read-only preview)
- `POST /api/v1/billing/period` (compute + persist)
- `GET /api/v1/billing/periods` (list)

### 10-20 — POPIA / GDPR DSAR

- `POST /api/v1/dsar/access` — admin or self; full export across users + audit_log + mind_queries + chat_conversations + run_comments + api_keys + notifications
- `POST /api/v1/dsar/erasure` — admin only; cascading delete (sessions/keys/tokens) + anonymise (audit_log, users) preserving referential integrity

Rate-limited per Phase 10-25:
- DSAR access: 5 / hour
- DSAR erasure: 3 / day

### 10-21 — Queue-based fan-out

When `CATALYST_QUEUE` is bound AND ≥ 5 tenants, the cron tick enqueues
one `analytics_sweep` message per tenant; the queue consumer processes
in parallel. Below the threshold, runs inline. Each step is idempotent
so queue redelivery is safe.

### 10-22 → 10-24 — Multi-step orchestration + catalyst_action

Workflows define a sequence of `WorkflowStep`s (`log` / `wait` /
`manual_gate` / `catalyst_action`). Pull-based engine — cron sweeps
active runs, advances each by ONE step per tick.

`catalyst_action` calls `executeTask` from `catalyst-engine` and polls
`catalyst_actions.verification_status` until `verified` (step
completes) or `failed` (run fails).

### 10-23 — ROI / Insights dashboard

`GET /roi-dashboard` (executive roles) renders four cards:
- shared-savings billing summary
- forecast accuracy (within-band rate + median |error| % per horizon)
- inference calibration recommendations (per gate)
- DSAR audit (counts by type / status)

Backed by `GET /api/v1/insights-stats/*` endpoints.

### 10-26 → 10-27 — SAP ECC demo seed + dashboard validation

`POST /api/v1/admin/seed-sap-ecc-demo` (gated on `SETUP_SECRET`,
idempotent) creates a fully-populated tenant for repeatable deploy
verification. Tests in `dashboard-data-accuracy.test.ts` validate
that the actual SQL Apex/Pulse routes run returns the seeded data
correctly.

---

## Cron schedule (production)

`wrangler.toml` configures cron triggers; `handleScheduled` runs every
15 minutes. The Phase 10 chain (`runPhase10ChainForTenant`) is daily-
debounced internally — running multiple times a day is safe and a
no-op for steps that have already produced their daily output.

Per-tenant chain duration on the SAP ECC demo: ~3.35 seconds.
At 100 tenants × ~17 sweeps each, queue-based fan-out (10-21) ensures
the 30-minute Workers cron deadline is not at risk.

---

## Common questions

- **"Why didn't this RCA produce a chain?"** — see `runbook-rca.md`
- **"Cron didn't run on schedule"** — see `runbook-ops.md`
- **"How is the impact_value computed?"** — Phase 10-10 above; the
  `evidence` JSON on each `causal_factor` shows the inputs
- **"Why is my industry tagged wrong?"** — `industry-profile.ts`
  derives from `domain` strings; rename your KPI domain to one of
  the canonical industry slugs (mining / agriculture / fmcg / etc.)
  or override via `tenant_settings.industries`
