import {
  loopbackEndpointIssue,
  newId,
  type Job,
  type Qualification,
  type QualifyRequest,
} from '@architect/shared';
import type { StoredQualification, StoredRun } from '../store/records';
import { trainedConfig } from './configuration';
import { errorMessage, isAbort, must } from './errors';
import {
  firstSeedsOf,
  frozenHarness,
  lockedTestAttempts,
  lockedTestReport,
  runLockedTest,
  type LockedTest,
} from './graduation';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { isoNow } from './time';

/*
 * Bringing a trained model back (decision 086): a model trained elsewhere, served on this
 * computer as an OpenAI-compatible endpoint, takes a finished run's locked test and its
 * never-seen organizations under the run's frozen harness, with no mentor. It is a re-test with
 * another student, so it shares the re-test's machinery; its attempts keep their own
 * configuration key, its card is filed with the qualification and the run never changes.
 */

/** Why a run has no frozen harness to qualify a model with, or null when it has. */
export function qualifyRefusal(record: StoredRun): string | null {
  const { status } = record.run;
  if (status === 'stopped' || status === 'failed') {
    return 'This run ended without a graduate, so there is no harness to qualify a model with.';
  }
  if (status !== 'finished' || record.freeze === null) {
    return "This run hasn't finished yet; only a finished run's frozen harness can qualify a model.";
  }
  if (record.improves !== undefined) {
    return 'An improvement is measured on dev, and its candidate never takes the locked test.';
  }
  return null;
}

/** The qualification as the app reads it. */
export function qualificationView(stored: StoredQualification): Qualification {
  const { contextLength: _contextLength, ...shown } = stored;
  return shown;
}

/** A qualification filed `testing`, for a run that can take one. */
export function newQualification(
  record: StoredRun,
  request: QualifyRequest,
  now: string,
): StoredQualification {
  const refusal = qualifyRefusal(record);
  if (refusal !== null) throw new Error(refusal);
  const { endpoint } = request;
  const issue = loopbackEndpointIssue(endpoint.baseUrl);
  if (issue !== null) throw new Error(issue);
  return {
    id: newId('qlf'),
    runId: record.run.id,
    jobId: record.run.jobId,
    harnessVersion: must(record.freeze, 'The frozen graduate').harnessVersion,
    model: endpoint.model,
    baseUrl: endpoint.baseUrl,
    contextLength: endpoint.contextLength,
    status: 'testing',
    startedAt: now,
  };
}

/** The job with the trained model's endpoint as its local student, named for what it is. */
function withTrained(job: Job, stored: StoredQualification): Job {
  return {
    ...job,
    student: {
      ...job.student,
      label: `${stored.model} (trained elsewhere)`,
      local: {
        runtime: 'openai_compatible',
        baseUrl: stored.baseUrl,
        model: stored.model,
        contextLength: stored.contextLength,
      },
    },
  };
}

/**
 * The frozen harness's locked test with the trained model, and its card. The server must answer
 * first, so a model that isn't running pauses the qualification before any attempt is made.
 */
async function qualifyModel(state: RunState, stored: StoredQualification): Promise<void> {
  const { store, deps } = state.ctx;
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const config = trainedConfig(stored.id);
  const { proof, harness } = await frozenHarness(state, frozen);
  const tester = await state.resources.student('local', config);
  if (!tester.isLocal) {
    throw new Error(`${stored.baseUrl} is not on this computer, so no model is qualified there.`);
  }
  const check = await tester.testConnection();
  if (!check.ok) throw new Error([check.error, check.hint].filter(Boolean).join(' '));
  const described = await tester.describe();
  const test: LockedTest = {
    target: 'local',
    tasks: await deps.vault.openForLockedTest(state.run.jobId, proof),
    sealed: await deps.vault.openTransfer(state.run.jobId, proof),
    harness,
    student: {
      label: state.job.student.label,
      model: described.model || stored.model,
      runtime: 'openai_compatible',
      ...(described.quantization === undefined ? {} : { quantization: described.quantization }),
      ...(described.sizeBytes === undefined ? {} : { sizeBytes: described.sizeBytes }),
    },
  };
  state.log(
    'info',
    `Qualifying ${stored.model}, trained elsewhere, on the locked test of the graduate frozen at harness version ${frozen.harnessVersion}, with no mentor.`,
  );
  const seeds = firstSeedsOf(state, frozen);
  if (!(await runLockedTest(state, frozen, test, 'retest', seeds, config))) return;
  const attempts = lockedTestAttempts(state, frozen, 'local', seeds, config);
  const card = await lockedTestReport(state, state.run, test, attempts);
  const current = must(store.qualifications.get(stored.id), 'The qualification');
  store.qualifications.update({ ...current, status: 'finished', card, endedAt: card.createdAt });
}

/**
 * One stretch of a qualification, from being queued or recovered until its card is filed or an
 * error pauses it. It releases the mentor first, having never made one, and never writes to the
 * run.
 */
export class QualifySession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly qualificationId: string,
  ) {}

  /** Stops at once, for app shutdown. The qualification stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs } = this.ctx;
    const record = store.runs.get(runId);
    const stored = store.qualifications.get(this.qualificationId);
    if (!record || stored?.status !== 'testing') return;
    let state: RunState | undefined;
    try {
      state = new RunState(this.ctx, this.control, withTrained(await jobs.forWork(record), stored));
      await qualifyModel(state, stored);
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(errorMessage(error));
    } finally {
      await state?.resources.close();
    }
  }

  /** Parks the qualification with the reason, until it is asked for again. */
  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const stored = must(store.qualifications.get(this.qualificationId), 'The qualification');
    store.qualifications.update({ ...stored, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The qualification of ${stored.model} paused after an error: ${message} Ask for it again once that's fixed.`,
    });
  }
}
