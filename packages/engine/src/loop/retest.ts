import type { Job, StudentTarget } from '@architect/shared';
import type { StoredRun } from '../store/records';
import { errorMessage, isAbort, must } from './errors';
import {
  lockedResult,
  lockedTestAttempts,
  lockedTestReport,
  openLockedTest,
  runLockedTest,
} from './graduation';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { isoNow } from './time';

/** Why a run's graduate can't be re-tested on `target`, or null when it can. */
/** Why an improvement's candidate is never measured on the locked test (decision 042). */
export const NO_LOCKED_TEST =
  'An improvement is measured on dev, and its candidate never takes the locked test.';

export function retestRefusal(record: StoredRun, job: Job, target: StudentTarget): string | null {
  const { status } = record.run;
  if (status === 'stopped' || status === 'failed') {
    return 'This run ended without a graduate, so there is nothing to re-test.';
  }
  if (status !== 'finished' || record.freeze === null) {
    return "This run hasn't finished yet; only a finished run's frozen graduate can be re-tested.";
  }
  if (record.improves !== undefined) return NO_LOCKED_TEST;
  if (target === record.lockedTestOn) {
    return `This run's locked test already ran on the ${target} student; a re-test runs on the other one.`;
  }
  if (target === 'hosted' && !job.student.hosted) {
    return `"${job.name}" has no hosted student endpoint.`;
  }
  return null;
}

/**
 * The frozen graduate's locked test on `target`, and its card, filed beside the run's own. The
 * same harness version, pinned student and test seed as the run's test; only the endpoint differs.
 */
async function retestGraduate(state: RunState, target: StudentTarget): Promise<void> {
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const test = await openLockedTest(state, frozen, target);
  state.log(
    'info',
    `Re-testing the graduate frozen at harness version ${frozen.harnessVersion} on the ${target} student, with no mentor.`,
  );
  if (!(await runLockedTest(state, frozen, test, 'retest'))) return;
  const attempts = lockedTestAttempts(state, frozen, target);
  const report = await lockedTestReport(state, state.run, test, attempts);
  const { store, runId } = state.ctx;
  store.transaction(() => {
    store.reports.put(report);
    const retest = must(store.retests.get(runId, target), 'The re-test');
    store.retests.update({ ...retest, status: 'finished', endedAt: report.createdAt });
  });
  state.emit({
    type: 'eval.finished',
    split: 'test',
    harnessVersion: frozen.harnessVersion,
    ...lockedResult(attempts, state.job),
  });
}

/**
 * One stretch of a re-test, from being queued or recovered until its card is filed or an error
 * pauses it. It releases the mentor before anything else, having never made one, so the vault's
 * proof comes from a session no mentor was ever part of. It never writes to the run.
 */
export class RetestSession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly target: StudentTarget,
  ) {}

  /** Stops at once, for app shutdown. The re-test stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs } = this.ctx;
    const record = store.runs.get(runId);
    if (!record || store.retests.get(runId, this.target)?.status !== 'testing') return;
    let state: RunState | undefined;
    try {
      state = new RunState(this.ctx, this.control, await jobs.forWork(record));
      await retestGraduate(state, this.target);
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(errorMessage(error));
    } finally {
      await state?.resources.close();
    }
  }

  /** Parks the re-test with the reason, until it is asked for again. */
  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const retest = must(store.retests.get(runId, this.target), 'The re-test');
    store.retests.update({ ...retest, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The re-test on the ${this.target} student paused after an error: ${message} Ask for it again once that's fixed.`,
    });
  }
}
