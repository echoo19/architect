import type { Job } from '@architect/shared';
import { RunDriver, type SessionContext, type SessionControl, type SessionOutcome } from './driver';
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
    return new RunDriver(this.ctx, this.control, job).drive();
  }
}
