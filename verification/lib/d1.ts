import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CONFIG } from '../config';

const execFileAsync = promisify(execFile);

/**
 * Execute a SQL statement against the REMOTE D1 via wrangler and return the
 * result rows. Reads dominate, but this also drives the negative-control test's
 * deliberate DELETE — it does NOT enforce read-only, so callers that mutate must
 * interpolate only validated values (see negative-control's UUID guard) and must
 * restore clean state afterwards. Invoked from workers/api (wrangler.toml binds atheon-db).
 *
 * Auth is resolved by wrangler itself: a CLOUDFLARE_API_TOKEN (+ CLOUDFLARE_ACCOUNT_ID)
 * in env is used when present (CI), otherwise wrangler falls back to its stored OAuth
 * login (local dev). We pass process.env through and let wrangler surface its own
 * auth error rather than pre-guarding on a specific credential mechanism.
 */
export async function queryD1<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { stdout } = await execFileAsync(
    'npx',
    ['wrangler', 'd1', 'execute', CONFIG.d1DatabaseName, '--remote', '--json', '--command', sql],
    { cwd: 'workers/api', maxBuffer: 64 * 1024 * 1024, env: process.env },
  );
  // wrangler --json prints `[{ results: [...], success: true, meta: {...} }]`.
  const parsed = JSON.parse(stdout) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}
