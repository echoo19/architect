import type { RunEvent } from '@architect/shared';
import type { EnginePort } from './port';
import {
  ENGINE_ROUTES,
  EventMessageSchema,
  fromErrorPayload,
  ResponseMessageSchema,
  type EngineApi,
  type EngineMethod,
  type EngineParams,
  type EngineResult,
} from './protocol';

export interface EngineClient extends EngineApi {
  /** Stops listening and fails the requests still waiting for an answer. */
  close(): void;
}

interface Pending {
  method: EngineMethod;
  resolve(result: unknown): void;
  reject(error: unknown): void;
}

/**
 * The main process's side of the engine host: the same methods as the API, carried over a
 * port. Results and events are validated before anyone sees them.
 */
export function connectEngine(
  port: EnginePort,
  onError: (error: unknown) => void = (error) => console.error(error),
): EngineClient {
  const pending = new Map<number, Pending>();
  const listeners = new Set<(event: RunEvent) => void>();
  let nextId = 1;
  let closed = false;

  port.onMessage((message) => {
    if (closed) return;
    const event = EventMessageSchema.safeParse(message);
    if (event.success) {
      for (const listener of listeners) listener(event.data.event);
      return;
    }
    const response = ResponseMessageSchema.safeParse(message);
    if (!response.success) {
      onError(new Error(`The engine sent a message that isn't a response or a run event.`));
      return;
    }
    const waiting = pending.get(response.data.id);
    if (!waiting) return;
    pending.delete(response.data.id);
    if (!response.data.ok) {
      waiting.reject(fromErrorPayload(response.data.error));
      return;
    }
    const result = ENGINE_ROUTES[waiting.method].result.safeParse(response.data.result);
    if (result.success) waiting.resolve(result.data);
    else waiting.reject(new Error(`The engine's answer to ${waiting.method} was malformed.`));
  });

  function request<M extends EngineMethod>(
    method: M,
    params: EngineParams<M>,
  ): Promise<EngineResult<M>> {
    if (closed) return Promise.reject(new Error('The connection to the engine is closed.'));
    const id = nextId++;
    return new Promise((resolve, reject) => {
      // The result was parsed with this method's own schema before it gets here.
      pending.set(id, { method, resolve: (result) => resolve(result as EngineResult<M>), reject });
      port.postMessage({ kind: 'request', id, method, params });
    });
  }

  return {
    jobs: {
      list: () => request('jobs.list', []),
      get: (jobId) => request('jobs.get', [jobId]),
      save: (job) => request('jobs.save', [job]),
      createSample: () => request('jobs.createSample', []),
      importFile: (file) => request('jobs.importFile', [file]),
      exportFile: (jobId, file) => request('jobs.exportFile', [jobId, file]),
      draftStart: (description, files) => request('jobs.draftStart', [description, files]),
      draftReply: (sessionId, text) => request('jobs.draftReply', [sessionId, text]),
    },
    runs: {
      start: (jobId, options) => request('runs.start', [jobId, options]),
      pause: (runId) => request('runs.pause', [runId]),
      resume: (runId) => request('runs.resume', [runId]),
      stop: (runId) => request('runs.stop', [runId]),
      retest: (runId, target) => request('runs.retest', [runId, target]),
      get: (runId) => request('runs.get', [runId]),
      list: (jobId) => request('runs.list', [jobId ?? null]),
      trace: (attemptId) => request('runs.trace', [attemptId]),
      roundDiff: (runId, round) => request('runs.roundDiff', [runId, round]),
      onEvent(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    mentoring: {
      lessons: (runId) => request('mentoring.lessons', [runId]),
      lessonTrace: (lessonId) => request('mentoring.lessonTrace', [lessonId]),
      interventions: (runId) => request('mentoring.interventions', [runId]),
      experiments: (runId) => request('mentoring.experiments', [runId]),
      progress: (runId) => request('mentoring.progress', [runId]),
      capabilities: (runId) => request('mentoring.capabilities', [runId]),
      categories: (jobId) => request('mentoring.categories', [jobId]),
      answer: (runId, round, reply) => request('mentoring.answer', [runId, round, reply]),
      reference: (runId, options) => request('mentoring.reference', [runId, options]),
      references: (runId) => request('mentoring.references', [runId]),
    },
    teach: {
      propose: (chatId, messageId, correction) =>
        request('teach.propose', [chatId, messageId, correction]),
      queue: (correctionId) => request('teach.queue', [correctionId]),
      discard: (correctionId) => request('teach.discard', [correctionId]),
      apply: (correctionId) => request('teach.apply', [correctionId]),
      list: (graduateId) => request('teach.list', [graduateId]),
      improve: (graduateId, options) => request('teach.improve', [graduateId, options]),
      improvements: (graduateId) => request('teach.improvements', [graduateId]),
    },
    reports: {
      get: (runId, target) => request('reports.get', [runId, target ?? null]),
      list: (runId) => request('reports.list', [runId]),
    },
    graduates: {
      list: () => request('graduates.list', []),
      accept: (runId) => request('graduates.accept', [runId]),
      versions: (graduateId) => request('graduates.versions', [graduateId]),
      history: (graduateId) => request('graduates.history', [graduateId]),
      report: (graduateId, version) => request('graduates.report', [graduateId, version ?? null]),
      acceptVersion: (graduateId, version) =>
        request('graduates.acceptVersion', [graduateId, version]),
      rejectVersion: (graduateId, version) =>
        request('graduates.rejectVersion', [graduateId, version]),
      promote: (graduateId, version) => request('graduates.promote', [graduateId, version]),
      rollback: (graduateId, version) => request('graduates.rollback', [graduateId, version]),
      installation: (graduateId) => request('graduates.installation', [graduateId]),
      bind: (graduateId, bindRequest) => request('graduates.bind', [graduateId, bindRequest]),
      verify: (graduateId, options) => request('graduates.verify', [graduateId, options ?? {}]),
      reviewExport: (graduateId, version, include) =>
        request('graduates.reviewExport', [graduateId, version ?? null, include ?? []]),
      exportPackage: (graduateId, exportRequest) =>
        request('graduates.exportPackage', [graduateId, exportRequest]),
      exportFolder: (graduateId, directory) =>
        request('graduates.exportFolder', [graduateId, directory]),
      exportPart: (graduateId, partRequest) =>
        request('graduates.exportPart', [graduateId, partRequest]),
      inspectPackage: (path) => request('graduates.inspectPackage', [path]),
      previewImport: (path) => request('graduates.previewImport', [path]),
      importPackage: (path, importRequest) =>
        request('graduates.importPackage', [path, importRequest ?? {}]),
      importFolder: (folder) => request('graduates.importFolder', [folder]),
      installFromHub: (source, installRequest) =>
        request('graduates.installFromHub', [source, installRequest ?? {}]),
      reviewPublication: (graduateId, publishRequest) =>
        request('graduates.reviewPublication', [graduateId, publishRequest]),
      publish: (graduateId, publishRequest) =>
        request('graduates.publish', [graduateId, publishRequest]),
      publications: (graduateId) => request('graduates.publications', [graduateId]),
      remove: (graduateId) => request('graduates.remove', [graduateId]),
      settings: (graduateId) => request('graduates.settings', [graduateId]),
      updateSettings: (graduateId, patch) =>
        request('graduates.updateSettings', [graduateId, patch]),
    },
    close() {
      closed = true;
      for (const waiting of pending.values()) {
        waiting.reject(new Error('The connection to the engine closed.'));
      }
      pending.clear();
      listeners.clear();
    },
  };
}
