import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { CONFIG } from '../config';

/**
 * Go-live load gate. Thin wrapper that drives the existing e2e/load-test.ts with
 * real seeded creds and a gentle default profile, then propagates its pass/fail
 * exit code. Keeping the measurement in one place (load-test.ts) avoids drift;
 * this file only supplies credentials, a profile, and the gate semantics.
 *
 * Profile and thresholds are env-overridable:
 *   LOAD_CONCURRENCY (default 5), LOAD_DURATION seconds (default 20),
 *   LOAD_ERROR_THRESHOLD_PCT, LOAD_P99_THRESHOLD_MS  (defaults live in load-test.ts)
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const TSX = join(REPO_ROOT, 'node_modules', '.bin', 'tsx');
const LOAD_TEST = join(REPO_ROOT, 'e2e', 'load-test.ts');

const concurrency = process.env.LOAD_CONCURRENCY || '5';
const duration = process.env.LOAD_DURATION || '20';

const child = spawn(TSX, [LOAD_TEST, CONFIG.apiUrl, concurrency, duration], {
  stdio: 'inherit',
  env: {
    ...process.env,
    LOAD_EMAIL: CONFIG.adminEmail,
    LOAD_PASSWORD: CONFIG.adminPassword,
    LOAD_TENANT: CONFIG.tenantSlug,
  },
});

child.on('exit', (code) => process.exit(code ?? 1));
child.on('error', (err) => {
  console.error('load-gate: failed to spawn load test:', err);
  process.exit(1);
});
