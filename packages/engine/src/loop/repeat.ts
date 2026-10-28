import type { Job, StudentTarget } from '@architect/shared';
import type { EngineStore } from '../store/engine-store';
import type { StoredRun } from '../store/records';
import { errorMessage, isAbort, must } from './errors';
import {
  deferredSeedsOf,
  lockedResult,
  lockedTestAttempts,
  openLockedTest,
  runLockedTest,
  testSeedsOf,
} from './graduation';
import { NO_LOCKED_TEST } from './retest';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { isoNow } from './time';

/**
 * Why a run's frozen graduate can't be tested again under the declared seeds it deferred, on
 * `target`, or null when it can: the run finished, its protocol deferred its repeats, it declared
 * more than one seed, and `target` already has the first seed's result (its own locked test, or a
 * finished re-test there).
 */
export function repeatRefusal(
  store: EngineStore,
  record: StoredRun,
  job: Job,
  target: StudentTarget,
): string | null {
  if (record.run.status !== 'finished' || record.freeze === null) {
    return "Only a finished run's frozen graduate has a locked test to repeat.";
  }
  if (record.improves !== undefined) return NO_LOCKED_TEST;
  if (record.protocol?.deferRepeats !== true) {
    return "This run's locked test ran every declared seed at once; there is nothing to repeat.";
  }
  const declared = record.freeze.testSeeds ?? [];
  if (declared.length < 2) return 'This run declared one locked-test seed, so it has no repeat.';
  const firstDone =
    target === record.lockedTestOn ||
    store.retests.get(record.run.id, target)?.status === 'finished';
  if (!firstDone) {
    return `This run's graduate hasn't taken its locked test on the ${target} student yet, so there is nothing there to repeat.`;
  }
  if (target === 'hosted' && !job.student.hosted) {
    return `"${job.name}" has no hosted student endpoint.`;
  }
  return null;
}

/**
 * The frozen graduate's locked test under the declared seeds it deferred, on `target`: the same
 * harness version, configuration and pinned student as its test there. Its attempts are kept with
 * their seeds, so each repeat is reported apart, never as more scenarios; nothing about the run
 * or its card changes.
 */
async function repeatGraduate(state: RunState, target: StudentTarget): Promise<void> {
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const seeds = deferredSeedsOf(state, frozen);
  const test = await openLockedTest(state, frozen, target);
  state.log(
    'info',
    `Repeating the locked test of the graduate frozen at harness version ${frozen.harnessVersion} on the ${target} student, under seed ${seeds.join(' and ')}.`,
  );
  if (!(await runLockedTest(state, frozen, test, 'retest', seeds))) return;
  const { store, runId } = state.ctx;
  const repeat = must(store.repeats.get(runId, target), 'The repeat');
  store.repeats.update({ ...repeat, status: 'finished', endedAt: state.now() });
  state.emit({
    type: 'eval.finished',
    split: 'test',
    harnessVersion: frozen.harnessVersion,
    ...lockedResult(
      lockedTestAttempts(state, frozen, target, testSeedsOf(state, frozen)),
      state.job,
    ),
  });
}

/**
 * One stretch of a repeat, from being queued or recovered until it finishes or an error pauses
 * it. Like a re-test, it releases the mentor before anything else, having never made one.
 */
export class RepeatSession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly target: StudentTarget,
  ) {}

  /** Stops at once, for app shutdown. The repeat stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs } = this.ctx;
    const record = store.runs.get(runId);
    if (!record || store.repeats.get(runId, this.target)?.status !== 'testing') return;
    let state: RunState | undefined;
    try {
      state = new RunState(this.ctx, this.control, await jobs.forRun(record));
      await repeatGraduate(state, this.target);
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(errorMessage(error));
    } finally {
      await state?.resources.close();
    }
  }

  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const repeat = must(store.repeats.get(runId, this.target), 'The repeat');
    store.repeats.update({ ...repeat, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The repeat on the ${this.target} student paused after an error: ${message} Ask for it again once that's fixed.`,
    });
  }
}
