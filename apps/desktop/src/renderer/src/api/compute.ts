import {
  ModelConfigReadSchema,
  QualificationSchema,
  TrainingPlanSchema,
  WrittenTrainBundleSchema,
  type ModelConfigSource,
  type QualifyRequest,
  type TrainBundleRequest,
  type TrainingPlanRequest,
} from '@architect/shared';
import { z } from 'zod';
import { architect, read } from './client';

/**
 * Training plans and cluster bundles through the engine (decision 072), each reply parsed before
 * the screen trusts it. Reading a config from the Hub is the only call that leaves the computer.
 */
export const computeApi = {
  readConfig: (source: ModelConfigSource) =>
    read('compute.readConfig', ModelConfigReadSchema, architect().compute.readConfig(source)),
  plan: (request: TrainingPlanRequest) =>
    read('compute.plan', TrainingPlanSchema, architect().compute.plan(request)),
  bundle: (request: TrainBundleRequest) =>
    read('compute.bundle', WrittenTrainBundleSchema, architect().compute.bundle(request)),
  /** Tests a finished run's frozen harness with a model served on this computer. */
  qualify: (request: QualifyRequest) =>
    read('runs.qualify', QualificationSchema, architect().runs.qualify(request)),
  qualifications: (jobId: string) =>
    read(
      'runs.qualifications',
      z.array(QualificationSchema),
      architect().runs.qualifications(jobId),
    ),
};
