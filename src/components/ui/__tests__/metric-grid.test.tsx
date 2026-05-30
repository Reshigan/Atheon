// Phase 1 (UI-v3 Swiss): pins the MetricGrid contract incl. two-tier delta colour.
import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MetricGrid } from '../metric-grid';

describe('<MetricGrid>', () => {
  it('renders a cell per entry with key and value', () => {
    render(
      <MetricGrid
        cells={[
          { k: 'Revenue', value: '42.1M' },
          { k: 'Cycle', value: '18d' },
        ]}
      />
    );
    expect(screen.getByText('Revenue')).toBeTruthy();
    expect(screen.getByText('42.1M')).toBeTruthy();
    expect(screen.getByText('Cycle')).toBeTruthy();
  });

  it('colours a negative delta with the reserved negative token', () => {
    const { container } = render(
      <MetricGrid cells={[{ k: 'Margin', value: '11%', delta: -2.4 }]} />
    );
    const deltaEl = screen.getByText(/2\.4/);
    expect(deltaEl.getAttribute('style')).toContain('--neg');
    // arrow points down for a negative delta
    expect(deltaEl.textContent).toContain('↓');
    expect(container).toBeTruthy();
  });

  it('colours a positive delta with the accent token', () => {
    render(<MetricGrid cells={[{ k: 'Savings', value: '8M', delta: 3.2 }]} />);
    const deltaEl = screen.getByText(/3\.2/);
    expect(deltaEl.getAttribute('style')).toContain('--accent');
    expect(deltaEl.textContent).toContain('↑');
  });

  it('tints the lead cell figure with the accent', () => {
    render(<MetricGrid cells={[{ k: 'Total', value: '99', lead: true }]} />);
    const figure = screen.getByText('99');
    expect(figure.getAttribute('style')).toContain('--accent');
  });
});
