import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  describeTrainingJob,
  FileTrainingStore,
  HF_JOB_FLAVORS,
  HfJobsBackend,
  loadRecipe,
  TrainingWorker,
  writeTrainingDataset,
} from '@architect/engine';
import { fieldDataset, FieldDatasetError } from '@architect/engine/field';
import { findHubToken, hubTokenResolver } from '@architect/engine/hub';
import {
  GLIMMER_TRAINING_BASE,
  TERMINAL_TRAINING_STATES,
  TrainerOutputSchema,
  type CliOutcome,
  type TrainingJobRecord,
} from '@architect/shared';
import { countOption, flag, stringOption, type Parsed } from '../args';
import type { CliContext } from '../context';
import { CliError, TOKEN_HINT } from '../exit';
import { bytes, line, printJson } from '../render';
import { trainerDir } from '../trainer';

const JOB_FORMAT = 'architect.training-job/1';
const usd = (amount: number) => `$${amount.toFixed(2)}`;
/** Between checks of a job with --wait, as the app's own worker checks. */
const WAIT_MS = 30_000;

/** The training worker on the app's data folder, its jobs going to Hugging Face Jobs. */
function worker(ctx: CliContext): TrainingWorker {
  const dir = trainerDir(ctx.io.env);
  const token = hubTokenResolver({ env: ctx.io.env });
  return new TrainingWorker({
    store: new FileTrainingStore(ctx.dataDir),
    backends: { 'hf-jobs': new HfJobsBackend({ hub: ctx.hub(), recipe: loadRecipe(dir), token }) },
    trainerDir: dir,
    watch: false,
  });
}

function jobOf(training: TrainingWorker, id: string | undefined): TrainingJobRecord {
  if (id === undefined) {
    throw new CliError('invalid_input', 'usage', 'Name the training job, such as trn_….');
  }
  try {
    return training.get(id);
  } catch {
    throw new CliError(
      'invalid_input',
      'not_found',
      `There is no training job ${id} here.`,
      'Training jobs are kept in the data folder they were started from (ARCHITECT_USER_DATA).',
    );
  }
}

function dollars(values: Parsed['values']): number {
  const text = stringOption(values, 'max-usd');
  const usd = Number(text);
  if (text === undefined || !Number.isFinite(usd) || usd <= 0) {
    throw new CliError(
      'invalid_input',
      'usage',
      'Say the most training may spend with --max-usd <dollars>.',
      'It is a hard cap: a job is cut to what is left of it, and the provider stops the job there.',
    );
  }
  return usd;
}

/** What a job is, how far it got and what it cost, and its adapter once it is ready. */
function describe(ctx: CliContext, record: TrainingJobRecord): void {
  const { stdout } = ctx.io;
  line(stdout, `${record.id}: ${describeTrainingJob(record)}`);
  line(stdout, `Base: ${record.baseModel.repo} at ${record.baseModel.revision}.`);
  if (record.providerUrl !== null) line(stdout, `Job: ${record.providerUrl}`);
  if (record.artifacts === null) return;
  const dir = join(ctx.dataDir, 'training', 'jobs', record.id);
  const adapter = record.artifacts.files.find((file) => file.kind === 'gguf_lora');
  if (adapter !== undefined) {
    line(
      stdout,
      `Adapter: ${join(dir, ...adapter.path.split('/'))} (${bytes(adapter.bytes)}, sha256 ${adapter.sha256}).`,
    );
  }
  const manifest = TrainerOutputSchema.parse(
    JSON.parse(readFileSync(join(dir, 'artifacts', 'manifest.json'), 'utf8')),
  );
  const { metrics, dataset } = manifest;
  const loss =
    metrics.loss_first === null || metrics.loss_last === null
      ? 'no loss logged'
      : `loss ${metrics.loss_first.toFixed(3)} to ${metrics.loss_last.toFixed(3)}`;
  line(
    stdout,
    `Trained ${dataset.trained_examples} of ${dataset.example_count} examples (${dataset.trained_tokens} target tokens, ${dataset.skipped.length} skipped) in ${metrics.steps} steps, ${loss}, ${Math.round(metrics.train_seconds / 60)} min.`,
  );
}

function print(ctx: CliContext, values: Parsed['values'], record: TrainingJobRecord): void {
  if (flag(values, 'json')) {
    const { format: _format, ...body } = record;
    printJson(ctx.io.stdout, JOB_FORMAT, body);
  } else {
    describe(ctx, record);
  }
}

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

/**
 * `architect train start`: trains an adapter for a field's student on its demonstrations, on
 * Hugging Face Jobs, with the pinned recipe (decision 101). The demonstrations are built here by
 * the exporter itself, from the job's records in the data folder, never read from a folder a
 * caller hands it. The job's record goes in the same data folder, written before the Hub hears of
 * it.
 */
async function start(ctx: CliContext, parsed: Parsed, signal: AbortSignal): Promise<CliOutcome> {
  const { values } = parsed;
  if (stringOption(values, 'export') !== undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      "architect train start doesn't take --export: it builds what it sends from the job itself.",
      'Name the job instead: architect train start <job> --max-usd <dollars>.',
    );
  }
  const name = parsed.args[1];
  if (name === undefined) {
    throw new CliError(
      'invalid_input',
      'usage',
      'Name the field job to train on, by its id or name.',
    );
  }
  const maxComputeUsd = dollars(values);
  const maxMinutes = countOption(values, 'max-minutes');
  const flavor = stringOption(values, 'flavor');
  if (flavor !== undefined && !HF_JOB_FLAVORS.some((known) => known.id === flavor)) {
    throw new CliError(
      'invalid_input',
      'usage',
      `--flavor takes ${HF_JOB_FLAVORS.map((known) => known.id).join(' or ')}, not "${flavor}".`,
      'Architect trains only on hardware whose price it knows, so the compute cap holds.',
    );
  }
  let built;
  try {
    built = await fieldDataset(ctx.dataDir, name);
  } catch (error) {
    if (error instanceof FieldDatasetError) {
      throw new CliError('invalid_input', 'no_demonstrations', error.message);
    }
    throw error;
  }
  if (!(await findHubToken({ env: ctx.io.env }))) {
    throw new CliError(
      'not_permitted',
      'no_token',
      'There is no Hugging Face token on this computer.',
      TOKEN_HINT,
    );
  }
  const { dataset, manifest } = built;
  const datasetDir = join(
    ctx.dataDir,
    'training',
    'datasets',
    `field-${manifest.job.id}-${dataset.manifest.examples_sha256.slice(0, 12)}`,
  );
  writeTrainingDataset(datasetDir, dataset);
  const revision = stringOption(values, 'revision');
  const training = worker(ctx);
  const record = await training.submit(
    {
      scope: `field:${manifest.job.id}`,
      maxComputeUsd,
      backend: 'hf-jobs',
      datasetDir,
      baseModel: {
        repo: GLIMMER_TRAINING_BASE.repo,
        ...(revision === undefined ? {} : { revision }),
      },
      ...(maxMinutes === undefined ? {} : { maxSeconds: maxMinutes * 60 }),
      ...(flavor === undefined ? {} : { flavor }),
    },
    signal,
  );
  if (flag(values, 'json')) {
    print(ctx, values, record);
    return 'succeeded';
  }
  const { compute } = record;
  line(
    ctx.io.stdout,
    `Sent ${record.dataset.exampleCount} demonstrations of ${manifest.job.name} to ${record.label} as ${record.id}.`,
  );
  line(
    ctx.io.stdout,
    `It runs on ${compute.flavor} at ${usd(compute.pricePerHourUsd)} an hour and stops by itself after ${Math.floor(compute.authorizedSeconds / 60)} minutes, ${usd(compute.authorizedUsd)} at most.`,
  );
  describe(ctx, record);
  line(ctx.io.stdout, `Check on it with: architect train status ${record.id} --wait`);
  return 'succeeded';
}

/** `architect train status`: checks a job once, or until it ends, and downloads its adapter. */
async function status(ctx: CliContext, parsed: Parsed, signal: AbortSignal): Promise<CliOutcome> {
  const { values } = parsed;
  const training = worker(ctx);
  let record = jobOf(training, parsed.args[1]);
  let said = '';
  for (;;) {
    record = await training.poll(record.id, signal);
    if (flag(values, 'wait') && !flag(values, 'json') && record.state !== said) {
      line(ctx.io.stderr, `${new Date().toISOString()} ${record.state}`);
      said = record.state;
    }
    if (!flag(values, 'wait') || TERMINAL_TRAINING_STATES.has(record.state)) break;
    await pause(WAIT_MS, signal);
    if (signal.aborted) return 'cancelled';
  }
  if (flag(values, 'logs')) ctx.io.stdout.write(await training.logs(record.id, signal));
  print(ctx, values, record);
  return record.state === 'failed' ? 'runtime_error' : 'succeeded';
}

/** `architect train cancel`: asks the provider to stop a job. */
async function cancel(ctx: CliContext, parsed: Parsed, signal: AbortSignal): Promise<CliOutcome> {
  const training = worker(ctx);
  const record = await training.cancel(jobOf(training, parsed.args[1]).id, signal);
  print(ctx, parsed.values, record);
  return 'succeeded';
}

export const TRAINING_JOB_ACTIONS = { start, status, cancel } as const;
