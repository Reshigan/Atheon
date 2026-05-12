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
    fontFamily: "'Inter', sans-serif",
  },
  tooltip: {
    background: 'var(--chart-tooltip-bg)',
    border: 'var(--chart-tooltip-border)',
    borderRadius: 8,
    padding: 12,
  },
  axis: {
    stroke: 'var(--chart-grid)',
    tickStroke: 'var(--chart-grid)',
  },
} as const;

// Recharts-compatible color palette
export const chartPalette = [
  '#A3B18A', // sage
  '#CDA37E', // bronze
  '#7EB3CD', // sky
  '#10b981', // success
  '#f59e0b', // warning
  '#ef4444', // danger
  '#8b5cf6', // purple
  '#06b6d4', // cyan
];

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
