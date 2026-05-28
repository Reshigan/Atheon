/**
 * E2E: Traceability drill-down chain (LIVE, same-origin).
 *
 * Proves the executive traceability story end-to-end against the *deployed*
 * frontend + real API: an admin logs in, Apex renders real health dimensions,
 * and the dimension / risk / metric trace controls open the shared
 * TraceabilityModal sourced from real batch runs.
 *
 * Skipped unless it targets a deployed same-origin frontend (E2E_BASE_URL is
 * not localhost) AND real login creds are present (E2E_LOGIN_EMAIL /
 * E2E_LOGIN_PASSWORD). See docs/runbooks/go-live.md: a browser on localhost is
 * CORS-blocked from the prod API, and the mock-JWT fixture used elsewhere
 * cannot exercise the real backend.
 */
import { test, expect } from '@playwright/test';
import { realLogin, realLoginCreds, isLiveBaseUrl } from '../fixtures/real-login';

const creds = realLoginCreds();
const live = isLiveBaseUrl() && creds !== null;

// Skip the whole group at collection time (no browser launch) unless we're
// running against a deployed same-origin frontend with real login creds.
const describeLive = live ? test.describe : test.describe.skip;

describeLive('Traceability chain (live)', () => {
  test.beforeEach(async ({ page }) => {
    await realLogin(page, creds!);
  });

  test('admin lands in the authenticated app after real login', async ({ page }) => {
    await expect(page).not.toHaveURL(/\/login/);
  });

  test('Apex renders real health dimensions', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole('tab', { name: /Business Health/i })).toBeVisible();
  });

  test('Apex dimension trace opens the traceability modal (or reports no data)', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });

    const traceBtn = page
      .locator('[aria-label^="Open trace for "], [aria-label*="open traceability"]')
      .first();
    await expect(traceBtn).toBeAttached({ timeout: 20_000 });
    await traceBtn.click();

    const modalHeading = page.getByRole('heading', { level: 3, name: /^Dimension:/ });
    const noData = page.getByText(/No traceability data available/i);
    await expect(modalHeading.or(noData).first()).toBeVisible({ timeout: 15_000 });

    // When the modal opened, it must carry a real source section and close cleanly.
    if (await modalHeading.isVisible()) {
      await expect(
        page
          .getByRole('button', { name: /Batch Runs|Source Attribution|Contributing Clusters/ })
          .first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(modalHeading).toBeHidden();
    }
  });

  test('Apex risk trace opens the risk traceability modal', async ({ page }) => {
    await page.goto('/apex');
    await expect(page.getByRole('tablist').first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole('tab', { name: /Risk Overview/i }).click();

    const riskTrace = page.locator('button[title="Trace to source"]').first();
    if (!(await riskTrace.isVisible({ timeout: 10_000 }).catch(() => false))) {
      test.skip(true, 'No risks with source attribution in the live tenant');
    }
    await riskTrace.click();

    const heading = page.getByRole('heading', { level: 3, name: /^Risk:/ });
    await expect(heading).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole('button', { name: /Source Attribution|Batch Runs/ }).first(),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await expect(heading).toBeHidden();
  });

  test('Pulse metric trace opens the metric traceability modal (or reports no data)', async ({ page }) => {
    await page.goto('/pulse');

    const metricTrace = page.locator('button[title="Trace to source"]').first();
    if (!(await metricTrace.isVisible({ timeout: 20_000 }).catch(() => false))) {
      test.skip(true, 'No metrics with source attribution in the live tenant');
    }
    await metricTrace.click();

    const modalHeading = page.getByRole('heading', { level: 3, name: /^Metric:/ });
    const noData = page.getByText(/No traceability data available/i);
    await expect(modalHeading.or(noData).first()).toBeVisible({ timeout: 15_000 });

    if (await modalHeading.isVisible()) {
      await expect(
        page
          .getByRole('button', { name: /Source Attribution|Batch Runs|KPI Contributors/ })
          .first(),
      ).toBeVisible();
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await expect(modalHeading).toBeHidden();
    }
  });
});
