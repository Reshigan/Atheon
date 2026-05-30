import { cn } from "@/lib/utils";
import type { Implementation } from "@/lib/api";

interface ImplementationDotProps {
  implementation: Implementation;
  className?: string;
}

const DOT_META: Record<Implementation, { label: string; classes: string; description: string }> = {
  real: {
    label: 'Real',
    description: 'Real runtime logic: this sub-catalyst is backed by a dedicated domain handler.',
    classes: 'bg-accent',
  },
  generic: {
    label: 'Generic',
    description: 'Generic output: this sub-catalyst falls through to the default dispatcher.',
    classes: 'bg-[var(--warning)]',
  },
  stub: {
    label: 'Stub',
    description: 'Stub: named in the catalog but has no runtime handler yet.',
    classes: 'bg-[var(--info)]',
  },
};

/**
 * ImplementationDot
 *
 * Tiny 8px status dot showing the implementation tier of an individual
 * sub-catalyst:
 *
 *   - green  -> `real`    (dedicated domain handler)
 *   - amber  -> `generic` (default dispatcher fallthrough)
 *   - gray   -> `stub`    (named-only / no handler)
 *
 * Includes `title` + `aria-label` so it is accessible on hover and to
 * screen readers.
 */
export function ImplementationDot({ implementation, className }: ImplementationDotProps) {
  const meta = DOT_META[implementation];
  return (
    <span
      role="img"
      aria-label={`${meta.label}: ${meta.description}`}
      title={meta.description}
      data-implementation={implementation}
      className={cn(
        'inline-block w-2 h-2 rounded-full flex-shrink-0',
        meta.classes,
        className
      )}
    />
  );
}
