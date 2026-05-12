# Atheon Frontend — World-Class Redesign Proposal

**Date:** 2026-05-12
**Author:** Claude Code (audit + synthesis)
**Status:** ⏳ Awaiting approval — **NO code changes have been made for this proposal**
**Reviewer:** Reshigan (CEO/owner)

This proposal answers: *"How do we make the Atheon frontend feel like one clinical, world-class enterprise product — not three systems stitched together?"*

It has three sections so you can scan or read deeply:

- **Part A** — what's actually broken right now in the live VantaX tenant (evidence-based)
- **Part B** — the design principles we'll adopt and what "world-class" means here
- **Part C** — concrete, per-screen redesign plan with phased delivery

Approve, redirect, or veto by part. No code lands until you sign off.

---

## Part A. What's wrong right now (evidence from live VantaX)

I logged into the live demo as you and pulled the data the page renders against. These are NOT speculative — every row is reproducible by calling the API endpoint listed.

### A.1 The headline complaint: two health scores at 55

**Where**: `/apex` (`ApexPage.tsx`).
**API**: `GET /api/apex/health` returns `{ overall: 55, dimensions: {...} }` — one number.
**What renders**:
- Apex Brief hero card (`ApexPage.tsx:172-196`): big `55` next to label **"Business Health"**.
- Below that, the FlipCard with `ScoreRing` (`ApexPage.tsx:782`): another big `55` next to label **"Overall Health"**.
- A few hundred lines down the same page (`ApexPage.tsx:830`): "Business Dimensions" panel where each dimension shows its sub-score plus the same 55 inferred via the average.

**Why it happens**: ApexPage was assembled across 3 phases. Each phase added "its" header card for the score because the prior phases were already shipped. Nobody removed the older one.

**Fix**: One score per page. One label. *"Atheon Score"* (or *"Health Index"*) becomes the platform-wide canonical name. Everywhere else that needs the score uses a small inline pill, not a hero card.

### A.2 Action queue with no values

**Where**: Dashboard + Apex `ActionQueuePanel`.
**API**: `GET /api/catalysts/actions` returns 7 actions but their `confidence`, `verificationStatus`, `reasoning`, `escalationLevel` are mostly empty for demo data:

```
GR/IR Reconciliation       status=completed   verification=∅
AP Invoice Validation      status=pending     verification=∅
Bank Reconciliation        status=completed   verification=∅
Inventory Reconciliation   status=in_progress verification=∅
Sales Order Matching       status=completed   verification=∅
```

**What renders**: A wide card per action with 5 columns (Confidence • Verification • Reasoning • Escalation • Time). 4 of the 5 columns are empty for every row. The card is mostly whitespace with a status badge in the corner.

**Why it happens**: The widget was designed for the autonomous-execution future where every action would have full provenance. The demo data is from before that schema was filled in. The widget renders the columns regardless.

**Fix**: Render only the columns that have data. The widget already has the metadata to know what's populated — it just doesn't gate display on it. Three columns is enough for the operator's actual question ("what needs my approval?"): **what** (catalyst), **when** (started_at relative), **what's blocking** (status + auto-escalation level if applicable).

### A.3 Process Mining shows 0 / "—"

**Where**: `/pulse?tab=processes`.
**API**: `GET /api/pulse/processes` returns 6 processes — **every one has `avgDuration: 0`** and the `steps` array has just `{ name, count }`. No per-step duration, throughput, or status.

**What renders**: My earlier `formatDuration` helper now correctly returns `"—"` instead of `Infinity`, so it's no longer literally a ∞ symbol. But the page still shows "Avg duration: —" for every process — which is honest but useless. The per-step pills that should show duration/throughput/status are entirely missing.

**Why it happens**: The backend `process_flows` row is populated by a cron sweep that computes `avg_duration_seconds = sum(completed_at - created_at) / count` over completed runs. The VantaX demo seeds runs with completed_at = created_at (no real elapsed time), so the average is genuinely zero. The steps JSON stores only `{name, count}` because real step-level timing requires per-step events the demo doesn't generate.

**Fix two options:**
- **(A) Hide what we can't measure**: drop the "Avg duration" line entirely on processes where it's 0. Steps render only the badges we actually have data for (e.g. count). Honest UX.
- **(B) Seed plausible per-step timing in demo data**: 30s for `Received`, 5m for `Processing`, 1m for `Completed`, etc. Then both the duration field and the per-step pills carry weight. Production tenants get real data; demo tenants get demonstrable data.

I'd ship **B** because it makes the demo actually demonstrate process mining. **A** is the right call for a customer with sparse data.

### A.4 Historic labels (the same number, three names)

I grepped the codebase. The composite tenant-health number is labelled, in different files:

| Label | Used in | Count |
|---|---|---|
| **Atheon Score** | Dashboard.tsx:339, ExecutiveSummaryPage.tsx:145 | 2 |
| **Business Health** | Dashboard.tsx:381, ApexPage.tsx:176, ExecutiveSummaryPage.tsx:176 | 3 |
| **Overall Health** | ApexPage.tsx:778 | 1 |
| **Composite Score** | ApexPage.tsx:816 (orphan dead-code-ish label) | 1 |

There's also `Health Score` (in tooltips), `Overall Score` (in admin-tooling), `Health Index` (in the API). Seven names. One number.

**Fix**: pick one. My recommendation: **"Atheon Score"** for the platform-wide index (it's the brand-strong term and it doesn't collide with the per-dimension scores). All other labels for the same number become bugs.

### A.5 Section headers that show engineering history, not user value

Examples in `Dashboard.tsx` source comments and visible headers:

- `{/* New Engine Summary Cards */}` (line 542) — user sees just the cards, not the comment, but the cards themselves are titled "Strategic Context", "Active Diagnostics", "ROI Tracking" — those *are* good titles, but they preview-render content that's available in full on Apex / Pulse / Catalysts respectively. So the user sees abbreviated versions twice.
- `{/* V2 Engine Summary Cards */}` (line 632) — same pattern.
- `{/* §11.7 Atheon Score + §11.2 Journey Card */}` (line 357) — spec numbers leaking out.

**Fix**: comments are internal — fine. The actual issue is the duplicate "abbreviated card on Dashboard + full card on the canonical page". The Dashboard should be a curated landing page (what needs attention) not a preview of every other page.

### A.6 Combinable cards on Dashboard

Dashboard.tsx currently has, in order:

1. Apex Score + Journey (1+2 col grid)
2. Health Ring + Business Dimensions (1+2 col grid)
3. KpiGrid (4 KPI cards)
4. Health Dimensions component (full-width)
5. Status Breakdown 4-up (Dimensions / Healthy / At Risk / Critical)
6. Action Queue Panel
7. Strategic Context + Active Diagnostics + ROI Tracking (3-up)
8. Charts row (Metrics Over Time + Health Trend)
9. Risk Summary + Process Metrics + Catalyst Activity (3-up)
10. Recent Anomalies + Recent Catalyst Actions (2-up)

That's **~10 sections, ~28 cards** above-the-fold to scroll-3. Sections 1 and 2 both show "what's our health?" Section 5 is a summarised version of section 4's data. Sections 9 and 10 are previews of /pulse and /catalysts.

A C-suite operator looking at this can't tell what they're supposed to *do* next.

### A.7 Empty-state inconsistency

Across 8+ places I counted different empty-state idioms:

- *"No baseline captured yet."* (Dashboard)
- *"No dimensions available yet"* (Dashboard)
- *"No risks active. Run an assessment to populate the risk register."* (Apex)
- *"No diagnostics run yet. Visit Pulse → Diagnostics."* (Dashboard)
- *"—"* (some places)
- *"R0M"* (ROI when value is genuinely zero — looks broken)
- Sometimes an icon + text + CTA; sometimes just a dash; sometimes a centered paragraph.

**Fix**: the `EmptyState` primitive exists (`src/components/ui/state.tsx`). Use it everywhere. One pattern: icon + title + one-line description + (optional) CTA.

---

## Part B. The "world-class" target

### B.1 What we're aspiring to

Three reference systems explicitly. None of them are SaaS dashboards — they're the targets:

1. **Bloomberg Terminal** — power-user information density. Every pixel earns its place. Reuters/FT/WSJ-quality. Specifically: monospaced numerics, sub-100ms interactions, zero decorative imagery, status colour carries semantic weight, keyboard-first.
   *Source: [Bloomberg LP — How Bloomberg Terminal UX designers conceal complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/) · [UI Density — Matt Ström-Awn](https://mattstromawn.com/writing/ui-density/)*

2. **Linear** — speed as a design value. Dark mode by default. Sub-100ms interactions. Sidebar + cards. Type system enforced via component library — no freelance sizes. Performance scored ≥90 on Lighthouse.
   *Source: [Better Design — Open-source Linear/Stripe/Vercel/Notion design systems](https://github.com/marvkr/better-design)*

3. **Clinical / Healthcare dashboards** — your framing. "Visibility over volume." Real-time clinical decision support. Scoping reviews emphasise: data density is fine if hierarchy is strict, four pillars (approach / content / behavior / usability), AI-assisted highlights replace raw dumps.
   *Source: [JMIR — Design Practices for Data Dashboards in Health Care: Scoping Review](https://www.jmir.org/2026/1/e77361/) · [Healthcare UI Design 2026 Best Practices — Eleken](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications)*

### B.2 The principles (in priority order)

1. **One number, one name, one place** — never show the same metric twice on the same screen. Never use different labels for the same metric across screens.
2. **Status is colour AND text AND icon** — colour alone is accessibility-failing. "On Track", "At Risk", "Blocked" as labels next to the colour. Same shape as financial trading dashboards: `▲ +3.2% · green · "improving"`.
3. **Hide what you can't measure** — empty fields don't render. A KPI without history doesn't show a sparkline. An action without confidence doesn't show a confidence column. Honest UX.
4. **Density with hierarchy** — Bloomberg-grade information density on power-user screens (Pulse / Catalysts / Run Detail) where the operator stares at the screen for 8 hours. *Less* density on executive screens (Apex / Executive Summary) where the CFO scans for 60 seconds.
5. **One job per screen** — every screen has one sentence that answers "what is this for?" If you can't answer in one sentence, the screen is wrong.
6. **Keyboard-first** — `⌘K` command palette, `j/k` row navigation, `/` filter, `?` shortcut overlay. (Implement on power-user screens first.)
7. **Real product UI, not illustrations** — every promotional surface (Marketing, login) shows actual product screenshots, not abstract gradients. (Already mostly there.)
8. **Performance is a design feature** — sub-100ms route transitions; sub-200ms data fetches with optimistic skeletons. Audit budget per route.

### B.3 What "clinical" means here, specifically

Borrowed from medical software but applied to enterprise ops:

- **Numbers in monospace**, so 9 fits where 1 fits. Apex Score `055` aligns vertically with `099`.
- **Three semantic colours only** — green / amber / red. Plus accent for interactive. No purple-for-fun.
- **No decorative gradients, glows, blur effects** — that's marketing-software aesthetic. Clinical = legible.
- **Hover never hides information** — a hover-tooltip is supplementary, never load-bearing. Touch-first parity.
- **Time is always relative + absolute** — `2 hours ago (13:42)`. Never just "ago".
- **Currency always shows currency code** — `R 2,450,000 (ZAR)` not `R 2.45M`. Compact format is a hover affordance, never the canonical display.
- **Trends use ▲▼ glyphs not arrow icons** — Unicode, monospace-aligned, accessible.
- **No emoji in product UI** — flag emoji for sentiment etc. is a smell. Bloomberg doesn't use 🟢. Use a coloured pill.

---

## Part C. Per-screen redesign plan

### C.1 New information architecture

**Today** (post the merges from earlier this session): 25 sidebar entries across 5 sections.

**Proposed** — fewer entries, clearer grouping. The user never sees more than 8 entries at their role; superadmin sees ≤12.

```
WORK
  Dashboard           — your personal landing: alerts + action queue + last touched
  Action Queue        — promoted to top-level (was hidden inside Catalysts)

INTELLIGENCE
  Apex                — executive intelligence (the "what should I worry about")
  Pulse               — operational intelligence (the "is the machine running")
  Catalysts           — autonomous execution (the "what is the machine doing")

KNOWLEDGE
  Memory              — graph + insights (operator deep-dive)
  Chat                — conversational query (when you don't want to click)
  Mind                — model + budget config (admin)

ADMINISTRATION
  IAM                 — users, roles, SSO
  Tenants             — multi-tenant clients (superadmin only)
  Integrations        — ERP + webhooks + connectivity (merged)
  Compliance          — Evidence · Audit · Governance · Trust  (tabs)
  Settings            — personal + tenant settings

PLATFORM OPS (superadmin / support_admin only)
  Operations Health   — infra + adoption (already merged)
  Support Console     — tenant support
  Tooling             — Impersonate · Bulk Users · Custom Roles · Feature Flags · System Alerts · Revenue · Assessments · Deployments  (single page with sub-tabs)
```

**Net**: from 25 sidebar entries to 13 (15 for superadmin). Every entry corresponds to one job. "Tooling" being a single entry with tabs lets ops collapse 8+ rarely-touched screens.

### C.2 Per-screen redesign

#### Dashboard (/dashboard) — "What needs my attention now"

**Drop**: sections 1, 2, 5, 7 from Part A.6 above (the duplicates).

**Keep + reshape**: above-the-fold becomes **one** clinical strip:

```
┌─────────────────────────────────────────────────────────────────────┐
│  Atheon Score   ▲  55 / 100  ─  Risk band                          │
│  ─────────────────────────────────────────────────────────────────  │
│  ⚠ 2 critical risks    ⚠ 1 anomaly open   ⏳ 4 actions pending     │
└─────────────────────────────────────────────────────────────────────┘
```

Then **the action strip** — full-width, dense rows, sortable, keyboard-navigable. Each row: action title • severity pill • since • next step. Click row → navigate to /catalysts/runs/:id.

Then a **3-up bento** of links into the deeper tools, with each card showing **one** number that signals whether to drill in:

- Apex → critical risk count (link "View 5 risks →")
- Pulse → red KPI count (link "View 3 red metrics →")
- Catalysts → exception count (link "View 14 exceptions →")

That's it. ~3 sections, ~8 cards. Scrollable to zero on a 14" laptop.

#### Apex (/apex) — "What are my top business risks"

**Drop**: the second hero (Overall Health FlipCard, lines 776+). The Brief at the top is enough.

**Restructure tabs into**:
1. **Brief** (default) — health number ONCE; 3-card "top of mind" (top risk • top strategic signal • top opportunity); narrative.
2. **Risks** — full register with filter (severity / category), search, hover-trace.
3. **Health** — score breakdown across dimensions; trend; drill-down per dimension. The current scattered "dimensions appears 3 times in different layouts" → one source of truth.
4. **Strategic Signals** — external signals + competitor intel.
5. **Scenarios** — what-if (already wired).
6. **Board Pack** — generate / list / download (currently a button hidden in the corner).

#### Pulse (/pulse) — "Is the machine running"

This is the power-user screen. Bloomberg density target.

**Hero**: 5-column counts strip (Metrics on track / At risk / Red / Anomalies open / Processes degraded). Tight monospace numerics. No cards, no decoration.

**Tabs**:
1. **Metrics** — table, not cards. Sortable. Sparkline column. Status column. Filter via the new FilterBar primitive.
2. **Anomalies** — table. Status colour, expected/actual, anomaly score, action.
3. **Processes** — process flow viz. Where per-step data is missing, hide the field instead of showing 0 or `—`.
4. **Correlations** — heatmap or list.

`⌘K` opens command palette for "go to metric: X".

#### Catalysts (/catalysts) — "What is the machine doing"

This is the second power-user screen. Already cleaned up via the recent dedup move. Keep that.

**Drop**: any preview cards that duplicate the dashboard.

**Tabs**: Clusters (cards) • Actions (table) • Run Analytics (table) • Run Detail (drill-down, already strong) • HITL queue • Catalyst Intelligence (patterns/prescriptions).

`Run Detail` is already the densest, most clinical screen in the platform. Keep it as the reference.

#### Run Detail (/catalysts/runs/:id) — already strong

Largely keep. Three small polish moves:
- Header KPI strip uses the same 5-column counts pattern as Pulse hero so power users move between Pulse + Run Detail without cognitive shift.
- "Run Items" table gains a **bulk-approve via keyboard** (`shift+click` range select, `a` to approve, `r` to reject) — matches Linear's issue triage UX.
- Comments panel: collapsed by default; ⌘. to toggle.

#### Compliance (/compliance) — already merged, polish only

Three tabs already (Evidence · Audit Log · Governance). The Evidence tab has 8 control cards stacked. Compress to a dense table view at the top + the cards as a "details" panel that expands per control. The auditor's first job is "show me the controls"; the second job is "show me the evidence for this control".

#### Operations Health (/platform-health) — already merged, polish only

Role-conditional rendering works. Two sub-polishes:
- Superadmin view: 5-column counts strip matches Pulse pattern.
- Admin view (CompanyHealthPage content): same.

#### Executive Summary (/executive-summary) — promote or retire

This page mostly duplicates Apex's Brief tab. Two options:
- **Promote**: this becomes the "shareable / printable" version. Add a "Download PDF" CTA, a "Schedule weekly email" CTA, a "Copy link with embed token" CTA. Then this page has a clear job (one-page distribution for execs who don't log in daily).
- **Retire**: redirect `/executive-summary` → `/apex` and add the export/scheduling features to Apex Brief.

I'd go with **promote**. Executive distribution is a real need; Apex is the live console; they're different jobs.

#### ROI Dashboard (/roi-dashboard) — fold into Catalysts

This page lives outside the main flow. Its 4 cards (Billing / Forecast Accuracy / Calibration / DSAR) belong contextually inside Catalysts (Billing + Forecast Accuracy + Calibration) and Compliance (DSAR). Fold and redirect.

#### Mind / Memory / Chat — already grouped, polish only

Three AI surfaces. Now in the same sidebar section. Polish: shared header chip "AI Lab" so users feel they're in the same conceptual area.

#### Tooling — collapse 8 admin pages into one

Today's sidebar has these as separate entries:
- Impersonate, Bulk Users, Custom Roles, Revenue, Feature Flags, System Alerts, Assessments, Deployments

Move all 8 to `/tooling` as tabs. Sidebar gets one "Tooling" entry. Each tab is the existing page content unchanged.

### C.3 Design system additions (over what we shipped earlier)

The previous polish round added:
- 4-level typography scale + label/caption
- 3-tier spacing (stack/row/bento)
- Card sizes (compact/default/relaxed)
- Pills (success/warning/danger/muted/accent)
- LoadingState / ErrorState / EmptyState
- Modal primitive
- FilterBar base

**Add for "world-class":**
- **`<Numeric value unit precision direction />`** primitive — replaces freelance `.toFixed(1)`. Always monospaced. Always handles `null` (renders `—`). Always shows unit + tone for trend.
- **`<StatusPill status="critical|high|medium|low|info|verified|pending|rejected" />`** — replaces ad-hoc `<Badge variant=…>` calls. Same colour vocabulary across all screens.
- **`<DataTable />` primitive** — sortable, keyboard-navigable, sticky header, virtual scroll for >100 rows. Pulse/Catalysts/Compliance/Audit all need it.
- **Command palette** (`⌘K`) — Linear-style. Powered by an index of routes + recent items + quick actions. Single component across the whole app.
- **Keyboard shortcut overlay** (`?`) — discoverable list. Same component everywhere.
- **Toast** has shipped; add an **`Inspector` side-sheet** primitive — right-side drawer that opens detail for any row (replaces full-page navigation for read-only deep-dives). Matches Linear's issue inspector.

### C.4 Theming

Two themes:
- **Atheon Dark** (default) — clinical, terminal-like, black-blue base with sage accent.
- **Atheon Light** — for print/PDF/email export only. The product itself ships dark-by-default. (Today's light theme is functional but not the canonical experience.)

---

## Part D. Phased delivery — what we ship, in what order

Each phase is ≤1 week of focused work; tests green at each gate.

### Phase 1 — Truth (1 week)

Fix what's broken in the live demo today.

- Remove duplicate health-score rendering (Apex hero #2 dies; Dashboard hero collapses)
- Pick **"Atheon Score"** as canonical; rename across 7 surfaces
- Ship `<Numeric>` + `<StatusPill>` primitives
- ActionQueuePanel: hide empty columns
- ProcessMining: hide `0` / `—` per-step fields; seed plausible per-step timings in `demo-sap-ecc-seeder` so the demo demonstrates real data
- Standardise all empty states on `EmptyState`

**Gate**: walk the live VantaX demo end-to-end with you on a call. Every screen passes the smell test.

### Phase 2 — One job per screen (1 week)

Information architecture cleanup. URL surface stays mostly intact; structure inside each page changes.

- Dashboard collapses to 3 sections / 8 cards
- Apex restructures into 6 tabs as per Part C.2
- Pulse hero becomes 5-column counts strip; tables replace cards inside tabs
- Catalysts cards stay; preview cards on Dashboard go
- Compliance Evidence tab compresses 8 cards → table + drill-in
- ROI Dashboard folds into Catalysts + Compliance; `/roi-dashboard` retires (or redirects)
- Executive Summary gains export/schedule (decision deferred to your call)

**Gate**: shareable URL of staging environment; you sign off per screen.

### Phase 3 — Density + Speed (1 week)

Power-user features.

- `<DataTable>` primitive (sortable, sticky, virtual, keyboard nav)
- Replace 10+ ad-hoc tables across Pulse / Catalysts / Compliance / Audit
- Command palette (`⌘K`)
- Inspector side-sheet primitive
- Keyboard shortcut overlay (`?`)
- Performance budget: sub-100ms route transitions on Catalysts + Pulse + Apex

**Gate**: Lighthouse Performance ≥90 on all four power-user pages.

### Phase 4 — Distribution (1 week)

Executive Summary as a distribution surface.

- PDF export via a server-side render
- Weekly email subscription
- Embed-token link (one-time share)
- Mobile-first responsive view (you read the briefing on a phone over coffee)

**Gate**: send yourself the weekly digest; if it reads better than a SQL printout, ship.

### Phase 5 — Marketing congruence (1 week, optional)

Marketing site (`/`) refresh to match the new clinical aesthetic. Real product screenshots, sub-100ms interactions, three-tier self-serve pricing + enterprise contact path. Same design system tokens.

---

## Part E. What I'm NOT proposing

- Not a new framework or rewrite.
- Not React Server Components / Next.js migration.
- Not new chart library — recharts stays.
- Not a Storybook (yet — overhead > benefit at our scale).
- Not removing dark mode or light mode — both stay, dark is default.

---

## Approval checklist

Please tick or comment:

- [ ] Part A findings — agreed, this is the right list of "what's broken"
- [ ] Part B principles — agreed, this is the right target ("clinical / Bloomberg / Linear / healthcare")
- [ ] Part C.1 information architecture — agreed, collapse to 13 sidebar entries
- [ ] Part C.2 per-screen plan — agreed, or call out which screens you want changed
- [ ] Part C.3 design system additions — agreed
- [ ] Part C.4 theming — dark default, light for export
- [ ] Part D phasing — 5 phases × 1 week, gates as defined
- [ ] **Authorise Phase 1 to start**

Comment freely. I'll do exactly what you approve.

---

## Sources

- [Bloomberg LP — How Bloomberg Terminal UX designers conceal complexity](https://www.bloomberg.com/company/stories/how-bloomberg-terminal-ux-designers-conceal-complexity/)
- [JMIR — Design Practices for Data Dashboards in Health Care: Scoping Review (2026)](https://www.jmir.org/2026/1/e77361/)
- [Healthcare UI Design 2026 Best Practices — Eleken](https://www.eleken.co/blog-posts/user-interface-design-for-healthcare-applications)
- [Bloomberg UX](https://www.bloomberg.com/ux/)
- [UI Density — Matt Ström-Awn](https://mattstromawn.com/writing/ui-density/)
- [Better Design — Linear/Stripe/Vercel/Notion design systems](https://github.com/marvkr/better-design)
- [SAP Fiori design system patterns — Enterprise UX 2026](https://www.wearetenet.com/blog/enterprise-ux-design)
- [Dashboard Design Patterns for Modern Web Apps 2026 — Art of Styleframe](https://artofstyleframe.com/blog/dashboard-design-patterns-web-apps/)
- [Fintech UX Design 2026 Best Practices — Wildnet Edge](https://www.wildnetedge.com/blogs/fintech-ux-design-best-practices-for-financial-dashboards)
