/**
 * Weight training (decision 033): the dataset built from verified episodes, the pinned recipe in
 * `trainer/`, the worker with its durable job records and compute cap, and the backends that run
 * jobs: Hugging Face Jobs, and a labeled stand-in that never counts as training.
 */
export { ArtifactError, checkOutputs, hashFile } from './artifacts';
export type {
  BackendHandle,
  BackendState,
  BackendStatus,
  BackendSubmission,
  FetchedArtifacts,
  HardwareFlavor,
  Submitted,
  TrainingBackend,
} from './backend';
export {
  authorizeCompute,
  computeUsage,
  costOf,
  type ComputeAuthorization,
  type ComputeUsage,
} from './budget';
export {
  buildTrainingDataset,
  DATASET_MANIFEST_FILE,
  DatasetError,
  EXAMPLES_FILE,
  readTrainingDataset,
  writeTrainingDataset,
  type BuildDatasetOptions,
  type BuiltDataset,
} from './dataset';
export { countsAsRealTraining, describeTrainingJob } from './describe';
export {
  bootstrapScript,
  HF_JOB_FLAVORS,
  HfJobsBackend,
  JOB_TAG,
  type HfJobsBackendOptions,
} from './hf-jobs';
export {
  HF_ENDPOINT,
  HubClient,
  HubError,
  MAX_COMMIT_FILE_BYTES,
  type HubClientOptions,
  type HubErrorCode,
  type JobInfo,
  type JobSpec,
} from './hub';
export {
  buildTrainerJob,
  FINISH_RESERVE_SECONDS,
  JOB_FILE,
  loadRecipe,
  MIN_JOB_SECONDS,
  MIN_TRAINING_SECONDS,
  RECIPE_FILE,
  STARTUP_RESERVE_SECONDS,
  writeTrainerInputs,
  type InputFile,
  type LoadedRecipe,
  type RecipeFile,
  type TrainerJobInput,
} from './recipe';
export { trainingDeps, type TrainingDepsOptions } from './loop-deps';
export { STAND_IN_LABEL, STAND_IN_REVISION, StandInBackend, type StandInOptions } from './stand-in';
export { FileTrainingStore, type TrainingStore } from './store';
export { TrainingWorker, type TrainingRequest, type TrainingWorkerOptions } from './worker';
