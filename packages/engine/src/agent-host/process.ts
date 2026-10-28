import { parseArgs } from 'node:util';
import {
  GpuLease,
  hostAdapterRuntime,
  ServerCommandSchema,
  type LocalRuntimeSettings,
  type ServerCommand,
} from '../local-runtime';
import { DataPaths } from '../loop/paths';
import { openEngineStore } from '../store/engine-store';
import type { LoopbackGuard } from './guard/install';
import { createAgentHost } from './host';
import { StopMessageSchema, type AgentHostPort } from './protocol';
import { serveAgentHost } from './serve';
import { workspaceStore } from './store';

/** The part of Electron's `process.parentPort` in a utility process that the host uses. */
interface ElectronParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/**
 * Runs the agent host for the parent process: `--data-dir <folder>` names the app's data folder
 * (required), `--sandbox-entry <file>` the tool sandbox's built child entry, and
 * `--llama-server-command <json>` a stand-in llama-server for tests (`{ file, args }`). The host
 * serves the parent over Electron's parent port, or over the IPC channel of a Node child process,
 * which must be forked with `serialization: 'advanced'` so messages are structured clones as they
 * are between Electron processes. Its llama-server follows the settings the parent sends with
 * `host.configure`, and stops with the host. It takes the GPU in turns with the engine and the
 * architect command through the lease in the data folder (decision 046).
 */
export function startAgentHostProcess(guard: LoopbackGuard): void {
  const { dataDir, sandboxEntryPath, llamaServerCommand } = readArguments();
  const parent = parentPort();
  const paths = new DataPaths(dataDir);
  const engine = openEngineStore(paths.database);
  let settings: LocalRuntimeSettings = {};
  const gpu = new GpuLease({
    dataDir,
    owner: 'workspace',
    onError: (error) => console.error('[workspace] The GPU lease:', error),
  });
  const host = createAgentHost({
    store: workspaceStore(engine, dataDir),
    adapters: hostAdapterRuntime({
      runtimeDir: paths.runtimeDir('workspace'),
      settings: () => settings,
      gpu,
      ...(llamaServerCommand === undefined ? {} : { command: llamaServerCommand }),
    }),
    gpu,
    ...(sandboxEntryPath === undefined ? {} : { sandboxEntryPath }),
  });
  let stopping: Promise<void> | null = null;
  const stop = () => {
    stopping ??= host
      .close()
      .then(() => gpu.close())
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        engine.close();
        process.exit(0);
      });
  };
  // A stop from the parent is the process's, not a request to the host.
  const port: AgentHostPort = {
    postMessage: (message) => parent.postMessage(message),
    onMessage: (handler) =>
      parent.onMessage((message) => {
        if (StopMessageSchema.safeParse(message).success) stop();
        else handler(message);
      }),
  };
  serveAgentHost(port, host, {
    guard,
    configure: (next) => {
      settings = next;
    },
  });
  // A Node parent that goes away takes the host with it.
  process.once('disconnect', stop);
}

function readArguments(): {
  dataDir: string;
  sandboxEntryPath?: string;
  llamaServerCommand?: ServerCommand;
} {
  // Electron and Node differ in what comes before the arguments, so positionals are ignored.
  const { values } = parseArgs({
    args: process.argv.slice(1),
    options: {
      'data-dir': { type: 'string' },
      'sandbox-entry': { type: 'string' },
      'llama-server-command': { type: 'string' },
    },
    allowPositionals: true,
    strict: false,
  });
  const dataDir = values['data-dir'];
  const sandboxEntry = values['sandbox-entry'];
  const command = values['llama-server-command'];
  if (typeof dataDir !== 'string' || dataDir === '') {
    throw new Error('Start the agent host with --data-dir <the app data folder>.');
  }
  return {
    dataDir,
    ...(typeof sandboxEntry === 'string' ? { sandboxEntryPath: sandboxEntry } : {}),
    ...(typeof command === 'string'
      ? { llamaServerCommand: ServerCommandSchema.parse(JSON.parse(command)) }
      : {}),
  };
}

function parentPort(): AgentHostPort {
  const electron = (process as NodeJS.Process & { parentPort?: ElectronParentPort }).parentPort;
  if (electron) {
    return {
      postMessage: (message) => electron.postMessage(message),
      onMessage: (handler) => electron.on('message', (event) => handler(event.data)),
    };
  }
  const send = process.send?.bind(process);
  if (send) {
    return {
      postMessage: (message) => {
        send(message);
      },
      onMessage: (handler) => {
        process.on('message', handler);
      },
    };
  }
  throw new Error(
    'The agent host runs as an Electron utility process or a Node child process with an IPC channel.',
  );
}
