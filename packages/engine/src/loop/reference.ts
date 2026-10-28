import {
  GuardError,
  type Job,
  type ReferenceRecord,
  type StudentTarget,
  type Task,
} from '@architect/shared';
import { MentorGate, type LeakDetector } from '../mentor/gate';
import { percentile } from '../report/report-card';
import type { StoredRun } from '../store/records';
import { gatedActor } from '../teaching/actor';
import { resultOf } from './attempts';
import { formatUsd } from './budget';
import { configurationKey, type AttemptConfig } from './configuration';
import { errorMessage, isAbort, must } from './errors';
import { evaluate } from './evaluation';
import { RunState, type SessionContext, type SessionControl } from './run-state';
import { devSeeds } from './seeds';
import { connectActor } from './setup';
import { isoNow } from './time';

/**
 * On the locked test the reference is measured on the test's own tasks, so a leak check against
 * them would refuse every request; it runs only after the run's mentor is released, from a
 * session that never made one, and nothing it does reaches any mentoring request.
 */
const TEST_CONTENT_IS_THE_POINT: LeakDetector = {
  scan: () => ({ leaked: false, matchedIds: [] }),
};

/** Why Spark can't be run as a reference on a run, or null when it can. */
export function referenceRefusal(record: StoredRun, job: Job): string | null {
  if (record.run.status !== 'finished' || record.freeze === null) {
    return "Spark runs as a reference only on a finished run's tasks, once its mentoring is over.";
  }
  if (job.mentor.kind !== 'model') return `${job.mentor.label} can't act as the agent.`;
  return null;
}

/** The configuration a reference's attempts are stored under. */
export function referenceConfig(job: Job): AttemptConfig {
  return {
    actor: 'reference',
    backend: job.mentor.kind === 'model' ? job.mentor.provider : 'none',
    adapter: null,
  };
}

/** The decoding seed a reference runs under: the run's first test seed, or its dev panel's. */
export function referenceSeed(record: StoredRun, split: ReferenceRecord['split']): number {
  if (split === 'test') return record.freeze?.testSeeds?.[0] ?? record.seeds.test;
  return must(devSeeds(record.seeds.devPanel, null, 1)[0], 'The dev seed');
}

/**
 * Spark as the agent on a finished run's tasks, with the frozen graduate's harness, tools and
 * limits (spec 17, comparison 6). It is a measurement apart: it never judges anything, the
 * checker grades it like the student, it has its own disclosed dollar cap, and its attempts and
 * costs are stored under their own configuration, which mentoring never reads. On dev its every
 * request passes the leak check like a mentor call. On the locked test, the mentor is released
 * first and the vault opens only on that proof, as for the graduate's own test.
 */
async function measureReference(state: RunState, split: ReferenceRecord['split']): Promise<void> {
  const { store, deps, runId } = state.ctx;
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const target: StudentTarget = state.record.lockedTestOn;
  let tasks: Task[];
  let leakDetector: LeakDetector;
  if (split === 'test') {
    const proof = await state.resources.releaseMentor();
    tasks = await deps.vault.openForLockedTest(state.run.jobId, proof);
    leakDetector = TEST_CONTENT_IS_THE_POINT;
  } else {
    tasks = await state.devTasks();
    leakDetector = await deps.vault.leakDetector(state.run.jobId);
  }
  const current = () => must(store.references.get(runId, split), 'The reference');
  const gate = new MentorGate({
    leakDetector,
    authorize: (maxUsd) => {
      const reference = current();
      const left = reference.maxUsd - reference.spentUsd;
      if (maxUsd === null) {
        throw new GuardError(
          'budget',
          "The reference's model has no known price, so its cap can't be kept.",
        );
      }
      if (maxUsd > left + 1e-9) {
        throw new GuardError(
          'budget',
          `The reference's next call could cost up to ${formatUsd(maxUsd)}, more than the ${formatUsd(Math.max(0, left))} left of its cap.`,
        );
      }
      return maxUsd;
    },
    onRefusal: (message) => state.log('error', message),
  });
  const raw = await connectActor(deps, state.job);
  state.resources.useReference(
    gatedActor(raw, gate, {
      onCharge: (charge) => {
        store.transaction(() => {
          store.costs.insert({
            runId,
            role: 'reference',
            model: charge.model,
            round: null,
            attemptId: null,
            usage: charge.usage,
            usd: charge.costUsd,
            at: state.now(),
          });
          const reference = current();
          store.references.put({
            ...reference,
            spentUsd: reference.spentUsd + charge.costUsd,
            inputTokens: reference.inputTokens + charge.usage.inputTokens,
            outputTokens: reference.outputTokens + charge.usage.outputTokens,
          });
        });
      },
    }),
  );
  const config = referenceConfig(state.job);
  const done = await evaluate(state, {
    tasks,
    split,
    round: null,
    version: frozen.harnessVersion,
    seeds: [current().seed],
    target,
    purpose: 'retest',
    concurrency: 1,
    config,
  });
  if (!done) return;
  const attempts = state.attempts({
    split,
    round: null,
    version: frozen.harnessVersion,
    target,
    config: configurationKey(config),
  });
  const result = resultOf(attempts, state.job);
  const latencies = attempts.map((attempt) => attempt.latencyMs);
  store.references.put({
    ...current(),
    status: 'finished',
    score: result.score,
    perType: result.perType,
    latencyMs: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    endedAt: state.now(),
  });
  state.announce('reference', `${runId}/${split}`, null);
}

/** One stretch of a reference run, from being queued or recovered until it finishes or pauses. */
export class ReferenceSession {
  private readonly control: SessionControl = {
    pauseRequested: false,
    abort: new AbortController(),
  };

  constructor(
    private readonly ctx: SessionContext,
    private readonly split: ReferenceRecord['split'],
  ) {}

  /** Stops at once, for app shutdown. The reference stays resumable. */
  abort(): void {
    this.control.abort.abort();
  }

  async run(): Promise<void> {
    const { store, runId, jobs } = this.ctx;
    const record = store.runs.get(runId);
    if (!record || store.references.get(runId, this.split)?.status !== 'running') return;
    let state: RunState | undefined;
    try {
      state = new RunState(this.ctx, this.control, await jobs.forRun(record));
      await measureReference(state, this.split);
    } catch (error) {
      if (this.control.abort.signal.aborted || isAbort(error)) return;
      this.pause(errorMessage(error));
    } finally {
      await state?.resources.close();
    }
  }

  private pause(message: string): void {
    const { store, runId, clock, emit } = this.ctx;
    const reference = must(store.references.get(runId, this.split), 'The reference');
    store.references.put({ ...reference, status: 'paused', error: message });
    emit({
      type: 'log',
      runId,
      at: isoNow(clock),
      level: 'error',
      message: `The reference run paused after an error: ${message} Ask for it again once that's fixed.`,
    });
  }
}
