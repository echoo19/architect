import type {
  ActorAdapter,
  CheckOutcome,
  CheckResult,
  Decoding,
  DraftOrganization,
  DraftTurn,
  FileDiff,
  FileEdit,
  Harness,
  HarnessTool,
  Job,
  MentorAdapter,
  MentorConfig,
  Organization,
  PackageManifest,
  Score,
  SplitConfig,
  StudentAdapter,
  StudentEndpoint,
  StudentTarget,
  SuiteResult,
  Task,
  Trace,
  Transcriber,
  TrainingBackendKind,
  TrainingJobRecord,
  TypeScore,
} from '@architect/shared';
import type { CounterexampleSearch, FoundCounterexample } from '../counterexamples/find';
import type { SuiteCase, SuiteContext } from '../counterexamples/suite';
import type { LeakDetector } from '../mentor/gate';
import type {
  CertificationSets,
  OpenedTransfer,
  SealedOrganization,
  TransferOrganization,
} from '../vault/vault';
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
  /** The sealed calibration split of a certified job (decision 077). */
  certify?: Task[];
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
  /** The sealed folders of organizations the job never trains on, for the locked test only. */
  sealedData?: Readonly<Record<string, string>>;
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
  splitTasks(tasks: Task[], config: SplitConfig & { certify?: number }): TaskSplits;
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
   * One verified correction of a task (decision 042): from a checkpoint rebuilt by replaying a
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
  /**
   * Counterexamples from the helper calls of failed train attempts (decision 078): each call
   * replayed, run again in the sandbox and reduced while the same failure holds. No model call.
   */
  findCounterexamples(
    search: Omit<CounterexampleSearch, 'sandbox'> & { sandbox: ToolSandbox },
  ): Promise<FoundCounterexample[]>;
  /** Runs a changed helper on counterexamples in the sandbox. No model call. */
  runSuite(
    ctx: Omit<SuiteContext, 'sandbox'> & { sandbox: ToolSandbox },
    tool: Pick<HarnessTool, 'name' | 'code'>,
    cases: readonly SuiteCase[],
  ): Promise<SuiteResult[]>;
}

/** The locked test split. Only the runner holds this; the mentor side never sees it. */
export interface VaultDeps {
  /**
   * Seals the test tasks. `others` are every other task of the job and `data` the text of its
   * data files: wording and values they share with test tasks are left out of the leak
   * fingerprint. `transfer` are the organizations the job never trains on, with their files,
   * sealed with it (decision 068); their tasks are among `tests`. `certify` is a certified job's
   * calibration split, sealed beside the test (decision 077).
   */
  seal(
    jobId: string,
    tests: Task[],
    others: Task[],
    data: string[],
    transfer?: TransferOrganization[],
    certify?: Task[],
  ): Awaitable<void>;
  /**
   * Takes back a seal, for a job whose making failed or was interrupted before it was in the
   * library: nothing of it was ever read, and nothing is to be left that no job owns.
   */
  discard(jobId: string): Awaitable<void>;
  isSealed(jobId: string): Awaitable<boolean>;
  count(jobId: string): Awaitable<number>;
  /** How many sealed tasks there are of each type; nothing else about them leaves the vault. */
  typeCounts(jobId: string): Awaitable<Record<string, number>>;
  /** The id and name of each sealed organization, so a request can be held to not naming one. */
  transferIdentifiers(jobId: string): Awaitable<{ id: string; name: string }[]>;
  leakDetector(jobId: string): Awaitable<LeakDetector>;
  openForLockedTest(jobId: string, proof: MentorReleased): Awaitable<Task[]>;
  /** The sealed organizations and each one's folder, on the same proof as the locked test. */
  openTransfer(jobId: string, proof: MentorReleased): Awaitable<OpenedTransfer>;
  /** A certified job's calibration split, on the same proof; none for a job without one. */
  openCalibration(jobId: string, proof: MentorReleased): Awaitable<Task[]>;
  /**
   * Seals a version's after-the-fact certification tasks in the job's vault, fingerprinted
   * against `others` and `data` as the test is, and refused when one has nothing of its own to be
   * recognized by; returns their sha256.
   */
  sealCertification(
    jobId: string,
    certificationId: string,
    sets: CertificationSets,
    others: Task[],
    data: string[],
  ): Awaitable<string>;
  /** Those tasks, on the same proof, as long as they still have the sha256 they were sealed with. */
  openCertification(
    jobId: string,
    certificationId: string,
    sha256: string,
    proof: MentorReleased,
  ): Awaitable<CertificationSets>;
  /** Takes back the sealed tasks of a certification that never started. */
  discardCertification(jobId: string, certificationId: string): Awaitable<void>;
  /**
   * Writes the sealed part of a job into a job folder that a comparison imports and seals again
   * in its own vault: the sealed tasks appended to its `tasks.jsonl`, each sealed organization's
   * files in `orgs/<id>/data/`. Returns the sealed organizations. Never for a mentor.
   */
  stageSealed(jobId: string, dir: string): Awaitable<Organization[]>;
  /**
   * Seals a never-seen organization beside the job's seal after the job was made (decision 085),
   * fingerprinted against `others` and `data` as the test is; the job's seal doesn't change.
   */
  addOrganization(
    jobId: string,
    organization: TransferOrganization,
    tasks: Task[],
    others: Task[],
    data: string[],
  ): Awaitable<void>;
  /** The organizations sealed after the job was made; the engine's own, never a mentor's. */
  addedOrganizations(jobId: string): Awaitable<Organization[]>;
  /** One of their tasks, on the same proof as the locked test. */
  openAdded(jobId: string, orgId: string, proof: MentorReleased): Awaitable<Task[]>;
  /**
   * A never-seen organization's files and tasks, for the new version of the job that teaches on
   * it at the person's word (decision 089). The job's own vault doesn't change.
   */
  releaseOrganization(jobId: string, orgId: string): Awaitable<SealedOrganization>;
  /**
   * Seals that new version: this job's final test without the moved organization (none for a
   * version carried to another model, decision 095), its
   * calibration split, and every other sealed organization again, fingerprinted against the new
   * version's visible tasks and taught files (decision 082).
   */
  sealVersion(
    fromJobId: string,
    toJobId: string,
    movedOrgId: string | null,
    others: Task[],
    data: string[],
  ): Awaitable<void>;
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
  /**
   * A graduate version's harness from its package folder, read (never run) and held to the hash
   * its manifest records.
   */
  readPackaged(dir: string, manifest: PackageManifest): Awaitable<Harness>;
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
  /** Whether `createActor` can make this mentor an agent; assumed so when absent. */
  canAct?(config: MentorConfig): boolean;
  /**
   * A student on llama.cpp with adapters, to measure a candidate adapter on and off on one
   * server. Absent where no adapter runtime is set up; weights interventions are then refused.
   */
  createAdapterStudent?(request: AdapterServeRequest, options: { label?: string }): StudentAdapter;
  /**
   * Muse Voice Transcribe, for a taught organization's recordings (decision 087). Absent where a
   * build has none; transcribing is then refused.
   */
  createTranscriber?(options: { apiKey: string }): Transcriber;
}

export interface SecretDeps {
  /** The stored value for a secret ref, or undefined when none is saved. */
  get(ref: string): Promise<string | undefined>;
}

/** The training worker as the loop uses it (decision 035). */
export type TrainingWorkerApi = Pick<
  TrainingWorker,
  'submit' | 'poll' | 'get' | 'cancel' | 'usage' | 'list' | 'resume' | 'close'
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
  /** A ready job's GGUF adapter on disk. */
  adapterPath(record: TrainingJobRecord): string;
  /** The tokens a ready job trained on, from its output manifest; 0 before it is ready. */
  trainedTokens(record: TrainingJobRecord): number;
  /**
   * Offer weights when only the stand-in backend is set up. Tests do, to run the plumbing; the
   * app doesn't, since a stand-in adapter is never kept and the round would be spent for nothing.
   */
  offersStandIn?: boolean;
}

/** What a meter read from the runtime serving a model during one stretch of an evaluation. */
export interface MeterReading {
  /** The most memory the server's processes held at any sample; null when none was read. */
  peakProcessBytes: number | null;
  /** The most GPU memory in use at any sample; null without a GPU reading. */
  peakGpuBytes: number | null;
  /** A first reply's time with the model unloaded before it; null when not measured. */
  coldStartMs: number | null;
  samples: number;
  /** How it read them, for the record. */
  sampler: string;
}

export interface MeterSession {
  /** Stops watching and returns what it saw. */
  stop(): Promise<MeterReading>;
}

/**
 * Watches the runtime that serves a student on this computer while a locked-test evaluation runs
 * (decision 045): peak memory, and a cold first reply. Absent where nobody measures; the
 * evaluation runs the same either way.
 */
export interface RuntimeMeter {
  /** Starts watching `backend` for one evaluation; null when it can't watch it (a hosted copy). */
  start(context: {
    backend: string;
    target: StudentTarget;
    student: StudentAdapter;
    signal: AbortSignal;
  }): Promise<MeterSession | null>;
}

export interface LoopDeps {
  runtime: RuntimeDeps;
  vault: VaultDeps;
  harness: HarnessDeps;
  adapters: AdapterDeps;
  secrets: SecretDeps;
  /** Absent where no training worker is set up; weights interventions are then refused. */
  training?: TrainingDeps;
  /** Absent where nothing measures the local runtime; no runtime measurements are recorded. */
  meter?: RuntimeMeter;
}

/**
 * The Describe and Clarify conversation that drafts a job (decisions 010 and 058). `teacher` is
 * the mentor the person chose in Settings, which the conversation talks to.
 */
export interface JobDrafter {
  start(description: string, files: string[], teacher: MentorConfig): Promise<DraftTurn>;
  startField(
    description: string,
    organizations: readonly DraftOrganization[],
    teacher: MentorConfig,
  ): Promise<DraftTurn>;
  reply(sessionId: string, text: string, teacher: MentorConfig): Promise<DraftTurn>;
}

/** The ready-made agent shipped with the app: its package, and the data it works on. */
export interface SampleAgentFiles {
  /** The agent's package, a `.architect.zip`. */
  packageFile: string;
  /** The folder holding the data the agent works on, which this computer gets its own copy of. */
  dataDir: string;
}

export interface EngineHostDeps extends LoopDeps {
  /** The sample job's `job.json`, shipped with the app, with `tasks.jsonl` and `data/` beside it. */
  sampleJobFile?: string;
  /** The Academy desk's job, with its academies at `orgs/<id>/data/` beside it. */
  academyJobFile?: string;
  /** Sweep desk's job, with its research groups at `orgs/<id>/data/` beside it. */
  sweepDeskJobFile?: string;
  /** The Assay desk's job, a science lab sample, with its labs at `orgs/<id>/data/` beside it. */
  assayJobFile?: string;
  /** Absent where the app ships no ready-made agent, which is then never offered. */
  sampleAgent?: SampleAgentFiles;
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
