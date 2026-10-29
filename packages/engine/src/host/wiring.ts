import { join } from 'node:path';
import {
  createLlamaCppStudent,
  createMentor,
  createMentorActor,
  createStudent,
  mentorCanAct,
  type StudentDeps,
} from '@architect/adapters';
import { DEFAULT_STUDENT, GLIMMER_TRAINING_BASE, type StudentEndpoint } from '@architect/shared';
import { readGgufHeader } from '../gguf';
import { readPackageHarness } from '../graduates/harness';
import { resolveOllamaModel, type AdapterServing } from '../local-runtime';
import {
  FileTrainingStore,
  HfJobsBackend,
  HubClient,
  loadRecipe,
  StandInBackend,
  trainingDeps,
  TrainingWorker,
} from '../training';
import {
  applyEdits,
  blankHarness,
  diffHarness,
  harnessToFiles,
  HarnessVersions,
  importHarness,
  templateHarness,
} from '@architect/harness';
import type {
  EngineHostDeps,
  SampleAgentFiles,
  TaskChecker,
  ToolSandbox,
  TrainingDeps,
} from '../loop/deps';
import { runCorrection } from '../teaching/correction';
import {
  createChecker,
  createSandbox,
  evaluateTasks,
  releaseMentor,
  splitTasks,
  todayFor,
  Vault,
  type Checker,
  type MentorReleased,
  type Sandbox,
} from '../runtime';
import { toolLoadProblem } from '../sandbox/tool-check';

export interface EngineWiringOptions {
  /** The app's data folder; the vault keeps sealed test splits under it. */
  dataDir: string;
  /**
   * The built JavaScript entry of the sandbox child. Leave it out to run the TypeScript source,
   * which is what tests and developer scripts do.
   */
  sandboxEntryPath?: string;
  /** Looks up a stored secret by ref; the engine never sees where secrets are kept. */
  getSecret(ref: string): Promise<string | undefined>;
  /** The sample job shipped with the app (`job.json`, with `tasks.jsonl` and `data/` beside it). */
  sampleJobFile?: string;
  /** The ready-made agent shipped with the app: its package, and the data it works on. */
  sampleAgent?: SampleAgentFiles;
  /** The CPU-thread cap for students on a local runtime right now, if there is one. */
  localThreads?: () => number | undefined;
  /** How long a local student rests after each reply, as a share of its time; none if absent. */
  localCooldown?: () => number | undefined;
  /**
   * The trainer folder: `trainer/` of the repository in development, the app's `trainer`
   * resource when packaged. Without it no training worker is set up.
   */
  trainerDir?: string;
  /**
   * The Hugging Face token, read when a job needs it. Hugging Face Jobs is offered for new jobs
   * only while this resolves to a token; otherwise the stand-in, which trains nothing.
   */
  huggingFaceToken?: () => Promise<string | undefined>;
  /**
   * The process's one adapter runtime, the one the engine host's installation checks use, so
   * runs and checks share one llama-server. Without it no adapter is served: weights are off the
   * mentor's menu.
   */
  adapterRuntime?: AdapterServing;
}

/** The training worker over `<data>/training`, its backends, and what the loop needs of it. */
function trainingWiring(options: EngineWiringOptions, trainerDir: string): TrainingDeps {
  const store = new FileTrainingStore(options.dataDir);
  const recipe = loadRecipe(trainerDir);
  const token = options.huggingFaceToken ?? (async () => undefined);
  const hub = new HfJobsBackend({ hub: new HubClient({ token }), recipe, token });
  const standIn = new StandInBackend({
    stateDir: join(options.dataDir, 'training', 'stand-in'),
    // The stand-in shapes its adapter for the default student's base, from Ollama's store.
    baseHeader: () => readGgufHeader(resolveOllamaModel(DEFAULT_STUDENT.model).modelPath),
  });
  const worker = new TrainingWorker({
    store,
    backends: { 'hf-jobs': hub, 'stand-in': standIn },
    trainerDir,
    onPollError: (id, error) => console.error(`[training] Checking job ${id} failed:`, error),
  });
  return trainingDeps({
    worker,
    store,
    backend: async () => ((await token()) ? hub : standIn),
    baseModel: { repo: GLIMMER_TRAINING_BASE.repo },
    flavor: recipe.recipe.hardware.flavor,
    datasetsDir: join(options.dataDir, 'training', 'datasets'),
  });
}

/**
 * Quiet mode's settings for a student on `endpoint`: the settings themselves, not what they say
 * now, since a student lives as long as a session and quiet mode may be switched on or off while
 * it works. Only a student on Ollama, which is on this computer, follows them.
 */
export function followedQuietSettings(
  endpoint: StudentEndpoint,
  { localThreads, localCooldown }: Pick<EngineWiringOptions, 'localThreads' | 'localCooldown'>,
): Pick<StudentDeps, 'cpuThreads' | 'cooldown'> {
  if (endpoint.runtime !== 'ollama') return {};
  return {
    ...(localThreads === undefined ? {} : { cpuThreads: localThreads }),
    ...(localCooldown === undefined ? {} : { cooldown: localCooldown }),
  };
}

/**
 * The real dependencies of the core loop: the runtime, the vault, the harness folders, the
 * model adapters and the training worker. Tests build the loop with fakes instead; this is the
 * one place they meet.
 */
export function createEngineDeps(options: EngineWiringOptions): EngineHostDeps {
  const vault = new Vault(options.dataDir);
  const { adapterRuntime } = options;
  return {
    ...(options.trainerDir === undefined
      ? {}
      : { training: trainingWiring(options, options.trainerDir) }),
    runtime: {
      splitTasks: (tasks, config) => splitTasks(tasks, config),
      today: (job, now) => todayFor(job, now),
      evaluateTasks: (tasks, ctx, evaluation) =>
        evaluateTasks(
          tasks,
          {
            job: ctx.job,
            jobDir: ctx.jobDir,
            harness: ctx.harness,
            student: ctx.student,
            sandbox: asSandbox(ctx.sandbox),
            checker: asChecker(ctx.checker),
            now: middayOf(ctx.today),
            ...(ctx.decoding === undefined ? {} : { decoding: ctx.decoding }),
          },
          evaluation,
        ),
      createSandbox: () =>
        createSandbox(
          options.sandboxEntryPath === undefined ? {} : { entryPath: options.sandboxEntryPath },
        ),
      createChecker: (job, jobDir, sandbox) =>
        createChecker({ job, jobDir, sandbox: asSandbox(sandbox) }),
      correct: (task, ctx, start, correction) =>
        runCorrection(
          task,
          { ...ctx, sandbox: asSandbox(ctx.sandbox), checker: asChecker(ctx.checker) },
          start,
          correction,
        ),
      toolLoadProblem: (sandbox, tool) => toolLoadProblem(asSandbox(sandbox), tool),
      // Nothing is disposed here, because nothing is left to dispose: before it asks, the loop
      // has closed its mentor gate, so no mentor call can start, and dropped its reference to
      // the adapter. All that remains is to issue the proof the vault asks for.
      releaseMentor: () => releaseMentor({ dispose: () => undefined }),
    },
    vault: {
      seal: (jobId, tests, others, data) => vault.seal(jobId, tests, others, data),
      discard: (jobId) => vault.reset(jobId),
      isSealed: (jobId) => vault.isSealed(jobId),
      count: (jobId) => vault.count(jobId),
      typeCounts: (jobId) => vault.typeCounts(jobId),
      leakDetector: (jobId) => vault.leakDetector(jobId),
      openForLockedTest: (jobId, proof) => vault.openForLockedTest(jobId, proof as MentorReleased),
    },
    harness: {
      versions: (dir) => new HarnessVersions(dir),
      applyEdits,
      diffHarness,
      harnessToFiles,
      blankHarness,
      templateHarness,
      importHarness,
      readPackaged: readPackageHarness,
    },
    adapters: {
      createMentor: (config, mentorOptions) => createMentor(config, mentorOptions),
      createStudent: (endpoint, adapterOptions) =>
        createStudent(endpoint, { ...adapterOptions, ...followedQuietSettings(endpoint, options) }),
      createActor: (config, actorOptions) => createMentorActor(config, actorOptions),
      canAct: (config) => mentorCanAct(config),
      ...(adapterRuntime === undefined
        ? {}
        : {
            createAdapterStudent: (request, studentOptions) =>
              createLlamaCppStudent(adapterRuntime.access(request), {
                ...(studentOptions.label === undefined ? {} : { label: studentOptions.label }),
              }),
          }),
    },
    secrets: { get: options.getSecret },
    ...(options.sampleJobFile === undefined ? {} : { sampleJobFile: options.sampleJobFile }),
    ...(options.sampleAgent === undefined ? {} : { sampleAgent: options.sampleAgent }),
  };
}

/*
 * The loop only creates sandboxes and checkers through the functions above and hands them back
 * unchanged, so these narrowings recover the runtime types it created.
 */
function asSandbox(sandbox: ToolSandbox): Sandbox {
  return sandbox as Sandbox;
}

function asChecker(checker: TaskChecker): Checker {
  return checker as Checker;
}

/** Noon UTC on a `YYYY-MM-DD` date: the same calendar day in every time zone the app runs in. */
function middayOf(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}
