# Deferred Items — Implementation Runbook

The 6-month roadmap closed out 10 wireable items (A1–A4, B1–B3, C1–C6).
Three deferred items remain that need cross-team coordination or
external vendor work before they can land. This runbook captures the
state of each, the gap to "done", the concrete path forward, and the
acceptance criteria.

Audience: engineering lead picking these up next quarter.

Last updated: 2026-05-27.

---

## 1. SAML / OIDC SSO

### Current state

- Local username/password + TOTP MFA: shipped
  ([auth.ts](../workers/api/src/routes/auth.ts))
- WorkOS env vars are stubbed in [types.ts](../workers/api/src/types.ts)
  (`WORKOS_API_KEY`, `WORKOS_CLIENT_ID`, `WORKOS_REDIRECT_URI`)
- No SSO routes wired yet
- The Stitch design brief calls out the `/login` flow handing off to
  Azure AD / Okta / SAML (see docs/STITCH_DESIGN_BRIEF.md:1247)

### Why deferred

WorkOS account + Azure AD test directory + a customer pilot are the
unblockers. Until we have a paying customer asking for SSO in writing,
this is speculative.

### Definition of done

- `POST /api/v1/auth/sso/start` returns a redirect URL for a given
  `tenant_id` (looks up `tenants.sso_provider_id`)
- `GET /api/v1/auth/sso/callback` exchanges the code, provisions or
  matches a user, issues an Atheon session
- Per-tenant SSO config in IAM page: provider type, connection ID,
  default role for JIT-provisioned users
- Admin can force-disable local login for their tenant (enterprise
  contracts will require this)
- SCIM 2.0 user provisioning hook so Azure AD/Okta can push users in
  before they log in (push, not JIT — large customers need this)

### Implementation path

1. **Pick provider**: WorkOS (recommended) vs Auth0 vs roll-our-own.
   WorkOS is cheapest for the SAML+SCIM combo and integrates in <1 day.
2. Add `tenant_sso_config` table:
   ```sql
   CREATE TABLE tenant_sso_config (
     tenant_id TEXT PRIMARY KEY REFERENCES tenants(id),
     provider TEXT NOT NULL,           -- 'workos' | 'auth0' | 'custom-saml'
     connection_id TEXT NOT NULL,      -- provider's connection ID
     default_role TEXT NOT NULL,       -- role assigned on JIT
     enforce_sso INTEGER DEFAULT 0,    -- disable local login when 1
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   ```
3. Add routes in `workers/api/src/routes/auth-sso.ts`:
   - `POST /api/v1/auth/sso/start` — body `{ tenantSlug }`, returns
     `{ redirectUrl }`
   - `GET /api/v1/auth/sso/callback` — handles the code exchange,
     creates/matches user, issues session token
4. Add SCIM endpoint (server-side, gated by per-tenant bearer token):
   - `POST /scim/v2/Users` — create
   - `PATCH /scim/v2/Users/:id` — update (incl. soft-delete via `active:false`)
   - `GET /scim/v2/Users` — list (paginated, filterable)
5. Update [LoginPage.tsx](../src/pages/LoginPage.tsx) to detect
   tenant-scoped SSO and redirect to the SSO start flow.
6. Update [IamPage.tsx](../src/pages/IamPage.tsx) with an "SSO" tab for
   admins to configure their tenant's provider.

### Acceptance test

```bash
# Configure a tenant's SSO
curl -X POST $BASE/api/v1/admin/tenants/$T/sso \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"provider":"workos","connectionId":"conn_xxx","defaultRole":"analyst"}'

# Start flow
curl $BASE/api/v1/auth/sso/start -d '{"tenantSlug":"acme"}'
# → { "redirectUrl": "https://api.workos.com/sso/authorize?..." }

# Callback (browser-driven)
# After successful Azure AD login → lands on /api/v1/auth/sso/callback?code=...
# → 302 to /app with Atheon session cookie set
```

### Estimate

- Implementation: 4-5 days (one engineer, assuming WorkOS)
- Pilot integration with a customer's Azure AD: +1 week of coordination
- SCIM provisioning: +2 days (mostly testing edge cases)

---

## 2. SOC 2 Type II attestation

### Current state

- **Audit logging**: comprehensive ([audit-log.ts](../workers/api/src/services/audit-log.ts)),
  but **no retention policy** — grows unbounded. SOC2 wants ≥1 year
  with documented purge.
- **MFA enforcement**: per-user toggle. No tenant-wide enforcement.
- **Access reviews**: no UI, no quarterly cadence.
- **Credential rotation**: no automated reminder for API keys or
  webhook secrets.
- **Encryption at rest**: D1 is encrypted by Cloudflare; we don't
  document this in a posture statement anywhere.
- **Documented SDLC**: no `CONTRIBUTING.md` describing the secure-dev
  process; no documented code review gate (it exists, it just isn't
  written down).

### Why deferred

SOC 2 Type II requires 6-12 months of evidence collection by an
external auditor (e.g. Drata, Vanta, Secureframe). The compliance work
itself is not the bottleneck; the audit window is. So this is gated on
either (a) a customer requiring it contractually or (b) us treating it
as an upfront investment ahead of Q4 sales.

### Definition of done

- Drata or Vanta connected to our infrastructure (auto-evidence)
- All 5 trust principles documented:
  - Security: this is the bulk
  - Availability: SLO/SLI definitions per service
  - Processing integrity: catalyst execution + audit trail
  - Confidentiality: tenant isolation + encryption
  - Privacy: GDPR/POPIA flows (we have some of this; see
    [tenants.ts](../workers/api/src/routes/tenants.ts) DSAR endpoint)
- All controls evidenced for at least 6 months (Type I) or 12 months
  (Type II)
- Compliance dashboard page (already designed in Stitch brief
  line 511) shows live posture against each control

### Implementation path

#### Phase 1 — pre-audit hardening (4-6 weeks)

1. **Audit log retention**:
   ```ts
   // workers/api/src/services/audit-log-retention.ts
   // Run nightly via scheduled.ts; soft-archive rows older than 1 year
   // to R2 then delete from D1. Track in audit_log_archive table.
   ```
2. **Tenant-wide MFA enforcement** — add `tenants.mfa_required` flag,
   wire into login flow so a user without TOTP enrolment is forced
   through enrolment on next login.
3. **API key rotation reminder** — extend [api-keys.ts](../workers/api/src/routes/api-keys.ts)
   so any key >90 days old surfaces a UI warning + email reminder.
4. **Access review workflow**:
   - `POST /api/v1/admin/access-reviews/start` — snapshots
     `user_role_assignments` into `access_review_<quarter>`
   - Admin walks the list in IAM page, marks each user as
     keep/remove/role-change, signs off
   - Result stored as immutable audit row + R2 PDF
5. **Compliance dashboard page** — drive the existing
   `CompliancePage.tsx` stub from a `/api/v1/admin/compliance/status`
   endpoint that returns each control's current posture.

#### Phase 2 — auditor engagement (3-6 months)

1. Pick auditor — Drata is easiest for our Cloudflare stack
2. Connect their probes (read-only API keys to D1, R2, GitHub, KV)
3. Run a Type I attestation (point-in-time) first — ~6 weeks once
   the controls are in place
4. Then continue collecting evidence for the Type II window

### Acceptance test

- All Drata controls show green for ≥6 weeks → Type I passes
- All Drata controls show green for ≥6 months → Type II passes
- The signed report PDF goes into the [/compliance](../src/pages/CompliancePage.tsx)
  page's "Latest attestation" card

### Estimate

- Phase 1: 4-6 weeks engineering
- Phase 2: 3-6 months elapsed (mostly waiting on the auditor)
- Auditor cost: $15-30k/year depending on vendor

---

## 3. SAP S/4HANA write-back

### Current state

- Read-only adapter wired:
  [erp-sap.ts](../workers/api/src/services/erp-sap.ts)
- Reads: business partners, sales orders, materials, GL accounts,
  invoices
- **Writes: none** — every recommendation Atheon produces lands as a
  catalyst sign-off that a human has to re-key into SAP
- The other 8 ERP adapters are in the same state (read-only)
- The shared-savings model requires the write path: a "claimed
  R" trace needs to point back to the SAP document number Atheon
  actually created (PO, journal entry, AP invoice match, etc.)

### Why deferred

Write-back to SAP S/4 is the hardest integration we have. Reasons:

1. **Customer-specific schemas**: every SAP install has bespoke
   customizations on top of standard tables. Our generic adapter can
   read the standard fields; writing means understanding the
   customer's `Z*` extensions.
2. **Approval workflow**: SAP releases (POs, invoices, etc.) usually
   go through a multi-stage approval chain that mirrors but doesn't
   match Atheon's catalyst sign-off. We need to either bypass it (and
   lose the audit trail) or integrate (and triple the implementation
   effort).
3. **Idempotency**: every Atheon write needs an idempotency key so a
   retry doesn't double-post. SAP's idempotency story is per-API and
   not consistent.
4. **Auth scopes**: customer's SAP admin has to grant write scopes,
   which goes through their change-control board.

### Definition of done

For the **first** sub-catalyst — call it AP invoice match (highest
value, simplest write):

- Atheon's catalyst flow can call `POST /api/v1/erp/sap/invoices/match`
  to mark a customer invoice as matched against a PO
- The SAP S/4 document number returned by the API is stored on
  `catalyst_sub_results.erp_document_id`
- The audit log records the exact payload sent
- The shared-savings dashboard can drill from "R3 200 saved" →
  catalyst run → SAP document → field-level mapping
- Retry-safe via idempotency key (`X-Idempotency-Key` header that
  Atheon generates from the catalyst run ID)

### Implementation path

1. **Pick the first scenario** — AP invoice match is recommended (we
   already have read coverage on invoices + POs; the OData write is
   straightforward; customer-side approval is usually centralized).
2. Extend [erp-sap.ts](../workers/api/src/services/erp-sap.ts) with
   write methods:
   ```ts
   // returns the new SAP document ID
   matchInvoice(args: {
     tenantId: string;
     invoiceId: string;          // SAP invoice ID
     purchaseOrderId: string;
     idempotencyKey: string;
   }): Promise<{ sapDocumentId: string }>
   ```
3. Wire the catalyst sign-off path so that on "approve" we call the
   write method and capture the doc ID:
   ```ts
   // workers/api/src/routes/catalysts.ts (signOff)
   const sapDoc = await sap.matchInvoice({ ... });
   await db.update(catalyst_sub_results)
     .set({ erp_document_id: sapDoc.sapDocumentId })
     .where(...);
   ```
4. Add a per-tenant ERP `write_scope` flag in `tenant_erp_config` —
   reads work without it, writes require it explicitly opt-in.
5. Add a circuit breaker around the write call: 3 consecutive
   failures → trip → all writes pause → admin notification → manual
   reset. We never want to retry-storm a customer's SAP.
6. Add a write-back smoke test that hits a sandbox SAP S/4 (Atheon's
   own — we have a Cloudera-hosted dev instance from the original
   Hyperscaler PoC) every cron tick.

### Pilot rollout

1. One paying customer commits in writing to the AP match scenario
2. We integrate against their sandbox SAP for 2 weeks
3. We run in shadow mode for another 2 weeks (Atheon generates the
   write payload but doesn't send it; their finance team validates)
4. Cut over to live writes, monitoring the circuit breaker hourly
5. Repeat for the next sub-catalyst (probably bank rec or GR/IR)

### Acceptance test

```bash
# End-to-end on the AP match catalyst
curl -X POST $BASE/api/v1/catalysts/ap-invoice/run \
  -d '{"tenantId":"acme","mode":"live"}'
# → returns catalyst_run_id

# Sign off
curl -X POST $BASE/api/v1/catalysts/runs/$RUN_ID/signoff \
  -d '{"approverId":"u_xxx"}'
# → must come back with { signedOff: true, sapDocumentId: "1000023145" }

# Verify trace
curl $BASE/api/v1/assessments/$A/trace?dollar=3200
# → response must include sap.documentId = "1000023145"
```

### Estimate

- Implementation against Atheon's sandbox: 2-3 weeks
- Customer integration (per customer): 4-6 weeks elapsed (mostly
  waiting on their change-control)
- Each additional sub-catalyst write: 1-2 weeks once the first is live

---

## Cross-cutting prerequisites

Before any of the three lands, the platform also needs:

- **GitHub access restored** (currently suspended; blocks deploys
  needed to ship and validate)
- **Customer pilot committed** — none of these are speculative
  features any more, but they're all expensive to ship without a
  contractual driver
- **One engineering hire** focused on integrations (SAP write-back
  is the biggest hire driver — too much for the current team to
  carry alongside roadmap work)

## Priority order

1. **SAML SSO** — smallest scope, biggest sales unlock for >$100k
   ACV deals.
2. **SAP S/4 write-back (AP match only)** — proves the shared-savings
   model in production. The other 8 ERPs follow the same pattern once
   this is done.
3. **SOC 2 Type II** — start the auditor engagement in parallel; the
   evidence window runs in the background while the engineering work
   above proceeds.
