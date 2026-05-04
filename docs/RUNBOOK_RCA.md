# Runbook — "Why didn't this RCA produce a chain?"

When a customer points at a red KPI and says "Atheon should be telling
me what's wrong" — this is the diagnostic flow.

## Step 1: Was the chain actually invoked?

```sql
SELECT * FROM root_cause_analyses
 WHERE tenant_id = ? AND metric_id = ?
 ORDER BY generated_at DESC LIMIT 5;
```

- **Empty** → the chain never tried. Most common cause: KPI not red. Check:
  ```sql
  SELECT status, value, threshold_red, threshold_amber, threshold_green
    FROM process_metrics WHERE tenant_id = ? AND id = ?;
  ```
  If `status` is amber/green, the synthesizer skips it (intentional — keep the surface free of low-stakes noise).
- **Has a row** with `status='active'` → chain ran, see step 2.
- **Has a row** with `status='resolved'` → metric recovered; that's why you don't see one currently.

## Step 2: Did it have evidence to chain?

```sql
SELECT layer, factor_type, title, confidence, impact_value
  FROM causal_factors
 WHERE rca_id = ?
 ORDER BY layer ASC;
```

- Just an `L0` symptom row → the synthesizer fired but found no L1/L2/L3 drivers; it skipped persistence (≥2 drivers required).
  Check substrate:
  ```sql
  SELECT COUNT(*) FROM signal_impacts
    WHERE tenant_id = ? AND analysis LIKE ?;
  -- and
  SELECT COUNT(*) FROM correlation_events
    WHERE tenant_id = ? AND (metric_a = ? OR metric_b = ?);
  ```
  If both are zero → Phase 10-1 / 10-3 had nothing to attribute. Most common: <14 days history.

## Step 3: Why was attribution skipped?

```sql
-- Phase 10-3 needs ≥10 paired observations, |r|≥0.6, signal Δ≥5%
SELECT COUNT(*) FROM process_metric_history
 WHERE tenant_id = ? AND metric_id = ?;
```

- < 10 → too sparse; chain can't produce signal_impacts. Wait for more samples or backfill from ERP.

```sql
-- Check the raw signal histories
SELECT json_extract(raw_data, '$.history') FROM external_signals
 WHERE tenant_id = ? LIMIT 1;
```

- Empty `history` → cron didn't run sweepExternalSignals, or the upstream API was down. Check `external_signals.detected_at`.

## Step 4: Why did the RCA close?

If `status='resolved'`, look at:

```sql
SELECT resolved_at, metric_name FROM root_cause_analyses WHERE id = ?;
SELECT value, recorded_at FROM process_metric_history
 WHERE tenant_id = ? AND metric_id = ?
 ORDER BY recorded_at DESC LIMIT 5;
```

Closure rule: 3 consecutive history points at non-red status. If you
see the metric flicker red again within 24h, the closure was premature
— record `false_positive` feedback so autotune tightens
`rca_closure.min_recovery_samples`:

```bash
curl -X POST .../api/v1/inferences/feedback \
  -H "Authorization: Bearer <token>" \
  -d '{"inference_type":"rca","reference_id":"<rca_id>","verdict":"incorrect","notes":"resolved prematurely"}'
```

## Step 5: Is the cron even running?

```sql
SELECT * FROM audit_log
 WHERE tenant_id = 'global' AND action LIKE 'scheduled.%'
 ORDER BY created_at DESC LIMIT 10;
```

Look for `scheduled.run.start` and `phase_10.chain_completed` entries
with timestamps in the last 24h. If absent → cron deadline exceeded
or worker crashed. Check `docs/RUNBOOK_OPS.md`.

## Common false-negative patterns

| Pattern | Diagnosis |
|---|---|
| KPI red, lots of history, no driver | Underlying signals don't actually correlate with this KPI |
| KPI red, < 14 days history | Phase 10-1 needs more samples |
| KPI red, no Brent attribution | Tenant industry profile doesn't include physical-economy industries; Brent source skipped per Phase 10-7 |
| Same RCA closes/reopens daily | `rca_closure.min_recovery_samples` too low for this tenant — feedback to tighten |
| Forecasts missing | <10 history points; emit forecasts on metrics with longer history first |
| No financial impact | Metric isn't monetary AND `tenant_settings.monthly_revenue_base` not set |

## Forcing a re-run for diagnosis

```bash
# Run the full chain on a tenant manually (sweeps idempotent)
curl -X POST .../api/v1/admin/seed-sap-ecc-demo \
  -H "X-Setup-Secret: <SETUP_SECRET>" \
  -d '{"tenant_id":"<tenant>","run_chain":true}'
```

Returns `chain_result.steps[]` with per-step ok/durationMs + error
strings, so you can see exactly which step failed.
