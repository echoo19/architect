import { parseArgs } from 'node:util';
import { createEngineHost } from '../../src/host/engine-host';
import { createEngineDeps } from '../../src/host/wiring';
import {
  GpuLease,
  hostAdapterRuntime,
  RUN_PURPOSE,
  ServerCommandSchema,
} from '../../src/local-runtime';
import { DataPaths } from '../../src/loop/paths';

/*
 * The engine host as the desktop's utility process starts it (`apps/desktop/src/utility/engine.ts`),
 * in a plain Node child for tests: the real dependencies, a share of the GPU lease and one
 * llama-server, the stand-in, served over the IPC channel with the engine's own protocol. It says
 * `{ kind: 'ready' }` once it serves, and closes when its parent lets go of the channel.
 * Arguments: `--data-dir`, `--llama-server-command <json>`, `--ollama-url`.
 */

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    'data-dir': { type: 'string' },
    'llama-server-command': { type: 'string' },
    'ollama-url': { type: 'string' },
  },
});
const dataDir = values['data-dir'] ?? '';
const ollamaUrl = values['ollama-url'];
const gpu = new GpuLease({ dataDir, owner: 'engine', pollMs: 25, heartbeatMs: 200 });
const adapterRuntime = hostAdapterRuntime({
  runtimeDir: new DataPaths(dataDir).runtimeDir('engine'),
  settings: () => (ollamaUrl === undefined ? {} : { ollamaUrl }),
  command: ServerCommandSchema.parse(JSON.parse(values['llama-server-command'] ?? '')),
  gpu,
  purpose: RUN_PURPOSE,
});
const host = await createEngineHost({
  dataDir,
  deps: createEngineDeps({ dataDir, getSecret: async () => undefined, adapterRuntime }),
  adapterRuntime,
  gpu,
});
host.serve({
  postMessage: (message) => process.send?.(message),
  onMessage: (handler) => {
    process.on('message', handler);
  },
});
process.once('disconnect', () => {
  void host
    .close()
    .then(() => gpu.close())
    .finally(() => process.exit(0));
});
process.send?.({ kind: 'ready' });
