# Quiet Capital Design-System Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Atheon's three overlapping color systems and glass-everywhere styling with the approved "Quiet Capital" design language (navy field, Hanken Grotesk display, single sage accent, solid surfaces + glass-for-overlays-only), and prove it end-to-end on the Dashboard.

**Architecture:** The codebase is already token-driven — primitives consume CSS variables and shared utility classes from `src/index.css`, and the navy theme is the `.atheon-dark` class on `<body>`. So we (1) pin the dark class always-on and retire light mode, (2) rewrite the `.atheon-dark` token block to the Quiet Capital contract, (3) redefine the shared glass utility classes to be solid (flipping most content cards at once) while reserving a single `.overlay-surface` for floating layers, (4) refine the in-place `src/components/ui/` primitives, then (5) sweep the Dashboard as the template-proving area. Remaining areas follow a repeatable procedure (§ Sweep Procedure).

**Tech Stack:** React + Vite + TypeScript + Tailwind CSS + Zustand. Build: `npm run build` (`tsc -b && vite build`). Lint: `npm run lint`. Unit tests: `npm test` (vitest). Visual checks: dev server `npm run dev` + browser/Playwright screenshot.

**Verification note:** Pure visual/CSS changes can't be unit-tested meaningfully. Where logic exists (theme pin) we write a vitest. Everywhere else the gates are: build passes, lint passes, **grep gates** (no retired tokens / no content blur), and a **visual smoke screenshot** reviewed against the spec. This is stated honestly per task.

---

## File Structure

**Foundation (Phase 0):**
- `index.html` — font `<link>` tags. Responsibility: load Hanken Grotesk; drop Outfit + Instrument Serif.
- `src/index.css` — token contract (`.atheon-dark` block), shared utility classes, font-family. Responsibility: single source of truth for color/elevation/glass utilities.
- `src/stores/appStore.ts` — theme state. Responsibility: pin dark theme canonical.
- `src/stores/__tests__/appStore.test.ts` — theme unit tests.
- `tailwind.config.js` — Tailwind palette, fonts, fontSize. Responsibility: reference tokens; delete per-area + duplicate Stitch colors.

**Primitives (Phase 1)** — all in `src/components/ui/`:
- `card.tsx` (solid variants), `button.tsx` (semantic alignment), `input.tsx` (sage focus), `status-pill.tsx` + `badge.tsx` (semantic-only), `hero-header.tsx` → `EditorialHero`.

**Dashboard sweep (Phase 2):**
- `src/pages/dashboard/*.tsx` (4 pages) + the Dashboard entry page. Responsibility: apply `EditorialHero`, remove any inline blur, confirm tokens.

---

## Phase 0 — Foundation

### Task 1: Pin dark theme as the canonical (retire light mode)

**Files:**
- Modify: `src/stores/appStore.ts:96-115` and `:144-161`
- Test: `src/stores/__tests__/appStore.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/stores/__tests__/appStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from '../appStore';

describe('theme is pinned to dark (Quiet Capital)', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.classList.remove('atheon-dark');
  });

  it('initial theme is dark even with no saved preference', () => {
    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('toggleTheme keeps the theme dark', () => {
    useAppStore.getState().toggleTheme();
    expect(useAppStore.getState().theme).toBe('dark');
  });

  it('setTheme("light") is ignored and stays dark', () => {
    useAppStore.getState().setTheme('light');
    expect(useAppStore.getState().theme).toBe('dark');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- appStore`
Expected: FAIL — initial theme is `'light'`; toggle flips to light.

- [ ] **Step 3: Implement — pin dark**

In `src/stores/appStore.ts`, replace the init block (lines ~90-115). Change the default and always apply the class:

```ts
// Quiet Capital is a dark-first design system; light mode is retired.
// The .atheon-dark class is always applied so all dark-scoped tokens
// in index.css are the canonical (and only) theme users see.
const initialTheme: Theme = 'dark';
const rawAccent = typeof window !== 'undefined' ? localStorage.getItem('atheon-accent') : null;
const legacyMap: Record<string, AccentColor> = { amber: 'indigo', teal: 'indigo', sky: 'blue', cyan: 'blue' };
const migratedAccent = rawAccent && legacyMap[rawAccent] ? legacyMap[rawAccent] : rawAccent;
if (rawAccent && legacyMap[rawAccent] && typeof window !== 'undefined') { localStorage.setItem('atheon-accent', legacyMap[rawAccent]); }
const savedAccent = (migratedAccent && ACCENT_LIGHT[migratedAccent as AccentColor] ? migratedAccent : null) as AccentColor | null;
const savedOnboarding = typeof window !== 'undefined' ? localStorage.getItem('atheon-onboarding-dismissed') === 'true' : false;
const savedSelectedCompanyId = typeof window !== 'undefined' ? localStorage.getItem(SELECTED_COMPANY_LS_KEY) : null;

if (typeof document !== 'undefined') {
  document.body.classList.add('atheon-dark');
  if (savedAccent && ACCENT_LIGHT[savedAccent]) {
    applyAccentColor(savedAccent, 'dark');
  }
}
```

Then make `setTheme` and `toggleTheme` no-op to dark (lines ~144-161):

```ts
  setTheme: (_theme) => {
    // Light mode retired — always dark.
    localStorage.setItem('atheon-theme', 'dark');
    if (typeof document !== 'undefined') document.body.classList.add('atheon-dark');
    applyAccentColor((localStorage.getItem('atheon-accent') as AccentColor) || 'indigo', 'dark');
    set({ theme: 'dark' });
  },
  toggleTheme: () => {
    if (typeof document !== 'undefined') document.body.classList.add('atheon-dark');
    set({ theme: 'dark' });
    return undefined as never;
  },
```

Note: if existing call sites rely on `toggleTheme` returning state, keep the original `set((s) => ({...}))` shape but always return `{ theme: 'dark' }`. Verify with `npm run build`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- appStore`
Expected: PASS (all three new tests).

- [ ] **Step 5: Commit**

```bash
git add src/stores/appStore.ts src/stores/__tests__/appStore.test.ts
git commit -m "feat(ui-v2): pin dark theme canonical, retire light mode"
```

---

### Task 2: Load Hanken Grotesk; drop Outfit + Instrument Serif

**Files:**
- Modify: `index.html:42` and `src/index.css:171`

- [ ] **Step 1: Replace the font link**

In `index.html`, replace line 42 (the Instrument Serif / Outfit / Inter / JetBrains link) with:

```html
    <link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@300;400;500;600&family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
```

(Keep the Material Symbols link on line 43 unchanged.)

- [ ] **Step 2: Update the body font-family**

In `src/index.css`, replace line 171:

```css
    font-family: "Inter", system-ui, -apple-system, BlinkMacSystemFont, sans-serif;
```

- [ ] **Step 3: Verify build + visually confirm fonts load**

Run: `npm run dev`, open the app, confirm body text is Inter and (after Task 3/Task 11) headings render in Hanken Grotesk. DevTools → Network → filter "font" shows `HankenGrotesk` woff2 loaded, no `Outfit`/`Instrument`.
Expected: Hanken + Inter + JetBrains + Material Symbols load; Outfit/Instrument absent.

- [ ] **Step 4: Commit**

```bash
git add index.html src/index.css
git commit -m "feat(ui-v2): load Hanken Grotesk, drop Outfit + Instrument Serif"
```

---

### Task 3: Rewrite the token contract in the `.atheon-dark` block

**Files:**
- Modify: `src/index.css:105-163` (the `.atheon-dark` token block)

- [ ] **Step 1: Replace the `.atheon-dark` variable block**

Replace the body of `.atheon-dark { … }` (lines ~105-163) with the Quiet Capital contract. Map new design intent onto the EXISTING variable names so all consumers inherit it:

```css
.atheon-dark {
  /* ── Field ─────────────────────────────────────────── */
  --bg-primary: #0A0E2A;
  --bg-secondary: #11163A;
  --bg-pattern: var(--field-gradient);
  --field-gradient: radial-gradient(130% 110% at 82% -12%, #141A3A 0%, #0A0E2A 60%);

  /* ── Surfaces (solid graded navy — NO blur on content) ── */
  --bg-card: #161D3A;            /* default content surface */
  --bg-card-solid: #161D3A;
  --bg-card-hover: #1B2344;      /* raised / hover */
  --bg-elevated: #1B2344;
  --bg-sidebar: #0C1130;
  --bg-header: rgba(10,14,42,.85);
  --bg-input: #11163A;           /* sunken */
  --bg-input-focus: #141A3A;
  --bg-modal: rgba(20,26,58,.72);  /* overlay — glass */

  /* ── Borders ───────────────────────────────────────── */
  --border-primary: #283157;
  --border-card: #283157;
  --border-subtle: rgba(255,255,255,.06);
  --divider: rgba(255,255,255,.06);

  /* ── Text ──────────────────────────────────────────── */
  --text-primary: #EEF1F8;
  --text-secondary: #AEB8D4;
  --text-muted: #8C98B8;
  --text-on-accent: #0E1226;

  /* ── Single signal: sage is the ONLY brand accent ───── */
  --accent: #A3B18A;
  --accent-rgb: 163, 177, 138;
  --accent-hover: #B1BE99;
  --accent-glow: rgba(163,177,138,.18);
  --accent-subtle: rgba(163,177,138,.08);
  --accent-dark: #EEF1F8;
  --sage: #A3B18A;
  --sage-b: #B1BE99;
  /* sky/bronze retained ONLY as info/neutral data hues, used sparingly */
  --sky: #7EB3CD;
  --bronze: #CDA37E;

  /* ── Elevation (solid content) ─────────────────────── */
  --shadow-xs: 0 1px 2px rgba(0,0,0,.3);
  --shadow-card: 0 1px 0 rgba(255,255,255,.04) inset, 0 8px 22px rgba(0,0,0,.35);
  --shadow-card-hover: 0 1px 0 rgba(255,255,255,.05) inset, 0 14px 34px rgba(0,0,0,.42);
  --shadow-glass: 0 8px 22px rgba(0,0,0,.35);
  --shadow-dropdown: 0 16px 40px rgba(0,0,0,.5);
  --shadow-modal: 0 24px 48px rgba(0,0,0,.6);

  /* ── Overlay (glass) — floating layers only ────────── */
  --overlay-bg: rgba(20,26,58,.72);
  --overlay-blur: 14px;
  --overlay-border: rgba(163,177,138,.28);
  --glass-blur: 14px;

  /* ── Form & interaction ────────────────────────────── */
  --placeholder: #5F6A8C;
  --option-bg: #161D3A;
  --scrollbar-thumb: rgba(163,177,138,.18);
  --scrollbar-thumb-hover: rgba(163,177,138,.32);
  --toggle-bg: rgba(163,177,138,.12);
  --ring-focus: rgba(163,177,138,.30);

  /* ── Semantic — RESERVED for status only ───────────── */
  --positive: #7CFFB2;
  --warning: #FFC857;
  --critical: #FF6B6B;
  --info: #7EB3CD;
  --teal: #7EB3CD;
  --teal-light: rgba(126,179,205,.08);
  --teal-dark: #5d92ad;

  /* ── Chart theme → repoint to new tokens ───────────── */
  --chart-primary: var(--sage);
  --chart-secondary: var(--info);
  --chart-tertiary: var(--bronze);
  --chart-success: var(--positive);
  --chart-warning: var(--warning);
  --chart-danger: var(--critical);
  --chart-grid: rgba(255,255,255,.06);
  --chart-text: var(--text-secondary);
  --chart-tooltip-bg: var(--bg-card-solid);
  --chart-tooltip-border: var(--border-card);
}
```

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build` → expect success.
Run: `npm run dev`, open the Dashboard. Expected: navy field, solid-ish cards (full solid lands in Task 4), sage accents only, no per-area colors in chrome. Take a screenshot for the gate.

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat(ui-v2): rewrite .atheon-dark token contract to Quiet Capital"
```

---

### Task 4: Convert glass utilities to solid; add `.overlay-surface`

**Files:**
- Modify: `src/index.css` — the glass utility definitions (`.glass-card` ~222-229; `.card-glass` ~318-341; `.card-dark` ~343-352; `.card-black` ~354-367; `.card-teal` ~369-378; `.card-mint` ~380-389; `.bg-glass`/`.bg-glass-strong`/`.bg-glass-subtle` ~404-423; `.glass-panel` ~440-447).

- [ ] **Step 1: Make content card utilities solid**

Replace each content-card utility's `backdrop-filter` surface with a solid token surface. Concretely, rewrite as:

```css
  .glass-card,
  .card-glass,
  .card-dark,
  .bg-glass,
  .glass-panel {
    background: var(--bg-card);
    border: 1px solid var(--border-card);
    border-radius: 1rem;
    box-shadow: var(--shadow-card);
    transition: transform var(--dur-quick) var(--ease-out), box-shadow var(--dur-quick) var(--ease-out);
    position: relative;
  }
  .card-glass:hover, .glass-card:hover, .card-dark:hover { box-shadow: var(--shadow-card-hover); }

  .bg-glass-subtle { background: var(--bg-card); border: 1px solid var(--border-subtle); border-radius: 1rem; }

  /* raised / tinted content variants — solid, accent-tinted border only */
  .card-black { background: var(--bg-card-hover); border: 1px solid var(--border-card); border-radius: 1rem; box-shadow: var(--shadow-card); color: var(--text-primary); }
  .card-teal  { background: var(--bg-card); border: 1px solid rgba(163,177,138,.28); border-radius: 1rem; box-shadow: var(--shadow-card); }
  .card-mint  { background: var(--bg-card); border: 1px solid var(--border-card); border-radius: 1rem; box-shadow: var(--shadow-card); }
```

Keep the existing sage hairline `::before` on `.card-glass` (lines ~333-341) — it's on-brand and uses no blur. Delete the now-redundant `.atheon-dark .card-black/.card-teal/.card-mint` overrides (~391-402) since the base rules are already navy.

- [ ] **Step 2: Add the single overlay (glass) utility**

Repurpose `.bg-glass-strong` as the reserved floating-layer surface, and add an alias:

```css
  .bg-glass-strong,
  .overlay-surface {
    background: var(--overlay-bg);
    backdrop-filter: blur(var(--overlay-blur));
    -webkit-backdrop-filter: blur(var(--overlay-blur));
    border: 1px solid var(--overlay-border);
    box-shadow: var(--shadow-modal);
    border-radius: 1rem;
  }
```

- [ ] **Step 3: Grep gate — no blur left on content utilities**

Run: `grep -nE "backdrop-filter|backdrop-blur" src/index.css`
Expected: matches ONLY inside `.bg-glass-strong` / `.overlay-surface` (and `@keyframes backdropIn`, which is the modal backdrop — allowed). No matches in `.card-*` / `.glass-card` / `.glass-panel` / `.bg-glass`/`.bg-glass-subtle`.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add src/index.css
git commit -m "feat(ui-v2): solid content surfaces, reserve glass for overlays"
```

---

### Task 5: Rewrite `tailwind.config.js` — fonts, type scale, kill per-area + duplicate palettes

**Files:**
- Modify: `tailwind.config.js:18-99`

- [ ] **Step 1: Replace fontFamily + fontSize**

Replace the `fontFamily` block (lines 68-74) so `headline` is Hanken Grotesk:

```js
      fontFamily: {
        sans:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display:     ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        headline:    ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        mono:        ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'mono-data': ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
```

Replace the `fontSize` block (lines 75-85) with the Refined Grotesque scale (light display):

```js
      fontSize: {
        'hero':        ['60px', { lineHeight: '0.92', letterSpacing: '-0.03em', fontWeight: '300' }],
        'display':     ['34px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '300' }],
        'headline-xl': ['25px', { lineHeight: '1.12', letterSpacing: '-0.02em', fontWeight: '500' }],
        'headline-lg': ['20px', { lineHeight: '1.3',  fontWeight: '500' }],
        'headline-md': ['18px', { lineHeight: '1.4',  fontWeight: '500' }],
        'body-base':   ['14px', { lineHeight: '1.6',  fontWeight: '400' }],
        'body-sm':     ['13px', { lineHeight: '1.5',  fontWeight: '400' }],
        'mono-data':   ['13px', { lineHeight: '1.4',  fontWeight: '450' }],
        'mono-label':  ['10px', { lineHeight: '1',    fontWeight: '500' }],
        'caption':     ['11px', { lineHeight: '1',    letterSpacing: '0.05em', fontWeight: '500' }],
      },
```

- [ ] **Step 2: Delete retired colors**

In the `colors` block (lines 18-67): delete the duplicate Stitch surface scale (`bg-primary`, `bg-secondary`, `background`, `surface*`, `surface-container-*`, `surface-variant`, `card-surface`, `outline*`) and the legacy per-area accents (`atheon`, `apex`, `pulse`, `catalyst`, `mind`, `memory`). Keep only token-referencing entries:

```js
      colors: {
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',
        'accent-sage':     '#A3B18A',
        'accent-sky':      '#7EB3CD',
        'accent-bronze':   '#CDA37E',
        'text-primary':    'var(--text-primary)',
        'text-muted':      'var(--text-muted)',
        'border-card':     'var(--border-card)',
        // Semantic — status only
        'success-emerald': '#7CFFB2',
        'warning-amber':   '#FFC857',
        'danger-red':      '#FF6B6B',
      },
```

- [ ] **Step 3: Grep gate — find pages that referenced retired classes**

Run:
```bash
grep -rnE "text-(apex|pulse|catalyst|mind|memory)\b|bg-(apex|pulse|catalyst|mind|memory)\b|border-(apex|pulse|catalyst|mind|memory)\b|surface-container|text-atheon-[0-9]|bg-atheon-[0-9]" src --include='*.tsx'
```
Expected: a list of files to fix during the sweep. Record this list in the PR description. (If any appear in primitives or AppLayout, fix them now; page-level ones are handled in their area sweep.)

- [ ] **Step 4: Build**

Run: `npm run build`
Expected: success. If Tailwind errors on an unknown class used somewhere critical (shell/primitives), replace that class with a token equivalent and rebuild.

- [ ] **Step 5: Commit**

```bash
git add tailwind.config.js
git commit -m "feat(ui-v2): Tailwind fonts/scale to Hanken+Refined, delete per-area palettes"
```

---

### Task 6: Phase 0 gate — full build, lint, grep, visual smoke

- [ ] **Step 1: Build + lint + tests**

Run: `npm run build && npm run lint && npm test`
Expected: all green. Fix any breakages (most likely: a shell/primitive component referencing a deleted color class — swap to a token).

- [ ] **Step 2: Grep gates**

Run:
```bash
grep -rn "Outfit\|Instrument Serif" src index.html
grep -nE "backdrop-filter" src/index.css | grep -v "overlay-surface\|bg-glass-strong\|backdropIn"
```
Expected: first returns nothing; second returns nothing.

- [ ] **Step 3: Visual smoke**

Run: `npm run dev`. Screenshot Dashboard, one Pulse page, one Catalysts page. Confirm: navy field, solid cards, sage-only chrome, Hanken headings, no broken layouts. (Pages aren't swept yet — looking for "inherited correctly," not "perfect".)

- [ ] **Step 4: Commit (if any gate fixes were made)**

```bash
git add -A
git commit -m "fix(ui-v2): Phase 0 gate fixes"
```

---

## Phase 1 — Primitives

### Task 7: `Card` — solid variants

**Files:**
- Modify: `src/components/ui/card.tsx:19-26`

- [ ] **Step 1: Remap variants to solid utilities**

The variant→class map currently points everything at glass utilities (now solid after Task 4, so this mostly works). Tighten it and add a `raised` variant:

```tsx
const variantClass: Record<string, string> = {
  default: 'card-glass',          // solid (Task 4)
  raised:  'card-glass shadow-[var(--shadow-card-hover)] bg-[var(--bg-card-hover)]',
  black:   'card-black',
  mint:    'card-mint',
  accent:  'card-teal',
  glass:   'overlay-surface',     // ONLY for floating contexts
  outline: 'bg-transparent border border-[var(--border-card)] rounded-2xl',
};
```

Update the `variant` prop union on line 9 to include `'raised'`:

```tsx
  variant?: 'default' | 'raised' | 'black' | 'mint' | 'accent' | 'glass' | 'outline';
```

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build`. In `npm run dev`, confirm cards are solid navy with hairline borders and lift on hover.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/card.tsx
git commit -m "feat(ui-v2): Card solid variants + raised"
```

---

### Task 8: `Button` — align danger/success to semantic tokens

**Files:**
- Modify: `src/components/ui/button.tsx:34-41`

(`button.tsx` already has correct press feedback + easing + primary uses `var(--accent)`. Only the danger/success colors need to move to the new semantic tokens.)

- [ ] **Step 1: Update variant classes**

Replace the `variants` map (lines 34-41):

```tsx
const variants: Record<string, string> = {
  primary:   'text-[var(--text-on-accent)] shadow-sm',
  secondary: 'bg-[var(--bg-secondary)] hover:bg-[var(--bg-input-focus)] t-primary border border-[var(--border-card)]',
  ghost:     'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary hover:t-primary',
  danger:    'bg-[rgba(255,107,107,.12)] hover:bg-[rgba(255,107,107,.18)] text-[var(--critical)] border border-[rgba(255,107,107,.25)]',
  success:   'bg-[rgba(124,255,178,.12)] hover:bg-[rgba(124,255,178,.18)] text-[var(--positive)] border border-[rgba(124,255,178,.25)]',
  outline:   'bg-transparent hover:bg-[var(--bg-secondary)] t-secondary border border-[var(--border-card)]',
};
```

Note: primary text was `text-white`; on a sage fill, `var(--text-on-accent)` (#0E1226) is the correct high-contrast choice. Update line 35 as shown.

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build`. In dev, confirm: primary = sage with dark text; press scales to .97; danger/success read as semantic.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/button.tsx
git commit -m "feat(ui-v2): Button semantic danger/success + on-accent text"
```

---

### Task 9: `Input` — sage focus ring, sunken fill

**Files:**
- Modify: `src/components/ui/input.tsx:16-28`

- [ ] **Step 1: Update input styles**

Replace the `<input>` className + style (lines 16-28):

```tsx
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg px-3 py-2 text-sm',
            'focus:outline-none focus:ring-[3px] focus:ring-[var(--accent-glow)]',
            'transition-[border-color,box-shadow] duration-150',
            '[transition-timing-function:var(--ease-out)]',
            'placeholder:text-[var(--placeholder)]',
            error && 'focus:ring-[rgba(255,107,107,.25)]',
            className
          )}
          style={{
            background: 'var(--bg-input)',
            color: 'var(--text-primary)',
            border: error ? '1px solid var(--critical)' : '1px solid var(--border-card)',
          }}
          {...props}
        />
```

Note: changed `transition-all` → explicit properties (compositor-friendly), and focus ring to sage.

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build`. In dev, focus an input → sage glow ring, no layout shift.

- [ ] **Step 3: Commit**

```bash
git add src/components/ui/input.tsx
git commit -m "feat(ui-v2): Input sage focus ring + sunken fill"
```

---

### Task 10: `status-pill` / `badge` — semantic-only

**Files:**
- Read first: `src/components/ui/status-pill.tsx`, `src/components/ui/badge.tsx`
- Modify: both, to ensure neutral/default uses navy-gray (not an accent hue) and status variants map to `--positive/--warning/--critical/--info`.

- [ ] **Step 1: Read both files**

Run: open `src/components/ui/status-pill.tsx` and `src/components/ui/badge.tsx`; identify the variant→color map.

- [ ] **Step 2: Repoint variant colors to semantic tokens**

For each status/severity variant, use the `.pill-*` utilities already defined in `index.css` (success/warning/danger/muted/accent) — they already reference the right tokens. Ensure the **default/neutral** variant uses `.pill-muted` (navy-gray), and that no variant uses sky/bronze/per-area hues for decoration. If the component inlines colors, replace with the `.pill-*` class names.

- [ ] **Step 3: Build + visual smoke + commit**

```bash
npm run build
git add src/components/ui/status-pill.tsx src/components/ui/badge.tsx
git commit -m "feat(ui-v2): status pills + badges semantic-only"
```

---

### Task 11: `EditorialHero` — the reusable hero pattern

**Files:**
- Read first: `src/components/ui/hero-header.tsx` (existing `HeroHeader`, props at line 41)
- Modify/extend: `src/components/ui/hero-header.tsx` — add an `EditorialHero` export.

- [ ] **Step 1: Read `hero-header.tsx`**

Understand the existing `HeroHeaderProps` (line 41) and `HeroHeader` (line 60) so the new component reuses its container/slots rather than duplicating.

- [ ] **Step 2: Add `EditorialHero`**

Append to `src/components/ui/hero-header.tsx`:

```tsx
export interface EditorialHeroProps {
  /** Uppercase kicker / eyebrow, e.g. "Released this quarter · verified". */
  kicker: string;
  /** The one hero figure for the view, e.g. "R4.2M". Rendered in Hanken. */
  figure: string;
  /** One-line provenance deck under the figure. */
  deck?: string;
  /** Optional delta chip, e.g. "+13.5%". */
  delta?: string;
  /** Optional trailing actions (buttons). */
  actions?: ReactNode;
  className?: string;
}

export function EditorialHero({ kicker, figure, deck, delta, actions, className }: EditorialHeroProps) {
  return (
    <header className={cn('relative', className)}>
      <div className="text-label">{kicker}</div>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="font-display font-light tracking-[-0.03em] leading-[0.92] text-[clamp(40px,6vw,60px)] t-primary">
          {figure}
        </span>
        {delta && (
          <span className="font-mono text-sm" style={{ color: 'var(--positive)' }}>{delta}</span>
        )}
      </div>
      {deck && <p className="text-body-sm t-secondary mt-2 max-w-[60ch]">{deck}</p>}
      {actions && <div className="flex gap-2 mt-4">{actions}</div>}
    </header>
  );
}
```

Ensure `ReactNode` and `cn` are imported at the top of the file (add to existing imports if missing).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add src/components/ui/hero-header.tsx
git commit -m "feat(ui-v2): EditorialHero pattern (Hanken hero figure + provenance deck)"
```

---

### Task 12: Phase 1 gate — primitives showcase smoke

- [ ] **Step 1: Build + lint**

Run: `npm run build && npm run lint`
Expected: green.

- [ ] **Step 2: Visual smoke of primitives**

In `npm run dev`, navigate to any page that renders Buttons, Cards, Inputs, and pills (e.g. Settings). Confirm: solid cards, sage primary buttons with dark text + press feedback, sage focus rings, semantic-only pills, Hanken headings.

- [ ] **Step 3: Commit (if fixes made)**

```bash
git add -A && git commit -m "fix(ui-v2): Phase 1 primitive gate fixes"
```

---

## Phase 2 — Dashboard sweep (template-proving area)

This area establishes the page template every other area copies.

### Task 13: Inventory the Dashboard's current styling debt

**Files:**
- Read: `src/pages/DashboardPage.tsx` (or the dashboard entry) + `src/pages/dashboard/*.tsx`

- [ ] **Step 1: Find the dashboard files + their debt**

Run:
```bash
ls src/pages/dashboard/
grep -rnE "backdrop-blur|text-(apex|pulse|catalyst|mind|memory)|bg-(apex|pulse|catalyst|mind|memory)|surface-container|text-display|text-h1" src/pages/Dashboard*.tsx src/pages/dashboard/ 2>/dev/null
```
Expected: a concrete list of inline-blur usages and retired-color references to fix.

- [ ] **Step 2: Record the list** in the PR description as the Dashboard checklist.

(No commit — investigation only.)

---

### Task 14: Apply `EditorialHero` to the Dashboard

**Files:**
- Modify: the Dashboard entry page (the hero region) — confirmed path from Task 13.

- [ ] **Step 1: Replace the existing hero block with `EditorialHero`**

Import and use the new component, wiring the real shared-savings figure already on the page (e.g. working-capital released, confidence, QoQ delta). Example shape:

```tsx
import { EditorialHero } from '@/components/ui/hero-header';
// …
<EditorialHero
  kicker="Released this quarter · verified"
  figure={formatCurrency(totals.releasedThisQuarter)}
  deck={`${totals.invoiceCount.toLocaleString()} SAP invoices reconciled at ${totals.confidencePct}% confidence — every rand traced to source.`}
  delta={totals.qoqDelta}
/>
```

Use the page's actual data variables (from Task 13 reading) — do not invent field names; map to whatever the dashboard store/query already exposes.

- [ ] **Step 2: Build + visual smoke**

Run: `npm run build` then `npm run dev`. Confirm the hero renders the big Hanken figure + provenance deck, solid content grid below.

- [ ] **Step 3: Commit**

```bash
git add src/pages/<dashboard-entry>.tsx
git commit -m "feat(ui-v2): Dashboard editorial hero"
```

---

### Task 15: Remove inline blur + retired colors from Dashboard

**Files:**
- Modify: each file from the Task 13 list.

- [ ] **Step 1: Replace inline blur with solid `Card`**

For each `backdrop-blur*` / `bg-glass*` inline usage on a content element, replace with `<Card>` (default variant) or the solid token surface. For retired color classes (`text-pulse`, etc.), replace with `t-secondary`/`t-muted` or a semantic token where it conveyed status.

- [ ] **Step 2: Grep gate**

Run:
```bash
grep -rnE "backdrop-blur|text-(apex|pulse|catalyst|mind|memory)|bg-(apex|pulse|catalyst|mind|memory)|surface-container" src/pages/Dashboard*.tsx src/pages/dashboard/
```
Expected: no matches.

- [ ] **Step 3: Build + visual smoke + commit**

```bash
npm run build
git add src/pages/Dashboard*.tsx src/pages/dashboard/
git commit -m "feat(ui-v2): Dashboard solid surfaces + semantic colors"
```

---

### Task 16: Dashboard accessibility + final gate

- [ ] **Step 1: Contrast check**

In dev, with browser DevTools, sample `--text-muted` (#8C98B8) and `--text-secondary` (#AEB8D4) against `--bg-card` (#161D3A). Expected: both ≥ 4.5:1 (they are: ~5.0:1 and ~7.4:1). If any custom muted text fails, bump to `--text-secondary`.

- [ ] **Step 2: Reduced motion**

Confirm `@media (prefers-reduced-motion: reduce)` disables card hover transforms (add the media query to `index.css` if not present):

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .001ms !important; transition-duration: .001ms !important; }
}
```

- [ ] **Step 3: Full gate + screenshot**

Run: `npm run build && npm run lint && npm test`. Screenshot the finished Dashboard for the PR.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat(ui-v2): Dashboard a11y + reduced-motion, sweep complete"
```

---

## Sweep Procedure (Phases 3-6: Pulse → Apex → Catalysts → Remainder)

The Dashboard sweep (Tasks 13-16) is the template. Each remaining area is a **separate PR** that repeats this exact procedure. Per-file code isn't pre-written here because the concrete edits depend on each page's current markup — but the procedure is fully deterministic:

**Per area (in order: Pulse `src/pages/pulse/` → Apex `src/pages/apex/` + `ApexPage.tsx` → Catalysts `src/pages/catalysts/` → Remainder: admin/, platform-ops, settings, top-level pages grouped by Sidebar section):**

1. **Inventory** (like Task 13): `grep -rnE "backdrop-blur|text-(apex|pulse|catalyst|mind|memory)|bg-(apex|pulse|catalyst|mind|memory)|surface-container|card-glass|glass-panel|bg-glass" src/pages/<area>/` → record the checklist.
2. **Hero**: if the area has a landing view, apply `EditorialHero` with the area's real headline metric (like Task 14).
3. **Surfaces**: replace inline blur / retired color classes with solid `Card` + tokens / semantic colors (like Task 15).
4. **Grep gate**: re-run the inventory grep on the area → expect zero matches.
5. **a11y**: contrast + reduced-motion already global; just confirm no area-specific custom muted text fails.
6. **Gate**: `npm run build && npm run lint && npm test` green; visual smoke screenshot.
7. **Commit + PR**: `feat(ui-v2): <area> Quiet Capital sweep`. Ship independently.

**Definition of done for the whole overhaul:**
```bash
# zero content blur anywhere
grep -rnE "backdrop-blur" src --include='*.tsx'        # → only overlay/modal components
# zero retired palette references
grep -rnE "text-(apex|pulse|catalyst|mind|memory)\b|bg-(apex|pulse|catalyst|mind|memory)\b|surface-container|Outfit|Instrument Serif" src index.html  # → nothing
```
Both clean + every area PR merged = overhaul complete.

---

## Self-Review

**Spec coverage:**
- §2 Aesthetic (navy field) → Task 3. ✔
- §2 Typography (Hanken/Inter/JetBrains) → Tasks 2, 5, 11. ✔
- §2 Color (mono + single signal, semantic reserved) → Tasks 3, 5, 8, 10. ✔
- §2 Components (Hybrid: solid + glass overlays) → Tasks 4, 7, 9. ✔
- §2 Layout (rail + editorial hero) → Task 11 (hero); rail already exists per §3, active-state confirmed in smoke. ✔
- §4 Token contract → Task 3. ✔
- §4.2 Font loading → Task 2. ✔
- §5 Primitive refactor list → Tasks 7-11. ✔
- §6 EditorialHero / whitelabel → Task 11; whitelabel `--brand-accent` untouched (Task 1 keeps `applyAccentColor`). ✔
- §7 Propagation (token-first then sweep) → Phases 0-2 + Sweep Procedure. ✔
- §8 Verification (build/grep/visual/a11y/whitelabel) → gates in Tasks 6, 12, 16 + procedure. ✔
- §9 Light mode retired → Task 1. ✔
- §9 Charts repointed → Task 3 chart vars. ✔

**Placeholder scan:** Task 10 and Tasks 13-15 instruct reading a file first before editing because the exact current markup must be seen — these include the exact grep commands and the exact transformation rule (not vague "handle it"). The Sweep Procedure is intentionally a repeatable checklist, not per-file code, and says so with the reason. No "TBD"/"add error handling"/"write tests for the above".

**Type consistency:** `EditorialHero` props (`kicker/figure/deck/delta/actions`) are used consistently in Tasks 11 and 14. `Card` `variant` union updated in Task 7 includes `'raised'` used in the same task. Token names (`--bg-card`, `--text-on-accent`, `--positive`, `--critical`, `--overlay-bg`, `--accent-glow`) defined in Task 3 are the same ones referenced in Tasks 7-9, 11. `--text-on-accent` defined in Task 3 ✔ and used in Task 8 ✔.
