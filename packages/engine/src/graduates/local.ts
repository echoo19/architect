import { createStudent } from '@architect/adapters';
import {
  hostAdapterRuntime,
  type AdapterServing,
  type LocalRuntimeSettings,
  type ServerCommand,
} from '../local-runtime';
import { systemClock, type Clock } from '../loop/deps';
import { DataPaths } from '../loop/paths';
import { createSandbox } from '../sandbox/sandbox';
import { toolLoadProblem } from '../sandbox/tool-check';
import type { Sandbox } from '../sandbox/types';
import { openEngineStore, type EngineStore } from '../store/engine-store';
import { ContractBook } from './contracts';
import { GraduateLibrary } from './library';

export interface LocalLibraryOptions {
  /** The app's data folder. */
  dataDir: string;
  /** The tool sandbox's child entry; a bundled build passes its own. */
  sandboxEntryPath?: string;
  /**
   * This process's own llama-server, for versions that carry an adapter: the name of its folder
   * under `local-runtime/`, the settings it follows (read at every start), and a stand-in
   * program for tests.
   */
  runtime: { owner: string; settings: () => LocalRuntimeSettings; command?: ServerCommand };
  clock?: Clock;
}

export interface LocalLibrary {
  paths: DataPaths;
  store: EngineStore;
  library: GraduateLibrary;
  /** The llama-server this process checks and serves versions with an adapter on. */
  adapterRuntime: AdapterServing;
  /** Stops the llama-server, if it started, and closes the database. */
  close(): Promise<void>;
}

/**
 * The graduate library for a process other than the engine host, such as the command line: the
 * app's own database, versions, installations and checks, with a tool sandbox, a local student
 * and a llama-server of its own for the installation checks, and nothing else. It converts and
 * clears nothing when it opens; the engine host does that when the app starts.
 */
export function openLocalLibrary(options: LocalLibraryOptions): LocalLibrary {
  const paths = new DataPaths(options.dataDir);
  const store = openEngineStore(paths.database);
  const clock = options.clock ?? systemClock;
  const adapterRuntime = hostAdapterRuntime({
    runtimeDir: paths.runtimeDir(options.runtime.owner),
    settings: options.runtime.settings,
    ...(options.runtime.command === undefined ? {} : { command: options.runtime.command }),
  });
  const library = new GraduateLibrary({
    store,
    paths,
    clock,
    contracts: new ContractBook(store, clock),
    deps: {
      runtime: {
        createSandbox: () =>
          createSandbox(
            options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
          ),
        // The library hands back the sandbox it was given by createSandbox above.
        toolLoadProblem: (sandbox, tool) => toolLoadProblem(sandbox as Sandbox, tool),
      },
      adapters: {
        createStudent: (endpoint, adapterOptions) => createStudent(endpoint, adapterOptions),
      },
    },
    adapterRuntime,
  });
  return {
    paths,
    store,
    library,
    adapterRuntime,
    close: async () => {
      try {
        await adapterRuntime.stop();
      } finally {
        store.close();
      }
    },
  };
}
