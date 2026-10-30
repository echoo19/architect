import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ExperimentEventSchema, PublishProgressSchema, RunEventSchema } from '@architect/shared';
import { ExperimentService, type ExperimentEnvironment } from '../experiments/service';
import {
  CHECK_PURPOSE,
  hostAdapterRuntime,
  RUN_PURPOSE,
  type GpuLease,
  type LocalAdapterRuntime,
  type LocalRuntimeSettings,
  type ServerCommand,
} from '../local-runtime';
import { RunController } from '../loop/controller';
import { systemClock, type Clock, type EngineHostDeps } from '../loop/deps';
import { JobLibrary } from '../loop/jobs';
import { DataPaths } from '../loop/paths';
import { openEngineStore } from '../store/engine-store';
import { ContractBook } from '../graduates/contracts';
import { GraduateLibrary } from '../graduates/library';
import { HubClient, hubTokenResolver } from '../hub';
import { createEngineApi } from './api';
import type { EnginePort } from './port';
import {
  ENGINE_ROUTES,
  isEngineMethod,
  RequestMessageSchema,
  toErrorPayload,
  type EngineApi,
} from './protocol';
import { studentsHolding } from './students';

export interface EngineHostOptions {
  /** The app's data folder: the database, jobs, the vault and graduates live here. */
  dataDir: string;
  deps: EngineHostDeps;
  clock?: Clock;
  /** Attempts in flight at once while training. */
  concurrency?: number;
  /** The settings its llama-server follows, read at every start: path, thread cap, which Ollama. */
  localRuntime?: () => LocalRuntimeSettings;
  /** A stand-in llama-server for tests, run instead of finding the real one. */
  llamaServerCommand?: ServerCommand;
  /**
   * The process's adapter runtime when the caller made it, for its deps' students as well, so
   * runs and installation checks share one llama-server. The host makes its own otherwise.
   * Either way the host stops it when it closes.
   */
  adapterRuntime?: LocalAdapterRuntime;
  /**
   * The process's share of the machine-wide GPU lease (decision 046), which a caller-made
   * `adapterRuntime` holds too. Students on Ollama here then hold it for each request, a run's
   * after a check's, and the host's own llama-server holds it as well. Without it, as in tests
   * and scripts on a data folder of their own, nothing is coordinated. The caller closes it.
   */
  gpu?: GpuLease;
  /**
   * Whether runs, re-tests and training jobs left active resume when the host starts: true for
   * the app. A command that does one thing on the app's data folder leaves them to the app.
   */
  recover?: boolean;
  /** Errors nobody asked about: a broken event listener, a message that isn't a request. */
  onError?(error: unknown): void;
  /**
   * Hugging Face, for publishing and installing versions. By default the Hub itself, with the
   * key saved in the app, else HF_TOKEN, else Hugging Face's token file.
   */
  hub?: HubClient;
  /**
   * The comparisons runner's environment on an experiment's data folder (decision 074): its
   * models, keys and training compute. Without it experiments can be planned and read, not run.
   */
  experimentEnvironment?: (dataDir: string, log: (line: string) => void) => ExperimentEnvironment;
  /**
   * The repository's trainer folder, which training bundles carry pins and the experimental
   * script from (decision 072). Without it plans can be sized, not bundled.
   */
  trainerDir?: string;
}

export interface EngineHost {
  /** The API for callers in the host's own process. */
  readonly api: EngineApi;
  /** Answers requests from the port and streams run events to it. */
  serve(port: EnginePort): void;
  /** Aborts active runs, which resume on the next start, and closes the database. */
  close(): Promise<void>;
}

function requestId(message: unknown): number | null {
  if (typeof message !== 'object' || message === null || !('id' in message)) return null;
  return typeof message.id === 'number' ? message.id : null;
}

async function answer(api: EngineApi, port: EnginePort, message: unknown): Promise<void> {
  const id = requestId(message);
  try {
    const request = RequestMessageSchema.parse(message);
    if (!isEngineMethod(request.method)) {
      throw new Error(`There is no "${request.method}" request.`);
    }
    const result = await ENGINE_ROUTES[request.method].answer(api, request.params);
    port.postMessage({ kind: 'response', id: request.id, ok: true, result });
  } catch (error) {
    if (id === null) throw error;
    port.postMessage({ kind: 'response', id, ok: false, error: toErrorPayload(error) });
  }
}

/**
 * The engine host: storage, jobs and the run controller behind a request/response API and an
 * event stream. It knows nothing about Electron; it talks over any `EnginePort`. Runs that were
 * active when the app last closed resume as soon as it starts.
 */
export async function createEngineHost(options: EngineHostOptions): Promise<EngineHost> {
  await mkdir(options.dataDir, { recursive: true });
  const clock = options.clock ?? systemClock;
  const onError = options.onError ?? ((error: unknown) => console.error(error));
  const paths = new DataPaths(options.dataDir);
  const store = openEngineStore(paths.database);
  const contracts = new ContractBook(store, clock);
  const { gpu } = options;
  // Runs and checks take the GPU in turns with the other processes, a check before a run.
  const deps = studentsHolding(options.deps, gpu, RUN_PURPOSE);
  const jobs = new JobLibrary(store, paths, deps, clock, contracts);
  // The engine's one llama-server, for its installation checks and its runs' adapter students,
  // apart from the workspace's (decision 041).
  const localRuntime = options.localRuntime ?? (() => ({}));
  const adapterRuntime =
    options.adapterRuntime ??
    hostAdapterRuntime({
      runtimeDir: paths.runtimeDir('engine'),
      settings: localRuntime,
      purpose: RUN_PURPOSE,
      ...(gpu === undefined ? {} : { gpu }),
      ...(options.llamaServerCommand === undefined ? {} : { command: options.llamaServerCommand }),
    });
  const graduates = new GraduateLibrary({
    store,
    paths,
    clock,
    contracts,
    deps: studentsHolding(options.deps, gpu, CHECK_PURPOSE),
    adapterRuntime: adapterRuntime.serving(CHECK_PURPOSE),
  });
  const controller = new RunController({
    libraryLock: graduates.lock,
    store,
    paths,
    jobs,
    deps,
    clock,
    concurrency: options.concurrency,
    onError,
  });
  const hub =
    options.hub ??
    new HubClient({
      token: hubTokenResolver({ saved: () => options.deps.secrets.get('huggingface') }),
    });
  const experiments = new ExperimentService({
    dir: join(paths.root, 'experiments'),
    clock,
    onError,
    ...(options.experimentEnvironment === undefined
      ? {}
      : { environment: options.experimentEnvironment }),
  });
  const api = createEngineApi({
    store,
    paths,
    jobs,
    controller,
    graduates,
    deps,
    clock,
    hub,
    experiments,
    ...(options.trainerDir === undefined ? {} : { trainerDir: options.trainerDir }),
  });
  const ports = new Set<EnginePort>();
  let closed = false;

  controller.onEvent((event) => {
    const message = { kind: 'event', event: RunEventSchema.parse(event) };
    for (const port of ports) port.postMessage(message);
  });
  experiments.onEvent((event) => {
    const message = { kind: 'experiment.event', event: ExperimentEventSchema.parse(event) };
    for (const port of ports) port.postMessage(message);
  });
  // A publication's progress goes to every port, like run events; a malformed one is reported,
  // never allowed to stop the upload it describes.
  api.graduates.onPublishProgress((progress) => {
    const checked = PublishProgressSchema.safeParse(progress);
    if (!checked.success) {
      onError(new Error("A publication's progress didn't match its schema, so it wasn't sent."));
      return;
    }
    const message = { kind: 'publish.progress', progress: checked.data };
    for (const port of ports) port.postMessage(message);
  });
  // Graduates from before versions become version 1 before anyone can open them.
  await graduates.upgrade();
  // A job that was being made when the app closed is taken back whole, with its sealed test, so
  // nothing is left that no job owns and the job's id is free to be made again.
  await jobs.recoverInterrupted(onError);
  if (options.recover !== false) {
    // Training jobs left unfinished when the app closed are checked again, never sent again.
    options.deps.training?.worker.resume();
    controller.recover();
  }

  return {
    api,
    serve(port) {
      ports.add(port);
      port.onMessage((message) => {
        if (!closed) answer(api, port, message).catch(onError);
      });
    },
    async close() {
      closed = true;
      ports.clear();
      await experiments.close();
      await Promise.all([controller.close(), adapterRuntime.stop()]);
      options.deps.training?.worker.close();
      store.close();
    },
  };
}
