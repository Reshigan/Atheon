# Runbook — "Why didn't this RCA produce a chain?"

A customer reports a red KPI but Atheon hasn't surfaced an RCA, or
the RCA exists but only has L0 (the symptom) and no L1/L2/L3 drivers.
This runbook walks through the diagnostic checks in order.

## 1. Confirm the symptom is actually red

```sql
SELECT id, name, value, status, threshold_red, threshold_amber, threshold_green
  FROM process_metrics
 WHERE tenant_id = ? AND id = ?;
```

The Phase 10-4 synthesizer ONLY runs for `status='red'` symptoms
(amber/green are excluded by design — to keep the surface free of
low-stakes noise). If you expect amber/green RCAs, flag this on a
roadmap item; current behaviour is intentional.

## 2. Check the debounce window

```sql
SELECT generated_at, status FROM root_cause_analyses
 WHERE tenant_id = ? AND metric_id = ?
 ORDER BY generated_at DESC LIMIT 5;
```

Phase 10-4 has a **24-hour per-metric debounce**. If an active RCA
exists within 24 hours, the synthesizer skips. Consumers see the
existing RCA, not a new one.

## 3. Check whether ≥ 2 causal factors were available

The synthesizer requires **≥ 2 distinct drivers** (L1 OR L2 OR L3)
before persisting — otherwise the chain reduces to "L0 plus nothing"
and adds no value. Skipped runs are logged at
`cross_rca.synthesis_completed` with `symptomsSkippedThin > 0`.

Query the substrate:

```sql
-- Phase 10-3 attributions for this metric
SELECT analysis FROM signal_impacts
 WHERE tenant_id = ? AND analysis LIKE '%"metric_id":"<metric_id>"%';

-- Phase 10-1 correlations on this metric
SELECT metric_a, metric_b, correlation_type, confidence
  FROM correlation_events
 WHERE tenant_id = ? AND (metric_a = ? OR metric_b = ?);
```

If both queries return zero rows: there's no substrate yet. The chain
needs **≥ 14 days of metric history** (Phase 10-1) and **≥ 10 paired
observations** with an external signal (Phase 10-3).

## 4. Check the strong-inference gates

| Gate | Threshold | Per-tenant override key |
|---|---|---|
| `signal_attribution.min_correlation` | 0.6 default | `inference_threshold:signal_attribution.min_correlation` |
| `signal_attribution.min_signal_delta_pct` | 5 default | `inference_threshold:signal_attribution.min_signal_delta_pct` |
| `metric_correlation.min_correlation` | 0.7 default | `inference_threshold:metric_correlation.min_correlation` |

Per-tenant overrides:

```sql
SELECT key, value FROM tenant_settings
 WHERE tenant_id = ? AND key LIKE 'inference_threshold:%';
```

Phase 10-16 auto-tuner will tighten gates if user feedback (via
`/api/v1/inferences/feedback`) reports many false positives. To
manually loosen a gate:

```sql
INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
VALUES (
  randomblob(16), '<tenant>',
  'inference_threshold:signal_attribution.min_correlation',
  '{"value": 0.5, "source": "manual", "updated_at": "...", "recommendation": "manual override"}',
  datetime('now'));
```

The `source: 'manual'` flag prevents the auto-tuner from overriding
this on the next sweep.

## 5. Check the chain ran at all

```sql
SELECT * FROM root_cause_analyses
 WHERE tenant_id = ? ORDER BY generated_at DESC LIMIT 1;
```

If the most recent RCA is days old, the cron may not have run.
See `runbook-ops.md` for cron diagnostics.

## 6. Check the financial impact didn't get filtered

Phase 10-10 returns `null` for `impact_value` when:

- The metric's unit isn't monetary (e.g. 'pct', 'days', 'count'); AND
- `tenant_settings.monthly_revenue_base` is not set

The RCA still gets persisted; the causal_factor's `impact_value` is
just null. Apex briefing renders without the "≈ R1.8M" suffix.

To enable monetary anchoring on a percentage-style KPI:

```sql
INSERT OR REPLACE INTO tenant_settings (id, tenant_id, key, value, updated_at)
VALUES (randomblob(16), '<tenant>', 'monthly_revenue_base',
        '5000000', datetime('now'));
```

## 7. Last-resort: re-run the chain manually

```bash
wrangler d1 execute atheon-db --remote --command \
  "SELECT id, status FROM tenants WHERE id = '<tenant>'"
```

Then trigger via the demo seed admin endpoint (or a custom cron one-off).

If on a hybrid/on-prem deploy, exec into the worker container and call
`runPhase10ChainForTenant(db, tenantId)` directly via the worker's REPL.

---

## Common patterns we've seen

- **"All my metrics are amber, no RCAs"** — by design. Phase 10-4
  only fires on red. Either tighten your thresholds (so amber
  becomes red) or treat this as expected.
- **"RCA shows L0 only"** — substrate missing. Most often: external
  signals haven't been pulled yet (check `external_signals` row count
  for the tenant) OR metric history < 14 days.
- **"RCA has factors but no impact_value"** — non-monetary metric +
  no tenant base. Phase 10-10 fix above.
