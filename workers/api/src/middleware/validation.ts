/**
 * Input Validation & Sanitization Middleware
 * Protects against injection, XSS, and malformed input
 */

import { Context, Next } from 'hono';
import type { Env } from '../types';

// ── Sanitization Helpers ──

export function sanitizeString(input: string): string {
  return input
    .replace(/[<>]/g, '') // Strip HTML angle brackets
    .replace(/javascript:/gi, '') // Strip JS protocol
    .replace(/on\w+=/gi, '') // Strip event handlers
    .trim();
}

export function sanitizeObject(obj: Record<string, unknown>): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeString(value);
    } else if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      sanitized[key] = sanitizeObject(value as Record<string, unknown>);
    } else if (Array.isArray(value)) {
      sanitized[key] = value.map(v => typeof v === 'string' ? sanitizeString(v) : v);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

// ── Validation Rules ──

interface ValidationRule {
  field: string;
  type: 'string' | 'number' | 'boolean' | 'email' | 'uuid' | 'url';
  required?: boolean;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  pattern?: RegExp;
}

export function validateInput(data: Record<string, unknown>, rules: ValidationRule[]): string[] {
  const errors: string[] = [];

  for (const rule of rules) {
    const value = data[rule.field];

    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${rule.field} is required`);
      continue;
    }

    if (value === undefined || value === null) continue;

    switch (rule.type) {
      case 'string':
        if (typeof value !== 'string') {
          errors.push(`${rule.field} must be a string`);
        } else {
          if (rule.minLength && value.length < rule.minLength) errors.push(`${rule.field} must be at least ${rule.minLength} characters`);
          if (rule.maxLength && value.length > rule.maxLength) errors.push(`${rule.field} must be at most ${rule.maxLength} characters`);
          if (rule.pattern && !rule.pattern.test(value)) errors.push(`${rule.field} has invalid format`);
        }
        break;
      case 'number':
        if (typeof value !== 'number' || isNaN(value)) {
          errors.push(`${rule.field} must be a number`);
        } else {
          if (rule.min !== undefined && value < rule.min) errors.push(`${rule.field} must be at least ${rule.min}`);
          if (rule.max !== undefined && value > rule.max) errors.push(`${rule.field} must be at most ${rule.max}`);
        }
        break;
      case 'boolean':
        if (typeof value !== 'boolean') errors.push(`${rule.field} must be a boolean`);
        break;
      case 'email':
        if (typeof value !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
          errors.push(`${rule.field} must be a valid email address`);
        }
        break;
      case 'uuid':
        if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
          errors.push(`${rule.field} must be a valid UUID`);
        }
        break;
      case 'url':
        if (typeof value !== 'string') {
          errors.push(`${rule.field} must be a valid URL`);
        } else {
          try { new URL(value); } catch { errors.push(`${rule.field} must be a valid URL`); }
        }
        break;
    }
  }

  return errors;
}

// ── Request Size Limiter Middleware ──

export function requestSizeLimiter(maxBytes: number = 1048576) {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    const contentLength = c.req.header('Content-Length');
    if (contentLength && parseInt(contentLength) > maxBytes) {
      return c.json({ error: 'Request body too large', maxBytes }, 413);
    }
    await next();
  };
}

// ── Audit Enrichment Middleware ──

export function auditEnrichment() {
  return async (c: Context<{ Bindings: Env }>, next: Next) => {
    // Capture request metadata for audit logging
    const ipAddress = c.req.header('CF-Connecting-IP') ||
                      c.req.header('X-Forwarded-For')?.split(',')[0]?.trim() ||
                      c.req.header('X-Real-IP') || 'unknown';
    const userAgent = c.req.header('User-Agent') || 'unknown';
    const country = c.req.header('CF-IPCountry') || 'unknown';
    const requestId = crypto.randomUUID();

    // Add response headers (don't modify immutable request headers in Workers)
    c.header('X-Request-ID', requestId);

    const start = Date.now();
    await next();
    const duration = Date.now() - start;

    // Log to audit for mutation operations
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(c.req.method)) {
      try {
        const tenantId = c.req.query('tenant_id') || 'system';
        const userId: string | null = null;

        await c.env.DB.prepare(
          'INSERT INTO audit_log (id, tenant_id, user_id, action, layer, resource, details, outcome, ip_address, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(\'now\'))'
        ).bind(
          requestId, tenantId, userId,
          `${c.req.method} ${c.req.path}`, 'api', c.req.path,
          JSON.stringify({ method: c.req.method, duration, userAgent: userAgent.substring(0, 200), country }),
          c.res.status < 400 ? 'success' : 'failure',
          ipAddress,
        ).run();
      } catch {
        // Don't fail the request if audit logging fails
      }
    }
  };
}
