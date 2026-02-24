import { Hono } from 'hono';
import type { Env } from '../types';

const iam = new Hono<{ Bindings: Env }>();

// GET /api/iam/policies?tenant_id=
iam.get('/policies', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; name: string; description?: string; type?: string; rules?: unknown[];
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO iam_policies (id, tenant_id, name, description, type, rules) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.name, body.description || '', body.type || 'rbac', JSON.stringify(body.rules || [])).run();

  return c.json({ id, name: body.name }, 201);
});

// DELETE /api/iam/policies/:id
iam.delete('/policies/:id', async (c) => {
  const id = c.req.param('id');
  await c.env.DB.prepare('DELETE FROM iam_policies WHERE id = ?').bind(id).run();
  return c.json({ success: true });
});

// GET /api/iam/roles?tenant_id=
iam.get('/roles', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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

// GET /api/iam/users?tenant_id=
iam.get('/users', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; email: string; name: string; role?: string; permissions?: string[];
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO users (id, tenant_id, email, name, role, permissions) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.email, body.name, body.role || 'analyst', JSON.stringify(body.permissions || [])).run();

  return c.json({ id, email: body.email, name: body.name, role: body.role || 'analyst' }, 201);
});

// GET /api/iam/sso?tenant_id=
iam.get('/sso', async (c) => {
  const tenantId = c.req.query('tenant_id') || 'vantax';
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
  const body = await c.req.json<{
    tenant_id: string; provider: string; client_id: string; issuer_url: string;
    auto_provision?: boolean; default_role?: string; domain_hint?: string;
  }>();

  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    'INSERT INTO sso_configs (id, tenant_id, provider, client_id, issuer_url, auto_provision, default_role, domain_hint) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, body.tenant_id, body.provider, body.client_id, body.issuer_url, body.auto_provision ? 1 : 0, body.default_role || 'analyst', body.domain_hint || '').run();

  return c.json({ id }, 201);
});

export default iam;
