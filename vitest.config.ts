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
      // Floor only — keeps PRs from deleting coverage. Set to just under
      // the current measured baseline so any regression is caught but the
      // next ratchet isn't pre-empted. Don't lower.
      // C2 ratchet 2026-05: added lib/catalyst-recommendation + retry tests.
      thresholds: {
        lines: 1.4,
        functions: 1,
        branches: 1,
        statements: 1.4,
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
