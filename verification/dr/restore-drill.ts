import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CONFIG } from '../config';

/**
 * Disaster-recovery restore drill. Proves the backup→restore path actually
 * round-trips data, not just that a backup file is produced:
 *
 *   1. `wrangler d1 export --remote` the database to a SQL dump (the "backup");
 *   2. wipe the LOCAL D1 state and import the dump into a clean local DB;
 *   3. assert every remote table was restored and the restore is non-empty;
 *   4. reconcile exact row counts for the business-critical tables.
 *
 * Why critical tables only for the count reconciliation: remote `COUNT(*)` over
 * the large append-only ERP/chat tables exceeds D1's per-query CPU limit (7429).
 * The restored LOCAL copy is a plain SQLite file, so its full row counts are
 * free — total-rows integrity comes from local, and remote↔restored fidelity is
 * proven precisely where it pays the bills (tenants, assessments, billing).
 *
 * SAFETY: only LOCAL D1 state (ephemeral, gitignored .wrangler/) is destroyed.
 * The remote export is strictly read-only — the drill never mutates production.
 *
 * Auth: resolved by wrangler (CLOUDFLARE_API_TOKEN+ACCOUNT_ID in CI, stored
 * OAuth login locally), the same path the accuracy suite already relies on.
 */

const execFileAsync = promisify(execFile);
const WORKERS_DIR = 'workers/api';
/** Wrangler v3/v4 default local persistence path for D1 (relative to WORKERS_DIR). */
const LOCAL_D1_STATE = join(WORKERS_DIR, '.wrangler', 'state', 'v3', 'd1');

/** Small, business-critical tables — reconciled remote↔restored exactly. */
const CRITICAL_TABLES = [
  'tenants',
  'users',
  'assessments',
  'billable_periods',
  'billable_line_items',
  'root_cause_analyses',
];

type Scope = '--remote' | '--local';

async function wrangler(args: string[]): Promise<string> {
  // Pin the config explicitly: a stray wrangler.jsonc higher in the tree (e.g.
  // the SPA's) otherwise shadows workers/api/wrangler.toml and hides the D1
  // binding, which breaks --local resolution.
  const { stdout } = await execFileAsync('npx', ['wrangler', ...args, '--config', 'wrangler.toml'], {
    cwd: WORKERS_DIR,
    maxBuffer: 256 * 1024 * 1024,
    env: process.env,
  });
  return stdout;
}

async function d1Query<T = Record<string, unknown>>(scope: Scope, sql: string): Promise<T[]> {
  const out = await wrangler(['d1', 'execute', CONFIG.d1DatabaseName, scope, '--json', '--command', sql]);
  const parsed = JSON.parse(out) as Array<{ results?: T[] }>;
  return parsed[0]?.results ?? [];
}

/** Remote D1 occasionally resets a query with CPU-limit 7429; retry briefly. */
async function remoteCount(table: string, attempts = 3): Promise<number> {
  for (let i = 1; ; i++) {
    try {
      const rows = await d1Query<{ n: number }>('--remote', `SELECT COUNT(*) AS n FROM "${table}"`);
      return Number(rows[0]?.n ?? 0);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (i >= attempts || !/7429|CPU time limit/.test(msg)) throw err;
      await new Promise(r => setTimeout(r, 1500 * i));
    }
  }
}

async function localCount(table: string): Promise<number> {
  const rows = await d1Query<{ n: number }>('--local', `SELECT COUNT(*) AS n FROM "${table}"`);
  return Number(rows[0]?.n ?? 0);
}

async function listTables(scope: Scope): Promise<string[]> {
  const rows = await d1Query<{ name: string }>(
    scope,
    "SELECT name FROM sqlite_master WHERE type='table' " +
      "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name",
  );
  return rows.map(r => r.name);
}

async function main(): Promise<void> {
  console.log(`[dr] restore drill against D1 "${CONFIG.d1DatabaseName}"`);

  // 1. Enumerate remote tables (cheap schema scan) and export the backup.
  const remoteTables = await listTables('--remote');
  if (remoteTables.length === 0) throw new Error('remote D1 reported no user tables — aborting');
  console.log(`[dr] remote schema: ${remoteTables.length} tables`);

  const dump = join(tmpdir(), `atheon-dr-${Date.now()}.sql`);
  await wrangler(['d1', 'export', CONFIG.d1DatabaseName, '--remote', '--output', dump]);
  console.log(`[dr] backup exported -> ${dump}`);

  // 2. Wipe LOCAL state (ephemeral) and restore the dump into a clean local DB.
  await rm(LOCAL_D1_STATE, { recursive: true, force: true });
  await wrangler(['d1', 'execute', CONFIG.d1DatabaseName, '--local', '--file', dump]);
  console.log('[dr] backup restored into a clean local D1');

  // 3. Full-restore integrity from the local copy (free, no CPU limit).
  const localTables = new Set(await listTables('--local'));
  const missing = remoteTables.filter(t => !localTables.has(t));
  if (missing.length > 0) {
    console.error(`[dr] FAIL: ${missing.length} tables not restored: ${missing.join(', ')}`);
    process.exit(1);
  }
  let localTotal = 0;
  for (const t of remoteTables) localTotal += await localCount(t);
  if (localTotal === 0) {
    console.error('[dr] FAIL: restored database is empty (0 rows across all tables)');
    process.exit(1);
  }
  console.log(`[dr] restored ${remoteTables.length} tables, ${localTotal} rows total`);

  // 4. Exact remote↔restored reconciliation for the business-critical tables.
  const critical = CRITICAL_TABLES.filter(t => localTables.has(t));
  if (critical.length === 0) {
    console.error(`[dr] FAIL: none of the critical tables exist: ${CRITICAL_TABLES.join(', ')}`);
    process.exit(1);
  }
  const mismatches: string[] = [];
  for (const t of critical) {
    const expected = await remoteCount(t);
    const restored = await localCount(t);
    if (restored !== expected) mismatches.push(`${t}: remote=${expected} restored=${restored}`);
    else if (expected === 0) mismatches.push(`${t}: empty on both sides (expected seeded data)`);
  }
  if (mismatches.length > 0) {
    console.error('[dr] FAIL: critical-table reconciliation:\n  ' + mismatches.join('\n  '));
    process.exit(1);
  }

  console.log(`[dr] PASS: ${critical.length} critical tables reconciled exactly; full backup restored intact`);
}

main().catch((err) => {
  console.error('[dr] drill failed:', err);
  process.exit(1);
});
