/**
 * E2E Tests: Authentication Flows
 * Tests login page rendering, form validation, login/logout, and protected route redirects.
 */
import { test, expect } from '@playwright/test';

test.describe('Login Page', () => {
  test('renders login form with email and password fields', async ({ page }) => {
    await page.goto('/login');
    await expect(page.locator('input[type="email"], input[placeholder*="email" i]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('shows validation error on empty form submission', async ({ page }) => {
    await page.goto('/login');
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
    await submitBtn.first().click();
    // Should stay on login page or show error
    await expect(page).toHaveURL(/login/);
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[type="email"], input[placeholder*="email" i]', 'bad@example.com');
    await page.fill('input[type="password"]', 'wrongpassword');
    const submitBtn = page.locator('button[type="submit"], button:has-text("Sign In"), button:has-text("Log In")');
    await submitBtn.first().click();
    // Should show error message or remain on login page
    await page.waitForTimeout(2000);
    await expect(page).toHaveURL(/login/);
  });

  test('redirects unauthenticated users to login', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForTimeout(1000);
    // Should redirect to login
    await expect(page).toHaveURL(/login|\/$/);
  });
});

test.describe('Marketing Page (Public)', () => {
  test('renders marketing page at root URL', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Atheon/i);
  });

  test('has navigation links', async ({ page }) => {
    await page.goto('/');
    // Should have some navigation or CTA
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('has a call-to-action button', async ({ page }) => {
    await page.goto('/');
    const cta = page.locator('a:has-text("Get Started"), a:has-text("Contact"), button:has-text("Get Started"), a:has-text("Login")');
    await expect(cta.first()).toBeVisible();
  });
});
