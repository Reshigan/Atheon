# Atheon Analytical Chain

This document explains how Atheon turns raw ERP data into the narrative
that lands in your executive briefing. It's intended for customer
admins, support, and sales engineers who need to explain *why* a
particular RCA showed up — or why one didn't.

## The chain at a glance

```
ERP / catalyst runs
       │
       ▼
process_metric_history (daily KPI samples)
       │
       ├── Phase 10-1 ───── correlation_events  (metric ↔ metric, |r|≥0.7, n≥14)
       │
       │   ┌── Phase 10-2 ── external_signals  (FX / Brent / weather)
       │   │
       ▼   ▼
   Phase 10-3 ─────── signal_impacts  (signal → KPI lag-sweep, |r|≥0.6, Δ≥5%)
       │
       ▼
   Phase 10-4 ─────── root_cause_analyses + causal_factors
                       (L0 symptom + L1 external + L2 cross-metric + L3 transitive)
       │
       ├── Phase 10-5 ── closeRecoveredRcas  (3 consecutive non-red samples → resolved)
       │
       ▼
   Phase 10-5 ─────── executive_briefings  (Apex narrative; daily debounce)
       │
       ├── Phase 10-10 — financial impact ($ amount per causal factor)
       ├── Phase 10-11 — kpi_forecasts (30/60/90 days, linear trend)
       ├── Phase 10-15 — inference_calibration (TP/FP per gate)
       ├── Phase 10-16 — autotune_thresholds (per-tenant)
       └── Phase 10-19 — billable_periods (verified action × resolved RCA × impact)
```

## What each layer requires (so you know when one didn't fire)

| Layer | Trigger | Minimum input | What can break it |
|---|---|---|---|
| Metric correlation | red metric in `process_metrics` | ≥14 daily history points | Insufficient history; |r|<0.7 |
| Signal attribution | external_signal with history | ≥10 paired observations after lag-shift | Signal moved <5%; |r|<0.6 |
| Cross-catalyst RCA | red KPI + correlation_events / signal_impacts | ≥2 distinct causal factors | Symptom not red; thin chain; 24h debounce |
| RCA closure | resolved metric + 3 consecutive non-red samples | thresholds set on the metric | Metric still red; thresholds missing |
| Apex narrative | active RCA OR recent recovery | (none beyond an RCA or recovery) | Daily debounce within 20h |
| Forecast | metric history | ≥10 points | Insufficient history |
| Billing | resolved RCA + verified action + impact_value | all three | Missing any one |

## Strong-inference policy

Atheon prefers false negatives over false positives. Concretely:
- Every gate has a minimum sample size (≥10 paired observations, ≥3 tenants for cross-tenant patterns, ≥25 for autotuning)
- Thresholds default conservative (|r|≥0.6 attribution, ≥3 consecutive samples for RCA closure)
- Customer feedback (`POST /api/v1/inferences/feedback verdict='incorrect'`) tightens the gate over time

When in doubt the platform stays silent — better than narrating a wrong story.

## How to validate the chain on your tenant

```bash
curl -X POST https://atheon-api.vantax.co.za/api/v1/admin/seed-sap-ecc-demo \
  -H "X-Setup-Secret: <SETUP_SECRET>" \
  -d '{"tenant_id":"demo-sap-ecc","run_chain":true}'
```

Returns the seed result + a structured `chain_result` showing per-step
duration and ok/fail flags. If any step shows `ok: false`, hit the
runbook (`docs/RUNBOOK_RCA.md`) for diagnosis.

## Reading an Apex briefing

```json
{
  "title": "Apex weekly briefing — Gross Margin %",
  "summary": "Apex narrative — 1 active causal chain under investigation. Top symptom: Gross Margin % ← Brent crude spot price driving Gross Margin % (headwind) ← Procurement Input Cost co-moves with Gross Margin %.",
  "risks": [
    {
      "metric": "Gross Margin %",
      "status": "red",
      "causal_chain": "Gross Margin % ← Brent crude spot price ← Procurement Input Cost",
      "drivers": ["Brent crude +22% with r=0.88", "Procurement Input Cost co-moves r=0.81"],
      "confidence": 87
    }
  ],
  "kpi_movements": [
    {
      "metric": "Gross Margin %",
      "value": 12.0, "unit": "pct", "status": "red",
      "forecast": [
        {"horizon_days": 30, "value": 9.4, "lower": 8.1, "upper": 10.7, "low_confidence": false},
        {"horizon_days": 60, "value": 6.8, "lower": 4.9, "upper": 8.7, "low_confidence": false},
        {"horizon_days": 90, "value": 4.2, "lower": 1.7, "upper": 6.7, "low_confidence": false}
      ]
    }
  ],
  "opportunities": []
}
```

## Configuration knobs (per tenant)

All in `tenant_settings` table; admin UI surfaces these:

| Key | Default | What it controls |
|---|---|---|
| `currency` | `ZAR` (or region default) | RCA `impact_unit`, LLM prompt currency |
| `monthly_revenue_base` | (unset) | Fallback base for impact estimation when metric isn't monetary |
| `billing_share_pct` | `0.2` | Atheon's share of realised savings |
| `competitor_source_overrides` | `{}` | Per-domain news source quality overrides |
| `inference_threshold:<gate>` | (autotuned) | Manual threshold pin |

## Where to look when something is off

- **No RCA on a red KPI**: check `causal_factors_count` — needs ≥2 drivers; Phase 10-1 + 10-3 must produce evidence first
- **No Apex briefing**: 20h debounce; check `executive_briefings.generated_at` for last entry
- **Forecast missing**: <10 history points
- **Wrong currency in briefing**: `tenant_settings.currency` not set, falling back to region (`af-south-1` → ZAR)
- **No competitor news**: tenant has no `competitors` rows; use `POST /api/v1/competitor-onboarding/suggest` to seed
- **No regulatory feed**: tenant industry profile didn't match any regulator's `applicableTo`; check inferred industry via `inferTenantIndustryProfile`

For deep ops issues see `docs/RUNBOOK_OPS.md`.
