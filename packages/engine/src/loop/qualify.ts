import type { Job, Organization, Qualification } from '@architect/shared';
import { orgResults } from '../report/report-card';
import type { StoredQualification, StoredRun } from '../store/records';
import { configurationKey } from './configuration';
import { errorMessage, isAbort, must } from './errors';
import { evaluate } from './evaluation';
import { firstSeedsOf, frozenConfig, openLockedTest, scenarios } from './graduation';
import { NO_LOCKED_TEST } from './retest';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { isoNow } from './time';

/*
 * Qualifying a frozen version on an organization sealed after its job was made (decision 085):
 * the run's locked test as a re-test takes it, the same harness version, pinned student, seeds
 * and endpoint, with no mentor, on that organization's sealed tasks and files. Its attempts are
 * the run's under split `test` and its own round, so the run's card and totals never change.
 */

/** Why a run's frozen version can't be qualified on an organization added later, or null. */
export function qualifyRefusal(record: StoredRun): string | null {
  const { status } = record.run;
  if (status === 'stopped' || status === 'failed') {
    return 'This run ended without a frozen version, so there is nothing to qualify.';
  }
  if (status !== 'finished' || record.freeze === null) {
    return "This run hasn't finished yet; only a finished run's frozen version can be qualified.";
  }
  if (record.improves !== undefined) return NO_LOCKED_TEST;
  if (record.protocol !== undefined) {
    return "A comparison's run is read in its comparison, so it isn't qualified on its own.";
  }
  return null;
}

/** A qualification as the app shows it: the organization by name, the score once finished. */
export function qualificationView(stored: StoredQualification): Qualification {
  const { orgId: _orgId, orgName, seq: _seq, results, ...shown } = stored;
  return {
    ...shown,
    org: orgName,
    ...(results === undefined
      ? {}
      : {
          score: {
            pass: results.reduce((sum, result) => sum + result.pass, 0),
            total: results.reduce((sum, result) => sum + result.total, 0),
          },
        }),
  };
}

/** Each skill's result at the organization, from its attempts, scenario by scenario. */
function resultsAt(
  job: Job,
  org: Organization,
  state: RunState,
  stored: StoredQualification,
  tasks: Parameters<typeof scenarios>[1],
) {
  const frozen = must(state.record.freeze, 'The frozen version');
  const seeds = firstSeedsOf(state, frozen);
  const attempts = state
    .attempts({
      split: 'test',
      round: stored.seq,
      version: frozen.harnessVersion,
      target: state.record.lockedTestOn,
      config: configurationKey(frozenConfig(frozen)),
    })
    .filter((attempt) => seeds.includes(attempt.seed));
  return orgResults(job, [org], scenarios(attempts, tasks)).map((result) => ({
    ...result,
    addedLater: true as const,
  }));
}

/**
 * One stretch of a qualification, from being queued or recovered until its results are filed or
 * an error pauses it. Like a re-test, it releases the mentor before anything else, having never
 * made one, and it never writes to the run.
 */
export class QualifySession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly orgId: string,
  ) {}

  /** Stops at once, for app shutdown. The qualification stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs, deps } = this.ctx;
    const record = store.runs.get(runId);
    const stored = store.qualifications.get(runId, this.orgId);
    if (!record || stored?.status !== 'testing') return;
    let state: RunState | undefined;
    try {
      state = new RunState(this.ctx, this.control, await jobs.forWork(record));
      const frozen = must(record.freeze, 'The frozen version');
      const target = record.lockedTestOn;
      const test = await openLockedTest(state, frozen, target);
      const proof = await state.resources.releaseMentor();
      const tasks = await deps.vault.openAdded(record.run.jobId, this.orgId, proof);
      const org = must(
        test.sealed.organizations.find((item) => item.id === this.orgId),
        'The organization',
      );
      state.log(
        'info',
        `Qualifying the version frozen at harness version ${frozen.harnessVersion} on an organization added later, with no mentor.`,
      );
      const finished = await evaluate(state, {
        tasks,
        split: 'test',
        round: stored.seq,
        version: frozen.harnessVersion,
        seeds: firstSeedsOf(state, frozen),
        target,
        purpose: 'retest',
        concurrency: 1,
        config: frozenConfig(frozen),
        ...(frozen.configuration === undefined ? {} : { decoding: frozen.configuration.decoding }),
        sealedData: test.sealed.dataDirs,
      });
      if (!finished) return;
      const results = resultsAt(state.job, org, state, stored, tasks);
      store.qualifications.update({
        ...must(store.qualifications.get(runId, this.orgId), 'The qualification'),
        status: 'finished',
        endedAt: isoNow(this.ctx.clock),
        results,
      });
      state.log(
        'info',
        'Qualified on the organization added later; its results are in the report.',
      );
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(errorMessage(error));
    } finally {
      await state?.resources.close();
    }
  }

  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const stored = must(store.qualifications.get(runId, this.orgId), 'The qualification');
    store.qualifications.update({ ...stored, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The qualification paused after an error: ${message} Ask for it again once that's fixed.`,
    });
  }
}
