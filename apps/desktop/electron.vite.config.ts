import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import type { Plugin } from 'vite';

/** Workspace packages ship TypeScript source, so they are bundled rather than required. */
const WORKSPACE_PACKAGES = [
  '@architect/shared',
  '@architect/engine',
  '@architect/harness',
  '@architect/adapters',
  '@architect/ui',
];

const STRICT_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self'",
].join('; ');

/** The dev server needs an inline React Refresh preamble and a websocket for hot reload. */
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self' data:",
  "connect-src 'self' ws://localhost:* http://localhost:*",
].join('; ');

function contentSecurityPolicy(): Plugin {
  let policy = STRICT_CSP;
  return {
    name: 'architect:csp',
    configResolved(config) {
      policy = config.command === 'serve' ? DEV_CSP : STRICT_CSP;
    },
    transformIndexHtml: () => [
      {
        tag: 'meta',
        attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
        injectTo: 'head-prepend',
      },
    ],
  };
}

export default defineConfig({
  main: {
    build: {
      externalizeDeps: { exclude: WORKSPACE_PACKAGES },
    },
  },
  preload: {
    build: {
      // Sandboxed preloads can't require packages, and must be CommonJS.
      externalizeDeps: false,
      rolldownOptions: {
        output: { format: 'cjs', entryFileNames: '[name].cjs' },
      },
    },
  },
  renderer: {
    plugins: [react(), tailwindcss(), contentSecurityPolicy()],
  },
});
