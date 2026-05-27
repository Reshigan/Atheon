import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env, AppBindings } from './types';
import { apiRateLimiter, authRateLimiter, aiRateLimiter, demoAuthRateLimiter, contactRateLimiter, dsarRateLimiter, dsarErasureRateLimiter, billingRateLimiter } from './middleware/ratelimit';
import { hashPassword } from './middleware/auth';
import { auditEnrichment, requestSizeLimiter, getValidatedJsonBody } from './middleware/validation';
import { runMigrations, MIGRATION_VERSION } from './services/migrate';
import { tenantIsolation, requireRole } from './middleware/tenant';
import { DashboardRoom } from './services/realtime';
import { handleScheduled, handleQueueMessage } from './services/scheduled';
import { captureException } from './services/sentry';
import type { CatalystQueueMessage } from './services/scheduled';
import { sendOrQueueEmail } from './services/email';
import { requestIdMiddleware } from './middleware/requestid';
import { logError, logInfo, logWarn } from './services/logger';
import { licenseEnforcement, getLicenseStatusForAdmin, refreshLicenseNow } from './services/license-enforcement';
import auth, { validatePasswordStrength } from './routes/auth';
import tenants from './routes/tenants';
import iam from './routes/iam';
import scim from './routes/scim';
import statusPublic from './routes/status';
import statusAdmin from './routes/status-admin';
import apex from './routes/apex';
import dashboard from './routes/dashboard';
import pulse from './routes/pulse';
import catalysts from './routes/catalysts';
import memory from './routes/memory';
import mind from './routes/mind';
import erp from './routes/erp';
import controlplane from './routes/controlplane';
import audit from './routes/audit';
import connectivity from './routes/connectivity';
import notifications from './routes/notifications';
import storage from './routes/storage';
import realtime from './routes/realtime';
import deployments from './routes/deployments';
import assessments from './routes/assessments';
import agentRoutes from './routes/agent-routes';
import aiCosts from './routes/ai-costs';
import seedVantaX from './routes/seed-vantax';
import demoSeedRoutes from './routes/demo-seed';
import tenantsAdmin from './routes/tenants-admin';
import radar from './routes/radar';
import diagnosticsRoutes from './routes/diagnostics';
import inferenceFeedbackRoutes from './routes/inference-feedback';
import billingRoutes from './routes/billing';
import dsarRoutes from './routes/dsar';
import orchestrationRoutes from './routes/orchestration';
import insightsStatsRoutes from './routes/insights-stats';
import catalystIntelligence from './routes/catalyst-intelligence';
import roi from './routes/roi';
import boardReport from './routes/board-report';
import onboarding from './routes/onboarding';
import freshness from './routes/freshness';
import atheonScore from './routes/atheon-score';
import trialAssessment from './routes/trial-assessment';
import baselineRoutes from './routes/baseline';
import targetRoutes from './routes/targets';
import executiveSummary from './routes/executive-summary';
import adminTooling from './routes/admin-tooling';
import webhooksRoutes from './routes/webhooks';
import governance from './routes/governance';
import systemAlerts from './routes/system-alerts';
import featureFlagsRoutes from './routes/feature-flags';
import supportRoutes from './routes/support';
import confidenceThresholds from './routes/confidence-thresholds';
import openapi from './routes/openapi';
import compliance from './routes/compliance';
import auditShare from './routes/audit-share';

// Export Durable Object class for Cloudflare runtime
export { DashboardRoom };

const app = new Hono<AppBindings>();

// CORS - restricted to production and preview domains
// Phase 1.6: Lock down localhost origins in production
const PRODUCTION_ORIGINS = [
  'https://atheon.vantax.co.za',
  'https://atheon-33b.pages.dev',
];
const DEV_ORIGINS = [
  'http://localhost:5173',
  'http://localhost:3000',
];

app.use('*', cors({
  origin: (origin, c) => {
    if (!origin) return 'https://atheon.vantax.co.za';
    if (PRODUCTION_ORIGINS.includes(origin)) return origin;
    // Allow Cloudflare Pages preview deployments
    if (origin.endsWith('.atheon-33b.pages.dev')) return origin;
    // Allow localhost in non-production environments (includes on-premise and dev)
    const env = (c as unknown as { env: { ENVIRONMENT?: string } }).env;
    if (env?.ENVIRONMENT !== 'production' && DEV_ORIGINS.includes(origin)) return origin;
    return null as unknown as string;
  },
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  // X-Request-ID added 2026-05-12: the frontend api client attaches a
  // correlation ID to every request (Security S8), and the browser CORS
  // preflight blocks the request unless we declare it allowed here.
  // X-Setup-Secret added so the documented /admin/setup curl path works
  // from a browser-based debug surface, not just from terminal curl.
  allowHeaders: ['Content-Type', 'Authorization', 'X-Tenant-ID', 'X-Licence-Key', 'X-Request-ID', 'X-Setup-Secret'],
  exposeHeaders: ['Content-Length', 'X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-Request-ID'],
  maxAge: 86400,
  credentials: true,
}));

// Security S8: X-Request-ID correlation header (generates or validates inbound IDs,
// then echoes them back on the response). Registered FIRST so downstream middleware,
// auth, rate limiting, and logger calls can read c.get('requestId').
app.use('*', requestIdMiddleware);

// H6: CSRF protection + additional security headers
app.use('*', async (c, next) => {
  await next();
  // H6: CSRF protection — enforce SameSite=Strict on any Set-Cookie headers
  const existingCookie = c.res.headers.get('Set-Cookie');
  if (existingCookie && !existingCookie.includes('SameSite')) {
    c.res.headers.set('Set-Cookie', `${existingCookie}; SameSite=Strict; Secure`);
  }
  // Additional security headers
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'strict-origin-when-cross-origin');
});

// Spec 7 PERF-1: Response time middleware with X-Response-Time header + slow request logging
app.use('*', async (c, next) => {
  const start = Date.now();
  await next();
  const duration = Date.now() - start;
  c.header('X-Response-Time', `${duration}ms`);
  if (duration > 500) {
    console.warn(`[SLOW] ${c.req.method} ${c.req.path} took ${duration}ms`);
  }
  // Store metrics in KV (non-blocking, best-effort)
  try {
    const minute = Math.floor(Date.now() / 60000);
    const bucket = c.req.path.split('/').slice(0, 4).join('/');
    const key = `perf:${bucket}:${minute}`;
    const existing = await c.env.CACHE.get(key);
    const metrics = existing ? JSON.parse(existing) as { count: number; totalMs: number; slowCount: number } : { count: 0, totalMs: 0, slowCount: 0 };
    metrics.count++;
    metrics.totalMs += duration;
    if (duration > 500) metrics.slowCount++;
    c.executionCtx.waitUntil(c.env.CACHE.put(key, JSON.stringify(metrics), { expirationTtl: 3600 }));
  } catch { /* non-fatal */ }
});

// Request size limiter (1MB max)
app.use('/api/*', requestSizeLimiter(1048576));

// Audit enrichment middleware (captures IP, user-agent, logs mutations)
app.use('/api/*', auditEnrichment());

// Rate limiting
app.use('/api/auth/demo-login', demoAuthRateLimiter);
app.use('/api/auth/*', authRateLimiter);
app.use('/api/mind/*', aiRateLimiter);
app.use('/api/contact', contactRateLimiter);

// Phase 10-25 — strict rate limits for sensitive endpoints. These
// MUST come BEFORE the general apiRateLimiter so they win on path
// match. Hono evaluates middleware in registration order.
// DSAR erasure tightest (3/day); DSAR access tighter (5/hour);
// billing 30/min (vs default 120/min) to bound the period-compute
// join cost.
app.use('/api/dsar/erasure', dsarErasureRateLimiter);
app.use('/api/v1/dsar/erasure', dsarErasureRateLimiter);
app.use('/api/dsar/access', dsarRateLimiter);
app.use('/api/v1/dsar/access', dsarRateLimiter);
app.use('/api/billing/*', billingRateLimiter);
app.use('/api/v1/billing/*', billingRateLimiter);

app.use('/api/*', apiRateLimiter);

// License enforcement — only fires when DEPLOYMENT_ROLE === 'customer'
// (hybrid + on-premise deployments). On Atheon's own SaaS this is a no-op.
// See services/license-enforcement.ts for the phone-home protocol.
app.use('/api/*', licenseEnforcement());

// Customer-side license-status endpoints — read-only for ops dashboards
// + a forced re-validate trigger for admins.
app.get('/api/v1/license-status', async (c) => {
  const status = await getLicenseStatusForAdmin(c.env);
  return c.json(status);
});
app.post('/api/v1/license-status/refresh', async (c) => {
  const result = await refreshLicenseNow(c.env);
  return c.json(result);
});

// 4.4: Database migrations — extracted to services/migrate.ts
// All DDL, indexes, self-heal columns, role upgrades, and seed orchestration
// now live in runMigrations(). POST /api/v1/admin/migrate is the canonical
// entry point; the legacy auto-migration middleware below provides backward compat.

// ── Auto-Migration + Guard Middleware ──
// On first request after a MIGRATION_VERSION bump, runs migrations
// automatically (backward compat). Once the KV flag is set, subsequent
// requests skip migration and pass through to next().
//
// Bounding contract (post-2026-04-30 prod incident):
//   - First request takes a "running" lease on a KV lock key (60s TTL)
//   - Concurrent requests that see the lease return 503 immediately
//     instead of stacking up behind a slow migration
//   - The lease-holder bounds the migration with AUTO_MIGRATE_TIMEOUT_MS
//     (default 25s — under Cloudflare's 30s request limit). On timeout
//     we mark KV='timeout' so subsequent requests stop retrying, and
//     return 503 with a hint to call POST /api/v1/admin/migrate.
//   - Operators recover by calling /admin/migrate (no time bound) or by
//     setting the migrated flag manually if the schema is known-good.
// 2026-05-12: bumped from 25s → 50s. The v73-orchestration migration on
// the production tenant took >25s, repeatedly tripping the timeout and
// trapping operators in a 503 loop because the recovery path (POST
// /admin/migrate) requires SETUP_SECRET that wasn't to hand. 50s sits
// inside Cloudflare Workers' CPU budget envelope and gives the cold-cache
// path enough room. If this keeps timing out, the right move is to split
// the migration into chunks, not to bump again.
const AUTO_MIGRATE_TIMEOUT_MS = 50_000;
const AUTO_MIGRATE_LEASE_TTL_S = 90;
const AUTO_MIGRATE_ERROR_TTL_S = 60;  // shorter so a failure recovers within a minute

// Phase BD: KV-write throttle for /healthz. Single writer per minute per
// worker isolate so a high-rate probe (load test, external monitoring)
// doesn't trip Cloudflare KV's 1-write-per-second-per-key limit and
// self-DoS the health endpoint into 503s.
const KV_WRITE_THROTTLE_MS = 60_000;
let lastKvWriteAt = 0;

app.use('*', async (c, next) => {
  const path = c.req.path;
  if (path === '/healthz' || path === '/' || path.includes('/admin/migrate') || path.includes('/admin/setup')) {
    await next();
    return;
  }

  const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
  const leaseKey = `db:migrating:${MIGRATION_VERSION}`;
  const alreadyMigrated = await c.env.CACHE.get(migrationKey);

  if (alreadyMigrated === 'true') {
    await next();
    return;
  }

  if (alreadyMigrated === 'error' || alreadyMigrated === 'timeout') {
    return c.json({
      error: 'Service unavailable',
      message: alreadyMigrated === 'timeout'
        ? 'Database migration exceeded the auto-migration timeout. Call POST /api/v1/admin/migrate to complete it.'
        : 'Database migration failed. Call POST /api/v1/admin/migrate to retry.',
      version: MIGRATION_VERSION,
      reason: alreadyMigrated,
    }, 503);
  }

  // Acquire a short-lived lease so concurrent requests don't all attempt
  // migration in parallel. KV doesn't have native CAS — but a short-TTL
  // get/put pair is sufficient: at most one request "loses" by writing
  // its lease milliseconds after another, and migrations are idempotent.
  const existingLease = await c.env.CACHE.get(leaseKey);
  if (existingLease) {
    return c.json({
      error: 'Service unavailable',
      message: 'Database migration in progress on another request — retry shortly.',
      version: MIGRATION_VERSION,
      reason: 'migration_in_progress',
    }, 503);
  }
  await c.env.CACHE.put(leaseKey, '1', { expirationTtl: AUTO_MIGRATE_LEASE_TTL_S });

  // Race the migration against a hard timeout. If the timeout wins, we
  // mark the version key as 'timeout' so subsequent requests fail fast
  // with a clear operator-actionable message instead of stacking up.
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(() => reject(new Error('auto_migrate_timeout')), AUTO_MIGRATE_TIMEOUT_MS);
  });

  try {
    await Promise.race([runMigrations(c.env.DB), timeoutPromise]);
    await c.env.CACHE.put(migrationKey, 'true', { expirationTtl: 86400 });
  } catch (e) {
    const isTimeout = e instanceof Error && e.message === 'auto_migrate_timeout';
    console.error(isTimeout ? 'Auto-migration timed out' : 'Auto-migration error:', e);
    await c.env.CACHE.put(
      migrationKey,
      isTimeout ? 'timeout' : 'error',
      { expirationTtl: AUTO_MIGRATE_ERROR_TTL_S },
    );
    return c.json({
      error: 'Service unavailable',
      message: isTimeout
        ? 'Database migration exceeded the auto-migration timeout. Call POST /api/v1/admin/migrate to complete it.'
        : 'Database migration failed on first request. Call POST /api/v1/admin/migrate to retry.',
      version: MIGRATION_VERSION,
      reason: isTimeout ? 'timeout' : 'error',
    }, 503);
  } finally {
    // Release the lease whether we succeeded or failed — successful
    // migrations don't need the lease (migrationKey='true' short-circuits)
    // and failed ones write their state into migrationKey directly.
    await c.env.CACHE.delete(leaseKey).catch(() => { /* non-fatal */ });
  }

  await next();
});

// Root endpoint — versioned
app.get('/', (c) => {
  return c.json({
    name: 'Atheon™ Enterprise Intelligence Platform API',
    version: '4.0.0',
    apiVersion: 'v1',
    status: 'operational',
    endpoints: {
      auth: '/api/v1/auth',
      tenants: '/api/v1/tenants',
      iam: '/api/v1/iam',
      apex: '/api/v1/apex',
      pulse: '/api/v1/pulse',
      catalysts: '/api/v1/catalysts',
      memory: '/api/v1/memory',
      mind: '/api/v1/mind',
      erp: '/api/v1/erp',
      controlplane: '/api/v1/controlplane',
      audit: '/api/v1/audit',
      connectivity: '/api/v1/connectivity',
      notifications: '/api/v1/notifications',
      storage: '/api/v1/storage',
      realtime: '/api/v1/realtime',
      assessments: '/api/v1/assessments',
      diagnostics: '/api/v1/diagnostics',
      'catalyst-intelligence': '/api/v1/catalyst-intelligence',
      radar: '/api/v1/radar',
      roi: '/api/v1/roi',
      'board-report': '/api/v1/board-report',
      'atheon-score': '/api/v1/atheon-score',
      trial: '/api/v1/trial',
      baseline: '/api/v1/baseline',
      targets: '/api/v1/targets',
      'executive-summary': '/api/v1/executive-summary',
      support: '/api/v1/support',
    },
    protocols: {
      mcp: '/api/v1/connectivity/mcp',
      a2a: '/api/v1/connectivity/a2a',
      websocket: '/api/v1/realtime/ws',
    },
    documentation: 'https://atheon.vantax.co.za',
  });
});

// GAP-05: Enhanced health check with DB connectivity probe
app.get('/healthz', async (c) => {
  const t0 = Date.now();
  let dbStatus = 'ok';
  let dbLatencyMs = 0;
  try {
    const dbStart = Date.now();
    await c.env.DB.prepare('SELECT 1').first();
    dbLatencyMs = Date.now() - dbStart;
  } catch (err) {
    dbStatus = 'error';
    console.error('Healthz DB probe failed:', err);
  }

  // KV health probe.
  //
  // Phase BD: the original version wrote to a single key ('healthz:probe')
  // on every probe. Cloudflare KV rate-limits writes to 1/sec/key, so any
  // monitoring tool polling /healthz at >1 RPS triggered cacheStatus=
  // 'error' → 503 (self-DoS observed at 10 VUs in the load test).
  // Fix: read-only probe by default. Writes are gated to one per minute
  // via a module-scoped timestamp so we still verify write-path health,
  // but we never write more than 60 times/hour regardless of probe load.
  let cacheStatus = 'ok';
  try {
    const now = Date.now();
    if (now - lastKvWriteAt > KV_WRITE_THROTTLE_MS) {
      lastKvWriteAt = now; // optimistic stamp so concurrent probes share
      await c.env.CACHE.put('healthz:probe', String(now), { expirationTtl: 120 });
    }
    const val = await c.env.CACHE.get('healthz:probe');
    if (!val) cacheStatus = 'degraded';
  } catch {
    cacheStatus = 'error';
  }

  // Spec 7 PERF-2: Aggregate performance metrics from KV
  // OPTIMIZED: Use KV list() to find keys in one call instead of 61 individual GETs
  let avgResponseMs = 0;
  let slowRequestsLastHour = 0;
  try {
    const perfKeys = await c.env.CACHE.list({ prefix: 'perf:/api:' });
    let totalRequests = 0;
    let totalMs = 0;
    let totalSlow = 0;
    // Fetch values for found keys (typically far fewer than 61)
    for (const key of perfKeys.keys) {
      const raw = await c.env.CACHE.get(key.name);
      if (raw) {
        const parsed = JSON.parse(raw) as { count: number; totalMs: number; slowCount: number };
        totalRequests += parsed.count;
        totalMs += parsed.totalMs;
        totalSlow += parsed.slowCount;
      }
    }
    avgResponseMs = totalRequests > 0 ? Math.round(totalMs / totalRequests) : 0;
    slowRequestsLastHour = totalSlow;
  } catch { /* non-fatal */ }

  const overall = dbStatus === 'ok' && cacheStatus === 'ok' ? 'healthy' : 'degraded';
  const statusCode = overall === 'healthy' ? 200 : 503;

  return c.json({
    status: overall,
    timestamp: new Date().toISOString(),
    uptime: Date.now() - t0,
    checks: {
      database: { status: dbStatus, latencyMs: dbLatencyMs },
      cache: { status: cacheStatus },
    },
    performance: {
      avg_response_ms: avgResponseMs,
      slow_requests_last_hour: slowRequestsLastHour,
      d1_query_ms: dbLatencyMs,
    },
  }, statusCode);
});

// Tenant isolation middleware for protected routes (supports both /api/ and /api/v1/ prefixes)
// Auth routes are excluded (login/register don't have JWT yet)
const protectedPrefixes = ['tenants', 'iam', 'apex', 'dashboard', 'pulse', 'catalysts', 'memory', 'mind', 'erp', 'controlplane', 'audit', 'connectivity', 'notifications', 'storage', 'realtime', 'assessments', 'deployments', 'ai-costs', 'radar', 'diagnostics', 'catalyst-intelligence', 'roi', 'board-report', 'onboarding', 'freshness', 'atheon-score', 'baseline', 'targets', 'executive-summary', 'webhooks', 'system-alerts', 'support', 'inferences', 'billing', 'dsar', 'orchestration', 'insights-stats'];
for (const prefix of protectedPrefixes) {
  app.use(`/api/${prefix}/*`, tenantIsolation());
  app.use(`/api/v1/${prefix}/*`, tenantIsolation());
}
// Agent routes are mounted at /api/agent — outside tenantIsolation (they use X-Licence-Key, not JWT)

// Bug #3 fix: Server-side role enforcement for admin-only routes
// superadmin: full platform access (tenants, IAM, controlplane, etc.)
// support_admin: configure catalysts, manage users, IAM, ERP, connectivity
// admin: company admin with full tenant access
const platformAdminPrefixes = ['tenants'];
for (const prefix of platformAdminPrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin'));
}
const platformAdminRoutePrefixes = ['iam', 'controlplane', 'erp', 'audit', 'connectivity'];
for (const prefix of platformAdminRoutePrefixes) {
  app.use(`/api/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
  app.use(`/api/v1/${prefix}/*`, requireRole('superadmin', 'support_admin', 'admin'));
}

// §9.6 Permission model for V3 routes
// board-report: admin+ (executive content)
for (const p of ['/api/board-report/*', '/api/v1/board-report/*']) {
  app.use(p, requireRole('superadmin', 'support_admin', 'admin'));
}
// v45-alerts: system-alerts (admin+) — CRUD/silence/test on alert rules
for (const p of ['/api/system-alerts/*', '/api/v1/system-alerts/*']) {
  app.use(p, requireRole('superadmin', 'support_admin', 'admin'));
}
// radar, diagnostics, catalyst-intelligence, roi: all authenticated users (read via tenantIsolation)
// onboarding, freshness: all authenticated users (self-service)

// Mount route modules (both /api/ and /api/v1/ for backward compatibility)
const routeModules: [string, typeof auth][] = [
  ['auth', auth], ['tenants', tenants], ['iam', iam], ['apex', apex], ['dashboard', dashboard],
  ['pulse', pulse], ['catalysts', catalysts], ['memory', memory], ['mind', mind],
  ['erp', erp], ['controlplane', controlplane], ['audit', audit],
  ['connectivity', connectivity], ['notifications', notifications],
  ['storage', storage], ['realtime', realtime],
  ['deployments', deployments], ['assessments', assessments],
  ['ai-costs', aiCosts],
  ['radar', radar], ['diagnostics', diagnosticsRoutes],
  ['inferences/feedback', inferenceFeedbackRoutes],
  ['billing', billingRoutes],
  ['dsar', dsarRoutes],
  ['orchestration', orchestrationRoutes],
  ['insights-stats', insightsStatsRoutes],
  ['catalyst-intelligence', catalystIntelligence],
  ['roi', roi], ['board-report', boardReport],
  ['onboarding', onboarding], ['freshness', freshness],
  ['atheon-score', atheonScore], ['baseline', baselineRoutes],
  ['targets', targetRoutes], ['executive-summary', executiveSummary],
  ['webhooks', webhooksRoutes],
  ['system-alerts', systemAlerts],
  ['support', supportRoutes],
  ['confidence-thresholds', confidenceThresholds],
];
for (const [name, handler] of routeModules) {
  app.route(`/api/${name}`, handler);
  app.route(`/api/v1/${name}`, handler);
}

// OpenAPI spec + Swagger UI — PUBLIC (developer-facing, no secrets in
// schema). Mounted at /api/v1/{openapi.json,docs}. Day 8 of GO_LIVE_SPRINT.
app.route('/api/v1', openapi);
app.route('/api', openapi);

// §11.1 Trial Assessment — PUBLIC routes (no auth required)
app.route('/api/trial', trialAssessment);
app.route('/api/v1/trial', trialAssessment);

// VantaX demo seeder - restricted to VantaX tenant only (needs tenantIsolation for auth context)
app.use('/api/v1/seed-vantax/*', tenantIsolation());
app.route('/api/v1/seed-vantax', seedVantaX);

// Phase 10-26: SAP ECC end-to-end demo seed. Gated on the SETUP_SECRET
// shared secret (same gate as /admin/migrate) — deploy-time tool, not
// behind tenant auth.
app.route('/api/v1/admin', demoSeedRoutes);
app.route('/api/admin', demoSeedRoutes);

// Phase AX: SCIM 2.0 endpoints for enterprise IdP provisioning (Okta,
// Azure AD, OneLogin, Google Workspace, JumpCloud). Mounted at /scim/v2
// per RFC 7644; authenticates via Bearer token, NOT JWT. Tenant scope is
// derived from the token row inside the scimAuth() middleware.
app.route('/scim/v2', scim);

// Phase AZ: Public platform status page + admin incident management.
// /api/status* is PUBLIC (no auth) — procurement teams probe this URL
// during vendor onboarding. /api/admin/status/* is JWT-authed and
// superadmin/support_admin gated inside the handler.
app.route('/api/status', statusPublic);
app.route('/api/v1/status', statusPublic);
app.use('/api/v1/admin/status/*', tenantIsolation());
app.route('/api/v1/admin/status', statusAdmin);
app.use('/api/admin/status/*', tenantIsolation());
app.route('/api/admin/status', statusAdmin);

// Tenant admin routes need auth middleware (tenantIsolation sets c.get('auth'))
// Scoped to /tenants/* so /admin/setup and /admin/migrate (JWT-free) are not blocked
app.use('/api/v1/admin/tenants/*', tenantIsolation());
app.use('/api/v1/admin/tenants/*', requireRole('superadmin'));
// §8.3 encryption key rotation needs JWT-backed auth (superadmin role enforced inside handler)
app.use('/api/v1/admin/rotate-encryption', tenantIsolation());
// Revenue/usage aggregation — superadmin role enforced inside handler. JWT required.
app.use('/api/v1/admin/revenue-usage', tenantIsolation());
app.route('/api/v1/admin', tenantsAdmin);

// Admin Tooling routes (ADMIN-001 to ADMIN-012)
app.use('/api/v1/admin-tooling/*', tenantIsolation());
app.use('/api/admin-tooling/*', tenantIsolation());
app.route('/api/v1/admin-tooling', adminTooling);
app.route('/api/admin-tooling', adminTooling);

// Data Governance aggregation (read-only). Admin+ role enforced inside handler;
// tenantIsolation provides the JWT-backed auth context.
app.use('/api/v1/governance/*', tenantIsolation());
app.route('/api/v1/governance', governance);

// SOC 2 control evidence pack (read-only). Admin+ for own tenant; support+
// for cross-tenant. Role enforcement inside the handler.
app.use('/api/v1/compliance/*', tenantIsolation());
app.route('/api/v1/compliance', compliance);

// Audit-share magic links — PUBLIC token lookup. NOT under tenantIsolation;
// the token in the URL is the credential. Tokens expire after 7 days and can
// be revoked from /compliance. See src/routes/audit-share.ts.
app.route('/api/v1/audit-share', auditShare);
app.route('/api/audit-share', auditShare);

// Feature Flags (v47-platform) — admin CRUD gated by role inside handler, evaluate endpoint
// requires only auth. tenantIsolation runs first to populate c.get('auth').
app.use('/api/v1/admin/feature-flags', tenantIsolation());
app.use('/api/v1/admin/feature-flags/*', tenantIsolation());
app.use('/api/admin/feature-flags', tenantIsolation());
app.use('/api/admin/feature-flags/*', tenantIsolation());
app.use('/api/v1/feature-flags/*', tenantIsolation());
app.use('/api/feature-flags/*', tenantIsolation());
app.route('/api/v1', featureFlagsRoutes);
app.route('/api', featureFlagsRoutes);


// Agent routes mounted separately — no tenantIsolation middleware
app.route('/api/agent', agentRoutes);
app.route('/api/v1/agent', agentRoutes);

// ── Admin Setup Endpoint ──
// Secure one-time admin provisioning gated by SETUP_SECRET (replaces hardcoded password seeding)
// Usage: POST /api/v1/admin/setup with { "setup_secret": "...", "email": "...", "password": "..." }

/** Body shape for admin setup request */
interface AdminSetupBody extends Record<string, unknown> {
  setup_secret: string;
  email: string;
  password: string;
}

/**
 * POST /api/v1/admin/setup — Reset a superadmin account password securely.
 * Gated by the SETUP_SECRET environment variable (set via `wrangler secret put SETUP_SECRET`).
 * Returns 404 when SETUP_SECRET is not configured (endpoint disabled in production by default).
 * @param setup_secret - Must match env.SETUP_SECRET
 * @param email - Email of the superadmin account to reset
 * @param password - New password (min 8 chars)
 */
app.post('/api/v1/admin/setup', async (c) => {
  const env = c.env as Env;

  // Endpoint disabled when SETUP_SECRET is not configured
  if (!env.SETUP_SECRET) {
    return c.json({ error: 'Not found', path: c.req.path }, 404);
  }

  // Parse raw body first to get unsanitized setup_secret, then validate email/password separately
  let rawBody: AdminSetupBody;
  try {
    rawBody = await c.req.json<AdminSetupBody>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  if (!rawBody.setup_secret || typeof rawBody.setup_secret !== 'string' || rawBody.setup_secret.length < 8) {
    return c.json({ error: 'Validation failed', details: ['setup_secret must be a string with at least 8 characters'] }, 400);
  }

  // Validate email via getValidatedJsonBody (sanitization is fine for email)
  const { data, errors } = await getValidatedJsonBody<AdminSetupBody>(c, [
    { field: 'email', type: 'email', required: true },
  ]);

  if (errors.length > 0 || !data) {
    return c.json({ error: 'Validation failed', details: errors }, 400);
  }

  // Validate password from raw body (unsanitized) to avoid sanitizer stripping <>, on\w+= etc.
  const rawPassword = rawBody.password;
  if (!rawPassword || typeof rawPassword !== 'string' || rawPassword.length < 8 || rawPassword.length > 128) {
    return c.json({ error: 'Validation failed', details: ['password must be 8-128 characters'] }, 400);
  }

  // Security: enforce password strength for superadmin accounts (same rules as registration)
  const pwCheck = validatePasswordStrength(rawPassword);
  if (!pwCheck.valid) {
    return c.json({ error: 'Weak password', details: pwCheck.errors }, 400);
  }

  // Constant-time comparison to prevent timing attacks (no early return on length mismatch)
  // Use raw (unsanitized) setup_secret to avoid sanitizer stripping special chars
  // Iterate over max length so loop duration doesn't reveal secret length
  const secretBytes = new TextEncoder().encode(rawBody.setup_secret);
  const expectedBytes = new TextEncoder().encode(env.SETUP_SECRET);
  let mismatch = secretBytes.length !== expectedBytes.length ? 1 : 0;
  const len = Math.max(secretBytes.length, expectedBytes.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (secretBytes[i] ?? 0) ^ (expectedBytes[i] ?? 0);
  }
  if (mismatch !== 0) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  // Find the user — must be a superadmin
  const user = await env.DB.prepare(
    'SELECT id, role FROM users WHERE email = ?'
  ).bind(data.email).first<{ id: string; role: string }>();

  if (!user) {
    return c.json({ error: 'User not found' }, 404);
  }
  if (user.role !== 'superadmin') {
    return c.json({ error: 'Only superadmin accounts can be provisioned via this endpoint' }, 403);
  }

  // Hash and set the new password (use raw unsanitized password)
  const newHash = await hashPassword(rawPassword);
  await env.DB.prepare(
    'UPDATE users SET password_hash = ? WHERE id = ?'
  ).bind(newHash, user.id).run();

  // Audit log
  try {
    await env.DB.prepare(
      'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      crypto.randomUUID(), 'system', 'admin.setup.password_reset', 'security', 'users',
      JSON.stringify({ email: data.email, userId: user.id }),
      'success'
    ).run();
  } catch (err) {
    console.error('Admin setup audit log failed:', err);
  }

  return c.json({ success: true, message: `Password updated for ${data.email}` });
});

// Also mount at /api/admin/setup for backward compat
app.post('/api/admin/setup', async (c) => {
  // Forward to v1 handler
  const url = new URL(c.req.url);
  url.pathname = '/api/v1/admin/setup';
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

// ── Admin Migrate Endpoint ──
// Runs all database migrations on demand. Requires X-Setup-Secret header.
// CI/CD pipeline should call this after each deployment.

/**
 * POST /api/v1/admin/migrate — Apply database migrations.
 * Auth: X-Setup-Secret header (matches env.SETUP_SECRET). JWT auth is not available
 * because tenantIsolation middleware does not run on /admin/* routes.
 * Returns MigrationResult with stats on tables created, indexes, columns healed, seeds run.
 */
app.post('/api/v1/admin/migrate', async (c) => {
  const env = c.env as Env;

  // Auth: X-Setup-Secret header required (JWT auth is not available here since
  // tenantIsolation middleware does not run on /admin/* routes)
  const setupSecret = c.req.header('X-Setup-Secret');
  if (!setupSecret || !env.SETUP_SECRET) {
    return c.json({ error: 'Forbidden — X-Setup-Secret header required' }, 403);
  }

  // Iterate over max length so loop duration doesn't reveal secret length
  const a = new TextEncoder().encode(setupSecret);
  const b = new TextEncoder().encode(env.SETUP_SECRET);
  let mismatch = a.length !== b.length ? 1 : 0;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    mismatch |= (a[i] ?? 0) ^ (b[i] ?? 0);
  }
  if (mismatch !== 0) {
    return c.json({ error: 'Forbidden' }, 403);
  }

  try {
    const migrationResult = await runMigrations(env.DB);

    // Cache migration status
    const migrationKey = `db:migrated:${MIGRATION_VERSION}`;
    await env.CACHE.put(migrationKey, 'true', { expirationTtl: 86400 });

    // Structured migration summary log — support uses this to verify deploys
    const logFn = migrationResult.errors.length === 0 ? logInfo : logWarn;
    logFn('migration.completed', {
      requestId: c.get('requestId'),
      layer: 'migration',
      action: 'admin.migrate',
    }, {
      version: migrationResult.version,
      tablesCreated: migrationResult.tablesCreated,
      indexesCreated: migrationResult.indexesCreated,
      columnsHealed: migrationResult.columnsHealed,
      durationMs: migrationResult.durationMs,
      errorCount: migrationResult.errors.length,
      errors: migrationResult.errors.slice(0, 10),
    });

    // Audit log
    try {
      await env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(
        crypto.randomUUID(), 'system', 'admin.migrate', 'infrastructure', 'database',
        JSON.stringify(migrationResult),
        migrationResult.errors.length === 0 ? 'success' : 'partial'
      ).run();
    } catch (err) {
      console.error('Migration audit log failed:', err);
    }

    return c.json(migrationResult);
  } catch (err) {
    logError('migration.failed', err, {
      requestId: c.get('requestId'),
      layer: 'migration',
      action: 'admin.migrate',
    });
    return c.json({ error: 'Migration failed', message: (err as Error).message }, 500);
  }
});

// Backward compat for /api/admin/migrate
app.post('/api/admin/migrate', async (c) => {
  const url = new URL(c.req.url);
  url.pathname = '/api/v1/admin/migrate';
  const newReq = new Request(url.toString(), c.req.raw);
  return app.fetch(newReq, c.env, c.executionCtx);
});

// HTML escape helper to prevent injection in email bodies
function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// POST /api/contact - Contact form submission (sends email to atheon@vantax.co.za)
app.post('/api/contact', async (c) => {
  try {
    const body = await c.req.json<{ name: string; email: string; company?: string; message: string }>();
    if (!body.name || !body.email || !body.message) {
      return c.json({ error: 'Name, email, and message are required' }, 400);
    }

    // Sanitize all user input for HTML email body
    const safeName = escapeHtml(body.name);
    const safeEmail = escapeHtml(body.email);
    const safeCompany = escapeHtml(body.company || 'Not provided');
    const safeMessage = escapeHtml(body.message).replace(/\n/g, '<br>');

    // Try to send via Microsoft Graph API if configured
    const env = c.env as Env;
    if (env.MS_GRAPH_CLIENT_ID && env.MS_GRAPH_CLIENT_SECRET && env.MS_GRAPH_TENANT_ID) {
      try {
        const tokenRes = await fetch(`https://login.microsoftonline.com/${env.MS_GRAPH_TENANT_ID}/oauth2/v2.0/token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: env.MS_GRAPH_CLIENT_ID,
            client_secret: env.MS_GRAPH_CLIENT_SECRET,
            scope: 'https://graph.microsoft.com/.default',
            grant_type: 'client_credentials',
          }),
        });
        const tokenData = await tokenRes.json() as { access_token?: string };
        if (tokenData.access_token) {
          try {
            await fetch('https://graph.microsoft.com/v1.0/users/atheon@vantax.co.za/sendMail', {
              method: 'POST',
              headers: { Authorization: `Bearer ${tokenData.access_token}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({
                message: {
                  subject: `Atheon Contact: ${body.name} from ${body.company || 'Unknown'}`,
                  body: { contentType: 'HTML', content: `<h3>New Contact Form Submission</h3><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Company:</strong> ${safeCompany}</p><p><strong>Message:</strong></p><p>${safeMessage}</p>` },
                  toRecipients: [{ emailAddress: { address: 'atheon@vantax.co.za' } }],
                  replyTo: [{ emailAddress: { address: body.email, name: body.name } }],
                },
              }),
            });
            console.log('[Contact Form] Graph email sent successfully');
          } catch (graphErr) {
            console.error('[Contact Form] Graph email send failed, queuing for retry:', graphErr);
            // Queue email for retry as fallback
            try {
              await sendOrQueueEmail(c.env.DB, {
                to: ['atheon@vantax.co.za'],
                subject: `Atheon Contact: ${body.name} from ${body.company || 'Unknown'}`,
                htmlBody: `<h3>New Contact Form Submission</h3><p><strong>Name:</strong> ${safeName}</p><p><strong>Email:</strong> ${safeEmail}</p><p><strong>Company:</strong> ${safeCompany}</p><p><strong>Message:</strong></p><p>${safeMessage}</p>`,
                textBody: `New Contact Form Submission\nName: ${body.name}\nEmail: ${body.email}\nCompany: ${body.company || 'Unknown'}\nMessage: ${body.message}`,
                tenantId: 'system',
              }, c.env);
            } catch (queueErr) {
              console.error('[Contact Form] Fallback email queue also failed:', queueErr);
            }
          }
        }
      } catch (err) { console.error('[Contact Form] Graph token fetch failed:', err); }
    }

    // Always log to DB as a fallback for audit trail
    try {
      await c.env.DB.prepare(
        'INSERT INTO audit_log (id, tenant_id, action, layer, resource, details, outcome) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), 'system', 'contact_form.submitted', 'marketing', 'contact',
        JSON.stringify({ name: body.name, email: body.email, company: body.company, message: body.message }),
        'success'
      ).run();
    } catch (err) { console.error('[Contact Form] DB log failed:', err); }

    return c.json({ success: true, message: 'Your message has been received. We will be in touch shortly.' });
  } catch (err) {
    console.error('Contact form handler failed:', err);
    return c.json({ error: 'Failed to process contact form' }, 500);
  }
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: 'Not found', path: c.req.path }, 404);
});

// Error handler — consistent format, no stack traces in production, reports to Sentry
app.onError((err, c) => {
  const auth = c.get('auth') as { userId?: string; email?: string; tenantId?: string } | undefined;
  const requestId = c.get('requestId') as string | undefined;
  logError('unhandled-error', err, {
    requestId,
    tenantId: auth?.tenantId,
    userId: auth?.userId,
    layer: 'http',
    action: 'request.error',
  }, { url: c.req.url, method: c.req.method });

  // Report to Sentry if configured
  const sentryDsn = c.env?.SENTRY_DSN;
  if (sentryDsn) {
    captureException(err, {
      dsn: sentryDsn,
      environment: c.env?.ENVIRONMENT || 'production',
      tags: { url: c.req.url, method: c.req.method },
      extra: { userAgent: c.req.header('user-agent') || 'unknown' },
      request: { url: c.req.url, method: c.req.method },
      user: auth ? { id: auth.userId || 'unknown', email: auth.email } : undefined,
      ctx: c.executionCtx,
    });
  }

  const isDev = c.env?.ENVIRONMENT !== 'production';
  return c.json({
    error: 'Internal server error',
    message: isDev ? err.message : 'An unexpected error occurred',
    ...(isDev ? { stack: err.stack } : {}),
  }, 500);
});

// Export the app as the default fetch handler
// Also export scheduled handler (Cron Triggers) and queue consumer
export default {
  fetch: app.fetch,
  scheduled: handleScheduled,
  queue: handleQueueMessage,
} satisfies ExportedHandler<Env & { CATALYST_QUEUE?: Queue<CatalystQueueMessage> }>;
