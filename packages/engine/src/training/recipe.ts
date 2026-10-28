import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  GuardError,
  TRAINER_JOB_FORMAT,
  TrainerJobSchema,
  TrainerRecipeSchema,
  type DatasetManifest,
  type TrainerJob,
  type TrainerRecipe,
} from '@architect/shared';
import { writeFileAtomic } from '../data/atomic-write';
import { DATASET_MANIFEST_FILE, EXAMPLES_FILE, type BuiltDataset } from './dataset';

export const RECIPE_FILE = 'recipe.json';
export const JOB_FILE = 'job.json';

/** Pulling the image and installing the bootstrap before the trainer's own clock starts. */
export const STARTUP_RESERVE_SECONDS = 10 * 60;
/** What pipeline.py keeps back from training to convert and upload (its RESERVE_SECONDS). */
export const FINISH_RESERVE_SECONDS = 15 * 60;
/** Less training than this isn't worth paying for the setup. */
export const MIN_TRAINING_SECONDS = 10 * 60;
/** The shortest job the provider is asked to run. */
export const MIN_JOB_SECONDS =
  STARTUP_RESERVE_SECONDS + FINISH_RESERVE_SECONDS + MIN_TRAINING_SECONDS;

export interface RecipeFile {
  name: string;
  path: string;
  sha256: string;
  bytes: number;
}

export interface LoadedRecipe {
  recipe: TrainerRecipe;
  /** The hash of recipe.json as it is on disk: the job names its recipe by it. */
  sha256: string;
  /** recipe.json and every script it lists, as the job runs them. */
  files: RecipeFile[];
}

const sha256 = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');

function recipeFile(dir: string, name: string): RecipeFile {
  const path = join(dir, name);
  const bytes = readFileSync(path);
  return { name, path, sha256: sha256(bytes), bytes: statSync(path).size };
}

/** Reads the pinned recipe from the trainer folder and hashes everything a job will run. */
export function loadRecipe(trainerDir: string): LoadedRecipe {
  const text = readFileSync(join(trainerDir, RECIPE_FILE), 'utf8');
  const recipe = TrainerRecipeSchema.parse(JSON.parse(text));
  if (!recipe.files.includes(recipe.entry)) {
    throw new Error(`The recipe's entry ${recipe.entry} is not among its files.`);
  }
  const files = [RECIPE_FILE, ...recipe.files].map((name) => recipeFile(trainerDir, name));
  return { recipe, sha256: sha256(text), files };
}

export interface TrainerJobInput {
  jobId: string;
  recipe: LoadedRecipe;
  baseModel: { repo: string; revision: string };
  dataset: DatasetManifest;
  /** The longest the provider will run the job: the compute budget's authorization. */
  authorizedSeconds: number;
  /** Where the job uploads its outputs, for a backend that has a repository. */
  outputRepo: string | null;
}

/** The job file the trainer reads, carrying every pinned setting from the recipe. */
export function buildTrainerJob(input: TrainerJobInput): TrainerJob {
  if (input.authorizedSeconds < MIN_JOB_SECONDS) {
    throw new GuardError(
      'budget',
      `A training job needs at least ${MIN_JOB_SECONDS / 60} minutes of compute; ${Math.floor(input.authorizedSeconds / 60)} were authorized.`,
    );
  }
  const { recipe } = input.recipe;
  return TrainerJobSchema.parse({
    format: TRAINER_JOB_FORMAT,
    job_id: input.jobId,
    base_model: input.baseModel,
    dataset: {
      manifest: DATASET_MANIFEST_FILE,
      examples: EXAMPLES_FILE,
      sha256: input.dataset.examples_sha256,
      example_count: input.dataset.example_count,
    },
    recipe: { name: recipe.name, version: recipe.version, sha256: input.recipe.sha256 },
    python_packages: recipe.python_packages,
    quantization: recipe.quantization,
    lora: recipe.lora,
    training: recipe.training,
    converter: recipe.converter,
    max_seconds: input.authorizedSeconds - STARTUP_RESERVE_SECONDS,
    output: { repo: input.outputRepo, path_in_repo: 'outputs' },
  });
}

export interface InputFile {
  /** The name in the job's inputs folder. */
  name: string;
  path: string;
  sha256: string;
  bytes: number;
}

/**
 * Lays out a job's inputs in one folder, as the trainer expects them: job.json, the dataset and
 * the recipe's files. Returns every file with its hash, for upload.
 */
export function writeTrainerInputs(
  dir: string,
  job: TrainerJob,
  recipe: LoadedRecipe,
  dataset: BuiltDataset,
): InputFile[] {
  mkdirSync(dir, { recursive: true });
  writeFileAtomic(join(dir, JOB_FILE), `${JSON.stringify(job, null, 2)}\n`);
  writeFileAtomic(join(dir, EXAMPLES_FILE), dataset.jsonl);
  writeFileAtomic(
    join(dir, DATASET_MANIFEST_FILE),
    `${JSON.stringify(dataset.manifest, null, 2)}\n`,
  );
  for (const file of recipe.files) copyFileSync(file.path, join(dir, file.name));
  const names = [
    JOB_FILE,
    DATASET_MANIFEST_FILE,
    EXAMPLES_FILE,
    ...recipe.files.map((file) => file.name),
  ];
  return names.map((name) => {
    const path = join(dir, name);
    return { name, path, sha256: sha256(readFileSync(path)), bytes: statSync(path).size };
  });
}
