/**
 * Builds the site into dist/: the scripts and styles for browsers, then each page rendered once
 * into its own file (dist/index.html and dist/results/index.html), so every file carries all its
 * words and pictures before any script runs. The result is plain static files that work from any
 * address, and the results page is served at /results/.
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
  const marker = '<!--app-html-->';
  for (const [file, html] of [
    [path.join(root, 'dist', 'index.html'), server.render()],
    [path.join(root, 'dist', 'results', 'index.html'), server.renderResults()],
  ]) {
    const page = await readFile(file, 'utf8');
    if (!page.includes(marker)) throw new Error(`${file} has no ${marker} to render into.`);
    await writeFile(file, page.replace(marker, html));
  }
} finally {
  await rm(rendered, { recursive: true, force: true });
}
