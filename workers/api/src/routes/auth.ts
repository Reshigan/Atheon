import { Hono } from 'hono';
import type { Env } from '../types';
import { generateToken, verifyToken, hashPassword, verifyPassword } from '../middleware/auth';

const auth = new Hono<{ Bindings: Env }>();

// POST /api/auth/register
auth.post('/register', async (c) => {
  const body = await c.req.json<{
    email: string; password: string; name: string; tenant_slug?: string;
  }>();

  if (!body.email || !body.password || !body.name) {
    return c.json({ error: 'Email, password and name are required' }, 400);
  }

  if (body.password.length < 8) {
    return c.json({ error: 'Password must be at least 8 characters' }, 400);
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

  await c.env.DB.prepare(
    'INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(userId, tenant.id, body.email, body.name, 'analyst', passwordHash, '["read"]').run();

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
    user: {
      id: userId,
      email: body.email,
      name: body.name,
      role: 'analyst',
      tenantId: tenant.id,
      tenantName: tenant.name,
      tenantSlug: tenant.slug,
      permissions: ['read'],
    },
  }, 201);
});

// POST /api/auth/login
auth.post('/login', async (c) => {
  const body = await c.req.json<{ email: string; password: string; tenant_slug?: string }>();

  if (!body.email || !body.password) {
    return c.json({ error: 'Email and password are required' }, 400);
  }

  // Find user by email
  const user = await c.env.DB.prepare(
    'SELECT u.*, t.slug as tenant_slug, t.name as tenant_name FROM users u JOIN tenants t ON u.tenant_id = t.id WHERE u.email = ? AND u.status = ?'
  ).bind(body.email, 'active').first();

  if (!user) {
    return c.json({ error: 'Invalid credentials' }, 401);
  }

  // Verify password if hash exists
  if (user.password_hash) {
    const valid = await verifyPassword(body.password, user.password_hash as string);
    if (!valid) {
      // Log failed attempt
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), user.tenant_id, user.id, 'login_failed', 'auth', 'session', JSON.stringify({ email: body.email, reason: 'invalid_password' }), 'failure').run();
      return c.json({ error: 'Invalid credentials' }, 401);
    }
  }

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

  return c.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      tenantId: user.tenant_id,
      tenantName: user.tenant_name,
      tenantSlug: user.tenant_slug,
      permissions: JSON.parse(user.permissions as string || '[]'),
    },
  });
});

// POST /api/auth/demo-login (for demo access without password)
auth.post('/demo-login', async (c) => {
  const body = await c.req.json<{ tenant_slug?: string; role?: string }>();
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

  const body = await c.req.json<{ current_password?: string; new_password: string }>();

  if (!body.new_password || body.new_password.length < 8) {
    return c.json({ error: 'New password must be at least 8 characters' }, 400);
  }

  const user = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(payload.sub).first();
  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }

  // Verify current password if it exists
  if (user.password_hash && body.current_password) {
    const valid = await verifyPassword(body.current_password, user.password_hash as string);
    if (!valid) {
      return c.json({ error: 'Current password is incorrect' }, 401);
    }
  }

  const newHash = await hashPassword(body.new_password);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(newHash, payload.sub).run();

  // Log audit
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), payload.tenant_id, payload.sub, 'change_password', 'auth', 'user', '{}', 'success').run();

  return c.json({ success: true, message: 'Password changed successfully' });
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

export default auth;
