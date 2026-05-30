/**
 * License Enforcement — for customer-hosted hybrid / on-premise deployments.
 *
 * Architecture
 * ============
 * Atheon supports three deployment models (see `tenants.deployment_model`):
 *
 *   1. saas       — Atheon's Cloudflare Workers. No license enforcement
 *                   needed: we control the runtime.
 *   2. on-premise — Customer hosts the entire stack in their VPC; license
 *                   key is granted with the contract.
 *   3. hybrid     — Customer hosts the data plane (catalyst execution,
 *                   ERP integration, mind queries); Atheon's cloud
 *                   provides license + version + config management.
 *
 * On-premise and hybrid both run the SAME Worker code as the cloud, just
 * with `DEPLOYMENT_ROLE = 'customer'` set. This service is the difference
 * that turns the cloud-mode runtime into a customer-mode runtime: it
 * phones home periodically and refuses traffic if the license is revoked.
 *
 * Phone-home protocol
 * ===================
 * Customer instance calls `GET ${ATHEON_LICENSE_CHECK_URL}?key=${LICENCE_KEY}`
 * (cloud endpoint at `/api/agent/license-check`). The cloud returns:
 *
 *   { valid: boolean, expires_at: string|null, status: 'active'|'expired'|'revoked'|'unknown' }
 *
 * The customer caches the result in CACHE KV under
 * `license-enforcement:status` with a 1-hour TTL. The middleware reads
 * this cache on every data-plane request — if the cache is missing /
 * stale, it triggers a fresh phone-home (with timeout, fail-open on
 * network errors so a transient outage doesn't take a customer offline).
 *
 * Failure modes
 * =============
 * - Network failure during phone-home: fail-OPEN (last good cached value
 *   stays until it naturally expires; a true revocation will catch up
 *   on next poll). Logged for ops.
 * - License revoked on cloud side: fail-CLOSED (middleware returns 503
 *   on the next request after the cache refreshes). Customer admin sees
 *   a clear remediation message.
 * - Cloud unreachable for more than 7 days: fail-CLOSED (we treat
 *   long-running disconnection as suspicious; customer must reconnect to
 *   verify their license).
 */
import type { Context, Next } from 'hono';
import type { AppBindings } from '../types';

/** Cached license status — fits inside one KV value. */
interface LicenseStatus {
  valid: boolean;
  expires_at: string | null;
  status: 'active' | 'expired' | 'revoked' | 'unknown';
  /** ISO timestamp of the most recent successful phone-home. */
  last_checked_at: string;
  /** Reason text for ops + UI. */
  reason: string;
}

const CACHE_KEY = 'license-enforcement:status';
const CACHE_TTL_SECONDS = 60 * 60; // 1 hour
const STALE_DAYS_FAIL_CLOSED = 7;
const PHONE_HOME_TIMEOUT_MS = 5_000;

/**
 * Paths that bypass enforcement even on a customer instance with a bad
 * license. These are required for the customer to recover (re-validate
 * their license, view the remediation message, agent heartbeat, health).
 */
const ENFORCEMENT_BYPASS = [
  '/api/healthz',
  '/api/v1/healthz',
  '/api/agent/heartbeat',
  '/api/v1/agent/heartbeat',
  '/api/v1/license-status',  // exposed by the customer instance for ops
];

/**
 * Phone home to the cloud's license-check endpoint. Returns null on
 * network failure (caller should treat as "use cached value, don't
 * change anything").
 */
async function phoneHome(env: AppBindings['Bindings']): Promise<LicenseStatus | null> {
  if (!env.ATHEON_LICENSE_CHECK_URL || !env.LICENCE_KEY) return null;
  try {
    const url = `${env.ATHEON_LICENSE_CHECK_URL}?key=${encodeURIComponent(env.LICENCE_KEY)}`;
    const resp = await fetch(url, {
      method: 'GET',
      headers: { 'X-Atheon-Customer-Phone-Home': '1' },
      signal: AbortSignal.timeout(PHONE_HOME_TIMEOUT_MS),
    });
    if (!resp.ok) {
      // Cloud said "no" — record the negative result so middleware blocks.
      return {
        valid: false,
        expires_at: null,
        status: resp.status === 403 ? 'revoked' : 'unknown',
        last_checked_at: new Date().toISOString(),
        reason: `Cloud responded ${resp.status}: ${await resp.text().catch(() => 'no body')}`,
      };
    }
    const body = await resp.json() as Partial<LicenseStatus>;
    return {
      valid: !!body.valid,
      expires_at: body.expires_at ?? null,
      status: body.status ?? (body.valid ? 'active' : 'unknown'),
      last_checked_at: new Date().toISOString(),
      reason: body.reason ?? '',
    };
  } catch (err) {
    // Network failure — caller treats as "no update", fall back to cache.
    console.error('license-enforcement: phone-home failed', err);
    return null;
  }
}

/**
 * Read the current license status from KV cache, refreshing via phone-home
 * if missing. Returns the canonical status the middleware should enforce.
 */
async function getCurrentStatus(env: AppBindings['Bindings']): Promise<LicenseStatus> {
  // KV read
  const cached = await env.CACHE.get(CACHE_KEY);
  let status: LicenseStatus | null = null;
  if (cached) {
    try { status = JSON.parse(cached) as LicenseStatus; } catch { /* corrupt → treat as missing */ }
  }

  // Helper: enforce the 7-day fail-closed override regardless of which
  // code path produced the status. Previously this check only ran on the
  // "cache < 1h fresh" branch — meaning a customer disconnected for >7d
  // would phone-home, fail, and silently keep their cached `valid:true`
  // forever. We now apply it any time a cached status is returned.
  const applyStaleGuard = (s: LicenseStatus): LicenseStatus => {
    const ageDays = (Date.now() - new Date(s.last_checked_at).getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > STALE_DAYS_FAIL_CLOSED) {
      return {
        ...s,
        valid: false,
        status: 'unknown',
        reason: `License has not been validated against Atheon cloud for ${ageDays.toFixed(0)} days; failing closed for safety. Restore network connectivity to ${env.ATHEON_LICENSE_CHECK_URL} to recover.`,
      };
    }
    return s;
  };

  // If cache is missing or > 1 hour old, refresh.
  const isStale = !status
    || (Date.now() - new Date(status.last_checked_at).getTime()) > CACHE_TTL_SECONDS * 1000;

  if (isStale) {
    const fresh = await phoneHome(env);
    if (fresh) {
      await env.CACHE.put(CACHE_KEY, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });
      return fresh;
    }
    // Phone-home failed — keep cached value if any (subject to stale
    // guard), else default to "unknown" (allow once).
    if (status) return applyStaleGuard(status);
    return {
      valid: true, // fail-OPEN on first-ever phone-home failure
      expires_at: null,
      status: 'unknown',
      last_checked_at: new Date().toISOString(),
      reason: 'Initial license phone-home failed; allowing requests until next refresh',
    };
  }

  return applyStaleGuard(status!);
}

/**
 * License-enforcement middleware. Skips entirely for cloud-mode
 * deployments (Atheon's own SaaS). On customer-mode deployments, gates
 * data-plane requests on a phoned-home license validity flag.
 */
export function licenseEnforcement() {
  return async (c: Context<AppBindings>, next: Next) => {
    if (c.env.DEPLOYMENT_ROLE !== 'customer') {
      // Cloud / on-premise without phone-home configured — skip.
      return next();
    }
    if (!c.env.LICENCE_KEY || !c.env.ATHEON_LICENSE_CHECK_URL) {
      // Misconfigured customer instance: scream loudly in logs but allow,
      // so the customer doesn't lock themselves out completely while
      // they fix their docker-compose.
      console.error('license-enforcement: DEPLOYMENT_ROLE=customer but LICENCE_KEY or ATHEON_LICENSE_CHECK_URL is missing; allowing request');
      return next();
    }

    // Bypass: the customer must always be able to reach health + license
    // status endpoints to recover.
    const path = new URL(c.req.url).pathname;
    if (ENFORCEMENT_BYPASS.some(prefix => path.startsWith(prefix))) {
      return next();
    }

    const status = await getCurrentStatus(c.env);
    if (!status.valid) {
      return c.json({
        error: 'license_invalid',
        license_status: status.status,
        message: status.reason || 'This Atheon instance is unable to validate its license against Atheon cloud. Contact your account manager.',
        last_checked_at: status.last_checked_at,
      }, 503);
    }
    return next();
  };
}

/**
 * Read-only license status endpoint — exposed on the customer instance
 * so admins can see what the middleware is going to do without making
 * a real data-plane request. Bypasses enforcement (declared above) so
 * it works even when license is revoked.
 */
export async function getLicenseStatusForAdmin(
  env: AppBindings['Bindings'],
): Promise<LicenseStatus> {
  if (env.DEPLOYMENT_ROLE !== 'customer') {
    return {
      valid: true,
      expires_at: null,
      status: 'active',
      last_checked_at: new Date().toISOString(),
      reason: 'License enforcement skipped: this is a cloud instance (DEPLOYMENT_ROLE != customer)',
    };
  }
  return getCurrentStatus(env);
}

/**
 * Force a fresh phone-home (admin-triggered "Re-validate now"). Updates
 * the cached status. Used by the customer admin UI when they've fixed
 * connectivity or a license has just been renewed.
 */
export async function refreshLicenseNow(
  env: AppBindings['Bindings'],
): Promise<LicenseStatus | { error: string }> {
  if (env.DEPLOYMENT_ROLE !== 'customer') {
    return { error: 'License refresh only applies to customer deployments' };
  }
  const fresh = await phoneHome(env);
  if (!fresh) return { error: 'Phone-home failed (network error)' };
  await env.CACHE.put(CACHE_KEY, JSON.stringify(fresh), { expirationTtl: CACHE_TTL_SECONDS });
  return fresh;
}
