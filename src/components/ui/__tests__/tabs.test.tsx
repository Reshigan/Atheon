/**
 * Roadmap C3 — WCAG focused remediation.
 *
 * Pins the ARIA tab pattern on <Tabs>: role assignments, aria-selected,
 * aria-controls wiring, and the manual-activation keyboard model
 * (Arrow keys move focus, Enter/Space activates).
 */
import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tabs, TabPanel } from '../tabs';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'detail', label: 'Detail' },
  { id: 'history', label: 'History' },
];

describe('<Tabs> ARIA contract', () => {
  it('renders a tablist with the right role and label', () => {
    render(<Tabs tabs={TABS} activeTab="overview" onTabChange={() => {}} ariaLabel="Test sections" />);
    const list = screen.getByRole('tablist');
    expect(list).toHaveAttribute('aria-label', 'Test sections');
  });

  it('exposes role=tab and aria-selected on each tab', () => {
    render(<Tabs tabs={TABS} activeTab="detail" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'false');
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(tabs[2]).toHaveAttribute('aria-selected', 'false');
  });

  it('only the active tab is in the tab order; others are tabIndex=-1', () => {
    render(<Tabs tabs={TABS} activeTab="overview" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0]).toHaveAttribute('tabIndex', '0');
    expect(tabs[1]).toHaveAttribute('tabIndex', '-1');
    expect(tabs[2]).toHaveAttribute('tabIndex', '-1');
  });

  it('wires aria-controls to the matching panel id', () => {
    render(
      <>
        <Tabs tabs={TABS} activeTab="overview" onTabChange={() => {}} />
        <TabPanel id="overview" activeTab="overview">overview body</TabPanel>
      </>,
    );
    const tab = screen.getAllByRole('tab')[0];
    expect(tab).toHaveAttribute('aria-controls', 'overview-panel');
    expect(tab).toHaveAttribute('id', 'overview-tab');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'overview-panel');
    expect(panel).toHaveAttribute('aria-labelledby', 'overview-tab');
  });

  it('Arrow keys move focus without changing the active tab (manual activation)', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeTab="overview" onTabChange={onChange} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(tabs[1]);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Home and End jump to first and last tab', () => {
    render(<Tabs tabs={TABS} activeTab="detail" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    tabs[1].focus();
    fireEvent.keyDown(tabs[1], { key: 'End' });
    expect(document.activeElement).toBe(tabs[2]);
    fireEvent.keyDown(tabs[2], { key: 'Home' });
    expect(document.activeElement).toBe(tabs[0]);
  });

  it('Click invokes onTabChange with the tab id', () => {
    const onChange = vi.fn();
    render(<Tabs tabs={TABS} activeTab="overview" onTabChange={onChange} />);
    fireEvent.click(screen.getAllByRole('tab')[2]);
    expect(onChange).toHaveBeenCalledWith('history');
  });

  it('Arrow-Left wraps from first tab to last', () => {
    render(<Tabs tabs={TABS} activeTab="overview" onTabChange={() => {}} />);
    const tabs = screen.getAllByRole('tab');
    tabs[0].focus();
    fireEvent.keyDown(tabs[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(tabs[2]);
  });
});
