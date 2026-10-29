/**
 * Builds the page into dist/: the scripts and styles for browsers, then the same page rendered once
 * into dist/index.html, so the file carries all its words and pictures before any script runs.
 * The result is plain static files that work from any address.
 */
import { readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rendered = path.join(root, 'dist-server');

await build({ root, logLevel: 'warn' });

await build({
  root,
  logLevel: 'warn',
  build: {
    ssr: 'src/entry-server.tsx',
    outDir: rendered,
    emptyOutDir: true,
    copyPublicDir: false,
    target: 'es2023',
  },
  // The component library is TypeScript source in this repository, so it is built with the page.
  ssr: { noExternal: ['@architect/ui'] },
});

try {
  const server = await import(pathToFileURL(path.join(rendered, 'entry-server.js')).href);
  const file = path.join(root, 'dist', 'index.html');
  const html = await readFile(file, 'utf8');
  const marker = '<!--app-html-->';
  if (!html.includes(marker)) throw new Error(`dist/index.html has no ${marker} to render into.`);
  await writeFile(file, html.replace(marker, server.render()));
} finally {
  await rm(rendered, { recursive: true, force: true });
}
