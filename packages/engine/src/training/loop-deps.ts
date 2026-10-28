import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrainerOutputSchema, type TrainingJobRecord } from '@architect/shared';
import type { TrainingDeps } from '../loop/deps';
import type { TrainingBackend } from './backend';
import type { TrainingStore } from './store';
import type { TrainingWorker } from './worker';

export interface TrainingDepsOptions {
  worker: TrainingWorker;
  store: TrainingStore;
  /** The backend new jobs go to now, or null when none is set up. */
  backend(): Promise<TrainingBackend | null>;
  /** The base model on the Hub that adapters are trained on. */
  baseModel: { repo: string; revision?: string };
  /** The hardware the recipe asks for, whose price a compute estimate is checked at. */
  flavor: string;
  /** Where each run's round datasets are written: `<dir>/<runId>/round-<n>`. */
  datasetsDir: string;
}

/**
 * What the loop needs from weight training, over a worker and its records: the backend a job
 * goes to and its price, where datasets go, and where a ready job's adapter and output manifest
 * are.
 */
export function trainingDeps(options: TrainingDepsOptions): TrainingDeps {
  const { worker, store } = options;
  const manifestOf = (record: TrainingJobRecord) => {
    if (record.state !== 'ready' || record.artifacts === null) return null;
    const file = join(store.jobDir(record.id), 'artifacts', 'manifest.json');
    return TrainerOutputSchema.parse(JSON.parse(readFileSync(file, 'utf8')));
  };
  return {
    worker,
    backend: async () => {
      const backend = await options.backend();
      if (backend === null) return null;
      const flavor = backend.flavor(options.flavor);
      // A hardware price nobody knows can't be held to a cap; the worker refuses such a job too.
      if (flavor === null) return null;
      return { kind: backend.kind, real: backend.real, pricePerHourUsd: flavor.pricePerHourUsd };
    },
    baseModel: options.baseModel,
    datasetDir: (runId, round) => join(options.datasetsDir, runId, `round-${round}`),
    adapterPath: (record) => {
      if (record.artifacts === null)
        throw new Error(`Training job ${record.id} has no adapter yet.`);
      return join(store.jobDir(record.id), ...record.artifacts.ggufLora.split('/'));
    },
    trainedTokens: (record) => manifestOf(record)?.dataset.trained_tokens ?? 0,
  };
}
