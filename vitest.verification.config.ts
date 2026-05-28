import { defineConfig } from 'vitest/config';

// Integration suites that hit the DEPLOYED API + remote D1. Node environment
// (real fetch, child_process), serial, generous timeouts because reseed is slow.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['verification/**/*.test.ts'],
    // globalSetup reseeds the tenant + executes every sub-catalyst ONCE and
    // records the results to a manifest; test files assert against that shared
    // state instead of each paying the ~220s reseed. (Set VERIFY_REUSE_RUNS=1
    // to reuse an existing manifest for fast local iteration.)
    globalSetup: ['verification/global-setup.ts'],
    // Reseed is destructive against the shared vantax tenant — never parallelise
    // files that reseed. One worker, serial files.
    // fileParallelism: false forces maxWorkers=1 in Vitest 4 (singleFork was
    // removed; the guarantee is now owned entirely by fileParallelism: false).
    fileParallelism: false,
    pool: 'forks',
    testTimeout: 120_000,
    // negative-control reseeds (~220s) in its own hooks to perturb + restore.
    hookTimeout: 360_000,
    retry: 0,
  },
});
