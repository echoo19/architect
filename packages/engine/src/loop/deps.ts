import type {
  ActorAdapter,
  CheckOutcome,
  CheckResult,
  Decoding,
  DraftTurn,
  FileDiff,
  FileEdit,
  Harness,
  HarnessTool,
  Job,
  MentorAdapter,
  MentorConfig,
  Score,
  SplitConfig,
  StudentAdapter,
  StudentEndpoint,
  Task,
  Trace,
  TrainingBackendKind,
  TypeScore,
} from '@architect/shared';
import type { LeakDetector } from '../mentor/gate';
import type {
  CorrectionContext,
  CorrectionOptions,
  CorrectionResult,
  CorrectionStart,
} from '../teaching/correction';
import type { TrainingWorker } from '../training/worker';

/**
 * What the core loop needs from the runtime, harness and adapter packages. The real
 * implementations are wired in where the engine host is created; tests use fakes.
 */

/** A dependency may answer directly or with a promise; the loop always awaits. */
export type Awaitable<T> = T | Promise<T>;

export interface TaskSplits {
  calibration: Task[];
  train: Task[];
  dev: Task[];
  test: Task[];
}

/** The tool sandbox. The loop only creates it, hands it to the runtime, and disposes it. */
export interface ToolSandbox {
  dispose(): Awaitable<void>;
}

/** The job's deterministic checker, built by the runtime and handed back to it. */
export type TaskChecker = unknown;

export interface EvaluationContext {
  job: Job;
  /** The job folder: data files and any checker module live under it. */
  jobDir: string;
  harness: Harness;
  student: StudentAdapter;
  sandbox: ToolSandbox;
  checker: TaskChecker;
  /** The date the job's tasks are written against, `YYYY-MM-DD`. */
  today: string;
  /** Replaces the harness's decoding, as a frozen graduate's recorded decoding does. */
  decoding?: Decoding;
}

/** A correction's context as the loop holds it: the sandbox and checker it made. */
export type LoopCorrectionContext = Omit<CorrectionContext, 'sandbox' | 'checker'> & {
  sandbox: ToolSandbox;
  checker: TaskChecker;
};

export interface EvaluatedTask {
  task: Task;
  result: { trace: Trace; outcome: CheckOutcome; check: CheckResult };
}

export interface EvaluationOptions {
  /** The runner's sampler seed; the runtime derives each task's seed from it and the task id. */
  seed: number;
  concurrency?: number;
  onAttempt?(item: EvaluatedTask): void;
  onProgress?(done: number, total: number, pass: number): void;
  signal?: AbortSignal;
}

export interface Evaluation {
  items: EvaluatedTask[];
  score: Score;
  perType: TypeScore[];
}

/** Proof from `releaseMentor` that no mentor can be called again; the vault asks for it. */
export type MentorReleased = unknown;

export interface MentorSession {
  jobId: string;
  runId: string;
  /** The mentor this session used, or null when it never made one. */
  mentor: MentorAdapter | null;
}

export interface RuntimeDeps {
  splitTasks(tasks: Task[], config: SplitConfig): TaskSplits;
  /**
   * The date a run's tasks are evaluated against, `YYYY-MM-DD`: the job's `businessDate` when it
   * has one, otherwise the date at `now`. A run fixes it when it starts.
   */
  today(job: Job, now: Date): string;
  /**
   * Runs the student on each task and checks the result. It should reject, not return an
   * `error` attempt, when the student can't be reached, so an outage pauses the run instead
   * of being scored as failures.
   */
  evaluateTasks(
    tasks: Task[],
    ctx: EvaluationContext,
    options: EvaluationOptions,
  ): Promise<Evaluation>;
  createSandbox(): Awaitable<ToolSandbox>;
  /**
   * Why a tool's code doesn't load in the sandbox (a syntax error, no `run`, a top level that
   * throws), or null when it loads. Only the code's top level runs, never the tool.
   */
  toolLoadProblem(sandbox: ToolSandbox, tool: HarnessTool): Promise<string | null>;
  /** The checker runs end-state validators in the sandbox it is given. */
  createChecker(job: Job, jobDir: string, sandbox: ToolSandbox): Awaitable<TaskChecker>;
  /**
   * One verified correction of a task (decision 041): from a checkpoint rebuilt by replaying a
   * recorded attempt, or the whole task from the start, by the given actor, graded by the
   * checker and the mutation audit. A guard's refusal of the actor's call propagates.
   */
  correct(
    task: Task,
    ctx: LoopCorrectionContext,
    start: CorrectionStart,
    options: CorrectionOptions,
  ): Promise<CorrectionResult>;
  /** Issues the release proof. The loop calls it after closing its gate and dropping the adapter. */
  releaseMentor(session: MentorSession): Promise<MentorReleased>;
}

/** The locked test split. Only the runner holds this; the mentor side never sees it. */
export interface VaultDeps {
  /**
   * Seals the test tasks. `others` are every other task of the job and `data` the text of its
   * data files: wording and values they share with test tasks are left out of the leak
   * fingerprint.
   */
  seal(jobId: string, tests: Task[], others: Task[], data: string[]): Awaitable<void>;
  isSealed(jobId: string): Awaitable<boolean>;
  count(jobId: string): Awaitable<number>;
  leakDetector(jobId: string): Awaitable<LeakDetector>;
  openForLockedTest(jobId: string, proof: MentorReleased): Awaitable<Task[]>;
}

/** One run's harness versions (`new HarnessVersions(dir)`). */
export interface HarnessVersionStore {
  /** Saves the next version, derived from `parent`; returns it with its number and hash. */
  save(harness: Harness, parent?: number): Awaitable<Harness>;
  /** Fails if the version's files no longer match its recorded hash. */
  load(version: number): Awaitable<Harness>;
  latest(): Awaitable<Harness | undefined>;
}

/** The name `applyEdits` gives the error for a change set whose files don't validate. */
export const HARNESS_VALIDATION_ERROR = 'HarnessValidationError';

export interface HarnessDeps {
  versions(dir: string): HarnessVersionStore;
  /**
   * Throws `GuardError('harness_surface')` for a path outside the harness surface, and an error
   * named `HarnessValidationError` when the edited files don't validate.
   */
  applyEdits(harness: Harness, edits: readonly FileEdit[]): Harness;
  diffHarness(from: Harness, to: Harness): FileDiff[];
  /** The harness as files keyed by relative path; with `includeDefaults`, every settings file too. */
  harnessToFiles(harness: Harness, options?: { includeDefaults?: boolean }): Record<string, string>;
  blankHarness(name: string, jobDescription: string): Harness;
  templateHarness(name: string, jobDescription: string, template: string): Harness;
  /** Reads a harness folder to improve, as a fresh starting point. */
  importHarness(dir: string): Awaitable<Harness>;
}

/** What a llama.cpp student serves: the base, every adapter loaded once, and its own scales. */
export interface AdapterServeRequest {
  /** The base model, by its name in Ollama's store. */
  model: string;
  /** Every adapter the server loads, in load order, each a GGUF LoRA on disk. */
  adapters: readonly { key: string; path: string }[];
  /** This student's scale for each adapter, by key; adapters it doesn't name get 0. */
  scales: Readonly<Record<string, number>>;
}

export interface AdapterDeps {
  /** `apiKey` is absent for a mentor that takes none, such as a model on this computer. */
  createMentor(config: MentorConfig, options: { apiKey?: string }): MentorAdapter;
  createStudent(
    endpoint: StudentEndpoint,
    options: { apiKey?: string; label?: string },
  ): StudentAdapter;
  /**
   * The mentor's model as an agent with the student's tools, for verified corrections and
   * references. Absent where a build can't run one; the runner then refuses what needs it.
   */
  createActor?(config: MentorConfig, options: { apiKey?: string }): ActorAdapter;
  /**
   * A student on llama.cpp with adapters, to measure a candidate adapter on and off on one
   * server. Absent where no adapter runtime is set up; weights interventions are then refused.
   */
  createAdapterStudent?(request: AdapterServeRequest, options: { label?: string }): StudentAdapter;
}

export interface SecretDeps {
  /** The stored value for a secret ref, or undefined when none is saved. */
  get(ref: string): Promise<string | undefined>;
}

/** The training worker as the loop uses it (decision 035). */
export type TrainingWorkerApi = Pick<
  TrainingWorker,
  'submit' | 'poll' | 'get' | 'cancel' | 'usage'
>;

/** Weight training for weights interventions: the worker, its backends and the base model. */
export interface TrainingDeps {
  worker: TrainingWorkerApi;
  /**
   * The backend a new job goes to now: Hugging Face Jobs when a token resolves, otherwise the
   * stand-in, which trains nothing; null when neither is set up.
   */
  backend(): Promise<{ kind: TrainingBackendKind; real: boolean; pricePerHourUsd: number } | null>;
  /** The base model adapters are trained on, by its Hub repository. */
  baseModel: { repo: string; revision?: string };
  /** Where a round's dataset is written before it is sent. */
  datasetDir(runId: string, round: number): string;
}

export interface LoopDeps {
  runtime: RuntimeDeps;
  vault: VaultDeps;
  harness: HarnessDeps;
  adapters: AdapterDeps;
  secrets: SecretDeps;
  /** Absent where no training worker is set up; weights interventions are then refused. */
  training?: TrainingDeps;
}

/** The Describe and Clarify conversation that drafts a job (decision 010). */
export interface JobDrafter {
  start(description: string, files: string[]): Promise<DraftTurn>;
  reply(sessionId: string, text: string): Promise<DraftTurn>;
}

export interface EngineHostDeps extends LoopDeps {
  /** The sample job's `job.json`, shipped with the app, with `tasks.jsonl` and `data/` beside it. */
  sampleJobFile?: string;
  drafts?: JobDrafter;
}

export interface Clock {
  /** Milliseconds since the epoch. */
  now(): number;
  /** A signal that aborts once `ms` more milliseconds have passed on this clock. */
  timeout(ms: number): AbortSignal;
}

export const systemClock: Clock = {
  now: () => Date.now(),
  timeout: (ms) => AbortSignal.timeout(Math.max(0, Math.ceil(ms))),
};
