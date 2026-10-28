import type { ConnectionTest } from './adapters';
import type { RunEvent } from './events';
import type { GraduateManifest } from './graduate';
import type { Job, MentorConfig, PermissionMode, StudentEndpoint, StudentTarget } from './job';
import type { LineageEntry } from './lineage';
import type { ProviderId, TokenPricing } from './models';
import type { ReportCard } from './report';
import type { Method, Round, Run } from './run';
import type { Attempt, Trace } from './trace';
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
}

export interface RunDetail {
  run: Run;
  job: Job;
  rounds: Round[];
  /** Most recent attempts first, train and dev only. */
  recentAttempts: (Attempt & { prompt?: string })[];
  lineage: LineageEntry[];
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
  manifest: GraduateManifest;
  path: string;
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
  };
  settings: {
    get(): Promise<AppSettings>;
    update(patch: Partial<AppSettings>): Promise<AppSettings>;
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
  };
  ollama: {
    status(): Promise<OllamaStatus>;
    pull(model: string): Promise<void>;
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
    trace(attemptId: string): Promise<Trace>;
    roundDiff(runId: string, round: number): Promise<FileDiff[]>;
    onEvent(listener: (event: RunEvent) => void): Unsubscribe;
  };
  reports: {
    /** The run's report card from one student endpoint: by default, where its locked test ran. */
    get(runId: string, target?: StudentTarget): Promise<ReportCard>;
    /** The student endpoints the run has a report card from, oldest card first. */
    list(runId: string): Promise<StudentTarget[]>;
  };
  graduates: {
    list(): Promise<GraduateSummary[]>;
    accept(runId: string): Promise<GraduateSummary>;
    exportFolder(graduateId: string, path: string): Promise<void>;
    importFolder(path: string): Promise<GraduateSummary>;
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
