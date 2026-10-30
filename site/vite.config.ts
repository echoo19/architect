import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** The faces the first screen is set in, which the browser should fetch alongside the styles. */
const FIRST_SCREEN_FONTS = [/inter-latin-wght-normal/, /inter-tight-latin-wght-normal/];

/**
 * Fonts named only inside the stylesheet are found late, after it has loaded, and the first screen
 * is drawn in a stand-in for a moment. Naming them in the page's head fetches them with it. The
 * address is relative to the page, which is one folder down for the results page.
 */
function preloadFonts(): Plugin {
  return {
    name: 'architect:preload-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const bundle = context.bundle ?? {};
        const depth = context.path.split('/').length - 2;
        const up = depth > 0 ? '../'.repeat(depth) : './';
        return Object.keys(bundle)
          .filter((file) => FIRST_SCREEN_FONTS.some((face) => face.test(file)))
          .map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `${up}${file}`,
              crossorigin: '',
            },
            injectTo: 'head' as const,
          }));
      },
    },
  };
}

/**
 * A relative base, so the built folder works from any address: a domain's root, or a path such as
 * a project page on GitHub. The site has two pages: the home page and the results page.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), preloadFonts()],
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        index: fileURLToPath(new URL('./index.html', import.meta.url)),
        results: fileURLToPath(new URL('./results/index.html', import.meta.url)),
      },
    },
  },
});
