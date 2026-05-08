/**
 * ConfidenceBadge — visualises the strength of an inferred rule.
 *
 * Per UX audit §5.8 + system principle 3.2 ("inference must be strong"):
 * every inferred rule (3-way match tolerance, dunning days, fiscal
 * year start, partner mapping, payment terms, etc.) must ship with a
 * visible confidence tier. Low-confidence rows belong in a HITL queue,
 * never silent auto-apply.
 *
 * Tier rules (defaults match the project's stated bar):
 *
 *   High    — n ≥ 25 AND confidence ≥ 0.70
 *             "We have enough evidence to apply this rule confidently."
 *
 *   Medium  — n ≥ 25 AND confidence ≥ 0.50
 *             "Worth using but worth a glance from a human."
 *
 *   Low     — anything else (small sample OR weak signal)
 *             "Do not silently apply. Surface in a HITL queue."
 *
 * Usage:
 *
 *   <ConfidenceBadge confidence={0.92} sampleSize={48} />
 *   <ConfidenceBadge confidence={0.55} sampleSize={31} label="Inferred" />
 *   <ConfidenceBadge confidence={0.40} sampleSize={9} hint="Add more samples or confirm manually" />
 *
 * The component is read-only — clicking does nothing. For a clickable
 * provenance trail use `<ProvenanceLink>` from this same folder.
 */
import { Badge } from "@/components/ui/badge";
import { classifyConfidence, type ConfidenceTier } from "@/lib/confidence";

export interface ConfidenceBadgeProps {
  /** Confidence value in [0, 1]. */
  confidence: number;
  /** Sample size (n). When unknown, omit and the tier is computed
   *  from confidence alone (with a stricter floor since we can't see
   *  whether the signal is statistically meaningful). */
  sampleSize?: number;
  /** Optional prefix shown before the tier ("Inferred", "Auto-mapped", etc.). */
  label?: string;
  /** Optional override for the tooltip text. */
  hint?: string;
  /** Compact mode hides the percentage in the visible label and shows
   *  only the tier word. The percentage stays in the tooltip. */
  compact?: boolean;
}

const TIER_META: Record<ConfidenceTier, { variant: 'success' | 'warning' | 'danger'; word: string; tooltip: string }> = {
  high: {
    variant: 'success',
    word: 'High',
    tooltip:
      'Strong inference (n ≥ 25, confidence ≥ 70%). Safe to apply.',
  },
  medium: {
    variant: 'warning',
    word: 'Medium',
    tooltip:
      'Worth using but worth a glance from a human. Confirm before billing on it.',
  },
  low: {
    variant: 'danger',
    word: 'Low',
    tooltip:
      'Do not silently apply. Surface in a HITL queue or ask the customer to confirm.',
  },
};

export function ConfidenceBadge({
  confidence, sampleSize, label, hint, compact,
}: ConfidenceBadgeProps) {
  const tier = classifyConfidence(confidence, sampleSize);
  const meta = TIER_META[tier];
  const pct = `${Math.round(confidence * 100)}%`;
  const visibleLabel = compact
    ? meta.word
    : `${meta.word} · ${pct}`;
  const tooltipParts = [
    label ? `${label}:` : null,
    `${meta.word} confidence (${pct}${typeof sampleSize === 'number' ? `, n=${sampleSize}` : ''}).`,
    hint ?? meta.tooltip,
  ].filter(Boolean);
  // Badge component doesn't forward HTML attrs; wrap in a span so the
  // title tooltip surfaces on hover for sighted users + screen readers.
  return (
    <span title={tooltipParts.join(' ')} className="inline-flex">
      <Badge variant={meta.variant} size="sm">
        {label ? `${label} ` : null}{visibleLabel}
      </Badge>
    </span>
  );
}

export default ConfidenceBadge;
