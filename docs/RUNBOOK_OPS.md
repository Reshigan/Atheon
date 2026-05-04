# Operational Runbook

For platform operators (not customers). Covers the 5 most common
incidents on Atheon's Cloudflare Workers + D1 deployment.

## 1. Cron tick is silent / overran 30-min deadline

Symptom: `audit_log` has no `scheduled.run.start` entry for the last
hour.

Diagnosis:
```bash
# Per-tenant counts (where the cron spends its time)
wrangler d1 execute atheon-db --remote --command \
  "SELECT COUNT(*) FROM tenants WHERE status='active'"

# How long the chain took on each tenant last run
wrangler tail --format json | grep phase_10.chain_completed | head -20
```

Resolution:
- **<5 active tenants**: chain runs inline (Phase 10-21 fan-out
  threshold). Should always finish in <60s.
- **≥5 tenants**: chain fans out via `CATALYST_QUEUE`. Verify queue is
  draining:
  ```bash
  wrangler tail --format json | grep analytics_fanout | head -10
  ```
  If `enqueued` > 0 but `handleQueueMessage` not firing, queue consumer
  is broken. Restart by re-deploying the worker.
- **Per-tenant timeout**: a single tenant taking >5 min suggests a
  large `process_metric_history` that should be archived. Run:
  ```sql
  DELETE FROM process_metric_history
   WHERE tenant_id = ? AND recorded_at < datetime('now', '-180 days');
  ```

## 2. Queue backed up / DLQ filling

Symptom: `catalyst-dlq` has messages.

Diagnosis:
```bash
wrangler queues list
# Check pending depth
```

Resolution:
- DLQ messages are inspected by `handleDlqMessage` in scheduled.ts;
  they record to `audit_log` with action `queue.dlq.received`
- Patch the underlying bug (likely a step throwing in
  `runPhase10ChainForTenant`); re-deploy
- Optionally re-drive the DLQ messages back to the main queue once
  the fix lands

## 3. Migration failed / partial schema

Symptom: customer reports `D1_ERROR: no such table: <X>` in API errors.

Diagnosis:
```bash
wrangler d1 execute atheon-db --remote --command \
  "SELECT version FROM kv_migrations WHERE id='current' LIMIT 1"
```

Should return the latest `MIGRATION_VERSION` from
`workers/api/src/services/migrate.ts` (currently `v73-orchestration`
as of go-live).

Resolution:
- Run `POST /api/v1/admin/migrate` with the SETUP_SECRET header — it
  uses `CREATE TABLE IF NOT EXISTS` so it's safe to re-run
- If a specific table is missing, check migrate.ts for typos in the
  CREATE statement; bump version and redeploy

## 4. RCA closure storming / many false positives

Symptom: customer feedback says "you keep telling me my margin
recovered when it didn't".

Diagnosis:
```sql
SELECT gate_name, outcome, COUNT(*) as n FROM inference_calibration
 WHERE tenant_id = ?
 GROUP BY gate_name, outcome;
```

If `false_positive` rate on `rca_closure.min_recovery_samples` > 30%,
the gate is too loose for this tenant.

Resolution: autotune sweeps daily; manual override available:
```bash
# Tighten via tenant_settings — survives autotune
curl -X POST .../api/v1/admin/threshold \
  -d '{"gate":"rca_closure.min_recovery_samples","value":5}'
```

## 5. EIA / Open-Meteo / Google News API down

Symptom: `external_signals.eia.fetch_failed` / `open_meteo.fetch_failed`
log entries.

Resolution:
- All sources are best-effort. A failed source returns `null` and the
  rest continue. Customer-facing impact: that one signal will be
  missing from new attributions until the upstream recovers
- For repeated EIA failures, verify `EIA_API_KEY` is still valid:
  ```bash
  wrangler secret list | grep EIA_API_KEY
  ```
- Open-Meteo is keyless; Google News RSS is keyless — both are public
  endpoints with their own SLAs

## 6. DSAR erasure misfire / panic recovery

If an erasure ran on the wrong subject:

```sql
-- The subject's user row is anonymised (status='deleted', email='erased+...')
-- but rows in audit_log / mind_queries / run_comments are also anonymised
-- with user_id='[erased]' — which means the original user_id is GONE.
SELECT * FROM dsar_requests WHERE id = ?;
```

The audit row carries the original `subject_identifier`. The user row
itself is recoverable via D1 time-travel (Cloudflare D1 retains 30 days):

```bash
wrangler d1 time-travel --bookmark <pre-erasure-timestamp> atheon-db
```

Restoring the user row does NOT un-anonymise the audit_log entries.
That's by design — the audit trail of the erasure itself is what
proves compliance.

## 7. Production password reset

(Not really a runbook entry — but documenting the proven path.)

```bash
HASH=$(node -e "
const c = require('crypto');
c.pbkdf2('NEW_PASSWORD', c.randomBytes(16), 100000, 32, 'sha256', (e, k) => {
  // ... format pbkdf2:100000:saltB64:hashB64
});
")
wrangler d1 execute atheon-db --remote --command \
  "UPDATE users SET password_hash = '$HASH' WHERE email = ?"
```

Always confirm the user's role first (`SELECT role FROM users WHERE
email = ?`) so an attacker compromising operator credentials doesn't
silently elevate themselves.
