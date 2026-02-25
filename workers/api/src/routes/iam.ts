import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { hashPassword } from '../middleware/auth';
import { getWelcomeEmailTemplate, sendOrQueueEmail } from '../services/email';

const iam = new Hono<AppBindings>();

function getTenantId(c: { get: (key: string) => unknown }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  return auth?.tenantId || 'vantax';
}

// GET /api/iam/policies
iam.get('/policies', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM iam_policies WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((p: Record<string, unknown>) => ({
    id: p.id,
    tenantId: p.tenant_id,
    name: p.name,
    description: p.description,
    type: p.type,
    rules: JSON.parse(p.rules as string || '[]'),
    createdAt: p.created_at,
  }));

  return c.json({ policies: formatted, total: formatted.length });
});

// POST /api/iam/policies
iam.post('/policies', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    name: string; description?: string; type?: string; rules?: unknown[];
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'description', type: 'string', required: false, maxLength: 500 },
    { field: 'type', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO iam_policies (id, tenant_id, name, description, type, rules) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.name, body.description || '', body.type || 'rbac', JSON.stringify(body.rules || [])).run();

  return c.json({ id, name: body.name }, 201);
});

// DELETE /api/iam/policies/:id
iam.delete('/policies/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM iam_policies WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

// GET /api/iam/roles
iam.get('/roles', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT role, COUNT(*) as user_count FROM users WHERE tenant_id = ? GROUP BY role'
  ).bind(tenantId).all();

  const roles = [
    { id: 'admin', name: 'Administrator', description: 'Full platform access', level: 100 },
    { id: 'executive', name: 'Executive', description: 'C-Suite view with approval authority', level: 90 },
    { id: 'manager', name: 'Manager', description: 'Department-level management', level: 70 },
    { id: 'analyst', name: 'Analyst', description: 'Read-only analytics access', level: 50 },
    { id: 'operator', name: 'Operator', description: 'Operational task execution', level: 40 },
    { id: 'viewer', name: 'Viewer', description: 'Dashboard viewing only', level: 10 },
  ].map(r => ({
    ...r,
    userCount: (results.results.find((u: Record<string, unknown>) => u.role === r.id) as Record<string, unknown> | undefined)?.user_count || 0,
  }));

  return c.json({ roles });
});

// GET /api/iam/users
iam.get('/users', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT id, email, name, role, permissions, status, last_login, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all();

  const formatted = results.results.map((u: Record<string, unknown>) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    permissions: JSON.parse(u.permissions as string || '[]'),
    status: u.status,
    lastLogin: u.last_login,
    createdAt: u.created_at,
  }));

  return c.json({ users: formatted, total: formatted.length });
});

// POST /api/iam/users
iam.post('/users', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    email: string; name: string; role?: string; permissions?: string[]; send_welcome_email?: boolean;
  }>(c, [
    { field: 'email', type: 'email', required: true },
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'role', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Check if user already exists in this tenant
  const existing = await c.env.DB.prepare(
    'SELECT id FROM users WHERE email = ? AND tenant_id = ?'
  ).bind(body.email, tenantId).first();
  if (existing) return c.json({ error: 'User with this email already exists' }, 409);

  // Generate temporary password
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let tempPassword = '';
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 12; i++) {
    tempPassword += chars[randomBytes[i] % chars.length];
  }

  const passwordHash = await hashPassword(tempPassword);
  const id = crypto.randomUUID();
  const role = body.role || 'analyst';
  const permissions = body.permissions || (role === 'admin' ? ['*'] : ['read']);

  await c.env.DB.prepare(
    'INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.email, body.name, role, passwordHash, JSON.stringify(permissions), 'active').run();

  // Send welcome email with temporary password
  const shouldSendEmail = body.send_welcome_email !== false; // default true
  if (shouldSendEmail) {
    const loginUrl = 'https://atheon.vantax.co.za/login';
    const template = getWelcomeEmailTemplate(body.name, body.email, tempPassword, loginUrl, 'dark');
    await sendOrQueueEmail(c.env.DB, {
      to: [body.email],
      subject: 'Welcome to Atheon\u2122 — Your Account Has Been Created',
      htmlBody: template.html,
      textBody: template.text,
      tenantId,
    }, c.env).catch(() => {}); // Don't fail user creation if email fails
  }

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, 'user_created', 'iam', 'user', JSON.stringify({ email: body.email, role }), 'success').run().catch(() => {});

  return c.json({ id, email: body.email, name: body.name, role, tempPassword }, 201);
});

// DELETE /api/iam/users/:id
iam.delete('/users/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
});

// POST /api/iam/users/:id/resend-welcome - Reset password and resend welcome email
iam.post('/users/:id/resend-welcome', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.req.param('id');

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ id: string; email: string; name: string; role: string }>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  // Generate new temporary password
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let tempPassword = '';
  const randomBytes = new Uint8Array(12);
  crypto.getRandomValues(randomBytes);
  for (let i = 0; i < 12; i++) {
    tempPassword += chars[randomBytes[i] % chars.length];
  }

  const passwordHash = await hashPassword(tempPassword);
  await c.env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ? AND tenant_id = ?')
    .bind(passwordHash, userId, tenantId).run();

  const loginUrl = 'https://atheon.vantax.co.za/login';
  const template = getWelcomeEmailTemplate(user.name, user.email, tempPassword, loginUrl, 'dark');
  await sendOrQueueEmail(c.env.DB, {
    to: [user.email],
    subject: 'Welcome to Atheon\u2122 \u2014 Your Account Has Been Created',
    htmlBody: template.html,
    textBody: template.text,
    tenantId,
  }, c.env).catch(() => null);

  return c.json({ success: true, email: user.email, tempPassword });
});

// GET /api/iam/sso
iam.get('/sso', async (c) => {
  const tenantId = getTenantId(c);
  const results = await c.env.DB.prepare(
    'SELECT * FROM sso_configs WHERE tenant_id = ?'
  ).bind(tenantId).all();

  const formatted = results.results.map((s: Record<string, unknown>) => ({
    id: s.id,
    provider: s.provider,
    clientId: s.client_id,
    issuerUrl: s.issuer_url,
    enabled: !!s.enabled,
    autoProvision: !!s.auto_provision,
    defaultRole: s.default_role,
    domainHint: s.domain_hint,
  }));

  return c.json({ configs: formatted });
});

// POST /api/iam/sso
iam.post('/sso', async (c) => {
  const tenantId = getTenantId(c);
  const { data: body, errors } = await getValidatedJsonBody<{
    provider: string; client_id: string; issuer_url: string;
    auto_provision?: boolean; default_role?: string; domain_hint?: string;
  }>(c, [
    { field: 'provider', type: 'string', required: true, minLength: 1, maxLength: 64 },
    { field: 'client_id', type: 'string', required: true, minLength: 1, maxLength: 200 },
    { field: 'issuer_url', type: 'url', required: true },
    { field: 'default_role', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO sso_configs (id, tenant_id, provider, client_id, issuer_url, auto_provision, default_role, domain_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, tenantId, body.provider, body.client_id, body.issuer_url, body.auto_provision ? 1 : 0, body.default_role || 'analyst', body.domain_hint || '').run();

  return c.json({ id }, 201);
});

export default iam;
