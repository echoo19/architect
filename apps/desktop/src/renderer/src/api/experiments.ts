import { useEffect } from 'react';
import {
  ExperimentDetailSchema,
  ExperimentEventSchema,
  ExperimentRecordSchema,
  type ExperimentInput,
  type ExperimentStart,
} from '@architect/shared';
import { z } from 'zod';
import { architect, read } from './client';
import { useQuery } from './query';

/**
 * Experiments through the engine (decision 074): plans, preregistration, runs and their reports,
 * each reply parsed before a screen trusts it.
 */
export const experimentsApi = {
  list: () =>
    read('experiments.list', z.array(ExperimentRecordSchema), architect().experiments.list()),
  get: (id: string) =>
    read('experiments.get', ExperimentDetailSchema, architect().experiments.get(id)),
  plan: (input: ExperimentInput) =>
    read('experiments.plan', ExperimentDetailSchema, architect().experiments.plan(input)),
  revise: (id: string, input: ExperimentInput) =>
    read('experiments.revise', ExperimentDetailSchema, architect().experiments.revise(id, input)),
  calibrate: (id: string) =>
    read('experiments.calibrate', ExperimentRecordSchema, architect().experiments.calibrate(id)),
  preregister: (id: string) =>
    read(
      'experiments.preregister',
      ExperimentRecordSchema,
      architect().experiments.preregister(id),
    ),
  start: (id: string, options: ExperimentStart) =>
    read('experiments.start', ExperimentRecordSchema, architect().experiments.start(id, options)),
  resume: (id: string, options: ExperimentStart) =>
    read('experiments.resume', ExperimentRecordSchema, architect().experiments.resume(id, options)),
  pause: (id: string) =>
    read('experiments.pause', ExperimentRecordSchema, architect().experiments.pause(id)),
  stop: (id: string) =>
    read('experiments.stop', ExperimentRecordSchema, architect().experiments.stop(id)),
};

export const experimentKeys = {
  list: 'experiments',
  detail: (id: string) => `experiment:${id}`,
};

/** An arm's rounds and its record move together; one read follows them all. */
const SETTLE_MS = 150;

/** Reads again whenever the engine says an experiment moved: `id` for one, any for the list. */
function useReloadOnEvent(reload: () => void, id?: string) {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const stop = architect().experiments.onEvent((payload) => {
      const event = ExperimentEventSchema.safeParse(payload);
      if (!event.success || (id !== undefined && event.data.experimentId !== id)) return;
      clearTimeout(timer);
      timer = setTimeout(reload, SETTLE_MS);
    });
    return () => {
      clearTimeout(timer);
      stop();
    };
  }, [reload, id]);
}

/** Every experiment, newest first, read again as any of them moves. */
export function useExperiments() {
  const query = useQuery(experimentKeys.list, experimentsApi.list, { refreshOnMount: true });
  useReloadOnEvent(query.reload);
  return query;
}

/** One experiment with its projection and report, read again as it moves. */
export function useExperiment(id: string) {
  const query = useQuery(experimentKeys.detail(id), () => experimentsApi.get(id), {
    refreshOnMount: true,
  });
  useReloadOnEvent(query.reload, id);
  return query;
}
