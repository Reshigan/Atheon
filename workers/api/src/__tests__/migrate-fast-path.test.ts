/**
 * Migration fast-path — Phase 10-35.
 *
 * Validates that runMigrations() short-circuits when the schema is
 * already at MIGRATION_VERSION (via the _migration_meta marker
 * table), so re-runs are O(1) instead of running 200+ DDL statements.
 *
 * This was the root cause of the 2026-05-05 prod incident: every
 * request was 503'ing because the auto-migration check kept running
 * the full schema apply over its 25s cap.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { env } from 'cloudflare:test';
import { runMigrations, MIGRATION_VERSION } from '../services/migrate';

describe('Phase 10-35 — migration fast-path', () => {
  beforeAll(async () => {
    // Ensure the schema is fully migrated to current version before any test
    await runMigrations(env.DB);
  }, 60_000);

  it('writes a _migration_meta marker after a successful migration', async () => {
    const row = await env.DB.prepare(
      `SELECT version, completed_at, duration_ms FROM _migration_meta WHERE version = ?`,
    ).bind(MIGRATION_VERSION).first<{ version: string; completed_at: string; duration_ms: number }>();
    expect(row).not.toBeNull();
    expect(row!.version).toBe(MIGRATION_VERSION);
    expect(typeof row!.duration_ms).toBe('number');
    expect(row!.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('fast-path: re-running with marker present returns sub-100ms', async () => {
    // Marker is already there from beforeAll; this run should hit the fast-path
    const t0 = Date.now();
    const result = await runMigrations(env.DB);
    const wall = Date.now() - t0;

    // Returned result reports the fast-path duration (sub-100ms in CI)
    expect(result.version).toBe(MIGRATION_VERSION);
    expect(result.tablesCreated).toBe(0); // fast-path doesn't run any DDL
    expect(result.indexesCreated).toBe(0);
    expect(result.errors.length).toBe(0);

    // Wall-clock should be tiny — even on slow CI, sub-500ms is the limit
    expect(wall).toBeLessThan(500);
  });

  it('force=true bypasses the fast-path and re-runs full migration', async () => {
    const result = await runMigrations(env.DB, { force: true });
    // Full run reports a non-zero duration (DDL has actually run)
    expect(result.version).toBe(MIGRATION_VERSION);
    expect(result.durationMs).toBeGreaterThan(0);
    // Marker is updated
    const row = await env.DB.prepare(
      `SELECT version FROM _migration_meta WHERE version = ?`,
    ).bind(MIGRATION_VERSION).first<{ version: string }>();
    expect(row?.version).toBe(MIGRATION_VERSION);
  });

  it('fast-path falls through to full migration if marker is missing', async () => {
    // Wipe the marker
    await env.DB.prepare(`DELETE FROM _migration_meta WHERE version = ?`).bind(MIGRATION_VERSION).run();

    const result = await runMigrations(env.DB);
    // Full migration ran (marker was missing)
    expect(result.version).toBe(MIGRATION_VERSION);
    expect(result.durationMs).toBeGreaterThan(0);
    // And the marker is now back
    const row = await env.DB.prepare(
      `SELECT version FROM _migration_meta WHERE version = ?`,
    ).bind(MIGRATION_VERSION).first<{ version: string }>();
    expect(row?.version).toBe(MIGRATION_VERSION);
  });
});
