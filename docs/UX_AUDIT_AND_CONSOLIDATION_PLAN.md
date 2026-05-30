# Atheon UX Audit & Consolidation Plan

**Last updated:** 2026-05-08
**Scope:** Every page and primary surface in the product, audited against the system's purpose and the seven user roles.
**Status:** Analysis + ranked plan. Implementation is sequenced into waves; nothing here has been built yet (existing in-flight PRs #374–#384 are noted but not included in the audit's "today" baseline).

---

## 1. System purpose (the north star)

Atheon exists to **drive measurable, billable shared savings** from automating ERP-driven business processes (AP, AR, GL, inventory, payroll, T&E, treasury) — and to do it with **audit-grade traceability** so every claimed dollar is defensible to the customer's CFO and external auditor.

Two non-negotiable principles flow from this:

1. **Provenance**: every monetary number on every screen — savings, savings-at-risk, posted value, recovered amounts — must trace back to (a) the specific ERP records that produced it, (b) the field mapping that interpreted those records, and (c) a confidence number. There is no such thing as a "headline" $-figure on Atheon without a drill path to the underlying journal/invoice/PO. Without provenance, the shared-savings invoice is uncollectable.
2. **Strong inference, no silent auto-apply**: when the platform infers a rule (3-way match tolerance, dunning days, fiscal year start, vendor-name → ERP-id mapping, etc.), it either (a) inferred from a sample of ≥25 with mode share ≥70% and applies confidently, or (b) it is below threshold and asks the customer. We always prefer false negatives (low confidence + ask) over silent application of a weak rule. Every UI that surfaces a recommendation must support a Human-In-The-Loop confirm/reject path; no UI should silently auto-commit a low-confidence inference.

**Every screen** in the product should answer at least one of three questions:

| Question | Surface | Primary role |
|---|---|---|
| **What did Atheon save us this period, and how do we prove it?** | Apex / Exec Brief / ROI / Compliance | Executive |
| **What's broken in our processes, and what's being done about it?** | Pulse / Catalysts / Action Layer / Findings | Manager + Operator |
| **Is the platform itself working — and if not, who's fixing it?** | Integration Health / Audit / System Alerts / Support | Admin + VantaX staff |

If a screen doesn't ladder back to one of those three, it shouldn't exist. The audit below tests every page against this rule.

---

## 2. Role catalog

Seven roles, ordered by access level. For each: who they are in the customer's org chart, what success looks like for them, and the **anti-pattern** — the thing they should *not* have to do, but currently sometimes do.

### 2.1 Executive (CFO / CEO / COO) — `executive` role

> *I'm successful when I can answer the board's "is this paying for itself?" question in under 30 seconds, with numbers I trust enough to repeat in the next earnings call.*

- **Core JTBD:** monitor the financial impact of Atheon, spot emerging risks before they become losses, sign off on board-level reports.
- **Top 3 actions:** scan health + savings delta on landing; drill into a specific risk to understand exposure; export a board-ready brief.
- **Anti-pattern:** being asked to choose between three different "executive" pages with overlapping content (Apex / Exec Briefing / ROI Dashboard) and not knowing which one is canonical for board reporting.

### 2.2 Manager (Head of AP / Head of AR / Controller / Operations Director) — `manager` role

> *I'm successful when my team's exception queue is shrinking week-over-week, my SLAs are green, and I can show my CFO the per-process savings at our next 1:1.*

- **Core JTBD:** triage what's broken in the processes I own, assign exceptions, track the catalyst's coverage and health.
- **Top 3 actions:** open Pulse → spot the red metric → click through to the catalyst that owns it; review my team's exception queue and reassign; pull a per-process savings report.
- **Anti-pattern:** having to assemble metrics from Pulse + Catalysts + Action Layer manually because no single page shows "AP this week: invoices processed, exceptions outstanding, savings claimed."

### 2.3 Operator (AP clerk / AR clerk / GL accountant) — `operator` role

> *I'm successful when my morning queue is short, every action I take has clear next steps, and I haven't been blamed for an auto-posted error.*

- **Core JTBD:** work the day's exception queue. Approve, reject, or correct items the catalyst couldn't auto-resolve.
- **Top 3 actions:** open the action queue filtered to "needs my attention"; approve / skip / revive an action with a one-click affordance; understand why an action failed (so I can fix the root cause).
- **Anti-pattern:** the queue is split across two distinct pages (`catalyst_actions` and `transactional_actions`) and the operator has to learn which lives where; a row's failure reason is shown as a string but doesn't link to the underlying record.

### 2.4 Analyst (Financial analyst / Process analyst / Internal audit) — `analyst` role

> *I'm successful when I can drill from a number on any chart down to the journal entry that created it, and walk an auditor through the chain.*

- **Core JTBD:** investigate a metric, validate a finding, build the audit story.
- **Top 3 actions:** drill from any chart to underlying records; ask the chat / mind layer a natural-language question; export an audit-defensible PDF.
- **Anti-pattern:** charts that show numbers without click-through; provenance ledger sits on a separate page from the chart it describes.

### 2.5 IT admin (CIO / Head of IT / Application owner) — `admin` role

> *I'm successful when ERP connections are healthy, partner mappings are populated, users are provisioned, and I haven't been paged this week.*

- **Core JTBD:** operate the platform on behalf of the customer's org. Configure connections, manage users + roles, monitor integration health, respond to alerts.
- **Top 3 actions:** add or rotate an ERP connection; provision/revoke a user with the right role; investigate why a connection is failing.
- **Anti-pattern:** ERP connection management is split across **four** pages (Integrations, Connectivity, Integration Health, Partner Mappings) — admin has to bounce between them to do one job.

### 2.6 VantaX support / CSM — `support_admin` role

> *I'm successful when I can land on a tenant's dashboard, diagnose the issue, and respond to the support ticket — all in under 5 minutes, all without breaking tenant isolation.*

- **Core JTBD:** open a customer's ticket, understand their state, fix or escalate.
- **Top 3 actions:** search for a tenant; impersonate or pivot into their context; reply to / triage their support ticket.
- **Anti-pattern:** four-page bounce: `/support` → `/support-tickets` → `/support-triage` → `/company-health`. Tenant context doesn't carry across the navigation.

### 2.7 VantaX superadmin / engineering — `superadmin` role

> *I'm successful when the platform is healthy, customers are onboarded smoothly, and I can ship safely without breaking anyone.*

- **Core JTBD:** operate the platform. Tenant CRUD, deployment lifecycle, feature flags, billing, infrastructure ops.
- **Top 3 actions:** investigate a platform-wide alert; roll out a feature flag with a percentage canary; review tenant adoption + revenue.
- **Anti-pattern:** infrastructure pages (Platform Health, System Alerts, Revenue, Feature Flags, Deployments) all live separately; a `system_alerts` summary appears on the Platform Health page but real management is on a different URL — same data, two places.

---

## 3. Cross-cutting design principles

These four principles apply to every screen. The audit below tests each page against them.

### 3.1 Provenance is a first-class UI primitive

Every numeric figure showing dollars, savings, exposures, or counts of items processed should be **clickable** and lead to:

- The underlying ERP records (PO, invoice, payment, journal entry, etc.)
- The field-mapping that produced the number
- A confidence value and how it was derived
- The catalyst run that emitted it

This is not optional. If we can't trace a number to its source, we can't bill on it.

### 3.2 Confidence is always visible

Every inferred value (3-way match tolerance, payment terms, dunning days, fiscal year start, partner mapping) should ship with a confidence badge in the UI: **High** (≥70% mode share, n≥25), **Medium** (50–69%), **Low** (<50% or n<25). Low-confidence rules MUST surface in a HITL queue and never auto-apply.

### 3.3 Every action queue uses the same vocabulary

`pending → approved → posted | failed → dead_letter | skipped` is the canonical lifecycle for every queue (catalyst actions, transactional actions, write-back actions, partner-mapping confirmations). Different statuses with the same meaning create cognitive load and obscure operational state.

### 3.4 One "tenant context" carries across the session

For VantaX-internal staff: when I select a tenant on any page, that selection should ride along across every subsequent page until I explicitly clear it. No re-searching. The current model uses query-string `?tenant_id=` and a Zustand `tenantOverrideId` — those work but are inconsistently surfaced (no breadcrumb, no global indicator).

---

## 4. Screen-by-screen audit

Pages are grouped by primary persona. Within each group: file path, what it does, primary user, top friction, and a recommendation tagged with effort (S/M/L) and confidence (●●●/●●○/●○○).

### 4.1 Executive surfaces

#### `src/pages/ApexPage.tsx` — Apex (Executive Intelligence)

- **Today:** Six-tab encyclopaedia: health trend, risk matrix, peer benchmarks, what-if scenarios, board reports, insights.
- **Friction:** Tabs fragment what should be a single decision-making narrative. Scenario comparison grid and templates encourage rabbit holes instead of decisioning. The mobile-first `ApexBriefPage` overlaps with this page's first tab.
- **Recommendation [M, ●●●]:** Make the **first view of Apex be the brief** (top-3 risks + delta + headline savings). Demote the encyclopaedia tabs to a "Studio" toggle for analysts who need to dig. The "Board Report" tab should generate a downloadable PDF, not a tab.

#### `src/pages/ApexBriefPage.tsx` — Mobile 60-second brief

- **Today:** Stripped briefing for mobile: health ring, top 3 risks, calibration, peer gap, LLM summary.
- **Friction:** Fully duplicates the conceptual content of the planned "first view of Apex" above. Distinct URL for distinct device is unnecessary in 2026 (responsive design covers it).
- **Recommendation [M, ●●●]:** **Merge into ApexPage's first tab** (rendered responsive). Kill the standalone URL.

#### `src/pages/ExecutiveSummaryPage.tsx` — Exec Briefing (one-page summary)

- **Today:** Pre-aggregated board briefing: health, top risks, metrics, targets, initiatives, forecast.
- **Friction:** A third executive surface alongside Apex and Apex Brief, with overlapping content. "Distribution / scheduling" stub appears as a hint card, making the page feel unfinished.
- **Recommendation [M, ●●●]:** **Merge into ApexPage as the "Board Brief" view.** Replace the separate `/executive-summary` URL with a "Print Board Brief" button on Apex that renders this layout to PDF. One executive surface, three render modes (live brief, deep dive, board PDF).

#### `src/pages/ROIDashboardPage.tsx` — ROI Dashboard

- **Today:** Four read-only KPI cards: realized savings, forecast accuracy, calibration gates, DSAR counts.
- **Friction:** Cards have no drill-down. DSAR count belongs in compliance/governance, not ROI. Calibration belongs in Trust. Mixing them implies they're peers; they're not.
- **Recommendation [M, ●●○]:** **Make every card a drill-down.** Realized savings → catalyst-by-catalyst contribution → underlying records (closes the provenance loop, principle 3.1). Forecast accuracy → time-series with the actual vs. predicted lines. Move DSAR count to `/data-governance`. Move calibration to `/trust`. Resulting page becomes a true ROI dashboard, not a hodgepodge.

### 4.2 Manager + Operator surfaces

#### `src/pages/PulsePage.tsx` — Process Intelligence

- **Today:** Six-tab process diagnostics: metrics, anomalies, correlations, processes, conformance, diagnostics.
- **Friction:** Three separate filtering surfaces (`MetricFilterBar`, `AnomalyDetectionControls`, `MetricStatusBar`) confuse users. The "Action Required" strip duplicates the Overview tab. Diagnostics tab is read-only — no drill to remediation.
- **Recommendation [M, ●●○]:** Consolidate filtering into one bar. Make every metric chart click-through (drill to the underlying records). Replace "Action Required" strip with an inline button on each red metric: "Open exception queue (12 items)". Drops to one mental model: red number → click → exception queue with the offending records.

#### `src/pages/CatalystsPage.tsx` — Autonomous Execution

- **Today:** Cluster + sub-catalyst orchestration: deploy, configure, exception triage, success stories, ROI.
- **Friction:** Three separate UIs to manage the same sub-catalysts (`SubCatalystPanel`, `SubCatalystOpsPanel`, overflow menu). Exception triage is buried in a tab. Run logs / detail is on a separate page.
- **Recommendation [L, ●●○]:** Three lanes:
  1. **Catalog** — what's available + deployed status (consolidates the three duplicate UIs into one panel).
  2. **Exceptions** — promoted to a top-level tab; this is THE operator view. Every row has a one-click resolve / reassign / escalate.
  3. **Runs** — execution history; click-through into `CatalystRunDetailPage`.

  The current "ROI" tab on this page is a duplicate of `ROIDashboardPage` from a different angle. Pick one home; recommend keeping ROI on the ROI page and removing the Catalysts tab.

#### `src/pages/CatalystRunDetailPage.tsx` — Run Detail

- **Today:** Post-run review: matched records, discrepancies, KPIs, comments, CSV export, audit trail.
- **Friction:** Read-only. Operator finds an exception here and has to navigate back to `CatalystsPage` to resolve it. Comments tie to post-hoc triage, not live exception handling.
- **Recommendation [S, ●●●]:** Add inline action buttons on each discrepancy row: Resolve, Escalate, Reassign. These dispatch to the action queue (no extra navigation). Comments thread stays for audit context.

#### `src/pages/TransactionalActionsPage.tsx` (in-flight, PR #383) — Action Layer

- **Today (post-#383):** AP/AR/GL dispatch queue with status filter, summary chips, per-row Revive/Approve/Skip.
- **Friction:** `window.prompt()` for skip reason is jarring (looks like a 2002 alert dialog). Summary chips are clickable but no hover affordance signals it. No drill-down from a row's error string to the underlying ERP record. Lives separately from the older `catalyst_actions` queue surfaced in `ActionQueuePanel.tsx` — same operator, two different conceptual queues.
- **Recommendation [M, ●●●]:** (a) Replace `window.prompt()` with a proper modal. (b) Add hover style on summary chips. (c) Add a "View source record" link on every row that pulls up the underlying invoice/PO/journal in a side panel. (d) **Long-term**: merge the two action queues into one operator surface (cataylst_actions + transactional_actions are conceptually the same — "an action a catalyst proposed that needs HITL or has executed against the ERP"). Today they're distinct tables for historical reasons; consolidating is a substantial migration, but it removes a major source of operator confusion.

### 4.3 Analyst surfaces

#### `src/pages/ChatPage.tsx` — Conversational AI

- **Today:** Tier dropdown, thread history, citations, layer badges.
- **Friction:** Layer concept underdeveloped (badges shown but selection unclear). Budget-exceeded message on 429 has no upgrade CTA — dead end.
- **Recommendation [S, ●●●]:** Add explicit "Upgrade tier" or "Ask my admin to raise budget" CTAs on the 429 path. Document or remove the layer badge UI.

#### `src/pages/MindPage.tsx` — AI Configuration

- **Today:** Three tabs: models, playground, stats.
- **Friction:** Tabs feel disconnected. Tier selector duplicates the one in ChatPage.
- **Recommendation [S, ●●●]:** Extract `<TierSelector />` shared component (used here + ChatPage). Tooltip-document each tier's cost/quality tradeoff. Consider whether playground belongs as a separate tab or as a "Try it" affordance inside the model card.

#### `src/pages/MemoryPage.tsx` — Knowledge Graph

- **Today:** Entities + relationships CRUD + GraphRAG search tab.
- **Friction:** GraphRAG search (the user-facing "why") is the last tab. Entities/relationships CRUD heavy and primarily admin/curation work, not analyst exploration.
- **Recommendation [M, ●●○]:** Reorder tabs: search first (analyst lands here), entities + relationships moved to a "Curation" admin sub-tab gated by admin role. Most analysts shouldn't be editing the knowledge graph.

#### `src/pages/Dashboard.tsx` — Personalized Health Overview

- **Today:** Health score, risks, anomalies, trends, action queue, recommendations.
- **Friction:** Six-panel layout competes for attention. ActionQueuePanel duplicates Pulse's strip. HealthDimensions + IntelligencePanel both use chart space without a clear primary action.
- **Recommendation [M, ●●○]:** **Make Dashboard role-aware.** Today every role lands on the same Dashboard. Better: route executives to Apex Brief, managers to Pulse, operators to Action Queue, analysts to Mind, admins to Integration Health. Dashboard becomes a thin "today's most important number for your role" landing strip with one big drill-through, not six competing panels. (This requires a routing change in `App.tsx` not a new page.)

### 4.4 Admin surfaces

#### `src/pages/IntegrationsPage.tsx` — ERP Connection Management

- **Today:** Adapters catalog + connection CRUD + credential form.
- **Friction:** Auth-method-keyed credential form is fragile (PR #380 fixed parts of this). No "which auth method maps to my ERP" guidance. No inline validation before form submit. Edit mode opens a separate modal that's near-identical to the create modal.
- **Recommendation [M, ●●●]:** (a) After PR #380 lands, the form's adapter-specific schemas cover Odoo/Xero/NetSuite/SAP. Extend the adapter-specific override to all the other write-back-capable adapters as they're added. (b) Add a "Test connection" button on the form before save (lots of platforms catch invalid creds at submit, hard to debug). (c) Surface inline help: "for Xero, you need a Custom Connection (machine-to-machine) — link to docs."

#### `src/pages/IntegrationHealthPage.tsx` — Sync Status Monitor

- **Today:** Three-tab health view (connections / errors / freshness) per connection.
- **Friction:** Same data as `ConnectivityPage.tsx` re-sliced. Circuit breaker badges have no action.
- **Recommendation [L, ●●●]:** **Merge with `ConnectivityPage` into a single "Integration Health" page.** Tabs: Connections, Sync errors, Freshness, Circuit breaker. Add a "Reset circuit" action on HALF_OPEN/OPEN connections. Retire `/connectivity` entirely.

#### `src/pages/ConnectivityPage.tsx` — Live Sync Health

- **Today:** Connection status + circuit + last sync + test button + multi-company.
- **Friction:** Near-identical to `IntegrationHealthPage`, different name.
- **Recommendation [L, ●●●]:** **Retire** in favour of merged Integration Health page (above).

#### `src/pages/PartnerMappingsPage.tsx` (in-flight, PR #379) — Partner Mappings

- **Today (post-#379+#381):** Connection picker, vendor/customer tabs, list, modal editor, bootstrap from ERP.
- **Friction:** Connection picker sits above tabs — every connection switch reopens. Discovery is poor: a missing mapping shows up in the Action Layer queue ("payload missing partner_id…"), not on this page. No bulk delete.
- **Recommendation [M, ●●○]:** (a) When the Action Layer detects a missing-mapping error, link the row's error to a pre-filtered Partner Mappings page. (b) Show an attention banner on this page: "12 mappings referenced but missing." (c) Bulk delete + multi-select for cleanup of stale rows. (d) Move connection picker to a sticky header chip so switching is one click.

#### `src/pages/IAMPage.tsx` — Users, Roles, Policies, SSO

- **Today:** Four tabs: users, roles, policies, SSO.
- **Friction:** Four disjoint concerns crammed in one page. Policies show raw JSON in rows without an edit UI. SSO has no "test provider" button.
- **Recommendation [L, ●●○]:** Keep four tabs but: (a) build a real policy editor (not raw JSON), (b) add SSO test, (c) absorb `CustomRoleBuilderPage` as the "Custom Roles" sub-section under Roles. Two pages → one.

#### `src/pages/CustomRoleBuilderPage.tsx` — Custom Roles

- **Today:** Permission tree + role composer.
- **Friction:** Separate URL from IAM. Permission tree has no search. Inheritance is read-only with no clear behavior.
- **Recommendation [M, ●●●]:** **Merge into `IAMPage` as a sub-tab under Roles.** Permission tree gets a search. Inheritance gets explicit "clear" affordance.

#### `src/pages/AuditPage.tsx` — Governance Trail

- **Today:** Action log with filters + export. ProvenanceVerifyPanel pinned to top.
- **Friction:** ProvenanceVerifyPanel disconnected from the audit table. Export emits raw JSON details.
- **Recommendation [M, ●●●]:** Pre-bake report templates (SOC2 access review, PCI quarterly, custom date range) so non-technical operators can hit "download report" instead of building a CSV in Excel. Make ProvenanceVerifyPanel context-sensitive: if I'm filtering on tenant X, the panel verifies tenant X's chain.

#### `src/pages/CompliancePage.tsx` — SOC 2 Evidence Pack

- **Today:** Read-only aggregation: access reviews, MFA, config changes, encryption, audit retention.
- **Friction:** No remediation links. MFA coverage shown but no "go to IAM and remediate" path. Read-only feels like a status dashboard rather than a compliance workflow.
- **Recommendation [M, ●●●]:** Every red metric → action link. MFA <100% → IAM filtered to "MFA off" users. Open incidents → System Alerts filtered to active P0s. Encryption gap → Data Governance retention page.

#### `src/pages/DataGovernancePage.tsx` — Retention, DSAR, Encryption

- **Today:** Four tabs: overview, DSAR/erasure, retention, encryption status.
- **Friction:** Overview tab duplicates the other three. DSAR is read-only here but raised from Settings. "Plaintext connection count" shown but rotation is a curl command.
- **Recommendation [M, ●●●]:** Drop the redundant overview tab. Add "Raise DSAR" CTA inline on the DSAR tab. Add "Rotate encryption" UI button (calls the existing rotation service). All three "compliance-adjacent" pages (`AuditPage`, `CompliancePage`, `DataGovernancePage`) share consolidation potential — see §5.4.

#### `src/pages/WebhooksPage.tsx` — Event Subscriptions

- **Today:** Webhook list + delivery table + test button.
- **Friction:** Health badge logic complex. No edit (delete + recreate). Receiver-side verification docs collapsed.
- **Recommendation [S, ●●●]:** Add an edit modal that re-shows the secret only for newly-rotated webhooks (similar to the webhook-create flow). Promote receiver verification snippet to an inline callout.

### 4.5 VantaX-internal surfaces

The internal-tools landscape is the most fragmented part of the product. CSM staff bounce between four pages to handle one ticket; superadmin staff bounce between five pages to manage one tenant. The recommended consolidation in §5.5 collapses 13 pages into 5 coherent "consoles."

Current state per page:

- `PlatformHealthPage` (`/platform-health`): infrastructure status, cross-tenant roster, alerts summary. Superadmin only.
- `SupportConsolePage` (`/support`): tenant search, activity timeline, quick-action hub.
- `SupportPage` (`/support-tickets`): customer + admin ticket list; new ticket form.
- `SupportTicketDetailPage` (`/support-tickets/:id`): thread view.
- `SupportTriagePage` (`/admin/support-triage`): admin-only filter + bulk-assign.
- `CompanyHealthPage` (`/company-health`): per-tenant adoption + LLM usage. Locked to own tenant.
- `ImpersonationPage` (`/impersonate`): time-limited view-as session.
- `BulkUserManagementPage` (`/bulk-users`): CSV import, bulk role change.
- `RevenueUsagePage` (`/revenue`): MRR/ARR + plan distribution + LLM aggregate.
- `FeatureFlagsPage` (`/feature-flags`): flag CRUD + evaluate-as-tenant.
- `TenantLlmBudgetPage` (`/admin/tenants/:id/llm`): per-tenant budget edit.
- `SystemAlertsPage` (`/system-alerts`): alert rules CRUD.
- `DeploymentsPage` (`/deployments`): on-prem/hybrid lifecycle.
- `TenantManagementPage` (`/tenants`): tenant CRUD.

Friction common to all: **tenant context doesn't carry between them.** A CSM searches for tenant X on `/support`, opens their ticket on `/support-tickets/:id`, needs their health → must navigate to `/company-health` (locked to own tenant — has to impersonate first), needs their LLM budget → must navigate to `/admin/tenants/X/llm`. Four separate context switches for one customer interaction.

**Recommendations are ranked together in §5.5.**

### 4.6 Other public + auth surfaces

#### `src/pages/MarketingPage.tsx`, `PricingPage.tsx`

Clean. No friction detected. Out of scope for this audit.

#### `src/pages/LoginPage.tsx`, `MFASetupPage.tsx`, `ERPOAuthCallbackPage.tsx`

Minor: backup-code regex hints buried; no resend on MFA timeout; OAuth callback's success/error states flip too quickly to read on slow connections. **[S, ●●●]** — bundle into a single "auth UX polish" PR.

#### `src/pages/SettingsPage.tsx`

Eight collapsible sections crammed into one page. MFA setup wizard lives at `/settings/mfa` instead of inline. **[M, ●●○]** — refactor to a tabbed Settings page with sections (Profile, Security, Notifications, API Keys, Integrations, Budget). MFA wizard moves inline.

#### `src/pages/OnboardingWizardPage.tsx`

Clean linear 7-step flow. No friction.

---

## 5. Top consolidation opportunities (ranked by leverage)

Each opportunity carries: pages affected, expected value (whose job it makes easier and how much), effort estimate, and implementation risk.

### 5.1 Executive surface: 3 pages → 1 page with 3 modes

**Affected:** `ApexPage`, `ApexBriefPage`, `ExecutiveSummaryPage`.

**Today:** Three distinct URLs, all targeting the executive role, all rendering overlapping content (health + risks + savings delta + initiatives). The exec doesn't know which is canonical. Each page has its own "incomplete" feel — Brief is mobile-only, Exec Briefing has a "scheduling" stub, Apex's first tab duplicates both.

**Plan:**

1. Make `ApexPage`'s landing view be the brief (top 3 risks + delta + headline savings + LLM narrative). Rendered responsive.
2. Demote the encyclopaedia tabs to an "Apex Studio" toggle/route for analysts.
3. Add a "Print board brief" button that renders the existing `ExecutiveSummaryPage` layout to PDF.
4. Remove `/apex/brief` and `/executive-summary` URLs (redirect to `/apex` for backwards-compat).

**Wins:** One executive surface. CFO never has to wonder which page to use. Mobile users get the brief on the same URL their email links to.

**Effort:** M (≈2 days). **Risk:** Low — both deprecated pages can redirect to `/apex` indefinitely.

### 5.2 Action queues: catalyst_actions + transactional_actions = one operator surface

**Affected:** `ActionQueuePanel.tsx` (Dashboard component), `TransactionalActionsPage.tsx` (PR #383).

**Today:** Two distinct queues with overlapping semantics. `catalyst_actions` is the older, broader "any catalyst proposing an action" queue. `transactional_actions` is the newer AP/AR/GL real-write queue with the retry/dead-letter system from PR #382. Operators don't care about the implementation distinction; they care about "what's in my queue today."

**Plan:**

1. Land the in-flight stack #382/#383 first (action layer admin page).
2. Extend `TransactionalActionsPage` to also surface `catalyst_actions` rows in a separate tab or unified view. Status semantics already align (`pending → approved → posted | failed → dead_letter | skipped`).
3. Retire `ActionQueuePanel` from the Dashboard; replace with a one-line "X actions need your attention" link to the consolidated page.

**Wins:** Operators have one URL for "my queue today." Status vocabulary is finally consistent (principle 3.3).

**Effort:** L (≈3-4 days; needs careful schema review). **Risk:** Medium — the two tables have overlapping but not identical columns; the unified surface needs to handle both shapes.

### 5.3 Integrations: 4 pages → 1 with 4 tabs

**Affected:** `IntegrationsPage`, `ConnectivityPage`, `IntegrationHealthPage`, `PartnerMappingsPage` (in-flight).

**Today:** Admin needs to bounce between four pages to set up an ERP. Connection list shows up on three of them with subtle differences. Partner mapping is a separate page entirely with its own connection picker.

**Plan:**

1. Single `/integrations` page with four tabs: **Connections**, **Health**, **Mappings**, **Webhooks**.
2. **Connections** tab: today's `IntegrationsPage` create/edit/delete UI.
3. **Health** tab: today's `IntegrationHealthPage` + circuit-breaker reset + multi-company view (today's `ConnectivityPage`).
4. **Mappings** tab: today's `PartnerMappingsPage` (after #379+#381 land), but with the connection picker as a sticky header chip that persists across tabs.
5. **Webhooks** tab: today's `WebhooksPage`.
6. URLs `/connectivity`, `/integration-health`, `/partner-mappings`, `/webhooks` redirect to `/integrations#<tab>`.

**Wins:** IT admin sets up an ERP in one place. "Tenant context" from §3.4 (the selected connection) carries across all four tabs.

**Effort:** L (≈4-5 days). **Risk:** Low — every existing surface is preserved; only the URL/tab structure changes. Webhooks belongs on integrations because every webhook is conceptually "an outbound integration."

### 5.4 Governance: Audit + Compliance + Data Governance → one Governance Hub

**Affected:** `AuditPage`, `CompliancePage`, `DataGovernancePage`.

**Today:** Three pages all reading from the same `audit_log` + `tenant_config` tables but surfacing non-overlapping slices. Compliance is read-only with no remediation links. Data Governance has redundant overview + detail tabs.

**Plan:**

1. Single `/governance` page with four tabs: **Audit log**, **SOC 2 controls**, **Retention & DSAR**, **Encryption status**.
2. Every red metric on the SOC 2 controls tab links to a remediation action: MFA gap → IAM filtered; encryption gap → Encryption tab; audit retention drift → Audit log filter.
3. ProvenanceVerifyPanel becomes context-aware (verifies whatever tenant the audit log filter is on).
4. Audit export gets pre-baked templates (SOC2 access review, PCI quarterly).

**Wins:** Auditors and CISOs have one destination. Provenance + audit + compliance + data governance are conceptually one thing — ledger of what happened, surfaced four ways.

**Effort:** L (≈4 days). **Risk:** Low.

### 5.5 VantaX-internal: 13 pages → 5 consoles

**Affected:** All admin-tooling pages, plus `TenantManagementPage`, `SupportConsolePage`, `SupportPage`, `SupportTriagePage`, `SupportTicketDetailPage`.

**Today:** A CSM bounces 4 pages to handle a ticket. A superadmin bounces 5 pages to manage a tenant. There's no "tenant context" that follows the user across navigation.

**Plan:** Five consoles, each with a sticky tenant-context chip in the header that persists across the console:

1. **`/console/tenants`** — TenantManagement + RevenueUsage + LLM Budget (per-tenant). Replaces `/tenants`, `/revenue`, `/admin/tenants/:id/llm`. Selecting a tenant activates the context chip.
2. **`/console/support`** — SupportConsole + SupportTickets + SupportTriage + SupportTicketDetail. List → detail in a side drawer; triage is a view mode (filter + bulk-assign), not a separate URL.
3. **`/console/health`** — PlatformHealth + IntegrationHealth + SystemAlerts + CompanyHealth (per-tenant when tenant context is set; cross-tenant when not). One place to watch the platform.
4. **`/console/operations`** — Impersonation + BulkUsers + FeatureFlags + Deployments. The "platform ops" toolkit.
5. **`/console/billing`** — Revenue (cross-tenant) + tenant LLM budget bulk-edit grid.

**Wins:**
- CSM workflow (search → tenant → ticket → response) collapses from 4 pages to 1 console.
- Tenant context chip means I never re-search.
- 13 sidebar entries collapse to 5 — much less cognitive load on internal staff onboarding.

**Effort:** XL (≈2 weeks). **Risk:** Medium-high — internal staff have muscle memory; need to keep redirects from old URLs and run a 4-week deprecation window. Worth doing because internal velocity is currently bottlenecked on this fragmentation.

### 5.6 Dashboard: role-aware landing

**Affected:** `Dashboard.tsx` + `App.tsx` routing.

**Today:** Every role lands on the same Dashboard with six competing panels.

**Plan:**

1. After login, route user to a role-specific landing:
   - `executive` → `/apex` (the merged brief from §5.1)
   - `manager` → `/pulse` (Action-required tab)
   - `operator` → `/console/actions` (the merged action queue from §5.2)
   - `analyst` → `/mind`
   - `admin` → `/integrations` (the merged surface from §5.3)
   - `support_admin` / `superadmin` → `/console/support` or `/console/health`
2. `/dashboard` becomes optional — an "all-up" view for users who want it. Default route is role-specific.

**Wins:** Every role lands somewhere they can immediately act. No more "which of six panels do I look at."

**Effort:** S (≈1 day). **Risk:** Low — purely a routing change; existing pages unchanged.

### 5.7 Provenance is a first-class UI primitive (cross-cutting)

**Affected:** Every page showing dollar figures or counts of records processed.

**Today:** Many `$NNN` / `12 records` figures on the platform are not clickable. The provenance is in the database but doesn't surface in the UI. This violates principle 3.1 and weakens the shared-savings billing case.

**Plan:**

1. Build a shared `<ProvenanceLink>` component that wraps any number with a click-through to a side panel showing: the underlying records, the field mapping that produced the number, the catalyst run that emitted it, and the confidence score.
2. Audit every page in `src/pages/` for un-linked dollar figures + record counts. Wrap them.
3. The side panel uses the existing audit + provenance APIs (`audit_log`, `provenance_chain` table from PR #199-ish).

**Wins:** Auditor walkthrough drops from "let me show you in three different tools" to "click any number on this screen." Strengthens billing position. Aligns with principle 3.1.

**Effort:** L (≈1 week to roll out across all pages). **Risk:** Low — shared component, page-by-page.

### 5.8 Confidence badges (cross-cutting)

**Affected:** Every page surfacing an inferred rule (Process Profile, Partner Mappings, Findings, Catalyst configs).

**Today:** Some pages show confidence (the auto-mapper UI), most don't.

**Plan:** Same approach as 5.7 — a shared `<ConfidenceBadge>` component (High/Medium/Low) wrapped around every inferred figure. Low-confidence rows route to a HITL review queue.

**Effort:** M. **Risk:** Low.

---

## 6. Implementation plan (waves)

Sequenced by dependency and risk. Each wave is sized so a single PR can land it without waiting on customer feedback.

### Wave 1 — Quick wins (this week)

Items with high confidence, low risk, immediate user value. Each is small enough to ship as one PR.

| # | Item | Section | Effort | PR scope |
|---|---|---|---|---|
| 1 | Replace `window.prompt()` in TransactionalActionsPage with a proper modal | §4.2 | S | 1 component, 1 hour |
| 2 | Hover affordance on summary chips (TransactionalActionsPage) | §4.2 | S | 1 line CSS, included in (1) |
| 3 | "View source record" side panel on each Action Layer row | §4.2 | M | 1 day |
| 4 | Inline action buttons on CatalystRunDetailPage discrepancy rows | §4.2 | S | 0.5 day |
| 5 | Upgrade CTA on Chat 429 dead-end | §4.3 | S | 1 hour |
| 6 | Receiver-verification inline callout on WebhooksPage | §4.4 | S | 1 hour |
| 7 | Auth UX polish (LoginPage backup-code hint, MFA resend, OAuth callback patience) | §4.6 | S | 0.5 day |

Bundle 1+2+3+4+5+6+7 into a single "Wave-1 polish" PR if desired (≈2-3 days total).

### Wave 2 — Executive surface merge + Dashboard role-aware

| # | Item | Section | Effort |
|---|---|---|---|
| 8 | Merge ApexPage + ApexBriefPage + ExecutiveSummaryPage into one Apex with three views (brief default, studio toggle, board-PDF button) | §5.1 | M |
| 9 | Role-aware post-login landing | §5.6 | S |
| 10 | Drill-down on every ROIDashboardPage card | §4.1 | M |

Effort: ≈4-5 days. Risk: Low. High visibility to executives.

### Wave 3 — Integrations consolidation

| # | Item | Section | Effort |
|---|---|---|---|
| 11 | Consolidate IntegrationsPage + ConnectivityPage + IntegrationHealthPage + PartnerMappingsPage + WebhooksPage into one `/integrations` with five tabs | §5.3 | L |
| 12 | Sticky connection-context chip across the merged page | §3.4 + §5.3 | M |
| 13 | "Test connection" button on the Integrations create form | §4.4 | S |

Effort: ≈5 days. Risk: Low. High value to IT admins.

### Wave 4 — Governance Hub

| # | Item | Section | Effort |
|---|---|---|---|
| 14 | Consolidate AuditPage + CompliancePage + DataGovernancePage into `/governance` with four tabs | §5.4 | L |
| 15 | Pre-baked report templates on Audit tab | §4.4 | M |
| 16 | Remediation links from every red SOC2 metric to its remediation surface | §4.4 | M |

Effort: ≈4-5 days. Risk: Low. High value to auditors + CISOs.

### Wave 5 — Provenance + Confidence as primitives (cross-cutting)

| # | Item | Section | Effort |
|---|---|---|---|
| 17 | Shared `<ProvenanceLink>` component + side panel | §5.7 | M |
| 18 | Wrap every `$NNN` / record count in `<ProvenanceLink>` (sweep across all pages) | §5.7 | M |
| 19 | Shared `<ConfidenceBadge>` component | §5.8 | S |
| 20 | Audit every inferred-rule UI for missing confidence; add badges | §5.8 | M |

Effort: ≈1 week. Risk: Low. Strengthens billing position; one of the highest-leverage changes for the shared-savings revenue model.

### Wave 6 — Action queue unification

| # | Item | Section | Effort |
|---|---|---|---|
| 21 | Merge catalyst_actions surface into TransactionalActionsPage (single operator queue) | §5.2 | L |
| 22 | Retire ActionQueuePanel from Dashboard; replace with one-line link | §5.2 | S |

Effort: ≈3-4 days. Risk: Medium (schema review needed). High value to operators.

### Wave 7 — Internal-tools console consolidation (largest, highest internal velocity gain)

| # | Item | Section | Effort |
|---|---|---|---|
| 23 | `/console/tenants` (Tenants + Revenue + per-tenant LLM budget) | §5.5 | L |
| 24 | `/console/support` (Support console + tickets + triage + detail in side drawer) | §5.5 | L |
| 25 | `/console/health` (Platform Health + Integration Health + System Alerts + Company Health) | §5.5 | L |
| 26 | `/console/operations` (Impersonate + Bulk Users + Feature Flags + Deployments) | §5.5 | L |
| 27 | Sticky tenant-context chip across all five consoles | §3.4 | M |
| 28 | Redirects from old URLs with deprecation banner | §5.5 | S |

Effort: ≈2 weeks. Risk: Medium-high (internal muscle memory). Highest internal-velocity gain in the doc.

### Wave 8 — Memory, IAM, Catalysts cleanup

| # | Item | Section | Effort |
|---|---|---|---|
| 29 | Reorder Memory tabs (search-first); gate curation behind admin role | §4.3 | S |
| 30 | Merge `CustomRoleBuilderPage` into IAMPage as Custom Roles sub-tab | §4.4 | M |
| 31 | Catalysts page restructure: Catalog / Exceptions / Runs (3 lanes) | §4.2 | L |

Effort: ≈1 week. Risk: Low.

---

## 7. Open questions / where research is still thin

Honest about uncertainty:

1. **Which roles actually use Dashboard today?** The §5.6 "role-aware landing" recommendation assumes most roles ignore Dashboard. If usage telemetry shows otherwise, we need to keep Dashboard prominent and adjust.
2. **Internal-staff URL muscle memory.** §5.5 collapses 13 pages into 5 consoles. Before announcing this, walk through the change with at least 3 internal CSMs / support staff to confirm the consoles align with how they actually work.
3. **Catalyst_actions vs transactional_actions schema reconciliation.** §5.2 requires a careful schema review — unclear whether the columns can fully unify without data migration.
4. **Customer adoption signal for ROI vs Apex.** Both pages target executives. If telemetry shows ROI Dashboard has zero traffic, Wave 2 should retire it instead of refactoring it.

---

## 8. What I'd ship first if I had to pick one PR

If only one item from this doc gets implemented this quarter, **§5.1 (Executive surface merge) + §5.6 (role-aware landing) bundled together**. Reason: it's the cheapest change in the doc that materially upgrades the daily experience of the most economically-leveraged user (the CFO who decides whether Atheon stays in their stack).

If two: add **§5.7 (Provenance as a first-class UI primitive)**. Reason: it's foundational to the shared-savings billing case. Every dollar Atheon claims becomes defensible. This pays for itself by making renewal conversations easier.

If three: add **§5.3 (Integrations consolidation)**. Reason: today an IT admin's "set up Atheon" experience requires hopping between four pages; this is the single biggest cause of "we couldn't get it working" conversations during onboarding.
