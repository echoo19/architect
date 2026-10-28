import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import {
  GuardError,
  newId,
  TERMINAL_TRAINING_STATES,
  type TrainingBackendKind,
  type TrainingJobRecord,
  type TrainingJobState,
} from '@architect/shared';
import { GgufError, inspectLoraAdapter, readGgufHeader } from '../gguf';
import { ArtifactError, hashFile } from './artifacts';
import type { BackendHandle, HardwareFlavor, Submitted, TrainingBackend } from './backend';
import { authorizeCompute, computeUsage, costOf, type ComputeUsage } from './budget';
import { readTrainingDataset } from './dataset';
import {
  buildTrainerJob,
  loadRecipe,
  MIN_JOB_SECONDS,
  writeTrainerInputs,
  type InputFile,
} from './recipe';
import type { TrainingStore } from './store';

export interface TrainingRequest {
  /** Whose compute budget pays: a job or run id. */
  scope: string;
  /** The scope's cap on compute dollars. */
  maxComputeUsd: number;
  backend: TrainingBackendKind;
  /** A folder written by `writeTrainingDataset`. */
  datasetDir: string;
  /** The base model on the Hub; its current revision is looked up and pinned when not given. */
  baseModel: { repo: string; revision?: string };
  /** The longest the job may run, before the budget's own limit. Default three hours. */
  maxSeconds?: number;
}

export interface TrainingWorkerOptions {
  store: TrainingStore;
  backends: Partial<Record<TrainingBackendKind, TrainingBackend>>;
  /** The trainer folder: recipe.json and the scripts it lists. */
  trainerDir: string;
  now?: () => number;
  /** Between status checks of a running job. Default 30 seconds. */
  pollMs?: number;
  /** Waits between checks; tests replace it. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
  /** Every saved change to a record. */
  onChange?: (record: TrainingJobRecord) => void;
  /** A background check failed; the job is checked again on the next round. */
  onPollError?: (id: string, error: unknown) => void;
  /** Keep checking jobs in the background once submitted or resumed. Default true. */
  watch?: boolean;
}

const DEFAULT_MAX_SECONDS = 3 * 60 * 60;
/** How far past its limit a job may be seen running before the worker stops it itself. */
const OVERRUN_GRACE_SECONDS = 120;

function rest(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener('abort', done, { once: true });
  });
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Runs each piece of work after every earlier one under the same key has finished. */
class Queue {
  private readonly tails = new Map<string, Promise<void>>();

  run<T>(key: string, work: () => Promise<T>): Promise<T> {
    const result = (this.tails.get(key) ?? Promise.resolve()).then(work);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return result;
  }
}

/**
 * Runs training jobs on a backend and keeps a durable record of each: written before the backend
 * hears of a job, so a crash can't lose one, and keyed by what it trains, so the same job is never
 * sent twice. After a restart, `resume` picks every unfinished job up where it was: it finds a
 * job whose submission was cut off, checks the status of running ones, and downloads the outputs
 * of finished ones. Compute is paid from a hard cap per scope; the provider is told to stop each
 * job at its share, and the worker stops it too if it is seen running past it.
 *
 * Every change to a job goes through one queue per job, so a check, a cancel and a download never
 * work from a stale copy of its record; new jobs go through one queue per budget scope, so two
 * can't be paid from the same dollars.
 */
export class TrainingWorker {
  private readonly watchers = new Map<string, AbortController>();
  private readonly jobs = new Queue();
  private readonly scopes = new Queue();

  constructor(private readonly options: TrainingWorkerOptions) {}

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }

  private iso(ms = this.now()): string {
    return new Date(ms).toISOString();
  }

  private backend(kind: TrainingBackendKind): TrainingBackend {
    const backend = this.options.backends[kind];
    if (!backend) throw new Error(`No ${kind} training backend is set up.`);
    return backend;
  }

  list(): TrainingJobRecord[] {
    return this.options.store.list();
  }

  get(id: string): TrainingJobRecord {
    const record = this.options.store.get(id);
    if (!record) throw new Error(`There is no training job ${id}.`);
    return record;
  }

  /** Compute spent and held in a scope against its cap. */
  usage(scope: string, maxComputeUsd: number): ComputeUsage {
    return computeUsage(this.list(), scope, maxComputeUsd);
  }

  private save(
    record: TrainingJobRecord,
    state: TrainingJobState,
    note: string | null,
  ): TrainingJobRecord {
    const at = this.iso();
    const next: TrainingJobRecord = {
      ...record,
      state,
      updatedAt: at,
      history: note === null ? record.history : [...record.history, { at, state, note }],
    };
    this.options.store.put(next);
    this.options.onChange?.(next);
    return next;
  }

  /**
   * Sends a dataset for training, or returns the job already made for the same dataset, base,
   * recipe and backend unless that one failed or was cancelled.
   */
  async submit(request: TrainingRequest, signal?: AbortSignal): Promise<TrainingJobRecord> {
    const backend = this.backend(request.backend);
    const dataset = readTrainingDataset(request.datasetDir);
    const recipe = loadRecipe(this.options.trainerDir);
    if (backend.real && !dataset.manifest.remote_training_allowed) {
      throw new GuardError(
        'permission',
        "Some of these examples may not leave this computer, so they can't go to remote training.",
      );
    }
    const flavorId = recipe.recipe.hardware.flavor;
    const flavor = backend.flavor(flavorId);
    if (!flavor) {
      throw new GuardError(
        'budget',
        `The price of ${flavorId} on ${backend.label} isn't known, so the compute cap can't be kept.`,
      );
    }
    const revision =
      request.baseModel.revision ?? (await backend.resolveRevision(request.baseModel.repo, signal));
    const key = createHash('sha256')
      .update(
        JSON.stringify({
          backend: backend.kind,
          dataset: dataset.manifest.examples_sha256,
          base: { repo: request.baseModel.repo, revision },
          recipe: recipe.sha256,
          flavor: flavor.id,
        }),
      )
      .digest('hex');

    // The budget check and the record that reserves its dollars happen together, one job at a
    // time per scope; the same job asked for twice finds the first one's record here.
    const made = await this.scopes.run(request.scope, async () => {
      const existing = this.list().find(
        (record) =>
          record.idempotencyKey === key &&
          record.state !== 'failed' &&
          record.state !== 'cancelled',
      );
      if (existing) return { record: existing, inputs: null };
      const authorized = authorizeCompute(
        this.usage(request.scope, request.maxComputeUsd),
        flavor.pricePerHourUsd,
        request.maxSeconds ?? DEFAULT_MAX_SECONDS,
        MIN_JOB_SECONDS,
        flavor.label,
      );
      const id = newId('trn');
      const outputRepo = await backend.outputRepo(id, signal);
      const job = buildTrainerJob({
        jobId: id,
        recipe,
        baseModel: { repo: request.baseModel.repo, revision },
        dataset: dataset.manifest,
        authorizedSeconds: authorized.seconds,
        outputRepo,
      });
      const at = this.iso();
      // Saved before the backend hears of the job, so a crash from here on can't lose it.
      const record = this.save(
        {
          format: 1,
          id,
          idempotencyKey: key,
          scope: request.scope,
          backend: backend.kind,
          real: backend.real,
          label: backend.label,
          state: 'submitting',
          createdAt: at,
          updatedAt: at,
          dataset: {
            sha256: dataset.manifest.examples_sha256,
            exampleCount: dataset.manifest.example_count,
            trainedTurns: dataset.manifest.trained_turns,
          },
          baseModel: { repo: request.baseModel.repo, revision },
          recipe: {
            name: recipe.recipe.name,
            version: recipe.recipe.version,
            sha256: recipe.sha256,
          },
          provider: null,
          providerUrl: null,
          compute: {
            flavor: flavor.id,
            pricePerHourUsd: flavor.pricePerHourUsd,
            authorizedSeconds: authorized.seconds,
            authorizedUsd: authorized.usd,
            startedAt: null,
            endedAt: null,
            seconds: 0,
            usd: 0,
          },
          artifacts: null,
          error: null,
          history: [],
        },
        'submitting',
        `Sending ${dataset.manifest.example_count} examples to ${backend.label}`,
      );
      const inputs = writeTrainerInputs(
        join(this.options.store.jobDir(id), 'inputs'),
        job,
        recipe,
        dataset,
      );
      return { record, inputs };
    });
    if (made.inputs === null) return made.record;

    const { record, inputs } = made;
    const timeout = record.compute.authorizedSeconds;
    const sent = await this.jobs.run(record.id, () =>
      this.send(record.id, backend, inputs, flavor, timeout, signal),
    );
    if (this.options.watch !== false && !TERMINAL_TRAINING_STATES.has(sent.state)) {
      this.watch(sent.id);
    }
    return sent;
  }

  private async send(
    id: string,
    backend: TrainingBackend,
    inputs: readonly InputFile[],
    flavor: HardwareFlavor,
    timeoutSeconds: number,
    signal?: AbortSignal,
  ): Promise<TrainingJobRecord> {
    let submitted: Submitted;
    try {
      submitted = await backend.submit({ jobId: id, inputs, flavor, timeoutSeconds }, signal);
    } catch (error) {
      // The provider may have the job even though its answer was lost, so ask before giving up.
      let found: Submitted | null;
      try {
        found = await backend.recover(id);
      } catch {
        // Not knowing is not the same as not having it: leave the job as sent, and ask again
        // on the next check, rather than risk sending it twice.
        this.save(
          this.get(id),
          'submitting',
          `The provider couldn't be asked whether it received the job: ${message(error)}`,
        );
        throw error;
      }
      if (!found) {
        this.save(
          { ...this.get(id), error: { code: 'submit_failed', message: message(error) } },
          'failed',
          'The job could not be sent',
        );
        throw error;
      }
      submitted = found;
    }
    return this.save(
      { ...this.get(id), provider: submitted.handle, providerUrl: submitted.url },
      'queued',
      'The provider has the job',
    );
  }

  /** Picks up every unfinished job after a restart. Returns their ids. */
  resume(): string[] {
    const open = this.list().filter((record) => !TERMINAL_TRAINING_STATES.has(record.state));
    if (this.options.watch !== false) for (const record of open) this.watch(record.id);
    return open.map((record) => record.id);
  }

  /** One step for a job: recover its submission, check its status, or fetch its outputs. */
  poll(id: string, signal?: AbortSignal): Promise<TrainingJobRecord> {
    return this.jobs.run(id, () => this.step(id, signal));
  }

  private async step(id: string, signal?: AbortSignal): Promise<TrainingJobRecord> {
    let record = this.get(id);
    if (TERMINAL_TRAINING_STATES.has(record.state)) return record;
    const backend = this.backend(record.backend);

    if (record.state === 'submitting') {
      const found = await backend.recover(id, signal);
      if (!found) {
        return this.save(
          {
            ...record,
            error: {
              code: 'interrupted',
              message:
                'The app stopped while sending this job, and the provider has no record of it. Nothing ran; send it again.',
            },
          },
          'failed',
          'The job was never received',
        );
      }
      record = this.save(
        { ...record, provider: found.handle, providerUrl: found.url },
        'queued',
        'Found the job the provider received before the app stopped',
      );
    }
    const handle = record.provider as BackendHandle;

    if (record.state === 'succeeded') return this.collect(record, backend, handle, signal);

    const status = await backend.status(handle, signal);
    const now = this.now();
    const finished = status.state !== 'queued' && status.state !== 'running';
    let startedAt = record.compute.startedAt;
    if (startedAt === null && status.state !== 'queued') {
      // It began after it was last seen waiting, or else after it was made: the earliest it
      // could have begun bounds what it can have cost.
      const lastSeenWaiting = record.state === 'queued' ? Date.parse(record.updatedAt) : null;
      startedAt = this.iso(lastSeenWaiting ?? status.createdAt ?? Date.parse(record.createdAt));
    }
    const endedAt = finished ? (record.compute.endedAt ?? this.iso(now)) : null;
    const ran =
      startedAt === null
        ? 0
        : Math.max(
            0,
            ((endedAt === null ? now : Date.parse(endedAt)) - Date.parse(startedAt)) / 1000,
          );
    // The provider stops a job at its limit, so it can't have run, or cost, more than that.
    const seconds = Math.min(ran, record.compute.authorizedSeconds);
    const updated: TrainingJobRecord = {
      ...record,
      compute: {
        ...record.compute,
        startedAt,
        endedAt,
        seconds,
        usd: costOf(seconds, record.compute.pricePerHourUsd),
      },
    };

    switch (status.state) {
      case 'queued':
      case 'running': {
        const overrun =
          status.state === 'running' &&
          ran > record.compute.authorizedSeconds + OVERRUN_GRACE_SECONDS;
        if (overrun && record.state !== 'cancelling') {
          await backend.cancel(handle, signal);
          return this.save(updated, 'cancelling', 'Stopped at its compute limit');
        }
        const state = record.state === 'cancelling' ? 'cancelling' : status.state;
        return this.save(updated, state, state === record.state ? null : `The job is ${state}`);
      }
      case 'succeeded': {
        const done = this.save(updated, 'succeeded', 'Training finished');
        return this.collect(done, backend, handle, signal);
      }
      case 'failed':
        return this.save(
          {
            ...updated,
            error: {
              code: 'provider_failed',
              message: status.message ?? `${backend.label} reported that the job failed.`,
            },
          },
          'failed',
          'The job failed',
        );
      case 'cancelled':
        return this.save(updated, 'cancelled', 'The job was cancelled');
    }
  }

  /**
   * Downloads and checks a finished job's outputs. Outputs that are missing or don't check out
   * fail the job; a dropped connection leaves it to try again on the next check.
   */
  private async collect(
    record: TrainingJobRecord,
    backend: TrainingBackend,
    handle: BackendHandle,
    signal?: AbortSignal,
  ): Promise<TrainingJobRecord> {
    const jobDir = this.options.store.jobDir(record.id);
    try {
      const fetched = await backend.fetchArtifacts(handle, join(jobDir, 'artifacts'), signal);
      const { manifest } = fetched;
      if (manifest.job_id !== record.id || manifest.dataset.sha256 !== record.dataset.sha256) {
        throw new ArtifactError('The outputs belong to another job or dataset.');
      }
      if (manifest.stand_in === backend.real) {
        throw new ArtifactError(
          backend.real
            ? 'A real backend returned a stand-in adapter.'
            : 'The stand-in returned outputs that claim to be trained.',
        );
      }
      const gguf = fetched.files.find((file) => file.kind === 'gguf_lora');
      if (!gguf) throw new ArtifactError('The outputs have no GGUF adapter.');
      let check;
      try {
        check = inspectLoraAdapter(readGgufHeader(gguf.path));
      } catch (error) {
        if (error instanceof GgufError) {
          throw new ArtifactError(`The adapter is not a GGUF file: ${error.message}`);
        }
        throw error;
      }
      if (!check.ok || !check.summary) {
        throw new ArtifactError(`The GGUF adapter is not usable: ${check.problems[0] ?? ''}`);
      }
      if (check.summary.standIn !== manifest.stand_in) {
        throw new ArtifactError("The adapter's stand-in label disagrees with the job's manifest.");
      }
      const stored = (path: string) => relative(jobDir, path).split(sep).join('/');
      const manifestFile = join(jobDir, 'artifacts', 'manifest.json');
      const files = [
        ...fetched.files,
        { kind: 'manifest' as const, path: manifestFile, ...hashFile(manifestFile) },
      ];
      return this.save(
        {
          ...record,
          artifacts: {
            revision: fetched.revision,
            files: files.map((file) => ({ ...file, path: stored(file.path) })),
            ggufLora: stored(gguf.path),
            standIn: manifest.stand_in,
            trainSeconds: manifest.metrics.train_seconds,
          },
        },
        'ready',
        manifest.stand_in
          ? 'Stand-in outputs downloaded: no model was trained'
          : 'Adapter downloaded and checked',
      );
    } catch (error) {
      if (!(error instanceof ArtifactError)) throw error;
      return this.save(
        { ...record, error: { code: 'artifacts_invalid', message: error.message } },
        'failed',
        'The outputs did not check out',
      );
    }
  }

  /** Asks the provider to stop a job. A finished job, or one already stopping, is left as it is. */
  cancel(id: string, signal?: AbortSignal): Promise<TrainingJobRecord> {
    return this.jobs.run(id, async () => {
      const record = this.get(id);
      const settled =
        TERMINAL_TRAINING_STATES.has(record.state) ||
        record.state === 'cancelling' ||
        record.state === 'succeeded';
      if (settled) return record;
      const backend = this.backend(record.backend);
      if (record.provider === null) {
        // Only after a restart cut a submission off: find out whether the provider has it.
        const found = await backend.recover(id, signal);
        if (!found) return this.save(record, 'cancelled', 'Cancelled before the provider had it');
        await backend.cancel(found.handle, signal);
        return this.save(
          { ...record, provider: found.handle, providerUrl: found.url },
          'cancelling',
          'Asked the provider to stop the job',
        );
      }
      await backend.cancel(record.provider, signal);
      return this.save(record, 'cancelling', 'Asked the provider to stop the job');
    });
  }

  logs(id: string, signal?: AbortSignal): Promise<string> {
    const record = this.get(id);
    if (record.provider === null) return Promise.resolve('');
    return this.backend(record.backend).logs(record.provider, signal);
  }

  /** Checks a job until it ends, in the background. */
  private watch(id: string): void {
    if (this.watchers.has(id)) return;
    const controller = new AbortController();
    this.watchers.set(id, controller);
    const sleep = this.options.sleep ?? rest;
    const report = (error: unknown) => {
      try {
        this.options.onPollError?.(id, error);
      } catch {
        // A listener that fails must not stop the checks.
      }
    };
    void (async () => {
      try {
        while (!controller.signal.aborted) {
          let record: TrainingJobRecord;
          try {
            record = await this.poll(id, controller.signal);
          } catch (error) {
            // A failed check (a network drop, a busy provider) is reported, then tried again.
            if (!controller.signal.aborted) report(error);
            await sleep(this.options.pollMs ?? 30_000, controller.signal);
            continue;
          }
          if (TERMINAL_TRAINING_STATES.has(record.state)) break;
          await sleep(this.options.pollMs ?? 30_000, controller.signal);
        }
      } finally {
        if (this.watchers.get(id) === controller) this.watchers.delete(id);
      }
    })();
  }

  /** Stops watching jobs; they keep running at the provider and resume on the next start. */
  close(): void {
    for (const controller of this.watchers.values()) controller.abort();
    this.watchers.clear();
  }
}
