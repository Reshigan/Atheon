/**
 * Real-login helper for live, same-origin E2E (the deployed production/staging
 * frontend).
 *
 * The rest of the Playwright suite injects a mock JWT (see fixtures/auth.ts),
 * which is fine for UI-only assertions but useless against a real API. The
 * traceability suite must prove the *live* drill-down chain, so it performs an
 * actual UI login against the deployed frontend with real seeded credentials.
 *
 * Credentials come from the same env vars the production-e2e workflow supplies:
 *   E2E_LOGIN_EMAIL, E2E_LOGIN_PASSWORD, E2E_LOGIN_TOTP_SEED (optional, base32),
 *   E2E_LOGIN_TENANT (optional, defaults to "vantax").
 * Never hardcode credentials — they are provisioned out-of-band.
 */
import { createHmac } from 'node:crypto';
import type { Page } from '@playwright/test';

export interface RealLoginCreds {
  email: string;
  password: string;
  totpSeed?: string;
  tenant: string;
}

/** Resolve live-login creds from the environment, or null when unset. */
export function realLoginCreds(): RealLoginCreds | null {
  const email = process.env.E2E_LOGIN_EMAIL?.trim();
  const password = process.env.E2E_LOGIN_PASSWORD?.trim();
  if (!email || !password) return null;
  return {
    email,
    password,
    totpSeed: process.env.E2E_LOGIN_TOTP_SEED?.trim() || undefined,
    tenant: process.env.E2E_LOGIN_TENANT?.trim() || 'vantax',
  };
}

/**
 * The traceability chain needs a real backend. A browser on localhost is
 * CORS-blocked from the prod API (see docs/runbooks/go-live.md), and a local
 * dev server has no guarantee of seeded data — so the live suite only runs
 * against a deployed, same-origin frontend.
 */
export function isLiveBaseUrl(): boolean {
  const base = process.env.E2E_BASE_URL?.trim();
  if (!base) return false;
  return !/localhost|127\.0\.0\.1|0\.0\.0\.0/i.test(base);
}

/** Standard RFC-6238 TOTP (SHA-1, 30s step, 6 digits) from a base32 seed. */
export function generateTotp(seed: string, step = 30, digits = 6): string {
  const key = base32Decode(seed);
  let counter = Math.floor(Date.now() / 1000 / step);
  const buf = Buffer.alloc(8);
  for (let i = 7; i >= 0; i--) {
    buf[i] = counter & 0xff;
    counter = Math.floor(counter / 256);
  }
  const hmac = createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const bin =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return (bin % 10 ** digits).toString().padStart(digits, '0');
}

function base32Decode(b32: string): Buffer {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = b32.replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const ch of clean) {
    const idx = alphabet.indexOf(ch);
    if (idx < 0) continue;
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Perform a real UI login on the deployed frontend. Handles the optional
 * tenant-selection and TOTP MFA steps, then resolves once we've navigated off
 * /login into the authenticated app shell.
 */
export async function realLogin(page: Page, creds: RealLoginCreds): Promise<void> {
  await page.goto('/login');
  await page.getByTestId('email').fill(creds.email);
  await page.getByTestId('password').fill(creds.password);
  await page.getByTestId('login-button').click();

  const deadline = Date.now() + 30_000;
  let tenantSelected = false;
  let mfaSubmitted = false;

  while (Date.now() < deadline) {
    if (!page.url().includes('/login')) return; // navigated into the app

    if (!tenantSelected) {
      const tenantBtn = page.getByRole('button', {
        name: new RegExp(escapeRegExp(creds.tenant), 'i'),
      });
      if (await tenantBtn.first().isVisible().catch(() => false)) {
        await tenantBtn.first().click();
        tenantSelected = true;
        await page.waitForTimeout(400);
        continue;
      }
    }

    if (!mfaSubmitted) {
      const mfaInput = page.getByLabel('Authenticator code or backup code');
      if (await mfaInput.isVisible().catch(() => false)) {
        if (!creds.totpSeed) {
          throw new Error('MFA challenge appeared but E2E_LOGIN_TOTP_SEED is not set');
        }
        await mfaInput.fill(generateTotp(creds.totpSeed));
        await page.getByRole('button', { name: /verify/i }).click();
        mfaSubmitted = true;
        await page.waitForTimeout(400);
        continue;
      }
    }

    await page.waitForTimeout(300);
  }
  throw new Error(`Login did not complete within 30s (still at ${page.url()})`);
}
