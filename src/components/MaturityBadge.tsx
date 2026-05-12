import { cn } from "@/lib/utils";
import type { ImplementationSummary, Maturity } from "@/lib/api";

interface MaturityBadgeProps {
  maturity: Maturity;
  summary?: ImplementationSummary;
  className?: string;
}

const MATURITY_META: Record<Maturity, { label: string; classes: string }> = {
  production: {
    label: 'Production',
    classes: 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20',
  },
  partial: {
    label: 'Partial',
    classes: 'bg-amber-500/10 text-amber-500 border-amber-500/20',
  },
  planned: {
    label: 'Planned',
    classes: 'bg-gray-500/10 text-gray-400 border-gray-500/20',
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

/**
 * MaturityBadge
 *
 * Small pill-style badge indicating whether a catalyst cluster has real
 * runtime logic (`production`), partial coverage (`partial`), or is
 * named-only / stub (`planned`).
 *
 * Color tokens match the app's existing Badge palette:
 *   - production -> emerald (success)
 *   - partial    -> amber   (warning)
 *   - planned    -> gray    (muted)
 *
 * A `title` attribute is attached for native hover tooltip, and an
 * `aria-label` carries the same copy for accessibility.
 */
export function MaturityBadge({ maturity, summary, className }: MaturityBadgeProps) {
  const meta = MATURITY_META[maturity];
  const tooltip = maturityTooltip(maturity, summary);
  return (
    <span
      className={cn(
        'inline-flex items-center rounded-md border font-medium px-1.5 py-0.5 text-caption',
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
