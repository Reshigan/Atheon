#!/usr/bin/env node
/**
 * Bundle-size CI gate. Run after `vite build`.
 *
 * Why: the SPA is shipped from Cloudflare Pages and parsed by a CFO on
 * a 4G hotel network. A 10 MB index regression silently degrades the
 * shared-savings demo. We catch it in CI rather than in production.
 *
 * Limits chosen with current sizes + ~25% headroom:
 *   - any single chunk      < 1300 KB raw
 *   - total dist/assets/*js < 4800 KB raw
 *
 * Override at the command line:
 *   node scripts/check-bundle-size.mjs --max-chunk-kb=1500 --max-total-kb=5000
 */

import { readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, '').split('=');
    return [k, v];
  }),
);

const MAX_CHUNK_KB = Number(args['max-chunk-kb'] ?? 1300);
const MAX_TOTAL_KB = Number(args['max-total-kb'] ?? 4800);
const DIST = resolve(process.cwd(), args['dist'] ?? 'dist/assets');

let files;
try {
  files = readdirSync(DIST).filter((f) => f.endsWith('.js'));
} catch (e) {
  console.error(`bundle-size: cannot read ${DIST} — did you run \`vite build\`?`);
  process.exit(2);
}

const chunks = files.map((name) => {
  const bytes = statSync(join(DIST, name)).size;
  return { name, kb: bytes / 1024 };
});
chunks.sort((a, b) => b.kb - a.kb);

const totalKb = chunks.reduce((s, c) => s + c.kb, 0);
const oversized = chunks.filter((c) => c.kb > MAX_CHUNK_KB);

const fmt = (kb) => `${kb.toFixed(1)} KB`;
console.log(`bundle-size: ${chunks.length} JS chunks · total ${fmt(totalKb)} (limit ${MAX_TOTAL_KB} KB)`);
console.log('top 5 chunks:');
for (const c of chunks.slice(0, 5)) {
  console.log(`  ${fmt(c.kb).padStart(10)}  ${c.name}`);
}

const failures = [];
if (totalKb > MAX_TOTAL_KB) {
  failures.push(`total ${fmt(totalKb)} exceeds ${MAX_TOTAL_KB} KB`);
}
if (oversized.length) {
  for (const c of oversized) {
    failures.push(`${c.name} = ${fmt(c.kb)} exceeds ${MAX_CHUNK_KB} KB`);
  }
}

if (failures.length) {
  console.error('\nbundle-size: FAIL');
  for (const f of failures) console.error(`  - ${f}`);
  console.error('\nResolve by code-splitting, lazy-loading, or removing dependencies.');
  process.exit(1);
}

console.log('bundle-size: OK');
