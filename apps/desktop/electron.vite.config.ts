import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'electron-vite';
import { build, type Plugin } from 'vite';

const APP_DIR = dirname(fileURLToPath(import.meta.url));
const ENGINE_SRC = dirname(createRequire(import.meta.url).resolve('@architect/engine'));
const CLI_DIR = dirname(createRequire(import.meta.url).resolve('@architect/cli/package.json'));
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

/** An entry in the engine package that runs as a process of its own. */
interface ProcessEntry {
  source: string;
  outDir: string;
  /** The bundle's name, when not the source's. */
  name?: string;
  plugins?: Plugin[];
}

const PROCESS_ENTRIES: ProcessEntry[] = [
  // The tool sandbox, which the engine and the agent host fork as a plain Node process from its
  // own folder, next to the QuickJS WebAssembly it loads.
  {
    source: join(ENGINE_SRC, 'sandbox', 'child.ts'),
    outDir: join(APP_DIR, 'out', 'sandbox'),
    plugins: [quickjsWasm()],
  },
  // The agent host, which installs its network guard before anything else it loads.
  { source: join(ENGINE_SRC, 'agent-host', 'main.ts'), outDir: join(APP_DIR, 'out', 'agent-host') },
  // The architect command, which the installed app's launcher runs on the app's own Node. It
  // finds the sandbox in the folder beside its own.
  {
    source: join(CLI_DIR, 'src', 'main.ts'),
    outDir: join(APP_DIR, 'out', 'cli'),
    name: 'architect',
  },
];

/**
 * Builds the process entries after each main build, each one a single ES module with every
 * dependency inlined, so it runs on its own from any folder.
 */
function processEntries(entries: readonly ProcessEntry[]): Plugin {
  let target: string | string[] | false = false;
  return {
    name: 'architect:process-entries',
    apply: 'build',
    configResolved(config) {
      target = config.build.target;
    },
    async writeBundle() {
      for (const entry of entries) {
        await build({
          configFile: false,
          root: APP_DIR,
          logLevel: 'warn',
          plugins: entry.plugins ?? [],
          ssr: { noExternal: true },
          build: {
            ssr: true,
            target,
            outDir: entry.outDir,
            emptyOutDir: true,
            minify: false,
            copyPublicDir: false,
            reportCompressedSize: false,
            rolldownOptions: {
              input: { [entry.name ?? basename(entry.source, '.ts')]: entry.source },
              output: { format: 'es', entryFileNames: '[name].mjs', codeSplitting: false },
            },
          },
        });
      }
    },
  };
}

export default defineConfig({
  main: {
    // src/main/index.ts imports the engine's utility process with `?modulePath`, which builds it
    // as a bundle of its own. The sandbox and the agent host are built by this plugin.
    plugins: [processEntries(PROCESS_ENTRIES)],
    build: {
      // Everything is bundled, so the packaged app ships no node_modules.
      externalizeDeps: false,
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
