import type { Job, Round, Run, RunEvent, RunStopReason, Task } from '@architect/shared';
import type { AttemptFilter, EngineStore } from '../store/engine-store';
import type { StoredAttempt, StoredRound, StoredRun } from '../store/records';
import { resultOf, type EvaluationResult } from './attempts';
import { BudgetGuard } from './budget';
import { configurationKey, STUDENT_CONFIG, type AttemptConfig } from './configuration';
import type { Clock, HarnessVersionStore, LoopDeps } from './deps';
import { must } from './errors';
import type { JobLibrary } from './jobs';
import { LineageLog } from './lineage';
import type { DataPaths } from './paths';
import { MAX_REJECTED_IN_A_ROW } from './plan';
import { SessionResources, type LogLevel } from './resources';
import { roundSeed, sampleTrainBatch } from './seeds';
import { isoNow } from './time';

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type RunEventBody = DistributiveOmit<RunEvent, 'runId' | 'at'>;

export interface SessionContext {
  runId: string;
  store: EngineStore;
  paths: DataPaths;
  jobs: JobLibrary;
  deps: LoopDeps;
  clock: Clock;
  /** Attempts in flight at once while training. The locked test runs one at a time. */
  concurrency: number;
  emit(event: RunEvent): void;
}

/** Shared between the controller and the session it started. */
export interface SessionControl {
  pauseRequested: boolean;
  readonly abort: AbortController;
}

type RunPatch = Partial<Run> | ((run: Run) => Partial<Run>);
type RecordPatch = Partial<Omit<StoredRun, 'run'>>;

export const TRAINING_ENDED: Record<RunStopReason | 'complete', string> = {
  complete: 'Training is complete.',
  target_met: 'Dev reached the target pass rate.',
  rounds: 'Every round in the budget is used.',
  usd: 'The mentor dollar budget is spent.',
  wall_clock: 'The wall-clock budget is spent.',
  patience: 'Too many rounds in a row brought no kept change.',
  rejected: `${MAX_REJECTED_IN_A_ROW} rounds in a row ended with a reply or change set that couldn't be used, so training ended.`,
  leak: 'The leak check refused a mentor call, so training ended before any later round could send the same data.',
  user: 'Stopped by you.',
  error: 'Training ended after an error.',
  contract:
    'Your answer changes what counts as success, so this run stopped: its locked test belongs to the job as it was. Start a new run on the changed job.',
};

/** The run patch that ends training and hands the run to its locked test. */
export function trainingEnd(reason: RunStopReason | undefined): Partial<Run> {
  return { status: 'testing', phase: 'testing', stopReason: reason };
}

/**
 * One session's view of a run, shared by its steps: the persisted record, the session's
 * collaborators, and the helpers that persist and announce each change. The record is read
 * fresh on every access, so a stop the controller records mid-step is never overwritten.
 */
export class RunState {
  readonly budget: BudgetGuard;
  readonly versions: HarnessVersionStore;
  readonly lineage: LineageLog;
  readonly resources: SessionResources;
  readonly jobDir: string;

  constructor(
    readonly ctx: SessionContext,
    readonly control: SessionControl,
    readonly job: Job,
  ) {
    const { run } = this.record;
    this.jobDir = ctx.paths.jobDir(run.jobId);
    this.versions = ctx.deps.harness.versions(ctx.paths.harnessDir(run.jobId, run.id));
    this.lineage = new LineageLog(ctx.paths.lineageFile(run.jobId, run.id));
    this.budget = new BudgetGuard(
      job.budget,
      { rounds: run.totals.rounds, usd: run.totals.mentorUsd, wallMs: run.totals.wallMs },
      ctx.clock,
    );
    this.resources = new SessionResources({
      deps: ctx.deps,
      job,
      jobDir: this.jobDir,
      dataDir: ctx.paths.dataDir(run.jobId),
      runId: run.id,
      versions: this.versions,
      budget: this.budget,
      fromStored: (path) => ctx.paths.fromStored(path),
      log: (level, message) => this.log(level, message),
    });
  }

  // Reading

  get record(): StoredRun {
    return must(this.ctx.store.runs.get(this.ctx.runId), `Run ${this.ctx.runId}`);
  }

  get run(): Run {
    return this.record.run;
  }

  get signal(): AbortSignal {
    return this.control.abort.signal;
  }

  rounds(): StoredRound[] {
    return this.ctx.store.rounds.list(this.ctx.runId);
  }

  round(index: number): StoredRound {
    return must(this.ctx.store.rounds.get(this.ctx.runId, index), `Round ${index}`);
  }

  attempts(filter: Omit<AttemptFilter, 'runId'>): StoredAttempt[] {
    return this.ctx.store.attempts.list({ runId: this.ctx.runId, ...filter });
  }

  /**
   * A version's result in one dev evaluation, every repeat added up: the baseline's (round
   * null) or a round's, where the candidate and the incumbent are measured side by side. With
   * `seeds`, only the attempts under those seeds, such as a round's first measurement. Only the
   * attempts made under `config` count: the job's student with no adapter unless it says.
   */
  devResult(
    version: number,
    round: number | null,
    seeds?: readonly number[],
    config: AttemptConfig = STUDENT_CONFIG,
  ): EvaluationResult {
    const attempts = this.attempts({
      split: 'dev',
      version,
      round,
      target: this.job.student.trainOn,
      config: configurationKey(config),
    });
    return resultOf(
      seeds === undefined ? attempts : attempts.filter((attempt) => seeds.includes(attempt.seed)),
      this.job,
    );
  }

  /**
   * Whether the round's author writes a whole harness rather than one change: the one-shot
   * method's only round, and in a run that starts from a blank harness every round until a
   * draft is kept (decision 026), so a draft refused even after its fix is followed by another
   * draft, not by building piece by piece. A drafting round makes no train attempts.
   */
  drafts(index: number): boolean {
    const { method } = this.run;
    if (method === 'one_shot') return true;
    if (method !== 'architect' && method !== 'self_reflection') return false;
    if (this.job.startingHarness.kind !== 'blank') return false;
    return !this.rounds().some(({ round }) => round.index < index && round.decision === 'kept');
  }

  trainTasks(): Promise<Task[]> {
    return this.ctx.jobs.tasks(this.run.jobId, 'train');
  }

  devTasks(): Promise<Task[]> {
    return this.ctx.jobs.tasks(this.run.jobId, 'dev');
  }

  /** The round's train batch, the same every time it is asked for. */
  async trainBatch(index: number): Promise<Task[]> {
    return sampleTrainBatch(
      await this.trainTasks(),
      this.job.evaluation.trainBatch,
      roundSeed(this.record.seeds.trainBatch, index),
    );
  }

  // Writing

  now(): string {
    return isoNow(this.ctx.clock);
  }

  /** Merges a patch into the stored run; joins the caller's transaction when there is one. */
  writeRun(patch: RunPatch = {}, extra: RecordPatch = {}): Run {
    const record = this.record;
    const changes = typeof patch === 'function' ? patch(record.run) : patch;
    const run: Run = {
      ...record.run,
      ...changes,
      totals: {
        ...(changes.totals ?? record.run.totals),
        wallMs: Math.round(this.budget.wallMs()),
      },
      updatedAt: this.now(),
    };
    this.ctx.store.runs.update({ ...record, ...extra, run });
    return run;
  }

  saveRun(patch?: RunPatch, extra?: RecordPatch): void {
    this.emit({ type: 'run.updated', run: this.writeRun(patch, extra) });
  }

  setPhase(phase: Run['phase']): void {
    if (this.run.phase !== phase) this.saveRun({ phase });
  }

  saveRound(stored: StoredRound): void {
    this.ctx.store.rounds.update(stored);
    this.emit({ type: 'round.updated', round: stored.round });
  }

  /** Ends a round without a change, and training too when a stop reason is given. */
  closeRound(index: number, message: string, stopReason?: RunStopReason): void {
    const stored = this.round(index);
    const round: Round = { ...stored.round, status: 'failed', error: message, endedAt: this.now() };
    const run = this.ctx.store.transaction(() => {
      this.ctx.store.rounds.update({ ...stored, round });
      return stopReason ? this.writeRun(trainingEnd(stopReason)) : null;
    });
    this.emit({ type: 'round.updated', round });
    this.log('warn', `Round ${index} ended without a change: ${message}`);
    if (run) {
      this.emit({ type: 'run.updated', run });
      this.log('info', TRAINING_ENDED[stopReason ?? 'complete']);
    }
  }

  /**
   * Ends a round whose reply or change set can't be used. It is marked rejected, so the author
   * is shown the reason next round and the planner counts it apart from changes dev measured.
   */
  rejectRound(
    index: number,
    reason: string,
    proposal: Partial<Pick<Round, 'title' | 'diagnosis' | 'files'>> = {},
  ): void {
    const stored = this.round(index);
    const round: Round = {
      ...stored.round,
      ...proposal,
      status: 'failed',
      error: reason,
      endedAt: this.now(),
    };
    this.saveRound({ ...stored, round, rejected: true });
    this.log('warn', `Round ${index} was rejected before evaluation: ${reason}`);
  }

  // Announcing

  emit(body: RunEventBody): void {
    // The spread keeps the body's own variant; TypeScript can't see that through the union.
    this.ctx.emit({ ...body, runId: this.ctx.runId, at: this.now() } as RunEvent);
  }

  emitBudget(): void {
    this.emit({ type: 'budget', state: this.budget.state() });
  }

  log(level: LogLevel, message: string): void {
    this.emit({ type: 'log', level, message });
  }
}
