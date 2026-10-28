import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GLIMMER_TRAINING_BASE } from '@architect/shared';
import { bufferSource, encodeGguf, parseGgufHeader } from '../../src/gguf';
import {
  FileTrainingStore,
  loadRecipe,
  StandInBackend,
  trainingDeps,
  TrainingWorker,
} from '../../src/training';
import type { World } from '../fakes/world';
import { tinyBaseSpec } from './gguf';

/** The repository's own trainer folder: the recipe the worker pins. */
export const TRAINER_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  '..',
  'trainer',
);

const BASE = parseGgufHeader(bufferSource(encodeGguf(tinyBaseSpec({ blocks: 2 }))));

export interface TrainingWorld {
  worker: TrainingWorker;
  store: FileTrainingStore;
}

/**
 * Gives the world a training worker over its data folder with the stand-in backend, which
 * trains nothing and runs on the world's clock. Call it again, as an engine restart would, for a
 * new worker over the same records.
 */
export function withStandInTraining(
  world: World,
  options: { runMs?: number; failWith?: string } = {},
): TrainingWorld {
  const store = new FileTrainingStore(world.dataDir);
  const backend = new StandInBackend({
    stateDir: join(world.dataDir, 'training', 'stand-in'),
    baseHeader: () => BASE,
    now: () => world.clock.now(),
    queueMs: 0,
    runMs: options.runMs ?? 0,
    ...(options.failWith === undefined ? {} : { failWith: options.failWith }),
  });
  const worker = new TrainingWorker({
    store,
    backends: { 'stand-in': backend },
    trainerDir: TRAINER_DIR,
    now: () => world.clock.now(),
    watch: false,
  });
  world.deps.training = trainingDeps({
    worker,
    store,
    backend: async () => backend,
    baseModel: { repo: GLIMMER_TRAINING_BASE.repo },
    flavor: loadRecipe(TRAINER_DIR).recipe.hardware.flavor,
    datasetsDir: join(world.dataDir, 'training', 'datasets'),
  });
  return { worker, store };
}
