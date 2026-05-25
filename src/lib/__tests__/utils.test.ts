// TASK-026: Tests for utility functions
import { describe, it, expect } from "vitest";
import { formatDays } from "../utils";

// Test the chart-theme utility (already tested in chart-theme.test.ts)
// This file tests additional lib utilities

describe("utils", () => {
  it("window.localStorage mock works", () => {
    localStorage.setItem("test-key", "test-value");
    expect(localStorage.getItem("test-key")).toBe("test-value");
    localStorage.removeItem("test-key");
    expect(localStorage.getItem("test-key")).toBeNull();
  });

  it("crypto.randomUUID produces unique IDs", () => {
    const id1 = crypto.randomUUID();
    const id2 = crypto.randomUUID();
    expect(id1).toBeDefined();
    expect(id2).toBeDefined();
    expect(id1).not.toBe(id2);
  });
});

describe("formatDays", () => {
  it("renders finite values as 'Nd'", () => {
    expect(formatDays(5)).toBe("5d");
    expect(formatDays(0)).toBe("0d");
    expect(formatDays(42.7)).toBe("43d");
  });

  it("returns '—' for non-finite or invalid values", () => {
    expect(formatDays(Infinity)).toBe("—");
    expect(formatDays(-Infinity)).toBe("—");
    expect(formatDays(NaN)).toBe("—");
    expect(formatDays(null)).toBe("—");
    expect(formatDays(undefined)).toBe("—");
    expect(formatDays(-1)).toBe("—");
  });

  it("supports long form with correct pluralisation", () => {
    expect(formatDays(1, { long: true })).toBe("1 day");
    expect(formatDays(2, { long: true })).toBe("2 days");
    expect(formatDays(0, { long: true })).toBe("0 days");
    expect(formatDays(Infinity, { long: true })).toBe("—");
  });

  it("supports decimals option", () => {
    expect(formatDays(5.234, { decimals: 1 })).toBe("5.2d");
    expect(formatDays(5.234, { long: true, decimals: 1 })).toBe("5.2 days");
    expect(formatDays(1.0, { long: true, decimals: 1 })).toBe("1.0 day");
  });
});
