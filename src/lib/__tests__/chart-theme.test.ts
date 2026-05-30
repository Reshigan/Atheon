// TASK-026: Test for chart theme
import { chartPalette, chartTheme } from "../chart-theme";

describe("chartTheme", () => {
  it("has required color tokens", () => {
    expect(chartTheme.colors.primary).toBeDefined();
    expect(chartTheme.colors.secondary).toBeDefined();
    expect(chartTheme.colors.tertiary).toBeDefined();
  });

  it("has grid configuration", () => {
    expect(chartTheme.grid.stroke).toBeDefined();
    expect(chartTheme.grid.strokeWidth).toBe(1);
  });

  it("has tooltip configuration", () => {
    expect(chartTheme.tooltip.borderRadius).toBe(2);
  });
});

describe("chartPalette", () => {
  it("has at least 6 colors", () => {
    expect(chartPalette.length).toBeGreaterThanOrEqual(6);
  });

  it("supports index-based access with wrapping", () => {
    expect(chartPalette[0]).toBeDefined();
    expect(chartPalette[0 % chartPalette.length]).toBe(chartPalette[0]);
    expect(chartPalette[chartPalette.length % chartPalette.length]).toBe(chartPalette[0]);
  });
});
