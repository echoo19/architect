import { mkdir } from 'node:fs/promises';
import { RunEventSchema } from '@architect/shared';
import { RunController } from '../loop/controller';
import { systemClock, type Clock, type EngineHostDeps } from '../loop/deps';
import { JobLibrary } from '../loop/jobs';
import { DataPaths } from '../loop/paths';
import { openEngineStore } from '../store/engine-store';
import { ContractBook } from '../graduates/contracts';
import { GraduateLibrary } from '../graduates/library';
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
  /** Errors nobody asked about: a broken event listener, a message that isn't a request. */
  onError?(error: unknown): void;
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
  const graduates = new GraduateLibrary({ store, paths, clock, contracts, deps: options.deps });
  const controller = new RunController({
    versionLock: graduates.lock,
    store,
    paths,
    jobs,
    deps: options.deps,
    clock,
    concurrency: options.concurrency,
    onError,
  });
  const api = createEngineApi({
    store,
    paths,
    jobs,
    controller,
    graduates,
    deps: options.deps,
    clock,
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
      await controller.close();
      options.deps.training?.worker.close();
      store.close();
    },
  };
}
