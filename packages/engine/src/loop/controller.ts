import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  CodedError,
  emptyTotals,
  GuardError,
  newId,
  type ImprovementStart,
  type ImproveOptions,
  type Job,
  type Method,
  type ReferenceRecord,
  type Run,
  type RunEvent,
  type RunImprovement,
  type StudentTarget,
  type TrainedAdapter,
} from '@architect/shared';
import { KeyedLock } from '../graduates/library';
import { improvementNote, improvementPlan, returnLessons } from '../improve/improvement';
import type { EngineStore } from '../store/engine-store';
import type { RunProtocol, StoredRun } from '../store/records';
import { configurationKey } from './configuration';
import { systemClock, type Clock, type LoopDeps } from './deps';
import type { SessionOutcome } from './driver';
import { errorMessage, must } from './errors';
import { writeJsonFile } from './files';
import type { JobLibrary } from './jobs';
import type { DataPaths } from './paths';
import { isTerminal } from './plan';
import { ReferenceSession, referenceConfig, referenceRefusal, referenceSeed } from './reference';
import { RepeatSession, repeatRefusal } from './repeat';
import { CertifySession } from './posthoc';
import { QualifySession, qualifyRefusal } from './qualify';
import { RetestSession, retestRefusal } from './retest';
import type { SessionContext } from './run-state';
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
  /** Runs and re-tests that may use the student at once (default 1); the others wait their turn. */
  maxActiveRuns?: number;
  /** Where errors from event listeners and broken sessions go. They never stop a run. */
  onError?(error: unknown): void;
  /**
   * The graduate library's lock, so a run writing an agent's version waits for its other
   * writers, and a run using llama-server waits for checks using it.
   */
  libraryLock?: KeyedLock;
}

export interface StartRunOptions {
  /**
   * Where the locked test runs: the local student by default. A hosted test is supplementary
   * (decision 009), and the report card says it didn't run offline.
   */
  lockedTestOn?: StudentTarget;
  /** Someone is there to answer a clarifying question; runs from scripts aren't. */
  interactive?: boolean;
  /** What a comparison holds the run to beyond its job (decision 045); none from the app. */
  protocol?: RunProtocol;
}

interface ActiveRun {
  session: RunSession;
  done: Promise<SessionOutcome | void>;
}

interface ActiveRetest {
  session: { abort(): void };
  done: Promise<void>;
}

/**
 * What waits its turn: a run, a re-test of a finished run's graduate, or Spark run as a
 * reference on a finished run's tasks.
 */
type Turn =
  | { kind: 'run'; runId: string }
  | { kind: 'retest'; runId: string; target: StudentTarget }
  | { kind: 'repeat'; runId: string; target: StudentTarget }
  | { kind: 'reference'; runId: string; split: ReferenceRecord['split'] }
  | { kind: 'certify'; runId: string; certificationId: string }
  | { kind: 'qualify'; runId: string; orgId: string };

/** A re-test's, a repeat's or a reference's key among the sessions holding a turn. */
function sideKey(turn: Exclude<Turn, { kind: 'run' }>): string {
  switch (turn.kind) {
    case 'retest':
      return `${turn.runId}/${turn.target}`;
    case 'repeat':
      return `${turn.runId}/repeat/${turn.target}`;
    case 'reference':
      return `${turn.runId}/reference/${turn.split}`;
    case 'certify':
      return `${turn.runId}/certify/${turn.certificationId}`;
    case 'qualify':
      return `${turn.runId}/qualify/${turn.orgId}`;
  }
}

function sameTurn(a: Turn, b: Turn): boolean {
  if (a.kind === 'run' || b.kind === 'run') return a.kind === b.kind && a.runId === b.runId;
  return sideKey(a) === sideKey(b);
}

/**
 * Starts, pauses, resumes and stops runs, re-tests finished runs' graduates, and resumes
 * whatever was interrupted after a restart. Runs and re-tests wait in one queue so only
 * `maxActiveRuns` use the student at once, which also keeps latency measurements honest. Each
 * is driven by a session that persists every step.
 */
export class RunController {
  private readonly listeners = new Set<(event: RunEvent) => void>();
  /** Each run's job, so its events go to its folder without a lookup per event. */
  private readonly jobOfRun = new Map<string, string>();
  private readonly queue: Turn[] = [];
  private readonly active = new Map<string, ActiveRun>();
  /** Re-tests holding the student, by run and target. */
  private readonly retesting = new Map<string, ActiveRetest>();
  private readonly clock: Clock;
  private readonly concurrency: number;
  private readonly maxActiveRuns: number;
  private readonly onError: (error: unknown) => void;
  private readonly libraryLock: KeyedLock;
  private closed = false;

  constructor(private readonly options: RunControllerOptions) {
    this.clock = options.clock ?? systemClock;
    this.concurrency = Math.max(1, options.concurrency ?? 1);
    this.maxActiveRuns = Math.max(1, options.maxActiveRuns ?? 1);
    this.onError = options.onError ?? ((error) => console.error(error));
    this.libraryLock = options.libraryLock ?? new KeyedLock();
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
    const job = await this.options.jobs.get(jobId);
    await this.checkRunnable(job, method, options);
    const record = await this.create(job, method, seed, options);
    this.enqueue(record.run.id);
    return record.run;
  }

  /**
   * Improve agent (spec section 8): a run on an agent's job that starts from its active version
   * with every lesson in its queue, within the budget the person was shown, and ends in a
   * candidate version of that agent. The active version keeps answering and never changes. Like
   * any run it waits its turn while another holds the student, and says so.
   */
  improve(graduateId: string, options: ImproveOptions): Promise<ImprovementStart> {
    // One at a time per agent, so two quick asks can't both pass the check for a running one.
    return this.libraryLock.run(graduateId, () => this.startImprovement(graduateId, options));
  }

  private async startImprovement(
    graduateId: string,
    options: ImproveOptions,
  ): Promise<ImprovementStart> {
    const { jobs, store, paths } = this.options;
    const plan = improvementPlan(store, paths, graduateId);
    const job = await jobs.get(plan.jobId);
    if (job.sharing?.corrections !== true) {
      throw new GuardError(
        'permission',
        `${job.name} no longer shares corrections with the mentor, so Improve agent can't send it the lessons. Allow sharing corrections in the job's data settings.`,
      );
    }
    await this.checkRunnable(job, 'architect', {});
    const budgeted: Job = {
      ...job,
      budget: { ...job.budget, maxRounds: options.maxRounds, maxMentorUsd: options.maxMentorUsd },
    };
    const { adapter, name: _name, jobId: _jobId, ...improves } = plan;
    // The lessons are taken in the transaction that writes the run, and only those still queued.
    const record = await this.create(
      budgeted,
      'architect',
      undefined,
      {},
      improves,
      adapter,
      (runId) => {
        const at = isoNow(this.clock);
        for (const id of improves.corrections) {
          const correction = store.corrections.get(id);
          if (correction?.status !== 'queued') continue;
          store.corrections.put({ ...correction, runId, updatedAt: at });
        }
      },
    );
    this.enqueue(record.run.id);
    const started = this.active.has(record.run.id);
    return { runId: record.run.id, started, note: improvementNote(plan, options, started) };
  }

  /** Writes a new run, with the copy of its job it reads from then on. */
  private async create(
    job: Job,
    method: Method,
    seed: number | undefined,
    options: StartRunOptions,
    improves?: RunImprovement,
    adapter?: TrainedAdapter,
    alongside?: (runId: string) => void,
  ): Promise<StoredRun> {
    const { paths, store, deps } = this.options;
    const runSeed = seed ?? Math.floor(Math.random() * 2 ** 31);
    const now = isoNow(this.clock);
    const record: StoredRun = {
      run: {
        id: newId('run'),
        jobId: job.id,
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
        ...(adapter === undefined ? {} : { currentAdapter: adapter }),
      },
      seeds: fanOutSeeds(runSeed),
      today: deps.runtime.today(job, new Date(this.clock.now())),
      lockedTestOn: options.lockedTestOn ?? 'local',
      stopRequested: false,
      freeze: null,
      ...(options.interactive === true ? { interactive: true } : {}),
      ...(improves === undefined ? {} : { improves }),
      ...(options.protocol === undefined ? {} : { protocol: options.protocol }),
    };
    await writeJsonFile(paths.runJobFile(job.id, record.run.id), job);
    store.transaction(() => {
      store.runs.insert(record);
      alongside?.(record.run.id);
    });
    this.publish(record.run);
    return record;
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
    // Going on is working on the job's records as they are now, so a rule that is no longer
    // confirmed over them is said at once, to whoever asked, and the run stays paused.
    await this.requireRules(runId);
    this.update(runId, { status: 'queued', error: undefined });
    this.enqueue(runId);
  }

  /** Refuses, with the reason, work on a run's job whose rules are not confirmed over its records. */
  private async requireRules(runId: string): Promise<void> {
    const { jobs } = this.options;
    await jobs.requireConfirmedRules(await jobs.forRun(this.get(runId)));
  }

  /**
   * Finishes the current step and skips to the locked test, so the user still gets a report
   * card. A run that never kept a change ends without a test. A locked test that has started
   * isn't stopped. An improvement takes no locked test, so it stops even while it writes its
   * candidate.
   */
  async stop(runId: string): Promise<void> {
    const before = this.get(runId);
    if (isTerminal(before.run.status)) return;
    if (before.improves !== undefined && before.run.phase === 'testing') {
      await this.stopWriting(runId, before.improves);
      return;
    }
    if (before.run.phase === 'testing' || before.stopRequested) return;
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

  /**
   * Stops an improvement while it freezes and writes its candidate, which may fail every time it
   * tries (decision 042). A step in flight finishes first, and a candidate it wrote by then
   * stands. Otherwise the improvement ends stopped with no candidate, and its lessons go back to
   * the queue.
   */
  private async stopWriting(runId: string, improves: RunImprovement): Promise<void> {
    const active = this.active.get(runId);
    if (active) {
      active.session.requestPause();
      await active.done;
    }
    const record = this.get(runId);
    if (isTerminal(record.run.status)) return;
    this.dequeue(runId);
    const { store } = this.options;
    const at = isoNow(this.clock);
    const run: Run = {
      ...record.run,
      status: 'stopped',
      phase: 'done',
      stopReason: 'user',
      error: undefined,
      endedAt: at,
      updatedAt: at,
    };
    store.transaction(() => {
      returnLessons(store, improves, runId, at);
      store.runs.update({ ...record, stopRequested: true, run });
    });
    this.publish(run);
    this.dispatch({
      type: 'log',
      runId,
      at,
      level: 'info',
      message: 'Stopped before its version was written. Its lessons are back in the queue.',
    });
  }

  /**
   * Queues a re-test of a finished run's frozen graduate on the run's other student endpoint:
   * the harness version and student it was frozen with, the run's test seed, and no mentor. It
   * files its own report card and never changes the run. Each target is re-tested once; asking
   * again only resumes a re-test that an error paused.
   */
  async retest(runId: string, target: StudentTarget): Promise<void> {
    const job = await this.options.jobs.forWork(this.get(runId));
    const refusal = retestRefusal(this.get(runId), job, target);
    if (refusal !== null) throw new Error(refusal);
    const { store } = this.options;
    const turn: Turn = { kind: 'retest', runId, target };
    const existing = store.retests.get(runId, target);
    if (existing?.status === 'finished') {
      throw new Error(`This run's graduate was already re-tested on the ${target} student.`);
    }
    if (existing?.status === 'testing' && this.isScheduled(turn)) {
      throw new Error(`This run's graduate is already being re-tested on the ${target} student.`);
    }
    if (existing === null) {
      store.retests.insert({ runId, target, status: 'testing', startedAt: isoNow(this.clock) });
    } else if (existing.status === 'paused') {
      store.retests.update({ ...existing, status: 'testing', error: undefined });
    }
    this.schedule(turn);
  }

  /**
   * Queues a finished run's frozen version for its locked test on an organization sealed after
   * its job was made, named as the person named it (decision 085). It never changes the run, and
   * its results join the report's organizations. Asking again only resumes one an error paused.
   */
  async qualify(runId: string, orgName: string): Promise<void> {
    const record = this.get(runId);
    const refusal = qualifyRefusal(record);
    if (refusal !== null) throw new Error(refusal);
    const { store, deps } = this.options;
    const org = (await deps.vault.addedOrganizations(record.run.jobId)).find(
      (item) => item.name === orgName,
    );
    if (org === undefined) {
      throw new Error(`No organization called ${orgName} was added to this run's field.`);
    }
    const turn: Turn = { kind: 'qualify', runId, orgId: org.id };
    const existing = store.qualifications.get(runId, org.id);
    if (existing?.status === 'finished') {
      throw new Error(`This run's version was already qualified at ${orgName}.`);
    }
    if (existing?.status === 'testing' && this.isScheduled(turn)) {
      throw new Error(`This run's version is already being qualified at ${orgName}.`);
    }
    if (existing === null) {
      store.qualifications.insert({
        runId,
        orgId: org.id,
        orgName: org.name,
        seq: store.qualifications.list(runId).length + 1,
        status: 'testing',
        startedAt: isoNow(this.clock),
      });
    } else if (existing.status === 'paused') {
      const { error: _error, ...rest } = existing;
      store.qualifications.update({ ...rest, status: 'testing' });
    }
    this.schedule(turn);
  }

  /**
   * Lifts a run's hold on its locked test (decision 045). A comparison releases its arms only
   * once every one of them is frozen, so no locked result exists while any arm still learns.
   * A run held and parked is queued again; one not frozen yet takes its test once it is.
   */
  release(runId: string): void {
    const record = this.get(runId);
    if (record.protocol?.holdTest !== true || record.protocol.released === true) return;
    this.options.store.runs.update({
      ...record,
      protocol: { ...record.protocol, released: true },
    });
    // A run still training reads the release when it reaches its test; a parked one goes again.
    const active = this.active.get(runId);
    if (active) {
      void active.done
        .then(() => this.requeueReleased(runId))
        .catch((error: unknown) => this.onError(error));
    } else {
      this.requeueReleased(runId);
    }
  }

  /** Queues a released run that parked frozen, waiting for the release. */
  private requeueReleased(runId: string): void {
    const { run, freeze: frozen } = this.get(runId);
    if (run.status !== 'paused' || frozen === null || this.closed) return;
    if (this.isScheduled({ kind: 'run', runId })) return;
    this.update(runId, { status: 'queued', error: undefined });
    this.enqueue(runId);
  }

  /**
   * Queues the frozen graduate's locked test under the declared seeds its protocol deferred, on
   * `target` (decision 045). Each target is repeated once; asking again only resumes a repeat
   * that an error paused.
   */
  async repeat(runId: string, target: StudentTarget): Promise<void> {
    const record = this.get(runId);
    const job = await this.options.jobs.forWork(record);
    const { store } = this.options;
    const refusal = repeatRefusal(store, record, job, target);
    if (refusal !== null) throw new Error(refusal);
    const turn: Turn = { kind: 'repeat', runId, target };
    const existing = store.repeats.get(runId, target);
    if (existing?.status === 'finished') {
      throw new Error(`This run's locked test was already repeated on the ${target} student.`);
    }
    if (existing?.status === 'testing' && this.isScheduled(turn)) {
      throw new Error(`This run's locked test is already being repeated on the ${target} student.`);
    }
    if (existing === null) {
      store.repeats.insert({ runId, target, status: 'testing', startedAt: isoNow(this.clock) });
    } else if (existing.status === 'paused') {
      store.repeats.update({ ...existing, status: 'testing', error: undefined });
    }
    this.schedule(turn);
  }

  /**
   * Queues a planned certification of a frozen version, or resumes a paused one (decision 079).
   * It holds the student like a re-test, and never changes the run.
   */
  certify(certificationId: string): void {
    const { store } = this.options;
    const stored = store.certifications.get(certificationId);
    if (stored === null) throw new Error(`There is no certification "${certificationId}".`);
    if (stored.status === 'finished') throw new Error('This certification has finished.');
    const turn: Turn = { kind: 'certify', runId: stored.runId, certificationId };
    if (stored.status === 'certifying' && this.isScheduled(turn)) {
      throw new Error('This version is already being certified.');
    }
    if (stored.status !== 'certifying') {
      store.certifications.update({ ...stored, status: 'certifying', error: undefined });
    }
    this.schedule(turn);
  }

  /** On startup: runs and re-tests that were active when the app closed resume where they were. */
  recover(): void {
    const { store } = this.options;
    for (const { run } of store.runs.withStatus(['queued', 'running', 'stopping', 'testing'])) {
      if (this.isScheduled({ kind: 'run', runId: run.id })) continue;
      if (run.status !== 'queued') this.update(run.id, { status: 'queued' });
      this.queue.push({ kind: 'run', runId: run.id });
    }
    for (const { runId, target } of store.retests.withStatus('testing')) {
      const turn: Turn = { kind: 'retest', runId, target };
      if (!this.isScheduled(turn)) this.queue.push(turn);
    }
    for (const { runId, target } of store.repeats.withStatus('testing')) {
      const turn: Turn = { kind: 'repeat', runId, target };
      if (!this.isScheduled(turn)) this.queue.push(turn);
    }
    for (const { runId, split } of store.references.withStatus('running')) {
      const turn: Turn = { kind: 'reference', runId, split };
      if (!this.isScheduled(turn)) this.queue.push(turn);
    }
    for (const { runId, id } of store.certifications.withStatus('certifying')) {
      const turn: Turn = { kind: 'certify', runId, certificationId: id };
      if (!this.isScheduled(turn)) this.queue.push(turn);
    }
    for (const { runId, orgId } of store.qualifications.withStatus('testing')) {
      const turn: Turn = { kind: 'qualify', runId, orgId };
      if (!this.isScheduled(turn)) this.queue.push(turn);
    }
    this.pump();
  }

  /**
   * Queues Spark as a reference on a finished run's dev or locked test tasks, with a dollar cap
   * disclosed up front. Each split is measured once; asking again only resumes one an error
   * paused.
   */
  async reference(runId: string, split: ReferenceRecord['split'], maxUsd: number): Promise<void> {
    const record = this.get(runId);
    const job = await this.options.jobs.forWork(record);
    const refusal = referenceRefusal(record, job, split);
    if (refusal !== null) throw new Error(refusal);
    const { store } = this.options;
    const turn: Turn = { kind: 'reference', runId, split };
    const existing = store.references.get(runId, split);
    if (existing?.status === 'finished') {
      throw new Error(`Spark was already measured on this run's ${split} tasks.`);
    }
    if (existing?.status === 'running' && this.isScheduled(turn)) {
      throw new Error(`Spark is already being measured on this run's ${split} tasks.`);
    }
    const frozen = must(record.freeze, 'The frozen graduate');
    const started = isoNow(this.clock);
    store.references.put(
      existing === null
        ? {
            runId,
            split,
            harnessVersion: frozen.harnessVersion,
            model: job.mentor.kind === 'model' ? job.mentor.model : job.mentor.label,
            configKey: configurationKey(referenceConfig(job)),
            status: 'running',
            maxUsd,
            spentUsd: 0,
            inputTokens: 0,
            outputTokens: 0,
            seed: referenceSeed(record, split),
            score: null,
            perType: [],
            latencyMs: null,
            startedAt: started,
          }
        : { ...existing, status: 'running', maxUsd, error: undefined },
    );
    this.schedule(turn);
  }

  /**
   * Whether a run, a re-test or a reference holds the student or waits its turn for it, so a
   * run started now would wait.
   */
  studentBusy(): boolean {
    return this.active.size + this.retesting.size >= this.maxActiveRuns || this.queue.length > 0;
  }

  /** Resolves when no run or re-test is active. */
  async idle(): Promise<void> {
    while (this.active.size > 0 || this.retesting.size > 0) {
      const sessions = [...this.active.values(), ...this.retesting.values()];
      await Promise.all(sessions.map(({ done }) => done));
    }
  }

  /** Aborts active sessions for shutdown. Their runs and re-tests stay resumable for `recover`. */
  async close(): Promise<void> {
    this.closed = true;
    this.queue.length = 0;
    for (const { session } of [...this.active.values(), ...this.retesting.values()]) {
      session.abort();
    }
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
    // A rule the person hasn't confirmed over these records would make the final test a measure of
    // nothing anyone agreed to (decision 061).
    await jobs.requireConfirmedRules(job);
  }

  private get(runId: string): StoredRun {
    const record = this.options.store.runs.get(runId);
    if (!record) throw new CodedError('run_not_found', `There is no run "${runId}".`);
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

  /** Whether the turn is waiting in the queue or holding the student. */
  private isScheduled(turn: Turn): boolean {
    const holding =
      turn.kind === 'run' ? this.active.has(turn.runId) : this.retesting.has(sideKey(turn));
    return holding || this.queue.some((queued) => sameTurn(queued, turn));
  }

  private schedule(turn: Turn): void {
    if (!this.isScheduled(turn)) this.queue.push(turn);
    this.pump();
  }

  private enqueue(runId: string): void {
    this.schedule({ kind: 'run', runId });
  }

  private dequeue(runId: string): void {
    const index = this.queue.findIndex((turn) => sameTurn(turn, { kind: 'run', runId }));
    if (index >= 0) this.queue.splice(index, 1);
  }

  private pump(): void {
    while (!this.closed && this.active.size + this.retesting.size < this.maxActiveRuns) {
      const turn = this.queue.shift();
      if (turn === undefined) return;
      if (turn.kind === 'run') this.launch(turn.runId);
      else this.launchSide(turn);
    }
  }

  private sessionContext(runId: string): SessionContext {
    const { store, paths, jobs, deps } = this.options;
    return {
      runId,
      store,
      paths,
      jobs,
      deps,
      clock: this.clock,
      concurrency: this.concurrency,
      libraryLock: this.libraryLock,
      emit: (event) => this.dispatch(event),
    };
  }

  private launch(runId: string): void {
    const session = new RunSession(this.sessionContext(runId));
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
   * A re-test or a reference. One that fails even to record its own error stays active, and
   * asking again resumes it.
   */
  private launchSide(turn: Exclude<Turn, { kind: 'run' }>): void {
    const key = sideKey(turn);
    const context = this.sessionContext(turn.runId);
    const session =
      turn.kind === 'retest'
        ? new RetestSession(context, turn.target)
        : turn.kind === 'repeat'
          ? new RepeatSession(context, turn.target)
          : turn.kind === 'certify'
            ? new CertifySession(context, turn.certificationId)
            : turn.kind === 'qualify'
              ? new QualifySession(context, turn.orgId)
              : new ReferenceSession(context, turn.split);
    const done = session
      .run()
      .catch((error: unknown) => this.onError(error))
      .finally(() => {
        this.retesting.delete(key);
        this.pump();
      });
    this.retesting.set(key, { session, done });
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
    this.keep(event);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (error) {
        this.onError(error);
      }
    }
  }

  /**
   * Appends the event to its run's `events.jsonl`, so what the screens saw live can be shown
   * again from the records. A failure to write it is reported and never stops the run.
   */
  private keep(event: RunEvent): void {
    try {
      let jobId = this.jobOfRun.get(event.runId);
      if (jobId === undefined) {
        const record = this.options.store.runs.get(event.runId);
        if (record === null) return;
        jobId = record.run.jobId;
        this.jobOfRun.set(event.runId, jobId);
      }
      const file = this.options.paths.eventsFile(jobId, event.runId);
      mkdirSync(dirname(file), { recursive: true });
      appendFileSync(
        file,
        `${JSON.stringify(event)}
`,
      );
    } catch (error) {
      this.onError(error);
    }
  }
}
