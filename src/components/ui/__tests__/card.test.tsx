// Phase 1 (UI-v3 Swiss): pins the Card surface contract.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { Card } from '../card';

describe('<Card> Swiss surface', () => {
  it('default variant is the hairline Swiss surface (no shadow class)', () => {
    const { container } = render(<Card>body</Card>);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('card-swiss');
    // Swiss cards are flat — never the legacy raised/glass shadow surfaces.
    expect(el.className).not.toContain('shadow-');
  });

  it('panel variant is the borderless top-rule block', () => {
    const { container } = render(<Card variant="panel">body</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('card-panel');
  });

  it('accent variant uses the ledger-tinted surface', () => {
    const { container } = render(<Card variant="accent">body</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('card-accent');
  });

  it('applies the requested padding size', () => {
    const { container } = render(<Card size="compact">body</Card>);
    expect((container.firstChild as HTMLElement).className).toContain('p-3');
  });
});
