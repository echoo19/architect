import { useEffect } from 'react';
import {
  WspComputeTargetSchema,
  WspEventSchema,
  WspExperimentSchema,
  WspExportSchema,
  WspMentorStatusSchema,
  WspModelSchema,
  WspWorkerStatusSchema,
  type WspBrief,
  type WspDraftInput,
  type WspExperiment,
} from '@architect/shared';
import { z } from 'zod';
import { architect, read } from './client';
import { setQueryData, useQuery } from './query';

/**
 * Architect WSP through the engine (decision 109): models, compute, the worker, the mentor and
 * experiments, each reply parsed before a screen trusts it.
 */
export const wspApi = {
  models: () => read('wsp.models', z.array(WspModelSchema), architect().wsp.models()),
  inspectModel: (folder: string) =>
    read('wsp.inspectModel', WspModelSchema, architect().wsp.inspectModel(folder)),
  computeTargets: () =>
    read('wsp.computeTargets', z.array(WspComputeTargetSchema), architect().wsp.computeTargets()),
  worker: () => read('wsp.worker', WspWorkerStatusSchema, architect().wsp.worker()),
  setupWorker: () => read('wsp.setupWorker', WspWorkerStatusSchema, architect().wsp.setupWorker()),
  mentor: () => read('wsp.mentor', WspMentorStatusSchema, architect().wsp.mentor()),
  draft: (input: WspDraftInput) =>
    read('wsp.draft', WspExperimentSchema, architect().wsp.draft(input)),
  redraft: (id: string) => read('wsp.redraft', WspExperimentSchema, architect().wsp.redraft(id)),
  revise: (id: string, brief: WspBrief, title: string) =>
    read('wsp.revise', WspExperimentSchema, architect().wsp.revise(id, brief, title)),
  start: (id: string) => read('wsp.start', WspExperimentSchema, architect().wsp.start(id)),
  cancel: (id: string) => read('wsp.cancel', WspExperimentSchema, architect().wsp.cancel(id)),
  resume: (id: string) => read('wsp.resume', WspExperimentSchema, architect().wsp.resume(id)),
  qualify: (id: string) => read('wsp.qualify', WspExperimentSchema, architect().wsp.qualify(id)),
  exportCandidate: (id: string, parentDir: string) =>
    read('wsp.exportCandidate', WspExportSchema, architect().wsp.exportCandidate(id, parentDir)),
  program: (id: string, n: number) =>
    read('wsp.program', z.string(), architect().wsp.program(id, n)),
  list: () => read('wsp.list', z.array(WspExperimentSchema), architect().wsp.list()),
  get: (id: string) => read('wsp.get', WspExperimentSchema, architect().wsp.get(id)),
};

export const wspKeys = {
  list: 'wsp.experiments',
  detail: (id: string) => `wsp.experiment:${id}`,
  models: 'wsp.models',
  compute: 'wsp.compute',
  worker: 'wsp.worker',
  mentor: 'wsp.mentor',
  program: (id: string, n: number) => `wsp.program:${id}:${n}`,
};

/** A program's records and its experiment's move together; one read follows them all. */
const SETTLE_MS = 150;

/** Reads again whenever the engine says an experiment moved: `id` for one, any for the rest. */
function useReloadOnEvent(reload: () => void, id?: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = architect().wsp.onEvent((payload) => {
      const event = WspEventSchema.safeParse(payload);
      if (id !== undefined && (!event.success || event.data.experimentId !== id)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [reload, id]);
}

/** Keeps what a write returned, so the experiment's screen shows it at once. */
export function keepExperiment(experiment: WspExperiment): WspExperiment {
  setQueryData(wspKeys.detail(experiment.id), experiment);
  return experiment;
}

/** Every experiment, newest first, read again as any of them moves. */
export function useWspExperiments() {
  const query = useQuery(wspKeys.list, wspApi.list, { refreshOnMount: true });
  useReloadOnEvent(query.reload);
  return query;
}

/** One experiment, read again as it moves. */
export function useWspExperiment(id: string) {
  const query = useQuery(wspKeys.detail(id), () => wspApi.get(id), { refreshOnMount: true });
  useReloadOnEvent(query.reload, id);
  return query;
}

export function useWspModels() {
  return useQuery(wspKeys.models, wspApi.models, { refreshOnMount: true });
}

export function useWspComputeTargets() {
  return useQuery(wspKeys.compute, wspApi.computeTargets);
}

/** What the engine's event names when the worker's setup ends, in place of an experiment. */
const WORKER_EVENT = 'wsp-worker';

/** The worker's environment, read again when its setup ends. */
export function useWspWorker() {
  const query = useQuery(wspKeys.worker, wspApi.worker, { refreshOnMount: true });
  useReloadOnEvent(query.reload, WORKER_EVENT);
  return query;
}

export function useWspMentor() {
  return useQuery(wspKeys.mentor, wspApi.mentor, { refreshOnMount: true });
}

export function useWspProgram(id: string, n: number) {
  return useQuery(wspKeys.program(id, n), () => wspApi.program(id, n));
}
