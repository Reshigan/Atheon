/**
 * ProvenanceLink — UX audit §5.7 primitive.
 *
 * Locks the contract:
 *   - Renders the wrapped value as a clickable button (visible affordance)
 *   - Clicking opens a side panel with title + subtitle
 *   - Side panel lists every source row with optional link and tone badge
 *   - Detail prop renders below the source list
 *   - Empty state copy when neither sources nor detail are supplied
 *   - Escape key closes the panel
 *   - onOpen callback fires only on the open transition
 */
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ProvenanceLink } from "../provenance-link";

function renderWithRouter(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("ProvenanceLink", () => {
  it("renders the children inside a clickable button", () => {
    renderWithRouter(
      <ProvenanceLink title="Realised savings">
        $1.2M
      </ProvenanceLink>
    );
    const btn = screen.getByRole("button", { name: /1\.2M/ });
    expect(btn).toBeInTheDocument();
  });

  it("opens a side panel with the title and subtitle on click", () => {
    renderWithRouter(
      <ProvenanceLink
        title="Realised savings"
        subtitle="Aggregate of every billable_line_items row"
      >
        $1.2M
      </ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(screen.getByText("Realised savings")).toBeInTheDocument();
    expect(screen.getByText("Aggregate of every billable_line_items row")).toBeInTheDocument();
  });

  it("renders each source row with its label + value + optional link", () => {
    renderWithRouter(
      <ProvenanceLink
        title="Realised savings"
        sources={[
          { label: 'Currency', value: 'ZAR' },
          { label: 'Closed periods', value: 12 },
          { label: 'Per-line evidence', value: 'View audit log', linkTo: '/audit?layer=billing' },
        ]}
      >
        $1.2M
      </ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(screen.getByText('Currency')).toBeInTheDocument();
    expect(screen.getByText('ZAR')).toBeInTheDocument();
    expect(screen.getByText('Closed periods')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // The link icon is rendered for the third row
    const links = screen.getAllByTitle('Open detail page');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/audit?layer=billing');
  });

  it("shows empty-state copy when neither sources nor detail are provided", () => {
    renderWithRouter(
      <ProvenanceLink title="Empty figure">$0</ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /0/ }));
    expect(screen.getByText(/No provenance recorded/)).toBeInTheDocument();
  });

  it("renders rich detail content below the sources", () => {
    renderWithRouter(
      <ProvenanceLink
        title="Realised savings"
        sources={[{ label: 'Periods', value: 1 }]}
        detail={<div data-testid="rich-detail">Custom drill-down content</div>}
      >
        $1.2M
      </ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(screen.getByTestId("rich-detail")).toBeInTheDocument();
    expect(screen.getByText("Custom drill-down content")).toBeInTheDocument();
  });

  it("closes when the user presses Escape", () => {
    renderWithRouter(
      <ProvenanceLink title="Realised savings">$1.2M</ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(screen.getByText("Realised savings")).toBeInTheDocument();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByText("Realised savings")).not.toBeInTheDocument();
  });

  it("fires onOpen exactly once per open transition", () => {
    const onOpen = vi.fn();
    renderWithRouter(
      <ProvenanceLink title="Realised savings" onOpen={onOpen}>$1.2M</ProvenanceLink>
    );
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(onOpen).toHaveBeenCalledTimes(1);
    // Closing + reopening should re-fire
    fireEvent.keyDown(document, { key: 'Escape' });
    fireEvent.click(screen.getByRole("button", { name: /1\.2M/ }));
    expect(onOpen).toHaveBeenCalledTimes(2);
  });
});
