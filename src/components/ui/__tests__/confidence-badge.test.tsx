/**
 * ConfidenceBadge — UX audit §5.8 primitive.
 *
 * Locks the threshold contract:
 *   - High requires n ≥ 25 AND confidence ≥ 0.70
 *   - Medium requires n ≥ 25 AND confidence ≥ 0.50
 *   - Low for anything else (insufficient sample OR weak confidence)
 *   - When sampleSize is undefined, threshold is stricter
 *   - Tooltip surfaces the tier guidance + numbers
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConfidenceBadge } from "../confidence-badge";
import { classifyConfidence } from "@/lib/confidence";

describe("classifyConfidence — threshold contract", () => {
  it("returns high when n >= 25 AND confidence >= 0.70", () => {
    expect(classifyConfidence(0.70, 25)).toBe('high');
    expect(classifyConfidence(0.92, 100)).toBe('high');
  });

  it("returns medium when n >= 25 AND 0.50 <= confidence < 0.70", () => {
    expect(classifyConfidence(0.50, 25)).toBe('medium');
    expect(classifyConfidence(0.69, 50)).toBe('medium');
  });

  it("returns low when sample size is too small even at high confidence", () => {
    expect(classifyConfidence(0.95, 9)).toBe('low');
    expect(classifyConfidence(0.85, 24)).toBe('low');
  });

  it("returns low when confidence is below the medium floor", () => {
    expect(classifyConfidence(0.49, 100)).toBe('low');
    expect(classifyConfidence(0.10, 50)).toBe('low');
  });

  it("applies a stricter floor when sample size is unknown", () => {
    // Without n, we don't know if a 0.75 signal is statistically real
    // (could be n=3) — so the high floor rises from 0.70 to 0.85.
    expect(classifyConfidence(0.75)).toBe('medium');
    expect(classifyConfidence(0.85)).toBe('high');
    expect(classifyConfidence(0.55)).toBe('low');
  });
});

describe("ConfidenceBadge rendering", () => {
  it("renders the tier word and percentage by default", () => {
    render(<ConfidenceBadge confidence={0.92} sampleSize={48} />);
    expect(screen.getByText(/High · 92%/)).toBeInTheDocument();
  });

  it("compact mode hides the percentage from the visible label", () => {
    render(<ConfidenceBadge confidence={0.92} sampleSize={48} compact />);
    expect(screen.getByText('High')).toBeInTheDocument();
    expect(screen.queryByText(/92%/)).not.toBeInTheDocument();
  });

  /** Walk up from the visible badge text to the wrapping span that
   *  carries the `title` attribute. */
  function tooltipFor(textMatcher: RegExp): string {
    const node = screen.getByText(textMatcher);
    let cur: HTMLElement | null = node;
    while (cur && !cur.getAttribute('title')) cur = cur.parentElement;
    return cur?.getAttribute('title') ?? '';
  }

  it("includes the percentage and sample size in the tooltip", () => {
    render(<ConfidenceBadge confidence={0.55} sampleSize={31} label="Inferred" />);
    const title = tooltipFor(/Inferred Medium/);
    expect(title).toContain('Inferred:');
    expect(title).toContain('Medium confidence');
    expect(title).toContain('55%');
    expect(title).toContain('n=31');
  });

  it("low-confidence tooltip explicitly says do-not-auto-apply", () => {
    render(<ConfidenceBadge confidence={0.40} sampleSize={9} />);
    expect(tooltipFor(/Low/)).toMatch(/Do not silently apply/);
  });

  it("custom hint overrides the default tooltip guidance", () => {
    render(
      <ConfidenceBadge
        confidence={0.40}
        sampleSize={9}
        hint="Add more vendor records before relying on this mapping."
      />,
    );
    const title = tooltipFor(/Low/);
    expect(title).toContain('Add more vendor records');
    // Default low tooltip is replaced, not appended
    expect(title).not.toMatch(/Do not silently apply/);
  });
});
