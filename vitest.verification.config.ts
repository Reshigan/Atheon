import { defineConfig } from 'vitest/config';

// Integration suites that hit the DEPLOYED API + remote D1. Node environment
// (real fetch, child_process), serial, generous timeouts because reseed is slow.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['verification/**/*.test.ts'],
    // Reseed is destructive against the shared vantax tenant — never parallelise
    // files that reseed. One worker, serial files.
    // fileParallelism: false forces maxWorkers=1 in Vitest 4 (singleFork was
    // removed; the guarantee is now owned entirely by fileParallelism: false).
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 0,
  },
});
