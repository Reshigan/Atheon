import { Hono } from 'hono';
import type { AppBindings } from '../types';
import { generateToken, verifyToken, hashPassword, verifyPassword } from '../middleware/auth';
import { getValidatedJsonBody } from '../middleware/validation';
import { encrypt, decrypt, isEncrypted } from '../services/encryption';

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
  const current = await cache.get(key);
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

  // Queue verification email
  const verifyUrl = `https://atheon.vantax.co.za/verify-email?token=${verificationToken}`;
  await c.env.DB.prepare(
    'INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
  ).bind(
    crypto.randomUUID(), tenant.id, JSON.stringify([body.email]),
    'Atheon\u2122 \u2014 Verify Your Email',
    `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
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
    `Verify your email: ${verifyUrl}\nThis link expires in 24 hours.`,
    'pending',
  ).run().catch((err) => { console.error('Phase 1.3: failed to queue verification email:', err); });

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
      tenantIndustry: tenant.industry || 'general',
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

  // BUG-14: Prevent cross-tenant login collisions (same email in multiple tenants)
  let user;
  if (body.tenant_slug) {
    const loginTenantRow = await c.env.DB.prepare('SELECT id FROM tenants WHERE slug = ?').bind(body.tenant_slug).first();
    if (!loginTenantRow) {
      await recordFailedLogin(c.env.CACHE, body.email);
      return c.json({ error: 'Invalid credentials' }, 401);
    }
    user = await c.env.DB.prepare(
      'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.tenant_id = ? AND u.status = ?'
    ).bind(body.email, loginTenantRow.id, 'active').first();
  } else {
    const matches = await c.env.DB.prepare(
      'SELECT COUNT(*) as count FROM users WHERE email = ? AND status = ?'
    ).bind(body.email, 'active').first<{ count: number }>();
    if ((matches?.count || 0) > 1) {
      return c.json({ error: 'Tenant selection required', message: 'This email exists in multiple workspaces. Please provide tenant_slug.' }, 400);
    }
    user = await c.env.DB.prepare(
      'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
    ).bind(body.email, 'active').first();
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
    // Generate a short-lived MFA challenge token
    const mfaChallengeToken = crypto.randomUUID();
    await c.env.CACHE.put(`mfa_challenge:${mfaChallengeToken}`, JSON.stringify({
      userId: user.id, tenantId: user.tenant_id, email: user.email,
      name: user.name, role: user.role, permissions: JSON.parse(user.permissions as string || '[]'),
    }), { expirationTtl: 300 }); // 5 minutes

    return c.json({
      mfaRequired: true,
      mfaChallengeToken,
      message: 'Please provide your TOTP code to complete login.',
    });
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

  // Fetch tenant industry for the user's company
  const loginTenant = await c.env.DB.prepare('SELECT industry FROM tenants WHERE id = ?').bind(user.tenant_id).first();

  return c.json({
    token,
    refreshToken,
    expiresIn: 86400,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      tenantIndustry: loginTenant?.industry || 'general',
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

  return c.json({ token: newToken, refreshToken: newRefreshToken, expiresIn: 86400 });
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
      tenantIndustry: tenant.industry || 'general',
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
  const exp = (payload.exp as number) || Math.floor(Date.now() / 1000) + 86400;
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

    // Queue email for sending
    const resetUrl = `https://atheon.vantax.co.za/reset-password?token=${resetToken}`;
    await c.env.DB.prepare(
      'INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(
      crypto.randomUUID(),
      user.tenant_id,
      JSON.stringify([user.email]),
      'Atheon™ — Password Reset Request',
      `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#0ea5e9;">Atheon™ Password Reset</h2>
        <p>Hi ${user.name},</p>
        <p>We received a request to reset your password. Click the button below to set a new password:</p>
        <p style="text-align:center;margin:24px 0;">
          <a href="${resetUrl}" style="background:#0ea5e9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Reset Password</a>
        </p>
        <p style="color:#666;font-size:13px;">This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
        <p style="color:#9ca3af;font-size:12px;">Atheon™ Enterprise Intelligence Platform</p>
      </div>`,
      `Reset your Atheon password: ${resetUrl}\nThis link expires in 1 hour.`,
      'pending',
    ).run().catch((err) => { console.error('BUG-23: failed to queue forgot-password email:', err); });

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
      'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?'
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
  // BUG-11: SSO redirect URI from env var
  const redirectUri = c.env.SSO_REDIRECT_URI || 'https://atheon.vantax.co.za/login';
  // BUG-16: Sign SSO state with HMAC to prevent tampering
  const statePayload = JSON.stringify({ tenant_slug: slug, provider: body.provider, ts: Date.now() });
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

  let stateData: { tenant_slug: string; provider: string; ts?: number; sig?: string };
  try {
    stateData = JSON.parse(atob(body.state));
  } catch {
    return c.json({ error: 'Invalid state parameter' }, 400);
  }

  // BUG-16: Verify HMAC signature on state to prevent tampering
  if (stateData.sig) {
    const { sig, ...payloadWithoutSig } = stateData;
    const verifyPayload = JSON.stringify(payloadWithoutSig);
    const verifyKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(c.env.JWT_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const expectedSig = await crypto.subtle.sign('HMAC', verifyKey, new TextEncoder().encode(verifyPayload));
    const expectedSigHex = Array.from(new Uint8Array(expectedSig)).map(b => b.toString(16).padStart(2, '0')).join('');
    if (sig !== expectedSigHex) {
      return c.json({ error: 'Invalid state signature — possible CSRF attack' }, 400);
    }
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
  const directoryTenantId = issuerUrl.split('/')[3] || 'common';
  // BUG-11: SSO redirect URI from env var
  const redirectUri = c.env.SSO_REDIRECT_URI || 'https://atheon.vantax.co.za/login';

  // Exchange authorization code for tokens with Azure AD
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

  // Decode the ID token to get user info (JWT payload is base64url-encoded)
  const idTokenParts = tokenData.id_token.split('.');
  if (idTokenParts.length !== 3) {
    return c.json({ error: 'Invalid ID token format' }, 401);
  }

  let idPayload: { email?: string; preferred_username?: string; name?: string; sub?: string; oid?: string };
  try {
    const padded = idTokenParts[1].replace(/-/g, '+').replace(/_/g, '/');
    const decoded = atob(padded + '='.repeat((4 - padded.length % 4) % 4));
    idPayload = JSON.parse(decoded);
  } catch {
    return c.json({ error: 'Failed to decode ID token' }, 401);
  }

  const ssoEmail = (idPayload.email || idPayload.preferred_username || '').toLowerCase();
  const ssoName = idPayload.name || ssoEmail.split('@')[0];

  if (!ssoEmail) {
    return c.json({ error: 'No email found in SSO token' }, 401);
  }

  // Find or auto-provision user
  let user = await c.env.DB.prepare(
    'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug, t.industry as tenant_industry FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.tenant_id = ?'
  ).bind(ssoEmail, tenant.id).first();

  if (!user && sso.auto_provision) {
    // Auto-provision new user
    const userId = crypto.randomUUID();
    const defaultRole = (sso.default_role as string) || 'analyst';
    const defaultPerms = defaultRole === 'admin' ? '["*"]' : '["read"]';

    await c.env.DB.prepare(
      'INSERT INTO users (id, tenant_id, email, name, role, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(userId, tenant.id, ssoEmail, ssoName, defaultRole, defaultPerms, 'active').run();

    user = await c.env.DB.prepare(
      'SELECT u.*, t.name as tenant_name, t.slug as tenant_slug, t.industry as tenant_industry FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.id = ?'
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
      tenantIndustry: user.tenant_industry || 'general',
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
    await c.env.DB.prepare(
      'INSERT INTO email_queue (id, tenant_id, recipients, subject, html_body, text_body, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
    ).bind(
      crypto.randomUUID(), user.tenant_id, JSON.stringify([user.email]),
      'Atheon\u2122 \u2014 Verify Your Email',
      `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px;">
        <h2 style="color:#0ea5e9;">Email Verification</h2>
        <p>Hi ${user.name},</p>
        <p>Click below to verify your email:</p>
        <p style="text-align:center;margin:24px 0;"><a href="${verifyUrl}" style="background:#0ea5e9;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Verify Email</a></p>
        <p style="color:#666;font-size:13px;">This link expires in 24 hours.</p>
      </div>`,
      `Verify your email: ${verifyUrl}`,
      'pending',
    ).run().catch((err) => { console.error('Phase 1.3: failed to queue resend verification email:', err); });
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
  await c.env.DB.prepare(
    'UPDATE users SET mfa_enabled = 1, mfa_secret = ? WHERE id = ?'
  ).bind(encryptedMfaSecret, payload.sub).run();

  // Clean up
  await c.env.CACHE.delete(`mfa_setup:${payload.sub}`);

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'mfa_enabled', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'MFA has been enabled successfully.' });
});

// POST /api/auth/mfa/validate - Complete login with TOTP code
auth.post('/mfa/validate', async (c) => {
  const { data: body, errors } = await getValidatedJsonBody<{ challenge_token: string; code: string }>(c, [
    { field: 'challenge_token', type: 'string', required: true, minLength: 1 },
    { field: 'code', type: 'string', required: true, minLength: 6, maxLength: 6 },
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

  // Get user's MFA secret
  const user = await c.env.DB.prepare('SELECT mfa_secret FROM users WHERE id = ?').bind(userData.userId).first();
  if (!user || !user.mfa_secret) {
    return c.json({ error: 'MFA not configured' }, 400);
  }

  // Verify TOTP code — decrypt secret if encrypted
  const rawMfaSecret = isEncrypted(user.mfa_secret as string)
    ? await decrypt(user.mfa_secret as string, c.env.ENCRYPTION_KEY)
    : user.mfa_secret as string;
  if (!rawMfaSecret) {
    return c.json({ error: 'MFA configuration error' }, 500);
  }
  const valid = await verifyTOTP(rawMfaSecret, body.code);
  if (!valid) {
    return c.json({ error: 'Invalid TOTP code' }, 401);
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
  ).bind(crypto.randomUUID(), userData.tenantId, userData.userId, 'login_mfa', 'auth', 'session', JSON.stringify({ email: userData.email }), 'success').run();

  // Fetch tenant info
  const loginTenant = await c.env.DB.prepare('SELECT name, slug, industry FROM tenants WHERE id = ?').bind(userData.tenantId).first();

  return c.json({
    token,
    refreshToken,
    expiresIn: 86400,
    user: {
      id: userData.userId,
      email: userData.email,
      name: userData.name,
      role: userData.role,
      tenantId: userData.tenantId,
      tenantName: loginTenant?.name || '',
      tenantSlug: loginTenant?.slug || '',
      tenantIndustry: loginTenant?.industry || 'general',
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

  await c.env.DB.prepare('UPDATE users SET mfa_enabled = 0, mfa_secret = NULL WHERE id = ?').bind(payload.sub).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'mfa_disabled', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'MFA has been disabled.' });
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

export default auth;
