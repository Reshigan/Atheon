/** @type {import('tailwindcss').Config} */
// Design tokens mirror the Stitch "Athens Executive Interface" project
// (projects/4059809207181456952). Anything added here must keep one source of
// truth — never inline a hex that exists below.
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

        // ── Surface system (Stitch palette) ─────────────────────
        'bg-primary':        '#06090D',
        'bg-secondary':      '#0E151C',
        'background':        '#101418',
        'surface':           '#101418',
        'surface-dim':       '#101418',
        'surface-bright':    '#36393e',
        'surface-container-lowest': '#0b0e13',
        'surface-container-low':    '#181c20',
        'surface-container':        '#1c2024',
        'surface-container-high':   '#272a2f',
        'surface-container-highest':'#32353a',
        'surface-variant':   '#32353a',
        'card-surface':      '#1A1F26',
        'border-card':       'rgba(255, 255, 255, 0.10)',
        'outline':           '#909287',
        'outline-variant':   '#45483f',

        // ── Foreground ─────────────────────────────────────────
        'text-primary':      '#F8F9F3',
        'text-muted':        'rgba(248, 249, 243, 0.5)',
        'on-surface':        '#e0e2e8',
        'on-surface-variant':'#c6c8bb',

        // ── Tri-accent (sage / sky / bronze) ───────────────────
        'accent-sage':       '#A3B18A',
        'accent-sky':        '#7EB3CD',
        'accent-bronze':     '#CDA37E',

        // ── Semantic ───────────────────────────────────────────
        'success-emerald':   '#34D399',
        'warning-amber':     '#FBBF24',
        'danger-red':        '#F87171',
        'tenant-orange':     '#F97316',

        // ── Legacy product accents kept for backwards-compat ───
        atheon: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc',
          400: '#818cf8', 500: '#6366f1', 600: '#4f46e5', 700: '#4338ca',
          800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
        apex:     { DEFAULT: '#CDA37E', light: '#e0bb9c', dark: '#a47e5c' },
        pulse:    { DEFAULT: '#7EB3CD', light: '#9fc7da', dark: '#5d92ad' },
        catalyst: { DEFAULT: '#A3B18A', light: '#bccaa5', dark: '#7e8d6a' },
        mind:     { DEFAULT: '#8b5cf6', light: '#a78bfa', dark: '#7c3aed' },
        memory:   { DEFAULT: '#ec4899', light: '#f472b6', dark: '#db2777' },
      },
      fontFamily: {
        sans:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        body:        ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        headline:    ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono:        ['JetBrains Mono', 'ui-monospace', 'monospace'],
        'mono-data': ['JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      fontSize: {
        // Stitch typography scale — Bloomberg-grade hierarchy
        'headline-xl': ['28px', { lineHeight: '1.2', letterSpacing: '-0.02em', fontWeight: '600' }],
        'headline-lg': ['22px', { lineHeight: '1.3', fontWeight: '600' }],
        'headline-md': ['18px', { lineHeight: '1.4', fontWeight: '600' }],
        'body-base':   ['14px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-sm':     ['13px', { lineHeight: '1.5', fontWeight: '400' }],
        'mono-data':   ['13px', { lineHeight: '1.4', fontWeight: '450' }],
        'mono-label':  ['10px', { lineHeight: '1',   fontWeight: '500' }],
        'caption':     ['11px', { lineHeight: '1',   letterSpacing: '0.05em', fontWeight: '500' }],
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

