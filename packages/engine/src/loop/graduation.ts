import {
  newId,
  type Harness,
  type Job,
  type ReportCard,
  type Run,
  type StudentModelInfo,
  type StudentTarget,
  type Task,
} from '@architect/shared';
import { SERVER_TURN } from '../graduates/library';
import { ContractBook } from '../graduates/contracts';
import { prepareGraduate } from '../graduates/graduation';
import { registerVersion } from '../graduates/versions';
import { computeReportCard, type TestResult } from '../report/report-card';
import type {
  FrozenConfiguration,
  GraduateFreeze,
  StoredAttempt,
  StudentPin,
} from '../store/records';
import { scoreByType } from '../mentor/view';
import { hashFile } from '../training/artifacts';
import type { EvaluationResult } from './attempts';
import {
  configurationKey,
  LLAMA_CPP,
  llamaCppConfig,
  STUDENT_CONFIG,
  type AttemptConfig,
} from './configuration';
import { must } from './errors';
import { evaluate, type EvaluationPurpose } from './evaluation';
import { settleExperimentCompute } from './experiments';
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

/** The configuration a frozen graduate runs as: its adapter on llama.cpp, or the job's student. */
export function frozenConfig(frozen: GraduateFreeze): AttemptConfig {
  const adapter = frozen.configuration?.adapter ?? null;
  if (adapter === null) return STUDENT_CONFIG;
  return {
    actor: 'student',
    backend: LLAMA_CPP,
    adapter: { id: adapter.id, scale: adapter.scale },
    loaded: [adapter],
  };
}

/**
 * The frozen harness without its adapter on the same llama-server: the adapter loaded and not
 * applied, so the server, the base and the prompt are the graduate's own (decision 051). Null for
 * a graduate without an adapter.
 */
export function withoutAdapterConfig(frozen: GraduateFreeze): AttemptConfig | null {
  const adapter = frozen.configuration?.adapter ?? null;
  return adapter === null ? null : llamaCppConfig([adapter], null);
}

/** The locked test's decoding seeds: fixed at freezing, or the run's test seed for older runs. */
export function testSeedsOf(state: RunState, frozen: GraduateFreeze): number[] {
  return frozen.testSeeds ?? [state.record.seeds.test];
}

/**
 * The declared seeds a locked-test evaluation runs now: all of them, or only the first when the
 * run's protocol defers its repeats, which a repeat runs later (decision 045).
 */
export function firstSeedsOf(state: RunState, frozen: GraduateFreeze): number[] {
  const seeds = testSeedsOf(state, frozen);
  return state.record.protocol?.deferRepeats === true ? seeds.slice(0, 1) : seeds;
}

/** The declared seeds a repeat runs: the ones a deferring protocol held back. */
export function deferredSeedsOf(state: RunState, frozen: GraduateFreeze): number[] {
  return state.record.protocol?.deferRepeats === true ? testSeedsOf(state, frozen).slice(1) : [];
}

/**
 * Fixes what will ship before any test runs: the harness version and its hash, the student, and
 * how it runs: the backend, the adapter with its GGUF's sha256 and its scale, and the decoding.
 * The locked test's decoding seeds are fixed here too, from the job's declared ones (decision
 * 037), so no result can choose them. An adapter that changed since it was measured isn't frozen.
 */
export async function freeze(state: RunState): Promise<void> {
  await state.resources.releaseMentor();
  for (const settled of settleExperimentCompute(
    state.ctx.store,
    state.ctx.deps.training,
    state.ctx.runId,
  )) {
    state.announce('experiment', settled.id, settled.round);
  }
  const harness = await state.resources.harness(state.run.currentVersion);
  const kept = state.run.currentAdapter ?? null;
  let adapter: FrozenConfiguration['adapter'] = null;
  if (kept !== null) {
    const { sha256 } = hashFile(state.ctx.paths.fromStored(kept.path));
    if (sha256 !== kept.sha256) {
      throw new Error(
        `The adapter ${kept.id} changed after it was measured, so the graduate can't be frozen with it.`,
      );
    }
    // Describing it may start the engine's llama-server, so it takes the server's turn.
    const served = await state.ctx.libraryLock.run(SERVER_TURN, async () =>
      (await state.resources.student('local', llamaCppConfig([kept], kept))).describe(),
    );
    adapter = {
      ...kept,
      scale: 1,
      ...(served.digest === undefined ? {} : { baseDigest: served.digest }),
    };
  }
  const frozen: GraduateFreeze = {
    // An improvement makes a version of the agent it improves, never a new agent.
    graduateId: state.record.improves?.graduateId ?? newId('grd'),
    harnessVersion: harness.meta.version,
    harnessHash: harness.meta.hash,
    student: pinOf(state, await (await state.resources.student('local')).describe()),
    frozenAt: state.now(),
    configuration: {
      backend: adapter === null ? state.job.student.local.runtime : LLAMA_CPP,
      adapter,
      decoding: harness.decoding,
    },
    testSeeds: state.job.evaluation.lockedTestSeeds ?? [state.record.seeds.test],
  };
  state.saveRun({}, { freeze: frozen });
  const using = adapter === null ? '' : ` with adapter ${adapter.id}`;
  state.log(
    'info',
    state.record.improves === undefined
      ? `Graduate frozen at harness version ${frozen.harnessVersion}${using} before its locked test.`
      : `Candidate frozen at harness version ${frozen.harnessVersion}${using}. An improvement is measured on dev and takes no locked test.`,
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
  // A version saved in format 1 is read migrated, with a new hash; it is still the frozen
  // graduate when the files it was migrated from have the frozen hash. It is tested, and ships,
  // as it runs now, and its package keeps the old hash.
  const frozenAs = harness.meta.migratedFrom?.hash ?? harness.meta.hash;
  if (harness.meta.hash !== frozen.harnessHash && frozenAs !== frozen.harnessHash) {
    throw new Error(
      `Harness version ${frozen.harnessVersion} changed after the graduate was frozen, so it won't be tested.`,
    );
  }
  const adapter = frozen.configuration?.adapter ?? null;
  if (adapter !== null) {
    if (target !== 'local') {
      throw new Error(
        "This graduate carries an adapter, which runs only on this computer's base model; the hosted copy can't take its test.",
      );
    }
    const { sha256 } = hashFile(state.ctx.paths.fromStored(adapter.path));
    if (sha256 !== adapter.sha256) {
      throw new Error(
        `The adapter ${adapter.id} changed after the graduate was frozen, so it won't be tested.`,
      );
    }
  }
  const pinned = await state.resources.student('local');
  const tester = await state.resources.student(target, frozenConfig(frozen));
  const described = await (target === 'local' ? pinned : tester).describe();
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
 * Attempts every locked test task once under each of the frozen decoding seeds, one at a time,
 * in exactly the frozen configuration: its harness version, adapter and scale, backend and
 * decoding. Resolves true once all are done; attempts made in an earlier session aren't made
 * again.
 */
export function runLockedTest(
  state: RunState,
  frozen: GraduateFreeze,
  test: LockedTest,
  purpose: Exclude<EvaluationPurpose, 'training'>,
  seeds: readonly number[] = firstSeedsOf(state, frozen),
  config: AttemptConfig = frozenConfig(frozen),
): Promise<boolean> {
  return evaluate(state, {
    tasks: test.tasks,
    split: 'test',
    round: null,
    version: frozen.harnessVersion,
    seeds,
    target: test.target,
    purpose,
    concurrency: 1,
    config,
    ...(frozen.configuration === undefined ? {} : { decoding: frozen.configuration.decoding }),
  });
}

/** The frozen graduate's locked-test attempts on one target, under its frozen configuration. */
export function lockedTestAttempts(
  state: RunState,
  frozen: GraduateFreeze,
  target: StudentTarget,
  seeds: readonly number[] = firstSeedsOf(state, frozen),
): StoredAttempt[] {
  return state
    .attempts({
      split: 'test',
      round: null,
      version: frozen.harnessVersion,
      target,
      config: configurationKey(frozenConfig(frozen)),
    })
    .filter((attempt) => seeds.includes(attempt.seed));
}

/**
 * The locked test's results per scenario: a task passes only when it passed under every
 * repeat, so repeats never count as more scenarios. Its time is its slowest repeat's, and it
 * was refused when any repeat was.
 */
function scenarios(attempts: readonly StoredAttempt[]): TestResult[] {
  const byTask = new Map<string, StoredAttempt[]>();
  for (const attempt of attempts) {
    byTask.set(attempt.taskId, [...(byTask.get(attempt.taskId) ?? []), attempt]);
  }
  return [...byTask.values()].map((repeats) => ({
    taskType: must(repeats[0], 'A repeat').taskType,
    pass: repeats.every((attempt) => attempt.check.pass),
    latencyMs: Math.max(...repeats.map((attempt) => attempt.latencyMs)),
    refused: repeats.some((attempt) => attempt.stopReason === 'refused'),
  }));
}

/** The locked test's score and per-type results, counting scenarios rather than repeats. */
export function lockedResult(attempts: readonly StoredAttempt[], job: Job): EvaluationResult {
  const results = scenarios(attempts);
  return {
    score: { pass: results.filter((result) => result.pass).length, total: results.length },
    perType: scoreByType(
      results.map((result) => ({ type: result.taskType, pass: result.pass })),
      job,
    ),
  };
}

/** Each repeat's own result, by its seed, in the order the seeds were declared. */
function repeatsOf(
  seeds: readonly number[],
  attempts: readonly StoredAttempt[],
): NonNullable<ReportCard['test']['repeats']> {
  return seeds.map((seed) => {
    const repeat = attempts.filter((attempt) => attempt.seed === seed);
    return {
      seed,
      score: { pass: repeat.filter((attempt) => attempt.check.pass).length, total: repeat.length },
    };
  });
}

/**
 * The card of a locked test, from its attempts and the run's record. With more than one
 * decoding seed, the score counts scenarios and each repeat's own score is kept beside it.
 */
export async function lockedTestReport(
  state: RunState,
  run: Run,
  test: LockedTest,
  attempts: readonly StoredAttempt[],
): Promise<ReportCard> {
  const rounds = state.rounds();
  const tester = await state.resources.student(test.target);
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const seeds = firstSeedsOf(state, frozen);
  const card = computeReportCard({
    job: state.job,
    run,
    rounds: rounds.map(({ round }) => round),
    lineage: await state.lineage.read(),
    test: scenarios(attempts),
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
  return seeds.length < 2
    ? card
    : { ...card, test: { ...card.test, repeats: repeatsOf(seeds, attempts) } };
}

/**
 * Writes the graduate's version 1 and prepares its installation on this computer, then files the
 * report card, records the version and finishes the run in one transaction.
 */
async function graduate(state: RunState, test: LockedTest, frozen: GraduateFreeze): Promise<void> {
  const { paths, store, deps, runId } = state.ctx;
  const { job } = state;
  const attempts = lockedTestAttempts(state, frozen, test.target);
  state.emit({
    type: 'eval.finished',
    split: 'test',
    harnessVersion: frozen.harnessVersion,
    ...lockedResult(attempts, job),
  });
  const run: Run = {
    ...state.run,
    totals: { ...state.run.totals, wallMs: Math.round(state.budget.wallMs()) },
  };
  const report = await lockedTestReport(state, run, test, attempts);
  const { createdAt } = report;
  const contract = new ContractBook(store, state.ctx.clock).ensure(job);
  const graduation = {
    job,
    run,
    contract,
    freeze: frozen,
    harness: test.harness,
    harnessFiles: deps.harness.harnessToFiles(test.harness),
    report,
    rounds: state.rounds().map(({ round }) => round),
    lineage: await state.lineage.read(),
  };
  const { written, installation } = await prepareGraduate(store, paths, graduation);

  const finished = store.transaction(() => {
    store.reports.put(report);
    registerVersion(store, paths, {
      graduateId: frozen.graduateId,
      name: job.name,
      version: 1,
      written,
      runId,
      state: 'candidate',
      installation,
      at: createdAt,
    });
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
 * released first. A pause parks it like any other evaluation; it is never stopped. A protocol
 * that pairs it without its adapter runs the same tasks and seeds again with the adapter loaded
 * and not applied, before the graduate is filed; its card stays the graduate's own result.
 */
export async function lockedTest(state: RunState): Promise<void> {
  const frozen = must(state.record.freeze, 'The frozen graduate');
  const test = await openLockedTest(state, frozen, state.record.lockedTestOn);
  if (!(await runLockedTest(state, frozen, test, 'locked_test'))) return;
  const without = withoutAdapterConfig(frozen);
  if (state.record.protocol?.pairedWithoutAdapter === true && without !== null) {
    const seeds = firstSeedsOf(state, frozen);
    if (!(await runLockedTest(state, frozen, test, 'locked_test', seeds, without))) return;
  }
  await graduate(state, test, frozen);
}
