import { mkdir } from 'node:fs/promises';
import { RunEventSchema } from '@architect/shared';
import {
  hostAdapterRuntime,
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
  /** Errors nobody asked about: a broken event listener, a message that isn't a request. */
  onError?(error: unknown): void;
  /**
   * Hugging Face, for publishing and installing versions. By default the Hub itself, with the
   * key saved in the app, else HF_TOKEN, else Hugging Face's token file.
   */
  hub?: HubClient;
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
  const jobs = new JobLibrary(store, paths, options.deps, clock, contracts);
  // The engine's one llama-server, for its installation checks and its runs' adapter students,
  // apart from the workspace's (decision 041).
  const localRuntime = options.localRuntime ?? (() => ({}));
  const adapterRuntime =
    options.adapterRuntime ??
    hostAdapterRuntime({
      runtimeDir: paths.runtimeDir('engine'),
      settings: localRuntime,
      ...(options.llamaServerCommand === undefined ? {} : { command: options.llamaServerCommand }),
    });
  const graduates = new GraduateLibrary({
    store,
    paths,
    clock,
    contracts,
    deps: options.deps,
    adapterRuntime,
  });
  const controller = new RunController({
    libraryLock: graduates.lock,
    store,
    paths,
    jobs,
    deps: options.deps,
    clock,
    concurrency: options.concurrency,
    onError,
  });
  const hub =
    options.hub ??
    new HubClient({
      token: hubTokenResolver({ saved: () => options.deps.secrets.get('huggingface') }),
    });
  const api = createEngineApi({
    store,
    paths,
    jobs,
    controller,
    graduates,
    deps: options.deps,
    clock,
    hub,
  });
  const ports = new Set<EnginePort>();
  let closed = false;

  controller.onEvent((event) => {
    const message = { kind: 'event', event: RunEventSchema.parse(event) };
    for (const port of ports) port.postMessage(message);
  });
  // Graduates from before versions become version 1 before anyone can open them.
  await graduates.upgrade();
  // Training jobs left unfinished when the app closed are checked again, never sent again.
  options.deps.training?.worker.resume();
  controller.recover();

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
      await Promise.all([controller.close(), adapterRuntime.stop()]);
      options.deps.training?.worker.close();
      store.close();
    },
  };
}
