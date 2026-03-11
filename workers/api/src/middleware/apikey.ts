/**
 * Phase 6.3: API Key Authentication Middleware
 * Authenticates requests using API keys (athn_ prefix) as an alternative to JWT.
 * Looks up the key hash in the api_keys table and sets auth context.
 */
import { Context, Next } from 'hono';
import type { Env } from '../types';

/**
 * Middleware that checks for API key authentication via X-API-Key header.
 * If present, validates against the api_keys table and sets auth context.
 * If not present, falls through to allow JWT auth to handle it.
 */
export function apiKeyAuth() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const apiKey = c.req.header('X-API-Key');

    // No API key header — skip, let JWT auth handle it
    if (!apiKey) {
      await next();
      return;
    }

    // Validate format: must start with athn_
    if (!apiKey.startsWith('athn_')) {
      return c.json({ error: 'Invalid API key format' }, 401);
    }

    try {
      // Hash the key for lookup (SHA-256)
      const encoder = new TextEncoder();
      const data = encoder.encode(apiKey);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const keyHash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      // Look up the key
      const keyRecord = await c.env.DB.prepare(
        `SELECT ak.id, ak.tenant_id, ak.name, ak.permissions, ak.expires_at,
                u.id as user_id, u.email, u.name as user_name, u.role
         FROM api_keys ak
         LEFT JOIN users u ON u.id = ak.user_id
         WHERE ak.key_hash = ? LIMIT 1`
      ).bind(keyHash).first<{
        id: string; tenant_id: string; name: string; permissions: string;
        expires_at: string | null; user_id: string; email: string;
        user_name: string; role: string;
      }>();

      if (!keyRecord) {
        return c.json({ error: 'Invalid API key' }, 401);
      }

      // Check expiry
      if (keyRecord.expires_at && new Date(keyRecord.expires_at) < new Date()) {
        return c.json({ error: 'API key expired' }, 401);
      }

      // Set auth context
      c.set('auth' as never, {
        userId: keyRecord.user_id || 'api-key',
        email: keyRecord.email || `apikey-${keyRecord.name}@system`,
        name: keyRecord.user_name || keyRecord.name,
        role: keyRecord.role || 'api',
        tenantId: keyRecord.tenant_id,
        permissions: JSON.parse(keyRecord.permissions || '["read"]'),
      } as never);

      // Update last_used timestamp
      await c.env.DB.prepare(
        'UPDATE api_keys SET last_used = datetime(\'now\') WHERE id = ?'
      ).bind(keyRecord.id).run().catch(() => { /* non-fatal */ });

      await next();
    } catch (err) {
      console.error('API key auth error:', err);
      return c.json({ error: 'Authentication failed' }, 500);
    }
  };
}
