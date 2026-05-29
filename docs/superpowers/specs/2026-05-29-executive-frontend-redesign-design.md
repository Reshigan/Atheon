# Executive Frontend Redesign — "Swiss Calm Authority" Design

**Status:** Approved design language; ready for implementation planning.
**Date:** 2026-05-29
**Owner:** Reshigan

---

## 1. Goal

Elevate the Atheon frontend so it reads as **designer-crafted and executive/board-grade** — museum-calm, not a generic dark-admin dashboard. The driving feedback (2026-05-29): _"this doesnt look executive and designer as a frontend."_ The audience is CFOs, auditors, and board members who answer for the numbers.

We adopt a single coherent visual language — **Swiss Calm Authority** — and apply it across the entire authenticated app (~57 pages), starting from the token layer so most of the app re-skins automatically, then refining page by page.

This is a **retheme of an existing design system**, not a rewrite. The current frontend already uses the canonical shadcn/ui pattern (CSS custom properties consumed by Tailwind `theme.extend`) and a primitive library. We change the *values* and a handful of *components*; the architecture stays.

---

## 2. The Design Language (validated)

Chosen from four directions (Editorial Luxe / Obsidian Premium / **Swiss Calm Authority** / The Briefing) via interactive mockups. Accent decided live: **ledger green**.

**Principles**
- Warm white field, ink type, **one accent**. The numbers carry the page.
- Hard 1px baseline grid; hairline rules and vertical dividers define structure instead of cards/shadows.
- Tabular numerals everywhere data appears — figures never jitter.
- Generous air; asymmetric column grids; uppercase letterspaced eyebrow/section labels.
- Calm motion: enter on opacity/transform only, no decorative animation; respect `prefers-reduced-motion`.

**Two-tier colour rule (important):**
- **Accent (ledger green)** = brand emphasis only — the lead figure, the live tick, the active nav tab, the "needs you" flag, the score trend line. Because green is on-message (value recovered), it doubles as the **positive** signed-delta colour.
- **Reserved red** = genuine negative signed deltas only (money/score down). Never decorative.
- Everything else is ink + warm white. This guarantees a CFO never misreads direction.

---

## 3. Design Tokens

Retheme **`src/index.css`** (`:root`) and **`tailwind.config.js`** (`theme.extend`). Light-only for v1 (see §7).

### 3.1 Colour (`:root` in `src/index.css`)
```css
--bg-primary:    #fbfaf7;   /* warm white field (was #f0f4f8) */
--bg-secondary:  #f4f2ec;   /* subtle alt panel */
--bg-card:       #ffffff;   /* cards sit a hair above paper */
--text-primary:  #0f1115;   /* ink */
--text-secondary:#6c7079;   /* muted */
--text-muted:    #9a9ea6;   /* faint — eyebrow/label/scale */
--accent:        #0a7d4f;   /* ledger green — single accent + positive */
--accent-rgb:    10, 125, 79;
--accent-hover:  #096a43;
--accent-glow:   rgba(10,125,79,0.14);
--accent-subtle: rgba(10,125,79,0.07);
--neg:           #b03423;   /* reserved: genuine negative deltas only */
--neg-rgb:       176, 52, 35;
--border-primary:#e4e2db;   /* hairline */
--border-card:   #e4e2db;
--line-strong:   #0f1115;   /* 1.5px section/header rule */
--shadow-xs:     none;
--shadow-card:   none;                              /* Swiss = flat, hairline-defined */
--shadow-modal:  0 24px 60px rgba(15,17,21,0.18);   /* overlays only */
--radius:        0.25rem;   /* sharp corners (was 0.75rem) */
```

### 3.2 Tailwind `theme.extend` (`tailwind.config.js`)
- `colors`: keep `accent` mapped to `rgb(var(--accent-rgb) / <alpha-value>)`; **remove** `accent-sage`/`accent-sky`/`accent-bronze`; add `neg: 'rgb(var(--neg-rgb) / <alpha-value>)'`, `paper: 'var(--bg-primary)'`, `ink: 'var(--text-primary)'`, `line: 'var(--border-primary)'`, `line-strong: 'var(--line-strong)'`.
- `borderRadius`: collapse to sharp scale — `DEFAULT: '2px'`, `sm: '2px'`, `md: '4px'`, `lg: '4px'`, `xl: '6px'`, `full: '9999px'`.
- Status colours: replace neon (`success-emerald #7CFFB2`, etc.) with print-grade — `success: 'rgb(var(--accent-rgb) / <alpha-value>)'` (positive = the one accent green, per the two-tier rule), `warning: '#9a6b1f'`, `danger: 'var(--neg)'`.

### 3.3 Typography
**Fonts** — replace the link in `index.html`:
```html
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700;800;900&family=Archivo+Expanded:wght@600;700;800&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet" />
```
Keep Material Symbols link (still used for nav icons).

**`fontFamily`** (`tailwind.config.js`):
```js
sans:        ['Archivo', 'system-ui', 'sans-serif'],
body:        ['Archivo', 'system-ui', 'sans-serif'],
display:     ['Archivo', 'system-ui', 'sans-serif'],     // weight 900 carries display
headline:    ['"Archivo Expanded"', 'Archivo', 'sans-serif'],
mono:        ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
'mono-data': ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
```
Set `body { font-family: 'Archivo', ... }` in `src/index.css`; drop the Inter `font-feature-settings` line.

**`fontSize` scale** (`tailwind.config.js`) — redefine to the Swiss scale:
```js
'hero':        ['72px', { lineHeight: '0.82', fontWeight: '900', letterSpacing: '-0.05em' }],
'display':     ['40px', { lineHeight: '0.96', fontWeight: '900', letterSpacing: '-0.035em' }],
'figure-lg':   ['46px', { lineHeight: '1',    fontWeight: '800', letterSpacing: '-0.03em' }],
'figure':      ['34px', { lineHeight: '1',    fontWeight: '800', letterSpacing: '-0.03em' }],
'headline-lg': ['20px', { fontWeight: '700',  letterSpacing: '-0.02em' }],
'body-base':   ['13.5px',{ lineHeight: '1.45' }],
'body-sm':     ['12px',  { lineHeight: '1.45' }],
'mono-data':   ['13px',  { fontWeight: '500' }],   // tabular figures
'eyebrow':     ['9.5px', { letterSpacing: '0.2em', fontWeight: '600' }],   // uppercase labels
'caption':     ['11px',  { fontWeight: '500' }],
```
Add a `.tnum { font-variant-numeric: tabular-nums; }` utility (or apply via the `numeric` primitive) and use it on every figure.

### 3.4 Spacing, grid, motion
- Keep the existing 4/8px spacing scale and sidebar width (240px desktop).
- Grid: introduce a reusable column-grid pattern for metric bands (e.g. `1.55fr 1fr 1fr`) with 1px vertical dividers (`border-right: 1px solid var(--border-primary)`).
- Motion: **keep** the existing custom curves (`--ease-out: cubic-bezier(.23,1,.32,1)`, etc.) and 120–360ms durations — they already match our craft bar. Add a global `@media (prefers-reduced-motion: reduce)` block that disables transitions/animations.

---

## 4. Component Changes

The 28 primitives in `src/components/ui/` mostly inherit the new look via tokens. These need explicit work:

| Component | Change |
| --- | --- |
| `card.tsx` | Default = warm-white surface, 1px hairline border, sharp corners, **no shadow**. **Retire** `glass`/`mint`/`black` variants (4 consumer files must migrate — see §8). Add a `panel` usage (borderless, hairline top-rule). |
| `button.tsx` | Primary = ink fill / paper text (matches active nav); accent used sparingly for the single primary CTA per screen. Keep `:active` `scale(0.97)` press feedback. Sharp corners. |
| `status-pill.tsx` | Print-grade palette (ink/accent/neg + muted), hairline border, mono label, no neon. |
| `atheon-score-ring.tsx` / `score-ring.tsx` | Thin 2px stroke, ink track + accent arc; flat (no glow). |
| `sparkline.tsx` | 2px accent stroke, hairline baseline, end-dot. (Used for the journey trend.) |
| `numeric.tsx` | Ensure tabular figures + IBM Plex Mono for data contexts. |
| `badge`, `tabs`, `input`, `modal`, `progress`, `breadcrumbs`, `skeleton`, `state` | Token-driven restyle: hairlines, sharp corners, accent for active/emphasis only. `modal` keeps the only real shadow (`--shadow-modal`). |
| `hero-header.tsx` | Becomes the Swiss hero band (eyebrow + live tick → Archivo-900 greeting → dek → 1.5px rule). |

**New primitives:**
- `page-header.tsx` — shared eyebrow + greeting/title + dek + live tick + optional actions. Reused on every page for consistent mastheads.
- `metric-grid.tsx` (or `data-cell.tsx`) — the asymmetric column band with hairline dividers, uppercase key, tabular figure, sub-line, signed delta.

---

## 5. App Shell

- **`Sidebar.tsx`** — light Swiss rail. Brand mark in Archivo Expanded with a 3px accent tab. **Keep all 5 sections** (Intelligence / Data / Administration / Platform Ops / Admin Tooling) + Settings footer **and all RBAC `roles[]` gating** — restyle only. Active leaf = ink fill / paper text (not the old sage right-border); section auto-expand behaviour preserved. Counts (e.g. Catalysts 142) in faint mono.
- **`Header.tsx`** — warm-white top bar, hairline bottom rule, restyled company switcher / search / user menu.
- **`AppLayout.tsx`** — stop applying `.atheon-dark` (see §7); ensure the layout renders the warm-white field.

---

## 6. Dashboard (reference build)

Rebuild `src/pages/Dashboard.tsx` on the new shell — this is the proof-of-language page. Preserve all data hooks (`api.apex.*`, `api.pulse.*`) and the `metric-source` provenance popovers (they make the shared-savings model visible — every figure traces to an ERP record + field mapping + confidence).

**Structure (top to bottom):**
1. `PageHeader` — eyebrow `Atheon / Enterprise Intelligence` + live tick → `Good morning, {name}` (Archivo 900) → dek → 1.5px rule.
2. **Metric band** (`metric-grid`) — Value recovered (lead, double-width, accent figure, "verified" pill) · Atheon score 69 (+21) · Catalysts run 142 (3 awaiting approval).
3. **Lower split** — left: Business dimensions (hairline rows, ink bars, accent on the maxed dimension, mono numbers); right: "Your Atheon journey" (big score number + accent sparkline + Dec→Today scale).
4. **Strip** — "Overnight" (recovered figure) · "Needs you" (approvals, accent flag) · "Assurance" (audit-ready traceability statement).

**Declutter:** remove the **duplicated Atheon Score card** the audit flagged, and fold redundant score/dimension repetition into the single journey split. Keep KPI grid, risks/anomalies, charts — restyled to hairline/tabular Swiss, sage→accent.

---

## 7. Light-only for v1

Retire the dark theme for this release.
- Remove the `.atheon-dark` selector block from `src/index.css`.
- `AppLayout.tsx` no longer applies the `atheon-dark` class.
- `appStore.ts` — remove/neutralise the dark-theme toggle state; update `appStore.test.ts` accordingly.
- The warm-white Swiss field is the single theme. A deliberate dark variant can be designed later as its own effort (out of scope here).

---

## 8. Full-App Rollout (all pages)

Foundation re-skins everything; each page then gets a refinement pass. Organised so **foundation + Dashboard ship first**, then page groups land incrementally.

**Phase 0 — Foundation:** tokens (§3), fonts, light-only (§7). _After this, the whole app already looks Swiss._
**Phase 1 — Shell + primitives:** §4 + §5, incl. new `page-header` / `metric-grid`.
**Phase 2 — Dashboard:** §6 (reference build + declutter).
**Phase 3 — Intelligence pages:** Apex, Pulse, Catalysts (+ CatalystRunDetail), Mind, Memory, Trust (TrustPerformance), Exec Briefing (ExecutiveSummary), Board Digest.
**Phase 4 — Data + Compliance:** Integrations, Webhooks, ActionLayer (Operator Queue), Connectivity, IntegrationHealth, Compliance, Audit (+ AuditShare), DataGovernance, Connectors.
**Phase 5 — Administration:** IAM, CustomRoleBuilder, BulkUserManagement, Clients (TenantManagement/Tenants), Support (+ SupportTicketDetail).
**Phase 6 — Platform Ops:** ControlPlane, Deployments, Assessments, PlatformHealth/OperationsHealth, SystemAlerts, IncidentManager (admin), FeatureFlags, Performance, Security.
**Phase 7 — Admin Tooling:** Revenue/RevenueUsage, SupportConsole, SupportTriage (admin), Impersonation, TenantLlmBudget (admin), ROIDashboard.
**Phase 8 — Auth / public / wizards:** Login, MarketingPage, Pricing, Trial, VerifyEmail, MFASetup, OnboardingWizard, Status, AccessState, ERPOAuthCallback, Settings.

**Per-page refinement = mostly mechanical:**
1. Replace any hardcoded sage `#A3B18A` (11 files) / navy `#0A0E2A` (3 files) with tokens.
2. Migrate retired card variants `glass`/`mint`/`black` (4 files) to the new card.
3. Apply `PageHeader` for the masthead.
4. Convert ad-hoc cards/sections to Swiss panels/grids; hairline dividers; sharp corners.
5. Tabular figures + mono on all data; accent only for emphasis/positive; reserved red for negatives.
6. Declutter duplication; verify role-gated views still render.

Pages that are pure token/primitive consumers may need little beyond steps 1–3.

---

## 9. Testing

- **Type + build:** `npm run build` (`tsc -b && vite build`) must pass after every phase.
- **Unit:** `npm test` (vitest) green throughout; update `appStore.test.ts` for the dark-theme removal; add/adjust tests where component contracts change (e.g. card variant removal, new `page-header`/`metric-grid`).
- **Visual QA:** run the dev server (`npm run dev`) and walk each page group in the browser per phase — confirm the language reads executive-grade and no page is broken by the dark→light flip or variant removal.
- **Accessibility:** ink `#0f1115` on warm white ≈ AAA. Verify ledger green `#0a7d4f` on white meets WCAG AA (≈4.7:1) for the contexts it's used; keep green for large/emphasis figures and prefer ink for small body text. Preserve focus rings; honour `prefers-reduced-motion`.

---

## 10. Out of Scope
- Backend/API changes; no new data or endpoints.
- New product features or content rewrites (beyond the Dashboard strip copy).
- A dark theme variant (deferred to a later, deliberate effort).
- Mobile-specific redesign beyond keeping existing responsive behaviour working.

---

## 11. Risks
- **Scope (57 pages):** mitigated by token-first rollout + incremental shipping (foundation + Dashboard first). Each phase is independently shippable.
- **Dark→light flip:** pages or components that assume the dark field may surface contrast bugs; the `.atheon-dark` removal touches `appStore` + `AppLayout` + a test. Grep-driven sweep (step 1) catches hardcoded hexes.
- **Card variant removal:** 4 consumer files must migrate or the build breaks — handle in Phase 1 before wider rollout.
- **Green-on-white contrast:** must be validated for small text; ink is the fallback.

---

## 12. Success Criteria
- The Dashboard and every page group read as warm-white, Archivo + IBM Plex Mono, ledger-green-accented, hairline-grid Swiss — visibly designer-crafted, not admin-generic.
- One accent, two-tier colour respected app-wide; tabular figures everywhere.
- Full nav model + RBAC + data hooks + provenance preserved; no functionality lost.
- `npm run build` and `npm test` green; no dark-theme remnants; reduced-motion honoured.
