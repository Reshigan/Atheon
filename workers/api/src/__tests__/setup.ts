/**
 * Test setup file for Vitest + Cloudflare Workers pool.
 * Runs before each test file to initialize the D1 database schema.
 */
import { env } from 'cloudflare:test';
import { runMigrations } from '../services/migrate';

let migrated = false;

/**
 * Ensure database schema is applied before tests run.
 * Only runs once per worker instance (cached via `migrated` flag).
 */
export async function ensureMigrated(): Promise<void> {
  if (migrated) return;
  await runMigrations(env.DB);
  migrated = true;
}
