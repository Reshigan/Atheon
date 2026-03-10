/**
 * Atheon Load Test Script
 * Simulates concurrent API requests to validate performance under load.
 * Run with: npx tsx e2e/load-test.ts [baseUrl] [concurrency] [duration_seconds]
 *
 * Default: 10 concurrent users, 30 seconds, against localhost:8787
 */

const BASE_URL = process.argv[2] || 'https://atheon-api.vantax.co.za';
const CONCURRENCY = parseInt(process.argv[3] || '10', 10);
const DURATION_SECONDS = parseInt(process.argv[4] || '30', 10);

interface LoadTestResult {
  endpoint: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  minLatencyMs: number;
  maxLatencyMs: number;
  requestsPerSecond: number;
}

/** Endpoints to test (public + authenticated) */
const ENDPOINTS = [
  { method: 'GET', path: '/healthz', auth: false },
  { method: 'GET', path: '/', auth: false },
  { method: 'POST', path: '/api/v1/auth/login', auth: false, body: { email: 'admin@vantax.co.za', password: 'Admin123' } },
  { method: 'GET', path: '/api/v1/apex/health', auth: true },
  { method: 'GET', path: '/api/v1/pulse/metrics', auth: true },
  { method: 'GET', path: '/api/v1/catalysts', auth: true },
  { method: 'GET', path: '/api/v1/erp/adapters', auth: true },
  { method: 'GET', path: '/api/v1/notifications', auth: true },
];

/**
 * Perform a single HTTP request and measure latency.
 * @param endpoint - Endpoint configuration
 * @param token - JWT token for authenticated requests
 * @returns Latency in milliseconds, or -1 on error
 */
async function makeRequest(
  endpoint: { method: string; path: string; auth: boolean; body?: Record<string, string> },
  token: string | null,
): Promise<{ latencyMs: number; success: boolean; status: number }> {
  const url = `${BASE_URL}${endpoint.path}`;
  const headers: Record<string, string> = {};
  if (endpoint.auth && token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (endpoint.body) {
    headers['Content-Type'] = 'application/json';
  }

  const start = performance.now();
  try {
    const resp = await fetch(url, {
      method: endpoint.method,
      headers,
      body: endpoint.body ? JSON.stringify(endpoint.body) : undefined,
    });
    const latencyMs = performance.now() - start;
    return { latencyMs, success: resp.ok, status: resp.status };
  } catch {
    const latencyMs = performance.now() - start;
    return { latencyMs, success: false, status: 0 };
  }
}

/**
 * Calculate percentile from a sorted array of numbers.
 * @param sorted - Sorted array of latency values
 * @param percentile - Target percentile (0-100)
 * @returns Value at the given percentile
 */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

/**
 * Run the load test.
 */
async function runLoadTest(): Promise<void> {
  console.log(`\n🔄 Atheon Load Test`);
  console.log(`   Base URL:    ${BASE_URL}`);
  console.log(`   Concurrency: ${CONCURRENCY}`);
  console.log(`   Duration:    ${DURATION_SECONDS}s`);
  console.log(`   Endpoints:   ${ENDPOINTS.length}\n`);

  // Step 1: Get auth token
  let token: string | null = null;
  try {
    const loginResp = await fetch(`${BASE_URL}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vantax.co.za', password: 'Admin123' }),
    });
    if (loginResp.ok) {
      const loginData = await loginResp.json() as { token?: string };
      token = loginData.token || null;
      console.log(`   Auth: ${token ? 'Token acquired' : 'No token (auth endpoints will fail)'}\n`);
    }
  } catch {
    console.log('   Auth: Login failed (proceeding with public endpoints only)\n');
  }

  const results: Map<string, number[]> = new Map();
  const errors: Map<string, number> = new Map();
  const successes: Map<string, number> = new Map();

  for (const ep of ENDPOINTS) {
    results.set(ep.path, []);
    errors.set(ep.path, 0);
    successes.set(ep.path, 0);
  }

  const endTime = Date.now() + DURATION_SECONDS * 1000;

  // Step 2: Run concurrent workers
  const workers = Array.from({ length: CONCURRENCY }, async (_, workerId) => {
    while (Date.now() < endTime) {
      const ep = ENDPOINTS[Math.floor(Math.random() * ENDPOINTS.length)];
      const result = await makeRequest(ep, token);
      results.get(ep.path)?.push(result.latencyMs);
      if (result.success) {
        successes.set(ep.path, (successes.get(ep.path) || 0) + 1);
      } else {
        errors.set(ep.path, (errors.get(ep.path) || 0) + 1);
      }
    }
  });

  await Promise.all(workers);

  // Step 3: Calculate and print results
  console.log('─'.repeat(100));
  console.log(
    'Endpoint'.padEnd(35),
    'Reqs'.padStart(6),
    'OK'.padStart(6),
    'Err'.padStart(5),
    'Avg(ms)'.padStart(9),
    'P95(ms)'.padStart(9),
    'P99(ms)'.padStart(9),
    'Min(ms)'.padStart(9),
    'Max(ms)'.padStart(9),
    'RPS'.padStart(7),
  );
  console.log('─'.repeat(100));

  const summaryResults: LoadTestResult[] = [];

  for (const ep of ENDPOINTS) {
    const latencies = results.get(ep.path) || [];
    const sorted = [...latencies].sort((a, b) => a - b);
    const total = latencies.length;
    const ok = successes.get(ep.path) || 0;
    const err = errors.get(ep.path) || 0;
    const avg = total > 0 ? latencies.reduce((a, b) => a + b, 0) / total : 0;
    const rps = total / DURATION_SECONDS;

    const result: LoadTestResult = {
      endpoint: `${ep.method} ${ep.path}`,
      totalRequests: total,
      successCount: ok,
      errorCount: err,
      avgLatencyMs: Math.round(avg),
      p95LatencyMs: Math.round(percentile(sorted, 95)),
      p99LatencyMs: Math.round(percentile(sorted, 99)),
      minLatencyMs: Math.round(sorted[0] || 0),
      maxLatencyMs: Math.round(sorted[sorted.length - 1] || 0),
      requestsPerSecond: Math.round(rps * 10) / 10,
    };
    summaryResults.push(result);

    console.log(
      result.endpoint.padEnd(35),
      String(result.totalRequests).padStart(6),
      String(result.successCount).padStart(6),
      String(result.errorCount).padStart(5),
      String(result.avgLatencyMs).padStart(9),
      String(result.p95LatencyMs).padStart(9),
      String(result.p99LatencyMs).padStart(9),
      String(result.minLatencyMs).padStart(9),
      String(result.maxLatencyMs).padStart(9),
      String(result.requestsPerSecond).padStart(7),
    );
  }

  console.log('─'.repeat(100));

  // Summary
  const totalReqs = summaryResults.reduce((a, r) => a + r.totalRequests, 0);
  const totalErrors = summaryResults.reduce((a, r) => a + r.errorCount, 0);
  const avgRps = totalReqs / DURATION_SECONDS;
  const errorRate = totalReqs > 0 ? (totalErrors / totalReqs * 100).toFixed(2) : '0';

  console.log(`\n   Total Requests: ${totalReqs}`);
  console.log(`   Total Errors:   ${totalErrors} (${errorRate}%)`);
  console.log(`   Avg RPS:        ${Math.round(avgRps * 10) / 10}`);
  console.log(`   Duration:       ${DURATION_SECONDS}s\n`);

  // Pass/Fail criteria
  const errorThreshold = 5; // 5% error rate max
  const latencyThreshold = 5000; // 5s p99 max
  const p99Max = Math.max(...summaryResults.map(r => r.p99LatencyMs));

  if (parseFloat(errorRate) > errorThreshold) {
    console.log(`   FAIL: Error rate ${errorRate}% exceeds threshold ${errorThreshold}%`);
    process.exit(1);
  }
  if (p99Max > latencyThreshold) {
    console.log(`   FAIL: P99 latency ${p99Max}ms exceeds threshold ${latencyThreshold}ms`);
    process.exit(1);
  }

  console.log(`   PASS: Error rate ${errorRate}% and P99 ${p99Max}ms within thresholds`);
}

runLoadTest().catch((err) => {
  console.error('Load test failed:', err);
  process.exit(1);
});
