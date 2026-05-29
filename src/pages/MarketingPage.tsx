import { useEffect, useRef, useState } from "react";

/* ============================================================
   ATHEON MARKETING PAGE — Swiss Editorial (UI-v3)
   Warm white field. Ledger green accent. Hairline grid.
   Archivo grotesk + IBM Plex Mono. Light-only.
   ============================================================ */

const marketingCSS = `
.mk5-body {
  --field: var(--bg-primary, #fbfaf7);
  --field-2: var(--bg-secondary, #f4f2ec);
  --paper: var(--bg-card-solid, #ffffff);
  --paper-hover: var(--bg-card-hover, #f7f6f1);
  --ink: var(--text-primary, #0f1115);
  --ink-2: var(--text-secondary, #6c7079);
  --ink-3: var(--text-muted, #9a9ea6);
  --rule: var(--border-card, #e4e2db);
  --rule-strong: var(--line-strong, #0f1115);
  --accent: var(--accent, #0a7d4f);
  --accent-hover: var(--accent-hover, #096a43);
  --accent-tint: rgba(10, 125, 79, 0.06);
  --bronze: var(--warning, #9a6b1f);
  --neg: var(--neg, #b03423);
  font-family: 'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-feature-settings: "ss01", "ss02";
  background: var(--field);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  overflow-x: hidden;
}
.mk5-body ::selection { background: var(--accent); color: #fff; }
.mk5-body a { color: inherit; text-decoration: none; }
.mk5-body h1, .mk5-body h2, .mk5-body h3, .mk5-body h4 {
  font-family: 'Archivo', 'Helvetica Neue', Helvetica, Arial, sans-serif;
  font-weight: 500;
  letter-spacing: -0.018em;
  color: var(--ink);
}
.mk5-body em, .mk5-body i { font-style: italic; font-weight: 500; color: var(--accent); }
.mk5-body strong { font-weight: 600; color: var(--ink); }
.mk5-mono { font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace; font-feature-settings: "tnum", "zero"; }

/* Section frame helper */
.mk5-frame { border-top: 1px solid var(--rule); }

/* Hairline horizontal rule */
.mk5-hr { height: 1px; background: var(--rule); border: 0; }

/* NAV */
.mk5-nav {
  position: sticky; top: 0; width: 100%; z-index: 60;
  display: flex; justify-content: space-between; align-items: center;
  padding: 1.25rem 3rem;
  background: rgba(251, 250, 247, 0.92);
  backdrop-filter: saturate(140%) blur(8px);
  -webkit-backdrop-filter: saturate(140%) blur(8px);
  border-bottom: 1px solid var(--rule);
}
.mk5-nav-logo {
  display: flex; align-items: center; gap: .55rem;
  font-family: 'Archivo', sans-serif; font-weight: 600;
  font-size: 1.0625rem; letter-spacing: -0.005em; color: var(--ink);
}
.mk5-nav-links { display: flex; gap: 2.25rem; align-items: center; }
.mk5-nav-links a {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; font-weight: 400;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-2);
  transition: color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-nav-links a:hover { color: var(--ink); }
.mk5-nav-cta {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem !important; font-weight: 500 !important;
  letter-spacing: 0.16em !important; text-transform: uppercase;
  padding: .55rem 1.1rem !important;
  border: 1px solid var(--ink);
  color: var(--ink) !important;
  background: transparent;
  border-radius: 2px;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1), color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-nav-cta:hover { background: var(--ink); color: var(--field) !important; }
.mk5-nav-cta span { position: relative; z-index: 1; }

/* MOBILE HAMBURGER */
.mk5-hamburger {
  display: none; background: none; border: 0; cursor: pointer; padding: .5rem;
  width: 36px; height: 36px;
}
.mk5-hamburger span {
  display: block; width: 18px; height: 1px; background: var(--ink); margin: 4px auto;
  transition: transform 200ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-hamburger.open span:nth-child(1) { transform: translateY(5px) rotate(45deg); }
.mk5-hamburger.open span:nth-child(2) { opacity: 0; }
.mk5-hamburger.open span:nth-child(3) { transform: translateY(-5px) rotate(-45deg); }

/* MOBILE MENU OVERLAY */
.mk5-mobile-menu {
  position: fixed; top: 64px; left: 0; right: 0; bottom: 0;
  background: var(--field);
  border-top: 1px solid var(--rule);
  display: none; flex-direction: column; gap: 1rem;
  padding: 2rem; z-index: 55;
}
.mk5-mobile-menu.open { display: flex; }
.mk5-mobile-menu a {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink); padding: .75rem 0; border-bottom: 1px solid var(--rule);
}

/* HERO */
.mk5-hero {
  position: relative;
  min-height: calc(100vh - 64px);
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem;
  padding: 6rem 3rem 5rem;
  align-items: end;
  border-bottom: 1px solid var(--rule);
}
.mk5-hero-eyebrow {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
  margin-bottom: 2.5rem;
  display: flex; align-items: center; gap: .75rem;
}
.mk5-hero-eyebrow::before {
  content: ""; display: inline-block; width: 24px; height: 1px; background: var(--ink-2);
}
.mk5-hero-left h1 {
  font-size: clamp(2.75rem, 6.5vw, 6.25rem);
  line-height: 0.96; letter-spacing: -0.03em;
  font-weight: 500;
}
.mk5-hero-left h1 .thin { font-weight: 300; color: var(--ink-3); }
.mk5-hero-left h1 i { font-style: italic; color: var(--accent); font-weight: 500; }
.mk5-hero-desc {
  font-size: 1.0625rem; line-height: 1.55;
  color: var(--ink-2);
  max-width: 32rem;
  margin-bottom: 2.5rem;
}
.mk5-hero-actions { display: flex; gap: 1rem; flex-wrap: wrap; }
.mk5-hero-scroll {
  position: absolute; left: 3rem; bottom: 2rem;
  display: flex; align-items: center; gap: .75rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .6875rem;
  letter-spacing: 0.18em; text-transform: uppercase; color: var(--ink-3);
}
.mk5-scroll-line { width: 36px; height: 1px; background: var(--ink-3); }

/* BUTTONS */
.mk5-btn-main {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  padding: .85rem 1.6rem;
  background: var(--accent);
  color: #fff !important;
  border: 1px solid var(--accent);
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
  display: inline-block;
}
.mk5-btn-main:hover { background: var(--accent-hover); border-color: var(--accent-hover); }
.mk5-btn-main:disabled { opacity: 0.5; cursor: not-allowed; }
.mk5-btn-line {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; font-weight: 500;
  letter-spacing: 0.14em; text-transform: uppercase;
  padding: .85rem 1.6rem;
  background: transparent;
  color: var(--ink);
  border: 1px solid var(--ink);
  border-radius: 2px;
  cursor: pointer;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1), color 120ms cubic-bezier(0.23, 1, 0.32, 1);
  display: inline-block;
}
.mk5-btn-line:hover { background: var(--ink); color: var(--field); }

/* TICKER (kept as a single hairline marquee strip) */
.mk5-ticker {
  border-top: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--field);
  overflow: hidden; padding: 1.1rem 0;
}
.mk5-ticker-track {
  display: flex; gap: 3rem; white-space: nowrap;
  animation: mk5-marquee 60s linear infinite;
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-ticker-item { display: inline-flex; align-items: center; gap: 3rem; }
.mk5-ticker-dot {
  display: inline-block; width: 4px; height: 4px;
  background: var(--accent); border-radius: 999px;
}
@keyframes mk5-marquee {
  from { transform: translateX(0); }
  to { transform: translateX(-50%); }
}

/* SHARED-SAVINGS STRIP (new — persistent CFO ledger) */
.mk5-ss {
  display: grid; grid-template-columns: auto 1fr auto auto auto;
  gap: 2.5rem; align-items: end;
  padding: 2.5rem 3rem;
  border-bottom: 1px solid var(--rule);
  background: var(--field);
}
.mk5-ss-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-ss-meta {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; color: var(--ink-3);
  letter-spacing: 0.04em;
}
.mk5-ss-figure {
  display: flex; flex-direction: column; gap: .25rem;
  min-width: 9rem; padding-left: 2rem; border-left: 1px solid var(--rule);
}
.mk5-ss-amount {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-size: 1.625rem; font-weight: 500; letter-spacing: -0.01em;
  color: var(--ink);
}
.mk5-ss-amount.accent { color: var(--accent); }
.mk5-ss-tag {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  color: var(--ink-2);
}

/* MANIFESTO */
.mk5-manifesto {
  padding: 9rem 3rem;
  max-width: 80rem; margin: 0 auto;
  border-bottom: 1px solid var(--rule);
}
.mk5-manifesto-text {
  font-size: clamp(1.5rem, 3vw, 2.5rem);
  line-height: 1.32; letter-spacing: -0.012em;
  color: var(--ink);
  font-weight: 400;
  max-width: 56rem;
}
.mk5-manifesto-text em { color: var(--accent); font-style: italic; }
.mk5-manifesto-text strong { color: var(--ink); font-weight: 600; }

/* EVOLUTION STRIP */
.mk5-evo {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--rule);
}
.mk5-evo-item {
  padding: 3rem 2.5rem;
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: 1rem;
  position: relative;
  background: var(--field);
}
.mk5-evo-item:last-child { border-right: 0; }
.mk5-evo-item.future { background: var(--accent-tint); }
.mk5-evo-era {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-3);
}
.mk5-evo-era.future { color: var(--accent); }
.mk5-evo-name {
  font-size: 2rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink);
}
.mk5-evo-desc {
  font-size: .9375rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-evo-arrow { display: none; }

/* LAYERS SECTION */
.mk5-layers, .mk5-ethos {
  padding: 7rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-layers-intro {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 5rem;
}
.mk5-layers-intro-left {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
  position: sticky; top: 5rem; align-self: start;
}
.mk5-layers-intro-right h2 {
  font-size: clamp(2rem, 4vw, 3.5rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.5rem;
}
.mk5-layers-intro-right p {
  font-size: 1.0625rem; line-height: 1.55; color: var(--ink-2);
  max-width: 42rem;
}
.mk5-layer-block {
  display: grid; grid-template-columns: 80px 1fr 280px;
  gap: 3rem; align-items: start;
  padding: 3.5rem 0;
  border-top: 1px solid var(--rule);
}
.mk5-layer-block:last-child { border-bottom: 1px solid var(--rule); }
.mk5-layer-num {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-size: 2.5rem; font-weight: 400; color: var(--ink-3);
  letter-spacing: -0.01em;
}
.mk5-layer-name {
  font-size: 1.75rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink); margin-bottom: .25rem;
}
.mk5-layer-role {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 1.25rem;
}
.mk5-layer-role.bronze { color: var(--bronze); }
.mk5-layer-role.sky, .mk5-layer-role.sage { color: var(--accent); }
.mk5-layer-desc {
  font-size: .9375rem; line-height: 1.6; color: var(--ink-2);
  margin-bottom: 1.5rem; max-width: 36rem;
}
.mk5-layer-tags { display: flex; flex-wrap: wrap; gap: .5rem; }
.mk5-layer-tag {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.1em;
  padding: .35rem .75rem;
  border: 1px solid var(--rule);
  color: var(--ink-2);
  background: var(--paper);
  border-radius: 2px;
}
.mk5-layer-visual {
  width: 100%; aspect-ratio: 4/3;
  border: 1px solid var(--rule);
  background: var(--paper);
  display: flex; align-items: center; justify-content: center;
}

/* BIG STATEMENT */
.mk5-big-stmt {
  padding: 9rem 3rem; text-align: left;
  border-bottom: 1px solid var(--rule);
  max-width: 80rem; margin: 0 auto;
}
.mk5-big-stmt h2 {
  font-size: clamp(3rem, 8vw, 7rem);
  line-height: 0.95; letter-spacing: -0.035em;
  font-weight: 400;
}
.mk5-big-stmt h2 .stroke {
  color: var(--ink-3); font-weight: 300;
}
.mk5-big-stmt h2 .glow {
  color: var(--accent); font-style: italic; font-weight: 500;
}

/* STATS */
.mk5-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 0;
  border-bottom: 1px solid var(--rule);
}
.mk5-stat-item {
  padding: 3rem 2.5rem;
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: .75rem;
  background: var(--field);
}
.mk5-stat-item:last-child { border-right: 0; }
.mk5-stat-num {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-size: 3rem; font-weight: 500; letter-spacing: -0.02em;
  color: var(--ink);
}
.mk5-stat-num .accent { color: var(--accent); }
.mk5-stat-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-2);
}

/* PERSONAS (new — auditor + board roles surfaced) */
.mk5-personas {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-personas-header {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-personas-header .left {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-personas-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.25rem;
}
.mk5-personas-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2); max-width: 42rem;
}
.mk5-personas-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
}
.mk5-persona {
  padding: 2.25rem 1.75rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--field);
  display: flex; flex-direction: column; gap: .75rem;
}
.mk5-persona:last-child { border-right: 0; }
.mk5-persona-role {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-persona-name {
  font-size: 1.25rem; font-weight: 500; letter-spacing: -0.012em;
  color: var(--ink);
}
.mk5-persona-desc {
  font-size: .8125rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-persona-want {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.04em;
  color: var(--accent);
  padding-top: .75rem;
  border-top: 1px solid var(--rule);
}

/* COMPARISON */
.mk5-comp {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-comp-header {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-comp-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-comp-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-cg {
  display: grid; grid-template-columns: 1.7fr 1fr 1fr 1fr 1fr;
  border: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-ch {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  padding: 1rem; color: var(--ink-2);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--field-2);
}
.mk5-ch:last-child { border-right: 0; }
.mk5-ch.rl { text-align: left; }
.mk5-ch.ath { color: var(--accent); }
.mk5-cc {
  font-size: .8125rem;
  padding: .9rem 1rem;
  color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--paper);
  display: flex; align-items: center;
}
.mk5-cc:last-child { border-right: 0; }
.mk5-cc.rl { font-weight: 500; color: var(--ink); }
.mk5-cc.cy { color: var(--ink-2); font-family: 'IBM Plex Mono', monospace; font-size: .875rem; }
.mk5-cc.cp { color: var(--bronze); font-family: 'IBM Plex Mono', monospace; font-size: .75rem; }
.mk5-cc.cn { color: var(--ink-3); font-family: 'IBM Plex Mono', monospace; font-size: .875rem; }
.mk5-cc.ca { color: var(--accent); font-family: 'IBM Plex Mono', monospace; font-size: .875rem; font-weight: 500; background: var(--accent-tint); }

/* PROOF LEDGER (new — evidenced shared-savings rows) */
.mk5-proof {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-proof-header {
  display: grid; grid-template-columns: 1fr 2fr;
  gap: 4rem; margin-bottom: 2.5rem;
}
.mk5-proof-header .left {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-proof-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1.25rem;
}
.mk5-proof-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2); max-width: 42rem;
}
.mk5-pl {
  display: grid;
  grid-template-columns: 1.4fr 1fr 1.2fr .9fr .7fr;
  border: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-plh {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.18em; text-transform: uppercase;
  padding: 1rem; color: var(--ink-2);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  background: var(--field-2);
}
.mk5-plh:last-child { border-right: 0; }
.mk5-plc {
  font-size: .8125rem; line-height: 1.5;
  padding: 1rem; color: var(--ink);
  border-bottom: 1px solid var(--rule);
  border-right: 1px solid var(--rule);
  display: flex; flex-direction: column; gap: .25rem;
}
.mk5-plc:last-child { border-right: 0; }
.mk5-plc .title { font-weight: 500; color: var(--ink); }
.mk5-plc .sub {
  font-family: 'IBM Plex Mono', monospace; font-size: .6875rem;
  letter-spacing: 0.04em; color: var(--ink-3);
}
.mk5-plc .amount {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-weight: 500; color: var(--accent); font-size: .9375rem;
}
.mk5-plc.muted { color: var(--ink-2); }

/* INTEGRATIONS */
.mk5-int {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-int-header {
  margin-bottom: 3rem;
}
.mk5-int-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-int-grid {
  display: grid; grid-template-columns: repeat(5, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-int-item {
  padding: 1.75rem 1.25rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  display: flex; flex-direction: column; gap: .5rem;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-int-item:hover { background: var(--paper-hover); }
.mk5-int-icon {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 1.25rem; color: var(--accent);
  line-height: 1;
}
.mk5-int-name {
  font-size: .9375rem; font-weight: 500; color: var(--ink);
  letter-spacing: -0.005em;
}
.mk5-int-type {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .625rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-3);
}

/* COVERAGE (INDUSTRIES) */
.mk5-ind {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-ind-header {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem; margin-bottom: 3rem;
}
.mk5-ind-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em;
}
.mk5-ind-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-ind-featured {
  display: grid; grid-template-columns: 1.6fr 1fr;
  gap: 0;
  border: 1px solid var(--rule);
  background: var(--paper);
  margin-bottom: 3rem;
}
.mk5-ind-featured-main {
  padding: 2.5rem;
  border-right: 1px solid var(--rule);
}
.mk5-ind-featured-badge {
  display: inline-block;
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.16em; text-transform: uppercase;
  padding: .35rem .75rem;
  border: 1px solid var(--accent);
  color: var(--accent);
  background: var(--accent-tint);
  border-radius: 2px;
  margin-bottom: 1.25rem;
}
.mk5-ind-featured-title {
  font-size: clamp(1.75rem, 3vw, 2.5rem);
  line-height: 1.08; letter-spacing: -0.02em;
  font-weight: 500; margin-bottom: 1rem;
}
.mk5-ind-featured-desc {
  font-size: .9375rem; line-height: 1.6;
  color: var(--ink-2); margin-bottom: 1.5rem;
  max-width: 38rem;
}
.mk5-ind-featured-caps {
  display: flex; flex-wrap: wrap; gap: .5rem;
}
.mk5-ind-featured-cap {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.08em;
  padding: .35rem .75rem;
  border: 1px solid var(--rule);
  color: var(--ink-2);
  background: var(--field);
  border-radius: 2px;
}
.mk5-ind-featured-stats {
  padding: 2.5rem;
  display: flex; flex-direction: column; gap: 1.75rem;
  background: var(--field-2);
}
.mk5-ind-stat-row {
  padding-bottom: 1.5rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-ind-stat-row:last-child { border-bottom: 0; padding-bottom: 0; }
.mk5-ind-stat-num {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-size: 2.5rem; font-weight: 500; letter-spacing: -0.02em;
  color: var(--accent); margin-bottom: .25rem;
}
.mk5-ind-stat-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-2); line-height: 1.5;
}

.mk5-ind-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-ind-card {
  padding: 2rem 1.75rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  display: flex; flex-direction: column; gap: .85rem;
  transition: background-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-ind-card:hover { background: var(--paper-hover); }
.mk5-ind-card-icon {
  font-family: 'IBM Plex Mono', monospace;
  font-size: 1.25rem; color: var(--accent); line-height: 1;
}
.mk5-ind-card-name {
  font-size: 1.125rem; font-weight: 500; letter-spacing: -0.01em;
  color: var(--ink);
}
.mk5-ind-card-desc {
  font-size: .875rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-ind-card-cats {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.04em;
  color: var(--ink-3);
  padding-top: .75rem;
  border-top: 1px solid var(--rule);
}

/* FEATURES DEEP-DIVE */
.mk5-feat {
  padding: 6rem 3rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-feat-header { margin-bottom: 3rem; max-width: 56rem; }
.mk5-feat-header h2 {
  font-size: clamp(2rem, 4vw, 3rem);
  line-height: 1.05; letter-spacing: -0.022em; margin-bottom: 1rem;
}
.mk5-feat-header p {
  font-size: 1rem; line-height: 1.55; color: var(--ink-2);
}
.mk5-feat-grid {
  display: grid; grid-template-columns: repeat(2, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-feat-item {
  padding: 2.25rem 2rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
}
.mk5-feat-item-label {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.2em; text-transform: uppercase;
  color: var(--accent); margin-bottom: .75rem;
}
.mk5-feat-item-title {
  font-size: 1.25rem; font-weight: 500; letter-spacing: -0.012em;
  color: var(--ink); margin-bottom: .85rem; line-height: 1.25;
}
.mk5-feat-item-desc {
  font-size: .875rem; line-height: 1.6; color: var(--ink-2);
  margin-bottom: 1.25rem;
}
.mk5-feat-item-bullets {
  list-style: none; padding: 0; margin: 0;
  border-top: 1px solid var(--rule);
}
.mk5-feat-item-bullets li {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.02em;
  color: var(--ink-2);
  padding: .55rem 0;
  border-bottom: 1px solid var(--rule);
  padding-left: 1rem; position: relative;
}
.mk5-feat-item-bullets li::before {
  content: ""; position: absolute; left: 0; top: 50%;
  width: 6px; height: 1px; background: var(--accent);
}
.mk5-feat-item-bullets li:last-child { border-bottom: 0; }

/* ETHOS */
.mk5-ethos-grid {
  display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 0;
  border-top: 1px solid var(--rule);
  border-left: 1px solid var(--rule);
}
.mk5-ethos-card {
  padding: 2.5rem 2rem;
  border-right: 1px solid var(--rule);
  border-bottom: 1px solid var(--rule);
  background: var(--paper);
  position: relative;
}
.mk5-ethos-num {
  font-family: 'IBM Plex Mono', monospace; font-feature-settings: "tnum";
  font-size: 1rem; letter-spacing: 0.06em;
  color: var(--ink-3); margin-bottom: 1.5rem;
}
.mk5-ethos-title {
  font-size: 1.5rem; font-weight: 500; letter-spacing: -0.015em;
  color: var(--ink); margin-bottom: .85rem;
}
.mk5-ethos-desc {
  font-size: .9375rem; line-height: 1.6; color: var(--ink-2);
}
.mk5-ethos-accent {
  position: absolute; top: 0; left: 0;
  width: 32px; height: 1px;
  background: var(--accent);
}

/* CTA */
.mk5-cta {
  padding: 7rem 3rem 9rem;
  border-bottom: 1px solid var(--rule);
}
.mk5-cta-content {
  max-width: 56rem; margin: 0 auto; text-align: center;
}
.mk5-cta-ey {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--ink-2); margin-bottom: 2rem;
  display: inline-flex; align-items: center; gap: .75rem;
}
.mk5-cta-ey::before, .mk5-cta-ey::after {
  content: ""; display: inline-block; width: 24px; height: 1px; background: var(--ink-2);
}
.mk5-cta h2 {
  font-size: clamp(2.5rem, 6vw, 5rem);
  line-height: 0.98; letter-spacing: -0.03em;
  font-weight: 500; margin-bottom: 1.5rem;
}
.mk5-cta h2 i { color: var(--accent); font-style: italic; }
.mk5-cta-sub {
  font-size: 1.0625rem; line-height: 1.55;
  color: var(--ink-2);
  max-width: 38rem; margin: 0 auto 2.5rem;
}
.mk5-cta-actions {
  display: flex; gap: 1rem; justify-content: center;
  margin-bottom: 4rem; flex-wrap: wrap;
}

/* CONTACT FORM */
.mk5-contact {
  max-width: 36rem; margin: 0 auto; text-align: left;
  display: flex; flex-direction: column; gap: 1rem;
  border-top: 1px solid var(--rule);
  padding-top: 2.5rem;
}
.mk5-contact-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1rem;
}
.mk5-contact-field { display: flex; flex-direction: column; gap: .35rem; }
.mk5-contact-field span {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--ink-2);
}
.mk5-contact-field input,
.mk5-contact-field textarea {
  font-family: 'Archivo', sans-serif;
  font-size: .9375rem; color: var(--ink);
  background: var(--paper);
  border: 1px solid var(--rule);
  border-radius: 2px;
  padding: .75rem .85rem;
  resize: vertical;
  transition: border-color 120ms cubic-bezier(0.23, 1, 0.32, 1);
}
.mk5-contact-field input:focus,
.mk5-contact-field textarea:focus {
  outline: none; border-color: var(--accent);
}
.mk5-contact-error {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; color: var(--neg);
  padding: .75rem; border: 1px solid var(--neg);
  background: rgba(176, 52, 35, 0.04);
  border-radius: 2px;
}
.mk5-contact-success {
  max-width: 36rem; margin: 0 auto;
  padding: 2rem;
  border: 1px solid var(--accent);
  background: var(--accent-tint);
  text-align: left;
  border-radius: 2px;
}
.mk5-contact-success-title {
  font-size: 1.25rem; font-weight: 500; color: var(--accent);
  margin-bottom: .5rem;
}
.mk5-contact-success p {
  font-size: .9375rem; line-height: 1.55; color: var(--ink-2);
}

/* FOOTER */
.mk5-footer {
  padding: 3rem; max-width: 80rem; margin: 0 auto;
  display: grid; grid-template-columns: 1fr 2fr 1fr;
  gap: 2rem; align-items: end;
}
.mk5-fl {
  font-family: 'Archivo', sans-serif;
  font-weight: 600; font-size: 1rem; color: var(--ink);
  letter-spacing: -0.005em;
}
.mk5-fc {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .75rem; letter-spacing: 0.06em;
  color: var(--ink-2); line-height: 1.6;
}
.mk5-fc a { color: var(--ink-2); }
.mk5-fc a:hover { color: var(--ink); }
.mk5-fr {
  font-family: 'IBM Plex Mono', monospace;
  font-size: .6875rem; letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--ink-3); text-align: right;
}

/* ANIMATIONS — restrained */
.mk5-reveal { opacity: 0; transform: translateY(8px); transition: opacity 400ms cubic-bezier(0.23, 1, 0.32, 1), transform 400ms cubic-bezier(0.23, 1, 0.32, 1); }
.mk5-reveal.visible { opacity: 1; transform: translateY(0); }
.mk5-rd1 { transition-delay: 80ms; }
.mk5-rd2 { transition-delay: 160ms; }
.mk5-rd3 { transition-delay: 240ms; }

/* RESPONSIVE */
@media(max-width: 1100px) {
  .mk5-hero { grid-template-columns: 1fr; gap: 2rem; padding: 4rem 2rem 3rem; align-items: start; min-height: 0; }
  .mk5-ss { grid-template-columns: 1fr; gap: 1rem; padding: 2rem; }
  .mk5-ss-figure { padding-left: 0; border-left: 0; border-top: 1px solid var(--rule); padding-top: 1rem; }
  .mk5-evo { grid-template-columns: 1fr; }
  .mk5-evo-item { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-layers-intro { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-layer-block { grid-template-columns: 1fr; gap: 1.25rem; padding: 2.5rem 0; }
  .mk5-layer-num { font-size: 1.75rem; }
  .mk5-stats { grid-template-columns: 1fr 1fr; }
  .mk5-stat-item:nth-child(2n) { border-right: 0; }
  .mk5-personas-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-personas-grid { grid-template-columns: 1fr 1fr; }
  .mk5-persona:nth-child(2n) { border-right: 0; }
  .mk5-comp-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-cg { grid-template-columns: 1.4fr 1fr 1fr 1fr 1fr; min-width: 720px; }
  .mk5-comp { overflow-x: auto; }
  .mk5-proof-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-pl { min-width: 720px; }
  .mk5-proof { overflow-x: auto; }
  .mk5-int-grid { grid-template-columns: repeat(3, 1fr); }
  .mk5-ind-header { grid-template-columns: 1fr; gap: 1.5rem; }
  .mk5-ind-featured { grid-template-columns: 1fr; }
  .mk5-ind-featured-main { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-ind-grid { grid-template-columns: repeat(2, 1fr); }
  .mk5-ind-card:nth-child(2n) { border-right: 0; }
  .mk5-feat-grid { grid-template-columns: 1fr; }
  .mk5-feat-item { border-right: 0; }
  .mk5-ethos-grid { grid-template-columns: 1fr; }
  .mk5-ethos-card { border-right: 0; }
}
@media(max-width: 768px) {
  .mk5-nav { padding: 1rem 1.25rem; }
  .mk5-nav-links { display: none; }
  .mk5-hamburger { display: flex; flex-direction: column; justify-content: center; }
  .mk5-ss, .mk5-manifesto, .mk5-layers, .mk5-comp, .mk5-int, .mk5-ind, .mk5-feat, .mk5-ethos, .mk5-personas, .mk5-proof { padding-left: 1.25rem; padding-right: 1.25rem; }
  .mk5-personas-grid { grid-template-columns: 1fr; }
  .mk5-persona { border-right: 0; }
  .mk5-int-grid { grid-template-columns: repeat(2, 1fr); }
  .mk5-int-item:nth-child(2n) { border-right: 0; }
  .mk5-ind-grid { grid-template-columns: 1fr; }
  .mk5-ind-card { border-right: 0; }
  .mk5-stats { grid-template-columns: 1fr; }
  .mk5-stat-item { border-right: 0; border-bottom: 1px solid var(--rule); }
  .mk5-contact-row { grid-template-columns: 1fr; }
  .mk5-footer { grid-template-columns: 1fr; gap: 1.5rem; text-align: left; padding: 2rem 1.25rem; }
  .mk5-fr { text-align: left; }
  .mk5-big-stmt { padding: 6rem 1.25rem; }
}
`;

/* ---- SVG Components ---- */

const AtheonLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden>
    <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="var(--accent, #0a7d4f)" strokeWidth="1.5" />
    <line x1="9" y1="20" x2="23" y2="20" stroke="var(--accent, #0a7d4f)" strokeWidth=".8" opacity=".6" />
    <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="var(--accent, #0a7d4f)" strokeWidth=".8" opacity=".45" />
    <circle cx="16" cy="9" r="1.5" fill="var(--accent, #0a7d4f)" />
  </svg>
);

/* ---- Static layer pictogram (replaces dark canvas) ---- */

function LayerPictogram({ tier }: { tier: 1 | 2 | 3 }) {
  const rows = tier === 1 ? 1 : tier === 2 ? 2 : 3;
  return (
    <svg viewBox="0 0 240 180" width="100%" height="100%" aria-hidden>
      {Array.from({ length: rows }).map((_, r) => {
        const y = 60 + r * 32;
        const dots = 7 + r * 4;
        const spread = 40 + r * 24;
        return (
          <g key={r}>
            {Array.from({ length: dots }).map((_, i) => {
              const cx = 120 + ((i - (dots - 1) / 2) * spread) / (dots - 1);
              return <circle key={i} cx={cx} cy={y} r="1.6" fill="var(--accent, #0a7d4f)" opacity={0.55 - r * 0.12} />;
            })}
            <line x1="40" y1={y} x2="200" y2={y} stroke="var(--border-card, #e4e2db)" strokeWidth="1" />
          </g>
        );
      })}
      <text x="200" y="170" fontFamily="IBM Plex Mono, monospace" fontSize="9" letterSpacing="0.18em" fill="var(--text-muted, #9a9ea6)" textAnchor="end">
        L{tier.toString().padStart(2, "0")}
      </text>
    </svg>
  );
}

/* ---- Scroll Reveal Hook ---- */

function useReveal(ref: React.RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      (entries) => entries.forEach((en) => { if (en.isIntersecting) en.target.classList.add("visible"); }),
      { threshold: 0.1, rootMargin: "0px 0px -80px 0px" }
    );
    el.querySelectorAll(".mk5-reveal, .mk5-layer-block").forEach((child) => obs.observe(child));
    return () => obs.disconnect();
  }, [ref]);
}

/* ---- Contact Form (wired to POST /api/contact) ---- */

function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !email.trim() || !message.trim()) {
      setStatus("error");
      setErrorMsg("Name, email and message are required.");
      return;
    }
    setStatus("sending");
    setErrorMsg("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email, company, message }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error((data as { error?: string }).error || "Could not send message.");
      }
      setStatus("success");
      setName(""); setEmail(""); setCompany(""); setMessage("");
    } catch (err) {
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Could not send message.");
    }
  }

  if (status === "success") {
    return (
      <div className="mk5-contact-success mk5-reveal">
        <div className="mk5-contact-success-title">Message received.</div>
        <p>Thank you. A member of the Atheon team will be in touch shortly.</p>
      </div>
    );
  }

  return (
    <form className="mk5-contact mk5-reveal" onSubmit={onSubmit} noValidate>
      <div className="mk5-contact-row">
        <label className="mk5-contact-field">
          <span>Name</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)}
            autoComplete="name" required maxLength={120} />
        </label>
        <label className="mk5-contact-field">
          <span>Work email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            autoComplete="email" required maxLength={200} />
        </label>
      </div>
      <label className="mk5-contact-field">
        <span>Company</span>
        <input type="text" value={company} onChange={(e) => setCompany(e.target.value)}
          autoComplete="organization" maxLength={160} />
      </label>
      <label className="mk5-contact-field">
        <span>How can we help?</span>
        <textarea value={message} onChange={(e) => setMessage(e.target.value)}
          required maxLength={2000} rows={4} />
      </label>
      {status === "error" && errorMsg && (
        <div className="mk5-contact-error" role="alert">{errorMsg}</div>
      )}
      <button type="submit" className="mk5-btn-main" disabled={status === "sending"}>
        {status === "sending" ? "Sending..." : "Send message"}
      </button>
    </form>
  );
}

/* ============================================================
   MARKETING PAGE COMPONENT
   ============================================================ */

export function MarketingPage() {
  const mainRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useReveal(mainRef);

  useEffect(() => {
    if (!document.getElementById("mk5-css")) {
      const s = document.createElement("style");
      s.id = "mk5-css";
      s.textContent = marketingCSS;
      document.head.appendChild(s);
    }
  }, []);

  const tickerItems = ["Catalyst", "Not an Agent", "Three Layers", "Governed", "Correlated", "One Truth"];

  const integrations = [
    { icon: "◆", name: "SAP S/4HANA", type: "ERP" },
    { icon: "◆", name: "SAP Business One", type: "ERP" },
    { icon: "◇", name: "Dynamics 365", type: "ERP + CRM" },
    { icon: "◆", name: "Sage 300", type: "ERP" },
    { icon: "◆", name: "SYSPRO", type: "ERP" },
    { icon: "◇", name: "Odoo 18", type: "ERP" },
    { icon: "◆", name: "Oracle Fusion", type: "ERP" },
    { icon: "◆", name: "NetSuite", type: "ERP" },
    { icon: "◆", name: "QuickBooks", type: "Accounting" },
    { icon: "○", name: "SuccessFactors", type: "HCM" },
    { icon: "○", name: "Salesforce", type: "CRM" },
    { icon: "○", name: "Xero", type: "Accounting" },
    { icon: "○", name: "Workday", type: "HCM" },
    { icon: "❐", name: "REST APIs", type: "Custom" },
    { icon: "❐", name: "Webhooks", type: "Custom" },
  ];

  const coverageDomains = [
    { icon: "◆", name: "Finance & Controlling", desc: "AP, AR, reconciliation, cash flow, budget vs actual, cost allocation, and inventory valuation.", catalysts: "Finance · Finance Ops · Treasury · Tax · Audit · GL Close" },
    { icon: "◇", name: "Supply Chain & Operations", desc: "Procurement, supplier risk, inventory optimisation, 3-way matching, and production scheduling.", catalysts: "Procurement · Supplier · Inventory · Production · Logistics" },
    { icon: "◆", name: "Commercial & Revenue", desc: "Pipeline hygiene, quote-to-cash, pricing intelligence, trade promotion, and revenue ops.", catalysts: "Sales · Pricing · Trade Promotion · CDP · Customer Success" },
    { icon: "◆", name: "People & Workforce", desc: "Recruitment funnel, engagement signals, payroll variance, and workforce planning.", catalysts: "HR · Recruitment · Engagement · Payroll · Workforce Planning" },
    { icon: "◇", name: "Governance, Risk & Compliance", desc: "Audit trails, tax compliance, regulatory reporting, policy monitoring, and DSAR handling.", catalysts: "Audit · Tax · Compliance · ESG · Risk" },
    { icon: "◆", name: "Data Quality & MDM", desc: "Master data hygiene, duplicate detection, entity resolution, and reference data governance.", catalysts: "DQ/MDM · Reference Data · Entity Resolution" },
    { icon: "◇", name: "Lean / Continuous Improvement", desc: "Process mining, bottleneck detection, cycle-time reduction, and waste elimination.", catalysts: "Lean/CI · Process Mining · Cycle Time" },
    { icon: "◆", name: "Sustainability & ESG", desc: "Scope 1/2/3 tracking, energy and water intensity, and sustainability disclosures.", catalysts: "ESG · Energy · Emissions · Disclosures" },
    { icon: "○", name: "IT, Platform & Security", desc: "Connectivity health, integration monitoring, and security posture across the estate.", catalysts: "Integration Health · Security Posture · Platform Health" },
  ];

  const personas = [
    { role: "Executive", name: "Chief Financial Officer", desc: "Owns the shared-savings ledger. Needs a single living truth across legal entities, with every claim traceable to a source record.", want: "Realised savings, weekly" },
    { role: "Finance", name: "Group Controller", desc: "Closes the books across subsidiaries. Wants reconciliation, cost variance, and inventory valuation visible before audit asks.", want: "Variance with citation" },
    { role: "Assurance", name: "Internal Auditor", desc: "Tests the controls behind every autonomous decision. Needs the audit trail, confidence band, and reviewer record for every catalyst run.", want: "Append-only audit log" },
    { role: "Governance", name: "Board Member", desc: "Reviews material risk and capital allocation. Needs a one-page synthesis with the underlying evidence one click away.", want: "Board-ready synthesis" },
    { role: "Operations", name: "VP Operations", desc: "Runs the catalysts that actually move cash. Wants schedules, autonomy tiers, and recommendations grounded in ERP signal.", want: "Run health, by domain" },
  ];

  const proofRows = [
    { area: "Standard cost variance", source: "SAP S/4HANA · CKMLCR / ACDOCA", field: "vprs_cogm × menge", amount: "$1,820,400", confidence: "High" },
    { area: "Duplicate remittances", source: "Oracle Fusion AP · ap_invoices_all", field: "invoice_num + supplier + amount", amount: "$412,180", confidence: "High" },
    { area: "Trade promotion leakage", source: "NetSuite + Salesforce", field: "promo_lift vs baseline_units", amount: "$268,540", confidence: "Medium" },
    { area: "Payroll overtime drift", source: "Workday · hours / rate / cost_center", field: "ot_hours × burdened_rate", amount: "$134,260", confidence: "Medium" },
  ];

  return (
    <div ref={mainRef} className="mk5-body">

      {/* NAV */}
      <nav className="mk5-nav">
        <a href="/" className="mk5-nav-logo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <AtheonLogo size={26} />
          Atheon
        </a>
        <div className="mk5-nav-links">
          <a href="#layers">Architecture</a>
          <a href="#personas">Roles</a>
          <a href="#coverage">Coverage</a>
          <a href="#features">Features</a>
          <a href="#security">Security</a>
          <a href="#compare">Compare</a>
          <a href="#proof">Proof</a>
          <a href="/login" className="mk5-nav-cta" style={{ marginRight: '0.5rem' }}>
            <span>Login</span>
          </a>
          <a href="#cta-s" className="mk5-nav-cta" onClick={(e) => { e.preventDefault(); document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" }); }}>
            <span>Early Access</span>
          </a>
        </div>
        <button className={`mk5-hamburger ${mobileMenuOpen ? 'open' : ''}`} onClick={() => setMobileMenuOpen(!mobileMenuOpen)} aria-label="Menu">
          <span /><span /><span />
        </button>
      </nav>

      {/* MOBILE MENU */}
      <div className={`mk5-mobile-menu ${mobileMenuOpen ? 'open' : ''}`}>
        <a href="#layers" onClick={() => setMobileMenuOpen(false)}>Architecture</a>
        <a href="#personas" onClick={() => setMobileMenuOpen(false)}>Roles</a>
        <a href="#coverage" onClick={() => setMobileMenuOpen(false)}>Coverage</a>
        <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
        <a href="#security" onClick={() => setMobileMenuOpen(false)}>Security</a>
        <a href="#compare" onClick={() => setMobileMenuOpen(false)}>Compare</a>
        <a href="#proof" onClick={() => setMobileMenuOpen(false)}>Proof</a>
        <a href="/login" className="mk5-nav-cta" onClick={() => setMobileMenuOpen(false)}>
          <span>Login</span>
        </a>
        <a href="#cta-s" className="mk5-nav-cta" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" }); }}>
          <span>Early Access</span>
        </a>
      </div>

      {/* HERO */}
      <section className="mk5-hero">
        <div className="mk5-hero-left">
          <div className="mk5-hero-eyebrow">01 &mdash; The Catalyst Platform</div>
          <h1>
            <span className="thin">Agents evolve.</span><br />
            <i>Catalysts</i> <span className="thin">emerge.</span>
          </h1>
        </div>
        <div className="mk5-hero-right">
          <p className="mk5-hero-desc">
            Agents automate tasks. Copilots assist individuals. A Catalyst does what neither
            can&nbsp;&mdash; it governs, correlates, and synthesises across your entire
            organisation. Atheon is the world&rsquo;s first Catalyst platform. Three layers of
            intelligence. One living truth, ledgered against your ERP.
          </p>
          <div className="mk5-hero-actions">
            <button className="mk5-btn-main" onClick={() => document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" })}>
              Request Access
            </button>
            <button className="mk5-btn-line" onClick={() => document.getElementById("layers")?.scrollIntoView({ behavior: "smooth" })}>
              See the architecture
            </button>
          </div>
        </div>
        <div className="mk5-hero-scroll">
          <div className="mk5-scroll-line" />
          <span>Scroll</span>
        </div>
      </section>

      {/* SHARED-SAVINGS STRIP — persistent CFO ledger */}
      <div className="mk5-ss" aria-label="Shared-savings ledger">
        <div>
          <div className="mk5-ss-label">Shared-Savings Ledger</div>
          <div className="mk5-ss-meta mk5-mono">Trailing 90 days &middot; Q2 2026</div>
        </div>
        <div className="mk5-ss-meta mk5-mono" style={{ alignSelf: "end" }}>
          Every claimed dollar traces to ERP record &middot; field &middot; confidence band.
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono">$12.4m</div>
          <div className="mk5-ss-tag">Identified</div>
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono">$8.6m</div>
          <div className="mk5-ss-tag">Approved</div>
        </div>
        <div className="mk5-ss-figure">
          <div className="mk5-ss-amount mk5-mono accent">$6.1m</div>
          <div className="mk5-ss-tag">Realised</div>
        </div>
      </div>

      {/* TICKER */}
      <div className="mk5-ticker">
        <div className="mk5-ticker-track">
          {[0, 1].map((rep) => (
            <span key={rep} style={{ display: "contents" }}>
              {tickerItems.map((t) => (
                <span key={rep + "-" + t} className="mk5-ticker-item">
                  {t}<span className="mk5-ticker-dot" />
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>

      {/* MANIFESTO */}
      <section className="mk5-manifesto">
        <p className="mk5-manifesto-text mk5-reveal">
          An agent automates a task. A copilot assists a person. A <em>Catalyst</em> governs
          an entire organisation&nbsp;&mdash; correlating every output, detecting every anomaly,
          synthesising every signal into a single, living <strong>truth</strong>. This is the
          next evolution.
        </p>
      </section>

      {/* EVOLUTION DEFINITION */}
      <div className="mk5-evo">
        <div className="mk5-evo-item past mk5-reveal">
          <div className="mk5-evo-era past">Yesterday</div>
          <div className="mk5-evo-name">Agent</div>
          <div className="mk5-evo-desc">
            Automates a single task. Operates in a silo. No awareness of what other agents
            are doing. No governance. No organisational context.
          </div>
        </div>
        <div className="mk5-evo-item present mk5-reveal mk5-rd1">
          <div className="mk5-evo-era present">Today</div>
          <div className="mk5-evo-name">Copilot</div>
          <div className="mk5-evo-desc">
            Assists one person at a time. Answers questions from a knowledge base. Cannot
            correlate across departments or govern autonomous processes.
          </div>
        </div>
        <div className="mk5-evo-item future mk5-reveal mk5-rd2">
          <div className="mk5-evo-era future">The Evolution</div>
          <div className="mk5-evo-name">Catalyst</div>
          <div className="mk5-evo-desc">
            Governs a fleet of agents. Correlates outputs across every department. Synthesises
            a living health score for the entire organisation. Thinks at executive, operational,
            and execution level simultaneously.
          </div>
        </div>
      </div>

      {/* THREE LAYERS */}
      <section className="mk5-layers" id="layers">
        <div className="mk5-layers-intro">
          <div className="mk5-layers-intro-left">The Architecture</div>
          <div className="mk5-layers-intro-right mk5-reveal">
            <h2>Inside the Catalyst.<br />Three layers deep.</h2>
            <p>
              A Catalyst isn&rsquo;t a single tool&nbsp;&mdash; it&rsquo;s three layers of intelligence
              working as one. Execution at the base. Operational correlation in the core.
              Executive synthesis at the apex. This is the architecture the agent market never built.
            </p>
          </div>
        </div>

        <div className="mk5-layer-block">
          <div className="mk5-layer-num">01</div>
          <div>
            <h3 className="mk5-layer-name">Executive Insight</h3>
            <div className="mk5-layer-role bronze">The Apex&nbsp;&mdash; C-Suite &amp; Board</div>
            <p className="mk5-layer-desc">
              What makes a Catalyst fundamentally different from an agent. Natural language queries
              across your entire business. One health score synthesising every department, every agent
              output, every anomaly into executive clarity. An agent automates. A Catalyst delivers
              organisational awareness.
            </p>
            <div className="mk5-layer-tags">
              {["Health Score Engine", "NLP Chat Interface", "Predictive Alerts", "Auto Reports", "Board Summaries"].map((t) => (
                <span key={t} className="mk5-layer-tag">{t}</span>
              ))}
            </div>
          </div>
          <div className="mk5-layer-visual">
            <LayerPictogram tier={1} />
          </div>
        </div>

        <div className="mk5-layer-block">
          <div className="mk5-layer-num">02</div>
          <div>
            <h3 className="mk5-layer-name">Operational Intelligence</h3>
            <div className="mk5-layer-role sky">The Core&nbsp;&mdash; Directors &amp; Managers</div>
            <p className="mk5-layer-desc">
              The layer that separates a Catalyst from everything that came before it. Real-time
              departmental intelligence that correlates agent outputs across your entire operation,
              detects anomalies before they escalate, and recommends actions with confidence scores.
              No agent has this. No copilot has this. Only a Catalyst.
            </p>
            <div className="mk5-layer-tags">
              {["Anomaly Detection", "Department Dashboards", "Process Mining", "Recommendation Engine", "Cross-Dept Correlation"].map((t) => (
                <span key={t} className="mk5-layer-tag">{t}</span>
              ))}
            </div>
          </div>
          <div className="mk5-layer-visual">
            <LayerPictogram tier={2} />
          </div>
        </div>

        <div className="mk5-layer-block">
          <div className="mk5-layer-num">03</div>
          <div>
            <h3 className="mk5-layer-name">Autonomous Catalysts</h3>
            <div className="mk5-layer-role sage">The Foundation&nbsp;&mdash; Operations &amp; Execution</div>
            <p className="mk5-layer-desc">
              75 catalyst clusters and 445 sub-catalysts spanning finance, HR, sales, supply chain,
              operations, tax, audit, treasury, ESG, data quality and more. Over 50 ship with real,
              ERP-connected handlers&nbsp;&mdash; the rest are generic templates you can configure. Every
              action is governed, every decision auditable, every escalation routed through the
              intelligence layers above.
            </p>
            <div className="mk5-layer-tags">
              {["445 Sub-Catalysts", "50+ Real Handlers", "Tag-Based Matching", "Governance Framework", "Full Audit Trail", "ERP-Native"].map((t) => (
                <span key={t} className="mk5-layer-tag">{t}</span>
              ))}
            </div>
          </div>
          <div className="mk5-layer-visual">
            <LayerPictogram tier={3} />
          </div>
        </div>
      </section>

      {/* BIG STATEMENT */}
      <section className="mk5-big-stmt mk5-reveal">
        <h2>
          <span className="stroke">Agent. Copilot.</span><br />
          <span className="glow">Catalyst.</span>
        </h2>
      </section>

      {/* STATS */}
      <div className="mk5-stats">
        <div className="mk5-stat-item mk5-reveal">
          <div className="mk5-stat-num mk5-mono">75<span className="accent">+</span></div>
          <div className="mk5-stat-label">Catalyst Clusters</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd1">
          <div className="mk5-stat-num mk5-mono">445<span className="accent">+</span></div>
          <div className="mk5-stat-label">Sub-Catalysts</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd2">
          <div className="mk5-stat-num mk5-mono">50<span className="accent">+</span></div>
          <div className="mk5-stat-label">Real Handlers Shipping</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd3">
          <div className="mk5-stat-num mk5-mono"><span className="accent">3</span></div>
          <div className="mk5-stat-label">Intelligence Layers</div>
        </div>
      </div>

      {/* PERSONAS — auditor + board surfaced */}
      <section className="mk5-personas" id="personas">
        <div className="mk5-personas-header">
          <div className="left">Designed for</div>
          <div className="mk5-reveal">
            <h2>Roles that own the result.</h2>
            <p>
              Atheon isn&rsquo;t a horizontal copilot. Every layer is shaped around the people
              who own the outcome &mdash; including the auditor and the board, who other platforms
              treat as afterthoughts.
            </p>
          </div>
        </div>
        <div className="mk5-personas-grid">
          {personas.map((p, i) => (
            <div key={p.name} className={`mk5-persona mk5-reveal mk5-rd${Math.min(i, 3)}`}>
              <div className="mk5-persona-role">{p.role}</div>
              <div className="mk5-persona-name">{p.name}</div>
              <div className="mk5-persona-desc">{p.desc}</div>
              <div className="mk5-persona-want">&rarr; {p.want}</div>
            </div>
          ))}
        </div>
      </section>

      {/* COMPARISON */}
      <section className="mk5-comp" id="compare">
        <div className="mk5-comp-header">
          <h2 className="mk5-reveal">Agents and copilots<br />were chapter one.</h2>
          <p className="mk5-reveal">
            Every competitor built agents or copilots. None evolved beyond. Atheon is the
            world&rsquo;s first Catalyst&nbsp;&mdash; the only platform with all three layers of enterprise intelligence,
            ledgered against your ERP.
          </p>
        </div>
        <div className="mk5-cg mk5-reveal">
          <div className="mk5-ch rl">Capability</div>
          <div className="mk5-ch">Copilot</div>
          <div className="mk5-ch">Agentforce</div>
          <div className="mk5-ch">Standalone</div>
          <div className="mk5-ch ath">Atheon</div>

          <div className="mk5-cc rl">Catalyst Execution</div>
          <div className="mk5-cc cy">&#10003;</div>
          <div className="mk5-cc cy">&#10003;</div>
          <div className="mk5-cc cy">&#10003;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Operational Intelligence</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Executive Insight Layer</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Cross-Dept Correlation</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Shared-Savings Billing</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Agent Governance</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">Full</div>

          <div className="mk5-cc rl">Multi-ERP Integration</div>
          <div className="mk5-cc cp">M365</div>
          <div className="mk5-cc cp">SFDC</div>
          <div className="mk5-cc cp">Custom</div>
          <div className="mk5-cc ca">SAP &middot; Oracle &middot; MS &middot; NetSuite &middot; Odoo &middot; Xero &middot; Workday +</div>

          <div className="mk5-cc rl">Organisation Health Score</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Purpose-Trained LLM</div>
          <div className="mk5-cc cp">Generic</div>
          <div className="mk5-cc cp">Generic</div>
          <div className="mk5-cc cp">Varies</div>
          <div className="mk5-cc ca">Tuned</div>

          <div className="mk5-cc rl">Multicompany (Group Entities)</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Enforced MFA + Signed Webhooks</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>

          <div className="mk5-cc rl">Per-Tenant LLM Budget + PII Redaction</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">&#10003;</div>
        </div>
      </section>

      {/* PROOF LEDGER — evidenced shared-savings rows */}
      <section className="mk5-proof" id="proof">
        <div className="mk5-proof-header">
          <div className="left">Proof Ledger</div>
          <div className="mk5-reveal">
            <h2>Every claim, traceable to a record.</h2>
            <p>
              Shared-savings means we get paid on what you keep. So every line on this ledger
              maps to a specific ERP source, the field calculation that produced it, and the
              confidence band the catalyst assigned. No black boxes.
            </p>
          </div>
        </div>
        <div className="mk5-pl mk5-reveal">
          <div className="mk5-plh">Area</div>
          <div className="mk5-plh">ERP Source</div>
          <div className="mk5-plh">Field Mapping</div>
          <div className="mk5-plh">Amount</div>
          <div className="mk5-plh">Confidence</div>
          {proofRows.map((r) => (
            <span key={r.area} style={{ display: "contents" }}>
              <div className="mk5-plc">
                <span className="title">{r.area}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.source}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.field}</span>
              </div>
              <div className="mk5-plc">
                <span className="amount">{r.amount}</span>
              </div>
              <div className="mk5-plc muted">
                <span className="sub">{r.confidence}</span>
              </div>
            </span>
          ))}
        </div>
      </section>

      {/* INTEGRATIONS */}
      <section className="mk5-int">
        <div className="mk5-int-header">
          <h2 className="mk5-reveal">Connects to everything<br />that matters.</h2>
        </div>
        <div className="mk5-int-grid mk5-reveal">
          {integrations.map((item) => (
            <div key={item.name} className="mk5-int-item">
              <div className="mk5-int-icon">{item.icon}</div>
              <div className="mk5-int-name">{item.name}</div>
              <div className="mk5-int-type">{item.type}</div>
            </div>
          ))}
        </div>
      </section>

      {/* COVERAGE (formerly INDUSTRIES) */}
      <section className="mk5-ind" id="coverage">
        <div className="mk5-ind-header">
          <h2 className="mk5-reveal">Tag-matched across<br />every domain.</h2>
          <p className="mk5-reveal">
            Atheon&rsquo;s 75 catalyst clusters and 445 sub-catalysts aren&rsquo;t siloed by vertical&nbsp;&mdash;
            they&rsquo;re matched to your tenant by function, maturity, and criticality tags. Turn on
            Finance and Procurement for a mining operation; Sales, Inventory, and Trade Promotion
            for FMCG. One catalog, one engine, your composition.
          </p>
        </div>

        {/* FEATURED: REAL HANDLERS */}
        <div className="mk5-ind-featured mk5-reveal">
          <div className="mk5-ind-featured-main">
            <div className="mk5-ind-featured-badge">50+ Real Handlers Shipping</div>
            <div className="mk5-ind-featured-title">Real code, not just<br />prompt templates.</div>
            <p className="mk5-ind-featured-desc">
              Catalysts aren&rsquo;t scripted LLM prompts. Over fifty sub-catalysts ship with hand-written
              handlers that pull data from your ERP, run domain logic, and persist governed output.
              The rest are generic templates you can configure or replace. Every handler is typed,
              tested, and auditable.
            </p>
            <div className="mk5-ind-featured-caps">
              {["Cash Flow Forecast", "Budget vs Actual", "Standard Cost Variance", "3-Way Matching", "Supplier Risk", "Inventory Optimisation", "Pipeline Hygiene", "AR Aging", "Payroll Variance"].map((c) => (
                <span key={c} className="mk5-ind-featured-cap">{c}</span>
              ))}
            </div>
          </div>
          <div className="mk5-ind-featured-stats">
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">75</div>
              <div className="mk5-ind-stat-label">Catalyst clusters in the<br />shared catalog</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">445</div>
              <div className="mk5-ind-stat-label">Sub-catalysts, each with<br />its own schedule and tier</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num mk5-mono">3</div>
              <div className="mk5-ind-stat-label">Autonomy tiers from<br />read-only to transactional</div>
            </div>
          </div>
        </div>

        {/* DOMAIN COVERAGE */}
        <div className="mk5-ind-grid mk5-reveal">
          {coverageDomains.map((d) => (
            <div key={d.name} className="mk5-ind-card">
              <div className="mk5-ind-card-icon">{d.icon}</div>
              <div className="mk5-ind-card-name">{d.name}</div>
              <p className="mk5-ind-card-desc">{d.desc}</p>
              <div className="mk5-ind-card-cats">{d.catalysts}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES DEEP-DIVE */}
      <section className="mk5-feat" id="features">
        <div className="mk5-feat-header mk5-reveal">
          <h2>Every feature, built<br />for enterprise.</h2>
          <p>
            Atheon isn&rsquo;t a collection of point solutions. Every capability is integrated
            into the three-layer architecture&nbsp;&mdash; governed, auditable, and correlated.
          </p>
        </div>
        <div className="mk5-feat-grid">
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">ERP Integration</div>
            <div className="mk5-feat-item-title">Native connectors for every major ERP, CRM and HCM</div>
            <p className="mk5-feat-item-desc">
              Pre-built adapters across SAP, Oracle, Microsoft, Salesforce, NetSuite, Workday,
              Odoo, Xero, QuickBooks, Sage and SYSPRO. OAuth 2.0, JWT Bearer, and token-based
              authentication. Bi-directional sync with configurable frequency. ERP credentials
              are stored AES-encrypted, per-tenant.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>SAP S/4HANA (OData V4, 2025 FPS01)</li>
              <li>Salesforce (REST v66.0, Spring &rsquo;26)</li>
              <li>Oracle Fusion (REST 26A)</li>
              <li>Dynamics 365 (OData v4, 10.0.42)</li>
              <li>NetSuite (REST/SuiteTalk 2026.1)</li>
              <li>Odoo 18 (JSON-RPC 2.0 + REST API)</li>
              <li>QuickBooks, Xero, Sage, Workday, SYSPRO</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Catalyst Engine</div>
            <div className="mk5-feat-item-title">75 clusters, 445 sub-catalysts, 50+ real handlers</div>
            <p className="mk5-feat-item-desc">
              A shared catalog of 75 catalyst clusters and 445 sub-catalysts, tag-matched to each
              tenant by function and maturity. Over 50 sub-catalysts ship with real, ERP-connected
              handlers&nbsp;&mdash; the rest are configurable generic templates. Deploy in minutes,
              not months.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>75 clusters across Finance, Ops, Commercial, People, GRC, DQ, ESG and more</li>
              <li>445 sub-catalysts with independent enable/disable and scheduling</li>
              <li>50+ sub-catalysts with real, typed, tested handlers (not prompts)</li>
              <li>Tag-based matching: function, vertical, maturity, criticality</li>
              <li>Three autonomy tiers: read-only, assisted, transactional</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Executive Layer</div>
            <div className="mk5-feat-item-title">Organisation health score</div>
            <p className="mk5-feat-item-desc">
              A single, living metric that synthesises signals from every department, every
              catalyst, and every agent into executive clarity. Natural language queries,
              predictive alerts, and auto-generated board summaries.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Composite health score across all departments</li>
              <li>NLP chat interface for natural language queries</li>
              <li>Predictive risk alerts with confidence scoring</li>
              <li>Auto-generated PDF board reports</li>
              <li>Scenario modelling and what-if analysis</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Governance &amp; Trust</div>
            <div className="mk5-feat-item-title">Enforced MFA, signed webhooks, encrypted exports</div>
            <p className="mk5-feat-item-desc">
              Every catalyst action is logged. MFA is enforced for privileged roles. Outbound
              webhooks are HMAC-SHA256 signed. DSAR exports are AES-encrypted. LLM calls run
              under per-tenant budgets with automatic PII redaction before any prompt leaves
              the platform.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Immutable audit log for every action and decision</li>
              <li>RBAC with 8 role levels and short-TTL JWTs</li>
              <li>Enforced MFA (TOTP) for admin and superadmin roles</li>
              <li>HMAC-signed webhook delivery with per-subscription secrets</li>
              <li>AES-encrypted DSAR exports and ERP credentials at rest</li>
              <li>Multi-tenant isolation across every layer of the stack</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Operational Intelligence</div>
            <div className="mk5-feat-item-title">Cross-department correlation</div>
            <p className="mk5-feat-item-desc">
              The layer that separates Atheon from agents and copilots. Real-time anomaly
              detection, process mining, and recommendation engine that correlates signals
              across every operational boundary.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Real-time anomaly detection with root cause analysis</li>
              <li>Department-level dashboards with drill-down</li>
              <li>Process mining and bottleneck identification</li>
              <li>Confidence-scored recommendations</li>
              <li>Cross-department correlation engine</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Knowledge &amp; Memory</div>
            <div className="mk5-feat-item-title">Enterprise knowledge graph</div>
            <p className="mk5-feat-item-desc">
              Every entity, relationship, and decision is mapped into a living knowledge graph.
              Vector-powered semantic search, citation tracking, and context-aware retrieval
              ensure every answer is grounded in your data.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Entity-relationship knowledge graph</li>
              <li>Vector-powered semantic search (Vectorize)</li>
              <li>Citation tracking with source attribution</li>
              <li>Contextual memory across chat sessions</li>
              <li>RAG pipeline with enterprise data grounding</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Multicompany</div>
            <div className="mk5-feat-item-title">Group companies, one Catalyst</div>
            <p className="mk5-feat-item-desc">
              Run Atheon across a portfolio of legal entities from a single tenant. Connect
              multiple ERP instances, consolidate health scores, and correlate signals across
              subsidiaries&nbsp;&mdash; while each company keeps its own data boundary, schedules,
              and autonomy tiers.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Multiple ERP connections per tenant, one per legal entity</li>
              <li>Per-company integration health and sync status</li>
              <li>Cross-company correlation at the Executive layer</li>
              <li>Independent autonomy tiers and schedules per company</li>
              <li>Role scoping by company for segregated reviewers</li>
            </ul>
          </div>
        </div>
      </section>

      {/* SECURITY POSTURE */}
      <section className="mk5-feat" id="security" style={{ borderTop: 'none' }}>
        <div className="mk5-feat-header mk5-reveal">
          <h2>Security, by default.<br />Not a checkbox.</h2>
          <p>
            Every Catalyst action touches regulated data. Atheon treats security as an architectural
            layer, not a compliance afterthought. Here&rsquo;s what ships enabled on day one.
          </p>
        </div>
        <div className="mk5-feat-grid">
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Identity</div>
            <div className="mk5-feat-item-title">Enforced MFA and short-TTL JWTs</div>
            <p className="mk5-feat-item-desc">
              TOTP-based multi-factor authentication is enforced for admin, superadmin, and support
              roles&nbsp;&mdash; no opt-out. Session tokens are short-lived JWTs with rotation on every
              privileged action, and all login events are streamed to the immutable audit log.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>TOTP MFA (enforced for privileged roles)</li>
              <li>Short-TTL access tokens, rotated on sensitive actions</li>
              <li>Azure AD / SAML 2.0 SSO for centralised identity</li>
              <li>Per-tenant session scoping and impersonation trail</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Data Protection</div>
            <div className="mk5-feat-item-title">AES-encrypted at rest, HMAC-signed in motion</div>
            <p className="mk5-feat-item-desc">
              ERP credentials, DSAR exports, and sensitive payloads are AES-encrypted per tenant.
              Outbound webhooks are HMAC-SHA256 signed with per-subscription secrets so downstream
              systems can verify authenticity. Encryption keys are rotatable without downtime.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>AES-GCM encryption for ERP credentials at rest</li>
              <li>Encrypted DSAR / data-subject exports</li>
              <li>HMAC-SHA256 signed webhooks with rotating secrets</li>
              <li>Key rotation without downtime</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">LLM Safety</div>
            <div className="mk5-feat-item-title">Per-tenant budgets, automatic PII redaction</div>
            <p className="mk5-feat-item-desc">
              Every LLM call runs under a per-tenant spend budget with hard cut-off. Prompts are
              scanned for personal data before leaving the platform, with emails, phone numbers,
              national IDs, and credit card numbers redacted or tokenised. No prompt, no response,
              no tenant data ever crosses tenant boundaries.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Hard per-tenant LLM spend budgets with alerting</li>
              <li>Automatic PII redaction before egress</li>
              <li>Model-agnostic provider abstraction</li>
              <li>Full prompt/response audit with tenant attribution</li>
            </ul>
          </div>
          <div className="mk5-feat-item mk5-reveal">
            <div className="mk5-feat-item-label">Governance</div>
            <div className="mk5-feat-item-title">Immutable audit, explicit autonomy tiers</div>
            <p className="mk5-feat-item-desc">
              Every catalyst action records inputs, outputs, handler, confidence, and the human
              who reviewed it. Autonomy tiers&nbsp;&mdash; read-only, assisted, transactional&nbsp;&mdash;
              are enforced at the engine layer, not the UI. Promotion between tiers is a governed
              event with its own approval trail.
            </p>
            <ul className="mk5-feat-item-bullets">
              <li>Append-only audit log across every layer</li>
              <li>Explicit autonomy-tier enforcement in the engine</li>
              <li>Governed tier promotion with approver record</li>
              <li>Tenant-scoped data, jobs, and quota isolation</li>
            </ul>
          </div>
        </div>
      </section>

      {/* ETHOS */}
      <section className="mk5-ethos" id="ethos">
        <div className="mk5-layers-intro">
          <div className="mk5-layers-intro-left">Ethos</div>
          <div className="mk5-layers-intro-right mk5-reveal">
            <h2>What we believe.</h2>
            <p>
              A Catalyst isn&rsquo;t built on features. It&rsquo;s built on principles. These are the
              convictions that shape every layer of the Atheon platform.
            </p>
          </div>
        </div>
        <div className="mk5-ethos-grid">
          <div className="mk5-ethos-card mk5-reveal">
            <div className="mk5-ethos-num">01</div>
            <h3 className="mk5-ethos-title">Truth over automation</h3>
            <p className="mk5-ethos-desc">
              Agents automate. Copilots assist. Neither delivers truth. A Catalyst synthesises
              every signal across your entire organisation into a single, living health score&nbsp;&mdash;
              so decisions are made from clarity, not dashboards.
            </p>
            <div className="mk5-ethos-accent" />
          </div>
          <div className="mk5-ethos-card mk5-reveal mk5-rd1">
            <div className="mk5-ethos-num">02</div>
            <h3 className="mk5-ethos-title">Governance is non-negotiable</h3>
            <p className="mk5-ethos-desc">
              Every agent output is governed. Every decision is auditable. Every escalation is
              routed through intelligence layers. A fleet of autonomous agents without governance
              is a liability. A Catalyst makes it an asset.
            </p>
            <div className="mk5-ethos-accent" />
          </div>
          <div className="mk5-ethos-card mk5-reveal mk5-rd2">
            <div className="mk5-ethos-num">03</div>
            <h3 className="mk5-ethos-title">Correlation, not silos</h3>
            <p className="mk5-ethos-desc">
              Departments don&rsquo;t operate in isolation. Neither should intelligence. Atheon
              correlates outputs across finance, operations, HR, and supply chain&nbsp;&mdash; detecting
              anomalies that no single agent could ever see.
            </p>
            <div className="mk5-ethos-accent" />
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="mk5-cta" id="cta-s">
        <div className="mk5-cta-content">
          <div className="mk5-cta-ey mk5-reveal">The Next Evolution in Enterprise AI</div>
          <h2 className="mk5-reveal">Meet the<br /><i>Catalyst.</i></h2>
          <p className="mk5-cta-sub mk5-reveal">
            Three layers of intelligence, 75 clusters, 445 sub-catalysts, ERP-native. We&rsquo;re
            onboarding founding partners now&nbsp;&mdash; start a trial or send us a note below.
          </p>
          <div className="mk5-cta-actions mk5-reveal">
            <a href="/trial" className="mk5-btn-main">Start Trial</a>
            <a href="/login" className="mk5-btn-line">Customer Login</a>
          </div>
          <ContactForm />
        </div>
      </section>

      {/* FOOTER */}
      <footer className="mk5-footer">
        <div className="mk5-fl">Atheon</div>
        <div className="mk5-fc">
          The World&rsquo;s First Catalyst Platform&nbsp;&mdash; A Vanta X Platform
          <div style={{ marginTop: '0.5rem', fontSize: '0.85em' }}>
            <a href="/status">Status</a>
            {' · '}
            <a href="/legal/security">Security &amp; Privacy</a>
            {' · '}
            <a href="/legal/connectors">Connectors</a>
            {' · '}
            <a href="/legal/performance">Performance</a>
            {' · '}
            <a href="/pricing">Pricing</a>
            {' · '}
            <a href="/login">Sign in</a>
          </div>
        </div>
        <div className="mk5-fr">&copy; 2026 Atheon. All rights reserved.</div>
      </footer>
    </div>
  );
}
