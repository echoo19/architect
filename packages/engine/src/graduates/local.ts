import { createStudent } from '@architect/adapters';
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
  clock?: Clock;
}

export interface LocalLibrary {
  paths: DataPaths;
  store: EngineStore;
  library: GraduateLibrary;
  /** Closes the database. */
  close(): void;
}

/**
 * The graduate library for a process other than the engine host, such as the command line: the
 * app's own database, versions, installations and checks, with a tool sandbox and a local
 * student for the installation checks, and nothing else. It converts and clears nothing when it
 * opens; the engine host does that when the app starts.
 */
export function openLocalLibrary(options: LocalLibraryOptions): LocalLibrary {
  const paths = new DataPaths(options.dataDir);
  const store = openEngineStore(paths.database);
  const clock = options.clock ?? systemClock;
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
  });
  return { paths, store, library, close: () => store.close() };
}
