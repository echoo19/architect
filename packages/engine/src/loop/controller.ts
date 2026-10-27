import {
  emptyTotals,
  newId,
  type Job,
  type Method,
  type Run,
  type RunEvent,
} from '@architect/shared';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun, StudentTarget } from '../store/records';
import { systemClock, type Clock, type LoopDeps } from './deps';
import type { SessionOutcome } from './driver';
import { errorMessage } from './errors';
import { writeJsonFile } from './files';
import type { JobLibrary } from './jobs';
import type { DataPaths } from './paths';
import { isTerminal } from './plan';
import { fanOutSeeds } from './seeds';
import { RunSession } from './session';
import { isoNow } from './time';

export interface RunControllerOptions {
  store: EngineStore;
  paths: DataPaths;
  jobs: JobLibrary;
  deps: LoopDeps;
  clock?: Clock;
  /** Attempts in flight at once while training (default 1). The locked test runs one at a time. */
  concurrency?: number;
  /** Runs that may train or test at once (default 1); the others wait their turn. */
  maxActiveRuns?: number;
  /** Where errors from event listeners and broken sessions go. They never stop a run. */
  onError?(error: unknown): void;
}

export interface StartRunOptions {
  /**
   * Where the locked test runs: the local student by default. A hosted test is supplementary
   * (decision 009), and the report card says it didn't run offline.
   */
  lockedTestOn?: StudentTarget;
}

interface ActiveRun {
  session: RunSession;
  done: Promise<SessionOutcome | void>;
}

/**
 * Starts, pauses, resumes and stops runs, and resumes interrupted ones after a restart. Runs
 * wait in a queue so only `maxActiveRuns` use the student at once, which also keeps latency
 * measurements honest. Each active run is driven by a session that persists every step.
 */
export class RunController {
  private readonly listeners = new Set<(event: RunEvent) => void>();
  private readonly queue: string[] = [];
  private readonly active = new Map<string, ActiveRun>();
  private readonly clock: Clock;
  private readonly concurrency: number;
  private readonly maxActiveRuns: number;
  private readonly onError: (error: unknown) => void;
  private closed = false;

  constructor(private readonly options: RunControllerOptions) {
    this.clock = options.clock ?? systemClock;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.maxActiveRuns = Math.max(1, options.maxActiveRuns ?? 1);
    this.onError = options.onError ?? ((error) => console.error(error));
  }

  onEvent(listener: (event: RunEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Creates a run and queues it. It starts as soon as no other run holds the student. */
  async start(
    jobId: string,
    method: Method,
    seed?: number,
    options: StartRunOptions = {},
  ): Promise<Run> {
    const { jobs, paths, store, deps } = this.options;
    const job = await jobs.get(jobId);
    await this.checkRunnable(job, method, options);
    const runSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
    const now = isoNow(this.clock);
    const record: StoredRun = {
      run: {
        id: newId('run'),
        jobId,
        method,
        seed: runSeed,
        status: 'queued',
        phase: 'preparing',
        createdAt: now,
        updatedAt: now,
        currentVersion: 0,
        devBaseline: null,
        devCurrent: null,
        totals: emptyTotals(),
      },
      seeds: fanOutSeeds(runSeed),
      today: deps.runtime.today(job, new Date(this.clock.now())),
      lockedTestOn: options.lockedTestOn ?? 'local',
      stopRequested: false,
      freeze: null,
    };
    await writeJsonFile(paths.runJobFile(jobId, record.run.id), job);
    store.runs.insert(record);
    this.publish(record.run);
    this.enqueue(record.run.id);
    return record.run;
  }

  /** Resolves once the attempt in flight has finished and the run is parked. */
  async pause(runId: string): Promise<void> {
    const { run } = this.get(runId);
    if (isTerminal(run.status) || run.status === 'paused') return;
    const active = this.active.get(runId);
    if (active) {
      active.session.requestPause();
      await active.done;
      return;
    }
    this.dequeue(runId);
    this.update(runId, { status: 'paused' });
  }

  async resume(runId: string): Promise<void> {
    const active = this.active.get(runId);
    if (active) {
      active.session.cancelPause();
      if (this.get(runId).run.status !== 'paused') return;
      await active.done;
    }
    if (this.get(runId).run.status !== 'paused') return;
    this.update(runId, { status: 'queued', error: undefined });
    this.enqueue(runId);
  }

  /**
   * Finishes the current step and skips to the locked test, so the user still gets a report
   * card. A run that never kept a change ends without a test. A locked test that has started
   * isn't stopped.
   */
  async stop(runId: string): Promise<void> {
    const before = this.get(runId);
    if (isTerminal(before.run.status) || before.run.phase === 'testing' || before.stopRequested) {
      return;
    }
    const active = this.active.get(runId);
    if (active) {
      if (this.get(runId).run.status !== 'paused') {
        this.update(runId, { status: 'stopping' }, { stopRequested: true });
        return;
      }
      await active.done;
    }
    const kept = this.options.store.rounds
      .list(runId)
      .some(({ round }) => round.decision === 'kept');
    if (kept) {
      this.update(runId, { status: 'queued', error: undefined }, { stopRequested: true });
      this.enqueue(runId);
      return;
    }
    this.dequeue(runId);
    this.update(runId, {
      status: 'stopped',
      phase: 'done',
      stopReason: 'user',
      endedAt: isoNow(this.clock),
    });
  }

  /** On startup: runs that were active when the app closed resume from their last saved step. */
  recover(): void {
    const interrupted = this.options.store.runs.withStatus([
      'queued',
      'running',
      'stopping',
      'testing',
    ]);
    for (const { run } of interrupted) {
      if (this.active.has(run.id) || this.queue.includes(run.id)) continue;
      if (run.status !== 'queued') this.update(run.id, { status: 'queued' });
      this.queue.push(run.id);
    }
    this.pump();
  }

  /** Resolves when no run is active. */
  async idle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.all([...this.active.values()].map((active) => active.done));
    }
  }

  /** Aborts active sessions for shutdown. Their runs stay resumable for `recover`. */
  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    for (const { session } of this.active.values()) session.abort();
    await this.idle();
  }

  private async checkRunnable(job: Job, method: Method, options: StartRunOptions): Promise<void> {
    const { jobs, deps } = this.options;
    if ((await jobs.tasks(job.id, 'dev')).length === 0) {
      throw new Error(`"${job.name}" has no dev tasks yet; import its tasks first.`);
    }
    if (method !== 'bare' && (await jobs.tasks(job.id, 'train')).length === 0) {
      throw new Error(`"${job.name}" has no train tasks yet; import its tasks first.`);
    }
    if ((await deps.vault.count(job.id)) === 0) {
      throw new Error(`"${job.name}" has no locked test tasks.`);
    }
    if ((method === 'architect' || method === 'one_shot') && job.mentor.kind !== 'model') {
      throw new Error('Coding-agent mentors are not supported yet; pick a model mentor.');
    }
    const needsHosted = job.student.trainOn === 'hosted' || options.lockedTestOn === 'hosted';
    if (needsHosted && !job.student.hosted) {
      throw new Error(`"${job.name}" has no hosted student endpoint.`);
    }
  }

  private get(runId: string): StoredRun {
    const record = this.options.store.runs.get(runId);
    if (!record) throw new Error(`There is no run "${runId}".`);
    return record;
  }

  /** Writes a run that no session is changing, and announces it. */
  private update(
    runId: string,
    patch: Partial<Run>,
    extra: Partial<Omit<StoredRun, 'run'>> = {},
  ): void {
    const record = this.get(runId);
    const run: Run = { ...record.run, ...patch, updatedAt: isoNow(this.clock) };
    this.options.store.runs.update({ ...record, ...extra, run });
    this.publish(run);
  }

  private enqueue(runId: string): void {
    if (!this.active.has(runId) && !this.queue.includes(runId)) this.queue.push(runId);
    this.pump();
  }

  private dequeue(runId: string): void {
    const index = this.queue.indexOf(runId);
    if (index >= 0) this.queue.splice(index, 1);
  }

  private pump(): void {
    while (!this.closed && this.active.size < this.maxActiveRuns) {
      const runId = this.queue.shift();
      if (runId === undefined) return;
      this.launch(runId);
    }
  }

  private launch(runId: string): void {
    const { store, paths, jobs, deps } = this.options;
    const session = new RunSession({
      runId,
      store,
      paths,
      jobs,
      deps,
      clock: this.clock,
      concurrency: this.concurrency,
      emit: (event) => this.dispatch(event),
    });
    const done = session
      .run()
      .catch((error: unknown) => this.settleCrashed(runId, error))
      .finally(() => {
        this.active.delete(runId);
        this.pump();
      });
    this.active.set(runId, { session, done });
  }

  /**
   * A session can fail while recording its own failure, such as a database write that fails as
   * it pauses. Its run would then look active with nothing driving it, so it is paused here
   * with the reason, and the error is reported.
   */
  private settleCrashed(runId: string, error: unknown): void {
    this.onError(error);
    const message = errorMessage(error);
    try {
      if (isTerminal(this.get(runId).run.status)) return;
      this.update(runId, { status: 'paused', error: message });
      this.dispatch({
        type: 'log',
        runId,
        at: isoNow(this.clock),
        level: 'error',
        message: `Paused after an error: ${message} Resume the run once it's fixed.`,
      });
    } catch (unrecorded) {
      this.onError(unrecorded);
    }
  }

  private publish(run: Run): void {
    this.dispatch({ type: 'run.updated', runId: run.id, at: isoNow(this.clock), run });
  }

  private dispatch(event: RunEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onError(error);
      }
    }
  }
}
