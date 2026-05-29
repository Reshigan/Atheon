/** @type {import('tailwindcss').Config} */
// Design tokens — Swiss Calm Authority. Source of truth is CSS variables in
// src/index.css. Never inline a hex that has a CSS-var equivalent.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: '2px',
        sm: '2px',
        md: '4px',
        lg: 'var(--radius)',
        xl: '6px',
        full: '9999px',
      },
      colors: {
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',

        // ── Swiss surfaces / rules (CSS-var references) ────────
        paper:           'var(--bg-primary)',
        ink:             'var(--text-primary)',
        line:            'var(--border-card)',
        'line-strong':   'var(--line-strong)',

        // ── Foreground ─────────────────────────────────────────
        'text-primary':    'var(--text-primary)',
        'text-secondary':  'var(--text-secondary)',
        'text-muted':      'var(--text-muted)',

        // ── Border ─────────────────────────────────────────────
        'border-card':     'var(--border-card)',

        // ── Reserved negative ──────────────────────────────────
        neg: 'rgb(var(--neg-rgb) / <alpha-value>)',

        // ── Restrained chart/data neutrals ─────────────────────
        info:   'var(--info)',
        bronze: 'var(--bronze)',

        // ── Semantic — status only (accent doubles as success) ──
        success: 'rgb(var(--accent-rgb) / <alpha-value>)',
        warning: '#9a6b1f',
        danger:  'rgb(var(--neg-rgb) / <alpha-value>)',
      },
      fontFamily: {
        sans:        ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
        body:        ['Archivo', 'system-ui', '-apple-system', 'sans-serif'],
        display:     ['Archivo Expanded', 'Archivo', 'system-ui', 'sans-serif'],
        headline:    ['Archivo', 'system-ui', 'sans-serif'],
        mono:        ['IBM Plex Mono', 'ui-monospace', 'monospace'],
        'mono-data': ['IBM Plex Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Swiss grotesk scale — heavy display, restrained body.
        'hero':        ['72px', { lineHeight: '0.92', letterSpacing: '-0.03em', fontWeight: '900' }],
        'display':     ['40px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '900' }],
        'figure-lg':   ['46px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '800' }],
        'figure':      ['34px', { lineHeight: '1.0',  letterSpacing: '-0.02em', fontWeight: '800' }],
        'headline-xl': ['25px', { lineHeight: '1.12', letterSpacing: '-0.015em', fontWeight: '700' }],
        'headline-lg': ['20px', { lineHeight: '1.3',  letterSpacing: '-0.01em', fontWeight: '700' }],
        'headline-md': ['18px', { lineHeight: '1.4',  fontWeight: '600' }],
        'body-base':   ['13.5px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm':     ['12px', { lineHeight: '1.5',  fontWeight: '400' }],
        'mono-data':   ['13px', { lineHeight: '1.4',  fontWeight: '500' }],
        'eyebrow':     ['9.5px', { lineHeight: '1',   letterSpacing: '0.2em', fontWeight: '600' }],
        'caption':     ['11px', { lineHeight: '1',    letterSpacing: '0.05em', fontWeight: '500' }],
      },
      spacing: {
        unit:               '4px',
        xs:                 '4px',
        sm:                 '8px',
        md:                 '16px',
        lg:                 '24px',
        xl:                 '32px',
        gutter:             '24px',
        'margin-page':      '32px',
        'header-height':    '48px',
        'sidebar-collapsed':'56px',
        'sidebar-expanded': '240px',
      },
    }
  },
  plugins: [import("tailwindcss-animate")],
}
