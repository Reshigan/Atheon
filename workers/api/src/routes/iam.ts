import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { getValidatedJsonBody } from '../middleware/validation';
import { hashPassword } from '../middleware/auth';
import { getWelcomeEmailTemplate, sendOrQueueEmail } from '../services/email';

const iam = new Hono<AppBindings>();

/** Role hierarchy levels — higher number = more privilege */
const ROLE_LEVELS: Record<string, number> = {
  superadmin: 120, support_admin: 110, admin: 100, executive: 90,
  board_member: 80, manager: 70, analyst: 50, operator: 40, auditor: 30, viewer: 10,
};

/** Only roles in ROLE_LEVELS are valid — reject unknown strings like 'system_admin' */
const VALID_ROLES = new Set(Object.keys(ROLE_LEVELS));

/** Superadmin/support_admin can override tenant via ?tenant_id= query param */
const CROSS_TENANT_ROLES = new Set(['superadmin', 'support_admin']);
function getTenantId(c: { get: (key: string) => unknown; req: { query: (key: string) => string | undefined } }): string {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth?.tenantId) throw new Error('No tenant context available');
  const defaultTenantId = auth.tenantId;
  if (CROSS_TENANT_ROLES.has(auth?.role || '')) {
    return c.req.query('tenant_id') || defaultTenantId;
  }
  return defaultTenantId;
}

// M12: Pagination helper
function parsePagination(c: { req: { query: (key: string) => string | undefined } }): { page: number; limit: number; offset: number } {
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  return { page, limit, offset: (page - 1) * limit };
}

// GET /api/iam/policies (M12: paginated)
iam.get('/policies', async (c) => {
  const tenantId = getTenantId(c);
  const { page, limit, offset } = parsePagination(c);

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM iam_policies WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();
  const total = countResult?.total || 0;

  const results = await c.env.DB.prepare(
    'SELECT * FROM iam_policies WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();

  const formatted = results.results.map((p: Record<string, unknown>) => ({
    id: p.id,
    tenantId: p.tenant_id,
    name: p.name,
    description: p.description,
    type: p.type,
    rules: JSON.parse(p.rules as string || '[]'),
    createdAt: p.created_at,
  }));

  return c.json({ policies: formatted, total, page, limit, totalPages: Math.ceil(total / limit) });
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
    { id: 'superadmin', name: 'Super Admin', description: 'Full platform access — can create and reset companies, manage all tenants', level: 120 },
    { id: 'support_admin', name: 'Support Admin', description: 'Configure catalysts, manage users and roles, ERP connections, and system connectivity', level: 110 },
    { id: 'admin', name: 'Company Admin', description: 'Full access within own tenant — manage users, catalysts, and settings', level: 100 },
    { id: 'executive', name: 'Executive', description: 'C-Suite strategic view — Apex intelligence, briefings, risk alerts, and approvals', level: 90 },
    { id: 'board_member', name: 'Board Member', description: 'Quarterly digest only — recovered savings, ROI multiple, critical risk delta. No operational surfaces.', level: 80 },
    { id: 'manager', name: 'Manager', description: 'Department-level access — dashboards, catalysts, process intelligence, and team oversight', level: 70 },
    { id: 'analyst', name: 'Analyst', description: 'Read-only analytics — dashboards, process metrics, conversational AI, and reports', level: 50 },
    { id: 'operator', name: 'Operator', description: 'Operational execution — dashboards, catalyst tasks, and process monitoring', level: 40 },
    { id: 'auditor', name: 'Auditor', description: 'Read-only compliance + audit log access for internal/external audit (SOC 2, POPIA). No operational surfaces.', level: 30 },
    { id: 'viewer', name: 'Viewer', description: 'View-only access — dashboard overview only', level: 10 },
  ].map(r => ({
    ...r,
    userCount: (results.results.find((u: Record<string, unknown>) => u.role === r.id) as Record<string, unknown> | undefined)?.user_count || 0,
  }));

  return c.json({ roles });
});

// GET /api/iam/users (M12: paginated)
iam.get('/users', async (c) => {
  const tenantId = getTenantId(c);
  const { page, limit, offset } = parsePagination(c);

  const countResult = await c.env.DB.prepare('SELECT COUNT(*) as total FROM users WHERE tenant_id = ?').bind(tenantId).first<{ total: number }>();
  const total = countResult?.total || 0;

  const results = await c.env.DB.prepare(
    'SELECT id, email, name, role, permissions, status, last_login, created_at FROM users WHERE tenant_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?'
  ).bind(tenantId, limit, offset).all();

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

  return c.json({ users: formatted, total, page, limit, totalPages: Math.ceil(total / limit) });
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

  // Reject unknown role strings (e.g. 'system_admin') that could bypass hierarchy checks
  if (!VALID_ROLES.has(role)) {
    return c.json({ error: 'Invalid role', message: `Role "${role}" is not valid. Valid roles: ${[...VALID_ROLES].join(', ')}` }, 400);
  }

  // Prevent privilege escalation: caller cannot assign a role higher than their own
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
  const requestedLevel = ROLE_LEVELS[role] ?? 0;
  if (requestedLevel > callerLevel) {
    return c.json({ error: 'Forbidden', message: `Cannot assign role "${role}" — exceeds your own privilege level` }, 403);
  }

  const permissions = body.permissions || (role === 'superadmin' || role === 'support_admin' || role === 'admin' ? ['*'] : ['read']);

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

// PUT /api/iam/users/:id — Update user role, status, name, or permissions
iam.put('/users/:id', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;

  const { data: body, errors } = await getValidatedJsonBody<{
    role?: string; status?: string; name?: string; permissions?: string[];
  }>(c, [
    // `custom:<uuid>` is up to 43 chars; allow 64 to be safe
    { field: 'role', type: 'string', required: false, maxLength: 64 },
    { field: 'status', type: 'string', required: false, maxLength: 32 },
    { field: 'name', type: 'string', required: false, maxLength: 100 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  // Fetch the target user to verify they exist and check current role
  const target = await c.env.DB.prepare(
    'SELECT id, role, email FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ id: string; role: string; email: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);

  // Prevent self-demotion below admin (protect against accidental lockout)
  if (auth?.userId === userId && body.role && ROLE_LEVELS[body.role] < ROLE_LEVELS['admin']) {
    return c.json({ error: 'Forbidden', message: 'Cannot demote your own account below admin' }, 403);
  }
  // Prevent self-suspension (protect against accidental lockout)
  if (auth?.userId === userId && body.status && body.status !== 'active') {
    return c.json({ error: 'Forbidden', message: 'Cannot suspend or deactivate your own account' }, 403);
  }

  // Prevent modifying users with higher privilege than caller
  const targetLevel = ROLE_LEVELS[target.role] ?? 0;
  if (targetLevel > callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Cannot modify a user with higher privilege than your own' }, 403);
  }

  // Company admins cannot modify peer admins (same level) — only superadmins can
  const callerRole = auth?.role || '';
  if (callerRole === 'admin' && targetLevel >= callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Company admins cannot modify other admins' }, 403);
  }

  // Validate new role if provided
  if (body.role) {
    // Custom roles carry a `custom:<id>` prefix — verify the custom role exists for this tenant
    if (body.role.startsWith('custom:')) {
      const customId = body.role.slice('custom:'.length);
      if (!customId) return c.json({ error: 'Invalid role', message: 'custom role id is required' }, 400);
      const customRow = await c.env.DB.prepare(
        'SELECT id FROM iam_custom_roles WHERE id = ? AND tenant_id = ?'
      ).bind(customId, tenantId).first();
      if (!customRow) {
        return c.json({ error: 'Invalid role', message: `Custom role "${customId}" does not exist for this tenant` }, 400);
      }
      // Custom roles are always strictly below caller privilege — managers can assign them
    } else {
      if (!VALID_ROLES.has(body.role)) {
        return c.json({ error: 'Invalid role', message: `Role "${body.role}" is not valid. Valid roles: ${[...VALID_ROLES].join(', ')}` }, 400);
      }
      const requestedLevel = ROLE_LEVELS[body.role] ?? 0;
      if (requestedLevel > callerLevel) {
        return c.json({ error: 'Forbidden', message: `Cannot assign role "${body.role}" — exceeds your own privilege level` }, 403);
      }
    }
  }

  // Validate status if provided
  if (body.status && !['active', 'suspended', 'inactive'].includes(body.status)) {
    return c.json({ error: 'Invalid status', message: 'Status must be active, suspended, or inactive' }, 400);
  }

  // Build dynamic UPDATE
  const updates: string[] = [];
  const values: (string | null)[] = [];
  if (body.role) { updates.push('role = ?'); values.push(body.role); }
  if (body.status) { updates.push('status = ?'); values.push(body.status); }
  if (body.name) { updates.push('name = ?'); values.push(body.name); }
  if (body.permissions) { updates.push('permissions = ?'); values.push(JSON.stringify(body.permissions)); }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);

  const sql = `UPDATE users SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`;
  values.push(userId, tenantId);
  await c.env.DB.prepare(sql).bind(...values).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, auth?.userId || '', 'user_updated', 'iam', 'user',
    JSON.stringify({ targetUserId: userId, targetEmail: target.email, changes: body }), 'success'
  ).run().catch(() => {});

  return c.json({ success: true, userId, changes: body });
});

// DELETE /api/iam/users/:id
iam.delete('/users/:id', async (c) => {
  const tenantId = getTenantId(c);
  const id = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;

  // Prevent self-deletion
  if (auth?.userId === id) {
    return c.json({ error: 'Forbidden', message: 'Cannot delete your own account' }, 403);
  }

  // Prevent deleting users with higher privilege
  const target = await c.env.DB.prepare(
    'SELECT id, role, email FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<{ id: string; role: string; email: string }>();
  if (!target) return c.json({ error: 'User not found' }, 404);

  const targetLevel = ROLE_LEVELS[target.role] ?? 0;
  if (targetLevel > callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Cannot delete a user with higher privilege than your own' }, 403);
  }

  // Company admins cannot delete peer admins (same level) — only superadmins can
  const callerRole = auth?.role || '';
  if (callerRole === 'admin' && targetLevel >= callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Company admins cannot delete other admins' }, 403);
  }

  await c.env.DB.prepare('DELETE FROM users WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();

  // Audit log
  await c.env.DB.prepare(
    'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), tenantId, auth?.userId || '', 'user_deleted', 'iam', 'user',
    JSON.stringify({ deletedUserId: id, deletedEmail: target.email, deletedRole: target.role }), 'success'
  ).run().catch(() => {});

  return c.json({ success: true });
});

// POST /api/iam/users/:id/resend-welcome - Reset password and resend welcome email
iam.post('/users/:id/resend-welcome', async (c) => {
  const tenantId = getTenantId(c);
  const userId = c.req.param('id');
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;

  const user = await c.env.DB.prepare(
    'SELECT id, email, name, role FROM users WHERE id = ? AND tenant_id = ?'
  ).bind(userId, tenantId).first<{ id: string; email: string; name: string; role: string }>();
  if (!user) return c.json({ error: 'User not found' }, 404);

  // Prevent resetting password for users with higher privilege
  const targetLevel = ROLE_LEVELS[user.role] ?? 0;
  if (targetLevel > callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Cannot reset password for a user with higher privilege than your own' }, 403);
  }

  // Company admins cannot reset passwords for peer admins
  const callerRole = auth?.role || '';
  if (callerRole === 'admin' && targetLevel >= callerLevel) {
    return c.json({ error: 'Forbidden', message: 'Company admins cannot reset passwords for other admins' }, 403);
  }

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

// ── Bulk User Management (v45) ────────────────────────────────────────
// CSV import, bulk suspend/activate/change-role, import history from audit_log

/**
 * Simple inline CSV parser supporting quoted fields and commas/newlines inside quotes.
 * Returns rows as arrays of strings. First row treated as header by the caller.
 */
function parseCSV(input: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < input.length) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { cur.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') { cur.push(field); rows.push(cur); cur = []; field = ''; i++; continue; }
    field += ch; i++;
  }
  // flush trailing field/row if present
  if (field.length > 0 || cur.length > 0) { cur.push(field); rows.push(cur); }
  // drop fully-empty trailing rows
  return rows.filter(r => r.length > 1 || (r.length === 1 && r[0].trim().length > 0));
}

function isValidEmail(email: string): boolean {
  // basic RFC-5322-lite validation; matches email format sufficient for user creation
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%';
  let pw = '';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < 12; i++) pw += chars[bytes[i] % chars.length];
  return pw;
}

// POST /api/iam/users/bulk-import — CSV import (admin+)
// Body: { csv: string, dryRun?: boolean }
// CSV columns: email,name,role[,permissions]
iam.post('/users/bulk-import', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
  if (callerLevel < ROLE_LEVELS['admin']) {
    return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  }
  const tenantId = getTenantId(c);

  let body: { csv?: string; dryRun?: boolean };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const csv = (body.csv || '').trim();
  const dryRun = body.dryRun === true;
  if (!csv) return c.json({ error: 'Invalid input', message: 'csv is required' }, 400);

  const importId = crypto.randomUUID();
  const rows = parseCSV(csv);
  if (rows.length < 2) {
    return c.json({ error: 'Invalid CSV', message: 'CSV must have a header row plus at least one data row' }, 400);
  }
  const header = rows[0].map(h => h.trim().toLowerCase());
  const emailIdx = header.indexOf('email');
  const nameIdx = header.indexOf('name');
  const roleIdx = header.indexOf('role');
  const permsIdx = header.indexOf('permissions');
  if (emailIdx === -1 || nameIdx === -1) {
    return c.json({ error: 'Invalid CSV', message: 'Header must include email and name columns' }, 400);
  }

  const created: Array<{ row: number; id: string; email: string; name: string; role: string; tempPassword: string }> = [];
  const skipped: Array<{ row: number; email: string; reason: string }> = [];
  const errors: Array<{ row: number; email?: string; reason: string }> = [];

  // Pre-fetch existing emails in one query for efficiency
  const dataRows = rows.slice(1);
  const candidateEmails = dataRows
    .map(r => (r[emailIdx] || '').trim().toLowerCase())
    .filter(e => e.length > 0);
  const existingEmails = new Set<string>();
  if (candidateEmails.length > 0) {
    // D1 limits variadic bindings — chunk to 50 at a time
    for (let i = 0; i < candidateEmails.length; i += 50) {
      const chunk = candidateEmails.slice(i, i + 50);
      const placeholders = chunk.map(() => '?').join(',');
      const res = await c.env.DB.prepare(
        `SELECT email FROM users WHERE tenant_id = ? AND lower(email) IN (${placeholders})`,
      ).bind(tenantId, ...chunk).all<{ email: string }>();
      for (const r of res.results || []) existingEmails.add((r.email || '').toLowerCase());
    }
  }
  const seenInBatch = new Set<string>();

  for (let r = 0; r < dataRows.length; r++) {
    const rowNumber = r + 2; // 1-indexed, +1 for header
    const row = dataRows[r];
    const email = (row[emailIdx] || '').trim();
    const name = (row[nameIdx] || '').trim();
    const role = (roleIdx >= 0 ? (row[roleIdx] || '').trim() : '') || 'analyst';
    let permissions: string[] = [];
    if (permsIdx >= 0 && row[permsIdx]) {
      // Support JSON-like or pipe-separated permissions
      const raw = row[permsIdx].trim();
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) permissions = parsed.map(String);
      } catch {
        permissions = raw.split('|').map(s => s.trim()).filter(Boolean);
      }
    }

    if (!email) { skipped.push({ row: rowNumber, email: '', reason: 'Missing email' }); continue; }
    if (!isValidEmail(email)) { skipped.push({ row: rowNumber, email, reason: 'Invalid email format' }); continue; }
    if (!name) { skipped.push({ row: rowNumber, email, reason: 'Missing name' }); continue; }
    if (!VALID_ROLES.has(role)) { skipped.push({ row: rowNumber, email, reason: `Invalid role "${role}"` }); continue; }
    if ((ROLE_LEVELS[role] ?? 0) > callerLevel) {
      skipped.push({ row: rowNumber, email, reason: `Role "${role}" exceeds your privilege level` }); continue;
    }
    const lowerEmail = email.toLowerCase();
    if (existingEmails.has(lowerEmail)) { skipped.push({ row: rowNumber, email, reason: 'User already exists' }); continue; }
    if (seenInBatch.has(lowerEmail)) { skipped.push({ row: rowNumber, email, reason: 'Duplicate email within CSV' }); continue; }
    seenInBatch.add(lowerEmail);

    if (permissions.length === 0) {
      permissions = (role === 'superadmin' || role === 'support_admin' || role === 'admin') ? ['*'] : ['read'];
    }

    if (dryRun) {
      created.push({ row: rowNumber, id: '(dry-run)', email, name, role, tempPassword: '(dry-run)' });
      continue;
    }

    try {
      const tempPassword = generateTempPassword();
      const passwordHash = await hashPassword(tempPassword);
      const id = crypto.randomUUID();
      await c.env.DB.prepare(
        'INSERT INTO users (id, tenant_id, email, name, role, password_hash, permissions, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(id, tenantId, email, name, role, passwordHash, JSON.stringify(permissions), 'active').run();

      // Per-user audit entry
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null,
        'bulk_user.import.created', 'iam', 'user',
        JSON.stringify({ importId, email, role, row: rowNumber }), 'success',
      ).run().catch(() => {});

      created.push({ row: rowNumber, id, email, name, role, tempPassword });
    } catch (err) {
      errors.push({ row: rowNumber, email, reason: (err as Error).message });
    }
  }

  // Batch-level audit entry for import history aggregation
  if (!dryRun) {
    await c.env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(
      importId, tenantId, auth?.userId || null,
      'bulk_user.import.batch', 'iam', 'users',
      JSON.stringify({
        importId,
        total: dataRows.length,
        createdCount: created.length,
        skippedCount: skipped.length,
        errorCount: errors.length,
      }),
      errors.length > 0 ? 'partial' : 'success',
    ).run().catch(() => {});
  }

  return c.json({
    importId,
    total: dataRows.length,
    created: created.length,
    createdUsers: created,
    skipped,
    errors,
    dryRun,
  });
});

// POST /api/iam/users/bulk-action — suspend/activate/change-role (admin+)
// Body: { user_ids: string[], action: 'suspend'|'activate'|'change_role', role?: string }
iam.post('/users/bulk-action', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
  if (callerLevel < ROLE_LEVELS['admin']) {
    return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  }
  const tenantId = getTenantId(c);

  let body: { user_ids?: string[]; action?: string; role?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON body' }, 400); }
  const userIds = Array.isArray(body.user_ids) ? body.user_ids.filter(x => typeof x === 'string') : [];
  const action = body.action;
  if (userIds.length === 0) return c.json({ error: 'Invalid input', message: 'user_ids must be a non-empty array' }, 400);
  if (!action || !['suspend', 'activate', 'change_role'].includes(action)) {
    return c.json({ error: 'Invalid input', message: 'action must be suspend, activate, or change_role' }, 400);
  }
  if (action === 'change_role') {
    if (!body.role) return c.json({ error: 'Invalid input', message: 'role is required for change_role action' }, 400);
    if (!VALID_ROLES.has(body.role)) {
      return c.json({ error: 'Invalid role', message: `Role "${body.role}" is not valid` }, 400);
    }
    if ((ROLE_LEVELS[body.role] ?? 0) > callerLevel) {
      return c.json({ error: 'Forbidden', message: `Cannot assign role "${body.role}" — exceeds your privilege level` }, 403);
    }
  }

  const applied: Array<{ user_id: string; email?: string }> = [];
  const failed: Array<{ user_id: string; reason: string }> = [];

  for (const id of userIds) {
    if (id === auth?.userId) { failed.push({ user_id: id, reason: 'Cannot modify your own account' }); continue; }
    const target = await c.env.DB.prepare(
      'SELECT id, email, role FROM users WHERE id = ? AND tenant_id = ?',
    ).bind(id, tenantId).first<{ id: string; email: string; role: string }>();
    if (!target) { failed.push({ user_id: id, reason: 'User not found' }); continue; }
    const targetLevel = ROLE_LEVELS[target.role] ?? 0;
    if (targetLevel > callerLevel) { failed.push({ user_id: id, reason: 'Target has higher privilege' }); continue; }
    if (auth?.role === 'admin' && targetLevel >= callerLevel) {
      failed.push({ user_id: id, reason: 'Company admins cannot modify peer admins' }); continue;
    }

    try {
      if (action === 'suspend') {
        await c.env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ? AND tenant_id = ?")
          .bind(id, tenantId).run();
      } else if (action === 'activate') {
        await c.env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ? AND tenant_id = ?")
          .bind(id, tenantId).run();
      } else if (action === 'change_role' && body.role) {
        await c.env.DB.prepare('UPDATE users SET role = ? WHERE id = ? AND tenant_id = ?')
          .bind(body.role, id, tenantId).run();
      }
      applied.push({ user_id: id, email: target.email });
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      ).bind(
        crypto.randomUUID(), tenantId, auth?.userId || null,
        `bulk_user.action.${action}`, 'iam', 'user',
        JSON.stringify({ targetUserId: id, targetEmail: target.email, role: body.role }), 'success',
      ).run().catch(() => {});
    } catch (err) {
      failed.push({ user_id: id, reason: (err as Error).message });
    }
  }

  return c.json({ applied: applied.length, failed, appliedUsers: applied });
});

// GET /api/iam/users/import-history — list recent bulk imports (admin+)
iam.get('/users/import-history', async (c) => {
  const auth = c.get('auth') as AuthContext | undefined;
  const callerLevel = ROLE_LEVELS[auth?.role || ''] ?? 0;
  if (callerLevel < ROLE_LEVELS['admin']) {
    return c.json({ error: 'Forbidden', message: 'Admin role required' }, 403);
  }
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    `SELECT id, user_id, action, details, outcome, created_at FROM audit_log
     WHERE tenant_id = ? AND action = 'bulk_user.import.batch'
     ORDER BY created_at DESC LIMIT 20`,
  ).bind(tenantId).all<Record<string, unknown>>();

  const imports = (results.results || []).map((row) => {
    let details: Record<string, unknown> = {};
    try { details = row.details ? JSON.parse(String(row.details)) : {}; } catch { details = {}; }
    return {
      id: String(row.id),
      imported_by: row.user_id ? String(row.user_id) : null,
      row_count: (details.total as number) ?? 0,
      created_count: (details.createdCount as number) ?? 0,
      skipped_count: (details.skippedCount as number) ?? 0,
      error_count: (details.errorCount as number) ?? 0,
      outcome: String(row.outcome || 'success'),
      created_at: String(row.created_at),
    };
  });

  return c.json({ imports });
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
    // Phase AY: WorkOS-brokered SAML connection identifier
    workosConnectionId: s.workos_connection_id ?? null,
  }));

  return c.json({ configs: formatted });
});

// ───────────────────────────────────────────────────────────
// Custom Roles (v46-platform) — admin+, tenant-scoped
// ───────────────────────────────────────────────────────────

/**
 * Canonical permission taxonomy surfaced via GET /permissions.
 * Kept in sync with user.permissions values already used by the platform
 * (grep migrate.ts seed data for evidence: `apex.read`, `pulse.read`,
 * `catalysts.execute`, `mind.query`, …). Admin roles get the wildcard
 * `admin.*` which implies full platform access.
 */
const PERMISSION_TAXONOMY: string[] = [
  'apex.read', 'apex.write',
  'pulse.read', 'pulse.write',
  'catalysts.read', 'catalysts.execute', 'catalysts.approve',
  'mind.query',
  'memory.read', 'memory.write',
  'iam.users.read', 'iam.users.write',
  'tenants.read',
  'admin.*',
];

/**
 * Permissions inherited by each built-in base role. Custom roles that set
 * `inherits_from` implicitly acquire these permissions (plus anything extra
 * the creator adds). The UI reflects this by showing inherited permissions
 * as read-only / pre-checked.
 */
// Permissions deliberately track the frontend role gates in src/App.tsx —
// analyst sits in STANDARD_ROLES which exposes /dashboard, /pulse, /chat,
// /trust. Granting apex.read/catalysts.read/memory.read here historically
// over-promised access the base role's UI does not surface, so a custom
// role that inherits from analyst couldn't actually use those permissions.
// Custom roles needing those reads should inherit from operator/manager
// instead (or list the permission explicitly), which is the common path
// for tenants that want a read-only operator-style profile.
const BASE_ROLE_PERMISSIONS: Record<string, string[]> = {
  analyst: ['pulse.read', 'mind.query'],
  operator: ['apex.read', 'pulse.read', 'catalysts.read', 'catalysts.execute', 'mind.query'],
  manager: ['apex.read', 'apex.write', 'pulse.read', 'pulse.write', 'catalysts.read', 'catalysts.execute', 'catalysts.approve', 'mind.query', 'memory.read', 'memory.write', 'iam.users.read'],
  admin: ['admin.*'],
};

const VALID_BASE_ROLES = new Set(Object.keys(BASE_ROLE_PERMISSIONS));

/** Shape of a persisted custom role row. */
interface CustomRoleRow {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  permissions: string;
  inherits_from: string | null;
  user_count: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

/** Format a custom role row for the API response, including user_count recomputed on read. */
async function formatCustomRole(db: D1Database, row: CustomRoleRow): Promise<Record<string, unknown>> {
  let perms: string[] = [];
  try { perms = JSON.parse(row.permissions || '[]'); } catch { perms = []; }

  // Denormalized user_count — always recompute on read per spec
  const countRes = await db
    .prepare('SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND role = ?')
    .bind(row.tenant_id, `custom:${row.id}`)
    .first<{ c: number }>();
  const userCount = countRes?.c || 0;

  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    description: row.description || '',
    permissions: Array.isArray(perms) ? perms : [],
    inheritsFrom: row.inherits_from,
    inheritedPermissions: row.inherits_from ? (BASE_ROLE_PERMISSIONS[row.inherits_from] || []) : [],
    userCount,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Require caller to be admin+ (admin, support_admin, superadmin). */
function requireAdmin(c: { get: (k: string) => unknown }): { ok: true; auth: AuthContext } | { ok: false; error: string } {
  const auth = c.get('auth') as AuthContext | undefined;
  if (!auth) return { ok: false, error: 'Unauthorized' };
  const role = auth.role;
  if (role !== 'admin' && role !== 'support_admin' && role !== 'superadmin') {
    return { ok: false, error: 'Forbidden' };
  }
  return { ok: true, auth };
}

// GET /api/iam/permissions — master permission taxonomy
iam.get('/permissions', async (c) => {
  const gate = requireAdmin(c);
  if (!gate.ok) return c.json({ error: gate.error }, gate.error === 'Unauthorized' ? 401 : 403);

  return c.json({
    permissions: PERMISSION_TAXONOMY,
    baseRoles: Object.entries(BASE_ROLE_PERMISSIONS).map(([id, perms]) => ({
      id, name: id.charAt(0).toUpperCase() + id.slice(1), permissions: perms,
    })),
  });
});

// GET /api/iam/custom-roles — list custom roles for the tenant
iam.get('/custom-roles', async (c) => {
  const gate = requireAdmin(c);
  if (!gate.ok) return c.json({ error: gate.error }, gate.error === 'Unauthorized' ? 401 : 403);
  const tenantId = getTenantId(c);

  const results = await c.env.DB.prepare(
    'SELECT * FROM iam_custom_roles WHERE tenant_id = ? ORDER BY created_at DESC'
  ).bind(tenantId).all<CustomRoleRow>();

  const roles = await Promise.all((results.results || []).map(r => formatCustomRole(c.env.DB, r)));
  return c.json({ roles, total: roles.length });
});

// POST /api/iam/custom-roles — create a new custom role for the tenant
iam.post('/custom-roles', async (c) => {
  const gate = requireAdmin(c);
  if (!gate.ok) return c.json({ error: gate.error }, gate.error === 'Unauthorized' ? 401 : 403);
  const tenantId = getTenantId(c);

  const { data: body, errors } = await getValidatedJsonBody<{
    name: string;
    description?: string;
    permissions?: string[];
    inherits_from?: string;
  }>(c, [
    { field: 'name', type: 'string', required: true, minLength: 1, maxLength: 100 },
    { field: 'description', type: 'string', required: false, maxLength: 500 },
    { field: 'inherits_from', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  if (body.inherits_from && !VALID_BASE_ROLES.has(body.inherits_from)) {
    return c.json({ error: 'Invalid inherits_from', message: `Must be one of: ${[...VALID_BASE_ROLES].join(', ')}` }, 400);
  }

  const permSet = new Set<string>();
  for (const p of (body.permissions || [])) {
    if (typeof p === 'string' && p.length > 0 && p.length <= 64) permSet.add(p);
  }
  // Reject obviously invalid permission strings (not in taxonomy)
  const allowedPerms = new Set(PERMISSION_TAXONOMY);
  for (const p of permSet) {
    if (!allowedPerms.has(p)) {
      return c.json({ error: 'Invalid permission', message: `Unknown permission: ${p}` }, 400);
    }
  }

  // Reject duplicate name for this tenant
  const existing = await c.env.DB.prepare(
    'SELECT id FROM iam_custom_roles WHERE tenant_id = ? AND name = ?'
  ).bind(tenantId, body.name.trim()).first();
  if (existing) return c.json({ error: 'Role already exists', message: `A custom role named "${body.name}" already exists` }, 409);

  const id = crypto.randomUUID();
  const auth = c.get('auth') as AuthContext | undefined;
  await c.env.DB.prepare(
    `INSERT INTO iam_custom_roles (id, tenant_id, name, description, permissions, inherits_from, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, tenantId, body.name.trim(), body.description || '',
    JSON.stringify([...permSet]),
    body.inherits_from || null,
    auth?.userId || null,
  ).run();

  const row = await c.env.DB.prepare('SELECT * FROM iam_custom_roles WHERE id = ?').bind(id).first<CustomRoleRow>();
  return c.json({ role: row ? await formatCustomRole(c.env.DB, row) : { id } }, 201);
});

// PUT /api/iam/custom-roles/:id — update
iam.put('/custom-roles/:id', async (c) => {
  const gate = requireAdmin(c);
  if (!gate.ok) return c.json({ error: gate.error }, gate.error === 'Unauthorized' ? 401 : 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT * FROM iam_custom_roles WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first<CustomRoleRow>();
  if (!existing) return c.json({ error: 'Role not found' }, 404);

  const { data: body, errors } = await getValidatedJsonBody<{
    name?: string;
    description?: string;
    permissions?: string[];
    inherits_from?: string | null;
  }>(c, [
    { field: 'name', type: 'string', required: false, minLength: 1, maxLength: 100 },
    { field: 'description', type: 'string', required: false, maxLength: 500 },
    { field: 'inherits_from', type: 'string', required: false, maxLength: 32 },
  ]);
  if (!body || errors.length > 0) return c.json({ error: 'Invalid input', details: errors }, 400);

  if (body.inherits_from && !VALID_BASE_ROLES.has(body.inherits_from)) {
    return c.json({ error: 'Invalid inherits_from' }, 400);
  }

  const updates: string[] = [];
  const values: (string | null)[] = [];
  if (body.name !== undefined) { updates.push('name = ?'); values.push(body.name.trim()); }
  if (body.description !== undefined) { updates.push('description = ?'); values.push(body.description); }
  if (body.inherits_from !== undefined) { updates.push('inherits_from = ?'); values.push(body.inherits_from || null); }
  if (body.permissions !== undefined) {
    const allowedPerms = new Set(PERMISSION_TAXONOMY);
    const permSet = new Set<string>();
    for (const p of body.permissions) {
      if (typeof p !== 'string') continue;
      if (!allowedPerms.has(p)) return c.json({ error: 'Invalid permission', message: `Unknown permission: ${p}` }, 400);
      permSet.add(p);
    }
    updates.push('permissions = ?'); values.push(JSON.stringify([...permSet]));
  }

  if (updates.length === 0) return c.json({ error: 'No fields to update' }, 400);
  updates.push("updated_at = datetime('now')");

  values.push(id, tenantId);
  await c.env.DB.prepare(
    `UPDATE iam_custom_roles SET ${updates.join(', ')} WHERE id = ? AND tenant_id = ?`
  ).bind(...values).run();

  const row = await c.env.DB.prepare('SELECT * FROM iam_custom_roles WHERE id = ?').bind(id).first<CustomRoleRow>();
  return c.json({ role: row ? await formatCustomRole(c.env.DB, row) : null });
});

// DELETE /api/iam/custom-roles/:id — blocked if any users assigned
iam.delete('/custom-roles/:id', async (c) => {
  const gate = requireAdmin(c);
  if (!gate.ok) return c.json({ error: gate.error }, gate.error === 'Unauthorized' ? 401 : 403);
  const tenantId = getTenantId(c);
  const id = c.req.param('id');

  const existing = await c.env.DB.prepare(
    'SELECT id FROM iam_custom_roles WHERE id = ? AND tenant_id = ?'
  ).bind(id, tenantId).first();
  if (!existing) return c.json({ error: 'Role not found' }, 404);

  // Block delete when users are still assigned to this custom role
  const countRes = await c.env.DB.prepare(
    'SELECT COUNT(*) as c FROM users WHERE tenant_id = ? AND role = ?'
  ).bind(tenantId, `custom:${id}`).first<{ c: number }>();
  const userCount = countRes?.c || 0;
  if (userCount > 0) {
    return c.json({ error: 'Role in use', message: `Cannot delete — ${userCount} user(s) are still assigned to this role`, userCount }, 409);
  }

  await c.env.DB.prepare('DELETE FROM iam_custom_roles WHERE id = ? AND tenant_id = ?').bind(id, tenantId).run();
  return c.json({ success: true });
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

// ─── Phase AY: SAML configuration (admin-only, JWT-authed) ───────────
// Manages the workos_connection_id + auto_provision + domain_hint for the
// tenant's SAML SSO connection. Frontend reads via GET /api/iam/sso and
// writes via this PATCH endpoint (which upserts the sso_configs row).

// PATCH /api/iam/sso/saml — upsert SAML config for the active tenant.
iam.patch('/sso/saml', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  let body: { workos_connection_id?: string | null; domain_hint?: string | null; auto_provision?: boolean; default_role?: string; enabled?: boolean };
  try { body = await c.req.json(); }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }

  // Validate the WorkOS connection_id shape (conn_<26 chars>) so admins
  // don't paste a URL or random string and wonder why login fails.
  const conn = body.workos_connection_id?.trim() || null;
  if (conn && !/^conn_[A-Za-z0-9]{20,40}$/.test(conn)) {
    return c.json({ error: 'workos_connection_id must look like "conn_..." from your WorkOS dashboard' }, 400);
  }

  // Upsert the tenant's sso_configs row. If a row exists, we update; if
  // not, we insert a SAML-mode row.
  const existing = await c.env.DB.prepare(
    `SELECT id FROM sso_configs WHERE tenant_id = ? LIMIT 1`
  ).bind(tenantId).first<{ id: string }>();

  if (existing) {
    await c.env.DB.prepare(
      `UPDATE sso_configs
          SET workos_connection_id = ?,
              domain_hint = COALESCE(?, domain_hint),
              auto_provision = COALESCE(?, auto_provision),
              default_role = COALESCE(?, default_role),
              enabled = COALESCE(?, enabled)
        WHERE id = ?`
    ).bind(
      conn,
      body.domain_hint ?? null,
      body.auto_provision === undefined ? null : (body.auto_provision ? 1 : 0),
      body.default_role ?? null,
      body.enabled === undefined ? null : (body.enabled ? 1 : 0),
      existing.id,
    ).run();
  } else {
    await c.env.DB.prepare(
      `INSERT INTO sso_configs (id, tenant_id, provider, client_id, issuer_url, workos_connection_id, domain_hint, auto_provision, default_role, enabled)
       VALUES (?, ?, 'workos_saml', '', '', ?, ?, ?, ?, ?)`
    ).bind(
      crypto.randomUUID(), tenantId, conn, body.domain_hint ?? '',
      body.auto_provision ? 1 : 0, body.default_role ?? 'analyst',
      body.enabled === false ? 0 : 1,
    ).run();
  }

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
     VALUES (?, ?, ?, 'iam.saml.configured', 'iam', 'sso_configs', ?, 'success', datetime('now'))`
  ).bind(
    crypto.randomUUID(), tenantId, auth?.userId || null,
    JSON.stringify({ hasConnection: !!conn, domainHint: body.domain_hint, autoProvision: !!body.auto_provision }),
  ).run();

  return c.json({ ok: true });
});

// ─── Phase AX: SCIM 2.0 token management (admin-only, JWT-authed) ─────
// These admin-side endpoints let a tenant admin generate / list / revoke
// the bearer tokens that enterprise IdPs (Okta, Azure AD, etc.) use to
// call /scim/v2/Users for automatic user provisioning.
//
// The actual /scim/v2/* endpoints live in workers/api/src/routes/scim.ts
// and authenticate via the bearer token alone (no JWT). This admin
// surface is JWT-authed via the existing platformAdminRoutePrefixes guard.

import { generateScimToken } from '../middleware/scim-auth';

// GET /api/iam/scim-tokens — list tokens for the active tenant.
iam.get('/scim-tokens', async (c) => {
  const tenantId = getTenantId(c);
  const result = await c.env.DB.prepare(
    `SELECT id, name, key_prefix, created_by, created_at, last_used_at, revoked_at
       FROM scim_tokens
      WHERE tenant_id = ?
      ORDER BY created_at DESC`
  ).bind(tenantId).all();
  return c.json({ tokens: result.results });
});

// POST /api/iam/scim-tokens — issue a new SCIM token. The clear value is
// returned exactly once; subsequent reads only ever return the prefix.
iam.post('/scim-tokens', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  let body: { name?: string };
  try { body = await c.req.json<{ name?: string }>(); }
  catch { return c.json({ error: 'Invalid JSON' }, 400); }
  const name = (body.name || '').trim();
  if (!name) return c.json({ error: 'name is required' }, 400);

  const { clear, hash, prefix } = await generateScimToken();
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    `INSERT INTO scim_tokens (id, tenant_id, name, token_hash, key_prefix, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`
  ).bind(id, tenantId, name.slice(0, 80), hash, prefix, auth?.userId || null).run();

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
     VALUES (?, ?, ?, 'iam.scim_token.created', 'iam', ?, ?, 'success', datetime('now'))`
  ).bind(
    crypto.randomUUID(), tenantId, auth?.userId || null,
    `scim_token/${id}`, JSON.stringify({ name, prefix }),
  ).run();

  // Return the token value exactly once. The frontend must surface it
  // immediately and never persist it; admin clicks "Done" and it's gone.
  return c.json({ id, name, prefix, token: clear }, 201);
});

// DELETE /api/iam/scim-tokens/:id — revoke. Soft-delete: sets revoked_at
// so audit history remains and a revoked token can never be re-activated.
iam.delete('/scim-tokens/:id', async (c) => {
  const tenantId = getTenantId(c);
  const auth = c.get('auth') as AuthContext | undefined;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, revoked_at FROM scim_tokens WHERE id = ? AND tenant_id = ?`
  ).bind(id, tenantId).first<{ id: string; revoked_at: string | null }>();
  if (!row) return c.json({ error: 'Token not found' }, 404);
  if (row.revoked_at) return c.json({ ok: true, alreadyRevoked: true });

  await c.env.DB.prepare(
    `UPDATE scim_tokens SET revoked_at = datetime('now') WHERE id = ?`
  ).bind(id).run();

  await c.env.DB.prepare(
    `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
     VALUES (?, ?, ?, 'iam.scim_token.revoked', 'iam', ?, '{}', 'success', datetime('now'))`
  ).bind(crypto.randomUUID(), tenantId, auth?.userId || null, `scim_token/${id}`).run();

  return c.json({ ok: true });
});

export default iam;
