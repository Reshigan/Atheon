import { defineConfig } from 'vitest/config';

// Integration suites that hit the DEPLOYED API + remote D1. Node environment
// (real fetch, child_process), serial, generous timeouts because reseed is slow.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['verification/**/*.test.ts'],
    // Reseed is destructive against the shared vantax tenant — never parallelise
    // files that reseed. One worker, serial files.
    fileParallelism: false,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 120_000,
    hookTimeout: 120_000,
    retry: 0,
  },
});
