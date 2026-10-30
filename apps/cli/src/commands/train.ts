import { readFileSync } from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  BundleError,
  describePlan,
  fetchModelConfig,
  GPU_TYPES,
  parseModelConfig,
  planTraining,
  SizingError,
  writeTrainBundle,
} from '@architect/engine/training-plan';
import {
  ClusterTargetSchema,
  TRAIN_BUNDLE_FORMAT,
  TRAINING_PLAN_FORMAT,
  TrainMethodSchema,
  TrainPrecisionSchema,
  type CliOutcome,
  type TrainingPlan,
} from '@architect/shared';
import { countOption, flag, stringOption, type Parsed, type Values } from '../args';
import type { CliContext } from '../context';
import { CliError } from '../exit';
import { line, printJson } from '../render';

const here = fileURLToPath(import.meta.url);

/**
 * The repository's trainer folder: three folders above the bundled command (the app's resources),
 * four above this source file, or wherever ARCHITECT_TRAINER_DIR says.
 */
function trainerDir(env: NodeJS.ProcessEnv): string {
  const set = env['ARCHITECT_TRAINER_DIR'];
  if (set) return set;
  const up = extname(here) === '.mjs' ? ['..', '..', '..'] : ['..', '..', '..', '..'];
  return join(dirname(here), ...up, 'trainer');
}

function choice<T extends string>(
  values: Values,
  name: string,
  schema: { options: readonly T[]; safeParse(value: unknown): { success: boolean; data?: T } },
  fallback: T,
): T {
  const text = stringOption(values, name);
  if (text === undefined) return fallback;
  const parsed = schema.safeParse(text);
  if (!parsed.success || parsed.data === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      `--${name} takes ${schema.options.join(', ')}, not "${text}".`,
    );
  }
  return parsed.data;
}

function gpuOf(values: Values): { name: string; memoryGb: number } {
  const memory = stringOption(values, 'gpu-memory');
  if (memory !== undefined) {
    const memoryGb = Number(memory);
    if (!Number.isFinite(memoryGb) || memoryGb <= 0) {
      throw new CliError('invalid_input', 'usage', `--gpu-memory takes GB, not "${memory}".`);
    }
    return { name: stringOption(values, 'gpu') ?? `${memoryGb} GB GPU`, memoryGb };
  }
  const name = stringOption(values, 'gpu') ?? 'h100-80gb';
  const memoryGb = GPU_TYPES[name];
  if (memoryGb === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      `Architect doesn't know the GPU "${name}".`,
      `Use one of ${Object.keys(GPU_TYPES).join(', ')}, or give its memory with --gpu-memory <GB>.`,
    );
  }
  return { name, memoryGb };
}

async function plan(ctx: CliContext, values: Values, signal: AbortSignal): Promise<TrainingPlan> {
  const repo = stringOption(values, 'model');
  const revision = stringOption(values, 'revision');
  const configPath = stringOption(values, 'config');
  let model: { repo: string | null; revision: string | null };
  let config;
  if (configPath !== undefined) {
    const path = ctx.path(configPath);
    let text: string;
    try {
      text = readFileSync(path, 'utf8');
    } catch {
      throw new CliError('invalid_input', 'not_found', `Can't read ${path}.`);
    }
    config = parseModelConfig(text, path);
    model = { repo: repo ?? null, revision: revision ?? null };
  } else {
    if (repo === undefined) {
      throw new CliError(
        'invalid_input',
        'usage',
        'Name the model with --model owner/name, or give its config.json with --config.',
      );
    }
    const fetched = await fetchModelConfig(ctx.hub(), repo, revision ?? 'main', signal);
    config = fetched.config;
    model = { repo, revision: fetched.revision };
  }
  return planTraining(config, {
    model,
    method: choice(values, 'method', TrainMethodSchema, 'lora'),
    precision: choice(values, 'precision', TrainPrecisionSchema, 'bf16'),
    gpu: gpuOf(values),
    seqLen: countOption(values, 'seq-len') ?? 4096,
    microBatch: countOption(values, 'micro-batch') ?? 1,
    gpusPerNode: countOption(values, 'gpus-per-node') ?? 8,
    loraRank: countOption(values, 'lora-rank') ?? 16,
  });
}

/**
 * `architect train plan`: sizes a training job from the model's config.json, each memory term
 * with its arithmetic. `architect train bundle`: writes the launch bundle for Slurm or
 * Kubernetes and prints the command that submits it. Neither submits anything or holds a
 * credential; the bundles are experimental and have not run on a cluster.
 */
export async function train(
  ctx: CliContext,
  parsed: Parsed,
  signal: AbortSignal,
): Promise<CliOutcome> {
  const { io } = ctx;
  const { values } = parsed;
  const action = parsed.args[0];
  if (action !== 'plan' && action !== 'bundle') {
    throw new CliError(
      'invalid_input',
      'usage',
      `architect train takes plan or bundle, not "${action ?? ''}".`,
    );
  }
  try {
    const sized = await plan(ctx, values, signal);
    if (action === 'plan') {
      if (flag(values, 'json')) {
        const { format: _format, ...body } = sized;
        printJson(io.stdout, TRAINING_PLAN_FORMAT, body);
      } else {
        for (const text of describePlan(sized)) line(io.stdout, text);
      }
      return 'succeeded';
    }

    const target = stringOption(values, 'target');
    if (target === undefined) {
      throw new CliError(
        'invalid_input',
        'usage',
        'Say where it runs with --target slurm|kubernetes.',
      );
    }
    const output = stringOption(values, 'output');
    if (output === undefined) {
      throw new CliError('invalid_input', 'usage', 'Say where to write it with --output <folder>.');
    }
    const exportDir = stringOption(values, 'export');
    const written = writeTrainBundle({
      target: choice(values, 'target', ClusterTargetSchema, 'slurm'),
      plan: sized,
      trainerDir: trainerDir(io.env),
      exportDir: exportDir === undefined ? null : ctx.path(exportDir),
      outputDir: ctx.path(output),
    });
    if (flag(values, 'json')) {
      const { format: _format, ...body } = written.bundle;
      printJson(io.stdout, TRAIN_BUNDLE_FORMAT, {
        ...body,
        dir: written.dir,
        files: written.files,
      });
    } else {
      line(io.stdout, `Wrote the bundle to ${written.dir} (${written.files.length} files).`);
      line(
        io.stdout,
        'EXPERIMENTAL, NOT RUN. Architect never submits it and holds no credentials.',
      );
      line(io.stdout, `Submit it from that folder with your own tools: ${written.bundle.submit}`);
      line(io.stdout, 'README.txt in the folder has the steps before that.');
    }
    return 'succeeded';
  } catch (error) {
    if (error instanceof SizingError || error instanceof BundleError) {
      throw new CliError(
        'invalid_input',
        error instanceof SizingError ? 'unsizable' : 'bundle',
        error.message,
      );
    }
    throw error;
  }
}
