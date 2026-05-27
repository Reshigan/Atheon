import type { Context, Next } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { verifyTOTP } from '../services/totp';
import { isEncrypted, decrypt } from '../services/encryption';

/**
 * Step-up MFA middleware. Enforces a fresh TOTP code on sensitive
 * actions even after the user is already logged in.
 *
 * Why: login-time MFA proves identity at session start. Step-up proves
 * the human is *still* present and intentional when the action has
 * material business impact — catalyst sign-off, ERP write-back,
 * audit pack generation, tenant deletion. Auditors (Big-4, SOX
 * reviewers) explicitly test for this control on shared-savings
 * billing artefacts.
 *
 * Flow:
 *   1. Client sends `X-MFA-Code: 123456` header with the request.
 *   2. We verify the TOTP against the user's mfa_secret.
 *   3. On success we cache a 5-minute pass in KV so subsequent
 *      step-up requests from the same user don't re-prompt.
 *   4. On failure, 401 with `step_up_required`.
 *
 * If the user has no MFA enrolled (no mfa_secret), we 403 with
 * `mfa_not_enrolled` — the action cannot proceed without enrolment.
 */

const STEP_UP_TTL_SECONDS = 5 * 60;
const STEP_UP_KV_PREFIX = 'mfa_stepup:';

export function stepUpMFA() {
  return async (c: Context<AppBindings>, next: Next) => {
    const auth = c.get('auth') as AuthContext | undefined;
    if (!auth?.userId) {
      return c.json({ error: 'Unauthorized', message: 'Authenticated session required' }, 401);
    }

    const kvKey = `${STEP_UP_KV_PREFIX}${auth.userId}`;
    const cached = await c.env.CACHE.get(kvKey);
    if (cached) {
      return next();
    }

    const code = c.req.header('X-MFA-Code');
    if (!code) {
      return c.json({
        error: 'Step-up MFA required',
        action: 'step_up_required',
        message: 'This action requires re-confirming MFA. Send a fresh TOTP code via the X-MFA-Code header.',
      }, 401);
    }

    const user = await c.env.DB.prepare(
      'SELECT mfa_enabled, mfa_secret FROM users WHERE id = ?'
    ).bind(auth.userId).first<{ mfa_enabled: number; mfa_secret: string | null }>();

    if (!user || user.mfa_enabled !== 1 || !user.mfa_secret) {
      return c.json({
        error: 'MFA not enrolled',
        action: 'mfa_not_enrolled',
        message: 'Enrol MFA before performing this action.',
        mfaSetupUrl: '/settings/security/mfa',
      }, 403);
    }

    const rawSecret = isEncrypted(user.mfa_secret)
      ? await decrypt(user.mfa_secret, c.env.ENCRYPTION_KEY)
      : user.mfa_secret;

    if (!rawSecret) {
      return c.json({ error: 'MFA secret unavailable', action: 'mfa_not_enrolled' }, 500);
    }

    const valid = await verifyTOTP(rawSecret, code);
    if (!valid) {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), auth.tenantId, auth.userId, 'step_up_mfa_failed', 'auth', 'session',
        JSON.stringify({ path: c.req.path }), 'failure',
      ).run();
      return c.json({
        error: 'Invalid MFA code',
        action: 'step_up_required',
      }, 401);
    }

    await c.env.CACHE.put(kvKey, '1', { expirationTtl: STEP_UP_TTL_SECONDS });
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), auth.tenantId, auth.userId, 'step_up_mfa_verified', 'auth', 'session',
      JSON.stringify({ path: c.req.path }), 'success',
    ).run();

    return next();
  };
}
