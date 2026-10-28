import {
  newId,
  type Harness,
  type ReportCard,
  type Run,
  type StudentModelInfo,
  type StudentTarget,
  type Task,
} from '@architect/shared';
import { buildGraduateManifest } from '../report/manifest';
import { computeReportCard } from '../report/report-card';
import type { GraduateFreeze, StoredAttempt, StudentPin } from '../store/records';
import { resultOf } from './attempts';
import { must } from './errors';
import { evaluate, type EvaluationPurpose } from './evaluation';
import type { RunState } from './run-state';
import { studentEndpoint } from './setup';

/** Who wrote the run's hypotheses, as the report card names them. */
function authorIdentity(state: RunState): ReportCard['mentor'] {
  const { job } = state;
  switch (state.run.method) {
    case 'bare':
      return { label: 'No mentor', model: '' };
    case 'self_reflection':
      return {
        label: `${job.student.label} (self-reflection)`,
        model: studentEndpoint(job, job.student.trainOn).model,
      };
    default:
      return {
        label: job.mentor.label,
        model: job.mentor.kind === 'model' ? job.mentor.model : job.mentor.agent,
      };
  }
}

/** The local student as a pin; a runtime that names no model is serving the job's. */
function pinOf(state: RunState, info: StudentModelInfo): StudentPin {
  return {
    model: info.model || state.job.student.local.model,
    quantization: info.quantization,
    digest: info.digest,
    sizeBytes: info.sizeBytes,
    contextLength: info.contextLength,
  };
}

/** How the local student differs from the build the graduate pinned, or null when it doesn't. */
function pinDrift(pinned: StudentPin, now: StudentPin): string | null {
  if (now.model !== pinned.model) return `it serves ${now.model} instead of ${pinned.model}`;
  if (pinned.digest !== undefined && now.digest !== pinned.digest) {
    return `${pinned.model} has digest ${now.digest ?? 'unknown'} instead of ${pinned.digest}`;
  }
  if (pinned.quantization !== undefined && now.quantization !== pinned.quantization) {
    return `${pinned.model} is quantized ${now.quantization ?? 'unknown'} instead of ${pinned.quantization}`;
  }
  return null;
}

/** Fixes what will ship before any test runs: the harness version, its hash and the student. */
export async function freeze(state: RunState): Promise<void> {
  await state.resources.releaseMentor();
  const harness = await state.resources.harness(state.run.currentVersion);
  const frozen: GraduateFreeze = {
    graduateId: newId('grd'),
    harnessVersion: harness.meta.version,
    harnessHash: harness.meta.hash,
    student: pinOf(state, await (await state.resources.student('local')).describe()),
    frozenAt: state.now(),
  };
  state.saveRun({}, { freeze: frozen });
  state.log(
    'info',
    `Graduate frozen at harness version ${frozen.harnessVersion} before its locked test.`,
  );
}

/** The frozen graduate, opened for its locked test on one of the job's student endpoints. */
export interface LockedTest {
  target: StudentTarget;
  tasks: Task[];
  harness: Harness;
  /** The student the test runs on, as its report card names it. */
  student: ReportCard['student'];
}

/**
 * Releases the mentor, checks that what is about to be tested is the frozen graduate, and only
 * then opens the locked test. The harness version must still have its hash, and the local
 * student must still be the pinned build. A hosted copy has no pin to hold it to: its card names
 * it as it describes itself, never with the local build's quantization.
 */
export async function openLockedTest(
  state: RunState,
  frozen: GraduateFreeze,
  target: StudentTarget,
): Promise<LockedTest> {
  const proof = await state.resources.releaseMentor();
  const harness = await state.resources.harness(frozen.harnessVersion);
  if (harness.meta.hash !== frozen.harnessHash) {
    throw new Error(
      `Harness version ${frozen.harnessVersion} no longer has the hash it was frozen with, so it won't be tested: it changed after the graduate was frozen, or it was frozen in harness format 1, and its results belong to the tools it ran with.`,
    );
  }
  const tester = await state.resources.student(target);
  const described = await tester.describe();
  const drift = target === 'local' ? pinDrift(frozen.student, pinOf(state, described)) : null;
  if (drift !== null) {
    throw new Error(
      `The local student isn't the model this graduate was frozen with: ${drift}. A test on it wouldn't describe the graduate.`,
    );
  }
  const build = target === 'local' ? frozen.student : described;
  return {
    target,
    tasks: await state.ctx.deps.vault.openForLockedTest(state.run.jobId, proof),
    harness,
    student: {
      label: state.job.student.label,
      model: tester.model,
      runtime: studentEndpoint(state.job, target).runtime,
      ...(build.quantization === undefined ? {} : { quantization: build.quantization }),
      ...(build.sizeBytes === undefined ? {} : { sizeBytes: build.sizeBytes }),
    },
  };
}

/**
 * Attempts every locked test task once, one at a time, under the run's test seed. Resolves
 * true once all are done; tasks attempted in an earlier session aren't attempted again.
 */
export function runLockedTest(
  state: RunState,
  frozen: GraduateFreeze,
  test: LockedTest,
  purpose: Exclude<EvaluationPurpose, 'training'>,
): Promise<boolean> {
  return evaluate(state, {
    tasks: test.tasks,
    split: 'test',
    round: null,
    version: frozen.harnessVersion,
    seeds: [state.record.seeds.test],
    target: test.target,
    purpose,
    concurrency: 1,
  });
}

/** The frozen graduate's locked-test attempts on one target. */
export function lockedTestAttempts(
  state: RunState,
  frozen: GraduateFreeze,
  target: StudentTarget,
): StoredAttempt[] {
  return state.attempts({ split: 'test', round: null, version: frozen.harnessVersion, target });
}

/** The card of a locked test, from its attempts and the run's record. */
export async function lockedTestReport(
  state: RunState,
  run: Run,
  test: LockedTest,
  attempts: readonly StoredAttempt[],
): Promise<ReportCard> {
  const rounds = state.rounds();
  const tester = await state.resources.student(test.target);
  return computeReportCard({
    job: state.job,
    run,
    rounds: rounds.map(({ round }) => round),
    lineage: await state.lineage.read(),
    test: attempts.map((attempt) => ({
      taskType: attempt.taskType,
      pass: attempt.check.pass,
      latencyMs: attempt.latencyMs,
      refused: attempt.stopReason === 'refused',
    })),
    guardrails: test.harness.guardrails,
    student: test.student,
    testedOn: test.target,
    mentor: authorIdentity(state),
    readyClaimed: rounds.some(({ hypothesis }) => hypothesis?.readyClaim === true),
    studentUsd: state.ctx.store.costs
      .list(state.ctx.runId)
      .filter((cost) => cost.role === 'student')
      .reduce((sum, cost) => sum + (cost.usd ?? 0), 0),
    ranOffline: test.target === 'local' && tester.isLocal,
    createdAt: state.now(),
  });
}

/** Writes the report card and the graduate folder, and finishes the run. */
async function graduate(state: RunState, test: LockedTest, frozen: GraduateFreeze): Promise<void> {
  const { paths, store, deps, runId } = state.ctx;
  const { job } = state;
  const attempts = lockedTestAttempts(state, frozen, test.target);
  state.emit({
    type: 'eval.finished',
    split: 'test',
    harnessVersion: frozen.harnessVersion,
    ...resultOf(attempts, job),
  });
  const run: Run = {
    ...state.run,
    totals: { ...state.run.totals, wallMs: Math.round(state.budget.wallMs()) },
  };
  const report = await lockedTestReport(state, run, test, attempts);
  const { createdAt } = report;
  const manifest = buildGraduateManifest({
    freeze: frozen,
    job,
    run,
    report,
    rounds: state.rounds().map(({ round }) => round),
    endpoint: job.student.local,
    createdAt,
  });
  const dir = paths.graduateDir(frozen.graduateId);
  await deps.harness.writeGraduate(dir, {
    harness: test.harness,
    manifest,
    report,
    lineage: await state.lineage.read(),
  });

  const finished = store.transaction(() => {
    store.reports.put(report);
    const existing = store.graduates.get(frozen.graduateId);
    const record = {
      id: frozen.graduateId,
      runId,
      name: job.name,
      path: paths.toStored(dir),
      manifest,
      settings: existing?.settings ?? null,
      createdAt,
    };
    if (existing) store.graduates.update(record);
    else store.graduates.insert(record);
    return state.writeRun({
      status: 'finished',
      phase: 'done',
      endedAt: createdAt,
      graduateId: frozen.graduateId,
    });
  });
  state.emit({ type: 'run.updated', run: finished });
  state.emit({ type: 'graduate.ready', graduateId: frozen.graduateId });
}

/**
 * The frozen graduate's one locked test, on the target the run chose, with the mentor
 * released first. A pause parks it like any other evaluation; it is never stopped.
 */
export async function lockedTest(state: RunState): Promise<void> {
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const test = await openLockedTest(state, frozen, state.record.lockedTestOn);
  if (await runLockedTest(state, frozen, test, 'locked_test')) await graduate(state, test, frozen);
}
