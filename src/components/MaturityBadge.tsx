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
    classes: 'text-accent border-[var(--border-card)]',
  },
  partial: {
    label: 'Partial',
    classes: 'text-[var(--warning)] border-[var(--border-card)]',
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
        'inline-flex items-center rounded-sm border font-medium px-2 py-0.5 text-caption',
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
