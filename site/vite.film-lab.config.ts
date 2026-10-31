import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/**
 * The built page opens from a file address, where a module script and a cross-origin stylesheet
 * do not load: the script is built as one plain file run after the page is parsed.
 */
function openFromAnywhere(): Plugin {
  return {
    name: 'architect:film-lab-open-from-anywhere',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html.replaceAll(' type="module"', ' defer').replaceAll(' crossorigin', ''),
    },
  };
}

/**
 * The Lab walkthrough film's page: development only, built to dist-film/lab/ with relative paths
 * so the renderer can open it from any folder. The site's build and deploy do not include it.
 *
 *   pnpm -C site exec vite build --config vite.film-lab.config.ts
 */
export default defineConfig({
  root: fileURLToPath(new URL('./film/lab', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss(), openFromAnywhere()],
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    outDir: fileURLToPath(new URL('./dist-film/lab', import.meta.url)),
    emptyOutDir: true,
    rollupOptions: { output: { format: 'iife', inlineDynamicImports: true } },
  },
});
