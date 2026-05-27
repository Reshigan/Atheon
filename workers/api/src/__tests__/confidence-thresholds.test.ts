/**
 * Roadmap B3 — per-tenant confidence threshold tuning.
 *
 * Pure-function tests for the validator + resolver. We don't exercise
 * the D1 path here (no worker harness in this test); those are covered
 * indirectly by the route module integration test once it exists.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_THRESHOLDS,
  validateThresholds,
  type ConfidenceThresholds,
} from '../services/confidence-thresholds';

function clone(overrides: Partial<ConfidenceThresholds> = {}): ConfidenceThresholds {
  return { ...DEFAULT_THRESHOLDS, ...overrides };
}

describe('confidence-thresholds.validateThresholds', () => {
  it('accepts the platform defaults', () => {
    expect(validateThresholds(clone())).toBeNull();
  });

  it('rejects auto_approve_min out of range', () => {
    expect(validateThresholds(clone({ autoApproveMin: 0 }))).toMatch(/auto_approve_min/);
    expect(validateThresholds(clone({ autoApproveMin: 1.5 }))).toMatch(/auto_approve_min/);
  });

  it('rejects when require_human_below is not lower than auto_approve_min', () => {
    expect(validateThresholds(clone({ autoApproveMin: 0.8, requireHumanBelow: 0.85 }))).toMatch(/require_human_below/);
    expect(validateThresholds(clone({ autoApproveMin: 0.8, requireHumanBelow: 0.8 }))).toMatch(/require_human_below/);
  });

  it('rejects when hard_reject_below is not lower than require_human_below', () => {
    expect(validateThresholds(clone({ hardRejectBelow: 0.7, requireHumanBelow: 0.7 }))).toMatch(/hard_reject_below/);
    expect(validateThresholds(clone({ hardRejectBelow: 0.85 }))).toMatch(/hard_reject_below/);
  });

  it('rejects non-integer or non-positive sample size', () => {
    expect(validateThresholds(clone({ minSampleSize: 0 }))).toMatch(/min_sample_size/);
    expect(validateThresholds(clone({ minSampleSize: 2.5 }))).toMatch(/min_sample_size/);
    expect(validateThresholds(clone({ minSampleSize: -5 }))).toMatch(/min_sample_size/);
  });

  it('rejects mode share outside (0, 1]', () => {
    expect(validateThresholds(clone({ minModeShare: 0 }))).toMatch(/min_mode_share/);
    expect(validateThresholds(clone({ minModeShare: 1.1 }))).toMatch(/min_mode_share/);
    expect(validateThresholds(clone({ minModeShare: 1 }))).toBeNull();
  });

  it('matches the inference rule defaults (sample >=25, mode share >=70%)', () => {
    expect(DEFAULT_THRESHOLDS.minSampleSize).toBeGreaterThanOrEqual(25);
    expect(DEFAULT_THRESHOLDS.minModeShare).toBeGreaterThanOrEqual(0.7);
  });
});
