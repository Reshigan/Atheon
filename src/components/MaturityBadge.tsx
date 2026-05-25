import { cn } from "@/lib/utils";
import type { ImplementationSummary, Maturity } from "@/lib/api";

interface MaturityBadgeProps {
  maturity: Maturity;
  summary?: ImplementationSummary;
  className?: string;
}

// Tone tokens align with StatusPill's success/warning/neutral mapping so
// MaturityBadge reads the same as the rest of the platform's status pills.
const MATURITY_META: Record<Maturity, { label: string; classes: string }> = {
  production: {
    label: 'Production',
    classes: 'bg-emerald-500/15 text-emerald-700 border-emerald-500/30 dark:text-emerald-300',
  },
  partial: {
    label: 'Partial',
    classes: 'bg-amber-500/15 text-amber-700 border-amber-500/30 dark:text-amber-300',
  },
  planned: {
    label: 'Planned',
    classes: 'bg-[var(--bg-secondary)] t-muted border-[var(--border-subtle)]',
  },
};

/**
 * Tooltip text explaining what the maturity badge means, using the
 * implementation summary counts when available.
 */
// eslint-disable-next-line react-refresh/only-export-components
export function maturityTooltip(maturity: Maturity, summary?: ImplementationSummary): string {
  if (maturity === 'production') {
    if (summary) {
      return `${summary.real} of ${summary.total} sub-catalysts have real runtime logic.`;
    }
    return 'This cluster is production-ready: the majority of sub-catalysts have real runtime logic.';
  }
  if (maturity === 'partial') {
    if (summary) {
      const nonReal = summary.total - summary.real;
      const tail = nonReal > 0
        ? ` The other ${nonReal} return generic data.`
        : '';
      return `${summary.real} of ${summary.total} sub-catalysts have real runtime logic.${tail}`;
    }
    return 'Some sub-catalysts have real runtime logic; others return generic data.';
  }
  return 'This cluster is in the catalog for completeness but has no real runtime handlers yet.';
}

export function MaturityBadge({ maturity, summary, className }: MaturityBadgeProps) {
  const meta = MATURITY_META[maturity];
  const tooltip = maturityTooltip(maturity, summary);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium px-2 py-0.5 text-caption',
        meta.classes,
        className
      )}
      title={tooltip}
      aria-label={`${meta.label}: ${tooltip}`}
      data-maturity={maturity}
    >
      {meta.label}
    </span>
  );
}
