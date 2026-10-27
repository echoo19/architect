import { AdapterError, type Job, type Run } from '@architect/shared';
import { author } from './authoring';
import { errorMessage } from './errors';
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

function isAbort(error: unknown): boolean {
  return (
    (error instanceof AdapterError && error.code === 'aborted') ||
    (error instanceof Error && error.name === 'AbortError')
  );
}

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
      for (;;) {
        const step = planNextStep(this.planInput());
        if (step.kind === 'done') return 'ended';
        if (step.kind === 'park') {
          state.budget.pause();
          state.saveRun({ status: 'paused' });
          return 'parked';
        }
        await this.execute(step);
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
      case 'evaluate_candidate':
        return evaluateCandidate(state, step.round);
      case 'abandon_round':
        return abandonRound(state, step.round, step.reason);
      case 'finish_training':
        return finishTraining(state, step.reason);
      case 'freeze':
        return freeze(state);
      case 'locked_test':
        return lockedTest(state);
    }
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
      rounds: state.rounds().map(({ round, rejected }) => ({ ...round, rejected })),
      maxRounds: state.job.budget.maxRounds,
      patience: state.job.evaluation.patience,
      passRateTarget: state.job.requirements.passRate,
      wallClockSpent: state.budget.wallClockSpent(),
    };
  }
}
