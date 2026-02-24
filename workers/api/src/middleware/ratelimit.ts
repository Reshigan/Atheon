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
