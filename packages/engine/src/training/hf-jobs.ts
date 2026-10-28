import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TrainerOutputSchema, type TrainerOutput } from '@architect/shared';
import { ArtifactError, insideDir } from './artifacts';
import type {
  BackendHandle,
  BackendState,
  BackendStatus,
  BackendSubmission,
  FetchedArtifacts,
  HardwareFlavor,
  Submitted,
  TrainingBackend,
} from './backend';
import { HubError, type HubClient, type JobInfo } from './hub';
import type { LoadedRecipe } from './recipe';

/**
 * Hardware Architect trains on, with its price per hour as the Hub's Jobs hardware table listed it
 * on Oct 28 (billed by the minute). A flavor that isn't listed has no known price, so no job runs
 * on it.
 */
export const HF_JOB_FLAVORS: readonly HardwareFlavor[] = [
  { id: 'l40sx1', label: 'one NVIDIA L40S (48 GB)', pricePerHourUsd: 1.8, gpuMemoryGb: 48 },
];

/** The environment variable that tags a job with Architect's id for it. */
export const JOB_TAG = 'ARCHITECT_TRAINING_JOB';

export interface HfJobsBackendOptions {
  hub: HubClient;
  recipe: LoadedRecipe;
  /** The token, given to the job as a secret so it can read its inputs and upload its outputs. */
  token: () => Promise<string | undefined>;
  /** The account or organization that runs the jobs; the token's own account when absent. */
  namespace?: string;
  /** How long a log request waits for lines from a running job. Default 5 seconds. */
  logWaitMs?: number;
}

const STAGES: Record<string, BackendState> = {
  RUNNING: 'running',
  COMPLETED: 'succeeded',
  ERROR: 'failed',
  CANCELED: 'cancelled',
  DELETED: 'failed',
};

/** What the job runs first: fetch its inputs at their commit, then hand over to the recipe. */
export function bootstrapScript(recipe: LoadedRecipe): string {
  const { bootstrap_packages: packages, entry } = recipe.recipe;
  return [
    'set -euo pipefail',
    `python -m pip install --no-cache-dir --quiet ${packages.join(' ')}`,
    "python - <<'PY'",
    'import os',
    'from huggingface_hub import snapshot_download',
    'snapshot_download(repo_id=os.environ["ARCHITECT_REPO"], revision=os.environ["ARCHITECT_INPUT_REVISION"], allow_patterns=["inputs/*"], local_dir="/work")',
    'PY',
    'cd /work/inputs',
    `python ${entry} --job job.json --inputs /work/inputs --out /work/outputs --upload`,
  ].join('\n');
}

function text(handle: BackendHandle, key: string): string {
  const value = handle[key];
  if (typeof value !== 'string' || value === '') throw new Error(`The job's handle has no ${key}.`);
  return value;
}

/**
 * Trains on Hugging Face Jobs. Each job gets a private model repository: the app commits the
 * job's inputs there, the job reads them at that commit, and it uploads its outputs beside them.
 * The job runs the recipe's pinned image with a timeout equal to the compute it was allowed, so
 * the Hub stops it there even if this app is closed.
 */
export class HfJobsBackend implements TrainingBackend {
  readonly kind = 'hf-jobs' as const;
  readonly real = true;
  readonly label = 'Hugging Face Jobs';
  private account: string | null = null;

  constructor(private readonly options: HfJobsBackendOptions) {}

  private async namespace(signal?: AbortSignal): Promise<string> {
    if (this.options.namespace) return this.options.namespace;
    this.account ??= await this.options.hub.whoami(signal);
    return this.account;
  }

  flavor(id: string): HardwareFlavor | null {
    return HF_JOB_FLAVORS.find((flavor) => flavor.id === id) ?? null;
  }

  resolveRevision(repo: string, signal?: AbortSignal): Promise<string> {
    return this.options.hub.revision(repo, 'main', signal);
  }

  async outputRepo(jobId: string, signal?: AbortSignal): Promise<string> {
    return `${await this.namespace(signal)}/architect-${jobId.replace('_', '-')}`;
  }

  private jobUrl(namespace: string, id: string): string {
    return `${this.options.hub.endpoint}/jobs/${namespace}/${id}`;
  }

  private submitted(namespace: string, info: JobInfo, repo: string, revision: string): Submitted {
    return {
      handle: { namespace, id: info.id, repo, inputRevision: revision },
      url: this.jobUrl(namespace, info.id),
    };
  }

  async submit(submission: BackendSubmission, signal?: AbortSignal): Promise<Submitted> {
    const { hub, recipe } = this.options;
    const namespace = await this.namespace(signal);
    const repo = await this.outputRepo(submission.jobId, signal);
    await hub.createPrivateRepo(repo, signal);
    const revision = await hub.commit(
      repo,
      submission.inputs.map((file) => ({
        path: `inputs/${file.name}`,
        content: readFileSync(file.path),
      })),
      `Inputs of training job ${submission.jobId}`,
      signal,
    );
    const token = await this.options.token();
    if (!token) throw new Error('No Hugging Face token is saved.');
    const info = await hub.createJob(
      namespace,
      {
        dockerImage: recipe.recipe.image,
        command: ['bash', '-c', bootstrapScript(recipe)],
        arguments: [],
        environment: {
          [JOB_TAG]: submission.jobId,
          ARCHITECT_REPO: repo,
          ARCHITECT_INPUT_REVISION: revision,
          PYTHONUNBUFFERED: '1',
        },
        secrets: { HF_TOKEN: token },
        flavor: submission.flavor.id,
        timeoutSeconds: submission.timeoutSeconds,
      },
      signal,
    );
    return this.submitted(namespace, info, repo, revision);
  }

  async recover(jobId: string, signal?: AbortSignal): Promise<Submitted | null> {
    const namespace = await this.namespace(signal);
    const jobs = await this.options.hub.listJobs(namespace, signal);
    const job = jobs.find((candidate) => candidate.environment?.[JOB_TAG] === jobId);
    const repo = job?.environment?.['ARCHITECT_REPO'];
    const revision = job?.environment?.['ARCHITECT_INPUT_REVISION'];
    if (!job || !repo || !revision) return null;
    return this.submitted(namespace, job, repo, revision);
  }

  async status(handle: BackendHandle, signal?: AbortSignal): Promise<BackendStatus> {
    const info = await this.options.hub.getJob(
      text(handle, 'namespace'),
      text(handle, 'id'),
      signal,
    );
    const createdAt = info.createdAt ? Date.parse(info.createdAt) : Number.NaN;
    return {
      state: STAGES[info.status.stage] ?? 'queued',
      ...(info.status.message ? { message: info.status.message } : {}),
      ...(Number.isFinite(createdAt) ? { createdAt } : {}),
    };
  }

  logs(handle: BackendHandle, signal?: AbortSignal): Promise<string> {
    return this.options.hub.jobLogs(
      text(handle, 'namespace'),
      text(handle, 'id'),
      this.options.logWaitMs ?? 5000,
      signal,
    );
  }

  cancel(handle: BackendHandle, signal?: AbortSignal): Promise<void> {
    return this.options.hub.cancelJob(text(handle, 'namespace'), text(handle, 'id'), signal);
  }

  /** Downloads the manifest at the outputs' current commit, then every file it lists, by hash. */
  async fetchArtifacts(
    handle: BackendHandle,
    destDir: string,
    signal?: AbortSignal,
  ): Promise<FetchedArtifacts> {
    const { hub } = this.options;
    const repo = text(handle, 'repo');
    const manifestPath = join(destDir, 'manifest.json');
    let revision: string;
    try {
      revision = await hub.revision(repo, 'main', signal);
      await hub.download(repo, revision, 'outputs/manifest.json', manifestPath, null, signal);
    } catch (error) {
      // A finished job whose outputs aren't there will not upload them later.
      if (error instanceof HubError && error.code === 'not_found') {
        throw new ArtifactError("The job finished, but its outputs aren't in its repository.");
      }
      throw error;
    }
    let manifest: TrainerOutput;
    try {
      manifest = TrainerOutputSchema.parse(JSON.parse(readFileSync(manifestPath, 'utf8')));
    } catch {
      throw new ArtifactError("The job's manifest can't be read.");
    }
    const files: FetchedArtifacts['files'] = [];
    for (const file of manifest.files) {
      const path = insideDir(destDir, file.path);
      try {
        await hub.download(repo, revision, `outputs/${file.path}`, path, file, signal);
      } catch (error) {
        // A file that is missing, or doesn't match its hash, won't be right on the next try either.
        if (
          error instanceof HubError &&
          (error.code === 'mismatch' || error.code === 'not_found')
        ) {
          throw new ArtifactError(error.message);
        }
        throw error;
      }
      files.push({ kind: file.kind, path, sha256: file.sha256, bytes: file.bytes });
    }
    return { revision, manifest, files };
  }
}
