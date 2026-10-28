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
  /**
   * Resumes what was active when the folder was last closed: the training worker's unfinished
   * jobs, and every run, re-test, repeat and reference that was going. Only once the runner has
   * checked its plan and set up its guards, since what resumes spends at once.
   */
  recover(): void;
  close(): Promise<void>;
}

export interface ComparisonEngineOptions {
  /** Runs, re-tests, repeats and references using the students at once. */
  parallel: number;
  /** Attempts in flight at once within one hosted evaluation. */
  concurrency: number;
  onError(error: unknown): void;
}

/**
 * Opens the engine on a data folder the way the engine host does, without the app's API, and
 * resumes nothing: work left active by a crash waits for `recover` (decision 051).
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
  return {
    paths,
    store,
    jobs,
    controller,
    recover: () => {
      deps.training?.worker.resume();
      controller.recover();
    },
    close: async () => {
      await controller.close();
      deps.training?.worker.close();
      store.close();
    },
  };
}
