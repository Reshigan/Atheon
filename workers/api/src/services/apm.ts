/**
 * Roadmap C5 — APM telemetry via Cloudflare Analytics Engine.
 *
 * Why Analytics Engine and not (Sentry / external APM):
 *   - 25M write/day free in Workers tier — well above our SLA at current scale.
 *   - SQL API supports p50/p95/p99 directly (quantile_cont) so the dashboard
 *     reads a single GROUP BY query instead of marshalling raw events.
 *   - Lives in the same Cloudflare account as the Worker, so no PII leaves
 *     the boundary that already holds the customer data.
 *
 * Data point shape (must stay in lock-step with the SQL queries in
 * routes/admin-apm.ts):
 *
 *   indexes [0]          — `${method} ${pathBucket}` (cardinality key —
 *                          AE limits each index to ≤96 bytes & high
 *                          cardinality hurts query speed, so we
 *                          aggressively bucket the path).
 *   blobs   [0]          — request_id   (correlation; nullable)
 *   blobs   [1]          — tenant_id    (multi-tenant slicing; nullable)
 *   blobs   [2]          — status_class ('2xx' | '3xx' | '4xx' | '5xx')
 *   doubles [0]          — duration_ms
 *   doubles [1]          — 1 if slow (≥500ms) else 0 — pre-aggregated so the
 *                          dashboard can `SUM(_sample_interval * double1)`
 *                          without re-classifying every event in SQL.
 *
 * No-op behaviour: when `env.APM` is undefined (local dev, test, on-premise
 * without AE provisioned), `recordRequest()` returns silently. This is
 * intentional — the middleware that calls it runs on every request and must
 * not throw or block.
 */

import type { Env } from '../types';

/** Buckets a request path down to ≤4 path segments so AE indexes stay bounded. */
export function bucketPath(path: string): string {
  const segs = path.split('?')[0].split('/').filter(Boolean);
  // Replace UUIDs and long numeric IDs with `:id` so /api/tenants/abc-123/users
  // collapses into /api/tenants/:id/users. AE indexes are 96 bytes max; we
  // also chop to the first 4 segments to keep cardinality sane.
  const normalised = segs.slice(0, 4).map((s) => {
    if (/^[0-9a-f]{8}-[0-9a-f]{4}/i.test(s)) return ':id';
    if (/^\d{4,}$/.test(s)) return ':id';
    return s;
  });
  return '/' + normalised.join('/');
}

/** Maps an HTTP status code to a coarse class ('2xx' … '5xx'). */
export function statusClass(status: number): '2xx' | '3xx' | '4xx' | '5xx' | 'other' {
  if (status >= 200 && status < 300) return '2xx';
  if (status >= 300 && status < 400) return '3xx';
  if (status >= 400 && status < 500) return '4xx';
  if (status >= 500 && status < 600) return '5xx';
  return 'other';
}

export interface RecordRequestArgs {
  method: string;
  path: string;
  status: number;
  durationMs: number;
  requestId?: string;
  tenantId?: string;
}

/**
 * Best-effort write of a single APM data point. Never throws — AE failures
 * (rate-limit, transient network) must not surface to the request path.
 *
 * `env.APM` is typed optional so this is a one-line guard at the top.
 */
export function recordRequest(env: Pick<Env, 'APM'>, args: RecordRequestArgs): void {
  if (!env.APM) return;
  try {
    const bucket = bucketPath(args.path);
    const cls = statusClass(args.status);
    const slow = args.durationMs >= 500 ? 1 : 0;
    env.APM.writeDataPoint({
      indexes: [`${args.method} ${bucket}`],
      blobs: [args.requestId ?? '', args.tenantId ?? '', cls],
      doubles: [args.durationMs, slow],
    });
  } catch { /* never propagate APM failures */ }
}
