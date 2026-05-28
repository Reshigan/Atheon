import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { RunItemTotals } from './client';

const HERE = dirname(fileURLToPath(import.meta.url));
/** Gitignored. Written by global-setup, consumed by the accuracy test files. */
export const MANIFEST_PATH = join(HERE, '..', '.run-manifest.json');

export interface RunRecord {
  subName: string;
  runId: string;
  status: string;
  totals: RunItemTotals;
  /** item_status -> count (e.g. matched / unmatched_source / unmatched_target / discrepancy). */
  statusCounts: Record<string, number>;
}

export interface RunManifest {
  seededAt: string;
  tenantId: string;
  /** Keyed by RECON_SUBCATALYSTS key: grir | bank | inventory | salesOrder. */
  runs: Record<string, RunRecord>;
}

export function writeManifest(m: RunManifest): void {
  writeFileSync(MANIFEST_PATH, JSON.stringify(m, null, 2));
}

export function manifestExists(): boolean {
  return existsSync(MANIFEST_PATH);
}

export function readManifest(): RunManifest {
  if (!existsSync(MANIFEST_PATH)) {
    throw new Error(
      `Run manifest not found at ${MANIFEST_PATH}. The verification globalSetup ` +
      `seeds the tenant and records run results here — run the suite via ` +
      `\`npm run verify:accuracy\` (not a bare vitest invocation that skips globalSetup).`,
    );
  }
  return JSON.parse(readFileSync(MANIFEST_PATH, 'utf8')) as RunManifest;
}
