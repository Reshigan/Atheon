# Quiet Capital — Design System Overhaul

**Date:** 2026-05-28
**Status:** Design approved (visual sections); awaiting spec review
**Scope:** Full design-system overhaul, then propagate across all 68 pages
**Author:** Brainstormed with Claude (design engineering + UI/UX review)

---

## 1. Vision

Atheon is an enterprise shared-savings platform: every claimed rand must trace to an ERP
record, a field mapping, and a confidence score. The product's visual job is to make that
provenance feel **trustworthy, calm, and expensive** — a private-bank statement, not a busy
operator console.

The aesthetic is **Quiet Capital**: a deep navy field, atmospheric depth, thin confident
typography, and *restraint*. The guiding principle is that in a category saturated with
Linear/Stripe clones, confidence comes from what we leave out. One accent. One hero number.
Generous quiet around the things that matter.

### Design principles
1. **Restraint is the brand.** Near-monochrome field; a single accent. Color earns its place.
2. **Provenance is the hero.** The shared-savings story — traced to source — is the visual centerpiece.
3. **Wayfinding without noise.** Areas are distinguished by the active-state signal and section labels, not by per-area hues.
4. **Semantic color means something.** Amber/red/emerald are reserved strictly for real status, never decoration.
5. **Motion serves meaning.** Every animation explains a cause/effect; nothing animates just to look alive.

---

## 2. Locked decisions

These were chosen one at a time through visual mockups and are the foundation of the system:

| Layer | Decision | Summary |
|---|---|---|
| **Aesthetic** | Quiet Capital | Deep navy gradient field, atmospheric radial depth, premium-calm. |
| **Typography** | Refined Grotesque | Hanken Grotesk (light) for display + hero figures; Inter for body/UI; JetBrains Mono for tabular figures. |
| **Color** | Mono + Single Signal | Navy-toned grays for all surfaces; **sage `#A3B18A` is the only brand accent** (active state + primary action). Semantic colors reserved for status. |
| **Components** | Hybrid | Solid graded-navy surfaces for all content; **glass/blur reserved exclusively for overlays** (modals, popovers, command bar, toasts) where it signals "floats above". |
| **Layout** | Persistent rail + editorial hero | Left sage-rail nav (single-signal active state); each area opens with one large editorial hero figure, then a content grid. |
| **Propagation** | Token-first, then sweep | Land tokens + primitives first, then sweep area-by-area, each shippable independently. |

---

## 3. Current state (what we're working with)

The codebase already has substantial infrastructure — this is a **refinement and consolidation**,
not a greenfield build.

**Good, keep as-is:**
- Motion tokens in [src/index.css](../../../src/index.css) already use the exact curves we want:
  `--ease-out: cubic-bezier(0.23,1,0.32,1)`, plus `--dur-press 120ms … --dur-slow 360ms`.
- A `.atheon-dark` theme already defines the navy field (`#0A0E2A`), sage accent, and a full
  shadow/border/text token set.
- The app shell ([src/components/layout/AppLayout.tsx](../../../src/components/layout/AppLayout.tsx),
  [Sidebar.tsx](../../../src/components/layout/Sidebar.tsx)) is **already a 240px left rail with a
  sage active-border** — Layout decision A is largely in place structurally.
- 27 primitives exist in [src/components/ui/](../../../src/components/ui/) (button, card, input,
  modal, badge, status-pill, tabs, toast, skeleton, hero-header, numeric, sparkline, …).
  These are refined to the new contract, not rebuilt.

**Problems this overhaul fixes:**
1. **Three overlapping color systems.** CSS vars in `index.css` (`--sage/--bronze/--sky`), a "Stitch
   palette" in `tailwind.config.js` (`surface-container-*`, `accent-sage/sky/bronze`), AND legacy
   per-area accents (`apex`/`pulse`/`catalyst`/`mind`/`memory`). The per-area hues directly
   contradict Mono + Single Signal and must be retired.
2. **Hanken Grotesk is not loaded.** `index.html` loads Instrument Serif + Outfit + Inter +
   JetBrains Mono; Tailwind's `headline` family points at Inter. Display type is wrong.
3. **Type scale is off-brand.** The `fontSize` scale is labelled "Bloomberg-grade / Stitch" with
   600-weight headlines — conflicts with Refined Grotesque's light (300) display voice.
4. **Glass is on content.** ~75 `backdrop-blur` usages across ~7 files + ~10 glass utility classes
   in `index.css`, applied to content cards. Hybrid requires glass only on overlays.

---

## 4. Token architecture (the contract)

The single source of truth becomes the CSS-variable layer in `src/index.css`, with
`tailwind.config.js` referencing those variables (no literal hex in the Tailwind palette except
the raw scale primitives). Quiet Capital is **dark-first**: the navy theme becomes the canonical
`:root`. (See §9 for the light-mode scope decision.)

### 4.1 Color
```
/* Field */
--field-base:      #0A0E2A;   /* deep navy */
--field-deep:      #080B1F;   /* gradient floor */
--field-gradient:  radial-gradient(130% 110% at 82% -12%, #141A3A 0%, #0A0E2A 60%);

/* Surfaces (graded navy — solid, no blur) */
--surface-1:       #161D3A;   /* default content card */
--surface-2:       #1B2344;   /* raised card */
--surface-sunken:  #11163A;   /* wells, inset panels */
--border-hairline: #283157;   /* 1px crisp border */
--border-subtle:   rgba(255,255,255,.06);

/* Text */
--text-primary:    #EEF1F8;
--text-secondary:  #AEB8D4;
--text-muted:      #8C98B8;
--text-faint:      #6F7BA0;

/* Single signal */
--accent:          #A3B18A;   /* sage — the ONLY brand accent */
--accent-hover:    #B1BE99;
--accent-press:    #94A27C;
--accent-on:       #0E1226;   /* text/icon on sage fills */
--accent-glow:     rgba(163,177,138,.18);
--accent-rail:     #A3B18A;   /* active nav indicator */

/* Semantic — RESERVED for status only, never decoration */
--positive:        #7CFFB2;   /* emerald — gains, success */
--warning:         #FFC857;   /* amber — needs attention */
--critical:        #FF6B6B;   /* red — failures, rejects */
--info:            #7EB3CD;   /* sky — neutral notices (sparingly) */

/* Overlay (glass) — used ONLY on floating layers */
--overlay-bg:      rgba(20,26,58,.72);
--overlay-blur:    14px;
--overlay-border:  rgba(163,177,138,.28);
```
The legacy per-area accents (`apex/pulse/catalyst/mind/memory`) and the duplicate Stitch surface
scale are **deleted**. Sky (`#7EB3CD`) survives only as `--info`, used sparingly.

### 4.2 Typography
```
--font-display: 'Hanken Grotesk', system-ui, sans-serif;  /* headings + hero figures */
--font-body:    'Inter', system-ui, sans-serif;           /* body, UI, labels */
--font-mono:    'JetBrains Mono', ui-monospace, monospace; /* tabular figures, IDs, codes */
```
Type scale (Refined Grotesque — light display, comfortable body):

| Token | Size / line-height / weight | Use |
|---|---|---|
| `hero` | 56–64px / .92 / 300 | The one big number per view (Hanken) |
| `display` | 30–38px / 1.0 / 300 | Section hero figures (Hanken) |
| `h1` | 25px / 1.12 / 500 | Page titles (Hanken) |
| `h2` | 18px / 1.3 / 500 | Card/section headings (Hanken) |
| `body` | 14px / 1.6 / 400 | Default text (Inter) |
| `body-sm` | 13px / 1.5 / 400 | Secondary text (Inter) |
| `label` | 9–10px / 1 / 500 / .16em tracking / uppercase | Kickers, eyebrows (Inter) |
| `mono` | 13px / 1.4 / 450 | Figures in tables, confidence %, IDs (JetBrains) |

**Font loading:** add Hanken Grotesk (weights 300/400/500/600) to `index.html`; remove Instrument
Serif and Outfit (no longer referenced). Keep Inter, JetBrains Mono, Material Symbols. `font-display: swap` retained.

### 4.3 Spacing, radius, elevation
- **Spacing:** keep the existing 4px base scale (`xs 4 / sm 8 / md 16 / lg 24 / xl 32`).
- **Radius:** `--radius-sm 7px / --radius 11px / --radius-lg 14px`. Cards use `--radius`; buttons/inputs `--radius-sm`.
- **Elevation (solid, no blur for content):**
  ```
  --elev-flat:   none;
  --elev-card:   0 1px 0 rgba(255,255,255,.04) inset, 0 8px 22px rgba(0,0,0,.35);
  --elev-raised: 0 1px 0 rgba(255,255,255,.05) inset, 0 14px 34px rgba(0,0,0,.42);
  --elev-overlay:0 16px 40px rgba(0,0,0,.5);   /* glass overlays only */
  ```

### 4.4 Motion (already correct — formalize)
Keep `--ease-out / --ease-in-out / --ease-drawer` and the duration scale. Codify usage:
- Press feedback: `transform: scale(.97)` over `--dur-press`.
- Enter/exit: `--ease-out`; on-screen movement: `--ease-in-out`.
- Cards lift `translateY(-4px)` on hover over `--dur-quick`.
- Respect `prefers-reduced-motion`: disable non-essential transforms.

---

## 5. Component treatment (Hybrid)

Refine the existing [src/components/ui/](../../../src/components/ui/) primitives to consume the new
token contract. No new primitive folder; we work in place.

**Solid (content) — the default:**
- `card.tsx` → solid `--surface-1`, 1px `--border-hairline`, `--elev-card`. Add a `raised` variant (`--surface-2` + `--elev-raised`). **Remove backdrop-blur.**
- `input.tsx` → `--surface-sunken` fill, hairline border, sage focus ring (`0 0 0 3px var(--accent-glow)`).
- `button.tsx` → primary = sage fill + `--accent-on` text; ghost = translucent white + hairline; destructive = `--critical`. All get `:active { scale(.97) }`.
- `badge.tsx` / `status-pill.tsx` → semantic-color-driven; default/neutral uses navy-gray, not an accent hue.
- `tabs.tsx`, `sort-header.tsx`, `breadcrumbs.tsx`, `progress.tsx`, `skeleton.tsx` → reskin to tokens, no blur.

**Glass (overlay) — reserved:**
- `modal.tsx`, `portal.tsx`-based popovers, `toast.tsx`, dropdowns/command bar → `--overlay-bg` + `--overlay-blur` + `--overlay-border` + `--elev-overlay`. Origin-aware transform where anchored (popovers scale from trigger; modals stay centered).

**Glass cleanup:** the `.glass-card / .card-glass / .card-dark / .card-teal / .card-mint / .bg-glass*`
utilities in `index.css` are reduced to a single `.overlay-surface` utility for floating layers;
content usages across the ~7 affected files are migrated to solid `Card`.

---

## 6. Layout & shell

The left rail already exists; this refines it and standardizes the hero pattern.

- **Rail:** brand wordmark; nav grouped by section. **Active item is the only place accent appears
  in the chrome** — sage left-rail indicator (`--accent-rail`) + subtle `--accent-glow` background +
  `--text-primary`. Inactive items `--text-muted`. The five existing sections
  (Intelligence / Data / Administration / Platform Ops / Admin Tooling) are preserved.
- **Hero pattern:** a reusable `<EditorialHero>` (evolve existing `hero-header.tsx` / `cost-of-inaction-ticker.tsx`):
  kicker (label) · one `hero`/`display` figure in Hanken · one-line provenance deck · optional
  delta. The four Intelligence areas (Dashboard, Apex, Pulse, Catalysts) each open with one.
- **Content grid below hero:** solid cards on the standard spacing scale; the daily-use depth
  (action queue, anomalies, confidence) sits one glance below the hero.
- **Whitelabel:** [BrandProvider.tsx](../../../src/components/layout/BrandProvider.tsx) keeps working —
  per-tenant `--brand-accent` continues to override `--accent` at runtime. The system must look
  correct when a tenant supplies their own accent (sage is the default, not a hard dependency).

---

## 7. Propagation plan (token-first, then sweep)

Each phase is independently shippable and demoable from production.

**Phase 0 — Foundation (no visible page changes yet)**
- Add Hanken Grotesk; remove Instrument Serif + Outfit from `index.html`.
- Rewrite the token layer in `index.css`; promote navy to canonical `:root`.
- Rewrite `tailwind.config.js` palette/fonts/fontSize to reference tokens; delete per-area + Stitch duplicates.
- Reduce glass utilities to `.overlay-surface`.
- *Gate:* app still builds; no per-area accent references remain (grep clean); CI green.

**Phase 1 — Primitives**
- Refine all `src/components/ui/` primitives to the contract (§5). Add `EditorialHero`.
- *Gate:* visual smoke-check of each primitive; build + lint + typecheck green.

**Phase 2–5 — Area sweep (one PR per area, in order):**
1. **Dashboard** (`pages/dashboard/`, 4 pages) — establishes the hero+grid template.
2. **Pulse** (`pages/pulse/`, 3 pages) — migrate AnomalyList off glass.
3. **Apex** (`pages/apex/` + top-level) — strategic depth panels to solid.
4. **Catalysts** (`pages/catalysts/`, 6 pages) — heaviest glass usage; migrate panels.
5. **Remainder** — admin/, platform-ops, settings, and the ~50 top-level pages, grouped by section.

- *Gate per area:* the area renders correctly in the live demo; no blur on content; semantic colors
  only on status; hero present where applicable.

---

## 8. Verification & testing

- **Build/lint/typecheck** green at every gate (CI runs `tsc -b`, stricter than local `tsc --noEmit`).
- **Grep gates:** Phase 0 ends with zero references to retired tokens (`apex.|pulse.|catalyst.|mind.|memory.`
  color classes, Instrument Serif, Outfit, `surface-container-`). Area phases end with zero
  `backdrop-blur` on content components.
- **Visual smoke:** for each area, load the live page (Playwright screenshot or manual) and confirm
  hero, solid surfaces, single-accent chrome, semantic-only status color.
- **Accessibility:** verify text/background pairs meet 4.5:1 on the navy field (the muted/faint text
  tokens are the risk); focus rings visible; `prefers-reduced-motion` respected.
- **Whitelabel:** sanity-check one tenant with a non-sage brand accent.

---

## 9. Out of scope / open decisions

- **Light mode (decision needed at spec review):** Quiet Capital is inherently a dark navy field;
  every mockup is dark. **Recommendation:** make dark the single canonical theme and retire the
  legacy light palette from the overhaul (leave it deprecated/untouched rather than redesigning it).
  Redesigning a parallel light theme would roughly double the surface area for little demo value.
  *Flagging for explicit confirmation.*
- **Charts:** the chart theme vars (`--chart-*`) will be repointed to the new tokens (sage primary,
  semantic for status) but a full chart-by-chart redesign is out of scope for this overhaul.
- **No new features.** This is purely visual/structural; data flows, routes, and business logic are untouched.
- **Material Symbols** icon font is retained as-is (icon redesign out of scope).

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| Token rewrite breaks pages that referenced literal Tailwind colors | Phase 0 grep gate catches retired references before sweep begins |
| 68 pages is large; sweep could stall mid-way | Area-by-area PRs keep the product coherent and shippable at every step; partial completion still looks intentional |
| Removing glass loses the "premium" feel users associate with today's UI | Glass is *reserved*, not removed — overlays keep it, and solid navy surfaces read as *more* premium (calmer), not less |
| Contrast regressions on muted text against navy | Accessibility gate per area; muted/faint tokens tuned to 4.5:1 |
| Whitelabel tenants with clashing accents | `--brand-accent` override preserved; system designed so sage is a default, not a hard dependency |
