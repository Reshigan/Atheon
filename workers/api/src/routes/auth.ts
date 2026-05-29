import { Hono } from 'hono';
import type { AppBindings } from '../types';
import {
  generateToken,
  verifyToken,
  hashPassword,
  verifyPassword,
  ACCESS_TOKEN_TTL_SECONDS,
  requiresMFA,
  withinMfaGracePeriod,
  computeMfaGraceUntil,
  mfaGraceDaysRemaining,
} from '../middleware/auth';
import { getValidatedJsonBody } from '../middleware/validation';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';
import { sendOrQueueEmail, getPasswordResetEmailTemplate } from '../services/email';
import { logInfo, logWarn } from '../services/logger';
import { withStorageRetry } from '../services/storage-retry';

// ── Backup Code helpers (v40) ──
//
// Format: 8 codes like "a8h3-k1m9" (lowercase base32-ish, dash-separated for readability).
// Storage: SHA-256 hex of the code string — NOT the stronger PBKDF2 hashPassword helper.
// Rationale: backup codes are high-entropy random secrets (40 bits each), so a fast hash
// is acceptable; the goal here is only to avoid storing the plaintext at rest. PBKDF2
// would add 100k iterations × 8 codes × every login verify with no real security gain.

const BACKUP_CODE_COUNT = 8;
const BACKUP_CODE_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o/1/l/i to avoid ambiguity
const BACKUP_CODE_PATTERN = /^[a-z0-9]{4}-[a-z0-9]{4}$/;

/** Generate a single human-friendly backup code like "a8h3-k1m9". */
function generateBackupCode(): string {
  const pick = (n: number): string => {
    const bytes = crypto.getRandomValues(new Uint8Array(n));
    let out = '';
    for (const b of bytes) out += BACKUP_CODE_ALPHABET[b % BACKUP_CODE_ALPHABET.length];
    return out;
  };
  return `${pick(4)}-${pick(4)}`;
}

/** SHA-256 hex of a backup code (normalized to lowercase, dashes preserved). */
async function hashBackupCode(code: string): Promise<string> {
  const normalized = code.trim().toLowerCase();
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalized));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

/** Generate a fresh set of 8 backup codes + their stored hashes (JSON string). */
async function generateBackupCodeSet(): Promise<{ codes: string[]; hashedJson: string }> {
  const codes: string[] = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) codes.push(generateBackupCode());
  const hashed = await Promise.all(codes.map(hashBackupCode));
  return { codes, hashedJson: JSON.stringify(hashed) };
}

/** True-ish check that an input looks like a backup code (xxxx-xxxx). */
function looksLikeBackupCode(input: string): boolean {
  return BACKUP_CODE_PATTERN.test(input.trim().toLowerCase());
}

const auth = new Hono<AppBindings>();

// Security S3: Password strength validation
export function validatePasswordStrength(password: string): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (password.length < 10) errors.push('Password must be at least 10 characters');
  if (!/[A-Z]/.test(password)) errors.push('Password must contain at least one uppercase letter');
  if (!/[a-z]/.test(password)) errors.push('Password must contain at least one lowercase letter');
  if (!/[0-9]/.test(password)) errors.push('Password must contain at least one digit');
  if (!/[^A-Za-z0-9]/.test(password)) errors.push('Password must contain at least one special character');
  return { valid: errors.length === 0, errors };
}

// Security S5: Per-account login lockout helper
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_SECONDS = 900; // 15 minutes

async function checkAndIncrementLoginAttempts(cache: KVNamespace, email: string): Promise<{ locked: boolean; attempts: number }> {
  const key = `login_attempts:${email}`;
  const current = await withStorageRetry(() => cache.get(key));
  const attempts = current ? parseInt(current, 10) : 0;
  if (attempts >= MAX_LOGIN_ATTEMPTS) return { locked: true, attempts };
  return { locked: false, attempts };
}

async function recordFailedLogin(cache: KVNamespace, email: string): Promise<void> {
  const key = `login_attempts:${email}`;
  const current = await cache.get(key);
  const attempts = current ? parseInt(current, 10) + 1 : 1;
  await cache.put(key, attempts.toString(), { expirationTtl: LOCKOUT_DURATION_SECONDS });
}

async function clearLoginAttempts(cache: KVNamespace, email: string): Promise<void> {
  await cache.delete(`login_attempts:${email}`);
}

// POST /api/auth/register
auth.post('/register', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{
    email: string; password: string; name: string; tenant_slug?: string;
  }>(c, [
    { field: 'email', type: 'email', required: true },
    { field: 'password', type: 'string', required: true, minLength: 10 },
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'tenant_slug', type: 'string', required: false, maxLength: 64 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Security S3: Validate password strength
  const pwStrength = validatePasswordStrength(body.password);
  if (!pwStrength.valid) {
    return c.json({ error: 'Weak password', details: pwStrength.errors }, 400);
  }

  const slug = body.tenant_slug || 'vantax';
  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  // Check if user already exists
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(body.email, tenant.id).first();

  if (existing) {
    return c.json({ error: 'User with this email already exists' }, 409);
  }

  const passwordHash = await hashPassword(body.password);
  const userId = crypto.randomUUID();

  // Phase 1.3: Set email_verified=0 for new registrations
  await c.env.DB.prepare(
    'INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, 0)'
  ).bind(userId, tenant.id, body.email, body.name, 'analyst', passwordHash, '["read"]').run();

  // Phase 1.3: Generate email verification token (24h TTL)
  const verificationToken = crypto.randomUUID();
  await c.env.CACHE.put(`email_verify:${verificationToken}`, JSON.stringify({
    userId, email: body.email, tenantId: tenant.id,
  }), { expirationTtl: 86400 });

  // Send verification email via MS Graph, falling back to queue. Fired via
  // ctx.waitUntil so the HTTP response returns immediately regardless of
  // email send latency \u2014 prevents the 45s hang we saw when MS Graph auth
  // is misconfigured (AZURE_AD_TENANT_ID = 'test').
  const verifyUrl = `https://atheon.vantax.co.za/verify-email?token=${verificationToken}`;
  c.executionCtx.waitUntil(
    sendOrQueueEmail(c.env.DB, {
      to: [body.email],
      subject: 'Atheon\u2122 \u2014 Verify Your Email',
      htmlBody: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#0ea5e9;">Welcome to Atheon\u2122</h2>
        <p>Hi ${body.name},</p>
        <p>Please verify your email address to activate your account:</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${verifyUrl}" style="background:#0ea5e9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a>
        </p>
        <p style="color:#666;font-size:13px;">This link expires in 24 hours.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">Atheon\u2122 Enterprise Intelligence Platform</p>
      </div>`,
      textBody: `Verify your email: ${verifyUrl}\nThis link expires in 24 hours.`,
      tenantId: tenant.id as string,
    }, c.env).catch((err) => { console.error('Phase 1.3: failed to send verification email:', err); }),
  );

  const token = await generateToken({
    sub: userId,
    email: body.email,
    name: body.name,
    role: 'analyst',
    tenant_id: tenant.id as string,
    permissions: ['read'],
  }, c.env.JWT_SECRET);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenant.id, userId, 'register', 'auth', 'user', JSON.stringify({ email: body.email }), 'success').run();

  logInfo('registration.success', {
    requestId: c.get('requestId'),
    tenantId: tenant.id as string,
    userId,
    layer: 'auth',
    action: 'registration.success',
  }, { email: body.email, tenantSlug: tenant.slug as string });

  return c.json({
    token,
    emailVerificationRequired: true,
    user: {
      id: userId,
      email: body.email,
      name: body.name,
      role: 'analyst',
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      // industry column removed from tenants; fall back to 'general'.
      tenantIndustry: 'general',
      permissions: ['read'],
    },
  }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ email: string; password: string; tenant_slug?: string }>(c, [
    { field: 'email', type: 'email', required: true },
    { field: 'password', type: 'string', required: true, minLength: 1 },
    { field: 'tenant_slug', type: 'string', required: false, maxLength: 64 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Security S5: Check login lockout before proceeding
  const lockoutCheck = await checkAndIncrementLoginAttempts(c.env.CACHE, body.email);
  if (lockoutCheck.locked) {
    return c.json({ error: 'Account temporarily locked due to too many failed attempts. Try again in 15 minutes.' }, 429);
  }

  // Prevent cross-tenant login collisions (same email in multiple tenants)
  // If tenant_slug is provided, scope login to that tenant
  // If not provided and email exists in multiple tenants, require tenant_slug
  let user;
  if (body.tenant_slug) {
    const loginTenantRow = await withStorageRetry(() =>
      c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(body.tenant_slug).first());
    if (!loginTenantRow) {
      await recordFailedLogin(c.env.CACHE, body.email);
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    // industry column removed from tenants; tenantIndustry defaults to 'general' in response.
    user = await withStorageRetry(() => c.env.DB.prepare(
      'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.tenant_id = ? AND u.status = ?'
    ).bind(body.email, loginTenantRow.id, 'active').first());
  } else {
    const tenantRows = await withStorageRetry(() => c.env.DB.prepare(
      'SELECT t.slug, t.name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
    ).bind(body.email, 'active').all());
    if ((tenantRows?.results?.length || 0) > 1) {
      const tenants = tenantRows.results.map((r: Record<string, unknown>) => ({ slug: r.slug as string, name: r.name as string }));
      return c.json({ error: 'Tenant selection required', tenantSelectionRequired: true, tenants, message: 'This email exists in multiple workspaces. Please select one.' }, 400);
    }
    // industry column removed from tenants; tenantIndustry defaults to 'general' in response.
    user = await withStorageRetry(() => c.env.DB.prepare(
      'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
    ).bind(body.email, 'active').first());
  }

  if (!user) {
    await recordFailedLogin(c.env.CACHE, body.email);
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Verify password — reject login if no password hash exists (e.g. SSO-only or unprovisioned user)
  if (!user.password_hash) {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login_failed', 'auth', 'session', JSON.stringify({ email: body.email, reason: 'no_password_set' }), 'failure').run();
    return c.json({ error: 'Password login is not available for this account. Please use SSO or contact your administrator to set a password.' }, 401);
  }

  const valid = await verifyPassword(body.password, user.password_hash as string);
  if (!valid) {
    await recordFailedLogin(c.env.CACHE, body.email);
    // Log failed attempt
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login_failed', 'auth', 'session', JSON.stringify({ email: body.email, reason: 'invalid_password' }), 'failure').run();
    logWarn('login.failed', {
      requestId: c.get('requestId'),
      tenantId: user.tenant_id as string,
      userId: user.id as string,
      layer: 'auth',
      action: 'login.failed',
    }, { email: body.email, reason: 'invalid_password' });
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Phase 1.3: Check email verification (skip for existing users who were auto-verified)
  const emailVerified = user.email_verified as number | undefined;
  if (emailVerified === 0) {
    return c.json({ 
      error: 'Email not verified', 
      message: 'Please verify your email address before logging in. Check your inbox for a verification link.',
      emailVerificationRequired: true,
    }, 403);
  }

  // Phase 1.4: Check MFA/TOTP if enabled
  const mfaEnabled = user.mfa_enabled as number | undefined;
  if (mfaEnabled === 1) {
    // Password was correct — clear lockout counter so failed attempts don't accumulate across MFA flow
    await clearLoginAttempts(c.env.CACHE, body.email);

    // Generate a short-lived MFA challenge token
    const mfaChallengeToken = crypto.randomUUID();
    await c.env.CACHE.put(`mfa_challenge:${mfaChallengeToken}`, JSON.stringify({
      userId: user.id, tenantId: user.tenant_id, email: user.email,
      name: user.name, role: user.role, permissions: JSON.parse(user.permissions as string || '[]'),
    }), { expirationTtl: 300 }); // 5 minutes

    return c.json({
      mfaRequired: true,
      mfaChallengeToken,
      message: 'Please provide your TOTP code or backup code to complete login.',
    });
  }

  // v40: Mandatory MFA for admin-tier roles. Runs AFTER password verify but BEFORE
  // issuing the JWT. If the user has no MFA, is an admin-tier role, and is past their
  // grace window, block the login and direct them to set up MFA.
  let mfaEnforcementWarning: { daysRemaining: number; reason: string; mfaSetupUrl: string } | null = null;
  if (requiresMFA(user.role as string) && (mfaEnabled ?? 0) !== 1) {
    const graceUntil = (user.mfa_grace_until as string | null | undefined) ?? null;

    // Back-fill grace on existing admin accounts that pre-date v40 so they aren't
    // locked out instantly on the first login after rollout.
    let effectiveGrace = graceUntil;
    if (!effectiveGrace) {
      effectiveGrace = computeMfaGraceUntil();
      await c.env.DB.prepare('UPDATE users SET mfa_grace_until = ? WHERE id = ?')
        .bind(effectiveGrace, user.id).run();
    }

    if (withinMfaGracePeriod(effectiveGrace)) {
      mfaEnforcementWarning = {
        daysRemaining: mfaGraceDaysRemaining(effectiveGrace),
        reason: 'MFA must be enabled for admin roles',
        mfaSetupUrl: '/settings/security/mfa',
      };
      // Audit: admin logged in under MFA grace period (visibility for security team)
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), user.tenant_id, user.id, 'login_admin_mfa_grace', 'auth', 'session',
        JSON.stringify({ email: body.email, daysRemaining: mfaEnforcementWarning.daysRemaining }),
        'success',
      ).run();
    } else {
      // Grace expired — block login until MFA is enabled.
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), user.tenant_id, user.id, 'login_blocked_mfa_required', 'auth', 'session',
        JSON.stringify({ email: body.email, role: user.role }), 'failure',
      ).run();
      await clearLoginAttempts(c.env.CACHE, body.email);
      return c.json({
        error: 'MFA required for this role',
        action: 'enable_mfa',
        mfaSetupUrl: '/settings/security/mfa',
      }, 403);
    }
  }

  // Security S5: Clear lockout counter on successful login
  await clearLoginAttempts(c.env.CACHE, body.email);

  const token = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login', 'auth', 'session', JSON.stringify({ email: body.email }), 'success').run();

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(user.id).run();

  // M5: Generate refresh token (longer-lived, stored in KV)
  const refreshToken = crypto.randomUUID();
  const REFRESH_TTL = 7 * 24 * 3600; // 7 days
  await c.env.CACHE.put(`refresh_token:${refreshToken}`, JSON.stringify({
    userId: user.id, tenantId: user.tenant_id, email: user.email,
    name: user.name, role: user.role, permissions: JSON.parse(user.permissions as string || '[]'),
  }), { expirationTtl: REFRESH_TTL });

  // industry column removed from tenants; tenantIndustry defaults to 'general'.
  return c.json({
    token,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    ...(mfaEnforcementWarning ? { mfaEnforcementWarning } : {}),
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      tenantIndustry: 'general',
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// M5: POST /api/auth/refresh - Exchange refresh token for new access token
auth.post('/refresh', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ refresh_token: string }>(c, [
    { field: 'refresh_token', type: 'string', required: true, minLength: 1 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const stored = await c.env.CACHE.get(`refresh_token:${body.refresh_token}`);
  if (!stored) {
    return c.json({ error: 'Invalid or expired refresh token' }, 401);
  }

  const userData = JSON.parse(stored) as {
    userId: string; tenantId: string; email: string;
    name: string; role: string; permissions: string[];
  };

  // Issue new access token
  const newToken = await generateToken({
    sub: userData.userId,
    email: userData.email,
    name: userData.name,
    role: userData.role,
    tenant_id: userData.tenantId,
    permissions: userData.permissions,
  }, c.env.JWT_SECRET);

  // Rotate refresh token: delete old, issue new
  await c.env.CACHE.delete(`refresh_token:${body.refresh_token}`);
  const newRefreshToken = crypto.randomUUID();
  await c.env.CACHE.put(`refresh_token:${newRefreshToken}`, stored, { expirationTtl: 7 * 24 * 3600 });

  return c.json({ token: newToken, refreshToken: newRefreshToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS });
});

// POST /api/auth/demo-login (for demo access without password)
// Bug #2: Gate behind DEMO_LOGIN_SECRET rather than trusting env var alone
auth.post('/demo-login', async (c) => {
  if (c.env.ENVIRONMENT === 'production') {
    return c.json({ error: 'Not found' }, 404);
  }
  // Double-gate: require a secret header even in non-production to prevent accidental exposure
  const demoSecret = c.req.header('X-Demo-Secret');
  if (!demoSecret || demoSecret !== c.env.DEMO_LOGIN_SECRET) {
    return c.json({ error: 'Not found' }, 404);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ tenant_slug?: string; role?: string }>(c, [
    { field: 'tenant_slug', type: 'string', required: false, maxLength: 64 },
    { field: 'role', type: 'string', required: false, maxLength: 32 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }
  const slug = body.tenant_slug || 'vantax';
  const requestedRole = body.role || 'admin';

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  // Find or use first user for this tenant
  let user = await c.env.DB.prepare(
    'SELECT * FROM users WHERE tenant_id = ? AND role = ? LIMIT 1'
  ).bind(tenant.id, requestedRole).first();

  if (!user) {
    user = await c.env.DB.prepare(
      'SELECT * FROM users WHERE tenant_id = ? LIMIT 1'
    ).bind(tenant.id).first();
  }

  if (!user) {
    return c.json({ error: 'No users found for tenant' }, 404);
  }

  const token = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      // industry column removed from tenants; fall back to 'general'.
      tenantIndustry: 'general',
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// POST /api/auth/change-password
auth.post('/change-password', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ current_password?: string; new_password: string }>(c, [
    { field: 'current_password', type: 'string', required: false, minLength: 1 },
    { field: 'new_password', type: 'string', required: true, minLength: 10 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Verify current password if the user already has a password
  if (user.password_hash) {
    if (!body.current_password) {
      return c.json({ error: 'current_password is required' }, 400);
    }

    const valid = await verifyPassword(body.current_password, user.password_hash as string);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }

  // Security S3: Validate new password strength
  const pwCheck = validatePasswordStrength(body.new_password);
  if (!pwCheck.valid) {
    return c.json({ error: 'Weak password', details: pwCheck.errors }, 400);
  }

  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, payload.sub).run();

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'change_password', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'Password changed successfully' });
});

// POST /api/auth/logout - Invalidate token via KV blacklist
auth.post('/logout', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  const token = authHeader.replace('Bearer ', '');
  const payload = await verifyToken(token, c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  // Bug #13 fix: Hash the token before using as KV key
  const hashBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const tokenHash = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');
  const exp = (payload.exp as number) || Math.floor(Date.now() / 1000) + ACCESS_TOKEN_TTL_SECONDS;
  const ttl = Math.max(exp - Math.floor(Date.now() / 1000), 60);
  await c.env.CACHE.put(`token:blacklist:${tokenHash}`, 'revoked', { expirationTtl: ttl });

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'logout', 'auth', 'session', '{}', 'success').run();

  return c.json({ success: true, message: 'Logged out successfully' });
});

// POST /api/auth/forgot-password - Send password reset email
auth.post('/forgot-password', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ email: string }>(c, [
    { field: 'email', type: 'email', required: true },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Find user by email (don't reveal if user exists)
  const user = await c.env.DB.prepare(
    'SELECT u.id, u.email, u.name, u.tenant_id, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
  ).bind(body.email, 'active').first();

  if (user) {
    // Generate a reset token and store in KV (expires in 1 hour)
    const resetToken = crypto.randomUUID();
    await c.env.CACHE.put(`password_reset:${resetToken}`, JSON.stringify({
      userId: user.id,
      email: user.email,
      tenantId: user.tenant_id,
    }), { expirationTtl: 3600 });

    // Send password reset email via MS Graph, fallback to queue. Fired via
    // ctx.waitUntil so the HTTP response returns immediately regardless of
    // MS Graph latency — also means response timing can't be used to probe
    // whether the account exists (the handler returns identically either way).
    const resetUrl = `https://atheon.vantax.co.za/reset-password?token=${resetToken}`;
    const { html, text } = getPasswordResetEmailTemplate(user.name as string, resetUrl);
    c.executionCtx.waitUntil(
      sendOrQueueEmail(c.env.DB, {
        to: [user.email as string],
        subject: 'Atheon™ — Password Reset Request',
        htmlBody: html,
        textBody: text,
        tenantId: user.tenant_id as string,
      }, c.env).catch((err) => {
        console.error('Failed to send forgot-password email:', err);
        // Log to audit but don't fail the request - email will be retried from queue
        return c.env.DB.prepare(
          'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'forgot_password_email_queued', 'auth', 'user', JSON.stringify({ email: body.email, queued: true }), 'success').run().catch(() => {});
      }),
    );

    // Audit log
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'forgot_password', 'auth', 'user', JSON.stringify({ email: body.email }), 'success').run();
  }

  // Always return success (don't reveal if user exists)
  return c.json({ success: true, message: 'If an account exists with that email, a reset link has been sent.' });
});

// POST /api/auth/reset-password - Complete password reset with token
auth.post('/reset-password', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ token: string; new_password: string }>(c, [
    { field: 'token', type: 'string', required: true, minLength: 1 },
    { field: 'new_password', type: 'string', required: true, minLength: 10 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Look up reset token in KV
  const resetData = await c.env.CACHE.get(`password_reset:${body.token}`);
  if (!resetData) {
    return c.json({ error: 'Invalid or expired reset token' }, 400);
  }

  const { userId, tenantId } = JSON.parse(resetData) as { userId: string; email: string; tenantId: string };

  // Security S3: Validate new password strength on reset
  const pwResetCheck = validatePasswordStrength(body.new_password);
  if (!pwResetCheck.valid) {
    return c.json({ error: 'Weak password', details: pwResetCheck.errors }, 400);
  }

  // Hash new password and update
  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, userId).run();

  // Delete the reset token
  await c.env.CACHE.delete(`password_reset:${body.token}`);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, userId, 'password_reset', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'Password has been reset successfully' });
});

// GET /api/auth/me
auth.get('/me', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  try {
    const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
    if (!payload) {
      return c.json({ error: 'Invalid token' }, 401);
    }

    const user = await c.env.DB.prepare(
      `SELECT u.*, t.name as tenant_name, t.slug as tenant_slug,
              t.logo_url as tenant_logo_url,
              t.brand_primary_color as tenant_brand_primary_color,
              t.brand_name_override as tenant_brand_name_override
         FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?`
    ).bind(payload.sub).first();

    if (!user) {
      return c.json({ error: 'User not found' }, 404);
    }

    return c.json({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
      brand: {
        logoUrl: user.tenant_logo_url || null,
        primaryColor: user.tenant_brand_primary_color || null,
        nameOverride: user.tenant_brand_name_override || null,
      },
    });
  } catch {
    return c.json({ error: 'Invalid token' }, 401);
  }
});

// GET /api/auth/sso/:tenant_slug (SSO config for tenant)
auth.get('/sso/:tenant_slug', async (c) => {
  const slug = c.req.param('tenant_slug');
  const tenant = await c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT provider, issuer_url, domain_hint FROM sso_configs WHERE tenant_id = ? AND enabled = 1'
  ).bind(tenant.id).first();

  if (!sso) {
    return c.json({ sso_enabled: false });
  }

  return c.json({
    sso_enabled: true,
    provider: sso.provider,
    issuer_url: sso.issuer_url,
    domain_hint: sso.domain_hint,
  });
});

// POST /api/auth/sso (legacy: attempt SSO login)
auth.post('/sso', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ provider: string; tenant_slug?: string }>(c, [
    { field: 'provider', type: 'string', required: true, minLength: 2, maxLength: 64 },
    { field: 'tenant_slug', type: 'string', required: false, maxLength: 64 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }
  const slug = body.tenant_slug || 'vantax';

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT * FROM sso_configs WHERE tenant_id = ? AND provider = ? AND enabled = 1'
  ).bind(tenant.id, body.provider).first();

  if (!sso) {
    return c.json({ error: 'SSO not configured for this provider' }, 404);
  }

  // Return the authorize URL for the frontend to redirect to
  // Use SSO_REDIRECT_URI from env var if available, otherwise default to production URL
  const redirectUri = c.env.SSO_REDIRECT_URI || 'https://atheon.vantax.co.za/login';
  
  // Replay protection: a per-request nonce is bound into the signed state and
  // emitted on the authorize URL; the callback verifies the ID token echoes it.
  const nonceBytes = new Uint8Array(16);
  crypto.getRandomValues(nonceBytes);
  const ssoNonce = Array.from(nonceBytes).map(b => b.toString(16).padStart(2, '0')).join('');

  // Sign SSO state with HMAC to prevent tampering (CSRF protection)
  const statePayload = JSON.stringify({ tenant_slug: slug, provider: body.provider, nonce: ssoNonce, ts: Date.now() });
  const stateHmacKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const stateSignature = await crypto.subtle.sign('HMAC', stateHmacKey, new TextEncoder().encode(statePayload));
  const stateSig = Array.from(new Uint8Array(stateSignature)).map(b => b.toString(16).padStart(2, '0')).join('');
  const state = btoa(JSON.stringify({ ...JSON.parse(statePayload), sig: stateSig }));

  if (body.provider === 'azure_ad') {
    const clientId = sso.client_id as string;
    // Extract directory tenant ID from issuer URL
    const issuerUrl = sso.issuer_url as string;
    const directoryTenantId = issuerUrl.split('/')[3] || 'common';

    const authorizeUrl = `https://login.microsoftonline.com/${directoryTenantId}/oauth2/v2.0/authorize?` +
      `client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent('openid profile email')}` +
      `&state=${encodeURIComponent(state)}` +
      `&response_mode=query` +
      (sso.domain_hint ? `&domain_hint=${encodeURIComponent(sso.domain_hint as string)}` : '');

    return c.json({ redirect_url: authorizeUrl });
  }

  // Generic OIDC — Okta, Auth0, Google Workspace, Keycloak, etc. Issuer URL
  // is the IdP's root (we append /.well-known/openid-configuration).
  if (body.provider === 'oidc_generic' || body.provider === 'okta' || body.provider === 'auth0' || body.provider === 'google_workspace') {
    try {
      const { fetchDiscovery, buildAuthorizeUrl } = await import('../services/oidc');
      const discovery = await fetchDiscovery(sso.issuer_url as string, c.env.CACHE);
      const authorizeUrl = buildAuthorizeUrl({
        discovery,
        clientId: sso.client_id as string,
        redirectUri,
        state,
        scope: 'openid profile email',
        domainHint: (sso.domain_hint as string | null) || null,
        nonce: ssoNonce,
      });
      return c.json({ redirect_url: authorizeUrl });
    } catch (err) {
      console.error('OIDC SSO initiate failed:', err);
      return c.json({ error: 'OIDC discovery failed', details: (err as Error).message }, 502);
    }
  }

  return c.json({ error: 'Unsupported SSO provider' }, 400);
});

// POST /api/auth/sso/callback (Azure AD OAuth callback - exchange code for token)
auth.post('/sso/callback', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ code: string; state: string }>(c, [
    { field: 'code', type: 'string', required: true, minLength: 1, maxLength: 4096 },
    { field: 'state', type: 'string', required: true, minLength: 1, maxLength: 4096 },
  ]);

  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  let stateData: { tenant_slug: string; provider: string; nonce?: string; ts?: number; sig?: string };
  try {
    stateData = JSON.parse(atob(body.state));
  } catch {
    return c.json({ error: 'Invalid state parameter' }, 400);
  }

  // Verify HMAC signature on state to prevent tampering (CSRF protection)
  // This ensures the state parameter was generated by our server and hasn't been modified
  if (stateData.sig) {
    const { sig, ...payloadWithoutSig } = stateData;
    const verifyPayload = JSON.stringify(payloadWithoutSig);
    const verifyKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expectedSig = await crypto.subtle.sign('HMAC', verifyKey, new TextEncoder().encode(verifyPayload));
    const expectedSigHex = Array.from(new Uint8Array(expectedSig)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (sig !== expectedSigHex) {
      return c.json({ error: 'Invalid state signature — possible CSRF attack' }, 400);
    }
  } else {
    // Reject unsigned state parameters (security requirement)
    return c.json({ error: 'Missing state signature — security validation failed' }, 400);
  }

  const tenant = await c.env.DB.prepare('SELECT * FROM tenants WHERE slug = ?').bind(stateData.tenant_slug).first();
  if (!tenant) {
    return c.json({ error: 'Tenant not found' }, 404);
  }

  const sso = await c.env.DB.prepare(
    'SELECT * FROM sso_configs WHERE tenant_id = ? AND provider = ? AND enabled = 1'
  ).bind(tenant.id, stateData.provider).first();

  if (!sso) {
    return c.json({ error: 'SSO configuration not found' }, 404);
  }

  const clientId = sso.client_id as string;
  const issuerUrl = sso.issuer_url as string;
  // Use SSO_REDIRECT_URI from env var if available, otherwise default to production URL
  const redirectUri = c.env.SSO_REDIRECT_URI || 'https://atheon.vantax.co.za/login';

  let idPayload: { email?: string; preferred_username?: string; name?: string; sub?: string; oid?: string };

  if (stateData.provider === 'oidc_generic' || stateData.provider === 'okta'
      || stateData.provider === 'auth0' || stateData.provider === 'google_workspace') {
    // Generic OIDC path — discovery doc + RS256 ID token verification.
    try {
      const { fetchDiscovery, exchangeCodeForTokens, verifyIdToken } = await import('../services/oidc');
      const discovery = await fetchDiscovery(issuerUrl, c.env.CACHE);
      const tokens = await exchangeCodeForTokens({
        discovery,
        clientId,
        // OIDC client secret is stored either in a per-tenant SSO field or
        // a shared env var (per-tenant override wins). Most enterprise IdPs
        // require Confidential clients with a secret.
        clientSecret: (sso.client_secret as string | null) || c.env.OIDC_CLIENT_SECRET || '',
        code: body.code,
        redirectUri,
      });
      const claims = await verifyIdToken({
        idToken: tokens.id_token,
        discovery,
        expectedAudience: clientId,
        expectedNonce: stateData.nonce,
        cacheKv: c.env.CACHE,
      });
      idPayload = {
        email: claims.email,
        preferred_username: claims.preferred_username,
        name: claims.name,
        sub: claims.sub,
      };
    } catch (err) {
      console.error('OIDC SSO callback failed:', err);
      return c.json({ error: 'OIDC authentication failed', details: (err as Error).message }, 401);
    }
  } else {
    // Azure AD path — preserved as-is for backwards compatibility.
    const directoryTenantId = issuerUrl.split('/')[3] || 'common';
    const tokenUrl = `https://login.microsoftonline.com/${directoryTenantId}/oauth2/v2.0/token`;
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: c.env.AZURE_AD_CLIENT_SECRET,
        code: body.code,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
        scope: 'openid profile email',
      }).toString(),
    });
    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      console.error('Azure AD token exchange failed:', err);
      return c.json({ error: 'SSO authentication failed' }, 401);
    }
    const tokenData = await tokenResponse.json() as { id_token?: string; access_token?: string };
    if (!tokenData.id_token) {
      return c.json({ error: 'No ID token returned from Azure AD' }, 401);
    }
    const idTokenParts = tokenData.id_token.split('.');
    if (idTokenParts.length !== 3) {
      return c.json({ error: 'Invalid ID token format' }, 401);
    }
    try {
      const padded = idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
      const decoded = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
      idPayload = JSON.parse(decoded);
    } catch {
      return c.json({ error: 'Failed to decode ID token' }, 401);
    }
  }

  const ssoEmail = (idPayload.email || idPayload.preferred_username || '').toLowerCase();
  const ssoName = idPayload.name || ssoEmail.split('@')[0];

  if (!ssoEmail) {
    return c.json({ error: 'No email found in SSO token' }, 401);
  }

  // Find or auto-provision user
  // industry column removed from tenants; tenantIndustry defaults to 'general' in response.
  let user = await c.env.DB.prepare(
    'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.tenant_id = ?'
  ).bind(ssoEmail, tenant.id).first();

  if (!user && sso.auto_provision) {
    // Auto-provision new user
    const userId = crypto.randomUUID();
    const defaultRole = (sso.default_role as string) || 'analyst';
    const defaultPerms = defaultRole === 'admin' ? '["*"]' : '["read"]';
    // v40: Admin-tier auto-provisioned accounts start with an MFA grace window.
    const graceUntil = requiresMFA(defaultRole) ? computeMfaGraceUntil() : null;

    await c.env.DB.prepare(
      'INSERT INTO users (id, tenant_id, email, name, role, permissions, status, mfa_grace_until) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, tenant.id, ssoEmail, ssoName, defaultRole, defaultPerms, 'active', graceUntil).run();

    user = await c.env.DB.prepare(
      // industry column removed from tenants; tenantIndustry defaults to 'general' in response.
      'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?'
    ).bind(userId).first();

    // Log auto-provision
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), tenant.id, userId, 'sso_auto_provision', 'auth', 'user', JSON.stringify({ email: ssoEmail, provider: stateData.provider }), 'success').run();
  }

  if (!user) {
    return c.json({ error: 'User not found. Contact your administrator to provision access.' }, 403);
  }

  if (user.status !== 'active') {
    return c.json({ error: 'Account is disabled' }, 403);
  }

  // Generate Atheon JWT
  const jwtToken = await generateToken({
    sub: user.id as string,
    email: user.email as string,
    name: user.name as string,
    role: user.role as string,
    tenant_id: user.tenant_id as string,
    permissions: JSON.parse(user.permissions as string || '[]'),
  }, c.env.JWT_SECRET);

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(user.id).run();

  // Log SSO login
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'sso_login', 'auth', 'session', JSON.stringify({ email: ssoEmail, provider: stateData.provider }), 'success').run();

  return c.json({
    token: jwtToken,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      // industry column removed from tenants; fall back to 'general'.
      tenantIndustry: 'general',
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// POST /api/auth/admin-reset - Reset any user's password (requires superadmin JWT)
auth.post('/admin-reset', async (c) => {
  // H1 fix: Use proper JWT auth instead of raw JWT_SECRET header comparison
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }
  // Only superadmin and support_admin can reset passwords
  if (payload.role !== 'superadmin' && payload.role !== 'support_admin') {
    return c.json({ error: 'Forbidden — superadmin or support_admin role required' }, 403);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ email: string; new_password: string }>(c, [
    { field: 'email', type: 'email', required: true },
    { field: 'new_password', type: 'string', required: true, minLength: 10 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const user = await c.env.DB.prepare('SELECT id, tenant_id, email, name, role FROM users WHERE email = ?').bind(body.email).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Security S3: Validate new password strength
  const pwCheck = validatePasswordStrength(body.new_password);
  if (!pwCheck.valid) {
    return c.json({ error: 'Weak password', details: pwCheck.errors }, 400);
  }

  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, user.id).run();

  // Clear any login lockout
  await c.env.CACHE.delete(`login_attempts:${body.email}`);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'admin_password_reset', 'auth', 'user', JSON.stringify({ email: body.email }), 'success').run();

  return c.json({ success: true, email: user.email, name: user.name, role: user.role });
});

// ══════════════════════════════════════════════════════════
// Phase 1.3: Email Verification Endpoints
// ══════════════════════════════════════════════════════════

// GET /api/auth/verify-email?token=... - Verify email address
auth.get('/verify-email', async (c) => {
  const token = c.req.query('token');
  if (!token) {
    return c.json({ error: 'Verification token is required' }, 400);
  }

  const storedData = await c.env.CACHE.get(`email_verify:${token}`);
  if (!storedData) {
    return c.json({ error: 'Invalid or expired verification token' }, 400);
  }

  const { userId, tenantId } = JSON.parse(storedData) as { userId: string; email: string; tenantId: string };

  // Mark user as verified
  await c.env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();

  // Delete the token
  await c.env.CACHE.delete(`email_verify:${token}`);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, userId, 'email_verified', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'Email verified successfully. You can now log in.' });
});

// POST /api/auth/resend-verification - Resend email verification
auth.post('/resend-verification', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ email: string }>(c, [
    { field: 'email', type: 'email', required: true },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, tenant_id, email_verified FROM users WHERE email = ? AND status = ?'
  ).bind(body.email, 'active').first();

  if (user && (user.email_verified as number) === 0) {
    const verificationToken = crypto.randomUUID();
    await c.env.CACHE.put(`email_verify:${verificationToken}`, JSON.stringify({
      userId: user.id, email: user.email, tenantId: user.tenant_id,
    }), { expirationTtl: 86400 });

    const verifyUrl = `https://atheon.vantax.co.za/verify-email?token=${verificationToken}`;
    c.executionCtx.waitUntil(
      sendOrQueueEmail(c.env.DB, {
        to: [user.email as string],
        subject: 'Atheon\u2122 \u2014 Verify Your Email',
        htmlBody: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
          <h2 style="color:#0ea5e9;">Email Verification</h2>
          <p>Hi ${user.name},</p>
          <p>Click below to verify your email:</p>
          <p style="text-align:center;margin:24px 0;"><a href="${verifyUrl}" style="background:#0ea5e9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
          <p style="color:#666;font-size:13px;">This link expires in 24 hours.</p>
        </div>`,
        textBody: `Verify your email: ${verifyUrl}`,
        tenantId: user.tenant_id as string,
      }, c.env).catch((err) => { console.error('Phase 1.3: failed to send resend verification email:', err); }),
    );
  }

  // Always return success (don't reveal if user exists)
  return c.json({ success: true, message: 'If an unverified account exists, a new verification email has been sent.' });
});

// ══════════════════════════════════════════════════════════
// Phase 1.4: MFA/TOTP Endpoints
// ══════════════════════════════════════════════════════════

/**
 * Generate a TOTP secret for MFA setup.
 * Uses HMAC-SHA256 to generate a cryptographically random base32-encoded secret.
 */
function generateTOTPSecret(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let result = '';
  let buffer = 0;
  let bitsLeft = 0;
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitsLeft += 8;
    while (bitsLeft >= 5) {
      result += base32Chars[(buffer >> (bitsLeft - 5)) & 31];
      bitsLeft -= 5;
    }
  }
  if (bitsLeft > 0) {
    result += base32Chars[(buffer << (5 - bitsLeft)) & 31];
  }
  return result;
}

/**
 * Verify a TOTP code against a secret.
 * Implements RFC 6238 TOTP with 30-second time step and 1-step window.
 */
async function verifyTOTP(secret: string, code: string): Promise<boolean> {
  const base32Chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  // Decode base32 secret
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of secret.toUpperCase()) {
    const idx = base32Chars.indexOf(char);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  const keyData = new Uint8Array(bytes);

  const now = Math.floor(Date.now() / 1000);
  const timeStep = 30;

  // Check current and adjacent time windows (allows for clock skew)
  for (const offset of [-1, 0, 1]) {
    const counter = Math.floor((now + offset * timeStep) / timeStep);
    const counterBytes = new ArrayBuffer(8);
    const view = new DataView(counterBytes);
    view.setUint32(4, counter, false);

    const key = await crypto.subtle.importKey(
      'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign'],
    );
    const hmac = await crypto.subtle.sign('HMAC', key, counterBytes);
    const hmacBytes = new Uint8Array(hmac);

    const off = hmacBytes[hmacBytes.length - 1] & 0x0f;
    const binary =
      ((hmacBytes[off] & 0x7f) << 24) |
      ((hmacBytes[off + 1] & 0xff) << 16) |
      ((hmacBytes[off + 2] & 0xff) << 8) |
      (hmacBytes[off + 3] & 0xff);
    const otp = (binary % 1000000).toString().padStart(6, '0');

    if (otp === code) return true;
  }
  return false;
}

// POST /api/auth/mfa/setup - Generate TOTP secret and QR code URI
auth.post('/mfa/setup', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const user = await c.env.DB.prepare('SELECT id, email, mfa_enabled, mfa_secret FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  if ((user.mfa_enabled as number) === 1) {
    return c.json({ error: 'MFA is already enabled for this account' }, 400);
  }

  // Generate TOTP secret
  const secret = generateTOTPSecret();
  const issuer = 'Atheon';
  const otpauthUri = `otpauth://totp/${issuer}:${encodeURIComponent(user.email as string)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;

  // Store secret temporarily in KV (pending verification)
  await c.env.CACHE.put(`mfa_setup:${user.id}`, secret, { expirationTtl: 600 });

  return c.json({
    secret,
    otpauthUri,
    message: 'Scan the QR code with your authenticator app, then verify with a code.',
  });
});

// POST /api/auth/mfa/verify - Verify TOTP code and enable MFA
auth.post('/mfa/verify', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ code: string }>(c, [
    { field: 'code', type: 'string', required: true, minLength: 6, maxLength: 6 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Get pending secret from KV
  const pendingSecret = await c.env.CACHE.get(`mfa_setup:${payload.sub}`);
  if (!pendingSecret) {
    return c.json({ error: 'No MFA setup in progress. Call /mfa/setup first.' }, 400);
  }

  // Verify the TOTP code
  const valid = await verifyTOTP(pendingSecret, body.code);
  if (!valid) {
    return c.json({ error: 'Invalid TOTP code. Please try again.' }, 400);
  }

  // Enable MFA and store encrypted secret
  const encryptedMfaSecret = await encrypt(pendingSecret, c.env.ENCRYPTION_KEY);

  // v40: Generate 8 one-time backup codes. Plaintext returned here ONCE;
  // only SHA-256 hashes are persisted.
  const { codes: backupCodes, hashedJson: backupHashes } = await generateBackupCodeSet();

  // v40: Clear any grace window — the user now has MFA active.
  await c.env.DB.prepare(
    'UPDATE users SET mfa_enabled = 1, mfa_secret = ?, mfa_backup_codes = ?, mfa_grace_until = NULL WHERE id = ?'
  ).bind(encryptedMfaSecret, backupHashes, payload.sub).run();

  // Clean up
  await c.env.CACHE.delete(`mfa_setup:${payload.sub}`);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'mfa_enabled', 'auth', 'user', JSON.stringify({ backupCodesIssued: backupCodes.length }), 'success').run();

  return c.json({
    success: true,
    message: 'MFA has been enabled successfully. Store your backup codes in a safe place — they will not be shown again.',
    backupCodes,
  });
});

// POST /api/auth/mfa/validate - Complete login with TOTP code OR backup code
auth.post('/mfa/validate', async (c) => {
  // v40: `code` now accepts either a 6-digit TOTP or an 8-char dash-separated backup
  // code like "a8h3-k1m9" (9 chars with the dash). Widen the length bounds accordingly.
  const { data: body, errors } = await getValidatedJsonBody<{ challenge_token: string; code: string }>(c, [
    { field: 'challenge_token', type: 'string', required: true, minLength: 1 },
    { field: 'code', type: 'string', required: true, minLength: 6, maxLength: 16 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  // Look up MFA challenge
  const challengeData = await c.env.CACHE.get(`mfa_challenge:${body.challenge_token}`);
  if (!challengeData) {
    return c.json({ error: 'Invalid or expired MFA challenge' }, 400);
  }

  const userData = JSON.parse(challengeData) as {
    userId: string; tenantId: string; email: string;
    name: string; role: string; permissions: string[];
  };

  // v40: Fetch both MFA secret and backup-code hashes in one query.
  const user = await c.env.DB.prepare(
    'SELECT mfa_secret, mfa_backup_codes FROM users WHERE id = ?',
  ).bind(userData.userId).first();
  if (!user || !user.mfa_secret) {
    return c.json({ error: 'MFA not configured' }, 400);
  }

  const inputCode = body.code.trim();
  let usedBackupCode = false;
  let backupCodesRemaining: number | null = null;
  let valid = false;

  if (looksLikeBackupCode(inputCode)) {
    // ── Backup-code path ──
    const storedHashesJson = (user.mfa_backup_codes as string | null) || '[]';
    let storedHashes: string[];
    try {
      storedHashes = JSON.parse(storedHashesJson) as string[];
      if (!Array.isArray(storedHashes)) storedHashes = [];
    } catch {
      storedHashes = [];
    }
    const candidate = await hashBackupCode(inputCode);
    const idx = storedHashes.indexOf(candidate);
    if (idx >= 0) {
      // Consume the code — remove it from the stored array (one-time use).
      const remaining = storedHashes.filter((_, i) => i !== idx);
      await c.env.DB.prepare('UPDATE users SET mfa_backup_codes = ? WHERE id = ?')
        .bind(JSON.stringify(remaining), userData.userId).run();
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), userData.tenantId, userData.userId, 'mfa.backup_code_used',
        'auth', 'session', JSON.stringify({ remaining: remaining.length }), 'success',
      ).run();
      usedBackupCode = true;
      backupCodesRemaining = remaining.length;
      valid = true;
    }
  } else {
    // ── TOTP path ──
    const rawMfaSecret = isEncrypted(user.mfa_secret as string)
      ? await decrypt(user.mfa_secret as string, c.env.ENCRYPTION_KEY)
      : user.mfa_secret as string;
    if (!rawMfaSecret) {
      return c.json({ error: 'MFA configuration error' }, 500);
    }
    valid = await verifyTOTP(rawMfaSecret, inputCode);
  }

  if (!valid) {
    logWarn('mfa.validate.failed', {
      requestId: c.get('requestId'),
      tenantId: userData.tenantId,
      userId: userData.userId,
      layer: 'auth',
      action: 'mfa.validate.failed',
    }, { email: userData.email });
    return c.json({ error: 'Invalid TOTP or backup code' }, 401);
  }

  // Clean up challenge
  await c.env.CACHE.delete(`mfa_challenge:${body.challenge_token}`);

  // Clear lockout and issue tokens
  await clearLoginAttempts(c.env.CACHE, userData.email);

  const token = await generateToken({
    sub: userData.userId,
    email: userData.email,
    name: userData.name,
    role: userData.role,
    tenant_id: userData.tenantId,
    permissions: userData.permissions,
  }, c.env.JWT_SECRET);

  // Refresh token
  const refreshToken = crypto.randomUUID();
  await c.env.CACHE.put(`refresh_token:${refreshToken}`, challengeData, { expirationTtl: 7 * 24 * 3600 });

  // Update last login
  await c.env.DB.prepare('UPDATE users SET last_login = datetime(\'now\') WHERE id = ?').bind(userData.userId).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), userData.tenantId, userData.userId, 'login_mfa', 'auth', 'session',
    JSON.stringify({ email: userData.email, method: usedBackupCode ? 'backup_code' : 'totp' }), 'success',
  ).run();

  // Fetch tenant info (industry column removed from tenants).
  const loginTenant = await c.env.DB.prepare('SELECT name, slug FROM tenants WHERE id = ?').bind(userData.tenantId).first();

  // v40: If a backup code was used and the user has < 3 codes remaining, nudge regeneration.
  const mfaBackupCodesLow = usedBackupCode && backupCodesRemaining !== null && backupCodesRemaining < 3;

  return c.json({
    token,
    refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    ...(usedBackupCode ? { mfaMethodUsed: 'backup_code', backupCodesRemaining } : {}),
    ...(mfaBackupCodesLow ? { mfaBackupCodesLow: true } : {}),
    user: {
      id: userData.userId,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      tenantId: userData.tenantId,
      tenantName: loginTenant?.name || '',
      tenantSlug: loginTenant?.slug || '',
      // industry column removed from tenants; fall back to 'general'.
      tenantIndustry: 'general',
      permissions: userData.permissions,
    },
  });
});

// POST /api/auth/mfa/disable - Disable MFA (requires current TOTP code)
auth.post('/mfa/disable', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ code: string }>(c, [
    { field: 'code', type: 'string', required: true, minLength: 6, maxLength: 6 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const user = await c.env.DB.prepare('SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user || (user.mfa_enabled as number) !== 1 || !user.mfa_secret) {
    return c.json({ error: 'MFA is not enabled' }, 400);
  }

  // Decrypt MFA secret before verifying
  const rawDisableSecret = isEncrypted(user.mfa_secret as string)
    ? await decrypt(user.mfa_secret as string, c.env.ENCRYPTION_KEY)
    : user.mfa_secret as string;
  if (!rawDisableSecret) {
    return c.json({ error: 'MFA configuration error' }, 500);
  }
  const valid = await verifyTOTP(rawDisableSecret, body.code);
  if (!valid) {
    return c.json({ error: 'Invalid TOTP code' }, 401);
  }

  // v40: Clear backup codes when MFA is disabled.
  await c.env.DB.prepare(
    'UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, mfa_backup_codes = NULL WHERE id = ?',
  ).bind(payload.sub).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'mfa_disabled', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'MFA has been disabled.' });
});

// POST /api/auth/mfa/regenerate-backup-codes — invalidate old backup codes, issue 8 new.
// Requires a valid TOTP code from the active MFA device for authorization.
auth.post('/mfa/regenerate-backup-codes', async (c) => {
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  const payload = await verifyToken(authHeader.replace('Bearer ', ''), c.env.JWT_SECRET);
  if (!payload) {
    return c.json({ error: 'Invalid token' }, 401);
  }

  const { data: body, errors } = await getValidatedJsonBody<{ code: string }>(c, [
    { field: 'code', type: 'string', required: true, minLength: 6, maxLength: 6 },
  ]);
  if (!body || errors.length > 0) {
    return c.json({ error: 'Invalid input', details: errors }, 400);
  }

  const user = await c.env.DB.prepare(
    'SELECT mfa_secret, mfa_enabled FROM users WHERE id = ?',
  ).bind(payload.sub).first();
  if (!user || (user.mfa_enabled as number) !== 1 || !user.mfa_secret) {
    return c.json({ error: 'MFA is not enabled' }, 400);
  }

  // Require current TOTP for this sensitive operation.
  const rawSecret = isEncrypted(user.mfa_secret as string)
    ? await decrypt(user.mfa_secret as string, c.env.ENCRYPTION_KEY)
    : user.mfa_secret as string;
  if (!rawSecret) {
    return c.json({ error: 'MFA configuration error' }, 500);
  }
  const valid = await verifyTOTP(rawSecret, body.code);
  if (!valid) {
    return c.json({ error: 'Invalid TOTP code' }, 401);
  }

  const { codes: backupCodes, hashedJson: backupHashes } = await generateBackupCodeSet();
  await c.env.DB.prepare('UPDATE users SET mfa_backup_codes = ? WHERE id = ?')
    .bind(backupHashes, payload.sub).run();

  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(
    crypto.randomUUID(), payload.tenant_id, payload.sub, 'mfa.backup_codes_regenerated',
    'auth', 'user', JSON.stringify({ count: backupCodes.length }), 'success',
  ).run();

  return c.json({
    success: true,
    message: 'New backup codes generated. Previous codes are no longer valid.',
    backupCodes,
  });
});

// Phase 6 Fix: Server-side API key generation
// POST /api/auth/api-keys — Generate a new API key (returns plaintext once, stores SHA-256 hash)
auth.post('/api-keys', async (c) => {
  const payload = await verifyToken(c.req.header('Authorization')?.replace('Bearer ', '') || '', c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const { data: body, errors } = await getValidatedJsonBody<{ name?: string }>(c, [
    { field: 'name', type: 'string', required: false, maxLength: 100 },
  ]);
  if (errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Generate key with athn_ prefix
  const rawBytes = new Uint8Array(24);
  crypto.getRandomValues(rawBytes);
  const keyChars = Array.from(rawBytes).map(b => 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[b % 62]).join('');
  const plaintextKey = `athn_${keyChars}`;

  // SHA-256 hash for storage
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(plaintextKey));
  const hashHex = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, '0')).join('');

  const keyId = crypto.randomUUID();
  const keyName = body?.name || 'Default API Key';

  await c.env.DB.prepare(
    'INSERT INTO api_keys (id, tenant_id, user_id, name, key_hash, key_prefix, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, NULL, datetime(\'now\'))'
  ).bind(keyId, payload.tenant_id, payload.sub, keyName, hashHex, plaintextKey.slice(0, 10)).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'api_key_created', 'auth', 'api_key', JSON.stringify({ keyId, name: keyName }), 'success').run();

  return c.json({ id: keyId, name: keyName, key: plaintextKey, prefix: plaintextKey.slice(0, 10), message: 'Store this key securely. It will not be shown again.' }, 201);
});

// GET /api/auth/api-keys — List existing API key metadata (no plaintext)
auth.get('/api-keys', async (c) => {
  const payload = await verifyToken(c.req.header('Authorization')?.replace('Bearer ', '') || '', c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const results = await c.env.DB.prepare(
    'SELECT id, name, key_prefix, created_at, last_used FROM api_keys WHERE user_id = ? AND tenant_id = ? ORDER BY created_at DESC'
  ).bind(payload.sub, payload.tenant_id).all();

  return c.json({
    keys: results.results.map((k: Record<string, unknown>) => ({
      id: k.id, name: k.name, prefix: k.key_prefix, createdAt: k.created_at, lastUsed: k.last_used,
    })),
  });
});

// DELETE /api/auth/api-keys/:id — Revoke an API key
auth.delete('/api-keys/:id', async (c) => {
  const payload = await verifyToken(c.req.header('Authorization')?.replace('Bearer ', '') || '', c.env.JWT_SECRET);
  if (!payload) return c.json({ error: 'Unauthorized' }, 401);

  const keyId = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM api_keys WHERE id = ? AND user_id = ? AND tenant_id = ?').bind(keyId, payload.sub, payload.tenant_id).run();
  return c.json({ success: true });
});

// ─── Phase AY: WorkOS-brokered SAML SSO ──────────────────────────────
//
// Atheon does NOT implement SAML/xmldsig directly — we federate via WorkOS
// because (a) there's no battle-tested xmldsig library that runs in the
// Workers runtime, (b) Big-4 security reviews prefer vendored SAML, and
// (c) per-IdP edge-case handling (encrypted assertions, multi-cert rotation,
// ADFS quirks) is exactly the kind of work a federation broker exists for.
//
// Flow:
//   1. User clicks "Sign in with SSO" on /login and types their work email
//   2. Frontend POSTs to /auth/sso/saml/start with { email }
//   3. We look up the tenant via email domain → fetch its sso_configs row
//   4. If workos_connection_id is set, we mint a WorkOS authorization URL
//      and return it; frontend redirects there
//   5. WorkOS forwards the user to the customer's IdP (Okta / Azure AD /
//      Ping / OneLogin / etc.). User authenticates there
//   6. IdP redirects back to WorkOS; WorkOS redirects back to
//      /auth/sso/saml/callback?code=... on our domain
//   7. We exchange the code with WorkOS for the user profile, upsert the
//      user (creating if missing — auto-provisioning), and mint our JWT

// POST /api/auth/sso/saml/start — kick off SAML SSO for an email
auth.post('/sso/saml/start', async (c) => {
  if (!c.env.WORKOS_API_KEY || !c.env.WORKOS_CLIENT_ID) {
    return c.json({
      error: 'SAML SSO not configured',
      detail: 'WorkOS credentials are not set on this deployment. Contact your platform admin to enable SAML.',
    }, 503);
  }
  let body: { email?: string };
  try { body = await c.req.json<{ email?: string }>(); }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const email = (body.email || '').trim().toLowerCase();
  if (!email || !email.includes('@')) {
    return c.json({ error: 'A valid email is required' }, 400);
  }
  const domain = email.split('@')[1];

  // Locate the tenant via the SSO config's domain_hint. Tenants must opt
  // into SAML by setting workos_connection_id; we never auto-create.
  const config = await c.env.DB.prepare(
    `SELECT s.id, s.tenant_id, s.workos_connection_id, s.default_role, s.auto_provision, t.slug as tenant_slug
       FROM sso_configs s
       JOIN tenants t ON t.id = s.tenant_id
      WHERE s.enabled = 1
        AND s.workos_connection_id IS NOT NULL
        AND s.workos_connection_id != ''
        AND (s.domain_hint = ? OR s.domain_hint = '' OR s.domain_hint IS NULL)
      LIMIT 1`
  ).bind(domain).first<{ id: string; tenant_id: string; workos_connection_id: string; default_role: string; auto_provision: number; tenant_slug: string }>();
  if (!config) {
    return c.json({
      error: 'SAML not enabled for this email domain',
      detail: 'Your organisation has not enabled SAML SSO on Atheon, or your email domain is not registered. Sign in with your password or ask your admin to configure SAML.',
    }, 404);
  }

  // Build the WorkOS authorization URL. WorkOS handles the SAML/xmldsig
  // dance and returns to our callback with an opaque code.
  const redirectUri = c.env.WORKOS_REDIRECT_URI
    || 'https://atheon.vantax.co.za/auth/sso/saml/callback';
  // State is a tenant-scoped CSRF-resistant nonce we re-verify on callback.
  const state = `${config.tenant_id}|${crypto.randomUUID()}`;
  // Persist state with short TTL so the callback can validate it. Reusing
  // the password_reset_tokens schema (token_hash + expires_at) keeps schema
  // surface flat — the user_id column gets the SAML-state marker.
  await c.env.DB.prepare(
    `INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, used, created_at)
     VALUES (?, ?, ?, datetime('now', '+10 minutes'), 0, datetime('now'))`
  ).bind(crypto.randomUUID(), `saml-state:${config.tenant_id}`, state).run();

  const authUrl = new URL('https://api.workos.com/sso/authorize');
  authUrl.searchParams.set('connection', config.workos_connection_id);
  authUrl.searchParams.set('client_id', c.env.WORKOS_CLIENT_ID);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('response_type', 'code');

  return c.json({
    authorizationUrl: authUrl.toString(),
    tenantId: config.tenant_id,
  });
});

// GET /api/auth/sso/saml/callback — exchange code for profile, mint JWT
auth.get('/sso/saml/callback', async (c) => {
  if (!c.env.WORKOS_API_KEY || !c.env.WORKOS_CLIENT_ID) {
    return c.json({ error: 'SAML SSO not configured' }, 503);
  }
  const code = c.req.query('code');
  const state = c.req.query('state');
  if (!code || !state) {
    return c.json({ error: 'Missing code or state' }, 400);
  }
  // Validate state — must exist, be unused, and within TTL.
  const stateRow = await c.env.DB.prepare(
    `SELECT id, user_id, expires_at, used FROM password_reset_tokens
      WHERE token_hash = ? LIMIT 1`
  ).bind(state).first<{ id: string; user_id: string; expires_at: string; used: number }>();
  if (!stateRow || stateRow.used || !stateRow.user_id?.startsWith('saml-state:')) {
    return c.json({ error: 'Invalid SAML state' }, 400);
  }
  if (new Date(stateRow.expires_at) < new Date()) {
    return c.json({ error: 'SAML state expired — please try again' }, 400);
  }
  await c.env.DB.prepare(
    `UPDATE password_reset_tokens SET used = 1 WHERE id = ?`
  ).bind(stateRow.id).run();
  const expectedTenantId = stateRow.user_id.slice('saml-state:'.length);

  // Exchange the WorkOS code for a profile via the WorkOS REST API.
  const profileRes = await fetch('https://api.workos.com/sso/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: c.env.WORKOS_CLIENT_ID,
      client_secret: c.env.WORKOS_API_KEY,
      grant_type: 'authorization_code',
      code,
    }),
  });
  if (!profileRes.ok) {
    return c.json({ error: 'SAML profile exchange failed', status: profileRes.status }, 502);
  }
  const profileData = await profileRes.json() as {
    profile?: {
      id?: string; email?: string; first_name?: string; last_name?: string;
      organization_id?: string; connection_id?: string;
      raw_attributes?: Record<string, unknown>;
    };
    access_token?: string;
  };
  const profile = profileData.profile;
  if (!profile?.email) {
    return c.json({ error: 'SAML profile missing email' }, 502);
  }
  const email = profile.email.toLowerCase();

  // Verify the WorkOS connection matches the tenant we redirected for.
  const config = await c.env.DB.prepare(
    `SELECT id, tenant_id, default_role, auto_provision, workos_connection_id
       FROM sso_configs WHERE tenant_id = ? AND enabled = 1 LIMIT 1`
  ).bind(expectedTenantId).first<{ id: string; tenant_id: string; default_role: string; auto_provision: number; workos_connection_id: string }>();
  if (!config || profile.connection_id !== config.workos_connection_id) {
    return c.json({ error: 'SAML connection mismatch — please contact your administrator' }, 403);
  }

  // Upsert the user. Auto-provision new users into the tenant's
  // configured default role when auto_provision is enabled.
  let userRow = await c.env.DB.prepare(
    `SELECT id, email, name, role, tenant_id, permissions, status
       FROM users WHERE tenant_id = ? AND email = ? LIMIT 1`
  ).bind(config.tenant_id, email).first<{ id: string; email: string; name: string; role: string; tenant_id: string; permissions: string; status: string }>();

  if (!userRow) {
    if (!config.auto_provision) {
      return c.json({
        error: 'Account not found',
        detail: 'Your SAML login succeeded but this email has no Atheon user yet, and auto-provisioning is disabled for your tenant. Ask your admin to invite you first.',
      }, 403);
    }
    const newId = crypto.randomUUID();
    const name = [profile.first_name, profile.last_name].filter(Boolean).join(' ').trim() || email;
    await c.env.DB.prepare(
      `INSERT INTO users (id, tenant_id, email, name, given_name, family_name, external_id, role, status, permissions, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', '["read"]', datetime('now'), datetime('now'))`
    ).bind(
      newId, config.tenant_id, email, name,
      profile.first_name ?? null, profile.last_name ?? null,
      profile.id ?? null, config.default_role || 'analyst',
    ).run();
    userRow = {
      id: newId, email, name, role: config.default_role || 'analyst',
      tenant_id: config.tenant_id, permissions: '["read"]', status: 'active',
    };
    await c.env.DB.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
       VALUES (?, ?, ?, 'auth.saml.provisioned', 'auth', ?, ?, 'success', datetime('now'))`
    ).bind(crypto.randomUUID(), config.tenant_id, newId, `user/${newId}`, JSON.stringify({ email, connectionId: profile.connection_id })).run();
  } else if (userRow.status === 'deactivated' || userRow.status === 'suspended') {
    return c.json({
      error: 'Account inactive',
      detail: 'Your Atheon account has been deactivated. Contact your administrator.',
    }, 403);
  }

  await c.env.DB.prepare(
    `UPDATE users SET last_login = datetime('now'), updated_at = datetime('now') WHERE id = ?`
  ).bind(userRow.id).run();
  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
     VALUES (?, ?, ?, 'auth.saml.login', 'auth', ?, ?, 'success', datetime('now'))`
  ).bind(crypto.randomUUID(), config.tenant_id, userRow.id, `user/${userRow.id}`, JSON.stringify({ email, connectionId: profile.connection_id })).run();

  const token = await generateToken({
    sub: userRow.id,
    email: userRow.email,
    name: userRow.name,
    role: userRow.role,
    tenant_id: userRow.tenant_id,
    permissions: JSON.parse(userRow.permissions || '[]'),
  }, c.env.JWT_SECRET);

  // Redirect to the frontend with the token in a fragment so the SPA can
  // pick it up without it ever hitting server logs. Frontend reads the
  // fragment, persists via setToken(), then replaces history to scrub it.
  const frontendBase = c.env.SSO_REDIRECT_URI?.replace(/\/api\/.*$/, '') || 'https://atheon.vantax.co.za';
  return c.redirect(`${frontendBase}/login#sso-token=${encodeURIComponent(token)}`, 302);
});

export default auth;
