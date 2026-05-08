/**
 * Confidence tier classification — UX audit §5.8 + system principle 3.2.
 *
 * Pure helper, kept separate from the React component so callers can
 * reason about tiers without importing JSX (e.g. backend response
 * shaping in a future PR, copy generation, telemetry).
 */

export type ConfidenceTier = 'high' | 'medium' | 'low';

export const TIER_THRESHOLDS = {
  // High requires both a meaningful sample AND a strong mode share.
  highMinSampleSize: 25,
  highMinConfidence: 0.70,
  // Medium relaxes confidence but keeps the sample-size floor — a
  // 95%-confident inference from n=3 should still be Low because we
  // don't know if it's real or noise.
  mediumMinSampleSize: 25,
  mediumMinConfidence: 0.50,
} as const;

/** Pick a confidence tier from a confidence value [0, 1] and an
 *  optional sample size. When the sample size is unknown, a stricter
 *  floor is applied (we can't tell if a strong signal is real or
 *  small-sample lucky). */
export function classifyConfidence(confidence: number, sampleSize?: number): ConfidenceTier {
  if (sampleSize === undefined) {
    if (confidence >= 0.85) return 'high';
    if (confidence >= 0.60) return 'medium';
    return 'low';
  }
  if (sampleSize >= TIER_THRESHOLDS.highMinSampleSize && confidence >= TIER_THRESHOLDS.highMinConfidence) {
    return 'high';
  }
  if (sampleSize >= TIER_THRESHOLDS.mediumMinSampleSize && confidence >= TIER_THRESHOLDS.mediumMinConfidence) {
    return 'medium';
  }
  return 'low';
}
