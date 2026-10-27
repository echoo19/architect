import {
  AdapterError,
  AttemptSchema,
  GuardError,
  JsonValueSchema,
  newId,
  TraceSchema,
  type Harness,
  type Hypothesis,
  type Job,
  type MentorAdapter,
  type MentorCompletionRequest,
  type ReportCard,
  type Round,
  type Run,
  type RunEvent,
  type RunStopReason,
  type Score,
  type StudentAdapter,
  type SplitName,
  type Task,
  type TypeScore,
} from '@architect/shared';
import type { GatedCompletion, MentorCharge } from '../mentor/gate';
import { diagnoseRequest, oneShotRequest, type PromptSettings } from '../mentor/prompts';
import { MentorReplyError, parseHypothesis } from '../mentor/reply';
import { studentAsMentor } from '../mentor/student-author';
import { buildMentorView, buildOneShotView, type TrainResult } from '../mentor/view';
import { buildGraduateManifest } from '../report/manifest';
import { computeReportCard } from '../report/report-card';
import type { AttemptFilter, EngineStore } from '../store/engine-store';
import type {
  AuthorReply,
  GraduateFreeze,
  StoredAttempt,
  StoredRound,
  StoredRun,
  StudentTarget,
} from '../store/records';
import {
  answerSummary,
  expectedSummary,
  resultOf,
  studentPrice,
  type EvaluationResult,
} from './attempts';
import { BudgetGuard } from './budget';
import {
  HARNESS_VALIDATION_ERROR,
  type Clock,
  type EvaluatedTask,
  type EvaluationContext,
  type HarnessVersionStore,
  type LoopDeps,
} from './deps';
import { readJsonFile, writeJsonFile } from './files';
import type { JobLibrary } from './jobs';
import { decideKeep, formatScore, type KeepDecision } from './keep';
import { LineageLog } from './lineage';
import type { DataPaths } from './paths';
import { planNextStep, type ActionStep, type PlanInput } from './plan';
import { runPool } from './pool';
import { errorMessage, must } from './errors';
import { SessionResources, type LogLevel } from './resources';
import { roundSeed, sampleTrainBatch } from './seeds';
import { startingHarness, studentEndpoint } from './setup';
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

export type SessionOutcome = 'parked' | 'ended' | 'aborted';

interface EvaluationSpec {
  tasks: readonly Task[];
  split: SplitName;
  round: number | null;
  version: number;
  seed: number;
  target: StudentTarget;
  /** Training evaluations halt for a stop or a spent wall clock; the locked test doesn't. */
  training: boolean;
  concurrency: number;
}

type RunPatch = Partial<Run> | ((run: Run) => Partial<Run>);
type RecordPatch = Partial<Omit<StoredRun, 'run'>>;

const TRAINING_ENDED: Record<RunStopReason | 'complete', string> = {
  complete: 'Training is complete.',
  target_met: 'Dev reached the target pass rate.',
  rounds: 'Every round in the budget is used.',
  usd: 'The mentor dollar budget is spent.',
  wall_clock: 'The wall-clock budget is spent.',
  patience: 'Too many rounds in a row brought no kept change.',
  user: 'Stopped by you.',
  error: 'Training ended after an error.',
};

function trainingEnd(reason: RunStopReason | undefined): Partial<Run> {
  return { status: 'testing', phase: 'testing', stopReason: reason };
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof AdapterError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

/** Replies that are the author's fault: the round ends without a change and training goes on. */
function isUnusableReply(error: unknown): boolean {
  return (
    error instanceof AdapterError && (error.code === 'bad_response' || error.code === 'blocked')
  );
}

function comparePerType(before: TypeScore[], after: TypeScore[]) {
  const types = [...new Set([...before, ...after].map((score) => score.type))];
  return types.map((type) => ({
    type,
    before: before.find((score) => score.type === type)?.pass ?? 0,
    after: after.find((score) => score.type === type)?.pass ?? 0,
  }));
}

function oneShotDecision(before: Score, after: Score): KeepDecision {
  return {
    keep: true,
    reason: `Dev ${formatScore(before)} → ${formatScore(after)}; the one-shot method keeps its harness without a keep-or-revert check`,
  };
}

/**
 * Executes one session of a run: plans the next step from the persisted state, runs it,
 * persists the result, and repeats until the run parks or ends. The run's record is re-read
 * before every write, so a stop the controller records mid-step is never overwritten.
 */
export class RunDriver {
  private readonly budget: BudgetGuard;
  private readonly versions: HarnessVersionStore;
  private readonly lineage: LineageLog;
  private readonly resources: SessionResources;
  private readonly jobDir: string;

  constructor(
    private readonly ctx: SessionContext,
    private readonly control: SessionControl,
    private readonly job: Job,
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
      log: (level, message) => this.log(level, message),
    });
  }

  async drive(): Promise<SessionOutcome> {
    this.budget.resume();
    try {
      this.saveRun({ status: this.activeStatus(), error: undefined });
      this.emitBudget();
      for (;;) {
        const step = planNextStep(this.planInput());
        if (step.kind === 'done') return 'ended';
        if (step.kind === 'park') {
          this.budget.pause();
          this.saveRun({ status: 'paused' });
          return 'parked';
        }
        await this.execute(step);
      }
    } catch (error) {
      return this.handleError(error);
    } finally {
      this.budget.pause();
      await this.resources.close();
    }
  }

  private execute(step: ActionStep): Promise<void> | void {
    switch (step.kind) {
      case 'prepare':
        return this.prepare();
      case 'baseline':
        return this.baseline();
      case 'start_round':
        return this.startRound(step.round);
      case 'attempt_train':
        return this.attemptTrain(step.round);
      case 'author':
        return this.author(step.round);
      case 'evaluate_candidate':
        return this.evaluateCandidate(step.round);
      case 'abandon_round':
        return this.abandonRound(step.round, step.reason);
      case 'finish_training':
        return this.finishTraining(step.reason);
      case 'freeze':
        return this.freeze();
      case 'locked_test':
        return this.lockedTest();
    }
  }

  private handleError(error: unknown): SessionOutcome {
    if (this.control.abort.signal.aborted || isAbort(error)) {
      // The app is closing: keep the wall time and leave the run active, so the next start resumes it.
      this.writeRun();
      return 'aborted';
    }
    const message = errorMessage(error);
    if (this.record.run.phase === 'preparing') {
      this.saveRun({
        status: 'failed',
        phase: 'done',
        stopReason: 'error',
        error: message,
        endedAt: this.now(),
      });
      this.log('error', `The run couldn't start: ${message}`);
      return 'ended';
    }
    this.budget.pause();
    this.saveRun({ status: 'paused', error: message });
    this.log('error', `Paused after an error: ${message} Resume the run once it's fixed.`);
    return 'parked';
  }

  // Steps

  /** Saves version 0: blank for the bare baseline, otherwise the job's starting harness. */
  private async prepare(): Promise<void> {
    const { harness } = this.ctx.deps;
    const start =
      (await this.versions.latest()) ??
      (await this.versions.save(
        this.run.method === 'bare'
          ? harness.blankHarness(this.job.name, this.job.description)
          : await startingHarness(this.job, this.jobDir, harness),
      ));
    this.saveRun({ phase: 'baseline', currentVersion: start.meta.version });
  }

  private async baseline(): Promise<void> {
    this.setPhase('baseline');
    const version = this.run.currentVersion;
    const complete = await this.evaluate({
      tasks: await this.devTasks(),
      split: 'dev',
      round: null,
      version,
      seed: this.record.seeds.devPanel,
      target: this.job.student.trainOn,
      training: true,
      concurrency: this.ctx.concurrency,
    });
    if (!complete) return;
    const result = this.devResult(version);
    this.emit({ type: 'eval.finished', split: 'dev', harnessVersion: version, ...result });
    this.saveRun({ devBaseline: result.score, devCurrent: result.score });
  }

  private startRound(index: number): void {
    const oneShot = this.run.method === 'one_shot';
    const round: Round = {
      runId: this.ctx.runId,
      index,
      status: oneShot ? 'diagnosing' : 'attempting',
      train: { pass: 0, total: 0 },
      files: [],
      costUsd: 0,
      startedAt: this.now(),
    };
    const run = this.ctx.store.transaction(() => {
      this.ctx.store.rounds.insert({
        round,
        baseVersion: this.run.currentVersion,
        reply: null,
        hypothesis: null,
      });
      return this.writeRun((current) => ({
        phase: oneShot ? 'diagnosing' : 'attempting',
        totals: { ...current.totals, rounds: current.totals.rounds + 1 },
      }));
    });
    this.budget.recordRound();
    this.emit({ type: 'round.updated', round });
    this.emit({ type: 'run.updated', run });
    this.emitBudget();
  }

  private async attemptTrain(index: number): Promise<void> {
    this.setPhase('attempting');
    const { baseVersion } = this.round(index);
    const complete = await this.evaluate({
      tasks: await this.trainBatch(index),
      split: 'train',
      round: index,
      version: baseVersion,
      seed: roundSeed(this.record.seeds.trainStudent, index),
      target: this.job.student.trainOn,
      training: true,
      concurrency: this.ctx.concurrency,
    });
    if (!complete) return;
    const stored = this.round(index);
    const train = resultOf(
      this.attempts({ split: 'train', round: index, version: baseVersion }),
      this.job,
    );
    this.saveRound({
      ...stored,
      round: { ...stored.round, status: 'diagnosing', train: train.score },
    });
  }

  private async author(index: number): Promise<void> {
    this.setPhase('diagnosing');
    if (this.round(index).reply === null && !(await this.requestHypothesis(index))) return;
    await this.adoptHypothesis(this.round(index));
  }

  /** Asks the author for one hypothesis and records the reply; false when the round ended instead. */
  private async requestHypothesis(index: number): Promise<boolean> {
    const request =
      this.run.method === 'one_shot'
        ? await this.oneShotRequest()
        : await this.diagnoseRequest(this.round(index));
    const author = await this.authorFor(index);
    const gate = await this.resources.gate();

    let gated: GatedCompletion;
    try {
      gated = await gate.complete(author, request, {
        signal: this.control.abort.signal,
        onSend: () => this.emit({ type: 'mentor.started', round: index }),
        onSpent: (charge) => this.charge(index, charge),
      });
    } catch (error) {
      if (error instanceof GuardError && error.guard === 'budget') {
        this.closeRound(index, error.message, 'usd');
        return false;
      }
      if (error instanceof GuardError || isUnusableReply(error)) {
        this.closeRound(index, errorMessage(error));
        return false;
      }
      throw error;
    }

    const { completion, costUsd } = gated;
    const json = JsonValueSchema.safeParse(completion.json);
    const reply: AuthorReply = {
      text: completion.text,
      json: json.success ? json.data : undefined,
      usage: completion.usage,
      costUsd,
      model: completion.model,
      latencyMs: completion.latencyMs,
    };
    this.charge(index, { model: completion.model, usage: completion.usage, costUsd }, reply);
    await writeJsonFile(this.ctx.paths.mentorFile(this.run.jobId, this.ctx.runId, index), {
      request,
      reply,
    });
    return true;
  }

  /**
   * Charges an author call to its round, the run and the cost ledger in one transaction, with
   * the reply when there is one. Failed calls the provider billed for are charged too.
   */
  private charge(index: number, charge: MentorCharge, reply?: AuthorReply): void {
    const { store, runId } = this.ctx;
    const { model, usage, costUsd } = charge;
    const run = store.transaction(() => {
      const current = this.round(index);
      store.rounds.update({
        ...current,
        reply: reply ?? current.reply,
        round: { ...current.round, costUsd: current.round.costUsd + costUsd },
      });
      store.costs.insert({
        runId,
        role: 'mentor',
        model,
        round: index,
        attemptId: null,
        usage,
        usd: costUsd,
        at: this.now(),
      });
      return this.writeRun((current) => ({
        totals: {
          ...current.totals,
          mentorUsd: current.totals.mentorUsd + costUsd,
          mentorInputTokens: current.totals.mentorInputTokens + usage.inputTokens,
          mentorOutputTokens: current.totals.mentorOutputTokens + usage.outputTokens,
        },
      }));
    });
    this.budget.recordSpend(costUsd);
    this.emit({ type: 'mentor.finished', round: index, usage, costUsd });
    this.emit({ type: 'run.updated', run });
    this.emitBudget();
  }

  /** Applies the recorded reply's change set to a new candidate version. */
  private async adoptHypothesis(stored: StoredRound): Promise<void> {
    const index = stored.round.index;
    let hypothesis: Hypothesis;
    let candidate: Harness;
    try {
      hypothesis = parseHypothesis(
        must(stored.reply, 'The reply'),
        await this.visibleTaskIds(index),
      );
      candidate = this.ctx.deps.harness.applyEdits(
        await this.resources.harness(stored.baseVersion),
        hypothesis.edits,
      );
    } catch (error) {
      const rejected =
        error instanceof MentorReplyError ||
        (error instanceof GuardError && error.guard === 'harness_surface') ||
        (error instanceof Error && error.name === HARNESS_VALIDATION_ERROR);
      if (!rejected) throw error;
      this.closeRound(index, error.message);
      return;
    }
    const saved = await this.versions.save(candidate, stored.baseVersion);
    this.saveRound({
      ...stored,
      hypothesis,
      round: {
        ...stored.round,
        status: 'evaluating',
        title: hypothesis.title,
        diagnosis: hypothesis.diagnosis,
        predicted: hypothesis.predicted,
        files: [...new Set(hypothesis.edits.map((edit) => edit.path))],
        candidateVersion: saved.meta.version,
      },
    });
  }

  private async evaluateCandidate(index: number): Promise<void> {
    this.setPhase('evaluating');
    const { baseVersion, round } = this.round(index);
    const candidate = must(round.candidateVersion, 'The candidate version');
    const complete = await this.evaluate({
      tasks: await this.devTasks(),
      split: 'dev',
      round: index,
      version: candidate,
      seed: this.record.seeds.devPanel,
      target: this.job.student.trainOn,
      training: true,
      concurrency: this.ctx.concurrency,
    });
    if (!complete) return;
    const before = this.devResult(baseVersion);
    const after = this.devResult(candidate);
    this.emit({ type: 'eval.finished', split: 'dev', harnessVersion: candidate, ...after });
    const decision =
      this.run.method === 'one_shot'
        ? oneShotDecision(before.score, after.score)
        : decideKeep({
            before: before.score,
            after: after.score,
            beforePerType: before.perType,
            afterPerType: after.perType,
            evaluation: this.job.evaluation,
          });
    await this.decide(this.round(index), before, after, decision);
  }

  /** Logs the hypothesis in lineage with its measured effect, and keeps or reverts it. */
  private async decide(
    stored: StoredRound,
    before: EvaluationResult,
    after: EvaluationResult,
    decision: KeepDecision,
  ): Promise<void> {
    const { round } = stored;
    const hypothesis = must(stored.hypothesis, 'The hypothesis');
    const reply = must(stored.reply, 'The reply');
    const entry = await this.lineage.record({
      id: newId('chg'),
      runId: this.ctx.runId,
      round: round.index,
      title: hypothesis.title,
      diagnosis: hypothesis.diagnosis,
      files: round.files,
      causeTaskIds: hypothesis.causeTaskIds,
      predicted: hypothesis.predicted,
      measured: {
        devBefore: before.score,
        devAfter: after.score,
        delta: after.score.pass - before.score.pass,
        perType: comparePerType(before.perType, after.perType),
      },
      decision: decision.keep ? 'kept' : 'reverted',
      decisionReason: decision.reason,
      versionFrom: stored.baseVersion,
      versionTo: must(round.candidateVersion, 'The candidate version'),
      mentor: {
        model: reply.model,
        costUsd: round.costUsd,
        inputTokens: reply.usage.inputTokens,
        outputTokens: reply.usage.outputTokens,
      },
      at: this.now(),
    });
    const decided: Round = {
      ...round,
      status: 'decided',
      devBefore: entry.measured.devBefore,
      devAfter: entry.measured.devAfter,
      decision: entry.decision,
      decisionReason: entry.decisionReason,
      endedAt: this.now(),
    };
    const { store } = this.ctx;
    const run = store.transaction(() => {
      store.rounds.update({ ...stored, round: decided });
      store.lineage.insert({
        id: entry.id,
        runId: entry.runId,
        round: entry.round,
        title: entry.title,
        decision: entry.decision,
        delta: entry.measured.delta,
        versionFrom: entry.versionFrom,
        versionTo: entry.versionTo,
        at: entry.at,
      });
      return entry.decision === 'kept'
        ? this.writeRun({ currentVersion: entry.versionTo, devCurrent: entry.measured.devAfter })
        : null;
    });
    this.emit({ type: 'round.updated', round: decided });
    if (run) this.emit({ type: 'run.updated', run });
    this.log('info', `Round ${round.index} ${entry.decision}: ${entry.decisionReason}.`);
  }

  private abandonRound(index: number, reason: string): void {
    const stored = this.round(index);
    this.saveRound({
      ...stored,
      round: { ...stored.round, status: 'failed', error: reason, endedAt: this.now() },
    });
    this.log('info', `Round ${index}: ${reason}`);
  }

  /** Ends a round without a change, and training too when the dollar cap is why. */
  private closeRound(index: number, message: string, stopReason?: RunStopReason): void {
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

  private finishTraining(reason: RunStopReason | undefined): void {
    const kept = this.rounds().some(({ round }) => round.decision === 'kept');
    if (reason === 'user' && !kept) {
      this.saveRun({ status: 'stopped', phase: 'done', stopReason: 'user', endedAt: this.now() });
      this.log('info', 'Stopped before any change was kept, so there is no graduate to test.');
      return;
    }
    this.saveRun(trainingEnd(reason));
    this.log('info', TRAINING_ENDED[reason ?? 'complete']);
  }

  /** Fixes what will ship before any test runs: the harness version, its hash and the student. */
  private async freeze(): Promise<void> {
    await this.resources.releaseMentor();
    const harness = await this.resources.harness(this.run.currentVersion);
    const pin = await (await this.resources.student('local')).describe();
    const freeze: GraduateFreeze = {
      graduateId: newId('grd'),
      harnessVersion: harness.meta.version,
      harnessHash: harness.meta.hash,
      student: {
        model: pin.model || this.job.student.local.model,
        quantization: pin.quantization,
        digest: pin.digest,
        sizeBytes: pin.sizeBytes,
        contextLength: pin.contextLength,
      },
      frozenAt: this.now(),
    };
    this.saveRun({}, { freeze });
    this.log(
      'info',
      `Graduate frozen at harness version ${freeze.harnessVersion} before its locked test.`,
    );
  }

  private async lockedTest(): Promise<void> {
    const freeze = must(this.record.freeze, 'The frozen graduate');
    const proof = await this.resources.releaseMentor();
    const tests = await this.ctx.deps.vault.openForLockedTest(this.run.jobId, proof);
    const harness = await this.resources.harness(freeze.harnessVersion);
    if (harness.meta.hash !== freeze.harnessHash) {
      throw new Error(
        `Harness version ${freeze.harnessVersion} changed after the graduate was frozen, so it won't be tested.`,
      );
    }
    const complete = await this.evaluate({
      tasks: tests,
      split: 'test',
      round: null,
      version: freeze.harnessVersion,
      seed: this.record.seeds.test,
      target: this.record.lockedTestOn,
      training: false,
      concurrency: 1,
    });
    if (complete) await this.graduate(harness, freeze);
  }

  private async graduate(harness: Harness, freeze: GraduateFreeze): Promise<void> {
    const { paths, store, deps, runId } = this.ctx;
    const target = this.record.lockedTestOn;
    const attempts = this.attempts({
      split: 'test',
      round: null,
      version: freeze.harnessVersion,
      target,
    });
    this.emit({
      type: 'eval.finished',
      split: 'test',
      harnessVersion: freeze.harnessVersion,
      ...resultOf(attempts, this.job),
    });
    const tester = await this.resources.student(target);
    const lineage = await this.lineage.read();
    const rounds = this.rounds();
    const createdAt = this.now();
    const run: Run = {
      ...this.run,
      totals: { ...this.run.totals, wallMs: Math.round(this.budget.wallMs()) },
    };
    const report = computeReportCard({
      job: this.job,
      run,
      rounds: rounds.map(({ round }) => round),
      lineage,
      test: attempts.map((attempt) => ({
        taskType: attempt.taskType,
        pass: attempt.check.pass,
        latencyMs: attempt.latencyMs,
        refused: attempt.stopReason === 'refused',
      })),
      guardrails: harness.guardrails,
      student: {
        label: this.job.student.label,
        model: tester.model,
        runtime: studentEndpoint(this.job, target).runtime,
      },
      mentor: this.authorIdentity(),
      readyClaimed: rounds.some(({ hypothesis }) => hypothesis?.readyClaim === true),
      ranOffline: target === 'local' && tester.isLocal,
      createdAt,
    });
    const manifest = buildGraduateManifest({
      freeze,
      job: this.job,
      run,
      report,
      endpoint: this.job.student.local,
      createdAt,
    });
    const dir = paths.graduateDir(freeze.graduateId);
    await deps.harness.writeGraduate(dir, { harness, manifest, report, lineage });

    const finished = store.transaction(() => {
      store.reports.put(runId, report);
      const existing = store.graduates.get(freeze.graduateId);
      const graduate = {
        id: freeze.graduateId,
        runId,
        name: this.job.name,
        path: paths.toStored(dir),
        manifest,
        settings: existing?.settings ?? null,
        createdAt,
      };
      if (existing) store.graduates.update(graduate);
      else store.graduates.insert(graduate);
      return this.writeRun({
        status: 'finished',
        phase: 'done',
        endedAt: createdAt,
        graduateId: freeze.graduateId,
      });
    });
    this.emit({ type: 'run.updated', run: finished });
    this.emit({ type: 'graduate.ready', graduateId: freeze.graduateId });
  }

  // Evaluations

  /**
   * Attempts every task of one evaluation that has no persisted attempt yet, and persists each
   * as it finishes. Resolves true once all are done, or false when it halted early (a pause, a
   * stop or the wall clock); the next session attempts only what is left.
   */
  private async evaluate(spec: EvaluationSpec): Promise<boolean> {
    const done = new Set(
      this.attempts({
        split: spec.split,
        round: spec.round,
        version: spec.version,
        target: spec.target,
      }).map((attempt) => attempt.taskId),
    );
    const remaining = spec.tasks.filter((task) => !done.has(task.id));
    if (remaining.length > 0) {
      const student = await this.resources.student(spec.target);
      const context: EvaluationContext = {
        job: this.job,
        jobDir: this.jobDir,
        harness: await this.resources.harness(spec.version),
        student,
        sandbox: await this.resources.sandbox(),
        checker: await this.resources.checker(),
        today: this.record.today,
      };
      await runPool(
        remaining,
        spec.concurrency,
        () => !this.shouldHalt(spec.training),
        async (task) => {
          this.emit({
            type: 'attempt.started',
            taskId: task.id,
            split: spec.split,
            harnessVersion: spec.version,
          });
          const evaluation = await this.ctx.deps.runtime.evaluateTasks([task], context, {
            seed: spec.seed,
            signal: this.control.abort.signal,
          });
          this.control.abort.signal.throwIfAborted();
          const item = evaluation.items.find((candidate) => candidate.task.id === task.id);
          if (!item) throw new Error(`The runtime returned no result for task ${task.id}.`);
          if (item.result.outcome.stopReason === 'aborted') {
            throw new Error(`The runtime aborted the attempt at task ${task.id}.`);
          }
          await this.recordAttempt(spec, item, student);
          done.add(task.id);
          this.reportProgress(spec, done);
        },
      );
    }
    return spec.tasks.every((task) => done.has(task.id));
  }

  private reportProgress(spec: EvaluationSpec, done: ReadonlySet<string>): void {
    if (spec.split !== 'dev' && spec.split !== 'test') return;
    const filter = {
      split: spec.split,
      round: spec.round,
      version: spec.version,
      target: spec.target,
    };
    this.emit({
      type: 'eval.progress',
      split: spec.split,
      harnessVersion: spec.version,
      done: spec.tasks.filter((task) => done.has(task.id)).length,
      total: spec.tasks.length,
      pass: this.attempts(filter).filter((attempt) => attempt.check.pass).length,
    });
  }

  private shouldHalt(training: boolean): boolean {
    if (this.control.pauseRequested) return true;
    return training && (this.record.stopRequested || this.budget.wallClockSpent());
  }

  /**
   * Persists one attempt with its student calls, in one transaction. Locked-test attempts keep
   * no trace file and no summaries, so test prompts and answers stay in the vault.
   */
  private async recordAttempt(
    spec: EvaluationSpec,
    item: EvaluatedTask,
    student: StudentAdapter,
  ): Promise<void> {
    const { store, paths, runId } = this.ctx;
    const { trace, outcome, check } = item.result;
    const id = newId('att');
    const locked = spec.split === 'test';
    const traceFile = locked ? null : paths.traceFile(this.run.jobId, runId, id);
    if (traceFile) await writeJsonFile(traceFile, trace);
    const attempt: StoredAttempt = {
      id,
      runId,
      round: spec.round,
      taskId: item.task.id,
      taskType: item.task.type,
      split: spec.split,
      harnessVersion: spec.version,
      check,
      latencyMs: trace.latencyMs,
      usage: trace.usage,
      answerSummary: locked ? undefined : answerSummary(outcome),
      expectedSummary: locked ? undefined : expectedSummary(item.task.expected),
      target: spec.target,
      seed: spec.seed,
      stopReason: outcome.stopReason,
      tracePath: traceFile && paths.toStored(traceFile),
      createdAt: this.now(),
    };
    const price = studentPrice(studentEndpoint(this.job, spec.target), student.isLocal);
    const run = store.transaction(() => {
      store.attempts.insert(attempt);
      for (const step of trace.steps) {
        if (step.kind !== 'model') continue;
        store.costs.insert({
          runId,
          role: 'student',
          model: trace.studentModel,
          round: spec.round,
          attemptId: id,
          usage: step.usage,
          usd: price(step.usage),
          at: attempt.createdAt,
        });
      }
      return this.writeRun((current) => ({
        totals: {
          ...current.totals,
          attempts: current.totals.attempts + 1,
          studentInputTokens: current.totals.studentInputTokens + trace.usage.inputTokens,
          studentOutputTokens: current.totals.studentOutputTokens + trace.usage.outputTokens,
        },
      }));
    });
    this.emit({
      type: 'attempt.finished',
      attempt: AttemptSchema.parse(attempt),
      prompt: locked ? undefined : item.task.prompt,
    });
    this.emit({ type: 'run.updated', run });
    this.emitBudget();
  }

  // Author requests

  private async authorFor(index: number): Promise<MentorAdapter> {
    if (this.run.method !== 'self_reflection') return this.resources.mentor();
    const student = await this.resources.student(this.job.student.trainOn);
    return studentAsMentor(student, roundSeed(this.record.seeds.mentor, index));
  }

  private promptSettings(): PromptSettings {
    const mentor = this.job.mentor;
    return {
      evaluation: this.job.evaluation,
      reasoningEffort:
        this.run.method !== 'self_reflection' && mentor.kind === 'model'
          ? mentor.reasoningEffort
          : undefined,
    };
  }

  private async diagnoseRequest(stored: StoredRound): Promise<MentorCompletionRequest> {
    const index = stored.round.index;
    const attempts = new Map(
      this.attempts({ split: 'train', round: index, version: stored.baseVersion }).map(
        (attempt) => [attempt.taskId, attempt],
      ),
    );
    const train: TrainResult[] = [];
    for (const task of await this.trainBatch(index)) {
      const attempt = must(attempts.get(task.id), `The train attempt at ${task.id}`);
      const tracePath = must(attempt.tracePath, `The trace of ${attempt.id}`);
      const trace = TraceSchema.parse(await readJsonFile(this.ctx.paths.fromStored(tracePath)));
      train.push({ task, pass: attempt.check.pass, reason: attempt.check.reason, trace });
    }
    const view = buildMentorView({
      job: this.job,
      dataFiles: await this.resources.dataFiles(),
      harnessFiles: await this.mentorFiles(stored.baseVersion),
      round: index,
      budgetLeft: this.budget.left(),
      train,
      dev: must(this.run.devCurrent, 'The dev score'),
      lineage: await this.lineage.read(),
    });
    return diagnoseRequest(view, this.promptSettings());
  }

  private async oneShotRequest(): Promise<MentorCompletionRequest> {
    const view = buildOneShotView({
      job: this.job,
      dataFiles: await this.resources.dataFiles(),
      harnessFiles: await this.mentorFiles(this.run.currentVersion),
      budgetLeft: this.budget.left(),
      train: await this.trainTasks(),
      devTotal: (await this.devTasks()).length,
    });
    return oneShotRequest(view, this.promptSettings());
  }

  /** Every file of a version, settings left at their defaults included, so the author sees them all. */
  private async mentorFiles(version: number): Promise<Record<string, string>> {
    return this.ctx.deps.harness.harnessToFiles(await this.resources.harness(version), {
      includeDefaults: true,
    });
  }

  /** Train task ids the author was shown, the only ones a hypothesis may cite as its cause. */
  private async visibleTaskIds(index: number): Promise<Set<string>> {
    const tasks =
      this.run.method === 'one_shot' ? await this.trainTasks() : await this.trainBatch(index);
    return new Set(tasks.map((task) => task.id));
  }

  private authorIdentity(): ReportCard['mentor'] {
    const mentor = this.job.mentor;
    switch (this.run.method) {
      case 'bare':
        return { label: 'No mentor', model: '' };
      case 'self_reflection':
        return {
          label: `${this.job.student.label} (self-reflection)`,
          model: studentEndpoint(this.job, this.job.student.trainOn).model,
        };
      default:
        return {
          label: mentor.label,
          model: mentor.kind === 'model' ? mentor.model : mentor.agent,
        };
    }
  }

  // State

  private get record(): StoredRun {
    return must(this.ctx.store.runs.get(this.ctx.runId), `Run ${this.ctx.runId}`);
  }

  private get run(): Run {
    return this.record.run;
  }

  private rounds(): StoredRound[] {
    return this.ctx.store.rounds.list(this.ctx.runId);
  }

  private round(index: number): StoredRound {
    return must(this.ctx.store.rounds.get(this.ctx.runId, index), `Round ${index}`);
  }

  private attempts(filter: Omit<AttemptFilter, 'runId'>): StoredAttempt[] {
    return this.ctx.store.attempts.list({ runId: this.ctx.runId, ...filter });
  }

  private devResult(version: number): EvaluationResult {
    return resultOf(
      this.attempts({ split: 'dev', version, target: this.job.student.trainOn }),
      this.job,
    );
  }

  private trainTasks(): Promise<Task[]> {
    return this.ctx.jobs.tasks(this.run.jobId, 'train');
  }

  private devTasks(): Promise<Task[]> {
    return this.ctx.jobs.tasks(this.run.jobId, 'dev');
  }

  private async trainBatch(index: number): Promise<Task[]> {
    return sampleTrainBatch(
      await this.trainTasks(),
      this.job.evaluation.trainBatch,
      roundSeed(this.record.seeds.trainBatch, index),
    );
  }

  private activeStatus(): Run['status'] {
    if (this.run.phase === 'testing') return 'testing';
    return this.record.stopRequested ? 'stopping' : 'running';
  }

  private planInput(): PlanInput {
    const { run, stopRequested, freeze } = this.record;
    return {
      method: run.method,
      status: run.status,
      phase: run.phase,
      stopRequested,
      pauseRequested: this.control.pauseRequested,
      devBaseline: run.devBaseline,
      devCurrent: run.devCurrent,
      frozen: freeze !== null,
      rounds: this.rounds().map(({ round }) => round),
      maxRounds: this.job.budget.maxRounds,
      patience: this.job.evaluation.patience,
      passRateTarget: this.job.requirements.passRate,
      wallClockSpent: this.budget.wallClockSpent(),
    };
  }

  // Persistence and events

  private now(): string {
    return isoNow(this.ctx.clock);
  }

  /** Merges a patch into the stored run; joins the caller's transaction when there is one. */
  private writeRun(patch: RunPatch = {}, extra: RecordPatch = {}): Run {
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

  private saveRun(patch?: RunPatch, extra?: RecordPatch): void {
    this.emit({ type: 'run.updated', run: this.writeRun(patch, extra) });
  }

  private setPhase(phase: Run['phase']): void {
    if (this.run.phase !== phase) this.saveRun({ phase });
  }

  private saveRound(stored: StoredRound): void {
    this.ctx.store.rounds.update(stored);
    this.emit({ type: 'round.updated', round: stored.round });
  }

  private emit(body: RunEventBody): void {
    // The spread keeps the body's own variant; TypeScript can't see that through the union.
    this.ctx.emit({ ...body, runId: this.ctx.runId, at: this.now() } as RunEvent);
  }

  private emitBudget(): void {
    this.emit({ type: 'budget', state: this.budget.state() });
  }

  private log(level: LogLevel, message: string): void {
    this.emit({ type: 'log', level, message });
  }
}
