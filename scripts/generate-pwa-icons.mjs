#!/usr/bin/env node
// Generate PWA icons from public/atheon-icon.svg.
// Produces:
//   - public/atheon-icon-192.png         (standard)
//   - public/atheon-icon-512.png         (standard)
//   - public/atheon-icon-192-maskable.png (maskable, 12% safe-zone padding)
//   - public/atheon-icon-512-maskable.png (maskable, 12% safe-zone padding)
//   - public/apple-touch-icon.png         (180x180 for iOS Add to Home Screen)
//
// Maskable icons are inset by ~12% to satisfy the safe-zone spec — Android
// applies circular / squircle / squared masks, and any content outside the
// safe zone may be cropped. Background fills the bleed area with the SVG's
// own primary dark navy so the mask blends in with the brand.
//
// Run: node scripts/generate-pwa-icons.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import sharp from 'sharp';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'public');
const svgPath = path.join(publicDir, 'atheon-icon.svg');

const BRAND_BG = '#0a0e2a';

async function render(svg, size, outPath, { maskable = false } = {}) {
  if (maskable) {
    // Inset the icon by ~12% to keep important content inside the safe zone.
    // The bleed area is filled with the brand background.
    const inner = Math.round(size * 0.76);
    const innerBuf = await sharp(Buffer.from(svg))
      .resize(inner, inner, { fit: 'contain', background: BRAND_BG })
      .png()
      .toBuffer();
    const offset = Math.round((size - inner) / 2);
    await sharp({
      create: { width: size, height: size, channels: 4, background: BRAND_BG },
    })
      .composite([{ input: innerBuf, top: offset, left: offset }])
      .png()
      .toFile(outPath);
  } else {
    await sharp(Buffer.from(svg))
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toFile(outPath);
  }
  console.log(`✓ ${path.relative(repoRoot, outPath)}`);
}

const svg = await readFile(svgPath, 'utf8');

await render(svg, 192, path.join(publicDir, 'atheon-icon-192.png'));
await render(svg, 512, path.join(publicDir, 'atheon-icon-512.png'));
await render(svg, 192, path.join(publicDir, 'atheon-icon-192-maskable.png'), { maskable: true });
await render(svg, 512, path.join(publicDir, 'atheon-icon-512-maskable.png'), { maskable: true });
await render(svg, 180, path.join(publicDir, 'apple-touch-icon.png'));

// Also produce a 96 favicon-style PNG for legacy browsers that don't render SVG favicons.
await render(svg, 96, path.join(publicDir, 'favicon-96.png'));
