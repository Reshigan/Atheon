/**
 * Roadmap C5 — APM dashboard query layer.
 *
 * Reads the `atheon_apm` Analytics Engine dataset via the Cloudflare AE SQL
 * API (https://api.cloudflare.com/client/v4/accounts/{id}/analytics_engine/sql).
 *
 * Why proxy through the Worker (rather than letting the dashboard call AE
 * directly):
 *   - The AE read token must never reach the browser. Scoping `Analytics:Read`
 *     to the dataset doesn't help — the token also has account-list scope by
 *     default and ops would have to rotate it on every layoff.
 *   - We need to enforce the same RBAC gate as the rest of admin-tooling
 *     (superadmin or support_admin), and AE has no RBAC of its own.
 *   - When AE isn't configured (CF_ACCOUNT_ID / CF_AE_READ_TOKEN unset) we
 *     fall back to the KV per-minute aggregate that `services/apm.ts` writes
 *     alongside AE — same response shape, lower fidelity (no percentiles).
 *
 * Auth: superadmin or support_admin. Falls through to the same isSupportOrAbove
 * check used by other admin-tooling routes.
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppBindings, AuthContext } from '../types';

const adminApm = new Hono<AppBindings>();

function getAuth(c: Context<AppBindings>): AuthContext | undefined {
  return c.get('auth');
}

function isSupportOrAbove(c: Context<AppBindings>): boolean {
  const auth = getAuth(c);
  return auth?.role === 'superadmin' || auth?.role === 'support_admin';
}

/**
 * Window options the dashboard exposes. Capped at 24h because AE retains
 * raw data for 90 days but quantile_cont over a wider window starts to
 * exceed the SQL API's 30-second timeout for high-traffic deployments.
 */
const ALLOWED_WINDOWS = new Set(['15m', '1h', '6h', '24h']);
function windowToInterval(win: string): string {
  switch (win) {
    case '15m': return "INTERVAL '15' MINUTE";
    case '1h':  return "INTERVAL '1' HOUR";
    case '6h':  return "INTERVAL '6' HOUR";
    default:    return "INTERVAL '24' HOUR";
  }
}
function windowToMinutes(win: string): number {
  switch (win) {
    case '15m': return 15;
    case '1h':  return 60;
    case '6h':  return 360;
    default:    return 1440;
  }
}

export interface RouteSummary {
  route: string;
  requestCount: number;
  p50Ms: number;
  p95Ms: number;
  p99Ms: number;
  errorRate: number; // 0-1 fraction of 5xx
  slowRate: number;  // 0-1 fraction ≥500ms
}

export interface ApmSummaryResponse {
  source: 'analytics-engine' | 'kv-fallback';
  window: string;
  generatedAt: string;
  routes: RouteSummary[];
}

/**
 * AE SQL response shape. The CF API wraps results in { meta, data, rows, … }
 * — we only consume `data` (object form, one row per record).
 */
interface AeSqlResponse {
  meta?: Array<{ name: string; type: string }>;
  data?: Array<Record<string, unknown>>;
  rows?: number;
}

async function queryAnalyticsEngine(
  accountId: string,
  token: string,
  win: string,
  signal?: AbortSignal,
): Promise<RouteSummary[]> {
  const interval = windowToInterval(win);
  // index1 is the `${method} ${pathBucket}` tag we wrote in services/apm.ts.
  // Use `index1` (AE exposes indexes as index1..indexN), not the field name
  // we passed in `indexes[0]`. The dataset is opaque-typed so we can't do
  // a JOIN to look it up; raw SQL is the API.
  const sql = `
    SELECT
      index1 AS route,
      SUM(_sample_interval) AS request_count,
      quantileWeighted(0.5)(double1, _sample_interval) AS p50,
      quantileWeighted(0.95)(double1, _sample_interval) AS p95,
      quantileWeighted(0.99)(double1, _sample_interval) AS p99,
      SUM(IF(blob3 = '5xx', _sample_interval, 0)) AS error_count,
      SUM(double2 * _sample_interval) AS slow_count
    FROM atheon_apm
    WHERE timestamp > NOW() - ${interval}
    GROUP BY route
    ORDER BY request_count DESC
    LIMIT 50
  `.trim();

  const res = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}/analytics_engine/sql`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'text/plain',
      },
      body: sql,
      signal,
    },
  );
  if (!res.ok) {
    throw new Error(`AE SQL ${res.status}: ${await res.text().catch(() => '<no body>')}`);
  }
  const body = (await res.json()) as AeSqlResponse;
  const rows = body.data ?? [];
  return rows.map((r) => {
    const count = Number(r.request_count ?? 0);
    return {
      route: String(r.route ?? ''),
      requestCount: count,
      p50Ms: Math.round(Number(r.p50 ?? 0)),
      p95Ms: Math.round(Number(r.p95 ?? 0)),
      p99Ms: Math.round(Number(r.p99 ?? 0)),
      errorRate: count > 0 ? Number(r.error_count ?? 0) / count : 0,
      slowRate:  count > 0 ? Number(r.slow_count  ?? 0) / count : 0,
    };
  });
}

/**
 * Fallback that scans the KV `perf:<bucket>:<minute>` rollup written by the
 * legacy response-time middleware (services/apm.ts has the AE write; this
 * KV write lives in index.ts and predates C5). Reads up to `windowToMinutes`
 * keys per route prefix — bounded by the path bucketing that limits unique
 * prefixes per minute to roughly the count of distinct top-level paths.
 */
async function queryKvFallback(
  kv: KVNamespace,
  win: string,
): Promise<RouteSummary[]> {
  const minutes = windowToMinutes(win);
  const nowMin = Math.floor(Date.now() / 60000);
  // KV doesn't expose a range query; we enumerate prefixes.
  const list = await kv.list({ prefix: 'perf:', limit: 1000 });
  type Bag = { count: number; totalMs: number; slowCount: number };
  const byRoute = new Map<string, Bag>();
  await Promise.all(list.keys.map(async (k) => {
    const m = k.name.match(/^perf:(.+):(\d+)$/);
    if (!m) return;
    const route = m[1];
    const minute = Number(m[2]);
    if (nowMin - minute > minutes) return;
    const raw = await kv.get(k.name);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Bag;
    const acc = byRoute.get(route) ?? { count: 0, totalMs: 0, slowCount: 0 };
    acc.count     += parsed.count;
    acc.totalMs   += parsed.totalMs;
    acc.slowCount += parsed.slowCount;
    byRoute.set(route, acc);
  }));
  return Array.from(byRoute.entries())
    .map(([route, b]) => {
      const avg = b.count > 0 ? Math.round(b.totalMs / b.count) : 0;
      return {
        route,
        requestCount: b.count,
        p50Ms: avg,        // no per-event detail in KV — surface avg as p50.
        p95Ms: avg,        // same — kv-fallback can't compute true percentiles.
        p99Ms: avg,
        errorRate: 0,      // not tracked in KV rollup.
        slowRate: b.count > 0 ? b.slowCount / b.count : 0,
      };
    })
    .sort((a, b) => b.requestCount - a.requestCount)
    .slice(0, 50);
}

/**
 * GET /api/admin/apm/summary?window=15m|1h|6h|24h
 *
 * Returns route-level latency + error percentiles for the requested window.
 * Falls back to KV rollup when AE credentials aren't configured — the
 * dashboard hides percentile columns when `source === 'kv-fallback'`.
 */
adminApm.get('/summary', async (c) => {
  if (!isSupportOrAbove(c)) return c.json({ error: 'Forbidden: superadmin or support_admin only' }, 403);

  const winRaw = c.req.query('window') ?? '1h';
  const win = ALLOWED_WINDOWS.has(winRaw) ? winRaw : '1h';

  const accountId = c.env.CF_ACCOUNT_ID;
  const token = c.env.CF_AE_READ_TOKEN;

  if (accountId && token) {
    try {
      const routes = await queryAnalyticsEngine(accountId, token, win);
      const body: ApmSummaryResponse = {
        source: 'analytics-engine',
        window: win,
        generatedAt: new Date().toISOString(),
        routes,
      };
      return c.json(body);
    } catch (err) {
      console.warn('[admin-apm] AE query failed, falling back to KV:', (err as Error).message);
      // fall through to KV
    }
  }

  const routes = await queryKvFallback(c.env.CACHE, win);
  const body: ApmSummaryResponse = {
    source: 'kv-fallback',
    window: win,
    generatedAt: new Date().toISOString(),
    routes,
  };
  return c.json(body);
});

export default adminApm;
