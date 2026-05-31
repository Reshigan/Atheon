import { Context, Next } from 'hono';
import type { Env } from '../types';

interface RateLimitConfig {
  windowMs: number;   // Time window in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix?: string;  // KV key prefix
}

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000,    // 1 minute
  maxRequests: 60,     // 60 requests per minute
  keyPrefix: 'rl',
};

export function rateLimiter(config: Partial<RateLimitConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Extract client identifier (IP or auth user)
    const clientId = c.req.header('CF-Connecting-IP') ||
                     c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
                     'unknown';

    const windowKey = Math.floor(Date.now() / cfg.windowMs);
    const kvKey = `${cfg.keyPrefix}:${clientId}:${windowKey}`;

    try {
      const current = await c.env.CACHE.get(kvKey);
      const count = current ? parseInt(current) : 0;

      if (count >= cfg.maxRequests) {
        return c.json({
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil(cfg.windowMs / 1000),
        }, 429);
      }

      // Increment counter
      await c.env.CACHE.put(kvKey, String(count + 1), {
        expirationTtl: Math.ceil(cfg.windowMs / 1000) + 10,
      });

      // Set rate limit headers
      c.header('X-RateLimit-Limit', String(cfg.maxRequests));
      c.header('X-RateLimit-Remaining', String(cfg.maxRequests - count - 1));
    } catch (err) {
      // If KV fails, allow the request through
      console.error('Rate limit KV error:', err);
    }

    await next();
  };
}

// Stricter rate limit for AI/LLM endpoints
export const aiRateLimiter = rateLimiter({
  windowMs: 60000,
  maxRequests: 20,
  keyPrefix: 'rl:ai',
});

// Standard API rate limit
export const apiRateLimiter = rateLimiter({
  windowMs: 60000,
  maxRequests: 120,
  keyPrefix: 'rl:api',
});

// Auth rate limit (prevent brute force)
export const authRateLimiter = rateLimiter({
  windowMs: 300000,  // 5 minutes
  maxRequests: 10,    // 10 attempts per 5 min
  keyPrefix: 'rl:auth',
});

// Demo-login rate limit (extra strict)
export const demoAuthRateLimiter = rateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 3,    // 3 per hour
  keyPrefix: 'rl:demo',
});

// Contact form rate limit (prevent spam)
export const contactRateLimiter = rateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 5,    // 5 per hour per IP
  keyPrefix: 'rl:contact',
});

// Phase 10-25 — DSAR access rate limit. Tightened because the access
// endpoint can return the full subject record across audit_log,
// mind_queries, chat_conversations etc. — useful for legitimate DSAR
// requests but a useful enumeration vector for an attacker who's
// already past auth (e.g. a compromised non-admin token trying to
// guess admin emails). 5 requests per hour is plenty for human-led
// compliance flow; admins doing bulk export should use an offline
// script with a service token.
export const dsarRateLimiter = rateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 5,
  keyPrefix: 'rl:dsar',
});

// Phase 10-25 — DSAR erasure rate limit. Even tighter — erasure is
// destructive and audit-critical. 3 per day per IP is enough for a
// real privacy team's workload and surfaces obviously-anomalous
// activity (mass deletion attack) before it does damage.
export const dsarErasureRateLimiter = rateLimiter({
  windowMs: 86400000, // 24 hours
  maxRequests: 3,
  keyPrefix: 'rl:dsar-erasure',
});

// Phase 10-25 — billing endpoints rate limit. Tighter than the 120
// req/min default because the period-compute query joins
// root_cause_analyses + causal_factors + diagnostic_prescriptions +
// catalyst_actions across the period — a tenant with thousands of
// rows can spike DB read time. 30 req/min is sufficient for a
// dashboard refresh + ad-hoc invoice review.
export const billingRateLimiter = rateLimiter({
  windowMs: 60000,
  maxRequests: 30,
  keyPrefix: 'rl:billing',
});

// Hybrid-license phone-home endpoint rate limit. /api/agent/license-check
// is intentionally unauthenticated (the customer instance phones home with
// only its licence key in the query string) which makes it a tempting
// surface for licence-key enumeration probes from a hostile network. The
// legitimate cadence is exactly one request per hour per deployment;
// 60 req/hour per source IP comfortably covers up to ~50 deployments
// behind a single NAT plus retry traffic, while turning sustained probing
// into a 429 within seconds. Cloudflare's own WAF already rate-limits
// abusive bots; this is defence in depth at the application layer.
export const licenseCheckRateLimiter = rateLimiter({
  windowMs: 3600000, // 1 hour
  maxRequests: 60,
  keyPrefix: 'rl:license-check',
});

/**
 * Phase 6.2: Per-Tenant Rate Limiter
 * Reads tenant entitlements to enforce custom rate limits per tenant.
 * Falls back to default limits if entitlements are not configured.
 */
export function tenantRateLimiter(defaultMax: number = 120) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const auth = c.get('auth' as never) as { tenantId?: string } | undefined;
    const tenantId = auth?.tenantId || 'anonymous';

    // Look up tenant-specific limit from KV cache
    let maxRequests = defaultMax;
    try {
      const cached = await c.env.CACHE.get(`tenant_rl:${tenantId}`);
      if (cached) {
        maxRequests = parseInt(cached, 10) || defaultMax;
      }
    } catch {
      // KV failure — use default
    }

    const windowMs = 60000;
    const windowKey = Math.floor(Date.now() / windowMs);
    const kvKey = `rl:tenant:${tenantId}:${windowKey}`;

    try {
      const current = await c.env.CACHE.get(kvKey);
      const count = current ? parseInt(current) : 0;

      if (count >= maxRequests) {
        c.header('X-RateLimit-Limit', String(maxRequests));
        c.header('X-RateLimit-Remaining', '0');
        c.header('Retry-After', String(Math.ceil(windowMs / 1000)));
        return c.json({ error: 'Tenant rate limit exceeded', retryAfter: Math.ceil(windowMs / 1000) }, 429);
      }

      await c.env.CACHE.put(kvKey, String(count + 1), { expirationTtl: Math.ceil(windowMs / 1000) + 10 });
      c.header('X-RateLimit-Limit', String(maxRequests));
      c.header('X-RateLimit-Remaining', String(maxRequests - count - 1));
    } catch (err) {
      console.error('Tenant rate limit error:', err);
    }

    await next();
  };
}
