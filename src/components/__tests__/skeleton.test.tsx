// TASK-026: Component test for Skeleton
import React from "react";
import { render, screen } from "@testing-library/react";
import { Skeleton, DashboardSkeleton, TableSkeleton } from "../ui/skeleton";

describe("Skeleton", () => {
  it("renders text variant by default", () => {
    render(<Skeleton />);
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("renders multiple lines", () => {
    render(<Skeleton lines={3} />);
    const status = screen.getByRole("status");
    expect(status.children.length).toBe(3);
  });

  it("renders circular variant", () => {
    render(<Skeleton variant="circular" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("rounded-full");
  });

  it("renders card variant", () => {
    render(<Skeleton variant="card" />);
    const el = screen.getByRole("status");
    expect(el.className).toContain("rounded-md");
  });
});

describe("DashboardSkeleton", () => {
  it("renders without crashing", () => {
    render(<DashboardSkeleton />);
    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBeGreaterThan(0);
  });
});

describe("TableSkeleton", () => {
  it("renders specified rows", () => {
    render(<TableSkeleton rows={3} columns={2} />);
    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBeGreaterThan(0);
  });
});
