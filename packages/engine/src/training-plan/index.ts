/**
 * Planning a training job for a cluster (docs/SCALE.md, decision 072): the memory a model needs,
 * counted from its config.json, the GPUs and nodes it fits on, and launch bundles for Slurm,
 * Kubernetes and SkyPilot that the user submits with their own tools. Experimental: nothing here has run on a
 * cluster.
 */
export { fetchModelConfig, parseModelConfig } from './config';
export { SizingError, sizeModel } from './size';
export { bundleFromRequest, planFromRequest, readModelConfig } from './requests';
export {
  describePlan,
  gb,
  GB,
  GPU_TYPES,
  HEADROOM_FRACTION,
  NF4_BYTES,
  params,
  planTraining,
  RUNTIME_BYTES,
  type TrainingPlanInput,
} from './plan';
export {
  BUNDLE_CLAIM,
  BUNDLE_FILE,
  BundleError,
  LORA_TARGETS,
  PYTORCHJOB_FILE,
  SBATCH_FILE,
  SKYPILOT_CLUSTER,
  SKYPILOT_FILE,
  skyAccelerator,
  TRAINER_SCRIPT,
  writeTrainBundle,
  type BundleInput,
  type WrittenBundle,
} from './bundle';
