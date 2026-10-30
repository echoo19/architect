import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * A module script and a cross-origin stylesheet do not load from a file address, which is how a
 * renderer may open the built page. The script is built as one plain file and run after the page
 * is parsed, and the attributes that ask for a cross-origin request are taken off.
 */
function openFromAnywhere(): Plugin {
  return {
    name: 'architect:film-open-from-anywhere',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replaceAll(' type="module"', ' defer').replaceAll(' crossorigin', ''),
    },
  };
}

/**
 * The launch film's page: a second entry, for development only, built to dist-film/ with relative
 * paths so it opens from any folder. The site's own build and its deploy do not include it.
 *
 *   pnpm -C site exec vite build --config vite.film.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('./film', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss(), openFromAnywhere()],
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    outDir: fileURLToPath(new URL('./dist-film', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
