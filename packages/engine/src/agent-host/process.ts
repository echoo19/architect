import { parseArgs } from 'node:util';
import { DataPaths } from '../loop/paths';
import { openEngineStore } from '../store/engine-store';
import type { LoopbackGuard } from './guard/install';
import { createAgentHost } from './host';
import type { AgentHostPort } from './protocol';
import { serveAgentHost } from './serve';
import { workspaceStore } from './store';

/** The part of Electron's `process.parentPort` in a utility process that the host uses. */
interface ElectronParentPort {
  on(event: 'message', listener: (event: { data: unknown }) => void): void;
  postMessage(message: unknown): void;
}

/**
 * Runs the agent host for the parent process: `--data-dir <folder>` names the app's data folder
 * (required) and `--sandbox-entry <file>` the tool sandbox's built child entry. The host serves
 * the parent over Electron's parent port, or over the IPC channel of a Node child process, which
 * must be forked with `serialization: 'advanced'` so messages are structured clones as they are
 * between Electron processes.
 */
export function startAgentHostProcess(guard: LoopbackGuard): void {
  const { dataDir, sandboxEntryPath } = readArguments();
  const port = parentPort();
  const engine = openEngineStore(new DataPaths(dataDir).database);
  const host = createAgentHost({
    store: workspaceStore(engine, dataDir),
    ...(sandboxEntryPath === undefined ? {} : { sandboxEntryPath }),
  });
  serveAgentHost(port, host, { guard });
  // A Node parent that goes away takes the host with it; Electron ends utility processes itself.
  process.once('disconnect', () => {
    host
      .close()
      .catch((error: unknown) => console.error(error))
      .finally(() => {
        engine.close();
        process.exit(0);
      });
  });
}

function readArguments(): { dataDir: string; sandboxEntryPath?: string } {
  // Electron and Node differ in what comes before the arguments, so positionals are ignored.
  const { values } = parseArgs({
    args: process.argv.slice(1),
    options: { 'data-dir': { type: 'string' }, 'sandbox-entry': { type: 'string' } },
    allowPositionals: true,
    strict: false,
  });
  const dataDir = values['data-dir'];
  const sandboxEntry = values['sandbox-entry'];
  if (typeof dataDir !== 'string' || dataDir === '') {
    throw new Error('Start the agent host with --data-dir <the app data folder>.');
  }
  return typeof sandboxEntry === 'string'
    ? { dataDir, sandboxEntryPath: sandboxEntry }
    : { dataDir };
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
