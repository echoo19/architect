import { mkdirSync } from 'node:fs';
import { KeyedLock } from '../graduates/library';
import { RunController } from '../loop/controller';
import type { Clock, LoopDeps } from '../loop/deps';
import { JobLibrary } from '../loop/jobs';
import { DataPaths } from '../loop/paths';
import { openEngineStore, type EngineStore } from '../store/engine-store';

/** The engine on a comparison's own data folder: its store, its jobs and one run controller. */
export interface ComparisonEngine {
  paths: DataPaths;
  store: EngineStore;
  jobs: JobLibrary;
  controller: RunController;
  close(): Promise<void>;
}

export interface ComparisonEngineOptions {
  /** Runs, re-tests, repeats and references using the students at once. */
  parallel: number;
  /** Attempts in flight at once within one hosted evaluation. */
  concurrency: number;
  onError(error: unknown): void;
  /** Resume what was active when it last closed; false only to read the records. Default true. */
  resume?: boolean;
}

/**
 * Opens the engine on a data folder the way the engine host does, without the app's API: the
 * training worker picks up its unfinished jobs and the controller resumes every run, re-test,
 * repeat and reference that was active, so a crash never pays for work twice.
 */
export function openComparisonEngine(
  dataDir: string,
  deps: LoopDeps,
  clock: Clock,
  options: ComparisonEngineOptions,
): ComparisonEngine {
  mkdirSync(dataDir, { recursive: true });
  const paths = new DataPaths(dataDir);
  const store = openEngineStore(paths.database);
  const jobs = new JobLibrary(store, paths, deps, clock);
  const controller = new RunController({
    store,
    paths,
    jobs,
    deps,
    clock,
    concurrency: options.concurrency,
    maxActiveRuns: options.parallel,
    onError: options.onError,
    libraryLock: new KeyedLock(),
  });
  if (options.resume !== false) {
    deps.training?.worker.resume();
    controller.recover();
  }
  return {
    paths,
    store,
    jobs,
    controller,
    close: async () => {
      await controller.close();
      deps.training?.worker.close();
      store.close();
    },
  };
}
