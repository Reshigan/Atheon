# Runbook — ERP Write-Back Stack

Operator runbook for the action-layer real-write chain shipped in
PRs #374 → #383. Companion to [RUNBOOK_OPS.md](RUNBOOK_OPS.md) (general
platform ops) and [runbook.md](runbook.md) (deploy / rollback / DB).

This runbook only covers the write-back path: AP / AR / GL transactional
actions getting dispatched into Odoo / Xero / NetSuite / SAP from the
Phase 10 chain. If your incident is upstream of dispatch (cron tick
silent, Phase 10 chain failing, KPI freshness alarms), use the general
ops runbook first.

## Architecture in 30 seconds

```
Phase 10 chain
  └─> runTransactionalSubcatalystsForTenant({ encryptionKey })
        ├─> AP/AR/GL subcatalysts stage rows in transactional_actions
        └─> executePendingActions({ encryptionKey })
              ├─> Picks up status='approved' rows
              ├─> Picks up status='failed' rows past their next_retry_at
              ├─> Joins erp_adapters; routes by adapter.system to:
              │     dispatchSap | dispatchOdoo | dispatchXero | dispatchNetsuite
              ├─> Decrypts erp_connections.encrypted_config with ENCRYPTION_KEY
              ├─> Calls the ERP API (real write)
              ├─> On success → status='posted', external_doc_id stamped
              └─> On failure → backoff schedule:
                    1m → 5m → 15m → 1h → 6h → status='dead_letter'
```

## Required env vars / bindings

Set on the Worker (production secret store, not `vars`):

| Name | Purpose | Failure mode if unset |
|---|---|---|
| `ENCRYPTION_KEY` | AES-GCM key for `erp_connections.encrypted_config` | Decrypt fails → adapters fall back to stub path → no real ERP writes |
| `JWT_SECRET` | Auth tokens | All admin routes 401 |

Existing bindings unchanged (`DB`, `CACHE`, `STORAGE`, `VECTORIZE`, `AI`).
No new D1 databases or queues introduced by this stack.

```bash
# Confirm both secrets are set on the production worker
wrangler secret list --name atheon-api | jq '.[] | .name'
# Must include: ENCRYPTION_KEY and JWT_SECRET
```

If `ENCRYPTION_KEY` is missing, set it BEFORE deploying the merged
stack — otherwise every connection that already has an
`encrypted_config` value will fall through to the stub on the next
sweep, which silently posts synthesised doc IDs rather than calling
the real ERP.

```bash
wrangler secret put ENCRYPTION_KEY --name atheon-api
# Paste a strong (32+ char) random string. Same key as PR #277 onwards.
```

## First-deploy smoke test

After the stack is merged + deployed, run this sequence end-to-end on
ONE non-critical tenant before declaring the chain live:

1. **Migration ran cleanly**: hit `POST /api/v1/admin/migrate` with
   the setup secret header. Confirm response has
   `version: "v76-dispatch-retry-backoff"` (or later) and
   `errorCount` is 0 or only contains expected pre-existing column-add
   noise.
2. **Encryption sanity**: in the Integrations UI, create a new
   connection of any of the 4 write-back adapters
   (Odoo / Xero / NetSuite / SAP) using sandbox credentials. Confirm the
   form renders adapter-specific fields (Odoo: `url`/`db`/`login`/`password`;
   Xero: 6 OAuth fields; NetSuite: 5 TBA fields; SAP: 4 fields incl.
   `client`).
3. **Encryption persisted**: query D1 directly and confirm
   `encrypted_config` is set and `config` is `{}`:
   ```bash
   wrangler d1 execute atheon-db --remote --command \
     "SELECT id, length(encrypted_config) AS enc_len, config
      FROM erp_connections WHERE tenant_id = 'YOUR_TEST_TENANT'"
   ```
4. **Partner mapping bootstrap**: in the new Partner Mappings page,
   pick the connection and click "Bootstrap from ERP". Confirm
   proposals come back. Pick a couple, confirm them. Watch
   `wrangler tail` for `partner_bootstrap.proposals_generated`.
5. **Force a real dispatch**: stage one transactional_action manually
   (or wait for the next Phase 10 chain tick), approve it, and watch
   the tail for `erp_writeback.<adapter>_posted`. The row should land
   at `status='posted'` with `external_doc_id` set to the ERP-issued
   document ID (NOT the synth `INV-XXXXXXXX-...` shape — if you see
   a synth ID, dispatch fell through to the stub path; check the
   adapter routing).
6. **Verify routing on production seed IDs**: the dispatcher routes by
   `erp_adapters.system` first (`Odoo`/`Xero`/`NetSuite`/`SAP`) and
   adapter_id second. PR #380 fixed a bug where production seed
   IDs (`erp-xero`, `erp-ns`, `erp-odoo`, `erp-sap-s4`) wouldn't match.
   If a dispatch lands `posted` but with a synth doc ID like
   `AP_INVOICE_POST-XXXXXXXXXXXX`, the routing fallback fired —
   check `erp_adapters.system` for that connection's adapter_id.
7. **Force a failure → confirm backoff**: temporarily set the
   connection's encrypted_config to broken creds (or pull network
   from your sandbox tenant). Stage + approve an action. Confirm:
   - First sweep → `status='failed'`, `retry_count=1`,
     `next_retry_at` ~60s in the future
   - 60s later, sweep again — same row gets retried; if still
     broken, `retry_count=2`, `next_retry_at` ~5 min ahead
   - After fixing creds, the next sweep succeeds and the row goes
     `posted`. `error` is cleared, `next_retry_at` is null.

## Alert response

### `erp_writeback.connection_failure_threshold` (warn)

Emitted when one connection accumulates ≥5 dead-lettered or ≥10 failed
rows in 24h. Payload:
```json
{
  "connection_id": "...",
  "dead_letter_count": 7,
  "failed_count": 12,
  "window": "24h"
}
```

**Triage:**
1. Look at `transactional_actions` for that connection:
   ```bash
   wrangler d1 execute atheon-db --remote --command \
     "SELECT status, sub_catalyst_name, action_type, error,
             retry_count, dead_letter_at
        FROM transactional_actions
       WHERE erp_connection_id = '<conn_id>'
         AND status IN ('failed','dead_letter')
       ORDER BY updated_at DESC LIMIT 20"
   ```
2. Cluster by error message. Common shapes:
   - `[Xero token_refresh_failed 400]` → refresh token expired/revoked.
     Customer must re-consent; new tokens via the connection edit form.
   - `[NetSuite INVALID_LOGIN ...]` → TBA token rotated server-side.
     New token from customer's NetSuite admin.
   - `[SAP CSRF csrf_fetch_failed 401]` → SAP technical user locked.
     Customer's BC needs to unlock.
   - `[Odoo AccessDenied]` → API key revoked or user deactivated.
   - `payload missing partner_id ... and no vendor_ref mapping found` →
     a vendor in this customer's data has no Atheon→ERP mapping.
     Direct ops to **Partner Mappings** page → bootstrap or hand-add.
3. After fixing the root cause, revive dead-lettered rows from the
   **Action Layer** page: filter "Needs attention" → click Revive on
   each. (Or call the API directly:
   `POST /api/v1/erp/transactional-actions/:id/revive` per row.)

### Synth doc IDs landing on `posted` rows

Symptom: `external_doc_id` looks like `AP_INVOICE_POST-abc123def456`
instead of the ERP's natural number (`5105612345`, `BILL/2026/00099`,
`INV-0042`, etc).

This means dispatch hit the generic stub. Check in order:
1. Is `ENCRYPTION_KEY` set on the worker? `wrangler secret list`
2. Is the connection's `encrypted_config` actually decryptable with the
   current `ENCRYPTION_KEY`? (If the key was rotated without re-encrypting
   the rows, decrypt fails silently and dispatch stubs.)
3. Does the connection have an `erp_adapters` row whose `system` matches
   one of `SAP` / `Odoo` / `Xero` / `NetSuite`? Production seed IDs
   `erp-sap-s4`, `erp-sap-ecc`, `erp-odoo`, `erp-xero`, `erp-ns` all
   work; custom adapter rows might not.

## Rollback procedure

The stack is layered; you can revert top-down without re-running
migrations.

| If you need to revert | Revert PR(s) | Migration impact |
|---|---|---|
| Action-layer admin UI (#383) | Revert #383 alone | None |
| Retry-backoff (#382) | Revert #383 then #382 | New columns left in place — harmless. Rows in `dead_letter` go untouched; on revert dispatcher will re-attempt them indefinitely |
| Partner-mapping bootstrap (#381) | Revert #383, #382, #381 | None |
| Partner-mapping table + UI (#378+#379) | Revert UI/bootstrap first, then APIs | Table left in place — empty/unused. Operators lose vendor_ref → ERP-id resolution; explicit numeric IDs in payloads still work |
| Adapter-config form + routing fix (#380) | Revert top-down to #380 | **Re-introduces the routing bug** — production tenants would hit the generic stub again. Don't revert #380 alone unless you also turn off the action-layer chain (`runPhase10ChainForTenant` skip transactional step) |
| Encryption-at-dispatch (#377) | Revert top-down to #377 | Connections with `encrypted_config` set will fall back to plaintext `config` — which is `{}` for any tenant who configured creds via the encryption path. Effectively turns the stack off; safe |
| Real adapters (#374–#376) | Revert top-down to the relevant adapter | Other adapters keep working; the reverted one falls to its synth stub |

If you need to **stop dispatch entirely** without reverting code,
mark all approved rows skipped and pause the chain step:

```bash
wrangler d1 execute atheon-db --remote --command \
  "UPDATE transactional_actions SET status='skipped', error='ops-pause'
   WHERE status IN ('approved','failed') AND tenant_id = '<tenant>'"
```

## Pre-merge checklist (per PR or per merge train)

Before clicking merge on the stack as a whole:

- [ ] `ENCRYPTION_KEY` set on the production worker (`wrangler secret list`)
- [ ] Migration version on the staging branch matches what the merged code expects (`grep MIGRATION_VERSION workers/api/src/services/migrate.ts`). Latest at time of writing: `v76-dispatch-retry-backoff`
- [ ] All 87 tests green on the merge-train tip (`cd workers/api && npx vitest run src/__tests__/erp-*.test.ts`)
- [ ] At least one customer's encrypted_config sample decrypts with the current ENCRYPTION_KEY in a staging shell
- [ ] Sandbox tenant smoke per "First-deploy smoke test" above passes against staging

## Day-of go-live steps (additive to general checklist)

These slot in after the existing day-of steps in [GO_LIVE_CHECKLIST.md](GO_LIVE_CHECKLIST.md):

1. Confirm migration v76+ landed: `wrangler d1 execute atheon-db --remote --command "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_txn_actions_retry'"` returns one row.
2. Pick one VantaX-internal sandbox tenant. Configure a real Xero sandbox connection (the easiest of the four to set up) via the new IntegrationsPage form.
3. Click **Bootstrap from ERP** on Partner Mappings → confirm proposals → bulk-confirm.
4. Stage + auto-approve one AP invoice via the demo seeder. Watch `wrangler tail` for:
   - `xero.token_proactive_refresh` (if the test access_token is near-expiry)
   - `erp_writeback.xero_posted`
5. Hit the new `/transactional-actions` page → confirm summary chips populate, the new row appears at `status=posted` with the Xero-issued `InvoiceNumber` as `external_doc_id`.
6. Tail for 30 minutes. If `erp_writeback.connection_failure_threshold` fires, treat as P2 and follow the alert-response section above.

## Quick reference — D1 queries

```sql
-- Rows currently in trouble
SELECT status, COUNT(*), COALESCE(SUM(posted_value),0)
FROM transactional_actions
WHERE tenant_id = ? AND status IN ('failed','dead_letter')
GROUP BY status;

-- Rows scheduled for retry in the next hour
SELECT id, sub_catalyst_name, action_type, retry_count,
       next_retry_at, error
FROM transactional_actions
WHERE tenant_id = ? AND status = 'failed'
  AND next_retry_at IS NOT NULL
  AND next_retry_at <= datetime('now', '+1 hour')
ORDER BY next_retry_at ASC;

-- Per-connection failure rate, last 24h
SELECT erp_connection_id,
       SUM(status='posted')      AS posted,
       SUM(status='failed')      AS failed,
       SUM(status='dead_letter') AS dead_letter
FROM transactional_actions
WHERE tenant_id = ? AND updated_at >= datetime('now','-24 hours')
GROUP BY erp_connection_id
ORDER BY dead_letter DESC, failed DESC;

-- Mapping coverage per connection
SELECT partner_type, COUNT(*) AS mappings
FROM erp_partner_mappings
WHERE tenant_id = ? AND erp_connection_id = ?
GROUP BY partner_type;

-- Force-revive every dead-lettered row for a tenant (use sparingly;
-- only after you've fixed the underlying cause)
UPDATE transactional_actions
   SET status='approved', retry_count=0,
       next_retry_at=NULL, dead_letter_at=NULL, error=NULL,
       updated_at=datetime('now')
WHERE tenant_id = ? AND status = 'dead_letter';
```
