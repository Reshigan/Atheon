// Phase 1 (UI-v3 Swiss): pins the PageHeader masthead contract.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { PageHeader } from '../page-header';

describe('<PageHeader>', () => {
  it('renders eyebrow and title', () => {
    render(<PageHeader eyebrow="Pulse" title="Operational Health" />);
    expect(screen.getByText('Pulse')).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Operational Health' })).toBeTruthy();
  });

  it('renders the dek when provided', () => {
    render(<PageHeader eyebrow="Apex" title="Executive" dek="Board-grade signal." />);
    expect(screen.getByText('Board-grade signal.')).toBeTruthy();
  });

  it('shows the live tick only when live is set', () => {
    const { container, rerender } = render(<PageHeader eyebrow="X" title="Y" />);
    expect(container.querySelector('.animate-pulse')).toBeNull();
    rerender(<PageHeader eyebrow="X" title="Y" live />);
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders a bottom rule', () => {
    const { container } = render(<PageHeader eyebrow="X" title="Y" />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain('border-b');
  });
});
