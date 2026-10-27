import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { build, type Plugin } from 'vite';

const APP_DIR = dirname(fileURLToPath(import.meta.url));

/** Workspace packages ship TypeScript source, so they are bundled rather than required. */
const WORKSPACE_PACKAGES = [
  '@architect/shared',
  '@architect/engine',
  '@architect/harness',
  '@architect/adapters',
  '@architect/ui',
];

/**
 * The engine's tool sandbox entry. The engine forks it as a plain Node process, so it ships as
 * one self-contained file next to the QuickJS WebAssembly it loads.
 */
const SANDBOX_ENTRY = join(
  dirname(createRequire(import.meta.url).resolve('@architect/engine')),
  'sandbox',
  'child.ts',
);
const SANDBOX_OUT_DIR = join(APP_DIR, 'out', 'sandbox');
/** The name the QuickJS loader looks for beside itself. */
const QUICKJS_WASM = 'emscripten-module.wasm';

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

/**
 * Emits the QuickJS WebAssembly beside the bundle, taken from the folder of the loader that was
 * actually bundled, so the two always come from the same build of QuickJS.
 */
function quickjsWasm(): Plugin {
  return {
    name: 'architect:quickjs-wasm',
    async generateBundle(_options, bundle) {
      const loaders = Object.values(bundle).flatMap((chunk) =>
        chunk.type === 'chunk'
          ? chunk.moduleIds.filter((id) => basename(id) === 'emscripten-module.mjs')
          : [],
      );
      const [loader, ...others] = loaders;
      if (!loader || others.length > 0) {
        this.error(`Expected one QuickJS loader in the sandbox bundle, found ${loaders.length}.`);
      }
      this.emitFile({
        type: 'asset',
        fileName: QUICKJS_WASM,
        source: await readFile(join(dirname(loader), QUICKJS_WASM)),
      });
    },
  };
}

/**
 * Builds the sandbox child after each main build: a single ES module with every dependency
 * inlined, so it runs from a plain folder outside the app archive.
 */
function sandboxChild(): Plugin {
  let target: string | string[] | false = false;
  return {
    name: 'architect:sandbox-child',
    apply: 'build',
    configResolved(config) {
      target = config.build.target;
    },
    async writeBundle() {
      await build({
        configFile: false,
        root: APP_DIR,
        logLevel: 'warn',
        plugins: [quickjsWasm()],
        ssr: { noExternal: true },
        build: {
          ssr: true,
          target,
          outDir: SANDBOX_OUT_DIR,
          emptyOutDir: true,
          minify: false,
          copyPublicDir: false,
          reportCompressedSize: false,
          rolldownOptions: {
            input: { child: SANDBOX_ENTRY },
            output: { format: 'es', entryFileNames: '[name].mjs', codeSplitting: false },
          },
        },
      });
    },
  };
}

export default defineConfig({
  main: {
    plugins: [sandboxChild()],
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
