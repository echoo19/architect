import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** The faces the first screen is set in, which the browser should fetch alongside the styles. */
const FIRST_SCREEN_FONTS = [/heros-regular-latin/, /heros-bold-latin/, /geist-latin-wght-normal/];

/**
 * Fonts named only inside the stylesheet are found late, after it has loaded, and the first screen
 * is drawn in a stand-in for a moment. Naming them in the page's head fetches them with it.
 */
function preloadFonts(): Plugin {
  return {
    name: 'architect:preload-fonts',
    transformIndexHtml: {
      order: 'post',
      handler(_html, context) {
        const bundle = context.bundle ?? {};
        return Object.keys(bundle)
          .filter((file) => FIRST_SCREEN_FONTS.some((face) => face.test(file)))
          .map((file) => ({
            tag: 'link',
            attrs: {
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `./${file}`,
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
 * a project page on GitHub.
 */
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), preloadFonts()],
  build: {
    target: 'es2023',
    assetsInlineLimit: 0,
  },
});
