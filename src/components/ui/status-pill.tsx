/**
 * `<StatusPill>` — canonical status / severity / verdict pill.
 *
 * Replaces the ad-hoc `<Badge variant="…">` calls and bespoke
 * `bg-red-500/10 text-red-400 px-2 py-0.5 rounded` spans scattered across
 * the platform. Born out of WORLD_CLASS_FRONTEND_PROPOSAL Phase 1 to make
 * status communication legible to corporate clients in three ways at once:
 *
 *   1. Colour (semantic — green/amber/red/blue/grey only — no purple-for-fun)
 *   2. Text (the label — "Critical", "Verified", "Pending")
 *   3. Glyph (a leading ◆ / ▲ / ● / ⏵ / ✓ / ✕ — accessibility-grade)
 *
 * Three rendering modes via the `density` prop:
 *   - solid    — filled background; the dominant signal on a row (default)
 *   - outline  — bordered, transparent fill; secondary state
 *   - dot      — leading dot only; for table cells where space is tight
 *
 * The full vocabulary is below in STATUS_DEF. Adding a new status?
 * Update STATUS_DEF — never define a one-off pill inline. The whole point
 * is a fixed grammar.
 */
import type { ReactNode } from 'react';

export type StatusKind =
  // Severity (operational + risk register)
  | 'critical' | 'high' | 'medium' | 'low' | 'info'
  // Health (KPI traffic light)
  | 'green' | 'amber' | 'red'
  // Action / item review
  | 'pending' | 'in_progress' | 'completed' | 'failed' | 'verified' | 'approved' | 'rejected' | 'deferred'
  // Catalyst run item
  | 'matched' | 'discrepancy' | 'unmatched_source' | 'unmatched_target' | 'exception'
  // Tenant / connection lifecycle
  | 'active' | 'provisioning' | 'suspended' | 'deleted' | 'connected' | 'disconnected';

interface StatusVisual {
  label: string;
  tone: 'critical' | 'warning' | 'success' | 'info' | 'neutral';
  glyph: string;
}

/**
 * The platform's complete status vocabulary. Adding a status here is a
 * design decision — it lives forever. Don't add `pending_review_v2`.
 */
const STATUS_DEF: Record<StatusKind, StatusVisual> = {
  // ── Severity ────────────────────────────────────────────────
  critical: { label: 'Critical', tone: 'critical', glyph: '◆' },
  high:     { label: 'High',     tone: 'critical', glyph: '▲' },
  medium:   { label: 'Medium',   tone: 'warning',  glyph: '◆' },
  low:      { label: 'Low',      tone: 'success',  glyph: '●' },
  info:     { label: 'Info',     tone: 'info',     glyph: '●' },

  // ── KPI traffic light ───────────────────────────────────────
  red:    { label: 'Red',    tone: 'critical', glyph: '●' },
  amber:  { label: 'Amber',  tone: 'warning',  glyph: '●' },
  green:  { label: 'Green',  tone: 'success',  glyph: '●' },

  // ── Action / item review ────────────────────────────────────
  pending:      { label: 'Pending',     tone: 'info',     glyph: '⏵' },
  in_progress:  { label: 'In progress', tone: 'info',     glyph: '⏵' },
  completed:    { label: 'Completed',   tone: 'success',  glyph: '✓' },
  failed:       { label: 'Failed',      tone: 'critical', glyph: '✕' },
  verified:     { label: 'Verified',    tone: 'success',  glyph: '✓' },
  approved:     { label: 'Approved',    tone: 'success',  glyph: '✓' },
  rejected:     { label: 'Rejected',    tone: 'critical', glyph: '✕' },
  deferred:     { label: 'Deferred',    tone: 'warning',  glyph: '⏸' },

  // ── Run item status ─────────────────────────────────────────
  matched:           { label: 'Matched',           tone: 'success',  glyph: '✓' },
  discrepancy:       { label: 'Discrepancy',       tone: 'warning',  glyph: '◆' },
  unmatched_source:  { label: 'Unmatched (Source)', tone: 'neutral', glyph: '○' },
  unmatched_target:  { label: 'Unmatched (Target)', tone: 'neutral', glyph: '○' },
  exception:         { label: 'Exception',         tone: 'critical', glyph: '◆' },

  // ── Lifecycle ───────────────────────────────────────────────
  active:        { label: 'Active',        tone: 'success',  glyph: '●' },
  provisioning:  { label: 'Provisioning',  tone: 'info',     glyph: '⏵' },
  suspended:     { label: 'Suspended',     tone: 'warning',  glyph: '⏸' },
  deleted:       { label: 'Deleted',       tone: 'critical', glyph: '✕' },
  connected:     { label: 'Connected',     tone: 'success',  glyph: '●' },
  disconnected:  { label: 'Disconnected',  tone: 'neutral',  glyph: '○' },
};

/** Tone → Tailwind class set. Three tokens per tone: bg, text, border.
 *  Maps onto `.pill-*` utilities defined in index.css §POLISH-2026. */
const TONE_CLASS: Record<StatusVisual['tone'], { solid: string; outline: string; dot: string }> = {
  success:  {
    solid:   'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
    outline: 'bg-transparent text-emerald-700 border-emerald-500/40 dark:text-emerald-300',
    dot:     'text-emerald-500',
  },
  warning:  {
    solid:   'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
    outline: 'bg-transparent text-amber-700 border-amber-500/40 dark:text-amber-300',
    dot:     'text-amber-500',
  },
  critical: {
    solid:   'bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-300',
    outline: 'bg-transparent text-red-700 border-red-500/40 dark:text-red-300',
    dot:     'text-red-500',
  },
  info:     {
    solid:   'bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-300',
    outline: 'bg-transparent text-blue-700 border-blue-500/40 dark:text-blue-300',
    dot:     'text-blue-500',
  },
  neutral:  {
    solid:   'bg-[var(--bg-secondary)] t-muted border-[var(--border-subtle)]',
    outline: 'bg-transparent t-muted border-[var(--border-subtle)]',
    dot:     't-muted',
  },
};

const SIZE_CLASS = {
  sm: 'text-caption px-1.5 py-0 leading-5',
  md: 'text-caption px-2 py-0.5 leading-5',
  lg: 'text-body-sm px-2.5 py-0.5 leading-6',
} as const;

export interface StatusPillProps {
  status: StatusKind | string;
  /** Override the default label from STATUS_DEF. Useful for context like "5 critical". */
  label?: ReactNode;
  density?: 'solid' | 'outline' | 'dot';
  size?: keyof typeof SIZE_CLASS;
  /** Suppress the leading glyph (just text + colour). */
  noGlyph?: boolean;
  className?: string;
}

export function StatusPill({
  status, label, density = 'solid', size = 'md', noGlyph = false, className = '',
}: StatusPillProps): JSX.Element {
  // Unknown status → neutral pill with the raw string. Don't crash.
  const def: StatusVisual = STATUS_DEF[status as StatusKind] ?? {
    label: String(status), tone: 'neutral', glyph: '●',
  };
  const tone = TONE_CLASS[def.tone];

  if (density === 'dot') {
    return (
      <span
        className={`inline-flex items-center gap-1.5 ${SIZE_CLASS[size]} ${className}`}
        aria-label={`Status: ${def.label}`}
      >
        <span className={tone.dot} aria-hidden="true">●</span>
        <span className="t-secondary">{label ?? def.label}</span>
      </span>
    );
  }

  const base = density === 'solid' ? tone.solid : tone.outline;
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border font-medium ${SIZE_CLASS[size]} ${base} ${className}`}
      aria-label={`Status: ${def.label}`}
    >
      {!noGlyph && <span aria-hidden="true">{def.glyph}</span>}
      <span>{label ?? def.label}</span>
    </span>
  );
}
