/**
 * Tenant Isolation Middleware
 * Enforces that authenticated users can only access their own tenant's data.
 * Extracts tenant_id from JWT and overrides any tenant_id query param.
 */

import { Context, Next } from 'hono';
import type { AppBindings, AuthContext } from '../types';
export type { AuthContext } from '../types';
import { verifyToken } from './auth';

/**
 * Middleware that:
 * 1. Verifies the JWT token
 * 2. Extracts tenant_id from the JWT payload
 * 3. Stores auth context in Hono's context variables (c.set/c.get)
 * 4. Ensures tenant_id in query params matches the JWT tenant_id
 */
export function tenantIsolation() {
  return async (c: Context<AppBindings>, next: Next) => {
    const authHeader = c.req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return c.json({ error: 'Unauthorized', message: 'Missing or invalid Authorization header' }, 401);
    }

    const token = authHeader.replace('Bearer ', '');

    try {
      const payload = await verifyToken(token, c.env.JWT_SECRET);
      if (!payload) {
        return c.json({ error: 'Unauthorized', message: 'Invalid or expired token' }, 401);
      }

      // Check if token has been blacklisted (logout)
      const blacklisted = await c.env.CACHE.get(`token:blacklist:${token}`);
      if (blacklisted) {
        return c.json({ error: 'Unauthorized', message: 'Token has been revoked' }, 401);
      }

      const authCtx: AuthContext = {
        userId: payload.sub as string,
        email: payload.email as string,
        name: payload.name as string,
        role: payload.role as string,
        tenantId: payload.tenant_id as string,
        permissions: (payload.permissions as string[]) || [],
      };

      // Store auth context in Hono variables (replaces immutable header approach)
      c.set('auth', authCtx);

      // Check tenant_id query param — if provided, it MUST match the JWT tenant_id
      // Exception: system admins can access any tenant
      const queryTenantId = c.req.query('tenant_id');
      if (queryTenantId && queryTenantId !== authCtx.tenantId && authCtx.role !== 'system_admin') {
        return c.json({
          error: 'Forbidden',
          message: 'You can only access data for your own tenant',
        }, 403);
      }

      // Industry param is passed through to route handlers for filtering,
      // but does NOT override the tenant context. Tenant isolation is preserved.
      // Route handlers can read c.req.query('industry') to filter data within the tenant.

      await next();
    } catch {
      return c.json({ error: 'Unauthorized', message: 'Invalid token' }, 401);
    }
  };
}

/**
 * Helper to get the effective tenant ID from the request.
 * Uses JWT tenant_id from auth context, falling back to query param for unauthenticated routes.
 */
export function getEffectiveTenantId(c: Context<AppBindings>): string {
  const auth = c.get('auth');
  if (auth) return auth.tenantId;
  return c.req.query('tenant_id') || 'vantax';
}
