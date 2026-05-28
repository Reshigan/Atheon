import { ApiClient, RECON_SUBCATALYSTS, type RunItem } from './lib/client';
import { writeManifest, manifestExists, type RunManifest, type RunRecord } from './lib/manifest';

/**
 * One-time setup for the whole verification suite. Reseeding the vantax tenant
 * costs ~220s and each sub-catalyst execution ~40-70s, so paying that per-file
 * (the naive design) makes the suite a 30+ minute gate. Instead we reseed ONCE,
 * execute every reconciliation sub-catalyst ONCE, capture the run results into a
 * manifest, and let every accuracy test file assert against that shared state.
 *
 * Dev ergonomics: set VERIFY_REUSE_RUNS=1 to reuse an existing manifest and skip
 * the reseed+execute cycle entirely (fast local iteration). CI leaves it unset,
 * so every gate run starts from a fresh, deterministic seed.
 */
function countBy(items: RunItem[], field: keyof RunItem): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items) {
    const key = String(it[field] ?? 'null');
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

export async function setup(): Promise<void> {
  if (process.env.VERIFY_REUSE_RUNS && manifestExists()) {
    // eslint-disable-next-line no-console
    console.log('[verify] VERIFY_REUSE_RUNS set + manifest present — skipping reseed/execute.');
    return;
  }

  const client = new ApiClient();
  await client.login();
  // eslint-disable-next-line no-console
  console.log('[verify] reseeding vantax tenant (~220s)…');
  await client.reseed();

  const runs: Record<string, RunRecord> = {};
  for (const [key, subName] of Object.entries(RECON_SUBCATALYSTS)) {
    // eslint-disable-next-line no-console
    console.log(`[verify] executing "${subName}"…`);
    const { runId, status } = await client.executeSubCatalyst(subName);
    const { totals, items } = await client.getRun(runId);
    runs[key] = { subName, runId, status, totals, statusCounts: countBy(items, 'item_status') };
  }

  const manifest: RunManifest = {
    seededAt: new Date().toISOString(),
    tenantId: client.user!.tenantId,
    runs,
  };
  writeManifest(manifest);
  // eslint-disable-next-line no-console
  console.log(`[verify] manifest written: ${Object.keys(runs).length} runs recorded.`);
}
