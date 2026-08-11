#!/usr/bin/env node
/**
 * Rasterizes apps/web/public/icon.svg into the PNGs the PWA manifest points at.
 *
 * The PNGs are committed — this only runs when the mark itself changes:
 *   pnpm build:icons
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'apps/web/public/icon.svg');
const outputDir = join(root, 'apps/web/public/icons');

const targets = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  // iOS ignores the manifest icons and never masks: this one ships pre-composed.
  { file: 'apple-touch-icon.png', size: 180 },
];

let sharp;
try {
  ({ default: sharp } = await import('sharp'));
} catch {
  console.error('sharp is not installed. Run: pnpm add -Dw sharp');
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

for (const { file, size } of targets) {
  const png = await sharp(source).resize(size, size).png({ compressionLevel: 9 }).toBuffer();
  await writeFile(join(outputDir, file), png);
  console.log(`${file} — ${size}×${size}, ${(png.length / 1024).toFixed(1)} kB`);
}

console.log('\nIcons written to apps/web/public/icons/');
