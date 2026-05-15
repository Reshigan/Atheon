#!/usr/bin/env node
/**
 * Conservative load tester for the Atheon API.
 *
 * Designed for routine performance verification, not stress testing. Runs N
 * "virtual users" in parallel; each VU runs a tight request loop for T
 * seconds against a single URL. Captures latency per request, computes
 * p50/p95/p99 + throughput + error rate, prints a JSON summary suitable
 * for the /legal/performance datasheet.
 *
 * Usage:
 *   node scripts/load-test.mjs --url https://atheon-api.vantax.co.za/healthz --vus 10 --duration 30
 *
 * Why Node + no deps: the load test must run anywhere the repo runs (CI,
 * a laptop, a Cloudflare schedule). External tools like k6 add a binary
 * dependency that fights `npm i` ergonomics.
 *
 * Safety:
 *   - Default --vus is 10 (low — won't tip our own infra into rate-limiting)
 *   - Default --duration is 30s (short — bounded total cost)
 *   - Honours --max-requests so the run can't blow past a fixed budget
 *   - Hard timeout per request (5s) so a stuck connection doesn't drag the
 *     whole run
 */
import { performance } from 'node:perf_hooks';

const args = parseArgs(process.argv.slice(2));
const url = args.url;
const vus = Math.max(1, parseInt(args.vus ?? '10', 10));
const durationSec = Math.max(1, parseInt(args.duration ?? '30', 10));
const maxRequests = parseInt(args['max-requests'] ?? '5000', 10);
const method = (args.method ?? 'GET').toUpperCase();
const requestTimeoutMs = parseInt(args['timeout'] ?? '5000', 10);
const label = args.label ?? new URL(url).pathname;

if (!url) {
  console.error('Usage: node scripts/load-test.mjs --url <URL> [--vus 10] [--duration 30] [--max-requests 5000]');
  process.exit(1);
}

const latencies = [];           // ms per successful request
const statusCounts = new Map(); // status code -> count
const errors = [];              // string error messages, capped
let requestsStarted = 0;
let requestsFinished = 0;
let totalBytes = 0;
const startWall = performance.now();
const deadlineWall = startWall + durationSec * 1000;

async function runVU() {
  while (performance.now() < deadlineWall && requestsStarted < maxRequests) {
    requestsStarted++;
    const reqStart = performance.now();
    let status = 0;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
      const res = await fetch(url, { method, signal: controller.signal });
      clearTimeout(timer);
      status = res.status;
      // Consume the body so connection cleanup is bounded — but cap so we
      // don't OOM on a huge accidental response.
      const text = await res.text();
      totalBytes += text.length;
    } catch (err) {
      if (errors.length < 20) errors.push(err.message || String(err));
      status = -1;
    }
    const dur = performance.now() - reqStart;
    if (status >= 200 && status < 400) latencies.push(dur);
    statusCounts.set(status, (statusCounts.get(status) ?? 0) + 1);
    requestsFinished++;
  }
}

function quantile(sorted, q) {
  if (sorted.length === 0) return null;
  const idx = Math.min(sorted.length - 1, Math.floor(q * sorted.length));
  return sorted[idx];
}

const workers = Array.from({ length: vus }, () => runVU());
await Promise.all(workers);
const endWall = performance.now();
const actualDurationSec = (endWall - startWall) / 1000;

latencies.sort((a, b) => a - b);
const ok = latencies.length;
const total = requestsFinished;
const failed = total - ok;
const okStatusCounts = Object.fromEntries(
  [...statusCounts.entries()].sort(([a], [b]) => a - b).map(([k, v]) => [String(k), v]),
);

const summary = {
  label,
  url,
  method,
  vus,
  durationSec: Math.round(actualDurationSec * 10) / 10,
  requestsTotal: total,
  requestsOk: ok,
  requestsFailed: failed,
  errorRatePct: total === 0 ? 0 : Math.round((failed / total) * 10000) / 100,
  throughputRps: total === 0 ? 0 : Math.round((total / actualDurationSec) * 10) / 10,
  latencyMs: {
    min: ok ? Math.round(latencies[0] * 10) / 10 : null,
    p50: ok ? Math.round(quantile(latencies, 0.50) * 10) / 10 : null,
    p95: ok ? Math.round(quantile(latencies, 0.95) * 10) / 10 : null,
    p99: ok ? Math.round(quantile(latencies, 0.99) * 10) / 10 : null,
    max: ok ? Math.round(latencies[ok - 1] * 10) / 10 : null,
    avg: ok ? Math.round((latencies.reduce((s, v) => s + v, 0) / ok) * 10) / 10 : null,
  },
  statusCounts: okStatusCounts,
  bytesReceived: totalBytes,
  errorsSample: errors.slice(0, 5),
  ranAt: new Date().toISOString(),
};

console.log(JSON.stringify(summary, null, 2));

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) { out[key] = 'true'; }
      else { out[key] = next; i++; }
    }
  }
  return out;
}
