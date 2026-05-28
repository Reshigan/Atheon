/** @type {import('tailwindcss').Config} */
// Design tokens — Quiet Capital system. Source of truth is CSS variables in
// src/index.css. Never inline a hex that has a CSS-var equivalent.
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        DEFAULT: '0.25rem',
        lg: 'var(--radius, 0.5rem)',
        md: 'calc(var(--radius, 0.5rem) - 2px)',
        sm: 'calc(var(--radius, 0.5rem) - 4px)',
        xl: '0.75rem',
        full: '9999px',
      },
      colors: {
        accent: 'rgb(var(--accent-rgb) / <alpha-value>)',

        // ── Tri-accent (sage / sky / bronze) ───────────────────
        'accent-sage':     '#A3B18A',
        'accent-sky':      '#7EB3CD',
        'accent-bronze':   '#CDA37E',

        // ── Foreground (CSS-var references) ────────────────────
        'text-primary':    'var(--text-primary)',
        'text-muted':      'var(--text-muted)',

        // ── Border ─────────────────────────────────────────────
        'border-card':     'var(--border-card)',

        // ── Semantic — status only ──────────────────────────────
        'success-emerald': '#7CFFB2',
        'warning-amber':   '#FFC857',
        'danger-red':      '#FF6B6B',
      },
      fontFamily: {
        sans:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        display:     ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        headline:    ['Hanken Grotesk', 'system-ui', 'sans-serif'],
        mono:        ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'mono-data': ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Refined Grotesque scale — light display weights
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
        // Kept aliases — widely used across pages (swept per area)
        'body':        ['14px', { lineHeight: '1.6',  fontWeight: '400' }],   // 159 uses; alias for body-base
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

