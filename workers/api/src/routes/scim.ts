/**
 * SCIM 2.0 — System for Cross-domain Identity Management (RFC 7643/7644).
 *
 * Enterprise IdPs (Okta, Azure AD, Google Workspace, OneLogin, JumpCloud)
 * use these endpoints to provision and deprovision users automatically.
 * This is the no-IT-lift user-lifecycle loop large enterprises require:
 * a leaver in the IdP is automatically deactivated in Atheon within
 * minutes, with an audit_log row proving it.
 *
 * What's implemented:
 *   - Discovery: /ServiceProviderConfig, /ResourceTypes, /Schemas
 *   - /Users:
 *       GET   list (with filter: eq/sw on userName, externalId, active;
 *             pagination via startIndex/count; total via SELECT COUNT)
 *       GET   /:id   read one
 *       POST  create
 *       PUT   /:id   full replace
 *       PATCH /:id   Okta-compatible op list (replace + remove)
 *       DELETE /:id  hard delete is forbidden by most IdPs — we soft-delete
 *                    by setting status='deactivated' so audit history stays
 *
 * What's deliberately out of scope (v1):
 *   - /Groups — most IdPs map roles via user.role attribute, not group
 *     membership. Adding /Groups is a follow-up if a specific tenant asks
 *   - /Bulk — only Okta-prosumer; we'll add when a customer needs it
 *   - SCIM-over-SOAP — nobody supports SOAP anymore
 *
 * Auth:
 *   - Bearer token per tenant (see scim-auth.ts). Tokens are issued via
 *     POST /api/iam/scim-tokens (admin-only, JWT-authed) and shown ONCE.
 *
 * Audit:
 *   - Every mutation (POST/PUT/PATCH/DELETE) writes an audit_log row with
 *     action=scim.user.* and resource=user/<id> so internal audit can
 *     reconstruct the provisioning chain end-to-end.
 */
import { Hono } from 'hono';
import type { AppBindings, AuthContext } from '../types';
import { scimAuth, scimError } from '../middleware/scim-auth';

const scim = new Hono<AppBindings>();

// All SCIM endpoints require the bearer token (no JWT here).
scim.use('*', scimAuth());

// ─── RFC 7643 §5 — Discovery endpoints ───────────────────────────────

// GET /scim/v2/ServiceProviderConfig — tells the IdP what we support.
scim.get('/ServiceProviderConfig', (c) => {
  return c.json({
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig'],
    documentationUri: 'https://atheon.vantax.co.za/docs/scim',
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: 'oauthbearertoken',
        name: 'OAuth Bearer Token',
        description: 'Bearer token issued by tenant admin via /api/iam/scim-tokens',
        specUri: 'https://datatracker.ietf.org/doc/html/rfc6750',
        documentationUri: 'https://atheon.vantax.co.za/docs/scim/auth',
        primary: true,
      },
    ],
    meta: { resourceType: 'ServiceProviderConfig' },
  });
});

// GET /scim/v2/ResourceTypes
scim.get('/ResourceTypes', (c) => {
  const base = new URL(c.req.url);
  return c.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 1,
    Resources: [
      {
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:ResourceType'],
        id: 'User',
        name: 'User',
        endpoint: '/Users',
        description: 'User Account',
        schema: 'urn:ietf:params:scim:schemas:core:2.0:User',
        meta: { resourceType: 'ResourceType', location: `${base.origin}/scim/v2/ResourceTypes/User` },
      },
    ],
  });
});

// GET /scim/v2/Schemas — minimal: declare we support the core User schema.
scim.get('/Schemas', (c) => {
  return c.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: 1,
    Resources: [
      {
        id: 'urn:ietf:params:scim:schemas:core:2.0:User',
        name: 'User',
        description: 'SCIM core User resource',
        attributes: [
          { name: 'userName', type: 'string', required: true, uniqueness: 'server' },
          { name: 'externalId', type: 'string', required: false },
          { name: 'name', type: 'complex', subAttributes: [
            { name: 'givenName', type: 'string' },
            { name: 'familyName', type: 'string' },
          ] },
          { name: 'emails', type: 'complex', multiValued: true, subAttributes: [
            { name: 'value', type: 'string', required: true },
            { name: 'type', type: 'string' },
            { name: 'primary', type: 'boolean' },
          ] },
          { name: 'active', type: 'boolean' },
        ],
      },
    ],
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────

interface UserRow {
  id: string;
  tenant_id: string;
  email: string;
  name: string;
  given_name: string | null;
  family_name: string | null;
  external_id: string | null;
  role: string;
  status: string;
  created_at: string;
  updated_at: string;
}

function rowToScimUser(row: UserRow, origin: string) {
  return {
    schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
    id: row.id,
    externalId: row.external_id ?? undefined,
    userName: row.email,
    name: {
      givenName: row.given_name ?? undefined,
      familyName: row.family_name ?? undefined,
      formatted: row.name,
    },
    emails: [{ value: row.email, type: 'work', primary: true }],
    active: row.status !== 'deactivated' && row.status !== 'suspended',
    meta: {
      resourceType: 'User',
      created: row.created_at,
      lastModified: row.updated_at,
      location: `${origin}/scim/v2/Users/${row.id}`,
    },
  };
}

interface ScimUserPayload {
  schemas?: string[];
  userName?: string;
  externalId?: string;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value?: string; type?: string; primary?: boolean }>;
  active?: boolean;
}

function payloadToColumns(p: ScimUserPayload): Partial<UserRow> {
  const primaryEmail = p.emails?.find((e) => e.primary)?.value
    || p.emails?.[0]?.value
    || p.userName;
  const givenName = p.name?.givenName ?? null;
  const familyName = p.name?.familyName ?? null;
  const formattedName = p.name?.formatted
    || [givenName, familyName].filter(Boolean).join(' ').trim()
    || primaryEmail
    || '';
  return {
    email: (primaryEmail || '').toLowerCase(),
    name: formattedName,
    given_name: givenName,
    family_name: familyName,
    external_id: p.externalId ?? null,
    status: p.active === false ? 'deactivated' : 'active',
  };
}

/**
 * SCIM filter parser — supports the small subset Okta/Azure AD actually
 * emit during provisioning probes: eq, sw on userName/externalId/active.
 * Anything more complex returns null → caller falls through to LIST ALL,
 * which is safer than 501ing the IdP probe.
 */
function parseScimFilter(filter: string | undefined): { sql: string; bindings: unknown[] } | null {
  if (!filter) return null;
  const m = filter.trim().match(/^(userName|externalId|active)\s+(eq|sw)\s+(?:"([^"]*)"|(true|false))$/i);
  if (!m) return null;
  const [, attr, op, strVal, boolVal] = m;
  const value = strVal ?? boolVal;
  let column: string;
  if (attr.toLowerCase() === 'username') column = 'email';
  else if (attr.toLowerCase() === 'externalid') column = 'external_id';
  else column = 'status'; // 'active' → status='active' when true
  if (column === 'status') {
    return { sql: `status ${value === 'true' ? '=' : '!='} 'active'`, bindings: [] };
  }
  if (op.toLowerCase() === 'sw') {
    return { sql: `${column} LIKE ?`, bindings: [`${value}%`] };
  }
  return { sql: `${column} = ?`, bindings: [value] };
}

async function writeAudit(
  db: D1Database,
  ctx: { tenantId: string; userId: string | null; action: string; resource: string; details: unknown },
) {
  try {
    await db.prepare(
      `INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, created_at)
       VALUES (?, ?, ?, ?, 'iam', ?, ?, 'success', datetime('now'))`
    ).bind(
      crypto.randomUUID(),
      ctx.tenantId,
      ctx.userId,
      ctx.action,
      ctx.resource,
      JSON.stringify(ctx.details),
    ).run();
  } catch {
    // Audit failures must never break the SCIM contract for the IdP.
  }
}

// ─── /Users ─────────────────────────────────────────────────────────

// GET /scim/v2/Users
scim.get('/Users', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const startIndex = Math.max(1, parseInt(c.req.query('startIndex') ?? '1', 10) || 1);
  const count = Math.min(200, Math.max(0, parseInt(c.req.query('count') ?? '100', 10) || 100));
  const filter = parseScimFilter(c.req.query('filter'));

  const baseWhere = 'WHERE tenant_id = ?';
  const filterClause = filter ? ` AND ${filter.sql}` : '';
  const bindings = [auth.tenantId, ...(filter?.bindings ?? [])];

  const totalRow = await c.env.DB.prepare(
    `SELECT COUNT(*) as n FROM users ${baseWhere}${filterClause}`
  ).bind(...bindings).first<{ n: number }>();
  const total = totalRow?.n ?? 0;

  const rows = await c.env.DB.prepare(
    `SELECT id, tenant_id, email, name, given_name, family_name, external_id,
            role, status, created_at, COALESCE(updated_at, created_at) as updated_at
       FROM users ${baseWhere}${filterClause}
      ORDER BY created_at ASC
      LIMIT ? OFFSET ?`
  ).bind(...bindings, count, startIndex - 1).all<UserRow>();

  const origin = new URL(c.req.url).origin;
  return c.json({
    schemas: ['urn:ietf:params:scim:api:messages:2.0:ListResponse'],
    totalResults: total,
    startIndex,
    itemsPerPage: rows.results?.length ?? 0,
    Resources: (rows.results ?? []).map((r) => rowToScimUser(r, origin)),
  });
});

// GET /scim/v2/Users/:id
scim.get('/Users/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const row = await c.env.DB.prepare(
    `SELECT id, tenant_id, email, name, given_name, family_name, external_id,
            role, status, created_at, COALESCE(updated_at, created_at) as updated_at
       FROM users
      WHERE id = ? AND tenant_id = ?`
  ).bind(id, auth.tenantId).first<UserRow>();
  if (!row) return c.json(scimError(404, 'User not found'), 404);
  const origin = new URL(c.req.url).origin;
  return c.json(rowToScimUser(row, origin));
});

// POST /scim/v2/Users — create
scim.post('/Users', async (c) => {
  const auth = c.get('auth') as AuthContext;
  let body: ScimUserPayload;
  try { body = await c.req.json<ScimUserPayload>(); }
  catch { return c.json(scimError(400, 'Invalid JSON'), 400); }
  if (!body.userName && !body.emails?.[0]?.value) {
    return c.json(scimError(400, 'userName or primary email is required', 'invalidValue'), 400);
  }
  const cols = payloadToColumns(body);
  if (!cols.email) return c.json(scimError(400, 'A valid email is required', 'invalidValue'), 400);

  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE tenant_id = ? AND email = ? LIMIT 1`
  ).bind(auth.tenantId, cols.email).first<{ id: string }>();
  if (existing) return c.json(scimError(409, 'User with this userName already exists', 'uniqueness'), 409);

  const id = crypto.randomUUID();
  // Default role for IdP-provisioned users is 'analyst' — read-only enough to
  // be safe by default; admins can elevate via PUT/PATCH or the IAM UI.
  await c.env.DB.prepare(
    `INSERT INTO users (id, tenant_id, email, name, given_name, family_name, external_id, role, status, permissions, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'analyst', ?, '["read"]', datetime('now'), datetime('now'))`
  ).bind(
    id, auth.tenantId, cols.email, cols.name ?? cols.email,
    cols.given_name ?? null, cols.family_name ?? null,
    cols.external_id ?? null, cols.status ?? 'active',
  ).run();

  await writeAudit(c.env.DB, {
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: 'scim.user.created',
    resource: `user/${id}`,
    details: { email: cols.email, externalId: cols.external_id, source: 'SCIM' },
  });

  const row = await c.env.DB.prepare(
    `SELECT id, tenant_id, email, name, given_name, family_name, external_id,
            role, status, created_at, COALESCE(updated_at, created_at) as updated_at
       FROM users WHERE id = ?`
  ).bind(id).first<UserRow>();
  const origin = new URL(c.req.url).origin;
  c.status(201);
  return c.json(rowToScimUser(row!, origin));
});

// PUT /scim/v2/Users/:id — full replace
scim.put('/Users/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  let body: ScimUserPayload;
  try { body = await c.req.json<ScimUserPayload>(); }
  catch { return c.json(scimError(400, 'Invalid JSON'), 400); }
  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE id = ? AND tenant_id = ?`
  ).bind(id, auth.tenantId).first<{ id: string }>();
  if (!existing) return c.json(scimError(404, 'User not found'), 404);

  const cols = payloadToColumns(body);
  await c.env.DB.prepare(
    `UPDATE users
        SET email = ?, name = ?, given_name = ?, family_name = ?,
            external_id = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?`
  ).bind(
    cols.email, cols.name, cols.given_name ?? null, cols.family_name ?? null,
    cols.external_id ?? null, cols.status ?? 'active',
    id, auth.tenantId,
  ).run();

  await writeAudit(c.env.DB, {
    tenantId: auth.tenantId, userId: auth.userId,
    action: 'scim.user.replaced', resource: `user/${id}`,
    details: { email: cols.email, status: cols.status, source: 'SCIM' },
  });

  const row = await c.env.DB.prepare(
    `SELECT id, tenant_id, email, name, given_name, family_name, external_id,
            role, status, created_at, COALESCE(updated_at, created_at) as updated_at
       FROM users WHERE id = ?`
  ).bind(id).first<UserRow>();
  const origin = new URL(c.req.url).origin;
  return c.json(rowToScimUser(row!, origin));
});

// PATCH /scim/v2/Users/:id — Okta-compatible op list.
// Supports two op shapes IdPs actually emit:
//   1. {op:"replace", path:"active", value:false}        ← deactivate
//   2. {op:"replace", value:{active:false, userName:"…"}} ← Azure AD
interface ScimPatchOp { op?: string; path?: string; value?: unknown }
scim.patch('/Users/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id, email, name, given_name, family_name, external_id, status
       FROM users WHERE id = ? AND tenant_id = ?`
  ).bind(id, auth.tenantId).first<UserRow>();
  if (!existing) return c.json(scimError(404, 'User not found'), 404);

  let body: { Operations?: ScimPatchOp[] };
  try { body = await c.req.json<{ Operations?: ScimPatchOp[] }>(); }
  catch { return c.json(scimError(400, 'Invalid JSON'), 400); }
  const ops = body.Operations ?? [];

  const merged: Partial<UserRow> = { ...existing };
  for (const op of ops) {
    const opType = (op.op ?? '').toLowerCase();
    if (opType !== 'replace' && opType !== 'add' && opType !== 'remove') continue;
    if (op.path && typeof op.value !== 'object') {
      // Targeted scalar replace, e.g. {op:"replace", path:"active", value:false}
      applyScalar(merged, op.path, opType === 'remove' ? null : op.value);
    } else if (typeof op.value === 'object' && op.value !== null) {
      // Whole-object replace, e.g. {op:"replace", value:{active:false}}
      const payload = op.value as ScimUserPayload;
      Object.assign(merged, payloadToColumns(payload));
    }
  }

  await c.env.DB.prepare(
    `UPDATE users
        SET email = ?, name = ?, given_name = ?, family_name = ?,
            external_id = ?, status = ?, updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?`
  ).bind(
    merged.email, merged.name, merged.given_name ?? null, merged.family_name ?? null,
    merged.external_id ?? null, merged.status ?? 'active',
    id, auth.tenantId,
  ).run();

  await writeAudit(c.env.DB, {
    tenantId: auth.tenantId, userId: auth.userId,
    action: 'scim.user.patched', resource: `user/${id}`,
    details: { ops: ops.length, status: merged.status, source: 'SCIM' },
  });

  const row = await c.env.DB.prepare(
    `SELECT id, tenant_id, email, name, given_name, family_name, external_id,
            role, status, created_at, COALESCE(updated_at, created_at) as updated_at
       FROM users WHERE id = ?`
  ).bind(id).first<UserRow>();
  const origin = new URL(c.req.url).origin;
  return c.json(rowToScimUser(row!, origin));
});

function applyScalar(target: Partial<UserRow>, path: string, value: unknown) {
  const p = path.toLowerCase();
  if (p === 'active') {
    target.status = value === true ? 'active' : 'deactivated';
  } else if (p === 'username') {
    target.email = String(value || '').toLowerCase();
  } else if (p === 'externalid') {
    target.external_id = value == null ? null : String(value);
  } else if (p === 'name.givenname') {
    target.given_name = value == null ? null : String(value);
  } else if (p === 'name.familyname') {
    target.family_name = value == null ? null : String(value);
  } else if (p === 'name.formatted' || p === 'displayname') {
    target.name = String(value || '');
  }
}

// DELETE /scim/v2/Users/:id — soft-delete (sets status='deactivated').
// SOC 2 evidence requires we keep the row for audit; never DROP DELETE.
scim.delete('/Users/:id', async (c) => {
  const auth = c.get('auth') as AuthContext;
  const id = c.req.param('id');
  const existing = await c.env.DB.prepare(
    `SELECT id FROM users WHERE id = ? AND tenant_id = ?`
  ).bind(id, auth.tenantId).first<{ id: string }>();
  if (!existing) return c.json(scimError(404, 'User not found'), 404);

  await c.env.DB.prepare(
    `UPDATE users SET status = 'deactivated', updated_at = datetime('now')
      WHERE id = ? AND tenant_id = ?`
  ).bind(id, auth.tenantId).run();

  await writeAudit(c.env.DB, {
    tenantId: auth.tenantId, userId: auth.userId,
    action: 'scim.user.deactivated', resource: `user/${id}`,
    details: { source: 'SCIM' },
  });

  c.status(204);
  return c.body(null);
});

export default scim;
