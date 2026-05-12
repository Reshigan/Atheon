# Stitch "Athens Executive Interface" → Atheon frontend migration

Source: Stitch project `projects/4059809207181456952`, designed 2026-05-12.
55 screens. Authored from `docs/STITCH_DESIGN_BRIEF.md`.

This doc tracks the port. The codebase keeps its existing React/router/state
plumbing (~50 routes, every API binding); the migration is **visual only**:
palette, typography, spacing, and per-screen layout density. No logic moves.

## Phase A — Foundation (this PR)

- [x] Palette swap: `#4A6B5A → #A3B18A` (sage), `#c9a059 → #CDA37E` (bronze),
      `#7AACB5 → #7EB3CD` (sky). Variable names preserved.
- [x] `--text-primary` → `#F8F9F3` (cool warm-white, matches Stitch).
- [x] Body font: `Outfit → Inter`. Mono font: `IBM Plex Mono → JetBrains Mono`.
- [x] Material Symbols Outlined font loaded for inline iconography.
- [x] `tailwind.config.js` extended with the full Stitch token set —
      `text-headline-xl/lg/md`, `text-body-base/sm`, `text-mono-data/label`,
      `text-caption`, `w-sidebar-expanded/collapsed`, `h-header-height`,
      `bg-bg-primary/secondary`, `bg-card-surface`, `border-border-card`,
      `text-accent-sage/sky/bronze`.
- [x] Body radial-gradient lifted exactly from the Stitch CSS (sage tint,
      `circle at 50% 0%`).
- [x] Component sweep: `atheon-score-ring`, `peer-comparison-bar`,
      `Sidebar`, `KpiCards`, `LoginPage`, `MarketingPage`, `DashCard`,
      `ApexPage`, `chart-theme` all re-pointed to the new palette.

## Phase B — Per-screen ports (follow-ups)

Each entry below maps a Stitch screen → the existing React page that owns it.
Visual-only port unless noted. Existing wiring stays intact.

| Stitch screen                          | Atheon route               | Status |
|----------------------------------------|----------------------------|--------|
| Atheon — Secure Login                  | `/login`                   | retheme only |
| Atheon — Onboarding Setup              | `/onboarding`              | pending |
| Authentication — MFA Challenge         | `/login` (mfa step)        | pending |
| Apex — Executive Intelligence          | `/apex`                    | pending |
| Pulse — Process Intelligence           | `/pulse`                   | pending |
| Catalysts — Autonomous Execution       | `/catalysts`               | pending |
| Catalyst — Run Detail                  | `/catalysts/:id`           | pending |
| Action Layer — Dispatch Queue          | `Dashboard` (action panel) | pending |
| ROI Dashboard — Financial Proof        | `/dashboard` (roi cards)   | pending |
| Conversational AI — Intelligence Chat  | `/chat`                    | pending |
| Memory — Knowledge Graph               | `/memory`                  | pending |
| Audit — Provenance Ledger / Trail      | `/audit`                   | pending |
| Compliance — SOC 2 Evidence Pack       | `/compliance`              | pending |
| Integrations (Connections / Mappings / Webhooks) | `/integrations` | pending |
| Integration Health — Sync Monitoring   | `/platform-health`         | pending |
| Connectivity — Live Protocols          | `/erp/*`                   | pending |
| IAM — Users & Roles, Custom Role Builder | `/iam`                   | pending |
| Governance — Data Privacy & Retention  | `/governance`              | pending |
| Deployments — Hybrid & On-Premise      | `/deployments`             | pending |
| Feature Flags — Platform Controls      | `/platform-ops/flags`      | pending |
| Platform Ops — Health & Tenants        | `/platform-ops`            | pending |
| Revenue — Platform Economics           | `/revenue`                 | pending |
| Support — All Tickets / My Tickets / Ticket Detail | `/support/*`   | pending |
| Support Console — Tenant Management    | `/support/console`         | pending |
| Settings — User Preferences / MFA      | `/settings/*`              | pending |
| Webhooks — Event Subscriptions         | `/integrations/webhooks`   | pending |
| System — Access Denied (403)           | `/403`                     | pending |

User-flow screens (multi-step journeys) are docs-only and shape acceptance
criteria for the per-page ports above:

- User Flow — Daily Exception Triage
- User Flow — ERP Connection Lifecycle
- User Flow — Executive Monthly Review
- User Flow — First-Run Onboarding
- User Flow — Partner Mapping Bootstrap
- User Flow — Support Triage & Impersonation
- User Flow — Webhook Verification Setup

## Re-fetching Stitch screens

```bash
# The MCP is wired in .mcp.json (gitignored). With it connected:
#   mcp__stitch__list_screens(projectId="4059809207181456952")
#   mcp__stitch__get_screen(name=".../screens/<id>")
# `htmlCode.downloadUrl` returns a pre-signed URL — curl it locally.
```

## Token mapping reference

| Stitch token        | Atheon CSS var / Tailwind   | Hex      |
|---------------------|-----------------------------|----------|
| bg-primary          | `--bg-primary`              | #06090D  |
| background          | `--bg-secondary` (alias)    | #101418  |
| card-surface        | `--bg-card-solid`           | #1A1F26  |
| text-primary        | `--text-primary`            | #F8F9F3  |
| text-muted          | `--text-muted`              | F8F9F3/50 |
| accent-sage         | `--accent` / `--sage`       | #A3B18A  |
| accent-sky          | `--sky`                     | #7EB3CD  |
| accent-bronze       | `--bronze`                  | #CDA37E  |
| success-emerald     | `--chart-success`           | #34D399  |
| warning-amber       | `--chart-warning`           | #FBBF24  |
| danger-red          | `--chart-danger`            | #F87171  |
| border-card         | `--border-card`             | rgba(255,255,255,0.10) |
