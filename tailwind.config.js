/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)'
      },
      colors: {
        atheon: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          300: '#a5b4fc',
          400: '#818cf8',
          500: '#6366f1',
          600: '#4f46e5',
          700: '#4338ca',
          800: '#3730a3',
          900: '#312e81',
          950: '#1e1b4b',
        },
        apex: { DEFAULT: '#f59e0b', light: '#fbbf24', dark: '#d97706' },
        pulse: { DEFAULT: '#10b981', light: '#34d399', dark: '#059669' },
        catalyst: { DEFAULT: '#3b82f6', light: '#60a5fa', dark: '#2563eb' },
        mind: { DEFAULT: '#8b5cf6', light: '#a78bfa', dark: '#7c3aed' },
        memory: { DEFAULT: '#ec4899', light: '#f472b6', dark: '#db2777' },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
    }
  },
  plugins: [import("tailwindcss-animate")],
}
