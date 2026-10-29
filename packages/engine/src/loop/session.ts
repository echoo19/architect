import type { Job, Run } from '@architect/shared';
import type { StoredRun } from '../store/records';
import { RunDriver, type SessionOutcome } from './driver';
import type { SessionContext, SessionControl } from './run-state';
import { isTerminal } from './plan';
import { errorMessage } from './errors';
import { isoNow } from './time';

/**
 * One stretch of a run between being started or resumed and parking or ending. The controller
 * holds it to ask for a pause or to abort on shutdown; the driver does the work.
 */
export class RunSession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(private readonly ctx: SessionContext) {}

  /** Parks the run once the attempt in flight has finished and been saved. */
  requestPause(): void {
    this.control.pauseRequested = true;
  }

  cancelPause(): void {
    this.control.pauseRequested = false;
  }

  /** Stops the session at once, for app shutdown. The run stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<SessionOutcome> {
    const record = this.ctx.store.runs.get(this.ctx.runId);
    if (!record || isTerminal(record.run.status)) return 'ended';
    let job: Job;
    try {
      job = await this.ctx.jobs.forRun(record);
    } catch (error) {
      const now = isoNow(this.ctx.clock);
      const message = `The run's copy of its job can't be read: ${errorMessage(error)}`;
      const run = {
        ...record.run,
        status: 'failed' as const,
        phase: 'done' as const,
        stopReason: 'error' as const,
        error: message,
        updatedAt: now,
        endedAt: now,
      };
      this.ctx.store.runs.update({ ...record, run });
      this.ctx.emit({ type: 'run.updated', runId: run.id, at: now, run });
      return 'ended';
    }
    // Whichever way a run came to be going again (started, resumed, found after a restart, let go
    // of its hold), it works on the job's records as they are now: a rule nobody confirmed over
    // them, or records that changed under a confirmed one, is no ground to train and test on.
    try {
      await this.ctx.jobs.requireConfirmedRules(job);
    } catch (error) {
      return this.holdForRule(record, error);
    }
    return new RunDriver(this.ctx, this.control, job).drive();
  }

  /**
   * Parks the run with the reason, where the person reads it, and leaves it alone. A run that was
   * being stopped can't take its final test on records its rule was not confirmed over, so it ends
   * stopped, as one that has nothing to test does.
   */
  private holdForRule(record: StoredRun, error: unknown): SessionOutcome {
    const message = errorMessage(error);
    const at = isoNow(this.ctx.clock);
    const stopping = record.stopRequested;
    const run: Run = stopping
      ? {
          ...record.run,
          status: 'stopped',
          phase: 'done',
          stopReason: 'user',
          error: message,
          endedAt: at,
          updatedAt: at,
        }
      : { ...record.run, status: 'paused', error: message, updatedAt: at };
    this.ctx.store.runs.update({ ...record, run });
    this.ctx.emit({ type: 'run.updated', runId: run.id, at, run });
    this.ctx.emit({
      type: 'log',
      runId: run.id,
      at,
      level: 'error',
      message: stopping ? `Stopped without a final test. ${message}` : `Paused. ${message}`,
    });
    return stopping ? 'ended' : 'parked';
  }
}
