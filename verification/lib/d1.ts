import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';

const execFileAsync = promisify(execFile);

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Execute a SQL statement against the REMOTE D1 via wrangler and return the
 * result rows. Reads dominate, but this also drives the negative-control test's
 * deliberate DELETE — it does NOT enforce read-only, so callers that mutate must
 * interpolate only validated values (see negative-control's identifier guard) and
 * must restore clean state afterwards. Invoked from workers/api (wrangler.toml binds atheon-db).
 *
 * Auth is resolved by wrangler itself: a CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID)
 * in env is used when present (CI), otherwise wrangler falls back to its stored OAuth
 * login (local dev). We pass process.env through and let wrangler surface its own
 * auth error rather than pre-guarding on a specific credential mechanism.
 *
 * D1's HTTP API intermittently returns transient errors (e.g. code 10000 /
 * "Command failed") under load; a single flake must not fail the go-live gate, so
 * we retry up to MAX_ATTEMPTS with linear backoff. Every current caller is safe to
 * retry: reads are idempotent, and the negative-control DELETE only orphans one
 * more inventory row on a re-run (the test asserts divergence and reseeds after).
 */
export async function queryD1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const { stdout } = await execFileAsync(
        'npx',
        ['wrangler', 'd1', 'execute', CONFIG.d1DatabaseName, '--remote', '--json', '--command', sql],
        { cwd: 'workers/api', maxBuffer: 64 * 1024 * 1024, env: process.env },
      );
      // wrangler --json prints `[{ results: [...], success: true, meta: {...} }]`.
      const parsed = JSON.parse(stdout) as Array<{ results?: T[] }>;
      return parsed[0]?.results ?? [];
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(attempt * 1000);
    }
  }
  throw lastErr;
}
