/**
 * Local vitest config for the SDK package.
 *
 * Overrides the monorepo-root config (which sets a JSDOM environment +
 * frontend test-setup.ts) — the SDK is a pure-TS library that runs under
 * Node 20+ with no DOM dependency.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    setupFiles: [],
  },
});
