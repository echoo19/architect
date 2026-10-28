import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLlamaCppStudent } from '@architect/adapters';
import {
  GLIMMER_TRAINING_BASE,
  HarnessSchema,
  TRAINER_OUTPUT_FORMAT,
  TrainerJobSchema,
  TrainerOutputSchema,
  type BackendId,
  type Harness,
  type Job,
  type RuntimeIdentity,
  type SplitConfig,
  type StudentAdapter,
  type Task,
} from '@architect/shared';
import { float32Bytes, encodeGguf } from '../../src/gguf';
import { LocalAdapterRuntime } from '../../src/local-runtime';
import type {
  AdapterServeRequest,
  Clock,
  EngineHostDeps,
  Evaluation,
  EvaluationContext,
  EvaluationOptions,
  RuntimeMeter,
} from '../../src/loop/deps';
import { splitTasks } from '../../src/splits/split';
import {
  checkOutputs,
  FileTrainingStore,
  hashFile,
  loadRecipe,
  trainingDeps,
  TrainingWorker,
  type BackendHandle,
  type BackendSubmission,
  type FetchedArtifacts,
  type HardwareFlavor,
  type Submitted,
  type TrainingBackend,
} from '../../src/training';
import { JOB_FILE } from '../../src/training/recipe';
import type { ComparisonEnvironment } from '../../src/comparisons';
import { diagnosis, FakeActor, FakeMentor, FakeStudent, hypothesis } from '../fakes/adapters';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  FileVersions,
  harnessToFiles,
  readPackaged,
  templateHarness,
} from '../fakes/harness';
import { FakeRuntime, FakeVault } from '../fakes/runtime';
import { fakeLlamaCommand, storeBase } from './adapter-runtime';
import { TRAINER_DIR } from './training-world';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
/** The returns desk as it ships: its tasks, data and checker, read-only. */
export const RETURNS_DESK = join(REPO, 'examples', 'gear-returns', 'job');
/** Home services, the regression check's job. */
export const HOME_SERVICES = join(REPO, 'examples', 'home-services', 'job');

/** A number in [0, 1) fixed by its parts, so every fake outcome is the same on every run. */
function chance(...parts: readonly (string | number)[]): number {
  return createHash('sha256').update(parts.join('|')).digest().readUInt32BE(0) / 2 ** 32;
}

/** How often each type passes with a blank harness: about what bare Glimmer did on Oct 28. */
const BASE_RATE: Record<string, number> = {
  refund: 0.82,
  order: 0.72,
  pickup: 0.62,
  invoice: 0.7,
  overdue: 0.9,
  schedule: 0.8,
};

/**
 * The fake runtime of a comparison's dry run: the real splitter, so the returns desk splits as it
 * ships, and a pass rule fixed by each task, seed, harness and adapter, so arms differ the way a
 * comparison's arms might, paired outcomes correlate, and every run gives the same report.
 * Attempts cost what a hosted Glimmer attempt costs, so the projections look like real ones.
 */
export class DryRunRuntime extends FakeRuntime {
  /** Failed train attempts since the mentor last asked, in the order they failed. */
  private trainFailures: string[] = [];
  private trainIds = new Set<string>();

  constructor() {
    super();
    this.askStudent = true;
    this.passes = (task, harness, seed, student) => {
      if (student.includes('spark')) return chance(task.id, seed, 'spark') < 0.96;
      let rate = BASE_RATE[task.type] ?? 0.7;
      if (harness.system.includes(`fix:${task.type}`)) rate += 0.22;
      if (/@1\b/.test(student)) rate += 0.08;
      if (this.trainIds.has(task.id)) rate = Math.min(rate, 0.55);
      const draw =
        0.7 * chance(task.id, seed) + 0.3 * chance(task.id, seed, harness.system, student);
      return draw < Math.min(rate, 0.98);
    };
  }

  override splitTasks(tasks: Task[], config?: SplitConfig) {
    const splits = splitTasks(
      tasks,
      config ?? { seed: 0, calibration: 0, train: 1, dev: 1, test: 1 },
    );
    for (const task of splits.train) this.trainIds.add(task.id);
    return splits;
  }

  /** Each task in turn, each reported as it finishes, as the real runtime reports them. */
  override async evaluateTasks(
    tasks: Task[],
    ctx: EvaluationContext,
    options: EvaluationOptions,
  ): Promise<Evaluation> {
    const items: Evaluation['items'] = [];
    for (const task of tasks) {
      const [item] = (await super.evaluateTasks([task], ctx, options)).items;
      if (item === undefined) continue;
      const { trace } = item.result;
      // A hosted attempt of the returns desk reads about 30,000 tokens and writes 800.
      for (const step of trace.steps) {
        if (step.kind === 'model') step.usage = { inputTokens: 15_000, outputTokens: 400 };
      }
      trace.usage = { inputTokens: 30_000, outputTokens: 800 };
      if (this.trainIds.has(item.task.id) && !item.result.check.pass) {
        this.trainFailures.push(item.task.id);
      }
      items.push(item);
      options.onAttempt?.(item);
    }
    const pass = items.filter((item) => item.result.check.pass).length;
    return { items, score: { pass, total: items.length }, perType: [] };
  }

  /** The train attempts that failed since the last call, up to `count`, for the mentor's findings. */
  takeTrainFailures(count: number): string[] {
    const taken = [...new Set(this.trainFailures)].slice(-count);
    this.trainFailures = [];
    return taken;
  }
}

/**
 * A training backend for dry runs that trains nothing and says so in its label, but hands back
 * an adapter without the stand-in's label, shaped for the tiny base in the fake Ollama store, so
 * a kept adapter can go through freezing and packaging as a real one would.
 */
export class DryRunTrainer implements TrainingBackend {
  readonly kind = 'hf-jobs' as const;
  readonly real = true;
  readonly label = 'Dry-run trainer (a fake that trains nothing)';
  private readonly jobs = new Map<string, { job: ReturnType<typeof TrainerJobSchema.parse> }>();

  flavor(id: string): HardwareFlavor {
    return { id, label: 'no hardware (dry run)', pricePerHourUsd: 1.8, gpuMemoryGb: 48 };
  }

  resolveRevision(): Promise<string> {
    return Promise.resolve('d'.repeat(40));
  }

  outputRepo(): Promise<string | null> {
    return Promise.resolve(null);
  }

  async submit(submission: BackendSubmission): Promise<Submitted> {
    const file = submission.inputs.find((input) => input.name === JOB_FILE);
    if (!file) throw new Error('The submission has no job.json.');
    const job = TrainerJobSchema.parse(JSON.parse(await readFile(file.path, 'utf8')));
    this.jobs.set(submission.jobId, { job });
    return { handle: { jobId: submission.jobId }, url: null };
  }

  recover(jobId: string): Promise<Submitted | null> {
    return Promise.resolve(this.jobs.has(jobId) ? { handle: { jobId }, url: null } : null);
  }

  status(): Promise<{ state: 'succeeded' }> {
    return Promise.resolve({ state: 'succeeded' });
  }

  logs(): Promise<string> {
    return Promise.resolve('[dry run] No model is trained.\n');
  }

  cancel(): Promise<void> {
    return Promise.resolve();
  }

  async fetchArtifacts(handle: BackendHandle, destDir: string): Promise<FetchedArtifacts> {
    const jobId = typeof handle['jobId'] === 'string' ? handle['jobId'] : '';
    const entry = this.jobs.get(jobId);
    if (!entry) throw new Error(`The dry-run trainer has no job ${jobId}.`);
    const { job } = entry;
    await mkdir(join(destDir, 'peft'), { recursive: true });
    writeFileSync(
      join(destDir, 'adapter.gguf'),
      encodeGguf({
        metadata: [
          ['general.architecture', { type: 'string', value: 'muse-glimmer' }],
          ['general.type', { type: 'string', value: 'adapter' }],
          ['adapter.type', { type: 'string', value: 'lora' }],
          ['adapter.lora.alpha', { type: 'float32', value: 32 }],
        ],
        tensors: [
          {
            name: 'blk.0.attn_q.weight.lora_a',
            dims: [64, 16],
            type: 'F32',
            bytes: () => float32Bytes(new Float32Array(64 * 16).fill(0.01)),
          },
          {
            name: 'blk.0.attn_q.weight.lora_b',
            dims: [16, 32],
            type: 'F32',
            bytes: () => float32Bytes(new Float32Array(16 * 32).fill(0.02)),
          },
        ],
      }),
    );
    await writeFile(join(destDir, 'peft', 'adapter_config.json'), '{"r": 16, "lora_alpha": 32}\n');
    await writeFile(join(destDir, 'peft', 'adapter_model.safetensors'), 'dry-run weights');
    const listed = [
      { path: 'peft/adapter_config.json', kind: 'peft_config' as const },
      { path: 'peft/adapter_model.safetensors', kind: 'peft_weights' as const },
      { path: 'adapter.gguf', kind: 'gguf_lora' as const },
    ].map((file) => ({ ...file, ...hashFile(join(destDir, ...file.path.split('/'))) }));
    const manifest = TrainerOutputSchema.parse({
      format: TRAINER_OUTPUT_FORMAT,
      job_id: job.job_id,
      stand_in: false,
      base_model: job.base_model,
      dataset: {
        sha256: job.dataset.sha256,
        example_count: job.dataset.example_count,
        trained_examples: job.dataset.example_count,
        trained_tokens: 4_200 * job.dataset.example_count,
        skipped: [],
      },
      recipe: job.recipe,
      lora: { r: job.lora.r, alpha: job.lora.alpha, target_modules: job.lora.target_modules },
      converter: { commit: job.converter.commit, outtype: job.converter.outtype },
      versions: { 'dry-run': '1' },
      metrics: {
        steps: 4,
        loss_first: 1.9,
        loss_last: 0.8,
        train_seconds: 1_500,
        convert_seconds: 80,
        stopped_early: false,
      },
      files: listed,
    });
    await writeFile(join(destDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    return { revision: null, manifest, files: checkOutputs(manifest, destDir) };
  }
}

/** A llama.cpp student whose model names the adapters it applies, so the pass rule can tell. */
function labeled(student: StudentAdapter, request: AdapterServeRequest): StudentAdapter {
  const applied = Object.entries(request.scales)
    .filter(([, scale]) => scale !== 0)
    .map(([key, scale]) => `${key}@${scale}`);
  return {
    label: student.label,
    model: `${request.model}+${applied.join(',') || 'base'}`,
    baseUrl: student.baseUrl,
    isLocal: student.isLocal,
    chat: (chat, signal) => student.chat(chat, signal),
    describe: () => student.describe(),
    testConnection: () => student.testConnection(),
    release: () => student.release(),
  };
}

export interface ComparisonWorld {
  root: string;
  out: string;
  runtime: DryRunRuntime;
  mentor: FakeMentor;
  env: ComparisonEnvironment;
  /** The digest of the fake base in the fake Ollama store, which a package must name. */
  baseDigest: string;
  /** Every start and chat the stand-in llama-server saw. */
  llamaRecord: string;
  worker: TrainingWorker;
  close(): Promise<void>;
}

/**
 * Everything a comparisons run needs, with fakes: the scripted Spark drafts, then diagnoses each
 * round from the train attempts that just failed, choosing what its menu allows; the student is a
 * fake on its hosted copy and on Ollama; adapters are served by the real adapter runtime through
 * the stand-in llama-server on a tiny base in a fake Ollama store; training goes through the real
 * worker to the dry-run trainer; and a fake meter reports this computer's memory.
 */
export function comparisonWorld(options: { clock: Clock; parallel?: number }): ComparisonWorld {
  const root = mkdtempSync(join(tmpdir(), 'architect-comparisons-'));
  const out = join(root, 'out');
  const modelsDir = join(root, 'ollama-models');
  const { digest } = storeBase(modelsDir, 'muse-glimmer:30b');
  const llamaRecord = join(root, 'llama-record.jsonl');
  mkdirSync(join(root, 'runtime'), { recursive: true });
  const adapterRuntime = new LocalAdapterRuntime({
    runtimeDir: join(root, 'runtime'),
    ollamaModelsDir: () => modelsDir,
    env: {},
    freeGpu: async () => undefined,
    command: fakeLlamaCommand(llamaRecord),
  });
  const runtime = new DryRunRuntime();
  const mentor = new FakeMentor();
  let rounds = 0;
  mentor.script = (request) => {
    if (request.json?.name !== 'diagnosis') {
      return hypothesis('Draft the returns desk', 'Returns desk.\nfix:refund\nfix:order');
    }
    rounds += 1;
    const allowed = /Allowed this round: ([^.]+)\./.exec(JSON.stringify(request))?.[1] ?? '';
    const findings = runtime.takeTrainFailures(2).map((taskId) => ({ taskId }));
    if (allowed === 'weights') {
      return diagnosis('Train the pickups', {
        findings,
        intervention: {
          type: 'weights',
          estimatedCost: { mentorUsd: 0.2, computeUsd: 2.7, minutes: 90 },
        },
      });
    }
    return diagnosis(rounds % 2 === 1 ? 'Add the pickup procedure' : 'Check dates twice', {
      system: `Returns desk.\nfix:refund\nfix:order\nfix:pickup${rounds % 2 === 1 ? '' : '\nCheck every date twice.'}`,
      findings,
      intervention: { type: 'procedure', practicePerFinding: 1 },
    });
  };
  const secrets = new Map([
    ['meta', 'dry-run-mentor-key'],
    ['openrouter', 'dry-run-student-key'],
  ]);
  const deps: EngineHostDeps = {
    runtime,
    vault: new FakeVault(runtime),
    harness: {
      versions: (dir) => new FileVersions(dir),
      applyEdits,
      diffHarness,
      harnessToFiles,
      blankHarness,
      templateHarness,
      importHarness: async (dir) =>
        HarnessSchema.parse(JSON.parse(await readFile(join(dir, 'harness.json'), 'utf8'))),
      readPackaged,
    },
    adapters: {
      createMentor: () => mentor,
      createStudent: (endpoint) =>
        new FakeStudent(
          endpoint,
          () => 'ANSWER: {}',
          () => digest,
        ),
      createActor: (config) => {
        if (config.kind !== 'model') throw new Error('Only a model mentor can act.');
        return new FakeActor(
          {
            runtime: 'openai_compatible',
            baseUrl: config.baseUrl,
            model: config.model,
            contextLength: 16_384,
          },
          () => 'ANSWER: {"ok":true}',
        );
      },
      createAdapterStudent: (request, studentOptions) =>
        labeled(
          createLlamaCppStudent(adapterRuntime.access(request), {
            ...(studentOptions.label === undefined ? {} : { label: studentOptions.label }),
          }),
          request,
        ),
    },
    secrets: { get: async (ref) => secrets.get(ref) },
  };
  const store = new FileTrainingStore(join(out, 'data'));
  const trainer = new DryRunTrainer();
  const worker = new TrainingWorker({
    store,
    backends: { 'hf-jobs': trainer },
    trainerDir: TRAINER_DIR,
    now: () => options.clock.now(),
    watch: false,
  });
  deps.training = trainingDeps({
    worker,
    store,
    backend: async () => trainer,
    baseModel: { repo: GLIMMER_TRAINING_BASE.repo },
    flavor: loadRecipe(TRAINER_DIR).recipe.hardware.flavor,
    datasetsDir: join(out, 'data', 'training', 'datasets'),
  });
  const meter: RuntimeMeter = {
    start: async ({ target }) =>
      target !== 'local'
        ? null
        : {
            stop: async () => ({
              peakProcessBytes: 9_663_676_416,
              peakGpuBytes: 11_811_160_064,
              coldStartMs: 27_600,
              samples: 6,
              sampler: 'a dry-run meter (fixed readings)',
            }),
          },
  };
  deps.meter = meter;
  const identity = (backend: BackendId, job: Job): RuntimeIdentity => ({
    model:
      backend === 'reference'
        ? job.mentor.kind === 'model'
          ? job.mentor.model
          : 'none'
        : backend === 'hosted'
          ? (job.student.hosted?.model ?? 'none')
          : job.student.local.model,
    provider: `${backend} (dry run)`,
    runtime: backend,
    quantization: backend.startsWith('local') ? 'IQ2_XXS (dry run)' : null,
    ggufSha256: backend.startsWith('local') ? digest : null,
    runtimeBuild: backend === 'local-llama.cpp' ? 'b10472 (stand-in)' : null,
    chatTemplate: 'dry run',
    contextLength: job.student.local.contextLength,
  });
  const env: ComparisonEnvironment = {
    deps,
    clock: options.clock,
    writeHarness: async (dir: string, harness: Harness) => {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'harness.json'), JSON.stringify(harness));
    },
    identify: async (backend, job) => identity(backend, job),
    log: () => undefined,
    commit: 'dry-run',
    dryRun: true,
    parallel: options.parallel ?? 1,
    resumeAfterMs: 0,
  };
  return {
    root,
    out,
    runtime,
    mentor,
    env,
    baseDigest: digest,
    llamaRecord,
    worker,
    close: async () => {
      await adapterRuntime.stop();
      rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
    },
  };
}
