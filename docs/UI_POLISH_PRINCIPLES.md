# Atheon UI Polish Principles (2026)

Last updated: 2026-05-12

This document captures the design principles applied across the platform during the May-2026 polish pass and the tokens that enforce them. **If you're about to write `text-[10px]`, `gap-2.5`, or another freelance value — read this first.**

---

## 1. The 2026 stance: density with clarity

The platform serves executives, ops managers, and analysts who scan dense information looking for the next action. The 2026 design trend that fits us is **"density with clarity"**, not minimalism for its own sake:

> Pack information tightly via strict grids + typographical hierarchy. Every element earns its place by moving the user toward a decision. Power features stay available via progressive disclosure, not always-on UI.

Sources informing this: [50 Best Dashboard Design Examples for 2026 — Muzli](https://muz.li/blog/best-dashboard-design-examples-inspirations-for-2026/) · [SaaS Design Trends 2026 — DesignStudioUIUX](https://www.designstudiouiux.com/blog/top-saas-design-trends/) · [Smart SaaS Dashboard Design Guide (2026) — F1Studioz](https://f1studioz.com/blog/smart-saas-dashboard-design/) · [Bento Grid Dashboard Design — Orbix](https://www.orbix.studio/blogs/bento-grid-dashboard-design-aesthetics).

The five principles below operationalise this stance.

---

## 2. Five principles

### 2.1 Every element earns its place
- **4–6 key metrics above the fold** per screen, by spatial weight. No more than 6 visible without a scroll.
- If a metric doesn't change a decision, push it behind a "View details" link or remove it.
- No decorative borders, gradients, or icons that don't aid scanning.

### 2.2 Typography is hierarchy, not preference
- One **display** number per screen — the headline KPI. Always 32px.
- **h1/h2** for section + card titles.
- **body** for content.
- **caption / label** for tertiary text (axis ticks, sublabels, "ago" timestamps).
- **Never use `text-[Npx]`** — if the token scale doesn't have your size, the design system is wrong, not the size.

### 2.3 Spacing is rhythm
- 3 gap tokens (`row-tight`, `row`, `row-loose` → 12/16/24px).
- 4 stack tokens (`stack-tight`, `stack`, `stack-loose`, `stack-page` → 12/16/24/32px).
- Below 8px tiles merge into an undifferentiated block; above 32px the layout reads as isolated elements. Stick to the tokens.

### 2.4 Accent colour is for the click
- The sage accent (`var(--accent)`) is reserved for interactive elements: buttons, "View all" links, active tab markers, focus rings.
- Decorative or informational text uses `t-muted` / `t-secondary`. If everything is highlighted, nothing is.

### 2.5 Progressive disclosure beats always-on
- Power features (filters, advanced settings, drill-downs) live behind a click — a disclosure toggle, a modal, a side sheet.
- Status pills replace ad-hoc colored badges (`.pill-success`, `.pill-warning`, `.pill-danger`, `.pill-muted`, `.pill-accent`).
- "View all" links replace inline lists longer than 5 items.

---

## 3. Design tokens (Tailwind utility classes)

All tokens defined in [`src/index.css`](../src/index.css) under `@layer utilities`.

### 3.1 Typography scale (use these names)

| Token | Size | Weight | Use case |
|---|---|---|---|
| `.text-display` | 32px / 1.1 | 600 | Hero number — one per screen |
| `.text-h1` | 22px / 1.25 | 600 | Page title |
| `.text-h2` | 16px / 1.35 | 600 | Card / section title |
| `.text-body` | 14px / 1.5 | 400 | Default content |
| `.text-body-sm` | 13px / 1.45 | 400 | Dense table rows |
| `.text-caption` | 11px / 1.4 | 500 | Sublabels, axis ticks |
| `.text-label` | 11px / 1.4 | 600 uppercase tracked | Section headers, column labels, tab labels |

**Banned**: `text-[9px]`, `text-[10px]`, `text-[11px]`. The polish pass removed 727 instances across 85 files; do not add more.

### 3.2 Spacing scale

Vertical (`stack-*`):
- `.stack-tight` — 12px between children
- `.stack` — 16px (default)
- `.stack-loose` — 24px (between sub-sections)
- `.stack-page` — 32px (between top-level page sections)

Horizontal (`row-*`):
- `.row-tight` — 12px
- `.row` — 16px (default)
- `.row-loose` — 24px

Use as: `<div className="grid grid-cols-3 row">…</div>` (gap = 16px).

### 3.3 Bento grid utilities

For KPI tiles and metric strips:
- `.bento` — auto-fit `minmax(220px, 1fr)` with 16px gaps
- `.bento-tight` — auto-fit `minmax(180px, 1fr)` with 12px gaps
- `.bento-wide` — auto-fit `minmax(280px, 1fr)` with 16px gaps

Tile size signals data priority — bigger tile = more important. No extra labels needed.

### 3.4 Status pills

Replaces ad-hoc colored badges:

```html
<span className="pill pill-success">Verified</span>
<span className="pill pill-warning">Pending</span>
<span className="pill pill-danger">Failed</span>
<span className="pill pill-muted">Draft</span>
<span className="pill pill-accent">Live</span>
```

### 3.5 Interactive text

For inline links / "View all" affordances:

```html
<a className="link-accent" href="/apex">View full context</a>
```

Hover crossfades to accent; the affordance is felt, not declared.

---

## 4. Card primitive

`<Card />` ([src/components/ui/card.tsx](../src/components/ui/card.tsx)) is the canonical card. Three padding sizes:

```tsx
<Card>Default — 20px padding, most cards</Card>
<Card size="compact">Compact — 12px, dense bento tiles</Card>
<Card size="relaxed">Relaxed — 28px, hero anchor cards</Card>
```

Variants for background:
- `default` / `glass` — translucent, light fill (default)
- `black` — dark anchor card (used for top-of-screen KPI heroes)
- `mint` / `accent` — tinted (sparingly)

**Banned**: inline `style={{ padding: ... }}`, ad-hoc `className="p-3"` overrides on `<Card>`. Pick a size; let the design system enforce rhythm.

---

## 5. What the polish pass changed (May 2026)

| Change | Files affected | Impact |
|---|---|---|
| Removed duplicate v1 "Strategic Context + Active Diagnostics" cards on Dashboard | Dashboard.tsx | -65 lines; user sees 1 set of engine summary cards, not 2 |
| Added typography tokens (`text-display` → `text-caption` / `text-label`) | index.css | One source of truth; bans freelance sizes |
| Added spacing tokens (`stack-*`, `row-*`, `bento*`) | index.css | 3 gap values, 4 stack values — was 7+6 freelance |
| Added status pills (`pill-success` / `pill-warning` / `pill-danger`) | index.css | Single source of severity colors |
| Added `link-accent` for interactive text | index.css | Accent colour now reserved for click |
| Card primitive: `size="compact"`/`relaxed"` variants | card.tsx | Removed need for inline padding overrides |
| Bulk-replaced 727 freelance text sizes | 85 files | Typography hierarchy is now scannable |
| Sidebar: removed icon collisions, added 2-line hover tooltip | Sidebar.tsx | Every menu item has unique icon + sublabel on hover |

---

## 6. Conventions for new screens

1. **Above the fold**: 4–6 metrics max, in a bento grid. The hero number is `text-display`; supporting numbers are `text-h1`.
2. **Section title**: `text-h2` + `mb-3`.
3. **Card padding**: pick a size on `<Card>`; don't override with `className`.
4. **Spacing between sections**: `.stack-loose` (24px) or `.stack-page` (32px).
5. **Spacing inside a card**: `.stack-tight` (12px) or `.stack` (16px).
6. **Status colors**: use pills, not raw `text-red-500` / `text-emerald-500` on prose.
7. **"View all" / drill-down**: use `link-accent`. Limit lists to 3–5 items inline; rest behind a link.
8. **Tooltips**: native `title=` for short labels; for richer hover content (label + sublabel) use the Sidebar pattern.

---

## 6.1 Consolidation patterns (May 2026 addendum)

After a second audit the platform "felt like 3 systems put together" — every page reinvented cards, loading states, and exec views. The following moves restore single-system feel:

### Card primitive is the only card

`Card` ([src/components/ui/card.tsx](../src/components/ui/card.tsx)) with `size` + `variant` is the **only** way to render a card. Local re-implementations like `DashCard` / `TintedCard` are banned. The Dashboard polish (2026-05-12) replaced 30 such calls.

```tsx
<Card>                 // standard tile
<Card size="compact">  // dense bento tile
<Card size="relaxed">  // hero anchor card
<Card variant="mint">  // tinted hero (was TintedCard)
<Card variant="black"> // dark anchor (Apex KPI rings)
```

### `LoadingState` / `ErrorState` / `EmptyState`

Three primitives in [src/components/ui/state.tsx](../src/components/ui/state.tsx) replace ad-hoc `{loading ? <Loader2/> : null}` spinners, inline error divs, and silent empty states. Every data-driven page should now render exactly four cases in order:

```tsx
if (loading) return <LoadingState variant="cards" count={4} />;
if (error && !data) return <ErrorState error={error} onRetry={load} />;
if (!data) return <EmptyState title="No runs yet" />;
return <RealContent />;
```

Variants:
- `LoadingState`: `inline` / `cards` / `table` / `list` / `page`
- `ErrorState`: `compact` for inline use, default for page-level
- `EmptyState`: `default` quiet, `hero` for first-time experience

**Adoption (as of 2026-05-12):** 14 pages converted across two sweeps:
ROIDashboard · RevenueUsage · SystemAlerts · FeatureFlags · Webhooks ·
PlatformHealth · Impersonation · Memory · Audit · IntegrationHealth ·
CompanyHealth · Compliance · BulkUserManagement · CustomRoleBuilder.
Remaining pages with inline `<Loader2>` patterns: ~25, mostly in long-form
pages (CatalystsPage, ApexPage, PulsePage) where Loader2 appears INSIDE
buttons / table rows (legitimate inline use, not page-level loading).

### Modal primitive

[src/components/ui/modal.tsx](../src/components/ui/modal.tsx) replaces the three DIY overlay approaches (`fixed inset-0` inline divs, raw `<Portal>` + manual backdrop, ad-hoc ConfirmDialog patterns). Use as:

```tsx
<Modal open={isOpen} onClose={() => setOpen(false)} size="md">
  <Modal.Header title="Reset password" onClose={() => setOpen(false)} />
  <Modal.Body>{form}</Modal.Body>
  <Modal.Footer>
    <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    <Button onClick={submit}>Confirm</Button>
  </Modal.Footer>
</Modal>
```

What Modal owns (so consumers don't): Portal mount, ESC-to-close, click-outside, body scroll lock, role="dialog" + aria-modal, theme-aware backdrop. Use `dismissible={false}` while a mutation is in flight. Five size bands: `sm` (24rem confirmation) / `md` (28rem form, default) / `lg` (42rem detail) / `xl` (56rem table) / `full` (viewport with 2rem inset).

### `FilterBar` base

[src/components/FilterBar.tsx](../src/components/FilterBar.tsx) replaces the ~90% copy-paste between MetricFilterBar and RunItemsFilterBar. Config-driven: search + N filter sections. Use as:

```tsx
<FilterBar
  search={{ value: q, onChange: setQ, placeholder: 'Search items…' }}
  result={{ count: filtered.length, total: items.length, noun: 'items' }}
  sections={[
    { label: 'Status',   selected: status,   onChange: setStatus,   options: STATUS_OPTIONS },
    { label: 'Severity', selected: severity, onChange: setSeverity, options: SEVERITY_OPTIONS },
  ]}
  layout="stacked"   // or "inline" — first section beside the search box
/>
```

`FilterOption` shape: `{ value, label, dotClass? }`. `dotClass` is optional — leave undefined for plain pills (the source_system category pattern). MetricFilterBar and RunItemsFilterBar are now thin wrappers over this base.

### API SDK methods only

Pages call `api.namespace.method()`, never raw `api.get('/path')`. If an endpoint isn't in the SDK yet, add it to [src/lib/api.ts](../src/lib/api.ts) first, then consume it. The 2026-05-12 sweep added `api.insightsStats.*` (5 methods: `billingSummary`, `forecastAccuracy`, `calibration`, `dsarSummary`, `platformTotals`) so ROIDashboardPage + PlatformTotalsChip no longer hit raw paths.

---

## 6.2 Page-merge backlog — shipped 2026-05-12

The 2026-05-12 audit identified four page pairs / triples that felt duplicative. All four were closed in the same sprint. Here's what each became:

### 1. Company Health → Platform Health (role-conditional)

`PlatformHealthPage` now serves as the canonical **Operations Health** surface for both audiences:

- **superadmin / support_admin** see the cross-tenant infra view (3 tabs: Infrastructure / Tenant Roster / System Alerts) — the original PlatformHealthPage.
- **admin** sees their own tenant's adoption / catalyst usage / LLM usage / entitlements (4 tabs) — the original CompanyHealthPage content, rendered inline.

Implementation: [PlatformHealthPage.tsx](../src/pages/PlatformHealthPage.tsx) does a single role check at the top and delegates to either the original `SuperadminPlatformHealth` sub-component or imports `<CompanyHealthPage />` directly. Both pages keep their working state lifecycle — no big refactor.

- Route: `/platform-health` (was superadmin-only) → relaxed to `PLATFORM_ADMIN_ROLES`
- Redirect: `/company-health` → `/platform-health` (preserves old bookmarks)
- Sidebar: "Platform Health" entry renamed to **"Operations Health"** with sublabel "Infrastructure & adoption"; the standalone "Company Health" entry is gone.

### 2. Audit + Governance → Compliance (3 tabs)

`/compliance` is now the single entry point for everything compliance-related:

| Tab | Source | What it shows |
|---|---|---|
| **Evidence Pack** | The original CompliancePage content (extracted to a `ComplianceEvidence` sub-component) | SOC 2 roll-up: access reviews, MFA posture, config changes, incident response, deprovisioning, encryption, audit retention |
| **Audit Log** | `<AuditPage />` rendered inline | Line-item `audit_log` read with filters + CSV export |
| **Governance** | `<DataGovernancePage />` rendered inline | DSAR / retention / encryption controls |

- Redirects: `/audit` → `/compliance`, `/data-governance` → `/compliance`
- Sidebar: standalone "Audit" + "Data Governance" entries deleted; **"Compliance"** sublabel updated to "Evidence · Audit · Governance"
- Each underlying page keeps its own data-fetch lifecycle — composition, not rewrite.

### 3. Mind / Memory / Chat — sidebar grouping

Memory moved from its solo `data` section into the `intelligence` section, next to Mind + Chat. No URL changes; the three AI surfaces just sit together in the sidebar now. ([Sidebar.tsx:82](../src/components/layout/Sidebar.tsx))

### 4. MarketingPage — already correct

`/` route (public landing page). Never in the authenticated sidebar nav. Nothing to fix; flagged here only because the original audit listed it.

### Net effect

| Before | After |
|---|---|
| 4 sidebar entries for "is everything OK" (Platform / Company / Compliance / Audit / Data Governance — 5 actually) | 2 entries (Operations Health + Compliance) |
| 4 URL surfaces for compliance | 1 (`/compliance` with 3 tabs) |
| 2 URL surfaces for org health | 1 (`/platform-health`, role-conditional) |
| Memory in its own 1-item section | Memory grouped under intelligence |

All retired URLs (`/audit`, `/data-governance`, `/company-health`) `<Navigate to="…" replace />` to their canonical home so existing bookmarks still work.

### Executive views: one canonical home

| URL | Page | Role |
|---|---|---|
| `/executive-summary` | ExecutiveSummaryPage | The single executive briefing — health roll-up + LLM narrative + risks |
| `/apex` | ApexPage | Full intelligence workbench (multi-tab) |
| `/dashboard` | Dashboard | Personalised landing page (your own metrics + actions) |
| ~~`/apex/brief`~~ | _redirects to `/executive-summary`_ | retired 2026-05-12 |

If you find yourself building a "third executive view", stop. Add a tab to ApexPage instead.

### Filter / selection: one pattern

For tab-style navigation use `<Tabs />`. For filter pills use `<Tabs variant="pills" />`. No ad-hoc `<button>` arrays, no inline pill divs. The 90% copy-paste between `MetricFilterBar` + `RunItemsFilterBar` should fold into a single `FilterBar` base (follow-up PR).

### API client: SDK methods only

Pages call `api.namespace.method()`, never raw `api.get('/path')`. If an endpoint isn't in the SDK yet, add it to `src/lib/api.ts` first, then consume it.

---

## 7. Where to look for examples

- **Sidebar hover tooltip** — [src/components/layout/Sidebar.tsx](../src/components/layout/Sidebar.tsx) — two-line tooltip pattern.
- **Dashboard** — [src/pages/Dashboard.tsx](../src/pages/Dashboard.tsx) — post-polish reference for KPI grid + section rhythm.
- **Card primitive** — [src/components/ui/card.tsx](../src/components/ui/card.tsx) — three padding sizes + variants.
- **Tokens** — [src/index.css](../src/index.css) — search `POLISH-2026`.

If a future change needs a value not in this document, update this document first.
