import { useEffect, useRef, useState } from "react";

/* ============================================================
   ATHEON MARKETING PAGE - Exact match to reference design
   ============================================================ */

const marketingCSS = `
@import url('https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Outfit:wght@200;300;400;500;600;700&family=IBM+Plex+Mono:wght@300;400;500&display=swap');

.mk5-body {
  --void: #06090d;
  --abyss: #0a0f14;
  --deep: #0e151c;
  --sage: #A3B18A;
  --sage-b: #5d8a6f;
  --sage-d: rgba(74,107,90,.08);
  --bronze: #CDA37E;
  --sky: #7EB3CD;
  --cream: #e8e4dc;
  --chalk: #c4bfb4;
  --slate: #586573;
  --line: rgba(74,107,90,.1);
  --line-b: rgba(74,107,90,.25);
  font-family: 'Outfit', sans-serif;
  background: var(--void);
  color: var(--cream);
  -webkit-font-smoothing: antialiased;
  overflow-x: hidden;
  cursor: auto;
}
.mk5-body ::selection { background: var(--sage); color: var(--void); }
.mk5-body a { color: inherit; text-decoration: none; }

/* GRAIN */
.mk5-grain {
  position: fixed; inset: 0; z-index: 9998; pointer-events: none; opacity: .035;
  background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 512 512' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='6' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
  background-size: 256px;
}

/* CURSOR */




/* NAV */
.mk5-nav {
  position: fixed; top: 0; width: 100%; z-index: 300;
  display: flex; justify-content: space-between; align-items: center;
  padding: 2rem 3.5rem; mix-blend-mode: difference;
}
.mk5-nav-logo {
  display: flex; align-items: center; gap: .6rem;
  font-family: 'Instrument Serif', serif; font-size: 1.4rem; letter-spacing: .15em;
  text-decoration: none; color: var(--cream);
}
.mk5-nav-links { display: flex; gap: 3rem; align-items: center; }
.mk5-nav-links a {
  font-size: .72rem; font-weight: 500; letter-spacing: .2em; text-transform: uppercase;
  color: var(--chalk); opacity: .6; transition: opacity .3s; text-decoration: none;
}
.mk5-nav-links a:hover { opacity: 1; }
.mk5-nav-cta {
  font-size: .68rem !important; font-weight: 600 !important; letter-spacing: .25em !important;
  padding: .7rem 2rem; border: 1px solid var(--sage); color: var(--sage) !important;
  opacity: 1 !important; position: relative; overflow: hidden;
  transition: all .4s cubic-bezier(.16,1,.3,1) !important;
  background: transparent; cursor: auto; text-transform: uppercase;
}
.mk5-nav-cta::before {
  content: ''; position: absolute; inset: 0; background: var(--sage);
  transform: translateY(100%); transition: transform .4s cubic-bezier(.16,1,.3,1);
}
.mk5-nav-cta:hover { color: var(--void) !important; }
.mk5-nav-cta:hover::before { transform: translateY(0); }
.mk5-nav-cta span { position: relative; z-index: 1; }

/* MOBILE HAMBURGER */
.mk5-hamburger {
  display: none; background: none; border: none; cursor: pointer; padding: .5rem;
  flex-direction: column; gap: 5px; z-index: 201;
}
.mk5-hamburger span {
  display: block; width: 24px; height: 2px; background: var(--cream);
  transition: all .3s cubic-bezier(.16,1,.3,1);
}
.mk5-hamburger.open span:nth-child(1) { transform: rotate(45deg) translate(5px, 5px); }
.mk5-hamburger.open span:nth-child(2) { opacity: 0; }
.mk5-hamburger.open span:nth-child(3) { transform: rotate(-45deg) translate(5px, -5px); }

/* MOBILE MENU OVERLAY */
.mk5-mobile-menu {
  display: none; position: fixed; inset: 0; z-index: 200;
  background: var(--void); flex-direction: column; align-items: center;
  justify-content: center; gap: 2rem;
}
.mk5-mobile-menu.open { display: flex; }
.mk5-mobile-menu a {
  font-size: 1rem; font-weight: 500; letter-spacing: .2em; text-transform: uppercase;
  color: var(--chalk); opacity: .8; transition: opacity .3s; text-decoration: none;
}
.mk5-mobile-menu a:hover { opacity: 1; }
.mk5-mobile-menu .mk5-nav-cta {
  font-size: .8rem !important; padding: 1rem 2.5rem;
}

/* HERO */
.mk5-hero {
  height: 100vh; min-height: 700px; display: flex; align-items: flex-end;
  padding: 0 3.5rem 6rem; position: relative; overflow: hidden;
}
.mk5-hero canvas { position: absolute; inset: 0; z-index: 0; }
.mk5-hero::after {
  content: ''; position: absolute; inset: 0; z-index: 1;
  background:
    radial-gradient(ellipse 60% 50% at 65% 40%, rgba(74,107,90,.06) 0%, transparent 70%),
    radial-gradient(ellipse 40% 60% at 30% 70%, rgba(201,160,89,.03) 0%, transparent 60%),
    linear-gradient(180deg, transparent 50%, var(--void) 100%);
}
.mk5-hero-content {
  position: relative; z-index: 2; display: grid; grid-template-columns: 1fr 1fr;
  gap: 4rem; width: 100%; align-items: end;
}
.mk5-hero-left { max-width: 680px; }
.mk5-hero-eyebrow {
  display: inline-flex; align-items: center; gap: 1rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .62rem; letter-spacing: .35em;
  text-transform: uppercase; color: var(--sage); margin-bottom: 2.5rem;
  opacity: 0; animation: mk5revUp 1s cubic-bezier(.16,1,.3,1) .5s forwards;
}
.mk5-hero-eyebrow::before {
  content: ''; width: 50px; height: 1px;
  background: linear-gradient(90deg, transparent, var(--sage));
}
.mk5-hero h1 {
  font-family: 'Instrument Serif', serif; font-size: clamp(3.5rem, 7.5vw, 7rem);
  font-weight: 400; line-height: .95; letter-spacing: -.02em; margin: 0;
  opacity: 0; animation: mk5revUp 1.2s cubic-bezier(.16,1,.3,1) .7s forwards;
}
.mk5-hero h1 i {
  font-style: italic;
  background: linear-gradient(135deg, var(--sage-b), var(--sky));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.mk5-hero h1 .thin {
  font-family: 'Outfit', sans-serif; font-weight: 200; font-size: .7em;
  -webkit-text-fill-color: var(--chalk); letter-spacing: .02em;
}
.mk5-hero-right { display: flex; flex-direction: column; gap: 2.5rem; padding-bottom: .5rem; }
.mk5-hero-desc {
  font-size: 1.05rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
  max-width: 420px; opacity: 0; animation: mk5revUp 1s cubic-bezier(.16,1,.3,1) 1s forwards;
}
.mk5-hero-actions {
  display: flex; gap: 2rem; align-items: center;
  opacity: 0; animation: mk5revUp 1s cubic-bezier(.16,1,.3,1) 1.2s forwards;
}
.mk5-btn-main {
  display: inline-flex; align-items: center; gap: 1rem;
  padding: 1.1rem 2.8rem; background: var(--sage); color: var(--void);
  font-weight: 600; font-size: .75rem; letter-spacing: .2em; text-transform: uppercase;
  overflow: hidden; transition: all .5s cubic-bezier(.16,1,.3,1);
  border: none; cursor: auto;
}
.mk5-btn-main::after {
  content: '\\2192'; font-size: 1.2rem;
  transition: transform .4s cubic-bezier(.16,1,.3,1);
}
.mk5-btn-main:hover::after { transform: translateX(6px); }
.mk5-btn-main:hover { letter-spacing: .3em; }
.mk5-btn-line {
  font-size: .75rem; font-weight: 400; letter-spacing: .15em; text-transform: uppercase;
  color: var(--chalk); padding-bottom: .3rem; border: none; background: transparent;
  border-bottom: 1px solid var(--line-b); transition: all .3s; cursor: auto;
}
.mk5-btn-line:hover { color: var(--cream); border-bottom-color: var(--cream); }
.mk5-hero-scroll {
  position: absolute; bottom: 2.5rem; left: 50%; transform: translateX(-50%);
  z-index: 3; display: flex; flex-direction: column; align-items: center; gap: .5rem;
  opacity: 0; animation: mk5revUp 1s ease 2s forwards;
}
.mk5-scroll-line {
  width: 1px; height: 50px; position: relative; overflow: hidden; background: var(--line);
}
.mk5-scroll-line::after {
  content: ''; position: absolute; top: -100%; left: 0; width: 1px; height: 100%;
  background: var(--sage); animation: mk5scrollP 2s ease-in-out infinite;
}
.mk5-hero-scroll span {
  font-family: 'IBM Plex Mono', monospace; font-size: .55rem; letter-spacing: .3em;
  text-transform: uppercase; color: var(--slate);
}

/* TICKER */
.mk5-ticker {
  padding: 3rem 0; overflow: hidden;
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.mk5-ticker-track {
  display: flex; white-space: nowrap; animation: mk5tickScroll 40s linear infinite;
}
.mk5-ticker-item {
  font-family: 'Instrument Serif', serif; font-size: clamp(3rem, 6vw, 5rem);
  padding: 0 2rem; flex-shrink: 0; display: flex; align-items: center; gap: 2rem;
  -webkit-text-fill-color: transparent; -webkit-text-stroke: 1px rgba(74,107,90,.15);
}
.mk5-ticker-dot {
  width: 8px; height: 8px; border-radius: 50%; background: var(--sage);
  opacity: .3; flex-shrink: 0; display: inline-block;
}

/* MANIFESTO */
.mk5-manifesto {
  padding: 14rem 3.5rem; display: flex; justify-content: center; position: relative;
}
.mk5-manifesto::before {
  content: '01'; position: absolute; top: 6rem; left: 3.5rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .3em;
  color: var(--sage); opacity: .4;
}
.mk5-manifesto-text {
  font-family: 'Instrument Serif', serif; font-size: clamp(2rem, 4.5vw, 3.8rem);
  font-weight: 400; line-height: 1.4; text-align: center; max-width: 1000px;
  color: var(--chalk);
}
.mk5-manifesto-text em {
  font-style: italic;
  background: linear-gradient(135deg, var(--sage-b), var(--sky));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.mk5-manifesto-text strong {
  color: var(--cream); font-weight: 400; -webkit-text-fill-color: var(--cream);
}

/* EVOLUTION STRIP */
.mk5-evo {
  padding: 0 3.5rem; display: grid; grid-template-columns: repeat(3, 1fr);
  gap: 1px; background: var(--line); margin-bottom: 0;
}
.mk5-evo-item {
  background: var(--abyss); padding: 4rem 3rem; position: relative; transition: all .5s;
}
.mk5-evo-item:hover { background: var(--deep); }
.mk5-evo-item::before {
  content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 2px;
  transition: background .4s;
}
.mk5-evo-item.past::before { background: var(--slate); }
.mk5-evo-item.present::before { background: var(--sky); }
.mk5-evo-item.future::before { background: var(--sage); height: 3px; }
.mk5-evo-era {
  font-family: 'IBM Plex Mono', monospace; font-size: .5rem; letter-spacing: .35em;
  text-transform: uppercase; margin-bottom: 1.5rem;
}
.mk5-evo-era.past { color: var(--slate); }
.mk5-evo-era.present { color: var(--sky); }
.mk5-evo-era.future { color: var(--sage); }
.mk5-evo-name {
  font-family: 'Instrument Serif', serif; font-size: 2.5rem; font-weight: 400;
  margin-bottom: 1rem;
}
.mk5-evo-item.future .mk5-evo-name {
  background: linear-gradient(135deg, var(--sage-b), var(--bronze));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.mk5-evo-desc { font-size: .9rem; font-weight: 300; line-height: 1.8; color: var(--chalk); }
.mk5-evo-arrow {
  font-family: 'Instrument Serif', serif; font-size: 1.5rem; color: var(--slate);
  margin-top: 1.5rem; opacity: .3;
}

/* LAYERS SECTION */
.mk5-layers { padding: 0 3.5rem 10rem; }
.mk5-layers-intro {
  display: grid; grid-template-columns: 1fr 1fr; gap: 4rem;
  margin-bottom: 10rem; padding-top: 4rem; border-top: 1px solid var(--line);
}
.mk5-layers-intro-left {
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .35em;
  text-transform: uppercase; color: var(--sage); padding-top: .3rem;
}
.mk5-layers-intro-right h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(2.5rem, 5vw, 4.5rem);
  font-weight: 400; line-height: 1.1; margin-bottom: 2rem;
}
.mk5-layers-intro-right p {
  font-size: 1.05rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
  max-width: 500px;
}
.mk5-layer-block {
  display: grid; grid-template-columns: 120px 1fr 1.2fr; gap: 4rem;
  padding: 5rem 0; border-top: 1px solid var(--line);
  opacity: 0; transform: translateY(40px);
  transition: all .8s cubic-bezier(.16,1,.3,1);
}
.mk5-layer-block.visible { opacity: 1; transform: translateY(0); }
.mk5-layer-num {
  font-family: 'Instrument Serif', serif; font-size: 8rem; font-weight: 400;
  line-height: .8; -webkit-text-stroke: 1px var(--line-b);
  -webkit-text-fill-color: transparent; user-select: none;
}
.mk5-layer-name {
  font-family: 'Instrument Serif', serif; font-size: 2.2rem; font-weight: 400;
  line-height: 1.2; margin-bottom: .5rem;
}
.mk5-layer-role {
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .3em;
  text-transform: uppercase; margin-bottom: 2rem;
}
.mk5-layer-role.bronze { color: var(--bronze); }
.mk5-layer-role.sky { color: var(--sky); }
.mk5-layer-role.sage { color: var(--sage); }
.mk5-layer-desc {
  font-size: 1rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
  margin-bottom: 2.5rem;
}
.mk5-layer-tags { display: flex; flex-wrap: wrap; gap: .5rem; }
.mk5-layer-tag {
  padding: .4rem 1rem; font-size: .7rem; font-weight: 500; letter-spacing: .05em;
  border: 1px solid var(--line); color: var(--chalk); transition: all .3s;
}
.mk5-layer-tag:hover { border-color: var(--sage); color: var(--sage); background: var(--sage-d); }
.mk5-layer-visual {
  display: flex; align-items: center; justify-content: center; position: relative;
  min-height: 300px;
}
.mk5-layer-visual canvas { width: 100%; height: 100%; }

/* BIG STATEMENT */
.mk5-big-stmt { padding: 16rem 3.5rem; text-align: center; }
.mk5-big-stmt h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(3rem, 8vw, 8rem);
  font-weight: 400; line-height: .95; letter-spacing: -.02em;
}
.mk5-big-stmt .stroke {
  -webkit-text-fill-color: transparent; -webkit-text-stroke: 1.5px var(--chalk);
}
.mk5-big-stmt .glow {
  background: linear-gradient(135deg, var(--sage-b), var(--bronze));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}

/* STATS */
.mk5-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  border-top: 1px solid var(--line); border-bottom: 1px solid var(--line);
}
.mk5-stat-item {
  padding: 4rem 3rem; border-right: 1px solid var(--line); text-align: center;
  transition: background .4s;
}
.mk5-stat-item:last-child { border-right: none; }
.mk5-stat-item:hover { background: var(--sage-d); }
.mk5-stat-num {
  font-family: 'Instrument Serif', serif; font-size: 4.5rem; font-weight: 400; line-height: 1;
}
.mk5-stat-num .accent { color: var(--sage-b); }
.mk5-stat-label {
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .25em;
  text-transform: uppercase; color: var(--slate); margin-top: 1rem;
}

/* COMPARISON */
.mk5-comp { padding: 10rem 3.5rem; position: relative; }
.mk5-comp::before {
  content: '02'; position: absolute; top: 4rem; left: 3.5rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .3em;
  color: var(--sage); opacity: .4;
}
.mk5-comp-header { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; margin-bottom: 5rem; }
.mk5-comp-header h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(2.5rem, 4vw, 4rem);
  font-weight: 400; line-height: 1.1;
}
.mk5-comp-header p { font-size: 1rem; font-weight: 300; line-height: 1.9; color: var(--chalk); align-self: end; }
.mk5-cg {
  display: grid; grid-template-columns: 2fr repeat(4, 1fr); border-top: 1px solid var(--line);
}
.mk5-ch {
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; font-weight: 500;
  letter-spacing: .2em; text-transform: uppercase; color: var(--slate);
  padding: 1.2rem 1.5rem; border-bottom: 2px solid var(--line); border-right: 1px solid var(--line);
}
.mk5-ch:nth-child(5n) { border-right: none; }
.mk5-ch.ath { color: var(--sage); border-bottom-color: var(--sage); }
.mk5-cc {
  padding: 1.4rem 1.5rem; font-size: .85rem; border-bottom: 1px solid var(--line);
  border-right: 1px solid var(--line); transition: background .3s;
}
.mk5-cc:nth-child(5n) { border-right: none; }
.mk5-cc.rl { font-weight: 500; color: var(--cream); }
.mk5-cc.ca { background: var(--sage-d); color: var(--sage-b); font-weight: 600; }
.mk5-cc.cy { color: var(--sage); }
.mk5-cc.cn { color: var(--slate); opacity: .3; }
.mk5-cc.cp { color: var(--slate); font-style: italic; }

/* INTEGRATIONS */
.mk5-int { padding: 10rem 3.5rem; }
.mk5-int-header { margin-bottom: 5rem; padding-bottom: 3rem; border-bottom: 1px solid var(--line); }
.mk5-int-header h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(2rem, 3.5vw, 3rem);
  font-weight: 400; line-height: 1.2;
}
.mk5-int-grid {
  display: grid; grid-template-columns: repeat(5, 1fr); gap: 1px; background: var(--line);
}
.mk5-int-item {
  background: var(--abyss); padding: 3rem 2rem; text-align: center;
  transition: all .4s; display: flex; flex-direction: column; align-items: center; gap: 1rem;
}
.mk5-int-item:hover { background: var(--sage-d); }
.mk5-int-icon { font-size: 1.6rem; opacity: .25; transition: opacity .3s; }
.mk5-int-item:hover .mk5-int-icon { opacity: .6; }
.mk5-int-name { font-size: .75rem; font-weight: 500; letter-spacing: .1em; color: var(--chalk); }
.mk5-int-type {
  font-family: 'IBM Plex Mono', monospace; font-size: .5rem; letter-spacing: .2em;
  text-transform: uppercase; color: var(--slate);
}

/* INDUSTRY SOLUTIONS */
.mk5-ind { padding: 10rem 3.5rem; position: relative; }
.mk5-ind::before {
  content: '03'; position: absolute; top: 4rem; left: 3.5rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .3em;
  color: var(--sage); opacity: .4;
}
.mk5-ind-header { display: grid; grid-template-columns: 1fr 1fr; gap: 4rem; margin-bottom: 5rem; }
.mk5-ind-header h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(2.5rem, 4vw, 4rem);
  font-weight: 400; line-height: 1.1;
}
.mk5-ind-header p { font-size: 1rem; font-weight: 300; line-height: 1.9; color: var(--chalk); align-self: end; }
.mk5-ind-featured {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1px; background: var(--line);
  margin-bottom: 4rem;
}
.mk5-ind-featured-main {
  background: var(--abyss); padding: 4rem 3rem; position: relative;
  border-left: 3px solid var(--sage); transition: all .5s;
}
.mk5-ind-featured-main:hover { background: var(--deep); }
.mk5-ind-featured-badge {
  display: inline-block; font-family: 'IBM Plex Mono', monospace; font-size: .5rem;
  letter-spacing: .3em; text-transform: uppercase; color: var(--void);
  background: var(--sage); padding: .3rem .8rem; margin-bottom: 1.5rem;
}
.mk5-ind-featured-title {
  font-family: 'Instrument Serif', serif; font-size: 2.2rem; font-weight: 400;
  line-height: 1.2; margin-bottom: 1rem;
}
.mk5-ind-featured-desc {
  font-size: .95rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
  margin-bottom: 2rem;
}
.mk5-ind-featured-caps {
  display: flex; flex-wrap: wrap; gap: .5rem;
}
.mk5-ind-featured-cap {
  padding: .4rem 1rem; font-size: .7rem; font-weight: 500; letter-spacing: .05em;
  border: 1px solid var(--sage); color: var(--sage); background: var(--sage-d);
}
.mk5-ind-featured-stats {
  background: var(--abyss); padding: 4rem 3rem;
  display: flex; flex-direction: column; justify-content: center; gap: 2.5rem;
}
.mk5-ind-stat-row {
  display: flex; align-items: baseline; gap: 1rem;
}
.mk5-ind-stat-num {
  font-family: 'Instrument Serif', serif; font-size: 3rem; font-weight: 400;
  line-height: 1; color: var(--sage-b);
}
.mk5-ind-stat-label {
  font-size: .85rem; font-weight: 300; color: var(--chalk); line-height: 1.4;
}
.mk5-ind-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px; background: var(--line);
}
.mk5-ind-card {
  background: var(--abyss); padding: 3rem 2.5rem; transition: all .5s; position: relative;
}
.mk5-ind-card:hover { background: var(--deep); }
.mk5-ind-card::before {
  content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 2px;
  background: transparent; transition: background .4s;
}
.mk5-ind-card:hover::before { background: var(--sage); }
.mk5-ind-card-icon {
  font-size: 1.4rem; margin-bottom: 1.5rem; opacity: .4;
}
.mk5-ind-card-name {
  font-family: 'Instrument Serif', serif; font-size: 1.5rem; font-weight: 400;
  margin-bottom: .5rem;
}
.mk5-ind-card-desc {
  font-size: .85rem; font-weight: 300; line-height: 1.8; color: var(--chalk);
  margin-bottom: 1.5rem;
}
.mk5-ind-card-cats {
  font-family: 'IBM Plex Mono', monospace; font-size: .55rem; letter-spacing: .15em;
  color: var(--slate); line-height: 1.8;
}

/* FEATURES DEEP-DIVE */
.mk5-feat { padding: 10rem 3.5rem; border-top: 1px solid var(--line); position: relative; }
.mk5-feat::before {
  content: '04'; position: absolute; top: 4rem; left: 3.5rem;
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .3em;
  color: var(--sage); opacity: .4;
}
.mk5-feat-header { margin-bottom: 5rem; }
.mk5-feat-header h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(2.5rem, 4vw, 4rem);
  font-weight: 400; line-height: 1.1; margin-bottom: 1.5rem;
}
.mk5-feat-header p { font-size: 1rem; font-weight: 300; line-height: 1.9; color: var(--chalk); max-width: 600px; }
.mk5-feat-grid {
  display: grid; grid-template-columns: repeat(2, 1fr); gap: 1px; background: var(--line);
}
.mk5-feat-item {
  background: var(--abyss); padding: 3.5rem 3rem; transition: all .5s;
}
.mk5-feat-item:hover { background: var(--deep); }
.mk5-feat-item-label {
  font-family: 'IBM Plex Mono', monospace; font-size: .55rem; letter-spacing: .3em;
  text-transform: uppercase; color: var(--sage); margin-bottom: 1rem;
}
.mk5-feat-item-title {
  font-family: 'Instrument Serif', serif; font-size: 1.6rem; font-weight: 400;
  margin-bottom: 1rem;
}
.mk5-feat-item-desc {
  font-size: .9rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
  margin-bottom: 1.5rem;
}
.mk5-feat-item-bullets {
  list-style: none; padding: 0; margin: 0;
}
.mk5-feat-item-bullets li {
  font-size: .8rem; font-weight: 300; color: var(--chalk); padding: .3rem 0;
  padding-left: 1.2rem; position: relative;
}
.mk5-feat-item-bullets li::before {
  content: ''; position: absolute; left: 0; top: .7rem;
  width: 5px; height: 1px; background: var(--sage);
}

/* ETHOS */
.mk5-ethos { padding: 10rem 3.5rem; border-top: 1px solid var(--line); }
.mk5-ethos-grid {
  display: grid; grid-template-columns: repeat(3, 1fr); gap: 1px;
  background: var(--line); margin-top: 5rem;
}
.mk5-ethos-card {
  background: var(--abyss); padding: 4rem 3rem; position: relative; transition: all .5s;
}
.mk5-ethos-card:hover { background: var(--deep); }
.mk5-ethos-card::before {
  content: ''; position: absolute; top: 0; left: 0; width: 100%; height: 2px;
  background: var(--sage); opacity: 0; transition: opacity .4s;
}
.mk5-ethos-card:hover::before { opacity: 1; }
.mk5-ethos-num {
  font-family: 'Instrument Serif', serif; font-size: 3.5rem; font-weight: 400;
  line-height: 1; -webkit-text-stroke: 1px var(--line-b); -webkit-text-fill-color: transparent;
  margin-bottom: 2rem; user-select: none;
}
.mk5-ethos-title {
  font-family: 'Instrument Serif', serif; font-size: 1.8rem; font-weight: 400;
  line-height: 1.2; margin-bottom: 1rem;
}
.mk5-ethos-desc {
  font-size: .9rem; font-weight: 300; line-height: 1.9; color: var(--chalk);
}
.mk5-ethos-accent {
  display: inline-block; width: 30px; height: 1px; margin-top: 2rem;
  transition: width .4s, background .4s;
}
.mk5-ethos-card:nth-child(1) .mk5-ethos-accent { background: var(--bronze); }
.mk5-ethos-card:nth-child(2) .mk5-ethos-accent { background: var(--sky); }
.mk5-ethos-card:nth-child(3) .mk5-ethos-accent { background: var(--sage-b); }
.mk5-ethos-card:hover .mk5-ethos-accent { width: 60px; }

/* CTA */
.mk5-cta {
  min-height: 100vh; display: flex; align-items: center; justify-content: center;
  flex-direction: column; text-align: center; position: relative; padding: 4rem;
}
.mk5-cta::before {
  content: ''; position: absolute; inset: 0;
  background: radial-gradient(ellipse 50% 50% at 50% 50%, rgba(74,107,90,.06) 0%, transparent 70%);
}
.mk5-cta-content { position: relative; z-index: 2; }
.mk5-cta-ey {
  font-family: 'IBM Plex Mono', monospace; font-size: .6rem; letter-spacing: .4em;
  text-transform: uppercase; color: var(--sage); margin-bottom: 3rem;
}
.mk5-cta h2 {
  font-family: 'Instrument Serif', serif; font-size: clamp(3rem, 7vw, 6.5rem);
  font-weight: 400; line-height: .95; letter-spacing: -.02em; margin-bottom: 2rem;
}
.mk5-cta h2 i {
  font-style: italic;
  background: linear-gradient(135deg, var(--sage-b), var(--bronze));
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}
.mk5-cta-sub {
  font-size: 1.1rem; font-weight: 300; line-height: 1.8; color: var(--chalk);
  max-width: 480px; margin: 0 auto 3.5rem;
}
.mk5-cta-actions {
  display: flex; gap: 2rem; justify-content: center; align-items: center;
  margin-bottom: 4rem; flex-wrap: wrap;
}

/* CONTACT FORM */
.mk5-contact {
  display: flex; flex-direction: column; gap: 1.25rem;
  max-width: 560px; margin: 0 auto; text-align: left;
  padding: 2.5rem; background: var(--abyss); border: 1px solid var(--line);
}
.mk5-contact-row {
  display: grid; grid-template-columns: 1fr 1fr; gap: 1.25rem;
}
.mk5-contact-field { display: flex; flex-direction: column; gap: .5rem; }
.mk5-contact-field > span {
  font-family: 'IBM Plex Mono', monospace; font-size: .55rem;
  letter-spacing: .3em; text-transform: uppercase; color: var(--sage);
}
.mk5-contact-field input,
.mk5-contact-field textarea {
  background: var(--void); border: 1px solid var(--line-b);
  color: var(--cream); font-family: 'Outfit', sans-serif; font-size: .9rem;
  padding: .75rem 1rem; outline: none; transition: border-color .2s;
  font-weight: 300; resize: vertical;
}
.mk5-contact-field input:focus,
.mk5-contact-field textarea:focus { border-color: var(--sage); }
.mk5-contact-field textarea { min-height: 100px; }
.mk5-contact-error {
  font-size: .8rem; color: var(--bronze); padding: .5rem .75rem;
  border-left: 2px solid var(--bronze); background: rgba(201,160,89,.05);
}
.mk5-contact button[type="submit"] {
  align-self: flex-start; margin-top: .5rem;
}
.mk5-contact button[type="submit"]:disabled { opacity: .5; cursor: not-allowed; }
.mk5-contact-success {
  max-width: 560px; margin: 0 auto; padding: 3rem 2rem; text-align: center;
  background: var(--abyss); border: 1px solid var(--sage);
}
.mk5-contact-success-title {
  font-family: 'Instrument Serif', serif; font-size: 1.8rem; color: var(--sage-b);
  margin-bottom: .75rem;
}
.mk5-contact-success p {
  font-size: .95rem; color: var(--chalk); line-height: 1.7;
}
@media(max-width: 640px) {
  .mk5-contact { padding: 1.75rem; }
  .mk5-contact-row { grid-template-columns: 1fr; }
  .mk5-cta-actions { gap: 1.25rem; }
}

/* FOOTER */
.mk5-footer {
  padding: 3rem 3.5rem; border-top: 1px solid var(--line);
  display: grid; grid-template-columns: 1fr 1fr 1fr; align-items: center;
}
.mk5-fl { font-family: 'Instrument Serif', serif; font-size: 1.2rem; letter-spacing: .15em; }
.mk5-fc { text-align: center; font-size: .75rem; font-weight: 300; color: var(--slate); }
.mk5-fr {
  text-align: right; font-family: 'IBM Plex Mono', monospace; font-size: .55rem;
  letter-spacing: .2em; text-transform: uppercase; color: var(--slate);
}

/* ANIMATIONS */
@keyframes mk5revUp { from { opacity: 0; transform: translateY(50px); } to { opacity: 1; transform: translateY(0); } }
@keyframes mk5scrollP { 0% { top: -100%; } 100% { top: 200%; } }
@keyframes mk5tickScroll { 0% { transform: translateX(0); } 100% { transform: translateX(-50%); } }
.mk5-reveal { opacity: 0; transform: translateY(50px); transition: all 1s cubic-bezier(.16,1,.3,1); }
.mk5-reveal.visible { opacity: 1; transform: translateY(0); }
.mk5-rd1 { transition-delay: .1s; }
.mk5-rd2 { transition-delay: .2s; }
.mk5-rd3 { transition-delay: .3s; }

/* RESPONSIVE */
@media(max-width: 1024px) {
  .mk5-hero-content { grid-template-columns: 1fr; }
  .mk5-layers-intro { grid-template-columns: 1fr; gap: 2rem; }
  .mk5-layer-block { grid-template-columns: 60px 1fr; gap: 2rem; }
  .mk5-layer-visual { display: none; }
  .mk5-stats { grid-template-columns: repeat(2, 1fr); }
  .mk5-evo { grid-template-columns: 1fr; }
  .mk5-int-grid { grid-template-columns: repeat(3, 1fr); }
  .mk5-comp-header { grid-template-columns: 1fr; }
  .mk5-ethos-grid { grid-template-columns: 1fr; }
  .mk5-ind-header { grid-template-columns: 1fr; }
  .mk5-ind-featured { grid-template-columns: 1fr; }
  .mk5-ind-grid { grid-template-columns: 1fr; }
  .mk5-feat-grid { grid-template-columns: 1fr; }
}
@media(max-width: 768px) {
  .mk5-nav { padding: 1.5rem 2rem; }
  .mk5-nav-links { display: none; }
  .mk5-hamburger { display: flex; }
  .mk5-hero { padding: 0 2rem 4rem; }
  .mk5-manifesto { padding: 8rem 2rem; }
  .mk5-layers, .mk5-comp, .mk5-int, .mk5-ind, .mk5-feat, .mk5-ethos { padding-left: 2rem; padding-right: 2rem; }
  .mk5-layer-block { grid-template-columns: 1fr; }
  .mk5-layer-num { font-size: 4rem; }
  .mk5-stats { grid-template-columns: 1fr 1fr; }
  .mk5-int-grid { grid-template-columns: repeat(2, 1fr); }
  .mk5-footer { grid-template-columns: 1fr; gap: 1.5rem; text-align: center; }
  .mk5-fr { text-align: center; }
  .mk5-big-stmt { padding: 8rem 2rem; }
  .mk5-cg { min-width: 700px; }
  .mk5-comp { overflow-x: auto; }
  .mk5-ethos-grid { grid-template-columns: 1fr; }
  .mk5-body { cursor: auto; }
  
}
`;

/* ---- SVG Components ---- */

const AtheonLogo = ({ size = 28 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
    <path d="M16 4L27 27H5L16 4Z" fill="none" stroke="#A3B18A" strokeWidth="1.5" />
    <line x1="9" y1="20" x2="23" y2="20" stroke="#A3B18A" strokeWidth=".8" opacity=".6" />
    <line x1="11.5" y1="14.5" x2="20.5" y2="14.5" stroke="#7EB3CD" strokeWidth=".8" opacity=".5" />
    <circle cx="16" cy="9" r="1.5" fill="#CDA37E" />
  </svg>
);

/* ---- Canvas: Particle Pyramid (Hero) ---- */

function HeroCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let w = 0, h = 0;
    const particles: Array<{
      tx: number; ty: number; x: number; y: number; s: number; a: number;
      sp: number; an: number; dr: number; c: string; fx: number; fy: number;
    }> = [];

    function resize() {
      w = canvas!.width = window.innerWidth;
      h = canvas!.height = window.innerHeight;
      for (const p of particles) {
        p.tx = w * p.fx;
        p.ty = h * p.fy;
      }
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < 200; i++) {
      const row = Math.random();
      const halfW = row * 0.35;
      const fx = 0.62 + (Math.random() - 0.5) * halfW * 2;
      const fy = 0.15 + row * 0.7;
      const tx = w * fx;
      const ty = h * fy;
      const c = Math.random();
      particles.push({
        tx, ty, fx, fy,
        x: tx + (Math.random() - 0.5) * 200,
        y: ty + (Math.random() - 0.5) * 200,
        s: Math.random() * 1.5 + 0.3,
        a: Math.random() * 0.3 + 0.05,
        sp: Math.random() * 0.003 + 0.001,
        an: Math.random() * Math.PI * 2,
        dr: Math.random() * 20 + 10,
        c: c < 0.6 ? "74,107,90" : c < 0.85 ? "122,172,181" : "201,160,89",
      });
    }

    let raf = 0;
    function animate() {
      ctx!.clearRect(0, 0, w, h);
      for (const p of particles) {
        p.an += p.sp;
        p.x = p.tx + Math.sin(p.an) * p.dr;
        p.y = p.ty + Math.cos(p.an * 0.7) * p.dr * 0.5;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.s, 0, Math.PI * 2);
        ctx!.fillStyle = "rgba(" + p.c + "," + p.a + ")";
        ctx!.fill();
      }
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < 100) {
            ctx!.beginPath();
            ctx!.moveTo(particles[i].x, particles[i].y);
            ctx!.lineTo(particles[j].x, particles[j].y);
            ctx!.strokeStyle = "rgba(74,107,90," + (0.03 * (1 - d / 100)) + ")";
            ctx!.lineWidth = 0.5;
            ctx!.stroke();
          }
        }
      }
      raf = requestAnimationFrame(animate);
    }
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return <canvas ref={canvasRef} />;
}

/* ---- Canvas: Layer Viz (Architecture section) ---- */

function LayerViz({ color }: { color: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const x = c.getContext("2d");
    if (!x) return;
    c.width = 400;
    c.height = 300;

    const pts: Array<{ x: number; y: number; vx: number; vy: number; r: number }> = [];
    for (let i = 0; i < 40; i++) {
      pts.push({
        x: Math.random() * 400,
        y: Math.random() * 300,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        r: Math.random() * 2 + 0.5,
      });
    }

    let raf = 0;
    function draw() {
      x!.clearRect(0, 0, 400, 300);
      for (const p of pts) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > 400) p.vx *= -1;
        if (p.y < 0 || p.y > 300) p.vy *= -1;
        x!.beginPath();
        x!.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        x!.fillStyle = color + "0.25)";
        x!.fill();
      }
      for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
          const dd = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
          if (dd < 80) {
            x!.beginPath();
            x!.moveTo(pts[i].x, pts[i].y);
            x!.lineTo(pts[j].x, pts[j].y);
            x!.strokeStyle = color + (0.1 * (1 - dd / 80)).toFixed(2) + ")";
            x!.lineWidth = 0.5;
            x!.stroke();
          }
        }
      }
      raf = requestAnimationFrame(draw);
    }
    raf = requestAnimationFrame(draw);

    return () => cancelAnimationFrame(raf);
  }, [color]);

  return <canvas ref={canvasRef} width={400} height={300} />;
}

/* ---- Custom Cursor ---- */

function CustomCursor() {
  const curRef = useRef<HTMLDivElement>(null);
  const dotRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const cur = curRef.current;
    const dot = dotRef.current;
    if (!cur || !dot) return;

    let mx = 0, my = 0, cx = 0, cy = 0;
    let raf = 0;

    function onMove(e: MouseEvent) {
      mx = e.clientX;
      my = e.clientY;
      dot!.style.left = mx + "px";
      dot!.style.top = my + "px";
    }
    document.addEventListener("mousemove", onMove);

    function ac() {
      cx += (mx - cx) * 0.15;
      cy += (my - cy) * 0.15;
      cur!.style.left = cx + "px";
      cur!.style.top = cy + "px";
      raf = requestAnimationFrame(ac);
    }
    raf = requestAnimationFrame(ac);

    const interactives = document.querySelectorAll("a, button, .mk5-layer-tag, .mk5-int-item, .mk5-stat-item");
    const enter = () => cur!.classList.add("active");
    const leave = () => cur!.classList.remove("active");
    interactives.forEach((el) => {
      el.addEventListener("mouseenter", enter);
      el.addEventListener("mouseleave", leave);
    });

    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove);
      interactives.forEach((el) => {
        el.removeEventListener("mouseenter", enter);
        el.removeEventListener("mouseleave", leave);
      });
    };
  }, []);

  return (
    <>
      <div ref={curRef} className="mk5-cur" />
      <div ref={dotRef} className="mk5-cur-dot" />
    </>
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
    { icon: "\u25C6", name: "SAP S/4HANA", type: "ERP" },
    { icon: "\u25C6", name: "SAP Business One", type: "ERP" },
    { icon: "\u25C7", name: "Dynamics 365", type: "ERP + CRM" },
    { icon: "\u25C6", name: "Sage 300", type: "ERP" },
    { icon: "\u25C6", name: "SYSPRO", type: "ERP" },
    { icon: "\u25C7", name: "Odoo 18", type: "ERP" },
    { icon: "\u25C6", name: "Oracle Fusion", type: "ERP" },
    { icon: "\u25C6", name: "NetSuite", type: "ERP" },
    { icon: "\u25C6", name: "QuickBooks", type: "Accounting" },
    { icon: "\u25CB", name: "SuccessFactors", type: "HCM" },
    { icon: "\u25CB", name: "Salesforce", type: "CRM" },
    { icon: "\u25CB", name: "Xero", type: "Accounting" },
    { icon: "\u25CB", name: "Workday", type: "HCM" },
    { icon: "\u2750", name: "REST APIs", type: "Custom" },
    { icon: "\u2750", name: "Webhooks", type: "Custom" },
  ];

  const coverageDomains = [
    { icon: "\u25C6", name: "Finance & Controlling", desc: "AP, AR, reconciliation, cash flow, budget vs actual, cost allocation, and inventory valuation.", catalysts: "Finance \u00B7 Finance Ops \u00B7 Treasury \u00B7 Tax \u00B7 Audit \u00B7 GL Close" },
    { icon: "\u25C7", name: "Supply Chain & Operations", desc: "Procurement, supplier risk, inventory optimisation, 3-way matching, and production scheduling.", catalysts: "Procurement \u00B7 Supplier \u00B7 Inventory \u00B7 Production \u00B7 Logistics" },
    { icon: "\u25C6", name: "Commercial & Revenue", desc: "Pipeline hygiene, quote-to-cash, pricing intelligence, trade promotion, and revenue ops.", catalysts: "Sales \u00B7 Pricing \u00B7 Trade Promotion \u00B7 CDP \u00B7 Customer Success" },
    { icon: "\u25C6", name: "People & Workforce", desc: "Recruitment funnel, engagement signals, payroll variance, and workforce planning.", catalysts: "HR \u00B7 Recruitment \u00B7 Engagement \u00B7 Payroll \u00B7 Workforce Planning" },
    { icon: "\u25C7", name: "Governance, Risk & Compliance", desc: "Audit trails, tax compliance, regulatory reporting, policy monitoring, and DSAR handling.", catalysts: "Audit \u00B7 Tax \u00B7 Compliance \u00B7 ESG \u00B7 Risk" },
    { icon: "\u25C6", name: "Data Quality & MDM", desc: "Master data hygiene, duplicate detection, entity resolution, and reference data governance.", catalysts: "DQ/MDM \u00B7 Reference Data \u00B7 Entity Resolution" },
    { icon: "\u25C7", name: "Lean / Continuous Improvement", desc: "Process mining, bottleneck detection, cycle-time reduction, and waste elimination.", catalysts: "Lean/CI \u00B7 Process Mining \u00B7 Cycle Time" },
    { icon: "\u25C6", name: "Sustainability & ESG", desc: "Scope 1/2/3 tracking, energy and water intensity, and sustainability disclosures.", catalysts: "ESG \u00B7 Energy \u00B7 Emissions \u00B7 Disclosures" },
    { icon: "\u25CB", name: "IT, Platform & Security", desc: "Connectivity health, integration monitoring, and security posture across the estate.", catalysts: "Integration Health \u00B7 Security Posture \u00B7 Platform Health" },
  ];

  return (
    <div ref={mainRef} className="mk5-body">
      <div className="mk5-grain" />
      <CustomCursor />

      {/* NAV */}
      <nav className="mk5-nav">
        <a href="/" className="mk5-nav-logo" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
          <AtheonLogo size={28} />
          Atheon
        </a>
        <div className="mk5-nav-links">
          <a href="#layers">Architecture</a>
          <a href="#coverage">Coverage</a>
          <a href="#features">Features</a>
          <a href="#security">Security</a>
          <a href="#compare">Compare</a>
          <a href="#ethos">Ethos</a>
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
        <a href="#coverage" onClick={() => setMobileMenuOpen(false)}>Coverage</a>
        <a href="#features" onClick={() => setMobileMenuOpen(false)}>Features</a>
        <a href="#security" onClick={() => setMobileMenuOpen(false)}>Security</a>
        <a href="#compare" onClick={() => setMobileMenuOpen(false)}>Compare</a>
        <a href="#ethos" onClick={() => setMobileMenuOpen(false)}>Ethos</a>
        <a href="/login" className="mk5-nav-cta" onClick={() => setMobileMenuOpen(false)}>
          <span>Login</span>
        </a>
        <a href="#cta-s" className="mk5-nav-cta" onClick={(e) => { e.preventDefault(); setMobileMenuOpen(false); document.getElementById("cta-s")?.scrollIntoView({ behavior: "smooth" }); }}>
          <span>Early Access</span>
        </a>
      </div>

      {/* HERO */}
      <section className="mk5-hero">
        <HeroCanvas />
        <div className="mk5-hero-content">
          <div className="mk5-hero-left">
            <div className="mk5-hero-eyebrow">Introducing the Catalyst</div>
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
              intelligence. One living truth.
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
        </div>
        <div className="mk5-hero-scroll">
          <div className="mk5-scroll-line" />
          <span>Scroll</span>
        </div>
      </section>

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
          <div className="mk5-evo-arrow">&rarr;</div>
        </div>
        <div className="mk5-evo-item present mk5-reveal mk5-rd1">
          <div className="mk5-evo-era present">Today</div>
          <div className="mk5-evo-name">Copilot</div>
          <div className="mk5-evo-desc">
            Assists one person at a time. Answers questions from a knowledge base. Cannot
            correlate across departments or govern autonomous processes.
          </div>
          <div className="mk5-evo-arrow">&rarr;</div>
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
            <LayerViz color="rgba(201,160,89," />
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
            <LayerViz color="rgba(122,172,181," />
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
            <LayerViz color="rgba(74,107,90," />
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
          <div className="mk5-stat-num">75<span className="accent">+</span></div>
          <div className="mk5-stat-label">Catalyst Clusters</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd1">
          <div className="mk5-stat-num">445<span className="accent">+</span></div>
          <div className="mk5-stat-label">Sub-Catalysts</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd2">
          <div className="mk5-stat-num">50<span className="accent">+</span></div>
          <div className="mk5-stat-label">Real Handlers Shipping</div>
        </div>
        <div className="mk5-stat-item mk5-reveal mk5-rd3">
          <div className="mk5-stat-num"><span className="accent">3</span></div>
          <div className="mk5-stat-label">Intelligence Layers</div>
        </div>
      </div>

      {/* COMPARISON */}
      <section className="mk5-comp" id="compare">
        <div className="mk5-comp-header">
          <h2 className="mk5-reveal">Agents and copilots<br />were chapter one.</h2>
          <p className="mk5-reveal">
            Every competitor built agents or copilots. None evolved beyond. Atheon is the
            world&rsquo;s first Catalyst&nbsp;&mdash; the only platform with all three layers of enterprise intelligence.
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

          <div className="mk5-cc rl">Agent Governance</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cp">Partial</div>
          <div className="mk5-cc cn">&mdash;</div>
          <div className="mk5-cc ca">Full</div>

          <div className="mk5-cc rl">Multi-ERP Integration</div>
          <div className="mk5-cc cp">M365</div>
          <div className="mk5-cc cp">SFDC</div>
          <div className="mk5-cc cp">Custom</div>
          <div className="mk5-cc ca">SAP · Oracle · MS · NetSuite · Odoo · Xero · Workday +</div>

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
              <div className="mk5-ind-stat-num">75</div>
              <div className="mk5-ind-stat-label">Catalyst clusters in the<br />shared catalog</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num">445</div>
              <div className="mk5-ind-stat-label">Sub-catalysts, each with<br />its own schedule and tier</div>
            </div>
            <div className="mk5-ind-stat-row">
              <div className="mk5-ind-stat-num">3</div>
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
            <div className="mk5-feat-item-label">Governance & Trust</div>
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
            <div className="mk5-feat-item-label">Knowledge & Memory</div>
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
          <div style={{ marginTop: '0.5rem', fontSize: '0.85em', opacity: 0.8 }}>
            <a href="/status" style={{ color: 'inherit', textDecoration: 'underline' }}>Status</a>
            {' · '}
            <a href="/legal/security" style={{ color: 'inherit', textDecoration: 'underline' }}>Security &amp; Privacy</a>
            {' · '}
            <a href="/legal/connectors" style={{ color: 'inherit', textDecoration: 'underline' }}>Connectors</a>
            {' · '}
            <a href="/pricing" style={{ color: 'inherit', textDecoration: 'underline' }}>Pricing</a>
            {' · '}
            <a href="/login" style={{ color: 'inherit', textDecoration: 'underline' }}>Sign in</a>
          </div>
        </div>
        <div className="mk5-fr">&copy; 2026 Atheon. All rights reserved.</div>
      </footer>
    </div>
  );
}
