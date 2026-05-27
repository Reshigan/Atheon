import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Worker-side tests live in `workers/api/` and depend on `cloudflare:test`
    // (plus other `cloudflare:*` virtual modules) which only resolve inside the
    // dedicated `@cloudflare/vitest-pool-workers` runner — invoked by the
    // "Backend Tests" CI job via `cd workers/api && vitest run`. Including them
    // in the root runner made every PR fail CI with "cannot resolve
    // cloudflare:test".
    include: ['src/**/*.test.{ts,tsx}'],
    exclude: ['workers/**', 'node_modules/**'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.*', '**/*.d.ts', '**/index.ts'],
      // Floor only — keeps PRs from deleting coverage. Set to roughly
      // the current measured baseline so the gate is real today; ratchet
      // up as we ship more unit tests (see roadmap C2). Don't lower.
      thresholds: {
        lines: 1,
        functions: 0.5,
        branches: 0.5,
        statements: 1,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
