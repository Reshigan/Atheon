// TASK-003 & TASK-013: Unified chart theme using CSS variables
// All charts must use these tokens instead of hardcoded colors

export const chartTheme = {
  colors: {
    primary: 'var(--chart-primary)',
    secondary: 'var(--chart-secondary)',
    tertiary: 'var(--chart-tertiary)',
    success: 'var(--chart-success)',
    warning: 'var(--chart-warning)',
    danger: 'var(--chart-danger)',
  },
  grid: {
    stroke: 'var(--chart-grid)',
    strokeWidth: 1,
  },
  text: {
    fill: 'var(--chart-text)',
    fontSize: 12,
    fontFamily: "'Archivo', system-ui, sans-serif",
  },
  tooltip: {
    background: 'var(--chart-tooltip-bg)',
    border: 'var(--chart-tooltip-border)',
    borderRadius: 2,
    padding: 12,
  },
  axis: {
    stroke: 'var(--chart-grid)',
    tickStroke: 'var(--chart-grid)',
  },
} as const;

// Recharts-compatible color palette. Named exports below cover the two
// extra brand-aligned shades the Dashboard needs alongside chartPalette.
export const chartPalette = [
  '#A3B18A', // sage     — chartPaletteNames.accent
  '#CDA37E', // bronze   — chartPaletteNames.bronze
  '#7EB3CD', // sky      — chartPaletteNames.sky
  '#10b981', // success
  '#f59e0b', // warning
  '#ef4444', // danger
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

// Named brand-aligned shades used outside the indexed palette (e.g. the
// Dashboard's secondary chart series). Keeping these here means Recharts
// strokes and inline pills draw from a single source of truth — when the
// brand palette changes, only this file needs to change.
export const chartAccentB = '#5d8a6f';   // deeper sage for stacked/secondary series
export const chartLight = '#b8d4c4';     // soft sage tint for muted secondary lines

// Recharts tooltip style using design tokens
export const tooltipStyle = {
  contentStyle: {
    backgroundColor: 'var(--bg-card-solid)',
    border: '1px solid var(--border-card)',
    borderRadius: 8,
    padding: '8px 12px',
    boxShadow: 'var(--shadow-dropdown)',
  },
  labelStyle: {
    color: 'var(--text-primary)',
    fontWeight: 600,
    marginBottom: 4,
  },
  itemStyle: {
    color: 'var(--text-secondary)',
    fontSize: 13,
  },
};
