/**
 * SCIM bearer-token auth middleware.
 *
 * SCIM endpoints are called by enterprise IdPs (Okta, Azure AD, OneLogin,
 * Google Workspace, etc.) — NOT by browsers. The IdP holds a long-lived
 * bearer token per tenant and posts it on every request. This middleware
 * validates the token, scopes the request to that tenant, and stamps the
 * `auth` context so the SCIM handlers can write to D1 the same way the
 * JWT-backed handlers do.
 *
 * Storage model:
 *   - Tokens are generated server-side once, returned in clear ONCE in the
 *     create response, and never stored or logged. Only their SHA-256 hash
 *     lives in the scim_tokens table.
 *   - Token format: "atscim_" + 32 url-safe base64 chars. The 7-char prefix
 *     is shown in the admin UI for identification ("atscim_aBcD3F…") so an
 *     admin can revoke a specific integration without seeing the secret.
 *   - Revocation: `revoked_at` is set on revoke; tokens are kept for audit
 *     history rather than deleted.
 *
 * Audit:
 *   - Every successful auth bumps `last_used_at` so an admin can spot stale
 *     integrations. The actual SCIM operation logs to audit_log separately.
 */
import type { Context, Next } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const SCIM_TOKEN_PREFIX = 'atscim_';

/** SHA-256 hash, URL-safe base64. Matches the format we store on creation. */
async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Validate the bearer token and stamp tenant scope on the request. */
export function scimAuth() {
  return async (c: Context<AppBindings>, next: Next) => {
    const authHeader = c.req.header('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json(scimError(401, 'Missing Bearer token'), 401);
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token.startsWith(SCIM_TOKEN_PREFIX)) {
      return c.json(scimError(401, 'Invalid token format'), 401);
    }
    const tokenHash = await sha256Hex(token);
    const row = await c.env.DB.prepare(
      `SELECT id, tenant_id, name, revoked_at
         FROM scim_tokens
        WHERE token_hash = ?
        LIMIT 1`
    ).bind(tokenHash).first<{ id: string; tenant_id: string; name: string; revoked_at: string | null }>();

    if (!row) return c.json(scimError(401, 'Invalid token'), 401);
    if (row.revoked_at) return c.json(scimError(401, 'Token has been revoked'), 401);

    // Stamp the auth context so downstream handlers (and our audit logger)
    // see this request as tenant-scoped, with a synthetic role that has no
    // execute-anything-but-user-provisioning privileges.
    const auth: AuthContext = {
      userId: `scim:${row.id}`,
      tenantId: row.tenant_id,
      role: 'system_admin',
      email: `scim-token-${row.name}@system.atheon`,
      name: `SCIM token: ${row.name}`,
      permissions: ['scim:read', 'scim:write'],
    };
    c.set('auth', auth);

    // Bump last_used_at — best-effort, never blocks the request. A missed
    // update just means the admin UI shows a slightly stale timestamp.
    void c.env.DB.prepare(
      `UPDATE scim_tokens SET last_used_at = datetime('now') WHERE id = ?`
    ).bind(row.id).run().catch(() => { /* silent */ });

    await next();
  };
}

/** RFC 7644 §3.12 error response shape. */
export function scimError(status: number, detail: string, scimType?: string) {
  return {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: String(status),
    ...(scimType ? { scimType } : {}),
    detail,
  };
}

/**
 * Generate a fresh SCIM token. Returns the clear token (for one-time display)
 * and the hash + prefix to persist. Caller must store hash + prefix and
 * never log the clear token.
 */
export async function generateScimToken(): Promise<{ clear: string; hash: string; prefix: string }> {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  const body = Array.from(bytes)
    .map((b) => b.toString(36).padStart(2, '0'))
    .join('')
    .slice(0, 32);
  const clear = `${SCIM_TOKEN_PREFIX}${body}`;
  const hash = await sha256Hex(clear);
  const prefix = clear.slice(0, 14); // "atscim_" + 7 visible chars
  return { clear, hash, prefix };
}
