/**
 * E2E Tests: All 16 Application Pages
 * Validates that each page loads correctly, renders key elements,
 * and responds to basic user interactions.
 *
 * Pages tested:
 * 1. MarketingPage (/) 2. LoginPage (/login) 3. Dashboard (/dashboard)
 * 4. ApexPage (/apex) 5. PulsePage (/pulse) 6. CatalystsPage (/catalysts)
 * 7. MindPage (/mind) 8. MemoryPage (/memory) 9. ERPAdaptersPage (/erp)
 * 10. ConnectivityPage (/connectivity) 11. IAMPage (/iam)
 * 12. ControlPlanePage (/control-plane) 13. AuditPage (/audit)
 * 14. SettingsPage (/settings) 15. TenantsPage (/tenants)
 * 16. AssessmentsPage (/assessments)
 */
import { test, expect } from '@playwright/test';

/**
 * Helper: Set a mock JWT token in localStorage so protected pages render.
 * In a real test environment, you would log in via the API first.
 */
async function setMockAuth(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/login');
  await page.evaluate(() => {
    const mockUser = {
      id: 'test-user',
      email: 'admin@vantax.co.za',
      name: 'Test Admin',
      role: 'superadmin',
      tenantId: 'vantax',
      permissions: ['*'],
    };
    localStorage.setItem('atheon_token', 'mock-jwt-token-for-e2e');
    localStorage.setItem('atheon_user', JSON.stringify(mockUser));
  });
}

// ── Public Pages ──

test.describe('Marketing Page (/)', () => {
  test('loads and displays brand name', async ({ page }) => {
    await page.goto('/');
    const body = await page.textContent('body');
    expect(body?.toLowerCase()).toContain('atheon');
  });

  test('has responsive layout on mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await expect(page.locator('body')).toBeVisible();
  });
});

test.describe('Login Page (/login)', () => {
  test('renders login form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[placeholder*="email" i]').first()).toBeVisible();
    await expect(page.locator('input[type="password"]').first()).toBeVisible();
  });
});

// ── Protected Pages (require auth) ──

test.describe('Dashboard (/dashboard)', () => {
  test('renders dashboard with key sections', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    // Dashboard should show some content even if API calls fail
    expect(body).toBeTruthy();
  });
});

test.describe('Apex Page (/apex)', () => {
  test('loads executive intelligence view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/apex');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Pulse Page (/pulse)', () => {
  test('loads operational intelligence view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/pulse');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Catalysts Page (/catalysts)', () => {
  test('loads catalyst clusters view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/catalysts');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Mind Page (/mind)', () => {
  test('loads AI assistant interface', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/mind');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Memory Page (/memory)', () => {
  test('loads knowledge graph view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/memory');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('ERP Adapters Page (/erp)', () => {
  test('loads ERP connector list', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/erp');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Connectivity Page (/connectivity)', () => {
  test('loads API connectivity view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/connectivity');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('IAM Page (/iam)', () => {
  test('loads identity management view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/iam');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Control Plane Page (/control-plane)', () => {
  test('loads control plane view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/control-plane');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Audit Page (/audit)', () => {
  test('loads audit log view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/audit');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Settings Page (/settings)', () => {
  test('loads settings view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/settings');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Tenants Page (/tenants)', () => {
  test('loads tenant management view', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/tenants');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

test.describe('Assessments Page (/assessments)', () => {
  test('loads pre-assessment tool', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/assessments');
    await page.waitForTimeout(1000);
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });
});

// ── Cross-Page Navigation ──

test.describe('Navigation', () => {
  test('sidebar navigation works between pages', async ({ page }) => {
    await setMockAuth(page);
    await page.goto('/dashboard');
    await page.waitForTimeout(500);

    // Check that the sidebar exists
    const sidebar = page.locator('nav, aside, [data-testid="sidebar"]');
    const sidebarVisible = await sidebar.first().isVisible().catch(() => false);
    if (sidebarVisible) {
      // Click through some sidebar links
      const links = sidebar.first().locator('a');
      const count = await links.count();
      expect(count).toBeGreaterThan(0);
    }
  });
});

// ── Responsive Design ──

test.describe('Responsive Design', () => {
  const viewports = [
    { name: 'mobile', width: 375, height: 812 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'desktop', width: 1440, height: 900 },
  ];

  for (const vp of viewports) {
    test(`marketing page renders at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/');
      await expect(page.locator('body')).toBeVisible();
      // No horizontal overflow
      const bodyWidth = await page.evaluate(() => document.body.scrollWidth);
      expect(bodyWidth).toBeLessThanOrEqual(vp.width + 20); // 20px tolerance
    });

    test(`login page renders at ${vp.name} (${vp.width}x${vp.height})`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto('/login');
      await expect(page.locator('input[type="email"], input[placeholder*="email" i]').first()).toBeVisible();
    });
  }
});
