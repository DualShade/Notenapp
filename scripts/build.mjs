#!/usr/bin/env node
// Baut die statische Seite nach dist/: kopiert site/ und legt pdf.js lokal ab,
// damit die App ohne externes CDN (und offline als PWA) funktioniert.

import { cp, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const pdfjsDir = path.join(root, 'node_modules', 'pdfjs-dist', 'legacy', 'build');

await rm(dist, { recursive: true, force: true });
await cp(path.join(root, 'site'), dist, { recursive: true });
await mkdir(path.join(dist, 'vendor', 'pdfjs'), { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) {
  await cp(path.join(pdfjsDir, file), path.join(dist, 'vendor', 'pdfjs', file));
}

// Service-Worker-Cache-Version an den Build koppeln.
const swPath = path.join(dist, 'sw.js');
const sw = await readFile(swPath, 'utf8');
const version = process.env.GITHUB_SHA?.slice(0, 8) ?? Date.now().toString(36);
await writeFile(swPath, sw.replace('__BUILD__', version));

// Server-Adressen per GitHub-Variablen überschreiben (PROXY_URL, API_URL).
if (process.env.PROXY_URL || process.env.API_URL) {
  const configPath = path.join(dist, 'js', 'config.js');
  let config = await readFile(configPath, 'utf8');
  for (const [key, value] of [['proxyUrl', process.env.PROXY_URL], ['apiUrl', process.env.API_URL]]) {
    if (value?.trim()) config = config.replace(new RegExp(`${key}: '[^']*'`), `${key}: ${JSON.stringify(value.trim()).replaceAll('"', "'")}`);
  }
  await writeFile(configPath, config);
}

// GitHub Pages soll keine Jekyll-Verarbeitung machen.
await writeFile(path.join(dist, '.nojekyll'), '');
console.log(`Build fertig: dist/ (Version ${version})`);
