# Executive Frontend Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or execute inline. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reskin the Atheon SPA into the "Swiss Calm Authority" language (warm white, Archivo + IBM Plex Mono, ledger-green accent, hairline grid, light-only) across all ~57 pages, starting from the token layer.

**Architecture:** Retheme the existing CSS-vars → Tailwind `theme.extend` system. Foundation change re-skins most of the app; shell + primitives + Dashboard are the reference build; remaining pages get a mechanical refinement pass.

**Tech Stack:** React 18, Vite, TypeScript, Tailwind, vitest. Spec: `docs/superpowers/specs/2026-05-29-executive-frontend-redesign-design.md`.

**Verification note:** This is a visual retheme. Use unit tests only for behavioural/contract changes (store, component prop contracts). For token/CSS/visual changes, verify with `npm run build` (`tsc -b && vite build`) green, `npm test` green, and a browser/Playwright check. Work on branch `feat/ui-v3-swiss`, never `main`. Commit per task.

---

## Phase 0 — Foundation (tokens, fonts, light-only)

_After this phase the whole app already renders warm-white Swiss._

### Task 0.1: Branch
- [ ] `git checkout -b feat/ui-v3-swiss`
- [ ] Confirm `git status` clean of unrelated changes; do not stage untracked artifacts (`.png`, `.wrangler/`, `wrangler.jsonc`, `.playwright-mcp/`, `.superpowers/`).

### Task 0.2: Colour + radius + shadow tokens (`src/index.css` `:root`)
- [ ] Replace the `:root` light-default token values per spec §3.1 (warm white `#fbfaf7`, ink `#0f1115`, accent `#0a7d4f` + `--accent-rgb: 10,125,79`, `--neg #b03423` + `--neg-rgb`, hairline `#e4e2db`, `--line-strong #0f1115`, `--shadow-card: none`, `--shadow-modal` kept, `--radius: 0.25rem`).
- [ ] Keep the existing motion curves/durations unchanged.
- [ ] Verify: `npm run build` passes.
- [ ] Commit: `feat(ui-v3): retheme colour/radius/shadow tokens to Swiss warm-white`

### Task 0.3: Tailwind theme tokens (`tailwind.config.js`)
- [ ] In `colors`: remove `accent-sage`/`accent-sky`/`accent-bronze`; add `neg`, `paper`, `ink`, `line`, `line-strong`; keep `accent` rgb mapping.
- [ ] Replace neon status colours with print-grade: `success` → accent rgb, `warning: '#9a6b1f'`, `danger: 'var(--neg)'`.
- [ ] Collapse `borderRadius` to sharp scale (DEFAULT 2px … xl 6px, full 9999px).
- [ ] Verify: `npm run build` passes.
- [ ] Commit: `feat(ui-v3): sharp radii + print-grade status colours in tailwind theme`

### Task 0.4: Fonts (`index.html` + `src/index.css` + `tailwind.config.js`)
- [ ] Swap the Google Fonts `<link>` in `index.html` to Archivo + Archivo Expanded + IBM Plex Mono (keep Material Symbols link). Per spec §3.3.
- [ ] Update `fontFamily` in `tailwind.config.js` (sans/body/display = Archivo, headline = Archivo Expanded, mono/mono-data = IBM Plex Mono).
- [ ] Redefine the `fontSize` scale per spec §3.3 (hero 72/900, display 40/900, figure-lg 46/800, figure 34/800, headline-lg 20/700, body-base 13.5, body-sm 12, mono-data 13, eyebrow 9.5/.2em, caption 11).
- [ ] Set `body { font-family: 'Archivo', … }` in `src/index.css`; remove Inter `font-feature-settings`. Add `.tnum { font-variant-numeric: tabular-nums }` utility and a `prefers-reduced-motion: reduce` block.
- [ ] Verify: `npm run build` passes.
- [ ] Commit: `feat(ui-v3): Archivo + IBM Plex Mono type system`

### Task 0.5: Light-only — remove dark theme
- [ ] Remove the `.atheon-dark { … }` block from `src/index.css`.
- [ ] `src/components/layout/AppLayout.tsx`: stop applying the `atheon-dark` class; ensure warm-white field.
- [ ] `src/stores/appStore.ts`: remove/neutralise dark-theme toggle state.
- [ ] Update `src/stores/__tests__/appStore.test.ts` to match (remove dark-toggle assertions).
- [ ] Verify: `npm test` green; `npm run build` passes.
- [ ] Commit: `feat(ui-v3): retire dark theme — light-only for v1`

### Task 0.6: Hardcoded-hex sweep
- [ ] `grep -rln "A3B18A" src` (11 files) → replace sage with `var(--accent)` / `text-accent` / token classes.
- [ ] `grep -rln "0A0E2A" src` (3 files) → replace navy with `var(--bg-primary)` / token.
- [ ] Verify: `npm run build` passes; `grep -rn "A3B18A\|0A0E2A" src` returns nothing.
- [ ] Commit: `refactor(ui-v3): replace hardcoded sage/navy hexes with tokens`

**Phase 0 gate:** build + tests green; app renders warm-white with Archivo type; no dark remnants. Browser-check the Dashboard renders without obvious breakage before proceeding.

---

## Phase 1 — Shell + primitives

### Task 1.1: Migrate retired card variants
- [ ] `grep -rln 'variant="\(glass\|mint\|black\)"' src` (4 files) → migrate each to the new default/`panel` card usage.
- [ ] In `src/components/ui/card.tsx`: remove `glass`/`mint`/`black` variants; default = warm-white surface + 1px hairline border + sharp corners + no shadow; add `panel` (borderless, hairline top-rule). Update CVA variant types.
- [ ] If `card.tsx` has tests, update them; else add a small render test asserting the default variant has border + no shadow class.
- [ ] Verify: `npm run build` + `npm test` green.
- [ ] Commit: `feat(ui-v3): Swiss card — hairline borders, sharp, no shadow; drop glass/mint/black`

### Task 1.2: PageHeader primitive
- [ ] Create `src/components/ui/page-header.tsx`: props `{ eyebrow, title, dek?, live?, actions? }`; renders uppercase letterspaced eyebrow + optional accent live tick → `text-display` Archivo-900 title → muted dek → 1.5px `--line-strong` rule.
- [ ] Add a render test (title + eyebrow present; rule element present).
- [ ] Verify: build + test green.
- [ ] Commit: `feat(ui-v3): add PageHeader masthead primitive`

### Task 1.3: MetricGrid primitive
- [ ] Create `src/components/ui/metric-grid.tsx`: a grid of cells with hairline vertical dividers; cell props `{ k, value, sub?, delta?, lead? }`; figure uses tabular mono/Archivo-800; `delta` accepts sign → accent (up) / `--neg` (down); `lead` widens + accent figure.
- [ ] Add a render test (renders cells, applies neg colour on negative delta).
- [ ] Verify: build + test green.
- [ ] Commit: `feat(ui-v3): add MetricGrid primitive (two-tier delta colour)`

### Task 1.4: Restyle remaining primitives
- [ ] `button.tsx` (ink-fill primary, accent reserved, keep `:active scale(.97)`, sharp), `status-pill.tsx` (print palette, hairline, mono), `atheon-score-ring.tsx`/`score-ring.tsx` (2px ink track + accent arc, flat), `sparkline.tsx` (2px accent + baseline + end-dot), `numeric.tsx` (tabular + mono), and token-driven restyle of `badge/tabs/input/modal/progress/breadcrumbs/skeleton/state`.
- [ ] Update any existing primitive tests; keep contracts stable.
- [ ] Verify: build + test green.
- [ ] Commit: `feat(ui-v3): restyle primitives to Swiss (flat, hairline, accent-sparingly)`

### Task 1.5: Sidebar + Header
- [ ] `Sidebar.tsx`: light rail, Archivo-Expanded brand mark + 3px accent tab, active leaf = ink fill/paper text, counts in faint mono. **Preserve all 5 sections, the `SECTIONS` array, `roles[]` gating, and auto-expand.**
- [ ] `Header.tsx`: warm-white top bar, hairline bottom rule, restyled switcher/search/user menu.
- [ ] Verify: build + test green; browser-check nav still renders all role-appropriate items and active state works.
- [ ] Commit: `feat(ui-v3): Swiss app shell — light sidebar rail + header`

**Phase 1 gate:** build + tests green; shell + primitives read Swiss; no functionality lost. Playwright screenshot the shell.

---

## Phase 2 — Dashboard (reference build)

### Task 2.1: Rebuild Dashboard on the new language
- [ ] `src/pages/Dashboard.tsx`: use `PageHeader` masthead → `MetricGrid` band (Value recovered lead / Atheon score / Catalysts) → lower split (Business dimensions hairline rows + ink/accent bars | journey big-number + `sparkline`) → strip (Overnight / Needs you / Assurance).
- [ ] **Declutter:** remove the duplicated Atheon Score card; fold redundant score/dimension repetition into the single journey split. Keep KPI grid, risks/anomalies, charts (restyled). Preserve ALL `api.apex.*`/`api.pulse.*` hooks and `metric-source` provenance popovers.
- [ ] Verify: build + test green; browser-check the Dashboard against the approved mockup (`/Users/reshigan/Atheon/.superpowers/brainstorm/89474-1780063197/content/swiss-interactive.html`).
- [ ] Commit: `feat(ui-v3): rebuild Dashboard in Swiss Calm Authority + declutter`

**Phase 2 gate (SHIP MILESTONE):** foundation + shell + Dashboard complete, build + tests green, Dashboard visually matches the approved direction. This is the first independently-shippable unit.

---

## Phases 3–8 — Page-group rollout

Each page below gets the **same mechanical refinement pass** (this recipe is intentionally repeated, not a placeholder — the work is identical and parameterised by page):

**Per-page recipe:**
1. Replace any remaining hardcoded colours with tokens.
2. Apply `PageHeader` for the masthead (eyebrow + title + dek + live tick where apt).
3. Convert ad-hoc cards/sections to Swiss panels / `MetricGrid`; hairline dividers; sharp corners.
4. Tabular figures + mono on all data; accent only for emphasis/positive; `--neg` red for negatives only.
5. Declutter duplication; confirm role-gated views still render.
6. Verify: `npm run build` + `npm test` green; browser-check the page (incl. a role-gated variant where relevant).
7. Commit per page or per small group: `feat(ui-v3): <PageName> in Swiss language`.

- [ ] **Phase 3 — Intelligence:** ApexPage, PulsePage, CatalystsPage, CatalystRunDetailPage, MindPage, MemoryPage, TrustPerformancePage, ExecutiveSummaryPage, BoardDigestPage, + `src/pages/dashboard/` sub-components (KpiCards, HealthDimensions, IntelligencePanel, ActionQueuePanel).
- [ ] **Phase 4 — Data + Compliance:** IntegrationsPage, WebhooksPage, ActionLayerPage, ConnectivityPage, IntegrationHealthPage, CompliancePage, AuditPage, AuditSharePage, DataGovernancePage, ConnectorsPage.
- [ ] **Phase 5 — Administration:** IAMPage, CustomRoleBuilderPage, BulkUserManagementPage, TenantManagementPage, TenantsPage, SupportPage, SupportTicketDetailPage.
- [ ] **Phase 6 — Platform Ops:** ControlPlanePage, DeploymentsPage, AssessmentsPage, PlatformHealthPage, CompanyHealthPage, SystemAlertsPage, FeatureFlagsPage, PerformancePage, SecurityPage, admin/StatusIncidentsAdminPage.
- [ ] **Phase 7 — Admin Tooling:** RevenueUsagePage, ROIDashboardPage, SupportConsolePage, admin/SupportTriagePage, ImpersonationPage, admin/TenantLlmBudgetPage.
- [ ] **Phase 8 — Auth / public / wizards:** LoginPage, MarketingPage, PricingPage, TrialPage, VerifyEmailPage, MFASetupPage, OnboardingWizardPage, StatusPage, AccessStatePage, ERPOAuthCallbackPage, SettingsPage.

**Each phase gate:** build + tests green; browser-walk the group; commit.

---

## Self-Review
- Spec coverage: tokens (§3)→Ph0; components (§4)→Ph1; shell (§5)→Ph1.5; Dashboard (§6)→Ph2; light-only (§7)→Ph0.5; rollout (§8)→Ph3–8; testing (§9)→per-task gates. Covered.
- Type consistency: `PageHeader`, `MetricGrid`, card `panel` variant referenced consistently across Ph1/Ph2/Ph3–8.
- Placeholder scan: the repeated per-page recipe is deliberate (identical parameterised work), not a TODO.
