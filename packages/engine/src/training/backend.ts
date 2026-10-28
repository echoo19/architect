import type {
  JsonValue,
  TrainerOutput,
  TrainingArtifact,
  TrainingBackendKind,
} from '@architect/shared';
import type { InputFile } from './recipe';

/** Hardware a job can run on, with what it costs. */
export interface HardwareFlavor {
  id: string;
  label: string;
  pricePerHourUsd: number;
  gpuMemoryGb: number;
}

/** A backend's own handle on a job, kept in the job's record as JSON. */
export type BackendHandle = { [key: string]: JsonValue };

export interface BackendSubmission {
  /** Architect's id for the job; the backend tags the job with it, so a lost handle can be found. */
  jobId: string;
  /** job.json, the dataset and the recipe's files. */
  inputs: readonly InputFile[];
  flavor: HardwareFlavor;
  /** The provider stops the job here, whatever happens to this app. */
  timeoutSeconds: number;
}

export interface Submitted {
  handle: BackendHandle;
  /** Where a person can watch the job, when the provider has a page for it. */
  url: string | null;
}

export type BackendState = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';

export interface BackendStatus {
  state: BackendState;
  /** The provider's own words about a failure. */
  message?: string;
  /** When the provider says the job was created, in ms since the epoch. */
  createdAt?: number;
}

export interface FetchedArtifacts {
  /** The outputs' immutable revision, for a backend with a repository. */
  revision: string | null;
  manifest: TrainerOutput;
  /** Downloaded and checked against the manifest's hashes; paths are absolute. */
  files: (Omit<TrainingArtifact, 'path'> & { path: string })[];
}

/**
 * Where training runs. The worker owns the records, the budget and the polling; a backend only
 * talks to its provider.
 */
export interface TrainingBackend {
  readonly kind: TrainingBackendKind;
  /** False for the stand-in: nothing it returns was trained, and it never counts as training. */
  readonly real: boolean;
  /** What records, reports and screens call it. */
  readonly label: string;
  /** The hardware with this id and its price, or null when its price isn't known. */
  flavor(id: string): HardwareFlavor | null;
  /** The base model's immutable revision. */
  resolveRevision(repo: string, signal?: AbortSignal): Promise<string>;
  /** Where the job will upload its outputs, or null for a backend without a repository. */
  outputRepo(jobId: string, signal?: AbortSignal): Promise<string | null>;
  submit(submission: BackendSubmission, signal?: AbortSignal): Promise<Submitted>;
  /** A job submitted under this id, when the app stopped before it saved the handle. */
  recover(jobId: string, signal?: AbortSignal): Promise<Submitted | null>;
  status(handle: BackendHandle, signal?: AbortSignal): Promise<BackendStatus>;
  logs(handle: BackendHandle, signal?: AbortSignal): Promise<string>;
  cancel(handle: BackendHandle, signal?: AbortSignal): Promise<void>;
  fetchArtifacts(
    handle: BackendHandle,
    destDir: string,
    signal?: AbortSignal,
  ): Promise<FetchedArtifacts>;
}
