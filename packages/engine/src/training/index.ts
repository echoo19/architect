/**
 * Weight training (decision 033): the dataset built from verified episodes, the pinned recipe in
 * `trainer/`, the worker with its durable job records and compute cap, and the backends that run
 * jobs: Hugging Face Jobs, and a labeled stand-in that never counts as training.
 */
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
