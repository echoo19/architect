import type { ConnectionTest } from './adapters';
import type {
  Correction,
  CorrectionRequest,
  Improvement,
  ImprovementStart,
  ImproveOptions,
  RunImprovement,
  TeachingOverview,
} from './corrections';
import type { RunEvent } from './events';
import type { GraduateManifest } from './graduate';
import type { Job, MentorConfig, PermissionMode, StudentEndpoint, StudentTarget } from './job';
import type { LineageEntry } from './lineage';
import type {
  CapabilityBreakdown,
  Category,
  Experiment,
  Intervention,
  ListedLesson,
  MentoringProgress,
  ReferenceRecord,
} from './mentoring';
import type { GpuInfo, ProviderId, StudentBuild, TokenPricing } from './models';
import type { ComparisonReport } from './comparisons';
import type { RuntimeMeasurement } from './measurements';
import type { ReportCard } from './report';
import type { Method, Round, Run } from './run';
import type { Attempt, Trace } from './trace';
import type {
  BindRequest,
  ExportPartRequest,
  ExportPartResult,
  ExportRequest,
  ExportResult,
  ExportReview,
  GraduateVersion,
  HubInstallRequest,
  ImportPreview,
  ImportRequest,
  Installation,
  InstallStatus,
  PackageInspection,
  Publication,
  PublicationReview,
  PublishProgress,
  PublishRequest,
  PublishResult,
  VersionEvent,
  VersionSource,
} from './versions';
import type { WorkspaceChat, WorkspaceEvent, WorkspaceMessage } from './workspace';

export type Unsubscribe = () => void;

export type Theme = 'dark' | 'light' | 'system';

export interface AppSettings {
  theme: Theme;
  /** Tool steps in chat start collapsed or expanded. */
  steps: 'collapsed' | 'expanded';
  /** Shows the baselines comparison on report cards and the run menu. */
  comparisonMode: boolean;
  /** Local models use fewer CPU threads: slower, but cooler and quieter. */
  quietLocalModels: boolean;
  /** Mentor preset used for new jobs. */
  defaultMentor: MentorConfig;
  defaultStudent: StudentEndpoint;
  /** OpenAI-compatible endpoints the user added by address. */
  customEndpoints: CustomEndpoint[];
  /** True once first-run setup is finished. */
  onboarded: boolean;
  /**
   * The llama-server the user chose, which runs graduates that carry an adapter: the program or
   * its folder. Absent: the first one on PATH.
   */
  llamaServerPath?: string;
}

/** What the renderer may change in settings: everything but the program Architect runs. */
export type AppSettingsPatch = Partial<Omit<AppSettings, 'llamaServerPath'>>;

/** llama.cpp's llama-server on this computer, as Settings shows it. */
export interface LlamaServerStatus {
  /** Where it was found: the path chosen in Settings, or the system PATH; null when it wasn't. */
  source: 'setting' | 'path' | null;
  /** The program, when one was found. */
  path?: string;
  /** Its build number, when it said. */
  build?: number;
  /** It runs and is new enough to serve graduates that carry an adapter. */
  ready: boolean;
  /** What stands in the way when it isn't ready, and how to fix it. */
  problem?: string;
  hint?: string;
  /** The oldest build that runs Glimmer. */
  minimumBuild: number;
}

/** An OpenAI-compatible endpoint the user added by its address, such as a vLLM server. */
export interface CustomEndpoint {
  baseUrl: string;
  /** What the app calls it: its host. */
  label: string;
}

/** One model a connection offers. */
export interface ModelEntry {
  id: string;
  /** A name for people, when the provider gives one. */
  label?: string;
  /** The price the provider lists with the model, when it lists one (OpenRouter does). */
  pricing?: TokenPricing;
  contextLength?: number;
  /** Size on disk, for a model on this computer. */
  sizeBytes?: number;
  /** For a model loaded on this computer right now: its size in memory, and how much is on the GPU. */
  inMemory?: { totalBytes: number; gpuBytes: number };
}

/** Where a model list comes from: a provider at an address, with the key it needs. */
export interface ModelSource {
  provider: ProviderId;
  baseUrl: string;
  secretRef?: string;
}

/** A model runtime on this computer, and the models it has. */
export interface LocalRuntime {
  running: boolean;
  version?: string;
  baseUrl: string;
  models: ModelEntry[];
}

export interface LocalRuntimes {
  ollama: LocalRuntime;
  lmstudio: LocalRuntime;
  /** The GPU local models can run on, when Architect can tell. */
  gpu: GpuInfo | null;
}

export interface AddConnectionRequest {
  provider: ProviderId;
  /** The address of an endpoint the user adds (`other`); a named provider uses its own. */
  baseUrl?: string;
  /** Required by named providers; an added endpoint may need none. */
  key?: string;
}

export interface AddConnectionResult {
  /** Where the key was saved, when there was one. */
  secretRef?: string;
  /** How many models the connection offers, when it lists them. */
  models?: number;
}

export type SignInResult = { status: 'signed_in' } | { status: 'cancelled' };

/**
 * Where the Hugging Face token that publishing and installing would use comes from, nearest
 * first: the key saved in Architect, an environment variable, or the token file `hf auth login`
 * writes. Never the token itself. Null when there is none.
 */
export interface HubTokenStatus {
  source: 'saved' | 'HF_TOKEN' | 'HUGGING_FACE_HUB_TOKEN' | 'token_file' | null;
}

export interface AppInfo {
  version: string;
  platform: 'win32' | 'darwin' | 'linux';
  dataPath: string;
  totalMemoryBytes: number;
}

export interface OllamaStatus {
  running: boolean;
  version?: string;
  models: { name: string; sizeBytes: number; digest: string }[];
}

export interface PullProgress {
  model: string;
  status: string;
  completedBytes?: number;
  totalBytes?: number;
  done: boolean;
  error?: string;
}

export interface JobSummary {
  id: string;
  name: string;
  summary?: string;
  createdAt: string;
  taskCount: number;
  latestRun?: Pick<Run, 'id' | 'status' | 'phase' | 'method' | 'devCurrent' | 'devBaseline'>;
}

/** How a run starts. */
export interface RunStartOptions {
  method: Method;
  /** The run's seed; a random one when absent. */
  seed?: number;
  /**
   * Where the locked test runs: the local student unless the run asks for the job's hosted copy.
   * A hosted test is a supplementary result, and its report card says it didn't run offline.
   */
  lockedTestOn?: StudentTarget;
  /**
   * Someone is there to answer: the mentor may pause the run with one clarifying question.
   * Runs started by scripts aren't.
   */
  interactive?: boolean;
}

/** The person's answer to a run's clarifying question. */
export interface ClarificationReply {
  text: string;
  /** The answer changes what counts as success; the run then stops for a new job contract. */
  changesCriteria: boolean;
}

/** How a reference run starts: on which split, and the most it may spend. */
export interface ReferenceOptions {
  split: 'dev' | 'test';
  maxUsd: number;
}

/** An attempt as the training screen lists it, with its task's request when the task is visible. */
export type ListedAttempt = Attempt & { prompt?: string };

/**
 * A finished run's frozen agent taken through its final test again on the other student endpoint
 * (`runs.retest`): `testing` until its report card is filed, `paused` with the reason when an
 * error stopped it (asking again resumes it), `finished` once the card is filed.
 */
export interface Retest {
  target: StudentTarget;
  status: 'testing' | 'paused' | 'finished';
  /** Why it paused. */
  error?: string;
  startedAt: string;
  endedAt?: string;
}

export interface RunDetail {
  run: Run;
  job: Job;
  rounds: Round[];
  /** Most recent attempts first, train and dev only. */
  recentAttempts: ListedAttempt[];
  lineage: LineageEntry[];
  /** The final tests the run has been put through again; absent when it has none. */
  retests?: Retest[];
  /**
   * Set when the run is Improve agent's: the agent and version it improves and the lessons it
   * took. Such a run ends in a candidate version measured on dev, never in a locked test.
   */
  improves?: RunImprovement;
}

export interface FileDiff {
  path: string;
  status: 'added' | 'modified' | 'deleted';
  /** Unified diff text. */
  patch: string;
}

export interface GraduateSummary {
  id: string;
  name: string;
  /**
   * The workspace's view of the active version, in the format 1 shape the screens read: the
   * package's facts with this computer's model endpoint.
   */
  manifest: GraduateManifest;
  /** The active version's folder. */
  path: string;
  /** The version chats run on; null while the agent has none that can run. */
  activeVersion: number | null;
  /** How many versions of the agent this computer keeps. */
  versions: number;
  /** Whether the active version can run on this computer, from its installation checks. */
  status: InstallStatus;
  /** Why not, in words a person can act on. */
  reasons: string[];
}

/** What importing a package did. */
export interface ImportResult {
  graduate: GraduateSummary;
  /** The local version the package became. */
  version: number;
  installation: Installation;
  /** True when this exact version was already installed, so nothing changed. */
  alreadyInstalled: boolean;
}

/** What installing a version from a Hugging Face repository did, and the commit it came from. */
export interface HubInstallResult extends ImportResult {
  source: VersionSource;
}

/** The ready-made agent that ships with the app, set up to be imported like any package. */
export interface SampleAgent {
  /** The agent's package, inside the app: a `.architect.zip`. */
  package: string;
  /** This computer's copy of the data it works on: the folder to choose for its `data/`. */
  data: string;
}

/** Per-graduate choices the user makes in the workspace. */
export interface GraduateSettings {
  /** Writes: ask every time, allow without asking, or never. Starts from the job's permission. */
  writeMode: PermissionMode;
}

export interface DraftTurn {
  sessionId: string;
  /** The mentor's reply, shown in the clarify conversation. */
  message: string;
  /** Choices the mentor offers for its question, if any. */
  options: string[];
  /** Set once the mentor has enough to draft the job. */
  draft?: Job;
}

/** The API the preload script exposes to the renderer as `window.architect`. */
export interface ArchitectApi {
  app: {
    info(): Promise<AppInfo>;
    /** Opens a provider's key page, or a local runtime's download page, in the browser. */
    openProviderPage(provider: ProviderId): Promise<void>;
    /**
     * Opens a web page in the browser, such as a repository on Hugging Face. Only HTTPS pages on
     * the hosts Architect knows open; any other address is refused.
     */
    openLink(url: string): Promise<void>;
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: AppSettingsPatch): Promise<AppSettings>;
    /** Fires whenever settings change, from this window or anywhere else. */
    onChange(listener: (settings: AppSettings) => void): Unsubscribe;
  };
  secrets: {
    /** Which secret refs have a stored value. Values never cross into the renderer. */
    status(): Promise<Record<string, boolean>>;
    set(ref: string, value: string): Promise<void>;
    clear(ref: string): Promise<void>;
  };
  connections: {
    testMentor(config: MentorConfig): Promise<ConnectionTest>;
    testStudent(endpoint: StudentEndpoint): Promise<ConnectionTest>;
    /** The models a connection offers, from its own list. */
    listModels(source: ModelSource): Promise<ModelEntry[]>;
    /** Ollama and LM Studio on this computer: whether each runs, and its models. */
    detectLocal(): Promise<LocalRuntimes>;
    /** Checks a key with its provider, then saves it; an added endpoint is remembered too. */
    add(request: AddConnectionRequest): Promise<AddConnectionResult>;
    /** Forgets a connection's key, and an added endpoint's address. */
    remove(source: Pick<ModelSource, 'provider' | 'baseUrl'>): Promise<void>;
    /** Signs in with the provider in the browser and saves the key it issues. */
    signIn(provider: 'openrouter'): Promise<SignInResult>;
    /** Stops a sign-in that is waiting for the browser. */
    cancelSignIn(): Promise<void>;
    /** Finds llama-server, asks its build, and says whether it can serve adapters. Loads nothing. */
    llamaServer(): Promise<LlamaServerStatus>;
    /**
     * Uses this llama-server from now on, which must be a file the user picked; null goes back
     * to the one on PATH. Checks it like `llamaServer`.
     */
    chooseLlamaServer(path: string | null): Promise<LlamaServerStatus>;
    /** Where the Hugging Face token comes from, if there is one. Sends nothing anywhere. */
    huggingFace(): Promise<HubTokenStatus>;
  };
  ollama: {
    status(): Promise<OllamaStatus>;
    pull(model: string): Promise<void>;
    /**
     * Installs one of Glimmer's builds: a plain pull, or for the GPU-sized one a pull, then a
     * text-only model made from its weights. Progress comes under the build's model name.
     */
    install(build: StudentBuild['key']): Promise<void>;
    onPullProgress(listener: (progress: PullProgress) => void): Unsubscribe;
  };
  files: {
    pick(options: {
      title: string;
      filters?: { name: string; extensions: string[] }[];
      multiple?: boolean;
      directory?: boolean;
    }): Promise<string[]>;
  };
  jobs: {
    list(): Promise<JobSummary[]>;
    get(jobId: string): Promise<Job>;
    save(job: Job): Promise<Job>;
    /** Creates the sample job shipped with the app and returns it. */
    createSample(): Promise<Job>;
    importFile(path: string): Promise<Job>;
    exportFile(jobId: string, path: string): Promise<void>;
    draftStart(description: string, files: string[]): Promise<DraftTurn>;
    draftReply(sessionId: string, text: string): Promise<DraftTurn>;
  };
  runs: {
    start(jobId: string, options: RunStartOptions): Promise<Run>;
    pause(runId: string): Promise<void>;
    resume(runId: string): Promise<void>;
    stop(runId: string): Promise<void>;
    /**
     * Tests a finished run's frozen graduate again on the other student endpoint, with the
     * harness version and student it was frozen with and no mentor, and files a report card for
     * that endpoint. The run itself never changes. Resolves once queued; progress comes as
     * `eval.progress` and `eval.finished` events for split `test`, the second once the card is
     * filed. Each endpoint is re-tested once: asking again only resumes a re-test an error paused.
     */
    retest(runId: string, target: StudentTarget): Promise<void>;
    get(runId: string): Promise<RunDetail>;
    list(jobId?: string): Promise<Run[]>;
    /**
     * One practice or check attempt, with its verdict, for opening it from a record that names
     * it, such as a finding. A locked-test attempt is refused: the final test shows as counts.
     */
    attempt(attemptId: string): Promise<ListedAttempt>;
    trace(attemptId: string): Promise<Trace>;
    roundDiff(runId: string, round: number): Promise<FileDiff[]>;
    /**
     * What a runtime meter read while the run's locked tests ran on this computer, oldest first:
     * peak memory and a cold start (decision 045). None where no meter ran.
     */
    runtimeMeasurements(runId: string): Promise<RuntimeMeasurement[]>;
    onEvent(listener: (event: RunEvent) => void): Unsubscribe;
  };
  /**
   * The records of failure-specific mentoring. Every number an evidence screen shows comes from
   * these, never from anything worked out on the screen.
   */
  mentoring: {
    /** Verified and rejected, oldest first. */
    lessons(runId: string): Promise<ListedLesson[]>;
    /**
     * What the mentor did as the agent in one lesson's correction, step by step. Null when the
     * correction never ran (its replay didn't hold, or a guard refused it).
     */
    lessonTrace(lessonId: string): Promise<Trace | null>;
    /** One per round that reached a diagnosis, accepted or refused. */
    interventions(runId: string): Promise<Intervention[]>;
    /** One per round that ended, rejected, invalid and stopped ones included, by round. */
    experiments(runId: string): Promise<Experiment[]>;
    progress(runId: string): Promise<MentoringProgress>;
    capabilities(runId: string): Promise<CapabilityBreakdown>;
    /** The job's failure vocabulary. */
    categories(jobId: string): Promise<Category[]>;
    /** Answers the question a paused run asked, and resumes it. */
    answer(runId: string, round: number, reply: ClarificationReply): Promise<void>;
    /**
     * Queues the mentor's model as a reference agent on a finished run's tasks, with its own
     * disclosed cap. Isolated from mentoring: its results never reach a mentor request.
     */
    reference(runId: string, options: ReferenceOptions): Promise<void>;
    references(runId: string): Promise<ReferenceRecord[]>;
  };
  /**
   * Teach this and Improve agent (spec section 8): corrections of workspace replies become
   * lessons, and lessons become candidate versions. The active version never changes here.
   */
  teach: {
    /**
     * The mentor reads one reply's exchange and the person's correction, and proposes a lesson.
     * Needs the job to allow sharing corrections and `consent` on this one; costs at most the
     * cap shown beside the consent. Nothing is queued yet.
     */
    propose(chatId: string, messageId: string, request: CorrectionRequest): Promise<Correction>;
    queue(correctionId: string): Promise<Correction>;
    discard(correctionId: string): Promise<Correction>;
    /** A procedure or source lesson as an instruction-only candidate version, not yet evaluated. */
    apply(correctionId: string): Promise<Correction>;
    list(graduateId: string): Promise<Correction[]>;
    /** Improve agent on every queued lesson, within the budget shown. */
    improve(graduateId: string, options: ImproveOptions): Promise<ImprovementStart>;
    /** Newest first: what each improvement changed and whether its candidate may be promoted. */
    improvements(graduateId: string): Promise<Improvement[]>;
    /**
     * Whether the agent can be taught on this computer and why not, who reads a flagged answer
     * and the most that may cost, and the budget Improve agent would keep to. Sends nothing.
     */
    overview(graduateId: string): Promise<TeachingOverview>;
    /**
     * Lets the agent's job send flagged answers to the mentor, each one still only once the
     * person agrees to it, or keeps them on this computer again.
     */
    shareCorrections(graduateId: string, allowed: boolean): Promise<TeachingOverview>;
  };
  reports: {
    /** The run's report card from one student endpoint: by default, where its locked test ran. */
    get(runId: string, target?: StudentTarget): Promise<ReportCard>;
    /** The student endpoints the run has a report card from, oldest card first. */
    list(runId: string): Promise<StudentTarget[]>;
    /**
     * The comparisons runner's report the run is an arm of (decision 045), when the app runs on
     * that comparison's data folder and the report sits beside it, as the runner leaves them.
     * Null otherwise.
     */
    comparisons(runId: string): Promise<ComparisonReport | null>;
  };
  graduates: {
    list(): Promise<GraduateSummary[]>;
    /**
     * Accepts the version a finished run made. An agent's first version is its active one from
     * the start; accepting a later one never makes it active (that is `promote`).
     */
    accept(runId: string): Promise<GraduateSummary>;
    /** Every version of the agent on this computer, oldest first. */
    versions(graduateId: string): Promise<GraduateVersion[]>;
    /** Acceptances, rejections, promotions and rollbacks, oldest first. */
    history(graduateId: string): Promise<VersionEvent[]>;
    /**
     * The report card a version carries (the active one unless named): its own locked test, from
     * its folder, wherever it was made. The author's result, never this computer's checks.
     */
    report(graduateId: string, version?: number): Promise<ReportCard>;
    acceptVersion(graduateId: string, version: number): Promise<GraduateVersion>;
    rejectVersion(graduateId: string, version: number): Promise<GraduateVersion>;
    /** Makes an accepted version the active one, in one step. Chats already answering finish first. */
    promote(graduateId: string, version: number): Promise<GraduateSummary>;
    /** Makes an earlier accepted version active again: its harness and adapter return together. */
    rollback(graduateId: string, version: number): Promise<GraduateSummary>;
    /** This computer's installation of the agent: bindings, grants and the last checks. */
    installation(graduateId: string): Promise<Installation>;
    /** Binds resources to folders, changes grants or the model endpoint, then checks again. */
    bind(graduateId: string, request: BindRequest): Promise<Installation>;
    /** Runs the installation checks of the active version again. */
    verify(graduateId: string, options?: { loadModel?: boolean }): Promise<Installation>;
    /** What an export would carry and leave out, and what the scan finds in it. */
    reviewExport(graduateId: string, version?: number, include?: string[]): Promise<ExportReview>;
    /** Writes `<name>/` and `<name>.architect.zip` into the request's folder. */
    exportPackage(graduateId: string, request: ExportRequest): Promise<ExportResult>;
    /** Exports the active version with nothing optional into `directory`. */
    exportFolder(graduateId: string, directory: string): Promise<ExportResult>;
    /** Writes one part of a version on its own: its harness folder, adapter file or report. */
    exportPart(graduateId: string, request: ExportPartRequest): Promise<ExportPartResult>;
    /** Validates a package folder or `.architect.zip` without installing it or loading its code. */
    inspectPackage(path: string): Promise<PackageInspection>;
    /**
     * Validates a package as `inspectPackage` does, and says where it would go and whether this
     * computer can run it and has its base model, without installing anything.
     */
    previewImport(path: string): Promise<ImportPreview>;
    /** Validates and installs a package, then runs its installation checks. */
    importPackage(path: string, request?: ImportRequest): Promise<ImportResult>;
    /** Imports a package with the default request. */
    importFolder(path: string): Promise<GraduateSummary>;
    /**
     * Installs a version from a Hugging Face repository (`hf://owner/name` or `owner/name`), at
     * the commit named or the one its main branch points at now, with an import's checks.
     */
    installFromHub(source: string, request?: HubInstallRequest): Promise<HubInstallResult>;
    /**
     * Whether this build ships a ready-made agent: its package and the data it works on are both
     * here. Changes nothing.
     */
    hasSampleAgent(): Promise<boolean>;
    /**
     * Where the ready-made agent's package is, and its data on this computer. The data is copied
     * into the app's data folder the first time; a copy already there is kept as it is, so what
     * the agent changed in it stays. Installing the agent is an import like any other, from
     * these two paths. Fails in a build that doesn't ship it.
     */
    prepareSampleAgent(): Promise<SampleAgent>;
    /** What publishing a version to Hugging Face would send, and what the scan finds. Sends nothing. */
    reviewPublication(graduateId: string, request: PublishRequest): Promise<PublicationReview>;
    /**
     * Publishes a version to a Hugging Face repository, private unless the request says public.
     * Its progress comes as `onPublishProgress` events until it resolves.
     */
    publish(graduateId: string, request: PublishRequest): Promise<PublishResult>;
    /** Every publication of the agent's versions, oldest first. */
    publications(graduateId: string): Promise<Publication[]>;
    /** Fires as a publication moves: each stage, and the bytes sent while it uploads. */
    onPublishProgress(listener: (progress: PublishProgress) => void): Unsubscribe;
    remove(graduateId: string): Promise<void>;
    settings(graduateId: string): Promise<GraduateSettings>;
    updateSettings(graduateId: string, patch: Partial<GraduateSettings>): Promise<GraduateSettings>;
  };
  workspace: {
    listChats(graduateId: string): Promise<WorkspaceChat[]>;
    createChat(graduateId: string): Promise<WorkspaceChat>;
    messages(chatId: string): Promise<WorkspaceMessage[]>;
    send(chatId: string, text: string): Promise<void>;
    stop(chatId: string): Promise<void>;
    decide(changeId: string, decision: 'approve' | 'deny' | 'always'): Promise<void>;
    onEvent(listener: (event: WorkspaceEvent) => void): Unsubscribe;
  };
}
