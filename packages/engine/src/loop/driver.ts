import type { Job, Run } from '@architect/shared';
import { author } from './authoring';
import { saveHarnessCandidate } from './candidate';
import { clarify } from './clarify';
import { interventionOfRound } from './intervene';
import { teach } from './teach';
import { awaitTraining, cancelTraining, startTraining } from './weights';
import { errorMessage, isAbort, passesOnItsOwn, summaryOf } from './errors';
import { proposeVersion } from '../improve/improvement';
import { isHeld } from './protocol';
import { freeze, lockedTest } from './graduation';
import { planNextStep, type ActionStep, type PlanInput } from './plan';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import {
  abandonRound,
  attemptTrain,
  baseline,
  evaluateCandidate,
  finishTraining,
  prepare,
  startRound,
} from './training';

export type SessionOutcome = 'parked' | 'ended' | 'aborted';

/**
 * How long the run waits before going on after a model call failed in a way that usually passes
 * on its own, such as a reply cut off partway or a busy server: 30 s, then 90 s. A third such
 * failure with no attempt finished since the last one pauses the run.
 */
const RETRY_WAITS_MS = [30_000, 90_000];

/**
 * Executes one session of a run: plans the next step from the persisted state, runs it (each
 * step persists its result), and repeats until the run parks or ends.
 */
export class RunDriver {
  private readonly state: RunState;

  constructor(ctx: SessionContext, control: SessionControl, job: Job) {
    this.state = new RunState(ctx, control, job);
  }

  async drive(): Promise<SessionOutcome> {
    const { state } = this;
    state.budget.resume();
    try {
      state.saveRun({ status: this.activeStatus(), error: undefined });
      state.emitBudget();
      let retries = 0;
      let finished = state.run.totals.attempts;
      for (;;) {
        const step = planNextStep(this.planInput());
        if (step.kind === 'done') return 'ended';
        if (step.kind === 'park') {
          state.budget.pause();
          state.saveRun({ status: 'paused' });
          return 'parked';
        }
        try {
          await this.execute(step);
        } catch (error) {
          if (state.run.totals.attempts !== finished) retries = 0;
          finished = state.run.totals.attempts;
          const wait = RETRY_WAITS_MS[retries];
          if (wait === undefined || !passesOnItsOwn(error) || state.signal.aborted) throw error;
          retries += 1;
          state.log('warn', `${summaryOf(error)} Trying again in ${wait / 1000} s.`);
          await this.wait(wait);
          state.signal.throwIfAborted();
        }
      }
    } catch (error) {
      return this.handleError(error);
    } finally {
      state.budget.pause();
      await state.resources.close();
    }
  }

  private execute(step: ActionStep): Promise<void> | void {
    const { state } = this;
    switch (step.kind) {
      case 'prepare':
        return prepare(state);
      case 'baseline':
        return baseline(state);
      case 'start_round':
        return startRound(state, step.round);
      case 'attempt_train':
        return attemptTrain(state, step.round);
      case 'author':
        return author(state, step.round);
      case 'teach':
        return this.teachRound(step.round);
      case 'await_training':
        return awaitTraining(state, step.round);
      case 'clarify':
        return clarify(state, step.round);
      case 'evaluate_candidate':
        return evaluateCandidate(state, step.round);
      case 'abandon_round':
        return this.abandon(step.round, step.reason);
      case 'finish_training':
        return finishTraining(state, step.reason);
      case 'freeze':
        return freeze(state);
      case 'locked_test':
        return lockedTest(state);
      case 'propose_version':
        return proposeVersion(state);
    }
  }

  /** A round's teaching, then its candidate: a harness version, or a training job for weights. */
  private async teachRound(index: number): Promise<void> {
    const { state } = this;
    if (!(await teach(state, index))) return;
    if (interventionOfRound(state, index).type === 'weights') await startTraining(state, index);
    else await saveHarnessCandidate(state, index);
  }

  /** Ends an open round for a stop or the wall clock; a training job it started is stopped too. */
  private async abandon(index: number, reason: string): Promise<void> {
    const { state } = this;
    if (state.round(index).round.status === 'training') await cancelTraining(state, index);
    abandonRound(state, index, reason);
  }

  private handleError(error: unknown): SessionOutcome {
    const { state } = this;
    if (state.signal.aborted || isAbort(error)) {
      // The app is closing: keep the wall time and leave the run active, so the next start resumes it.
      state.writeRun();
      return 'aborted';
    }
    const message = errorMessage(error);
    if (state.run.phase === 'preparing') {
      state.saveRun({
        status: 'failed',
        phase: 'done',
        stopReason: 'error',
        error: message,
        endedAt: state.now(),
      });
      state.log('error', `The run couldn't start: ${message}`);
      return 'ended';
    }
    state.budget.pause();
    state.saveRun({ status: 'paused', error: message });
    state.log('error', `Paused after an error: ${message} Resume the run once it's fixed.`);
    return 'parked';
  }

  /** Waits `ms` on the run's clock, or until the session is aborted. */
  private async wait(ms: number): Promise<void> {
    const signal = AbortSignal.any([this.state.signal, this.state.ctx.clock.timeout(ms)]);
    if (signal.aborted) return;
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => resolve(), { once: true });
    });
  }

  private activeStatus(): Run['status'] {
    const { run, stopRequested } = this.state.record;
    if (run.phase === 'testing') return 'testing';
    return stopRequested ? 'stopping' : 'running';
  }

  private planInput(): PlanInput {
    const { state } = this;
    const { run, stopRequested, freeze: frozen } = state.record;
    return {
      method: run.method,
      status: run.status,
      phase: run.phase,
      stopRequested,
      pauseRequested: state.control.pauseRequested,
      devBaseline: run.devBaseline,
      devCurrent: run.devCurrent,
      frozen: frozen !== null,
      ...(isHeld(state.record) ? { held: true } : {}),
      ...(state.record.protocol?.fixedRounds === true ||
      state.record.protocol?.oneShotAdapter !== undefined
        ? { fixedRounds: true }
        : {}),
      ...(state.record.improves === undefined ? {} : { improves: true }),
      rounds: state.rounds().map(({ round, rejected }) => ({
        ...round,
        rejected,
        ...(round.status === 'clarifying'
          ? {
              awaitingAnswer:
                state.ctx.store.interventions.get(state.ctx.runId, round.index)?.answer ===
                undefined,
            }
          : {}),
      })),
      maxRounds: state.job.budget.maxRounds,
      patience: state.job.evaluation.patience,
      passRateTarget: state.job.requirements.passRate,
      wallClockSpent: state.budget.wallClockSpent(),
    };
  }
}
